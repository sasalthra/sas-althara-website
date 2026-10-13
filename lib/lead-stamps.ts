import {isEverFieldDispatchFilter} from './lead-cohorts';
import {paramEq} from './sql-collation';

type StampDb = {
  prepare(sql: string): {
    bind(...args: Array<string | number | null>): {
      first?<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
};

function missingColumn(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(message);
}

/** A lead counted as ever dispatched: the stage itself, or a field employee. */
export function leadNeedsFieldDispatchStamp(stage: unknown, fieldAssignedTo: unknown) {
  return isEverFieldDispatchFilter(stage) || Boolean(String(fieldAssignedTo ?? '').trim());
}

/** True when this save moves the lead into تفويج للميداني from any other stage. */
export function enteringFieldDispatch(previousStage: unknown, nextStage: unknown) {
  return isEverFieldDispatchFilter(nextStage) && !isEverFieldDispatchFilter(previousStage);
}

/**
 * Whether this save must record a dispatch.
 * `latest` is the field-dispatch button, a stage change into تفويج للميداني,
 * or a new field employee. A later note on the same stage does not move it.
 */
export function fieldDispatchWrite(input: {
  previousStage?: unknown;
  nextStage: unknown;
  previousField?: unknown;
  nextField?: unknown;
}) {
  const entering = enteringFieldDispatch(input.previousStage, input.nextStage);
  const nextField = String(input.nextField ?? '').trim();
  const previousField = String(input.previousField ?? '').trim();
  const fieldChanged = Boolean(nextField) && nextField !== previousField;
  const write = entering || fieldChanged || leadNeedsFieldDispatchStamp(input.nextStage, nextField);
  return {write, latest: entering || fieldChanged};
}

/** Overwrite the sales assignment time. Call only when the assignee changes. */
export async function rememberAssignedAt(db: StampDb, id: string, at: string) {
  if (!id || !at) return;
  try {
    await db.prepare(`UPDATE leads SET assigned_at = ? WHERE ${paramEq('id')}`).bind(at, id).run();
  } catch (error) {
    if (missingColumn(error)) return;
    throw error;
  }
}

/**
 * Keep the first dispatch time. A later stage change does not clear it.
 * The comparison stays on the parameter side so mixed collations do not raise 1267.
 */
export async function rememberFirstFieldDispatch(db: StampDb, id: string, at: string) {
  if (!id || !at) return;
  try {
    const row = await db
      .prepare(`SELECT first_field_dispatch_at FROM leads WHERE ${paramEq('id')} LIMIT 1`)
      .bind(id)
      .first?.<{first_field_dispatch_at?: unknown}>();
    if (row && String(row.first_field_dispatch_at ?? '').trim()) return;
    await db.prepare(`UPDATE leads SET first_field_dispatch_at = ? WHERE ${paramEq('id')}`).bind(at, id).run();
  } catch (error) {
    if (missingColumn(error)) return;
    throw error;
  }
}

/** Overwrite the latest dispatch time. The first-dispatch stamp stays. */
export async function rememberLatestFieldDispatch(db: StampDb, id: string, at: string) {
  if (!id || !at) return;
  try {
    await db.prepare(`UPDATE leads SET field_dispatched_at = ? WHERE ${paramEq('id')}`).bind(at, id).run();
  } catch (error) {
    if (missingColumn(error)) return;
    throw error;
  }
}

/** Record a dispatch now. The first time is kept; the latest time moves when asked. */
export async function rememberFieldDispatch(db: StampDb, id: string, at: string, latest = false) {
  await rememberFirstFieldDispatch(db, id, at);
  if (latest) await rememberLatestFieldDispatch(db, id, at);
}
