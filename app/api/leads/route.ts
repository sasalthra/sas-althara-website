import {getCrmUser} from '@/lib/admin';
import {propertyRequestText} from '@/lib/assignment-email';
import {notifyLeadAssignment} from '@/lib/assignment-notify';
import {crmDb} from '@/lib/crm-db';
import {leadSchema as schema} from '@/lib/lead-input';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';


function reply(
  body: unknown,
  status = 200
) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function canSeeAll(role: string) {
  return (
    role === 'admin' ||
    role === 'supervisor'
  );
}

function canAssign(role: string) {
  return (
    role === 'admin' ||
    role === 'supervisor'
  );
}

async function validUserForRole(
  userId: string,
  role: 'sales' | 'field'
) {
  const user = await crmDb()
    .prepare(`
      SELECT id
      FROM crm_users
      WHERE id = ?
        AND active = 1
        AND role = ?
      LIMIT 1
    `)
    .bind(
      userId,
      role
    )
    .first<{id: string}>();

  return Boolean(user);
}

async function notifySalesAssignment(
  previousAssignedTo: string | null | undefined,
  assignedTo: string | null | undefined,
  value: {
    name: string;
    phone: string;
    stage: string;
    source: string;
    notes: string;
    followUp: string;
    propertyId: string;
    propertyOther: string;
  }
) {
  await notifyLeadAssignment({
    previousAssignedTo,
    assignedTo,
    client: {
      name: value.name,
      phone: value.phone,
      stage: value.stage,
      source: value.source,
      notes: value.notes,
      followUp: value.followUp,
      propertyRequest: propertyRequestText(
        value.propertyId,
        value.propertyOther
      ),
    },
  });
}

function leadSelect() {
  return `
    SELECT
      leads.*,

      sales_user.name AS assigned_name,
      sales_user.username AS assigned_username,

      field_user.name AS field_assigned_name,
      field_user.username AS field_assigned_username,

      (
        SELECT JSON_UNQUOTE(
          JSON_EXTRACT(
            activity.details,
            '$.note'
          )
        )
        FROM lead_activity AS activity
        INNER JOIN crm_users AS activity_user
          ON activity_user.id = activity.user_id
        WHERE activity.lead_id = leads.id
          AND activity_user.role = 'sales'
          AND JSON_EXTRACT(
            activity.details,
            '$.note'
          ) IS NOT NULL
        ORDER BY activity.created_at DESC
        LIMIT 1
      ) AS sales_last_update,

      (
        SELECT activity.created_at
        FROM lead_activity AS activity
        INNER JOIN crm_users AS activity_user
          ON activity_user.id = activity.user_id
        WHERE activity.lead_id = leads.id
          AND activity_user.role = 'sales'
          AND JSON_EXTRACT(
            activity.details,
            '$.note'
          ) IS NOT NULL
        ORDER BY activity.created_at DESC
        LIMIT 1
      ) AS sales_last_update_at,

      (
        SELECT JSON_UNQUOTE(
          JSON_EXTRACT(
            activity.details,
            '$.note'
          )
        )
        FROM lead_activity AS activity
        INNER JOIN crm_users AS activity_user
          ON activity_user.id = activity.user_id
        WHERE activity.lead_id = leads.id
          AND activity_user.role = 'field'
          AND JSON_EXTRACT(
            activity.details,
            '$.note'
          ) IS NOT NULL
        ORDER BY activity.created_at DESC
        LIMIT 1
      ) AS field_last_update,

      (
        SELECT activity.created_at
        FROM lead_activity AS activity
        INNER JOIN crm_users AS activity_user
          ON activity_user.id = activity.user_id
        WHERE activity.lead_id = leads.id
          AND activity_user.role = 'field'
          AND JSON_EXTRACT(
            activity.details,
            '$.note'
          ) IS NOT NULL
        ORDER BY activity.created_at DESC
        LIMIT 1
      ) AS field_last_update_at

    FROM leads

    LEFT JOIN crm_users AS sales_user
      ON sales_user.id = leads.assigned_to

    LEFT JOIN crm_users AS field_user
      ON field_user.id = leads.field_assigned_to
  `;
}

export async function GET() {
  const user = await getCrmUser();

  if (!user) {
    return reply(
      {error: 'يجب تسجيل الدخول'},
      401
    );
  }

  try {
    const db = crmDb();

    if (canSeeAll(user.role)) {
      const result = await db
        .prepare(`
          ${leadSelect()}
          ORDER BY leads.created_at DESC
        `)
        .all();

      return reply(result.results);
    }

    if (user.role === 'sales') {
      const result = await db
        .prepare(`
          ${leadSelect()}
          WHERE
            leads.assigned_to = ?
            OR leads.created_by = ?
            OR leads.owner = ?
          ORDER BY leads.created_at DESC
        `)
        .bind(
          user.userId,
          user.userId,
          user.userId
        )
        .all();

      return reply(result.results);
    }

    if (user.role === 'field') {
      const result = await db
        .prepare(`
          ${leadSelect()}
          WHERE
            leads.field_assigned_to = ?
            OR leads.created_by = ?
            OR leads.owner = ?
          ORDER BY leads.created_at DESC
        `)
        .bind(
          user.userId,
          user.userId,
          user.userId
        )
        .all();

      return reply(result.results);
    }

    return reply([]);
  } catch (error) {
    console.error(
      'Failed to load leads:',
      error
    );

    return reply(
      {
        error:
          'تعذر تحميل العملاء. حاول مجددًا.',
      },
      503
    );
  }
}

async function write(
  req: Request,
  update: boolean
) {
  const user = await getCrmUser();

  if (!user) {
    return reply(
      {error: 'يجب تسجيل الدخول'},
      401
    );
  }

  if (
    !process.env.NEXTAUTH_URL ||
    req.headers.get('origin') !==
      new URL(
        process.env.NEXTAUTH_URL
      ).origin
  ) {
    return reply(
      {error: 'طلب غير مسموح'},
      403
    );
  }

  let input;

  try {
    const reader =
      req.body?.getReader();

    if (!reader) {
      return reply(
        {error: 'بيانات غير صالحة'},
        400
      );
    }

    let size = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const {
        done,
        value,
      } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > 12000) {
        await reader.cancel();

        return reply(
          {
            error:
              'الطلب أكبر من المسموح',
          },
          413
        );
      }

      chunks.push(value);
    }

    input = schema.safeParse(
      JSON.parse(
        Buffer.concat(
          chunks
        ).toString('utf8')
      )
    );
  } catch {
    return reply(
      {error: 'بيانات غير صالحة'},
      400
    );
  }

  if (!input.success) {
    return reply(
      {
        error:
          'راجع الاسم ورقم الجوال والعقار والتاريخ',
      },
      400
    );
  }

  const value = input.data;
  const now =
    new Date().toISOString();

  let assignedTo:
    | string
    | null
    | undefined;

  let fieldAssignedTo:
    | string
    | null
    | undefined;

  if (canAssign(user.role)) {
    assignedTo =
      value.assignedTo ?? null;

    fieldAssignedTo =
      value.fieldAssignedTo ?? null;

    if (
      assignedTo &&
      !(await validUserForRole(
        assignedTo,
        'sales'
      ))
    ) {
      return reply(
        {
          error:
            'مندوب المبيعات المحدد غير صالح أو غير نشط',
        },
        400
      );
    }

    if (
      fieldAssignedTo &&
      !(await validUserForRole(
        fieldAssignedTo,
        'field'
      ))
    ) {
      return reply(
        {
          error:
            'الموظف الميداني المحدد غير صالح أو غير نشط',
        },
        400
      );
    }
  }

  try {
    const db = crmDb();

    if (update) {
      if (canSeeAll(user.role)) {
        const existing = await db
          .prepare(`
            SELECT
              id,
              assigned_to,
              field_assigned_to
            FROM leads
            WHERE id = ?
            LIMIT 1
          `)
          .bind(value.id)
          .first<{
            id: string;
            assigned_to:
              | string
              | null;
            field_assigned_to:
              | string
              | null;
          }>();

        if (!existing) {
          return reply(
            {
              error:
                'العميل غير موجود',
            },
            404
          );
        }

        const finalAssignedTo =
          assignedTo ?? null;

        const finalFieldAssignedTo =
          fieldAssignedTo ?? null;

        await db
          .prepare(`
            UPDATE leads
            SET
              name = ?,
              phone = ?,
              property_id = ?,
              property_other = ?,
              source = ?,
              stage = ?,
              notes = ?,
              follow_up = ?,
              assigned_to = ?,
              field_assigned_to = ?,
              updated_at = ?
            WHERE id = ?
          `)
          .bind(
            value.name,
            value.phone,
            value.propertyId,
            value.propertyOther,
            value.source,
            value.stage,
            value.notes,
            value.followUp,
            finalAssignedTo ?? '',
            finalFieldAssignedTo ?? '',
            now,
            value.id
          )
          .run();

        await db
          .prepare(`
            INSERT INTO lead_activity (
              id,
              lead_id,
              user_id,
              action,
              details
            )
            VALUES (?, ?, ?, ?, ?)
          `)
          .bind(
            crypto.randomUUID(),
            value.id,
            user.userId,
            'updated',
            JSON.stringify({
              stage:
                value.stage,
              followUp:
                value.followUp,
              assignedTo:
                finalAssignedTo,
              fieldAssignedTo:
                finalFieldAssignedTo,
              note:
                value.notes,
            })
          )
          .run();

        await notifySalesAssignment(
          existing.assigned_to,
          finalAssignedTo,
          value
        );

        return reply({
          ok: true,
          id: value.id,
        });
      }

      let existing:
        | {id: string}
        | null = null;

      if (user.role === 'sales') {
        existing = await db
          .prepare(`
            SELECT id
            FROM leads
            WHERE id = ?
              AND (
                assigned_to = ?
                OR created_by = ?
                OR owner = ?
              )
            LIMIT 1
          `)
          .bind(
            value.id,
            user.userId,
            user.userId,
            user.userId
          )
          .first<{id: string}>();
      }

      if (user.role === 'field') {
        existing = await db
          .prepare(`
            SELECT id
            FROM leads
            WHERE id = ?
              AND (
                field_assigned_to = ?
                OR created_by = ?
                OR owner = ?
              )
            LIMIT 1
          `)
          .bind(
            value.id,
            user.userId,
            user.userId,
            user.userId
          )
          .first<{id: string}>();
      }

      if (!existing) {
        return reply(
          {
            error:
              'العميل غير موجود أو غير مسموح لك بتعديله',
          },
          404
        );
      }

      await db
        .prepare(`
          UPDATE leads
          SET
            name = ?,
            phone = ?,
            property_id = ?,
              property_other = ?,
              source = ?,
            stage = ?,
            notes = ?,
            follow_up = ?,
            updated_at = ?
          WHERE id = ?
        `)
        .bind(
          value.name,
          value.phone,
          value.propertyId,
            value.propertyOther,
            value.source,
          value.stage,
          value.notes,
          value.followUp,
          now,
          value.id
        )
        .run();

      await db
        .prepare(`
          INSERT INTO lead_activity (
            id,
            lead_id,
            user_id,
            action,
            details
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          crypto.randomUUID(),
          value.id,
          user.userId,
          'updated',
          JSON.stringify({
            stage:
              value.stage,
            followUp:
              value.followUp,
            note:
              value.notes,
          })
        )
        .run();
    } else {
      let newAssignedTo:
        | string
        | null = null;

      let newFieldAssignedTo:
        | string
        | null = null;

      if (canAssign(user.role)) {
        newAssignedTo =
          assignedTo ?? null;

        newFieldAssignedTo =
          fieldAssignedTo ?? null;
      } else if (
        user.role === 'sales'
      ) {
        newAssignedTo =
          user.userId;
      } else if (
        user.role === 'field'
      ) {
        newFieldAssignedTo =
          user.userId;
      }

      await db
        .prepare(`
          INSERT INTO leads (
            id,
            owner,
            assigned_to,
            field_assigned_to,
            created_by,
            name,
            phone,
            property_id,
            property_other,
            source,
            stage,
            notes,
            follow_up,
            created_at,
            updated_at
          )
          VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )
          ON DUPLICATE KEY
          UPDATE id = id
        `)
        .bind(
          value.id,
          user.userId,
          newAssignedTo ?? '',
          newFieldAssignedTo ?? '',
          user.userId,
          value.name,
          value.phone,
          value.propertyId,
            value.propertyOther,
            value.source,
          value.stage,
          value.notes,
          value.followUp,
          now,
          now
        )
        .run();

      const stored = await db
        .prepare(`
          SELECT owner
          FROM leads
          WHERE id = ?
        `)
        .bind(value.id)
        .first<{
          owner: string;
        }>();

      if (
        stored?.owner !==
        user.userId
      ) {
        return reply(
          {
            error:
              'معرف مستخدم مسبقًا',
          },
          409
        );
      }

      await db
        .prepare(`
          INSERT INTO lead_activity (
            id,
            lead_id,
            user_id,
            action,
            details
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          crypto.randomUUID(),
          value.id,
          user.userId,
          'created',
          JSON.stringify({
            source: 'manual',
            stage:
              value.stage,
            assignedTo:
              newAssignedTo,
            fieldAssignedTo:
              newFieldAssignedTo,
            note:
              value.notes,
          })
        )
        .run();

      if (canAssign(user.role)) {
        await notifySalesAssignment(
          null,
          newAssignedTo,
          value
        );
      }
    }

    return reply({
      ok: true,
      id: value.id,
    });
  } catch (error) {
    console.error(
      'Lead write failed:',
      error
    );

    return reply(
      {
        error:
          'تعذر حفظ البيانات. بياناتك باقية؛ حاول مجددًا.',
      },
      503
    );
  }
}

export async function POST(
  req: Request
) {
  return write(req, false);
}

export async function PATCH(
  req: Request
) {
  return write(req, true);
}