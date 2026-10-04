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
  assert.equal(headers[mapping.name], 'full_name');
  assert.equal(headers[mapping.phone], 'phone_number');
  assert.equal(headers[mapping.propertyType], 'نوع_العقار_الذى_تبحث_عنه');
  assert.equal(headers[mapping.budget], 'طريقة_الشراء_التى_تفضلها');
  assert.equal(headers[mapping.residency], 'هل_انت_');
  assert.equal(headers[mapping.campaign], 'campaign_name');
  assert.equal(headers[mapping.formName], 'form_name');
  assert.equal(headers[mapping.platform], 'platform');
  assert.equal(mapping.city, undefined);
  assert.equal(config.sameHeaders(headers, headers.slice(0, -2)), true, 'trailing empty headers do not count as drift');
  assert.equal(config.sameHeaders(headers, headers.map((header, index) => index === 15 ? 'الاسم' : header)), false);

  const draft = config.composeSheetLead(
    ['', '', '', '', '', '', '', 'New Leads campaign', '', 'تمويل عقارى 4 نوفمبر', '', 'ig', 'شقة_تمليك_', 'تمويل', 'مواطن', 'سارة اختبار', 'p:+966551110000', 'CREATED'],
    {label: 'تيك توك', campaign: 'تمويل عقارى 4 نوفمبر'},
    mapping
  );
  assert.equal(draft.phone, '0551110000');
  assert.equal(draft.stage, 'new');
  assert.equal(draft.source, 'تيك توك — تمويل عقارى 4 نوفمبر');
  assert.match(draft.notes, /شقة تمليك/);
  assert.match(draft.notes, /تمويل/);
  assert.match(draft.notes, /مواطن/);
  assert.match(draft.propertyOther, /شقة تمليك/);
  assert.equal(config.sheetRowProblem(draft), '');
  assert.equal(config.sheetRowProblem({name: 'س', phone: ''}), 'الاسم ناقص');

  const key = sync.sheetRowKey(2, ['أ', '0551110000']);
  assert.equal(key, sync.sheetRowKey(2, ['أ', '0551110000']));
  assert.notEqual(key, sync.sheetRowKey(2, ['ب', '0551110000']));
  assert.match(key, /^2:[a-f0-9]{24}$/);
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
  const seeded = mem.prepare('SELECT id, sheet_id, label, campaign, enabled, mapping, headers FROM crm_sheet_sources').all();
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].id, 'tiktok-leads-1');
  assert.equal(seeded[0].sheet_id, config.TIKTOK_SHEET_ID);
  assert.equal(seeded[0].label, 'تيك توك');
  assert.equal(seeded[0].campaign, 'تمويل عقارى 4 نوفمبر');
  assert.equal(Number(seeded[0].enabled), 1);
  const seededMapping = JSON.parse(seeded[0].mapping);
  const seededHeaders = JSON.parse(seeded[0].headers);
  assert.equal(seededHeaders[seededMapping.phone], 'phone_number');
  assert.equal(seededHeaders[seededMapping.name], 'full_name');
  schema.resetLeadSchemaCache();
  await schema.ensureLeadSchema(sqliteExecutor(mem));
  assert.equal(mem.prepare('SELECT COUNT(*) AS n FROM crm_sheet_sources').get().n, 1);
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
  mem.close();

  assert.match(readFileSync('instrumentation.ts', 'utf8'), /phase-production-build/);
  assert.match(readFileSync('instrumentation.ts', 'utf8'), /startSheetSyncInterval/);
  assert.match(readFileSync('app/api/cron/sheets-sync/route.ts', 'utf8'), /assertCron/);
  assert.match(readFileSync('app/crm/sheet-sources-panel.tsx', 'utf8'), /مزامنة الآن/);
  assert.match(readFileSync('lib/sheet-sync-job.server.ts', 'utf8'), /180_000|sheetsSyncIntervalMs/);
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

  globalThis.sentMail = [];
  globalThis.mailThrows = true;
  await notify.notifyNewLeads([{id: 'x', name: 'لن يُرسل', phone: '0551999999', source: 'تيك توك'}]);
  assert.equal(globalThis.sentMail.length, 0);
  globalThis.mailThrows = false;
  mailDb.close();
  console.log('PASS new-lead mail, five separate emails, and one digest above five');
} finally {
  rmSync(output, {recursive: true, force: true});
}
