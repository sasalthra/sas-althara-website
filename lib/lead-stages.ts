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

export function stageLabel(stage: string): string {
  return stageLabels[stage] || stage || 'غير محدد';
}
