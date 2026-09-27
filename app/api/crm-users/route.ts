import bcrypt from 'bcryptjs';
import {z} from 'zod';

import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import {parseUserEmail, parseUserName, parseUserPhone} from '@/lib/user-contact';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9._-]+$/),

  password: z
    .string()
    .min(8)
    .max(100),

  name: z
    .string()
    .trim()
    .min(2)
    .max(120),

  email: z
    .string()
    .trim()
    .max(190)
    .optional()
    .or(z.literal('')),

  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal('')),

  role: z.enum([
    'admin',
    'supervisor',
    'sales',
    'field',
  ]),
});

const updateContactSchema = z.object({
  id: z.string().trim().min(1).max(255),
  name: z.string().max(200),
  email: z.string().max(190),
  phone: z.string().max(40),
});

function sameOrigin(req: Request) {
  return Boolean(
    process.env.NEXTAUTH_URL &&
      req.headers.get('origin') === new URL(process.env.NEXTAUTH_URL).origin
  );
}

async function emailTaken(email: string, exceptId?: string) {
  if (!email) return false;
  const row = await crmDb()
    .prepare(`
      SELECT id
      FROM crm_users
      WHERE LOWER(email) = ?
        AND id <> ?
      LIMIT 1
    `)
    .bind(email, exceptId || '')
    .first<{id: string}>();
  return Boolean(row);
}

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

export async function GET(
  req: Request
) {
  const user = await getCrmUser();

  if (!user) {
    return reply(
      {error: 'يجب تسجيل الدخول'},
      401
    );
  }

  const url = new URL(req.url);
  const assignable =
    url.searchParams.get('assignable') === '1';
  const fieldStaff =
    url.searchParams.get('field') === '1';

  try {
    const db = crmDb();

    /*
     * موظفو الميدان لاختيار التفويج.
     * متاح للمبيعات والمشرف والمدير، بدون بريد أو جوال.
     */
    if (fieldStaff) {
      if (
        user.role !== 'admin' &&
        user.role !== 'supervisor' &&
        user.role !== 'sales'
      ) {
        return reply(
          {
            error:
              'غير مسموح لك بعرض الموظفين الميدانيين',
          },
          403
        );
      }

      const result = await db
        .prepare(`
          SELECT
            id,
            username,
            name,
            role,
            active
          FROM crm_users
          WHERE active = 1
            AND role = 'field'
          ORDER BY name ASC
        `)
        .all();

      return reply(result.results);
    }

    /*
     * قائمة المندوبين التي يستخدمها
     * Admin / Supervisor عند تعيين العميل.
     */
    if (assignable) {
      if (
        user.role !== 'admin' &&
        user.role !== 'supervisor'
      ) {
        return reply(
          {
            error:
              'غير مسموح لك بعرض قائمة المندوبين',
          },
          403
        );
      }

      const result = await db
        .prepare(`
          SELECT
            id,
            username,
            name,
            email,
            phone,
            role,
            active
          FROM crm_users
          WHERE active = 1
            AND role IN ('sales', 'field')
          ORDER BY name ASC
        `)
        .all();

      return reply(result.results);
    }

    /*
     * إدارة المستخدمين الكاملة:
     * Admin فقط.
     */
    if (user.role !== 'admin') {
      return reply(
        {
          error:
            'غير مسموح لك بإدارة المستخدمين',
        },
        403
      );
    }

    const result = await db
      .prepare(`
        SELECT
          id,
          username,
          name,
          email,
          phone,
          role,
          active,
          created_at,
          updated_at
        FROM crm_users
        ORDER BY created_at DESC
      `)
      .all();

    return reply(result.results);
  } catch (error) {
    console.error(
      'Failed to load CRM users:',
      error
    );

    return reply(
      {
        error:
          'تعذر تحميل المستخدمين',
      },
      503
    );
  }
}

export async function POST(
  req: Request
) {
  const user = await getCrmUser();

  if (!user) {
    return reply(
      {error: 'يجب تسجيل الدخول'},
      401
    );
  }

  if (user.role !== 'admin') {
    return reply(
      {
        error:
          'غير مسموح لك بإدارة المستخدمين',
      },
      403
    );
  }

  if (!sameOrigin(req)) {
    return reply(
      {error: 'طلب غير مسموح'},
      403
    );
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return reply(
      {error: 'بيانات غير صالحة'},
      400
    );
  }

  const parsed =
    createUserSchema.safeParse(body);

  if (!parsed.success) {
    return reply(
      {
        error:
          'راجع اسم المستخدم وكلمة المرور والاسم والدور',
      },
      400
    );
  }

  const input = parsed.data;
  const email = parseUserEmail(input.email || '');
  const phone = parseUserPhone(input.phone || '');
  if (!email.ok) return reply({error: email.error}, 400);
  if (!phone.ok) return reply({error: phone.error}, 400);

  try {
    const db = crmDb();

    if (await emailTaken(email.value)) {
      return reply({error: 'هذا البريد مستخدم لحساب آخر'}, 409);
    }

    const existing = await db
      .prepare(`
        SELECT id
        FROM crm_users
        WHERE LOWER(username) = ?
        LIMIT 1
      `)
      .bind(input.username)
      .first<{id: string}>();

    if (existing) {
      return reply(
        {
          error:
            'اسم المستخدم مستخدم بالفعل',
        },
        409
      );
    }

    const passwordHash =
      await bcrypt.hash(
        input.password,
        12
      );

    const id =
      crypto.randomUUID();

    await db
      .prepare(`
        INSERT INTO crm_users (
          id,
          username,
          password_hash,
          name,
          email,
          phone,
          role,
          active
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `)
      .bind(
        id,
        input.username,
        passwordHash,
        input.name,
        email.value,
        phone.value,
        input.role
      )
      .run();

    return reply(
      {
        ok: true,
        id,
      },
      201
    );
  } catch (error) {
    console.error(
      'Failed to create CRM user:',
      error
    );

    return reply(
      {
        error:
          'تعذر إنشاء المستخدم',
      },
      503
    );
  }
}

export async function PATCH(req: Request) {
  const user = await getCrmUser();

  if (!user) {
    return reply({error: 'يجب تسجيل الدخول'}, 401);
  }

  if (user.role !== 'admin') {
    return reply({error: 'غير مسموح لك بإدارة المستخدمين'}, 403);
  }

  if (!sameOrigin(req)) {
    return reply({error: 'طلب غير مسموح'}, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply({error: 'بيانات غير صالحة'}, 400);
  }

  const parsed = updateContactSchema.safeParse(body);
  if (!parsed.success) {
    return reply({error: 'راجع الاسم والبريد الإلكتروني ورقم الجوال'}, 400);
  }

  const name = parseUserName(parsed.data.name);
  const email = parseUserEmail(parsed.data.email);
  const phone = parseUserPhone(parsed.data.phone);
  if (!name.ok) return reply({error: name.error}, 400);
  if (!email.ok) return reply({error: email.error}, 400);
  if (!phone.ok) return reply({error: phone.error}, 400);

  try {
    const db = crmDb();
    const current = await db
      .prepare(`SELECT id, username FROM crm_users WHERE id = ? LIMIT 1`)
      .bind(parsed.data.id)
      .first<{id: string; username: string}>();

    if (!current) {
      return reply({error: 'المستخدم غير موجود'}, 404);
    }

    if (await emailTaken(email.value, parsed.data.id)) {
      return reply({error: 'هذا البريد مستخدم لحساب آخر'}, 409);
    }

    // Display name only. username is the login and is never written here.
    await db
      .prepare(`UPDATE crm_users SET name = ?, email = ?, phone = ? WHERE id = ?`)
      .bind(name.value, email.value, phone.value, parsed.data.id)
      .run();

    return reply({
      ok: true,
      id: parsed.data.id,
      name: name.value,
      username: current.username,
      email: email.value,
      phone: phone.value,
    });
  } catch (error) {
    console.error('Failed to update CRM user contact:', error);
    return reply({error: 'تعذر حفظ الاسم أو البريد أو الجوال'}, 503);
  }
}