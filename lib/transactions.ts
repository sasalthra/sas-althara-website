import {z} from 'zod';
// Labels preserve the agreed workbook fields. Values are decimal strings, not floating-point money.
export const transactionFields = [
 ['clientSerial','مسلسل العميل','text'],['contractDate','تاريخ العقد','date'],['fundingEntity','جهة التمويل','text'],['requestStage','مرحلة الطلب','text'],['notes','الملاحظات','text'],['fundingAmount','مبلغ التمويل','money'],['propertyValue','قيمة العقار','money'],['ownerCommission','العمولة من المالك','money'],['clientCommission','العمولة من العميل','money'],['brokerage','ملاحظة عمولة سابقة','text'],['tax','ضريبة — إدخال يدوي','money'],['district','حي العقار','text'],['financeEmployeeId','موظف التمويل','employee'],['companyDeposit','عربون محول من الشركة','money'],['companyValuation','رسوم تقييم من الشركة','money'],['companyPayments','دفعات من الشركة','money'],['debtSettlement','سداد مديونية','money'],['totalPayments','اجمالي المدفوعات — يدوي','money'],['totalDue','إجمالي المستحق علي العميل — يدوي','money'],['refund','استرداد الدفعة','money'],['brokerageCheque','تحصيل شيك سعي','money'],['ownerCollection','تحصيل من المالك','money'],['clientCollection','تحصيل من العميل','money'],['totalCollections','إجمالي المتحصلات — يدوي','money'],['balance','الرصيد — يدوي','signedMoney'],['financeNotes','ملاحظات المالية','text'],['brokerName','اسم الوسيط العقاري','text'],['brokerCommission','عمولة الوسيط','money'],['externalExpenses','المصروفات الخارجية','money'],['externalExpensesDescription','بيان المصروفات الخارجية','text'],['buyerDeposit','عربون محول من المشتري','money'],['netCommission','صافي العمولة لساس الثراء — يدوي','signedMoney']
].map(([key,label,type])=>({key,label,type}));
const money = z.string().regex(/^$|^\d{1,12}(\.\d{1,2})?$/).default('');
const signedMoney = z.string().regex(/^$|^-?\d{1,12}(\.\d{1,2})?$/).default('');
const date = z.string().refine(v=>v==='' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v)).default('');
const fields:Record<string,z.ZodTypeAny> = {};
for(const f of transactionFields) fields[f.key] = f.type === 'money' ? money : f.type === 'signedMoney' ? signedMoney : f.type === 'date' ? date : f.type === 'employee' ? z.union([z.string().uuid(),z.literal('')]).default('') : z.string().trim().max(3000).default('');
export const transactionSchema: z.ZodType<TransactionInput,z.ZodTypeDef,unknown> = z.object({ ...fields, leadId:z.string().uuid(), debtPayer:z.enum(['company','client','unset']).default('unset') }).strict();
export type TransactionInput = Record<string,string> & {leadId:string;debtPayer:'company'|'client'|'unset'};
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
export function confirmedDue(value:TransactionInput):string|null {
 const brokerage=numericMoney(value.brokerage);
 if(value.debtPayer==='unset' || !brokerage || (value.debtPayer==='company' && !numericMoney(value.debtSettlement))) return null;
 const due=moneyCents(brokerage)+(value.debtPayer==='company'?moneyCents(numericMoney(value.debtSettlement)!):BigInt(0));
 return formatMoneyCents(due);
}
