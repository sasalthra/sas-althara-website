// Pure migration planner for the leads table — no database, no I/O.
// Kept separate from scripts/migrate-leads.mjs so the decision logic can be
// tested without a live MySQL server (see scripts/check-migration-plan.mjs).

export const COLUMNS = [
  ['created_by',        "VARCHAR(255) NOT NULL DEFAULT ''"],
  ['assigned_to',       "VARCHAR(255) NOT NULL DEFAULT ''"],
  ['field_assigned_to', "VARCHAR(255) NOT NULL DEFAULT ''"],
  ['source',            "VARCHAR(80) NOT NULL DEFAULT 'manual'"],
  ['property_other',    "VARCHAR(500) NOT NULL DEFAULT ''"],
];

export const INDEXES = [
  ['leads_assigned_idx',   '(assigned_to, created_at)'],
  ['leads_field_idx',      '(field_assigned_to, created_at)'],
  ['leads_created_by_idx', '(created_by, created_at)'],
  ['leads_source_idx',     '(source)'],
  ['leads_property_idx',   '(property_id)'],
];

export const STAGES = [
  'new','received','no_answer','contacted','data_received','calculation_done',
  'visit_qualified','property_visited','bank_approval','deposit_paid',
  'contract_signed','transferred','unqualified','not_interested',
  'viewing','negotiation','won','closed',
];

// Given the output of SHOW COLUMNS / SHOW INDEX, decide what must change.
// `showColumns` : [{Field, Type}]   `showIndex` : [{Key_name}]
export function planMigration(showColumns, showIndex) {
  const have = new Set(showColumns.map(c => c.Field));
  const haveIdx = new Set(showIndex.map(i => i.Key_name));
  const stageCol = showColumns.find(c => c.Field === 'stage');

  const addColumns = COLUMNS.filter(([c]) => !have.has(c));
  const addIndexes = INDEXES.filter(([i]) => !haveIdx.has(i));
  const widenStage = Boolean(stageCol) && !STAGES.every(s => String(stageCol.Type).includes(`'${s}'`));

  const statements = [];
  for (const [name, ddl] of addColumns) statements.push(`ALTER TABLE leads ADD COLUMN \`${name}\` ${ddl}`);
  // Backfill only when the column is newly created, so a re-run never rewrites rows.
  if (addColumns.some(([c]) => c === 'created_by')) statements.push("UPDATE leads SET created_by = owner WHERE created_by = ''");
  if (addColumns.some(([c]) => c === 'source')) statements.push("UPDATE leads SET source = 'manual' WHERE source = ''");
  if (widenStage) statements.push(`ALTER TABLE leads MODIFY COLUMN stage ENUM(${STAGES.map(s => `'${s}'`).join(',')}) NOT NULL DEFAULT 'new'`);
  for (const [name, def] of addIndexes) statements.push(`ALTER TABLE leads ADD INDEX \`${name}\` ${def}`);

  return {addColumns, addIndexes, widenStage, statements, upToDate: statements.length === 0};
}

// The production schema created by db/mysql/001_leads.sql — the state that broke reports.
export const LEGACY_COLUMNS = [
  {Field: 'id', Type: 'char(36)'},
  {Field: 'owner', Type: 'varchar(255)'},
  {Field: 'name', Type: 'varchar(100)'},
  {Field: 'phone', Type: 'varchar(22)'},
  {Field: 'property_id', Type: 'varchar(32)'},
  {Field: 'stage', Type: "enum('new','contacted','viewing','negotiation','won','closed')"},
  {Field: 'notes', Type: 'text'},
  {Field: 'follow_up', Type: 'varchar(10)'},
  {Field: 'created_at', Type: 'varchar(24)'},
  {Field: 'updated_at', Type: 'varchar(24)'},
];
