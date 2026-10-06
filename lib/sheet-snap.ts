import {normalizeSource} from './lead-cohorts';
import {riyadhDayKey} from './lead-dates';
import {foldHeader} from './lead-import';
import {isSaudiMobile, normalizeLeadPhone} from './phone';
import {
  composeSheetLead,
  isSheetUuid,
  normalizeHeaderCell,
  parseSnapChoice,
  suggestSheetMapping,
  type SheetField,
  type SheetLeadDraft,
  type SheetMapping,
} from './sheet-sync-config';

/** Reports bucket Snapchat under this label (`normalizeSource('snapchat')`). */
export function snapPlatformLabel() {
  return normalizeSource('snapchat').label;
}

export function isSnapTimestamp(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(String(value ?? '').trim());
}

/**
 * Snap sends UTC. The CRM stores that instant and the lead page formats it in
 * Asia/Riyadh, so the registration day is the Riyadh day.
 */
export function snapRegisteredAt(value: string) {
  const trimmed = String(value ?? '').trim();
  if (!isSnapTimestamp(trimmed)) return '';
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function isSnapChoiceCell(value: string) {
  const raw = String(value ?? '').trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) return false;
  return /:\s*true\b/i.test(raw) || /:\s*false\b/i.test(raw);
}

function cellIsSaudiMobile(value: string) {
  if (isSheetUuid(value)) return false;
  return isSaudiMobile(value);
}

type ColumnTest = (value: string) => boolean;

function columnStats(rows: string[][], index: number, test: ColumnTest) {
  let nonempty = 0;
  let hits = 0;
  for (const row of rows) {
    const value = String(row[index] ?? '').trim();
    if (!value) continue;
    nonempty += 1;
    if (test(value)) hits += 1;
  }
  return {nonempty, hits};
}

function mostly(rows: string[][], index: number, test: ColumnTest) {
  if (index < 0) return false;
  const stats = columnStats(rows, index, test);
  return stats.nonempty > 0 && stats.hits * 2 >= stats.nonempty;
}

const ANSWER_FIELDS: {field: SnapAnswerField; label: string; test: (folded: string) => boolean}[] = [
  {field: 'propertyType', label: 'نوع العقار', test: folded => /نوع العقار|^الوحده$/.test(folded)},
  {field: 'location', label: 'موقع العقار', test: folded => /^موقع العقار$|^المدينه$|^مدينه$/.test(folded)},
  {field: 'purchase', label: 'طريقة الشراء', test: folded => /^طريقه الشراء$|ميزاني/.test(folded)},
  {field: 'salary', label: 'الراتب', test: folded => /^الراتب$/.test(folded)},
  {field: 'residency', label: 'مواطن ام مقيم', test: folded => (/مواطن/.test(folded) && /مقيم/.test(folded)) || /هل انت مواطن/.test(folded)},
  {field: 'timeline', label: 'الفترة المتوقعه للشراء', test: folded => /الفتره المتوقعه للشراء|الوقت المتوقع للشراء/.test(folded)},
];

export type SnapAnswerField = 'propertyType' | 'location' | 'purchase' | 'salary' | 'residency' | 'timeline' | 'other';

export type SnapAnswerColumn = {index: number; label: string; field: SnapAnswerField};

export type SheetImportPlan = {
  snap: boolean;
  mapping: SheetMapping;
  lastNameIndex: number;
  createdAtIndex: number;
  leadIdIndex: number;
  formNameIndex: number;
  campaignIndex: number;
  adNameIndex: number;
  adSetIndex: number;
  answers: SnapAnswerColumn[];
  extraIndexes: number[];
};

function emptyPlan(mapping: SheetMapping): SheetImportPlan {
  return {
    snap: false,
    mapping,
    lastNameIndex: -1,
    createdAtIndex: -1,
    leadIdIndex: -1,
    formNameIndex: -1,
    campaignIndex: -1,
    adNameIndex: -1,
    adSetIndex: -1,
    answers: [],
    extraIndexes: [],
  };
}

function dataRows(rows: string[][]) {
  return rows.filter(row => row.some(cell => String(cell ?? '').trim()));
}

function widthOf(headers: string[], rows: string[][]) {
  return Math.max(headers.length, 0, ...rows.map(row => row.length));
}

function saudiPhoneColumn(rows: string[][], width: number) {
  let best = -1;
  let bestHits = 0;
  for (let index = 0; index < width; index++) {
    const stats = columnStats(rows, index, cellIsSaudiMobile);
    if (!stats.nonempty || stats.hits * 2 < stats.nonempty || stats.hits <= bestHits) continue;
    best = index;
    bestHits = stats.hits;
  }
  return best;
}

function timestampColumn(rows: string[][], width: number) {
  let best = -1;
  let bestHits = 0;
  for (let index = 0; index < width; index++) {
    const stats = columnStats(rows, index, isSnapTimestamp);
    if (!stats.nonempty || stats.hits * 2 < stats.nonempty || stats.hits <= bestHits) continue;
    best = index;
    bestHits = stats.hits;
  }
  return best;
}

function looksLikeNameColumn(rows: string[][], index: number) {
  if (index < 0 || !mostly(rows, index, value => value.trim().length >= 2)) return false;
  if (mostly(rows, index, isSheetUuid)) return false;
  if (mostly(rows, index, cellIsSaudiMobile)) return false;
  if (mostly(rows, index, isSnapChoiceCell)) return false;
  if (mostly(rows, index, isSnapTimestamp)) return false;
  return true;
}

function findNamePair(headers: string[], rows: string[][], phone: number) {
  const pairs: {first: number; last: number}[] = [];
  for (let index = 0; index < headers.length - 1; index++) {
    const folded = foldHeader(headers[index] || '');
    if (!/^(الاسم|اسم|name|full name)$/.test(folded)) continue;
    if (normalizeHeaderCell(headers[index + 1] || '') !== '') continue;
    if (mostly(rows, index, isSheetUuid) || mostly(rows, index, cellIsSaudiMobile)) continue;
    pairs.push({first: index, last: index + 1});
  }
  if (pairs.length) {
    const beforePhone = phone >= 0 ? pairs.filter(pair => pair.first < phone) : pairs;
    const list = beforePhone.length ? beforePhone : pairs;
    return list[list.length - 1];
  }
  if (phone >= 2 && looksLikeNameColumn(rows, phone - 2) && looksLikeNameColumn(rows, phone - 1)) {
    return {first: phone - 2, last: phone - 1};
  }
  if (phone >= 1 && looksLikeNameColumn(rows, phone - 1)) return {first: phone - 1, last: -1};
  return null;
}

function metaIndexes(row: string[], createdAt: number) {
  const pairs: number[] = [];
  let index = 0;
  while (index < createdAt) {
    const cell = String(row[index] ?? '').trim();
    const next = String(row[index + 1] ?? '').trim();
    const nextInRange = index + 1 < createdAt;
    if (isSheetUuid(cell) && nextInRange && next && !isSheetUuid(next) && !isSnapTimestamp(next)) {
      pairs.push(index + 1);
      index += 2;
      continue;
    }
    index += 1;
  }
  const named = pairs.slice(-4);
  const roles = ['formNameIndex', 'campaignIndex', 'adNameIndex', 'adSetIndex'] as const;
  const result = {formNameIndex: -1, campaignIndex: -1, adNameIndex: -1, adSetIndex: -1};
  const offset = roles.length - named.length;
  named.forEach((nameIndex, position) => {
    result[roles[offset + position]] = nameIndex;
  });
  return result;
}

function answerColumns(headers: string[], rows: string[][], createdAt: number, nameFirst: number, nameLast: number, phone: number) {
  const width = widthOf(headers, rows);
  const found = new Map<string, SnapAnswerColumn>();
  for (let index = createdAt + 1; index < width; index++) {
    if (index === phone || index === nameFirst || index === nameLast) continue;
    const folded = foldHeader(headers[index] || '');
    const spec = ANSWER_FIELDS.find(item => folded && item.test(folded));
    const choice = mostly(rows, index, isSnapChoiceCell);
    if (!spec && !choice) continue;
    const field = spec?.field || 'other';
    const label = spec?.label || normalizeHeaderCell(headers[index] || '') || 'إجابة';
    const column = {index, label, field};
    const key = field === 'other' ? `other-${index}` : field;
    const previous = found.get(key);
    if (previous && field !== 'other') {
      const previousChoice = mostly(rows, previous.index, isSnapChoiceCell);
      if (choice && !previousChoice) found.set(key, column);
      continue;
    }
    found.set(key, column);
  }
  return [...found.values()].sort((left, right) => left.index - right.index);
}

function looksLikeSnap(rows: string[][], width: number) {
  if (!rows.length) return false;
  if (saudiPhoneColumn(rows, width) < 0) return false;
  if (timestampColumn(rows, width) < 0) return false;
  let braces = 0;
  let uuids = 0;
  for (let index = 0; index < width; index++) {
    if (mostly(rows, index, isSnapChoiceCell)) braces += 1;
    if (mostly(rows, index, isSheetUuid)) uuids += 1;
  }
  return braces >= 1 && uuids >= 2;
}

/**
 * TikTok rows keep `saved`. A Snap lead-gen row (UUIDs, `{value:true}` answers,
 * a UTC timestamp, and a Saudi mobile) is remapped from the cell contents.
 * The phone column is the one whose values normalize to `05XXXXXXXX`.
 */
export function planSheetImport(headers: string[], rows: string[][], saved: SheetMapping): SheetImportPlan {
  const data = dataRows(rows);
  const width = widthOf(headers, data);
  if (!looksLikeSnap(data, width)) return emptyPlan(saved);
  const phone = saudiPhoneColumn(data, width);
  const createdAt = timestampColumn(data, width);
  const leadId = createdAt > 0 && mostly(data, createdAt - 1, isSheetUuid) ? createdAt - 1 : -1;
  const suggested = suggestSheetMapping(headers);
  const mapping: SheetMapping = {...saved};
  if (phone >= 0 && (mapping.phone === undefined || !mostly(data, mapping.phone, cellIsSaudiMobile))) mapping.phone = phone;
  const pair = findNamePair(headers, data, phone);
  if (pair && (mapping.name === undefined || mostly(data, mapping.name, isSheetUuid) || mapping.name === phone)) {
    mapping.name = pair.first;
  }
  if (leadId >= 0) mapping.leadId = leadId;
  (Object.keys(suggested) as SheetField[]).forEach(key => {
    if (key === 'name' || key === 'phone' || key === 'leadId') return;
    const current = mapping[key];
    if (current !== undefined && mostly(data, current, isSheetUuid)) delete mapping[key];
    const next = suggested[key];
    if (mapping[key] === undefined && next !== undefined && !mostly(data, next, isSheetUuid)) mapping[key] = next;
  });
  const sample = data.find(row => createdAt >= 0 && isSnapTimestamp(String(row[createdAt] ?? ''))) || data[0] || [];
  const meta = createdAt >= 0 ? metaIndexes(sample, createdAt) : {formNameIndex: -1, campaignIndex: -1, adNameIndex: -1, adSetIndex: -1};
  const answers = answerColumns(headers, data, createdAt, pair?.first ?? -1, pair?.last ?? -1, phone);
  const used = new Set<number>([
    phone,
    pair?.first ?? -1,
    pair?.last ?? -1,
    leadId,
    createdAt,
    meta.formNameIndex,
    meta.campaignIndex,
    meta.adNameIndex,
    meta.adSetIndex,
    ...answers.map(answer => answer.index),
  ]);
  const extraIndexes: number[] = [];
  for (let index = createdAt + 1; index < width; index++) {
    if (used.has(index)) continue;
    const hasText = data.some(row => {
      const value = String(row[index] ?? '').trim();
      return Boolean(value) && !isSheetUuid(value) && !cellIsSaudiMobile(value) && !isSnapTimestamp(value);
    });
    if (hasText) extraIndexes.push(index);
  }
  return {
    snap: true,
    mapping,
    lastNameIndex: pair?.last ?? -1,
    createdAtIndex: createdAt,
    leadIdIndex: leadId,
    ...meta,
    answers,
    extraIndexes,
  };
}

function cleanText(value: string) {
  return parseSnapChoice(value).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

function namePart(value: string) {
  const text = cleanText(value);
  if (!text || isSheetUuid(text) || cellIsSaudiMobile(text) || isSnapTimestamp(text) || isSnapChoiceCell(text)) return '';
  return text;
}

function cellAt(row: string[], index: number) {
  if (index < 0) return '';
  const value = String(row[index] ?? '').trim();
  if (!value || isSheetUuid(value)) return '';
  return cleanText(value);
}

export type ParsedSnapLead = {
  name: string;
  phone: string;
  source: string;
  registeredAt: string;
  riyadhDay: string;
  propertyType: string;
  location: string;
  purchaseMethod: string;
  salary: string;
  residency: string;
  timeline: string;
  formName: string;
  campaign: string;
  adName: string;
  adSet: string;
  leadId: string;
  extra: string;
};

function answerValue(row: string[], answers: SnapAnswerColumn[], field: SnapAnswerField) {
  const column = answers.find(item => item.field === field);
  return column ? cellAt(row, column.index) : '';
}

export function readSnapRow(row: string[], plan: SheetImportPlan): ParsedSnapLead {
  const first = namePart(plan.mapping.name === undefined ? '' : String(row[plan.mapping.name] ?? ''));
  const last = namePart(plan.lastNameIndex >= 0 ? String(row[plan.lastNameIndex] ?? '') : '');
  const name = [first, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const phoneCell = plan.mapping.phone === undefined ? '' : String(row[plan.mapping.phone] ?? '');
  const registeredAt = snapRegisteredAt(plan.createdAtIndex >= 0 ? String(row[plan.createdAtIndex] ?? '') : '');
  const extras = plan.extraIndexes
    .map(index => cellAt(row, index))
    .filter(Boolean);
  const leadId = plan.leadIdIndex >= 0 && isSheetUuid(String(row[plan.leadIdIndex] ?? ''))
    ? String(row[plan.leadIdIndex]).trim()
    : '';
  return {
    name,
    phone: isSheetUuid(phoneCell) ? '' : normalizeLeadPhone(phoneCell),
    source: snapPlatformLabel(),
    registeredAt,
    riyadhDay: registeredAt ? riyadhDayKey(registeredAt) : '',
    propertyType: answerValue(row, plan.answers, 'propertyType'),
    location: answerValue(row, plan.answers, 'location'),
    purchaseMethod: answerValue(row, plan.answers, 'purchase'),
    salary: answerValue(row, plan.answers, 'salary'),
    residency: answerValue(row, plan.answers, 'residency'),
    timeline: answerValue(row, plan.answers, 'timeline'),
    formName: cellAt(row, plan.formNameIndex),
    campaign: cellAt(row, plan.campaignIndex),
    adName: cellAt(row, plan.adNameIndex),
    adSet: cellAt(row, plan.adSetIndex),
    leadId,
    extra: extras.join(' | '),
  };
}

export function snapLeadNotes(lead: ParsedSnapLead) {
  const lines = [
    lead.propertyType ? `نوع العقار: ${lead.propertyType}` : '',
    lead.location ? `موقع العقار: ${lead.location}` : '',
    lead.purchaseMethod ? `طريقة الشراء: ${lead.purchaseMethod}` : '',
    lead.salary ? `الراتب: ${lead.salary}` : '',
    lead.residency ? `مواطن ام مقيم: ${lead.residency}` : '',
    lead.timeline ? `الفترة المتوقعه للشراء: ${lead.timeline}` : '',
    lead.formName ? `النموذج: ${lead.formName}` : '',
    lead.campaign ? `الحملة: ${lead.campaign}` : '',
    lead.adName ? `الإعلان: ${lead.adName}` : '',
    lead.adSet ? `المجموعة الإعلانية: ${lead.adSet}` : '',
    lead.leadId ? `معرف سناب: ${lead.leadId}` : '',
    lead.extra ? `حقل إضافي: ${lead.extra}` : '',
  ].filter(Boolean);
  return lines.join('\n').slice(0, 3000);
}

export function composeSnapLead(
  row: string[],
  plan: SheetImportPlan
): SheetLeadDraft {
  const lead = readSnapRow(row, plan);
  const property = lead.propertyType.slice(0, 500);
  return {
    name: lead.name.slice(0, 100),
    phone: lead.phone,
    propertyOther: property.length >= 2 ? property : 'غير محدد',
    source: lead.source.slice(0, 80),
    notes: snapLeadNotes(lead),
    campaign: lead.campaign.slice(0, 60),
    stage: 'new',
    registeredAt: lead.registeredAt,
  };
}

export function composePlannedLead(
  row: string[],
  source: {label: string; campaign: string},
  plan: SheetImportPlan
): SheetLeadDraft {
  if (!plan.snap) return composeSheetLead(row, source, plan.mapping);
  return composeSnapLead(row, plan);
}

/** Dry-run of one grid. Null when the rows are not a Snap lead-gen sheet. */
export function parseSnapLeads(grid: string[][]): ParsedSnapLead[] | null {
  const headers = (grid[0] || []).map(cell => String(cell ?? ''));
  const rows = grid.slice(1).map(row => (row || []).map(cell => String(cell ?? '')));
  const plan = planSheetImport(headers, rows, suggestSheetMapping(headers));
  if (!plan.snap) return null;
  return dataRows(rows).map(row => readSnapRow(row, plan));
}
