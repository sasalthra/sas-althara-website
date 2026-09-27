import {ApiError} from './secure-api';
import {confirmationMatches, SALES_ASSIGNMENT_SCOPE} from './employee-client-purge';

/**
 * Permanently removes clients whose sales rep is the given employee
 * (`leads.assigned_to`). Dependent rows that reference those leads are removed
 * first so InnoDB foreign keys do not reject the lead delete:
 *   - lead_activity (stage history, follow-ups, notes stored on the activity)
 *   - crm_transactions
 *   - crm_import_rows
 * The lead row itself (including notes and is_featured) is deleted with them.
 *
 * Not deleted: the employee (`crm_users` and HR rows), clients where this
 * person is only the field rep (`field_assigned_to`), clients they created or
 * own without a sales assignment, and existing `crm_audit` history. A new
 * audit row is inserted in the same transaction.
 */

type Statement = {
  bind(...args: (string | number | null)[]): Statement;
  all(): Promise<{results: Record<string, unknown>[]}>;
  first<T>(): Promise<T | null>;
  run(): Promise<{meta: {changes: number}}>;
};

export type PurgeDb = {prepare(sql: string): Statement};

export type EmployeeRecord = {
  id: string;
  name: string;
  username: string;
  role: string;
  active: number;
};

export type EmployeeClientCounts = {
  salesAssigned: number;
  fieldOnly: number;
  fieldAssigned: number;
};

const employeeSql = `SELECT id, name, username, role, active FROM crm_users WHERE id = ? LIMIT 1`;

export async function loadEmployee(db: PurgeDb, employeeId: string) {
  return db.prepare(employeeSql).bind(employeeId).first<EmployeeRecord>();
}

export async function countEmployeeClients(db: PurgeDb, employeeId: string): Promise<EmployeeClientCounts> {
  const row = await db.prepare(
    `SELECT COUNT(CASE WHEN assigned_to = ? THEN 1 END) AS sales_assigned, COUNT(CASE WHEN field_assigned_to = ? AND assigned_to <> ? THEN 1 END) AS field_only, COUNT(CASE WHEN field_assigned_to = ? THEN 1 END) AS field_assigned FROM leads`
  ).bind(employeeId, employeeId, employeeId, employeeId).first<{
    sales_assigned: number | string | null;
    field_only: number | string | null;
    field_assigned: number | string | null;
  }>();
  return {
    salesAssigned: Number(row?.sales_assigned ?? 0),
    fieldOnly: Number(row?.field_only ?? 0),
    fieldAssigned: Number(row?.field_assigned ?? 0),
  };
}

function changes(result: {meta: {changes: number}}) {
  return Number(result.meta.changes ?? 0);
}

export async function purgeAssignedClients(
  db: PurgeDb,
  input: {actorId: string; employeeId: string; confirmation: string}
) {
  const employee = await db.prepare(`${employeeSql} FOR UPDATE`).bind(input.employeeId).first<EmployeeRecord>();
  if (!employee) throw new ApiError(404, 'الموظف غير موجود');
  if (!confirmationMatches(String(employee.name ?? ''), input.confirmation)) {
    throw new ApiError(400, 'اكتب اسم الموظف أو كلمة حذف للتأكيد');
  }

  await db.prepare(`SELECT id FROM leads WHERE assigned_to = ? FOR UPDATE`).bind(input.employeeId).all();
  const activity = changes(await db.prepare(
    `DELETE FROM lead_activity WHERE lead_id IN (SELECT id FROM leads WHERE assigned_to = ?)`
  ).bind(input.employeeId).run());
  const transactions = changes(await db.prepare(
    `DELETE FROM crm_transactions WHERE lead_id IN (SELECT id FROM leads WHERE assigned_to = ?)`
  ).bind(input.employeeId).run());
  const importRows = changes(await db.prepare(
    `DELETE FROM crm_import_rows WHERE lead_id IN (SELECT id FROM leads WHERE assigned_to = ?)`
  ).bind(input.employeeId).run());
  const deleted = changes(await db.prepare(
    `DELETE FROM leads WHERE assigned_to = ?`
  ).bind(input.employeeId).run());

  const stillThere = await db.prepare(employeeSql).bind(input.employeeId).first<{id: string}>();
  if (!stillThere) throw new ApiError(500, 'توقف الحذف لأن حساب الموظف لم يعد موجوداً');

  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO crm_audit (id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    input.actorId,
    'leads.purge_assigned',
    input.employeeId,
    JSON.stringify({
      deleted,
      scope: SALES_ASSIGNMENT_SCOPE,
      employeeName: String(employee.name ?? ''),
      activity,
      transactions,
      importRows,
    }),
    now
  ).run();

  return {
    ok: true as const,
    deleted,
    employeeId: input.employeeId,
    employeeName: String(employee.name ?? ''),
    scope: SALES_ASSIGNMENT_SCOPE,
    activity,
    transactions,
    importRows,
  };
}
