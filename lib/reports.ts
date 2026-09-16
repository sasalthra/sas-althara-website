import {reportCatalog,type ReportColumn,type ReportResult,type ReportRow,type ReportId} from './report-catalog';
import {stageLabel} from './lead-stages';
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
const leadFrom='leads l LEFT JOIN crm_users s ON s.id=l.assigned_to LEFT JOIN crm_users f ON f.id=l.field_assigned_to';
const leadFields='l.id,l.name,l.property_id,l.property_other,l.source,l.stage,l.follow_up,l.created_at,l.updated_at,s.name AS sales,f.name AS field';
type Spec={select:string;from:string;date?:string;employee?:string;lead?:boolean;fixed?:string;order:string;columns:string[][];groups?:string[]};
const specs:Record<Exclude<ReportId,'properties'>,Spec>={
 leads:{select:leadFields,from:leadFrom,date:'l.created_at',lead:true,order:'l.created_at DESC,l.id',columns:[['id','معرف العميل'],['name','العميل'],['source','المصدر'],['stage','المرحلة الحالية'],['sales','المبيعات'],['field','الميدان'],['property_id','معرف العقار'],['property_other','عقار آخر'],['follow_up','المتابعة'],['created_at','الإنشاء UTC']],groups:['source','stage','sales','field']},
 followups:{select:leadFields,from:leadFrom,date:'l.follow_up',lead:true,fixed:"l.follow_up <> ''",order:'l.follow_up,l.id',columns:[['id','معرف العميل'],['name','العميل'],['follow_up','الموعد الحالي'],['follow_up_age','عمر المتابعة بتوقيت الرياض'],['stage','المرحلة'],['sales','المبيعات'],['field','الميدان']],groups:['follow_up_age','stage','sales']},
 activity:{select:'a.id,a.lead_id,a.user_id,a.action,CAST(a.created_at AS CHAR) AS created_at',from:'lead_activity a JOIN leads l ON l.id=a.lead_id',date:'a.created_at',lead:true,order:'a.created_at DESC,a.id',columns:[['id','معرف الحدث'],['lead_id','العميل'],['user_id','الفاعل'],['action','العمل'],['created_at','الوقت المخزن — منطقة DB']],groups:['action','user_id']},
 transactions:{select:'t.id,t.lead_id,t.data,t.confirmed_due,t.updated_at,l.name,l.source,l.stage,l.property_id,s.name AS sales,f.name AS field',from:'crm_transactions t JOIN leads l ON l.id=t.lead_id LEFT JOIN crm_users s ON s.id=l.assigned_to LEFT JOIN crm_users f ON f.id=l.field_assigned_to',date:'t.updated_at',lead:true,order:'t.updated_at DESC,t.id',columns:[],groups:['fundingEntity','debtPayer','requestStage']},
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
function where(spec:Spec,user:Actor,f:ReportFilters){
 const clauses:string[]=[],args:(string|number|null)[]=[];const add=(sql:string,...values:(string|number|null)[])=>{clauses.push(sql);args.push(...values);};
 if(spec.fixed)add(spec.fixed);
 if(spec.lead){
  if(user.role!=='admin'){const assignment=user.role==='field'?'l.field_assigned_to':user.role==='supervisor'?'l.assigned_to = ? OR l.field_assigned_to':'l.assigned_to';add(`(l.owner = ? OR l.created_by = ? OR ${assignment} = ?)`,user.userId,user.userId,...(user.role==='supervisor'?[user.userId]:[]),user.userId);}
  if(f.employee){const finance=spec===specs.transactions;add('(l.assigned_to = ? OR l.field_assigned_to = ? OR l.owner = ? OR l.created_by = ?'+(finance?" OR JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.financeEmployeeId')) = ?":'')+')',f.employee,f.employee,f.employee,f.employee,...(finance?[f.employee]:[]));}
  if(f.source)add('l.source = ?',f.source);
  if(f.stage)add(spec===specs.transactions?"JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.requestStage')) = ?":'l.stage = ?',f.stage);
  if(f.funding&&spec===specs.transactions)add("JSON_UNQUOTE(JSON_EXTRACT(t.data,'$.fundingEntity')) = ?",f.funding);
 } else if(spec.employee){if(user.role!=='admin')add(`${spec.employee} = ?`,user.userId);else if(f.employee)add(`${spec.employee} = ?`,f.employee);}
 // Date-only fields are already local work/calendar days. UTC text/timestamps are shifted to fixed Riyadh UTC+03 (Saudi Arabia has no DST).
 if(spec.date){const localDate=['l.follow_up','a.work_day'].includes(spec.date)?`SUBSTRING(${spec.date},1,10)`:`SUBSTRING(CONVERT_TZ(CAST(${spec.date} AS CHAR),'+00:00','+03:00'),1,10)`;add(`${localDate} >= ?`,f.from);add(`${localDate} <= ?`,f.to);}
 return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',args};
}
export async function readReport(db:Database,user:Actor,id:string,f:ReportFilters,options:{exporting?:boolean;properties?:Record<string,unknown>[];now?:Date}={}):Promise<ReportResult>{
 const meta=authorizeReport(user,id,f,options.exporting),now=options.now||new Date();
 if(id==='properties'){
  // Read the same authorized bounded data, not only the visible first page.
  const spec=specs.leads,w=where(spec,user,f);const result=await db.prepare(`SELECT l.property_id,l.property_other FROM leads l${w.sql} ORDER BY l.id LIMIT 10001`).bind(...w.args).all();
  if(result.results.length>10000)throw new ReportError(422,'أكثر من 10000 سجل؛ ضيق الفترة أو المرشحات');
  const counts=new Map<string,number>();for(const r of result.results){const key=String(r.property_id||'other');counts.set(key,(counts.get(key)||0)+1);}
  const rows:ReportRow[]=(options.properties||[]).map(p=>({id:String(p.id),title:cell(p.title),status:cell(p.status)??'غير مسجل في الكتالوج',city:cell(p.city)??'غير مسجل في الكتالوج',price:cell(p.price),area:cell(p.area),demand:counts.get(String(p.id))||0}));
  for(const [key,count] of counts)if(!rows.some(p=>p.id===key))rows.push({id:key,title:key==='other'?'عقار آخر — وصف في ملف العميل':'معرف غير موجود بالكتالوج',status:'غير مسجل في الكتالوج',city:'غير مسجل في الكتالوج',price:null,area:null,demand:count});
  const columns=[['id','معرف العقار'],['title','العقار'],['status','حالة الكتالوج'],['city','المدينة'],['price','سعر معلن — ليس إيراداً'],['area','المساحة'],['demand','عملاء مرتبطون ضمن النطاق']].map(([key,label])=>({key,label}));
  const groups:ReportResult['groups']={};for(const key of ['status','city']){const grouped=new Map<string,number>();for(const row of rows){const label=String(row[key]??'غير مسجل في الكتالوج');grouped.set(label,(grouped.get(label)||0)+1);}groups[key]=Array.from(grouped,([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));}
  return {...meta,columns,total:rows.length,page:f.page,pageSize:f.pageSize,rows:options.exporting?rows:rows.slice((f.page-1)*f.pageSize,f.page*f.pageSize),groups,metrics:[{label:'روابط العملاء المصرح بها',value:result.results.length},{label:'عقارات الكتالوج الحالي',value:(options.properties||[]).length}],generatedAt:now.toISOString()};
 }
 const spec=specs[id as Exclude<ReportId,'properties'>],w=where(spec,user,f);
 const raw=await db.prepare(`SELECT ${spec.select} FROM ${spec.from}${w.sql} ORDER BY ${spec.order} LIMIT 10001`).bind(...w.args).all();
 if(raw.results.length>10000)throw new ReportError(422,'أكثر من 10000 سجل؛ ضيق الفترة أو المرشحات. لم يعرض مجموع جزئي');
 const metrics:ReportResult['metrics']=[];
 const rows:ReportRow[]=raw.results.map(record=>{
  const r={...record};
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
 if(id==='followups')metrics.push({label:'مواعيد غير منتهية متأخرة قبل اليوم (الرياض)',value:rows.filter(r=>String(r.follow_up)<riyadhDay(now)&&!['won','closed'].includes(String(r.stage))).length});
 if(id==='requests')metrics.push({label:'الطلبات المفتوحة حالياً',value:rows.filter(r=>r.status==='pending').length},{label:'طلبات الإجازة ضمن الفترة',value:rows.filter(r=>r.type==='leave').length});
 if(id==='ai'){if(rows.length===0)throw new ReportError(404,'لا توجد بيانات استخدام AI محفوظة ضمن الفترة؛ الاستخدام والتكلفة غير متاحين.');metrics.push({label:'محاولات الطلبات المسجلة',value:rows.reduce((n,r)=>n+Number(r.requests||0),0)});}
 if(id==='imports')metrics.push({label:'الصفوف المقبولة المسجلة في التشغيلات',value:rows.reduce((n,r)=>n+Number(r.inserted||0),0)});
 const groups:ReportResult['groups']={};for(const key of spec.groups||[]){const counts=new Map<string,number>();for(const r of rows){const label=String(r[key]??'غير محدد');counts.set(label,(counts.get(label)||0)+1);}groups[key]=Array.from(counts,([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));}
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
function snapshotLeadWhere(user:Actor,f:Pick<ReportFilters,'employee'>){
 const clauses:string[]=[],args:(string|number|null)[]=[];const add=(sql:string,...values:(string|number|null)[])=>{clauses.push(sql);args.push(...values);};
 if(user.role!=='admin'){const assignment=user.role==='field'?'l.field_assigned_to':user.role==='supervisor'?'l.assigned_to = ? OR l.field_assigned_to':'l.assigned_to';add(`(l.owner = ? OR l.created_by = ? OR ${assignment} = ?)`,user.userId,user.userId,...(user.role==='supervisor'?[user.userId]:[]),user.userId);}
 if(f.employee)add('(l.assigned_to = ? OR l.field_assigned_to = ? OR l.owner = ? OR l.created_by = ?)',f.employee,f.employee,f.employee,f.employee);
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
 const w=snapshotLeadWhere(user,f);
 const result=await db.prepare(`SELECT l.stage FROM leads l${w.sql} ORDER BY l.id LIMIT 10001`).bind(...w.args).all();
 if(result.results.length>10000)throw new ReportError(422,'أكثر من 10000 عميل في اللقطة؛ ضيق مرشح الموظف. لم يعرض مجموع جزئي');
 const counts=new Map<string,number>();
 for(const row of result.results){const stage=String(row.stage??'');counts.set(stage,(counts.get(stage)||0)+1);}
 const total=result.results.length,notInterested=counts.get('not_interested')||0;
 const byStage=Array.from(counts,([stage,count])=>({stage,label:stageLabel(stage),count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'ar'));
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
