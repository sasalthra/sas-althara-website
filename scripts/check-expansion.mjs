import {build} from 'esbuild';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
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
  assert.equal(preview[0].lead.phone,'0500000000');assert.deepEqual(preview[0].raw,rows[0]);
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
  assert.equal(althara[0].lead.phone,'0551697456');
  assert.equal(althara[0].lead.propertyOther,'فيلا دورين وملحق');
  assert.equal(althara[0].lead.stage,'unqualified');
  assert.equal(althara[1].lead.propertyOther,'غير محدد');
  assert.equal(althara[1].lead.stage,'not_interested');
  assert.equal(althara[2].lead.propertyOther,'غير محدد');
  assert.equal(althara[3].lead.phone,'5568399159');
  assert.equal(althara[4].lead.phone,'0561619056');
  assert.equal(althara[4].lead.stage,'contacted');
  assert.equal(althara[5].lead.stage,'new');
  assert.match(althara[5].warnings[0],/مرحلة غير معروفة/);
  assert.equal(althara[5].lead.propertyOther,'غير محدد');
  assert.equal(althara[6].status,'ready');
  assert.equal(althara[6].lead.name,'A');
  assert.equal(althara[6].lead.phone,'0501822472');
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
  const wonAliases=previewImport([
    ['عميل مكسب','0500000091','مكسب'],
    ['عميل رابح','0500000092','رابح'],
    ['عميل بيع','0500000093','تم البيع'],
    ['عميل مباع','0500000094','مباع'],
    ['عميل sold','0500000095','sold'],
    ['عميل won','0500000096','won'],
  ],{name:0,phone:1,stage:2},[]);
  assert.deepEqual(wonAliases.map(r=>r.status),['ready','ready','ready','ready','ready','ready']);
  assert.deepEqual(wonAliases.map(r=>r.lead.stage),['contract_signed','contract_signed','contract_signed','contract_signed','contract_signed','contract_signed']);
  console.log('PASS import mapping, Arabic digits, canonical phone dedup, invalid rows and raw preservation');
  console.log('PASS retired won aliases import as contract_signed');
  await build({stdin:{contents:`export {stageChoices, stageWriteAllowed, canonicalStage, stageLabel, editableStage, stageEnumValues} from './lib/lead-stages.ts';
export {formatRiyadhDate, riyadhDayKey} from './lib/lead-dates.ts';
export {canToggleFeatured, compareClients, featuredControlsEnabled, isNewUnassignedLead, leadListOrderSql} from './lib/lead-featured.ts';`,resolveDir:process.cwd(),loader:'ts'},outfile:join(output,'lead-rules.cjs'),bundle:true,platform:'node',format:'cjs'});
  const rules=createRequire(import.meta.url)(join(output,'lead-rules.cjs'));
  assert.equal(rules.stageChoices('new').some(([key])=>key==='won'),false);
  assert.equal(rules.stageChoices('won').some(([key])=>key==='won'),false);
  assert.equal(rules.stageChoices('won').some(([,label])=>label==='مكسب'),false);
  assert.equal(rules.stageLabel('won'),'وقع عقد');
  assert.equal(rules.stageLabel('contract_signed'),'وقع عقد');
  assert.equal(rules.editableStage('won'),'contract_signed');
  assert.equal(rules.canonicalStage('مكسب'),'contract_signed');
  assert.equal(rules.stageWriteAllowed('won'),false);
  assert.equal(rules.stageWriteAllowed('won','new'),false);
  assert.equal(rules.stageWriteAllowed('won','won'),false);
  assert.equal(rules.stageWriteAllowed('contract_signed','won'),true);
  const choiceLabels=rules.stageChoices().map(([,label])=>label);
  assert.deepEqual(choiceLabels,[
    'عميل جديد','لم يتم الرد','تم التواصل','بانتظار العروض','تفويج للميداني','تم زيارة العقار','تفاوض',
    'تمت إحالة معاملة العميل للبنك','دفع عربون','وقع عقد','إفراغ','تم تأجيل الطلب - للمتابعة','غير مؤهل','غير مهتم','مغلق',
  ]);
  assert.equal(choiceLabels.includes('تم عمل حسبة للعميل'),false);
  assert.equal(choiceLabels.includes('مؤهل بانتظار موافقة البنك'),false);
  assert.equal(rules.canonicalStage('حسبه'),'contacted');
  assert.equal(rules.canonicalStage('تم عمل حسبة للعميل'),'contacted');
  assert.equal(rules.canonicalStage('calculation_done'),'contacted');
  assert.equal(rules.canonicalStage('مؤهل بانتظار موافقة البنك'),'bank_referred');
  assert.equal(rules.canonicalStage('bank_approval'),'bank_referred');
  assert.equal(rules.stageLabel('calculation_done'),'تم التواصل');
  assert.equal(rules.stageLabel('bank_approval'),'تمت إحالة معاملة العميل للبنك');
  assert.equal(rules.editableStage('calculation_done'),'contacted');
  assert.equal(rules.editableStage('bank_approval'),'bank_referred');
  assert.equal(rules.stageWriteAllowed('calculation_done'),false);
  assert.equal(rules.stageWriteAllowed('bank_approval'),false);
  assert.equal(rules.stageChoices().some(([key])=>key==='calculation_done'||key==='bank_approval'),false);
  for(const label of ['تم استلام العميل','تم استلام بيانات العميل','تم عرض العقارات','معاينة','مؤهل زيارة','مؤهل زيارة العقار']){
    assert.equal(choiceLabels.includes(label),false,label);
  }
  assert.equal(rules.stageChoices().some(([key])=>key==='viewing'||key==='received'||key==='data_received'||key==='visit_qualified'),false);
  assert.equal(rules.canonicalStage('تم استلام العميل'),'contacted');
  assert.equal(rules.canonicalStage('تم استلام بيانات العميل'),'contacted');
  assert.equal(rules.canonicalStage('received'),'contacted');
  assert.equal(rules.canonicalStage('data_received'),'contacted');
  assert.equal(rules.canonicalStage('تم عرض العقارات'),'awaiting_offers');
  assert.equal(rules.canonicalStage('معاينة'),'field_dispatch');
  assert.equal(rules.canonicalStage('viewing'),'field_dispatch');
  assert.equal(rules.canonicalStage('مؤهل زيارة'),'field_dispatch');
  assert.equal(rules.canonicalStage('مؤهل زيارة العقار'),'field_dispatch');
  assert.equal(rules.canonicalStage('visit_qualified'),'field_dispatch');
  assert.equal(rules.canonicalStage('بنتظار العروض'),'awaiting_offers');
  assert.equal(rules.canonicalStage('بانتظار العروض'),'awaiting_offers');
  assert.equal(rules.canonicalStage('في انتظار العروض'),'awaiting_offers');
  assert.equal(rules.canonicalStage('مؤجل'),'postponed');
  assert.equal(rules.canonicalStage('تأجيل'),'postponed');
  assert.equal(rules.canonicalStage('اعادة تواصل'),'postponed');
  assert.equal(rules.canonicalStage('إعادة تواصل'),'postponed');
  assert.equal(rules.canonicalStage('تمت إحالة معاملة العميل للبنك'),'bank_referred');
  assert.equal(rules.canonicalStage('تفويج للميداني'),'field_dispatch');
  assert.equal(rules.canonicalStage('تم تأجيل الطلب - للمتابعة'),'postponed');
  assert.equal(rules.stageLabel('viewing'),'تفويج للميداني');
  assert.equal(rules.stageLabel('received'),'تم التواصل');
  assert.equal(rules.stageLabel('data_received'),'تم التواصل');
  assert.equal(rules.stageLabel('visit_qualified'),'تفويج للميداني');
  assert.equal(rules.stageLabel('تم عرض العقارات'),'بانتظار العروض');
  assert.equal(rules.editableStage('viewing'),'field_dispatch');
  assert.equal(rules.editableStage('visit_qualified'),'field_dispatch');
  assert.equal(rules.editableStage('data_received'),'contacted');
  assert.equal(rules.editableStage('received'),'contacted');
  assert.equal(rules.stageWriteAllowed('viewing'),false);
  assert.equal(rules.stageWriteAllowed('received'),false);
  assert.equal(rules.stageWriteAllowed('data_received'),false);
  assert.equal(rules.stageWriteAllowed('visit_qualified'),false);
  assert.equal(rules.stageWriteAllowed('properties_shown'),false);
  assert.equal(rules.stageWriteAllowed('field_dispatch'),true);
  assert.equal(rules.stageWriteAllowed('awaiting_offers'),true);
  assert.equal(rules.stageWriteAllowed('bank_referred'),true);
  assert.equal(rules.stageWriteAllowed('postponed'),true);
  const retiredImport=previewImport([
    ['استلام','0500000101','تم استلام العميل'],
    ['بيانات','0500000102','تم استلام بيانات العميل'],
    ['عرض','0500000103','تم عرض العقارات'],
    ['معاينة صف','0500000104','معاينة'],
    ['زيارة','0500000105','مؤهل زيارة العقار'],
    ['بنتظار','0500000106','بنتظار العروض'],
    ['انتظار','0500000107','في انتظار العروض'],
    ['مؤجل صف','0500000108','مؤجل'],
    ['تأجيل صف','0500000109','تأجيل'],
    ['متابعة','0500000110','اعادة تواصل'],
    ['بنك','0500000111','تمت إحالة معاملة العميل للبنك'],
    ['ميدان','0500000112','تفويج للميداني'],
    ['مؤجل كامل','0500000113','تم تأجيل الطلب - للمتابعة'],
  ],{name:0,phone:1,stage:2},[]);
  assert.deepEqual(retiredImport.map(r=>r.status),retiredImport.map(()=>'ready'));
  assert.deepEqual(retiredImport.map(r=>r.lead.stage),[
    'contacted','contacted','awaiting_offers','field_dispatch','field_dispatch','awaiting_offers','awaiting_offers',
    'postponed','postponed','postponed','bank_referred','field_dispatch','postponed',
  ]);
  assert.equal(rules.featuredControlsEnabled({}),true);
  assert.equal(rules.featuredControlsEnabled({featured_available:0}),false);
  assert.equal(rules.featuredControlsEnabled({featured_available:'0'}),false);
  assert.equal(rules.featuredControlsEnabled({featured_available:1}),true);
  assert.equal(rules.riyadhDayKey('2026-09-26T21:30:00.000Z'),'2026-09-27');
  assert.equal(rules.riyadhDayKey('2026-09-27T21:00:00.000Z'),'2026-09-28');
  assert.equal(rules.riyadhDayKey('2026-09-27'),'2026-09-27');
  assert.match(rules.formatRiyadhDate('2026-09-26T21:30:00.000Z'),/27/);
  assert.match(rules.formatRiyadhDate('2026-09-26T21:30:00.000Z'),/2026/);
  assert.equal(rules.canToggleFeatured({userId:'s',role:'admin'},{assigned_to:''}),true);
  assert.equal(rules.canToggleFeatured({userId:'s',role:'supervisor'},{assigned_to:''}),true);
  assert.equal(rules.canToggleFeatured({userId:'s',role:'sales'},{assigned_to:'s'}),true);
  assert.equal(rules.canToggleFeatured({userId:'s',role:'sales'},{assigned_to:'other'}),false);
  assert.equal(rules.canToggleFeatured({userId:'f',role:'field'},{assigned_to:'f'}),false);
  const ordered=[{id:'old',is_featured:1,created_at:'2020-01-01T00:00:00.000Z'},{id:'newer',is_featured:0,created_at:'2026-09-01T00:00:00.000Z'}].sort(rules.compareClients);
  assert.equal(ordered[0].id,'old');
  assert.equal(rules.isNewUnassignedLead({assigned_to:null,stage:'new'}),true);
  assert.equal(rules.isNewUnassignedLead({assigned_to:'',stage:'new'}),true);
  assert.equal(rules.isNewUnassignedLead({assigned_to:'   ',stage:'new'}),true);
  assert.equal(rules.isNewUnassignedLead({assigned_to:'rep',stage:'new'}),false);
  assert.equal(rules.isNewUnassignedLead({assigned_to:null,stage:'contacted'}),false);
  const adminOrder=[
    {id:'featured',is_featured:1,assigned_to:'rep',stage:'contacted',created_at:'2020-01-01T00:00:00.000Z'},
    {id:'fresh',is_featured:0,assigned_to:'',stage:'new',created_at:'2026-01-01T00:00:00.000Z'},
    {id:'featured-fresh',is_featured:1,assigned_to:'   ',stage:'new',created_at:'2024-06-01T00:00:00.000Z'},
    {id:'older-fresh',is_featured:0,assigned_to:null,stage:'new',created_at:'2025-01-01T00:00:00.000Z'},
    {id:'assigned-new',is_featured:0,assigned_to:'rep',stage:'new',created_at:'2026-08-01T00:00:00.000Z'},
  ].sort(rules.compareClients);
  assert.deepEqual(adminOrder.map(row=>row.id),['fresh','older-fresh','featured-fresh','featured','assigned-new']);
  const withFeatured=rules.leadListOrderSql(true);
  const withoutFeatured=rules.leadListOrderSql(false);
  assert.match(withFeatured,/CASE WHEN leads\.stage = 'new' AND TRIM\(IFNULL\(leads\.assigned_to, ''\)\) = '' THEN 0 ELSE 1 END/);
  assert.match(withFeatured,/THEN 1 ELSE leads\.is_featured END DESC, leads\.created_at DESC/);
  assert.doesNotMatch(withoutFeatured,/is_featured/);
  assert.match(withoutFeatured,/leads\.created_at DESC/);
  assert.doesNotMatch(withFeatured,/OVER\s*\(|ROW_NUMBER|JSON_TABLE/);
  console.log('PASS featured permissions, Riyadh registration date, and retired won stage rules');
  await build({entryPoints:['lib/lead-schema.ts'],outfile:join(output,'lead-schema.cjs'),bundle:true,platform:'node',format:'cjs',external:['mysql2/promise']});
  const {ensureLeadSchema,resetLeadSchemaCache}=createRequire(import.meta.url)(join(output,'lead-schema.cjs'));
  function sqliteExecutor(db){return {async execute(sql,values=[]){const text=String(sql).trim();if(text.startsWith('SHOW'))throw Error('near SHOW: syntax error');if(text.startsWith('SELECT'))return [db.prepare(text).all(...values)];return [{affectedRows:Number(db.prepare(text).run(...values).changes)}];}};}
  const mem=new DatabaseSync(':memory:');
  mem.exec("CREATE TABLE leads(id TEXT PRIMARY KEY, stage TEXT, created_at TEXT); CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO leads VALUES ('w1','won','2020-01-01'),('n1','new','2026-01-01'),('r1','received','2020-01-01'),('d1','data_received','2020-01-01'),('p1','properties_shown','2020-01-01'),('a1','تم عرض العقارات','2020-01-01'),('v1','viewing','2020-01-01'),('q1','visit_qualified','2020-01-01'),('c1','calculation_done','2020-01-01'),('b1','bank_approval','2020-01-01'),('h1','تم عمل حسبة للعميل','2020-01-01'),('k1','مؤهل بانتظار موافقة البنك','2020-01-01');");
  resetLeadSchemaCache();
  const repaired=await ensureLeadSchema(sqliteExecutor(mem));
  assert.equal(repaired.featured,true);
  assert.equal(mem.prepare("SELECT is_featured FROM leads WHERE id='n1'").get().is_featured,0);
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='w1'").get().stage,'contract_signed');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='r1'").get().stage,'contacted');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='d1'").get().stage,'contacted');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='p1'").get().stage,'awaiting_offers');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='a1'").get().stage,'awaiting_offers');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='v1'").get().stage,'field_dispatch');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='q1'").get().stage,'field_dispatch');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='n1'").get().stage,'new');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='c1'").get().stage,'contacted');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='h1'").get().stage,'contacted');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='b1'").get().stage,'bank_referred');
  assert.equal(mem.prepare("SELECT stage FROM leads WHERE id='k1'").get().stage,'bank_referred');
  const calcHistory=mem.prepare("SELECT details FROM lead_activity WHERE lead_id='c1'").get();
  assert.match(calcHistory.details,/contacted/);
  assert.match(calcHistory.details,/تم اعتماد مرحلة تم التواصل/);
  const bankHistory=mem.prepare("SELECT details FROM lead_activity WHERE lead_id='b1'").get();
  assert.match(bankHistory.details,/bank_referred/);
  assert.match(bankHistory.details,/تمت إحالة معاملة العميل للبنك/);
  const history=mem.prepare("SELECT user_id, action, details FROM lead_activity WHERE lead_id='w1'").all();
  assert.equal(history.length,1);
  assert.equal(history[0].user_id,'system');
  assert.equal(history[0].action,'stage_changed');
  assert.match(history[0].details,/contract_signed/);
  assert.match(history[0].details,/تم اعتماد مرحلة وقع عقد/);
  const viewingHistory=mem.prepare("SELECT details FROM lead_activity WHERE lead_id='v1'").get();
  assert.match(viewingHistory.details,/field_dispatch/);
  assert.match(viewingHistory.details,/تم اعتماد مرحلة تفويج للميداني/);
  assert.equal(mem.prepare('SELECT COUNT(*) AS n FROM lead_activity').get().n,11,'one history row per converted lead');
  assert.equal(mem.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='leads_featured_idx'").all().length,1);
  resetLeadSchemaCache();
  await ensureLeadSchema(sqliteExecutor(mem));
  assert.equal(mem.prepare('SELECT COUNT(*) AS n FROM lead_activity').get().n,11,'a second repair does not write another history row');
  const locked=new DatabaseSync(':memory:');
  locked.exec("CREATE TABLE leads(id TEXT PRIMARY KEY, stage TEXT, created_at TEXT); CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT); INSERT INTO leads VALUES ('w2','won','2020-01-01'),('v2','viewing','2020-01-01');");
  resetLeadSchemaCache();
  const lockedState=await ensureLeadSchema({async execute(sql,values=[]){const text=String(sql).trim();if(text.startsWith('SHOW')||text.startsWith('ALTER')||text.startsWith('CREATE'))throw Error('schema locked');if(text.startsWith('SELECT'))return [locked.prepare(text).all(...values)];return [{affectedRows:Number(locked.prepare(text).run(...values).changes)}];}});
  assert.equal(lockedState.featured,false);
  assert.equal(locked.prepare("SELECT stage FROM leads WHERE id='w2'").get().stage,'contract_signed');
  assert.equal(locked.prepare("SELECT stage FROM leads WHERE id='v2'").get().stage,'field_dispatch');
  resetLeadSchemaCache();
  const failed=await ensureLeadSchema({async execute(){throw Error('access denied');}});
  assert.equal(failed.featured,false);
  const cachedFailure=await ensureLeadSchema({async execute(){throw Error('should stay cached');}});
  assert.equal(cachedFailure.featured,false);
  resetLeadSchemaCache();
  const enumDb=new DatabaseSync(':memory:');
  enumDb.exec("CREATE TABLE leads(id TEXT PRIMARY KEY, stage TEXT, created_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0); CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO leads (id,stage,created_at) VALUES ('r9','received','2020-01-01'),('v9','viewing','2020-01-01'),('ok','new','2026-01-01');");
  const calls=[];
  const widened=await ensureLeadSchema({async execute(sql,values=[]){const text=String(sql).trim();calls.push(text);if(text.startsWith('SHOW COLUMNS'))return [[{Field:'stage',Type:"enum('new','received','contacted','viewing','won','closed')"},{Field:'is_featured',Type:'tinyint(1)'}]];if(text.startsWith('SHOW'))return [[]];if(text.startsWith('ALTER TABLE leads MODIFY COLUMN stage'))return [{affectedRows:0}];if(text.startsWith('ALTER')||text.startsWith('CREATE'))return [{affectedRows:0}];if(text.startsWith('SELECT'))return [enumDb.prepare(text).all(...values)];return [{affectedRows:Number(enumDb.prepare(text).run(...values).changes)}];}});
  assert.equal(widened.featured,true);
  const alter=calls.find(sql=>sql.startsWith('ALTER TABLE leads MODIFY COLUMN stage'));
  assert.ok(alter,'an ENUM stage column is widened before rows are moved');
  const members=[...alter.matchAll(/'([^']+)'/g)].map(m=>m[1]);
  assert.deepEqual(members.slice(0,6),['new','received','contacted','viewing','won','closed']);
  for(const key of ['awaiting_offers','field_dispatch','bank_referred','postponed','properties_shown','visit_qualified','data_received'])assert.ok(members.includes(key),key);
  const alterAt=calls.findIndex(sql=>sql.startsWith('ALTER TABLE leads MODIFY COLUMN stage'));
  const updateAt=calls.findIndex(sql=>sql.startsWith('UPDATE leads SET stage'));
  assert.ok(updateAt>alterAt,'rows move only after the ENUM includes the new keys');
  assert.equal(enumDb.prepare("SELECT stage FROM leads WHERE id='r9'").get().stage,'contacted');
  assert.equal(enumDb.prepare("SELECT stage FROM leads WHERE id='v9'").get().stage,'field_dispatch');
  assert.equal(enumDb.prepare("SELECT stage FROM leads WHERE id='ok'").get().stage,'new');
  assert.equal(enumDb.prepare('SELECT COUNT(*) AS n FROM lead_activity').get().n,2);
  calls.length=0;
  resetLeadSchemaCache();
  await ensureLeadSchema({async execute(sql,values=[]){const text=String(sql).trim();calls.push(text);if(text.includes('MODIFY COLUMN stage'))throw Error('enum locked');if(text.startsWith('SHOW COLUMNS'))return [[{Field:'stage',Type:"enum('new','won')"},{Field:'is_featured',Type:'tinyint(1)'}]];if(text.startsWith('SHOW')||text.startsWith('ALTER')||text.startsWith('CREATE'))return [[]];if(text.startsWith('SELECT'))return [enumDb.prepare(text).all(...values)];return [{affectedRows:Number(enumDb.prepare(text).run(...values).changes)}];}});
  assert.equal(enumDb.prepare('SELECT COUNT(*) AS n FROM lead_activity').get().n,2,'a failed ENUM change does not duplicate history');
  const usersDb=new DatabaseSync(':memory:');
  usersDb.exec("CREATE TABLE leads(id TEXT PRIMARY KEY, stage TEXT, created_at TEXT, is_featured INTEGER NOT NULL DEFAULT 0); CREATE TABLE lead_activity(id TEXT PRIMARY KEY, lead_id TEXT, user_id TEXT, action TEXT, details TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE crm_users(id TEXT PRIMARY KEY, email TEXT); INSERT INTO crm_users (id, email) VALUES ('u1','old@sas.test');");
  resetLeadSchemaCache();
  await ensureLeadSchema(sqliteExecutor(usersDb));
  assert.equal(usersDb.prepare("SELECT name FROM pragma_table_info('crm_users') WHERE name='phone'").get().name,'phone');
  resetLeadSchemaCache();
  await ensureLeadSchema(sqliteExecutor(usersDb));
  assert.equal(usersDb.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('crm_users') WHERE name='phone'").get().n,1,'phone column is added once');
  usersDb.close();
  mem.close();locked.close();enumDb.close();
  console.log('PASS runtime schema repair adds is_featured, converts won once, and fails closed');
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
  await build({entryPoints:['lib/user-contact.ts'],outfile:join(output,'user-contact.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {parseUserEmail,parseUserPhone,parseUserName,parseUsername,withLiveActivityNames}=createRequire(import.meta.url)(join(output,'user-contact.cjs'));
  assert.deepEqual(parseUserName('  عهود  '),{ok:true,value:'عهود'});
  assert.equal(parseUserName('').ok,false);
  assert.equal(parseUserName('   ').ok,false);
  assert.equal(parseUserName('ع').ok,false);
  assert.equal(parseUserName('ن'.repeat(100)).ok,true);
  assert.equal(parseUserName('ن'.repeat(101)).ok,false);
  assert.deepEqual(parseUsername('  Ohoud.Sales  '),{ok:true,value:'ohoud.sales'});
  assert.equal(parseUsername('').ok,false);
  assert.equal(parseUsername('   ').ok,false);
  assert.equal(parseUsername('ab').ok,false);
  assert.equal(parseUsername('a'.repeat(80)).ok,true);
  assert.equal(parseUsername('a'.repeat(81)).ok,false);
  assert.equal(parseUsername('bad name').ok,false);
  assert.equal(parseUsername('عهود').ok,false);
  assert.equal(parseUsername('ohoud_sales-1.2').ok,true);
  const snapshot={fieldAssignedTo:'field-1',fieldAssignedName:'خالد الميداني',dispatchedByName:'أحمد المبيعات',note:'زيارة'};
  assert.equal(withLiveActivityNames(snapshot,{actorName:'إدارة الثراء',fieldName:'نورة الميدان'}).fieldAssignedName,'نورة الميدان');
  assert.equal(withLiveActivityNames(snapshot,{actorName:'إدارة الثراء',fieldName:'نورة الميدان'}).dispatchedByName,'إدارة الثراء');
  assert.equal(withLiveActivityNames(snapshot,{actorName:'',fieldName:''}).fieldAssignedName,'خالد الميداني','a missing person keeps the stored snapshot');
  assert.equal(snapshot.fieldAssignedName,'خالد الميداني','the stored snapshot object is not rewritten');
  assert.deepEqual(parseUserEmail(' Fresh.Rep@sas.test '),{ok:true,value:'fresh.rep@sas.test'});
  assert.deepEqual(parseUserEmail(''),{ok:true,value:''});
  assert.equal(parseUserEmail('not-an-email').ok,false);
  assert.deepEqual(parseUserPhone('0501111111'),{ok:true,value:'+966501111111'});
  assert.deepEqual(parseUserPhone('00966501111111'),{ok:true,value:'+966501111111'});
  assert.deepEqual(parseUserPhone('966501111111'),{ok:true,value:'+966501111111'});
  assert.deepEqual(parseUserPhone(''),{ok:true,value:''});
  assert.equal(parseUserPhone('123').ok,false);
  console.log('PASS employee display name, login username, email format and Saudi mobile normalization');
  await build({entryPoints:['lib/assignment-email.ts'],outfile:join(output,'assign-mail.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {
    assignmentChanged,
    adminRecipientEmails,
    groupClientsByAssignee,
    assigneeAssignmentEmail,
    adminAssignmentEmail,
    fieldDispatchEmail,
    adminFieldDispatchEmail,
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
  const dispatchMail=fieldDispatchEmail({dispatcherName:'أحمد المبيعات',employeeName:'خالد الميداني',client,url:'https://sas.test/crm/leads/lead-1',dispatchNote:'زيارة غداً'});
  assert.match(dispatchMail.subject,/علي/);
  assert.match(dispatchMail.text,/أحمد المبيعات/);
  assert.match(dispatchMail.text,/خالد الميداني/);
  assert.match(dispatchMail.text,/الجوال: \+966501234567/);
  assert.match(dispatchMail.text,/طلب العقار: فيلا دورين/);
  assert.match(dispatchMail.text,/الملاحظات: يريد فيلا/);
  assert.match(dispatchMail.text,/زيارة غداً/);
  assert.match(dispatchMail.text,/https:\/\/sas\.test\/crm\/leads\/lead-1/);
  assert.match(dispatchMail.html,/dir="rtl"/);
  assert.match(dispatchMail.html,/lang="ar"/);
  assert.match(dispatchMail.html,/#3F1A44/);
  assert.match(dispatchMail.html,/علي &lt;script&gt;/);
  assert.doesNotMatch(dispatchMail.html,/<script>/);
  assert.doesNotMatch(dispatchMail.html,/info@/);
  assert.doesNotMatch(dispatchMail.text,/info@/);
  const adminDispatch=adminFieldDispatchEmail({dispatcherName:'أحمد المبيعات',employeeName:'خالد الميداني',client,url:'https://sas.test/crm/leads/lead-1'});
  assert.match(adminDispatch.subject,/خالد الميداني/);
  assert.match(adminDispatch.subject,/أحمد المبيعات/);
  assert.match(adminDispatch.text,/https:\/\/sas\.test\/crm\/leads\/lead-1/);
  assert.match(adminDispatch.html,/#3F1A44/);
  console.log('PASS assignment email copy, RTL HTML, admin recipients, grouping and change detection');
  console.log('PASS field dispatch email names the sales rep, client, property, notes and client link');
  const previousSmtp={
    SMTP_HOST:process.env.SMTP_HOST,
    SMTP_PORT:process.env.SMTP_PORT,
    SMTP_SECURE:process.env.SMTP_SECURE,
    SMTP_USER:process.env.SMTP_USER,
    SMTP_PASSWORD:process.env.SMTP_PASSWORD,
    SMTP_PASS:process.env.SMTP_PASS,
    SMTP_FROM:process.env.SMTP_FROM,
  };
  try{
    for(const key of Object.keys(previousSmtp)) delete process.env[key];
    process.env.SMTP_HOST='smtp.gmail.com';
    process.env.SMTP_PORT='465';
    process.env.SMTP_USER='sasalthra.sa@gmail.com';
    process.env.SMTP_PASSWORD='test-app-password';
    globalThis.smtpSent=[];
    await build({entryPoints:['lib/mail.ts'],outfile:join(output,'smtp-mail.cjs'),bundle:true,platform:'node',format:'cjs',plugins:[{name:'nodemailer-mock',setup(b){
      b.onResolve({filter:/^nodemailer$/},()=>({path:'nodemailer',namespace:'mail-test'}));
      b.onLoad({filter:/.*/,namespace:'mail-test'},()=>({loader:'js',contents:'export default {createTransport(opts){globalThis.smtpOpts=opts;return {async sendMail(msg){globalThis.smtpSent.push(msg);}}}};'}));
    }}]});
    const {sendMail}=createRequire(import.meta.url)(join(output,'smtp-mail.cjs'));
    assert.equal(await sendMail({to:'rep@sas.test',subject:'تعيين',text:'نص'}),true);
    assert.equal(globalThis.smtpOpts.host,'smtp.gmail.com');
    assert.equal(globalThis.smtpSent[0].from,'ساس الثراء <sasalthra.sa@gmail.com>');
    assert.doesNotMatch(globalThis.smtpSent[0].from,/info@/);
    process.env.SMTP_FROM='Custom <other@sas.test>';
    assert.equal(await sendMail({to:'rep@sas.test',subject:'تعيين',text:'نص'}),true);
    assert.equal(globalThis.smtpSent[1].from,'Custom <other@sas.test>');
  } finally {
    for(const [key,value] of Object.entries(previousSmtp)){
      if(value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
  }
  console.log('PASS assignment SMTP from defaults to Gmail, not info@');
} finally { rmSync(output,{recursive:true,force:true}); }
