import {assignmentChanged, propertyRequestText, type AssignmentClient} from './assignment-email';
import {ApiError} from './secure-api';
import {SHEET_DUPLICATE_CHILD_TABLES} from './sheet-duplicate-cleanup';
import {SHEET_ROW_PURGED} from './sheet-test-purge';

/** One request stays inside a normal JSON body and a short InnoDB transaction. */
export const BULK_LEAD_LIMIT = 500;
const CHUNK = 50;

type Statement = {
  bind(...args: (string | number | null)[]): Statement;
  all(): Promise<{results: Record<string, unknown>[]}>;
  first<T>(): Promise<T | null>;
  run(): Promise<{meta: {changes: number}}>;
};

export type BulkDb = {prepare(sql: string): Statement};

export type BulkAssignClient = AssignmentClient & {id: string};

type StoredLead = {
  id: string;
  name: string;
  phone: string;
  stage: string;
  source: string;
  notes: string;
  follow_up: string;
  property_id: string;
  property_other: string;
  assigned_to: string;
};

function chunks<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function marks(count: number) {
  return Array.from({length: count}, () => '?').join(', ');
}

function changes(result: {meta: {changes: number}}) {
  return Number(result.meta.changes ?? 0);
}

function missingTable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /no such table|ER_NO_SUCH_TABLE|doesn't exist|does not exist/i.test(message);
}

export function uniqueLeadIds(ids: readonly string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function assertIds(ids: string[]) {
  if (!ids.length) throw new ApiError(400, 'اختر عميلاً واحداً على الأقل');
  if (ids.length > BULK_LEAD_LIMIT) {
    throw new ApiError(400, `يمكن تنفيذ الإجراء على ${BULK_LEAD_LIMIT} عميلاً في المرة الواحدة`);
  }
}

async function lockLeads(db: BulkDb, ids: string[]) {
  const found: StoredLead[] = [];
  for (const group of chunks(ids, CHUNK)) {
    const rows = await db
      .prepare(
        `SELECT id, name, phone, stage, IFNULL(source, '') AS source, IFNULL(notes, '') AS notes, IFNULL(follow_up, '') AS follow_up, IFNULL(property_id, '') AS property_id, IFNULL(property_other, '') AS property_other, IFNULL(assigned_to, '') AS assigned_to FROM leads WHERE id IN (${marks(group.length)}) FOR UPDATE`
      )
      .bind(...group)
      .all();
    for (const row of rows.results) {
      found.push({
        id: String(row.id ?? ''),
        name: String(row.name ?? ''),
        phone: String(row.phone ?? ''),
        stage: String(row.stage ?? ''),
        source: String(row.source ?? ''),
        notes: String(row.notes ?? ''),
        follow_up: String(row.follow_up ?? ''),
        property_id: String(row.property_id ?? ''),
        property_other: String(row.property_other ?? ''),
        assigned_to: String(row.assigned_to ?? ''),
      });
    }
  }
  return found.filter(lead => lead.id);
}

function clientFrom(lead: StoredLead): BulkAssignClient {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    stage: lead.stage,
    source: lead.source,
    notes: lead.notes,
    followUp: lead.follow_up,
    propertyRequest: propertyRequestText(lead.property_id, lead.property_other),
  };
}

/**
 * Assigns the given leads to one active sales employee.
 * Leads already assigned to that employee are left untouched.
 * Each changed lead gets one activity row. The caller sends one digest email
 * after the transaction commits.
 */
export async function assignLeadsBulk(
  db: BulkDb,
  input: {actorId: string; ids: readonly string[]; assignedTo: string}
) {
  const ids = uniqueLeadIds(input.ids);
  assertIds(ids);
  const assignedTo = input.assignedTo.trim();
  const employee = await db
    .prepare(
      `SELECT id, name, email FROM crm_users WHERE id = ? AND active = 1 AND role = 'sales' LIMIT 1`
    )
    .bind(assignedTo)
    .first<{id: string; name: string; email: string | null}>();
  if (!employee) throw new ApiError(400, 'مندوب المبيعات المحدد غير صالح أو غير نشط');

  const leads = await lockLeads(db, ids);
  if (!leads.length) throw new ApiError(404, 'العملاء غير موجودين');

  const now = new Date().toISOString();
  const clients: BulkAssignClient[] = [];
  for (const lead of leads) {
    if (!assignmentChanged(lead.assigned_to, assignedTo)) continue;
    await db
      .prepare(`UPDATE leads SET assigned_to = ?, updated_at = ? WHERE id = ?`)
      .bind(assignedTo, now, lead.id)
      .run();
    await db
      .prepare(
        `INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        lead.id,
        input.actorId,
        'assigned',
        JSON.stringify({
          assignedTo,
          previousAssignedTo: lead.assigned_to,
          assignedName: String(employee.name ?? ''),
        })
      )
      .run();
    clients.push(clientFrom(lead));
  }

  await db
    .prepare(
      `INSERT INTO crm_audit (id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      input.actorId,
      'leads.bulk_assign',
      assignedTo,
      JSON.stringify({
        assigned: clients.length,
        requested: ids.length,
        employeeName: String(employee.name ?? ''),
      }),
      now
    )
    .run();

  return {
    ok: true as const,
    assigned: clients.length,
    assignedTo,
    employeeName: String(employee.name ?? ''),
    clients,
    message: clients.length ? `تم إسناد ${clients.length} عميل` : 'لم يتغير الإسناد',
  };
}

async function markSheetRowsPurged(db: BulkDb, ids: string[]) {
  let rowsMarked = 0;
  for (const group of chunks(ids, CHUNK)) {
    const placeholders = marks(group.length);
    try {
      const row = await db
        .prepare(`SELECT COUNT(*) AS n FROM crm_sheet_rows WHERE lead_id IN (${placeholders})`)
        .bind(...group)
        .first<{n: number | string | null}>();
      rowsMarked += Number(row?.n ?? 0) || 0;
      await db
        .prepare(`UPDATE crm_sheet_rows SET status = ? WHERE lead_id IN (${placeholders})`)
        .bind(SHEET_ROW_PURGED, ...group)
        .run();
    } catch (error) {
      if (missingTable(error)) return rowsMarked;
      throw error;
    }
  }
  return rowsMarked;
}

/**
 * Deletes the selected leads and the rows that reference them, in an order
 * InnoDB foreign keys accept. Sheet row keys stay, with status `purged`, so a
 * later sheet sync treats them as already seen.
 */
export async function deleteLeadsBulk(db: BulkDb, input: {actorId: string; ids: readonly string[]}) {
  const ids = uniqueLeadIds(input.ids);
  assertIds(ids);
  const leads = await lockLeads(db, ids);
  if (!leads.length) throw new ApiError(404, 'العملاء غير موجودين');
  const found = leads.map(lead => lead.id);

  const rowsMarked = await markSheetRowsPurged(db, found);
  let activity = 0;
  let transactions = 0;
  let importRows = 0;
  for (const group of chunks(found, CHUNK)) {
    const placeholders = marks(group.length);
    for (const table of SHEET_DUPLICATE_CHILD_TABLES) {
      const removed = changes(
        await db.prepare(`DELETE FROM ${table} WHERE lead_id IN (${placeholders})`).bind(...group).run()
      );
      if (table === 'lead_activity') activity += removed;
      else if (table === 'crm_transactions') transactions += removed;
      else importRows += removed;
    }
  }

  let deleted = 0;
  for (const group of chunks(found, CHUNK)) {
    deleted += changes(
      await db.prepare(`DELETE FROM leads WHERE id IN (${marks(group.length)})`).bind(...group).run()
    );
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO crm_audit (id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      input.actorId,
      'leads.bulk_delete',
      input.actorId,
      JSON.stringify({deleted, requested: ids.length, rowsMarked, activity, transactions, importRows}),
      now
    )
    .run();

  return {
    ok: true as const,
    deleted,
    rowsMarked,
    activity,
    transactions,
    importRows,
    message: `تم حذف ${deleted} عميل`,
  };
}
