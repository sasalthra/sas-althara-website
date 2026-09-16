import {crmDb} from '@/lib/crm-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {'Cache-Control': 'no-store'},
  });
}

function allowedOrigin(origin: string | null) {
  if (!origin) return false;
  try {
    const host = new URL(origin).host.toLowerCase();
    const allowed = new Set<string>([
      'localhost:3000',
      '127.0.0.1:3000',
      'sasalthra.sa',
      'www.sasalthra.sa',
    ]);
    if (process.env.NEXTAUTH_URL) {
      allowed.add(new URL(process.env.NEXTAUTH_URL).host.toLowerCase());
    }
    if (process.env.PUBLIC_SITE_URL) {
      allowed.add(new URL(process.env.PUBLIC_SITE_URL).host.toLowerCase());
    }
    return allowed.has(host);
  } catch {
    return false;
  }
}

function cleanPhone(value: string) {
  return value.replace(/[^\d+]/g, '');
}

async function resolveOwnerId() {
  if (process.env.WEBSITE_LEAD_OWNER_ID) {
    return process.env.WEBSITE_LEAD_OWNER_ID;
  }
  const admin = await crmDb()
    .prepare(
      `SELECT id FROM crm_users WHERE role = 'admin' AND active = 1 ORDER BY created_at ASC LIMIT 1`,
    )
    .first<{id: string}>();
  return admin?.id ?? null;
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (!allowedOrigin(origin)) {
    return json({error: 'طلب غير مسموح'}, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({error: 'بيانات غير صالحة'}, 400);
  }

  if (typeof body.company === 'string' && body.company.trim()) {
    return json({ok: true});
  }

  const name = String(body.name ?? '').trim();
  const phone = cleanPhone(String(body.phone ?? ''));
  const city = String(body.city ?? '').trim().slice(0, 80);
  const notes = String(body.notes ?? '').trim().slice(0, 2000);
  const propertyPrice = Number(body.propertyPrice ?? 0);
  const downPayment = Number(body.downPayment ?? 0);
  const years = Number(body.years ?? 0);
  const rate = Number(body.annualRate ?? 0);
  const monthly = Number(body.monthlyPayment ?? 0);

  if (name.length < 2 || name.length > 100) {
    return json({error: 'الاسم مطلوب'}, 400);
  }
  if (!/^\+?\d{7,15}$/.test(phone)) {
    return json({error: 'رقم الجوال غير صحيح'}, 400);
  }

  const ownerId = await resolveOwnerId();
  if (!ownerId) {
    return json({error: 'تعذر حفظ الطلب حالياً'}, 503);
  }

  const calcLines = [
    propertyPrice > 0
      ? `سعر العقار: ${Math.round(propertyPrice).toLocaleString('ar-SA')} ر.س`
      : '',
    downPayment >= 0
      ? `الدفعة الأولى: ${Math.round(downPayment).toLocaleString('ar-SA')} ر.س`
      : '',
    years > 0 ? `مدة التمويل: ${years} سنة` : '',
    rate > 0 ? `نسبة تقريبية: ${rate}%` : '',
    monthly > 0
      ? `القسط الشهري التقريبي: ${Math.round(monthly).toLocaleString('ar-SA')} ر.س`
      : '',
    city ? `المدينة: ${city}` : '',
  ].filter(Boolean);

  const propertyOther = 'طلب حساب تمويل عبر صفحة احسب تمويلك';
  const leadNotes = [...calcLines, notes ? `ملاحظات العميل: ${notes}` : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 3000);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await crmDb()
      .prepare(
        `INSERT INTO leads (
          id, owner, assigned_to, field_assigned_to, created_by,
          name, phone, property_id, property_other, source, stage, notes, follow_up,
          created_at, updated_at
        ) VALUES (?, ?, '', '', ?, ?, ?, 'other', ?, 'calculate-loan', 'new', ?, '', ?, ?)`,
      )
      .bind(
        id,
        ownerId,
        ownerId,
        name,
        phone,
        propertyOther,
        leadNotes,
        now,
        now,
      )
      .run();

    await crmDb()
      .prepare(
        `INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        ownerId,
        'created',
        JSON.stringify({
          source: 'calculate-loan',
          stage: 'new',
          propertyPrice,
          downPayment,
          years,
          annualRate: rate,
          monthlyPayment: monthly,
          city,
        }),
      )
      .run();

    return json({ok: true, id});
  } catch (error) {
    console.error('public lead create failed', error);
    return json({error: 'تعذر حفظ الطلب، حاول مرة أخرى'}, 503);
  }
}
