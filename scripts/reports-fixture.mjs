// Test-only SQL fixture. Bundle-time replacement of auth/driver; NEVER imported by application.
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
export const syntheticProperties=[{id:'fixture-property',title:'عقار اصطناعي للاختبار',price:100000,area:200,city:'الرياض',status:'متاح'}];
export async function reportsFixture(){
 const sql=new DatabaseSync(':memory:');
 sql.function('JSON_UNQUOTE',v=>v);
 sql.function('CONVERT_TZ',(value,from,to)=>{if(value==null)return null;assert.equal(from,'+00:00');assert.equal(to,'+03:00');const text=String(value).replace(' ','T');const parsed=Date.parse(text.endsWith('Z')||/[+-]\d\d:\d\d$/.test(text)?text:text+'Z');return Number.isFinite(parsed)?new Date(parsed+3*60*60*1000).toISOString().replace('T',' ').slice(0,23):String(value);});
 const out=mkdtempSync(join(tmpdir(),'sas-report-api-'));
 sql.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY,owner TEXT,created_by TEXT,assigned_to TEXT,field_assigned_to TEXT,name TEXT,property_id TEXT,property_other TEXT,source TEXT,stage TEXT,follow_up TEXT,created_at TEXT,updated_at TEXT);
 CREATE TABLE crm_users(id TEXT PRIMARY KEY,name TEXT,role TEXT,active INTEGER,created_at TEXT,password_hash TEXT);
 CREATE TABLE lead_activity(id TEXT,lead_id TEXT,user_id TEXT,action TEXT,created_at TEXT,details TEXT);
 CREATE TABLE crm_transactions(id TEXT,lead_id TEXT,data TEXT,confirmed_due TEXT,updated_at TEXT);
 CREATE TABLE hr_attendance(user_id TEXT,work_day TEXT,check_in TEXT,check_out TEXT,late_minutes INTEGER);
 CREATE TABLE hr_profiles(user_id TEXT,job_title TEXT,department TEXT,leave_balance TEXT,schedule TEXT,updated_at TEXT);
 CREATE TABLE hr_requests(id TEXT,user_id TEXT,type TEXT,status TEXT,created_at TEXT,start_date TEXT,end_date TEXT,reviewed_at TEXT,details TEXT);
 CREATE TABLE hr_announcements(id TEXT,title TEXT,created_at TEXT);
 CREATE TABLE crm_audit(id TEXT,actor_id TEXT,action TEXT,created_at TEXT,details TEXT);
 CREATE TABLE crm_import_rows(id TEXT,lead_id TEXT,source TEXT,created_at TEXT,raw_data TEXT);
 CREATE TABLE crm_integrations(id TEXT,last_run TEXT,last_result TEXT,config TEXT);
 CREATE TABLE ai_usage(user_id TEXT,hour_key TEXT,requests INTEGER);
 CREATE TABLE ai_settings(encrypted_key TEXT);
 INSERT INTO crm_users VALUES ('alice','موظف اصطناعي أ','sales',1,'2026-01-01','SECRET_SENTINEL'),('bob','موظف اصطناعي ب','field',1,'2026-01-01','SECRET_SENTINEL'),('finance-user','موظف تمويل اصطناعي','sales',1,'2026-01-01','SECRET_SENTINEL');
 INSERT INTO hr_profiles VALUES ('alice','مبيعات','تجريبي','12','{"start":"09:00","end":"17:00","timezone":"Asia/Riyadh","days":[0,1,2,3,4],"grace":15}','2026-09-01'),('bob','ميدان','تجريبي','8','{}','2026-09-01');
 INSERT INTO hr_attendance VALUES ('alice','2026-09-01','2026-09-01T06:00:00Z','2026-09-01T14:00:00Z',5),('bob','2026-09-01','2026-09-01T06:00:00Z',NULL,0);
 INSERT INTO hr_requests VALUES ('request-a','alice','leave','pending','2026-09-01',NULL,NULL,NULL,'SECRET_SENTINEL'),('request-b','bob','advance','approved','2026-09-02',NULL,NULL,'2026-09-03','SECRET_SENTINEL');
 INSERT INTO hr_announcements VALUES ('notice','إعلان اختبار اصطناعي','2026-09-01');
 INSERT INTO crm_audit VALUES ('audit','alice','leads.import','2026-09-01','{"inserted":2,"prompt":"SECRET_SENTINEL"}'),('audit-ai','bob','ai.read','2026-09-02','{"prompt":"SECRET_SENTINEL"}');
 INSERT INTO crm_integrations VALUES ('sheets','2026-09-02','{"inserted":2,"duplicates":1,"invalid":[{"row":3,"errors":["SECRET_SENTINEL"]}]}','{"enabled":true,"sourceConfirmed":true,"sheetId":"SECRET_SENTINEL"}');
 INSERT INTO ai_usage VALUES ('alice','2026-09-01T10',2),('bob','2026-09-02T11',3);
 INSERT INTO ai_settings VALUES ('SECRET_SENTINEL');`);
 const put=sql.prepare('INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
 for(let i=0;i<31;i++){const owner=i%2?'alice':'bob',id='fixture-'+String(i).padStart(2,'0');put.run(id,owner,owner,owner==='alice'?owner:'',owner==='bob'?owner:'',i===0?'=SYNTHETIC()':'عميل اصطناعي '+i,i===2?'other':'fixture-property',i===2?'عقار آخر اصطناعي':'',i%2?'website':'excel',i%3?'new':'won','2026-09-10','2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z');}
 sql.exec(`INSERT INTO lead_activity VALUES ('act-a','fixture-01','alice','created','2026-09-01 00:00:00','SECRET_SENTINEL'),('act-b','fixture-00','bob','updated','2026-09-30 20:59:59','SECRET_SENTINEL'),('act-c','fixture-00','bob','updated','2026-09-30 21:00:00','SECRET_SENTINEL');
 INSERT INTO crm_import_rows VALUES ('row','fixture-00','excel','2026-09-01','SECRET_SENTINEL');`);
 sql.prepare('INSERT INTO crm_transactions VALUES (?,?,?,?,?)').run('finance','fixture-00',JSON.stringify({brokerage:'100.10',debtPayer:'client',debtSettlement:'900.00',clientCollection:'20.10',balance:'80.00',notes:'SECRET_SENTINEL'}),'100.10','2026-09-01');
 let count=0,failTable='';
 globalThis.reportFixtureActor={userId:'root',role:'admin',name:'إدارة اصطناعية'};
 globalThis.reportFixtureDriver={async execute(query,args){assert.match(query.trim(),/^SELECT/,'Report attempted SQL mutation');assert.ok(!/password_hash|encrypted_key|raw_data|SELECT\s+\*/i.test(query),'Secret column selected');if(failTable&&query.includes(failTable))throw Error('synthetic missing table');count++;return [sql.prepare(query).all(...args)];}};
 const boundary={name:'isolated-report-boundaries',setup(b){
  b.onResolve({filter:/^mysql2\/promise$/},()=>({path:'driver',namespace:'fixture'}));
  b.onResolve({filter:/[\\/]admin$/},()=>({path:'auth',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='driver'?'export default {createPool(){return globalThis.reportFixtureDriver}}':'export async function getCrmUser(){return globalThis.reportFixtureActor}'}));
  b.onLoad({filter:/data[\\/]properties\.json$/},()=>({contents:JSON.stringify(syntheticProperties),loader:'json'}));
 }};
 // The driver cannot make a connection. These placeholders only satisfy crmDb's configuration guard.
 const saved=Object.fromEntries(['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME'].map(k=>[k,process.env[k]]));
 Object.assign(process.env,{DB_HOST:'synthetic.invalid',DB_USER:'synthetic',DB_PASSWORD:'synthetic',DB_NAME:'synthetic'});
 await build({entryPoints:['app/api/reports/route.ts'],outfile:join(out,'route.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[boundary]});
 const route=createRequire(import.meta.url)(join(out,'route.cjs'));
 return {sql,route,get count(){return count;},actor(value){globalThis.reportFixtureActor=value;},fail(table){failTable=table;},async get(query=''){return route.GET(new Request('http://127.0.0.1/api/reports?'+query));},close(){sql.close();rmSync(out,{recursive:true,force:true});delete globalThis.reportFixtureDriver;delete globalThis.reportFixtureActor;for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}};
}
