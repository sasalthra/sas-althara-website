import {crmDb} from './crm-db';
import {
  adminAssignmentEmail,
  adminFieldDispatchEmail,
  adminRecipientEmails,
  assigneeAssignmentEmail,
  assignmentChanged,
  fieldDispatchEmail,
  groupClientsByAssignee,
  normalizeEmail,
  newLeadDigestEmail,
  newLeadEmail,
  reregistrationDigestEmail,
  reregistrationEmail,
  sheetBackfillSummaryEmail,
  type AssignmentClient,
  type AssignmentEmployee,
  type NewLeadMailInput,
} from './assignment-email';
import {leadSourceLabel, riyadhStamp} from './lead-reregistration';
import {stageLabel} from './lead-stages';
import {sendMail} from './mail';

type CrmPerson = AssignmentEmployee & {role: string};

/** Names and recipient addresses are read from crm_users here, at send time, never from the session. */
async function loadPeople(assigneeIds: string[]): Promise<CrmPerson[]> {
  const uniqueIds = [...new Set(assigneeIds.filter(Boolean))];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const sql = uniqueIds.length
    ? `SELECT id, name, email, role FROM crm_users WHERE active = 1 AND (role = 'admin' OR id IN (${placeholders}))`
    : `SELECT id, name, email, role FROM crm_users WHERE active = 1 AND role = 'admin'`;
  const rows = await crmDb()
    .prepare(sql)
    .bind(...uniqueIds)
    .all();
  return rows.results.map((row) => ({
    id: String(row.id),
    name: String(row.name || ''),
    email: normalizeEmail(row.email == null ? '' : String(row.email)) || null,
    role: String(row.role || ''),
  }));
}

function employeeFrom(people: CrmPerson[], id: string): AssignmentEmployee {
  const match = people.find((person) => person.id === id);
  return match || {id, name: 'مندوب المبيعات', email: null};
}

async function sendAssignmentMails(
  groups: Array<{employee: AssignmentEmployee; clients: AssignmentClient[]}>,
  people: CrmPerson[]
) {
  if (!groups.length) return;
  const adminTo = adminRecipientEmails(people);
  for (const group of groups) {
    const assigneeEmail = normalizeEmail(group.employee.email);
    if (!assigneeEmail) {
      console.warn(
        `Assignment email skipped; assignee ${group.employee.name || group.employee.id} has no email`
      );
    } else {
      const mail = assigneeAssignmentEmail(group.employee, group.clients);
      await sendMail({to: assigneeEmail, ...mail});
    }
  }
  if (!adminTo.length) {
    console.warn('Assignment admin email skipped; no admin recipients');
    return;
  }
  const mail = adminAssignmentEmail(groups);
  await sendMail({to: adminTo, ...mail});
}

export async function notifyLeadAssignment(input: {
  previousAssignedTo?: string | null;
  assignedTo?: string | null;
  client: AssignmentClient;
}) {
  if (!assignmentChanged(input.previousAssignedTo, input.assignedTo)) return;
  const assignedTo = input.assignedTo!.trim();
  try {
    const people = await loadPeople([assignedTo]);
    await sendAssignmentMails(
      [{employee: employeeFrom(people, assignedTo), clients: [input.client]}],
      people
    );
  } catch (error) {
    console.error('Assignment email failed:', error);
  }
}

export async function notifyImportAssignments(
  items: Array<{assignedTo: string; client: AssignmentClient}>
) {
  const grouped = groupClientsByAssignee(items);
  if (!grouped.size) return;
  try {
    const people = await loadPeople([...grouped.keys()]);
    const groups = [...grouped.entries()].map(([id, clients]) => ({
      employee: employeeFrom(people, id),
      clients,
    }));
    await sendAssignmentMails(groups, people);
  } catch (error) {
    console.error('Import assignment email failed:', error);
  }
}

export async function notifyFieldDispatch(input: {
  fieldUserId: string;
  dispatcherName: string;
  client: AssignmentClient & {id: string};
  dispatchNote?: string | null;
}) {
  try {
    const people = await loadPeople([input.fieldUserId]);
    const match = people.find((person) => person.id === input.fieldUserId);
    const employeeName = match?.name || 'الموظف الميداني';
    const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
    const mailInput = {
      dispatcherName: input.dispatcherName,
      employeeName,
      client: input.client,
      url: `${base}/crm/leads/${input.client.id}`,
      dispatchNote: input.dispatchNote,
    };
    const assigneeEmail = normalizeEmail(match?.email);
    if (!assigneeEmail) {
      console.warn(
        `Field dispatch email skipped; employee ${employeeName} has no email`
      );
    } else {
      await sendMail({
        to: assigneeEmail,
        ...fieldDispatchEmail(mailInput),
      });
    }
    const adminTo = adminRecipientEmails(people);
    if (!adminTo.length) {
      console.warn('Field dispatch admin email skipped; no admin recipients');
      return;
    }
    await sendMail({
      to: adminTo,
      ...adminFieldDispatchEmail(mailInput),
    });
  } catch (error) {
    console.error('Field dispatch email failed:', error);
  }
}

export async function notifyReregistration(input: {
  lead: {id: string; name: string; phone: string; stage: string; assigned_to?: string | null};
  source: string;
  submittedName?: string | null;
  submittedNotes?: string | null;
  campaign?: string | null;
}) {
  try {
    const assignedTo = input.lead.assigned_to?.trim() || '';
    const people = await loadPeople(assignedTo ? [assignedTo] : []);
    const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
    const mail = reregistrationEmail({
      name: input.lead.name,
      phone: input.lead.phone,
      stageLabel: stageLabel(input.lead.stage || ''),
      sourceLabel: leadSourceLabel(input.source),
      campaign: input.campaign,
      submittedName: input.submittedName,
      submittedNotes: input.submittedNotes,
      url: `${base}/crm/leads/${input.lead.id}`,
      when: riyadhStamp(),
    });
    if (assignedTo) {
      const assignee = people.find((person) => person.id === assignedTo);
      const assigneeEmail = normalizeEmail(assignee?.email);
      if (!assigneeEmail) {
        console.warn(`Reregistration email skipped for assignee ${assignedTo}; no email on the user`);
      } else {
        await sendMail({to: assigneeEmail, ...mail});
      }
    }
    const adminTo = adminRecipientEmails(people);
    if (!adminTo.length) {
      console.warn('Reregistration admin email skipped; no admin recipients');
      return;
    }
    await sendMail({to: adminTo, ...mail});
  } catch (error) {
    console.error('Reregistration email failed:', error);
  }
}

export type NewLeadNotice = {
  id: string;
  name: string;
  phone: string;
  source: string;
};

function leadBase() {
  return (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
}

function stampLead(lead: NewLeadNotice, when: string): NewLeadMailInput {
  const base = leadBase();
  return {
    name: lead.name,
    phone: lead.phone,
    source: lead.source,
    when,
    url: `${base}/crm/leads/${lead.id}`,
    distributeUrl: `${base}/crm?tab=leads`,
  };
}

/** One email per new lead, or a single digest when a sync brings in more than five. */
export async function notifyNewLeads(leads: NewLeadNotice[]) {
  const fresh = leads.filter(lead => lead.id && lead.phone);
  if (!fresh.length) return;
  try {
    const people = await loadPeople([]);
    const adminTo = adminRecipientEmails(people);
    if (!adminTo.length) {
      console.warn('New lead admin email skipped; no admin recipients');
      return;
    }
    const when = riyadhStamp();
    const stamped = fresh.map(lead => stampLead(lead, when));
    if (stamped.length > 5) {
      await sendMail({to: adminTo, ...newLeadDigestEmail(stamped)});
      return;
    }
    for (const lead of stamped) {
      await sendMail({to: adminTo, ...newLeadEmail(lead)});
    }
  } catch (error) {
    console.error('New lead email failed:', error);
  }
}

export async function notifyNewLead(lead: NewLeadNotice) {
  await notifyNewLeads([lead]);
}

export type SheetBackfillNotice = {
  label: string;
  campaign: string;
  inserted: number;
  duplicates: number;
};

/** Admins only. Replaces per-lead and re-registration mail for a source's first sync. */
export async function notifySheetBackfillSummaries(items: SheetBackfillNotice[]) {
  const fresh = items.filter(item => item.inserted > 0 || item.duplicates > 0);
  if (!fresh.length) return;
  const people = await loadPeople([]);
  const adminTo = adminRecipientEmails(people);
  if (!adminTo.length) {
    console.warn('Sheet backfill summary skipped; no admin recipients');
    return;
  }
  const when = riyadhStamp();
  const url = `${leadBase()}/crm?tab=leads`;
  for (const item of fresh) {
    try {
      await sendMail({to: adminTo, ...sheetBackfillSummaryEmail({...item, when, url})});
    } catch (error) {
      console.error('Sheet backfill summary failed:', error);
    }
  }
}

export async function notifyReregistrationBatch(
  items: Array<{
    lead: {id: string; name: string; phone: string; stage: string; assigned_to?: string | null};
    source: string;
    submittedName?: string | null;
    submittedNotes?: string | null;
    campaign?: string | null;
  }>
) {
  if (!items.length) return;
  if (items.length <= 5) {
    for (const item of items) {
      try {
        await notifyReregistration(item);
      } catch (error) {
        console.error('Reregistration email failed:', error);
      }
    }
    return;
  }
  try {
    const people = await loadPeople(items.map(item => item.lead.assigned_to || ''));
    const adminTo = adminRecipientEmails(people);
    const when = riyadhStamp();
    const base = leadBase();
    const stamped = items.map(item => ({
      name: item.lead.name,
      phone: item.lead.phone,
      stageLabel: stageLabel(item.lead.stage || ''),
      sourceLabel: leadSourceLabel(item.source),
      campaign: item.campaign,
      submittedName: item.submittedName,
      submittedNotes: item.submittedNotes,
      url: `${base}/crm/leads/${item.lead.id}`,
      when,
    }));
    if (adminTo.length) await sendMail({to: adminTo, ...reregistrationDigestEmail(stamped)});
    const byRep = new Map<string, typeof stamped>();
    items.forEach((item, index) => {
      const assignedTo = item.lead.assigned_to?.trim() || '';
      if (!assignedTo) return;
      const list = byRep.get(assignedTo) || [];
      list.push(stamped[index]);
      byRep.set(assignedTo, list);
    });
    for (const [id, list] of byRep) {
      const assignee = people.find(person => person.id === id);
      const email = normalizeEmail(assignee?.email);
      if (!email || !list.length) continue;
      await sendMail({to: email, ...reregistrationDigestEmail(list)});
    }
  } catch (error) {
    console.error('Reregistration digest failed:', error);
  }
}
