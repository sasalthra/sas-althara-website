// Proves the leads migration planner is correct and safe WITHOUT a live MySQL.
// Then replays the planned statements against SQLite to prove the migrated
// schema actually satisfies the real report queries.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {planMigration, LEGACY_COLUMNS, COLUMNS, INDEXES, STAGES} from './lib/migration-plan.mjs';

// ── 1. Against the broken production schema, the plan must fix everything ──
const legacyPlan = planMigration(LEGACY_COLUMNS, [{Key_name: 'PRIMARY'}, {Key_name: 'leads_owner_created_idx'}]);
assert.equal(legacyPlan.addColumns.length, 5, 'all five missing columns must be planned');
assert.deepEqual(legacyPlan.addColumns.map(([c]) => c).sort(),
  ['assigned_to', 'created_by', 'field_assigned_to', 'property_other', 'source']);
assert.equal(legacyPlan.widenStage, true, 'the 6-value stage ENUM must be widened');
assert.equal(legacyPlan.addIndexes.length, 5, 'all report indexes must be planned');
assert.equal(legacyPlan.upToDate, false);

// ── 2. The plan must never destroy data ──
for (const stmt of legacyPlan.statements) {
  assert.ok(!/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(stmt), `destructive statement planned: ${stmt}`);
}
// The only UPDATEs allowed are the guarded placeholder backfills.
for (const stmt of legacyPlan.statements.filter(s => /^UPDATE/i.test(s))) {
  assert.ok(/WHERE\s+\w+\s*=\s*''/.test(stmt), `UPDATE must be guarded by a placeholder check: ${stmt}`);
}

// ── 3. Idempotence: after migrating, a second plan must be a no-op ──
const migratedColumns = [
  ...LEGACY_COLUMNS.filter(c => c.Field !== 'stage'),
  {Field: 'stage', Type: `enum(${STAGES.map(s => `'${s}'`).join(',')})`},
  ...COLUMNS.map(([Field]) => ({Field, Type: 'varchar(255)'})),
];
const migratedIndexes = [{Key_name: 'PRIMARY'}, ...INDEXES.map(([Key_name]) => ({Key_name}))];
const second = planMigration(migratedColumns, migratedIndexes);
assert.equal(second.upToDate, true, 're-running the migration must change nothing');
assert.equal(second.statements.length, 0);

// ── 4. Partial state: only the genuinely missing pieces are planned ──
const partial = planMigration(
  [...LEGACY_COLUMNS, {Field: 'source', Type: 'varchar(80)'}],
  [{Key_name: 'PRIMARY'}, {Key_name: 'leads_source_idx'}],
);
assert.equal(partial.addColumns.length, 4, 'an already-present column must not be re-added');
assert.ok(!partial.addColumns.some(([c]) => c === 'source'));
assert.ok(!partial.addIndexes.some(([i]) => i === 'leads_source_idx'));
assert.ok(!partial.statements.some(s => /SET source =/.test(s)),
  'no backfill for a column that already existed — it may hold real values');

// ── 5. Replay the plan for real, then run the actual report queries ──
const sql = new DatabaseSync(':memory:');
// Build the legacy (broken) table.
sql.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY,owner TEXT NOT NULL,name TEXT NOT NULL,
  phone TEXT NOT NULL,property_id TEXT NOT NULL,stage TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',follow_up TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE crm_users(id TEXT,name TEXT,role TEXT,active INTEGER,created_at TEXT);`);
for (const [id, owner] of [['l1', 'admin'], ['l2', 'alice'], ['l3', 'alice']]) {
  sql.prepare(`INSERT INTO leads VALUES('${id}','${owner}','عميل ${id}','0500000000','18494','new','','','2026-09-10T08:00:00.000Z','2026-09-10T08:00:00.000Z')`).run();
}
const before = sql.prepare('SELECT COUNT(*) n FROM leads').get().n;

// Confirm the failure this migration exists to fix.
const leadFrom = 'leads l LEFT JOIN crm_users s ON s.id=l.assigned_to LEFT JOIN crm_users f ON f.id=l.field_assigned_to';
const leadFields = 'l.id,l.name,l.property_id,l.property_other,l.source,l.stage,s.name AS sales,f.name AS field';
assert.throws(() => sql.prepare(`SELECT ${leadFields} FROM ${leadFrom} LIMIT 1`).all(),
  /no such column/, 'the legacy schema must fail the leads report query');

// Apply the planned statements (translated to SQLite: one ADD COLUMN per statement,
// ENUM becomes TEXT, and indexes use CREATE INDEX).
for (const stmt of legacyPlan.statements) {
  if (/^ALTER TABLE leads ADD COLUMN/i.test(stmt)) {
    sql.exec(stmt.replace(/`/g, '"').replace(/VARCHAR\(\d+\)/i, 'TEXT'));
  } else if (/^UPDATE/i.test(stmt)) {
    sql.exec(stmt);
  } else if (/MODIFY COLUMN stage/i.test(stmt)) {
    // SQLite has no ENUM; the widening is asserted structurally in step 1.
  } else if (/ADD INDEX/i.test(stmt)) {
    const m = /ADD INDEX `(\w+)` \(([^)]+)\)/.exec(stmt);
    sql.exec(`CREATE INDEX ${m[1]} ON leads (${m[2]})`);
  }
}

// No data lost, and the backfill preserved ownership.
assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads').get().n, before, 'migration must not lose rows');
assert.equal(sql.prepare("SELECT COUNT(*) n FROM leads WHERE created_by = ''").get().n, 0,
  'every row must have created_by after backfill, or it leaves its owner\'s report scope');
assert.equal(sql.prepare("SELECT created_by FROM leads WHERE id='l2'").get().created_by, 'alice',
  'created_by must be backfilled from owner, not blanked');
assert.equal(sql.prepare("SELECT COUNT(*) n FROM leads WHERE source='manual'").get().n, before);

// The real report queries must now resolve.
const rows = sql.prepare(`SELECT ${leadFields} FROM ${leadFrom} ORDER BY l.id LIMIT 10`).all();
assert.equal(rows.length, 3, 'the leads report must read every stored lead after migration');
const props = sql.prepare(`SELECT l.property_id,l.property_other FROM ${leadFrom} ORDER BY l.id`).all();
assert.equal(props.length, 3, 'the properties report must read lead-to-property links after migration');
assert.equal(props[0].property_id, '18494');

// Non-admin scope must still resolve and still isolate.
const scoped = sql.prepare(`SELECT COUNT(*) n FROM ${leadFrom} WHERE (l.owner = ? OR l.created_by = ? OR l.assigned_to = ?)`).all('alice', 'alice', 'alice');
assert.equal(scoped[0].n, 2, 'ownership scope must return only that user\'s leads');

console.log('PASS leads migration plan: fixes legacy schema, non-destructive, idempotent, partial-safe, backfills ownership, and report queries resolve');
