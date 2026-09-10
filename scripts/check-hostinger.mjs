import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
// Match webpack's CommonJS default-import interop for the actual Google provider.
const googleInterop={name:'google-interop',setup(b){
  b.onResolve({filter:/^next-auth\/providers\/google$/},()=>({path:'google',namespace:'interop'}));
  b.onLoad({filter:/.*/,namespace:'interop'},()=>({contents:`import mod from ${JSON.stringify(require.resolve('next-auth/providers/google').replaceAll('\\','/'))}; export default mod.default ?? mod;`,loader:'js',resolveDir:process.cwd()}));
}};
mkdirSync('test-output',{recursive:true});
process.env.NEXTAUTH_URL='https://sas.test';
process.env.NEXTAUTH_SECRET='test-only-secret-that-is-not-used-in-production';
process.env.GOOGLE_CLIENT_ID='test-client';process.env.GOOGLE_CLIENT_SECRET='test-secret';
await build({entryPoints:['lib/auth.ts'],outfile:'test-output/auth.cjs',bundle:true,platform:'node',format:'cjs',plugins:[googleInterop]});
const {authOptions,authConfigured}=require('../test-output/auth.cjs');
const callbacks=authOptions.callbacks;
const profile={email:'sasalthra.sa@gmail.com',email_verified:true,sub:'test-admin'};
assert.equal(authConfigured(),true);
assert.equal(await callbacks.signIn({account:{provider:'google'},profile}),true);
for(const p of [{...profile,email:'other@gmail.com'},{...profile,email_verified:false},{...profile,sub:''}])
  assert.equal(await callbacks.signIn({account:{provider:'google'},profile:p}),false);
assert.equal(await callbacks.signIn({account:{provider:'other'},profile}),false);
assert.equal(await callbacks.redirect({url:'https://evil.test',baseUrl:'https://sas.test'}),'https://sas.test/crm');
let token=await callbacks.jwt({token:{email:profile.email},account:{provider:'google'},profile});
let session=await callbacks.session({session:{user:{email:profile.email}},token});
assert.equal(session.adminId,'google:test-admin');
assert.equal((await callbacks.session({session:{user:{email:profile.email}},token:{email:profile.email}})).user,undefined);
const secret=process.env.NEXTAUTH_SECRET;delete process.env.NEXTAUTH_SECRET;
assert.equal(authConfigured(),false);process.env.NEXTAUTH_SECRET=secret;

const sqlite=new DatabaseSync(':memory:');
sqlite.exec('CREATE TABLE leads(id TEXT PRIMARY KEY,owner TEXT,name TEXT,phone TEXT,property_id TEXT,stage TEXT,notes TEXT,follow_up TEXT,created_at TEXT,updated_at TEXT)');
globalThis.qaSession=null;globalThis.qaFailDB=false;
// Only the external MySQL driver and session retrieval are substituted.
// SQL runs in SQLite; MySQL-specific upsert is translated at this boundary.
globalThis.qaPool={async execute(sql,values){
  if(globalThis.qaFailDB)throw Error('test database unavailable');
  if(sql.startsWith('SELECT'))return [sqlite.prepare(sql).all(...values)];
  const translated=sql.replace(' ON DUPLICATE KEY UPDATE id=id',' ON CONFLICT(id) DO NOTHING');
  return [{affectedRows:Number(sqlite.prepare(translated).run(...values).changes)}];
}};
process.env.DB_HOST='test';process.env.DB_USER='test';process.env.DB_PASSWORD='test';process.env.DB_NAME='test';
await build({entryPoints:['app/api/leads/route.ts'],outfile:'test-output/api.cjs',bundle:true,platform:'node',format:'cjs',plugins:[googleInterop,{name:'test-boundaries',setup(b){
  b.onResolve({filter:/^next-auth$/},()=>({path:'session',namespace:'test'}));
  b.onResolve({filter:/^mysql2\/promise$/},()=>({path:'db',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='session'?'export async function getServerSession(){return globalThis.qaSession}':'export default {createPool(){return globalThis.qaPool}}',loader:'js'}));
}}]});
const api=require('../test-output/api.cjs');
const property=JSON.parse(readFileSync('data/properties.json','utf8'))[0];
const make=(v,origin='https://sas.test')=>new Request('https://internal-host/api/leads',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(v)});
assert.equal((await api.GET()).status,401);
globalThis.qaSession={user:{email:'other@gmail.com'},adminId:'google:other'};assert.equal((await api.GET()).status,401);
globalThis.qaSession={user:{email:profile.email},adminId:'local_admin'};assert.equal((await api.GET()).status,401);
globalThis.qaSession={user:{email:profile.email},adminId:'google:test-admin'};
const v={id:crypto.randomUUID(),name:'عميل اختبار',phone:'+966500000000',propertyId:property.id,stage:'new',notes:"quote ' ; --",followUp:'2026-10-01'};
assert.equal((await api.POST(make(v))).status,200);
assert.equal((await api.POST(make({...v,name:'لا يستبدل الأصل'}))).status,200);
let list=await(await api.GET()).json();assert.equal(list.length,1);assert.equal(list[0].name,v.name);assert.equal(list[0].notes,v.notes);
assert.equal((await api.PATCH(make({...v,stage:'viewing'}))).status,200);
assert.equal((await(await api.GET()).json())[0].stage,'viewing');
assert.equal((await api.POST(make({...v,id:crypto.randomUUID(),propertyId:'invalid'}))).status,400);
for(const followUp of ['2026-99-99','2026-02-30'])assert.equal((await api.POST(make({...v,followUp}))).status,400);
assert.equal((await api.POST(make(v,'https://evil.test'))).status,403);
assert.equal((await api.POST(make({...v,notes:'x'.repeat(13000)}))).status,413);
assert.equal((await api.PATCH(make({...v,id:crypto.randomUUID()}))).status,404);
sqlite.prepare('UPDATE leads SET owner=? WHERE id=?').run('google:someone-else',v.id);
assert.equal((await api.POST(make(v))).status,409);
assert.equal((await api.PATCH(make(v))).status,404);
assert.equal((await(await api.GET()).json()).length,0);
globalThis.qaFailDB=true;assert.equal((await api.GET()).status,503);
assert.equal((await api.POST(make({...v,id:crypto.randomUUID()}))).status,503);
sqlite.close();
console.log('PASS: auth policy, session claims, owner isolation, CRUD, idempotency, input limits, origin checks, database failure. External Google and MySQL integration still requires staging verification.');
