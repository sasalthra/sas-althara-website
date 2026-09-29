import {timingSafeEqual} from 'node:crypto';
import {notifyReregistration} from './assignment-notify';
import {crmDb} from './crm-db';
import {extractInboundLead, type InboundLead} from './inbound-lead';
import {findLeadByNormalizedPhone, leadSourceLabel, noteReregistration} from './lead-reregistration';
import {normalizeLeadPhone} from './phone';

export type IntakeResult =
  | {ok: true; id?: string; duplicate?: boolean; ignored?: boolean}
  | {ok: false; error: string; status: number};

function secretBuffers(expected: string, received: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  if (left.length !== right.length || left.length === 0) return null;
  return {left, right};
}

export function leadWebhookAuthorized(received: string | null | undefined): boolean {
  const secret = process.env.LEAD_WEBHOOK_SECRET?.trim() || '';
  if (secret.length < 8) return false;
  const pair = secretBuffers(secret, (received || '').trim());
  if (!pair) return false;
  return timingSafeEqual(pair.left, pair.right);
}

export function leadWebhookTokenFrom(req: Request, body: unknown): string {
  const header =
    req.headers.get('x-lead-token') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (header.trim()) return header.trim();
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const embedded = record.token || record.google_key || record.secret;
    if (typeof embedded === 'string') return embedded.trim();
  }
  return '';
}

async function resolveOwnerId() {
  if (process.env.WEBSITE_LEAD_OWNER_ID) return process.env.WEBSITE_LEAD_OWNER_ID;
  const admin = await crmDb()
    .prepare(`SELECT id FROM crm_users WHERE role = 'admin' AND active = 1 ORDER BY created_at ASC LIMIT 1`)
    .first<{id: string}>();
  return admin?.id ?? null;
}

function propertyOtherFor(lead: InboundLead): string {
  if (lead.source === 'property-inquiry') {
    return (lead.propertyTitle || 'استفسار عن عقار').slice(0, 500);
  }
  if (lead.source === 'contact') return 'طلب تواصل من الموقع';
  if (lead.source === 'calculate-loan') return 'طلب حساب تمويل عبر صفحة احسب تمويلك';
  const campaign = lead.campaign || lead.formName;
  if (campaign) return `حملة: ${campaign}`.slice(0, 500);
  return 'طلب وارد';
}

function notesFor(lead: InboundLead): string {
  const lines: string[] = [];
  if (lead.source === 'calculate-loan') {
    if (lead.propertyPrice > 0) lines.push(`سعر العقار: ${Math.round(lead.propertyPrice).toLocaleString('ar-SA')} ر.س`);
    if (lead.downPayment >= 0) lines.push(`الدفعة الأولى: ${Math.round(lead.downPayment).toLocaleString('ar-SA')} ر.س`);
    if (lead.years > 0) lines.push(`مدة التمويل: ${lead.years} سنة`);
    if (lead.annualRate > 0) lines.push(`نسبة تقريبية: ${lead.annualRate}%`);
    if (lead.monthlyPayment > 0) {
      lines.push(`القسط الشهري التقريبي: ${Math.round(lead.monthlyPayment).toLocaleString('ar-SA')} ر.س`);
    }
  }
  if (lead.city) lines.push(`المدينة: ${lead.city}`);
  if (lead.propertyTitle) lines.push(`العقار: ${lead.propertyTitle}`);
  if (lead.propertyId) lines.push(`معرف العقار: ${lead.propertyId}`);
  if (lead.campaign) lines.push(`الحملة: ${lead.campaign}`);
  if (lead.formName) lines.push(`النموذج: ${lead.formName}`);
  if (lead.notes) lines.push(lead.source === 'calculate-loan' ? `ملاحظات العميل: ${lead.notes}` : lead.notes);
  return lines.filter(Boolean).join('\n').slice(0, 3000);
}

export async function acceptInboundLead(body: unknown, fallbackSource: string): Promise<IntakeResult> {
  const lead = extractInboundLead(body, fallbackSource);
  if (lead.company) return {ok: true, ignored: true};
  if (lead.platformPing) return {ok: true, ignored: true};
  if (lead.name.length < 2 || lead.name.length > 100) return {ok: false, error: 'الاسم مطلوب', status: 400};
  const phone = normalizeLeadPhone(lead.phone);
  if (!phone) return {ok: false, error: 'رقم الجوال غير صحيح', status: 400};

  const ownerId = await resolveOwnerId();
  if (!ownerId) return {ok: false, error: 'تعذر حفظ الطلب حالياً', status: 503};

  const propertyOther = propertyOtherFor(lead);
  const leadNotes = notesFor(lead);
  const campaign = [lead.campaign, lead.formName].filter(Boolean).join(' — ');
  const db = crmDb();

  try {
    const existing = await findLeadByNormalizedPhone(db, phone);
    if (existing) {
      await noteReregistration(db, existing, {
        actorId: 'system',
        source: lead.source,
        submittedName: lead.name,
        submittedNotes: leadNotes,
        campaign,
      });
      try {
        await notifyReregistration({
          lead: {...existing, phone: normalizeLeadPhone(existing.phone) || existing.phone},
          source: lead.source,
          submittedName: lead.name,
          submittedNotes: leadNotes,
          campaign,
        });
      } catch (error) {
        console.error('reregistration email failed', error);
      }
      return {ok: true, id: existing.id, duplicate: true};
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO leads (
          id, owner, assigned_to, field_assigned_to, created_by,
          name, phone, property_id, property_other, source, stage, notes, follow_up,
          created_at, updated_at
        ) VALUES (?, ?, '', '', ?, ?, ?, 'other', ?, ?, 'new', ?, '', ?, ?)`
      )
      .bind(id, ownerId, ownerId, lead.name, phone, propertyOther, lead.source, leadNotes, now, now)
      .run();
    await db
      .prepare(`INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        id,
        ownerId,
        'created',
        JSON.stringify({
          source: lead.source,
          sourceLabel: leadSourceLabel(lead.source),
          stage: 'new',
          campaign,
          propertyPrice: lead.propertyPrice,
          downPayment: lead.downPayment,
          years: lead.years,
          annualRate: lead.annualRate,
          monthlyPayment: lead.monthlyPayment,
          city: lead.city,
        })
      )
      .run();
    return {ok: true, id, duplicate: false};
  } catch (error) {
    console.error('inbound lead create failed', error);
    return {ok: false, error: 'تعذر حفظ الطلب، حاول مرة أخرى', status: 503};
  }
}
