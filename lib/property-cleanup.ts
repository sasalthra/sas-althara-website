import properties from '@/data/properties.json';

import {deleteLeadsBulk, uniqueLeadIds, type BulkDb} from './bulk-leads';
import {displayLeadPhone} from './phone';
import {
  DEFAULT_PROPERTY_CLEANUP_LABELS,
  matchPropertyCleanup,
  normalizeCleanupLabels,
  type CleanupEmployee,
  type CleanupLeadRow,
  type CleanupMatch,
} from './property-cleanup-shared';
import {ApiError} from './secure-api';

export {DEFAULT_PROPERTY_CLEANUP_LABELS, normalizeCleanupLabels};
export type {CleanupEmployee, CleanupMatch};

const LEAD_LIMIT = 20001;
const DELETE_CHUNK = 500;

const propertyTitles = new Map(properties.map(item => [item.id, item.title]));

type Statement = {
  bind(...args: (string | number | null)[]): Statement;
  all(): Promise<{results: Record<string, unknown>[]}>;
  run(): Promise<{meta: {changes: number}}>;
};

export type CleanupDb = {prepare(sql: string): Statement};

function text(value: unknown) {
  return String(value ?? '');
}

/**
 * Loads leads and employees with no string comparison in SQL.
 * Name spellings and property phrases are matched in JS so mixed collations
 * cannot raise error 1267, and CONVERT_TZ is never used.
 */
export async function loadCleanupDirectory(db: CleanupDb): Promise<CleanupEmployee[]> {
  const queries = [
    'SELECT id, name, username, role, active FROM crm_users ORDER BY name, id',
    'SELECT id, name, role, active FROM crm_users ORDER BY name, id',
  ];
  let last: unknown;
  for (const sql of queries) {
    try {
      const rows = await db.prepare(sql).bind().all();
      return rows.results.map(row => ({
        id: text(row.id).trim(),
        name: text(row.name).trim(),
        username: text(row.username).trim(),
        role: text(row.role).trim(),
        active: Number(row.active ?? 0) === 1 ? 1 : 0,
      })).filter(user => user.id);
    } catch (error) {
      last = error;
      const message = error instanceof Error ? error.message : '';
      if (!/username|no such column|unknown column/i.test(message)) throw error;
    }
  }
  throw last instanceof Error ? last : new ApiError(503, 'تعذر قراءة الموظفين');
}

async function loadCleanupLeads(db: CleanupDb): Promise<CleanupLeadRow[]> {
  const rows = await db.prepare(
    `SELECT id, name, phone, IFNULL(property_id, '') AS property_id, IFNULL(property_other, '') AS property_other, IFNULL(assigned_to, '') AS assigned_to
     FROM leads ORDER BY id LIMIT ${LEAD_LIMIT}`
  ).bind().all();
  if (rows.results.length >= LEAD_LIMIT) throw new ApiError(422, 'سجل العملاء أكبر من الحد الآمن لهذه الأداة');
  return rows.results.map(row => ({
    id: text(row.id).trim(),
    name: text(row.name).trim(),
    phone: displayLeadPhone(text(row.phone)),
    property_id: text(row.property_id).trim(),
    property_other: text(row.property_other),
    assigned_to: text(row.assigned_to).trim(),
  })).filter(lead => lead.id);
}

export async function previewPropertyCleanup(
  db: CleanupDb,
  input: {employeeId: string; labels?: readonly string[]}
): Promise<{employee: CleanupEmployee; labels: string[]; count: number; leads: CleanupMatch[]}> {
  const directory = await loadCleanupDirectory(db);
  const employee = directory.find(user => user.id === input.employeeId);
  if (!employee) throw new ApiError(404, 'الموظف غير موجود');
  const labels = normalizeCleanupLabels(input.labels);
  if (!labels.length) throw new ApiError(400, 'أدخل عبارة واحدة على الأقل للبحث في نص العقار');
  const leads = matchPropertyCleanup(await loadCleanupLeads(db), directory, employee.id, labels, propertyTitles);
  return {employee, labels, count: leads.length, leads};
}

/**
 * Deletes only ids that were both requested and still match the employee and
 * property phrases. Related activity, stage notes, transactions, and import
 * rows go through the same bulk delete used by the leads screen.
 */
export async function confirmPropertyCleanup(
  db: BulkDb,
  input: {actorId: string; employeeId: string; labels?: readonly string[]; ids: readonly string[]}
) {
  const requested = uniqueLeadIds(input.ids);
  if (!requested.length) throw new ApiError(400, 'لا يوجد عملاء لتأكيد حذفهم');
  const preview = await previewPropertyCleanup(db, {employeeId: input.employeeId, labels: input.labels});
  const allowed = new Set(preview.leads.map(lead => lead.id));
  const victims = requested.filter(id => allowed.has(id));
  if (!victims.length) throw new ApiError(400, 'لم يعد أي من العملاء المعروضين مطابقاً. أعد المعاينة.');

  let deleted = 0;
  let activity = 0;
  let notes = 0;
  let transactions = 0;
  let importRows = 0;
  for (let index = 0; index < victims.length; index += DELETE_CHUNK) {
    const group = victims.slice(index, index + DELETE_CHUNK);
    const result = await deleteLeadsBulk(db, {actorId: input.actorId, ids: group});
    deleted += result.deleted;
    activity += result.activity;
    notes += result.notes;
    transactions += result.transactions;
    importRows += result.importRows;
  }

  return {
    ok: true as const,
    deleted,
    requested: requested.length,
    matched: victims.length,
    skipped: requested.length - victims.length,
    activity,
    notes,
    transactions,
    importRows,
    employeeId: preview.employee.id,
    employeeName: preview.employee.name,
    labels: preview.labels,
    message: `تم حذف ${deleted} عميل`,
  };
}
