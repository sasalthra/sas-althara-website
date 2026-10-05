// Bulk select: assign one digest, or admin-delete leads and purge sheet rows.
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

process.env.npm_lifecycle_event = process.env.npm_lifecycle_event || 'test';

const out = mkdtempSync(join(tmpdir(), 'sas-bulk-'));
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');

const admin = '11111111-1111-4111-8111-111111111111';
const supervisor = '22222222-2222-4222-8222-222222222222';
const sales = '33333333-3333-4333-8333-333333333333';
const inactive = '44444444-4444-4444-8444-444444444444';
const fieldUser = '55555555-5555-4555-8555-555555555555';
const leadNew = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const leadFresh = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const leadSame = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const leadKeep = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const leadRollback = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';

sql.exec(`
CREATE TABLE leads(
  id TEXT PRIMARY KEY, owner TEXT, created_by TEXT, assigned_to TEXT, field_assigned_to TEXT,
  name TEXT, phone TEXT, property_id TEXT, property_other TEXT, source TEXT, stage TEXT,
  notes TEXT, follow_up TEXT, created_at TEXT, updated_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0,
  created_via TEXT
);
CREATE TABLE crm_users(id TEXT PRIMARY KEY, username TEXT, name TEXT, role TEXT, active INTEGER, email TEXT);
CREATE TABLE lead_activity(
  id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
CREATE TABLE crm_transactions(
  id TEXT PRIMARY KEY, lead_id TEXT, data TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
CREATE TABLE crm_import_rows(
  id TEXT PRIMARY KEY, lead_id TEXT, source TEXT, raw_data TEXT, created_at TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
CREATE TABLE crm_sheet_rows(
  id TEXT PRIMARY KEY, source_id TEXT, row_key TEXT, row_key_hash TEXT, lead_id TEXT, status TEXT, created_at TEXT
);
CREATE TABLE crm_audit(id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, target_id TEXT, details TEXT, created_at TEXT);
`);

function user(id, name, role, email, active = 1) {
  sql.prepare('INSERT INTO crm_users VALUES (?,?,?,?,?,?)').run(id, role, name, role, active, email);
}
user(admin, 'مدير', 'admin', 'ops@sas.test');
user(supervisor, 'مشرف', 'supervisor', 'lead@sas.test');
user(sales, 'عهود', 'sales', 'old@sas.test');
user(inactive, 'متوقف', 'sales', 'off@sas.test', 0);
user(fieldUser, 'ميداني', 'field', 'field@sas.test');

function lead(id, name, phone, assigned = '') {
  sql.prepare(`INSERT INTO leads (id,owner,created_by,assigned_to,field_assigned_to,name,phone,property_id,property_other,source,stage,notes,follow_up,created_at,updated_at,is_featured,created_via)
    VALUES (?,?,?,?,?,?,?,'other','فيلا','تيك توك','new','ملاحظة','2026-10-06',?,?,0,'')`).run(
    id, admin, admin, assigned, '', name, phone, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'
  );
}
lead(leadNew, 'علي الجديد', '0551000001');
lead(leadFresh, 'سارة الجديدة', '0551000002');
lead(leadSame, 'خالد المسند', '0551000003', sales);
lead(leadKeep, 'نورة تبقى', '0551000004', sales);
lead(leadRollback, 'عميل التراجع', '0551000005');
sql.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-new', ?, 'system', 'created', '{}')`).run(leadNew);
sql.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-keep', ?, 'system', 'created', '{}')`).run(leadKeep);
sql.prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES ('act-rollback', ?, 'system', 'created', '{}')`).run(leadRollback);
sql.prepare(`INSERT INTO crm_transactions (id, lead_id, data) VALUES ('tx-new', ?, '{}')`).run(leadNew);
sql.prepare(`INSERT INTO crm_transactions (id, lead_id, data) VALUES ('tx-keep', ?, '{}')`).run(leadKeep);
sql.prepare(`INSERT INTO crm_import_rows (id, lead_id, source, raw_data, created_at) VALUES ('imp-new', ?, 'excel', '[]', '2026-10-01')`).run(leadNew);
sql.prepare(`INSERT INTO crm_import_rows (id, lead_id, source, raw_data, created_at) VALUES ('imp-keep', ?, 'excel', '[]', '2026-10-01')`).run(leadKeep);
sql.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-new', 'bulk-src', 'tt:bulk-keep', ?, 'imported', '2026-10-01')`).run(leadNew);
sql.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-new-2', 'bulk-src', 'tt:bulk-keep-2', ?, 'imported', '2026-10-01')`).run(leadNew);
sql.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-keep', 'bulk-src', 'tt:keep-live', ?, 'imported', '2026-10-01')`).run(leadKeep);
sql.prepare(`INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES ('row-rollback', 'bulk-src', 'tt:rollback', ?, 'imported', '2026-10-01')`).run(leadRollback);

assert.throws(
  () => sql.prepare('DELETE FROM leads WHERE id = ?').run(leadNew),
  /FOREIGN KEY|constraint/i,
  'a lead with activity cannot be deleted until the children are removed'
);

let failAudit = false;
const driver = {
  async execute(query, args = []) {
    if (failAudit && String(query).includes('INSERT INTO crm_audit')) throw Error('injected audit failure');
    const sqlText = String(query).replace(/ FOR UPDATE/g, '');
    const statement = sql.prepare(sqlText);
    if (/^\s*SELECT/i.test(sqlText)) return [statement.all(...args)];
    return [{affectedRows: Number(statement.run(...args).changes)}];
  },
  async beginTransaction() { sql.exec('BEGIN'); },
  async commit() { sql.exec('COMMIT'); },
  async rollback() { sql.exec('ROLLBACK'); },
  release() {},
};
globalThis.storagePool = {execute: driver.execute, async getConnection() { return driver; }};
globalThis.testUser = null;
globalThis.sentMail = [];
Object.assign(process.env, {
  DB_HOST: 'synthetic', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic', DB_NAME: 'synthetic',
  NEXTAUTH_URL: 'https://sas.test',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_USER: 'sasalthra.sa@gmail.com',
  SMTP_PASSWORD: 'test-app-password',
});
delete process.env.SMTP_FROM;
delete process.env.SMTP_PASS;

const boundary = {name: 'bulk-boundary', setup(buildApi) {
  buildApi.onResolve({filter: /^mysql2\/promise$/}, () => ({path: 'mysql', namespace: 'test'}));
  buildApi.onResolve({filter: /^nodemailer$/}, () => ({path: 'mailer', namespace: 'test'}));
  buildApi.onResolve({filter: /[\\/]admin$/}, () => ({path: 'auth', namespace: 'test'}));
  buildApi.onResolve({filter: /^server-only$/}, () => ({path: 'guard', namespace: 'test'}));
  buildApi.onLoad({filter: /.*/, namespace: 'test'}, args => ({loader: 'js', contents: args.path === 'mysql'
    ? 'export default {createPool(){return globalThis.storagePool}}'
    : args.path === 'mailer'
      ? 'export default {createTransport(){return {async sendMail(msg){globalThis.sentMail.push(msg);}}}}'
      : args.path === 'auth'
        ? 'export async function getCrmUser(){return globalThis.testUser}'
        : ''}));
}};

const accessSource = readFileSync(new URL('../lib/bulk-lead-access.ts', import.meta.url), 'utf8');
const assignRoute = readFileSync(new URL('../app/api/leads/bulk-assign/route.ts', import.meta.url), 'utf8');
const deleteRoute = readFileSync(new URL('../app/api/leads/bulk-delete/route.ts', import.meta.url), 'utf8');
const barSource = readFileSync(new URL('../app/crm/lead-bulk-bar.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../app/crm/workspace.tsx', import.meta.url), 'utf8');
const bulkCss = readFileSync(new URL('../app/crm/crm.css', import.meta.url), 'utf8').split('.crm-shell .crm-check').pop();
assert.match(accessSource, /role === 'admin' \|\| role === 'supervisor'/);
assert.match(accessSource, /role === 'admin'/);
assert.match(assignRoute, /notifyImportAssignments/);
assert.doesNotMatch(assignRoute, /notifyLeadAssignment/);
assert.match(assignRoute, /actor\(req, \['admin', 'supervisor'\]\)/);
assert.match(deleteRoute, /actor\(req, \['admin'\]\)/);
assert.doesNotMatch(deleteRoute, /notifyImportAssignments|sendMail|assignment-notify/);
assert.match(readFileSync(new URL('../lib/bulk-leads.ts', import.meta.url), 'utf8'), /SHEET_ROW_PURGED/);
assert.match(barSource, /تم تحديد/);
assert.match(barSource, /إسناد لموظف/);
assert.match(barSource, /حذف المحددين/);
assert.match(barSource, /إلغاء التحديد/);
assert.match(barSource, /لا يمكن التراجع عن هذا الحذف/);
assert.match(barSource, /canBulkDelete\(role\)/);
assert.match(workspace, /تحديد الكل في هذه الصفحة/);
assert.match(workspace, /canBulkSelect\(role\)/);
assert.doesNotMatch(bulkCss, /teal|#0d9488|#14b8a6|#d4af37|#b8860b/i);
assert.match(bulkCss, /#3F1A44/);
assert.match(bulkCss, /#111/);
assert.match(bulkCss, /#d1d5db/);

try {
  await build({
    stdin: {
      contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Bar from './app/crm/lead-bulk-bar';const ids=['a','b'];export const admin=renderToStaticMarkup(<Bar role="admin" ids={ids} onClear={()=>{}} onDone={()=>{}}/>);export const supervisor=renderToStaticMarkup(<Bar role="supervisor" ids={['a']} onClear={()=>{}} onDone={()=>{}}/>);export const sales=renderToStaticMarkup(<Bar role="sales" ids={ids} onClear={()=>{}} onDone={()=>{}}/>);export const field=renderToStaticMarkup(<Bar role="field" ids={ids} onClear={()=>{}} onDone={()=>{}}/>);export const idle=renderToStaticMarkup(<Bar role="admin" ids={[]} onClear={()=>{}} onDone={()=>{}}/>);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    outfile: join(out, 'bar.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
  const view = createRequire(import.meta.url)(join(out, 'bar.cjs'));
  assert.match(view.admin, /تم تحديد\s*2/);
  assert.match(view.admin, /إسناد لموظف/);
  assert.match(view.admin, /حذف المحددين/);
  assert.match(view.admin, /إلغاء التحديد/);
  assert.match(view.supervisor, /تم تحديد\s*1/);
  assert.match(view.supervisor, /إسناد لموظف/);
  assert.doesNotMatch(view.supervisor, /حذف المحددين/);
  assert.equal(view.sales, '');
  assert.equal(view.field, '');
  assert.equal(view.idle, '');
  console.log('PASS bulk bar is managers-only and hides delete from everyone except admin');

  await build({
    entryPoints: {
      assign: 'app/api/leads/bulk-assign/route.ts',
      remove: 'app/api/leads/bulk-delete/route.ts',
      sync: 'lib/sheet-sync.ts',
      config: 'lib/sheet-sync-config.ts',
      featured: 'lib/lead-featured.ts',
    },
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
    plugins: [boundary],
  });
  const requireOut = createRequire(import.meta.url);
  const assignApi = requireOut(join(out, 'assign.cjs'));
  const deleteApi = requireOut(join(out, 'remove.cjs'));
  const sync = requireOut(join(out, 'sync.cjs'));
  const config = requireOut(join(out, 'config.cjs'));
  const featured = requireOut(join(out, 'featured.cjs'));
  const call = (api, body, origin = 'https://sas.test') => api.POST(new Request('https://sas.test/api/leads/bulk', {
    method: 'POST',
    headers: {origin, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  }));

  assert.equal((await call(deleteApi, {ids: [leadNew]})).status, 401);
  globalThis.testUser = {userId: sales, role: 'sales', name: 'عهود'};
  assert.equal((await call(deleteApi, {ids: [leadNew]})).status, 403);
  assert.equal((await call(assignApi, {ids: [leadNew], assignedTo: sales})).status, 403);
  globalThis.testUser = {userId: fieldUser, role: 'field', name: 'ميداني'};
  assert.equal((await call(deleteApi, {ids: [leadNew]})).status, 403);
  assert.equal((await call(assignApi, {ids: [leadNew], assignedTo: sales})).status, 403);
  globalThis.testUser = {userId: supervisor, role: 'supervisor', name: 'مشرف'};
  assert.equal((await call(deleteApi, {ids: [leadNew]})).status, 403);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads').get().n, 5, 'rejected roles never delete');
  assert.equal((await call(assignApi, {ids: [leadNew], assignedTo: sales}, 'https://evil.test')).status, 403);

  globalThis.testUser = {userId: admin, role: 'admin', name: 'مدير'};
  assert.equal((await call(assignApi, {ids: ['not-a-uuid'], assignedTo: sales})).status, 400);
  assert.equal((await call(assignApi, {ids: [leadNew], assignedTo: inactive})).status, 400);
  assert.equal(sql.prepare('SELECT assigned_to FROM leads WHERE id = ?').get(leadNew).assigned_to, '');
  assert.equal(globalThis.sentMail.length, 0, 'an invalid employee sends no mail');

  sql.prepare('UPDATE crm_users SET email = ? WHERE id = ?').run('rep@sas.test', sales);
  globalThis.sentMail = [];
  const assigned = await call(assignApi, {ids: [leadNew, leadNew, leadFresh, leadSame], assignedTo: sales});
  assert.equal(assigned.status, 200);
  const assignedBody = await assigned.json();
  assert.equal(assignedBody.assigned, 2);
  assert.match(assignedBody.message, /تم إسناد 2 عميل/);
  assert.equal(sql.prepare('SELECT assigned_to FROM leads WHERE id = ?').get(leadNew).assigned_to, sales);
  assert.equal(sql.prepare('SELECT assigned_to FROM leads WHERE id = ?').get(leadFresh).assigned_to, sales);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM lead_activity WHERE action = 'assigned'").get().n, 2);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM lead_activity WHERE lead_id = ? AND action = 'assigned'").get(leadSame).n, 0);
  const stored = sql.prepare('SELECT assigned_to, stage FROM leads WHERE id = ?').get(leadNew);
  assert.equal(featured.isNewUnassignedLead(stored), false);
  assert.equal(featured.isNewUnassignedLead({assigned_to: '', stage: 'new'}), true);
  const recipients = message => (Array.isArray(message.to) ? message.to : [message.to]);
  const employeeMails = globalThis.sentMail.filter(message => recipients(message).join(',') === 'rep@sas.test');
  const adminMails = globalThis.sentMail.filter(message => recipients(message).includes('ops@sas.test'));
  assert.equal(employeeMails.length, 1, 'the batch is one digest, not one email per lead');
  assert.match(employeeMails[0].subject, /2 عملاء/);
  assert.match(employeeMails[0].text, /علي الجديد/);
  assert.match(employeeMails[0].text, /سارة الجديدة/);
  assert.doesNotMatch(employeeMails[0].text, /خالد المسند/);
  assert.equal(employeeMails[0].from, 'ساس الثراء <sasalthra.sa@gmail.com>');
  assert.equal(adminMails.length, 1);
  assert.ok(adminMails[0].to.includes('ops@sas.test'));
  assert.ok(adminMails[0].to.includes('sasalthra.sa@gmail.com'));
  assert.match(adminMails[0].text, /عهود/);
  assert.equal(globalThis.sentMail.length, 2);

  globalThis.sentMail = [];
  const unchanged = await call(assignApi, {ids: [leadSame], assignedTo: sales});
  assert.equal(unchanged.status, 200);
  assert.equal((await unchanged.json()).assigned, 0);
  assert.equal(globalThis.sentMail.length, 0, 'an unchanged assignment does not email');

  globalThis.testUser = {userId: supervisor, role: 'supervisor', name: 'مشرف'};
  const bySupervisor = await call(assignApi, {ids: [leadKeep], assignedTo: sales});
  assert.equal(bySupervisor.status, 200);
  assert.equal((await bySupervisor.json()).assigned, 0);

  failAudit = true;
  globalThis.testUser = {userId: admin, role: 'admin', name: 'مدير'};
  const rolled = await call(deleteApi, {ids: [leadRollback]});
  assert.equal(rolled.status, 503);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(leadRollback).id, leadRollback);
  assert.equal(sql.prepare("SELECT status FROM crm_sheet_rows WHERE id = 'row-rollback'").get().status, 'imported');
  assert.equal(sql.prepare("SELECT id FROM lead_activity WHERE id = 'act-rollback'").get().id, 'act-rollback');
  failAudit = false;

  const removed = await call(deleteApi, {ids: [leadNew, leadFresh]});
  assert.equal(removed.status, 200);
  const removedBody = await removed.json();
  assert.equal(removedBody.deleted, 2);
  assert.match(removedBody.message, /تم حذف 2 عميل/);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(leadNew), undefined);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(leadFresh), undefined);
  assert.equal(sql.prepare('SELECT name FROM leads WHERE id = ?').get(leadKeep).name, 'نورة تبقى');
  assert.equal(sql.prepare("SELECT id FROM lead_activity WHERE id = 'act-new'").get(), undefined);
  assert.equal(sql.prepare("SELECT id FROM lead_activity WHERE id = 'act-keep'").get().id, 'act-keep');
  assert.equal(sql.prepare("SELECT id FROM crm_transactions WHERE id = 'tx-new'").get(), undefined);
  assert.equal(sql.prepare("SELECT id FROM crm_transactions WHERE id = 'tx-keep'").get().id, 'tx-keep');
  assert.equal(sql.prepare("SELECT id FROM crm_import_rows WHERE id = 'imp-new'").get(), undefined);
  assert.equal(sql.prepare("SELECT id FROM crm_import_rows WHERE id = 'imp-keep'").get().id, 'imp-keep');
  assert.equal(sql.prepare("SELECT status, row_key, lead_id FROM crm_sheet_rows WHERE id = 'row-new'").get().status, 'purged');
  assert.equal(sql.prepare("SELECT row_key FROM crm_sheet_rows WHERE id = 'row-new'").get().row_key, 'tt:bulk-keep');
  assert.equal(sql.prepare("SELECT status FROM crm_sheet_rows WHERE id = 'row-new-2'").get().status, 'purged');
  assert.equal(sql.prepare("SELECT status, lead_id FROM crm_sheet_rows WHERE id = 'row-keep'").get().status, 'imported');

  const headers = ['الاسم', 'رقم الجوال', 'TikTok Lead ID'];
  const again = await sync.importSheetGrid({prepare(query) {
    return {bind(...args) {
      return {
        async all() { return {results: sql.prepare(query).all(...args)}; },
        async first() { return sql.prepare(query).get(...args) || null; },
        async run() { sql.prepare(query).run(...args); },
      };
    }};
  }}, {
    id: 'bulk-src',
    sheetId: 'abcdefghijklmnopqrstuvwxyz12',
    gid: '9',
    label: 'تيك توك',
    campaign: '',
    mapping: config.suggestSheetMapping(headers),
    headers,
    enabled: true,
  }, [headers, ['علي يعود', '0551000001', 'bulk-keep']], admin);
  assert.equal(again.inserted, 0);
  assert.equal(again.unchanged, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM leads WHERE phone = '0551000001'").get().n, 0);
  assert.equal(sql.prepare("SELECT status FROM crm_sheet_rows WHERE row_key = 'tt:bulk-keep'").get().status, 'purged');
  console.log('PASS bulk assign sends one digest and bulk delete purges sheet rows');
} finally {
  sql.close();
  rmSync(out, {recursive: true, force: true});
}
