// Manager property cleanup: preview the Noura spellings, then delete only those ids.
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {sqliteReportSql} from './sqlite-report-sql.mjs';

process.env.npm_lifecycle_event = process.env.npm_lifecycle_event || 'test';

const source = readFileSync(new URL('../lib/property-cleanup.ts', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/leads/property-cleanup/route.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../app/crm/property-cleanup.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(source, /CONVERT_TZ\s*\(|HEX\s*\(/i);
assert.match(source, /matchPropertyCleanup/);
assert.match(route, /\['admin', 'supervisor'\]/);
assert.doesNotMatch(route, /'sales'|'field'/);
assert.match(panel, /عرض المطابقين/);
assert.match(panel, /تأكيد الحذف/);
assert.match(panel, /DEFAULT_PROPERTY_CLEANUP_LABELS/);
assert.match(readFileSync(new URL('../app/crm/import-panel.tsx', import.meta.url), 'utf8'), /PropertyCleanup/);
assert.match(readFileSync(new URL('../lib/bulk-leads.ts', import.meta.url), 'utf8'), /lead_stage_notes/);
assert.match(readFileSync(new URL('../lib/bulk-leads.ts', import.meta.url), 'utf8'), /inParams\('lead_id'/);

const out = mkdtempSync(join(tmpdir(), 'sas-property-cleanup-'));
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');

const admin = '11111111-1111-4111-8111-111111111111';
const supervisor = '22222222-2222-4222-8222-222222222222';
const sales = '33333333-3333-4333-8333-333333333333';
const noura = '66666666-6666-4666-8666-666666666666';
const nouraAlt = '88888888-8888-4888-8888-888888888888';
const other = '77777777-7777-4777-8777-777777777777';
const dropUnqualified = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const dropUninterested = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const keepVilla = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const keepOther = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const dropSpelling = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';

sql.exec(`
CREATE TABLE leads(
  id TEXT PRIMARY KEY, owner TEXT, created_by TEXT, assigned_to TEXT, field_assigned_to TEXT,
  name TEXT, phone TEXT, property_id TEXT, property_other TEXT, source TEXT, stage TEXT,
  notes TEXT, follow_up TEXT, created_at TEXT, updated_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE crm_users(id TEXT PRIMARY KEY, username TEXT, name TEXT, role TEXT, active INTEGER, email TEXT);
CREATE TABLE lead_activity(
  id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
CREATE TABLE lead_stage_notes(
  id TEXT PRIMARY KEY, lead_id TEXT, stage TEXT, note_text TEXT, created_at TEXT,
  by_user_id TEXT, by_name TEXT, source_activity_id TEXT
);
CREATE TABLE crm_transactions(id TEXT PRIMARY KEY, lead_id TEXT, data TEXT, FOREIGN KEY (lead_id) REFERENCES leads(id));
CREATE TABLE crm_import_rows(id TEXT PRIMARY KEY, lead_id TEXT, source TEXT, raw_data TEXT, created_at TEXT, FOREIGN KEY (lead_id) REFERENCES leads(id));
CREATE TABLE crm_sheet_rows(id TEXT PRIMARY KEY, source_id TEXT, row_key TEXT, lead_id TEXT, status TEXT, created_at TEXT);
CREATE TABLE crm_audit(id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, target_id TEXT, details TEXT, created_at TEXT);
`);

function user(id, name, role, active = 1) {
  sql.prepare('INSERT INTO crm_users VALUES (?,?,?,?,?,?)').run(id, role, name, role, active, `${role}@sas.test`);
}
user(admin, 'مدير', 'admin');
user(supervisor, 'مشرف', 'supervisor');
user(sales, 'عهود', 'sales');
user(noura, 'نورة', 'sales');
user(nouraAlt, 'نوره', 'sales');
user(other, 'أحمد', 'sales');

function lead(id, name, phone, assigned, property, stage = 'new') {
  sql.prepare(`INSERT INTO leads (id,owner,created_by,assigned_to,field_assigned_to,name,phone,property_id,property_other,source,stage,notes,follow_up,created_at,updated_at,is_featured)
    VALUES (?,?,?,?,?,?,?,'other',?,'excel',?,'', '', ?, ?, 0)`).run(
    id, admin, admin, assigned, '', name, phone, property, stage, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'
  );
}
lead(dropUnqualified, 'سارة', '0551000001', noura, 'غير مؤهل');
lead(dropUninterested, 'خالد', '0551000002', noura, 'عميل غير مهتم بالتمويل');
lead(keepVilla, 'ليان', '0551000003', noura, 'فيلا في الرياض', 'not_interested');
lead(keepOther, 'ماجد', '0551000004', other, 'غير مؤهل');
lead(dropSpelling, 'هند', '0551000005', 'نوره', 'شقة — غير مؤهل');
sql.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-drop', ?, ?, 'created', '{}')`).run(dropUnqualified, noura);
sql.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-keep', ?, ?, 'created', '{}')`).run(keepVilla, noura);
sql.prepare(`INSERT INTO lead_stage_notes (id, lead_id, stage, note_text, created_at, by_user_id, by_name, source_activity_id) VALUES ('note-drop', ?, 'new', 'ملاحظة', '2026-10-01', ?, 'نورة', 'act-drop')`).run(dropUnqualified, noura);
sql.prepare(`INSERT INTO lead_stage_notes (id, lead_id, stage, note_text, created_at, by_user_id, by_name, source_activity_id) VALUES ('note-keep', ?, 'new', 'تبقى', '2026-10-01', ?, 'نورة', 'act-keep')`).run(keepVilla, noura);
sql.prepare(`INSERT INTO crm_transactions (id, lead_id, data) VALUES ('tx-drop', ?, '{}')`).run(dropUnqualified);
sql.prepare(`INSERT INTO crm_import_rows (id, lead_id, source, raw_data, created_at) VALUES ('imp-drop', ?, 'excel', '[]', '2026-10-01')`).run(dropUnqualified);

const driver = {
  async execute(query, args = []) {
    const sqlText = sqliteReportSql(String(query).replace(/ FOR UPDATE/g, ''));
    const statement = sql.prepare(sqlText);
    if (/^\s*(SELECT|SHOW|EXPLAIN)/i.test(sqlText)) return [statement.all(...args)];
    return [{affectedRows: Number(statement.run(...args).changes)}];
  },
  async beginTransaction() { sql.exec('BEGIN'); },
  async commit() { sql.exec('COMMIT'); },
  async rollback() { sql.exec('ROLLBACK'); },
  release() {},
};
globalThis.storagePool = {execute: driver.execute, async getConnection() { return driver; }};
globalThis.testUser = null;
Object.assign(process.env, {
  DB_HOST: 'synthetic', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic', DB_NAME: 'synthetic',
  NEXTAUTH_URL: 'https://sas.test',
});

const boundary = {name: 'cleanup-boundary', setup(buildApi) {
  buildApi.onResolve({filter: /^mysql2\/promise$/}, () => ({path: 'mysql', namespace: 'test'}));
  buildApi.onResolve({filter: /^nodemailer$/}, () => ({path: 'mailer', namespace: 'test'}));
  buildApi.onResolve({filter: /[\\/]admin$/}, () => ({path: 'auth', namespace: 'test'}));
  buildApi.onResolve({filter: /^server-only$/}, () => ({path: 'guard', namespace: 'test'}));
  buildApi.onLoad({filter: /.*/, namespace: 'test'}, args => ({loader: 'js', contents: args.path === 'mysql'
    ? 'export default {createPool(){return globalThis.storagePool}}'
    : args.path === 'mailer'
      ? 'export default {createTransport(){return {async sendMail(){}}}}'
      : args.path === 'auth'
        ? 'export async function getCrmUser(){return globalThis.testUser}'
        : ''}));
}};

try {
  await build({
    entryPoints: {
      shared: 'lib/property-cleanup-shared.ts',
      api: 'app/api/leads/property-cleanup/route.ts',
    },
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
    plugins: [boundary],
  });
  const requireOut = createRequire(import.meta.url);
  const shared = requireOut(join(out, 'shared.cjs'));
  const api = requireOut(join(out, 'api.cjs'));

  const directory = [
    {id: noura, name: 'نورة', username: 'noura', role: 'sales', active: 1},
    {id: nouraAlt, name: 'نوره', username: 'nourah', role: 'sales', active: 1},
    {id: other, name: 'أحمد', username: 'ahmad', role: 'sales', active: 1},
  ];
  const rows = [
    {id: dropUnqualified, name: 'سارة', phone: '055', property_id: 'other', property_other: 'غير مؤهل', assigned_to: noura},
    {id: dropUninterested, name: 'خالد', phone: '056', property_id: 'other', property_other: 'غير مهتم', assigned_to: nouraAlt},
    {id: keepVilla, name: 'ليان', phone: '057', property_id: 'other', property_other: 'فيلا', assigned_to: noura},
    {id: keepOther, name: 'ماجد', phone: '058', property_id: 'other', property_other: 'غير مؤهل', assigned_to: other},
    {id: dropSpelling, name: 'هند', phone: '059', property_id: 'other', property_other: 'غير مؤهل', assigned_to: 'نوره'},
  ];
  const matched = shared.matchPropertyCleanup(rows, directory, noura, shared.DEFAULT_PROPERTY_CLEANUP_LABELS);
  assert.deepEqual(matched.map(item => item.id).sort(), [dropUnqualified, dropUninterested, dropSpelling].sort());
  assert.equal(shared.leadAssignedToEmployee('نورة', directory[1], directory), true);
  assert.equal(shared.leadAssignedToEmployee(other, directory[0], directory), false);
  assert.equal(shared.propertyHasCleanupLabel('other', 'فيلا', '', ['غير مهتم']), false);

  const call = (method, body) => api[method](new Request('https://sas.test/api/leads/property-cleanup', {
    method,
    headers: {origin: 'https://sas.test', 'content-type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

  assert.equal((await call('GET')).status, 401);
  globalThis.testUser = {userId: sales, role: 'sales', name: 'عهود'};
  assert.equal((await call('GET')).status, 403);
  assert.equal((await call('POST', {employeeId: noura})).status, 403);
  globalThis.testUser = {userId: supervisor, role: 'supervisor', name: 'مشرف'};
  const listed = await call('GET');
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.ok(listedBody.employees.some(employee => employee.name === 'نورة'));
  assert.deepEqual(listedBody.defaultLabels, ['غير مؤهل', 'غير مهتم']);

  const preview = await call('POST', {employeeId: noura});
  assert.equal(preview.status, 200);
  const previewBody = await preview.json();
  assert.equal(previewBody.count, 3);
  assert.deepEqual(previewBody.leads.map(item => item.id).sort(), [dropUnqualified, dropUninterested, dropSpelling].sort());
  assert.ok(previewBody.leads.every(item => item.name && item.phone && item.propertyText));
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads').get().n, 5, 'preview does not delete');

  const tampered = await call('POST', {
    confirm: true,
    employeeId: noura,
    ids: [dropUnqualified, keepVilla, keepOther],
  });
  assert.equal(tampered.status, 200);
  const tamperedBody = await tampered.json();
  assert.equal(tamperedBody.deleted, 1);
  assert.equal(tamperedBody.skipped, 2);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(dropUnqualified), undefined);
  assert.equal(sql.prepare('SELECT name FROM leads WHERE id = ?').get(keepVilla).name, 'ليان');
  assert.equal(sql.prepare('SELECT name FROM leads WHERE id = ?').get(keepOther).name, 'ماجد');
  assert.equal(sql.prepare("SELECT id FROM lead_activity WHERE id = 'act-drop'").get(), undefined);
  assert.equal(sql.prepare("SELECT id FROM lead_activity WHERE id = 'act-keep'").get().id, 'act-keep');
  assert.equal(sql.prepare("SELECT id FROM lead_stage_notes WHERE id = 'note-drop'").get(), undefined);
  assert.equal(sql.prepare("SELECT id FROM lead_stage_notes WHERE id = 'note-keep'").get().id, 'note-keep');
  assert.equal(sql.prepare("SELECT id FROM crm_transactions WHERE id = 'tx-drop'").get(), undefined);
  assert.equal(sql.prepare("SELECT id FROM crm_import_rows WHERE id = 'imp-drop'").get(), undefined);

  globalThis.testUser = {userId: admin, role: 'admin', name: 'مدير'};
  const rest = await call('POST', {confirm: true, employeeId: noura, ids: [dropUninterested, dropSpelling, keepVilla]});
  assert.equal(rest.status, 200);
  const restBody = await rest.json();
  assert.equal(restBody.deleted, 2);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(dropUninterested), undefined);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(dropSpelling), undefined);
  assert.equal(sql.prepare('SELECT name FROM leads WHERE id = ?').get(keepVilla).name, 'ليان');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads').get().n, 2);
  console.log('PASS property cleanup previews both Noura spellings and deletes only the confirmed ids');
} finally {
  sql.close();
  rmSync(out, {recursive: true, force: true});
}
