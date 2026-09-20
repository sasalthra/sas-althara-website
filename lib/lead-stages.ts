/** Arabic labels for every lead stage key used in forms and reports. */
export const stageLabels: Record<string, string> = {
  new: 'عميل جديد',
  received: 'تم استلام العميل',
  no_answer: 'لم يتم الرد',
  contacted: 'تم التواصل',
  data_received: 'تم استلام بيانات العميل',
  calculation_done: 'تم عمل حسبة للعميل',
  visit_qualified: 'مؤهل زيارة',
  property_visited: 'تم زيارة العقار',
  bank_approval: 'مؤهل بانتظار موافقة البنك',
  deposit_paid: 'دفع عربون',
  contract_signed: 'وقع عقد',
  transferred: 'إفراغ',
  unqualified: 'غير مؤهل',
  not_interested: 'غير مهتم',
  viewing: 'معاينة',
  negotiation: 'تفاوض',
  won: 'مكسب',
  closed: 'مغلق',
};

/**
 * Extra Excel/CRM spellings mapped onto existing keys only.
 * Unknown values must never become a new stage.
 */
export const stageAliasGroups: Record<string, string[]> = {
  new: ['جديد', 'عميل جديد', 'new', 'new lead', 'lead', 'fresh'],
  received: ['تم استلام العميل', 'استلام العميل', 'مستلم', 'استلام', 'received'],
  no_answer: ['لم يتم الرد', 'لم يرد', 'لا يرد', 'ما يرد', 'no answer', 'no_answer', 'no-answer'],
  contacted: ['تم التواصل', 'تواصل', 'تم الاتصال', 'اتصال', 'contacted', 'contact'],
  data_received: ['تم استلام بيانات العميل', 'استلام بيانات', 'بيانات مستلمة', 'data received'],
  calculation_done: ['تم عمل حسبة للعميل', 'تم عمل حسبة', 'حسبة', 'حسبه', 'حسابه', 'calculation'],
  visit_qualified: ['مؤهل زيارة', 'مؤهل للزيارة', 'visit qualified'],
  property_visited: ['تم زيارة العقار', 'زيارة العقار', 'زار العقار', 'property visited'],
  bank_approval: ['مؤهل بانتظار موافقة البنك', 'موافقة البنك', 'انتظار البنك', 'بانتظار موافقة البنك', 'bank approval'],
  deposit_paid: ['دفع عربون', 'عربون', 'تم دفع العربون', 'deposit'],
  contract_signed: ['وقع عقد', 'توقيع عقد', 'تم توقيع العقد', 'عقد موقع', 'signed'],
  transferred: ['إفراغ', 'افراغ', 'تم الافراغ', 'transferred'],
  unqualified: ['غير مؤهل', 'غير مؤهلين', 'unqualified'],
  not_interested: ['غير مهتم', 'غير مهتمين', 'لا يرغب', 'not interested'],
  viewing: ['معاينة', 'تم المعاينة', 'viewing', 'view'],
  negotiation: ['تفاوض', 'قيد التفاوض', 'مفاوضات', 'negotiation'],
  won: ['مكسب', 'رابح', 'تم البيع', 'مباع', 'won', 'sold'],
  closed: ['مغلق', 'اغلاق', 'إغلاق', 'منتهي', 'closed'],
};

export function stageLabel(stage: string): string {
  return stageLabels[stage] || stage || 'غير محدد';
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

/** Map a spreadsheet cell onto an existing stage key, or null if unknown. Never invents keys. */
export function canonicalStage(value: string): string | null {
  let text = foldStageText(value);
  if (!text) return null;
  text = text.replace(/^(مرحله|حاله العميل|حاله|status|stage)\s*[:\-=–]?\s*/, '');
  if (!text) return null;
  return stageLookup[text] || null;
}
