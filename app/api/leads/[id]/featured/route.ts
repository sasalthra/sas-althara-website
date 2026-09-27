import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import {canToggleFeatured} from '@/lib/lead-featured';
import {ensureLeadSchema} from '@/lib/lead-schema';

type LeadRow = {
  id: string;
  assigned_to: string | null;
};

export async function PATCH(
  request: Request,
  context: {params: Promise<{id: string}>}
) {
  const user = await getCrmUser();
  if (!user) return NextResponse.json({error: 'يجب تسجيل الدخول'}, {status: 401});

  const {id} = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({error: 'بيانات غير صالحة'}, {status: 400});
  }
  const featured = body && typeof body === 'object' ? (body as {featured?: unknown}).featured : undefined;
  if (typeof featured !== 'boolean') {
    return NextResponse.json({error: 'بيانات غير صالحة'}, {status: 400});
  }

  const lead = await crmDb()
    .prepare(`
      SELECT id, assigned_to
      FROM leads
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<LeadRow>();

  if (!lead) return NextResponse.json({error: 'العميل غير موجود'}, {status: 404});
  if (!(await ensureLeadSchema()).featured) {
    return NextResponse.json({error: 'تمييز العملاء غير متاح حالياً'}, {status: 503});
  }
  if (!canToggleFeatured(user, lead)) {
    return NextResponse.json({error: 'غير مسموح بتعديل تمييز هذا العميل'}, {status: 403});
  }

  const flag = featured ? 1 : 0;
  await crmDb()
    .prepare(`UPDATE leads SET is_featured = ?, updated_at = ? WHERE id = ?`)
    .bind(flag, new Date().toISOString(), id)
    .run();

  await crmDb()
    .prepare(`
      INSERT INTO lead_activity (id, lead_id, user_id, action, details)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(
      randomUUID(),
      id,
      user.userId,
      'featured_changed',
      JSON.stringify({featured})
    )
    .run();

  return NextResponse.json({ok: true, featured});
}
