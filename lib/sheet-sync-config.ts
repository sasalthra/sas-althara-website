import {z} from 'zod';
import {foldHeader} from './lead-import';
import {normalizeLeadPhone} from './phone';

/** Lead-form columns an admin can map. Name and phone are required. */
export const SHEET_FIELDS = [
  'name',
  'phone',
  'propertyType',
  'budget',
  'citizen',
  'supported',
  'salary',
  'age',
  'contactTime',
  'purchaseTimeline',
  'leadId',
  'sheetLeadStatus',
  'sheetAssignment',
  'sheetState',
  'sheetTiktokStatus',
  'city',
  'notes',
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
  propertyType: 'الوحدة / نوع العقار',
  budget: 'طريقة الشراء',
  citizen: 'هل انت مواطن',
  supported: 'هل انت مدعوم',
  salary: 'الراتب',
  age: 'العمر',
  contactTime: 'وقت التواصل',
  purchaseTimeline: 'الوقت المتوقع للشراء',
  leadId: 'TikTok Lead ID',
  sheetLeadStatus: 'Lead status (ملاحظة فقط)',
  sheetAssignment: 'الاسناد (ملاحظة فقط)',
  sheetState: 'الحاله (ملاحظة فقط)',
  sheetTiktokStatus: 'TikTok Lead Status (ملاحظة فقط)',
  city: 'المدينة',
  notes: 'الملاحظات',
  campaign: 'عمود اسم الحملة',
  residency: 'هل أنت (مواطن / مقيم)',
  platform: 'المنصة',
  formName: 'اسم النموذج',
};

export const DEFAULT_SHEET_LABEL = 'تيك توك';
export const TIKTOK_SHEET_SOURCE_ID = 'tiktok-leads-1';
export const TIKTOK_SHEET_ID = '1_lAoABagOV93EQPi_vNWct4ok3zCWE1plJFfbDzm6Nc';
/** Tab «تيك توك». The first tab is «meta» and must not be synced. */
export const TIKTOK_SHEET_GID = '1331680179';
export const TIKTOK_META_TAB_GID = '1976004933';
export const TIKTOK_SHEET_CAMPAIGN = '';

/** Header row of the public «تيك توك» tab (gid 1331680179). */
export const TIKTOK_SHEET_HEADERS = [
  'Lead status',
  'الاسم',
  'رقم الجوال',
  'الوحدة',
  'طريقة الشراء',
  'هل انت مواطن',
  'هل انت مدعوم',
  'الراتب',
  'العمر',
  'وقت التواصل',
  'الوقت المتوقع للشراء',
  'TikTok Lead ID',
  'الاسناد',
  'الحاله',
  'TikTok Lead Status',
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
  {key: 'leadId', test: folded => /tiktok lead id/.test(folded)},
  {key: 'sheetTiktokStatus', test: folded => /tiktok lead status/.test(folded)},
  {key: 'sheetLeadStatus', test: folded => /^lead status$/.test(folded)},
  {key: 'phone', test: folded => /phone number|^phone$|^mobile$|جوال|هاتف|موبايل/.test(folded)},
  {
    key: 'name',
    test: folded =>
      !/campaign name|form name|ad name|adset name|lead id|lead status/.test(folded) &&
      (/full name|^name$|الاسم الكامل|^الاسم$|^اسم$|اسم العميل/.test(folded)),
  },
  {key: 'propertyType', test: folded => /^الوحده$|نوع العقار|property type|^unit$/.test(folded)},
  {key: 'budget', test: folded => /ميزاني|^طريقه الشراء$|purchase method|^budget$/.test(folded)},
  {key: 'citizen', test: folded => /هل انت مواطن/.test(folded)},
  {key: 'supported', test: folded => /هل انت مدعوم/.test(folded)},
  {key: 'salary', test: folded => /^الراتب$|^salary$/.test(folded)},
  {key: 'age', test: folded => /^العمر$|^age$/.test(folded)},
  {key: 'contactTime', test: folded => /وقت التواصل/.test(folded)},
  {key: 'purchaseTimeline', test: folded => /الوقت المتوقع للشراء/.test(folded)},
  {key: 'sheetAssignment', test: folded => /^الاسناد$/.test(folded)},
  {key: 'sheetState', test: folded => /^الحاله$/.test(folded)},
  {key: 'city', test: folded => /^(city|المدينه|مدينه)$/.test(folded)},
  {key: 'campaign', test: folded => /campaign name|^campaign$|اسم الحمله|^الحمله$/.test(folded)},
  {key: 'formName', test: folded => /form name|اسم النموذج|^النموذج$/.test(folded)},
  {key: 'residency', test: folded => /^هل انت$|residency/.test(folded)},
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

const noteLines: Array<{key: SheetField; label: string}> = [
  {key: 'propertyType', label: 'الوحدة'},
  {key: 'budget', label: 'طريقة الشراء'},
  {key: 'citizen', label: 'هل انت مواطن'},
  {key: 'supported', label: 'هل انت مدعوم'},
  {key: 'salary', label: 'الراتب'},
  {key: 'age', label: 'العمر'},
  {key: 'contactTime', label: 'وقت التواصل'},
  {key: 'purchaseTimeline', label: 'الوقت المتوقع للشراء'},
  {key: 'sheetLeadStatus', label: 'Lead status'},
  {key: 'sheetAssignment', label: 'الاسناد'},
  {key: 'sheetState', label: 'الحاله'},
  {key: 'sheetTiktokStatus', label: 'TikTok Lead Status'},
  {key: 'leadId', label: 'TikTok Lead ID'},
  {key: 'city', label: 'المدينة'},
  {key: 'residency', label: 'هل أنت'},
  {key: 'platform', label: 'المنصة'},
  {key: 'formName', label: 'النموذج'},
];

function mappedCell(row: string[], mapping: SheetMapping, key: SheetField) {
  const index = mapping[key];
  if (index === undefined || index < 0) return '';
  return String(row[index] ?? '').replace(/\s+/g, ' ').trim();
}

/** Stable id from the TikTok Lead ID column. Empty when that column is unmapped or blank. */
export function sheetExternalId(row: string[], mapping: SheetMapping) {
  return mappedCell(row, mapping, 'leadId').slice(0, 120);
}

/** A row with neither a name nor a phone is not a lead and is not stored. */
export function sheetNameAndPhoneBlank(row: string[], mapping: SheetMapping) {
  return !mappedCell(row, mapping, 'name') && !mappedCell(row, mapping, 'phone');
}

export function composeSheetLead(
  row: string[],
  source: {label: string; campaign: string},
  mapping: SheetMapping
): SheetLeadDraft {
  const read = (key: SheetField) => mappedCell(row, mapping, key);
  const propertyType = tidy(read('propertyType'));
  const rowCampaign = tidy(read('campaign'));
  const configured = source.campaign.trim();
  const campaign = (configured || rowCampaign).slice(0, 60);
  const label = (source.label.trim() || DEFAULT_SHEET_LABEL).slice(0, 40);
  const lines = [
    ...noteLines.map(({key, label: title}) => {
      const value = tidy(read(key));
      return value ? `${title}: ${value}` : '';
    }),
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

export type SheetTab = {gid: string; name: string};

/** Tab names from a public Google htmlview page. Ignores everything except name and gid. */
export function parseSheetTabList(html: string): SheetTab[] {
  const tabs: SheetTab[] = [];
  const seen = new Set<string>();
  const pattern = /items\.push\(\{name:\s*"((?:\\.|[^"\\])*)"[\s\S]{0,500}?gid:\s*"(\d{1,20})"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && tabs.length < 40) {
    const gid = match[2];
    if (seen.has(gid)) continue;
    const name = match[1]
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/[\u0000-\u001f]/g, '')
      .trim()
      .slice(0, 80);
    if (!name) continue;
    seen.add(gid);
    tabs.push({gid, name});
  }
  return tabs;
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
    gid: TIKTOK_SHEET_GID,
    label: DEFAULT_SHEET_LABEL,
    campaign: TIKTOK_SHEET_CAMPAIGN,
    mapping: suggestSheetMapping(TIKTOK_SHEET_HEADERS),
    headers: TIKTOK_SHEET_HEADERS,
    enabled: 1,
  };
}
