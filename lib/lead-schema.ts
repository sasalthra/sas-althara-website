/**
 * Idempotent leads schema repair, cached for the life of the process.
 * Deploy can reach the clients list before anyone runs `npm run db:migrate`.
 * SHOW COLUMNS is used first because Hostinger's DB user may not read
 * information_schema. If the repair cannot run, featured stays off and callers
 * must not reference `leads.is_featured`.
 * Stage repair appends ENUM members (it never drops or reorders existing
 * ones) and then moves retired stages. A failure is logged and the page
 * keeps loading with the previous stage list.
 */

import {retiredStageMoves, stageEnumValues} from './lead-stages';

export type LeadSchemaState = {featured: boolean};

export type SqlExecutor = {
  execute: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
  query?: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
};

let cached: Promise<LeadSchemaState> | null = null;

export function resetLeadSchemaCache() {
  cached = null;
}

export function ensureLeadSchema(executor?: SqlExecutor): Promise<LeadSchemaState> {
  if (!cached) {
    const resolved = executor ? Promise.resolve(executor) : defaultExecutor();
    cached = resolved.then(runEnsure).catch(error => {
      console.error('Lead schema check failed; clients stay unfeatured', error);
      return {featured: false};
    });
  }
  return cached;
}

async function defaultExecutor(): Promise<SqlExecutor> {
  const {crmPool} = await import('./crm-db');
  return crmPool() as unknown as SqlExecutor;
}

async function run(executor: SqlExecutor, sql: string, values: readonly unknown[] = []) {
  if (!values.length && executor.query) return executor.query(sql);
  return executor.execute(sql, values);
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    const first = result[0];
    return Array.isArray(first) ? first as Record<string, unknown>[] : [];
  }
  return [];
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function hasFeaturedColumn(executor: SqlExecutor): Promise<boolean | null> {
  try {
    const names = new Set(
      rowsOf(await run(executor, 'SHOW COLUMNS FROM leads')).map(row =>
        String(row.Field ?? row.field ?? row.name ?? '')
      )
    );
    return names.has('is_featured');
  } catch (error) {
    if (/no such table|ER_NO_SUCH_TABLE/i.test(messageOf(error))) return null;
    try {
      await run(executor, 'SELECT is_featured FROM leads LIMIT 0');
      return true;
    } catch (probe) {
      if (/is_featured|unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(messageOf(probe))) return false;
      return null;
    }
  }
}

async function ensureFeaturedIndex(executor: SqlExecutor) {
  try {
    const names = new Set(
      rowsOf(await run(executor, 'SHOW INDEX FROM leads')).map(row =>
        String(row.Key_name ?? row.key_name ?? row.name ?? '')
      )
    );
    if (names.has('leads_featured_idx')) return;
  } catch {
    // SHOW INDEX is MySQL. SQLite and locked-down accounts fall through to CREATE.
  }
  try {
    await run(executor, 'ALTER TABLE leads ADD INDEX leads_featured_idx (is_featured, created_at)');
  } catch (error) {
    if (/duplicate|already exists|ER_DUP_KEYNAME/i.test(messageOf(error))) return;
    try {
      await run(executor, 'CREATE INDEX IF NOT EXISTS leads_featured_idx ON leads (is_featured, created_at)');
    } catch (fallback) {
      console.error('featured index was not added', fallback);
    }
  }
}

function columnName(row: Record<string, unknown>) {
  return String(row.Field ?? row.field ?? row.COLUMN_NAME ?? row.column_name ?? '');
}

function columnType(row: Record<string, unknown>) {
  return String(row.Type ?? row.type ?? row.COLUMN_TYPE ?? row.column_type ?? '');
}

/** MySQL/MariaDB `enum('a','b')`. Anything else (TEXT, missing column) is left alone. */
function parseEnum(type: string): string[] | null {
  const match = /^enum\s*\((.*)\)$/i.exec(type.trim());
  if (!match) return null;
  const values = [...match[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(part =>
    part[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  );
  return values.length ? values : null;
}

/**
 * Append missing stage keys. Existing members stay in place so MySQL ENUM
 * indexes are not remapped, and unknown production values are not dropped.
 */
async function widenStageEnum(executor: SqlExecutor) {
  let type = '';
  try {
    const rows = rowsOf(await run(executor, 'SHOW COLUMNS FROM leads'));
    const stage = rows.find(row => columnName(row).toLowerCase() === 'stage');
    type = stage ? columnType(stage) : '';
  } catch (error) {
    console.error('stage enum inspection failed; existing stages stay as stored', error);
    return;
  }
  const current = parseEnum(type);
  if (!current) return;
  const next = [...current];
  for (const value of stageEnumValues) {
    if (!next.includes(value)) next.push(value);
  }
  if (next.length === current.length) return;
  if (next.some(value => !/^[a-z0-9_]+$/i.test(value))) {
    console.error('stage enum was not widened; a value is not a safe identifier');
    return;
  }
  try {
    await run(
      executor,
      `ALTER TABLE leads MODIFY COLUMN stage ENUM(${next.map(value => `'${value}'`).join(',')}) NOT NULL DEFAULT 'new'`
    );
  } catch (error) {
    console.error('stage enum was not widened; stage updates keep the previous list', error);
  }
}

async function convertRetiredStages(executor: SqlExecutor) {
  for (const move of retiredStageMoves) {
    try {
      const ids = rowsOf(await run(executor, 'SELECT id FROM leads WHERE stage = ?', [move.from]))
        .map(row => String(row.id ?? ''))
        .filter(Boolean);
      if (!ids.length) continue;
      await run(executor, 'UPDATE leads SET stage = ? WHERE stage = ?', [move.to, move.from]);
      for (const id of ids) {
        try {
          await run(
            executor,
            'INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)',
            [
              crypto.randomUUID(),
              id,
              'system',
              'stage_changed',
              JSON.stringify({
                previousStage: move.from,
                stage: move.to,
                note: move.note,
              }),
            ]
          );
        } catch (error) {
          console.error('stage history for a retired stage was not written', error);
        }
      }
    } catch (error) {
      console.error(`stage conversion ${move.from} -> ${move.to} failed`, error);
    }
  }
}

async function repairStages(executor: SqlExecutor) {
  try {
    await widenStageEnum(executor);
  } catch (error) {
    console.error('stage enum widen failed', error);
  }
  try {
    await convertRetiredStages(executor);
  } catch (error) {
    console.error('retired stage conversion failed', error);
  }
}

async function runEnsure(executor: SqlExecutor): Promise<LeadSchemaState> {
  let featured = false;
  const existing = await hasFeaturedColumn(executor);
  if (existing === null) {
    await repairStages(executor);
    return {featured: false};
  }
  featured = existing;
  if (!featured) {
    try {
      await run(executor, 'ALTER TABLE leads ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0');
      featured = true;
    } catch (error) {
      console.error('is_featured column was not added; clients stay unfeatured', error);
      featured = false;
    }
  }
  if (featured) await ensureFeaturedIndex(executor);
  await repairStages(executor);
  return {featured};
}

export function isMissingFeaturedColumn(error: unknown) {
  return /is_featured|unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(messageOf(error));
}
