import {crmDb,crmTransaction} from './crm-db';
import {previewImport,type Mapping} from './lead-import';
import {ApiError} from './secure-api';
export async function runImport(rows:string[][],mapping:Mapping,userId:string,commit:boolean,source='excel'){
 const execute=async(db:ReturnType<typeof crmDb>)=>{
  if(commit){const lock=await db.prepare("SELECT id FROM crm_import_lock WHERE id='leads' FOR UPDATE").first();if(!lock)throw new ApiError(503,'تهيئة الاستيراد غير مكتملة');}
  const existing=await db.prepare('SELECT phone FROM leads').all();
  const preview=previewImport(rows,mapping,existing.results.map(r=>String(r.phone)));
  if(commit){const now=new Date().toISOString();for(const r of preview){
   if(r.status!=='ready'||!r.lead)continue;const v=r.lead;
   await db.prepare('INSERT INTO leads (id,owner,created_by,assigned_to,field_assigned_to,name,phone,property_id,property_other,source,stage,notes,follow_up,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(v.id,userId,userId,'','',v.name,v.phone,v.propertyId,v.propertyOther,v.source==='excel'?source:v.source,v.stage,v.notes,v.followUp,now,now).run();
   await db.prepare('INSERT INTO crm_import_rows (id,lead_id,source,raw_data,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),v.id,source,JSON.stringify(r.raw),now).run();
   await db.prepare('INSERT INTO lead_activity (id,lead_id,user_id,action,details) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),v.id,userId,'imported',JSON.stringify({source})).run();
  }
  await db.prepare('INSERT INTO crm_audit (id,actor_id,action,target_id,details,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),userId,'leads.import',source,JSON.stringify({inserted:preview.filter(r=>r.status==='ready').length}),now).run();}
  return {rows:preview,inserted:commit?preview.filter(r=>r.status==='ready').length:0};
 };
 return commit?crmTransaction(execute):execute(crmDb());
}
