import {normalizeLeadPhone, phoneLookupVariants} from './phone';

export type LeadDb = {
  prepare(sql: string): {
    bind(...args: Array<string | number | null>): {
      all(): Promise<{results: Array<Record<string, unknown>>}>;
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
};

export type ExistingLead = {
  id: string;
  name: string;
  phone: string;
  stage: string;
  assigned_to: string;
  source: string;
};

const SOURCE_LABELS: Record<string, string> = {
  contact: 'نموذج التواصل',
  'calculate-loan': 'احسب تمويلك',
  'property-inquiry': 'استفسار عن عقار',
  meta: 'ميتا',
  tiktok: 'تيك توك',
  snapchat: 'سناب شات',
  google: 'جوجل',
  excel: 'إكسل',
  google_sheets: 'جداول جوجل',
  manual: 'إضافة يدوية',
  management: 'الإدارة',
  website: 'الموقع',
  ad: 'حملة إعلانية',
};

export function leadSourceLabel(source: string | null | undefined): string {
  const key = source?.trim() || '';
  return SOURCE_LABELS[key] || key || 'غير محدد';
}

export function riyadhStamp(date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Riyadh',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export async function findLeadByNormalizedPhone(
  db: LeadDb,
  phone: string,
  exceptId = ''
): Promise<ExistingLead | null> {
  const variants = phoneLookupVariants(phone);
  if (!variants.length) return null;
  const marks = variants.map(() => '?').join(',');
  const sql = `SELECT id, name, phone, stage, IFNULL(assigned_to, '') AS assigned_to, IFNULL(source, '') AS source FROM leads WHERE phone IN (${marks})${exceptId ? ' AND id <> ?' : ''} ORDER BY created_at ASC LIMIT 1`;
  const args: Array<string | number | null> = [...variants];
  if (exceptId) args.push(exceptId);
  const row = await db.prepare(sql).bind(...args).first<ExistingLead>();
  if (!row?.id) return null;
  return {
    id: String(row.id),
    name: String(row.name || ''),
    phone: String(row.phone || ''),
    stage: String(row.stage || ''),
    assigned_to: String(row.assigned_to || ''),
    source: String(row.source || ''),
  };
}

export type ReregistrationInput = {
  actorId: string;
  source: string;
  submittedName: string;
  submittedNotes: string;
  campaign: string;
};

export async function noteReregistration(
  db: LeadDb,
  lead: ExistingLead,
  input: ReregistrationInput
): Promise<void> {
  const now = new Date().toISOString();
  const phone = normalizeLeadPhone(lead.phone) || lead.phone;
  const sourceLabel = leadSourceLabel(input.source);
  const campaign = input.campaign.trim();
  const submittedName = input.submittedName.trim();
  const submittedNotes = input.submittedNotes.trim().slice(0, 2000);
  const note = [
    `أعاد العميل التسجيل بتاريخ ${riyadhStamp()}.`,
    `المصدر: ${sourceLabel}.`,
    campaign ? `الحملة / النموذج: ${campaign}.` : '',
    submittedName ? `الاسم المُرسل: ${submittedName}.` : '',
    submittedNotes ? `الملاحظات: ${submittedNotes}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (phone && phone !== lead.phone) {
    await db.prepare('UPDATE leads SET phone = ?, updated_at = ? WHERE id = ?').bind(phone, now, lead.id).run();
  } else {
    await db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').bind(now, lead.id).run();
  }
  await db
    .prepare('INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .bind(
      crypto.randomUUID(),
      lead.id,
      input.actorId || 'system',
      'reregistered',
      JSON.stringify({
        note,
        source: input.source,
        campaign,
        submittedName,
        submittedNotes,
        phone,
        at: now,
      })
    )
    .run();
}
