import {z} from 'zod';
import {foldHeader} from './lead-import';
import {normalizeLeadPhone} from './phone';

/** Lead-form columns an admin can map. Name and phone are required. */
export const SHEET_FIELDS = [
  'name',
  'phone',
  'city',
  'notes',
  'propertyType',
  'budget',
  'campaign',
  'residency',
  'platform',
  'formName',
] as const;

export type SheetField = (typeof SHEET_FIELDS)[number];
export type SheetMapping = Partial<Record<SheetField, number>>;

export const sheetFieldLabels: Record<SheetField, string> = {
  name: 'الاسم',
  phone: 'الجوال',
  city: 'المدينة',
  notes: 'الملاحظات',
  propertyType: 'نوع العقار',
  budget: 'الميزانية / طريقة الشراء',
  campaign: 'عمود اسم الحملة',
  residency: 'هل أنت (مواطن / مقيم)',
  platform: 'المنصة',
  formName: 'اسم النموذج',
};

export const DEFAULT_SHEET_LABEL = 'تيك توك';
export const TIKTOK_SHEET_SOURCE_ID = 'tiktok-leads-1';
export const TIKTOK_SHEET_ID = '1_lAoABagOV93EQPi_vNWct4ok3zCWE1plJFfbDzm6Nc';
export const TIKTOK_SHEET_CAMPAIGN = 'تمويل عقارى 4 نوفمبر';

/** Header row read from the public CSV export of the owner's lead form sheet. */
export const TIKTOK_SHEET_HEADERS = [
  'id',
  'created_time',
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'form_id',
  'form_name',
  'is_organic',
  'platform',
  'نوع_العقار_الذى_تبحث_عنه',
  'طريقة_الشراء_التى_تفضلها',
  'هل_انت_',
  'full_name',
  'phone_number',
  'lead_status',
  '',
  '',
  '',
];

/** In-process poll while the Node server is running. 0 disables it. */
export const DEFAULT_SHEETS_SYNC_INTERVAL_MS = 180_000;

export function sheetsSyncIntervalMs() {
  const raw = process.env.SHEETS_SYNC_INTERVAL_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_SHEETS_SYNC_INTERVAL_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(30_000, Math.min(value, 60 * 60 * 1000));
}

export function parseSheetRef(input: string): {sheetId: string; gid: string} | null {
  const text = input.trim();
  if (/^[a-zA-Z0-9_-]{20,100}$/.test(text)) return {sheetId: text, gid: ''};
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== 'docs.google.com' && url.hostname !== 'drive.google.com') return null;
  const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,100})/);
  if (!match) return null;
  const fromQuery = url.searchParams.get('gid') || '';
  const fromHash = url.hash.match(/gid=(\d+)/)?.[1] || '';
  const gid = fromQuery || fromHash;
  if (gid && !/^\d{1,20}$/.test(gid)) return null;
  return {sheetId: match[1], gid};
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length && rows[rows.length - 1].every(value => value === '')) rows.pop();
  return rows;
}

export function normalizeHeaderRow(headers: string[]) {
  const copy = headers.map(header => header.replace(/^\uFEFF/, '').trim().slice(0, 150));
  while (copy.length && copy[copy.length - 1] === '') copy.pop();
  return copy;
}

export function sameHeaders(saved: string[], live: string[]) {
  const left = normalizeHeaderRow(saved);
  const right = normalizeHeaderRow(live);
  if (!left.length || left.length !== right.length) return false;
  return left.every((header, index) => header === right[index]);
}

const matchers: {key: SheetField; test: (folded: string) => boolean}[] = [
  {key: 'phone', test: folded => /phone number|^phone$|^mobile$|جوال|هاتف|موبايل/.test(folded)},
  {
    key: 'name',
    test: folded =>
      !/campaign name|form name|ad name|adset name/.test(folded) &&
      (/full name|^name$|الاسم الكامل|^الاسم$|^اسم$|اسم العميل/.test(folded)),
  },
  {key: 'city', test: folded => /^(city|المدينه|مدينه)$/.test(folded) || folded.includes('مدين')},
  {key: 'propertyType', test: folded => /نوع العقار|property type/.test(folded)},
  {key: 'budget', test: folded => /ميزاني|طريقه الشراء|budget|purchase/.test(folded)},
  {key: 'campaign', test: folded => /campaign name|^campaign$|اسم الحمله|^الحمله$/.test(folded)},
  {key: 'formName', test: folded => /form name|اسم النموذج|^النموذج$/.test(folded)},
  {key: 'residency', test: folded => /هل انت|residency/.test(folded)},
  {key: 'platform', test: folded => /^(platform|المنصه|منصه)$/.test(folded)},
  {key: 'notes', test: folded => /^(notes|note|الملاحظات|ملاحظات|ملاحظه)$/.test(folded)},
];

export function suggestSheetMapping(headers: string[]): SheetMapping {
  const mapping: SheetMapping = {};
  const used = new Set<number>();
  headers.forEach((header, index) => {
    const folded = foldHeader(header);
    if (!folded || used.has(index)) return;
    for (const matcher of matchers) {
      if (mapping[matcher.key] !== undefined) continue;
      if (!matcher.test(folded)) continue;
      mapping[matcher.key] = index;
      used.add(index);
      break;
    }
  });
  return mapping;
}

function tidy(value: string) {
  return value.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

export type SheetLeadDraft = {
  name: string;
  phone: string;
  propertyOther: string;
  source: string;
  notes: string;
  campaign: string;
  stage: 'new';
};

export function composeSheetLead(
  row: string[],
  source: {label: string; campaign: string},
  mapping: SheetMapping
): SheetLeadDraft {
  const read = (key: SheetField) => {
    const index = mapping[key];
    if (index === undefined || index < 0) return '';
    return String(row[index] ?? '').replace(/\s+/g, ' ').trim();
  };
  const propertyType = tidy(read('propertyType'));
  const budget = tidy(read('budget'));
  const city = tidy(read('city'));
  const residency = tidy(read('residency'));
  const platform = tidy(read('platform'));
  const formName = tidy(read('formName'));
  const rowCampaign = tidy(read('campaign'));
  const configured = source.campaign.trim();
  const campaign = (configured || rowCampaign).slice(0, 60);
  const label = (source.label.trim() || DEFAULT_SHEET_LABEL).slice(0, 40);
  const lines = [
    propertyType ? `نوع العقار: ${propertyType}` : '',
    budget ? `الميزانية / طريقة الشراء: ${budget}` : '',
    city ? `المدينة: ${city}` : '',
    residency ? `هل أنت: ${residency}` : '',
    platform ? `المنصة: ${platform}` : '',
    formName ? `النموذج: ${formName}` : '',
    rowCampaign && rowCampaign !== campaign ? `حملة الإعلان: ${rowCampaign}` : '',
    read('notes'),
  ].filter(Boolean);
  const propertyOther = (propertyType || 'غير محدد').slice(0, 500);
  return {
    name: tidy(read('name')).slice(0, 100),
    phone: normalizeLeadPhone(read('phone')),
    propertyOther: propertyOther.length >= 2 ? propertyOther : 'غير محدد',
    source: (campaign ? `${label} — ${campaign}` : label).slice(0, 80) || DEFAULT_SHEET_LABEL,
    notes: lines.join('\n').slice(0, 3000),
    campaign,
    stage: 'new',
  };
}

export function sheetRowProblem(lead: Pick<SheetLeadDraft, 'name' | 'phone'>) {
  if (lead.name.trim().length < 2) return 'الاسم ناقص';
  if (!lead.phone) return 'الجوال غير صالح';
  return '';
}

export function isBlankSheetRow(cells: string[]) {
  return cells.every(cell => !String(cell ?? '').trim());
}

const mappingSchema = z.record(z.enum(SHEET_FIELDS), z.number().int().min(0).max(200));

export const sheetSourceInputSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).optional(),
    sheetUrl: z.string().trim().min(5).max(500),
    gid: z.string().regex(/^\d{0,20}$/).optional(),
    label: z.string().trim().min(1).max(40),
    campaign: z.string().trim().max(60).default(''),
    mapping: mappingSchema,
    headers: z.array(z.string().max(150)).min(2).max(100),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mapping.name === undefined || value.mapping.phone === undefined) {
      ctx.addIssue({code: 'custom', message: 'الاسم والجوال مطلوبان في الربط'});
    }
    const indexes = Object.values(value.mapping);
    if (new Set(indexes).size !== indexes.length) {
      ctx.addIssue({code: 'custom', message: 'لا تكرر العمود في الربط'});
    }
    if (indexes.some(index => index >= value.headers.length)) {
      ctx.addIssue({code: 'custom', message: 'ربط عمود خارج العناوين'});
    }
    if (!parseSheetRef(value.sheetUrl)) {
      ctx.addIssue({code: 'custom', path: ['sheetUrl'], message: 'رابط الجدول أو معرفه غير صالح'});
    }
  });

export const sheetPreviewSchema = z
  .object({
    sheetUrl: z.string().trim().min(5).max(500),
    gid: z.string().regex(/^\d{0,20}$/).optional(),
  })
  .strict();

export function tiktokSheetSeed() {
  return {
    id: TIKTOK_SHEET_SOURCE_ID,
    sheetId: TIKTOK_SHEET_ID,
    gid: '',
    label: DEFAULT_SHEET_LABEL,
    campaign: TIKTOK_SHEET_CAMPAIGN,
    mapping: suggestSheetMapping(TIKTOK_SHEET_HEADERS),
    headers: TIKTOK_SHEET_HEADERS,
    enabled: 1,
  };
}
