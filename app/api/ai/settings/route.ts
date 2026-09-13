import {z} from 'zod';
import {crmDb,crmTransaction} from '@/lib/crm-db';
import {actor,body,endpoint,reply} from '@/lib/secure-api';
import {seal} from '@/lib/secrets.server';
export const runtime='nodejs';export const dynamic='force-dynamic';
const schema=z.object({provider:z.enum(['openai','anthropic']),model:z.string().trim().regex(/^[a-zA-Z0-9._:-]{1,100}$/),apiKey:z.string().trim().min(10).max(512)}).strict();
export async function GET(){return endpoint(async()=>{await actor(undefined,['admin']);const row=await crmDb().prepare("SELECT provider,model,updated_at FROM ai_settings WHERE id='primary'").first<{provider:string;model:string;updated_at:string}>();return reply(row?{configured:true,provider:row.provider,model:row.model,updatedAt:row.updated_at}:{configured:false});});}
export async function POST(req:Request){return endpoint(async()=>{
 const user=await actor(req,['admin']),v=schema.parse(await body(req,4000)),encrypted=seal(v.apiKey,v.provider),now=new Date().toISOString();
 await crmTransaction(async db=>{
 await db.prepare("INSERT INTO ai_settings (id,provider,model,encrypted_key,updated_at) VALUES ('primary',?,?,?,?) ON DUPLICATE KEY UPDATE provider=VALUES(provider),model=VALUES(model),encrypted_key=VALUES(encrypted_key),updated_at=VALUES(updated_at)").bind(v.provider,v.model,encrypted,now).run();
 await db.prepare('INSERT INTO crm_audit (id,actor_id,action,target_id,details,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),user.userId,'ai.settings','primary',JSON.stringify({provider:v.provider}),now).run();
 });return reply({ok:true});
});}
