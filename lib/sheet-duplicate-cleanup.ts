import {normalizeLeadPhone} from './phone';

/**
 * Sync-created marker, in order of reliability:
 * 1. `leads.created_via = 'google_sheet'` (written on insert and backfilled)
 * 2. `lead_activity.action = 'created'` whose details.via is `google_sheet`
 * 3. `crm_sheet_rows.lead_id` with status `imported` (the insert path only;
 *    status `duplicate` points at the older lead and is not a sync marker)
 * Source text such as «تيك توك» is never used. A manual lead with that source
 * stays even when a newer or older row shares its phone.
 */
export const SHEET_SYNC_CREATED_VIA = 'google_sheet';
export const SHEET_ROW_IMPORTED = 'imported';
export const SHEET_ROW_DUPLICATE = 'duplicate';

/**
 * Child rows that reference leads.id. Removed before the lead so InnoDB
 * foreign keys (lead_activity, crm_transactions, crm_import_rows) accept the
 * delete. crm_sheet_rows has no FK; those rows are retargeted, not deleted.
 */
export const SHEET_DUPLICATE_CHILD_TABLES = ['lead_activity', 'crm_transactions', 'crm_import_rows'] as const;

export type SqlRunner = {
  all(sql: string, values?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  run(sql: string, values?: readonly unknown[]): Promise<void>;
};

export type CleanupCandidate = {
  id: string;
  phone: string;
  createdAt: string;
  syncCreated: boolean;
};

export type CleanupDeletion = {
  deleteId: string;
  survivorId: string;
  phone: string;
};

export type SheetDuplicateCleanupResult = {
  ok: boolean;
  skipped: boolean;
  reason: string;
  deleted: number;
  deletedIds: string[];
  rowsMarked: number;
  totalDeleted: number;
  ranAt: string;
};

export type SheetDuplicateCleanupSnapshot = {
  deleted: number;
  totalDeleted: number;
  rowsMarked: number;
  ranAt: string;
};

const EMPTY_RESULT = (reason = '', skipped = false): SheetDuplicateCleanupResult => ({
  ok: !reason,
  skipped,
  reason,
  deleted: 0,
  deletedIds: [],
  rowsMarked: 0,
  totalDeleted: 0,
  ranAt: '',
});

let turn: Promise<void> = Promise.resolve();

/** One in-process queue for the timer, cron, «مزامنة الآن», and the cleanup button. */
export function enqueueSheetTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = turn.then(work, work);
  turn = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? '');
}

function duplicateKey(error: unknown) {
  return /duplicate|UNIQUE|ER_DUP_ENTRY/i.test(messageOf(error));
}

function missingTable(error: unknown) {
  return /no such table|ER_NO_SUCH_TABLE|doesn't exist|does not exist/i.test(messageOf(error));
}

function missingColumn(error: unknown) {
  return /unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(messageOf(error));
}

export function leadCreatedAtValue(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value ?? '').trim();
}

/** Empty timestamps sort last so a missing date is not treated as earlier. */
export function leadAgeKey(createdAt: string, id: string) {
  const stamp = createdAt.trim() || '9999-99-99T99:99:99.999Z';
  return `${stamp}\n${id}`;
}

export function activityViaSheet(details: unknown): boolean {
  if (details && typeof details === 'object') {
    return (details as {via?: unknown}).via === SHEET_SYNC_CREATED_VIA;
  }
  const text = String(details ?? '');
  if (!text.trim()) return false;
  try {
    const parsed = JSON.parse(text) as {via?: unknown};
    if (parsed && typeof parsed === 'object' && parsed.via === SHEET_SYNC_CREATED_VIA) return true;
  } catch {
    // details may be plain text
  }
  return /"via"\s*:\s*"google_sheet"/.test(text);
}

export function isSheetSyncCreatedLead(input: {
  createdVia?: unknown;
  importedBySheet?: boolean;
  createdActivities?: unknown[];
}): boolean {
  if (String(input.createdVia ?? '') === SHEET_SYNC_CREATED_VIA) return true;
  if (input.importedBySheet) return true;
  return (input.createdActivities || []).some(activityViaSheet);
}

/**
 * Newer sheet-sync leads whose normalized phone matches an earlier lead.
 * The earliest lead is always kept. A later lead is deleted only when the
 * sync marker says the sheet sync created it. Two sync leads: keep the oldest.
 */
export function planSheetSyncDuplicateCleanup(leads: CleanupCandidate[]): CleanupDeletion[] {
  const groups = new Map<string, CleanupCandidate[]>();
  for (const lead of leads) {
    const id = String(lead.id || '').trim();
    const phone = normalizeLeadPhone(lead.phone);
    if (!id || !phone) continue;
    const list = groups.get(phone) || [];
    list.push({id, phone, createdAt: leadCreatedAtValue(lead.createdAt), syncCreated: Boolean(lead.syncCreated)});
    groups.set(phone, list);
  }
  const plan: CleanupDeletion[] = [];
  for (const [phone, group] of groups) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => {
      const left = leadAgeKey(a.createdAt, a.id);
      const right = leadAgeKey(b.createdAt, b.id);
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    const survivor = ordered[0];
    for (const lead of ordered.slice(1)) {
      if (!lead.syncCreated) continue;
      if (lead.id === survivor.id) continue;
      plan.push({deleteId: lead.id, survivorId: survivor.id, phone});
    }
  }
  return plan;
}

export type IndexedLead = {
  id: string;
  name: string;
  phone: string;
  storedPhone: string;
  stage: string;
  assigned_to: string;
  source: string;
  createdAt: string;
};

/** Oldest lead for each normalized phone. Used before every sheet insert. */
export function indexLeadsByNormalizedPhone(rows: Array<Record<string, unknown>>): Map<string, IndexedLead> {
  const index = new Map<string, IndexedLead>();
  for (const row of rows) {
    const phone = normalizeLeadPhone(String(row.phone ?? ''));
    const id = String(row.id ?? '').trim();
    if (!phone || !id) continue;
    const lead: IndexedLead = {
      id,
      name: String(row.name ?? ''),
      phone,
      storedPhone: String(row.phone ?? ''),
      stage: String(row.stage ?? ''),
      assigned_to: String(row.assigned_to ?? ''),
      source: String(row.source ?? ''),
      createdAt: leadCreatedAtValue(row.created_at ?? row.createdAt),
    };
    const prev = index.get(phone);
    if (!prev || leadAgeKey(lead.createdAt, lead.id) < leadAgeKey(prev.createdAt, prev.id)) index.set(phone, lead);
  }
  return index;
}

export async function acquireSheetSyncLock(runner: SqlRunner): Promise<string> {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const until = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  try {
    await runner.run('INSERT INTO crm_sheet_sync_lock (id, locked_until, token) VALUES (?, ?, ?)', ['sheets', until, token]);
    return token;
  } catch (error) {
    if (!duplicateKey(error)) throw error;
  }
  const rows = await runner.all('SELECT locked_until, token FROM crm_sheet_sync_lock WHERE id = ?', ['sheets']);
  const current = rows[0];
  if (!current) return '';
  const lockedUntil = String(current.locked_until ?? '');
  const currentToken = String(current.token ?? '');
  if (lockedUntil >= now) return '';
  await runner.run(
    'UPDATE crm_sheet_sync_lock SET locked_until = ?, token = ? WHERE id = ? AND token = ? AND locked_until = ?',
    [until, token, 'sheets', currentToken, lockedUntil]
  );
  const owned = await runner.all('SELECT token FROM crm_sheet_sync_lock WHERE id = ?', ['sheets']);
  return String(owned[0]?.token ?? '') === token ? token : '';
}

export async function releaseSheetSyncLock(runner: SqlRunner, token: string) {
  if (!token) return;
  try {
    await runner.run(
      'UPDATE crm_sheet_sync_lock SET locked_until = ?, token = ? WHERE id = ? AND token = ?',
      ['1970-01-01T00:00:00.000Z', '', 'sheets', token]
    );
  } catch (error) {
    console.error('sheet sync lock was not released', error instanceof Error ? error.name : 'error');
  }
}

export function runnerFromLeadDb(db: {
  prepare(sql: string): {
    bind(...args: Array<string | number | null>): {
      all(): Promise<{results: Array<Record<string, unknown>>}>;
      run(): Promise<unknown>;
    };
  };
}): SqlRunner {
  return {
    async all(sql, values = []) {
      const rows = await db.prepare(sql).bind(...(values as Array<string | number | null>)).all();
      return rows.results || [];
    },
    async run(sql, values = []) {
      await db.prepare(sql).bind(...(values as Array<string | number | null>)).run();
    },
  };
}

async function loadLeadRows(runner: SqlRunner) {
  try {
    return await runner.all('SELECT id, phone, created_at, created_via FROM leads');
  } catch (error) {
    if (!missingColumn(error) && !/created_via/i.test(messageOf(error))) throw error;
    return await runner.all('SELECT id, phone, created_at FROM leads');
  }
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

async function backfillCreatedVia(runner: SqlRunner, ids: string[]) {
  for (const id of ids) {
    try {
      await runner.run(
        `UPDATE leads SET created_via = ? WHERE id = ? AND (created_via IS NULL OR created_via = '')`,
        [SHEET_SYNC_CREATED_VIA, id]
      );
    } catch (error) {
      if (missingColumn(error) || /created_via/i.test(messageOf(error))) return;
      console.error('sheet sync created_via was not backfilled', error instanceof Error ? error.name : 'error');
      return;
    }
  }
}

async function persistCleanup(runner: SqlRunner, deleted: number, rowsMarked: number) {
  const ranAt = new Date().toISOString();
  let previous = 0;
  const existing = await runner.all('SELECT total_deleted FROM crm_sheet_cleanup WHERE id = ?', ['latest']);
  if (existing.length) previous = Number(existing[0]?.total_deleted ?? 0) || 0;
  const totalDeleted = previous + deleted;
  if (existing.length) {
    await runner.run(
      'UPDATE crm_sheet_cleanup SET deleted_count = ?, total_deleted = ?, rows_marked = ?, ran_at = ? WHERE id = ?',
      [deleted, totalDeleted, rowsMarked, ranAt, 'latest']
    );
  } else {
    try {
      await runner.run(
        'INSERT INTO crm_sheet_cleanup (id, deleted_count, total_deleted, rows_marked, ran_at) VALUES (?, ?, ?, ?, ?)',
        ['latest', deleted, totalDeleted, rowsMarked, ranAt]
      );
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      await runner.run(
        'UPDATE crm_sheet_cleanup SET deleted_count = ?, total_deleted = ?, rows_marked = ?, ran_at = ? WHERE id = ?',
        [deleted, totalDeleted, rowsMarked, ranAt, 'latest']
      );
    }
  }
  return {totalDeleted, ranAt};
}

async function deleteNewerSheetSyncDuplicates(runner: SqlRunner): Promise<SheetDuplicateCleanupResult> {
  const leadRows = await loadLeadRows(runner);
  let activityRows: Record<string, unknown>[] = [];
  try {
    activityRows = await runner.all(`SELECT lead_id, details FROM lead_activity WHERE action = 'created'`);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
  let sheetRows: Record<string, unknown>[] = [];
  try {
    sheetRows = await runner.all('SELECT id, lead_id, status FROM crm_sheet_rows');
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
  const candidates: CleanupCandidate[] = leadRows.map(row => {
    const id = text(row.id);
    return {
      id,
      phone: String(row.phone ?? ''),
      createdAt: leadCreatedAtValue(row.created_at),
      syncCreated: isSheetSyncCreatedLead({
        createdVia: row.created_via,
        importedBySheet: imported.has(id),
        createdActivities: activities.get(id) || [],
      }),
    };
  });
  const syncIds = candidates.filter(lead => lead.syncCreated && lead.id).map(lead => lead.id);
  await backfillCreatedVia(runner, syncIds);
  const plan = planSheetSyncDuplicateCleanup(candidates);
  const deletedIds: string[] = [];
  let rowsMarked = 0;
  for (const item of plan) {
    const linked = sheetRows.filter(row => text(row.lead_id) === item.deleteId);
    let removedLead = false;
    try {
      for (const table of SHEET_DUPLICATE_CHILD_TABLES) {
        try {
          await runner.run(`DELETE FROM ${table} WHERE lead_id = ?`, [item.deleteId]);
        } catch (error) {
          if (missingTable(error)) continue;
          throw error;
        }
      }
      await runner.run('DELETE FROM leads WHERE id = ?', [item.deleteId]);
      removedLead = true;
    } catch (error) {
      console.error('sheet sync duplicate was not deleted', error instanceof Error ? error.name : 'error');
      continue;
    }
    if (!removedLead) continue;
    deletedIds.push(item.deleteId);
    if (linked.length) {
      try {
        await runner.run(
          `UPDATE crm_sheet_rows SET status = ?, lead_id = ? WHERE lead_id = ?`,
          [SHEET_ROW_DUPLICATE, item.survivorId, item.deleteId]
        );
        rowsMarked += linked.length;
      } catch (error) {
        if (!missingTable(error)) {
          console.error('sheet row was not marked duplicate', error instanceof Error ? error.name : 'error');
        }
      }
    }
    try {
      await runner.run(
        'INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)',
        [
          crypto.randomUUID(),
          item.survivorId,
          'system',
          'sheet_duplicate_removed',
          JSON.stringify({
            note: 'حُذف عميل أحدث أنشأته مزامنة الجدول لأن رقم الجوال موجود على هذا العميل الأقدم. لم يُرسل بريد.',
            deletedLeadId: item.deleteId,
            phone: item.phone,
          }),
        ]
      );
    } catch (error) {
      console.error('sheet duplicate note was not written', error instanceof Error ? error.name : 'error');
    }
  }
  let totalDeleted = deletedIds.length;
  let ranAt = new Date().toISOString();
  try {
    const stored = await persistCleanup(runner, deletedIds.length, rowsMarked);
    totalDeleted = stored.totalDeleted;
    ranAt = stored.ranAt;
  } catch (error) {
    console.error('sheet duplicate cleanup result was not saved', error instanceof Error ? error.name : 'error');
  }
  if (deletedIds.length) {
    console.log(`[sheet-dedupe] deleted ${deletedIds.length} sync duplicates, marked ${rowsMarked} rows`);
  }
  return {
    ok: true,
    skipped: false,
    reason: '',
    deleted: deletedIds.length,
    deletedIds,
    rowsMarked,
    totalDeleted,
    ranAt,
  };
}

/**
 * Deletes newer sheet-sync duplicates. Pass `{locked: true}` when the caller
 * already holds crm_sheet_sync_lock id `sheets` (the sync itself). Otherwise
 * this acquires that lock so a timer, cron, and «مزامنة الآن» cannot insert
 * while the delete runs. A busy lock skips the work.
 */
export async function cleanupSheetSyncDuplicates(
  runner: SqlRunner,
  options?: {locked?: boolean}
): Promise<SheetDuplicateCleanupResult> {
  let token = '';
  try {
    if (options?.locked !== true) {
      token = await acquireSheetSyncLock(runner);
      if (!token) return {...EMPTY_RESULT('المزامنة تعمل بالفعل', true), ok: true};
    }
    return await deleteNewerSheetSyncDuplicates(runner);
  } catch (error) {
    console.error('sheet duplicate cleanup failed', error instanceof Error ? error.message : 'error');
    return EMPTY_RESULT('تعذر تنظيف العملاء المكررين');
  } finally {
    if (token) await releaseSheetSyncLock(runner, token);
  }
}

export async function readSheetDuplicateCleanup(runner: SqlRunner): Promise<SheetDuplicateCleanupSnapshot | null> {
  try {
    const rows = await runner.all(
      'SELECT deleted_count, total_deleted, rows_marked, ran_at FROM crm_sheet_cleanup WHERE id = ?',
      ['latest']
    );
    const row = rows[0];
    if (!row) return null;
    return {
      deleted: Number(row.deleted_count ?? 0) || 0,
      totalDeleted: Number(row.total_deleted ?? 0) || 0,
      rowsMarked: Number(row.rows_marked ?? 0) || 0,
      ranAt: text(row.ran_at),
    };
  } catch (error) {
    if (missingTable(error) || missingColumn(error)) return null;
    console.error('sheet duplicate cleanup result was not read', error instanceof Error ? error.name : 'error');
    return null;
  }
}
