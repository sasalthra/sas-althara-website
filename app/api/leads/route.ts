import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import data from '@/data/properties.json';
import {z} from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^[+\d\s()-]{7,22}$/),
  propertyId: z.string().refine(id => data.some(p => p.id === id)),
  notes: z.string().max(3000).default(''),
  stage: z.enum([
    'new',
    'contacted',
    'viewing',
    'negotiation',
    'won',
    'closed',
  ]).default('new'),
  followUp: z.string().refine(value => {
    if (value === '') return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const date = new Date(value);

    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }).default(''),
});

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {'Cache-Control': 'no-store'},
  });
}

function canSeeAll(role: string) {
  return role === 'admin' || role === 'supervisor';
}

export async function GET() {
  const user = await getCrmUser();

  if (!user) {
    return reply({error: 'يجب تسجيل الدخول'}, 401);
  }

  try {
    const db = crmDb();

    if (canSeeAll(user.role)) {
      const result = await db
        .prepare('SELECT * FROM leads ORDER BY created_at DESC')
        .all();

      return reply(result.results);
    }

    const result = await db
      .prepare(`
        SELECT *
        FROM leads
        WHERE assigned_to = ?
           OR created_by = ?
           OR owner = ?
        ORDER BY created_at DESC
      `)
      .bind(user.userId, user.userId, user.userId)
      .all();

    return reply(result.results);
  } catch (error) {
    console.error('Failed to load leads:', error);
    return reply({error: 'تعذر تحميل العملاء. حاول مجددًا.'}, 503);
  }
}

async function write(req: Request, update: boolean) {
  const user = await getCrmUser();

  if (!user) {
    return reply({error: 'يجب تسجيل الدخول'}, 401);
  }

  if (
    !process.env.NEXTAUTH_URL ||
    req.headers.get('origin') !== new URL(process.env.NEXTAUTH_URL).origin
  ) {
    return reply({error: 'طلب غير مسموح'}, 403);
  }

  let input;

  try {
    const reader = req.body?.getReader();

    if (!reader) {
      return reply({error: 'بيانات غير صالحة'}, 400);
    }

    let size = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const {done, value} = await reader.read();
      if (done) break;

      size += value.byteLength;

      if (size > 12000) {
        await reader.cancel();
        return reply({error: 'الطلب أكبر من المسموح'}, 413);
      }

      chunks.push(value);
    }

    input = schema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString('utf8'))
    );
  } catch {
    return reply({error: 'بيانات غير صالحة'}, 400);
  }

  if (!input.success) {
    return reply(
      {error: 'راجع الاسم ورقم الجوال والعقار والتاريخ'},
      400
    );
  }

  const v = input.data;
  const now = new Date().toISOString();

  try {
    const db = crmDb();

    if (update) {
      let result;

      if (canSeeAll(user.role)) {
        result = await db
          .prepare(`
            UPDATE leads
            SET name = ?,
                phone = ?,
                property_id = ?,
                stage = ?,
                notes = ?,
                follow_up = ?,
                updated_at = ?
            WHERE id = ?
          `)
          .bind(
            v.name,
            v.phone,
            v.propertyId,
            v.stage,
            v.notes,
            v.followUp,
            now,
            v.id
          )
          .run();
      } else {
        result = await db
          .prepare(`
            UPDATE leads
            SET name = ?,
                phone = ?,
                property_id = ?,
                stage = ?,
                notes = ?,
                follow_up = ?,
                updated_at = ?
            WHERE id = ?
              AND (
                assigned_to = ?
                OR created_by = ?
                OR owner = ?
              )
          `)
          .bind(
            v.name,
            v.phone,
            v.propertyId,
            v.stage,
            v.notes,
            v.followUp,
            now,
            v.id,
            user.userId,
            user.userId,
            user.userId
          )
          .run();
      }

      if (!result.meta.changes) {
        return reply(
          {error: 'العميل غير موجود أو غير مسموح لك بتعديله'},
          404
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
          v.id,
          user.userId,
          'updated',
          JSON.stringify({
            stage: v.stage,
            followUp: v.followUp,
          })
        )
        .run();
    } else {
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE id = id
        `)
        .bind(
          v.id,
          user.userId,
          user.userId,
          user.userId,
          v.name,
          v.phone,
          v.propertyId,
          'manual',
          v.stage,
          v.notes,
          v.followUp,
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
        .bind(v.id)
        .first<{owner: string}>();

      if (stored?.owner !== user.userId) {
        return reply({error: 'معرف مستخدم مسبقًا'}, 409);
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
          v.id,
          user.userId,
          'created',
          JSON.stringify({
            source: 'manual',
            stage: v.stage,
          })
        )
        .run();
    }

    return reply({ok: true, id: v.id});
  } catch (error) {
    console.error('Lead write failed:', error);

    return reply(
      {
        error: 'تعذر حفظ البيانات. بياناتك باقية؛ حاول مجددًا.',
      },
      503
    );
  }
}

export async function POST(req: Request) {
  return write(req, false);
}

export async function PATCH(req: Request) {
  return write(req, true);
}