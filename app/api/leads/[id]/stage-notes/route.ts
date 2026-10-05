import {NextResponse} from 'next/server';
import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';

type LeadAccessRow = {
  id: string;
  owner: string;
  assigned_to: string | null;
  field_assigned_to: string | null;
  created_by: string | null;
};

type NoteRow = {
  id: string;
  stage: string | null;
  text: string | null;
  at: string | null;
  by_user_id: string | null;
  by_name: string | null;
  live_name: string | null;
};

function canAccessLead(
  user: {userId: string; role: string},
  lead: LeadAccessRow
) {
  if (user.role === 'admin' || user.role === 'supervisor') return true;
  if (user.role === 'sales') {
    return lead.assigned_to === user.userId || lead.created_by === user.userId || lead.owner === user.userId;
  }
  if (user.role === 'field') {
    return lead.field_assigned_to === user.userId || lead.created_by === user.userId || lead.owner === user.userId;
  }
  return false;
}

export async function GET(
  _request: Request,
  context: {params: Promise<{id: string}>}
) {
  const user = await getCrmUser();
  if (!user) return NextResponse.json({error: 'Unauthorized'}, {status: 401});

  const {id} = await context.params;
  const lead = await crmDb()
    .prepare(`
      SELECT id, owner, assigned_to, field_assigned_to, created_by
      FROM leads
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<LeadAccessRow>();

  if (!lead) return NextResponse.json({error: 'Lead not found'}, {status: 404});
  if (!canAccessLead(user, lead)) return NextResponse.json({error: 'Forbidden'}, {status: 403});

  const {results} = await crmDb()
    .prepare(`
      SELECT
        lead_stage_notes.id,
        lead_stage_notes.stage,
        lead_stage_notes.note_text AS text,
        lead_stage_notes.created_at AS at,
        lead_stage_notes.by_user_id,
        lead_stage_notes.by_name,
        crm_users.name AS live_name
      FROM lead_stage_notes
      LEFT JOIN crm_users ON crm_users.id = lead_stage_notes.by_user_id
      WHERE lead_stage_notes.lead_id = ?
      ORDER BY lead_stage_notes.created_at DESC, lead_stage_notes.id DESC
    `)
    .bind(id)
    .all();

  const notes = (results as NoteRow[]).map(row => {
    const live = String(row.live_name ?? '').trim();
    const stored = String(row.by_name ?? '').trim();
    return {
      id: String(row.id),
      text: String(row.text ?? ''),
      at: String(row.at ?? ''),
      byUserId: String(row.by_user_id ?? ''),
      byName: live || stored || 'النظام',
      stage: String(row.stage ?? ''),
    };
  });

  return NextResponse.json(notes);
}
