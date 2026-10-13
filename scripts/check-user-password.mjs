import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {assertCollationSafe, sqliteReportSql} from './sqlite-report-sql.mjs';

const panel = readFileSync('app/crm/users-panel.tsx', 'utf8');
const route = readFileSync('app/api/crm-users/password/route.ts', 'utf8');
const workspace = readFileSync('app/crm/workspace.tsx', 'utf8');
const usersApi = readFileSync('app/api/crm-users/route.ts', 'utf8');

assert.match(workspace, /role === 'admin' && \([\s\S]*<TabsContent value="users">/);
assert.match(panel, /تغيير كلمة المرور/);
assert.match(panel, /كلمة المرور الجديدة/);
assert.match(panel, /تأكيد كلمة المرور/);
assert.match(panel, /كلمة المرور يجب أن تكون 8 أحرف على الأقل/);
assert.match(panel, /كلمتا المرور غير متطابقتين/);
assert.match(panel, /تم تغيير كلمة المرور/);
assert.match(panel, /كلمة المرور الحالية لا تُعرض/);
assert.match(panel, /\/api\/crm-users\/password/);
assert.doesNotMatch(panel, /password_hash/);
assert.doesNotMatch(route, /SELECT\s+[^;]*password_hash/i);
assert.match(route, /bcrypt\.hash/);
assert.match(route, /paramEq\('id'\)/);
assert.match(usersApi, /password_hash is omitted/);
assert.doesNotMatch(usersApi, /SELECT\s+[^;]*password_hash/i);

const out = mkdtempSync(join(tmpdir(), 'sas-password-'));
globalThis.testUser = null;
globalThis.userRow = null;
globalThis.writes = [];
process.env.NEXTAUTH_URL = 'https://sas.test';

const boundaries = {
  name: 'boundaries',
  setup(b) {
    b.onResolve({filter: /[\\/]admin$/}, () => ({path: 'auth', namespace: 'test'}));
    b.onResolve({filter: /[\\/]crm-db$/}, () => ({path: 'db', namespace: 'test'}));
    b.onLoad({filter: /.*/, namespace: 'test'}, args => ({
      loader: 'js',
      contents: args.path === 'auth'
        ? 'export async function getCrmUser(){return globalThis.testUser}'
        : `export function crmDb(){return {prepare(sql){let args=[];const row={bind(...v){args=v;return row},async first(){globalThis.writes.push({sql,args});return globalThis.userRow},async run(){globalThis.writes.push({sql,args});return {meta:{changes:1}}}};return row}}};`,
    }));
  },
};

try {
  await build({
    entryPoints: ['app/api/crm-users/password/route.ts'],
    outfile: join(out, 'password.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [boundaries],
  });
  const api = createRequire(import.meta.url)(join(out, 'password.cjs'));
  const userId = 'user-ohoud';
  const password = 'new-secret-9';
  const call = (body, origin = 'https://sas.test') => api.POST(new Request('https://internal-host/api/crm-users/password', {
    method: 'POST',
    headers: {Origin: origin, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  }));

  assert.equal((await call({id: userId, password, confirm: password})).status, 401);
  globalThis.testUser = {userId: 'sales-1', role: 'sales', name: 'مندوب'};
  assert.equal((await call({id: userId, password, confirm: password})).status, 403);
  globalThis.testUser = {userId: 'admin-1', role: 'supervisor', name: 'مشرف'};
  assert.equal((await call({id: userId, password, confirm: password})).status, 403);
  globalThis.testUser = {userId: 'admin-1', role: 'admin', name: 'مدير'};
  assert.equal((await call({id: userId, password, confirm: password}, 'https://evil.test')).status, 403);
  assert.equal((await (await call({id: userId, password: 'short', confirm: 'short'})).json()).error, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  assert.equal((await (await call({id: userId, password, confirm: 'other-secret-9'})).json()).error, 'كلمتا المرور غير متطابقتين');
  assert.equal(globalThis.writes.length, 0, 'rejected passwords are not written');

  globalThis.userRow = null;
  assert.equal((await call({id: userId, password, confirm: password})).status, 404);
  assert.equal(globalThis.writes.some(row => row.sql.startsWith('UPDATE')), false, 'a missing user is not updated');
  globalThis.writes = [];

  globalThis.userRow = {id: userId};
  const saved = await call({id: userId, password, confirm: password});
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.equal(body.ok, true);
  assert.equal(body.id, userId);
  assert.equal(JSON.stringify(body).includes(password), false);
  assert.equal(JSON.stringify(body).includes('password_hash'), false);

  const lookup = globalThis.writes.find(row => row.sql.startsWith('SELECT'));
  const update = globalThis.writes.find(row => row.sql.startsWith('UPDATE'));
  assert.ok(lookup);
  assert.ok(update);
  assert.doesNotMatch(lookup.sql, /password_hash/);
  assertCollationSafe(lookup.sql);
  const where = update.sql.slice(update.sql.toUpperCase().indexOf('WHERE'));
  assertCollationSafe(where);
  for (const sql of [lookup.sql, where]) {
    assert.match(sql, /id = CAST\(\? AS BINARY\)/);
    assert.doesNotMatch(sql, /CAST\(\s*id\s+AS BINARY\s*\)/i);
  }
  assert.match(update.sql, /SET password_hash = \?/);
  assert.equal(update.args[1], userId);
  assert.notEqual(update.args[0], password);
  assert.equal(await bcrypt.compare(password, update.args[0]), true);
  assert.equal(await bcrypt.compare('old-secret-9', update.args[0]), false);

  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE crm_users(id TEXT PRIMARY KEY, password_hash TEXT)');
  db.prepare('INSERT INTO crm_users (id, password_hash) VALUES (?, ?)').run(userId, 'old-hash');
  db.prepare('INSERT INTO crm_users (id, password_hash) VALUES (?, ?)').run('other', 'keep-me');
  db.prepare(sqliteReportSql(update.sql)).run(...update.args);
  assert.equal(db.prepare('SELECT password_hash FROM crm_users WHERE id=?').get(userId).password_hash, update.args[0]);
  assert.equal(db.prepare('SELECT password_hash FROM crm_users WHERE id=?').get('other').password_hash, 'keep-me');
  db.close();

  console.log('PASS admin password change hashes with bcrypt, hides the old password, and compares the user id with CAST(? AS BINARY)');
} finally {
  rmSync(out, {recursive: true, force: true});
}
