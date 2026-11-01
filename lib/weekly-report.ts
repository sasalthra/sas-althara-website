import {
  fieldDispatchMoment,
  instantInRiyadhRange,
  isContactedStage,
  isInterestedStage,
  isNotInterestedStage,
  isSignedStage,
  matchUser,
  normalizeSource,
  orderedStages,
  stageKeyOf,
  type DirectoryUser,
} from './lead-cohorts';
import {stageLabel} from './lead-stages';
import {fieldReportText} from './field-report';
import {emptyStageCounts, employeeStageColumns, noteEmployeeLead, sumStageTable} from './employee-stages';
import {nextCalendarDay, shiftCalendarDay} from './report-presets';

export {employeeStageColumns, stageRowSum, sumStageTable, stageTableIsExact} from './employee-stages';

export const DEFAULT_WEEKLY_REPORT_TO = 'sasalthra.sa@gmail.com';

const VISIT_DONE = new Set(['property_visited', 'negotiation', 'bank_referred', 'deposit_paid', 'contract_signed', 'transferred']);

export type WeeklyLead = {
  id?: unknown;
  source?: unknown;
  stage?: unknown;
  assigned_to?: unknown;
  field_assigned_to?: unknown;
  created_at?: unknown;
  assigned_at?: unknown;
  field_dispatched_at?: unknown;
  first_field_dispatch_at?: unknown;
  field_report?: unknown;
  field_report_at?: unknown;
};

export type WeeklyEmployeeRow = {
  name: string;
  assigned: number;
  stages: Record<string, number>;
  contacted: number;
  interested: number;
  notInterested: number;
  dispatched: number;
  visits: number;
  reports: number;
  deals: number;
};

export type WeeklyReportData = {
  from: string;
  to: string;
  weekKey: string;
  newLeads: number;
  interested: number;
  notInterested: number;
  dispatched: number;
  bySource: {label: string; count: number}[];
  byStage: {label: string; count: number}[];
  employees: WeeklyEmployeeRow[];
};

export type WeeklyClock = {weekday: string; dayKey: string; hour: number};

export function riyadhClock(now: Date): WeeklyClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  let hour = Number(get('hour'));
  const period = get('dayPeriod');
  if (!Number.isFinite(hour)) hour = 0;
  if (/pm/i.test(period) && hour < 12) hour += 12;
  if (/am/i.test(period) && hour === 12) hour = 0;
  if (hour === 24) hour = 0;
  return {weekday: get('weekday'), dayKey: `${get('year')}-${get('month')}-${get('day')}`, hour};
}

/** Previous 7 Riyadh days, ending yesterday. Due only on Saturday at or after 11:00. */
export function weeklyReportWindow(now: Date) {
  const clock = riyadhClock(now);
  const to = shiftCalendarDay(clock.dayKey, -1);
  const from = shiftCalendarDay(clock.dayKey, -7);
  return {
    due: clock.weekday === 'Sat' && clock.hour >= 11,
    weekKey: clock.dayKey,
    from,
    to,
    weekday: clock.weekday,
    hour: clock.hour,
  };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive Riyadh ranges for the manual email menu. Week is 7 days and month is 30 days, both ending today. */
export function manualReportRange(period: 'week' | 'month', today: string): {from: string; to: string} | null {
  if (!DAY_KEY.test(today)) return null;
  if (period === 'week') return {from: shiftCalendarDay(today, -6), to: today};
  if (period === 'month') return {from: shiftCalendarDay(today, -29), to: today};
  return null;
}

export function validReportRange(from: string, to: string): boolean {
  if (!DAY_KEY.test(from) || !DAY_KEY.test(to) || from > to) return false;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const days = Math.round((end - start) / 86400000) + 1;
  return days >= 1 && days <= 400;
}

export function weeklyReportRecipients(value?: string | null): string[] {
  const text = (value ?? '').trim() || DEFAULT_WEEKLY_REPORT_TO;
  const list = text.split(/[,;]+/).map(item => item.trim()).filter(Boolean);
  return list.length ? list : [DEFAULT_WEEKLY_REPORT_TO];
}

export function weeklySendDecision(input: {due: boolean; alreadySent: boolean; force: boolean; preview: boolean}) {
  if (input.preview) return 'preview' as const;
  if (input.force) return 'send' as const;
  if (!input.due || input.alreadySent) return 'skip' as const;
  return 'send' as const;
}

/** Midnight that opens a Riyadh calendar day, as UTC `YYYY-MM-DD HH:MM:SS`. Saudi Arabia is fixed UTC+3. */
export function riyadhMidnightUtc(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d) - 3 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}`;
}

export function riyadhWindowBounds(from: string, to: string) {
  return {start: riyadhMidnightUtc(from), end: riyadhMidnightUtc(nextCalendarDay(to))};
}

function inRange(value: unknown, from: string, to: string) {
  return instantInRiyadhRange(value, from, to);
}

function linked(lead: WeeklyLead, person: DirectoryUser) {
  return Boolean(matchUser([person], lead.assigned_to) || matchUser([person], lead.field_assigned_to));
}

function newlyAssigned(lead: WeeklyLead, person: DirectoryUser, from: string, to: string) {
  if (person.role === 'field') {
    return Boolean(matchUser([person], lead.field_assigned_to) && inRange(fieldDispatchMoment(lead), from, to));
  }
  if (!matchUser([person], lead.assigned_to)) return false;
  const stamp = String(lead.assigned_at ?? '').trim();
  return inRange(stamp || lead.created_at, from, to);
}

export function buildWeeklyReport(leads: WeeklyLead[], users: DirectoryUser[], from: string, to: string, weekKey = to): WeeklyReportData {
  const fresh = leads.filter(lead => inRange(lead.created_at, from, to));
  const sourceCounts = new Map<string, {label: string; count: number}>();
  const stageCounts = new Map<string, number>();
  for (const lead of fresh) {
    const source = normalizeSource(lead.source);
    const bucket = sourceCounts.get(source.key) || {label: source.label, count: 0};
    bucket.count += 1;
    sourceCounts.set(source.key, bucket);
    const stage = stageKeyOf(lead.stage) || 'new';
    stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1);
  }
  const known = new Set(orderedStages().map(stage => stage.stage));
  const byStage = orderedStages().map(stage => ({label: stage.label, count: stageCounts.get(stage.stage) || 0}));
  for (const [stage, count] of stageCounts) {
    if (!known.has(stage)) byStage.push({label: stageLabel(stage), count});
  }
  const dispatchedLeads = leads.filter(lead => inRange(fieldDispatchMoment(lead), from, to));
  const staff = users.filter(user => user.role === 'sales' || user.role === 'field');
  const employees = staff.map(person => {
    const assignedLeads = leads.filter(lead => newlyAssigned(lead, person, from, to));
    const ownedDispatch = dispatchedLeads.filter(lead => linked(lead, person));
    const visits = leads.filter(lead => linked(lead, person) && VISIT_DONE.has(stageKeyOf(lead.stage)) && (inRange(fieldDispatchMoment(lead), from, to) || inRange(lead.created_at, from, to)));
    const reports = leads.filter(lead => linked(lead, person) && fieldReportText(lead.field_report) && (inRange(lead.field_report_at, from, to) || inRange(fieldDispatchMoment(lead), from, to)));
    const bucket = {assigned: 0, stages: emptyStageCounts()};
    for (const lead of assignedLeads) noteEmployeeLead(bucket, lead.stage);
    return {
      name: person.name || person.id,
      assigned: bucket.assigned,
      stages: bucket.stages,
      contacted: assignedLeads.filter(lead => isContactedStage(lead.stage)).length,
      interested: assignedLeads.filter(lead => isInterestedStage(lead.stage)).length,
      notInterested: assignedLeads.filter(lead => isNotInterestedStage(lead.stage)).length,
      dispatched: ownedDispatch.length,
      visits: visits.length,
      reports: reports.length,
      deals: assignedLeads.filter(lead => isSignedStage(lead.stage)).length,
    };
  }).filter(row => row.assigned || row.contacted || row.interested || row.notInterested || row.dispatched || row.visits || row.reports || row.deals)
    .sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name, 'ar'));
  return {
    from,
    to,
    weekKey,
    newLeads: fresh.length,
    interested: fresh.filter(lead => isInterestedStage(lead.stage)).length,
    notInterested: fresh.filter(lead => isNotInterestedStage(lead.stage)).length,
    dispatched: dispatchedLeads.length,
    bySource: [...sourceCounts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ar')),
    byStage,
    employees,
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char] || char));
}

function cellStyle(index: number, totalRow: boolean, zebra: boolean) {
  const align = index === 0 ? 'right' : 'center';
  const background = totalRow ? '#f3eaf4' : zebra ? '#f7f4f8' : '#ffffff';
  const weight = index === 0 || totalRow ? '700' : '500';
  const color = totalRow ? '#3F1A44' : '#111827';
  return `text-align:${align};padding:10px 8px 12px;border:1px solid #e5e7eb;background:${background};line-height:1.7;font-weight:${weight};color:${color};font-variant-numeric:tabular-nums`;
}

function table(headers: string[], rows: string[][]) {
  const head = headers.map((header, index) => `<th style="text-align:${index === 0 ? 'right' : 'center'};padding:10px 8px 12px;background:#3F1A44;color:#ffffff;border:1px solid #3F1A44;font-weight:700;line-height:1.6">${escapeHtml(header)}</th>`).join('');
  const body = rows.length
    ? rows.map((row, rowIndex) => {
      const totalRow = row[0] === 'الإجمالي';
      return `<tr>${row.map((cell, index) => `<td style="${cellStyle(index, totalRow, rowIndex % 2 === 1)}">${escapeHtml(cell)}</td>`).join('')}</tr>`;
    }).join('')
    : `<tr><td colspan="${headers.length}" style="${cellStyle(0, false, false)}">—</td></tr>`;
  return `<div style="overflow-x:auto;margin:8px 0 18px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px">${`<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`}</table></div>`;
}

function share(part: number, whole: number) {
  if (!whole) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

export function weeklyReportSubject(report: WeeklyReportData) {
  return `تقرير الأداء ${report.from} — ${report.to}`;
}

export function renderWeeklyReportText(report: WeeklyReportData) {
  const sources = report.bySource.map(row => `${row.label}: ${row.count}`).join('\n') || '—';
  const stages = report.byStage.filter(row => row.count > 0).map(row => `${row.label}: ${row.count}`).join('\n') || '—';
  const columns = employeeStageColumns();
  const people = report.employees.map(row => {
    const stages = columns.filter(column => row.stages[column.stage]).map(column => `${column.short} ${row.stages[column.stage]}`).join('، ') || '—';
    return `${row.name}: الإجمالي ${row.assigned} (${stages})؛ زيارات ${row.visits}، تقارير ${row.reports}، صفقات ${row.deals}`;
  }).join('\n') || '—';
  return [
    'ساس الثراء',
    weeklyReportSubject(report),
    `الفترة: ${report.from} — ${report.to}`,
    '',
    `عملاء جدد: ${report.newLeads}`,
    'حسب المصدر:',
    sources,
    '',
    `مهتم: ${report.interested}`,
    `غير مهتم: ${report.notInterested}`,
    'المراحل:',
    stages,
    '',
    `تفويج للميدان: ${report.dispatched}`,
    '',
    'الموظفون:',
    people,
  ].join('\n');
}

export function renderWeeklyReportHtml(report: WeeklyReportData) {
  const sourceTotal = report.bySource.reduce((sum, row) => sum + row.count, 0);
  const sources = table(
    ['المصدر', 'عملاء جدد', 'النسبة'],
    report.bySource.map(row => [row.label, String(row.count), share(row.count, sourceTotal)]).concat(report.bySource.length ? [['الإجمالي', String(sourceTotal), sourceTotal ? '100%' : '—']] : []),
  );
  const stageRows = report.byStage.filter(row => row.count > 0);
  const stageTotal = stageRows.reduce((sum, row) => sum + row.count, 0);
  const stages = table(
    ['المرحلة', 'العدد', 'النسبة'],
    stageRows.map(row => [row.label, String(row.count), share(row.count, stageTotal)]).concat(stageRows.length ? [['الإجمالي', String(stageTotal), stageTotal ? '100%' : '—']] : []),
  );
  const columns = employeeStageColumns();
  const footer = sumStageTable(report.employees.map(row => ({total: row.assigned, stages: row.stages})));
  const people = table(
    ['الموظف', ...columns.map(column => column.short), 'الإجمالي', 'النسبة'],
    report.employees.map(row => [
      row.name,
      ...columns.map(column => String(row.stages[column.stage] || 0)),
      String(row.assigned),
      share(row.assigned, footer.total),
    ]).concat(report.employees.length ? [[
      'الإجمالي',
      ...columns.map(column => String(footer.stages[column.stage] || 0)),
      String(footer.total),
      footer.total ? '100%' : '—',
    ]] : []),
  );
  const activity = table(
    ['الموظف', 'زيارات', 'تقارير', 'صفقات'],
    report.employees.map(row => [row.name, String(row.visits), String(row.reports), String(row.deals)]),
  );
  const body = `
    <p style="margin:0 0 8px;line-height:1.7">الفترة: ${escapeHtml(report.from)} — ${escapeHtml(report.to)}</p>
    <h2 style="margin:18px 0 8px;padding:0;font-size:18px;font-weight:700;color:#3F1A44;line-height:1.6">عملاء جدد: ${report.newLeads}</h2>
    ${sources}
    <h2 style="margin:18px 0 8px;padding:0;font-size:18px;font-weight:700;color:#3F1A44;line-height:1.6">المراحل</h2>
    <p style="margin:0 0 8px;line-height:1.7">مهتم: ${report.interested} · غير مهتم: ${report.notInterested}</p>
    ${stages}
    <h2 style="margin:18px 0 8px;padding:0;font-size:18px;font-weight:700;color:#3F1A44;line-height:1.6">تفويج للميدان: ${report.dispatched}</h2>
    <h2 style="margin:18px 0 8px;padding:0;font-size:18px;font-weight:700;color:#3F1A44;line-height:1.6">الموظفون حسب المرحلة الحالية</h2>
    ${people}
    <h2 style="margin:18px 0 8px;padding:0;font-size:18px;font-weight:700;color:#3F1A44;line-height:1.6">نشاط الموظفين</h2>
    ${activity}
  `;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>${escapeHtml(weeklyReportSubject(report))}</title></head><body style="margin:0;padding:24px;background:#fff;color:#111827;font-family:Tahoma,Arial,sans-serif;line-height:1.7;direction:rtl;text-align:right"><div style="max-width:960px;margin:0 auto"><p style="margin:0 0 8px;color:#3F1A44;font-size:20px;line-height:1.6">ساس الثراء</p><h1 style="margin:0 0 12px;color:#3F1A44;font-size:22px;font-weight:700;line-height:1.6">${escapeHtml(weeklyReportSubject(report))}</h1>${body}</div></body></html>`;
}
