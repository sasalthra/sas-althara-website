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

type ActivityRow = {
  id: string;
  lead_id: string;
  user_id: string | null;
  action: string;
  details: string | null;
  created_at: string;
  user_name: string | null;
  username: string | null;
  role: string | null;
};

function canAccessLead(
  user: {
    userId: string;
    role: string;
  },
  lead: LeadAccessRow
) {
  if (
    user.role === 'admin' ||
    user.role === 'supervisor'
  ) {
    return true;
  }

  if (user.role === 'sales') {
    return (
      lead.assigned_to === user.userId ||
      lead.created_by === user.userId ||
      lead.owner === user.userId
    );
  }

  if (user.role === 'field') {
    return (
      lead.field_assigned_to === user.userId ||
      lead.created_by === user.userId ||
      lead.owner === user.userId
    );
  }

  return false;
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  const user = await getCrmUser();

  if (!user) {
    return NextResponse.json(
      {error: 'Unauthorized'},
      {status: 401}
    );
  }

  const {id} = await context.params;

  const lead = await crmDb()
    .prepare(`
      SELECT
        id,
        owner,
        assigned_to,
        field_assigned_to,
        created_by
      FROM leads
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<LeadAccessRow>();

  if (!lead) {
    return NextResponse.json(
      {error: 'Lead not found'},
      {status: 404}
    );
  }

  if (!canAccessLead(user, lead)) {
    return NextResponse.json(
      {error: 'Forbidden'},
      {status: 403}
    );
  }

  const {results} = await crmDb()
    .prepare(`
      SELECT
        lead_activity.id,
        lead_activity.lead_id,
        lead_activity.user_id,
        lead_activity.action,
        lead_activity.details,
        lead_activity.created_at,
        crm_users.name AS user_name,
        crm_users.username,
        crm_users.role
      FROM lead_activity
      LEFT JOIN crm_users
        ON crm_users.id = lead_activity.user_id
      WHERE lead_activity.lead_id = ?
      ORDER BY lead_activity.created_at DESC
    `)
    .bind(id)
    .all();

  const activities = (results as ActivityRow[]).map(
    item => {
      let details: unknown = null;

      if (item.details) {
        try {
          details = JSON.parse(item.details);
        } catch {
          details = item.details;
        }
      }

      return {
        ...item,
        details,
      };
    }
  );

  return NextResponse.json(activities);
}
