// Stage notes append. Same-stage saves must not replace older notes.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

process.env.npm_lifecycle_event = 'test';
process.env.NEXTAUTH_URL = 'https://sas.test';
process.env.NEXTAUTH_SECRET = 'test-only-secret-that-is-not-used-in-production';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.DB_HOST = 'test';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'test';

const stageRouteSource = readFileSync(new URL('../app/api/leads/[id]/stage/route.ts', import.meta.url), 'utf8');
assert.match(stageRouteSource, /STAGE_NOTE_INSERT_SQL/);
assert.doesNotMatch(stageRouteSource, /UPDATE lead_stage_notes|sendMail|assignment-email|assignment-notify/);
assert.doesNotMatch(stageRouteSource, /if \(stage === previousStage\) return/);

const out = mkdtempSync(join(tmpdir(), 'sas-stage-notes-'));
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE leads(
  id TEXT PRIMARY KEY, owner TEXT, created_by TEXT, assigned_to TEXT, field_assigned_to TEXT,
  name TEXT, phone TEXT, property_id TEXT, property_other TEXT, source TEXT, stage TEXT,
  notes TEXT, follow_up TEXT, created_at TEXT, updated_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE crm_users(
  id TEXT PRIMARY KEY, name TEXT, username TEXT, role TEXT, active INTEGER, email TEXT, phone TEXT
);
CREATE TABLE lead_activity(
  id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT
);
`);

const leadId = '11111111-1111-4111-8111-111111111111';
const salesLeadId = '22222222-2222-4222-8222-222222222222';
const oldActivity = '33333333-3333-4333-8333-333333333333';
db.prepare(`INSERT INTO crm_users (id,name,username,role,active,email) VALUES (?,?,?,?,1,?)`).run('user-admin', 'أحمد المدير', 'admin', 'admin', 'admin@sas.test');
db.prepare(`INSERT INTO crm_users (id,name,username,role,active,email) VALUES (?,?,?,?,1,?)`).run('sales-1', 'سارة', 'sales.1', 'sales', 'sales1@sas.test');
db.prepare(`INSERT INTO crm_users (id,name,username,role,active,email) VALUES (?,?,?,?,1,?)`).run('sales-2', 'خالد', 'sales.2', 'sales', 'sales2@sas.test');
db.prepare(`INSERT INTO leads (id,owner,created_by,assigned_to,field_assigned_to,name,phone,property_id,property_other,source,stage,notes,follow_up,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  leadId, 'user-admin', 'user-admin', 'sales-1', '', 'عميل التواصل', '0550000001', 'other', '', 'manual', 'contacted', '', '', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'
);
db.prepare(`INSERT INTO leads (id,owner,created_by,assigned_to,field_assigned_to,name,phone,property_id,property_other,source,stage,notes,follow_up,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  salesLeadId, 'user-admin', 'user-admin', 'sales-1', '', 'عميل سارة', '0550000002', 'other', '', 'manual', 'contacted', '', '', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'
);
db.prepare(`INSERT INTO lead_activity (id,lead_id,user_id,action,details,created_at) VALUES (?,?,?,?,?,?)`).run(
  oldActivity, leadId, 'user-admin', 'stage_changed',
  JSON.stringify({previousStage: 'new', stage: 'contacted', note: 'ملاحظة قديمة'}),
  '2026-10-01T08:00:00.000Z'
);

globalThis.qaUser = null;
globalThis.qaPool = {async execute(sql, values = []) {
  const text = String(sql).trim();
  if (text.startsWith('SHOW')) throw Error('near SHOW: syntax error');
  if (text.startsWith('SELECT')) return [db.prepare(text).all(...values)];
  return [{affectedRows: Number(db.prepare(text).run(...values).changes)}];
}};

const boundary = {name: 'stage-notes-boundary', setup(b) {
  b.onResolve({filter: /[\\/]admin$/}, () => ({path: 'auth', namespace: 'test'}));
  b.onResolve({filter: /^mysql2\/promise$/}, () => ({path: 'db', namespace: 'test'}));
  b.onResolve({filter: /^server-only$/}, () => ({path: 'guard', namespace: 'test'}));
  b.onLoad({filter: /.*/, namespace: 'test'}, args => ({loader: 'js', contents: args.path === 'auth'
    ? 'export async function getCrmUser(){return globalThis.qaUser} export async function getAdmin(){return globalThis.qaUser}'
    : args.path === 'db'
      ? 'export default {createPool(){return globalThis.qaPool}}'
      : ''}));
}};

await build({entryPoints: ['app/api/leads/[id]/stage/route.ts'], outfile: join(out, 'stage.cjs'), bundle: true, platform: 'node', format: 'cjs', plugins: [boundary]});
await build({entryPoints: ['app/api/leads/[id]/stage-notes/route.ts'], outfile: join(out, 'notes.cjs'), bundle: true, platform: 'node', format: 'cjs', plugins: [boundary]});
const stageApi = createRequire(import.meta.url)(join(out, 'stage.cjs'));
const notesApi = createRequire(import.meta.url)(join(out, 'notes.cjs'));

function asUser(userId, role, name) {
  globalThis.qaUser = {userId, role, name, username: userId, email: `${userId}@sas.test`};
}
function patch(id, body) {
  return stageApi.PATCH(new Request(`https://sas.test/api/leads/${id}/stage`, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  }), {params: Promise.resolve({id})});
}
function listNotes(id) {
  return notesApi.GET(new Request(`https://sas.test/api/leads/${id}/stage-notes`), {params: Promise.resolve({id})});
}

asUser('user-admin', 'admin', 'أحمد المدير');
assert.equal((await patch(leadId, {stage: 'contacted', note: ''})).status, 400);
assert.equal((await patch(leadId, {stage: 'contacted', note: 'ملاحظة ثانية'})).status, 200);
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal((await patch(leadId, {stage: 'contacted', note: 'ملاحظة ثالثة'})).status, 200);
let stored = db.prepare('SELECT note_text, stage, by_name, by_user_id FROM lead_stage_notes WHERE lead_id = ? ORDER BY created_at ASC, id ASC').all(leadId);
assert.deepEqual(stored.map(row => row.note_text), ['ملاحظة قديمة', 'ملاحظة ثانية', 'ملاحظة ثالثة']);
assert.deepEqual(stored.map(row => row.stage), ['contacted', 'contacted', 'contacted']);
assert.equal(stored.find(row => row.note_text === 'ملاحظة ثانية').by_name, 'أحمد المدير');
assert.equal(stored.find(row => row.note_text === 'ملاحظة ثانية').by_user_id, 'user-admin');
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lead_activity WHERE lead_id = ? AND action = 'stage_changed'").get(leadId).n, 1);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lead_activity WHERE lead_id = ? AND action = 'stage_note'").get(leadId).n, 2);
assert.equal(db.prepare('SELECT stage FROM leads WHERE id = ?').get(leadId).stage, 'contacted');

await new Promise(resolve => setTimeout(resolve, 5));
assert.equal((await patch(leadId, {stage: 'interested', note: 'يريد العرض'})).status, 200);
assert.equal(db.prepare('SELECT stage FROM leads WHERE id = ?').get(leadId).stage, 'interested');
stored = db.prepare('SELECT note_text, stage FROM lead_stage_notes WHERE lead_id = ? ORDER BY created_at ASC, id ASC').all(leadId);
assert.deepEqual(stored.map(row => row.note_text), ['ملاحظة قديمة', 'ملاحظة ثانية', 'ملاحظة ثالثة', 'يريد العرض']);
assert.deepEqual(stored.map(row => row.stage), ['contacted', 'contacted', 'contacted', 'interested']);
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lead_activity WHERE lead_id = ? AND action = 'stage_changed'").get(leadId).n, 2);
assert.equal((await patch(leadId, {stage: 'nope'})).status, 400);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_stage_notes WHERE lead_id = ?').get(leadId).n, 4);

const listed = await (await listNotes(leadId)).json();
assert.deepEqual(listed.map(row => row.text), ['يريد العرض', 'ملاحظة ثالثة', 'ملاحظة ثانية', 'ملاحظة قديمة']);
assert.equal(listed[0].stage, 'interested');
assert.equal(listed[0].byName, 'أحمد المدير');
assert.equal(listed[3].byName, 'أحمد المدير');
assert.ok(listed[0].at);
assert.equal((await listNotes(leadId)).status, 200);

asUser('sales-2', 'sales', 'خالد');
assert.equal((await patch(salesLeadId, {stage: 'contacted', note: 'ليست لخالد'})).status, 403);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_stage_notes WHERE lead_id = ?').get(salesLeadId).n, 0);
asUser('sales-1', 'sales', 'سارة');
assert.equal((await patch(salesLeadId, {stage: 'contacted', note: 'ملاحظة سارة'})).status, 200);
await new Promise(resolve => setTimeout(resolve, 5));
assert.equal((await patch(salesLeadId, {stage: 'contacted', note: 'متابعة سارة'})).status, 200);
const salesNotes = db.prepare('SELECT note_text, by_name, stage FROM lead_stage_notes WHERE lead_id = ? ORDER BY created_at ASC').all(salesLeadId);
assert.deepEqual(salesNotes.map(row => row.note_text), ['ملاحظة سارة', 'متابعة سارة']);
assert.deepEqual(salesNotes.map(row => row.by_name), ['سارة', 'سارة']);
assert.equal((await listNotes(salesLeadId)).status, 200);
asUser('sales-2', 'sales', 'خالد');
assert.equal((await listNotes(salesLeadId)).status, 403);
globalThis.qaUser = null;
assert.equal((await patch(leadId, {stage: 'interested', note: 'بلا دخول'})).status, 401);

db.close();
rmSync(out, {recursive: true, force: true});
console.log('PASS stage notes append on the same stage, keep prior stages, and مهتم is writable by sales and admin');
