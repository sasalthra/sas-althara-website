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
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].id, 'tiktok-leads-1');
  assert.equal(seeded[0].sheet_id, config.TIKTOK_SHEET_ID);
  assert.equal(seeded[0].label, 'تيك توك');
  assert.equal(seeded[0].campaign, '');
  assert.equal(seeded[0].gid, config.TIKTOK_SHEET_GID);
  assert.equal(Number(seeded[0].enabled), 1);
  const seededMapping = JSON.parse(seeded[0].mapping);
  const seededHeaders = JSON.parse(seeded[0].headers);
  assert.equal(seededHeaders[seededMapping.phone], 'رقم الجوال');
  assert.equal(seededHeaders[seededMapping.name], 'الاسم');
  assert.equal(seededHeaders[seededMapping.leadId], 'TikTok Lead ID');
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(mem));
  assert.equal(mem.prepare('SELECT COUNT(*) AS n FROM crm_sheet_sources').get().n, 1);
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
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE name='crm_sheet_rows'").get().name, 'crm_sheet_rows');
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE name='crm_sheet_sync_lock'").get().name, 'crm_sheet_sync_lock');

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
  mem.close();

  assert.match(readFileSync('instrumentation.ts', 'utf8'), /phase-production-build/);
  assert.match(readFileSync('instrumentation.ts', 'utf8'), /startSheetSyncInterval/);
  assert.match(readFileSync('app/api/cron/sheets-sync/route.ts', 'utf8'), /assertCron/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /مزامنة الآن/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /180_000|sheetsSyncIntervalMs/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /notifySheetBackfillSummaries/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /sourceAlreadySynced/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /أول مزامنة/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /TIKTOK_SHEET_GID/);
  assert.match(readFileSync('app/api/integrations/sheet-sources/preview/route.ts', 'utf8'), /listSheetTabs/);
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
    CREATE TABLE crm_sheet_sources(id TEXT PRIMARY KEY, sheet_id TEXT NOT NULL, gid TEXT, label TEXT NOT NULL, campaign TEXT NOT NULL, mapping TEXT NOT NULL, headers TEXT, enabled INTEGER NOT NULL DEFAULT 1, last_run TEXT, last_result TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE crm_sheet_rows(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, row_key TEXT NOT NULL, lead_id TEXT, status TEXT, created_at TEXT);
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
} finally {
  rmSync(output, {recursive: true, force: true});
}
