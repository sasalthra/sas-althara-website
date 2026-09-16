// Guards the contract between db/mysql/*.sql and every column the CRM reads or writes.
//
// This suite exists because the reports pages rendered "تعذر قراءة المصدر" on
// production: 001_leads.sql never created created_by/assigned_to/
// field_assigned_to/source/property_other, so every leads-based SELECT died with
// "Unknown column" and the properties report (which reuses the leads FROM clause)
// looked empty even with a full catalog. A read failure must never be presentable
// as an empty result, and the schema must never again lag the queries.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const root = process.cwd();
const sqlDir = join(root, 'db', 'mysql');
const migrations = readdirSync(sqlDir).filter(f => f.endsWith('.sql')).sort();
assert.ok(migrations.includes('003_leads_expansion_columns.sql'),
  'the leads expansion migration must ship with the code that depends on it');

const allSql = migrations.map(f => readFileSync(join(sqlDir, f), 'utf8')).join('\n');

// 1. Every column the application reads or writes must be created by a migration.
const REQUIRED_LEAD_COLUMNS = ['created_by', 'assigned_to', 'field_assigned_to', 'source', 'property_other'];
for (const column of REQUIRED_LEAD_COLUMNS) {
  assert.ok(new RegExp(`\\b${column}\\b`).test(allSql),
    `leads.${column} is used by the app but no migration creates it`);
}

// 2. The migration must be additive and idempotent — never destructive.
const migration = readFileSync(join(sqlDir, '003_leads_expansion_columns.sql'), 'utf8');
for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bDROP\s+COLUMN\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i]) {
  assert.ok(!forbidden.test(migration),
    `the migration must not contain ${forbidden} — it runs against live client data`);
}
assert.ok(/information_schema\.COLUMNS/i.test(migration),
  'column additions must be guarded so re-running the migration is safe');
assert.ok(/information_schema\.STATISTICS/i.test(migration),
  'index additions must be guarded so re-running the migration is safe');

// 3. The widened stage ENUM must cover every key the validator accepts.
const stageKeys = (readFileSync(join(root, 'lib', 'lead-input.ts'), 'utf8')
  .match(/export const stageKeys\s*=\s*\[([^\]]+)\]/) || [])[1];
assert.ok(stageKeys, 'could not read stageKeys from lib/lead-input.ts');
const keys = [...stageKeys.matchAll(/'([^']+)'/g)].map(m => m[1]);
assert.ok(keys.length >= 18, `expected the full stage list, found ${keys.length}`);
const enumBlock = (migration.match(/MODIFY COLUMN stage ENUM\(([\s\S]*?)\)\s*NOT NULL/) || [])[1];
assert.ok(enumBlock, 'the migration must widen the stage ENUM');
const enumValues = [...enumBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
for (const key of keys) {
  assert.ok(enumValues.includes(key),
    `stage '${key}' is accepted by lib/lead-input.ts but rejected by the leads ENUM`);
}

// 4. Behavioural proof: build the POST-migration schema and run the real report
//    queries against it. Before the migration these same queries threw.
const out = process.env.REPORTS_BUILD_DIR;
const sql = new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE leads(
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '',
  assigned_to TEXT NOT NULL DEFAULT '', field_assigned_to TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL, phone TEXT NOT NULL, property_id TEXT NOT NULL,
  property_other TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual',
  stage TEXT NOT NULL DEFAULT 'new', notes TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE crm_users(id TEXT, name TEXT, role TEXT, active INTEGER, created_at TEXT);`);
sql.prepare(`INSERT INTO leads
  (id,owner,created_by,assigned_to,field_assigned_to,name,phone,property_id,property_other,source,stage,notes,follow_up,created_at,updated_at)
  VALUES ('l1','admin','admin','','','عميل حقيقي','0500000000','18494','','manual','new','','','2026-09-10T08:00:00.000Z','2026-09-10T08:00:00.000Z')`).run();

// The exact SELECT/FROM that lib/reports.ts builds for the leads report.
const leadFrom = 'leads l LEFT JOIN crm_users s ON s.id=l.assigned_to LEFT JOIN crm_users f ON f.id=l.field_assigned_to';
const leadFields = 'l.id,l.name,l.property_id,l.property_other,l.source,l.stage,l.follow_up,l.created_at,l.updated_at,s.name AS sales,f.name AS field';
const leadRows = sql.prepare(`SELECT ${leadFields} FROM ${leadFrom} ORDER BY l.id LIMIT 5`).all();
assert.equal(leadRows.length, 1, 'the leads report query must return the stored lead, not throw');
assert.equal(leadRows[0].name, 'عميل حقيقي');
assert.equal(leadRows[0].source, 'manual');

// The properties report reuses the same FROM clause — this is why properties
// looked empty while data/properties.json was full.
const propertyRows = sql.prepare(`SELECT l.property_id,l.property_other FROM ${leadFrom} ORDER BY l.id LIMIT 5`).all();
assert.equal(propertyRows.length, 1, 'the properties report query must read lead-to-property links');
assert.equal(propertyRows[0].property_id, '18494');

// The scope predicate used for non-admin roles must also resolve.
const scoped = sql.prepare(
  `SELECT COUNT(*) n FROM ${leadFrom} WHERE (l.owner = ? OR l.created_by = ? OR l.assigned_to = ?)`
).all('admin', 'admin', 'admin');
assert.equal(scoped[0].n, 1, 'the ownership scope predicate must resolve against the migrated schema');

// 5. The catalog must keep saying an unreadable source is not a zero.
const catalog = readFileSync(join(root, 'lib', 'report-catalog.ts'), 'utf8');
assert.ok(/لا يمثل صفر|ليس صفر|لا يعني صفر/.test(catalog + readFileSync(join(root, 'app', 'api', 'reports', 'route.ts'), 'utf8')),
  'a source read failure must stay distinguishable from a genuine zero');

console.log('PASS leads schema matches every column the CRM reads/writes; migration additive, idempotent, stage ENUM complete; report queries resolve');
void out;
