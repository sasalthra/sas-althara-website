import {randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import {stageWriteAllowed} from '@/lib/lead-stages';
import {STAGE_NOTE_INSERT_SQL, STAGE_NOTE_MAX, clipName} from '@/lib/stage-notes';

type LeadRow = {
  id: string;
  owner: string;
  assigned_to: string | null;
  field_assigned_to: string | null;
  created_by: string | null;
  stage: string;
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

  const stage = typeof body.stage === 'string' ? body.stage.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (!stageWriteAllowed(stage)) {
    return NextResponse.json({error: 'هذه المرحلة لم تعد متاحة'}, {status: 400});
  }
  if (note.length > STAGE_NOTE_MAX) {
    return NextResponse.json({error: 'الملاحظة طويلة جدًا'}, {status: 400});
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
  const stageChanged = stage !== previousStage;
  if (!stageChanged && !note) {
    return NextResponse.json({error: 'اكتب الملاحظة، أو اختر مرحلة أخرى'}, {status: 400});
  }

  const at = new Date().toISOString();
  const byName = clipName(user.name || user.username || 'النظام') || 'النظام';
  const byUserId = clipName(user.userId);
  const activityId = randomUUID();

  if (stageChanged) {
    await crmDb()
      .prepare(`UPDATE leads SET stage = ?, updated_at = ? WHERE id = ?`)
      .bind(stage, at, id)
      .run();

    await crmDb()
      .prepare(`
        INSERT INTO lead_activity (id, lead_id, user_id, action, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        activityId,
        id,
        user.userId,
        'stage_changed',
        JSON.stringify({previousStage, stage, note}),
        at
      )
      .run();
  } else {
    await crmDb()
      .prepare(`UPDATE leads SET updated_at = ? WHERE id = ?`)
      .bind(at, id)
      .run();

    await crmDb()
      .prepare(`
        INSERT INTO lead_activity (id, lead_id, user_id, action, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        activityId,
        id,
        user.userId,
        'stage_note',
        JSON.stringify({stage, note, text: note, at, byUserId, byName}),
        at
      )
      .run();
  }

  if (note) {
    await crmDb()
      .prepare(STAGE_NOTE_INSERT_SQL)
      .bind(randomUUID(), id, stage, note, at, byUserId, byName, activityId)
      .run();
  }

  return NextResponse.json({ok: true, appended: Boolean(note)});
}
