import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const port=Number(process.env.TEST_PORT||5187);
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'],{
  env:{...process.env,NODE_ENV:'production',NEXTAUTH_URL:`https://localhost:${port}`,NEXTAUTH_SECRET:randomBytes(48).toString('hex'),GOOGLE_CLIENT_ID:'http-test-only',GOOGLE_CLIENT_SECRET:'http-test-only'},
  stdio:['ignore','pipe','pipe'],windowsHide:true,
});
let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
try {
  let ready=false;
  for(let i=0;i<90;i++) {
    if(server.exitCode!==null)throw Error('Server exited: '+log);
    try {if((await fetch(base+'/')).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  assert(ready,'Server did not start');
  const home=await fetch(base+'/');assert.equal(home.status,200);assert((await home.text()).includes('ساس الثراء'));
  const property=JSON.parse(readFileSync('data/properties.json','utf8'))[0];
  assert.equal((await fetch(base+'/properties/'+property.id)).status,200);
  assert.equal((await fetch(base+'/properties/missing')).status,404);
  const crm=await fetch(base+'/crm');assert.equal(crm.status,200);assert((await crm.text()).includes('الدخول بحساب Google'));
  assert.equal((await fetch(base+'/api/leads')).status,401);
  assert.equal((await fetch(base+'/api/leads',{headers:{'oai-authenticated-user-email':'sasalthra.sa@gmail.com','oai-authenticated-user-id':'admin'}})).status,401);
  assert.equal((await fetch(base+'/api/leads',{headers:{Cookie:'__Secure-next-auth.session-token=forged'}})).status,401);
  const csrf=await fetch(base+'/api/auth/csrf');assert.equal(csrf.status,200);assert.equal(typeof(await csrf.json()).csrfToken,'string');
  assert.equal((await fetch(base+'/brand/logo.png')).status,200);
  assert.equal((await fetch(base+'/brand/rb.woff2')).status,200);
  console.log('PASS: production HTTP pages, missing property, login UI, rejected anonymous/forged identities, real auth CSRF endpoint, brand assets. No Google login or real MySQL connection performed.');
} finally {
  server.kill();
  await new Promise(resolve=>{if(server.exitCode!==null)resolve();else server.once('exit',resolve);});
}
