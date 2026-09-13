// Real SQL execution against disposable in-memory SQLite. No .env, network or customer data.
// MySQL row locks/upsert syntax are adapted only at the driver boundary; staging MySQL remains required.
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const out=mkdtempSync(join(tmpdir(),'sas-storage-')),sql=new DatabaseSync(':memory:');
const employee=crypto.randomUUID(),admin=crypto.randomUUID();
sql.exec(`
CREATE TABLE leads(id TEXT PRIMARY KEY,owner TEXT,created_by TEXT,assigned_to TEXT,field_assigned_to TEXT,name TEXT,phone TEXT,property_id TEXT,property_other TEXT,source TEXT,stage TEXT,notes TEXT,follow_up TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE crm_users(id TEXT PRIMARY KEY,name TEXT,active INTEGER);
CREATE TABLE crm_import_lock(id TEXT PRIMARY KEY); INSERT INTO crm_import_lock VALUES ('leads');
CREATE TABLE crm_import_rows(id TEXT PRIMARY KEY,lead_id TEXT,source TEXT,raw_data TEXT,created_at TEXT);
CREATE TABLE lead_activity(id TEXT PRIMARY KEY,lead_id TEXT,user_id TEXT,action TEXT,details TEXT);
CREATE TABLE crm_audit(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,target_id TEXT,details TEXT,created_at TEXT);
CREATE TABLE crm_transactions(id TEXT PRIMARY KEY,lead_id TEXT,data TEXT,confirmed_due TEXT,version INTEGER,updated_at TEXT);
CREATE TABLE hr_profiles(user_id TEXT PRIMARY KEY,job_title TEXT,department TEXT,leave_balance REAL,schedule TEXT,updated_at TEXT);
CREATE TABLE hr_attendance(user_id TEXT,work_day TEXT,check_in TEXT,check_out TEXT,late_minutes INTEGER,in_key TEXT UNIQUE,out_key TEXT UNIQUE,in_distance INTEGER,in_accuracy REAL,out_distance INTEGER,out_accuracy REAL,PRIMARY KEY(user_id,work_day));
CREATE TABLE hr_requests(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,details TEXT,status TEXT,created_at TEXT,start_date TEXT,end_date TEXT,review_note TEXT,reviewed_by TEXT,reviewed_at TEXT);
CREATE TABLE hr_announcements(id TEXT PRIMARY KEY,title TEXT,details TEXT,created_at TEXT);
`);
sql.prepare('INSERT INTO crm_users VALUES (?,?,1)').run(employee,'Synthetic employee');
sql.prepare('INSERT INTO crm_users VALUES (?,?,1)').run(admin,'Synthetic admin');
let failAudit=false;
globalThis.storageUser={userId:admin,role:'admin',name:'Synthetic admin'};
const driver={async execute(query,args){
 if(failAudit&&query.includes('INSERT INTO crm_audit'))throw Error('injected audit failure');
 query=query.replace(/ FOR UPDATE/g,'').replace(/ON DUPLICATE KEY UPDATE /g,'ON CONFLICT DO UPDATE SET ').replace(/VALUES\((\w+)\)/g,'excluded.$1');
 const statement=sql.prepare(query);
 return /^SELECT/.test(query.trim())?[statement.all(...args)]:[{affectedRows:Number(statement.run(...args).changes)}];
},async beginTransaction(){sql.exec('BEGIN');},async commit(){sql.exec('COMMIT');},async rollback(){sql.exec('ROLLBACK');},release(){}};
globalThis.storagePool={execute:driver.execute,async getConnection(){return driver;}};
Object.assign(process.env,{DB_HOST:'synthetic',DB_USER:'synthetic',DB_PASSWORD:'synthetic',DB_NAME:'synthetic',NEXTAUTH_URL:'https://sas.test'});
const boundary={name:'isolated-storage',setup(b){
 b.onResolve({filter:/^mysql2\/promise$/},()=>({path:'mysql',namespace:'test'}));
 b.onResolve({filter:/[\\/]admin$/},()=>({path:'auth',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({loader:'js',contents:a.path==='mysql'?'export default {createPool(){return globalThis.storagePool}}':'export async function getCrmUser(){return globalThis.storageUser}'}));
}};
async function load(path,name){await build({entryPoints:[path],outfile:join(out,name+'.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[boundary]});return createRequire(import.meta.url)(join(out,name+'.cjs'));}
const request=v=>new Request('https://sas.test/api/test',{method:'POST',headers:{origin:'https://sas.test','content-type':'application/json'},body:JSON.stringify(v)});
try{
 const {runImport}=await load('lib/import-service.ts','import');
 const rows=[['Synthetic one','0500000000','Other land','source-001'],['Synthetic duplicate','966500000000','Other','source-002'],['Synthetic invalid','invalid','Other','source-003']],mapping={name:0,phone:1,propertyOther:2};
 assert.equal((await runImport(rows,mapping,admin,false)).inserted,0);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads').get().n,0);
 assert.equal((await runImport(rows,mapping,admin,true)).inserted,1);
 assert.equal((await runImport(rows,mapping,admin,true)).inserted,0);
 const lead=sql.prepare('SELECT * FROM leads').get();assert.equal(lead.property_other,'Other land');
 assert.deepEqual(JSON.parse(sql.prepare('SELECT raw_data FROM crm_import_rows').get().raw_data),rows[0]);
 failAudit=true;await assert.rejects(()=>runImport([['Rollback','0500000001','Other']],mapping,admin,true));failAudit=false;
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM leads').get().n,1,'all import inserts rollback if audit fails');
 console.log('PASS SQL import preview/no-write, normalized duplicate replay, Other/raw-source persistence and atomic rollback');
 const finance=await load('app/api/transactions/route.ts','finance'),id=crypto.randomUUID();
 const data={leadId:lead.id,debtPayer:'company',debtSettlement:'100.25',brokerage:'20.10'};
 assert.equal((await finance.POST(request({id,version:0,confirmed:true,data}))).status,200);
 assert.equal(sql.prepare('SELECT confirmed_due FROM crm_transactions').get().confirmed_due,'120.35');
 assert.equal((await finance.POST(request({id,version:1,confirmed:true,data:{...data,debtPayer:'client'}}))).status,200);
 assert.equal(sql.prepare('SELECT confirmed_due FROM crm_transactions').get().confirmed_due,'20.10');
 assert.equal(JSON.parse(sql.prepare('SELECT data FROM crm_transactions').get().data).clientCollection,'');
 assert.equal((await finance.POST(request({id,version:1,confirmed:true,data}))).status,409);
 console.log('PASS SQL linked transaction save/update/readback, debt payer rule, no fictional collection, stale-version conflict');
 const hr=await load('app/api/hr/route.ts','hr');
 const schedule={latitude:24,longitude:46,radius:100,maxAccuracy:30,start:'00:00',end:'23:59',grace:10,days:[0,1,2,3,4,5,6],timezone:'UTC'};
 assert.equal((await hr.POST(request({action:'profile',data:{userId:employee,jobTitle:'Test',department:'Test',leaveBalance:12,schedule}}))).status,200);
 globalThis.storageUser={userId:employee,role:'sales',name:'Synthetic employee'};
 assert.equal((await hr.POST(request({action:'profile',data:{}}))).status,403);
 const point={latitude:24,longitude:46,accuracy:10},punchId=crypto.randomUUID();
 assert.equal((await hr.POST(request({action:'punch',id:punchId,kind:'in',point}))).status,200);
 assert.equal((await hr.POST(request({action:'punch',id:punchId,kind:'in',point}))).status,200);
 assert.equal((await hr.POST(request({action:'punch',id:crypto.randomUUID(),kind:'in',point}))).status,409);
 assert.equal((await hr.POST(request({action:'punch',id:crypto.randomUUID(),kind:'out',point:{...point,latitude:25}}))).status,409);
 assert.equal((await hr.POST(request({action:'punch',id:crypto.randomUUID(),kind:'out',point}))).status,200);
 assert.ok(sql.prepare('SELECT check_out FROM hr_attendance').get().check_out);
 const leaveId=crypto.randomUUID();
 assert.equal((await hr.POST(request({action:'request',data:{id:leaveId,type:'leave',details:'Synthetic leave',startDate:'2026-09-14',endDate:'2026-09-15'}}))).status,200);
 globalThis.storageUser={userId:admin,role:'admin',name:'Synthetic admin'};
 assert.equal((await hr.POST(request({action:'review',data:{id:leaveId,status:'approved',note:'Test approval'}}))).status,200);
 globalThis.storageUser={userId:employee,role:'sales',name:'Synthetic employee'};
 let result=await(await hr.GET(new Request('https://sas.test/api/hr?month=2026-09'))).json();
 assert.equal(result.calendarLeaves.length,1);assert.equal(result.calendarLeaves[0].start_date,'2026-09-14');
 globalThis.storageUser={userId:crypto.randomUUID(),role:'sales',name:'Other employee'};
 result=await(await hr.GET(new Request('https://sas.test/api/hr?month=2026-09'))).json();
 assert.equal(result.calendarLeaves.length,0);assert.equal(result.attendance.length,0);assert.equal(result.requests.length,0);
 console.log('PASS SQL HR admin schedule, employee permissions, punch idempotency/geofence, check-out, leave approval/month query and isolation');
}finally{sql.close();rmSync(out,{recursive:true,force:true});delete globalThis.storagePool;delete globalThis.storageUser;}
