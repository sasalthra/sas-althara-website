import {normalizeLeadPhone} from './phone';
import {
  acquireSheetSyncLock,
  isSheetSyncCreatedLead,
  leadAgeKey,
  leadCreatedAtValue,
  releaseSheetSyncLock,
  SHEET_DUPLICATE_CHILD_TABLES,
  SHEET_ROW_IMPORTED,
  type SqlRunner,
} from './sheet-duplicate-cleanup';

/**
 * Manual purge of sheet-sync test leads. Not called from schema repair, the
 * timer, or cron. The three real mobiles are the default keep list; the admin
 * screen can edit them before previewing.
 *
 * Cutoff is the earliest created_at among the most recent lead for each keep
 * phone that exists. Sync-created leads strictly before that instant are
 * deleted. Leads at or after the cutoff stay. Leads with a keep phone stay,
 * including an older row of the same mobile. If none of the phones exist,
 * nothing is deleted.
 *
 * crm_sheet_rows for a deleted lead are marked `purged` and kept, so the
 * sheet row key still blocks a later import. The orphan cleanup only removes
 * imported/processed/seen rows with an empty lead id.
 */
export const SHEET_ROW_PURGED = 'purged';

/** Saudi locals for +966 54 482 3616, +966 53 240 6763, and +966 50 370 4328. */
export const DEFAULT_SHEET_TEST_KEEP_PHONES = ['0544823616', '0532406763', '0503704328'] as const;

const KEEP_LIMIT = 3;
const CHUNK = 50;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const SQL_INSTANT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

export type SheetTestLead = {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  syncCreated: boolean;
};

export type SheetTestLeadView = {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
};

export type SheetTestPurgePlan = {
  aborted: boolean;
  reason: string;
  cutoff: string;
  phones: string[];
  kept: SheetTestLeadView[];
  delete: SheetTestLeadView[];
};

export type SheetTestPurgeOutcome = SheetTestPurgePlan & {
  ok: boolean;
  skipped: boolean;
  count: number;
  deleted: number;
  rowsMarked: number;
};

export function normalizeSheetTestKeepPhones(phones: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of phones) {
    const phone = normalizeLeadPhone(raw);
    if (!/^05\d{8}$/.test(phone) || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
    if (out.length >= KEEP_LIMIT) break;
  }
  return out;
}

/** UTC millis. SQL datetimes without a zone are read as UTC, matching stored ISO stamps. */
export function leadInstant(value: unknown): number | null {
  const text = leadCreatedAtValue(value);
  if (!text) return null;
  if (ISO_INSTANT.test(text)) {
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const sql = SQL_INSTANT.exec(text);
  if (sql) {
    const parsed = Date.parse(`${sql[1]}T${sql[2]}Z`);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function viewOf(lead: {id: string; name: string; phone: string; createdAt: string}): SheetTestLeadView {
  return {
    id: lead.id,
    name: lead.name,
    phone: normalizeLeadPhone(lead.phone) || lead.phone,
    createdAt: leadCreatedAtValue(lead.createdAt),
  };
}

function emptyPlan(reason: string, phones: string[]): SheetTestPurgePlan {
  return {aborted: true, reason, cutoff: '', phones, kept: [], delete: []};
}

/**
 * Pure plan. `syncCreated` must already reflect the sheet-sync marker
 * (created_via, a created activity via google_sheet, or an imported sheet row).
 * Source text such as «تيك توك» is not a marker.
 */
export function planSheetTestLeadPurge(leads: SheetTestLead[], phones: readonly string[]): SheetTestPurgePlan {
  const keepPhones = normalizeSheetTestKeepPhones(phones);
  if (!keepPhones.length) {
    return emptyPlan('أدخل رقماً سعودياً بصيغة 05XXXXXXXX.', []);
  }
  const keepSet = new Set(keepPhones);
  const byPhone = new Map<string, SheetTestLead[]>();
  const normalized: SheetTestLead[] = [];
  for (const lead of leads) {
    const id = String(lead.id || '').trim();
    if (!id) continue;
    const phone = normalizeLeadPhone(lead.phone);
    const row: SheetTestLead = {
      id,
      name: String(lead.name || '').trim(),
      phone,
      createdAt: leadCreatedAtValue(lead.createdAt),
      syncCreated: Boolean(lead.syncCreated),
    };
    normalized.push(row);
    if (!phone || !keepSet.has(phone)) continue;
    const list = byPhone.get(phone) || [];
    list.push(row);
    byPhone.set(phone, list);
  }
  if (byPhone.size === 0) {
    return emptyPlan('لم يُعثر على أي من أرقام العملاء الحقيقيين. لم يُحذف شيء.', keepPhones);
  }

  const anchors: SheetTestLead[] = [];
  for (const phone of keepPhones) {
    const group = byPhone.get(phone);
    if (!group?.length) continue;
    let best: number | null = null;
    for (const lead of group) {
      const ms = leadInstant(lead.createdAt);
      if (ms === null) continue;
      if (best === null || ms > best) best = ms;
    }
    if (best === null) continue;
    for (const lead of group) {
      if (leadInstant(lead.createdAt) === best) anchors.push(lead);
    }
  }
  if (!anchors.length) {
    return emptyPlan('تعذر تحديد تاريخ العملاء الحقيقيين. لم يُحذف شيء.', keepPhones);
  }

  let cutoffMs = Infinity;
  let cutoff = '';
  for (const lead of anchors) {
    const ms = leadInstant(lead.createdAt);
    if (ms === null || ms >= cutoffMs) continue;
    cutoffMs = ms;
    cutoff = lead.createdAt;
  }
  if (!Number.isFinite(cutoffMs)) {
    return emptyPlan('تعذر تحديد تاريخ العملاء الحقيقيين. لم يُحذف شيء.', keepPhones);
  }

  const anchorIds = new Set(anchors.map(lead => lead.id));
  const toDelete = normalized.filter(lead => {
    if (!lead.syncCreated || anchorIds.has(lead.id)) return false;
    if (lead.phone && keepSet.has(lead.phone)) return false;
    const ms = leadInstant(lead.createdAt);
    return ms !== null && ms < cutoffMs;
  });
  toDelete.sort((a, b) => {
    const left = leadAgeKey(a.createdAt, a.id);
    const right = leadAgeKey(b.createdAt, b.id);
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  const kept = [...anchors].sort((a, b) => {
    const ap = keepPhones.indexOf(a.phone);
    const bp = keepPhones.indexOf(b.phone);
    if (ap !== bp) return ap - bp;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return {
    aborted: false,
    reason: '',
    cutoff,
    phones: keepPhones,
    kept: kept.map(viewOf),
    delete: toDelete.map(viewOf),
  };
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? '');
}

function missingTable(error: unknown) {
  return /no such table|ER_NO_SUCH_TABLE|doesn't exist|does not exist/i.test(messageOf(error));
}

function missingColumn(error: unknown) {
  return /unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(messageOf(error));
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function chunks<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

export async function loadSheetTestLeads(runner: SqlRunner): Promise<SheetTestLead[]> {
  let leadRows: Record<string, unknown>[];
  try {
    leadRows = await runner.all('SELECT id, name, phone, created_at, created_via FROM leads');
  } catch (error) {
    if (!missingColumn(error) && !/created_via/i.test(messageOf(error))) throw error;
    leadRows = await runner.all('SELECT id, name, phone, created_at FROM leads');
  }
  let activityRows: Record<string, unknown>[] = [];
  try {
    activityRows = await runner.all(`SELECT lead_id, details FROM lead_activity WHERE action = 'created'`);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  let sheetRows: Record<string, unknown>[] = [];
  try {
    sheetRows = await runner.all('SELECT lead_id, status FROM crm_sheet_rows');
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  const activities = new Map<string, unknown[]>();
  for (const row of activityRows) {
    const id = text(row.lead_id);
    if (!id) continue;
    const list = activities.get(id) || [];
    list.push(row.details);
    activities.set(id, list);
  }
  const imported = new Set<string>();
  for (const row of sheetRows) {
    const id = text(row.lead_id);
    if (!id || text(row.status) !== SHEET_ROW_IMPORTED) continue;
    imported.add(id);
  }
  return leadRows.map(row => {
    const id = text(row.id);
    return {
      id,
      name: text(row.name),
      phone: String(row.phone ?? ''),
      createdAt: leadCreatedAtValue(row.created_at),
      syncCreated: isSheetSyncCreatedLead({
        createdVia: row.created_via,
        importedBySheet: imported.has(id),
        createdActivities: activities.get(id) || [],
      }),
    };
  });
}

function outcomeFromPlan(
  plan: SheetTestPurgePlan,
  extra: {skipped: boolean; deleted: number; rowsMarked: number}
): SheetTestPurgeOutcome {
  return {
    ok: true,
    aborted: plan.aborted,
    reason: plan.reason,
    cutoff: plan.cutoff,
    phones: plan.phones,
    kept: plan.kept,
    delete: plan.delete,
    count: plan.delete.length,
    ...extra,
  };
}

export function skippedSheetTestPurge(reason = 'المزامنة تعمل بالفعل'): SheetTestPurgeOutcome {
  return {
    ok: true,
    aborted: false,
    skipped: true,
    reason,
    cutoff: '',
    phones: [],
    kept: [],
    delete: [],
    count: 0,
    deleted: 0,
    rowsMarked: 0,
  };
}

export async function previewSheetTestLeadPurge(
  runner: SqlRunner,
  phones: readonly string[] = DEFAULT_SHEET_TEST_KEEP_PHONES
): Promise<SheetTestPurgeOutcome> {
  const plan = planSheetTestLeadPurge(await loadSheetTestLeads(runner), phones);
  return outcomeFromPlan(plan, {skipped: false, deleted: 0, rowsMarked: 0});
}

async function markPurged(runner: SqlRunner, ids: string[]) {
  let marked = 0;
  for (const group of chunks(ids, CHUNK)) {
    const marks = group.map(() => '?').join(', ');
    try {
      const rows = await runner.all(`SELECT COUNT(*) AS n FROM crm_sheet_rows WHERE lead_id IN (${marks})`, group);
      marked += Number(rows[0]?.n ?? 0) || 0;
      await runner.run(`UPDATE crm_sheet_rows SET status = ? WHERE lead_id IN (${marks})`, [SHEET_ROW_PURGED, ...group]);
    } catch (error) {
      if (missingTable(error)) return marked;
      throw error;
    }
  }
  return marked;
}

async function deletePlannedLeads(runner: SqlRunner, ids: string[]) {
  for (const group of chunks(ids, CHUNK)) {
    const marks = group.map(() => '?').join(', ');
    for (const table of SHEET_DUPLICATE_CHILD_TABLES) {
      try {
        await runner.run(`DELETE FROM ${table} WHERE lead_id IN (${marks})`, group);
      } catch (error) {
        if (missingTable(error)) continue;
        throw error;
      }
    }
    await runner.run(`DELETE FROM leads WHERE id IN (${marks})`, group);
  }
}

/**
 * Deletes the planned leads. Caller holds the sheet sync lock and, on MySQL,
 * a transaction. A second call deletes nothing.
 */
export async function executeSheetTestLeadPurge(
  runner: SqlRunner,
  phones: readonly string[] = DEFAULT_SHEET_TEST_KEEP_PHONES
): Promise<SheetTestPurgeOutcome> {
  const plan = planSheetTestLeadPurge(await loadSheetTestLeads(runner), phones);
  if (plan.aborted || !plan.delete.length) {
    return outcomeFromPlan(plan, {skipped: false, deleted: 0, rowsMarked: 0});
  }
  const ids = plan.delete.map(lead => lead.id);
  const rowsMarked = await markPurged(runner, ids);
  await deletePlannedLeads(runner, ids);
  return outcomeFromPlan(plan, {skipped: false, deleted: ids.length, rowsMarked});
}

/** Lock plus delete on one connection. The admin route holds the lock outside its transaction instead. */
export async function purgeSheetTestLeads(
  runner: SqlRunner,
  phones: readonly string[] = DEFAULT_SHEET_TEST_KEEP_PHONES,
  options?: {locked?: boolean}
): Promise<SheetTestPurgeOutcome> {
  let token = '';
  try {
    if (options?.locked !== true) {
      token = await acquireSheetSyncLock(runner);
      if (!token) return skippedSheetTestPurge();
    }
    return await executeSheetTestLeadPurge(runner, phones);
  } finally {
    if (token) await releaseSheetSyncLock(runner, token);
  }
}
