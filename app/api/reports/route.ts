import {getCrmUser} from '@/lib/admin';
import {crmDb} from '@/lib/crm-db';
import {allowedReports} from '@/lib/report-catalog';
import {ReportError,authorizeReport,parseReportFilters,readReport,reportCsv} from '@/lib/reports';
import properties from '@/data/properties.json';
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
  const employees=user.role==='admin'?(await db.prepare('SELECT id,name FROM crm_users ORDER BY name,id LIMIT 10001').all()).results:[{id:user.userId,name:user.name}];
  if(employees.length>10000)throw new ReportError(422,'قائمة الموظفين أكبر من الحد المدعوم');
  if(filters.employee&&!employees.some(employee=>String(employee.id)===filters.employee))throw new ReportError(400,'الموظف المحدد غير موجود في النطاق المسموح');
  if(exporting){const report=await readReport(db,user,id,filters,{properties,exporting:true});return new Response(reportCsv(report),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="sas-report-${id}.csv"`}});}
  if(id==='overview'){
   const summaries=[];
   for(const meta of allowedReports(user.role)){
    try{const r=await readReport(db,user,meta.id,filters,{properties});summaries.push({...meta,status:'ok',total:r.total,metrics:r.metrics});}
    catch(error){summaries.push({...meta,status:'unavailable',total:null,error:sourceError(error)});}
   }
   return Response.json({summaries,employees,canExport:user.role==='admin',filters,generatedAt:new Date().toISOString()},{headers});
  }
  return Response.json({report:await readReport(db,user,id,filters,{properties}),employees,canExport:user.role==='admin',filters},{headers});
 } catch(error){return Response.json({error:error instanceof ReportError?error.message:sourceError(error)},{status:error instanceof ReportError?error.status:503,headers});}
}
// A read failure must never look like a zero, and a schema gap must name itself
// instead of hiding behind a generic message. Only the column name is surfaced —
// never SQL text, credentials or connection details.
function sourceError(error:unknown){
 if(error instanceof ReportError)return error.message;
 const raw=error instanceof Error?error.message:'';
 const column=/Unknown column '(?:\w+\.)?(\w+)'/i.exec(raw)?.[1];
 if(column)return `عمود «${column}» غير موجود في قاعدة البيانات، فتعذّرت القراءة ولا يمثل صفراً. شغّل ترقية قاعدة البيانات db/mysql/003_leads_expansion_columns.sql ثم أعد المحاولة.`;
 if(/Table '.*' doesn't exist|no such table/i.test(raw))return 'جدول مطلوب غير موجود في قاعدة البيانات، فتعذّرت القراءة ولا يمثل صفراً. شغّل ترقيات db/mysql بالترتيب ثم أعد المحاولة.';
 if(/ER_ACCESS_DENIED|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Database configuration missing/i.test(raw))return 'تعذّر الاتصال بقاعدة البيانات، فلا توجد نتيجة ولا يمثل صفراً. راجع بيانات الاتصال وصلاحيات المستخدم.';
 return 'تعذر قراءة المصدر؛ راجع تهيئة الجدول وصلاحيات الاتصال. لا يمثل صفراً.';
}
