/** Client-safe matching for the manager property cleanup. No database imports. */

export const DEFAULT_PROPERTY_CLEANUP_LABELS = ['غير مؤهل', 'غير مهتم'] as const;

export type CleanupEmployee = {
  id: string;
  name: string;
  username: string;
  role: string;
  active: number;
};

export type CleanupLeadRow = {
  id: string;
  name: string;
  phone: string;
  property_id: string;
  property_other: string;
  assigned_to: string;
};

export type CleanupMatch = {
  id: string;
  name: string;
  phone: string;
  propertyText: string;
};

const NOURA_FOLDED = 'نوره';

export function foldArabicName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u0640\u064B-\u0652\u0670]/g, '')
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .replace(/[.,،;؛:：]+$/g, '')
    .trim()
    .toLowerCase();
}

/** «نورة» and «نوره» are the same employee name. */
export function isNouraSpelling(value: unknown): boolean {
  return foldArabicName(value) === NOURA_FOLDED;
}

export function sameAssignedEmployee(selected: CleanupEmployee, other: Pick<CleanupEmployee, 'id' | 'name' | 'username'>): boolean {
  if (selected.id && other.id && selected.id === other.id) return true;
  const selectedName = foldArabicName(selected.name);
  const otherName = foldArabicName(other.name);
  if (selectedName && otherName && selectedName === otherName) return true;
  if (isNouraSpelling(selected.name) && isNouraSpelling(other.name)) return true;
  return false;
}

export function leadAssignedToEmployee(assigned: unknown, employee: CleanupEmployee, directory: readonly CleanupEmployee[]): boolean {
  const raw = String(assigned ?? '').trim();
  if (!raw || !employee.id) return false;
  if (raw === employee.id) return true;
  if (employee.username && raw === employee.username) return true;
  if (foldArabicName(raw) && foldArabicName(raw) === foldArabicName(employee.name)) return true;
  if (isNouraSpelling(employee.name) && isNouraSpelling(raw)) return true;
  const person = directory.find(user => user.id === raw || (user.username && user.username === raw) || foldArabicName(user.name) === foldArabicName(raw));
  if (!person) return false;
  return sameAssignedEmployee(employee, person);
}

export function normalizeCleanupLabels(labels: readonly string[] | undefined): string[] {
  const source = labels && labels.length ? labels : DEFAULT_PROPERTY_CLEANUP_LABELS;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of source) {
    const text = String(label ?? '')
      .normalize('NFC')
      .replace(/^[«»"'“”\s]+|[«»"'“”\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 2 || text.length > 80 || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export function cleanupPropertyText(propertyId: string, propertyOther: string, title: string): string {
  const other = propertyOther.trim();
  if (other) return other;
  const named = title.trim();
  if (named) return named;
  return propertyId.trim();
}

export function propertyHasCleanupLabel(
  propertyId: string,
  propertyOther: string,
  title: string,
  labels: readonly string[]
): boolean {
  const hay = [propertyOther, title, propertyId].map(part => String(part ?? '').normalize('NFC')).join('\n');
  const collapsed = hay.replace(/\s+/g, ' ');
  return labels.some(label => {
    const wanted = label.normalize('NFC').trim();
    if (wanted.length < 2) return false;
    return hay.includes(wanted) || collapsed.includes(wanted.replace(/\s+/g, ' '));
  });
}

export function matchPropertyCleanup(
  leads: readonly CleanupLeadRow[],
  directory: readonly CleanupEmployee[],
  employeeId: string,
  labels: readonly string[],
  titles: ReadonlyMap<string, string> = new Map()
): CleanupMatch[] {
  const employee = directory.find(user => user.id === employeeId);
  const cleaned = normalizeCleanupLabels(labels);
  if (!employee || !cleaned.length) return [];
  const matches: CleanupMatch[] = [];
  for (const lead of leads) {
    const id = lead.id.trim();
    if (!id) continue;
    if (!leadAssignedToEmployee(lead.assigned_to, employee, directory)) continue;
    const title = titles.get(lead.property_id.trim()) || '';
    if (!propertyHasCleanupLabel(lead.property_id, lead.property_other, title, cleaned)) continue;
    matches.push({
      id,
      name: lead.name.trim(),
      phone: lead.phone.trim(),
      propertyText: cleanupPropertyText(lead.property_id, lead.property_other, title),
    });
  }
  return matches;
}
