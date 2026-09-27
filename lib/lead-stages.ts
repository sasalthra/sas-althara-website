/**
 * Lead pipeline shown in CRM dropdowns, filters, import, and reports.
 * Order is the working pipeline, then pause/exit stages.
 * Retired keys stay valid in MySQL only so old rows can be moved;
 * they are never offered, and saving one is rejected.
 */

const activeStageEntries = [
  ['new', 'عميل جديد'],
  ['no_answer', 'لم يتم الرد'],
  ['contacted', 'تم التواصل'],
  ['awaiting_offers', 'بانتظار العروض'],
  ['field_dispatch', 'تفويج للميداني'],
  ['property_visited', 'تم زيارة العقار'],
  ['negotiation', 'تفاوض'],
  ['bank_referred', 'تمت إحالة معاملة العميل للبنك'],
  ['deposit_paid', 'دفع عربون'],
  ['contract_signed', 'وقع عقد'],
  ['transferred', 'إفراغ'],
  ['postponed', 'تم تأجيل الطلب - للمتابعة'],
  ['unqualified', 'غير مؤهل'],
  ['not_interested', 'غير مهتم'],
  ['closed', 'مغلق'],
] as const;

/** Arabic labels for stages staff can assign. Retired keys are omitted. */
export const stageLabels: Record<string, string> = Object.fromEntries(activeStageEntries);

/**
 * Every stage value the MySQL ENUM must accept.
 * Includes retired keys so an ALTER never drops a stored value.
 * `properties_shown` was never a selectable label; it exists so a stored
 * «تم عرض العقارات» key can be moved to بانتظار العروض.
 */
export const stageEnumValues = [
  'new',
  'no_answer',
  'contacted',
  'calculation_done',
  'awaiting_offers',
  'field_dispatch',
  'property_visited',
  'bank_referred',
  'bank_approval',
  'deposit_paid',
  'contract_signed',
  'transferred',
  'postponed',
  'unqualified',
  'not_interested',
  'negotiation',
  'closed',
  'received',
  'data_received',
  'visit_qualified',
  'properties_shown',
  'viewing',
  'won',
] as const;

/** Stored value -> the stage that replaces it in the UI, import, and reports. */
export const retiredStageMap: Record<string, string> = {
  won: 'contract_signed',
  received: 'contacted',
  data_received: 'contacted',
  properties_shown: 'awaiting_offers',
  'تم عرض العقارات': 'awaiting_offers',
  viewing: 'field_dispatch',
  visit_qualified: 'field_dispatch',
  calculation_done: 'contacted',
  'تم عمل حسبة للعميل': 'contacted',
  bank_approval: 'bank_referred',
  'مؤهل بانتظار موافقة البنك': 'bank_referred',
};

export const retiredStageMoves: ReadonlyArray<{from: string; to: string; note: string}> = [
  {from: 'won', to: 'contract_signed', note: 'تم اعتماد مرحلة وقع عقد'},
  {from: 'received', to: 'contacted', note: 'تم اعتماد مرحلة تم التواصل'},
  {from: 'data_received', to: 'contacted', note: 'تم اعتماد مرحلة تم التواصل'},
  {from: 'properties_shown', to: 'awaiting_offers', note: 'تم اعتماد مرحلة بانتظار العروض'},
  {from: 'تم عرض العقارات', to: 'awaiting_offers', note: 'تم اعتماد مرحلة بانتظار العروض'},
  {from: 'viewing', to: 'field_dispatch', note: 'تم اعتماد مرحلة تفويج للميداني'},
  {from: 'visit_qualified', to: 'field_dispatch', note: 'تم اعتماد مرحلة تفويج للميداني'},
  {from: 'calculation_done', to: 'contacted', note: 'تم اعتماد مرحلة تم التواصل'},
  {from: 'تم عمل حسبة للعميل', to: 'contacted', note: 'تم اعتماد مرحلة تم التواصل'},
  {from: 'bank_approval', to: 'bank_referred', note: 'تم اعتماد مرحلة تمت إحالة معاملة العميل للبنك'},
  {from: 'مؤهل بانتظار موافقة البنك', to: 'bank_referred', note: 'تم اعتماد مرحلة تمت إحالة معاملة العميل للبنك'},
];

/** Stages staff can assign. Retired values, including `won`, are never choices. */
export function stageChoices(_current?: string | null): Array<[string, string]> {
  return activeStageEntries.map(([key, label]) => [key, label]);
}

/** A leftover retired value is edited and saved as its replacement. */
export function displayStage(stage?: string | null): string {
  if (!stage) return '';
  return retiredStageMap[stage] || stage;
}

export function editableStage(stage?: string | null): string {
  return displayStage(stage) || 'new';
}

/** Retired and unknown stages cannot be stored again. */
export function stageWriteAllowed(next: string, _current?: string | null): boolean {
  return Object.prototype.hasOwnProperty.call(stageLabels, next);
}

/**
 * Extra Excel/CRM spellings mapped onto current keys only.
 * Removed-stage spellings map to the replacement key.
 * Unknown values must never become a new stage.
 */
export const stageAliasGroups: Record<string, string[]> = {
  new: ['جديد', 'عميل جديد', 'new', 'new lead', 'lead', 'fresh'],
  no_answer: ['لم يتم الرد', 'لم يرد', 'لا يرد', 'ما يرد', 'no answer', 'no_answer', 'no-answer'],
  contacted: [
    'تم التواصل', 'تواصل', 'تم الاتصال', 'اتصال', 'contacted', 'contact',
    'تم استلام العميل', 'استلام العميل', 'مستلم', 'استلام', 'received',
    'تم استلام بيانات العميل', 'استلام بيانات', 'بيانات مستلمة', 'data received', 'data_received',
    'تم عمل حسبة للعميل', 'تم عمل حسبة', 'حسبة', 'حسبه', 'حسابه', 'calculation', 'calculation_done',
  ],
  awaiting_offers: [
    'بانتظار العروض', 'بنتظار العروض', 'في انتظار العروض', 'انتظار العروض', 'انتظار العرض',
    'تم عرض العقارات', 'عرض العقارات', 'تم عرض العقار', 'عرض العقار',
    'awaiting offers', 'awaiting_offers', 'pending offers', 'properties shown', 'properties_shown',
  ],
  field_dispatch: [
    'تفويج للميداني', 'تفويج للميدان', 'تفويج ميداني', 'تفويج', 'ارسال للميداني', 'إرسال للميداني',
    'field dispatch', 'field_dispatch',
    'معاينة', 'تم المعاينة', 'viewing', 'view',
    'مؤهل زيارة', 'مؤهل زيارة العقار', 'مؤهل للزيارة', 'visit qualified', 'visit_qualified',
  ],
  property_visited: ['تم زيارة العقار', 'زيارة العقار', 'زار العقار', 'property visited'],
  bank_referred: [
    'تمت إحالة معاملة العميل للبنك', 'إحالة معاملة العميل للبنك', 'احالة معاملة العميل للبنك',
    'إحالة للبنك', 'احالة للبنك', 'تمت الاحالة للبنك', 'تحويل للبنك',
    'bank referral', 'bank_referred', 'referred to bank',
    'مؤهل بانتظار موافقة البنك', 'موافقة البنك', 'انتظار البنك', 'بانتظار موافقة البنك', 'bank approval', 'bank_approval',
  ],
  deposit_paid: ['دفع عربون', 'عربون', 'تم دفع العربون', 'deposit'],
  contract_signed: ['وقع عقد', 'توقيع عقد', 'تم توقيع العقد', 'عقد موقع', 'signed', 'مكسب', 'رابح', 'تم البيع', 'مباع', 'won', 'sold'],
  transferred: ['إفراغ', 'افراغ', 'تم الافراغ', 'transferred'],
  postponed: [
    'تم تأجيل الطلب - للمتابعة', 'تم تأجيل الطلب للمتابعة', 'تم تأجيل الطلب', 'تأجيل الطلب',
    'مؤجل', 'تأجيل', 'تاجيل', 'اعادة تواصل', 'إعادة تواصل', 'اعادة التواصل', 'إعادة التواصل',
    'postponed', 'on hold',
  ],
  unqualified: ['غير مؤهل', 'غير مؤهلين', 'unqualified'],
  not_interested: ['غير مهتم', 'غير مهتمين', 'لا يرغب', 'not interested'],
  negotiation: ['تفاوض', 'قيد التفاوض', 'مفاوضات', 'negotiation'],
  closed: ['مغلق', 'اغلاق', 'إغلاق', 'منتهي', 'closed'],
};

export function stageLabel(stage: string): string {
  const key = retiredStageMap[stage] || stage;
  return stageLabels[key] || stage || 'غير محدد';
}

/**
 * Lead-stage filter values, including leftovers that display as `input`.
 * «معاينة» matches تفويج للميداني and any row still stored as viewing.
 */
export function stageMatchKeys(input: string): string[] {
  const text = input.trim();
  if (!text) return [];
  const canonical = canonicalStage(text);
  const target = displayStage(canonical || text) || text;
  const keys = new Set<string>();
  if (target) keys.add(target);
  for (const [from, to] of Object.entries(retiredStageMap)) {
    if (to === target) keys.add(from);
  }
  return [...keys];
}

export function foldStageText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0640\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[_./\\,;|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const stageLookup: Record<string, string> = {};
for (const key of Object.keys(stageAliasGroups)) {
  stageLookup[foldStageText(key)] = key;
  stageLookup[foldStageText(key.replace(/_/g, ' '))] = key;
  const label = stageLabels[key];
  if (label) stageLookup[foldStageText(label)] = key;
  for (const alias of stageAliasGroups[key] || []) stageLookup[foldStageText(alias)] = key;
}

/** Pipeline position for dropdowns, filters, and reports. Unknown values sort last. */
export function stagePipelineIndex(value: string): number {
  const text = value.trim();
  if (!text) return activeStageEntries.length + 1;
  const direct = activeStageEntries.findIndex(([key, label]) => key === text || label === text);
  if (direct >= 0) return direct;
  const key = displayStage(canonicalStage(text) || text);
  const mapped = activeStageEntries.findIndex(([stageKey]) => stageKey === key);
  return mapped >= 0 ? mapped : activeStageEntries.length + 1;
}

/** Map a spreadsheet cell onto a current stage key, or null if unknown. Never invents keys. */
export function canonicalStage(value: string): string | null {
  let text = foldStageText(value);
  if (!text) return null;
  text = text.replace(/^(مرحله|حاله العميل|حاله|status|stage)\s*[:\-=–]?\s*/, '');
  if (!text) return null;
  const key = stageLookup[text] || null;
  if (!key) return null;
  return stageWriteAllowed(key) ? key : displayStage(key) || null;
}
