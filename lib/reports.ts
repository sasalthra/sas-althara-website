import {reportCatalog,type ReportColumn,type ReportResult,type ReportRow,type ReportId} from './report-catalog';
import {retiredStageMap, stageLabel, stageMatchKeys, stagePipelineIndex} from './lead-stages';
import {COHORT_DEFINITIONS,completionRate,conversionRate,isClosedStage,isContactedStage,isInactiveLead,isInterestedStage,isNotInterestedStage,isOverdueFollowUp,isPastFreshStage,isSignedStage,isUnassignedNew,isUnassignedNewWaiting,matchUser,normalizeSource,orderedStages,stageKeyOf,type DirectoryUser} from './lead-cohorts';
export class ReportError extends Error {constructor(public status:number,message:string){super(message);}}
type Actor={userId:string;role:string};
type Database={prepare(sql:string):{bind(...args:(string|number|null)[]):{all():Promise<{results:Record<string,unknown>[]}>}}};
export type ReportFilters={from:string;to:string;employee:string;source:string;stage:string;funding:string;page:number;pageSize:number};
const REPORT_QUERY_KEYS=new Set(['module','format','from','to','employee','source','stage','funding','page','pageSize']);
function riyadhDay(now:Date){return new Date(now.getTime()+3*60*60*1000).toISOString().slice(0,10);}
export function parseReportFilters(query:URLSearchParams,now=new Date()):ReportFilters {
 for(const key of query.keys())if(!REPORT_QUERY_KEYS.has(key))throw new ReportError(400,'مرشح غير معروف');
 for(const key of REPORT_QUERY_KEYS)if(query.getAll(key).length>1)throw new ReportError(400,'لا يسمح بتكرار المرشح');
 const today=riyadhDay(now),start=new Date(today+'T00:00:00.000Z');start.setUTCDate(start.getUTCDate()-29);const defaultFrom=start.toISOString().slice(0,10);
 const date=(key:string,fallback:string)=>{const v=query.get(key)||fallback;if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new ReportError(400,'تاريخ غير صالح');return v;};
 const from=date('from',defaultFrom),to=date('to',today);if(from>to)throw new ReportError(400,'ترتيب تاريخ الفترة غير صالح');
 const text=(key:string)=>{const raw=query.get(key)||'';if(raw.length>255||/[\u0000-\u001f\u007f]/.test(raw))throw new ReportError(400,'مرشح نصي غير صالح أو أطول من المسموح');return raw.trim();};
 const positive=(key:string,fallback:number,max:number)=>{const v=query.get(key);if(v===null)return fallback;if(!/^\d+$/.test(v)||Number(v)<1||Number(v)>max)throw new ReportError(400,'صفحة غير صالحة');return Number(v);};
 return {from,to,employee:text('employee'),source:text('source'),stage:text('stage'),funding:text('funding'),page:positive('page',1,10000),pageSize:positive('pageSize',25,100)};
}
// HEX(LOWER()) compares user ids without mixing ascii_bin columns and utf8mb4 parameters (MySQL 1267).
const leadFrom='leads l LEFT JOIN crm_users s ON HEX(LOWER(s.id))=HEX(LOWER(l.assigned_to)) LEFT JOIN crm_users f ON HEX(LOWER(f.id))=HEX(LOWER(l.field_assigned_to))';
const leadFields='l.id,l.name,l.property_id,l.property_other,l.source,l.stage,l.follow_up,l.created_at,l.updated_at,s.name AS sales,f.name AS field,l.assigned_to AS assigned_raw,l.field_assigned_to AS field_raw';
type Spec={select:string;from:string;date?:string;employee?:string;lead?:boolean;fixed?:string;order:string;columns:string[][];groups?:string[]};
const specs:Record<Exclude<ReportId,'properties'>,Spec>={
 leads:{select:leadFields,from:leadFrom,date:'l.created_at',lead:true,order:'l.created_at DESC,l.id',columns:[['id','معرف العميل'],['name','العميل'],['source','المصدر'],['stage','المرحلة الحالية'],['sales','المبيعات'],['field','الميدان'],['property_id','معرف العقار'],['property_other','عقار آخر'],['follow_up','المتابعة'],['created_at','الإنشاء UTC']],groups:['source','stage','sales','field']},
 followups:{select:leadFields,from:leadFrom,date:'l.follow_up',lead:true,fixed:"l.follow_up <> ''",order:'l.follow_up,l.id',columns:[['id','معرف العميل'],['name','العميل'],['follow_up','الموعد الحالي'],['follow_up_age','عمر المتابعة بتوقيت الرياض'],['stage','المرحلة'],['sales','المبيعات'],['field','الميدان']],groups:['follow_up_age','stage','sales']},
 activity:{select:'a.id,a.lead_id,a.user_id,a.action,CAST(a.created_at AS CHAR) AS created_at',from:'lead_activity a JOIN leads l ON l.id=a.lead_id',date:'a.created_at',lead:true,order:'a.created_at DESC,a.id',columns:[['id','معرف الحدث'],['lead_id','العميل'],['user_id','الفاعل'],['action','العمل'],['created_at','الوقت المخزن — منطقة DB']],groups:['action','user_id']},
 transactions:{select:'t.id,t.lead_id,t.data,t.confirmed_due,t.updated_at,l.name,l.source,l.stage,l.property_id,s.name AS sales,f.name AS field,l.assigned_to AS assigned_raw,l.field_assigned_to AS field_raw',from:'crm_transactions t JOIN leads l ON l.id=t.lead_id LEFT JOIN crm_users s ON HEX(LOWER(s.id))=HEX(LOWER(l.assigned_to)) LEFT JOIN crm_users f ON HEX(LOWER(f.id))=HEX(LOWER(l.field_assigned_to))',date:'t.updated_at',lead:true,order:'t.updated_at DESC,t.id',columns:[],groups:['fundingEntity','debtPayer','requestStage']},
 attendance:{select:'a.user_id,u.name,a.work_day,a.check_in,a.check_out,a.late_minutes',from:'hr_attendance a LEFT JOIN crm_users u ON u.id=a.user_id',date:'a.work_day',employee:'a.user_id',order:'a.work_day DESC,a.user_id',columns:[['user_id','الموظف'],['name','الاسم'],['work_day','يوم العمل'],['check_in','الحضور UTC'],['check_out','الانصراف UTC'],['hours','ساعات مكتملة'],['late_minutes','دقائق التأخير المسجلة']],groups:['name']},
 profiles:{select:'p.user_id,u.name,p.job_title,p.department,p.leave_balance,p.updated_at,p.schedule',from:'hr_profiles p LEFT JOIN crm_users u ON u.id=p.user_id',employee:'p.user_id',order:'p.user_id',columns:[['user_id','الموظف'],['name','الاسم'],['job_title','الوظيفة'],['department','القسم'],['leave_balance','رصيد الإجازة اليدوي'],['schedule_status','الدوام الحالي'],['shift','وقت الدوام الحالي'],['timezone','منطقة الدوام'],['work_days','أيام الدوام الحالي (0 الأحد–6 السبت)'],['grace_minutes','السماح الحالي بالدقائق'],['updated_at','آخر تعديل UTC']],groups:['department','schedule_status']},
 requests:{select:'r.id,r.user_id,u.name,r.type,r.status,r.created_at,r.start_date,r.end_date,r.reviewed_at',from:'hr_requests r LEFT JOIN crm_users u ON u.id=r.user_id',date:'r.created_at',employee:'r.user_id',order:'r.created_at DESC,r.id',columns:[['id','معرف الطلب'],['user_id','الموظف'],['name','الاسم'],['type','الخدمة'],['status','الحالة الحالية'],['created_at','الطلب UTC'],['start_date','بداية الإجازة'],['end_date','نهاية الإجازة'],['reviewed_at','المراجعة UTC']],groups:['type','status']},
 announcements:{select:'id,title,created_at',from:'hr_announcements',date:'created_at',order:'created_at DESC,id',columns:[['id','المعرف'],['title','الإعلان'],['created_at','النشر UTC']]},
 users:{select:'id,name,role,active,CAST(created_at AS CHAR) AS created_at',from:'crm_users',employee:'id',order:'id',columns:[['id','المعرف'],['name','الاسم'],['role','الدور'],['active','فعال'],['created_at','إنشاء الحساب']],groups:['role','active']},
 audit:{select:'id,actor_id,action,created_at',from:'crm_audit',date:'created_at',employee:'actor_id',order:'created_at DESC,id',columns:[['id','الحدث'],['actor_id','الفاعل'],['action','العمل'],['created_at','الوقت UTC']],groups:['action','actor_id']},
 imports:{select:"id,actor_id,created_at,JSON_EXTRACT(details,'$.inserted') AS inserted",from:'crm_audit',date:'created_at',employee:'actor_id',fixed:"action='leads.import'",order:'created_at DESC,id',columns:[['id','معرف التشغيل'],['actor_id','الفاعل'],['inserted','صفوف مقبولة'],['created_at','الوقت UTC']],groups:['actor_id']},
 importRows:{select:'r.id,r.lead_id,r.source,r.created_at',from:'crm_import_rows r JOIN leads l ON l.id=r.lead_id',date:'r.created_at',lead:true,order:'r.created_at DESC,r.id',columns:[['id','معرف الصف'],['lead_id','العميل'],['source','مصدر الاستيراد'],['created_at','الوقت UTC']],groups:['source']},
 sheets:{select:"id,last_run,JSON_EXTRACT(config,'$.enabled') AS enabled,JSON_EXTRACT(config,'$.sourceConfirmed') AS sourceConfirmed,JSON_EXTRACT(last_result,'$.error') AS failed,JSON_EXTRACT(last_result,'$.inserted') AS inserted,JSON_EXTRACT(last_result,'$.duplicates') AS duplicates,JSON_EXTRACT(last_result,'$.invalid') AS invalid",from:'crm_integrations',fixed:"id='sheets'",order:'id',columns:[['id','التكامل'],['enabled','حالة الإعداد'],['sourceConfirmed','اعتماد المصدر'],['last_run','آخر تشغيل UTC'],['health','الحالة المحفوظة'],['inserted','المقبول'],['duplicates','المكرر'],['invalid','غير الصالح']]},
 ai:{select:'user_id,hour_key,requests',from:'ai_usage',date:'hour_key',employee:'user_id',order:'hour_key DESC,user_id',columns:[['user_id','المستخدم'],['hour_key','الساعة UTC'],['requests','محاولات الطلبات']],groups:['user_id']},
};
const financeFields=[['brokerage','السعي — مدخل'],['companyDebt','سداد الشركة للمديونية'],['clientDebt','سداد العميل المباشر — ليس تحصيلاً'],['confirmed_due','المستحق المؤكد حسب القاعدة'],['companyDeposit','عربون الشركة — يدوي'],['companyValuation','تقييم الشركة — يدوي'],['companyPayments','دفعات الشركة — يدوي'],['totalPayments','إجمالي مدفوعات — يدوي مستقل'],['brokerageCheque','تحصيل شيك سعي — يدوي'],['ownerCollection','تحصيل المالك — يدوي'],['clientCollection','تحصيل العميل للشركة — يدوي'],['totalCollections','إجمالي متحصلات — يدوي مستقل'],['totalDue','إجمالي مستحق — يدوي مستقل'],['balance','رصيد — يدوي مستقل'],['tax','ضريبة — يدوي'],['netCommission','صافي العمولة — يدوي'],['fundingAmount','تمويل — يدوي'],['propertyValue','قيمة عقار — يدوي'],['refund','استرداد — يدوي'],['brokerCommission','عمولة وسيط — يدوي'],['externalExpenses','مصروفات خارجية — يدوي'],['buyerDeposit','عربون المشتري — يدوي']];
specs.transactions.columns=[['id','المعاملة'],['lead_id','العميل'],['name','اسم العميل'],['property_id','العقار'],['source','المصدر'],['stage','مرحلة العميل الحالية'],['sales','المبيعات'],['field','الميدان'],['financeEmployeeId','موظف التمويل'],['fundingEntity','جهة التمويل'],['requestStage','مرحلة طلب التمويل'],['debtPayer','جهة سداد الدين'],['updated_at','التحديث UTC'],...financeFields];
function object(value:unknown):Record<string,unknown>{if(typeof value==='string')return JSON.parse(value);return value&&typeof value==='object'?value as Record<string,unknown>:{};}
function cell(value:unknown):string|number|null {if(value==null||value==='')return null;if(value instanceof Date)return value.toISOString();return typeof value==='number'?value:String(value);}
export function sumDecimal(values:unknown[]):{value:string|null;missing:number}{
 let total=BigInt(0),known=0;for(const v of values){if(v===null||v===undefined||v==='')continue;const s=String(v);if(!/^-?\d{1,15}(\.\d{1,2})?$/.test(s))throw new ReportError(503,'قيمة مالية غير صالحة؛ لم يحسب المجموع');const negative=s.startsWith('-'),[whole,fraction='']=s.replace('-','').split('.');const amount=BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'));total+=negative?-amount:amount;known++;}
 const absolute=total<BigInt(0)?-total:total;return {value:known?`${total<BigInt(0)?'-':''}${absolute/BigInt(100)}.${String(absolute%BigInt(100)).padStart(2,'0')}`:null,missing:values.length-known};
}
export function authorizeReport(user:Actor,id:string,filters:ReportFilters,exporting=false){
 if(!['admin','supervisor','sales','field'].includes(user.role))throw new ReportError(403,'لا تملك الصلاحية');
 const meta=reportCatalog.find(r=>r.id===id);if(!meta)throw new ReportError(400,'تقرير غير معروف');
 if((meta.admin||exporting)&&user.role!=='admin')throw new ReportError(403,'لا تملك صلاحية هذا التقرير أو التصدير');
 if(user.role!=='admin'&&filters.employee&&filters.employee!==user.userId)throw new ReportError(403,'الموظف غير مسموح');return meta;
}
function hexEq(expr:string){return `HEX(LOWER(${expr}))=HEX(LOWER(?))`;}
function hexAny(exprs:string[],values:string[]){
 const unique=[...new Set(values.map(value=>value.trim()).filter(Boolean))];
 const parts:string[]=[],args:string[]=[];
 for(const expr of exprs)for(const value of unique){parts.push(hexEq(expr));args.push(value);}
 return {sql:parts.length?`(${parts.join(' OR ')})`:'',args};
}
function where(spec:Spec,user:Actor,f:ReportFilters,employeeTokens:string[]=[]){
 const clauses:string[]=[],args:(string|number|null)[]=[];const add=(sql:string,...values:(string|number|null)[])=>{if(sql){clauses.push(sql);args.push(...values);}};
 if(spec.fixed)add(spec.fixed);
 if(spec.lead){
  if(user.role!=='admin'){
   const columns=['l.owner','l.created_by'];
   if(user.role==='field')columns.push('l.field_assigned_to');
   else if(user.role==='supervisor')columns.push('l.assigned_to','l.field_assigned_to');
   else columns.push('l.assigned_to');
   const scope=hexAny(columns,[user.userId]);add(scope.sql,...scope.args);
  }
  if(f.employee){
   const tokens=employeeTokens.length?employeeTokens:[f.employee];
   const columns=['l.assigned_to','l.field_assigned_to','l.owner','l.created_by'];
   if(spec===specs.transactions)columns.push("JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.financeEmployeeId'))");
   const match=hexAny(columns,tokens);add(match.sql,...match.args);
  }
  if(f.source)add(hexEq('l.source'),f.source);
  if(f.stage){
    if(spec===specs.transactions)add(hexEq("JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.requestStage'))"),f.stage);
    else {const keys=stageMatchKeys(f.stage);const match=hexAny(['l.stage'],keys);add(match.sql,...match.args);}
  }
  if(f.funding&&spec===specs.transactions)add(hexEq("JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.fundingEntity'))"),f.funding);
 } else if(spec.employee){
  if(user.role!=='admin')add(hexEq(spec.employee),user.userId);
  else if(f.employee){const tokens=employeeTokens.length?employeeTokens:[f.employee];const match=hexAny([spec.employee],tokens);add(match.sql,...match.args);}
 }
 // Date-only fields are already local work/calendar days. UTC text/timestamps are shifted to fixed Riyadh UTC+03 (Saudi Arabia has no DST).
 if(spec.date){const localDate=['l.follow_up','a.work_day'].includes(spec.date)?`SUBSTRING(${spec.date},1,10)`:`SUBSTRING(CONVERT_TZ(CAST(${spec.date} AS CHAR),'+00:00','+03:00'),1,10)`;add(`${localDate} >= ?`,f.from);add(`${localDate} <= ?`,f.to);}
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
}
const tokenCache=new WeakMap<object,Map<string,Promise<string[]>>>();
async function employeeTokens(db:Database,employee:string):Promise<string[]>{
 const tokens=new Set<string>();const add=(value:unknown)=>{const text=String(value??'').trim();if(text)tokens.add(text);};
 add(employee);
 if(!employee.trim())return [];
 const queries=[
  `SELECT id, name, username FROM crm_users WHERE ${hexEq('id')} OR ${hexEq('username')} OR ${hexEq('name')} LIMIT 5`,
  `SELECT id, name FROM crm_users WHERE ${hexEq('id')} OR ${hexEq('name')} LIMIT 5`,
 ];
 for(const sql of queries){
  try{
   const marks=(sql.match(/\?/g)||[]).length;
   const rows=await db.prepare(sql).bind(...Array.from({length:marks},()=>employee)).all();
   for(const row of rows.results){add(row.id);add(row.name);add(row.username);}
   break;
  }catch(error){
   const message=error instanceof Error?error.message:'';
   if(!/username|no such column|unknown column/i.test(message))break;
  }
 }
 return [...tokens];
}
function cachedTokens(db:Database,employee:string){
 let map=tokenCache.get(db);if(!map){map=new Map();tokenCache.set(db,map);}
 let pending=map.get(employee);
 if(!pending){pending=employeeTokens(db,employee).catch(error=>{map!.delete(employee);throw error;});map.set(employee,pending);}
 return pending;
}
async function loadUsers(db:Database):Promise<DirectoryUser[]>{
 const queries=[
  'SELECT id, name, username FROM crm_users ORDER BY name, id LIMIT 10001',
  'SELECT id, name FROM crm_users ORDER BY name, id LIMIT 10001',
 ];
 let last:unknown;
 for(const sql of queries){
  try{
   const rows=await db.prepare(sql).bind().all();
   return rows.results.map(row=>({id:String(row.id??''),name:String(row.name??'').trim()||String(row.id??''),username:String(row.username??'').trim()}));
  }catch(error){
   last=error;
   const message=error instanceof Error?error.message:'';
   if(!/username|no such column|unknown column/i.test(message))throw error;
  }
 }
 throw last instanceof Error?last:new ReportError(503,'تعذر قراءة الموظفين');
}
function fillAssigneeNames(record:Record<string,unknown>,users:DirectoryUser[]){
 if(!record.sales){const user=matchUser(users,record.assigned_raw);if(user)record.sales=user.name;}
 if(!record.field){const user=matchUser(users,record.field_raw);if(user)record.field=user.name;}
}
export async function readReport(db:Database,user:Actor,id:string,f:ReportFilters,options:{exporting?:boolean;properties?:Record<string,unknown>[];now?:Date}={}):Promise<ReportResult>{
 const meta=authorizeReport(user,id,f,options.exporting),now=options.now||new Date();
 const tokens=f.employee?await cachedTokens(db,f.employee):[];
 if(id==='properties'){
  // Read the same authorized bounded data, not only the visible first page.
  const spec=specs.leads,w=where(spec,user,f,tokens);const result=await db.prepare(`SELECT l.property_id,l.property_other FROM leads l${w.sql} ORDER BY l.id LIMIT 10001`).bind(...w.args).all();
  if(result.results.length>10000)throw new ReportError(422,'أكثر من 10000 سجل؛ ضيق الفترة أو المرشحات');
  const counts=new Map<string,number>();for(const r of result.results){const key=String(r.property_id||'other');counts.set(key,(counts.get(key)||0)+1);}
  const rows:ReportRow[]=(options.properties||[]).map(p=>({id:String(p.id),title:cell(p.title),status:cell(p.status)??'غير مسجل في الكتالوج',city:cell(p.city)??'غير مسجل في الكتالوج',price:cell(p.price),area:cell(p.area),demand:counts.get(String(p.id))||0}));
  for(const [key,count] of counts)if(!rows.some(p=>p.id===key))rows.push({id:key,title:key==='other'?'عقار آخر — وصف في ملف العميل':'معرف غير موجود بالكتالوج',status:'غير مسجل في الكتالوج',city:'غير مسجل في الكتالوج',price:null,area:null,demand:count});
  const columns=[['id','معرف العقار'],['title','العقار'],['status','حالة الكتالوج'],['city','المدينة'],['price','سعر معلن — ليس إيراداً'],['area','المساحة'],['demand','عملاء مرتبطون ضمن النطاق']].map(([key,label])=>({key,label}));
  const groups:ReportResult['groups']={};for(const key of ['status','city']){const grouped=new Map<string,number>();for(const row of rows){const label=String(row[key]??'غير مسجل في الكتالوج');grouped.set(label,(grouped.get(label)||0)+1);}groups[key]=Array.from(grouped,([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));}
  return {...meta,columns,total:rows.length,page:f.page,pageSize:f.pageSize,rows:options.exporting?rows:rows.slice((f.page-1)*f.pageSize,f.page*f.pageSize),groups,metrics:[{label:'روابط العملاء المصرح بها',value:result.results.length},{label:'عقارات الكتالوج الحالي',value:(options.properties||[]).length}],generatedAt:now.toISOString()};
 }
 const spec=specs[id as Exclude<ReportId,'properties'>],w=where(spec,user,f,tokens);
 const raw=await db.prepare(`SELECT ${spec.select} FROM ${spec.from}${w.sql} ORDER BY ${spec.order} LIMIT 10001`).bind(...w.args).all();
 if(raw.results.length>10000)throw new ReportError(422,'أكثر من 10000 سجل؛ ضيق الفترة أو المرشحات. لم يعرض مجموع جزئي');
 const metrics:ReportResult['metrics']=[];
 const directory=spec.lead?await loadUsers(db).catch(()=>[]):[];
 const rows:ReportRow[]=raw.results.map(record=>{
  const r={...record};
  if(spec.lead)fillAssigneeNames(r,directory);
  if(typeof r.stage==='string'&&r.stage)r.stage=stageLabel(r.stage);
  if(id==='transactions'){const data=object(r.data);for(const [key] of specs.transactions.columns)if(key in data)r[key]=data[key];r.companyDebt=data.debtPayer==='company'?data.debtSettlement:null;r.clientDebt=data.debtPayer==='client'?data.debtSettlement:null;}
  if(id==='followups'){const today=riyadhDay(now),days=Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(String(r.follow_up)+'T00:00:00Z'))/86400000);r.follow_up_age=days<0?'قادمة':days===0?'اليوم':days<=7?'متأخرة 1–7 أيام':days<=30?'متأخرة 8–30 يوماً':'متأخرة أكثر من 30 يوماً';}
  if(id==='attendance'){const ms=r.check_out?Date.parse(String(r.check_out))-Date.parse(String(r.check_in)):NaN;r.hours=Number.isFinite(ms)&&ms>=0?(ms/3600000).toFixed(2):null;}
  if(id==='profiles'){const s=object(r.schedule);r.schedule_status=s.start&&s.end&&s.timezone?'مضبوط حالياً — بلا تاريخ':'غير مكتمل';r.shift=s.start&&s.end?`${s.start} — ${s.end}`:null;r.timezone=s.timezone;r.work_days=Array.isArray(s.days)?s.days.join(', '):null;r.grace_minutes=typeof s.grace==='number'?s.grace:null;}
  if(id==='sheets'){const boolean=(v:unknown)=>v===true||v===1||v==='true'?true:v===false||v===0||v==='false'?false:null;r.enabled=boolean(r.enabled)===true?'مفعل':boolean(r.enabled)===false?'موقوف':'غير معروف';r.sourceConfirmed=boolean(r.sourceConfirmed)===true?'معتمد':'غير مؤكد';const invalid=typeof r.invalid==='string'?JSON.parse(r.invalid):r.invalid;r.invalid=Array.isArray(invalid)?invalid.length:null;r.health=!r.last_run?'لم يسجل تشغيل':r.failed?'آخر تشغيل فشل':r.inserted!==null&&r.inserted!==undefined?'آخر تشغيل ناجح':'نتيجة غير معروفة';for(const key of ['inserted','duplicates','invalid'])r[key]=r[key]!==null&&r[key]!==undefined&&Number.isSafeInteger(Number(r[key]))?Number(r[key]):null;}
  return Object.fromEntries(spec.columns.map(([key])=>[key,cell(r[key])]));
 });
 if(id==='transactions')for(const [key,label] of financeFields)metrics.push({label:`مجموع مستقل: ${label}`,...sumDecimal(rows.map(r=>r[key]))});
 if(id==='attendance'){
  const closed=raw.results.filter(r=>r.check_out&&Number.isFinite(Date.parse(String(r.check_out))-Date.parse(String(r.check_in)))&&Date.parse(String(r.check_out))>=Date.parse(String(r.check_in)));
  metrics.push({label:'ساعات البصمات المكتملة فقط',value:closed.length?(closed.reduce((n,r)=>n+Date.parse(String(r.check_out))-Date.parse(String(r.check_in)),0)/3600000).toFixed(2):null,missing:rows.length-closed.length},{label:'دقائق التأخير المسجلة',value:rows.reduce((n,r)=>n+Number(r.late_minutes||0),0)},{label:'بصمات مفتوحة أو غير صالحة',value:rows.length-closed.length});
 }
 if(id==='followups')metrics.push({label:'مواعيد غير منتهية متأخرة قبل اليوم (الرياض)',value:raw.results.filter(r=>String(r.follow_up)<riyadhDay(now)&&!['won','closed'].includes(String(r.stage))).length});
 if(id==='requests')metrics.push({label:'الطلبات المفتوحة حالياً',value:rows.filter(r=>r.status==='pending').length},{label:'طلبات الإجازة ضمن الفترة',value:rows.filter(r=>r.type==='leave').length});
 if(id==='ai'){if(rows.length===0)throw new ReportError(404,'لا توجد بيانات استخدام AI محفوظة ضمن الفترة؛ الاستخدام والتكلفة غير متاحين.');metrics.push({label:'محاولات الطلبات المسجلة',value:rows.reduce((n,r)=>n+Number(r.requests||0),0)});}
 if(id==='imports')metrics.push({label:'الصفوف المقبولة المسجلة في التشغيلات',value:rows.reduce((n,r)=>n+Number(r.inserted||0),0)});
 const groups:ReportResult['groups']={};for(const key of spec.groups||[]){const counts=new Map<string,number>();for(const r of rows){const label=String(r[key]??'غير محدد');counts.set(label,(counts.get(label)||0)+1);}groups[key]=Array.from(counts,([label,count])=>({label,count})).sort((a,b)=>{if(key==='stage'){const order=stagePipelineIndex(a.label)-stagePipelineIndex(b.label);if(order)return order;}return b.count-a.count||a.label.localeCompare(b.label,'ar');});}
 // Trend is derived from the same authorized rows, bucketed by the module's own Riyadh-local date basis. No extra query, no extra scope.
 const trend=buildTrend(spec,id,raw.results,f);
 return {...meta,columns:spec.columns.map(([key,label])=>({key,label})),rows:options.exporting?rows:rows.slice((f.page-1)*f.pageSize,f.page*f.pageSize),total:rows.length,page:f.page,pageSize:f.pageSize,groups,metrics,...(trend?{trend}:{}),generatedAt:now.toISOString()};
}
const TREND_DATE_FIELD:Partial<Record<Exclude<ReportId,'properties'>,{field:string;basis:string;dateOnly?:boolean}>>={
 leads:{field:'created_at',basis:'يوم إنشاء العميل (الرياض)'},
 followups:{field:'follow_up',basis:'يوم موعد المتابعة',dateOnly:true},
 activity:{field:'created_at',basis:'يوم الحدث (الرياض)'},
 transactions:{field:'updated_at',basis:'يوم آخر تحديث للمعاملة (الرياض)'},
 attendance:{field:'work_day',basis:'يوم العمل المسجل',dateOnly:true},
 requests:{field:'created_at',basis:'يوم إنشاء الطلب (الرياض)'},
 announcements:{field:'created_at',basis:'يوم النشر (الرياض)'},
 audit:{field:'created_at',basis:'يوم الحدث (الرياض)'},
 imports:{field:'created_at',basis:'يوم التشغيل (الرياض)'},
 importRows:{field:'created_at',basis:'يوم الاستيراد (الرياض)'},
 ai:{field:'hour_key',basis:'يوم الاستخدام (UTC كما هو مخزن)'},
};
function riyadhBucket(value:unknown,dateOnly:boolean):string|null{
 if(value===null||value===undefined||value==='')return null;
 const s=value instanceof Date?value.toISOString():String(value);
 if(dateOnly)return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):null;
 const ms=Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)?s:s.replace(' ','T')+'Z');
 if(!Number.isFinite(ms))return /^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):null;
 return new Date(ms+3*60*60*1000).toISOString().slice(0,10);
}
function buildTrend(spec:Spec,id:string,records:Record<string,unknown>[],f:ReportFilters):ReportResult['trend']{
 const config=TREND_DATE_FIELD[id as Exclude<ReportId,'properties'>];
 if(!config||!spec.date)return undefined;
 const counts=new Map<string,number>();
 for(const record of records){const day=riyadhBucket(record[config.field],!!config.dateOnly);if(day)counts.set(day,(counts.get(day)||0)+1);}
 if(!counts.size)return undefined;
 // Emit a continuous series across the filtered window so gaps read as zero, not as missing days.
 const points:{day:string;count:number}[]=[];const cursor=new Date(f.from+'T00:00:00.000Z'),end=Date.parse(f.to+'T00:00:00.000Z');
 if(!Number.isFinite(end))return undefined;
 for(let guard=0;cursor.getTime()<=end&&guard<400;guard++){const day=cursor.toISOString().slice(0,10);points.push({day,count:counts.get(day)||0});cursor.setUTCDate(cursor.getUTCDate()+1);}
 // Out-of-window buckets (e.g. upcoming follow-ups) must still be visible rather than silently dropped.
 for(const [day,count] of counts)if(!points.some(p=>p.day===day))points.push({day,count});
 points.sort((a,b)=>a.day.localeCompare(b.day));
 return {basis:config.basis,points};
}
export function reportCsv(report:{columns:ReportColumn[];rows:ReportRow[]}){
 const quote=(v:unknown)=>{let s=v==null?'':String(v);if(/^[\s\u0000-\u001f\u007f\uFEFF]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\uFEFF'+[report.columns.map(c=>quote(c.label)).join(','),...report.rows.map(r=>report.columns.map(c=>quote(r[c.key])).join(','))].join('\r\n')+'\r\n';
}


const NEIGHBORHOOD_FROM_TITLE=/حي\s+([\u0600-\u06FF\w]+)/;
/** Derive الحي: non-empty address, else title match, else غير محدد. */
export function propertyNeighborhood(property:{address?:unknown;title?:unknown}):string{
 const address=String(property.address??'').trim();
 if(address)return address;
 const match=NEIGHBORHOOD_FROM_TITLE.exec(String(property.title??''));
 return match?.[1]||'غير محدد';
}
export function buildPropertiesSnapshot(properties:Record<string,unknown>[]){
 if(!Array.isArray(properties))throw new ReportError(503,'كتالوج العقارات غير متاح؛ لا يمثل صفراً');
 const counts=new Map<string,number>();
 for(const property of properties){const label=propertyNeighborhood(property);counts.set(label,(counts.get(label)||0)+1);}
 return {total:properties.length,byNeighborhood:Array.from(counts,([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'ar'))};
}
/** Auth + optional employee filter only — no date/source/stage/funding window. */
function snapshotLeadWhere(user:Actor,f:Pick<ReportFilters,'employee'>,employeeTokens:string[]=[]){
 const clauses:string[]=[],args:(string|number|null)[]=[];const add=(sql:string,...values:(string|number|null)[])=>{if(sql){clauses.push(sql);args.push(...values);}};
 if(user.role!=='admin'){
  const columns=['l.owner','l.created_by'];
  if(user.role==='field')columns.push('l.field_assigned_to');
  else if(user.role==='supervisor')columns.push('l.assigned_to','l.field_assigned_to');
  else columns.push('l.assigned_to');
  const scope=hexAny(columns,[user.userId]);add(scope.sql,...scope.args);
 }
 if(f.employee){const match=hexAny(['l.assigned_to','l.field_assigned_to','l.owner','l.created_by'],employeeTokens.length?employeeTokens:[f.employee]);add(match.sql,...match.args);}
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
}
export type SnapshotCount={label:string;count:number};
export type SnapshotStageCount={stage:string;label:string;count:number};
export type ReportSnapshots={
 note:string;
 clients:{status:'ok';total:number;interested:number;notInterested:number;byStage:SnapshotStageCount[]}|{status:'unavailable';error:string};
 properties:{status:'ok';total:number;byNeighborhood:SnapshotCount[]}|{status:'unavailable';error:string};
};
export const REPORT_SNAPSHOT_NOTE='لقطات النظام ضمن صلاحيتك: إجمالي العملاء بلا فلتر تاريخ/مصدر/مرحلة (يُحترم فلتر الموظف إن وُجد). المهتمون = كل من ليس غير مهتم. العقارات من الكتالوج الحالي مع توزيع الأحياء — ليست طلب عملاء الفترة.';
export async function readClientsSnapshot(db:Database,user:Actor,f:Pick<ReportFilters,'employee'>){
 const tokens=f.employee?await cachedTokens(db,f.employee):[];
 const w=snapshotLeadWhere(user,f,tokens);
 const result=await db.prepare(`SELECT l.stage FROM leads l${w.sql} ORDER BY l.id LIMIT 10001`).bind(...w.args).all();
 if(result.results.length>10000)throw new ReportError(422,'أكثر من 10000 عميل في اللقطة؛ ضيق مرشح الموظف. لم يعرض مجموع جزئي');
 const counts=new Map<string,number>();
 for(const row of result.results){const raw=String(row.stage??'');const stage=retiredStageMap[raw]||raw;counts.set(stage,(counts.get(stage)||0)+1);}
 const total=result.results.length,notInterested=counts.get('not_interested')||0;
 const byStage=Array.from(counts,([stage,count])=>({stage,label:stageLabel(stage),count})).sort((a,b)=>stagePipelineIndex(a.stage)-stagePipelineIndex(b.stage)||b.count-a.count||a.label.localeCompare(b.label,'ar'));
 return {total,interested:total-notInterested,notInterested,byStage};
}
export async function readReportSnapshots(db:Database,user:Actor,f:Pick<ReportFilters,'employee'>,properties:Record<string,unknown>[],mapError:(error:unknown)=>string):Promise<ReportSnapshots>{
 let clients:ReportSnapshots['clients'];
 try{clients={status:'ok',...await readClientsSnapshot(db,user,f)};}
 catch(error){clients={status:'unavailable',error:mapError(error)};}
 let propertiesSnap:ReportSnapshots['properties'];
 try{propertiesSnap={status:'ok',...buildPropertiesSnapshot(properties)};}
 catch(error){propertiesSnap={status:'unavailable',error:mapError(error)};}
 return {note:REPORT_SNAPSHOT_NOTE,clients,properties:propertiesSnap};
}
export async function listReportEmployees(db:Database):Promise<DirectoryUser[]>{
 const users=await loadUsers(db);
 if(users.length>10000)throw new ReportError(422,'قائمة الموظفين أكبر من الحد المدعوم');
 return users;
}
export type DashboardStage={stage:string;label:string;count:number;pct:number};
export type DashboardEmployee={id:string;name:string;username:string;assigned:number;contacted:number;interested:number;signed:number;notInterested:number;overdue:number;completion:number|null};
export type DashboardSource={key:string;label:string;total:number;interested:number;notInterested:number;signed:number;closed:number;unassignedNew:number;conversion:number|null};
export type DashboardAlert={id:string;tone:'warn'|'info'|'muted';tag:string;message:string;href:string};
export type ReportDashboard={
 total:number;interested:number;notInterested:number;signed:number;closed:number;unassignedNew:number;overdue:number;inactive:number;unassignedWaiting:number;
 byStage:DashboardStage[];employees:DashboardEmployee[];sources:DashboardSource[];alerts:DashboardAlert[];definitions:typeof COHORT_DEFINITIONS;
};
function listHref(filters:ReportFilters,extra:Record<string,string>,users:DirectoryUser[]){
 const q=new URLSearchParams();q.set('tab','leads');
 if(filters.from)q.set('from',filters.from);
 if(filters.to)q.set('to',filters.to);
 if(filters.source){q.set('source',filters.source);q.set('sourceExact','1');}
 else if(extra.source)q.set('source',extra.source);
 if(filters.stage&&!extra.stage&&!extra.stageGroup)q.set('stage',filters.stage);
 const employeeId=extra.employee||filters.employee;
 if(employeeId){
  q.set('employee',employeeId);
  const person=users.find(user=>user.id===employeeId)||matchUser(users,employeeId);
  if(person?.name)q.set('employeeName',person.name);
  if(person?.username)q.set('employeeUser',person.username);
 }
 for(const [key,value] of Object.entries(extra)){if(!value||key==='employee'||key==='source'&&filters.source)continue;q.set(key,value);}
 return '/crm?'+q.toString();
}
export async function readReportDashboard(db:Database,user:Actor,f:ReportFilters,now=new Date()):Promise<ReportDashboard>{
 authorizeReport(user,'leads',f,false);
 const tokens=f.employee?await cachedTokens(db,f.employee):[];
 const w=where(specs.leads,user,f,tokens);
 const result=await db.prepare(`SELECT l.id,l.stage,l.source,l.assigned_to,l.field_assigned_to,l.follow_up,l.created_at,l.updated_at FROM leads l${w.sql} ORDER BY l.id LIMIT 10001`).bind(...w.args).all();
 if(result.results.length>10000)throw new ReportError(422,'أكثر من 10000 عميل في لوحة التقارير؛ ضيق الفترة أو المرشحات. لم يعرض مجموع جزئي');
 const directory=await loadUsers(db);
 const visible=user.role==='admin'?directory:directory.filter(person=>person.id===user.userId||tokens.includes(person.id)||tokens.includes(person.username)||tokens.includes(person.name));
 const staff=visible.length?visible:[{id:user.userId,name:user.userId,username:''}];
 const stats=new Map<string,DashboardEmployee & {pastFresh:number}>();
 for(const person of staff)stats.set(person.id,{id:person.id,name:person.name,username:person.username,assigned:0,contacted:0,interested:0,signed:0,notInterested:0,overdue:0,pastFresh:0,completion:null});
 const stageCounts=new Map<string,number>();
 const sourceCounts=new Map<string,DashboardSource>();
 const today=riyadhDay(now);const nowMs=now.getTime();
 let interested=0,notInterested=0,signed=0,closed=0,unassignedNew=0,overdue=0,inactive=0,unassignedWaiting=0;
 for(const row of result.results){
  const key=stageKeyOf(row.stage)||'new';
  stageCounts.set(key,(stageCounts.get(key)||0)+1);
  if(isInterestedStage(row.stage))interested++;
  if(isNotInterestedStage(row.stage))notInterested++;
  if(isSignedStage(row.stage))signed++;
  if(isClosedStage(row.stage))closed++;
  if(isUnassignedNew(row.stage,row.assigned_to))unassignedNew++;
  if(isUnassignedNewWaiting(row.stage,row.assigned_to,row.created_at,nowMs))unassignedWaiting++;
  if(isOverdueFollowUp(row.follow_up,row.stage,today))overdue++;
  if(isInactiveLead(row.updated_at,row.created_at,row.stage,nowMs))inactive++;
  const source=normalizeSource(row.source);
  const bucket=sourceCounts.get(source.key)||{key:source.key,label:source.label,total:0,interested:0,notInterested:0,signed:0,closed:0,unassignedNew:0,conversion:null};
  bucket.total++;
  if(isInterestedStage(row.stage))bucket.interested++;
  if(isNotInterestedStage(row.stage))bucket.notInterested++;
  if(isSignedStage(row.stage))bucket.signed++;
  if(isClosedStage(row.stage))bucket.closed++;
  if(isUnassignedNew(row.stage,row.assigned_to))bucket.unassignedNew++;
  sourceCounts.set(source.key,bucket);
  const people=[matchUser(directory,row.assigned_to),matchUser(directory,row.field_assigned_to)].filter((person):person is DirectoryUser=>Boolean(person));
  const seen=new Set<string>();
  for(const person of people){
   if(seen.has(person.id)||!stats.has(person.id))continue;
   seen.add(person.id);
   const stat=stats.get(person.id)!;
   stat.assigned++;
   if(isContactedStage(row.stage))stat.contacted++;
   if(isInterestedStage(row.stage))stat.interested++;
   if(isSignedStage(row.stage))stat.signed++;
   if(isNotInterestedStage(row.stage))stat.notInterested++;
   if(isOverdueFollowUp(row.follow_up,row.stage,today))stat.overdue++;
   if(isPastFreshStage(row.stage))stat.pastFresh++;
  }
 }
 const total=result.results.length;
 const known=new Set(orderedStages().map(stage=>stage.stage));
 const byStage:DashboardStage[]=orderedStages().map(stage=>({stage:stage.stage,label:stage.label,count:stageCounts.get(stage.stage)||0,pct:total?Math.round(((stageCounts.get(stage.stage)||0)/total)*100):0}));
 for(const [stage,count] of stageCounts)if(!known.has(stage))byStage.push({stage,label:stageLabel(stage),count,pct:total?Math.round((count/total)*100):0});
 const employees=[...stats.values()].map(stat=>({id:stat.id,name:stat.name,username:stat.username,assigned:stat.assigned,contacted:stat.contacted,interested:stat.interested,signed:stat.signed,notInterested:stat.notInterested,overdue:stat.overdue,completion:completionRate(stat.assigned,stat.pastFresh)})).sort((a,b)=>b.assigned-a.assigned||a.name.localeCompare(b.name,'ar'));
 const sources=[...sourceCounts.values()].map(source=>({...source,conversion:conversionRate(source.total,source.signed)})).sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label,'ar'));
 const alerts:DashboardAlert[]=[];
 if(unassignedWaiting>0)alerts.push({id:'unassigned-wait',tone:'warn',tag:'تنبيه',message:`${unassignedWaiting} عميل جديد غير مسند بانتظار أكثر من 24 ساعة.`,href:listHref(f,{waiting:'1'},directory)});
 if(overdue>0)alerts.push({id:'overdue',tone:'warn',tag:'تنبيه',message:`${overdue} موعد متابعة متأخر يحتاج انتباهاً.`,href:listHref(f,{overdue:'1'},directory)});
 for(const person of [...employees].filter(person=>person.overdue>=3).sort((a,b)=>b.overdue-a.overdue).slice(0,3))alerts.push({id:'overdue-'+person.id,tone:'warn',tag:'موظف',message:`${person.name}: ${person.overdue} مواعيد متابعة متأخرة.`,href:listHref(f,{employee:person.id,overdue:'1'},directory)});
 for(const source of [...sources].filter(source=>source.total>=5&&source.notInterested/source.total>=0.4).sort((a,b)=>b.notInterested/b.total-a.notInterested/a.total).slice(0,3))alerts.push({id:'source-'+source.key,tone:'warn',tag:'مصدر',message:`مصدر ${source.label}: ${Math.round((source.notInterested/source.total)*100)}% غير مهتم أو غير مؤهل (${source.notInterested} من ${source.total}).`,href:listHref(f,{source:source.key,stageGroup:'not_interested'},directory)});
 if(inactive>0)alerts.push({id:'inactive',tone:'info',tag:'متابعة',message:`${inactive} عميل بلا تحديث منذ 7 أيام أو أكثر.`,href:listHref(f,{inactive:'1'},directory)});
 if(notInterested>0)alerts.push({id:'not-interested',tone:'muted',tag:'ملاحظة',message:`${notInterested} عميل مصنّف غير مهتم أو غير مؤهل ضمن الفلاتر.`,href:listHref(f,{stageGroup:'not_interested'},directory)});
 return {total,interested,notInterested,signed,closed,unassignedNew,overdue,inactive,unassignedWaiting,byStage,employees,sources,alerts,definitions:COHORT_DEFINITIONS};
}
