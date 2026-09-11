import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import data from '@/data/properties.json';
import {z} from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  id: z.string().uuid(),

  name: z
    .string()
    .trim()
    .min(2)
    .max(100),

  phone: z
    .string()
    .trim()
    .regex(/^[+\d\s()-]{7,22}$/),

  propertyId: z
    .string()
    .refine(id =>
      data.some(property => property.id === id)
    ),

  notes: z
    .string()
    .max(3000)
    .default(''),

  stage: z.enum([
    'new',
    'contacted',
    'viewing',
    'negotiation',
    'won',
    'closed',
  ]).default('new'),

  followUp: z
    .string()
    .refine(value => {
      if (value === '') {
        return true;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
      }

      const date = new Date(value);

      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    })
    .default(''),

  assignedTo: z
    .string()
    .uuid()
    .nullable()
    .optional(),
});

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

async function validAssignableUser(
  userId: string
) {
  const user = await crmDb()
    .prepare(`
      SELECT id
      FROM crm_users
      WHERE id = ?
        AND active = 1
        AND role IN ('sales', 'field')
      LIMIT 1
    `)
    .bind(userId)
    .first<{id: string}>();

  return Boolean(user);
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
          SELECT
            leads.*,
            assigned_user.name AS assigned_name,
            assigned_user.username AS assigned_username
          FROM leads
          LEFT JOIN crm_users AS assigned_user
            ON assigned_user.id = leads.assigned_to
          ORDER BY leads.created_at DESC
        `)
        .all();

      return reply(result.results);
    }

    const result = await db
      .prepare(`
        SELECT
          leads.*,
          assigned_user.name AS assigned_name,
          assigned_user.username AS assigned_username
        FROM leads
        LEFT JOIN crm_users AS assigned_user
          ON assigned_user.id = leads.assigned_to
        WHERE leads.assigned_to = ?
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

  if (canAssign(user.role)) {
    assignedTo =
      value.assignedTo ?? null;

    if (
      assignedTo &&
      !(await validAssignableUser(
        assignedTo
      ))
    ) {
      return reply(
        {
          error:
            'المندوب المحدد غير صالح أو غير نشط',
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
              assigned_to
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
          canAssign(user.role)
            ? assignedTo ?? null
            : existing.assigned_to;

        await db
          .prepare(`
            UPDATE leads
            SET
              name = ?,
              phone = ?,
              property_id = ?,
              stage = ?,
              notes = ?,
              follow_up = ?,
              assigned_to = ?,
              updated_at = ?
            WHERE id = ?
          `)
          .bind(
            value.name,
            value.phone,
            value.propertyId,
            value.stage,
            value.notes,
            value.followUp,
            finalAssignedTo ?? '',
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
            })
          )
          .run();

        return reply({
          ok: true,
          id: value.id,
        });
      }

      const existing = await db
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
          })
        )
        .run();
    } else {
      const newAssignedTo =
        canAssign(user.role)
          ? assignedTo ?? null
          : user.userId;

      await db
        .prepare(`
          INSERT INTO leads (
            id,
            owner,
            assigned_to,
            created_by,
            name,
            phone,
            property_id,
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
            ?
          )
          ON DUPLICATE KEY
          UPDATE id = id
        `)
        .bind(
          value.id,
          user.userId,
          newAssignedTo ?? '',
          user.userId,
          value.name,
          value.phone,
          value.propertyId,
          'manual',
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
          })
        )
        .run();
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