import {z} from 'zod';
// Labels preserve the agreed workbook fields. Values are decimal strings, not floating-point money.
// Hidden keys stay in the payload so older rows round-trip. They are not inputs.
export const transactionFields = [
 ['contractDate','تاريخ عقد الوساطة','date'],
 ['fundingEntity','جهة التمويل','text'],
 ['notes','الملاحظات','text'],
 ['propertyValue','قيمة العقار','money'],
 ['district','حي العقار','text'],
 ['financeEmployeeId','موظف التمويل','employee'],
 ['companyDeposit','عربون محول من العميل','money'],
 ['companyValuation','رسوم تقييم من الشركة','money'],
 ['totalPayments','اجمالي المدفوعات — يدوي','money'],
 ['brokerageCheque','تحصيل شيك سعي','money'],
 ['ownerCollection','تحصيل من المالك','money'],
 ['clientCollection','تحصيل من العميل','money'],
 ['totalCollections','إجمالي المتحصلات — يدوي','money'],
 ['tax','ضريبة — إدخال يدوي','money'],
 ['netCommission','صافي العمولة لساس الثراء — يدوي','signedMoney'],
 ['financeNotes','ملاحظات المالية','text'],
 ['brokerName','اسم الوسيط العقاري','text'],
 ['brokerCommission','عمولة الوسيط','money'],
 ['externalExpenses','المصروفات الخارجية','money'],
 ['externalExpensesDescription','بيان المصروفات الخارجية','text'],
 ['debtPayoffAmount','المبلغ المراد سداده','money'],
 ['debtAccountNumber','رقم الحساب','text'],
 ['debtPayoffDate','التاريخ','date'],
 ['debtPaymentRef','رقم السداد','text'],
 ['refund','استرداد دفعة','money'],
 ['otherRefund','استرداد مبالغ أخرى','money'],
 ['otherRefundNote','بيان استرداد المبالغ الأخرى','text'],
 ['linkedPropertyId','العقار المرتبط','text'],
 ['ownerCommission','العمولة من المالك','money'],
 ['clientCommission','العمولة من العميل','money'],
 ['brokerage','ملاحظة عمولة سابقة','text'],
 ['clientSerial','مسلسل العميل','text'],
 ['requestStage','مرحلة الطلب','text'],
 ['fundingAmount','مبلغ التمويل','money'],
 ['companyPayments','دفعات من الشركة','money'],
 ['debtSettlement','سداد مديونية','money'],
 ['totalDue','إجمالي المستحق علي العميل — يدوي','money'],
 ['balance','الرصيد — يدوي','signedMoney'],
 ['buyerDeposit','عربون محول من المشتري','money'],
].map(([key,label,type])=>({key,label,type}));

/** Inputs removed from the form. Stored values stay on the row and in JSON. */
export const hiddenTransactionKeys = new Set([
  'clientSerial','requestStage','fundingAmount','companyPayments','debtSettlement','totalDue','balance','buyerDeposit',
]);

/** Rendered by a dedicated control, not the generic field loop. */
export const specialTransactionKeys = new Set([
  'ownerCommission','clientCommission','brokerage','linkedPropertyId',
  'debtPayoffAmount','debtAccountNumber','debtPayoffDate','debtPaymentRef',
  'refund','otherRefund','otherRefundNote',
]);

export const debtPayerLabels = {unset:'لم يحدد', company:'الشركة', client:'العميل بنفسه'} as const;
export const reviewStatusLabels = {
  pending:'بانتظار اعتماد الحسابات',
  approved:'معتمدة',
  rejected:'مرفوضة',
} as const;
export type ReviewStatus = keyof typeof reviewStatusLabels;

const money = z.string().regex(/^$|^\d{1,12}(\.\d{1,2})?$/).default('');
const signedMoney = z.string().regex(/^$|^-?\d{1,12}(\.\d{1,2})?$/).default('');
const date = z.string().refine(v=>v==='' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v)).default('');
const fields:Record<string,z.ZodTypeAny> = {};
for(const f of transactionFields) fields[f.key] = f.type === 'money' ? money : f.type === 'signedMoney' ? signedMoney : f.type === 'date' ? date : f.type === 'employee' ? z.union([z.string().uuid(),z.literal('')]).default('') : z.string().trim().max(3000).default('');
fields.clientSerial = z.string().trim().max(40).default('');
fields.debtAccountNumber = z.string().trim().max(80).default('');
fields.debtPaymentRef = z.string().trim().max(80).default('');
fields.otherRefundNote = z.string().trim().max(1000).default('');
fields.linkedPropertyId = z.string().trim().max(64).default('');
export const transactionSchema: z.ZodType<TransactionInput,z.ZodTypeDef,unknown> = z.object({ ...fields, leadId:z.string().uuid(), debtPayer:z.enum(['company','client','unset']).default('unset') }).strict();
export type TransactionInput = Record<string,string> & {leadId:string;debtPayer:'company'|'client'|'unset'};

export function blankTransaction(leadId = ''): TransactionInput {
  const form = {leadId, debtPayer:'unset' as const} as TransactionInput;
  for (const field of transactionFields) form[field.key] = '';
  return form;
}

export function transactionFromRecord(data: Partial<TransactionInput> | null | undefined): TransactionInput {
  const form = blankTransaction(typeof data?.leadId === 'string' ? data.leadId : '');
  if (!data) return form;
  for (const field of transactionFields) {
    if (data[field.key] != null) form[field.key] = String(data[field.key]);
  }
  if (data.debtPayer === 'company' || data.debtPayer === 'client' || data.debtPayer === 'unset') form.debtPayer = data.debtPayer;
  return form;
}

export function numericMoney(value:unknown):string|null {
 const text=String(value??'').trim();
 return /^\d{1,12}(\.\d{1,2})?$/.test(text)?text:null;
}
function moneyCents(value:string):bigint {
 const [whole,fraction='']=value.split('.');
 return BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));
}
export function formatMoneyCents(cents:bigint):string {
 const negative=cents<BigInt(0);
 const absolute=negative?-cents:cents;
 return `${negative?'-':''}${absolute/BigInt(100)}.${String(absolute%BigInt(100)).padStart(2,'0')}`;
}
/** Owner + client commission. Empty sides count as zero. Both empty is 0.00. A legacy note is never added. */
export function commissionTotal(owner:unknown, client:unknown):string {
 const left=numericMoney(owner);
 const right=numericMoney(client);
 return formatMoneyCents((left?moneyCents(left):BigInt(0))+(right?moneyCents(right):BigInt(0)));
}
/** New payoff amount, otherwise the legacy settlement amount still stored on old rows. */
export function debtAmount(value: Record<string, unknown>): string | null {
 return numericMoney(value.debtPayoffAmount) || numericMoney(value.debtSettlement);
}
export function confirmedDue(value:TransactionInput):string|null {
 const brokerage=numericMoney(value.brokerage);
 const debt=debtAmount(value);
 if(value.debtPayer==='unset' || !brokerage || (value.debtPayer==='company' && !debt)) return null;
 const due=moneyCents(brokerage)+(value.debtPayer==='company'?moneyCents(debt!):BigInt(0));
 return formatMoneyCents(due);
}

/** Next numeric client serial. Non-numeric legacy values are kept and do not reset the sequence. */
export function nextClientSerial(values: readonly unknown[]): string {
  let max = 0;
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!/^\d{1,12}$/.test(text)) continue;
    const parsed = Number(text);
    if (parsed > max) max = parsed;
  }
  return String(max + 1);
}

export function canEditTransactions(role: string) {
  return role === 'admin' || role === 'accounts' || role === 'sales';
}

export function canReviewTransactions(role: string) {
  return role === 'admin' || role === 'accounts';
}
