import {build} from 'esbuild';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const output = mkdtempSync(join(tmpdir(), 'sas-tests-'));
try {
  await build({entryPoints:['lib/lead-input.ts'],outfile:join(output,'domain.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {leadSchema} = createRequire(import.meta.url)(join(output,'domain.cjs'));
  const input={id:crypto.randomUUID(),name:'عميل تجريبي',phone:'0500000000',propertyId:'other',propertyOther:'أرض حسب الطلب',source:'إحالة',stage:'bank_approval'};
  assert.equal(leadSchema.parse(input).propertyOther,input.propertyOther);
  assert.equal(leadSchema.parse(input).source,'إحالة');
  assert.equal(leadSchema.safeParse({...input,propertyOther:' '}).success,false);
  assert.equal(leadSchema.safeParse({...input,propertyId:'unknown'}).success,false);
  assert.equal(leadSchema.safeParse({...input,followUp:'2026-02-30'}).success,false);
  console.log('PASS lead Other, source, stages, invalid property and date');
  await build({entryPoints:['lib/transactions.ts'],outfile:join(output,'finance.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {transactionSchema, confirmedDue, transactionFields} = createRequire(import.meta.url)(join(output,'finance.cjs'));
  const finance={leadId:crypto.randomUUID(),debtPayer:'company',debtSettlement:'100.25',brokerage:'20.10'};
  assert.equal(confirmedDue(transactionSchema.parse(finance)),'120.35');
  assert.equal(confirmedDue(transactionSchema.parse({...finance,debtPayer:'client'})),'20.10');
  assert.equal(confirmedDue(transactionSchema.parse({...finance,debtPayer:'unset'})),null);
  assert.equal(transactionSchema.safeParse({...finance,tax:'-1'}).success,false);
  assert.equal(transactionSchema.safeParse({...finance,tax:'1.001'}).success,false);
  assert.equal(transactionSchema.safeParse({...finance,'د=':'99'}).success,false);
  assert.equal(transactionFields.some(f=>f.label==='د='),false);
  assert.equal(transactionSchema.parse(finance).balance,'');
  console.log('PASS confirmed finance rule, precise decimals, manual unknown formulas, excluded column');
  await build({entryPoints:['components/ui/table.tsx'],outfile:join(output,'table.cjs'),bundle:true,platform:'node',format:'cjs',external:['react','react-dom']});
  // Bundle render fixture in repo resolution context (no browser/auth required).
  await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Table,TableHead,TableCell} from './components/ui/table';export const html=renderToStaticMarkup(<Table><thead><tr><TableHead>عنوان</TableHead></tr></thead><tbody><tr><TableCell>قيمة</TableCell></tr></tbody></Table>);`,resolveDir:process.cwd(),loader:'tsx'},outfile:join(output,'render.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {html}=createRequire(import.meta.url)(join(output,'render.cjs'));
  assert.match(html,/dir="rtl"/); assert.match(html,/text-start/); assert.doesNotMatch(html,/text-left/);
  console.log('PASS shared RTL table render and matching alignment');
  await build({entryPoints:['lib/hr-policy.ts'],outfile:join(output,'hr.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {validatePunch,scheduleSchema,canManageSchedule}=createRequire(import.meta.url)(join(output,'hr.cjs'));
  const schedule={latitude:24,longitude:46,radius:100,maxAccuracy:30,start:'09:00',end:'17:00',grace:10,days:[0,1,2,3,4],timezone:'Asia/Riyadh'};
  const point={latitude:24,longitude:46,accuracy:10};
  assert.equal(validatePunch(schedule,point,'in',null,new Date('2026-09-13T06:15:00Z')).lateMinutes,5);
  assert.throws(()=>validatePunch(schedule,{...point,latitude:25},'in',null,new Date()),/النطاق/);
  assert.throws(()=>validatePunch(schedule,{...point,accuracy:90},'in',null,new Date()),/دقة/);
  assert.throws(()=>validatePunch(schedule,null,'in',null,new Date()),/الموقع/);
  assert.throws(()=>validatePunch(schedule,point,'in',{check_in:'x',check_out:null},new Date()),/مسجل/);
  assert.throws(()=>validatePunch(schedule,point,'out',null,new Date()),/حضور/);
  assert.equal(canManageSchedule('sales'),false);assert.equal(canManageSchedule('admin'),true);
  assert.equal(scheduleSchema.safeParse({...schedule,start:'25:00'}).success,false);
  console.log('PASS HR geofence, accuracy, server time, duplicates, schedule authorization');
  await build({entryPoints:['lib/lead-import.ts'],outfile:join(output,'import.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {previewImport,normalizePhone,suggestMapping,parseFollowUpDate,assigneesForReady}=createRequire(import.meta.url)(join(output,'import.cjs'));
  const rows=[['عميل تجريبي','٠٥٠٠٠٠٠٠٠٠','أرض','ملاحظة'],['ثان','+966500000000','أرض','ثان'],['ناقص','bad','',''],['ثالث','0500000001','شقة','نص']];
  const mapping={name:0,phone:1,propertyOther:2,notes:3};
  const preview=previewImport(rows,mapping,[]);
  assert.deepEqual(preview.map(r=>r.status),['ready','duplicate','invalid','ready']);
  assert.equal(preview[0].lead.phone,'+966500000000');assert.deepEqual(preview[0].raw,rows[0]);
  assert.equal(previewImport(rows,mapping,['+966500000000'])[0].status,'duplicate');
  assert.equal(normalizePhone('00966500000000'),'+966500000000');
  assert.throws(()=>previewImport(rows,{name:0,phone:0},[]),/الأعمدة/);
  const namePhone=previewImport([['عميل بلا عقار','0500000002']],{name:0,phone:1},[]);
  assert.equal(namePhone[0].status,'ready');
  assert.equal(namePhone[0].lead.propertyId,'other');
  assert.equal(namePhone[0].lead.propertyOther,'غير محدد');
  assert.equal(namePhone[0].lead.stage,'new');
  const staged=previewImport([['عميل مرحلة','0500000003','تم التواصل'],['عميل مرحلة','0500000004','مرحلة مخترعة'],['عميل مرحلة','0500000005','غير مهتم']],{name:0,phone:1,stage:2},[]);
  assert.equal(staged[0].lead.stage,'contacted');
  assert.equal(staged[1].status,'ready');
  assert.equal(staged[1].lead.stage,'new');
  assert.match(staged[1].warnings[0],/مرحلة غير معروفة/);
  assert.equal(staged[2].lead.stage,'not_interested');
  assert.equal(parseFollowUpDate('15/01/2026'),'2026-01-15');
  assert.equal(previewImport([['عميل تاريخ','0500000006','15/01/2026']],{name:0,phone:1,followUp:2},[])[0].lead.followUp,'2026-01-15');
  assert.deepEqual(suggestMapping(['اسم العميل','الجوال','حالة العميل','تاريخ المتابعة']),{name:0,phone:1,stage:2,followUp:3});
  const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222';
  assert.deepEqual(assigneesForReady(4,{mode:'distribute',userIds:[a,b]}),[a,b,a,b]);
  assert.deepEqual(assigneesForReady(2,{mode:'one',userIds:[a]}),[a,a]);
  const altharaHeaders=['العمود 1','اسم العميل','رقم الجــــوال','المصدر','الطلب','الملاحظات','حاله العميل ','تاريخ التحديث','التحديث'];
  const altharaMap=suggestMapping(altharaHeaders);
  assert.deepEqual(altharaMap,{name:1,phone:2,source:3,propertyOther:4,notes:5,stage:6});
  assert.equal(altharaMap.followUp,undefined);
  const altharaRows=[
    ['45937','ابو محمد علاء خلاشي','551697456','بيوت','فيلا دورين وملحق','بانتظار البيانات','غير مؤهل','45965','ملاحظة'],
    ['45937','مشعل','594358813','داتا','-','اجل الاتصال','غير مهتم','45946','x'],
    ['45937','ولاء','582903618','داتا','','ملاحظات','غير مهتم','45939','x'],
    ['45937','محمد حريص','5568399159','داتا','شقه استثمار','تم التواصل','غير مهتم','45943','x'],
    ['45937','سامي',' 561619056\u2069','داتا','-','ملاحظات','حسبه','45950','x'],
    ['45937','خالد سداد','500765399','داتا','-','يحتاج سداد','سداد','45939','x'],
    ['45937','A','501822472','داتا','-','','غير مهتم','45940','x'],
  ];
  const althara=previewImport(altharaRows,altharaMap,[]);
  assert.deepEqual(althara.map(r=>r.status),['ready','ready','ready','ready','ready','ready','ready']);
  assert.equal(althara[0].lead.name,'ابو محمد علاء خلاشي');
  assert.equal(althara[0].lead.phone,'+966551697456');
  assert.equal(althara[0].lead.propertyOther,'فيلا دورين وملحق');
  assert.equal(althara[0].lead.stage,'unqualified');
  assert.equal(althara[1].lead.propertyOther,'غير محدد');
  assert.equal(althara[1].lead.stage,'not_interested');
  assert.equal(althara[2].lead.propertyOther,'غير محدد');
  assert.equal(althara[3].lead.phone,'+966568399159');
  assert.equal(althara[4].lead.phone,'+966561619056');
  assert.equal(althara[4].lead.stage,'calculation_done');
  assert.equal(althara[5].lead.stage,'new');
  assert.match(althara[5].warnings[0],/مرحلة غير معروفة/);
  assert.equal(althara[5].lead.propertyOther,'غير محدد');
  assert.equal(althara[6].status,'ready');
  assert.equal(althara[6].lead.name,'A');
  assert.equal(althara[6].lead.phone,'+966501822472');
  const dashOnly=previewImport([['عميل شرطة','551697456','-']],{name:0,phone:1,propertyOther:2},[]);
  assert.equal(dashOnly[0].status,'ready');
  assert.equal(dashOnly[0].lead.propertyOther,'غير محدد');
  assert.equal(dashOnly[0].lead.name,'عميل شرطة');
  const unmappedExtras=previewImport([['سارة','551111111','-','سناب','ملاحظة طويلة','غير مهتم','45965']],{name:0,phone:1},[]);
  assert.equal(unmappedExtras[0].status,'ready');
  assert.equal(unmappedExtras[0].lead.propertyOther,'غير محدد');
  assert.equal(unmappedExtras[0].errors.length,0);
  assert.equal(previewImport([['','551111112']],{name:0,phone:1},[])[0].status,'invalid');
  assert.equal(previewImport([['عميل','bad']],{name:0,phone:1},[])[0].status,'invalid');
  assert.equal(previewImport([['x','551111113','z']],{name:0,phone:1,propertyOther:2},[])[0].lead.propertyOther,'غير محدد');
  assert.deepEqual(suggestMapping(['اسم العميل','رقم الجــــوال']),{name:0,phone:1});
  assert.deepEqual(suggestMapping(['الاسم','رقم الهاتف']),{name:0,phone:1});
  assert.equal(suggestMapping(['العمود 1','اسم العميل','رقم الجوال']).phone,2);
  console.log('PASS import mapping, Arabic digits, canonical phone dedup, invalid rows and raw preservation');
  console.log('PASS import name/phone-only visibility, existing stage aliases, unknown stage warning, follow-up parse, round-robin');
  console.log('PASS Althara workbook headers, tatweel phone, dash/empty الطلب, 9-digit mobiles, حسبه/سداد stages');
  console.log('PASS unmapped optional columns never invalidate; name+phone auto-map');
  await build({entryPoints:['lib/secrets.server.ts'],outfile:join(output,'secret.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'server-only-test',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'guard',namespace:'guard'}));b.onLoad({filter:/.*/,namespace:'guard'},()=>({contents:'',loader:'js'}));}}]});
  const {seal,unseal}=createRequire(import.meta.url)(join(output,'secret.cjs'));
  delete process.env.APP_ENCRYPTION_KEY;assert.throws(()=>seal('test-provider-key','openai'));
  process.env.APP_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
  const encrypted=seal('test-provider-key','openai');assert.equal(unseal(encrypted,'openai'),'test-provider-key');assert.equal(encrypted.includes('test-provider-key'),false);
  assert.throws(()=>unseal(encrypted,'anthropic'));assert.throws(()=>unseal(encrypted.slice(0,-3)+'abc','openai'));
  delete process.env.APP_ENCRYPTION_KEY;
  console.log('PASS server secret encryption, missing key fail-closed, provider binding and tamper rejection');
  await build({entryPoints:['lib/sheets-policy.ts'],outfile:join(output,'sheets.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {sheetConfigSchema,checkSheetHeaders}=createRequire(import.meta.url)(join(output,'sheets.cjs'));
  const config={sheetId:'synthetic_sheet_id_only_123456',range:'Leads!A1:D1001',headers:['الاسم','الجوال','العقار','الملاحظات'],mapping:{name:0,phone:1,propertyOther:2,notes:3},enabled:true,sourceConfirmed:true};
  assert.equal(sheetConfigSchema.safeParse(config).success,true);
  assert.equal(sheetConfigSchema.safeParse({...config,sheetId:'https://evil.test'}).success,false);
  assert.equal(sheetConfigSchema.safeParse({...config,sourceConfirmed:false}).success,false);
  assert.throws(()=>checkSheetHeaders(config,['الجوال','الاسم','العقار','الملاحظات']));
  console.log('PASS Sheets source confirmation, bounded mapping and header-drift rejection');
  await build({entryPoints:['lib/assignment-email.ts'],outfile:join(output,'assign-mail.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {
    assignmentChanged,
    adminRecipientEmails,
    groupClientsByAssignee,
    assigneeAssignmentEmail,
    adminAssignmentEmail,
    formatClientText,
  }=createRequire(import.meta.url)(join(output,'assign-mail.cjs'));
  assert.equal(assignmentChanged('','sales-1'),true);
  assert.equal(assignmentChanged('sales-1','sales-1'),false);
  assert.equal(assignmentChanged('sales-1',''),false);
  assert.equal(assignmentChanged('sales-1','sales-2'),true);
  const admins=adminRecipientEmails([{role:'admin',email:'ops@sas.test'},{role:'sales',email:'rep@sas.test'}]);
  assert.deepEqual(admins,['ops@sas.test','sasalthra.sa@gmail.com']);
  const grouped=groupClientsByAssignee([
    {assignedTo:'a',client:{name:'علي',phone:'+966500000001'}},
    {assignedTo:'',client:{name:'تجاهل',phone:'+966500000000'}},
    {assignedTo:'a',client:{name:'سارة',phone:'+966500000002'}},
    {assignedTo:'b',client:{name:'خالد',phone:'+966500000003'}},
  ]);
  assert.equal(grouped.get('a').length,2);
  assert.equal(grouped.get('b').length,1);
  const client={name:'علي <script>',phone:'+966501234567',stage:'contacted',source:'إكسل',notes:'يريد فيلا',propertyRequest:'فيلا دورين'};
  const assigneeMail=assigneeAssignmentEmail({id:'a',name:'مندوب الاختبار',email:'rep@sas.test'},[client]);
  assert.match(assigneeMail.subject,/علي/);
  assert.match(assigneeMail.text,/الجوال: \+966501234567/);
  assert.match(assigneeMail.text,/المرحلة: تم التواصل/);
  assert.match(assigneeMail.html,/dir="rtl"/);
  assert.match(assigneeMail.html,/lang="ar"/);
  assert.match(assigneeMail.html,/علي &lt;script&gt;/);
  assert.doesNotMatch(assigneeMail.html,/<script>/);
  const bulkAssignee=assigneeAssignmentEmail({id:'a',name:'مندوب الاختبار',email:'rep@sas.test'},[client,{name:'سارة',phone:'+966509999999'}]);
  assert.match(bulkAssignee.subject,/2 عملاء/);
  assert.match(bulkAssignee.text,/عميل 2/);
  const adminMail=adminAssignmentEmail([{employee:{id:'a',name:'مندوب الاختبار',email:'rep@sas.test'},clients:[client]}]);
  assert.match(adminMail.subject,/مندوب الاختبار/);
  assert.match(adminMail.text,/rep@sas.test/);
  assert.match(adminMail.text,/المصدر: إكسل/);
  assert.match(formatClientText(client),/طلب العقار: فيلا دورين/);
  console.log('PASS assignment email copy, RTL HTML, admin recipients, grouping and change detection');
} finally { rmSync(output,{recursive:true,force:true}); }
