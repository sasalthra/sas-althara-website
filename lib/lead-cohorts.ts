import {crmInstant, riyadhDayKey} from './lead-dates';
import {canonicalStage, displayStage, stageChoices, stageLabel} from './lead-stages';

/** Working pipeline from «مهتم» through «إفراغ». Pause and exit stages stay out. */
const WORKING = ['new', 'no_answer', 'contacted', 'interested', 'awaiting_offers', 'field_dispatch', 'property_visited', 'negotiation', 'bank_referred', 'deposit_paid', 'contract_signed', 'transferred'] as const;

export const INTERESTED_STAGES = new Set<string>(WORKING.slice(WORKING.indexOf('interested')));
export const SIGNED_STAGES = new Set(['contract_signed', 'transferred']);
export const NOT_INTERESTED_STAGES = new Set(['not_interested', 'unqualified']);
export const INACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
export const UNASSIGNED_WAIT_MS = 24 * 60 * 60 * 1000;

export const COHORT_DEFINITIONS = {
  interested: 'المهتم = مرحلة «مهتم» وكل مرحلة بعدها في مسار العمل حتى «إفراغ» (بانتظار العروض، تفويج، زيارة، تفاوض، إحالة للبنك، عربون، وقع عقد، إفراغ). لا يشمل التأجيل ولا غير المؤهل ولا غير المهتم ولا المغلق.',
  notInterested: 'غير المهتم = «غير مهتم» + «غير مؤهل».',
  signed: 'الإغلاق الناجح = «وقع عقد» + «إفراغ». صفوف «مكسب» القديمة تُحسب مع وقع عقد.',
  closed: 'مغلق = مرحلة «مغلق» فقط، وتُعرض منفصلة عن وقع عقد وإفراغ.',
  conversion: 'نسبة التحويل = (وقع عقد + إفراغ) ÷ إجمالي عملاء المصدر × 100.',
  completion: 'نسبة الإنجاز = نسبة العملاء المسندين الذين تجاوزوا مرحلتي «عميل جديد» و«لم يتم الرد».',
  contacted: 'تم التواصل = العميل حالياً في مرحلة «تم التواصل» فقط.',
  overdue: 'متابعة متأخرة = تاريخ المتابعة قبل اليوم بتوقيت الرياض، والمرحلة ليست «مغلق» ولا المكسب القديم.',
  inactive: 'بلا نشاط = لم يُحدَّث سجل العميل منذ 7 أيام أو أكثر، باستثناء «مغلق» و«غير مهتم».',
  unassignedNew: 'جدد غير مسندين = مرحلة «عميل جديد» بلا موظف مبيعات.',
  unassignedWait: 'جديد غير مسند = مرحلة «عميل جديد» بلا موظف مبيعات، ومرّ على تسجيله أكثر من 24 ساعة.',
} as const;

export type DirectoryUser = {id: string; name: string; username: string};

export function normText(value: unknown): string {
  return String(value ?? '').replace(/[\u200B-\u200F\u202A-\u202E]/g, '').trim().toLowerCase();
}

export function stageKeyOf(stage: unknown): string {
  const raw = String(stage ?? '').trim();
  if (!raw) return '';
  return displayStage(raw) || raw;
}

export function isInterestedStage(stage: unknown): boolean {
  return INTERESTED_STAGES.has(stageKeyOf(stage));
}
export function isSignedStage(stage: unknown): boolean {
  return SIGNED_STAGES.has(stageKeyOf(stage));
}
export function isNotInterestedStage(stage: unknown): boolean {
  return NOT_INTERESTED_STAGES.has(stageKeyOf(stage));
}
export function isClosedStage(stage: unknown): boolean {
  return stageKeyOf(stage) === 'closed';
}
export function isContactedStage(stage: unknown): boolean {
  return stageKeyOf(stage) === 'contacted';
}
/** Moved past «عميل جديد» and «لم يتم الرد». */
export function isPastFreshStage(stage: unknown): boolean {
  const key = stageKeyOf(stage);
  return Boolean(key) && key !== 'new' && key !== 'no_answer';
}

export function completionRate(assigned: number, pastFresh: number): number | null {
  if (assigned <= 0) return null;
  return Math.round((pastFresh / assigned) * 100);
}

export function conversionRate(total: number, signed: number): number | null {
  if (total <= 0) return null;
  return Math.round((signed / total) * 100);
}

export function isOverdueFollowUp(followUp: unknown, stage: unknown, today: string): boolean {
  const due = String(followUp ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !today || due >= today) return false;
  const raw = String(stage ?? '').trim();
  if (raw === 'won' || raw === 'closed' || stageKeyOf(raw) === 'closed') return false;
  return true;
}

export function isInactiveLead(updatedAt: unknown, createdAt: unknown, stage: unknown, now: number): boolean {
  const key = stageKeyOf(stage);
  if (key === 'closed' || key === 'not_interested') return false;
  const instant = crmInstant(String(updatedAt || createdAt || ''));
  if (!instant) return false;
  return now - instant.getTime() >= INACTIVE_MS;
}

export function isUnassignedNew(stage: unknown, assignedTo: unknown): boolean {
  return stageKeyOf(stage) === 'new' && !String(assignedTo ?? '').trim();
}

export function isUnassignedNewWaiting(stage: unknown, assignedTo: unknown, createdAt: unknown, now: number): boolean {
  if (!isUnassignedNew(stage, assignedTo)) return false;
  const instant = crmInstant(typeof createdAt === 'string' || createdAt instanceof Date ? createdAt : String(createdAt ?? ''));
  if (!instant) return false;
  return now - instant.getTime() >= UNASSIGNED_WAIT_MS;
}

export function createdInPeriod(createdAt: unknown, from: string, to: string): boolean {
  if (!from && !to) return true;
  const day = riyadhDayKey(typeof createdAt === 'string' || createdAt instanceof Date ? createdAt : String(createdAt ?? ''));
  if (!day) return false;
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

const SOURCE_RULES: {key: string; label: string; test: RegExp}[] = [
  {key: 'tiktok', label: 'تيك توك', test: /tik\s*tok|تيك\s*توك|تيكتوك/i},
  {key: 'snapchat', label: 'سناب', test: /snap(?:chat)?|سناب/i},
  {key: 'whatsapp', label: 'واتساب', test: /whats?\s*app|واتساب|واتس/i},
  {key: 'meta', label: 'ميتا', test: /\bmeta\b|facebook|instagram|\binsta\b|فيسبوك|انستغرام|انستقرام|انستا|ميتا/i},
  {key: 'excel', label: 'إكسل', test: /excel|xlsx|اكسيل|إكسل|اكسل/i},
  {key: 'sheets', label: 'جداول جوجل', test: /google[_\s-]*sheets|\bsheets\b|جداول/i},
  {key: 'google', label: 'جوجل', test: /google|جوجل/i},
  {key: 'website', label: 'الموقع', test: /website|الموقع|property-inquiry|calculate-loan|^contact$/i},
  {key: 'manual', label: 'يدوي', test: /manual|يدوي/i},
  {key: 'management', label: 'الإدارة', test: /management|الادارة|الإدارة/i},
  {key: 'ad', label: 'حملة إعلانية', test: /^ad$|حملة/i},
];

export function normalizeSource(raw: unknown): {key: string; label: string} {
  const text = String(raw ?? '').replace(/[\u200B-\u200F\u202A-\u202E]/g, '').trim();
  if (!text) return {key: 'unknown', label: 'غير محدد'};
  const folded = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  for (const rule of SOURCE_RULES) if (rule.test.test(folded)) return {key: rule.key, label: rule.label};
  return {key: folded.toLowerCase(), label: folded};
}

export function leadMatchesSource(raw: unknown, filter: string, exact = false): boolean {
  const wanted = filter.trim();
  if (!wanted) return true;
  if (exact || normText(raw) === normText(wanted)) return normText(raw) === normText(wanted);
  const actual = normalizeSource(raw);
  const target = normalizeSource(wanted);
  return actual.key === target.key || actual.label === wanted;
}

export function leadMatchesStage(stage: unknown, filter: string): boolean {
  const wanted = filter.trim();
  if (!wanted) return true;
  const actualKey = stageKeyOf(stage);
  const wantedKey = stageKeyOf(canonicalStage(wanted) || wanted) || wanted;
  if (actualKey === wantedKey || String(stage ?? '') === wanted) return true;
  return stageLabel(actualKey) === wanted || stageLabel(String(stage ?? '')) === wanted;
}

export type StageGroup = '' | 'interested' | 'not_interested' | 'signed' | 'closed' | 'contacted' | 'unassigned_new';

export function leadMatchesStageGroup(stage: unknown, assignedTo: unknown, group: string): boolean {
  if (!group) return true;
  if (group === 'interested') return isInterestedStage(stage);
  if (group === 'not_interested') return isNotInterestedStage(stage);
  if (group === 'signed') return isSignedStage(stage);
  if (group === 'closed') return isClosedStage(stage);
  if (group === 'contacted') return isContactedStage(stage);
  if (group === 'unassigned_new') return isUnassignedNew(stage, assignedTo);
  return true;
}

export function matchUser(users: DirectoryUser[], raw: unknown): DirectoryUser | null {
  const key = normText(raw);
  if (!key) return null;
  return users.find(user => normText(user.id) === key)
    || users.find(user => user.username && normText(user.username) === key)
    || users.find(user => user.name && normText(user.name) === key)
    || null;
}

export type LeadIdentity = {
  assigned_to?: unknown;
  field_assigned_to?: unknown;
  assigned_name?: unknown;
  assigned_username?: unknown;
  field_assigned_name?: unknown;
  field_assigned_username?: unknown;
};

export function leadMatchesEmployee(lead: LeadIdentity, tokens: string[]): boolean {
  const wanted = new Set(tokens.map(normText).filter(Boolean));
  if (!wanted.size) return true;
  const fields = [lead.assigned_to, lead.field_assigned_to, lead.assigned_name, lead.assigned_username, lead.field_assigned_name, lead.field_assigned_username];
  return fields.some(value => wanted.has(normText(value)));
}

export function orderedStages(): {stage: string; label: string}[] {
  return stageChoices().map(([stage, label]) => ({stage, label}));
}
