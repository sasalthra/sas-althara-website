/**
 * Read-only admin assistant math. No database and no provider calls.
 * Client names and phones stay out of anything this module marks as model-safe.
 */

import {displayStage, stageLabel} from './lead-stages';

export const OVERDUE_AFTER_DAYS = 3;
export const ASSISTANT_ROLES = ['admin', 'supervisor'] as const;

export const OVERDUE_RULE =
  'يُعد العميل متأخراً إذا بقي في مرحلة مفتوحة دون أي نشاط أو متابعة لأكثر من 3 أيام. مراحل الخروج (غير مؤهل، غير مهتم، مغلق) ومراحل التحويل (وقع عقد، دفع عربون، إفراغ) لا تدخل في هذا التنبيه.';

export const SUGGESTED_QUESTIONS = [
  'حلل أداء الموظفين',
  'ملخص الفريق',
  'ما توزيع المراحل؟',
  'المصادر والحملات',
  'كم العميل المتأخر؟',
  'حالة التفويج الميداني',
] as const;

const CONVERSION_STAGES = new Set(['contract_signed', 'deposit_paid', 'transferred', 'won']);
const EXIT_STAGES = new Set(['unqualified', 'not_interested', 'closed']);

const SOURCE_LABELS: Record<string, string> = {
  manual: 'يدوي',
  excel: 'إكسل',
  website: 'الموقع',
  'property-inquiry': 'استفسار عقار',
  contact: 'تواصل',
  'calculate-loan': 'حساب تمويل',
  meta: 'ميتا',
  google: 'جوجل',
  tiktok: 'تيك توك',
};

export type SpendSummary = {available: boolean; total: number};

export type EmployeeStat = {
  id: string;
  name: string;
  leads: number;
  overdue: number;
  conversions: number;
  conversionPct: number;
  lastLoginDays: number | null;
};

export type AlertRow = {
  id: string;
  name: string;
  phone: string;
  stage: string;
  stageLabel: string;
  salesName: string;
  days: number;
};

export type AssistantSnapshot = {
  generatedAt: string;
  kpis: {
    overdue: number;
    conversions: number;
    properties: number;
    campaignSpend: SpendSummary;
  };
  employees: EmployeeStat[];
  stages: {label: string; count: number}[];
  sources: {label: string; count: number}[];
  campaigns: {label: string; count: number}[];
  field: {
    inStage: number;
    assigned: number;
    unassigned: number;
    byEmployee: {name: string; count: number}[];
  };
  overdueByStage: {label: string; count: number}[];
  unassignedLeads: number;
  unassignedOverdue: number;
  leadCount: number;
  alerts: AlertRow[];
  alertsTotal: number;
};

export type RawLead = {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  notes: string;
  assignedTo: string;
  fieldAssignedTo: string;
  createdAt: unknown;
  updatedAt: unknown;
};

export type RawUser = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt: unknown;
};

export function parseCrmInstant(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let normalized = trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) normalized = `${trimmed}T00:00:00.000Z`;
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(trimmed) && !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    normalized = `${trimmed.replace(' ', 'T')}Z`;
  }
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

export function ageInDays(thenMs: number, nowMs: number): number {
  return Math.floor((nowMs - thenMs) / 86_400_000);
}

export function isConversionStage(stage: string): boolean {
  const shown = displayStage(stage) || stage;
  return CONVERSION_STAGES.has(stage) || CONVERSION_STAGES.has(shown);
}

export function isOpenStage(stage: string): boolean {
  if (!stage) return false;
  if (isConversionStage(stage)) return false;
  const shown = displayStage(stage) || stage;
  return !EXIT_STAGES.has(stage) && !EXIT_STAGES.has(shown);
}

export function isFieldDispatchStage(stage: string): boolean {
  return (displayStage(stage) || stage) === 'field_dispatch';
}

export function sourceLabel(source: string): string {
  const key = source.trim();
  if (!key) return 'غير محدد';
  return SOURCE_LABELS[key] || key;
}

export function campaignFromNotes(notes: string): string | null {
  const match = /(?:الحملة(?:\s*\/\s*النموذج)?|حملة)\s*[:：]\s*([^\n.]{1,80})/.exec(notes || '');
  if (!match) return null;
  const name = match[1].replace(/\s+/g, ' ').trim();
  if (!name || /05\d{8}/.test(name)) return null;
  return name.slice(0, 80);
}

export function redactPhones(text: string): string {
  return text.replace(/(?:\+?966|00966|0)?5\d{8}/g, '[رقم]');
}

function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1);
}

function ranked(map: Map<string, number>): {label: string; count: number}[] {
  return [...map.entries()]
    .map(([label, count]) => ({label, count}))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ar'));
}

export function assembleSnapshot(input: {
  leads: RawLead[];
  users: RawUser[];
  activityAt: Map<string, number>;
  propertyIds: string[];
  spend: SpendSummary;
  now?: Date;
}): AssistantSnapshot {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const usersById = new Map(input.users.map(user => [user.id, user]));
  const stageCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const campaignCounts = new Map<string, number>();
  const overdueStageCounts = new Map<string, number>();
  const fieldCounts = new Map<string, number>();
  const owned = new Map<string, {leads: number; overdue: number; conversions: number}>();

  const ensureOwned = (id: string) => {
    let row = owned.get(id);
    if (!row) {
      row = {leads: 0, overdue: 0, conversions: 0};
      owned.set(id, row);
    }
    return row;
  };

  let conversions = 0;
  let overdue = 0;
  let unassignedLeads = 0;
  let unassignedOverdue = 0;
  let fieldInStage = 0;
  let fieldAssigned = 0;
  const alerts: AlertRow[] = [];

  for (const lead of input.leads) {
    const shown = displayStage(lead.stage) || lead.stage || 'new';
    bump(stageCounts, stageLabel(shown));
    bump(sourceCounts, sourceLabel(lead.source));
    const campaign = campaignFromNotes(lead.notes);
    if (campaign) bump(campaignCounts, campaign);

    const converted = isConversionStage(lead.stage);
    if (converted) conversions += 1;
    const open = isOpenStage(lead.stage);
    const activityMs = input.activityAt.get(lead.id) ?? null;
    const leadMs = [activityMs, parseCrmInstant(lead.updatedAt), parseCrmInstant(lead.createdAt)]
      .filter((value): value is number => value != null)
      .reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
    const days = Number.isFinite(leadMs) ? ageInDays(leadMs, nowMs) : OVERDUE_AFTER_DAYS + 1;
    const late = open && days > OVERDUE_AFTER_DAYS;
    if (late) {
      overdue += 1;
      bump(overdueStageCounts, stageLabel(shown));
      const sales = lead.assignedTo ? usersById.get(lead.assignedTo) : undefined;
      alerts.push({
        id: lead.id,
        name: lead.name || 'بدون اسم',
        phone: lead.phone,
        stage: shown,
        stageLabel: stageLabel(shown),
        salesName: sales?.name || 'غير معيّن',
        days,
      });
    }

    if (isFieldDispatchStage(lead.stage)) {
      fieldInStage += 1;
      if (lead.fieldAssignedTo) {
        fieldAssigned += 1;
        const fieldUser = usersById.get(lead.fieldAssignedTo);
        bump(fieldCounts, fieldUser?.name || 'ميداني');
      }
    }

    const ownerIds = [...new Set([lead.assignedTo, lead.fieldAssignedTo].filter(Boolean))];
    if (!ownerIds.length) {
      unassignedLeads += 1;
      if (late) unassignedOverdue += 1;
    }
    for (const id of ownerIds) {
      const row = ensureOwned(id);
      row.leads += 1;
      if (late) row.overdue += 1;
      if (converted) row.conversions += 1;
    }
  }

  alerts.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'ar'));

  const listedUsers = input.users.filter(user => user.active || owned.has(user.id));
  for (const user of listedUsers) ensureOwned(user.id);

  const employees: EmployeeStat[] = [...owned.entries()].map(([id, row]) => {
    const user = usersById.get(id);
    const loginMs = parseCrmInstant(user?.lastLoginAt);
    return {
      id,
      name: user?.name || 'موظف',
      leads: row.leads,
      overdue: row.overdue,
      conversions: row.conversions,
      conversionPct: percent(row.conversions, row.leads),
      lastLoginDays: loginMs == null ? null : Math.max(0, ageInDays(loginMs, nowMs)),
    };
  }).sort((a, b) => b.overdue - a.overdue || b.leads - a.leads || a.name.localeCompare(b.name, 'ar'));

  return {
    generatedAt: now.toISOString(),
    kpis: {
      overdue,
      conversions,
      properties: new Set(input.propertyIds.filter(Boolean)).size,
      campaignSpend: input.spend,
    },
    employees,
    stages: ranked(stageCounts),
    sources: ranked(sourceCounts),
    campaigns: ranked(campaignCounts),
    field: {
      inStage: fieldInStage,
      assigned: fieldAssigned,
      unassigned: Math.max(0, fieldInStage - fieldAssigned),
      byEmployee: ranked(fieldCounts).map(row => ({name: row.label, count: row.count})),
    },
    overdueByStage: ranked(overdueStageCounts),
    unassignedLeads,
    unassignedOverdue,
    leadCount: input.leads.length,
    alerts: alerts.slice(0, 150),
    alertsTotal: alerts.length,
  };
}

export type ModelFacts = {
  overdueRule: string;
  kpis: {
    overdueLeads: number;
    conversions: number;
    properties: number;
    campaignSpend: number | null;
  };
  employees: {
    name: string;
    leads: number;
    overdue: number;
    conversionPct: number;
    lastLoginDays: number | null;
  }[];
  stages: {label: string; count: number}[];
  sources: {label: string; count: number}[];
  campaigns: {label: string; count: number}[];
  fieldDispatch: AssistantSnapshot['field'];
  overdueByStage: {label: string; count: number}[];
  unassignedLeads: number;
  unassignedOverdue: number;
};

/** Aggregates safe to send to an external model. No client names or phones. */
export function modelFacts(snapshot: AssistantSnapshot): ModelFacts {
  return {
    overdueRule: OVERDUE_RULE,
    kpis: {
      overdueLeads: snapshot.kpis.overdue,
      conversions: snapshot.kpis.conversions,
      properties: snapshot.kpis.properties,
      campaignSpend: snapshot.kpis.campaignSpend.available ? snapshot.kpis.campaignSpend.total : null,
    },
    employees: snapshot.employees.map(employee => ({
      name: employee.name,
      leads: employee.leads,
      overdue: employee.overdue,
      conversionPct: employee.conversionPct,
      lastLoginDays: employee.lastLoginDays,
    })),
    stages: snapshot.stages,
    sources: snapshot.sources,
    campaigns: snapshot.campaigns,
    fieldDispatch: snapshot.field,
    overdueByStage: snapshot.overdueByStage,
    unassignedLeads: snapshot.unassignedLeads,
    unassignedOverdue: snapshot.unassignedOverdue,
  };
}

function loginText(days: number | null): string {
  return days == null ? 'آخر دخول غير مسجل' : `آخر دخول ${days} يوم`;
}

export function employeeLine(employee: EmployeeStat): string {
  return `${employee.name}: ${employee.leads} عميل، ${employee.overdue} متأخر، تحويل ${employee.conversionPct}%، ${loginText(employee.lastLoginDays)}`;
}

function companyConversion(snapshot: AssistantSnapshot): number {
  return percent(snapshot.kpis.conversions, snapshot.leadCount);
}

function shortfalls(snapshot: AssistantSnapshot): string[] {
  const company = companyConversion(snapshot);
  const lines: string[] = [];
  for (const employee of snapshot.employees) {
    const reasons: string[] = [];
    if (employee.overdue > 0) {
      const noun = employee.overdue === 1 ? 'عميل' : 'عملاء';
      reasons.push(`لديه ${employee.overdue} ${noun} بلا متابعة منذ أكثر من 3 أيام`);
    }
    if (employee.leads >= 3 && employee.conversionPct + 10 < company) {
      reasons.push(`نسبة التحويل ${employee.conversionPct}% أقل من متوسط الفريق ${company}%`);
    }
    if (employee.lastLoginDays == null) reasons.push('لا يوجد تسجيل دخول محفوظ');
    else if (employee.lastLoginDays > 7) reasons.push(`آخر دخول منذ ${employee.lastLoginDays} يوم`);
    if (reasons.length) lines.push(`- ${employee.name}: ${reasons.join('؛ ')}`);
  }
  if (snapshot.unassignedOverdue > 0) {
    lines.push(`- عملاء بلا مندوب: ${snapshot.unassignedOverdue} متأخر من أصل ${snapshot.unassignedLeads} غير معيّن`);
  }
  return lines;
}

function actions(snapshot: AssistantSnapshot): string[] {
  const steps: string[] = [];
  if (snapshot.kpis.overdue > 0) steps.push('- ابدأ بالعملاء الأقدم في لوحة التنبيهات واتصل بهم اليوم');
  if (shortfalls(snapshot).some(line => line.includes('التحويل'))) {
    steps.push('- راجع مراحل التفاوض والإحالة للبنك مع الموظفين الأقل تحويلاً');
  }
  if (snapshot.employees.some(employee => employee.lastLoginDays == null || employee.lastLoginDays > 7)) {
    steps.push('- اطلب تسجيل الدخول وتحديث المتابعات قبل نهاية اليوم');
  }
  if (snapshot.field.unassigned > 0) steps.push('- عيّن ميدانياً لعملاء التفويج الذين بلا مسؤول');
  if (!steps.length) steps.push('- لا قصور ظاهر في المتابعة أو التحويل حسب القاعدة الحالية');
  return steps;
}

function teamAnswer(snapshot: AssistantSnapshot): string {
  const lines = snapshot.employees.length
    ? snapshot.employees.map(employeeLine)
    : ['لا يوجد موظفون نشطون في النظام.'];
  const gaps = shortfalls(snapshot);
  return [
    lines.join('\n'),
    '',
    'أسباب القصور',
    gaps.length ? gaps.join('\n') : '- لا قصور ظاهر حسب قاعدة التأخير والتحويل الحالية.',
    '',
    'إجراءات مقترحة',
    actions(snapshot).join('\n'),
  ].join('\n');
}

function stageAnswer(snapshot: AssistantSnapshot): string {
  if (!snapshot.stages.length) return 'لا توجد عملاء لعرض توزيع المراحل.';
  return ['توزيع المراحل', ...snapshot.stages.map(row => `- ${row.label}: ${row.count}`)].join('\n');
}

function sourceAnswer(snapshot: AssistantSnapshot): string {
  const parts = ['المصادر'];
  parts.push(...(snapshot.sources.length ? snapshot.sources.map(row => `- ${row.label}: ${row.count}`) : ['- لا توجد مصادر']));
  parts.push('', 'الحملات المذكورة في التسجيل');
  parts.push(...(snapshot.campaigns.length ? snapshot.campaigns.map(row => `- ${row.label}: ${row.count}`) : ['- لا توجد حملات مسجّلة في ملاحظات التسجيل']));
  parts.push('', snapshot.kpis.campaignSpend.available
    ? `مصروف الحملات: ${snapshot.kpis.campaignSpend.total}`
    : 'مصروف الحملات: غير مسجّل في قاعدة البيانات');
  return parts.join('\n');
}

function overdueAnswer(snapshot: AssistantSnapshot): string {
  const byEmployee = snapshot.employees.filter(employee => employee.overdue > 0);
  return [
    `العملاء المتأخرون: ${snapshot.kpis.overdue}.`,
    OVERDUE_RULE,
    byEmployee.length ? byEmployee.map(employee => `- ${employee.name}: ${employee.overdue} متأخر`).join('\n') : '- لا موظف لديه عملاء متأخرون.',
    snapshot.overdueByStage.length ? snapshot.overdueByStage.map(row => `- ${row.label}: ${row.count}`).join('\n') : '',
  ].filter(Boolean).join('\n');
}

function fieldAnswer(snapshot: AssistantSnapshot): string {
  const lines = [
    `في مرحلة التفويج: ${snapshot.field.inStage}.`,
    `معيّن لميداني: ${snapshot.field.assigned}.`,
    `بانتظار تعيين ميداني: ${snapshot.field.unassigned}.`,
  ];
  for (const row of snapshot.field.byEmployee) lines.push(`- ${row.name}: ${row.count} عميل في التفويج`);
  if (!snapshot.field.byEmployee.length) lines.push('- لا توزيع ميداني حالي.');
  return lines.join('\n');
}

export type AssistantIntent = 'team' | 'stages' | 'sources' | 'overdue' | 'field' | 'overview';

export function assistantIntent(question: string): AssistantIntent {
  const text = question.trim();
  if (/ميدان|تفويج/.test(text)) return 'field';
  if (/مصدر|حمل/.test(text)) return 'sources';
  if (/مرحل/.test(text)) return 'stages';
  if (/متأخر/.test(text)) return 'overdue';
  if (/موظف|فريق|أداء/.test(text)) return 'team';
  return 'overview';
}

export function answerDeterministic(question: string, snapshot: AssistantSnapshot): string {
  const intent = assistantIntent(question);
  if (intent === 'team') return teamAnswer(snapshot);
  if (intent === 'stages') return stageAnswer(snapshot);
  if (intent === 'sources') return sourceAnswer(snapshot);
  if (intent === 'overdue') return overdueAnswer(snapshot);
  if (intent === 'field') return fieldAnswer(snapshot);
  const spend = snapshot.kpis.campaignSpend.available
    ? String(snapshot.kpis.campaignSpend.total)
    : 'غير مسجّل';
  return [
    `العملاء المتأخرون: ${snapshot.kpis.overdue}. التحويلات: ${snapshot.kpis.conversions}. العقارات: ${snapshot.kpis.properties}. مصروف الحملات: ${spend}.`,
    teamAnswer(snapshot),
    stageAnswer(snapshot),
    fieldAnswer(snapshot),
  ].join('\n\n');
}
