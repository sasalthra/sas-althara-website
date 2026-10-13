import bcrypt from 'bcryptjs';
import {z} from 'zod';

import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import {paramEq} from '@/lib/sql-collation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const passwordSchema = z.object({
  id: z.string().trim().min(1).max(255),
  password: z.string().max(100),
  confirm: z.string().max(100),
});

function sameOrigin(req: Request) {
  return Boolean(
    process.env.NEXTAUTH_URL &&
      req.headers.get('origin') === new URL(process.env.NEXTAUTH_URL).origin
  );
}

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {'Cache-Control': 'no-store'},
  });
}

export async function POST(req: Request) {
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

  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return reply({error: 'راجع كلمة المرور الجديدة'}, 400);
  }

  const {id, password, confirm} = parsed.data;
  if (password.length < 8 || confirm.length < 8) {
    return reply({error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'}, 400);
  }
  if (password !== confirm) {
    return reply({error: 'كلمتا المرور غير متطابقتين'}, 400);
  }

  try {
    const db = crmDb();
    const current = await db
      .prepare(`SELECT id FROM crm_users WHERE ${paramEq('id')} LIMIT 1`)
      .bind(id)
      .first<{id: string}>();

    if (!current) {
      return reply({error: 'المستخدم غير موجود'}, 404);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await db
      .prepare(`UPDATE crm_users SET password_hash = ? WHERE ${paramEq('id')}`)
      .bind(passwordHash, id)
      .run();

    return reply({ok: true, id});
  } catch (error) {
    console.error('Failed to change CRM user password:', error);
    return reply({error: 'تعذر تغيير كلمة المرور'}, 503);
  }
}
