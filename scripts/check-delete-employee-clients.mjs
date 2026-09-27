// Admin purge of clients assigned to one sales rep. Disposable SQLite only.
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const out = mkdtempSync(join(tmpdir(), 'sas-purge-'));
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');
const ohoud = crypto.randomUUID();
const twin = crypto.randomUUID();
const other = crypto.randomUUID();
const admin = crypto.randomUUID();
const rollbackUser = crypto.randomUUID();
sql.exec(`
CREATE TABLE leads(
  id TEXT PRIMARY KEY, owner TEXT, created_by TEXT, assigned_to TEXT, field_assigned_to TEXT,
  name TEXT, phone TEXT, property_id TEXT, property_other TEXT, source TEXT, stage TEXT,
  notes TEXT, follow_up TEXT, created_at TEXT, updated_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE crm_users(id TEXT PRIMARY KEY, username TEXT, name TEXT, role TEXT, active INTEGER, email TEXT);
CREATE TABLE lead_activity(
  id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
CREATE TABLE crm_transactions(
  id TEXT PRIMARY KEY, lead_id TEXT, data TEXT, confirmed_due TEXT, version INTEGER, updated_at TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
CREATE TABLE crm_import_rows(
  id TEXT PRIMARY KEY, lead_id TEXT, source TEXT, raw_data TEXT, created_at TEXT,
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
CREATE TABLE crm_audit(id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, target_id TEXT, details TEXT, created_at TEXT);
CREATE TABLE hr_profiles(user_id TEXT PRIMARY KEY, job_title TEXT, department TEXT, leave_balance REAL, schedule TEXT, updated_at TEXT);
CREATE TABLE hr_attendance(user_id TEXT, work_day TEXT, check_in TEXT, PRIMARY KEY(user_id, work_day));
`);

function user(id, name, role, username) {
  sql.prepare('INSERT INTO crm_users VALUES (?,?,?,?,1,?)').run(id, username, name, role, `${username}@sas.test`);
}
user(ohoud, 'عهود', 'sales', 'ohoud');
user(twin, 'عهود', 'sales', 'ohoud-2');
user(other, 'مندوب آخر', 'sales', 'other');
user(admin, 'مدير', 'admin', 'admin');
user(rollbackUser, 'تراجع', 'sales', 'rollback');
sql.prepare('INSERT INTO hr_profiles VALUES (?,?,?,?,?,?)').run(ohoud, 'مبيعات', 'المبيعات', 4, '{}', '2026-09-01');
sql.prepare('INSERT INTO hr_attendance VALUES (?,?,?)').run(ohoud, '2026-09-01', '2026-09-01T06:00:00.000Z');

const ids = {
  sales: crypto.randomUUID(),
  both: crypto.randomUUID(),
  fieldOnly: crypto.randomUUID(),
  owned: crypto.randomUUID(),
  unrelated: crypto.randomUUID(),
  twin: crypto.randomUUID(),
  rollback: crypto.randomUUID(),
  otherActivity: crypto.randomUUID(),
};
function lead(id, owner, assigned, field, name, notes) {
  sql.prepare(`INSERT INTO leads (id,owner,created_by,assigned_to,field_assigned_to,name,phone,property_id,property_other,source,stage,notes,follow_up,created_at,updated_at,is_featured)
    VALUES (?,?,?,?,?,?,?,'other','','manual','new',?,'','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z',0)`).run(
    id, owner, owner, assigned, field, name, `+9665${id.replaceAll('-', '').slice(0, 8)}`, notes
  );
}
lead(ids.sales, admin, ohoud, '', 'عميل مبيعات', 'ملاحظة المبيعات');
lead(ids.both, admin, ohoud, ohoud, 'عميل مبيعات وميدان', 'ملاحظة مشتركة');
lead(ids.fieldOnly, other, other, ohoud, 'عميل ميداني فقط', 'ملاحظة ميدانية');
lead(ids.owned, ohoud, other, '', 'عميل أنشأته عهود', 'ملاحظة الملكية');
lead(ids.unrelated, other, other, '', 'عميل غير مرتبط', 'ملاحظة أخرى');
lead(ids.twin, admin, twin, '', 'عميل النسخة الأخرى', 'ملاحظة التوأم');
lead(ids.rollback, admin, rollbackUser, '', 'عميل التراجع', 'ملاحظة التراجع');
function activity(id, leadId, userId) {
  sql.prepare('INSERT INTO lead_activity VALUES (?,?,?,?,?)').run(id, leadId, userId, 'updated', '{"note":"سجل"}');
}
activity(crypto.randomUUID(), ids.sales, ohoud);
activity(crypto.randomUUID(), ids.both, ohoud);
activity(crypto.randomUUID(), ids.fieldOnly, ohoud);
activity(ids.otherActivity, ids.unrelated, ohoud);
activity(crypto.randomUUID(), ids.twin, twin);
activity(crypto.randomUUID(), ids.rollback, rollbackUser);
sql.prepare('INSERT INTO crm_transactions VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), ids.sales, '{}', null, 1, '2026-09-01');
sql.prepare('INSERT INTO crm_import_rows VALUES (?,?,?,?,?)').run(crypto.randomUUID(), ids.sales, 'excel', '[]', '2026-09-01');
sql.prepare('INSERT INTO crm_audit VALUES (?,?,?,?,?,?)').run('old-audit', admin, 'transaction.saved', ids.sales, '{}', '2026-09-01T00:00:00.000Z');

assert.throws(
  () => sql.prepare('DELETE FROM leads WHERE id = ?').run(ids.sales),
  /FOREIGN KEY|constraint/i,
  'the fixture must reject deleting a lead that still has activity'
);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads').get().n, 7);

let failAudit = false;
const log = [];
const driver = {
  async execute(query, args = []) {
    if (failAudit && query.includes('INSERT INTO crm_audit')) throw Error('injected audit failure');
    const sqlText = query.replace(/ FOR UPDATE/g, '').replace(/ON DUPLICATE KEY UPDATE /g, 'ON CONFLICT DO UPDATE SET ').replace(/VALUES\((\w+)\)/g, 'excluded.$1');
    log.push({query, args});
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
Object.assign(process.env, {
  DB_HOST: 'synthetic', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic', DB_NAME: 'synthetic',
  NEXTAUTH_URL: 'https://sas.test',
});
const boundary = {name: 'purge-boundary', setup(build) {
  build.onResolve({filter: /^mysql2\/promise$/}, () => ({path: 'mysql', namespace: 'test'}));
  build.onResolve({filter: /[\\/]admin$/}, () => ({path: 'auth', namespace: 'test'}));
  build.onResolve({filter: /^server-only$/}, () => ({path: 'guard', namespace: 'test'}));
  build.onLoad({filter: /.*/, namespace: 'test'}, args => ({loader: 'js', contents: args.path === 'mysql'
    ? 'export default {createPool(){return globalThis.storagePool}}'
    : args.path === 'auth'
      ? 'export async function getCrmUser(){return globalThis.testUser}'
      : ''}));
}};

const source = readFileSync(new URL('../lib/delete-employee-clients.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /DELETE\s+FROM\s+crm_users/i, 'the purge must not delete the employee account');
assert.match(source, /DELETE FROM lead_activity WHERE lead_id IN \(SELECT id FROM leads WHERE assigned_to = \?\)/);
assert.match(source, /DELETE FROM crm_transactions WHERE lead_id IN \(SELECT id FROM leads WHERE assigned_to = \?\)/);
assert.match(source, /DELETE FROM crm_import_rows WHERE lead_id IN \(SELECT id FROM leads WHERE assigned_to = \?\)/);
assert.match(source, /DELETE FROM leads WHERE assigned_to = \?/);
assert.doesNotMatch(source, /DELETE FROM leads WHERE field_assigned_to/);

try {
  await build({entryPoints: ['app/api/crm-users/clients/route.ts'], outfile: join(out, 'api.cjs'), bundle: true, platform: 'node', format: 'cjs', plugins: [boundary]});
  const api = createRequire(import.meta.url)(join(out, 'api.cjs'));
  const call = (method, url, body, origin = 'https://sas.test') => api[method](new Request(url, {
    method,
    headers: {origin, 'content-type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  }));

  assert.equal((await call('GET', `https://sas.test/api/crm-users/clients?userId=${ohoud}`)).status, 401);
  globalThis.testUser = {userId: other, role: 'sales', name: 'مندوب آخر'};
  assert.equal((await call('GET', `https://sas.test/api/crm-users/clients?userId=${ohoud}`)).status, 403);
  assert.equal((await call('POST', 'https://sas.test/api/crm-users/clients', {userId: ohoud, confirmation: 'عهود'})).status, 403);
  globalThis.testUser = {userId: other, role: 'supervisor', name: 'مشرف'};
  assert.equal((await call('POST', 'https://sas.test/api/crm-users/clients', {userId: ohoud, confirmation: 'حذف'})).status, 403);
  globalThis.testUser = {userId: other, role: 'field', name: 'ميداني'};
  assert.equal((await call('POST', 'https://sas.test/api/crm-users/clients', {userId: ohoud, confirmation: 'حذف'})).status, 403);
  assert.equal(log.filter(entry => /^\s*DELETE/i.test(entry.query)).length, 0, 'rejected roles never delete');

  globalThis.testUser = {userId: admin, role: 'admin', name: 'مدير'};
  assert.equal((await call('POST', 'https://sas.test/api/crm-users/clients', {userId: ohoud, confirmation: 'حذف'}, 'https://evil.test')).status, 403);
  assert.equal((await call('GET', 'https://sas.test/api/crm-users/clients?userId=not-a-uuid')).status, 400);
  assert.equal((await call('GET', `https://sas.test/api/crm-users/clients?userId=${crypto.randomUUID()}`)).status, 404);
  const counts = await (await call('GET', `https://sas.test/api/crm-users/clients?userId=${ohoud}`)).json();
  assert.equal(counts.scope, 'assigned_to');
  assert.equal(counts.employee.name, 'عهود');
  assert.equal(counts.salesAssigned, 2, 'sales-rep assignments are the delete scope');
  assert.equal(counts.fieldOnly, 1, 'field-only assignments are counted and kept');
  assert.equal(counts.fieldAssigned, 2);

  const beforeLeads = sql.prepare('SELECT COUNT(*) n FROM leads').get().n;
  const rejected = await call('POST', 'https://sas.test/api/crm-users/clients', {userId: ohoud, confirmation: 'حذ'});
  assert.equal(rejected.status, 400);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads').get().n, beforeLeads);
  assert.equal(log.filter(entry => /^\s*DELETE/i.test(entry.query)).length, 0);

  const purged = await call('POST', 'https://sas.test/api/crm-users/clients', {userId: ohoud, confirmation: '  عهود  '});
  assert.equal(purged.status, 200);
  const body = await purged.json();
  assert.equal(body.deleted, 2);
  assert.equal(body.scope, 'assigned_to');
  assert.equal(body.employeeName, 'عهود');
  assert.equal(body.activity, 2);
  assert.equal(body.transactions, 1);
  assert.equal(body.importRows, 1);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(ids.sales), undefined);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(ids.both), undefined);
  assert.equal(sql.prepare('SELECT notes FROM leads WHERE id = ?').get(ids.fieldOnly).notes, 'ملاحظة ميدانية');
  assert.equal(sql.prepare('SELECT notes FROM leads WHERE id = ?').get(ids.owned).notes, 'ملاحظة الملكية');
  assert.equal(sql.prepare('SELECT notes FROM leads WHERE id = ?').get(ids.unrelated).notes, 'ملاحظة أخرى');
  assert.equal(sql.prepare('SELECT notes FROM leads WHERE id = ?').get(ids.twin).notes, 'ملاحظة التوأم');
  assert.equal(sql.prepare('SELECT id FROM lead_activity WHERE id = ?').get(ids.otherActivity).id, ids.otherActivity);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM lead_activity WHERE lead_id IN (?, ?)').get(ids.sales, ids.both).n, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM crm_transactions').get().n, 0);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM crm_import_rows').get().n, 0);
  assert.equal(sql.prepare('SELECT name FROM crm_users WHERE id = ?').get(ohoud).name, 'عهود');
  assert.equal(sql.prepare('SELECT job_title FROM hr_profiles WHERE user_id = ?').get(ohoud).job_title, 'مبيعات');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM hr_attendance WHERE user_id = ?').get(ohoud).n, 1);
  const audits = sql.prepare('SELECT action, target_id, details FROM crm_audit ORDER BY created_at').all();
  assert.equal(audits.filter(row => row.action === 'transaction.saved').length, 1, 'older audit history stays');
  const purgeAudit = audits.find(row => row.action === 'leads.purge_assigned' && row.target_id === ohoud);
  assert.ok(purgeAudit);
  assert.equal(JSON.parse(purgeAudit.details).deleted, 2);
  assert.equal(JSON.parse(purgeAudit.details).scope, 'assigned_to');
  const deletes = log.filter(entry => /^\s*DELETE/i.test(entry.query)).map(entry => entry.query.replace(/\s+/g, ' ').trim());
  assert.deepEqual(deletes, [
    'DELETE FROM lead_activity WHERE lead_id IN (SELECT id FROM leads WHERE assigned_to = ?)',
    'DELETE FROM crm_transactions WHERE lead_id IN (SELECT id FROM leads WHERE assigned_to = ?)',
    'DELETE FROM crm_import_rows WHERE lead_id IN (SELECT id FROM leads WHERE assigned_to = ?)',
    'DELETE FROM leads WHERE assigned_to = ?',
  ]);
  assert.equal(log.filter(entry => /^\s*DELETE/i.test(entry.query)).every(entry => entry.args[0] === ohoud), true);

  const twinResult = await (await call('POST', 'https://sas.test/api/crm-users/clients', {userId: twin, confirmation: 'حذف'})).json();
  assert.equal(twinResult.deleted, 1);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(ids.twin), undefined);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads WHERE assigned_to = ?').get(ohoud).n, 0);
  assert.equal(sql.prepare('SELECT id FROM leads WHERE id = ?').get(ids.fieldOnly).id, ids.fieldOnly, 'field-only client of عهود remains');

  const leadsBeforeRollback = sql.prepare('SELECT COUNT(*) n FROM leads').get().n;
  const auditsBeforeRollback = sql.prepare('SELECT COUNT(*) n FROM crm_audit').get().n;
  failAudit = true;
  const failed = await call('POST', 'https://sas.test/api/crm-users/clients', {userId: rollbackUser, confirmation: 'تراجع'});
  failAudit = false;
  assert.equal(failed.status, 503);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads').get().n, leadsBeforeRollback, 'audit failure rolls the purge back');
  assert.equal(sql.prepare('SELECT notes FROM leads WHERE id = ?').get(ids.rollback).notes, 'ملاحظة التراجع');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM lead_activity WHERE lead_id = ?').get(ids.rollback).n, 1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM crm_audit').get().n, auditsBeforeRollback);
  assert.equal(sql.prepare('SELECT name FROM crm_users WHERE id = ?').get(rollbackUser).name, 'تراجع');

  await build({entryPoints: ['lib/employee-client-purge.ts'], outfile: join(out, 'rule.cjs'), bundle: true, platform: 'node', format: 'cjs'});
  const {confirmationMatches} = createRequire(import.meta.url)(join(out, 'rule.cjs'));
  assert.equal(confirmationMatches('عهود', 'عهود'), true);
  assert.equal(confirmationMatches(' عهود ', 'عهود'), true);
  assert.equal(confirmationMatches('عهود', 'حذف'), true);
  assert.equal(confirmationMatches('عهود', 'حذ'), false);
  assert.equal(confirmationMatches('عهود', ''), false);
  assert.equal(confirmationMatches('', 'حذف'), true);
  assert.equal(confirmationMatches('', ' '), false);

  await build({stdin: {contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import Purge from './app/crm/purge-employee-clients';import CRM from './app/crm/workspace';const users=[{id:'${ohoud}',username:'ohoud',name:'عهود',role:'sales',active:1}];export const purge=renderToStaticMarkup(<Purge users={users} usersLoading={false}/>);export const admin=renderToStaticMarkup(<CRM role="admin"/>);export const sales=renderToStaticMarkup(<CRM role="sales"/>);export const supervisor=renderToStaticMarkup(<CRM role="supervisor"/>);`, resolveDir: process.cwd(), loader: 'tsx'}, outfile: join(out, 'ui.cjs'), bundle: true, platform: 'node', format: 'cjs'});
  const ui = createRequire(import.meta.url)(join(out, 'ui.cjs'));
  assert.match(ui.purge, /حذف عملاء موظف/);
  assert.match(ui.purge, /assigned_to/);
  assert.match(ui.purge, /field_assigned_to/);
  assert.match(ui.purge, /كمندوب مبيعات/);
  assert.match(ui.purge, /مندوبه الميداني فقط/);
  assert.match(ui.purge, /لا يُحذف حساب الموظف/);
  assert.match(ui.purge, /كلمة حذف/);
  assert.match(ui.purge, /عهود/);
  assert.match(ui.purge, /disabled/);
  assert.match(ui.admin, /حذف عملاء موظف/);
  assert.doesNotMatch(ui.sales, /حذف عملاء موظف/);
  assert.doesNotMatch(ui.supervisor, /حذف عملاء موظف/);
  console.log('PASS admin-only purge of sales-assigned clients, dependent rows, audit, rollback, and confirmation UI');
} finally {
  rmSync(out, {recursive: true, force: true});
}
