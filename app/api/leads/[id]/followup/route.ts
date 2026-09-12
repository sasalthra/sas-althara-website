import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';

type LeadRow = {
  id: string;
  owner: string;
  assigned_to: string | null;
  field_assigned_to: string | null;
  created_by: string | null;
};

function canAccess(user: {userId: string; role: string}, lead: LeadRow) {
  if (user.role === 'admin' || user.role === 'supervisor') return true;
  if (user.role === 'sales') {
    return lead.assigned_to === user.userId || lead.created_by === user.userId || lead.owner === user.userId;
  }
  if (user.role === 'field') {
    return lead.field_assigned_to === user.userId || lead.created_by === user.userId || lead.owner === user.userId;
  }
  return false;
}

export async function PATCH(
  request: Request,
  context: {params: Promise<{id: string}>}
) {
  const user = await getCrmUser();
  if (!user) return NextResponse.json({error: 'Unauthorized'}, {status: 401});

  const {id} = await context.params;
  const body = await request.json();

  const followUp = typeof body.followUp === 'string' ? body.followUp.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(followUp)) {
    return NextResponse.json({error: 'Invalid follow-up date'}, {status: 400});
  }

  const lead = await crmDb()
    .prepare(`
      SELECT id, owner, assigned_to, field_assigned_to, created_by
      FROM leads
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<LeadRow>();

  if (!lead) return NextResponse.json({error: 'Lead not found'}, {status: 404});
  if (!canAccess(user, lead)) return NextResponse.json({error: 'Forbidden'}, {status: 403});

  await crmDb()
    .prepare(`UPDATE leads SET follow_up = ?, updated_at = ? WHERE id = ?`)
    .bind(followUp, new Date().toISOString(), id)
    .run();

  await crmDb()
    .prepare(`
      INSERT INTO lead_activity (id, lead_id, user_id, action, details, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `)
    .bind(
      randomUUID(),
      id,
      user.userId,
      'follow_up_added',
      JSON.stringify({followUp, note})
    )
    .run();

  return NextResponse.json({ok: true});
}
