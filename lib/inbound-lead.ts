/**
 * Reads a website form or an ad-platform lead payload into one shape.
 * Meta, TikTok, Snap and Google field names are accepted. A platform ping
 * that has no phone (Meta leadgen id only) stays empty so the caller can
 * acknowledge it without creating a client.
 */

export type InboundLead = {
  name: string;
  phone: string;
  notes: string;
  source: string;
  campaign: string;
  formName: string;
  propertyTitle: string;
  propertyId: string;
  city: string;
  company: string;
  propertyPrice: number;
  downPayment: number;
  years: number;
  annualRate: number;
  monthlyPayment: number;
  platformPing: boolean;
};

function text(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string') return value.trim();
  return '';
}

function amount(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(text(value));
  return Number.isFinite(number) ? number : 0;
}

function columnValue(row: Record<string, unknown>): string {
  return text(row.string_value ?? row.value ?? row.phone ?? row.name);
}

function fromUserColumns(columns: unknown): {name: string; phone: string} {
  if (!Array.isArray(columns)) return {name: '', phone: ''};
  let name = '';
  let phone = '';
  for (const column of columns) {
    if (!column || typeof column !== 'object') continue;
    const row = column as Record<string, unknown>;
    const id = text(row.column_id || row.column_name || row.columnName).toUpperCase();
    const value = columnValue(row);
    if (!value) continue;
    if (/PHONE|MOBILE|جوال|هاتف/.test(id)) phone = phone || value;
    else if (/NAME|اسم/.test(id)) name = name || value;
  }
  return {name, phone};
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function extractInboundLead(body: unknown, fallbackSource = 'website'): InboundLead {
  const record = nestedRecord(body) || {};
  const columns = fromUserColumns(record.user_column_data);
  const first = text(record.first_name || record.firstName);
  const last = text(record.last_name || record.lastName);
  const joinedName = [first, last].filter(Boolean).join(' ').trim();
  const name =
    text(record.name || record.full_name || record.fullName || record.customer_name) ||
    columns.name ||
    joinedName;
  const phone =
    text(
      record.phone ||
        record.phone_number ||
        record.phoneNumber ||
        record.mobile ||
        record.tel
    ) || columns.phone;
  const campaign = text(
    record.campaign ||
      record.campaign_name ||
      record.campaignName ||
      record.ad_name ||
      record.adset_name
  ).slice(0, 120);
  const formName = text(record.form_name || record.formName || record.form_id || record.formId).slice(0, 120);
  const explicitSource = text(record.source).slice(0, 80);
  const hasGoogleColumns = Array.isArray(record.user_column_data);
  const hasMetaPing = Boolean(record.leadgen_id || record.entry || record.object === 'leadgen');
  let source = explicitSource;
  if (!source && hasGoogleColumns) source = 'google';
  else if (!source && hasMetaPing) source = 'meta';
  else if (!source) source = fallbackSource.slice(0, 80) || 'website';
  const notes = text(record.notes || record.message || record.comment).slice(0, 2000);
  const propertyTitle = text(record.propertyTitle || record.property_title || record.listing).slice(0, 200);
  const propertyId = text(record.propertyId || record.property_id).slice(0, 32);
  return {
    name: name.slice(0, 100),
    phone,
    notes,
    source,
    campaign,
    formName,
    propertyTitle,
    propertyId,
    city: text(record.city).slice(0, 80),
    company: text(record.company),
    propertyPrice: amount(record.propertyPrice),
    downPayment: amount(record.downPayment),
    years: amount(record.years),
    annualRate: amount(record.annualRate),
    monthlyPayment: amount(record.monthlyPayment),
    platformPing: !phone && !name && hasMetaPing,
  };
}
