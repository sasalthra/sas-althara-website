import 'server-only';
import {createHash, randomUUID} from 'node:crypto';
import {crmDb} from './crm-db';
import {
  fieldReportDeadlineHours,
  fieldReportOverdue,
  fieldReportOverdueMessage,
  fieldReportRequired,
  fieldReportStamp,
  fieldReportText,
} from './field-report';
import {adminRecipientEmails, fieldReportOverdueEmail, normalizeEmail, uniqueEmails} from './assignment-email';
import {sendMail} from './mail';
import {paramEq} from './sql-collation';
import {publicSyncError} from './sheet-sync-config';

export type FieldReportJobReport = {
  ok: boolean;
  checked: number;
  alerted: number;
  emailed: number;
  skipped: number;
  error: string;
  at: string;
};

type LeadRow = {
  id: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  assigned_to: string | null;
  field_assigned_to: string | null;
  field_dispatched_at: string | null;
  field_report: string | null;
  field_report_alert_at: string | null;
};

type Person = {
  id: string;
  name: string;
  email: string | null;
  role: string;
};

const BATCH = 40;
let inflight: Promise<FieldReportJobReport> | null = null;

function emptyReport(error = ''): FieldReportJobReport {
  return {
    ok: !error,
    checked: 0,
    alerted: 0,
    emailed: 0,
    skipped: 0,
    error,
    at: new Date().toISOString(),
  };
}

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function dedupeKey(userId: string, leadId: string, dispatchedAt: string) {
  return createHash('sha256').update(`${userId}|${leadId}|${dispatchedAt}`).digest('hex');
}

async function loadPeople(ids: string[]): Promise<Person[]> {
  const unique = [...new Set(ids.map(id => id.trim()).filter(Boolean))];
  const idSql = unique.map(() => paramEq('id')).join(' OR ');
  const sql = unique.length
    ? `SELECT id, name, email, role FROM crm_users WHERE active = 1 AND (role = CAST(? AS BINARY) OR ${idSql})`
    : `SELECT id, name, email, role FROM crm_users WHERE active = 1 AND role = CAST(? AS BINARY)`;
  const rows = await crmDb().prepare(sql).bind('admin', ...unique).all();
  return rows.results.map(row => ({
    id: text(row.id),
    name: text(row.name),
    email: normalizeEmail(row.email == null ? '' : String(row.email)) || null,
    role: text(row.role),
  }));
}

async function claim(id: string, at: string) {
  const result = await crmDb()
    .prepare(`UPDATE leads SET field_report_alert_at = ? WHERE ${paramEq('id')} AND field_report_alert_at IS NULL`)
    .bind(at, id)
    .run();
  return (result.meta?.changes || 0) > 0;
}

async function rememberAlert(userId: string, leadId: string, dispatchedAt: string, message: string, at: string) {
  const clipped = message.length > 500 ? message.slice(0, 500) : message;
  try {
    await crmDb()
      .prepare(`
        INSERT INTO crm_user_alerts (id, user_id, dedupe_key, kind, lead_id, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(randomUUID(), userId, dedupeKey(userId, leadId, dispatchedAt), 'field_report_overdue', leadId, clipped, at)
      .run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(detail)) return;
    throw error;
  }
}

async function alertOne(lead: LeadRow, at: string) {
  const dispatchedAt = text(lead.field_dispatched_at);
  const fieldUserId = text(lead.field_assigned_to);
  const salesUserId = text(lead.assigned_to);
  const people = await loadPeople([fieldUserId, salesUserId]);
  const fieldPerson = people.find(person => person.id === fieldUserId);
  const message = fieldReportOverdueMessage({
    fieldName: fieldPerson?.name || '',
    leadName: text(lead.name),
    phone: text(lead.phone),
    dispatchedAt,
  });
  const claimed = await claim(text(lead.id), at);
  if (!claimed) return {alerted: false, emailed: false};
  const recipients = new Map<string, Person>();
  for (const person of people) {
    if (person.role === 'admin' || person.id === fieldUserId || person.id === salesUserId) {
      if (person.id) recipients.set(person.id, person);
    }
  }
  for (const person of recipients.values()) {
    await rememberAlert(person.id, text(lead.id), dispatchedAt, message, at);
  }
  const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  const mail = fieldReportOverdueEmail({
    message,
    url: `${base}/crm/leads/${text(lead.id)}`,
  });
  const emails = uniqueEmails([
    ...adminRecipientEmails(people),
    fieldPerson?.email,
    people.find(person => person.id === salesUserId)?.email,
  ]);
  let emailed = false;
  if (!emails.length) {
    console.warn('Field report alert email skipped; no recipients');
  } else {
    emailed = await sendMail({to: emails, ...mail});
    if (!emailed) console.warn('Field report alert email was not sent');
  }
  return {alerted: true, emailed};
}

async function doCheck(): Promise<FieldReportJobReport> {
  const report = emptyReport();
  try {
    const rows = await crmDb()
      .prepare(`
        SELECT id, name, phone, stage, assigned_to, field_assigned_to,
               field_dispatched_at, field_report, field_report_alert_at
        FROM leads
        WHERE field_report_alert_at IS NULL
          AND field_dispatched_at IS NOT NULL
      `)
      .all();
    const now = Date.now();
    const hours = fieldReportDeadlineHours();
    const due = (rows.results as LeadRow[])
      .filter(lead => fieldReportRequired(lead) && !fieldReportText(lead.field_report_alert_at))
      .filter(lead => fieldReportOverdue(lead.field_dispatched_at, now, hours))
      .sort((a, b) => text(a.field_dispatched_at).localeCompare(text(b.field_dispatched_at)));
    report.checked = due.length;
    const at = fieldReportStamp();
    for (const lead of due.slice(0, BATCH)) {
      try {
        const result = await alertOne(lead, at);
        if (result.alerted) report.alerted += 1;
        if (result.emailed) report.emailed += 1;
        if (!result.alerted) report.skipped += 1;
      } catch (error) {
        report.skipped += 1;
        console.error('field report alert failed', publicSyncError(error));
      }
    }
    return report;
  } catch (error) {
    const message = publicSyncError(error);
    console.error('field report check failed', message);
    report.ok = false;
    report.error = message || 'تعذر فحص تقارير الميدان';
    return report;
  }
}

/** One overdue notice per dispatch. A later تفويج starts a new clock. */
export function checkOverdueFieldReports(): Promise<FieldReportJobReport> {
  if (!inflight) {
    inflight = doCheck().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
