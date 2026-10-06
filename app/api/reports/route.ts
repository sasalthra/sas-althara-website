import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import {allowedReports} from '@/lib/report-catalog';
import {ReportError,authorizeReport,listReportEmployees,parseReportFilters,readReport,readReportDashboard,readReportSnapshots,reportCsv} from '@/lib/reports';
import {loadPublishedProperties} from '@/lib/property-catalog';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(req:Request){
 const user=await getCrmUser();if(!user)return Response.json({error:'يجب تسجيل الدخول'},{status:401,headers});
 try {
  const query=new URL(req.url).searchParams,filters=parseReportFilters(query),id=query.get('module')||'overview',exporting=query.get('format')==='csv';
  if(query.has('format')&&!exporting)throw new ReportError(400,'صيغة غير مدعومة');
  if(exporting&&id==='overview')throw new ReportError(400,'اختر تقريراً تفصيلياً للتصدير');
  // Validate scope before any SQL, including employee choices and overview.
  authorizeReport(user,id==='overview'?'leads':id,filters,exporting);
  const db=crmDb();
  const reveal=user.role==='admin';
  const explain=(error:unknown)=>sourceError(error,reveal);
  const properties=await loadPublishedProperties() as unknown as Record<string, unknown>[];
  const employees=user.role==='admin'?await listReportEmployees(db):await selfEmployee(db,user);
  if(employees.length>10000)throw new ReportError(422,'قائمة الموظفين أكبر من الحد المدعوم');
  if(filters.employee&&!employees.some(employee=>String(employee.id)===filters.employee))throw new ReportError(400,'الموظف المحدد غير موجود في النطاق المسموح');
  if(exporting){const report=await readReport(db,user,id,filters,{properties,exporting:true});return new Response(reportCsv(report),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="sas-report-${id}.csv"`}});}
  if(id==='overview'){
   const summaries=[];
   for(const meta of allowedReports(user.role)){
    try{const r=await readReport(db,user,meta.id,filters,{properties});summaries.push({...meta,status:'ok',total:r.total,metrics:r.metrics});}
    catch(error){summaries.push({...meta,status:'unavailable',total:null,error:explain(error)});}
   }
   const snapshots=await readReportSnapshots(db,user,filters,properties as Record<string,unknown>[],explain);
   let dashboard=null,dashboardError:string|undefined;
   try{dashboard=await readReportDashboard(db,user,filters);}
   catch(error){dashboardError=explain(error);}
   return Response.json({summaries,snapshots,dashboard,dashboardError,employees,canExport:user.role==='admin',filters,generatedAt:new Date().toISOString()},{headers});
  }
  return Response.json({report:await readReport(db,user,id,filters,{properties}),employees,canExport:user.role==='admin',filters},{headers});
 } catch(error){const reveal=user.role==='admin';return Response.json({error:error instanceof ReportError?error.message:sourceError(error,reveal)},{status:error instanceof ReportError?error.status:503,headers});}
}
// A read failure must never look like a zero, and a schema gap must name itself
// instead of hiding behind a generic message. Only the column name is surfaced —
// never SQL text, credentials or connection details.
async function selfEmployee(db: ReturnType<typeof crmDb>, user: {userId: string; name: string}) {
  const row = await db.prepare('SELECT id, name FROM crm_users WHERE HEX(LOWER(id))=HEX(LOWER(?)) LIMIT 1').bind(user.userId).first<{id: string; name: string | null}>();
  return [{id: user.userId, name: row?.name?.trim() || user.name, username: ''}];
}

function dbErrorParts(error:unknown){
 const record=error&&typeof error==='object'?error as {code?:unknown;errno?:unknown;sqlMessage?:unknown}:{};
 const code=[typeof record.code==='string'?record.code:'',typeof record.errno==='number'?String(record.errno):''].filter(Boolean).join('/');
 let detail=typeof record.sqlMessage==='string'?record.sqlMessage:error instanceof Error?error.message:'';
 detail=detail.replace(/\s+/g,' ').trim();
 if(/password|access denied for user|DB_PASSWORD/i.test(detail))detail='';
 return {code,detail:detail.slice(0,220)};
}
function sourceError(error:unknown,reveal=false){
 if(error instanceof ReportError)return error.message;
 const raw=error instanceof Error?error.message:'';
 const {code,detail}=dbErrorParts(error);
 const suffix=reveal&&code?` (رمز ${code})`:'';
 const column=/Unknown column '(?:\w+\.)?(\w+)'/i.exec(raw)?.[1];
 if(column)return `عمود «${column}» غير موجود في قاعدة البيانات، فتعذّرت القراءة ولا يمثل صفراً. شغّل ترقية قاعدة البيانات db/mysql/003_leads_expansion_columns.sql ثم أعد المحاولة.${suffix}`;
 if(/Table '.*' doesn't exist|no such table|ER_NO_SUCH_TABLE/i.test(raw+' '+code))return `جدول مطلوب غير موجود في قاعدة البيانات، فتعذّرت القراءة ولا يمثل صفراً. شغّل ترقيات db/mysql بالترتيب ثم أعد المحاولة.${suffix}`;
 if(/ER_ACCESS_DENIED|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Database configuration missing/i.test(raw+' '+code))return 'تعذّر الاتصال بقاعدة البيانات، فلا توجد نتيجة ولا يمثل صفراً. راجع بيانات الاتصال وصلاحيات المستخدم.'+suffix;
 if(reveal&&(code||detail))return `تعذر قراءة المصدر (رمز ${code||'غير معروف'}${detail?`: ${detail}`:''}). لا يمثل صفراً.`;
 return 'تعذر قراءة المصدر؛ راجع تهيئة الجدول وصلاحيات الاتصال. لا يمثل صفراً.';
}
