import {crmDb} from './crm-db';
import {
  adminAssignmentEmail,
  adminRecipientEmails,
  assigneeAssignmentEmail,
  assignmentChanged,
  groupClientsByAssignee,
  normalizeEmail,
  type AssignmentClient,
  type AssignmentEmployee,
} from './assignment-email';
import {sendMail} from './mail';

type CrmPerson = AssignmentEmployee & {role: string};

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
