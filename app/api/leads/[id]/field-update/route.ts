import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import {clipFieldReport, fieldReportText, markedVisitStage} from '@/lib/field-report';
import {normalizeLeadPhone} from '@/lib/phone';

type LeadRow = {
  id: string;
  owner: string;
  assigned_to: string | null;
  field_assigned_to: string | null;
  created_by: string | null;
  phone: string;
  stage: string;
  field_report: string | null;
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
  const payload = body && typeof body === 'object' ? body as {note?: unknown; visitDone?: unknown; phone?: unknown} : {};
  const note = typeof payload.note === 'string' ? payload.note.trim() : '';
  const visitDone = payload.visitDone === true;
  if (payload.visitDone != null && typeof payload.visitDone !== 'boolean') {
    return NextResponse.json({error: 'بيانات غير صالحة'}, {status: 400});
  }
  if (note.length > 2000) {
    return NextResponse.json({error: 'الملاحظة طويلة جدًا'}, {status: 400});
  }

  const lead = await crmDb()
    .prepare(`
      SELECT id, owner, assigned_to, field_assigned_to, created_by, phone, stage, field_report
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

  const existingReport = fieldReportText(lead.field_report);
  if (visitDone && !note && !existingReport) {
    return NextResponse.json({error: 'أدخل تقرير الزيارة قبل تعليم الزيارة كمكتملة.'}, {status: 400});
  }
  if ((note || !visitDone) && note.length < 2) {
    return NextResponse.json({error: 'اكتب ملاحظة الزيارة (حرفان على الأقل).'}, {status: 400});
  }

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const submittedPhone = typeof payload.phone === 'string' ? payload.phone : lead.phone;
  const phone = normalizeLeadPhone(submittedPhone) || normalizeLeadPhone(lead.phone) || lead.phone;
  const report = note ? clipFieldReport(note) : '';
  const nextStage = markedVisitStage(lead.stage, visitDone);
  const sets = ['phone = ?', 'updated_at = ?'];
  const args: Array<string | null> = [phone, now];
  if (report) {
    sets.push('field_report = ?', 'field_report_at = ?');
    args.push(report, now);
  }
  if (nextStage) {
    sets.push('stage = ?');
    args.push(nextStage);
  }
  args.push(id);
  await crmDb()
    .prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...args)
    .run();

  if (report) {
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
        JSON.stringify({note: report, visitDone}),
        now
      )
      .run();
  }

  if (nextStage) {
    await crmDb()
      .prepare(`
        INSERT INTO lead_activity (id, lead_id, user_id, action, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        randomUUID(),
        id,
        user.userId,
        'stage_changed',
        JSON.stringify({previousStage: lead.stage, stage: nextStage, note: report}),
        now
      )
      .run();
  }

  return NextResponse.json({ok: true, stage: nextStage || lead.stage});
}
