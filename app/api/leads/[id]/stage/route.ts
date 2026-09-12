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
  stage: string;
};

const allowedStages = new Set([
  'new',
  'contacted',
  'viewing',
  'negotiation',
  'won',
  'closed',
]);

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

  const stage = typeof body.stage === 'string' ? body.stage.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (!allowedStages.has(stage)) {
    return NextResponse.json({error: 'Invalid stage'}, {status: 400});
  }

  const lead = await crmDb()
    .prepare(`
      SELECT id, owner, assigned_to, field_assigned_to, created_by, stage
      FROM leads
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<LeadRow>();

  if (!lead) return NextResponse.json({error: 'Lead not found'}, {status: 404});
  if (!canAccess(user, lead)) return NextResponse.json({error: 'Forbidden'}, {status: 403});

  const previousStage = lead.stage;

  await crmDb()
    .prepare(`UPDATE leads SET stage = ?, updated_at = ? WHERE id = ?`)
    .bind(stage, new Date().toISOString(), id)
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
      'stage_changed',
      JSON.stringify({previousStage, stage, note})
    )
    .run();

  return NextResponse.json({ok: true});
}
