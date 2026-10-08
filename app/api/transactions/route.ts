import {z} from 'zod';
import {crmDb,crmTransaction} from '@/lib/crm-db';
import {actor,body,endpoint,reply,ApiError} from '@/lib/secure-api';
import {transactionSchema,confirmedDue} from '@/lib/transactions';
import {binJoin} from '@/lib/sql-collation';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const schema=z.object({id:z.string().uuid(),version:z.number().int().min(0),confirmed:z.literal(true),data:transactionSchema}).strict();
export async function GET(){return endpoint(async()=>{
 await actor(undefined,['admin']);
 const rows=await crmDb().prepare(`SELECT t.*, l.name AS client_name, l.source, l.property_id, l.property_other, s.name AS sales_name, f.name AS field_name FROM crm_transactions t JOIN leads l ON ${binJoin('l.id','t.lead_id')} LEFT JOIN crm_users s ON ${binJoin('s.id','l.assigned_to')} LEFT JOIN crm_users f ON ${binJoin('f.id','l.field_assigned_to')} ORDER BY t.updated_at DESC LIMIT 500`).all();
 return reply(rows.results.map(r=>{
  const data=typeof r.data==='string'?JSON.parse(r.data):r.data&&typeof r.data==='object'?{...r.data as Record<string,unknown>}:{};
  if(!data.ownerCommission&&r.owner_commission)data.ownerCommission=String(r.owner_commission);
  if(!data.clientCommission&&r.client_commission)data.clientCommission=String(r.client_commission);
  return {...r,data};
 }));
});}
export async function POST(req:Request){return endpoint(async()=>{
 const user=await actor(req,['admin']);const input=schema.parse(await body(req));
 await crmTransaction(async db=>{
  const lead=await db.prepare('SELECT id FROM leads WHERE id=?').bind(input.data.leadId).first();
  if(!lead)throw new ApiError(404,'العميل غير موجود');
  if(input.data.financeEmployeeId){const employee=await db.prepare('SELECT id FROM crm_users WHERE id=? AND active=1').bind(input.data.financeEmployeeId).first();if(!employee)throw new ApiError(400,'موظف التمويل غير صالح');}
  const json=JSON.stringify(input.data), due=confirmedDue(input.data), now=new Date().toISOString();
  if(input.version===0){await db.prepare('INSERT INTO crm_transactions (id,lead_id,data,confirmed_due,version,updated_at) VALUES (?,?,?,?,1,?)').bind(input.id,input.data.leadId,json,due,now).run();}
  else {const result=await db.prepare('UPDATE crm_transactions SET data=?,confirmed_due=?,version=version+1,updated_at=? WHERE id=? AND lead_id=? AND version=?').bind(json,due,now,input.id,input.data.leadId,input.version).run();if(!result.meta.changes)throw new ApiError(409,'تم تعديل المعاملة؛ أعد تحميلها قبل الحفظ');}
  await db.prepare('UPDATE crm_transactions SET owner_commission=?, client_commission=? WHERE id=?').bind(input.data.ownerCommission||null,input.data.clientCommission||null,input.id).run();
  await db.prepare('INSERT INTO crm_audit (id,actor_id,action,target_id,details,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),user.userId,'transaction.saved',input.id,JSON.stringify({version:input.version+1}),now).run();
 });return reply({ok:true,id:input.id,version:input.version+1});
});}
