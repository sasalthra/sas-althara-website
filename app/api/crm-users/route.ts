import bcrypt from 'bcryptjs';
import {z} from 'zod';

import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';

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
    .email()
    .max(190)
    .optional()
    .or(z.literal('')),

  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .or(z.literal('')),

  role: z.enum([
    'admin',
    'supervisor',
    'sales',
    'field',
  ]),
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

  try {
    const db = crmDb();

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

  try {
    const db = crmDb();

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
        input.email || '',
        input.phone || '',
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