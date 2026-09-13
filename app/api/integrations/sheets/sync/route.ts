import {timingSafeEqual} from 'node:crypto';
import {crmDb} from '@/lib/crm-db';
import {actor,endpoint,reply,ApiError} from '@/lib/secure-api';
import {sheetConfigSchema} from '@/lib/sheets-policy';
import {fetchSheet} from '@/lib/sheets.server';
import {runImport} from '@/lib/import-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function sync(){
 const db=crmDb(),row=await db.prepare("SELECT config FROM crm_integrations WHERE id='sheets'").first<{config:unknown}>();
 if(!row)throw new ApiError(409,'مصدر العملاء غير مضبوط');
 const config=sheetConfigSchema.parse(typeof row.config==='string'?JSON.parse(row.config):row.config);
 if(!config.enabled)throw new ApiError(409,'المزامنة موقوفة');
 try{const rows=await fetchSheet(config);const result=rows.length?await runImport(rows,config.mapping,'integration:sheets',true,'google_sheets'):{inserted:0,rows:[]};
 const summary={inserted:result.inserted,invalid:result.rows.filter(r=>r.status==='invalid').map(r=>({row:r.row+1,errors:r.errors})),duplicates:result.rows.filter(r=>r.status==='duplicate').length};
 await db.prepare("UPDATE crm_integrations SET last_run=?,last_result=? WHERE id='sheets'").bind(new Date().toISOString(),JSON.stringify(summary)).run();return reply(summary);
 }catch(e){await db.prepare("UPDATE crm_integrations SET last_run=?,last_result=? WHERE id='sheets'").bind(new Date().toISOString(),JSON.stringify({error:'فشلت المزامنة؛ راجع المصدر والعناوين والتهيئة'})).run();throw e;}
}
export async function POST(req:Request){return endpoint(async()=>{await actor(req,['admin']);return sync();});}
export async function GET(req:Request){return endpoint(async()=>{
 const secret=process.env.CRON_SECRET,received=req.headers.get('authorization')||'';
 if(!secret||secret.length<32)throw new ApiError(503,'مفتاح الجدولة غير مضبوط');
 const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(received);
 if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new ApiError(401,'غير مصرح');
 return sync();
});}
