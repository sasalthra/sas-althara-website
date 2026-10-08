/**
 * Read-only CRM aggregates for the admin assistant.
 * Client names and phones are returned only for the local alerts panel.
 */

import properties from '@/data/properties.json';
import {
  ASSIGNMENT_BASIS,
  assembleSnapshot,
  parseCrmInstant,
  type AlignedReport,
  type AssignmentToday,
  type AssistantSnapshot,
  type RawLead,
  type RawUser,
  type SpendSummary,
} from './admin-assistant';
import {conversionRate} from './lead-cohorts';
import {riyadhDayKey} from './lead-dates';
import {parseReportFilters, readAssignmentCounts, readReportDashboard} from './reports';

type Statement = {
  bind(...args: (string | number | null)[]): Statement;
  all(): Promise<{results: unknown[]}>;
  first<T>(): Promise<T | null>;
  run(): Promise<{meta: {changes: number}}>;
};

export type AssistantDb = {
  prepare(sql: string): Statement;
};

function rowsOf(result: {results?: unknown}): Record<string, unknown>[] {
  const rows = result?.results;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function activeFlag(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

async function optionalRows(db: AssistantDb, sql: string): Promise<Record<string, unknown>[] | null> {
  try {
    return rowsOf(await db.prepare(sql).all());
  } catch (error) {
    console.error('assistant optional read skipped', error);
    return null;
  }
}

async function leadRows(db: AssistantDb): Promise<RawLead[]> {
  const withNotes = await optionalRows(
    db,
    `SELECT id, name, phone, stage, source, notes, assigned_to, field_assigned_to, follow_up, created_at, updated_at FROM leads`
  );
  const rows = withNotes ?? await optionalRows(
    db,
    `SELECT id, name, phone, stage, source, assigned_to, field_assigned_to, follow_up, created_at, updated_at FROM leads`
  ) ?? [];
  return rows.map(row => ({
    id: text(row.id),
    name: text(row.name),
    phone: text(row.phone),
    stage: text(row.stage),
    source: text(row.source),
    notes: text(row.notes),
    assignedTo: text(row.assigned_to),
    fieldAssignedTo: text(row.field_assigned_to),
    followUp: row.follow_up,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })).filter(row => row.id);
}

async function userRows(db: AssistantDb): Promise<RawUser[]> {
  const withLogin = await optionalRows(db, 'SELECT id, name, username, role, active, last_login_at FROM crm_users');
  const rows = withLogin ?? await optionalRows(db, 'SELECT id, name, role, active FROM crm_users') ?? [];
  return rows.map(row => ({
    id: text(row.id),
    name: text(row.name),
    username: text(row.username),
    role: text(row.role),
    active: activeFlag(row.active),
    lastLoginAt: row.last_login_at ?? null,
  })).filter(row => row.id);
}

async function activityMap(db: AssistantDb): Promise<Map<string, number>> {
  const rows = await optionalRows(
    db,
    'SELECT lead_id, MAX(created_at) AS last_at FROM lead_activity GROUP BY lead_id'
  ) ?? [];
  const map = new Map<string, number>();
  for (const row of rows) {
    const id = text(row.lead_id);
    const instant = parseCrmInstant(row.last_at);
    if (!id || instant == null) continue;
    map.set(id, instant);
  }
  return map;
}

async function propertyIds(db: AssistantDb): Promise<string[]> {
  const staticIds = (properties as {id?: string}[]).map(item => text(item.id)).filter(Boolean);
  const live = await optionalRows(db, 'SELECT id FROM site_properties');
  const ids = new Set(staticIds);
  for (const row of live ?? []) {
    const id = text(row.id);
    if (id) ids.add(id);
  }
  return [...ids];
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(amount) ? amount : null;
}

async function campaignSpend(db: AssistantDb): Promise<SpendSummary> {
  const queries = [
    'SELECT SUM(amount) AS total FROM campaign_spend',
    'SELECT SUM(spend) AS total FROM campaigns',
    'SELECT SUM(campaign_spend) AS total FROM leads',
  ];
  for (const sql of queries) {
    try {
      const row = await db.prepare(sql).first<{total: unknown}>();
      const total = numberOrNull(row?.total);
      if (total == null) return {available: true, total: 0};
      return {available: true, total};
    } catch {
      // Table or column is absent. Try the next known spend location.
    }
  }
  return {available: false, total: 0};
}

function alignReport(dash: Awaited<ReturnType<typeof readReportDashboard>>, from: string, to: string): AlignedReport {
  return {
    from,
    to,
    total: dash.total,
    overdue: dash.overdue,
    signed: dash.signed,
    scheduled: dash.scheduled,
    employees: dash.employees.map(employee => ({
      name: employee.name,
      assigned: employee.assigned,
      signed: employee.signed,
      overdue: employee.overdue,
      conversionPct: conversionRate(employee.assigned, employee.signed),
    })),
    stages: dash.byStage.filter(stage => stage.count > 0).map(stage => ({label: stage.label, count: stage.count})),
    sources: dash.sources.map(source => ({label: source.label, count: source.total, conversion: source.conversion})),
    field: dash.field,
  };
}

export async function loadReportAlignment(db: AssistantDb, now: Date, actor: {userId: string; role: string}, filters?: {from?: string; to?: string; employee?: string; source?: string; stage?: string}): Promise<AlignedReport | null> {
  const params = new URLSearchParams();
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  if (filters?.employee) params.set('employee', filters.employee);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.stage) params.set('stage', filters.stage);
  const parsed = parseReportFilters(params, now);
  const dash = await readReportDashboard(db as never, actor, parsed, now);
  return alignReport(dash, parsed.from, parsed.to);
}

export async function loadAssignments(db: AssistantDb, from: string, to: string, employee = ''): Promise<AssignmentToday> {
  try {
    const counts = await readAssignmentCounts(db as never, from, to, employee);
    return {date: from === to ? from : `${from} — ${to}`, basis: counts.basis || ASSIGNMENT_BASIS, unavailable: counts.unavailable, total: counts.total, byEmployee: counts.byEmployee.map(row => ({name: row.name, count: row.count}))};
  } catch (error) {
    console.error('assignment counts unavailable', error);
    return {date: from === to ? from : `${from} — ${to}`, basis: ASSIGNMENT_BASIS, unavailable: true, total: null, byEmployee: []};
  }
}

export async function loadAssistantSnapshot(db: AssistantDb, now = new Date(), actor: {userId: string; role: string} = {userId: 'assistant', role: 'admin'}): Promise<AssistantSnapshot> {
  const [leads, users, activityAt, ids, spend] = await Promise.all([
    leadRows(db),
    userRows(db),
    activityMap(db),
    propertyIds(db),
    campaignSpend(db),
  ]);
  const snapshot = assembleSnapshot({leads, users, activityAt, propertyIds: ids, spend, now});
  const today = riyadhDayKey(now);
  try {
    snapshot.aligned = await loadReportAlignment(db, now, actor) ?? undefined;
  } catch (error) {
    console.error('report alignment unavailable', error);
  }
  snapshot.assignmentsToday = today ? await loadAssignments(db, today, today) : {date: '', basis: ASSIGNMENT_BASIS, unavailable: true, total: null, byEmployee: []};
  return snapshot;
}
