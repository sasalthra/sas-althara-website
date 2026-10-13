import {NextResponse} from 'next/server';
import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import {paramEq} from '@/lib/sql-collation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCrmUser();
  if (!user) return NextResponse.json({error: 'يجب تسجيل الدخول'}, {status: 401});
  const rows = await crmDb()
    .prepare(`
      SELECT id, kind, lead_id, message, created_at
      FROM crm_user_alerts
      WHERE ${paramEq('user_id')}
      ORDER BY created_at DESC
      LIMIT 20
    `)
    .bind(user.userId)
    .all();
  return NextResponse.json({
    alerts: rows.results.map(row => ({
      id: String(row.id ?? ''),
      kind: String(row.kind ?? ''),
      leadId: String(row.lead_id ?? ''),
      message: String(row.message ?? ''),
      createdAt: String(row.created_at ?? ''),
    })),
  });
}
