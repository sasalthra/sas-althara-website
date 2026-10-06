import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

const require = createRequire(import.meta.url);
const output = mkdtempSync(join(tmpdir(), 'sas-sheets-'));

function sqliteExecutor(db) {
  return {async execute(sql, values = []) {
    const text = String(sql).trim();
    if (text.startsWith('SHOW')) throw Error('near SHOW: syntax error');
    if (text.startsWith('SELECT')) return [db.prepare(text).all(...values)];
    return [{affectedRows: Number(db.prepare(text).run(...values).changes)}];
  }};
}

function leadDb(db) {
  return {prepare(sql) {
    return {bind(...args) {
      return {
        async all() { return {results: db.prepare(sql).all(...args)}; },
        async first() { return db.prepare(sql).get(...args) || null; },
        async run() { db.prepare(sql).run(...args); },
      };
    }};
  }};
}

try {
  await build({
    entryPoints: {
      config: 'lib/sheet-sync-config.ts',
      sync: 'lib/sheet-sync.ts',
      cron: 'lib/cron-auth.ts',
      schema: 'lib/lead-schema.ts',
      dedupe: 'lib/sheet-duplicate-cleanup.ts',
      purge: 'lib/sheet-test-purge.ts',
    },
    outdir: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
    external: ['mysql2/promise'],
  });
  const config = require(join(output, 'config.cjs'));
  const sync = require(join(output, 'sync.cjs'));
  const cron = require(join(output, 'cron.cjs'));
  const schema = require(join(output, 'schema.cjs'));
  const dedupe = require(join(output, 'dedupe.cjs'));
  const purge = require(join(output, 'purge.cjs'));

  const ref = config.parseSheetRef('https://docs.google.com/spreadsheets/d/1_lAoABagOV93EQPi_vNWct4ok3zCWE1plJFfbDzm6Nc/edit?usp=sharing#gid=0');
  assert.equal(ref.sheetId, config.TIKTOK_SHEET_ID);
  assert.equal(ref.gid, '0');
  assert.equal(config.parseSheetRef(config.TIKTOK_SHEET_ID).sheetId, config.TIKTOK_SHEET_ID);
  assert.equal(config.parseSheetRef('https://evil.test/spreadsheets/d/1_lAoABagOV93EQPi_vNWct4ok3zCWE1plJFfbDzm6Nc'), null);
  assert.equal(config.parseSheetRef('not a sheet'), null);

  const parsed = config.parseCsv('name,phone\n"سارة, اختبار","0551000001"\n\n');
  assert.deepEqual(parsed, [['name', 'phone'], ['سارة, اختبار', '0551000001']]);

  const headers = config.TIKTOK_SHEET_HEADERS;
  const mapping = config.suggestSheetMapping(headers);
  assert.equal(headers[mapping.name], 'الاسم');
  assert.equal(headers[mapping.phone], 'رقم الجوال');
  assert.equal(headers[mapping.propertyType], 'الوحدة');
  assert.equal(headers[mapping.budget], 'طريقة الشراء');
  assert.equal(headers[mapping.citizen], 'هل انت مواطن');
  assert.equal(headers[mapping.supported], 'هل انت مدعوم');
  assert.equal(headers[mapping.salary], 'الراتب');
  assert.equal(headers[mapping.age], 'العمر');
  assert.equal(headers[mapping.contactTime], 'وقت التواصل');
  assert.equal(headers[mapping.purchaseTimeline], 'الوقت المتوقع للشراء');
  assert.equal(headers[mapping.leadId], 'TikTok Lead ID');
  assert.equal(headers[mapping.sheetLeadStatus], 'Lead status');
  assert.equal(headers[mapping.sheetAssignment], 'الاسناد');
  assert.equal(headers[mapping.sheetState], 'الحاله');
  assert.equal(headers[mapping.sheetTiktokStatus], 'TikTok Lead Status');
  assert.equal(mapping.city, undefined);
  assert.equal(config.sameHeaders(headers, headers.slice(0, -2)), false);
  assert.equal(config.sameHeaders(headers, headers.map((header, index) => index === 1 ? 'full_name' : header)), false);

  const tiktokRow = [
    'تم التواصل',
    'سارة اختبار',
    'p:+966551110000',
    'شقة تمليك',
    'تمويل',
    'مواطن',
    'نعم',
    '15000',
    '34',
    'مساء',
    'خلال شهر',
    'tt-lead-1',
    'أحمد',
    'جديد',
    'CREATED',
  ];
  const draft = config.composeSheetLead(tiktokRow, {label: 'تيك توك', campaign: ''}, mapping);
  assert.equal(draft.phone, '0551110000');
  assert.equal(draft.stage, 'new');
  assert.equal(draft.source, 'تيك توك');
  assert.equal(draft.propertyOther, 'شقة تمليك');
  assert.match(draft.notes, /الوحدة: شقة تمليك/);
  assert.match(draft.notes, /طريقة الشراء: تمويل/);
  assert.match(draft.notes, /هل انت مواطن: مواطن/);
  assert.match(draft.notes, /هل انت مدعوم: نعم/);
  assert.match(draft.notes, /الراتب: 15000/);
  assert.match(draft.notes, /العمر: 34/);
  assert.match(draft.notes, /وقت التواصل: مساء/);
  assert.match(draft.notes, /الوقت المتوقع للشراء: خلال شهر/);
  assert.match(draft.notes, /Lead status: تم التواصل/);
  assert.match(draft.notes, /الاسناد: أحمد/);
  assert.match(draft.notes, /الحاله: جديد/);
  assert.match(draft.notes, /TikTok Lead Status: CREATED/);
  assert.match(draft.notes, /TikTok Lead ID: tt-lead-1/);
  assert.equal(config.composeSheetLead(tiktokRow, {label: 'تيك توك', campaign: 'حملة خاصة'}, mapping).source, 'تيك توك — حملة خاصة');
  assert.equal(config.sheetExternalId(tiktokRow, mapping), 'tt-lead-1');
  assert.equal(config.sheetNameAndPhoneBlank(['تم التواصل', '', '', '', '', '', '', '', '', '', '', 'tt-empty'], mapping), true);
  const tabs = config.parseSheetTabList('items.push({name: "meta", pageUrl: "https://docs.google.com/x", gid: "1976004933"});items.push({name: "تيك توك", pageUrl: "https://docs.google.com/x", gid: "1331680179"});');
  assert.equal(tabs[0].name, 'meta');
  assert.equal(tabs[1].gid, config.TIKTOK_SHEET_GID);
  assert.equal(tabs[1].name, 'تيك توك');
  assert.equal(config.sheetRowProblem(draft), '');
  assert.equal(config.sheetRowProblem({name: 'س', phone: ''}), 'الاسم ناقص');
  assert.equal(config.parseSnapChoice('{شقة:true}'), 'شقة');
  assert.equal(config.parseSnapChoice('{كاش :true}'), 'كاش');
  assert.equal(config.parseSnapChoice('{6000 - 9000:true}'), '6000 - 9000');
  assert.equal(config.parseSnapChoice('{شقة:true, روف:false}'), 'شقة');
  assert.equal(config.parseSnapChoice('شقة تمليك'), 'شقة تمليك');
  assert.equal(config.isSheetUuid('b41e147f-838d-4eec-bbc0-ce522f601350'), true);
  assert.equal(config.isSheetUuid('+966565959930'), false);
  const uuidName = config.composeSheetLead(
    ['b41e147f-838d-4eec-bbc0-ce522f601350', 'اسناب يوليو 2026 شقق'],
    {label: 'تيك توك', campaign: ''},
    {name: 0, phone: 1}
  );
  assert.equal(uuidName.name, '');
  assert.equal(config.sheetRowProblem(uuidName), 'الاسم ناقص');
  const uuidPhone = config.composeSheetLead(
    ['سارة اختبار', 'b41e147f-838d-4eec-bbc0-ce522f601350'],
    {label: 'تيك توك', campaign: ''},
    {name: 0, phone: 1}
  );
  assert.equal(uuidPhone.name, 'سارة اختبار');
  assert.equal(uuidPhone.phone, '');
  assert.equal(config.sheetRowProblem(uuidPhone), 'الجوال غير صالح');
  assert.equal(sync.planSheetImport(headers, [tiktokRow], mapping).snap, false);
  const snapSuggested = config.suggestSheetMapping(config.SNAP_SHEET_HEADERS);
  assert.equal(snapSuggested.name, 11);
  assert.equal(config.SNAP_SHEET_HEADERS[snapSuggested.name], 'الاسم');
  assert.equal(snapSuggested.phone, 13);
  assert.equal(config.SNAP_SHEET_HEADERS[snapSuggested.phone], 'رقم الجوال');
  assert.equal(snapSuggested.propertyType, 14);
  assert.equal(snapSuggested.city, 15);
  assert.equal(snapSuggested.budget, 16);
  assert.equal(snapSuggested.salary, 17);
  assert.equal(snapSuggested.residency, 18);
  assert.equal(snapSuggested.purchaseTimeline, 19);
  assert.equal(snapSuggested.leadId, 9);
  assert.equal(sync.snapPlatformLabel(), 'سناب');
  assert.equal(config.alignedFormHeaderStart(headers), -1);
  assert.equal(config.alignedFormHeaderStart(config.SNAP_SHEET_HEADERS), 11);

  const key = sync.sheetRowKey(2, ['أ', '0551110000']);
  assert.equal(key, sync.sheetRowKey(2, ['أ', '0551110000']));
  assert.notEqual(key, sync.sheetRowKey(2, ['ب', '0551110000']));
  assert.match(key, /^2:[a-f0-9]{24}$/);
  assert.equal(sync.sheetRowKey(2, ['أ', '0551110000'], 'tt-lead-1'), 'tt:tt-lead-1');
  assert.equal(sync.sheetRowKey(9, ['تغيّر'], 'tt-lead-1'), 'tt:tt-lead-1');
  const expectedHash = createHash('sha256').update(['أ', '0551110000'].join('\u001f')).digest('hex').slice(0, 24);
  assert.equal(key, `2:${expectedHash}`);

  process.env.CRON_SECRET = 'short';
  assert.equal(cron.cronAuthorized({authorization: 'Bearer short'}), false);
  process.env.CRON_SECRET = 'cron-secret-value-with-32-characters-min';
  assert.equal(cron.cronAuthorized({authorization: 'Bearer cron-secret-value-with-32-characters-min'}), true);
  assert.equal(cron.cronAuthorized({authorization: 'Bearer wrong-secret-value-with-32-characters'}), false);
  assert.equal(cron.cronAuthorized({cronSecret: 'cron-secret-value-with-32-characters-min'}), true);
  assert.equal(cron.cronAuthorized({authorization: ''}), false);
  delete process.env.CRON_SECRET;

  const mem = new DatabaseSync(':memory:');
  mem.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY, owner TEXT, created_by TEXT, assigned_to TEXT, field_assigned_to TEXT, name TEXT, phone TEXT, property_id TEXT, property_other TEXT, source TEXT, stage TEXT, notes TEXT, follow_up TEXT, created_at TEXT, updated_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE crm_users(id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, active INTEGER, created_at TEXT, phone TEXT, last_login_at TEXT);`);
  const owner = '11111111-1111-4111-8111-111111111111';
  mem.prepare(`INSERT INTO crm_users (id, name, email, role, active, created_at) VALUES (?, 'إدارة', 'ops@sas.test', 'admin', 1, '2020-01-01')`).run(owner);
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(mem));
  const seeded = mem.prepare('SELECT id, sheet_id, gid, label, campaign, enabled, mapping, headers FROM crm_sheet_sources').all();
  assert.equal(seeded.length, 2);
  const tiktokSeeded = seeded.find(row => row.id === 'tiktok-leads-1');
  assert.ok(tiktokSeeded);
  assert.equal(tiktokSeeded.sheet_id, config.TIKTOK_SHEET_ID);
  assert.equal(tiktokSeeded.label, 'تيك توك');
  assert.equal(tiktokSeeded.campaign, '');
  assert.equal(tiktokSeeded.gid, config.TIKTOK_SHEET_GID);
  assert.equal(Number(tiktokSeeded.enabled), 1);
  const seededMapping = JSON.parse(tiktokSeeded.mapping);
  const seededHeaders = JSON.parse(tiktokSeeded.headers);
  const snapSeeded = seeded.find(row => row.id === config.SNAP_SHEET_SOURCE_ID);
  assert.ok(snapSeeded);
  assert.equal(snapSeeded.sheet_id, config.TIKTOK_SHEET_ID);
  assert.equal(snapSeeded.gid, config.SNAP_SHEET_GID);
  assert.equal(snapSeeded.label, 'اسناب يوليو');
  assert.equal(snapSeeded.campaign, '');
  assert.equal(Number(snapSeeded.enabled), 1);
  const snapSeedMapping = JSON.parse(snapSeeded.mapping);
  assert.equal(snapSeedMapping.name, 11);
  assert.equal(snapSeedMapping.phone, 13);
  assert.equal(JSON.parse(snapSeeded.headers)[11], 'الاسم');
  assert.equal(seededHeaders[seededMapping.phone], 'رقم الجوال');
  assert.equal(seededHeaders[seededMapping.name], 'الاسم');
  assert.equal(seededHeaders[seededMapping.leadId], 'TikTok Lead ID');
  const statColumns = mem.prepare('PRAGMA table_info(crm_sheet_sources)').all().map(row => row.name);
  for (const name of ['last_run_at', 'rows_read', 'created', 'existing', 'skipped', 'error_message', 'sheet_key']) {
    assert.equal(statColumns.includes(name), true, name);
  }
  const sourceDdl = mem.prepare("SELECT sql FROM sqlite_master WHERE name='crm_sheet_sources'").get().sql;
  const rowDdl = mem.prepare("SELECT sql FROM sqlite_master WHERE name='crm_sheet_rows'").get().sql;
  const rowIndex = mem.prepare("SELECT sql FROM sqlite_master WHERE name='crm_sheet_rows_source_key'").get().sql;
  assert.match(sourceDdl, /VARCHAR\(40\)/);
  assert.match(sourceDdl, /LONGTEXT/);
  assert.match(sourceDdl, /sheet_key/);
  assert.doesNotMatch(sourceDdl, /TEXT PRIMARY KEY/i);
  assert.match(rowDdl, /row_key_hash/);
  assert.doesNotMatch(rowDdl, /TEXT PRIMARY KEY/i);
  assert.match(rowIndex, /row_key_hash/);
  assert.doesNotMatch(rowIndex, /row_key\)/);
  assert.match(mem.prepare("SELECT sheet_key FROM crm_sheet_sources WHERE id='tiktok-leads-1'").get().sheet_key, /^[a-f0-9]{64}$/);
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(mem));
  assert.equal(mem.prepare('SELECT COUNT(*) AS n FROM crm_sheet_sources').get().n, 2);
  mem.prepare(`UPDATE crm_sheet_sources SET gid = '', campaign = 'تمويل عقارى 4 نوفمبر', headers = '[]', mapping = '{}' WHERE id = 'tiktok-leads-1'`).run();
  mem.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('old-key', 'tiktok-leads-1', 'meta-row', NULL, 'imported', '2026-01-01')`).run();
  mem.prepare(`INSERT INTO crm_sheet_sources (id, sheet_id, gid, label, campaign, mapping, headers, enabled, created_at, updated_at) VALUES ('meta-extra', ?, ?, 'ميتا', '', '{}', '[]', 1, '2026-01-01', '2026-01-01')`).run(config.TIKTOK_SHEET_ID, config.TIKTOK_META_TAB_GID);
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(mem));
  const moved = mem.prepare('SELECT gid, campaign, enabled, label FROM crm_sheet_sources WHERE id = ?').get('tiktok-leads-1');
  assert.equal(moved.gid, config.TIKTOK_SHEET_GID);
  assert.equal(moved.campaign, '');
  assert.equal(moved.label, 'تيك توك');
  assert.equal(Number(moved.enabled), 1);
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM crm_sheet_rows WHERE source_id = 'tiktok-leads-1'").get().n, 0);
  assert.equal(Number(mem.prepare("SELECT enabled FROM crm_sheet_sources WHERE id = 'meta-extra'").get().enabled), 0);
  mem.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('kept', 'tiktok-leads-1', 'tt:keep', NULL, 'imported', '2026-03-01')`).run();
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(mem));
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM crm_sheet_rows WHERE source_id = 'tiktok-leads-1'").get().n, 1);
  mem.prepare('DELETE FROM crm_sheet_sources').run();
  mem.prepare('DELETE FROM crm_sheet_rows').run();
  mem.prepare(`INSERT INTO crm_sheet_sources (id, sheet_id, gid, label, campaign, mapping, headers, enabled, created_at, updated_at) VALUES ('other-src', 'abcdefghijklmnopqrstuvwxyz12', '9', 'آخر', '', '{}', '[]', 1, '2026-01-01', '2026-01-01')`).run();
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(mem));
  const withOther = mem.prepare('SELECT id, gid, enabled FROM crm_sheet_sources').all();
  const seededAgain = withOther.find(row => row.id === 'tiktok-leads-1');
  assert.ok(seededAgain);
  assert.equal(seededAgain.gid, config.TIKTOK_SHEET_GID);
  assert.equal(Number(seededAgain.enabled), 1);
  assert.equal(Number(withOther.find(row => row.id === 'other-src').enabled), 1);
  const snapWithOther = withOther.find(row => row.id === config.SNAP_SHEET_SOURCE_ID);
  assert.ok(snapWithOther);
  assert.equal(snapWithOther.gid, config.SNAP_SHEET_GID);
  assert.equal(Number(snapWithOther.enabled), 1);
  mem.prepare(`UPDATE crm_sheet_sources SET gid = '42' WHERE id = 'tiktok-leads-1'`).run();
  mem.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('wrong-gid', 'tiktok-leads-1', 'tt:stale', NULL, 'imported', '2026-04-01')`).run();
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(mem));
  assert.equal(mem.prepare("SELECT gid FROM crm_sheet_sources WHERE id = 'tiktok-leads-1'").get().gid, config.TIKTOK_SHEET_GID);
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM crm_sheet_rows WHERE source_id = 'tiktok-leads-1'").get().n, 0);
  mem.prepare(`UPDATE crm_sheet_sources SET enabled = 0, label = 'يدوي سناب' WHERE id = ?`).run(config.SNAP_SHEET_SOURCE_ID);
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(mem));
  const keptSnap = mem.prepare('SELECT id, label, enabled FROM crm_sheet_sources WHERE gid = ?').all(config.SNAP_SHEET_GID);
  assert.equal(keptSnap.length, 1);
  assert.equal(keptSnap[0].id, config.SNAP_SHEET_SOURCE_ID);
  assert.equal(keptSnap[0].label, 'يدوي سناب');
  assert.equal(Number(keptSnap[0].enabled), 0);
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE name='crm_sheet_rows'").get().name, 'crm_sheet_rows');
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE name='crm_sheet_sync_lock'").get().name, 'crm_sheet_sync_lock');
  const portable = [schema.SHEET_SOURCES_DDL, schema.SHEET_ROWS_DDL, schema.SHEET_LOCK_DDL, schema.SHEET_CLEANUP_DDL, schema.SHEET_ROW_INDEX_DDL, schema.SHEET_SOURCE_INDEX_DDL].join('\n');
  assert.doesNotMatch(portable, /TEXT\s+PRIMARY\s+KEY/i);
  assert.doesNotMatch(portable, /\bJSON\b/);
  assert.doesNotMatch(portable, /\bDATETIME\b/i);
  assert.doesNotMatch(portable, /CURRENT_TIMESTAMP/i);
  assert.doesNotMatch(portable, /FOREIGN\s+KEY/i);
  assert.match(schema.SHEET_SOURCES_DDL, /mapping LONGTEXT/);
  assert.match(schema.SHEET_SOURCES_DDL, /sheet_key CHAR\(64\)/);
  assert.match(schema.SHEET_ROWS_DDL, /source_id VARCHAR\(40\)/);
  assert.match(schema.SHEET_ROWS_DDL, /row_key VARCHAR\(255\)/);
  assert.match(schema.SHEET_ROWS_DDL, /row_key_hash CHAR\(64\)/);
  assert.match(schema.SHEET_CLEANUP_DDL, /crm_sheet_cleanup/);
  assert.match(schema.SHEET_CLEANUP_DDL, /total_deleted INTEGER/);
  assert.match(schema.SHEET_ROW_INDEX_DDL, /\(source_id, row_key_hash\)/);
  assert.doesNotMatch(schema.SHEET_ROW_INDEX_DDL, /row_key\)/);
  assert.ok(40 + 64 < 191);
  assert.ok((40 + 64) * 4 < 767);
  schema.resetLeadSchemaCache();
  const mysqlCalls = [];
  let creates = 0;
  const mysqlish = {async execute(sql, values = []) {
    const text = String(sql).trim();
    mysqlCalls.push({sql: text, values});
    if (/TEXT\s+PRIMARY\s+KEY/i.test(text)) {
      const error = new Error("BLOB/TEXT column 'id' used in key specification without a key length");
      error.code = 'ER_BLOB_KEY_WITHOUT_LENGTH';
      error.errno = 1170;
      error.sqlMessage = error.message;
      throw error;
    }
    if (/\bJSON\b/.test(text) || /\bDATETIME\b/i.test(text) || /CURRENT_TIMESTAMP/i.test(text)) {
      throw Object.assign(new Error('unsupported column type'), {code: 'ER_PARSE_ERROR'});
    }
    if (text.startsWith('CREATE TABLE IF NOT EXISTS crm_sheet_sources') && creates++ === 0) {
      const error = new Error("BLOB/TEXT column 'id' used in key specification without a key length");
      error.code = 'ER_BLOB_KEY_WITHOUT_LENGTH';
      error.errno = 1170;
      error.sqlMessage = error.message;
      throw error;
    }
    if (/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS/i.test(text)) {
      throw Object.assign(new Error('You have an error in your SQL syntax'), {code: 'ER_PARSE_ERROR', errno: 1064});
    }
    if (text.startsWith('SHOW')) return [[]];
    if (text.startsWith('SELECT')) return [[]];
    return [{affectedRows: 0}];
  }};
  await assert.rejects(() => schema.ensureSheetSchema(mysqlish), /key specification/);
  await schema.ensureSheetSchema(mysqlish);
  assert.ok(mysqlCalls.some(call => call.sql.startsWith('CREATE TABLE IF NOT EXISTS crm_sheet_sources') && /VARCHAR\(40\)/.test(call.sql)));
  assert.ok(mysqlCalls.some(call => call.sql === schema.SHEET_ROW_INDEX_ALTER));
  assert.ok(mysqlCalls.some(call => call.sql === schema.SHEET_SOURCE_INDEX_ALTER));
  assert.ok(mysqlCalls.some(call => call.sql.startsWith('INSERT INTO crm_sheet_sources') && call.values.includes(config.TIKTOK_SHEET_GID)));
  assert.ok(mysqlCalls.some(call => call.sql.startsWith('INSERT INTO crm_sheet_sources') && call.values.includes(config.SNAP_SHEET_GID)));
  assert.equal(mysqlCalls.some(call => /IFNULL\s*\(\s*gid/i.test(call.sql)), false);
  assert.equal(mysqlCalls.some(call => /ON crm_sheet_rows \(source_id, row_key\)/.test(call.sql)), false);
  schema.resetLeadSchemaCache();
  console.log('PASS sheet DDL is portable and a failed create is retried');

  const source = {
    id: 'sheet-test',
    sheetId: 'abcdefghijklmnopqrstuvwxyz12',
    gid: '',
    label: 'تيك توك',
    campaign: 'حملة الاختبار',
    mapping: config.suggestSheetMapping(['full_name', 'phone_number', 'نوع_العقار_الذى_تبحث_عنه', 'طريقة_الشراء']),
    headers: ['full_name', 'phone_number', 'نوع_العقار_الذى_تبحث_عنه', 'طريقة_الشراء'],
    enabled: true,
  };
  const grid = [
    source.headers,
    ['سارة اختبار', 'p:+966551110000', 'شقة_تمليك', 'تمويل'],
    ['', '', '', ''],
    ['بدون جوال', 'abc', 'فيلا', 'كاش'],
  ];
  const db = leadDb(mem);
  const first = await sync.importSheetGrid(db, source, grid, owner);
  assert.equal(first.inserted, 1);
  assert.equal(first.invalid, 1);
  assert.equal(first.duplicates, 0);
  assert.equal(first.created[0].phone, '0551110000');
  assert.equal(first.created[0].source, 'تيك توك — حملة الاختبار');
  const stored = mem.prepare('SELECT phone, stage, source, assigned_to, property_other, notes FROM leads WHERE id=?').get(first.created[0].id);
  assert.equal(stored.phone, '0551110000');
  assert.equal(stored.stage, 'new');
  assert.equal(stored.source, 'تيك توك — حملة الاختبار');
  assert.equal(stored.assigned_to, '');
  assert.match(stored.property_other, /شقة تمليك/);
  assert.match(stored.notes, /تمويل/);
  const second = await sync.importSheetGrid(db, source, grid, owner);
  assert.equal(second.inserted, 0);
  assert.equal(second.unchanged, 2);
  assert.equal(mem.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1);
  const edited = [source.headers, ['سارة معدّلة', '0551110000', 'شقة_تمليك', 'تمويل'], ['', '', '', ''], ['بدون جوال', 'abc', 'فيلا', 'كاش']];
  const third = await sync.importSheetGrid(db, source, edited, owner);
  assert.equal(third.inserted, 0);
  assert.equal(third.duplicates, 1);
  assert.equal(mem.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1);
  assert.match(mem.prepare("SELECT details FROM lead_activity WHERE action='reregistered'").get().details, /سارة معدّلة/);
  const drifted = await sync.importSheetGrid(db, {...source, headers: ['اسم', 'جوال', 'عقار', 'شراء']}, grid, owner);
  assert.equal(drifted.ok, false);
  assert.match(drifted.error, /عناوين/);
  assert.equal(drifted.inserted, 0);

  const batchHeaders = ['full_name', 'phone_number'];
  const batchSource = {...source, id: 'batch', headers: batchHeaders, mapping: {name: 0, phone: 1}, campaign: 'دفعة'};
  const batchGrid = [batchHeaders];
  for (let i = 1; i <= 6; i++) batchGrid.push([`عميل ${i}`, `055100000${i}`]);
  const batch = await sync.importSheetGrid(db, batchSource, batchGrid, owner);
  assert.equal(batch.inserted, 6);
  assert.equal(batch.created.length, 6);
  const again = await sync.importSheetGrid(db, batchSource, batchGrid, owner);
  assert.equal(again.inserted, 0);
  assert.equal(again.unchanged, 6);

  const idHeaders = ['الاسم', 'رقم الجوال', 'TikTok Lead ID', 'Lead status', 'الاسناد'];
  const idMapping = config.suggestSheetMapping(idHeaders);
  const idSource = {...source, id: 'tiktok-tab', headers: idHeaders, mapping: idMapping, campaign: ''};
  const idGrid = [
    idHeaders,
    ['', '', 'tt-empty', 'CREATED', 'أحمد'],
    ['نورة', '0552220001', 'tt-live', 'تم التواصل', 'أحمد'],
    ['ليلى', 'abc', 'tt-bad', 'جديد', ''],
  ];
  const identified = await sync.importSheetGrid(db, idSource, idGrid, owner);
  assert.equal(identified.inserted, 1);
  assert.equal(identified.invalid, 1);
  assert.equal(identified.created[0].source, 'تيك توك');
  const storedLead = mem.prepare('SELECT stage, assigned_to, source, notes FROM leads WHERE phone = ?').get('0552220001');
  assert.equal(storedLead.stage, 'new');
  assert.equal(storedLead.assigned_to, '');
  assert.equal(storedLead.source, 'تيك توك');
  assert.match(storedLead.notes, /Lead status: تم التواصل/);
  assert.match(storedLead.notes, /الاسناد: أحمد/);
  assert.equal(mem.prepare("SELECT row_key FROM crm_sheet_rows WHERE source_id = 'tiktok-tab' AND status = 'imported'").get().row_key, 'tt:tt-live');
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM crm_sheet_rows WHERE row_key = 'tt:tt-empty'").get().n, 0);
  const editedId = [
    idHeaders,
    ['', '', 'tt-empty', 'CREATED', 'أحمد'],
    ['نورة معدلة', '0552220001', 'tt-live', 'مؤهل', 'مندوب آخر'],
    ['ليلى صالحة', '0552220009', 'tt-bad', 'جديد', ''],
  ];
  const identifiedAgain = await sync.importSheetGrid(db, idSource, editedId, owner);
  assert.equal(identifiedAgain.unchanged, 1);
  assert.equal(identifiedAgain.inserted, 1);
  assert.equal(mem.prepare("SELECT name FROM leads WHERE phone = '0552220001'").get().name, 'نورة');

  const fixtureCsv = readFileSync('scripts/fixtures/tiktok-leads-sample.csv', 'utf8');
  assert.equal(fixtureCsv.includes('سارة اختبار'), true);
  assert.equal(/\+966\s*5\d{8}/.test(fixtureCsv) || fixtureCsv.includes('+966 55 000 0001'), true);
  assert.equal(fixtureCsv.includes('tt-sample'), true);
  const fixtureGrid = config.parseCsv(fixtureCsv);
  assert.deepEqual(fixtureGrid[0], config.TIKTOK_SHEET_HEADERS);
  assert.equal(fixtureGrid.length, 4);
  const messyHeader = fixtureGrid[0].map((header, index) => {
    if (index === 0) return `\uFEFF${header}`;
    if (index === 1) return `${header}\u200B`;
    if (index === 3) return 'الوحده';
    if (index === 13) return 'الحالة';
    return header;
  });
  assert.equal(config.sameHeaders(config.TIKTOK_SHEET_HEADERS, [...messyHeader, 'عمود إضافي']), true);
  const fixtureSource = {
    id: 'fixture-tiktok',
    sheetId: config.TIKTOK_SHEET_ID,
    gid: config.TIKTOK_SHEET_GID,
    label: 'تيك توك',
    campaign: '',
    mapping: config.suggestSheetMapping(config.TIKTOK_SHEET_HEADERS),
    headers: config.TIKTOK_SHEET_HEADERS,
    enabled: true,
  };
  const beforeFixture = mem.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  const fixtureImport = await sync.importSheetGrid(db, fixtureSource, [messyHeader, ...fixtureGrid.slice(1)], owner);
  assert.equal(fixtureImport.inserted, 2);
  assert.equal(fixtureImport.duplicates, 1);
  assert.equal(fixtureImport.error, '');
  assert.equal(fixtureImport.rowsRead, 3);
  assert.equal(mem.prepare('SELECT COUNT(*) AS n FROM leads').get().n, beforeFixture + 2);
  const firstPhone = mem.prepare("SELECT name, phone, stage, assigned_to, source FROM leads WHERE phone = '0550000001'").all();
  assert.equal(firstPhone.length, 1);
  assert.equal(firstPhone[0].name, 'سارة اختبار');
  assert.equal(firstPhone[0].stage, 'new');
  assert.equal(firstPhone[0].assigned_to, '');
  assert.equal(firstPhone[0].source, 'تيك توك');
  const secondPhone = mem.prepare("SELECT phone, stage, assigned_to FROM leads WHERE phone = '0550000002'").get();
  assert.equal(secondPhone.phone, '0550000002');
  assert.equal(secondPhone.stage, 'new');
  assert.equal(secondPhone.assigned_to, '');
  mem.prepare(`INSERT INTO leads (id, owner, created_by, assigned_to, field_assigned_to, name, phone, property_id, property_other, source, stage, notes, follow_up, created_at, updated_at) VALUES ('already-9', ?, ?, 'rep-existing', '', 'عميل سابق', '0550000009', 'other', '', 'سابق', 'contacted', '', '', '2026-01-01', '2026-01-01')`).run(owner, owner);
  const existingGrid = [
    config.TIKTOK_SHEET_HEADERS,
    ['جديد', 'اسم مكرر', '+966 55 000 0009', 'شقة', 'تمويل', 'نعم', 'لا', '10000', '29', 'مساء', 'شهر', 'tt-sample-existing', '', 'جديد', 'CREATED'],
  ];
  const existingImport = await sync.importSheetGrid(db, {...fixtureSource, id: 'fixture-existing'}, existingGrid, owner);
  assert.equal(existingImport.inserted, 0);
  assert.equal(existingImport.duplicates, 1);
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM leads WHERE phone = '0550000009'").get().n, 1);
  mem.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('orphan-key', 'fixture-orphan', 'tt:tt-sample-orphan', NULL, 'imported', '2026-01-01')`).run();
  const orphanGrid = [
    config.TIKTOK_SHEET_HEADERS,
    ['جديد', 'عميل يتيم', '+966 55 000 0008', 'فيلا', 'كاش', 'نعم', 'نعم', '18000', '36', 'صباح', 'شهرين', 'tt-sample-orphan', '', 'جديد', 'CREATED'],
  ];
  const orphanImport = await sync.importSheetGrid(db, {...fixtureSource, id: 'fixture-orphan'}, orphanGrid, owner);
  assert.equal(orphanImport.inserted, 1);
  assert.equal(mem.prepare("SELECT name, assigned_to, stage FROM leads WHERE phone = '0550000008'").get().name, 'عميل يتيم');
  assert.equal(mem.prepare("SELECT lead_id FROM crm_sheet_rows WHERE source_id = 'fixture-orphan' AND row_key = 'tt:tt-sample-orphan'").get().lead_id.length > 10, true);

  const snapCsv = readFileSync('scripts/fixtures/snap-july-leads.csv', 'utf8');
  const snapGrid = config.parseCsv(snapCsv);
  assert.deepEqual(snapGrid[0], config.SNAP_SHEET_HEADERS);
  assert.equal(snapGrid.length, 7);
  const parsedSnap = sync.parseSnapLeads(snapGrid);
  assert.equal(parsedSnap.length, 6);
  const expectedSnap = [
    ['Almaha Albogami', '0565959930', 'شقة', 'وسط جدة', 'تمويل عقاري', '6000 - 9000', 'مواطن', 'خلال شهر', 'فيديو شقق جدة', 'd0ef60c4-a1dd-43b8-aede-ad44d4c4d894', '2026-10-06T14:39:36.031Z'],
    ['Aziz الشهري', '0532272206', 'فيلا', 'شمال جدة', 'تمويل عقاري', '9000 - 12000', 'مواطن', 'مجرد استفسار', 'صورة فيلا الياقوت', '992914a6-7fdf-4041-a088-5800485548e3', '2026-10-06T14:47:38.923Z'],
    ['بندر محمد', '0566620355', 'فيلا', 'شمال جدة', 'كاش', '9000 - 12000', 'مواطن', 'خلال شهرين', 'صورة فيلا الياقوت', 'abfe9bd3-9115-4ad0-a7be-0c830737c553', '2026-10-06T16:03:46.459Z'],
    ['مشعل الزهراني', '0503422291', 'فيلا', 'جنوب جدة', 'تمويل عقاري', '9000 - 12000', 'مواطن', 'مجرد استفسار', 'صورة فيلا الياقوت', 'c1573253-f8ba-428c-adbf-1bcff707d12f', '2026-10-06T16:25:10.789Z'],
    ['Amjad Fallatah', '0543492126', 'فيلا', 'شمال جدة', 'تمويل عقاري', '12000 - أعلى', 'مواطن', 'خلال شهرين', 'صورة فيلا الياقوت', 'c0b2b53b-3dc7-4922-92b1-f3a3cbe62aa9', '2026-10-06T16:40:34.327Z'],
    ['صابر الحارثي', '0565653001', 'شقة', 'شمال جدة', 'تمويل عقاري', '9000 - 12000', 'مواطن', 'خلال شهر', 'صورة حي السلامة', '34f2f051-6f65-4e71-b994-2219fac849bf', '2026-10-06T19:00:46.611Z'],
  ];
  parsedSnap.forEach((lead, index) => {
    const expected = expectedSnap[index];
    assert.equal(lead.name, expected[0], lead.name);
    assert.equal(lead.phone, expected[1]);
    assert.equal(lead.propertyType, expected[2]);
    assert.equal(lead.location, expected[3]);
    assert.equal(lead.purchaseMethod, expected[4]);
    assert.equal(lead.salary, expected[5]);
    assert.equal(lead.residency, expected[6]);
    assert.equal(lead.timeline, expected[7]);
    assert.equal(lead.adName, expected[8]);
    assert.equal(lead.leadId, expected[9]);
    assert.equal(lead.registeredAt, expected[10]);
    assert.equal(lead.riyadhDay, '2026-10-06');
    assert.equal(lead.source, 'سناب');
    assert.equal(lead.campaign, 'شقق جدة - ليدز - أكتوبر 2026');
    assert.equal(lead.adSet, 'جدة 27-55 عقار');
    assert.equal(lead.formName, 'اسناب يوليو 2026 شقق');
    assert.equal(lead.extra, 'More Volume');
    assert.equal(lead.name.includes('-'), false);
    assert.equal(/^[0-9a-f-]{36}$/i.test(lead.phone), false);
  });
  const snapSource = {
    id: 'snap-july',
    sheetId: config.TIKTOK_SHEET_ID,
    gid: config.SNAP_SHEET_GID,
    label: 'اسناب يوليو',
    campaign: 'يجب ألا يلتصق بالمصدر',
    mapping: {name: 0, phone: 1, propertyType: 2, budget: 4},
    headers: config.SNAP_SHEET_HEADERS,
    enabled: true,
  };
  const snapImport = await sync.importSheetGrid(db, snapSource, snapGrid, owner);
  assert.equal(snapImport.ok, true, snapImport.error);
  assert.equal(snapImport.inserted, 6);
  assert.equal(snapImport.duplicates, 0);
  assert.equal(snapImport.invalid, 0);
  const snapStored = mem.prepare("SELECT name, phone, source, stage, assigned_to, property_other, notes, created_at, created_via FROM leads WHERE phone = '0565959930'").get();
  assert.equal(snapStored.name, 'Almaha Albogami');
  assert.equal(snapStored.source, 'سناب');
  assert.equal(snapStored.stage, 'new');
  assert.equal(snapStored.assigned_to, '');
  assert.equal(snapStored.property_other, 'شقة');
  assert.equal(snapStored.created_at, '2026-10-06T14:39:36.031Z');
  assert.equal(snapStored.created_via, 'google_sheet');
  assert.match(snapStored.notes, /نوع العقار: شقة/);
  assert.match(snapStored.notes, /موقع العقار: وسط جدة/);
  assert.match(snapStored.notes, /طريقة الشراء: تمويل عقاري/);
  assert.match(snapStored.notes, /الراتب: 6000 - 9000/);
  assert.match(snapStored.notes, /مواطن ام مقيم: مواطن/);
  assert.match(snapStored.notes, /الفترة المتوقعه للشراء: خلال شهر/);
  assert.match(snapStored.notes, /الحملة: شقق جدة - ليدز - أكتوبر 2026/);
  assert.match(snapStored.notes, /الإعلان: فيديو شقق جدة/);
  assert.match(snapStored.notes, /المجموعة الإعلانية: جدة 27-55 عقار/);
  assert.match(snapStored.notes, /معرف سناب: d0ef60c4-a1dd-43b8-aede-ad44d4c4d894/);
  assert.match(snapStored.notes, /النموذج: اسناب يوليو 2026 شقق/);
  assert.match(snapStored.notes, /حقل إضافي: More Volume/);
  assert.equal(snapStored.notes.includes('TikTok'), false);
  assert.equal(snapStored.notes.includes('{'), false);
  assert.equal(mem.prepare("SELECT row_key, status FROM crm_sheet_rows WHERE source_id = 'snap-july' AND lead_id = (SELECT id FROM leads WHERE phone = '0565959930')").get().row_key, 'tt:d0ef60c4-a1dd-43b8-aede-ad44d4c4d894');
  assert.equal(mem.prepare("SELECT phone, property_other FROM leads WHERE phone = '0566620355'").get().property_other, 'فيلا');
  assert.match(mem.prepare("SELECT notes FROM leads WHERE phone = '0566620355'").get().notes, /طريقة الشراء: كاش/);
  assert.equal(mem.prepare("SELECT name, phone FROM leads WHERE phone = '0565653001'").get().name, 'صابر الحارثي');
  const snapAgain = await sync.importSheetGrid(db, snapSource, snapGrid, owner);
  assert.equal(snapAgain.inserted, 0);
  assert.equal(snapAgain.unchanged, 6);
  assert.equal(snapAgain.duplicates, 0);
  const repeatPhone = snapGrid[1].slice();
  repeatPhone[9] = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  repeatPhone[11] = 'اسم';
  repeatPhone[12] = 'مكرر';
  const repeatImport = await sync.importSheetGrid(db, snapSource, [snapGrid[0], repeatPhone], owner);
  assert.equal(repeatImport.inserted, 0);
  assert.equal(repeatImport.duplicates, 1);
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM leads WHERE phone = '0565959930'").get().n, 1);
  assert.equal(mem.prepare("SELECT name FROM leads WHERE phone = '0565959930'").get().name, 'Almaha Albogami');
  const roofRow = snapGrid[2].slice();
  roofRow[9] = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
  roofRow[11] = 'ريف';
  roofRow[12] = 'مقيم';
  roofRow[13] = '+966500000111';
  roofRow[14] = '{روف:true}';
  roofRow[18] = '{مقيم:true}';
  const roofImport = await sync.importSheetGrid(db, snapSource, [snapGrid[0], roofRow], owner);
  assert.equal(roofImport.inserted, 1);
  const roofLead = mem.prepare("SELECT name, property_other, notes, source, assigned_to, stage FROM leads WHERE phone = '0500000111'").get();
  assert.equal(roofLead.name, 'ريف مقيم');
  assert.equal(roofLead.property_other, 'روف');
  assert.equal(roofLead.source, 'سناب');
  assert.equal(roofLead.assigned_to, '');
  assert.equal(roofLead.stage, 'new');
  assert.match(roofLead.notes, /مواطن ام مقيم: مقيم/);
  const driftedSnap = await sync.importSheetGrid(db, {...snapSource, id: 'snap-drift', headers: ['اسم مختلف', 'جوال']}, snapGrid, owner);
  assert.equal(driftedSnap.ok, false);
  assert.match(driftedSnap.error, /عناوين/);
  assert.equal(driftedSnap.inserted, 0);
  const boom = {prepare(sql) {
    const inner = db.prepare(sql);
    return {bind(...args) {
      return {
        async all() { return inner.bind(...args).all(); },
        async first() { return inner.bind(...args).first(); },
        async run() {
          if (/^INSERT INTO leads\b/i.test(String(sql).trim())) throw Error("Unknown column 'source' in 'field list'");
          return inner.bind(...args).run();
        },
      };
    }};
  }};
  const boomGrid = [
    config.TIKTOK_SHEET_HEADERS,
    ['جديد', 'لن يُحفظ', '+966 55 000 0007', 'شقة', 'كاش', 'نعم', 'لا', '9000', '28', 'مساء', 'شهر', 'tt-sample-boom', '', 'جديد', 'CREATED'],
  ];
  const boomImport = await sync.importSheetGrid(boom, {...fixtureSource, id: 'fixture-boom'}, boomGrid, owner);
  assert.equal(boomImport.ok, false);
  assert.equal(boomImport.inserted, 0);
  assert.match(boomImport.error, /Unknown column 'source'/);
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM leads WHERE phone = '0550000007'").get().n, 0);
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM crm_sheet_rows WHERE source_id = 'fixture-boom' AND status = 'imported'").get().n, 0);
  const batchDupHeaders = ['full_name', 'phone_number'];
  const batchDup = await sync.importSheetGrid(db, {...source, id: 'batch-dup', headers: batchDupHeaders, mapping: {name: 0, phone: 1}}, [
    batchDupHeaders,
    ['أول', '+966 55 111 0081'],
    ['ثاني', '0551110081'],
  ], owner);
  assert.equal(batchDup.inserted, 1);
  assert.equal(batchDup.duplicates, 1);
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM leads WHERE phone = '0551110081'").get().n, 1);
  assert.equal(mem.prepare("SELECT name FROM leads WHERE phone = '0551110081'").get().name, 'أول');
  assert.equal(mem.prepare("SELECT created_via FROM leads WHERE phone = '0551110081'").get().created_via, 'google_sheet');
  mem.prepare(`INSERT INTO leads (id, owner, created_by, assigned_to, field_assigned_to, name, phone, property_id, property_other, source, stage, notes, follow_up, created_at, updated_at) VALUES ('weird-9660', ?, ?, 'rep-existing', '', 'عميل سابق', '9660551110091', 'other', '', 'موقع', 'contacted', '', '', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`).run(owner, owner);
  mem.prepare(`INSERT INTO leads (id, owner, created_by, assigned_to, field_assigned_to, name, phone, property_id, property_other, source, stage, notes, follow_up, created_at, updated_at) VALUES ('weird-ar', ?, ?, '', '', 'عميل عربي', '٠٥٥١١١٠٠٩٢', 'other', '', 'تيك توك', 'new', '', '', '2020-02-01T00:00:00.000Z', '2020-02-01T00:00:00.000Z')`).run(owner, owner);
  const weird = await sync.importSheetGrid(db, {...source, id: 'weird-phones', headers: batchDupHeaders, mapping: {name: 0, phone: 1}}, [
    batchDupHeaders,
    ['لن يُضاف', '0551110091'],
    ['لن يُضاف أيضاً', '0551110092'],
  ], owner);
  assert.equal(weird.inserted, 0);
  assert.equal(weird.duplicates, 2);
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM leads WHERE id IN ('weird-9660', 'weird-ar')").get().n, 2);
  assert.equal(mem.prepare("SELECT name, phone, assigned_to, stage FROM leads WHERE id = 'weird-9660'").get().name, 'عميل سابق');
  assert.equal(mem.prepare("SELECT phone FROM leads WHERE id = 'weird-9660'").get().phone, '0551110091');
  assert.equal(mem.prepare("SELECT assigned_to, stage FROM leads WHERE id = 'weird-9660'").get().assigned_to, 'rep-existing');
  assert.equal(mem.prepare("SELECT name, source FROM leads WHERE id = 'weird-ar'").get().name, 'عميل عربي');
  assert.equal(mem.prepare("SELECT source FROM leads WHERE id = 'weird-ar'").get().source, 'تيك توك');
  assert.equal(mem.prepare("SELECT COUNT(*) AS n FROM leads WHERE phone = '0551110092' OR phone = '٠٥٥١١١٠٠٩٢'").get().n, 1);
  mem.close();

  assert.match(readFileSync('instrumentation.ts', 'utf8'), /phase-production-build/);
  assert.match(readFileSync('instrumentation.ts', 'utf8'), /startSheetSyncInterval/);
  assert.match(readFileSync('instrumentation.ts', 'utf8'), /NEXT_RUNTIME !== 'nodejs'/);
  assert.match(readFileSync('lib/crm-db.ts', 'utf8'), /startSheetSyncInterval/);
  assert.match(readFileSync('lib/sheet-fetch.server.ts', 'utf8'), /User-Agent/);
  assert.match(readFileSync('lib/sheet-fetch.server.ts', 'utf8'), /redirect: 'follow'/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /last_run_at/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /error_message/);
  assert.doesNotMatch(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /if \(inflight\) return Promise\.resolve/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /صحة المزامنة/);
  assert.match(readFileSync('app/crm/workspace.tsx', 'utf8'), /جدد غير مسندين/);
  assert.match(readFileSync('app/globals.css', 'utf8'), /new-lead-badge/);
  assert.match(readFileSync('app/globals.css', 'utf8'), /prefers-reduced-motion/);
  assert.match(readFileSync('components/new-lead-badge.tsx', 'utf8'), /NEW/);
  assert.match(readFileSync('app/api/cron/sheets-sync/route.ts', 'utf8'), /assertCron/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /مزامنة الآن/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /180_000|sheetsSyncIntervalMs/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /notifySheetBackfillSummaries/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /sourceAlreadySynced/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /أول مزامنة/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /TIKTOK_SHEET_GID/);
  assert.match(readFileSync('app/api/integrations/sheet-sources/preview/route.ts', 'utf8'), /listSheetTabs/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /تنظيف المكررات من المزامنة/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /معاينة حذف عملاء التجربة/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /تأكيد الحذف/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /تم حذف \$\{Number\(data\.deleted \?\? 0\)\} عميل/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /#3F1A44/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /data-sheet-test-purge/);
  assert.match(readFileSync('app/api/integrations/sheet-sources/purge-tests/route.ts', 'utf8'), /actor\(req, \['admin'\]\)/);
  assert.match(readFileSync('app/api/integrations/sheet-sources/purge-tests/route.ts', 'utf8'), /crmTransaction/);
  assert.match(readFileSync('app/api/integrations/sheet-sources/purge-tests/route.ts', 'utf8'), /acquireSheetSyncLock/);
  assert.match(readFileSync('app/api/integrations/sheet-sources/purge-tests/route.ts', 'utf8'), /تم حذف \$\{result\.deleted\} عميل/);
  assert.match(readFileSync('app/api/integrations/sheet-sources/purge-tests/route.ts', 'utf8'), /if \(!input\.confirm\)/);
  assert.doesNotMatch(readFileSync('app/api/integrations/sheet-sources/purge-tests/route.ts', 'utf8'), /sendMail|assignment-notify/);
  assert.doesNotMatch(readFileSync('lib/sheet-test-purge.ts', 'utf8'), /sendMail|assignment-notify/);
  assert.doesNotMatch(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /sheet-test-purge|purgeSheetTest|executeSheetTestLeadPurge/);
  assert.doesNotMatch(readFileSync('lib/lead-schema.ts', 'utf8'), /sheet-test-purge|purgeSheetTest|executeSheetTestLeadPurge/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /تم حذف \{status\.duplicateCleanup\.totalDeleted\} عميل مكرر من المزامنة/);
  assert.match(readFileSync('app/api/integrations/sheet-sources/cleanup/route.ts', 'utf8'), /cleanupSheetSyncDuplicates/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /enqueueSheetTurn/);
  assert.match(readFileSync('lib/sheet-duplicate-cleanup.ts', 'utf8'), /SHEET_SYNC_CREATED_VIA/);
  assert.doesNotMatch(readFileSync('lib/sheet-duplicate-cleanup.ts', 'utf8'), /sendMail|assignment-notify/);
  assert.equal(dedupe.SHEET_SYNC_CREATED_VIA, 'google_sheet');
  const plan = dedupe.planSheetSyncDuplicateCleanup([
    {id: 'old-manual', phone: '+966 55 111 1001', createdAt: '2020-01-01T00:00:00.000Z', syncCreated: false},
    {id: 'new-sync', phone: '0551111001', createdAt: '2026-06-01T00:00:00.000Z', syncCreated: true},
    {id: 'keep-sync', phone: '9660552222002', createdAt: '2024-01-01T00:00:00.000Z', syncCreated: true},
    {id: 'drop-sync', phone: '٠٥٥٢٢٢٢٠٠٢', createdAt: '2026-07-01T00:00:00.000Z', syncCreated: true},
    {id: 'tiktok-only', phone: '0553333003', createdAt: '2026-08-01T00:00:00.000Z', syncCreated: false},
    {id: 'older-c', phone: '0553333003', createdAt: '2019-01-01T00:00:00.000Z', syncCreated: false},
    {id: 'sync-b', phone: '0555555005', createdAt: '2025-01-01T00:00:00.000Z', syncCreated: true},
    {id: 'sync-a', phone: '0555555005', createdAt: '2025-01-01T00:00:00.000Z', syncCreated: true},
    {id: 'blank', phone: '', createdAt: '2020-01-01T00:00:00.000Z', syncCreated: true},
    {id: 'blank-2', phone: 'abc', createdAt: '2026-01-01T00:00:00.000Z', syncCreated: true},
  ]);
  assert.deepEqual(plan.map(item => item.deleteId).sort(), ['drop-sync', 'new-sync', 'sync-b']);
  assert.equal(plan.find(item => item.deleteId === 'new-sync').survivorId, 'old-manual');
  assert.equal(plan.find(item => item.deleteId === 'drop-sync').survivorId, 'keep-sync');
  assert.equal(plan.find(item => item.deleteId === 'sync-b').survivorId, 'sync-a');
  assert.equal(dedupe.isSheetSyncCreatedLead({createdVia: 'google_sheet'}), true);
  assert.equal(dedupe.isSheetSyncCreatedLead({importedBySheet: true}), true);
  assert.equal(dedupe.isSheetSyncCreatedLead({createdActivities: [JSON.stringify({via: 'google_sheet'})]}), true);
  assert.equal(dedupe.isSheetSyncCreatedLead({createdVia: '', importedBySheet: false, createdActivities: []}), false);
  assert.equal(dedupe.activityViaSheet({via: 'google_sheet'}), true);
  assert.equal(dedupe.activityViaSheet('{"note":"تيك توك"}'), false);

  const cleanDb = new DatabaseSync(':memory:');
  cleanDb.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY, name TEXT, phone TEXT, source TEXT, stage TEXT, assigned_to TEXT, created_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0, created_via TEXT);
    CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE crm_transactions(id TEXT PRIMARY KEY, lead_id TEXT, data TEXT);
    CREATE TABLE crm_import_rows(id TEXT PRIMARY KEY, lead_id TEXT, source TEXT, raw_data TEXT, created_at TEXT);
    CREATE TABLE crm_sheet_rows(id TEXT PRIMARY KEY, source_id TEXT, row_key TEXT, row_key_hash TEXT, lead_id TEXT, status TEXT, created_at TEXT);`);
  const putLead = (id, name, phone, source, stage, assigned, created, via) => {
    cleanDb.prepare('INSERT INTO leads (id, name, phone, source, stage, assigned_to, created_at, created_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, name, phone, source, stage, assigned, created, via);
  };
  putLead('keep-manual', 'الأصل', '+966 55 111 1001', 'موقع', 'contacted', 'rep-1', '2020-01-01T00:00:00.000Z', null);
  putLead('drop-sync', 'المكرر', '0551111001', 'تيك توك', 'contacted', 'rep-2', '2026-06-01T00:00:00.000Z', null);
  putLead('keep-sync', 'الأقدم مزامنة', '9660552222002', 'تيك توك', 'new', '', '2024-01-01T00:00:00.000Z', 'google_sheet');
  putLead('drop-sync-2', 'الأحدث مزامنة', '٠٥٥٢٢٢٢٠٠٢', 'تيك توك', 'new', '', '2026-07-01T00:00:00.000Z', null);
  putLead('keep-tiktok', 'تيك توك يدوي', '0553333003', 'تيك توك', 'new', '', '2026-08-01T00:00:00.000Z', null);
  putLead('keep-older', 'أقدم يدوي', '0553333003', 'موقع', 'won', 'rep-3', '2019-01-01T00:00:00.000Z', null);
  putLead('manual-d1', 'يدوي ١', '0554444004', 'موقع', 'new', '', '2020-03-01T00:00:00.000Z', null);
  putLead('manual-d2', 'يدوي ٢', '0554444004', 'موقع', 'new', '', '2021-03-01T00:00:00.000Z', null);
  putLead('sync-a', 'أ', '0555555005', 'تيك توك', 'new', '', '2025-01-01T00:00:00.000Z', 'google_sheet');
  putLead('sync-b', 'ب', '0555555005', 'تيك توك', 'new', '', '2025-01-01T00:00:00.000Z', 'google_sheet');
  cleanDb.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-drop', 'drop-sync', 'system', 'created', ?)`).run(JSON.stringify({via: 'google_sheet', source: 'تيك توك'}));
  cleanDb.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-drop2', 'drop-sync-2', 'system', 'created', ?)`).run(JSON.stringify({via: 'google_sheet'}));
  cleanDb.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-keep', 'keep-manual', 'system', 'created', ?)`).run(JSON.stringify({source: 'موقع'}));
  cleanDb.prepare(`INSERT INTO crm_transactions (id, lead_id, data) VALUES ('tx-drop', 'drop-sync', '{}')`).run();
  cleanDb.prepare(`INSERT INTO crm_transactions (id, lead_id, data) VALUES ('tx-keep', 'keep-manual', '{}')`).run();
  cleanDb.prepare(`INSERT INTO crm_import_rows (id, lead_id, source, raw_data, created_at) VALUES ('imp-drop', 'drop-sync', 'excel', '{}', '2026-06-01')`).run();
  cleanDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-drop', 'cleanup-src', 'tt:drop', 'drop-sync', 'imported', '2026-06-01')`).run();
  cleanDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-keep-link', 'cleanup-src', 'tt:keep', 'keep-manual', 'duplicate', '2026-06-02')`).run();
  cleanDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-drop2', 'cleanup-src', 'tt:drop2', 'drop-sync-2', 'imported', '2026-07-01')`).run();
  cleanDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-sync-a', 'cleanup-src', 'tt:a', 'sync-a', 'imported', '2025-01-01')`).run();
  cleanDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-sync-b', 'cleanup-src', 'tt:b', 'sync-b', 'imported', '2025-01-01')`).run();
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(cleanDb));
  assert.deepEqual(cleanDb.prepare('SELECT id FROM leads ORDER BY id').all().map(row => row.id), ['keep-manual', 'keep-older', 'keep-sync', 'keep-tiktok', 'manual-d1', 'manual-d2', 'sync-a']);
  const keptManual = cleanDb.prepare("SELECT name, stage, assigned_to, source FROM leads WHERE id = 'keep-manual'").get();
  assert.equal(keptManual.name, 'الأصل');
  assert.equal(keptManual.stage, 'contacted');
  assert.equal(keptManual.assigned_to, 'rep-1');
  assert.equal(keptManual.source, 'موقع');
  assert.equal(cleanDb.prepare("SELECT id FROM leads WHERE id = 'drop-sync'").get(), undefined);
  assert.equal(cleanDb.prepare("SELECT id FROM leads WHERE id = 'drop-sync-2'").get(), undefined);
  assert.equal(cleanDb.prepare("SELECT id FROM leads WHERE id = 'sync-b'").get(), undefined);
  assert.equal(cleanDb.prepare("SELECT source FROM leads WHERE id = 'keep-tiktok'").get().source, 'تيك توك');
  assert.equal(cleanDb.prepare("SELECT id FROM crm_transactions WHERE lead_id = 'drop-sync'").get(), undefined);
  assert.equal(cleanDb.prepare("SELECT id FROM crm_transactions WHERE id = 'tx-keep'").get().id, 'tx-keep');
  assert.equal(cleanDb.prepare("SELECT id FROM crm_import_rows WHERE lead_id = 'drop-sync'").get(), undefined);
  assert.equal(cleanDb.prepare("SELECT COUNT(*) AS n FROM lead_activity WHERE lead_id = 'drop-sync'").get().n, 0);
  const droppedRow = cleanDb.prepare("SELECT status, lead_id FROM crm_sheet_rows WHERE id = 'row-drop'").get();
  assert.equal(droppedRow.status, 'duplicate');
  assert.equal(droppedRow.lead_id, 'keep-manual');
  assert.equal(cleanDb.prepare("SELECT status, lead_id FROM crm_sheet_rows WHERE id = 'row-keep-link'").get().lead_id, 'keep-manual');
  assert.equal(cleanDb.prepare("SELECT lead_id FROM crm_sheet_rows WHERE id = 'row-drop2'").get().lead_id, 'keep-sync');
  assert.equal(cleanDb.prepare("SELECT status, lead_id FROM crm_sheet_rows WHERE id = 'row-sync-b'").get().lead_id, 'sync-a');
  assert.equal(cleanDb.prepare("SELECT action FROM lead_activity WHERE lead_id = 'keep-manual' AND action = 'sheet_duplicate_removed'").get().action, 'sheet_duplicate_removed');
  assert.equal(Number(cleanDb.prepare("SELECT total_deleted FROM crm_sheet_cleanup WHERE id = 'latest'").get().total_deleted), 3);
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(cleanDb));
  assert.equal(cleanDb.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 7);
  const secondCleanup = cleanDb.prepare("SELECT deleted_count, total_deleted FROM crm_sheet_cleanup WHERE id = 'latest'").get();
  assert.equal(Number(secondCleanup.deleted_count), 0);
  assert.equal(Number(secondCleanup.total_deleted), 3);
  cleanDb.close();

  function sqlRunner(db) {
    return {
      async all(sql, values = []) { return db.prepare(sql).all(...values); },
      async run(sql, values = []) { db.prepare(sql).run(...values); },
    };
  }
  const lockDb = new DatabaseSync(':memory:');
  lockDb.exec(`CREATE TABLE crm_sheet_sync_lock(id TEXT PRIMARY KEY, locked_until TEXT NOT NULL, token TEXT NOT NULL);
    CREATE TABLE leads(id TEXT PRIMARY KEY, phone TEXT, created_at TEXT, created_via TEXT);
    CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT);
    CREATE TABLE crm_sheet_rows(id TEXT PRIMARY KEY, lead_id TEXT, status TEXT);
    CREATE TABLE crm_sheet_cleanup(id TEXT PRIMARY KEY, deleted_count INTEGER, total_deleted INTEGER, rows_marked INTEGER, ran_at TEXT);`);
  lockDb.prepare(`INSERT INTO leads (id, phone, created_at, created_via) VALUES ('old', '0551000001', '2020-01-01T00:00:00.000Z', NULL)`).run();
  lockDb.prepare(`INSERT INTO leads (id, phone, created_at, created_via) VALUES ('new', '0551000001', '2026-01-01T00:00:00.000Z', 'google_sheet')`).run();
  const held = await dedupe.acquireSheetSyncLock(sqlRunner(lockDb));
  assert.ok(held);
  const skippedCleanup = await dedupe.cleanupSheetSyncDuplicates(sqlRunner(lockDb));
  assert.equal(skippedCleanup.skipped, true);
  assert.equal(skippedCleanup.deleted, 0);
  assert.equal(lockDb.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 2);
  assert.equal(await dedupe.acquireSheetSyncLock(sqlRunner(lockDb)), '');
  await dedupe.releaseSheetSyncLock(sqlRunner(lockDb), held);
  const ranCleanup = await dedupe.cleanupSheetSyncDuplicates(sqlRunner(lockDb));
  assert.equal(ranCleanup.deleted, 1);
  assert.deepEqual(ranCleanup.deletedIds, ['new']);
  assert.equal(lockDb.prepare('SELECT id FROM leads').get().id, 'old');
  const againCleanup = await dedupe.cleanupSheetSyncDuplicates(sqlRunner(lockDb));
  assert.equal(againCleanup.deleted, 0);
  assert.equal(againCleanup.totalDeleted, 1);
  let turnOrder = '';
  await Promise.all([
    dedupe.enqueueSheetTurn(async () => {
      turnOrder += 'a';
      await new Promise(resolve => setTimeout(resolve, 20));
      turnOrder += 'b';
    }),
    dedupe.enqueueSheetTurn(async () => { turnOrder += 'c'; }),
  ]);
  assert.equal(turnOrder, 'abc');
  lockDb.close();

  assert.deepEqual(purge.DEFAULT_SHEET_TEST_KEEP_PHONES, ['0544823616', '0532406763', '0503704328']);
  assert.deepEqual(
    purge.normalizeSheetTestKeepPhones(['+966 54 482 3616', '+966 53 240 6763', '+966 50 370 4328']),
    ['0544823616', '0532406763', '0503704328']
  );
  assert.equal(purge.SHEET_ROW_PURGED, 'purged');
  const absent = purge.planSheetTestLeadPurge([
    {id: 'only-test', name: 'تجربة', phone: '0551111111', createdAt: '2020-01-01T00:00:00.000Z', syncCreated: true},
  ], purge.DEFAULT_SHEET_TEST_KEEP_PHONES);
  assert.equal(absent.aborted, true);
  assert.equal(absent.delete.length, 0);
  const customCutoff = purge.planSheetTestLeadPurge([
    {id: 'real', name: 'حقيقي', phone: '0559990001', createdAt: '2026-10-01T00:00:00.000Z', syncCreated: true},
    {id: 'default-real', name: 'افتراضي', phone: '0544823616', createdAt: '2026-01-01T00:00:00.000Z', syncCreated: true},
  ], ['0559990001']);
  assert.equal(customCutoff.aborted, false);
  assert.deepEqual(customCutoff.delete.map(lead => lead.id), ['default-real']);
  assert.equal(customCutoff.kept[0].id, 'real');

  const purgeDb = new DatabaseSync(':memory:');
  purgeDb.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY, name TEXT, phone TEXT, source TEXT, stage TEXT, assigned_to TEXT, created_at TEXT, created_via TEXT, owner TEXT, created_by TEXT, field_assigned_to TEXT, property_id TEXT, property_other TEXT, notes TEXT, follow_up TEXT, updated_at TEXT);
    CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT);
    CREATE TABLE crm_transactions(id TEXT PRIMARY KEY, lead_id TEXT, data TEXT);
    CREATE TABLE crm_import_rows(id TEXT PRIMARY KEY, lead_id TEXT, source TEXT, raw_data TEXT, created_at TEXT);
    CREATE TABLE crm_sheet_rows(id TEXT PRIMARY KEY, source_id TEXT, row_key TEXT, row_key_hash TEXT, lead_id TEXT, status TEXT, created_at TEXT);
    CREATE TABLE crm_sheet_sync_lock(id TEXT PRIMARY KEY, locked_until TEXT NOT NULL, token TEXT NOT NULL);`);
  const putPurgeLead = (id, name, phone, source, created, via) => {
    purgeDb.prepare('INSERT INTO leads (id, name, phone, source, stage, assigned_to, created_at, created_via) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, name, phone, source, 'new', '', created, via);
  };
  putPurgeLead('real-a', 'حقيقي أحمد', '+966 54 482 3616', 'تيك توك', '2026-09-15T00:00:00.000Z', 'google_sheet');
  putPurgeLead('real-b', 'حقيقي سارة', '0532406763', 'تيك توك', '2026-09-10T00:00:00.000Z', 'google_sheet');
  putPurgeLead('real-c', 'حقيقي نورة', '0503704328', 'تيك توك', '2026-09-20T00:00:00.000Z', null);
  putPurgeLead('real-a-old', 'أقدم نفس الرقم', '0544823616', 'تيك توك', '2026-08-01T00:00:00.000Z', 'google_sheet');
  putPurgeLead('drop-before', 'يُحذف قبل الحد', '0551000001', 'تيك توك', '2026-09-09T23:59:59.999Z', 'google_sheet');
  putPurgeLead('keep-equal', 'عند الحد', '0551000002', 'تيك توك', '2026-09-10T00:00:00.000Z', 'google_sheet');
  putPurgeLead('keep-after', 'بعد الحد', '0551000003', 'تيك توك', '2026-09-12T00:00:00.000Z', 'google_sheet');
  putPurgeLead('keep-manual', 'يدوي', '0551000004', 'موقع', '2020-01-01T00:00:00.000Z', null);
  putPurgeLead('keep-excel', 'إكسل', '0551000005', 'excel', '2020-02-01T00:00:00.000Z', null);
  putPurgeLead('keep-telegram', 'تيليجرام', '0551000006', 'تيليجرام', '2020-03-01T00:00:00.000Z', 'telegram');
  putPurgeLead('keep-tiktok-text', 'نص تيك توك', '0551000007', 'تيك توك', '2020-04-01T00:00:00.000Z', null);
  putPurgeLead('drop-activity', 'نشاط', '0551000008', 'موقع', '2020-05-01T00:00:00.000Z', null);
  putPurgeLead('drop-imported', 'صف مستورد', '0551000009', 'موقع', '2020-06-01T00:00:00.000Z', null);
  putPurgeLead('keep-duplicate-status', 'حالة مكرر', '0551000010', 'تيك توك', '2020-07-01T00:00:00.000Z', null);
  putPurgeLead('keep-sql-time', 'نفس اللحظة', '0551000011', 'تيك توك', '2026-09-10 00:00:00', 'google_sheet');
  putPurgeLead('drop-sql-before', 'قبل بصيغة SQL', '0551000012', 'تيك توك', '2026-09-09 21:00:00', 'google_sheet');
  purgeDb.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-c', 'real-c', 'system', 'created', ?)`).run(JSON.stringify({via: 'google_sheet'}));
  purgeDb.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-drop', 'drop-activity', 'system', 'created', ?)`).run(JSON.stringify({via: 'google_sheet', source: 'تيك توك'}));
  purgeDb.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-manual', 'keep-manual', 'user', 'created', ?)`).run(JSON.stringify({source: 'موقع'}));
  purgeDb.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-text', 'keep-tiktok-text', 'user', 'created', ?)`).run(JSON.stringify({note: 'تيك توك'}));
  purgeDb.prepare(`INSERT INTO crm_transactions (id, lead_id, data) VALUES ('tx-drop', 'drop-before', '{}')`).run();
  purgeDb.prepare(`INSERT INTO crm_transactions (id, lead_id, data) VALUES ('tx-keep', 'keep-manual', '{}')`).run();
  purgeDb.prepare(`INSERT INTO crm_import_rows (id, lead_id, source, raw_data, created_at) VALUES ('imp-drop', 'drop-before', 'excel', '{}', '2026-09-01')`).run();
  purgeDb.prepare(`INSERT INTO crm_import_rows (id, lead_id, source, raw_data, created_at) VALUES ('imp-keep', 'keep-excel', 'excel', '{}', '2020-02-01')`).run();
  purgeDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-drop', 'purge-src', 'tt:purge-me', 'drop-before', 'imported', '2026-09-09')`).run();
  purgeDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-real', 'purge-src', 'tt:real-b', 'real-b', 'imported', '2026-09-10')`).run();
  purgeDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-imported', 'purge-src', 'tt:imported-only', 'drop-imported', 'imported', '2020-06-01')`).run();
  purgeDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-dup-status', 'purge-src', 'tt:dup-status', 'keep-duplicate-status', 'duplicate', '2020-07-01')`).run();
  const purgeRunner = sqlRunner(purgeDb);
  const missed = await purge.executeSheetTestLeadPurge(purgeRunner, ['0550000099']);
  assert.equal(missed.aborted, true);
  assert.equal(missed.deleted, 0);
  assert.equal(purgeDb.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 16);
  const previewPurge = await purge.previewSheetTestLeadPurge(purgeRunner);
  assert.equal(previewPurge.aborted, false);
  assert.equal(previewPurge.deleted, 0);
  assert.equal(previewPurge.cutoff, '2026-09-10T00:00:00.000Z');
  assert.deepEqual(previewPurge.kept.map(lead => lead.id), ['real-a', 'real-b', 'real-c']);
  assert.deepEqual(previewPurge.kept.map(lead => lead.phone), ['0544823616', '0532406763', '0503704328']);
  assert.deepEqual(previewPurge.delete.map(lead => lead.id), ['drop-activity', 'drop-imported', 'drop-sql-before', 'drop-before']);
  assert.equal(purgeDb.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 16);
  const heldPurge = await dedupe.acquireSheetSyncLock(purgeRunner);
  assert.ok(heldPurge);
  const skippedPurge = await purge.purgeSheetTestLeads(purgeRunner);
  assert.equal(skippedPurge.skipped, true);
  assert.equal(skippedPurge.deleted, 0);
  assert.equal(purgeDb.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 16);
  await dedupe.releaseSheetSyncLock(purgeRunner, heldPurge);
  const ranPurge = await purge.executeSheetTestLeadPurge(purgeRunner);
  assert.equal(ranPurge.aborted, false);
  assert.equal(ranPurge.deleted, 4);
  assert.equal(ranPurge.rowsMarked, 2);
  assert.equal(purgeDb.prepare("SELECT id FROM leads WHERE id = 'drop-before'").get(), undefined);
  assert.equal(purgeDb.prepare("SELECT id FROM leads WHERE id = 'drop-activity'").get(), undefined);
  assert.equal(purgeDb.prepare("SELECT id FROM leads WHERE id = 'drop-imported'").get(), undefined);
  assert.equal(purgeDb.prepare("SELECT id FROM leads WHERE id = 'drop-sql-before'").get(), undefined);
  for (const id of ['real-a', 'real-b', 'real-c', 'real-a-old', 'keep-equal', 'keep-after', 'keep-manual', 'keep-excel', 'keep-telegram', 'keep-tiktok-text', 'keep-duplicate-status', 'keep-sql-time']) {
    assert.equal(purgeDb.prepare('SELECT id FROM leads WHERE id = ?').get(id).id, id);
  }
  assert.equal(purgeDb.prepare("SELECT id FROM crm_transactions WHERE lead_id = 'drop-before'").get(), undefined);
  assert.equal(purgeDb.prepare("SELECT id FROM crm_import_rows WHERE lead_id = 'drop-before'").get(), undefined);
  assert.equal(purgeDb.prepare("SELECT COUNT(*) AS n FROM lead_activity WHERE lead_id = 'drop-before' OR lead_id = 'drop-activity'").get().n, 0);
  assert.equal(purgeDb.prepare("SELECT id FROM crm_transactions WHERE id = 'tx-keep'").get().id, 'tx-keep');
  assert.equal(purgeDb.prepare("SELECT id FROM crm_import_rows WHERE id = 'imp-keep'").get().id, 'imp-keep');
  assert.equal(purgeDb.prepare("SELECT action FROM lead_activity WHERE id = 'act-manual'").get().action, 'created');
  const purgedRow = purgeDb.prepare("SELECT status, lead_id, row_key FROM crm_sheet_rows WHERE id = 'row-drop'").get();
  assert.equal(purgedRow.status, 'purged');
  assert.equal(purgedRow.lead_id, 'drop-before');
  assert.equal(purgedRow.row_key, 'tt:purge-me');
  assert.equal(purgeDb.prepare("SELECT status, row_key FROM crm_sheet_rows WHERE id = 'row-imported'").get().status, 'purged');
  assert.equal(purgeDb.prepare("SELECT status, lead_id FROM crm_sheet_rows WHERE id = 'row-real'").get().status, 'imported');
  assert.equal(purgeDb.prepare("SELECT status, lead_id FROM crm_sheet_rows WHERE id = 'row-dup-status'").get().status, 'duplicate');
  const againPurge = await purge.executeSheetTestLeadPurge(purgeRunner);
  assert.equal(againPurge.aborted, false);
  assert.equal(againPurge.deleted, 0);
  assert.equal(againPurge.rowsMarked, 0);
  assert.equal(purgeDb.prepare("SELECT status FROM crm_sheet_rows WHERE id = 'row-drop'").get().status, 'purged');
  const purgeHeaders = ['الاسم', 'رقم الجوال', 'TikTok Lead ID'];
  const purgeImport = await sync.importSheetGrid(leadDb(purgeDb), {
    id: 'purge-src',
    sheetId: config.TIKTOK_SHEET_ID,
    gid: config.TIKTOK_SHEET_GID,
    label: 'تيك توك',
    campaign: '',
    mapping: config.suggestSheetMapping(purgeHeaders),
    headers: purgeHeaders,
    enabled: true,
  }, [purgeHeaders, ['تعود التجربة', '0551000001', 'purge-me']], 'owner-1');
  assert.equal(purgeImport.inserted, 0);
  assert.equal(purgeImport.unchanged, 1);
  assert.equal(purgeDb.prepare("SELECT COUNT(*) AS n FROM leads WHERE phone = '0551000001'").get().n, 0);
  assert.equal(purgeDb.prepare("SELECT status FROM crm_sheet_rows WHERE row_key = 'tt:purge-me'").get().status, 'purged');
  purgeDb.close();
  console.log('PASS sheet mapping, row keys, seed, import once, duplicate phone, and cron secret');

  const mailDb = new DatabaseSync(':memory:');
  mailDb.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY, phone TEXT, stage TEXT, created_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE crm_users(id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, active INTEGER, created_at TEXT, phone TEXT, last_login_at TEXT);`);
  mailDb.prepare(`INSERT INTO crm_users (id, name, email, role, active, created_at) VALUES ('admin-1', 'إدارة', 'ops@sas.test', 'admin', 1, '2020-01-01')`).run();
  globalThis.sheetPool = {async execute(sql, args = []) {
    const text = String(sql).trim();
    const statement = mailDb.prepare(text);
    return /^SELECT/i.test(text) ? [statement.all(...args)] : [{affectedRows: Number(statement.run(...args).changes)}];
  }};
  globalThis.sentMail = [];
  globalThis.mailThrows = false;
  process.env.NEXTAUTH_URL = 'https://sas.test';
  process.env.DB_HOST = 'synthetic';
  process.env.DB_USER = 'synthetic';
  process.env.DB_PASSWORD = 'synthetic';
  process.env.DB_NAME = 'synthetic';
  const boundary = {name: 'sheet-mail', setup(b) {
    b.onResolve({filter: /^mysql2\/promise$/}, () => ({path: 'mysql', namespace: 'test'}));
    b.onResolve({filter: /[\\/]mail$/}, () => ({path: 'mail', namespace: 'test'}));
    b.onLoad({filter: /.*/, namespace: 'test'}, args => ({
      loader: 'js',
      contents: args.path === 'mysql'
        ? 'export default {createPool(){return globalThis.sheetPool}}'
        : 'export async function sendMail(msg){if(globalThis.mailThrows)throw Error("smtp down");globalThis.sentMail.push(msg);return true}',
    }));
  }};
  await build({
    entryPoints: ['lib/assignment-notify.ts'],
    outfile: join(output, 'notify.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [boundary],
  });
  const notify = require(join(output, 'notify.cjs'));
  const one = {id: 'lead-1', name: 'سارة اختبار', phone: '0551110000', source: 'تيك توك — حملة الاختبار'};
  await notify.notifyNewLeads([one]);
  assert.equal(globalThis.sentMail.length, 1);
  assert.equal(globalThis.sentMail[0].subject, 'عميل جديد سجل — بحاجة للتوزيع');
  assert.match(globalThis.sentMail[0].text, /0551110000/);
  assert.match(globalThis.sentMail[0].text, /تيك توك — حملة الاختبار/);
  assert.match(globalThis.sentMail[0].text, /https:\/\/sas\.test\/crm\/leads\/lead-1/);
  assert.match(globalThis.sentMail[0].text, /tab=leads/);
  assert.match(globalThis.sentMail[0].html, /#3F1A44/);
  assert.match(globalThis.sentMail[0].html, /#d1d5db/);
  assert.match(globalThis.sentMail[0].html, /color:#111/);
  assert.equal(globalThis.sentMail[0].to.includes('ops@sas.test'), true);
  assert.equal(globalThis.sentMail[0].to.includes('sasalthra.sa@gmail.com'), true);

  globalThis.sentMail = [];
  const five = Array.from({length: 5}, (_, index) => ({id: `l${index}`, name: `عميل ${index}`, phone: `055200000${index}`, source: 'تيك توك'}));
  await notify.notifyNewLeads(five);
  assert.equal(globalThis.sentMail.length, 5);
  assert.equal(globalThis.sentMail[0].subject, 'عميل جديد سجل — بحاجة للتوزيع');

  globalThis.sentMail = [];
  const six = Array.from({length: 6}, (_, index) => ({id: `d${index}`, name: `دفعة ${index}`, phone: `055300000${index}`, source: 'تيك توك — دفعة'}));
  await notify.notifyNewLeads(six);
  assert.equal(globalThis.sentMail.length, 1);
  assert.equal(globalThis.sentMail[0].subject, 'عملاء جدد سجلوا — بحاجة للتوزيع');
  assert.match(globalThis.sentMail[0].text, /دفعة 0/);
  assert.match(globalThis.sentMail[0].text, /دفعة 5/);
  assert.match(globalThis.sentMail[0].html, /#3F1A44/);

  function addresses(msg) {
    return (Array.isArray(msg.to) ? msg.to : [msg.to]).map(value => String(value));
  }
  function reregItem(id, name, phone, assigned) {
    return {
      lead: {id, name, phone, stage: 'contacted', assigned_to: assigned},
      source: 'تيك توك — حملة',
      submittedName: name,
      campaign: 'حملة',
    };
  }
  mailDb.prepare(`INSERT INTO crm_users (id, name, email, role, active, created_at) VALUES ('rep-a', 'مندوب أ', 'repa@sas.test', 'sales', 1, '2020-01-02')`).run();
  mailDb.prepare(`INSERT INTO crm_users (id, name, email, role, active, created_at) VALUES ('rep-b', 'مندوب ب', 'repb@sas.test', 'sales', 1, '2020-01-03')`).run();

  globalThis.sentMail = [];
  const fiveRe = Array.from({length: 5}, (_, index) => reregItem(`r${index}`, `فردي ${index}`, `055400000${index}`, ''));
  await notify.notifyReregistrationBatch(fiveRe);
  assert.equal(globalThis.sentMail.length, 5);
  assert.equal(globalThis.sentMail.every(msg => msg.subject.startsWith('إعادة تسجيل عميل —')), true);

  globalThis.sentMail = [];
  const sixRe = [
    reregItem('a1', 'مندوب أ١', '0551110001', 'rep-a'),
    reregItem('a2', 'مندوب أ٢', '0551110002', 'rep-a'),
    reregItem('a3', 'مندوب أ٣', '0551110003', 'rep-a'),
    reregItem('b1', 'مندوب ب١', '0551110004', 'rep-b'),
    reregItem('b2', 'مندوب ب٢', '0551110005', 'rep-b'),
    reregItem('u1', 'بلا تعيين', '0551110006', ''),
  ];
  await notify.notifyReregistrationBatch(sixRe);
  assert.equal(globalThis.sentMail.length, 3);
  const adminDigest = globalThis.sentMail.find(msg => msg.subject === 'إعادة تسجيل 6 عملاء');
  const repAMail = globalThis.sentMail.find(msg => msg.to === 'repa@sas.test');
  const repBMail = globalThis.sentMail.find(msg => msg.to === 'repb@sas.test');
  assert.ok(adminDigest);
  assert.equal(addresses(adminDigest).includes('ops@sas.test'), true);
  assert.equal(addresses(adminDigest).includes('repa@sas.test'), false);
  assert.match(adminDigest.text, /مندوب أ١/);
  assert.match(adminDigest.text, /مندوب ب٢/);
  assert.match(adminDigest.text, /بلا تعيين/);
  assert.equal(repAMail.subject, 'إعادة تسجيل 3 عملاء');
  assert.match(repAMail.text, /مندوب أ١/);
  assert.match(repAMail.text, /0551110003/);
  assert.doesNotMatch(repAMail.text, /مندوب ب١/);
  assert.doesNotMatch(repAMail.text, /بلا تعيين/);
  assert.equal(repBMail.subject, 'إعادة تسجيل 2 عملاء');
  assert.match(repBMail.text, /مندوب ب١/);
  assert.doesNotMatch(repBMail.text, /مندوب أ١/);
  assert.match(repAMail.html, /#3F1A44/);
  assert.match(repAMail.html, /#d1d5db/);

  globalThis.sentMail = [];
  await notify.notifySheetBackfillSummaries([{label: 'تيك توك', campaign: 'تمويل عقارى 4 نوفمبر', inserted: 2, duplicates: 3}]);
  assert.equal(globalThis.sentMail.length, 1);
  assert.equal(globalThis.sentMail[0].subject, 'ملخص أول مزامنة — 2 جدد، 3 موجودون');
  assert.match(globalThis.sentMail[0].text, /عملاء جدد: 2/);
  assert.match(globalThis.sentMail[0].text, /موجودون مسبقاً: 3/);
  assert.match(globalThis.sentMail[0].text, /تيك توك/);
  assert.match(globalThis.sentMail[0].text, /تمويل عقارى 4 نوفمبر/);
  assert.match(globalThis.sentMail[0].text, /https:\/\/sas\.test\/crm\?tab=leads/);
  assert.match(globalThis.sentMail[0].html, /#3F1A44/);
  assert.match(globalThis.sentMail[0].html, /color:#111/);
  assert.equal(addresses(globalThis.sentMail[0]).includes('ops@sas.test'), true);
  assert.equal(addresses(globalThis.sentMail[0]).includes('repa@sas.test'), false);
  globalThis.sentMail = [];
  await notify.notifySheetBackfillSummaries([{label: 'فارغ', campaign: '', inserted: 0, duplicates: 0}]);
  assert.equal(globalThis.sentMail.length, 0);

  globalThis.sentMail = [];
  globalThis.mailThrows = true;
  await notify.notifyNewLeads([{id: 'x', name: 'لن يُرسل', phone: '0551999999', source: 'تيك توك'}]);
  await notify.notifySheetBackfillSummaries([{label: 'تيك توك', campaign: 'ح', inserted: 1, duplicates: 4}]);
  await notify.notifyReregistrationBatch(sixRe);
  assert.equal(globalThis.sentMail.length, 0);
  globalThis.mailThrows = false;
  mailDb.close();
  console.log('PASS new-lead mail, re-registration digest above five, and backfill summary');

  const jobDb = new DatabaseSync(':memory:');
  jobDb.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY, owner TEXT, created_by TEXT, assigned_to TEXT, field_assigned_to TEXT, name TEXT, phone TEXT, property_id TEXT, property_other TEXT, source TEXT, stage TEXT, notes TEXT, follow_up TEXT, created_at TEXT, updated_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE crm_users(id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT, active INTEGER, created_at TEXT, phone TEXT, last_login_at TEXT);
    CREATE TABLE crm_sheet_sources(id TEXT PRIMARY KEY, sheet_id TEXT NOT NULL, gid TEXT, label TEXT NOT NULL, campaign TEXT NOT NULL, mapping TEXT NOT NULL, headers TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_run TEXT, last_result TEXT, created_at TEXT, updated_at TEXT, sheet_key TEXT);
    CREATE TABLE crm_sheet_rows(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, row_key TEXT NOT NULL, row_key_hash TEXT, lead_id TEXT, status TEXT, created_at TEXT);
    CREATE UNIQUE INDEX crm_sheet_rows_source_key ON crm_sheet_rows (source_id, row_key);
    CREATE TABLE crm_sheet_sync_lock(id TEXT PRIMARY KEY, locked_until TEXT NOT NULL, token TEXT NOT NULL);`);
  jobDb.prepare(`INSERT INTO crm_users (id, name, email, role, active, created_at) VALUES ('admin-1', 'إدارة', 'ops@sas.test', 'admin', 1, '2020-01-01')`).run();
  jobDb.prepare(`INSERT INTO crm_users (id, name, email, role, active, created_at) VALUES ('rep-a', 'مندوب أ', 'repa@sas.test', 'sales', 1, '2020-01-02')`).run();
  jobDb.prepare(`INSERT INTO crm_users (id, name, email, role, active, created_at) VALUES ('rep-b', 'مندوب ب', 'repb@sas.test', 'sales', 1, '2020-01-03')`).run();
  const addLead = (id, name, phone, assigned) => {
    jobDb.prepare(`INSERT INTO leads (id, owner, created_by, assigned_to, field_assigned_to, name, phone, property_id, property_other, source, stage, notes, follow_up, created_at, updated_at) VALUES (?, 'admin-1', 'admin-1', ?, '', ?, ?, 'other', '', 'سابق', 'contacted', '', '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run(id, assigned, name, phone);
  };
  addLead('lead-a1', 'مندوب أ١', '0551110001', 'rep-a');
  addLead('lead-a2', 'مندوب أ٢', '0551110002', 'rep-a');
  addLead('lead-a3', 'مندوب أ٣', '0551110003', 'rep-a');
  addLead('lead-b1', 'مندوب ب١', '0551110004', 'rep-b');
  addLead('lead-b2', 'مندوب ب٢', '0551110005', 'rep-b');
  addLead('lead-u1', 'بلا تعيين', '0551110006', '');
  addLead('lead-silent', 'قديم صامت', '0551110007', 'rep-b');
  addLead('lead-silent-a', 'صامت أ', '0551110008', 'rep-a');
  addLead('lead-silent-b', 'صامت ب', '0551110009', '');
  const jobHeaders = ['full_name', 'phone_number'];
  const jobMapping = JSON.stringify(config.suggestSheetMapping(jobHeaders));
  const headerJson = JSON.stringify(jobHeaders);
  const addSource = (id, sheetId, label, campaign, storedHeaders, storedMapping, createdAt) => {
    jobDb.prepare(`INSERT INTO crm_sheet_sources (id, sheet_id, gid, label, campaign, mapping, headers, enabled, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?, 1, ?, ?)`).run(id, sheetId, label, campaign, storedMapping, storedHeaders, createdAt, createdAt);
  };
  addSource('backfill-src', 'sheet-backfill', 'تيك توك', 'حملة الخلفية', headerJson, jobMapping, '2026-02-01T00:00:00.000Z');
  addSource('later-src', 'sheet-later', 'لاحق', 'حملة لاحقة', headerJson, jobMapping, '2026-02-02T00:00:00.000Z');
  addSource('drift-src', 'sheet-drift', 'مصدر منحرف', 'حملة منحرفة', JSON.stringify(['اسم', 'جوال']), JSON.stringify({name: 0, phone: 1}), '2026-02-03T00:00:00.000Z');
  jobDb.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('sentinel', 'later-src', 'sentinel', NULL, 'imported', '2026-02-02T00:00:00.000Z')`).run();
  const backfillGrid = [
    jobHeaders,
    ['نورة جديدة', 'p:+966552220001'],
    ['ليلى جديدة', '0552220002'],
    ['قديم صامت', '0551110007'],
    ['صامت أ', '0551110008'],
    ['صامت ب', '0551110009'],
  ];
  const laterGrid = [
    jobHeaders,
    ['مندوب أ١', '0551110001'],
    ['مندوب أ٢', '0551110002'],
    ['مندوب أ٣', '0551110003'],
    ['مندوب ب١', '0551110004'],
    ['مندوب ب٢', '0551110005'],
    ['بلا تعيين', '0551110006'],
  ];
  globalThis.sheetGrids = {
    'sheet-backfill': backfillGrid,
    'sheet-later': laterGrid,
    'sheet-drift': [jobHeaders, ['شخص منحرف', '0553330001']],
  };
  globalThis.sheetPool = sqliteExecutor(jobDb);
  globalThis.sentMail = [];
  globalThis.mailThrows = false;
  process.env.WEBSITE_LEAD_OWNER_ID = 'admin-1';
  await build({
    entryPoints: ['lib/sheet-sync-job.server.ts'],
    outfile: join(output, 'job.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [{name: 'job-boundary', setup(b) {
      b.onResolve({filter: /^server-only$/}, () => ({path: 'guard', namespace: 'job'}));
      b.onResolve({filter: /^mysql2\/promise$/}, () => ({path: 'mysql', namespace: 'job'}));
      b.onResolve({filter: /[\\/]mail$/}, () => ({path: 'mail', namespace: 'job'}));
      b.onResolve({filter: /[\\/]admin$/}, () => ({path: 'admin', namespace: 'job'}));
      b.onResolve({filter: /sheet-fetch\.server/}, () => ({path: 'sheet-fetch', namespace: 'job'}));
      b.onLoad({filter: /.*/, namespace: 'job'}, args => {
        if (args.path === 'guard') return {loader: 'js', contents: ''};
        if (args.path === 'mysql') return {loader: 'js', contents: 'export default {createPool(){return globalThis.sheetPool}}'};
        if (args.path === 'mail') return {loader: 'js', contents: 'export async function sendMail(msg){if(globalThis.mailThrows)throw Error("smtp down");globalThis.sentMail.push(msg);return true}'};
        if (args.path === 'admin') return {loader: 'js', contents: 'export async function getCrmUser(){return null}'};
        return {loader: 'js', contents: 'export async function readSheetGrid(sheetId){const grid=globalThis.sheetGrids[sheetId]; if(!grid) throw Error("missing grid"); return grid.map(row=>row.slice());}'};
      });
    }}],
  });
  const job = require(join(output, 'job.cjs'));
  const firstRun = await job.syncAllSheets();
  assert.equal(firstRun.inserted, 2);
  assert.equal(firstRun.duplicates, 9);
  assert.equal(firstRun.ok, false);
  assert.match(firstRun.errors.join('\n'), /عناوين/);
  assert.equal(jobDb.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 11);
  assert.equal(jobDb.prepare("SELECT COUNT(*) AS n FROM lead_activity WHERE action='reregistered'").get().n, 9);
  assert.match(jobDb.prepare("SELECT details FROM lead_activity WHERE lead_id='lead-silent' AND action='reregistered'").get().details, /قديم صامت/);
  assert.equal(jobDb.prepare("SELECT COUNT(*) AS n FROM crm_sheet_rows WHERE source_id='drift-src'").get().n, 0);
  assert.equal(globalThis.sentMail.length, 4);
  const summary = globalThis.sentMail.find(msg => msg.subject.startsWith('ملخص أول مزامنة'));
  const laterAdmin = globalThis.sentMail.find(msg => msg.subject === 'إعادة تسجيل 6 عملاء');
  const laterRepA = globalThis.sentMail.find(msg => msg.to === 'repa@sas.test');
  const laterRepB = globalThis.sentMail.find(msg => msg.to === 'repb@sas.test');
  assert.equal(summary.subject, 'ملخص أول مزامنة — 2 جدد، 3 موجودون');
  assert.match(summary.text, /عملاء جدد: 2/);
  assert.match(summary.text, /موجودون مسبقاً: 3/);
  assert.match(summary.text, /حملة الخلفية/);
  assert.doesNotMatch(summary.text, /نورة جديدة/);
  assert.doesNotMatch(summary.text, /قديم صامت/);
  assert.equal(addresses(summary).includes('repa@sas.test'), false);
  assert.match(laterAdmin.text, /مندوب أ١/);
  assert.match(laterAdmin.text, /بلا تعيين/);
  assert.doesNotMatch(laterAdmin.text, /قديم صامت/);
  assert.doesNotMatch(laterAdmin.text, /نورة جديدة/);
  assert.equal(laterRepA.subject, 'إعادة تسجيل 3 عملاء');
  assert.doesNotMatch(laterRepA.text, /صامت أ/);
  assert.doesNotMatch(laterRepA.text, /قديم صامت/);
  assert.equal(laterRepB.subject, 'إعادة تسجيل 2 عملاء');
  assert.doesNotMatch(laterRepB.text, /قديم صامت/);
  assert.equal(globalThis.sentMail.some(msg => msg.subject.startsWith('عميل جديد سجل')), false);
  assert.equal(globalThis.sentMail.some(msg => msg.subject.startsWith('إعادة تسجيل عميل —')), false);

  globalThis.sheetGrids['sheet-backfill'] = [
    jobHeaders,
    ['نورة معدلة', 'p:+966552220001'],
    ['ليلى جديدة', '0552220002'],
    ['قديم صامت', '0551110007'],
    ['صامت أ', '0551110008'],
    ['صامت ب', '0551110009'],
    ['هند جديدة', '0552220003'],
  ];
  globalThis.sentMail = [];
  const secondRun = await job.syncAllSheets();
  assert.equal(secondRun.inserted, 1);
  assert.equal(secondRun.duplicates, 1);
  assert.equal(jobDb.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 12);
  const nora = jobDb.prepare("SELECT id FROM leads WHERE phone='0552220001'").get();
  assert.match(jobDb.prepare("SELECT details FROM lead_activity WHERE lead_id=? AND action='reregistered'").get(nora.id).details, /نورة معدلة/);
  assert.equal(globalThis.sentMail.length, 2);
  assert.equal(globalThis.sentMail.some(msg => msg.subject === 'عميل جديد سجل — بحاجة للتوزيع' && msg.text.includes('هند جديدة') && msg.text.includes('0552220003')), true);
  assert.equal(globalThis.sentMail.some(msg => msg.subject === 'إعادة تسجيل عميل — نورة جديدة'), true);
  assert.equal(globalThis.sentMail.some(msg => msg.subject.startsWith('ملخص أول مزامنة')), false);
  assert.equal(globalThis.sentMail.some(msg => msg.subject === 'إعادة تسجيل 6 عملاء'), false);
  jobDb.close();
  console.log('PASS first sheet sync is a count summary, and a later run batches re-registration mail');

  const saveDb = new DatabaseSync(':memory:');
  globalThis.sheetSaveDb = saveDb;
  globalThis.sheetSaveUser = {userId: 'admin-1', role: 'admin', name: 'إدارة'};
  globalThis.sheetSaveBoom = false;
  const runSql = async (sql, values = []) => {
    const text = String(sql).trim();
    if (/^SELECT\s+VERSION\(\)/i.test(text)) return [[{version: '10.4.28-MariaDB'}]];
    if (text.startsWith('SHOW')) throw Error('near SHOW: syntax error');
    if (globalThis.sheetSaveBoom && values.some(value => String(value).includes('diag-not-real'))) {
      const error = new Error("Table 'synthetic.crm_sheet_sources' doesn't exist");
      error.code = 'ER_NO_SUCH_TABLE';
      error.errno = 1146;
      error.sqlMessage = error.message;
      error.sql = 'INSERT secret-should-not-leak';
      throw error;
    }
    if (globalThis.sheetSaveBoom && /INSERT INTO crm_sheet_sources/i.test(text) && values.some(value => value === 'failfailfailfailfailfailfail12')) {
      const error = new Error("Table 'synthetic.crm_sheet_sources' doesn't exist");
      error.code = 'ER_NO_SUCH_TABLE';
      error.errno = 1146;
      error.sqlMessage = error.message;
      error.sql = 'INSERT secret-should-not-leak';
      throw error;
    }
    if (text.startsWith('SELECT')) return [saveDb.prepare(text).all(...values)];
    return [{affectedRows: Number(saveDb.prepare(text).run(...values).changes || 0)}];
  };
  const connection = {
    async beginTransaction() { saveDb.exec('BEGIN'); },
    async commit() { saveDb.exec('COMMIT'); },
    async rollback() { saveDb.exec('ROLLBACK'); },
    execute: runSql,
    query: runSql,
    release() {},
  };
  globalThis.sheetSavePool = {execute: runSql, query: runSql, async getConnection() { return connection; }};
  Object.assign(process.env, {DB_HOST: 'synthetic', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic', DB_NAME: 'synthetic', NEXTAUTH_URL: 'https://sas.test'});
  await build({
    entryPoints: ['app/api/integrations/sheet-sources/route.ts', 'app/api/integrations/sheet-sources/diagnose/route.ts'],
    outdir: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
    plugins: [{name: 'save-boundary', setup(b) {
      b.onResolve({filter: /^server-only$/}, () => ({path: 'guard', namespace: 'save'}));
      b.onResolve({filter: /^mysql2\/promise$/}, () => ({path: 'mysql', namespace: 'save'}));
      b.onResolve({filter: /[\\/]admin$/}, () => ({path: 'admin', namespace: 'save'}));
      b.onLoad({filter: /.*/, namespace: 'save'}, args => {
        if (args.path === 'guard') return {loader: 'js', contents: ''};
        if (args.path === 'mysql') return {loader: 'js', contents: 'export default {createPool(){return globalThis.sheetSavePool}}'};
        return {loader: 'js', contents: 'export async function getCrmUser(){return globalThis.sheetSaveUser}'};
      });
    }}],
  });
  const saveRoute = require(join(output, 'route.cjs'));
  const diagnoseRoute = require(join(output, 'diagnose/route.cjs'));
  const postSource = body => new Request('https://sas.test/api/integrations/sheet-sources', {
    method: 'POST',
    headers: {origin: 'https://sas.test', 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  const sourceBody = {
    sheetUrl: 'abcdefghijklmnopqrstuvwxyz12',
    gid: '5',
    label: 'اختبار',
    campaign: '',
    mapping: {name: 0, phone: 1},
    headers: ['الاسم', 'رقم الجوال'],
    enabled: true,
  };
  const saved = await saveRoute.POST(postSource(sourceBody));
  const savedBody = await saved.json();
  assert.equal(saved.status, 200, savedBody.error);
  const savedRow = saveDb.prepare('SELECT sheet_id, gid, label, sheet_key FROM crm_sheet_sources WHERE id = ?').get(savedBody.id);
  assert.equal(savedRow.sheet_id, 'abcdefghijklmnopqrstuvwxyz12');
  assert.equal(savedRow.gid, '5');
  assert.equal(savedRow.label, 'اختبار');
  assert.match(savedRow.sheet_key, /^[a-f0-9]{64}$/);
  assert.equal(saveDb.prepare("SELECT gid FROM crm_sheet_sources WHERE id = 'tiktok-leads-1'").get().gid, config.TIKTOK_SHEET_GID);
  globalThis.sheetSaveUser = {userId: 'sales-1', role: 'sales', name: 'مندوب'};
  globalThis.sheetSaveBoom = true;
  const hidden = await saveRoute.POST(postSource({...sourceBody, sheetUrl: 'bbbbbbbbbbbbbbbbbbbbbbbbbb'}));
  const hiddenBody = await hidden.json();
  assert.equal(hidden.status, 403);
  assert.equal(String(hiddenBody.error).includes('ER_NO_SUCH_TABLE'), false);
  globalThis.sheetSaveUser = {userId: 'admin-1', role: 'admin', name: 'إدارة'};
  const failed = await saveRoute.POST(postSource({...sourceBody, sheetUrl: 'failfailfailfailfailfailfail12'}));
  const failedBody = await failed.json();
  assert.equal(failed.status, 503);
  assert.match(failedBody.error, /ER_NO_SUCH_TABLE/);
  assert.match(failedBody.error, /crm_sheet_sources/);
  assert.equal(failedBody.error.includes('لم يتم تأكيد الحفظ'), false);
  assert.equal(failedBody.error.includes('secret-should-not-leak'), false);
  globalThis.sheetSaveBoom = false;
  const listed = await (await saveRoute.GET()).json();
  assert.equal(listed.sources.some(source => source.id === 'tiktok-leads-1' && source.gid === config.TIKTOK_SHEET_GID), true);
  const before = saveDb.prepare('SELECT COUNT(*) AS n FROM crm_sheet_sources').get().n;
  const diagnosed = await diagnoseRoute.POST(new Request('https://sas.test/api/integrations/sheet-sources/diagnose', {
    method: 'POST',
    headers: {origin: 'https://sas.test'},
  }));
  const diagnosedBody = await diagnosed.json();
  assert.equal(diagnosed.status, 200, diagnosedBody.error);
  assert.equal(diagnosedBody.ok, true);
  assert.equal(diagnosedBody.version, '10.4.28-MariaDB');
  assert.equal(diagnosedBody.tables.crm_sheet_sources, true);
  assert.equal(diagnosedBody.tables.crm_sheet_rows, true);
  assert.equal(diagnosedBody.tables.crm_sheet_sync_lock, true);
  assert.equal(diagnosedBody.insert, 'rolled-back');
  assert.equal(diagnosedBody.persisted, false);
  assert.equal(saveDb.prepare('SELECT COUNT(*) AS n FROM crm_sheet_sources').get().n, before);
  globalThis.sheetSaveBoom = true;
  const broken = await (await diagnoseRoute.POST(new Request('https://sas.test/api/integrations/sheet-sources/diagnose', {
    method: 'POST',
    headers: {origin: 'https://sas.test'},
  }))).json();
  assert.equal(broken.ok, false);
  assert.match(broken.insert, /ER_NO_SUCH_TABLE/);
  assert.equal(broken.insert.includes('secret-should-not-leak'), false);
  assert.equal(saveDb.prepare('SELECT COUNT(*) AS n FROM crm_sheet_sources').get().n, before);
  saveDb.close();
  console.log('PASS sheet source save returns the database code and the diagnostic insert rolls back');
} finally {
  rmSync(output, {recursive: true, force: true});
}
