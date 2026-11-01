// A lead registered before the window and dispatched inside it counts.
// A lead registered inside the window and dispatched outside it does not.
// Riyadh bounds stay in JS. No network and no CONVERT_TZ.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {assertCollationSafe, sqliteReportSql} from './sqlite-report-sql.mjs';

const from = '2026-10-25';
const to = '2026-10-31';
const createdEarly = '2026-09-01T08:00:00.000Z';
const dispatchedIn = '2026-10-27T10:00:00.000Z';
const dispatchedOut = '2026-09-01T08:00:00.000Z';

function filters(extra = {}) {
  return {
    q: '', view: '', stage: '', stageNow: false, assignFrom: '', assignTo: '', assignRole: '',
    dispatched: false, fieldEmployee: '', fieldEmployeeName: '', fieldEmployeeUser: '', fieldUnassigned: false,
    from: '', to: '', source: '', sourceExact: false, employee: '', employeeName: '', employeeUser: '',
    stageGroup: '', overdue: false, inactive: false, waiting: false, scheduled: false,
    duplicateOnly: false, newOnly: false, reportRequired: false, legacyUpdates: false, legacyActor: '',
    page: 1, id: '', picklist: false, ...extra,
  };
}

const out = mkdtempSync(join(tmpdir(), 'sas-dispatch-period-'));
try {
  await build({
    entryPoints: ['lib/lead-list.ts', 'lib/reports.ts', 'lib/lead-schema.ts', 'lib/weekly-report.ts', 'lib/legacy-updates.ts'],
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['mysql2/promise', 'server-only'],
  });
  const require = createRequire(import.meta.url);
  const {leadMatchesClientFilters, loadLeadPage} = require(join(out, 'lead-list.js'));
  const {parseReportFilters, readReport, readReportDashboard} = require(join(out, 'reports.js'));
  const {ensureLeadSchema, resetLeadSchemaCache} = require(join(out, 'lead-schema.js'));
  const {buildWeeklyReport} = require(join(out, 'weekly-report.js'));
  const {aggregateLegacyUpdates, legacyUpdateGroupSql} = require(join(out, 'legacy-updates.js'));

  const early = {
    id: 'early', name: 'قديم مفوج', stage: 'field_dispatch', source: 'manual',
    created_at: createdEarly, assigned_to: 'sales-1', field_assigned_to: 'field-1',
    field_dispatched_at: dispatchedIn, first_field_dispatch_at: '2026-09-15T00:00:00.000Z',
  };
  const outside = {
    ...early, id: 'outside', name: 'مفوج قديماً', created_at: dispatchedIn,
    field_dispatched_at: dispatchedOut, first_field_dispatch_at: dispatchedOut,
  };
  const period = filters({stage: 'تفويج للميداني', from, to});
  assert.equal(leadMatchesClientFilters(early, period, new Set(), to, Date.parse(dispatchedIn)), true, 'created 2026-09-01 and dispatched 2026-10-27 is inside 2026-10-25..2026-10-31');
  assert.equal(leadMatchesClientFilters(outside, period, new Set(), to, Date.parse(dispatchedIn)), false, 'created inside the window but dispatched before it is not a dispatch of this period');
  assert.equal(leadMatchesClientFilters(early, filters({dispatched: true, from, to}), new Set(), to, Date.parse(dispatchedIn)), true);

  const sql = new DatabaseSync(':memory:');
  sql.function('JSON_UNQUOTE', value => value);
  sql.exec(`CREATE TABLE leads(
    id TEXT PRIMARY KEY, owner TEXT, created_by TEXT, assigned_to TEXT, field_assigned_to TEXT,
    name TEXT, property_id TEXT, property_other TEXT, source TEXT, stage TEXT, follow_up TEXT,
    created_at TEXT, updated_at TEXT, assigned_at TEXT, field_dispatched_at TEXT, first_field_dispatch_at TEXT,
    field_report TEXT, field_report_at TEXT, field_report_alert_at TEXT
  );
  CREATE TABLE crm_users(id TEXT PRIMARY KEY, name TEXT, username TEXT, role TEXT, active INTEGER, created_at TEXT);
  CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT);
  CREATE INDEX activity_lead_time ON lead_activity (lead_id, created_at);`);
  sql.prepare(`INSERT INTO crm_users (id,name,username,role,active,created_at) VALUES ('sales-1','عهود','ohoud','sales',1,'2026-01-01')`).run();
  sql.prepare(`INSERT INTO crm_users (id,name,username,role,active,created_at) VALUES ('field-1','خالد','khaled','field',1,'2026-01-01')`).run();
  const insert = sql.prepare(`INSERT INTO leads (id,owner,created_by,assigned_to,field_assigned_to,name,property_id,property_other,source,stage,follow_up,created_at,updated_at,assigned_at,field_dispatched_at,first_field_dispatch_at)
    VALUES (?,'root','root',?,?,?,'p','','manual',?,'',?,?,?,?,?)`);
  insert.run('early', 'sales-1', 'field-1', 'قديم', 'field_dispatch', createdEarly, dispatchedIn, createdEarly, dispatchedIn, '2026-09-15T00:00:00.000Z');
  insert.run('outside', 'sales-1', 'field-1', 'خارج', 'field_dispatch', dispatchedIn, dispatchedIn, dispatchedIn, dispatchedOut, dispatchedOut);
  insert.run('fresh', 'sales-1', '', 'جديد', 'new', dispatchedIn, dispatchedIn, null, null, null);
  sql.prepare(`INSERT INTO lead_activity (id,lead_id,user_id,action,details,created_at) VALUES (?,?,?,?,?,?)`).run(
    'act-stage', 'early', 'sales-1', 'stage_changed', JSON.stringify({previousStage: 'interested', stage: 'field_dispatch'}), '2026-10-26T10:00:00.000Z'
  );
  sql.prepare(`INSERT INTO lead_activity (id,lead_id,user_id,action,details,created_at) VALUES (?,?,?,?,?,?)`).run(
    'act-note', 'early', 'field-1', 'stage_note', JSON.stringify({stage: 'field_dispatch', note: 'تمت المكالمة'}), '2026-10-28T10:00:00.000Z'
  );
  sql.prepare(`INSERT INTO lead_activity (id,lead_id,user_id,action,details,created_at) VALUES (?,?,?,?,?,?)`).run(
    'act-fresh', 'fresh', 'sales-1', 'updated', JSON.stringify({stage: 'new'}), '2026-10-28T10:00:00.000Z'
  );
  sql.prepare(`INSERT INTO lead_activity (id,lead_id,user_id,action,details,created_at) VALUES (?,?,?,?,?,?)`).run(
    'act-old', 'early', 'sales-1', 'updated', JSON.stringify({stage: 'interested'}), '2026-09-02T10:00:00.000Z'
  );

  const seen = [];
  const db = {prepare(query) {
    const text = String(query);
    assert.match(text.trim(), /^SELECT/, 'report SQL stays read-only');
    assert.doesNotMatch(text, /CONVERT_TZ\s*\(/i);
    assertCollationSafe(text);
    seen.push(text);
    const runnable = sqliteReportSql(text);
    let args = [];
    return {bind(...values) { args = values; return this; }, async all() { return {results: sql.prepare(runnable).all(...args)}; }};
  }};
  const admin = {userId: 'root', role: 'admin'};
  const reportFilters = parseReportFilters(new URLSearchParams(`from=${from}&to=${to}`));
  const dash = await readReportDashboard(db, admin, reportFilters, new Date('2026-10-31T12:00:00.000Z'));
  const sales = dash.employees.find(row => row.id === 'sales-1');
  const field = dash.employees.find(row => row.id === 'field-1');
  assert.ok(sales && field);
  assert.equal(sales.dispatched, 1, 'the dispatch KPI counts the October dispatch, not the September registration');
  assert.equal(sales.stages.field_dispatch, 1, 'the تفويج column uses the dispatch date');
  assert.equal(field.dispatched, 1);
  assert.equal(field.stages.field_dispatch, 1);
  assert.equal(dash.byStage.find(row => row.stage === 'field_dispatch').count, 1);
  assert.equal(dash.employees.reduce((sum, row) => sum + (row.id === 'outside' ? 1 : 0), 0), 0);
  const listed = await readReport(db, admin, 'leads', {...reportFilters, stage: 'تفويج للميداني'});
  assert.deepEqual(listed.rows.map(row => row.id).sort(), ['early'], 'the leads report keeps the early registration and drops the old dispatch');

  const legacy = dash.legacyUpdates.find(row => row.id === 'sales-1');
  const fieldNote = dash.legacyUpdates.find(row => row.id === 'field-1');
  assert.ok(legacy, 'the old-client table has the employee who changed the stage');
  assert.equal(legacy.leads, 1);
  assert.equal(legacy.stageChanges, 1);
  assert.equal(legacy.notes, 0);
  assert.equal(fieldNote.leads, 1);
  assert.equal(fieldNote.notes, 1);
  assert.equal(dash.legacyUpdates.some(row => row.leads && row.name === 'جديد'), false);
  assert.ok(seen.some(query => query.includes('GROUP BY a.user_id, a.lead_id, a.action')));
  assert.ok(seen.some(query => query.includes('activity') || query.includes('a.lead_id')));
  const grouped = legacyUpdateGroupSql(from, to);
  assert.doesNotMatch(grouped.sql, /CONVERT_TZ\s*\(/i);
  assertCollationSafe(grouped.sql);
  assert.match(grouped.sql, /a\.lead_id = CAST\(l\.id AS BINARY\)/);

  const page = await loadLeadPage(db, admin, filters({legacyUpdates: true, from, to, legacyActor: 'sales-1'}), false);
  assert.deepEqual(page.leads.map(lead => lead.id), ['early'], 'the drill-down lists the old lead updated in the period');
  const everyone = await loadLeadPage(db, admin, filters({legacyUpdates: true, from, to}), false);
  assert.deepEqual(everyone.leads.map(lead => lead.id).sort(), ['early']);

  const folded = aggregateLegacyUpdates({
    events: [
      {userId: 'sales-1', leadId: 'early', action: 'stage_changed', count: 2, stage: 'field_dispatch', source: 'manual'},
      {userId: 'sales-1', leadId: 'early', action: 'updated', count: 1, stage: 'field_dispatch', source: 'manual'},
      {userId: 'field-1', leadId: 'fresh', action: 'stage_note', count: 1, stage: 'new', source: 'tiktok'},
    ],
    users: [{id: 'sales-1', name: 'عهود', username: 'ohoud', role: 'sales'}, {id: 'field-1', name: 'خالد', username: 'khaled', role: 'field'}],
    source: 'manual',
  });
  assert.equal(folded.rows.length, 1);
  assert.equal(folded.rows[0].stageChanges, 2);
  assert.equal(folded.rows[0].statusUpdates, 1);
  assert.equal(folded.rows[0].total, 3);
  assert.equal(folded.totals.leads, 1);

  const weekly = buildWeeklyReport(
    [early, outside],
    [{id: 'sales-1', name: 'عهود', username: 'ohoud', role: 'sales'}, {id: 'field-1', name: 'خالد', username: 'khaled', role: 'field'}],
    from,
    to,
    to,
    folded.rows,
  );
  assert.equal(weekly.dispatched, 1, 'the email counts the dispatch inside the period');
  assert.equal(weekly.employees.find(row => row.name === 'خالد').stages.field_dispatch, 1);
  assert.equal(weekly.employees.find(row => row.name === 'خالد').dispatched, 1);
  assert.equal(weekly.legacyUpdates[0].name, 'عهود');

  const mem = new DatabaseSync(':memory:');
  mem.exec(`CREATE TABLE leads(
    id TEXT PRIMARY KEY, stage TEXT, assigned_to TEXT, field_assigned_to TEXT,
    field_dispatched_at TEXT, first_field_dispatch_at TEXT, assigned_at TEXT,
    updated_at TEXT, created_at TEXT, name TEXT, phone TEXT
  );
  CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT);
  CREATE TABLE crm_schema_meta(name TEXT PRIMARY KEY, applied_at TEXT);
  INSERT INTO crm_schema_meta (name, applied_at) VALUES
    ('first_field_dispatch_at_v1', '2026-10-01T00:00:00.000Z'),
    ('first_field_dispatch_at_null_v2', '2026-10-02T00:00:00.000Z'),
    ('assigned_at_backfill_v1', '2026-10-01T00:00:00.000Z'),
    ('assigned_at_null_v2', '2026-10-02T00:00:00.000Z'),
    ('field_report_dispatch_v1', '2026-10-02T00:00:00.000Z');`);
  mem.prepare(`INSERT INTO leads (id,stage,assigned_to,field_assigned_to,field_dispatched_at,first_field_dispatch_at,assigned_at,updated_at,created_at,name,phone)
    VALUES ('blank','field_dispatch','sales-1','field-1',NULL,NULL,'2026-09-01T00:00:00.000Z','2026-09-02T00:00:00.000Z','2026-09-01T08:00:00.000Z','فارغ','0550000001')`).run();
  mem.prepare(`INSERT INTO leads (id,stage,assigned_to,field_assigned_to,field_dispatched_at,first_field_dispatch_at,assigned_at,updated_at,created_at,name,phone)
    VALUES ('kept','negotiation','sales-1','field-1','2026-08-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z','2026-10-13T00:00:00.000Z','2026-01-01T00:00:00.000Z','محفوظ','0550000002')`).run();
  mem.prepare(`INSERT INTO lead_activity (id,lead_id,user_id,action,details,created_at) VALUES (?,?,?,?,?,?)`).run(
    'hist', 'blank', 'sales-1', 'stage_changed', JSON.stringify({previousStage: 'interested', stage: 'field_dispatch'}), dispatchedIn
  );
  resetLeadSchemaCache();
  const executor = {async execute(query, values = []) {
    const text = sqliteReportSql(String(query).trim());
    if (/^(SHOW|SET SESSION)\b/i.test(text)) throw Error('near SHOW: syntax error');
    if (/^SELECT/i.test(text)) return [mem.prepare(text).all(...values)];
    const result = mem.prepare(text).run(...values);
    return [{affectedRows: Number(result.changes || 0)}];
  }};
  await ensureLeadSchema(executor);
  const blank = mem.prepare('SELECT field_dispatched_at, first_field_dispatch_at, created_at FROM leads WHERE id = ?').get('blank');
  assert.equal(blank.first_field_dispatch_at, dispatchedIn, 'a NULL first dispatch is filled from stage history');
  assert.equal(blank.field_dispatched_at, dispatchedIn, 'a NULL latest dispatch is filled from the same history');
  assert.notEqual(blank.first_field_dispatch_at, blank.created_at);
  const kept = mem.prepare('SELECT field_dispatched_at, first_field_dispatch_at FROM leads WHERE id = ?').get('kept');
  assert.equal(kept.first_field_dispatch_at, '2026-01-01T00:00:00.000Z');
  assert.equal(kept.field_dispatched_at, '2026-08-01T00:00:00.000Z');
  assert.ok(mem.prepare(`SELECT name FROM crm_schema_meta WHERE name = 'dispatch_stamps_null_v3'`).get());

  const panel = readFileSync('app/crm/reports-panel.tsx', 'utf8');
  const css = readFileSync('app/crm/crm.css', 'utf8');
  const weeklySource = readFileSync('lib/weekly-report.ts', 'utf8');
  const schema = readFileSync('lib/lead-schema.ts', 'utf8');
  assert.doesNotMatch(panel, /نشاط الموظفين/);
  assert.doesNotMatch(weeklySource, /نشاط الموظفين/);
  assert.match(panel, /تحديثات العملاء القدامى/);
  assert.match(weeklySource, /تحديثات العملاء القدامى/);
  assert.match(css, /background:\s*transparent !important/);
  assert.match(css, /color:\s*#fff !important/);
  assert.match(css, /thead button/);
  assert.doesNotMatch(css, /\.reports-stage-matrix\{min-width:1180px\}/);
  assert.match(css, /position:\s*sticky/);
  assert.match(schema, /dispatch_stamps_null_v3/);
  assert.doesNotMatch(readFileSync('lib/reports.ts', 'utf8'), /CONVERT_TZ\s*\(/);
  assert.doesNotMatch(readFileSync('lib/legacy-updates.ts', 'utf8'), /CONVERT_TZ\s*\(/);

  console.log('PASS dispatch period uses the dispatch date, old-client updates group once, and header buttons stay readable');
} finally {
  rmSync(out, {recursive: true, force: true});
}
