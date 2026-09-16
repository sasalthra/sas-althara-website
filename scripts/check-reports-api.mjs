import assert from 'node:assert/strict';
import {reportsFixture} from './reports-fixture.mjs';
const f=await reportsFixture();
try{
 let response=await f.get(),body=await response.json();assert.equal(response.status,200);
 const ids=body.summaries.map(r=>r.id);assert.equal(ids.length,15);assert.equal(new Set(ids).size,15);
 assert.equal(body.summaries.filter(r=>r.status!=='ok').length,0,JSON.stringify(body.summaries));
 assert.ok(body.snapshots,'overview exposes system snapshots');
 assert.equal(body.snapshots.clients.status,'ok');
 assert.ok(body.snapshots.clients.total>=body.summaries.find(s=>s.id==='leads').total,'client snapshot is not date-window limited below leads period total');
 assert.equal(body.snapshots.clients.interested+body.snapshots.clients.notInterested,body.snapshots.clients.total);
 assert.equal(body.snapshots.properties.status,'ok');
 assert.ok(body.snapshots.properties.total>0);
 assert.ok(body.snapshots.properties.byNeighborhood.length>0);
 for(const id of ids){response=await f.get('module='+id);assert.equal(response.status,200,id);body=await response.json();assert.ok(body.report.total>0,id+' must exercise seeded rows');assert.ok(!JSON.stringify(body).includes('SECRET_SENTINEL'),id+' secret leak');response=await f.get('module='+id+'&format=csv');assert.equal(response.status,200);assert.ok(!((await response.text()).includes('SECRET_SENTINEL')));}
 response=await f.get('module=leads&page=2');body=await response.json();assert.equal(body.report.total,31);assert.equal(body.report.rows.length,6);assert.equal(body.report.groups.source.reduce((n,g)=>n+g.count,0),31);
 response=await f.get('module=leads&format=csv');const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);const csv=new TextDecoder().decode(bytes);assert.ok(csv.includes("'=SYNTHETIC()"));assert.equal(csv.trim().split('\r\n').length,32);
 f.sql.prepare('UPDATE crm_transactions SET data=?').run(JSON.stringify({brokerage:'1.00',financeEmployeeId:'finance-user',debtPayer:'client',fundingEntity:'بنك اختبار',requestStage:'اعتماد'}));
 response=await f.get('module=transactions&employee=finance-user');assert.equal((await response.json()).report.total,1,'finance responsible employee participates in employee filter');
 response=await f.get('module=transactions&funding='+encodeURIComponent('بنك اختبار')+'&stage='+encodeURIComponent('اعتماد'));body=await response.json();assert.equal(body.report.total,1,'funding and transaction-stage filters map to persisted JSON');assert.equal(body.report.groups.fundingEntity[0].label,'بنك اختبار');
 response=await f.get('module=properties');body=await response.json();assert.equal(body.report.groups.city.find(g=>g.label==='الرياض').count,1);assert.equal(body.report.groups.status.find(g=>g.label==='متاح').count,1);
 response=await f.get('module=followups');body=await response.json();assert.ok(body.report.columns.some(c=>c.key==='follow_up_age'));assert.ok(body.report.groups.follow_up_age.length>0);
 response=await f.get('module=requests');body=await response.json();assert.equal(body.report.metrics.find(m=>m.label.includes('المفتوحة')).value,1);assert.equal(body.report.metrics.find(m=>m.label.includes('الإجاز')).value,1);
 f.sql.prepare('UPDATE crm_integrations SET config=?').run(JSON.stringify({enabled:false,sourceConfirmed:true,sheetId:'SECRET_SENTINEL'}));
 response=await f.get('module=sheets');body=await response.json();assert.equal(body.report.rows[0].enabled,'موقوف');assert.equal(body.report.rows[0].sourceConfirmed,'معتمد');
 response=await f.get('module=profiles');body=await response.json();assert.equal(body.report.rows[0].grace_minutes,15);assert.equal(body.report.rows[0].work_days,'0, 1, 2, 3, 4');
 response=await f.get('module=activity&from=2026-09-30&to=2026-09-30');assert.equal((await response.json()).report.total,1,'SQL timestamp date bounds');
 for(const role of ['sales','field','supervisor']){
  f.actor({userId:'alice',role,name:'Synthetic'});body=await(await f.get()).json();assert.equal(body.summaries.length,8);assert.deepEqual(body.employees.map(e=>e.id),['alice']);
  for(const id of ['transactions','users','audit','imports','importRows','sheets','ai']){const before=f.count;assert.equal((await f.get('module='+id)).status,403);assert.equal((await f.get('module='+id+'&format=csv')).status,403);assert.equal(f.count,before,'denied before any SQL');}
  for(const id of ['leads','followups','activity','properties','attendance','profiles','requests','announcements'])assert.equal((await f.get('module='+id+'&format=csv')).status,403);
  assert.equal((await f.get('employee=bob')).status,403);
  for(const id of ['leads','followups','activity','attendance','profiles','requests']){body=await(await f.get('module='+id)).json();assert.ok(!JSON.stringify(body.report.rows).includes('bob'),id+' other employee leakage');}
 }
 f.actor(null);const before=f.count;assert.equal((await f.get()).status,401);assert.equal(f.count,before);
 f.actor({userId:'root',role:'admin',name:'Synthetic'});
 f.fail('hr_attendance');body=await(await f.get()).json();assert.equal(body.summaries.find(r=>r.id==='attendance').total,null);assert.equal(body.summaries.find(r=>r.id==='attendance').status,'unavailable');assert.equal((await f.get('module=attendance')).status,503);assert.equal((await f.get('module=attendance&format=csv')).status,503);f.fail('');
 for(const query of ['module=bad','page=0','pageSize=1000','from=2026-02-30','format=xlsx','format=csv','unknown=value','funding=%0Ainvalid','employee=missing-user'])assert.equal((await f.get(query)).status,400,query);
 f.sql.exec('DELETE FROM ai_usage');assert.equal((await f.get('module=ai')).status,404,'empty persisted AI source is explicit unavailable');
 f.sql.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10001) INSERT INTO ai_usage SELECT 'big','2026-09-01T10',1 FROM n");
 assert.equal((await f.get('module=ai')).status,422);assert.equal((await f.get('module=ai&format=csv')).status,422);
 console.log('PASS all 15 report routes: actual SQL, every export, role denial before SQL, self HR, pagination, missing source, CSV, 10000-row bound');
}finally{f.close();}
