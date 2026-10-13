import properties from '@/data/properties.json';
import {fieldDispatchMoment, instantInRiyadhRange, isEverFieldDispatchFilter, leadEverFieldDispatched, leadMatchesAssignmentCohort, leadMatchesReportFilters} from './lead-cohorts';
import {riyadhDayKey} from './lead-dates';
import {compareClients, isNewUnassignedLead} from './lead-featured';
import {displayLeadPhone, leadPhoneMatchesQuery} from './phone';
import {fieldReportRequired} from './field-report';
import {binJoin, inParams, paramEq} from './sql-collation';

export const LEAD_PAGE_SIZE = 100;

const propertyTitles = new Map(properties.map(item => [item.id, item.title]));

export type LeadListFilters = {
  q: string;
  view: string;
  stage: string;
  stageNow: boolean;
  assignFrom: string;
  assignTo: string;
  assignRole: '' | 'sales' | 'field';
  from: string;
  to: string;
  source: string;
  sourceExact: boolean;
  employee: string;
  employeeName: string;
  employeeUser: string;
  stageGroup: string;
  overdue: boolean;
  inactive: boolean;
  waiting: boolean;
  scheduled: boolean;
  duplicateOnly: boolean;
  newOnly: boolean;
  reportRequired: boolean;
  page: number;
  id: string;
  picklist: boolean;
};

export type LeadListCounts = {
  total: number;
  followUps: number;
  newUnassigned: number;
  reportRequired: number;
  duplicatePhones: string[];
};

export type LeadListPage = {
  leads: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  counts: LeadListCounts;
};

type SqlValue = string | number | null;

type LeadQuery = {
  prepare(sql: string): {
    bind(...args: SqlValue[]): {
      all(): Promise<{results?: Record<string, unknown>[]}>;
    };
  };
};

type ListLead = {
  id?: string;
  phone?: string | null;
  sales_last_update?: unknown;
  sales_last_update_at?: unknown;
  field_last_update?: unknown;
  field_last_update_at?: unknown;
  follow_up?: string | null;
  stage?: string | null;
  property_id?: string | null;
  property_other?: string | null;
  name?: string | null;
  assigned_name?: string | null;
  field_assigned_name?: string | null;
  assigned_to?: string | null;
  field_assigned_to?: string | null;
  field_dispatched_at?: string | null;
  first_field_dispatch_at?: string | null;
  assigned_at?: string | null;
  field_report?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  source?: string | null;
  is_featured?: unknown;
};

export function emptyLeadFilters(page = 1): LeadListFilters {
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
    page,
    id: '',
    picklist: false,
  };
}

export function parseLeadListFilters(url: URL | null, role: string): LeadListFilters {
  const params = url?.searchParams;
  const text = (key: string) => (params?.get(key) || '').slice(0, 255);
  const pageRaw = Number(params?.get('page') || 1);
  const canReviewDuplicates = role === 'admin' || role === 'supervisor';
  return {
    q: text('q').trim(),
    view: params?.get('view') === 'followups' ? 'followups' : '',
    stage: text('stage'),
    stageNow: params?.get('stageNow') === '1',
    assignFrom: /^\d{4}-\d{2}-\d{2}$/.test(text('assignFrom')) ? text('assignFrom') : '',
    assignTo: /^\d{4}-\d{2}-\d{2}$/.test(text('assignTo')) ? text('assignTo') : '',
    assignRole: params?.get('assignRole') === 'field' ? 'field' : params?.get('assignRole') === 'sales' ? 'sales' : '',
    from: text('from'),
    to: text('to'),
    source: text('source'),
    sourceExact: params?.get('sourceExact') === '1',
    employee: text('employee'),
    employeeName: text('employeeName'),
    employeeUser: text('employeeUser'),
    stageGroup: text('stageGroup'),
    overdue: params?.get('overdue') === '1',
    inactive: params?.get('inactive') === '1' || params?.get('noActivity') === '1',
    waiting: params?.get('waiting') === '1',
    scheduled: params?.get('scheduled') === '1',
    duplicateOnly: canReviewDuplicates && params?.get('duplicate') === '1',
    newOnly: role === 'admin' && params?.get('newOnly') === '1',
    reportRequired: params?.get('report') === '1',
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    id: text('id').trim(),
    picklist: params?.get('picklist') === '1',
  };
}

export function isLeadListPage(value: unknown): value is LeadListPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const page = value as LeadListPage;
  return Array.isArray(page.leads) && typeof page.page === 'number' && typeof page.total === 'number';
}

export function leadListSearchParams(filters: LeadListFilters): string {
  const params = new URLSearchParams();
  params.set('page', String(filters.page));
  if (filters.q) params.set('q', filters.q);
  if (filters.view === 'followups') params.set('view', 'followups');
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.stageNow) params.set('stageNow', '1');
  if (filters.assignFrom) params.set('assignFrom', filters.assignFrom);
  if (filters.assignTo) params.set('assignTo', filters.assignTo);
  if (filters.assignRole) params.set('assignRole', filters.assignRole);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.source) params.set('source', filters.source);
  if (filters.sourceExact) params.set('sourceExact', '1');
  if (filters.employee) params.set('employee', filters.employee);
  if (filters.employeeName) params.set('employeeName', filters.employeeName);
  if (filters.employeeUser) params.set('employeeUser', filters.employeeUser);
  if (filters.stageGroup) params.set('stageGroup', filters.stageGroup);
  if (filters.overdue) params.set('overdue', '1');
  if (filters.inactive) params.set('inactive', '1');
  if (filters.waiting) params.set('waiting', '1');
  if (filters.scheduled) params.set('scheduled', '1');
  if (filters.duplicateOnly) params.set('duplicate', '1');
  if (filters.newOnly) params.set('newOnly', '1');
  if (filters.reportRequired) params.set('report', '1');
  return params.toString();
}

export function followUpDue(lead: {follow_up?: string | null; stage?: string | null}, today: string) {
  return Boolean(lead.follow_up && lead.follow_up <= today && !['won', 'closed'].includes(String(lead.stage || '')));
}

export function duplicatePhoneList(leads: {phone?: string | null}[]) {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const phone = displayLeadPhone(String(lead.phone ?? ''));
    if (!phone) continue;
    counts.set(phone, (counts.get(phone) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([phone]) => phone);
}

export function leadListCounts(leads: ListLead[], today: string): LeadListCounts {
  return {
    total: leads.length,
    followUps: leads.filter(lead => followUpDue(lead, today)).length,
    newUnassigned: leads.filter(lead => isNewUnassignedLead(lead)).length,
    reportRequired: leads.filter(lead => fieldReportRequired(lead)).length,
    duplicatePhones: duplicatePhoneList(leads),
  };
}

function propertyTitle(id: string) {
  return propertyTitles.get(id) || '';
}

function leadMatchesSearch(lead: ListLead, queryText: string) {
  if (!queryText) return true;
  const phoneShown = displayLeadPhone(String(lead.phone ?? ''));
  const searchable = [
    lead.name || '',
    phoneShown,
    propertyTitle(String(lead.property_id ?? '')) || lead.property_other || '',
    lead.assigned_name || '',
    lead.field_assigned_name || '',
  ].join(' ');
  return searchable.toLowerCase().includes(queryText.toLowerCase()) || leadPhoneMatchesQuery(phoneShown, queryText);
}

/** Same list predicates the clients page used before paging moved to the server. */
export function leadMatchesClientFilters(
  lead: ListLead,
  filters: LeadListFilters,
  duplicatePhones: Set<string>,
  today: string,
  nowMs: number
) {
  if (filters.view === 'followups' && !followUpDue(lead, today)) return false;
  // «تفويج للميداني» on the clients filter means the lead ever entered that stage.
  // Report drill-downs pass stageNow or an assignment cohort and keep the current stage.
  // The flag is on the lead row, so paging does not join lead_activity.
  const cohort = filters.assignRole === 'sales' || filters.assignRole === 'field';
  const everDispatch = !filters.stageNow && !cohort && isEverFieldDispatchFilter(filters.stage);
  // تفويج للميداني plus a period uses the dispatch time, not created_at.
  // Assignment cohorts keep their own assignFrom/assignTo window.
  const dispatchPeriod = !cohort && isEverFieldDispatchFilter(filters.stage) && Boolean(filters.from || filters.to);
  if (!leadMatchesReportFilters(lead, {
    from: dispatchPeriod ? '' : filters.from,
    to: dispatchPeriod ? '' : filters.to,
    stage: everDispatch ? '' : filters.stage,
    source: filters.source,
    sourceExact: filters.sourceExact,
    employeeTokens: cohort ? [] : [filters.employee, filters.employeeName, filters.employeeUser],
    stageGroup: filters.stageGroup,
    overdue: filters.overdue,
    inactive: filters.inactive,
    waiting: filters.waiting,
    scheduled: filters.scheduled,
    today,
    nowMs,
  })) return false;
  if (everDispatch && !leadEverFieldDispatched(lead)) return false;
  if (dispatchPeriod && !instantInRiyadhRange(fieldDispatchMoment(lead), filters.from, filters.to)) return false;
  if (cohort && !leadMatchesAssignmentCohort(lead, {
    role: filters.assignRole,
    from: filters.assignFrom,
    to: filters.assignTo,
    employeeTokens: [filters.employee, filters.employeeName, filters.employeeUser],
  })) return false;
  if (filters.duplicateOnly && !duplicatePhones.has(displayLeadPhone(String(lead.phone ?? '')))) return false;
  if (filters.newOnly && !isNewUnassignedLead(lead)) return false;
  if (filters.reportRequired && !fieldReportRequired(lead)) return false;
  return leadMatchesSearch(lead, filters.q);
}

function userJoins() {
  return `
    LEFT JOIN crm_users AS sales_user
      ON ${binJoin('sales_user.id', 'leads.assigned_to')}
    LEFT JOIN crm_users AS field_user
      ON ${binJoin('field_user.id', 'leads.field_assigned_to')}
  `;
}

function scopeClause(role: string, userId: string) {
  if (role === 'admin' || role === 'supervisor') return {sql: '', args: [] as string[]};
  const column = role === 'field' ? 'leads.field_assigned_to' : role === 'sales' ? 'leads.assigned_to' : '';
  if (!column) return {sql: ' WHERE 1 = 0', args: [] as string[]};
  return {
    sql: ` WHERE ${paramEq(column)} OR ${paramEq('leads.created_by')} OR ${paramEq('leads.owner')}`,
    args: [userId, userId, userId],
  };
}

/**
 * One grouped read of the latest sales/field note for the ids on this page.
 * MySQL 5.7 has no window functions. The indexed lead_id column stays bare.
 */
export function latestNotesSql(count: number) {
  return `
    SELECT
      activity.lead_id AS lead_id,
      activity_user.role AS role,
      JSON_UNQUOTE(JSON_EXTRACT(activity.details, '$.note')) AS note,
      activity.created_at AS created_at
    FROM lead_activity AS activity
    INNER JOIN crm_users AS activity_user
      ON ${binJoin('activity_user.id', 'activity.user_id')}
    INNER JOIN (
      SELECT
        activity.lead_id AS lead_id,
        activity_user.role AS role,
        MAX(activity.created_at) AS created_at
      FROM lead_activity AS activity
      INNER JOIN crm_users AS activity_user
        ON ${binJoin('activity_user.id', 'activity.user_id')}
      WHERE ${inParams('activity.lead_id', count)}
        AND ${inParams('activity_user.role', 2)}
        AND JSON_EXTRACT(activity.details, '$.note') IS NOT NULL
      GROUP BY activity.lead_id, activity_user.role
    ) AS latest
      ON ${binJoin('activity.lead_id', 'latest.lead_id')}
     AND ${binJoin('activity_user.role', 'latest.role')}
     AND ${binJoin('activity.created_at', 'latest.created_at')}
    WHERE JSON_EXTRACT(activity.details, '$.note') IS NOT NULL
  `;
}

function presentLeadRows(rows: Record<string, unknown>[], featured: boolean): ListLead[] {
  return rows.map(row => {
    const phone = displayLeadPhone(String(row.phone ?? ''));
    return featured
      ? {...row, phone, featured_available: 1}
      : {...row, phone, is_featured: 0, featured_available: 0};
  }) as ListLead[];
}

function blankNotes(row: ListLead): ListLead {
  return {
    ...row,
    sales_last_update: null,
    sales_last_update_at: null,
    field_last_update: null,
    field_last_update_at: null,
  };
}

async function queryRows(db: LeadQuery, sql: string, args: SqlValue[]) {
  const result = await db.prepare(sql).bind(...args).all();
  return result.results || [];
}

async function attachNotes(db: LeadQuery, rows: ListLead[]) {
  const blank = rows.map(blankNotes);
  const ids = blank.map(row => String(row.id ?? '')).filter(Boolean);
  if (!ids.length) return blank;
  const notes = await queryRows(db, latestNotesSql(ids.length), [...ids, 'sales', 'field']);
  const byLead = new Map<string, Record<string, unknown>>();
  for (const row of blank) byLead.set(String(row.id ?? ''), row);
  for (const note of notes) {
    const lead = byLead.get(String(note.lead_id ?? ''));
    if (!lead) continue;
    const role = String(note.role ?? '');
    if (role === 'sales') {
      lead.sales_last_update = note.note ?? null;
      lead.sales_last_update_at = note.created_at ?? null;
    } else if (role === 'field') {
      lead.field_last_update = note.note ?? null;
      lead.field_last_update_at = note.created_at ?? null;
    }
  }
  return blank;
}

function pagePayload(
  leads: ListLead[],
  filteredTotal: number,
  page: number,
  pageSize: number,
  counts: LeadListCounts
): LeadListPage {
  const pages = Math.max(1, Math.ceil(filteredTotal / pageSize));
  return {leads, page, pageSize, total: filteredTotal, pages, counts};
}

export async function loadLeadPage(
  db: LeadQuery,
  user: {userId: string; role: string},
  filters: LeadListFilters,
  featured: boolean
): Promise<LeadListPage> {
  const today = riyadhDayKey(new Date());
  const scope = scopeClause(user.role, user.userId);
  if (filters.picklist) {
    const sql = `
      SELECT
        leads.id, leads.name, leads.phone, leads.source,
        leads.property_id, leads.property_other,
        sales_user.name AS assigned_name,
        field_user.name AS field_assigned_name
      FROM leads
      ${userJoins()}
      ${scope.sql}
    `;
    const leads = presentLeadRows(await queryRows(db, sql, scope.args), featured);
    const counts = leadListCounts(leads, today);
    return pagePayload(leads, leads.length, 1, Math.max(leads.length, 1), counts);
  }
  const select = `
    SELECT
      leads.*,
      sales_user.name AS assigned_name,
      sales_user.username AS assigned_username,
      field_user.name AS field_assigned_name,
      field_user.username AS field_assigned_username
    FROM leads
    ${userJoins()}
  `;
  if (filters.id) {
    const where = scope.sql ? `${scope.sql} AND ${paramEq('leads.id')}` : ` WHERE ${paramEq('leads.id')}`;
    const leads = presentLeadRows(await queryRows(db, `${select} ${where}`, [...scope.args, filters.id]), featured);
    const withNotes = await attachNotes(db, leads);
    return pagePayload(withNotes, withNotes.length, 1, 1, leadListCounts(withNotes, today));
  }
  const leads = presentLeadRows(await queryRows(db, `${select} ${scope.sql}`, scope.args), featured);
  const counts = leadListCounts(leads, today);
  const duplicatePhones = new Set(counts.duplicatePhones);
  const filtered = leads
    .filter(lead => leadMatchesClientFilters(lead, filters, duplicatePhones, today, Date.now()))
    .sort((a, b) => {
      if (user.role === 'field') {
        const rank = Number(fieldReportRequired(b)) - Number(fieldReportRequired(a));
        if (rank) return rank;
      }
      return compareClients(a, b);
    });
  const pages = Math.max(1, Math.ceil(filtered.length / LEAD_PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const slice = filtered.slice((page - 1) * LEAD_PAGE_SIZE, page * LEAD_PAGE_SIZE);
  const withNotes = await attachNotes(db, slice);
  return pagePayload(withNotes, filtered.length, page, LEAD_PAGE_SIZE, counts);
}
