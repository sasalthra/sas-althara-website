import {z} from 'zod';
// Labels preserve the agreed workbook fields. Values are decimal strings, not floating-point money.
export const transactionFields = [
 ['clientSerial','مسلسل العميل','text'],['contractDate','تاريخ العقد','date'],['fundingEntity','جهة التمويل','text'],['requestStage','مرحلة الطلب','text'],['notes','الملاحظات','text'],['fundingAmount','مبلغ التمويل','money'],['propertyValue','قيمة العقار','money'],['brokerage','عموله','money'],['tax','ضريبة — إدخال يدوي','money'],['district','حي العقار','text'],['financeEmployeeId','موظف التمويل','employee'],['companyDeposit','عربون محول من الشركة','money'],['companyValuation','رسوم تقييم من الشركة','money'],['companyPayments','دفعات من الشركة','money'],['debtSettlement','سداد مديونية','money'],['totalPayments','اجمالي المدفوعات — يدوي','money'],['totalDue','إجمالي المستحق علي العميل — يدوي','money'],['refund','استرداد الدفعة','money'],['brokerageCheque','تحصيل شيك سعي','money'],['ownerCollection','تحصيل من المالك','money'],['clientCollection','تحصيل من العميل','money'],['totalCollections','إجمالي المتحصلات — يدوي','money'],['balance','الرصيد — يدوي','signedMoney'],['financeNotes','ملاحظات المالية','text'],['brokerName','اسم الوسيط العقاري','text'],['brokerCommission','عمولة الوسيط','money'],['externalExpenses','المصروفات الخارجية','money'],['externalExpensesDescription','بيان المصروفات الخارجية','text'],['buyerDeposit','عربون محول من المشتري','money'],['netCommission','صافي العمولة لساس الثراء — يدوي','signedMoney']
].map(([key,label,type])=>({key,label,type}));
const money = z.string().regex(/^$|^\d{1,12}(\.\d{1,2})?$/).default('');
const signedMoney = z.string().regex(/^$|^-?\d{1,12}(\.\d{1,2})?$/).default('');
const date = z.string().refine(v=>v==='' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v)).default('');
const fields:Record<string,z.ZodTypeAny> = {};
for(const f of transactionFields) fields[f.key] = f.type === 'money' ? money : f.type === 'signedMoney' ? signedMoney : f.type === 'date' ? date : f.type === 'employee' ? z.union([z.string().uuid(),z.literal('')]).default('') : z.string().trim().max(3000).default('');
export const transactionSchema: z.ZodType<TransactionInput,z.ZodTypeDef,unknown> = z.object({ ...fields, leadId:z.string().uuid(), debtPayer:z.enum(['company','client','unset']).default('unset') }).strict();
export type TransactionInput = Record<string,string> & {leadId:string;debtPayer:'company'|'client'|'unset'};
export function confirmedDue(value:TransactionInput):string|null {
 if(value.debtPayer==='unset' || !value.brokerage || (value.debtPayer==='company' && !value.debtSettlement)) return null;
 const cents=(v:string)=>{const [a,b='']=v.split('.'); return BigInt(a)*BigInt(100)+BigInt(b.padEnd(2,'0'));};
 const due=cents(value.brokerage)+(value.debtPayer==='company'?cents(value.debtSettlement):BigInt(0));
 return `${due/BigInt(100)}.${String(due%BigInt(100)).padStart(2,'0')}`;
}
