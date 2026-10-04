/**
 * Idempotent leads schema repair, cached for the life of the process.
 * Deploy can reach the clients list before anyone runs `npm run db:migrate`.
 * SHOW COLUMNS is used first because Hostinger's DB user may not read
 * information_schema. If the repair cannot run, featured stays off and callers
 * must not reference `leads.is_featured`.
 * Stage repair appends ENUM members (it never drops or reorders existing
 * ones) and then moves retired stages. A failure is logged and the page
 * keeps loading with the previous stage list.
 * crm_users.phone is added the same way when an older users table lacks it.
 * Telegram offers use site_properties. Beds and baths are nullable TEXT so an
 * unparsed post stores NULL, and telegram_chat_id / telegram_message_id /
 * telegram_media_group_id are added the same once-per-process way. The repair
 * never drops data and a failure here does not block the leads schema.
 * Existing lead phones are rewritten to the Saudi local form 05XXXXXXXX once
 * per process. Shared numbers are kept (nothing is merged or deleted) and each
 * of those leads gets one phone_duplicate activity note.
 * ai_settings / ai_usage are created the same way so provider-key save does not
 * depend on a manual migration. crm_users.last_login_at is added once and left
 * null until a real sign-in writes it.
 * crm_sheet_sources / crm_sheet_rows / crm_sheet_sync_lock are created the same
 * way. The public TikTok lead sheet is inserted only while the source table is
 * empty, so disabling that row is kept and a second process start does not
 * duplicate it.
 */

import {planLeadPhoneMigration} from './phone';
import {retiredStageMoves, stageEnumValues} from './lead-stages';
import {TIKTOK_META_TAB_GID, tiktokSheetSeed} from './sheet-sync-config';

export type LeadSchemaState = {featured: boolean};

export type SqlExecutor = {
  execute: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
  query?: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
};

let cached: Promise<LeadSchemaState> | null = null;

export function resetLeadSchemaCache() {
  cached = null;
}

export function ensureLeadSchema(executor?: SqlExecutor): Promise<LeadSchemaState> {
  if (!cached) {
    const resolved = executor ? Promise.resolve(executor) : defaultExecutor();
    cached = resolved.then(runEnsure).catch(error => {
      console.error('Lead schema check failed; clients stay unfeatured', error);
      return {featured: false};
    });
  }
  return cached;
}

async function defaultExecutor(): Promise<SqlExecutor> {
  const {crmPool} = await import('./crm-db');
  return crmPool() as unknown as SqlExecutor;
}

async function run(executor: SqlExecutor, sql: string, values: readonly unknown[] = []) {
  if (!values.length && executor.query) return executor.query(sql);
  return executor.execute(sql, values);
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    const first = result[0];
    return Array.isArray(first) ? first as Record<string, unknown>[] : [];
  }
  return [];
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function hasFeaturedColumn(executor: SqlExecutor): Promise<boolean | null> {
  try {
    const names = new Set(
      rowsOf(await run(executor, 'SHOW COLUMNS FROM leads')).map(row =>
        String(row.Field ?? row.field ?? row.name ?? '')
      )
    );
    return names.has('is_featured');
  } catch (error) {
    if (/no such table|ER_NO_SUCH_TABLE/i.test(messageOf(error))) return null;
    try {
      await run(executor, 'SELECT is_featured FROM leads LIMIT 0');
      return true;
    } catch (probe) {
      if (/is_featured|unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(messageOf(probe))) return false;
      return null;
    }
  }
}

async function ensureFeaturedIndex(executor: SqlExecutor) {
  try {
    const names = new Set(
      rowsOf(await run(executor, 'SHOW INDEX FROM leads')).map(row =>
        String(row.Key_name ?? row.key_name ?? row.name ?? '')
      )
    );
    if (names.has('leads_featured_idx')) return;
  } catch {
    // SHOW INDEX is MySQL. SQLite and locked-down accounts fall through to CREATE.
  }
  try {
    await run(executor, 'ALTER TABLE leads ADD INDEX leads_featured_idx (is_featured, created_at)');
  } catch (error) {
    if (/duplicate|already exists|ER_DUP_KEYNAME/i.test(messageOf(error))) return;
    try {
      await run(executor, 'CREATE INDEX IF NOT EXISTS leads_featured_idx ON leads (is_featured, created_at)');
    } catch (fallback) {
      console.error('featured index was not added', fallback);
    }
  }
}

function columnName(row: Record<string, unknown>) {
  return String(row.Field ?? row.field ?? row.COLUMN_NAME ?? row.column_name ?? '');
}

function columnType(row: Record<string, unknown>) {
  return String(row.Type ?? row.type ?? row.COLUMN_TYPE ?? row.column_type ?? '');
}

/** MySQL/MariaDB `enum('a','b')`. Anything else (TEXT, missing column) is left alone. */
function parseEnum(type: string): string[] | null {
  const match = /^enum\s*\((.*)\)$/i.exec(type.trim());
  if (!match) return null;
  const values = [...match[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(part =>
    part[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  );
  return values.length ? values : null;
}

/**
 * Append missing stage keys. Existing members stay in place so MySQL ENUM
 * indexes are not remapped, and unknown production values are not dropped.
 */
async function widenStageEnum(executor: SqlExecutor) {
  let type = '';
  try {
    const rows = rowsOf(await run(executor, 'SHOW COLUMNS FROM leads'));
    const stage = rows.find(row => columnName(row).toLowerCase() === 'stage');
    type = stage ? columnType(stage) : '';
  } catch (error) {
    console.error('stage enum inspection failed; existing stages stay as stored', error);
    return;
  }
  const current = parseEnum(type);
  if (!current) return;
  const next = [...current];
  for (const value of stageEnumValues) {
    if (!next.includes(value)) next.push(value);
  }
  if (next.length === current.length) return;
  if (next.some(value => !/^[a-z0-9_]+$/i.test(value))) {
    console.error('stage enum was not widened; a value is not a safe identifier');
    return;
  }
  try {
    await run(
      executor,
      `ALTER TABLE leads MODIFY COLUMN stage ENUM(${next.map(value => `'${value}'`).join(',')}) NOT NULL DEFAULT 'new'`
    );
  } catch (error) {
    console.error('stage enum was not widened; stage updates keep the previous list', error);
  }
}

async function convertRetiredStages(executor: SqlExecutor) {
  for (const move of retiredStageMoves) {
    try {
      const ids = rowsOf(await run(executor, 'SELECT id FROM leads WHERE stage = ?', [move.from]))
        .map(row => String(row.id ?? ''))
        .filter(Boolean);
      if (!ids.length) continue;
      await run(executor, 'UPDATE leads SET stage = ? WHERE stage = ?', [move.to, move.from]);
      for (const id of ids) {
        try {
          await run(
            executor,
            'INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)',
            [
              crypto.randomUUID(),
              id,
              'system',
              'stage_changed',
              JSON.stringify({
                previousStage: move.from,
                stage: move.to,
                note: move.note,
              }),
            ]
          );
        } catch (error) {
          console.error('stage history for a retired stage was not written', error);
        }
      }
    } catch (error) {
      console.error(`stage conversion ${move.from} -> ${move.to} failed`, error);
    }
  }
}

/**
 * Older crm_users tables may have email without phone. One ALTER per process
 * cache; a second run sees the column and does nothing. Missing table or a
 * locked account must not fail the leads schema repair.
 */
async function ensureUserPhone(executor: SqlExecutor) {
  let missing = false;
  try {
    const rows = rowsOf(await run(executor, 'SHOW COLUMNS FROM crm_users'));
    missing = !rows.some(row => columnName(row).toLowerCase() === 'phone');
  } catch (error) {
    if (/no such table|ER_NO_SUCH_TABLE/i.test(messageOf(error))) return;
    try {
      await run(executor, 'SELECT phone FROM crm_users LIMIT 0');
      return;
    } catch (probe) {
      if (/phone|unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(messageOf(probe))) {
        missing = true;
      } else {
        return;
      }
    }
  }
  if (!missing) return;
  try {
    await run(executor, 'ALTER TABLE crm_users ADD COLUMN phone VARCHAR(30) NULL');
  } catch (error) {
    if (/duplicate|already exists|ER_DUP_FIELDNAME/i.test(messageOf(error))) return;
    console.error('crm_users.phone was not added', error);
  }
}

const PROPERTY_COLUMNS: [string, string][] = [
  ['title', 'TEXT NULL'],
  ['price', 'REAL NULL'],
  ['area', 'REAL NULL'],
  ['beds', 'TEXT NULL'],
  ['baths', 'TEXT NULL'],
  ['city', 'TEXT NULL'],
  ['address', 'TEXT NULL'],
  ['type', 'TEXT NULL'],
  ['purpose', 'TEXT NULL'],
  ['street_width', 'TEXT NULL'],
  ['facade', 'TEXT NULL'],
  ['age', 'TEXT NULL'],
  ['description', 'TEXT NULL'],
  ['images', 'TEXT NULL'],
  ['image_meta', 'TEXT NULL'],
  ['status', 'TEXT NULL'],
  ['telegram_chat_id', 'TEXT NULL'],
  ['telegram_message_id', 'TEXT NULL'],
  ['telegram_media_group_id', 'TEXT NULL'],
  ['telegram_message_ids', 'TEXT NULL'],
  ['telegram_source_key', 'TEXT NULL'],
  ['created_at', 'TEXT NULL'],
  ['updated_at', 'TEXT NULL'],
];

function safeIdent(value: string) {
  return /^[a-z_]+$/.test(value);
}

async function columnMissing(executor: SqlExecutor, table: string, column: string): Promise<boolean> {
  if (!safeIdent(table) || !safeIdent(column)) return false;
  try {
    const rows = rowsOf(await run(executor, `SHOW COLUMNS FROM ${table}`));
    if (rows.length) return !rows.some(row => columnName(row).toLowerCase() === column);
  } catch (error) {
    if (/no such table|ER_NO_SUCH_TABLE/i.test(messageOf(error))) return false;
  }
  try {
    await run(executor, `SELECT \`${column}\` FROM ${table} LIMIT 0`);
    return false;
  } catch (probe) {
    const text = messageOf(probe);
    if (new RegExp(column, 'i').test(text) || /unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(text)) return true;
    return false;
  }
}

async function ensureColumn(executor: SqlExecutor, table: string, column: string, definition: string) {
  if (!safeIdent(table) || !safeIdent(column)) return;
  if (!(await columnMissing(executor, table, column))) return;
  try {
    await run(executor, `ALTER TABLE ${table} ADD COLUMN \`${column}\` ${definition}`);
  } catch (error) {
    if (/duplicate|already exists|ER_DUP_FIELDNAME/i.test(messageOf(error))) return;
    console.error(`${table}.${column} was not added`, error);
  }
}

/**
 * Creates the published-property table and fills any telegram source columns
 * that an older process created the table without. Idempotent.
 */
async function ensureTelegramSchema(executor: SqlExecutor) {
  try {
    await run(
      executor,
      `CREATE TABLE IF NOT EXISTS site_properties (
        id TEXT PRIMARY KEY,
        title TEXT NULL,
        price REAL NULL,
        area REAL NULL,
        beds TEXT NULL,
        baths TEXT NULL,
        city TEXT NULL,
        address TEXT NULL,
        type TEXT NULL,
        purpose TEXT NULL,
        street_width TEXT NULL,
        facade TEXT NULL,
        age TEXT NULL,
        description TEXT NULL,
        images TEXT NULL,
        image_meta TEXT NULL,
        status TEXT NULL,
        telegram_chat_id TEXT NULL,
        telegram_message_id TEXT NULL,
        telegram_media_group_id TEXT NULL,
        telegram_message_ids TEXT NULL,
        telegram_source_key TEXT NULL,
        created_at TEXT NULL,
        updated_at TEXT NULL
      )`
    );
  } catch (error) {
    console.error('site_properties table was not created', error);
    return;
  }
  for (const [column, definition] of PROPERTY_COLUMNS) {
    await ensureColumn(executor, 'site_properties', column, definition);
  }
  try {
    await run(executor, 'CREATE UNIQUE INDEX IF NOT EXISTS site_properties_tg_key ON site_properties (telegram_source_key)');
  } catch (error) {
    if (!/already exists|duplicate|ER_DUP_KEYNAME/i.test(messageOf(error))) {
      try {
        await run(executor, 'ALTER TABLE site_properties ADD UNIQUE INDEX site_properties_tg_key (telegram_source_key)');
      } catch (fallback) {
        if (!/already exists|duplicate|ER_DUP_KEYNAME/i.test(messageOf(fallback))) {
          console.error('telegram source index was not added', fallback);
        }
      }
    }
  }
  try {
    await run(
      executor,
      `CREATE TABLE IF NOT EXISTS telegram_sync_log (
        id TEXT PRIMARY KEY,
        chat_id TEXT NULL,
        message_id TEXT NULL,
        media_group_id TEXT NULL,
        property_id TEXT NULL,
        action TEXT NULL,
        note TEXT NULL,
        created_at TEXT NULL
      )`
    );
  } catch (error) {
    console.error('telegram_sync_log table was not created', error);
  }
}

/**
 * One pass per process cache. A missing phone column or a locked account is
 * logged and skipped. A second process run sees stored 05 numbers and existing
 * phone_duplicate notes, so it does not write them again.
 */
async function normalizeExistingLeadPhones(executor: SqlExecutor) {
  let rows: Record<string, unknown>[] = [];
  try {
    rows = rowsOf(await run(executor, 'SELECT id, phone FROM leads'));
  } catch (error) {
    console.error('lead phone normalization skipped', error);
    return;
  }
  const plan = planLeadPhoneMigration(
    rows
      .map(row => ({id: String(row.id ?? ''), phone: String(row.phone ?? '')}))
      .filter(row => row.id)
  );
  for (const update of plan.updates) {
    try {
      await run(executor, 'UPDATE leads SET phone = ? WHERE id = ?', [update.phone, update.id]);
    } catch (error) {
      console.error('lead phone was not normalized', error);
    }
  }
  if (!plan.duplicateNotes.length) return;
  let noted = new Set<string>();
  try {
    noted = new Set(
      rowsOf(await run(executor, "SELECT lead_id FROM lead_activity WHERE action = 'phone_duplicate'"))
        .map(row => String(row.lead_id ?? row.leadId ?? ''))
        .filter(Boolean)
    );
  } catch (error) {
    console.error('duplicate phone notes were not checked', error);
    return;
  }
  for (const item of plan.duplicateNotes) {
    if (noted.has(item.id)) continue;
    try {
      await run(
        executor,
        'INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)',
        [
          crypto.randomUUID(),
          item.id,
          'system',
          'phone_duplicate',
          JSON.stringify({
            note: `رقم الجوال ${item.phone} مكرر على ${item.count} عملاء بعد توحيد الصيغة. لم يُدمج السجل ولم يُحذف أي عميل.`,
            phone: item.phone,
            count: item.count,
          }),
        ]
      );
    } catch (error) {
      console.error('duplicate phone note was not written', error);
    }
  }
}

async function repairStages(executor: SqlExecutor) {
  try {
    await widenStageEnum(executor);
  } catch (error) {
    console.error('stage enum widen failed', error);
  }
  try {
    await convertRetiredStages(executor);
  } catch (error) {
    console.error('retired stage conversion failed', error);
  }
}

/**
 * Provider settings are written on first save. Installations that never ran
 * 002_expansion.sql otherwise fail that save with a generic error.
 */
async function ensureAiSchema(executor: SqlExecutor) {
  try {
    await run(
      executor,
      `CREATE TABLE IF NOT EXISTS ai_settings (
        id VARCHAR(30) PRIMARY KEY,
        provider VARCHAR(30) NOT NULL,
        model VARCHAR(100) NOT NULL,
        encrypted_key TEXT NOT NULL,
        updated_at VARCHAR(24) NOT NULL
      )`
    );
  } catch (error) {
    console.error('ai_settings table was not created', error);
    return;
  }
  await ensureColumn(executor, 'ai_settings', 'provider', 'VARCHAR(30) NULL');
  await ensureColumn(executor, 'ai_settings', 'model', 'VARCHAR(100) NULL');
  await ensureColumn(executor, 'ai_settings', 'updated_at', 'VARCHAR(24) NULL');
  try {
    await run(
      executor,
      `CREATE TABLE IF NOT EXISTS ai_usage (
        user_id VARCHAR(255) NOT NULL,
        hour_key CHAR(13) NOT NULL,
        requests INT NOT NULL,
        PRIMARY KEY (user_id, hour_key)
      )`
    );
  } catch (error) {
    console.error('ai_usage table was not created', error);
  }
}

async function ensureLastLogin(executor: SqlExecutor) {
  await ensureColumn(executor, 'crm_users', 'last_login_at', 'VARCHAR(24) NULL');
}

async function ensureSheetIndex(executor: SqlExecutor) {
  try {
    await run(executor, 'CREATE UNIQUE INDEX IF NOT EXISTS crm_sheet_rows_source_key ON crm_sheet_rows (source_id, row_key)');
  } catch (error) {
    if (/already exists|duplicate|ER_DUP_KEYNAME/i.test(messageOf(error))) return;
    try {
      await run(executor, 'ALTER TABLE crm_sheet_rows ADD UNIQUE INDEX crm_sheet_rows_source_key (source_id, row_key)');
    } catch (fallback) {
      if (!/already exists|duplicate|ER_DUP_KEYNAME/i.test(messageOf(fallback))) {
        console.error('sheet row index was not added', fallback);
      }
    }
  }
}

/**
 * Point the seeded source at the «تيك توك» tab.
 * A previous seed with an empty gid, or gid 1976004933, read the first tab («meta»).
 * That row is rewritten in place and its old row keys are dropped so the new tab
 * is an initial backfill. Any other source still aimed at that first tab is disabled.
 * When the table is empty, the TikTok tab is inserted. A correct gid is left untouched.
 */
async function alignTiktokSheetSource(executor: SqlExecutor) {
  const seed = tiktokSheetSeed();
  const now = new Date().toISOString();
  const rows = rowsOf(await run(executor, 'SELECT id, sheet_id, gid FROM crm_sheet_sources'));
  const gidOf = (row: Record<string, unknown>) => String(row.gid ?? '').trim();
  const mine = rows.filter(row => String(row.sheet_id ?? '') === seed.sheetId);
  const stale = mine.filter(row => {
    const gid = gidOf(row);
    return gid === '' || gid === TIKTOK_META_TAB_GID;
  });
  const current = mine.find(row => gidOf(row) === seed.gid);
  if (current) {
    for (const row of stale) {
      if (String(row.id ?? '') === String(current.id ?? '')) continue;
      await run(executor, 'UPDATE crm_sheet_sources SET enabled = 0, updated_at = ? WHERE id = ?', [now, String(row.id ?? '')]);
    }
    return;
  }
  if (!stale.length) {
    if (rows.length) return;
    await run(
      executor,
      `INSERT INTO crm_sheet_sources (
        id, sheet_id, gid, label, campaign, mapping, headers, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seed.id,
        seed.sheetId,
        seed.gid,
        seed.label,
        seed.campaign,
        JSON.stringify(seed.mapping),
        JSON.stringify(seed.headers),
        seed.enabled,
        now,
        now,
      ]
    );
    return;
  }
  const target = stale.find(row => String(row.id ?? '') === seed.id) || stale[0];
  const targetId = String(target.id ?? '');
  await run(
    executor,
    `UPDATE crm_sheet_sources
     SET sheet_id = ?, gid = ?, label = ?, campaign = ?, mapping = ?, headers = ?, enabled = 1, updated_at = ?
     WHERE id = ?`,
    [
      seed.sheetId,
      seed.gid,
      seed.label,
      seed.campaign,
      JSON.stringify(seed.mapping),
      JSON.stringify(seed.headers),
      now,
      targetId,
    ]
  );
  await run(executor, 'DELETE FROM crm_sheet_rows WHERE source_id = ?', [targetId]);
  for (const row of stale) {
    if (String(row.id ?? '') === targetId) continue;
    await run(executor, 'UPDATE crm_sheet_sources SET enabled = 0, updated_at = ? WHERE id = ?', [now, String(row.id ?? '')]);
  }
}

/**
 * Lead-form sheet sources and the keys of rows already imported.
 * The TikTok tab is seeded when no source exists, and an older meta-tab seed is retargeted.
 */
async function ensureSheetSyncSchema(executor: SqlExecutor) {
  try {
    await run(
      executor,
      `CREATE TABLE IF NOT EXISTS crm_sheet_sources (
        id TEXT PRIMARY KEY,
        sheet_id TEXT NOT NULL,
        gid TEXT NULL,
        label TEXT NOT NULL,
        campaign TEXT NOT NULL,
        mapping TEXT NOT NULL,
        headers TEXT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run TEXT NULL,
        last_result TEXT NULL,
        created_at TEXT NULL,
        updated_at TEXT NULL
      )`
    );
    await run(
      executor,
      `CREATE TABLE IF NOT EXISTS crm_sheet_rows (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        row_key TEXT NOT NULL,
        lead_id TEXT NULL,
        status TEXT NULL,
        created_at TEXT NULL
      )`
    );
    await run(
      executor,
      `CREATE TABLE IF NOT EXISTS crm_sheet_sync_lock (
        id TEXT PRIMARY KEY,
        locked_until TEXT NOT NULL,
        token TEXT NOT NULL
      )`
    );
  } catch (error) {
    console.error('sheet sync tables were not created', error);
    return;
  }
  await ensureSheetIndex(executor);
  try {
    await alignTiktokSheetSource(executor);
  } catch (error) {
    if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(messageOf(error))) return;
    console.error('tiktok sheet seed skipped', error);
  }
}

async function runEnsure(executor: SqlExecutor): Promise<LeadSchemaState> {
  try {
    await ensureSheetSyncSchema(executor);
  } catch (error) {
    console.error('sheet sync schema check failed', error);
  }
  try {
    await ensureTelegramSchema(executor);
  } catch (error) {
    console.error('telegram property schema check failed', error);
  }
  try {
    await ensureUserPhone(executor);
  } catch (error) {
    console.error('crm_users phone check failed', error);
  }
  try {
    await ensureLastLogin(executor);
  } catch (error) {
    console.error('crm_users last_login_at check failed', error);
  }
  try {
    await ensureAiSchema(executor);
  } catch (error) {
    console.error('ai settings schema check failed', error);
  }
  let featured = false;
  const existing = await hasFeaturedColumn(executor);
  if (existing === null) {
    await repairStages(executor);
    try {
      await normalizeExistingLeadPhones(executor);
    } catch (error) {
      console.error('lead phone normalization failed', error);
    }
    return {featured: false};
  }
  featured = existing;
  if (!featured) {
    try {
      await run(executor, 'ALTER TABLE leads ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0');
      featured = true;
    } catch (error) {
      console.error('is_featured column was not added; clients stay unfeatured', error);
      featured = false;
    }
  }
  if (featured) await ensureFeaturedIndex(executor);
  await repairStages(executor);
  try {
    await normalizeExistingLeadPhones(executor);
  } catch (error) {
    console.error('lead phone normalization failed', error);
  }
  return {featured};
}

export function isMissingFeaturedColumn(error: unknown) {
  return /is_featured|unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(messageOf(error));
}
