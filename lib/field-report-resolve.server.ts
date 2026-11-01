import {crmDb} from './crm-db';
import {paramEq} from './sql-collation';

function missingSchema(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /unknown column|no such column|no such table|doesn't exist|ER_NO_SUCH_TABLE|ER_BAD_FIELD_ERROR/i.test(message);
}

/**
 * A filed visit report ends the overdue notice for every recipient of that lead:
 * the field employee, the assigned sales rep, and admins. The alert row is removed
 * and field_report_alert_at is cleared so the badge and the in-app notice both stop.
 * Comparisons cast the parameter, not the column, so mixed collations do not raise 1267.
 */
export async function resolveFieldReportAlerts(leadId: string) {
  const id = leadId.trim();
  if (!id) return;
  const db = crmDb();
  try {
    await db.prepare(`UPDATE leads SET field_report_alert_at = NULL WHERE ${paramEq('id')}`).bind(id).run();
  } catch (error) {
    if (!missingSchema(error)) throw error;
  }
  try {
    await db
      .prepare(`DELETE FROM crm_user_alerts WHERE ${paramEq('lead_id')} AND ${paramEq('kind')}`)
      .bind(id, 'field_report_overdue')
      .run();
  } catch (error) {
    if (!missingSchema(error)) throw error;
  }
}
