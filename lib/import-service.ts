import {crmDb,crmTransaction} from './crm-db';
import {assigneesForReady,previewImport,type Assignment,type Mapping} from './lead-import';
import {ApiError} from './secure-api';

async function activeSalesIds(db:ReturnType<typeof crmDb>,ids:string[]){
  if(!ids.length)return [] as string[];
  const rows=await db.prepare("SELECT id FROM crm_users WHERE active = 1 AND role = 'sales'").all();
  const allowed=new Set(rows.results.map(r=>String(r.id)));
  const missing=ids.filter(id=>!allowed.has(id));
  if(missing.length)throw new ApiError(400,'مندوب المبيعات المحدد غير صالح أو غير نشط');
  return ids;
}

export async function runImport(rows:string[][],mapping:Mapping,userId:string,commit:boolean,source='excel',assignment?:Assignment){
 const execute=async(db:ReturnType<typeof crmDb>)=>{
  if(commit){const lock=await db.prepare("SELECT id FROM crm_import_lock WHERE id='leads' FOR UPDATE").first();if(!lock)throw new ApiError(503,'تهيئة الاستيراد غير مكتملة');}
  if(commit&&assignment&&assignment.mode!=='unassigned')await activeSalesIds(db,assignment.userIds);
  const existing=await db.prepare('SELECT phone FROM leads').all();
  const preview=previewImport(rows,mapping,existing.results.map(r=>String(r.phone)));
  if(commit){
   const now=new Date().toISOString();
   const ready=preview.filter(r=>r.status==='ready'&&r.lead);
   const assigned=assigneesForReady(ready.length,assignment);
   let i=0;
   for(const r of preview){
    if(r.status!=='ready'||!r.lead)continue;const v=r.lead;
    const assignedTo=assigned[i++]||'';
    await db.prepare('INSERT INTO leads (id,owner,created_by,assigned_to,field_assigned_to,name,phone,property_id,property_other,source,stage,notes,follow_up,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(v.id,userId,userId,assignedTo,'',v.name,v.phone,v.propertyId,v.propertyOther,v.source==='excel'?source:v.source,v.stage,v.notes,v.followUp,now,now).run();
    await db.prepare('INSERT INTO crm_import_rows (id,lead_id,source,raw_data,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),v.id,source,JSON.stringify(r.raw),now).run();
    await db.prepare('INSERT INTO lead_activity (id,lead_id,user_id,action,details) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),v.id,userId,'imported',JSON.stringify({source,assignedTo:assignedTo||null,stage:v.stage})).run();
   }
   await db.prepare('INSERT INTO crm_audit (id,actor_id,action,target_id,details,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),userId,'leads.import',source,JSON.stringify({inserted:ready.length,assignment:assignment?.mode||'unassigned'}),now).run();
  }
  return {rows:preview,inserted:commit?preview.filter(r=>r.status==='ready').length:0};
 };
 return commit?crmTransaction(execute):execute(crmDb());
}
