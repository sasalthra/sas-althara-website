import {crmDb,crmTransaction} from '@/lib/crm-db';
import {actor,body,endpoint,reply} from '@/lib/secure-api';
import {sheetConfigSchema} from '@/lib/sheets-policy';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){return endpoint(async()=>{await actor(undefined,['admin']);const row=await crmDb().prepare("SELECT config,last_run,last_result FROM crm_integrations WHERE id='sheets'").first<{config:unknown;last_run:string;last_result:string}>();return reply({config:row?(typeof row.config==='string'?JSON.parse(row.config):row.config):null,lastRun:row?.last_run,lastResult:row?.last_result,credentialsReady:Boolean(process.env.GOOGLE_SHEETS_CLIENT_EMAIL&&process.env.GOOGLE_SHEETS_PRIVATE_KEY),schedulerReady:Boolean(process.env.CRON_SECRET)});});}
export async function POST(req:Request){return endpoint(async()=>{const user=await actor(req,['admin']),v=sheetConfigSchema.parse(await body(req,20000));await crmTransaction(async db=>{
 await db.prepare("INSERT INTO crm_integrations (id,config,updated_by) VALUES ('sheets',?,?) ON DUPLICATE KEY UPDATE config=VALUES(config),updated_by=VALUES(updated_by)").bind(JSON.stringify(v),user.userId).run();
 await db.prepare('INSERT INTO crm_audit (id,actor_id,action,target_id,details,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),user.userId,'sheets.settings','sheets',JSON.stringify({enabled:v.enabled}),new Date().toISOString()).run();
 });return reply({ok:true});});}
