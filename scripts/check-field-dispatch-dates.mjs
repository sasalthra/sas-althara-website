// Field-dispatch search dates use the dispatch stamp in Asia/Riyadh, not created_at.
// The null refill still runs after the first migration marker. No network and no CONVERT_TZ.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {assertCollationSafe, sqliteReportSql} from './sqlite-report-sql.mjs';

const today = '2026-10-13';
const riyadhNoon = Date.parse('2026-10-13T12:00:00.000Z');

function filters(extra) {
  return {
    q: '',
    view: '',
    stage: '',
    stageNow: false,
    assignFrom: '',
    assignTo: '',
    assignRole: '',
    from: '',
    to: '',
    source: '',
    sourceExact: false,
    employee: '',
    employeeName: '',
    employeeUser: '',
    stageGroup: '',
    overdue: false,
    inactive: false,
    waiting: false,
    scheduled: false,
    duplicateOnly: false,
    newOnly: false,
    reportRequired: false,
    page: 1,
    id: '',
    picklist: false,
    ...extra,
  };
}

const out = mkdtempSync(join(tmpdir(), 'sas-dispatch-dates-'));
try {
  await build({
    entryPoints: ['lib/lead-list.ts', 'lib/reports.ts', 'lib/lead-dates.ts', 'lib/lead-schema.ts'],
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['mysql2/promise'],
  });
  const require = createRequire(import.meta.url);
  const {leadMatchesClientFilters} = require(join(out, 'lead-list.js'));
  const {riyadhDayKey} = require(join(out, 'lead-dates.js'));
  const {parseReportFilters, readReport, readAssignmentCounts, readEmployeeAssignmentReport} = require(join(out, 'reports.js'));
  const {ensureLeadSchema, resetLeadSchemaCache, schemaDiagnostics} = require(join(out, 'lead-schema.js'));

  assert.equal(riyadhDayKey(new Date('2026-10-12T21:00:00.000Z')), '2026-10-13', 'Riyadh midnight is 21:00 UTC the previous day');
  assert.equal(riyadhDayKey(new Date('2026-10-13T20:59:59.000Z')), '2026-10-13', '23:59 Riyadh is still the same day');
  assert.equal(riyadhDayKey(new Date('2026-10-13T21:00:00.000Z')), '2026-10-14', 'the next Riyadh day opens at 21:00 UTC');
  const defaults = parseReportFilters(new URLSearchParams(), new Date('2026-10-13T21:30:00.000Z'));
  assert.equal(defaults.to, '2026-10-14', 'report "today" is the Asia/Riyadh day, computed in JS');

  const period = filters({stage: 'تفويج للميداني', from: today, to: today});
  const base = {
    id: 'lead-1',
    name: 'عميل مفوج',
    stage: 'negotiation',
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-10-13T08:00:00.000Z',
    field_assigned_to: 'field-1',
    field_dispatched_at: '2026-10-13T08:00:00.000Z',
    first_field_dispatch_at: '2026-09-01T00:00:00.000Z',
  };
  assert.equal(leadMatchesClientFilters(base, period, new Set(), today, riyadhNoon), true, 'dispatched today matches even when the lead was registered earlier');
  assert.equal(
    leadMatchesClientFilters({...base, field_dispatched_at: '2026-09-01T08:00:00.000Z', first_field_dispatch_at: '2026-10-13T08:00:00.000Z', created_at: '2026-10-13T08:00:00.000Z'}, period, new Set(), today, riyadhNoon),
    false,
    'an older latest dispatch is the date, not created_at and not an earlier first stamp'
  );
  assert.equal(
    leadMatchesClientFilters({...base, field_dispatched_at: '', first_field_dispatch_at: '2026-10-13T08:00:00.000Z'}, period, new Set(), today, riyadhNoon),
    true,
    'a missing latest stamp falls back to the first dispatch'
  );
  assert.equal(
    leadMatchesClientFilters({...base, field_dispatched_at: '2026-10-12T21:30:00.000Z', first_field_dispatch_at: ''}, period, new Set(), today, riyadhNoon),
    true,
    '00:30 Asia/Riyadh is still today'
  );
  assert.equal(
    leadMatchesClientFilters({...base, field_dispatched_at: '2026-10-13T20:59:59.000Z'}, period, new Set(), today, riyadhNoon),
    true,
    '23:59 Asia/Riyadh is still today'
  );
  assert.equal(
    leadMatchesClientFilters({...base, field_dispatched_at: '2026-10-13T21:00:00.000Z'}, period, new Set(), today, riyadhNoon),
    false,
    '00:00 the next Asia/Riyadh day is not today'
  );
  assert.equal(
    leadMatchesClientFilters({...base, stage: 'field_dispatch'}, filters({...period, stageNow: true}), new Set(), today, riyadhNoon),
    true,
    'the current-stage drill-down also dates the dispatch'
  );
  assert.equal(
    leadMatchesClientFilters(base, filters({...period, stageNow: true}), new Set(), today, riyadhNoon),
    false,
    'stageNow still requires the lead to be in تفويج للميداني now'
  );
  assert.equal(
    leadMatchesClientFilters(base, filters({stage: 'تفويج للميداني'}), new Set(), today, riyadhNoon),
    true,
    'without a period, ever-dispatched leads stay visible'
  );
  assert.equal(
    leadMatchesClientFilters(base, filters({stage: 'مهتم', from: today, to: today}), new Set(), today, riyadhNoon),
    false,
    'other stages still use created_at'
  );

  const sql = new DatabaseSync(':memory:');
  sql.function('JSON_UNQUOTE', value => value);
  sql.exec(`CREATE TABLE leads(
    id TEXT PRIMARY KEY, owner TEXT, created_by TEXT, assigned_to TEXT, field_assigned_to TEXT,
    name TEXT, property_id TEXT, property_other TEXT, source TEXT, stage TEXT, follow_up TEXT,
    created_at TEXT, updated_at TEXT, assigned_at TEXT, field_dispatched_at TEXT, first_field_dispatch_at TEXT
  );
  CREATE TABLE crm_users(id TEXT PRIMARY KEY, name TEXT, username TEXT, role TEXT, active INTEGER, created_at TEXT);
  CREATE TABLE lead_activity(id TEXT, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT);`);
  sql.prepare(`INSERT INTO crm_users (id,name,username,role,active,created_at) VALUES ('field-1','خالد','field.1','field',1,'2026-01-01')`).run();
  sql.prepare(`INSERT INTO crm_users (id,name,username,role,active,created_at) VALUES ('sales-1','عهود','ohoud','sales',1,'2026-01-01')`).run();
  const insert = sql.prepare(`INSERT INTO leads (id,owner,created_by,assigned_to,field_assigned_to,name,property_id,property_other,source,stage,follow_up,created_at,updated_at,assigned_at,field_dispatched_at,first_field_dispatch_at)
    VALUES (?,'root','root',?,?,?,'p','','manual',?,'',?,?,?,?,?)`);
  insert.run('d1', 'sales-1', 'field-1', 'd1', 'field_dispatch', '2026-09-01T08:00:00.000Z', '2026-10-13T08:00:00.000Z', null, '2026-10-13T08:00:00.000Z', '2026-09-01T00:00:00.000Z');
  insert.run('d2', 'sales-1', 'field-1', 'd2', 'field_dispatch', '2026-10-13T08:00:00.000Z', '2026-10-13T08:00:00.000Z', null, '2026-09-01T08:00:00.000Z', '2026-10-13T08:00:00.000Z');
  insert.run('d3', 'sales-1', 'field-1', 'd3', 'field_dispatch', '2026-09-01T08:00:00.000Z', '2026-10-13T08:00:00.000Z', null, null, '2026-10-13T08:00:00.000Z');
  insert.run('d4', 'sales-1', 'field-1', 'd4', 'field_dispatch', '2026-09-01T08:00:00.000Z', '2026-10-13T08:00:00.000Z', null, '2026-10-12T21:30:00.000Z', null);
  insert.run('d5', 'sales-1', 'field-1', 'd5', 'field_dispatch', '2026-09-01T08:00:00.000Z', '2026-10-13T08:00:00.000Z', null, '2026-10-13T21:00:00.000Z', null);
  insert.run('s1', 'sales-1', '', 's1', 'negotiation', '2026-09-01T00:00:00.000Z', '2026-10-13T08:00:00.000Z', '2026-10-12T21:30:00.000Z', null, null);
  insert.run('s2', 'sales-1', '', 's2', 'negotiation', '2026-10-13T08:00:00.000Z', '2026-10-13T08:00:00.000Z', '2026-09-01T08:00:00.000Z', null, null);

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
  const reportFilters = parseReportFilters(new URLSearchParams(`from=${today}&to=${today}&stage=${encodeURIComponent('تفويج للميداني')}`));
  const report = await readReport(db, admin, 'leads', reportFilters);
  const ids = report.rows.map(row => row.id).sort();
  assert.deepEqual(ids, ['d1', 'd3', 'd4'], 'the leads report dates تفويج للميداني by the dispatch, on Riyadh day bounds');
  assert.ok(seen.some(query => query.includes('l.field_dispatched_at') && query.includes('l.first_field_dispatch_at')));
  assert.equal(seen.some(query => /CONVERT_TZ/i.test(query)), false);

  const assigned = await readAssignmentCounts(db, today, today, 'sales-1');
  assert.equal(assigned.unavailable, false);
  assert.equal(assigned.total, 1, 'sales assignment counts the Riyadh day of assigned_at, not created_at');
  const fieldAssign = await readEmployeeAssignmentReport(db, admin, {...reportFilters, employee: 'field-1', stage: ''});
  assert.equal(fieldAssign.status, 'ok');
  assert.equal(fieldAssign.total, 3, 'field assignment counts use the dispatch date in Asia/Riyadh');

  const mem = new DatabaseSync(':memory:');
  mem.exec(`CREATE TABLE leads(
    id TEXT PRIMARY KEY, stage TEXT, assigned_to TEXT, field_assigned_to TEXT,
    field_dispatched_at TEXT, first_field_dispatch_at TEXT, assigned_at TEXT,
    updated_at TEXT, created_at TEXT, name TEXT, phone TEXT
  );
  CREATE TABLE lead_activity(
    id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT
  );
  CREATE TABLE crm_schema_meta(name TEXT PRIMARY KEY, applied_at TEXT);
  INSERT INTO crm_schema_meta (name, applied_at) VALUES
    ('first_field_dispatch_at_v1', '2026-10-01T00:00:00.000Z'),
    ('assigned_at_backfill_v1', '2026-10-01T00:00:00.000Z');`);
  mem.prepare(`INSERT INTO leads (id,stage,assigned_to,field_assigned_to,field_dispatched_at,first_field_dispatch_at,assigned_at,updated_at,created_at,name,phone)
    VALUES ('missed','negotiation','sales-1','',NULL,NULL,NULL,'2026-01-02T00:00:00.000Z','2026-01-01T00:00:00.000Z','فائت','0550000099')`).run();
  mem.prepare(`INSERT INTO leads (id,stage,assigned_to,field_assigned_to,field_dispatched_at,first_field_dispatch_at,assigned_at,updated_at,created_at,name,phone)
    VALUES ('kept','field_dispatch','sales-1','field-1','2026-08-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z','2026-10-13T00:00:00.000Z','2026-01-01T00:00:00.000Z','محفوظ','0550000098')`).run();
  mem.prepare(`INSERT INTO lead_activity (id,lead_id,action,details,created_at) VALUES (?,?,?,?,?)`).run(
    'act-dispatch', 'missed', 'stage_changed', JSON.stringify({previousStage: 'contacted', stage: 'field_dispatch'}), '2026-10-13T09:00:00.000Z'
  );
  mem.prepare(`INSERT INTO lead_activity (id,lead_id,action,details,created_at) VALUES (?,?,?,?,?)`).run(
    'act-assign', 'missed', 'assigned', JSON.stringify({assignedTo: 'sales-1'}), '2026-10-13T07:00:00.000Z'
  );
  mem.prepare(`INSERT INTO lead_activity (id,lead_id,action,details,created_at) VALUES (?,?,?,?,?)`).run(
    'act-later', 'kept', 'field_dispatched', JSON.stringify({fieldAssignedTo: 'field-1'}), '2026-10-13T09:00:00.000Z'
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
  const missed = mem.prepare('SELECT first_field_dispatch_at, assigned_at FROM leads WHERE id = ?').get('missed');
  assert.equal(missed.first_field_dispatch_at, '2026-10-13T09:00:00.000Z', 'a NULL dispatch stamp is filled even when the v1 marker exists');
  assert.equal(missed.assigned_at, '2026-10-13T07:00:00.000Z', 'a NULL assignment stamp is filled even when the v1 marker exists');
  const kept = mem.prepare('SELECT first_field_dispatch_at, assigned_at, field_dispatched_at FROM leads WHERE id = ?').get('kept');
  assert.equal(kept.first_field_dispatch_at, '2026-01-01T00:00:00.000Z', 'an existing first dispatch is not overwritten');
  assert.equal(kept.assigned_at, '2026-01-02T00:00:00.000Z', 'an existing assignment time is not overwritten');
  assert.ok(mem.prepare(`SELECT name FROM crm_schema_meta WHERE name = 'first_field_dispatch_at_null_v2'`).get());
  assert.ok(mem.prepare(`SELECT name FROM crm_schema_meta WHERE name = 'assigned_at_null_v2'`).get());
  assert.equal(schemaDiagnostics().some(issue => /1267|collation/i.test(issue.detail)), false);

  const files = {
    schema: readFileSync('lib/lead-schema.ts', 'utf8'),
    stamps: readFileSync('lib/lead-stamps.ts', 'utf8'),
    dispatch: readFileSync('app/api/leads/[id]/dispatch/route.ts', 'utf8'),
    stage: readFileSync('app/api/leads/[id]/stage/route.ts', 'utf8'),
    api: readFileSync('app/api/leads/route.ts', 'utf8'),
    bulk: readFileSync('lib/bulk-leads.ts', 'utf8'),
    reports: readFileSync('lib/reports.ts', 'utf8'),
    cohorts: readFileSync('lib/lead-cohorts.ts', 'utf8'),
    dates: readFileSync('lib/lead-dates.ts', 'utf8'),
  };
  for (const source of Object.values(files)) assert.doesNotMatch(source, /CONVERT_TZ\s*\(/);
  assert.match(files.schema, /first_field_dispatch_at_null_v2/);
  assert.match(files.schema, /assigned_at_null_v2/);
  assert.match(files.schema, /first_field_dispatch_at_v1/);
  assert.match(files.schema, /assigned_at_backfill_v1/);
  assert.doesNotMatch(files.schema, /migrationApplied\(executor, FIRST_DISPATCH_MIGRATION\)\) return/);
  assert.doesNotMatch(files.schema, /migrationApplied\(executor, ASSIGNED_AT_MIGRATION\)\) return/);
  assert.match(files.dispatch, /first_field_dispatch_at/);
  assert.match(files.dispatch, /field_dispatched_at/);
  assert.match(files.stage, /first_field_dispatch_at/);
  assert.match(files.stage, /field_dispatched_at/);
  assert.match(files.api, /rememberAssignedAt/);
  assert.match(files.api, /rememberFieldDispatch/);
  assert.match(files.bulk, /assigned_at/);
  assert.match(files.reports, /dispatchDateWindow/);
  assert.match(files.cohorts, /fieldDispatchMoment/);
  assert.match(files.dates, /Asia\/Riyadh/);

  console.log('PASS field dispatch dates use the Riyadh dispatch stamp and null stamps refill');
} finally {
  rmSync(out, {recursive: true, force: true});
}
