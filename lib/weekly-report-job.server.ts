import 'server-only';
import {crmDb} from './crm-db';
import {CRM_MAIL_FROM, sendMail} from './mail';
import {asBinary, paramEq} from './sql-collation';
import {publicSyncError} from './sheet-sync-config';
import type {DirectoryUser} from './lead-cohorts';
import {
  buildWeeklyReport,
  renderWeeklyReportHtml,
  renderWeeklyReportText,
  riyadhWindowBounds,
  weeklyReportRecipients,
  weeklyReportSubject,
  weeklyReportWindow,
  weeklySendDecision,
  type WeeklyLead,
  type WeeklyReportData,
} from './weekly-report';

export type WeeklyReportJobResult = {
  ok: boolean;
  sent: boolean;
  preview: boolean;
  reason: string;
  weekKey: string;
  from: string;
  to: string;
  toAddress: string[];
  html?: string;
};

const DATE_COLUMNS = ['created_at', 'assigned_at', 'field_dispatched_at', 'first_field_dispatch_at', 'field_report_at'] as const;
const OPTIONAL_COLUMNS = ['assigned_at', 'field_dispatched_at', 'first_field_dispatch_at', 'field_report', 'field_report_at'] as const;

let inflight: Promise<WeeklyReportJobResult> | null = null;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? '');
}

function stampExpr(column: string) {
  return asBinary(`REPLACE(${asBinary(`SUBSTR(${column},1,19)`)}, ${asBinary(`'T'`)}, ${asBinary(`' '`)})`);
}

function inWindow(column: string) {
  const expr = stampExpr(column);
  return `${expr} >= ${asBinary('?')} AND ${expr} < ${asBinary('?')}`;
}

function emptyResult(extra: Partial<WeeklyReportJobResult> = {}): WeeklyReportJobResult {
  return {ok: true, sent: false, preview: false, reason: '', weekKey: '', from: '', to: '', toAddress: [], ...extra};
}

async function claimWeek(weekKey: string, sentAt: string) {
  try {
    await crmDb().prepare('INSERT INTO crm_weekly_report_sends (week_key, sent_at) VALUES (?, ?)').bind(weekKey, sentAt).run();
    return true;
  } catch (error) {
    if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(messageOf(error))) return false;
    throw error;
  }
}

async function releaseWeek(weekKey: string) {
  await crmDb().prepare(`DELETE FROM crm_weekly_report_sends WHERE ${paramEq('week_key')}`).bind(weekKey).run();
}

async function rememberWeek(weekKey: string, sentAt: string) {
  const claimed = await claimWeek(weekKey, sentAt);
  if (claimed) return;
  await crmDb().prepare(`UPDATE crm_weekly_report_sends SET sent_at = ? WHERE ${paramEq('week_key')}`).bind(sentAt, weekKey).run();
}

async function loadLeads(from: string, to: string): Promise<WeeklyLead[]> {
  const bounds = riyadhWindowBounds(from, to);
  let optional: string[] = [...OPTIONAL_COLUMNS];
  for (let attempt = 0; attempt < OPTIONAL_COLUMNS.length + 1; attempt++) {
    const columns = ['id', 'source', 'stage', 'assigned_to', 'field_assigned_to', 'created_at', ...optional];
    const windows = DATE_COLUMNS.filter(column => column === 'created_at' || optional.includes(column));
    const sql = `SELECT ${columns.join(', ')} FROM leads WHERE ${windows.map(column => inWindow(column)).join(' OR ')}`;
    const args = windows.flatMap(() => [bounds.start, bounds.end]);
    try {
      const rows = await crmDb().prepare(sql).bind(...args).all();
      return rows.results as WeeklyLead[];
    } catch (error) {
      const message = messageOf(error);
      if (!/unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(message)) throw error;
      const dropped = optional.find(column => message.includes(column));
      if (!dropped) throw error;
      optional = optional.filter(column => column !== dropped);
    }
  }
  throw new Error('weekly report lead query failed');
}

async function loadStaff(): Promise<DirectoryUser[]> {
  const queries = [
    'SELECT id, name, username, role FROM crm_users WHERE active = 1',
    'SELECT id, name, role FROM crm_users WHERE active = 1',
    'SELECT id, name, username, role FROM crm_users',
    'SELECT id, name FROM crm_users',
  ];
  let last: unknown;
  for (const sql of queries) {
    try {
      const rows = await crmDb().prepare(sql).bind().all();
      return rows.results.map(row => ({
        id: String(row.id ?? ''),
        name: String(row.name ?? '').trim() || String(row.id ?? ''),
        username: String(row.username ?? '').trim(),
        role: String(row.role ?? '').trim(),
      }));
    } catch (error) {
      last = error;
      if (!/username|active|unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(messageOf(error))) throw error;
    }
  }
  throw last instanceof Error ? last : new Error('weekly report staff query failed');
}

export async function loadWeeklyReport(now = new Date()): Promise<WeeklyReportData> {
  const window = weeklyReportWindow(now);
  const [leads, staff] = await Promise.all([loadLeads(window.from, window.to), loadStaff()]);
  return buildWeeklyReport(leads, staff, window.from, window.to, window.weekKey);
}

async function deliver(options: {force?: boolean; preview?: boolean; now?: Date}): Promise<WeeklyReportJobResult> {
  const now = options.now || new Date();
  const window = weeklyReportWindow(now);
  const preview = Boolean(options.preview);
  const force = Boolean(options.force);
  const decision = weeklySendDecision({due: window.due, alreadySent: false, force, preview});
  if (decision === 'skip' && !force && !preview && !window.due) {
    return emptyResult({reason: 'not-due', weekKey: window.weekKey, from: window.from, to: window.to});
  }
  const report = await loadWeeklyReport(now);
  const html = renderWeeklyReportHtml(report);
  const text = renderWeeklyReportText(report);
  if (preview) {
    return emptyResult({ok: true, preview: true, reason: 'preview', weekKey: window.weekKey, from: window.from, to: window.to, html});
  }
  const recipients = weeklyReportRecipients(process.env.WEEKLY_REPORT_TO);
  if (!force) {
    const claimed = await claimWeek(window.weekKey, now.toISOString());
    if (!claimed) return emptyResult({reason: 'already-sent', weekKey: window.weekKey, from: window.from, to: window.to, toAddress: recipients});
  }
  try {
    const sent = await sendMail({
      to: recipients,
      from: CRM_MAIL_FROM,
      subject: weeklyReportSubject(report),
      text,
      html,
    });
    if (!sent) {
      if (!force) await releaseWeek(window.weekKey);
      return emptyResult({ok: false, reason: 'mail-failed', weekKey: window.weekKey, from: window.from, to: window.to, toAddress: recipients});
    }
    if (force) await rememberWeek(window.weekKey, now.toISOString());
    return emptyResult({ok: true, sent: true, reason: force ? 'forced' : 'sent', weekKey: window.weekKey, from: window.from, to: window.to, toAddress: recipients});
  } catch (error) {
    if (!force) await releaseWeek(window.weekKey).catch(releaseError => console.error('weekly report claim release failed', publicSyncError(releaseError)));
    throw error;
  }
}

export function sendWeeklyReport(options: {force?: boolean; preview?: boolean; now?: Date} = {}): Promise<WeeklyReportJobResult> {
  if (options.preview || options.force || options.now) return deliver(options);
  if (!inflight) {
    inflight = deliver(options).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export function sendWeeklyReportIfDue() {
  return sendWeeklyReport();
}
