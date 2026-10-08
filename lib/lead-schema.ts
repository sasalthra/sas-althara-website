/**
 * Idempotent leads schema repair, cached for the life of the process.
 * Deploy can reach the clients list before anyone runs `npm run db:migrate`.
 * SHOW COLUMNS is used first because Hostinger's DB user may not read
 * information_schema. If the repair cannot run, featured stays off and callers
 * must not reference `leads.is_featured`.
 * Stage repair appends ENUM members (it never drops or reorders existing
 * ones) and then moves retired stages. A failure is logged and the page
 * keeps loading with the previous stage list.
 * lead_stage_notes keeps every stage note as its own row
 * (text, at, byUserId, byName, stage). A later note on the same stage is
 * inserted; it does not replace the previous row. Existing stage_changed
 * notes are copied once, keyed by the activity id.
 * crm_users.phone is added the same way when an older users table lacks it.
 * Telegram offers use site_properties. Beds and baths are nullable TEXT so an
 * unparsed post stores NULL, and telegram_chat_id / telegram_message_id /
 * telegram_media_group_id are added the same once-per-process way. The repair
 * never drops data and a failure here does not block the leads schema.
 * site_properties.id and telegram_sync_log.id are VARCHAR primary keys.
 * A TEXT/BLOB primary or unique key is ER_BLOB_KEY_WITHOUT_LENGTH (1170) on
 * MySQL 5.7, MySQL 8, and MariaDB 10.4, and that failure used to return before
 * telegram_sync_log existed, so the admin sync page could not read the log.
 * The source uniqueness is telegram_source_hash CHAR(64), a SHA-256, not a
 * TEXT column. JSON columns are not used. A failed create is not cached.
 * Existing lead phones are rewritten to the Saudi local form 05XXXXXXXX once
 * per process. A newer lead created by the sheet sync is then deleted when an
 * earlier lead has the same normalized phone (see lib/sheet-duplicate-cleanup.ts).
 * The marker is leads.created_via = google_sheet, a created activity whose
 * via is google_sheet, or a crm_sheet_rows link with status imported. Source
 * text alone is not a marker. Other shared numbers are kept, and each of those
 * remaining leads gets one phone_duplicate activity note.
 * ai_settings / ai_usage are created the same way so provider-key save does not
 * depend on a manual migration. crm_users.last_login_at is added once and left
 * null until a real sign-in writes it.
 * crm_transactions.owner_commission and client_commission are added once and
 * left null. A previous free-text brokerage value is not copied into either
 * column.
 * crm_sheet_sources / crm_sheet_rows / crm_sheet_sync_lock are created the same
 * way, with DDL that MySQL 5.7+, MySQL 8, and MariaDB 10.4 accept. TEXT cannot
 * be a primary key there (ER_BLOB_KEY_WITHOUT_LENGTH), JSON and a long utf8mb4
 * unique key are avoided, and the row/sheet uniqueness is a SHA-256 column.
 * The public TikTok lead sheet is inserted whenever that sheet id and gid
 * are missing, even if other sources already exist. A wrong gid on the seeded
 * row is rewritten. Disabling a row that already points at the right gid is
 * kept, and a second process start does not duplicate it. The Snap tab
 * «اسناب يوليو» is inserted once when that spreadsheet id and gid are missing,
 * and an existing row for the same tab is left as the admin saved it. A failed create is
 * not cached, so the next read or write tries again. last_run_at, rows_read,
 * created, existing, skipped, and error_message are added the same way.
 */

import {planLeadPhoneMigration} from './phone';
import {retiredStageMoves, stageEnumValues} from './lead-stages';
import {
  STAGE_CHANGED_NOTES_SQL,
  STAGE_NOTE_INSERT_SQL,
  STAGE_NOTE_SOURCES_SQL,
  STAGE_NOTES_DDL,
  STAGE_NOTES_LEAD_INDEX,
  STAGE_NOTES_LEAD_INDEX_ALTER,
  STAGE_NOTES_SOURCE_INDEX,
  STAGE_NOTES_SOURCE_INDEX_ALTER,
  clipName,
  normalizeNoteAt,
  parseStageActivityNote,
} from './stage-notes';
import {sheetSourceKey} from './sheet-keys';
import {cleanupSheetSyncDuplicates, type SqlRunner} from './sheet-duplicate-cleanup';
import {TIKTOK_META_TAB_GID, snapSheetSeed, tiktokSheetSeed} from './sheet-sync-config';

export type LeadSchemaState = {featured: boolean};

export type SqlExecutor = {
  execute: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
  query?: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
};

let cached: Promise<LeadSchemaState> | null = null;
let sheetReady: Promise<void> | null = null;
let telegramReady: Promise<void> | null = null;
let telegramSchemaError: unknown = null;

export function resetLeadSchemaCache() {
  cached = null;
  sheetReady = null;
  telegramReady = null;
  telegramSchemaError = null;
}

export function lastTelegramSchemaError() {
  return telegramSchemaError;
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
  ['telegram_chat_id', 'VARCHAR(64) NULL'],
  ['telegram_message_id', 'VARCHAR(32) NULL'],
  ['telegram_media_group_id', 'VARCHAR(64) NULL'],
  ['telegram_message_ids', 'TEXT NULL'],
  ['telegram_source_key', 'VARCHAR(255) NULL'],
  ['telegram_source_hash', 'CHAR(64) NULL'],
  ['price_from', 'INTEGER NULL'],
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
 * VARCHAR keys stay inside the 767-byte utf8mb4 limit on MySQL 5.7.
 * id is VARCHAR(191) (764 bytes). The unique source key is CHAR(64), not the
 * raw telegram_source_key string and not TEXT (error 1170). No JSON column.
 * MySQL has no CREATE INDEX IF NOT EXISTS; the ALTER form is the fallback.
 * A failure of one table does not skip the others.
 */
export const SITE_PROPERTIES_DDL = `CREATE TABLE IF NOT EXISTS site_properties (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
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
  telegram_chat_id VARCHAR(64) NULL,
  telegram_message_id VARCHAR(32) NULL,
  telegram_media_group_id VARCHAR(64) NULL,
  telegram_message_ids TEXT NULL,
  telegram_source_key VARCHAR(255) NULL,
  telegram_source_hash CHAR(64) NULL,
  price_from INTEGER NULL,
  created_at VARCHAR(40) NULL,
  updated_at VARCHAR(40) NULL
)`;

export const TELEGRAM_SYNC_LOG_DDL = `CREATE TABLE IF NOT EXISTS telegram_sync_log (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  chat_id VARCHAR(64) NULL,
  message_id VARCHAR(32) NULL,
  media_group_id VARCHAR(64) NULL,
  property_id VARCHAR(191) NULL,
  action VARCHAR(32) NULL,
  note TEXT NULL,
  created_at VARCHAR(40) NULL
)`;

export const TELEGRAM_SEEN_CHATS_DDL = `CREATE TABLE IF NOT EXISTS telegram_seen_chats (
  chat_id VARCHAR(64) NOT NULL PRIMARY KEY,
  title TEXT NULL,
  chat_type VARCHAR(32) NULL,
  last_message_id VARCHAR(32) NULL,
  last_seen_at VARCHAR(40) NULL
)`;

/**
 * One row per incoming update. id is VARCHAR (chat + message), never TEXT —
 * a TEXT primary key is error 1170. raw_body is the update payload and is not indexed.
 * The (chat_id, message_id) unique key is 96 characters, under the 767-byte MySQL 5.7 limit.
 */
export const TELEGRAM_MESSAGES_DDL = `CREATE TABLE IF NOT EXISTS telegram_messages (
  id VARCHAR(96) NOT NULL PRIMARY KEY,
  chat_id VARCHAR(64) NOT NULL,
  message_id VARCHAR(32) NOT NULL,
  message_date VARCHAR(20) NULL,
  media_group_id VARCHAR(64) NULL,
  kind VARCHAR(16) NOT NULL,
  body TEXT NULL,
  file_id VARCHAR(191) NULL,
  file_unique_id VARCHAR(128) NULL,
  raw_body LONGTEXT NULL,
  created_at VARCHAR(40) NULL
)`;

/** Old fragment URLs point here so /properties/<old id> can 301 to the merged offer. */
export const TELEGRAM_REDIRECTS_DDL = `CREATE TABLE IF NOT EXISTS telegram_redirects (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  target_id VARCHAR(191) NOT NULL,
  created_at VARCHAR(40) NULL
)`;

export const TELEGRAM_MESSAGES_INDEX_DDL = 'CREATE UNIQUE INDEX IF NOT EXISTS telegram_messages_chat_message ON telegram_messages (chat_id, message_id)';
export const TELEGRAM_MESSAGES_INDEX_ALTER = 'ALTER TABLE telegram_messages ADD UNIQUE INDEX telegram_messages_chat_message (chat_id, message_id)';

export const TELEGRAM_SOURCE_INDEX_DDL = 'CREATE UNIQUE INDEX IF NOT EXISTS site_properties_tg_key ON site_properties (telegram_source_hash)';
export const TELEGRAM_SOURCE_INDEX_ALTER = 'ALTER TABLE site_properties ADD UNIQUE INDEX site_properties_tg_key (telegram_source_hash)';

/**
 * Creates the published-property table, the sync log, and the chats the bot has
 * seen. Fills any telegram source columns an older process created the table
 * without. Idempotent. Throws the first table-creation error so the admin page
 * can show its code; a failed attempt is not cached by ensureTelegramTables.
 */
async function ensureTelegramSchema(executor: SqlExecutor) {
  let fatal: unknown = null;
  const fail = (error: unknown) => {
    console.error('telegram table was not created', error);
    if (!fatal) fatal = error;
  };
  for (const sql of [SITE_PROPERTIES_DDL, TELEGRAM_SYNC_LOG_DDL, TELEGRAM_SEEN_CHATS_DDL, TELEGRAM_MESSAGES_DDL, TELEGRAM_REDIRECTS_DDL]) {
    try {
      await run(executor, sql);
    } catch (error) {
      fail(error);
    }
  }
  if (!fatal) {
    for (const [column, definition] of PROPERTY_COLUMNS) {
      await ensureColumn(executor, 'site_properties', column, definition);
    }
    try {
      await ensureUniqueIndex(executor, TELEGRAM_SOURCE_INDEX_DDL, TELEGRAM_SOURCE_INDEX_ALTER, 'telegram');
    } catch (error) {
      console.error('telegram source index was not added', error);
    }
    try {
      await ensureUniqueIndex(executor, TELEGRAM_MESSAGES_INDEX_DDL, TELEGRAM_MESSAGES_INDEX_ALTER, 'telegram messages');
    } catch (error) {
      console.error('telegram message index was not added', error);
    }
  }
  telegramSchemaError = fatal;
  if (fatal) throw fatal;
}

/** Creates the telegram tables. A failure is not cached, so the next call tries again. */
export function ensureTelegramTables(executor?: SqlExecutor): Promise<void> {
  if (telegramReady) return telegramReady;
  let pending: Promise<void>;
  pending = (async () => {
    const ex = executor ?? (await defaultExecutor());
    await ensureTelegramSchema(ex);
  })();
  telegramReady = pending;
  return pending.catch(error => {
    if (telegramReady === pending) telegramReady = null;
    throw error;
  });
}

function runnerFromExecutor(executor: SqlExecutor): SqlRunner {
  return {
    async all(sql, values = []) {
      return rowsOf(await run(executor, sql, values));
    },
    async run(sql, values = []) {
      await run(executor, sql, values);
    },
  };
}

/**
 * One pass per process cache. A missing phone column or a locked account is
 * logged and skipped. Phones are rewritten first, then newer sheet-sync
 * duplicates are deleted, then any numbers that are still shared get one
 * phone_duplicate note. A second process run sees stored 05 numbers and
 * existing notes, so it does not write them again.
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
  try {
    await cleanupSheetSyncDuplicates(runnerFromExecutor(executor));
  } catch (error) {
    console.error('sheet duplicate cleanup failed', error);
  }
  await noteSharedLeadPhones(executor);
}

async function noteSharedLeadPhones(executor: SqlExecutor) {
  let rows: Record<string, unknown>[] = [];
  try {
    rows = rowsOf(await run(executor, 'SELECT id, phone FROM leads'));
  } catch (error) {
    console.error('duplicate phone notes were not checked', error);
    return;
  }
  const plan = planLeadPhoneMigration(
    rows
      .map(row => ({id: String(row.id ?? ''), phone: String(row.phone ?? '')}))
      .filter(row => row.id)
  );
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

async function ensureStageNoteIndex(executor: SqlExecutor, createSql: string, alterSql: string) {
  try {
    await run(executor, createSql);
  } catch (error) {
    if (/already exists|duplicate|ER_DUP_KEYNAME/i.test(messageOf(error))) return;
    try {
      await run(executor, alterSql);
    } catch (fallback) {
      if (/already exists|duplicate|ER_DUP_KEYNAME/i.test(messageOf(fallback))) return;
      console.error('lead_stage_notes index was not added', fallback);
    }
  }
}

/**
 * Copies the one `note` string on each stage_changed activity into
 * lead_stage_notes. source_activity_id makes a second pass a no-op.
 * New notes are inserted by the stage route and are not rewritten here.
 */
async function backfillStageNotes(executor: SqlExecutor) {
  const activities = rowsOf(await run(executor, STAGE_CHANGED_NOTES_SQL));
  if (!activities.length) return;
  const copied = new Set(
    rowsOf(await run(executor, STAGE_NOTE_SOURCES_SQL))
      .map(row => String(row.source_activity_id ?? row.sourceActivityId ?? ''))
      .filter(Boolean)
  );
  for (const row of activities) {
    const sourceId = String(row.id ?? '').trim();
    if (!sourceId || copied.has(sourceId)) continue;
    const parsed = parseStageActivityNote(row.details);
    if (!parsed) continue;
    const leadId = String(row.lead_id ?? row.leadId ?? '').trim();
    if (!leadId) continue;
    const userId = String(row.user_id ?? row.userId ?? '').trim();
    try {
      await run(executor, STAGE_NOTE_INSERT_SQL, [
        crypto.randomUUID(),
        leadId.slice(0, 64),
        parsed.stage,
        parsed.text,
        normalizeNoteAt(row.created_at),
        clipName(userId),
        userId === 'system' || !userId ? 'النظام' : '',
        sourceId.slice(0, 36),
      ]);
      copied.add(sourceId);
    } catch (error) {
      if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(messageOf(error))) {
        copied.add(sourceId);
        continue;
      }
      console.error('a stage note was not copied into history', error);
    }
  }
}

async function ensureStageNotes(executor: SqlExecutor) {
  try {
    await run(executor, STAGE_NOTES_DDL);
  } catch (error) {
    console.error('lead_stage_notes table was not created', error);
    return;
  }
  await ensureStageNoteIndex(executor, STAGE_NOTES_LEAD_INDEX, STAGE_NOTES_LEAD_INDEX_ALTER);
  await ensureStageNoteIndex(executor, STAGE_NOTES_SOURCE_INDEX, STAGE_NOTES_SOURCE_INDEX_ALTER);
  try {
    await backfillStageNotes(executor);
  } catch (error) {
    console.error('stage note history was not backfilled', error);
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
  try {
    await ensureStageNotes(executor);
  } catch (error) {
    console.error('stage note history was not prepared', error);
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

/**
 * Keys stay inside the 767-byte utf8mb4 limit (MySQL 5.7 without large prefixes):
 * sheet_key is CHAR(64); (source_id VARCHAR(40), row_key_hash CHAR(64)) is 104
 * characters. The stored row_key itself is not indexed. MySQL has no
 * CREATE INDEX IF NOT EXISTS, so the ALTER form is the fallback.
 */
export const SHEET_SOURCES_DDL = `CREATE TABLE IF NOT EXISTS crm_sheet_sources (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  sheet_id VARCHAR(100) NOT NULL,
  gid VARCHAR(20) NOT NULL DEFAULT '',
  label VARCHAR(40) NOT NULL,
  campaign VARCHAR(60) NOT NULL,
  mapping LONGTEXT NOT NULL,
  headers LONGTEXT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run VARCHAR(40) NULL,
  last_result LONGTEXT NULL,
  last_run_at VARCHAR(40) NULL,
  rows_read INTEGER NULL,
  \`created\` INTEGER NULL,
  existing INTEGER NULL,
  skipped INTEGER NULL,
  error_message LONGTEXT NULL,
  created_at VARCHAR(40) NULL,
  updated_at VARCHAR(40) NULL,
  sheet_key CHAR(64) NULL
)`;

export const SHEET_ROWS_DDL = `CREATE TABLE IF NOT EXISTS crm_sheet_rows (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  source_id VARCHAR(40) NOT NULL,
  row_key VARCHAR(255) NOT NULL,
  row_key_hash CHAR(64) NULL,
  lead_id VARCHAR(40) NULL,
  status VARCHAR(20) NULL,
  created_at VARCHAR(40) NULL
)`;

export const SHEET_LOCK_DDL = `CREATE TABLE IF NOT EXISTS crm_sheet_sync_lock (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  locked_until VARCHAR(40) NOT NULL,
  token VARCHAR(40) NOT NULL
)`;

export const SHEET_CLEANUP_DDL = `CREATE TABLE IF NOT EXISTS crm_sheet_cleanup (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  deleted_count INTEGER NOT NULL DEFAULT 0,
  total_deleted INTEGER NOT NULL DEFAULT 0,
  rows_marked INTEGER NOT NULL DEFAULT 0,
  ran_at VARCHAR(40) NULL
)`;

export const SHEET_ROW_INDEX_DDL = 'CREATE UNIQUE INDEX IF NOT EXISTS crm_sheet_rows_source_key ON crm_sheet_rows (source_id, row_key_hash)';
export const SHEET_ROW_INDEX_ALTER = 'ALTER TABLE crm_sheet_rows ADD UNIQUE INDEX crm_sheet_rows_source_key (source_id, row_key_hash)';
export const SHEET_SOURCE_INDEX_DDL = 'CREATE UNIQUE INDEX IF NOT EXISTS crm_sheet_sources_sheet_key ON crm_sheet_sources (sheet_key)';
export const SHEET_SOURCE_INDEX_ALTER = 'ALTER TABLE crm_sheet_sources ADD UNIQUE INDEX crm_sheet_sources_sheet_key (sheet_key)';

async function ensureUniqueIndex(executor: SqlExecutor, createSql: string, alterSql: string, label = 'sheet') {
  try {
    await run(executor, createSql);
  } catch (error) {
    if (/already exists|duplicate|ER_DUP_KEYNAME/i.test(messageOf(error))) return;
    try {
      await run(executor, alterSql);
    } catch (fallback) {
      if (/already exists|duplicate|ER_DUP_KEYNAME/i.test(messageOf(fallback))) return;
      console.error(`${label} index was not added`, fallback);
      throw fallback;
    }
  }
}

const SHEET_SOURCE_STATS: [string, string][] = [
  ['last_run_at', 'VARCHAR(40) NULL'],
  ['rows_read', 'INTEGER NULL'],
  ['created', 'INTEGER NULL'],
  ['existing', 'INTEGER NULL'],
  ['skipped', 'INTEGER NULL'],
  ['error_message', 'LONGTEXT NULL'],
  ['sheet_key', 'CHAR(64) NULL'],
];

async function ensureSheetSourceStats(executor: SqlExecutor) {
  for (const [column, definition] of SHEET_SOURCE_STATS) {
    await ensureColumn(executor, 'crm_sheet_sources', column, definition);
  }
}

/**
 * Point the seeded source at the «تيك توك» tab.
 * A previous seed with an empty gid, gid 1976004933, or any other gid read the
 * wrong tab. That canonical row is rewritten in place and its old row keys are
 * dropped so the next sync is an initial backfill. Any other source still aimed
 * at the meta tab is disabled. The TikTok tab is inserted even when the sources
 * table already has unrelated rows. A row that already has the correct gid is
 * left untouched, including when an admin has disabled it.
 */
async function alignTiktokSheetSource(executor: SqlExecutor) {
  const seed = tiktokSheetSeed();
  const now = new Date().toISOString();
  const rows = rowsOf(await run(executor, 'SELECT id, sheet_id, gid FROM crm_sheet_sources'));
  const gidOf = (row: Record<string, unknown>) => String(row.gid ?? '').trim();
  const idOf = (row: Record<string, unknown>) => String(row.id ?? '');
  const mine = rows.filter(row => String(row.sheet_id ?? '') === seed.sheetId);
  const canonical = rows.find(row => idOf(row) === seed.id);
  const current = mine.find(row => gidOf(row) === seed.gid);

  const disableMeta = async (exceptId: string) => {
    for (const row of mine) {
      const id = idOf(row);
      if (!id || id === exceptId) continue;
      const gid = gidOf(row);
      if (gid !== '' && gid !== TIKTOK_META_TAB_GID) continue;
      await run(executor, 'UPDATE crm_sheet_sources SET enabled = 0, updated_at = ? WHERE id = ?', [now, id]);
    }
  };

  const retarget = async (targetId: string) => {
    await run(
      executor,
      `UPDATE crm_sheet_sources
       SET sheet_id = ?, gid = ?, label = ?, campaign = ?, mapping = ?, headers = ?, enabled = 1, updated_at = ?, sheet_key = ?
       WHERE id = ?`,
      [
        seed.sheetId,
        seed.gid,
        seed.label,
        seed.campaign,
        JSON.stringify(seed.mapping),
        JSON.stringify(seed.headers),
        now,
        sheetSourceKey(seed.sheetId, seed.gid),
        targetId,
      ]
    );
    await run(executor, 'DELETE FROM crm_sheet_rows WHERE source_id = ?', [targetId]);
    await disableMeta(targetId);
  };

  if (canonical && gidOf(canonical) !== seed.gid) {
    await retarget(seed.id);
    return;
  }
  if (current) {
    await disableMeta(idOf(current));
    return;
  }
  const stale = mine.filter(row => {
    const gid = gidOf(row);
    return gid === '' || gid === TIKTOK_META_TAB_GID;
  });
  if (stale.length) {
    const target = stale.find(row => idOf(row) === seed.id) || stale[0];
    await retarget(idOf(target));
    return;
  }
  await insertTiktokSeed(executor);
}

async function insertTiktokSeed(executor: SqlExecutor) {
  const seed = tiktokSheetSeed();
  const now = new Date().toISOString();
  await insertSheetSeed(executor, seed, now);
}

/**
 * Insert «اسناب يوليو» only when no source already uses this spreadsheet id and gid.
 * Compared in JS so mixed utf8mb4 collations cannot raise error 1267.
 * An admin's label, mapping, or enabled flag on that tab is left untouched.
 */
async function ensureSnapSheetSource(executor: SqlExecutor) {
  const seed = snapSheetSeed();
  const rows = rowsOf(await run(executor, 'SELECT id, sheet_id, gid FROM crm_sheet_sources'));
  const exists = rows.some(
    row => String(row.sheet_id ?? '').trim() === seed.sheetId && String(row.gid ?? '').trim() === seed.gid
  );
  if (exists) return;
  await insertSheetSeed(executor, seed, new Date().toISOString());
}

async function insertSheetSeed(
  executor: SqlExecutor,
  seed: ReturnType<typeof tiktokSheetSeed>,
  now: string
) {
  await run(
    executor,
    `INSERT INTO crm_sheet_sources (
      id, sheet_id, gid, label, campaign, mapping, headers, enabled, created_at, updated_at, sheet_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      sheetSourceKey(seed.sheetId, seed.gid),
    ]
  );
}

async function backfillSheetKeys(executor: SqlExecutor) {
  const rows = rowsOf(await run(executor, 'SELECT id, sheet_id, gid, sheet_key FROM crm_sheet_sources'));
  for (const row of rows) {
    if (String(row.sheet_key ?? '').trim()) continue;
    const id = String(row.id ?? '');
    if (!id) continue;
    await run(executor, 'UPDATE crm_sheet_sources SET sheet_key = ? WHERE id = ?', [
      sheetSourceKey(String(row.sheet_id ?? ''), String(row.gid ?? '')),
      id,
    ]);
  }
}

/**
 * Lead-form sheet sources and the keys of rows already imported.
 * The TikTok tab is seeded when that sheet is missing, even if other sources exist.
 * An older or mismatched gid on the seeded row is retargeted.
 */
async function ensureSheetSyncSchema(executor: SqlExecutor) {
  for (const sql of [SHEET_SOURCES_DDL, SHEET_ROWS_DDL, SHEET_LOCK_DDL, SHEET_CLEANUP_DDL]) {
    try {
      await run(executor, sql);
    } catch (error) {
      console.error('sheet sync table was not created', error);
      throw error;
    }
  }
  await ensureSheetSourceStats(executor);
  await ensureColumn(executor, 'crm_sheet_rows', 'row_key_hash', 'CHAR(64) NULL');
  try {
    await backfillSheetKeys(executor);
  } catch (error) {
    console.error('sheet source keys were not filled', error);
    throw error;
  }
  await ensureUniqueIndex(executor, SHEET_ROW_INDEX_DDL, SHEET_ROW_INDEX_ALTER);
  await ensureUniqueIndex(executor, SHEET_SOURCE_INDEX_DDL, SHEET_SOURCE_INDEX_ALTER);
  try {
    await alignTiktokSheetSource(executor);
  } catch (error) {
    if (!/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(messageOf(error))) {
      console.error('tiktok sheet seed skipped', error);
      throw error;
    }
  }
  try {
    await ensureSnapSheetSource(executor);
  } catch (error) {
    if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(messageOf(error))) return;
    console.error('snap sheet seed skipped', error);
    throw error;
  }
}

/** Creates the sheet tables. A failure is not cached, so the next call tries again. */
export function ensureSheetSchema(executor?: SqlExecutor): Promise<void> {
  if (sheetReady) return sheetReady;
  let pending: Promise<void>;
  pending = (async () => {
    const ex = executor ?? (await defaultExecutor());
    await ensureSheetSyncSchema(ex);
  })();
  sheetReady = pending;
  return pending.catch(error => {
    if (sheetReady === pending) sheetReady = null;
    throw error;
  });
}

/** Inserts the TikTok sheet only when the source table has no rows. */
export async function seedTiktokSheetSourceIfEmpty(executor?: SqlExecutor) {
  const ex = executor ?? (await defaultExecutor());
  await ensureSheetSchema(ex);
  const rows = rowsOf(await run(ex, 'SELECT id FROM crm_sheet_sources LIMIT 1'));
  if (rows.length) return false;
  try {
    await insertTiktokSeed(ex);
    return true;
  } catch (error) {
    if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(messageOf(error))) return false;
    throw error;
  }
}

async function ensureFinanceCommissions(executor: SqlExecutor) {
  await ensureColumn(executor, 'crm_transactions', 'owner_commission', 'VARCHAR(40) NULL');
  await ensureColumn(executor, 'crm_transactions', 'client_commission', 'VARCHAR(40) NULL');
}

async function runEnsure(executor: SqlExecutor): Promise<LeadSchemaState> {
  try {
    await ensureSheetSchema(executor);
  } catch (error) {
    console.error('sheet sync schema check failed', error);
  }
  try {
    await ensureTelegramSchema(executor);
    telegramReady = Promise.resolve();
  } catch (error) {
    telegramSchemaError = error;
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
  try {
    await ensureFinanceCommissions(executor);
  } catch (error) {
    console.error('crm_transactions commission columns were not added', error);
  }
  let featured = false;
  const existing = await hasFeaturedColumn(executor);
  if (existing === null) {
    await repairStages(executor);
  try {
    await ensureColumn(executor, 'leads', 'created_via', 'VARCHAR(40) NULL');
  } catch (error) {
    console.error('leads.created_via was not added', error);
  }
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
    await ensureColumn(executor, 'leads', 'created_via', 'VARCHAR(40) NULL');
  } catch (error) {
    console.error('leads.created_via was not added', error);
  }
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
