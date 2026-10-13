import {z} from 'zod';
import {crmDb,crmTransaction} from '@/lib/crm-db';
import {actor,body,endpoint,reply,ApiError} from '@/lib/secure-api';
import {binEq,binJoin} from '@/lib/sql-collation';
import {
  canEditTransactions,
  canReviewTransactions,
  confirmedDue,
  nextClientSerial,
  transactionSchema,
  type ReviewStatus,
  type TransactionInput,
} from '@/lib/transactions';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const editors=['admin','accounts','sales'] as const;
const schema=z.object({
  id:z.string().uuid(),
  version:z.number().int().min(0),
  confirmed:z.literal(true),
  decision:z.enum(['approved','rejected']).optional(),
  data:transactionSchema,
}).strict();

type Sql = ReturnType<typeof crmDb>;
type Row = Record<string, unknown>;

function parsedData(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? {...value as Record<string, unknown>} : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function missingColumn(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /unknown column|no such column|ER_BAD_FIELD_ERROR/i.test(message);
}

async function serials(db: Sql, skipId: string) {
  const values: unknown[] = [];
  const rows = await db.prepare('SELECT id, data FROM crm_transactions').all();
  for (const row of rows.results) {
    if (text(row.id) === skipId) continue;
    const data = parsedData(row.data);
    values.push(data.clientSerial);
  }
  try {
    const columns = await db.prepare('SELECT id, client_serial FROM crm_transactions').all();
    for (const row of columns.results) {
      if (text(row.id) === skipId) continue;
      values.push(row.client_serial);
    }
  } catch (error) {
    if (!missingColumn(error)) throw error;
  }
  return values;
}

async function existingRow(db: Sql, id: string): Promise<Row | null> {
  try {
    return await db.prepare('SELECT id, data, client_serial, review_status, reviewed_by, reviewed_at, version FROM crm_transactions WHERE id=?').bind(id).first<Row>();
  } catch (error) {
    if (!missingColumn(error)) throw error;
    return await db.prepare('SELECT id, data, version FROM crm_transactions WHERE id=?').bind(id).first<Row>();
  }
}

async function writeColumns(db: Sql, id: string, data: TransactionInput, reviewStatus: ReviewStatus, reviewedBy: string, reviewedAt: string) {
  const values = [
    data.ownerCommission || null,
    data.clientCommission || null,
    data.clientSerial || null,
    reviewStatus,
    reviewedBy || null,
    reviewedAt || null,
    data.debtPayoffAmount || null,
    data.debtAccountNumber || null,
    data.debtPayoffDate || null,
    data.debtPaymentRef || null,
    data.otherRefund || null,
    data.otherRefundNote || null,
    data.linkedPropertyId || null,
    id,
  ];
  try {
    await db.prepare(`UPDATE crm_transactions SET owner_commission=?, client_commission=?, client_serial=?, review_status=?, reviewed_by=?, reviewed_at=?, debt_payoff_amount=?, debt_account_number=?, debt_payoff_date=?, debt_payment_ref=?, other_refund=?, other_refund_note=?, linked_property_id=? WHERE id=?`).bind(...values).run();
  } catch (error) {
    if (!missingColumn(error)) throw error;
    try {
      await db.prepare('UPDATE crm_transactions SET owner_commission=?, client_commission=? WHERE id=?').bind(data.ownerCommission || null, data.clientCommission || null, id).run();
    } catch (fallback) {
      if (!missingColumn(fallback)) throw fallback;
    }
  }
}

function present(row: Row) {
  const data = parsedData(row.data);
  if (!data.ownerCommission && row.owner_commission) data.ownerCommission = String(row.owner_commission);
  if (!data.clientCommission && row.client_commission) data.clientCommission = String(row.client_commission);
  if (!data.clientSerial && row.client_serial) data.clientSerial = String(row.client_serial);
  if (!data.debtPayoffAmount && row.debt_payoff_amount) data.debtPayoffAmount = String(row.debt_payoff_amount);
  if (!data.debtAccountNumber && row.debt_account_number) data.debtAccountNumber = String(row.debt_account_number);
  if (!data.debtPayoffDate && row.debt_payoff_date) data.debtPayoffDate = String(row.debt_payoff_date);
  if (!data.debtPaymentRef && row.debt_payment_ref) data.debtPaymentRef = String(row.debt_payment_ref);
  if (!data.otherRefund && row.other_refund) data.otherRefund = String(row.other_refund);
  if (!data.otherRefundNote && row.other_refund_note) data.otherRefundNote = String(row.other_refund_note);
  if (!data.linkedPropertyId && row.linked_property_id) data.linkedPropertyId = String(row.linked_property_id);
  const reviewStatus = text(row.review_status || data.reviewStatus) || 'pending';
  return {
    ...row,
    data,
    review_status: reviewStatus,
    reviewed_by: text(row.reviewed_by || data.reviewedBy),
    reviewed_by_name: text(data.reviewedByName),
    reviewed_at: text(row.reviewed_at || data.reviewedAt),
  };
}

export async function GET(req: Request){return endpoint(async()=>{
 const user = await actor(undefined, [...editors]);
 const leadId = new URL(req.url).searchParams.get('leadId') || '';
 if (leadId && !z.string().uuid().safeParse(leadId).success) throw new ApiError(400, 'العميل غير صالح');
 const scope: string[] = [];
 const args: string[] = [];
 if (user.role === 'sales') {
  scope.push(`(${binEq('l.assigned_to')} OR ${binEq('l.created_by')} OR ${binEq('l.owner')})`);
  args.push(user.userId, user.userId, user.userId);
 }
 if (leadId) {
  scope.push(binEq('t.lead_id'));
  args.push(leadId);
 }
 const where = scope.length ? ` WHERE ${scope.join(' AND ')}` : '';
 const rows = await crmDb().prepare(`SELECT t.*, l.name AS client_name, l.source, l.property_id, l.property_other, s.name AS sales_name, f.name AS field_name FROM crm_transactions t JOIN leads l ON ${binJoin('l.id','t.lead_id')} LEFT JOIN crm_users s ON ${binJoin('s.id','l.assigned_to')} LEFT JOIN crm_users f ON ${binJoin('f.id','l.field_assigned_to')}${where} ORDER BY t.updated_at DESC LIMIT 500`).bind(...args).all();
 return reply({
  rows: rows.results.map(row => present(row)),
  canReview: canReviewTransactions(user.role),
 });
});}

export async function POST(req:Request){return endpoint(async()=>{
 const user=await actor(req,[...editors]);
 if (!canEditTransactions(user.role)) throw new ApiError(403, 'لا تملك الصلاحية');
 const input=schema.parse(await body(req));
 if (input.decision && !canReviewTransactions(user.role)) throw new ApiError(403, 'اعتماد المعاملة لموظف الحسابات أو الإدارة');
 const saved=await crmTransaction(async db=>{
  const lead=await db.prepare('SELECT id, assigned_to, created_by, owner FROM leads WHERE id=?').bind(input.data.leadId).first<Row>();
  if(!lead)throw new ApiError(404,'العميل غير موجود');
  if (user.role === 'sales' && text(lead.assigned_to) !== user.userId && text(lead.created_by) !== user.userId && text(lead.owner) !== user.userId) {
   throw new ApiError(403, 'لا تملك صلاحية معاملة هذا العميل');
  }
  if(input.data.financeEmployeeId){const employee=await db.prepare('SELECT id FROM crm_users WHERE id=? AND active=1').bind(input.data.financeEmployeeId).first();if(!employee)throw new ApiError(400,'موظف التمويل غير صالح');}
  const current = input.version === 0 ? null : await existingRow(db, input.id);
  if (input.version !== 0 && !current) throw new ApiError(409, 'تم تعديل المعاملة؛ أعد تحميلها قبل الحفظ');
  const previous = parsedData(current?.data);
  const keptSerial = text(current?.client_serial || previous.clientSerial);
  const serial = keptSerial || await nextClientSerial(await serials(db, input.id));
  const now=new Date().toISOString();
  let reviewStatus: ReviewStatus = (text(current?.review_status || previous.reviewStatus) || 'pending') as ReviewStatus;
  if (reviewStatus !== 'approved' && reviewStatus !== 'rejected') reviewStatus = 'pending';
  let reviewedBy = text(current?.reviewed_by || previous.reviewedBy);
  let reviewedAt = text(current?.reviewed_at || previous.reviewedAt);
  let reviewedByName = text(previous.reviewedByName);
  if (user.role === 'sales') {
   reviewStatus = 'pending';
   reviewedBy = '';
   reviewedAt = '';
   reviewedByName = '';
  } else if (input.decision) {
   reviewStatus = input.decision;
   reviewedBy = user.userId;
   reviewedAt = now;
   reviewedByName = user.name || user.username || '';
  }
  const data: TransactionInput & {reviewStatus: ReviewStatus; reviewedBy: string; reviewedByName: string; reviewedAt: string} = {
   ...input.data,
   clientSerial: serial,
   reviewStatus,
   reviewedBy,
   reviewedByName,
   reviewedAt,
  };
  const json=JSON.stringify(data), due=confirmedDue(input.data);
  if(input.version===0){await db.prepare('INSERT INTO crm_transactions (id,lead_id,data,confirmed_due,version,updated_at) VALUES (?,?,?,?,1,?)').bind(input.id,input.data.leadId,json,due,now).run();}
  else {const result=await db.prepare('UPDATE crm_transactions SET data=?,confirmed_due=?,version=version+1,updated_at=? WHERE id=? AND lead_id=? AND version=?').bind(json,due,now,input.id,input.data.leadId,input.version).run();if(!result.meta.changes)throw new ApiError(409,'تم تعديل المعاملة؛ أعد تحميلها قبل الحفظ');}
  await writeColumns(db, input.id, data, reviewStatus, reviewedBy, reviewedAt);
  await db.prepare('INSERT INTO crm_audit (id,actor_id,action,target_id,details,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),user.userId,input.decision?`transaction.${input.decision}`:'transaction.saved',input.id,JSON.stringify({version:input.version+1,reviewStatus}),now).run();
  return {reviewStatus, reviewedBy, reviewedByName, reviewedAt, clientSerial: serial};
 });
 return reply({ok:true,id:input.id,version:input.version+1,...saved});
});}
