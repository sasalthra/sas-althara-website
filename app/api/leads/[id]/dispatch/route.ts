import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getCrmUser} from '@/lib/admin';
import {notifyFieldDispatch} from '@/lib/assignment-notify';
import {propertyRequestText} from '@/lib/assignment-email';
import {crmDb} from '@/lib/crm-db';
import properties from '@/data/properties.json';

type LeadRow = {
  id: string;
  owner: string;
  assigned_to: string | null;
  field_assigned_to: string | null;
  created_by: string | null;
  stage: string;
  name: string;
  phone: string;
  property_id: string | null;
  property_other: string | null;
  source: string | null;
  notes: string | null;
  follow_up: string | null;
};

type FieldUserRow = {
  id: string;
  name: string | null;
};

function canDispatch(user: {userId: string; role: string}, lead: LeadRow) {
  if (user.role === 'admin' || user.role === 'supervisor') return true;
  if (user.role === 'sales') {
    return lead.assigned_to === user.userId || lead.created_by === user.userId || lead.owner === user.userId;
  }
  return false;
}

function sameOrigin(request: Request) {
  if (!process.env.NEXTAUTH_URL) return false;
  return request.headers.get('origin') === new URL(process.env.NEXTAUTH_URL).origin;
}

function propertyLabel(propertyId: string | null, propertyOther: string | null) {
  const match = properties.find(item => item.id === propertyId);
  if (match?.title?.trim()) return match.title.trim();
  return propertyRequestText(propertyId, propertyOther);
}

export async function POST(
  request: Request,
  context: {params: Promise<{id: string}>}
) {
  const user = await getCrmUser();
  if (!user) return NextResponse.json({error: 'يجب تسجيل الدخول'}, {status: 401});
  if (!sameOrigin(request)) {
    return NextResponse.json({error: 'طلب غير مسموح'}, {status: 403});
  }
  if (user.role !== 'admin' && user.role !== 'supervisor' && user.role !== 'sales') {
    return NextResponse.json({error: 'غير مسموح بتفويج العملاء'}, {status: 403});
  }

  const {id} = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({error: 'بيانات غير صالحة'}, {status: 400});
  }
  const payload = body && typeof body === 'object' ? body as {fieldUserId?: unknown; note?: unknown} : {};
  const fieldUserId = typeof payload.fieldUserId === 'string' ? payload.fieldUserId.trim() : '';
  const note = typeof payload.note === 'string' ? payload.note.trim() : '';
  if (!fieldUserId || fieldUserId.length > 255) {
    return NextResponse.json({error: 'حدد الموظف الميداني'}, {status: 400});
  }
  if (payload.note != null && typeof payload.note !== 'string') {
    return NextResponse.json({error: 'بيانات غير صالحة'}, {status: 400});
  }
  if (note.length > 2000) {
    return NextResponse.json({error: 'الملاحظة طويلة جدًا'}, {status: 400});
  }

  const lead = await crmDb()
    .prepare(`
      SELECT id, owner, assigned_to, field_assigned_to, created_by, stage,
             name, phone, property_id, property_other, source, notes, follow_up
      FROM leads
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<LeadRow>();

  if (!lead) return NextResponse.json({error: 'العميل غير موجود'}, {status: 404});
  if (!canDispatch(user, lead)) {
    return NextResponse.json({error: 'غير مسموح بتفويج هذا العميل'}, {status: 403});
  }

  const fieldUser = await crmDb()
    .prepare(`
      SELECT id, name
      FROM crm_users
      WHERE id = ?
        AND active = 1
        AND role = 'field'
      LIMIT 1
    `)
    .bind(fieldUserId)
    .first<FieldUserRow>();

  if (!fieldUser) {
    return NextResponse.json({error: 'الموظف الميداني غير صالح أو غير نشط'}, {status: 400});
  }

  const dispatcher = await crmDb()
    .prepare(`SELECT name FROM crm_users WHERE id = ? LIMIT 1`)
    .bind(user.userId)
    .first<{name: string | null}>();
  const dispatchedByName = dispatcher?.name?.trim() || user.name?.trim() || user.username?.trim() || 'فريق المبيعات';
  const fieldAssignedName = fieldUser.name?.trim() || 'الموظف الميداني';
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

  await crmDb()
    .prepare(`UPDATE leads SET field_assigned_to = ?, stage = 'field_dispatch', updated_at = ? WHERE id = ?`)
    .bind(fieldUserId, now, id)
    .run();

  await crmDb()
    .prepare(`
      INSERT INTO lead_activity (id, lead_id, user_id, action, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      randomUUID(),
      id,
      user.userId,
      'field_dispatched',
      JSON.stringify({
        previousStage: lead.stage,
        stage: 'field_dispatch',
        previousFieldAssignedTo: lead.field_assigned_to || '',
        fieldAssignedTo: fieldUserId,
        fieldAssignedName,
        dispatchedByName,
        note,
      }),
      now
    )
    .run();

  await notifyFieldDispatch({
    fieldUserId,
    dispatcherName: dispatchedByName,
    dispatchNote: note,
    client: {
      id,
      name: lead.name,
      phone: lead.phone,
      stage: 'field_dispatch',
      source: lead.source,
      notes: lead.notes,
      followUp: lead.follow_up,
      propertyRequest: propertyLabel(lead.property_id, lead.property_other),
    },
  });

  return NextResponse.json({ok: true, stage: 'field_dispatch', fieldAssignedTo: fieldUserId});
}
