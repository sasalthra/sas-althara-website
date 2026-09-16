'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,PieChart,Pie,Cell,Legend,CartesianGrid} from 'recharts';
import {allowedReports,type ReportResult} from '@/lib/report-catalog';
import {CrmLink,navigateCrm,useCrmQuery} from './navigation';

type Summary={id:string;label:string;kind:string;note:string;status:string;total:number|null;error?:string;metrics?:ReportResult['metrics']};
type Payload={report?:ReportResult;summaries?:Summary[];employees:{id:string;name:string}[];canExport:boolean;filters:{from:string;to:string;employee:string;source:string;stage:string;funding:string;page:number;pageSize:number};generatedAt?:string};
type Metric=NonNullable<ReportResult['metrics']>[number];

const groupNames:Record<string,string>={source:'المصادر',stage:'المراحل',sales:'المبيعات',field:'الميدان',follow_up_age:'عمر المتابعة',city:'المدن',action:'الأعمال',user_id:'المستخدمون',name:'الموظفون',department:'الأقسام',schedule_status:'الدوام',type:'الخدمات',status:'الحالات',role:'الأدوار',active:'تفعيل الحساب',actor_id:'الفاعلون',fundingEntity:'جهات التمويل',debtPayer:'جهة السداد',requestStage:'مرحلة الطلب'};
const CHART_COLORS=['#c9a24b','#2f6f5e','#3d6fa8','#a84e3d','#7a4fa8','#4f8fa8','#8f7a3d','#5e8f3d','#a83d7a','#666'];

function isNumericValue(v:unknown):boolean{
 if(v===null||v===undefined||v==='')return false;
 const n=Number(String(v).replace(/[,٬]/g,''));
 return Number.isFinite(n);
}
function numericOf(v:unknown):number{
 return Number(String(v).replace(/[,٬]/g,''));
}

export default function ReportsPanel({role}:{role:string}){
 const query=useCrmQuery(),modules=allowedReports(role),selectedModule=query.get('module')||'overview';
 const params=new URLSearchParams();for(const k of ['module','from','to','source','stage','funding','page','pageSize'])if(query.get(k))params.set(k,query.get(k)!);if(query.get('reportEmployee'))params.set('employee',query.get('reportEmployee')!);
 const key=params.toString();
 const [state,setState]=useState<{key:string;data?:Payload;error?:string}>({key:''});
 const [retry,setRetry]=useState(0),[exportError,setExportError]=useState(''),[exporting,setExporting]=useState(false);
 useEffect(()=>{const controller=new AbortController();fetch('/api/reports?'+key,{signal:controller.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||'تعذر تحميل التقرير');return data;}).then(data=>setState({key,data})).catch(e=>{if(!controller.signal.aborted)setState({key,error:e instanceof Error?e.message:'تعذر التحميل'});});return()=>controller.abort();},[key,retry]);
 const current=state.key===key,stateData=current?state.data:undefined,report=stateData?.report,error=current?state.error:undefined,loading=!error&&!stateData;
 function href(changes:Record<string,string>){const q=new URLSearchParams(query);q.set('tab','reports');for(const [k,v] of Object.entries(changes)){if(v)q.set(k,v);else q.delete(k);}return '/crm?'+q.toString();}
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);const changes:Record<string,string>={page:'1'};for(const k of ['module','from','to','reportEmployee','source','stage','funding','pageSize'])changes[k]=String(data.get(k)||'');navigateCrm(href(changes));}
 async function download(){setExportError('');setExporting(true);try{const r=await fetch('/api/reports?'+key+'&format=csv',{cache:'no-store'});if(!r.ok){const data=await r.json();throw Error(data.error||'تعذر التصدير');}const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=`sas-report-${selectedModule}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setExportError(e instanceof Error?e.message:'تعذر التصدير');}finally{setExporting(false);}}
 const page=report?.page||1,pages=Math.max(1,Math.ceil((report?.total||0)/(report?.pageSize||25)));
 function deepLink(column:string,value:unknown){if(value===null||value===undefined||value==='')return '';if(column==='lead_id'||(column==='id'&&['leads','followups'].includes(selectedModule)))return '/crm/leads/'+encodeURIComponent(String(value));if(column==='property_id'||(column==='id'&&selectedModule==='properties'&&!['other'].includes(String(value))))return '/properties/'+encodeURIComponent(String(value));return '';}

 // Chart data builders
 function groupChartData(){
  if(!report)return null;
  const entries=Object.entries(report.groups).filter(([,g])=>g.length>0);
  if(!entries.length)return null;
  return entries.map(([gkey,groups])=>({
   gkey,
   title:groupNames[gkey]||gkey,
   data:groups.slice(0,10).map(g=>({name:g.label,value:g.count}))
  }));
 }
 function metricChartData(){
  if(!report)return [];
  return report.metrics
   .filter((m:Metric)=>m.value!==null&&m.value!==undefined&&isNumericValue(m.value))
   .map((m:Metric)=>({name:m.label,value:numericOf(m.value)}));
 }
 const groupsCharts=report?groupChartData():null;
 const metricsChart=report?metricChartData():[];

 return <section className="reports-center" aria-label="مركز التقارير">
  <div className="report-heading"><div><h2>مركز التقارير</h2><p className="subtle">قراءة فقط · {role==='admin'?'نطاق الإدارة':'سجلاتك المملوكة أو المسندة لك؛ بيانات الموظفين خاصة بك فقط'}</p></div><CrmLink className="crm-button" href="/crm?tab=reports">نظرة عامة</CrmLink></div>
  <form className="report-filters panel" onSubmit={submit} key={key+(stateData?.filters.from||'')}>
   <label>الوحدة<select name="module" defaultValue={selectedModule}><option value="overview">نظرة عامة — كل المسموح</option>{modules.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
   <label>من تاريخ — الرياض<input type="date" name="from" defaultValue={query.get('from')||stateData?.filters.from||''}/></label><label>إلى تاريخ — الرياض<input type="date" name="to" defaultValue={query.get('to')||stateData?.filters.to||''}/></label>
   <label>الموظف المسموح<select name="reportEmployee" defaultValue={query.get('reportEmployee')||''}><option value="">{role==='admin'?'كل الموظفين':'نطاقي فقط'}</option>{stateData?.employees.map(e=><option key={e.id} value={e.id}>{e.name} — {e.id}</option>)}</select></label>
   <label>مصدر العميل<input name="source" placeholder="كل المصادر" defaultValue={query.get('source')||''}/></label>
   <label>المرحلة<input name="stage" placeholder={selectedModule==='transactions'?'مرحلة طلب التمويل':'مرحلة العميل'} defaultValue={query.get('stage')||''}/></label>
   <label>جهة التمويل<input name="funding" placeholder="للمعاملات فقط" defaultValue={query.get('funding')||''}/></label>
   <label>حجم الصفحة<select name="pageSize" defaultValue={query.get('pageSize')||'25'}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label>
   <button className="primary" type="submit">تطبيق المرشحات</button><CrmLink className="crm-button" href="/crm?tab=reports">إعادة ضبط المرشحات</CrmLink>
  </form>
  <p className="report-scope">الفترة المطبقة: {stateData?.filters.from||'…'} — {stateData?.filters.to||'…'} بتقويم الرياض (UTC+03)، والافتراضي آخر 30 يوماً. المصدر يؤثر في وحدات العملاء، والمرحلة تعني مرحلة طلب التمويل في المعاملات ومرحلة العميل في غيرها، وجهة التمويل للمعاملات فقط. الموظف يحدد التكليف/الملكية في وحدات العملاء، والموظف/الفاعل في HR والتدقيق. الإعلانات وSheets لا يرتبطان بموظف. لكل وحدة أساس تاريخ موضح؛ اللقطات الحالية ليست تاريخاً للحالة. الرابط يحفظ المرشحات.</p>
  {loading&&<p role="status">جارٍ تحميل التقارير…</p>}
  {error&&<div role="alert" className="error">{error} <button onClick={()=>setRetry(n=>n+1)}>إعادة المحاولة</button></div>}
  {stateData?.summaries&&<div className="report-overview panel"><h3>تغطية النظام ضمن الصلاحية</h3><div className="report-table-scroll" tabIndex={0} aria-label="ملخص الوحدات"><table><thead><tr><th>التقرير</th><th>السجلات</th><th>أساس القراءة وحدودها</th><th>التفاصيل</th></tr></thead><tbody>{stateData.summaries.map(s=><tr key={s.id}><th scope="row">{s.label}</th><td>{s.status==='ok'?s.total:'غير متاح'}</td><td><strong>{s.kind}</strong><p>{s.status==='ok'?s.note:s.error}</p>{s.metrics?.slice(0,2).map((m,i)=><p key={i}>{m.label}: {m.value??'غير مسجل'}{m.missing?` · ${m.missing} غير مسجل`:''}</p>)}</td><td><CrmLink href={href({module:s.id,page:'1'})}>عرض التفاصيل</CrmLink></td></tr>)}</tbody></table></div>
   <div className="report-charts-grid">
    <div className="report-chart panel"><h4>توزيع السجلات حسب الوحدة</h4><ResponsiveContainer width="100%" height={280}><BarChart data={stateData.summaries.filter(s=>s.status==='ok'&&s.total!==null).map(s=>({name:s.label,value:s.total}))}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name" tick={{fontSize:11}} angle={-35} textAnchor="end" height={70}/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="value" name="السجلات" radius={[6,6,0,0]}>{stateData.summaries.filter(s=>s.status==='ok').map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer></div>
   </div>
  </div>}
  {report&&<>
   <div className="report-heading"><div><h3>{report.label}</h3><p>{report.kind}</p></div><div className="report-actions">{stateData?.canExport?<button disabled={exporting} onClick={()=>void download()}>{exporting?'جارٍ التصدير…':'تصدير CSV لكل النتائج'}</button>:<span>التصدير للإدارة فقط</span>}<button onClick={()=>window.print()}>طباعة الصفحة الحالية</button></div></div>
   <p className="report-caveat">{report.note}</p><p>عدد السجلات المطابقة: <strong>{report.total}</strong> · الصفحة {page} من {pages} · قراءة <time dateTime={report.generatedAt} dir="ltr">{report.generatedAt}</time> · «—» تعني غير مسجل، لا صفراً. الحد الآمن 10000 سجل؛ تجاوز الحد يرفض القراءة والتصدير بدلاً من مجموع جزئي.</p>
   {exportError&&<p role="alert" className="error">{exportError}</p>}
   {report.metrics.length>0&&<dl className="report-metrics">{report.metrics.map((m,i)=><div key={i}><dt>{m.label}</dt><dd>{m.value??'غير مسجل'}{m.missing!==undefined&&m.missing>0&&<small> · غير مسجل في {m.missing} سجل</small>}</dd></div>)}</dl>}
   {(metricsChart.length>0||groupsCharts)&&<div className="report-charts-grid">
    {metricsChart.length>0&&<div className="report-chart panel"><h4>المؤشرات الرقمية</h4><ResponsiveContainer width="100%" height={280}><BarChart data={metricsChart} layout="vertical"><CartesianGrid strokeDasharray="3 3"/><XAxis type="number"/><YAxis dataKey="name" type="category" width={160} tick={{fontSize:12}}/><Tooltip/><Bar dataKey="value" name="القيمة" radius={[0,6,6,0]}>{metricsChart.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer></div>}
    {groupsCharts?.map(gc=>(
      gc.data.length>1&&gc.data.length<=8?
       <div className="report-chart panel" key={gc.gkey}><h4>توزيع {gc.title}</h4><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={gc.data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} label>{gc.data.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer></div>
      :
       <div className="report-chart panel" key={gc.gkey}><h4>توزيع {gc.title}</h4><ResponsiveContainer width="100%" height={280}><BarChart data={gc.data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name" tick={{fontSize:11}} angle={-35} textAnchor="end" height={70}/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="value" name="السجلات" radius={[6,6,0,0]}>{gc.data.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer></div>
    ))}
   </div>}
   {Object.entries(report.groups).map(([gkey,groups])=>groups.length>0&&<details className="report-group" key={gkey}><summary>{groupNames[gkey]||gkey} — توزيع السجلات ({groups.length})</summary><ul>{groups.map(g=><li key={g.label}>{['source','stage'].includes(gkey)&&g.label!=='غير محدد'?<CrmLink href={href({[gkey]:g.label,page:'1'})}>{g.label}</CrmLink>:g.label} <strong>{g.count}</strong></li>)}</ul></details>)}
   {report.rows.length?<div className="report-table-scroll panel" tabIndex={0} aria-label="تفاصيل التقرير"><table className="report-detail-table"><thead><tr>{report.columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{report.rows.map((r,i)=><tr key={String(r.id||r.user_id||i)+i}>{report.columns.map(c=>{const link=deepLink(c.key,r[c.key]);return <td key={c.key} data-label={c.label}>{link?<a href={link}>{String(r[c.key])}</a>:<bdi>{r[c.key]??'—'}</bdi>}</td>;})}</tr>)}</tbody></table></div>:<p className="panel">{report.total?'هذه الصفحة خارج النتائج؛ انتقل إلى الصفحة الأولى.':'لا توجد سجلات مطابقة في المصدر المقروء بنجاح.'}</p>}
   <nav className="report-pagination" aria-label="صفحات التقرير">{page>1&&<CrmLink className="crm-button" href={href({page:String(page-1)})}>السابق</CrmLink>}<CrmLink className="crm-button" href={href({page:'1'})}>الصفحة الأولى</CrmLink>{page<pages&&<CrmLink className="crm-button" href={href({page:String(page+1)})}>التالي</CrmLink>}</nav>
  </>}
 </section>;
}
