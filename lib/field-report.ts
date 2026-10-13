/**
 * A lead dispatched to a field employee (تفويج للميداني) needs a visit report
 * before the visit can be marked done (تم زيارة العقار). The overdue check
 * sends one alert per dispatch after FIELD_REPORT_DEADLINE_HOURS (default 24).
 */
import {displayStage} from './lead-stages';
import {crmInstant, formatRiyadhDate} from './lead-dates';
import {displayLeadPhone} from './phone';

export const VISIT_DONE_STAGE = 'property_visited';
export const FIELD_REPORT_MAX = 2000;
export const DEFAULT_FIELD_REPORT_DEADLINE_HOURS = 24;

export type FieldReportLead = {
  stage?: string | null;
  field_assigned_to?: string | null;
  field_dispatched_at?: string | null;
  field_report?: string | null;
};

export function fieldReportText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  return String(value).trim();
}

export function clipFieldReport(value: string) {
  const text = value.trim();
  return text.length > FIELD_REPORT_MAX ? text.slice(0, FIELD_REPORT_MAX) : text;
}

/** Dispatched to a field employee, still in تفويج, and the report is empty. */
export function fieldReportRequired(lead: FieldReportLead) {
  if (displayStage(lead.stage) !== 'field_dispatch') return false;
  if (!String(lead.field_assigned_to ?? '').trim()) return false;
  return !fieldReportText(lead.field_report);
}

/**
 * Moving a dispatched lead to تم زيارة العقار needs a non-empty report.
 * `incomingReport` is a note submitted in the same request by the field employee.
 */
export function visitDoneBlocked(lead: FieldReportLead, nextStage: string, incomingReport = '') {
  if (nextStage !== VISIT_DONE_STAGE) return false;
  if (!fieldReportRequired(lead)) return false;
  return !fieldReportText(incomingReport);
}

/** The visit-done checkbox only moves a lead that is still in تفويج للميداني. */
export function markedVisitStage(current: string | null | undefined, visitDone: boolean) {
  if (!visitDone || displayStage(current) !== 'field_dispatch') return '';
  return VISIT_DONE_STAGE;
}

export function fieldReportDeadlineHours(raw = process.env.FIELD_REPORT_DEADLINE_HOURS) {
  const text = (raw ?? '').trim();
  if (!text) return DEFAULT_FIELD_REPORT_DEADLINE_HOURS;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_FIELD_REPORT_DEADLINE_HOURS;
  return Math.min(value, 24 * 30);
}

export function fieldReportOverdue(
  dispatchedAt: string | null | undefined,
  now = Date.now(),
  hours = fieldReportDeadlineHours()
) {
  const instant = crmInstant(dispatchedAt);
  if (!instant) return false;
  return now - instant.getTime() >= hours * 60 * 60 * 1000;
}

export function fieldReportStamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

export function fieldReportOverdueMessage(input: {
  fieldName: string;
  leadName: string;
  phone: string;
  dispatchedAt: string;
}) {
  const fieldName = input.fieldName.trim() || 'غير مسمّى';
  const name = input.leadName.trim();
  const phone = displayLeadPhone(input.phone) || input.phone.trim();
  const client = [name, phone].filter(Boolean).join(' / ') || 'عميل';
  const date = formatRiyadhDate(input.dispatchedAt) || input.dispatchedAt.trim() || 'غير محدد';
  return `الموظف الميداني ${fieldName} لم يُدخل تقرير العميل ${client} المفوَّج له بتاريخ ${date}`;
}
