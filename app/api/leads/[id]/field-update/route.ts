import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import {normalizeLeadPhone} from '@/lib/phone';

type LeadRow = {
  id: string;
  owner: string;
  assigned_to: string | null;
  field_assigned_to: string | null;
  created_by: string | null;
  phone: string;
};

function canUpdate(user: {userId: string; role: string}, lead: LeadRow) {
  if (user.role !== 'field') return false;
  return lead.field_assigned_to === user.userId || lead.created_by === user.userId || lead.owner === user.userId;
}

function sameOrigin(request: Request) {
  if (!process.env.NEXTAUTH_URL) return false;
  return request.headers.get('origin') === new URL(process.env.NEXTAUTH_URL).origin;
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
  if (user.role !== 'field') {
    return NextResponse.json({error: 'غير مسموح بإضافة تحديث ميداني'}, {status: 403});
  }

  const {id} = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({error: 'بيانات غير صالحة'}, {status: 400});
  }
  const note = body && typeof body === 'object' && typeof (body as {note?: unknown}).note === 'string'
    ? (body as {note: string}).note.trim()
    : '';
  if (note.length < 2 || note.length > 2000) {
    return NextResponse.json({error: 'اكتب ملاحظة الزيارة (حرفان على الأقل).'}, {status: 400});
  }

  const lead = await crmDb()
    .prepare(`
      SELECT id, owner, assigned_to, field_assigned_to, created_by, phone
      FROM leads
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<LeadRow>();

  if (!lead) return NextResponse.json({error: 'العميل غير موجود'}, {status: 404});
  if (!canUpdate(user, lead)) {
    return NextResponse.json({error: 'غير مسموح بتحديث هذا العميل'}, {status: 403});
  }

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const submittedPhone = body && typeof body === 'object' && typeof (body as {phone?: unknown}).phone === 'string'
    ? (body as {phone: string}).phone
    : lead.phone;
  const phone = normalizeLeadPhone(submittedPhone) || normalizeLeadPhone(lead.phone) || lead.phone;
  await crmDb()
    .prepare(`UPDATE leads SET phone = ?, updated_at = ? WHERE id = ?`)
    .bind(phone, now, id)
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
      'field_update',
      JSON.stringify({note}),
      now
    )
    .run();

  return NextResponse.json({ok: true});
}
