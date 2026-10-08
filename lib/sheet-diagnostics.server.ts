import 'server-only';
import {crmPool} from './crm-db';
import {ensureSheetSchema, schemaDiagnostics} from './lead-schema';
import {sheetRowKeyHash, sheetSourceKey} from './sheet-keys';
import {publicSyncError} from './sheet-sync-config';

const TABLES = ['crm_sheet_sources', 'crm_sheet_rows', 'crm_sheet_sync_lock'] as const;

export type SheetDiagnostics = {
  ok: boolean;
  version: string;
  tables: Record<(typeof TABLES)[number], boolean>;
  insert: string;
  persisted: boolean;
  schemaIssues: ReturnType<typeof schemaDiagnostics>;
};

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result)) return [];
  const first = result[0];
  return Array.isArray(first) ? first as Record<string, unknown>[] : [];
}

/**
 * Confirms the sheet tables, reports the server version, and inserts one probe
 * row inside a transaction that is always rolled back.
 */
export async function diagnoseSheetDatabase(): Promise<SheetDiagnostics> {
  await ensureSheetSchema();
  const pool = crmPool();
  const versionRows = rowsOf(await pool.query('SELECT VERSION() AS version'));
  const version = String(versionRows[0]?.version ?? versionRows[0]?.VERSION ?? '');
  const tables = {crm_sheet_sources: false, crm_sheet_rows: false, crm_sheet_sync_lock: false};
  for (const table of TABLES) {
    try {
      await pool.query(`SELECT 1 AS ok FROM \`${table}\` LIMIT 0`);
      tables[table] = true;
    } catch (error) {
      console.error('sheet table check failed', table, publicSyncError(error));
      tables[table] = false;
    }
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const sheetId = 'diag-not-real-sheet-id-0001';
  const gid = '1';
  let insert = 'rolled-back';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO crm_sheet_sources (
        id, sheet_id, gid, label, campaign, mapping, headers, enabled, created_at, updated_at, sheet_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, sheetId, gid, 'فحص', '', '{}', '[]', 0, now, now, sheetSourceKey(sheetId, gid)]
    );
    await connection.execute(
      `INSERT INTO crm_sheet_rows (id, source_id, row_key, row_key_hash, lead_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, id, 'diag-row', sheetRowKeyHash(id, 'diag-row'), null, 'diag', now]
    );
    await connection.rollback();
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('sheet diagnostic rollback failed', publicSyncError(rollbackError));
    }
    insert = publicSyncError(error);
    console.error('sheet diagnostic insert failed', insert);
  } finally {
    connection.release();
  }
  let persisted = false;
  try {
    const left = rowsOf(await pool.execute('SELECT id FROM crm_sheet_sources WHERE id = ?', [id]));
    persisted = left.length > 0;
  } catch (error) {
    persisted = true;
    insert = publicSyncError(error);
    console.error('sheet diagnostic read-back failed', insert);
  }
  if (persisted) {
    try {
      await pool.execute('DELETE FROM crm_sheet_rows WHERE id = ? OR source_id = ?', [id, id]);
      await pool.execute('DELETE FROM crm_sheet_sources WHERE id = ?', [id]);
    } catch (error) {
      console.error('sheet diagnostic probe was not removed', publicSyncError(error));
    }
  }
  const tablesOk = TABLES.every(table => tables[table]);
  return {
    ok: tablesOk && insert === 'rolled-back' && !persisted && version.length > 0,
    version,
    tables,
    insert,
    persisted,
    schemaIssues: schemaDiagnostics(),
  };
}
