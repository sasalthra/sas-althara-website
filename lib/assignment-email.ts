import {ADMIN_EMAIL} from './auth-policy';
import {stageLabel} from './lead-stages';

export type AssignmentClient = {
  name: string;
  phone: string;
  stage?: string | null;
  source?: string | null;
  notes?: string | null;
  propertyRequest?: string | null;
  followUp?: string | null;
};

export type AssignmentEmployee = {
  id: string;
  name: string;
  email: string | null;
};

export function normalizeEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() || '';
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function uniqueEmails(values: Array<string | null | undefined>) {
  return [...new Set(values.map(normalizeEmail).filter(Boolean))];
}

export function assignmentId(value: string | null | undefined) {
  return value?.trim() || '';
}

export function assignmentChanged(
  previous: string | null | undefined,
  next: string | null | undefined
) {
  const assignedTo = assignmentId(next);
  return Boolean(assignedTo && assignedTo !== assignmentId(previous));
}

export function propertyRequestText(
  propertyId?: string | null,
  propertyOther?: string | null
) {
  return (propertyOther || propertyId || '').trim();
}

export function adminRecipientEmails(
  users: Array<{role?: string | null; email?: string | null}>
) {
  return uniqueEmails([
    ...users.filter((user) => user.role === 'admin').map((user) => user.email),
    ADMIN_EMAIL,
  ]);
}

export function groupClientsByAssignee(
  items: Array<{assignedTo: string; client: AssignmentClient}>
) {
  const groups = new Map<string, AssignmentClient[]>();
  for (const item of items) {
    const assignedTo = assignmentId(item.assignedTo);
    if (!assignedTo) continue;
    const list = groups.get(assignedTo) || [];
    list.push(item.client);
    groups.set(assignedTo, list);
  }
  return groups;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => (
    {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char] || char
  ));
}

function detailRows(client: AssignmentClient) {
  const stage = client.stage ? stageLabel(client.stage) : '';
  return [
    ['الاسم', client.name],
    ['الجوال', client.phone],
    ['المرحلة', stage],
    ['المصدر', client.source || ''],
    ['طلب العقار', client.propertyRequest || ''],
    ['الملاحظات', client.notes || ''],
    ['موعد المتابعة', client.followUp || ''],
  ].filter(([, value]) => Boolean(value && String(value).trim()));
}

export function formatClientText(client: AssignmentClient) {
  return detailRows(client)
    .map(([label, value]) => `${label}: ${String(value).trim()}`)
    .join('\n');
}

function clientHtml(client: AssignmentClient) {
  const rows = detailRows(client)
    .map(([label, value]) => `<tr><th style="text-align:right;padding:6px 10px;color:#5B245F;font-weight:400;white-space:nowrap">${escapeHtml(label)}</th><td style="padding:6px 10px">${escapeHtml(String(value).trim()).replace(/\n/g, '<br/>')}</td></tr>`)
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:12px 0;background:#f5f6f8;border:1px solid #e5e7eb">${rows}</table>`;
}

function wrapHtml(title: string, body: string) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:24px;background:#fff;color:#111827;font-family:Tahoma,Arial,sans-serif;line-height:1.7;direction:rtl;text-align:right"><div style="max-width:640px;margin:0 auto"><p style="margin:0 0 16px;color:#3F1A44;font-size:20px">ساس الثراء</p><h1 style="margin:0 0 16px;color:#3F1A44;font-size:22px;font-weight:400">${escapeHtml(title)}</h1>${body}<p style="margin:24px 0 0;color:#6b7280;font-size:13px">هذه رسالة تلقائية من نظام ساس الثراء.</p></div></body></html>`;
}

export function assigneeAssignmentEmail(
  employee: AssignmentEmployee,
  clients: AssignmentClient[]
) {
  const count = clients.length;
  const subject = count === 1
    ? `تم تعيين عميل إليك — ${clients[0].name || 'ساس الثراء'}`
    : `تم تعيين ${count} عملاء إليك — ساس الثراء`;
  const intro = count === 1
    ? `مرحباً ${employee.name || 'مندوب المبيعات'}،\nتم تعيين العميل التالي إليك.`
    : `مرحباً ${employee.name || 'مندوب المبيعات'}،\nتم تعيين ${count} عملاء إليك.`;
  const text = [intro, ...clients.map((client, index) => `${count > 1 ? `\nعميل ${index + 1}\n` : '\n'}${formatClientText(client)}`), '\nيمكنك متابعتهم من لوحة العملاء في ساس الثراء.'].join('\n');
  const html = wrapHtml(
    count === 1 ? 'تم تعيين عميل إليك' : `تم تعيين ${count} عملاء إليك`,
    `<p>${escapeHtml(intro).replace(/\n/g, '<br/>')}</p>${clients.map(clientHtml).join('')}<p>يمكنك متابعتهم من لوحة العملاء في ساس الثراء.</p>`
  );
  return {subject, text, html};
}

export function adminAssignmentEmail(
  groups: Array<{employee: AssignmentEmployee; clients: AssignmentClient[]}>
) {
  const total = groups.reduce((sum, group) => sum + group.clients.length, 0);
  const singleGroup = groups.length === 1 ? groups[0] : null;
  const subject = singleGroup && total === 1
    ? `تم تعيين عميل إلى ${singleGroup.employee.name || 'مندوب المبيعات'} — ساس الثراء`
    : singleGroup
      ? `تم تعيين ${total} عملاء إلى ${singleGroup.employee.name || 'مندوب المبيعات'} — ساس الثراء`
      : `تم تعيين ${total} عملاء إلى مناديب المبيعات — ساس الثراء`;
  const intro = singleGroup
    ? `تم تعيين ${total === 1 ? 'عميل' : `${total} عملاء`} إلى ${singleGroup.employee.name || 'مندوب المبيعات'}${singleGroup.employee.email ? ` (${singleGroup.employee.email})` : ''}.`
    : `تم تعيين ${total} عملاء إلى ${groups.length} من مناديب المبيعات.`;
  const textParts = [intro];
  for (const group of groups) {
    if (!singleGroup) {
      textParts.push(`\nالمندوب: ${group.employee.name}${group.employee.email ? ` — ${group.employee.email}` : ''}\nعدد العملاء: ${group.clients.length}`);
    } else if (group.employee.email) {
      textParts.push(`بريد المندوب: ${group.employee.email}`);
    }
    for (const [index, client] of group.clients.entries()) {
      textParts.push(`${group.clients.length > 1 ? `\nعميل ${index + 1}\n` : '\n'}${formatClientText(client)}`);
    }
  }
  const htmlGroups = groups.map((group) => {
    const heading = singleGroup
      ? ''
      : `<h2 style="margin:20px 0 8px;color:#3F1A44;font-size:18px;font-weight:400">${escapeHtml(group.employee.name || 'مندوب المبيعات')}${group.employee.email ? ` — ${escapeHtml(group.employee.email)}` : ''} (${group.clients.length})</h2>`;
    return `${heading}${group.clients.map(clientHtml).join('')}`;
  }).join('');
  const html = wrapHtml(
    total === 1 ? 'تعيين عميل' : `تعيين ${total} عملاء`,
    `<p>${escapeHtml(intro)}</p>${singleGroup?.employee.email ? `<p>بريد المندوب: ${escapeHtml(singleGroup.employee.email)}</p>` : ''}${htmlGroups}`
  );
  return {subject, text: textParts.join('\n'), html};
}
