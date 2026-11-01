import {leadMatchesSource, leadMatchesStage, matchUser, type DirectoryUser} from './lead-cohorts';
import {nextCalendarDay} from './report-presets';
import {asBinary, paramEq} from './sql-collation';

/**
 * Updates on leads registered before the report window.
 * One grouped read of lead_activity (lead_id, created_at). Riyadh bounds are
 * computed here. Both sides of each comparison are binary, so collations do
 * not mix, and CONVERT_TZ is not used.
 */

export type LegacyKind = 'stage' | 'status' | 'note';

export type LegacyUpdateRow = {
  id: string;
  name: string;
  username: string;
  leads: number;
  stageChanges: number;
  statusUpdates: number;
  notes: number;
  total: number;
};

export type LegacyUpdateTotals = {
  leads: number;
  stageChanges: number;
  statusUpdates: number;
  notes: number;
  total: number;
};

export type LegacyActivityEvent = {
  userId: string;
  leadId: string;
  action: string;
  count: number;
  stage?: string;
  source?: string;
};

const STAGE_ACTIONS = new Set(['stage_changed', 'field_dispatched']);
const NOTE_ACTIONS = new Set(['stage_note']);
const STATUS_ACTIONS = new Set(['updated', 'field_update', 'follow_up_added', 'follow_up', 'assigned', 'assignment', 'reassigned']);

export const LEGACY_UPDATE_ACTIONS = [...STAGE_ACTIONS, ...NOTE_ACTIONS, ...STATUS_ACTIONS];

export function classifyLegacyAction(action: unknown): LegacyKind | '' {
  const key = String(action ?? '').trim();
  if (STAGE_ACTIONS.has(key)) return 'stage';
  if (NOTE_ACTIONS.has(key)) return 'note';
  if (STATUS_ACTIONS.has(key)) return 'status';
  return '';
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** Midnight that opens a Riyadh day, as UTC `YYYY-MM-DD HH:MM:SS`. UTC+3, computed in JS. */
export function legacyRiyadhMidnightUtc(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(y, (m || 1) - 1, d || 1) - 3 * 60 * 60 * 1000);
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())} ${pad2(utc.getUTCHours())}:${pad2(utc.getUTCMinutes())}:${pad2(utc.getUTCSeconds())}`;
}

function timestampExpr(column: string) {
  return asBinary(`REPLACE(${asBinary(`SUBSTR(${column},1,19)`)}, ${asBinary(`'T'`)}, ${asBinary(`' '`)})`);
}

/** Activity inside the Riyadh window, on a lead registered before that window opens. */
export function legacyUpdateWindow(from: string, to: string) {
  const activity = timestampExpr('a.created_at');
  const created = timestampExpr('l.created_at');
  return {
    sql: `${activity} >= ${asBinary('?')} AND ${activity} < ${asBinary('?')} AND ${created} < ${asBinary('?')}`,
    args: [legacyRiyadhMidnightUtc(from), legacyRiyadhMidnightUtc(nextCalendarDay(to)), legacyRiyadhMidnightUtc(from)] as (string | number | null)[],
  };
}

/**
 * The activity index is (lead_id, created_at). lead_id stays bare so that
 * index can satisfy the join; the lead primary key is cast on the other side.
 */
export function legacyUpdateJoin() {
  return `a.lead_id = ${asBinary('l.id')}`;
}

export function legacyUpdateGroupSql(from: string, to: string, actorId = '') {
  const window = legacyUpdateWindow(from, to);
  const actions = LEGACY_UPDATE_ACTIONS.map(() => paramEq('a.action')).join(' OR ');
  const actor = actorId ? ` AND ${paramEq('a.user_id')}` : '';
  return {
    sql: `SELECT a.user_id AS user_id, a.lead_id AS lead_id, a.action AS action, l.stage AS stage, l.source AS source, COUNT(*) AS n
      FROM lead_activity a
      INNER JOIN leads l ON ${legacyUpdateJoin()}
      WHERE (${actions}) AND ${window.sql}${actor}
      GROUP BY a.user_id, a.lead_id, a.action, l.stage, l.source`,
    args: [...LEGACY_UPDATE_ACTIONS, ...window.args, ...(actorId ? [actorId] : [])],
  };
}

export function legacyUpdateLeadSql(from: string, to: string, actorId = '') {
  const window = legacyUpdateWindow(from, to);
  const actions = LEGACY_UPDATE_ACTIONS.map(() => paramEq('a.action')).join(' OR ');
  const actor = actorId ? ` AND ${paramEq('a.user_id')}` : '';
  return {
    sql: `SELECT a.lead_id AS lead_id
      FROM lead_activity a
      INNER JOIN leads l ON ${legacyUpdateJoin()}
      WHERE (${actions}) AND ${window.sql}${actor}
      GROUP BY a.lead_id`,
    args: [...LEGACY_UPDATE_ACTIONS, ...window.args, ...(actorId ? [actorId] : [])],
  };
}

export function emptyLegacyTotals(): LegacyUpdateTotals {
  return {leads: 0, stageChanges: 0, statusUpdates: 0, notes: 0, total: 0};
}

export function sumLegacyUpdates(rows: LegacyUpdateRow[]): LegacyUpdateTotals {
  return rows.reduce((totals, row) => ({
    leads: totals.leads + row.leads,
    stageChanges: totals.stageChanges + row.stageChanges,
    statusUpdates: totals.statusUpdates + row.statusUpdates,
    notes: totals.notes + row.notes,
    total: totals.total + row.total,
  }), emptyLegacyTotals());
}

function tokenHit(user: DirectoryUser, tokens: string[]) {
  return tokens.some(token => matchUser([user], token)?.id === user.id);
}

/** Fold one grouped activity read into an employee table. Stage and source narrow the lead, not the clock. */
export function aggregateLegacyUpdates(input: {
  events: LegacyActivityEvent[];
  users: DirectoryUser[];
  stage?: string;
  source?: string;
  sourceExact?: boolean;
  employeeTokens?: string[];
}): {rows: LegacyUpdateRow[]; totals: LegacyUpdateTotals} {
  const stage = (input.stage || '').trim();
  const source = (input.source || '').trim();
  const tokens = (input.employeeTokens || []).map(token => token.trim()).filter(Boolean);
  const buckets = new Map<string, {user: DirectoryUser; leads: Set<string>; stageChanges: number; statusUpdates: number; notes: number}>();
  for (const event of input.events) {
    const kind = classifyLegacyAction(event.action);
    if (!kind || !event.leadId || !event.userId) continue;
    if (stage && !leadMatchesStage(event.stage, stage)) continue;
    if (source && !leadMatchesSource(event.source, source, Boolean(input.sourceExact))) continue;
    const person = matchUser(input.users, event.userId);
    const id = person?.id || event.userId;
    if (tokens.length) {
      const known = person && tokenHit(person, tokens);
      const raw = tokens.some(token => token === event.userId || token === id);
      if (!known && !raw) continue;
    }
    const bucket = buckets.get(id) || {
      user: person || {id, name: id, username: '', role: ''},
      leads: new Set<string>(),
      stageChanges: 0,
      statusUpdates: 0,
      notes: 0,
    };
    bucket.leads.add(event.leadId);
    const count = Number(event.count) || 0;
    if (kind === 'stage') bucket.stageChanges += count;
    else if (kind === 'status') bucket.statusUpdates += count;
    else bucket.notes += count;
    buckets.set(id, bucket);
  }
  const rows = [...buckets.values()].map(bucket => {
    const total = bucket.stageChanges + bucket.statusUpdates + bucket.notes;
    return {
      id: bucket.user.id,
      name: bucket.user.name || bucket.user.id,
      username: bucket.user.username || '',
      leads: bucket.leads.size,
      stageChanges: bucket.stageChanges,
      statusUpdates: bucket.statusUpdates,
      notes: bucket.notes,
      total,
    };
  }).filter(row => row.leads > 0 || row.total > 0)
    .sort((a, b) => b.leads - a.leads || b.total - a.total || a.name.localeCompare(b.name, 'ar'));
  return {rows, totals: sumLegacyUpdates(rows)};
}
