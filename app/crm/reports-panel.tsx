'use client';
import {useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,PieChart,Pie,Cell,Legend,CartesianGrid,AreaChart,Area} from 'recharts';
import {AlertCircle,BarChart3,Bell,Building2,Calendar,CheckCircle2,ClipboardList,Download,FileText,Filter,Home,Info,Layers,PieChart as PieIcon,TrendingUp,Users} from 'lucide-react';
import {allowedReports,type ReportResult} from '@/lib/report-catalog';
import {CrmLink,navigateCrm,useCrmQuery} from './navigation';

type Summary={id:string;label:string;kind:string;note:string;status:string;total:number|null;error?:string;metrics?:ReportResult['metrics']};
type ReportSnapshotsPayload={
 note:string;
 clients:{status:'ok';total:number;interested:number;notInterested:number;byStage:{stage:string;label:string;count:number}[]}|{status:'unavailable';error:string};
 properties:{status:'ok';total:number;byNeighborhood:{label:string;count:number}[]}|{status:'unavailable';error:string};
};
type Payload={report?:ReportResult;summaries?:Summary[];snapshots?:ReportSnapshotsPayload;employees:{id:string;name:string}[];canExport:boolean;filters:{from:string;to:string;employee:string;source:string;stage:string;funding:string;page:number;pageSize:number};generatedAt?:string};
type Metric=NonNullable<ReportResult['metrics']>[number];

const groupNames:Record<string,string>={source:'المصادر',stage:'المراحل',sales:'المبيعات',field:'الميدان',follow_up_age:'عمر المتابعة',city:'المدن',action:'الأعمال',user_id:'المستخدمون',name:'الموظفون',department:'الأقسام',schedule_status:'الدوام',type:'الخدمات',status:'الحالات',role:'الأدوار',active:'تفعيل الحساب',actor_id:'الفاعلون',fundingEntity:'جهات التمويل',debtPayer:'جهة السداد',requestStage:'مرحلة الطلب'};
const CHART_COLORS=['#3F1A44','#6B5A70','#9CA3AF','#5B245F','#D1D5DB','#8B6B90','#4B5563','#C4B5C8','#374151','#E5E7EB'];
const PURPLE='#3F1A44';
const GREY_BAR='#E5E7EB';
const SIGNED_STAGES=new Set(['contract_signed','transferred','won','deposit_paid']);

function isNumericValue(v:unknown):boolean{
 if(v===null||v===undefined||v==='')return false;
 const n=Number(String(v).replace(/[,٬]/g,''));
 return Number.isFinite(n);
}
function numericOf(v:unknown):number{
 return Number(String(v).replace(/[,٬]/g,''));
}
function fmt(n:number|null|undefined):string{
 if(n===null||n===undefined||!Number.isFinite(n))return '—';
 return n.toLocaleString('ar-SA');
}

function HorizontalBars({items,title}:{items:{label:string;count:number}[];title:string}){
 const total=items.reduce((n,i)=>n+i.count,0)||1;
 return (
  <div className="report-hbar-card panel reports-chart-card">
   <h4>{title}</h4>
   <ul className="report-hbar-list">
    {items.map((item,idx)=>{
     const pct=Math.round((item.count/total)*100);
     const isTop=idx===0;
     const isNotQualified=/غير مؤهل|not.?qualif/i.test(item.label);
     const fill=isNotQualified?'#9CA3AF':isTop?PURPLE:GREY_BAR;
     return (
      <li key={item.label+idx}>
       <div className="report-hbar-meta">
        <span className="report-hbar-label">{item.label}</span>
        <span className="report-hbar-stats">({pct}%) {item.count}</span>
       </div>
       <div className="report-hbar-track" aria-hidden="true">
        <span className="report-hbar-fill" style={{width:`${Math.max(pct, pct>0?2:0)}%`,background:fill}}/>
       </div>
      </li>
     );
    })}
   </ul>
  </div>
 );
}

function KpiCard({value,label,icon,chip}:{value:string|number;label:string;icon:ReactNode;chip?:string}){
 return (
  <div className="reports-kpi-card">
   <div className="reports-kpi-icon" aria-hidden="true">{icon}</div>
   <strong className="reports-kpi-value">{value}</strong>
   <span className="reports-kpi-label">{label}</span>
   {chip?<span className="reports-kpi-chip">{chip}</span>:null}
  </div>
 );
}

function ChartEmpty({title,hint}:{title:string;hint:string}){
 return (
  <div className="reports-chart-card panel report-chart">
   <h4>{title}</h4>
   <div className="reports-chart-empty" role="status">
    <TrendingUp size={28} aria-hidden="true"/>
    <p>{hint}</p>
   </div>
  </div>
 );
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
 async function download(moduleOverride?:string){
  setExportError('');setExporting(true);
  try{
   const exportParams=new URLSearchParams(key);
   if(moduleOverride)exportParams.set('module',moduleOverride);
   const mod=exportParams.get('module')||selectedModule;
   if(mod==='overview')exportParams.set('module','leads');
   const r=await fetch('/api/reports?'+exportParams.toString()+'&format=csv',{cache:'no-store'});
   if(!r.ok){const data=await r.json();throw Error(data.error||'تعذر التصدير');}
   const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');
   a.href=url;a.download=`sas-report-${exportParams.get('module')||selectedModule}.csv`;a.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setExportError(e instanceof Error?e.message:'تعذر التصدير');}
  finally{setExporting(false);}
 }
 const page=report?.page||1,pages=Math.max(1,Math.ceil((report?.total||0)/(report?.pageSize||25)));
 function deepLink(column:string,value:unknown){if(value===null||value===undefined||value==='')return '';if(column==='lead_id'||(column==='id'&&['leads','followups'].includes(selectedModule)))return '/crm/leads/'+encodeURIComponent(String(value));if(column==='property_id'||(column==='id'&&selectedModule==='properties'&&!['other'].includes(String(value))))return '/properties/'+encodeURIComponent(String(value));return '';}

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

 const snap=stateData?.snapshots;
 const clientsOk=snap?.clients.status==='ok'?snap.clients:null;
 const propsOk=snap?.properties.status==='ok'?snap.properties:null;
 const followupsSummary=stateData?.summaries?.find(s=>s.id==='followups');
 const transactionsSummary=stateData?.summaries?.find(s=>s.id==='transactions');
 const leadsSummary=stateData?.summaries?.find(s=>s.id==='leads');
 const stageBars=clientsOk?.byStage.map(s=>({label:s.label,count:s.count,stage:s.stage}))||[];
 const neighborhoodBars=propsOk?.byNeighborhood.slice(0,8).map(n=>({label:n.label,count:n.count}))||[];
 const salesGroups=report?.groups?.sales||[];

 const signedCount=clientsOk?clientsOk.byStage.filter(s=>SIGNED_STAGES.has(s.stage)).reduce((n,s)=>n+s.count,0):null;
 const completedDeals=transactionsSummary?.status==='ok'&&transactionsSummary.total!==null
  ?transactionsSummary.total
  :signedCount;
 const scheduledFollowups=followupsSummary?.status==='ok'?followupsSummary.total:null;
 const newClientsCount=clientsOk
  ?(clientsOk.byStage.find(s=>s.stage==='new')?.count ?? clientsOk.total)
  :(leadsSummary?.status==='ok'?leadsSummary.total:null);
 const employeesCount=stateData?.employees.length??null;

 const stagePieData=stageBars.slice(0,8).map(s=>({name:s.label,value:s.count}));
 const moduleBars=(stateData?.summaries||[])
  .filter(s=>s.status==='ok'&&s.total!==null)
  .map(s=>({name:s.label,value:s.total as number}));

 const perfRows=(()=>{
  if(salesGroups.length>0){
   const total=salesGroups.reduce((n,g)=>n+g.count,0)||1;
   return salesGroups.map((g,i)=>({
    rank:i+1,
    name:g.label,
    id:'',
    clients:g.count as number|null,
    pct:Math.round((g.count/total)*100) as number|null,
    linkEmployee:''
   }));
  }
  const emps=stateData?.employees||[];
  return emps.slice(0,40).map((emp,i)=>({
   rank:i+1,
   name:emp.name,
   id:emp.id,
   clients:null as number|null,
   pct:null as number|null,
   linkEmployee:emp.id
  }));
 })();

 const alerts=(()=>{
  const rows:{tone:'info'|'warn'|'muted';tag:string;message:string;time:string}[]=[];
  const gen=stateData?.generatedAt?new Date(stateData.generatedAt):new Date();
  const timeLabel=gen.toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'});
  if(followupsSummary?.status==='ok'&&followupsSummary.total!==null){
   const overdue=followupsSummary.metrics?.find(m=>/متأخر|قبل اليوم/i.test(m.label));
   if(overdue&&isNumericValue(overdue.value)&&numericOf(overdue.value)>0){
    rows.push({tone:'warn',tag:'تنبيه',message:`${fmt(numericOf(overdue.value))} مواعيد متابعة متأخرة تحتاج انتباهاً.`,time:timeLabel});
   }else if(followupsSummary.total>0){
    rows.push({tone:'info',tag:'معلومات',message:`${fmt(followupsSummary.total)} تذكيرات/متابعات ضمن النطاق الحالي.`,time:timeLabel});
   }
  }
  if(completedDeals===0){
   rows.push({tone:'warn',tag:'تنبيه',message:'لا توجد صفقات مكتملة أو معاملات مسجّلة ضمن المرشحات الحالية.',time:timeLabel});
  }
  if(clientsOk&&clientsOk.notInterested>0){
   rows.push({tone:'muted',tag:'ملاحظة',message:`${fmt(clientsOk.notInterested)} عميل مصنّف غير مهتم في اللقطة الحالية.`,time:timeLabel});
  }
  if(stateData?.canExport){
   rows.push({tone:'info',tag:'معلومات',message:'تصدير CSV متاح للإدارة من التقارير التفصيلية وبنفس المرشحات.',time:timeLabel});
  }else{
   rows.push({tone:'muted',tag:'ملاحظة',message:'التصدير مقصور على الإدارة؛ يمكنك عرض التفاصيل والطباعة ضمن نطاقك.',time:timeLabel});
  }
  if(snap?.clients.status==='unavailable'){
   rows.push({tone:'warn',tag:'تنبيه',message:`لقطة العملاء غير متاحة: ${snap.clients.error}`,time:timeLabel});
  }
  if(snap?.properties.status==='unavailable'){
   rows.push({tone:'warn',tag:'تنبيه',message:`لقطة العقارات غير متاحة: ${snap.properties.error}`,time:timeLabel});
  }
  return rows.slice(0,5);
 })();

 const isOverview=selectedModule==='overview';

 return <section className="reports-center reports-dash" aria-label="مركز التقارير">
  <div className="report-heading reports-dash-head">
   <div className="reports-dash-title">
    <h2><BarChart3 size={26} aria-hidden="true"/> التقارير</h2>
    <p className="subtle">تحليل شامل لأداء المشرفين والموظفين والعملاء والعقارات · {role==='admin'?'نطاق الإدارة':'سجلاتك المملوكة أو المسندة لك'}</p>
   </div>
   <div className="report-heading-actions">
    {stateData?.canExport?(
     <button type="button" className="report-primary-btn" disabled={exporting} onClick={()=>void download(isOverview?'leads':undefined)}>
      <Download size={16}/> {exporting?'جارٍ التصدير…':'تصدير التقرير'}
     </button>
    ):null}
    <CrmLink className="report-secondary-btn" href="/crm?tab=reports&module=leads">
     <FileText size={16}/> تفاصيل العملاء
    </CrmLink>
   </div>
  </div>

  <form className="report-filters panel report-filter-card reports-filters" onSubmit={submit} key={key+(stateData?.filters.from||'')}>
   <div className="report-filter-head">
    <h3><Filter size={16} aria-hidden="true"/> تصفية التقارير</h3>
    <CrmLink className="report-clear-link" href="/crm?tab=reports">مسح الفلاتر</CrmLink>
   </div>
   <div className="report-filter-grid reports-filters-row">
    <label className="reports-filter-period">الفترة
     <div className="reports-date-range">
      <input type="date" name="from" aria-label="من تاريخ" defaultValue={query.get('from')||stateData?.filters.from||''}/>
      <span aria-hidden="true">←</span>
      <input type="date" name="to" aria-label="إلى تاريخ" defaultValue={query.get('to')||stateData?.filters.to||''}/>
     </div>
    </label>
    <label>مرحلة العميل<input name="stage" placeholder={selectedModule==='transactions'?'مرحلة طلب التمويل':'كل المراحل'} defaultValue={query.get('stage')||''}/></label>
    <label>مصدر العميل<input name="source" placeholder="كل المصادر" defaultValue={query.get('source')||''}/></label>
    <label>الموظف<select name="reportEmployee" defaultValue={query.get('reportEmployee')||''}><option value="">{role==='admin'?'جميع الموظفين':'نطاقي فقط'}</option>{stateData?.employees.map(e=><option key={e.id} value={e.id}>{e.name} — {e.id}</option>)}</select></label>
    <label>الوحدة التقريرية<select name="module" defaultValue={selectedModule}><option value="overview">نظرة عامة — كل المسموح</option>{modules.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    {!isOverview?(
     <>
      <label>جهة التمويل<input name="funding" placeholder="للمعاملات فقط" defaultValue={query.get('funding')||''}/></label>
      <label>حجم الصفحة<select name="pageSize" defaultValue={query.get('pageSize')||'25'}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label>
     </>
    ):(
     <>
      <input type="hidden" name="funding" value={query.get('funding')||''}/>
      <input type="hidden" name="pageSize" value={query.get('pageSize')||'25'}/>
     </>
    )}
    <div className="report-filter-actions reports-filter-submit">
     <button className="primary report-primary-btn" type="submit">تطبيق التصفية</button>
    </div>
   </div>
   <p className="report-filter-help">التصدير إلى CSV يتبع نفس الفلاتر المطبقة أعلاه. الفترة الافتراضية آخر 30 يوماً بتوقيت الرياض.</p>
  </form>

  <p className="report-scope">الفترة المطبقة: {stateData?.filters.from||'…'} — {stateData?.filters.to||'…'} بتقويم الرياض (UTC+03)، والافتراضي آخر 30 يوماً. المصدر يؤثر في وحدات العملاء، والمرحلة تعني مرحلة طلب التمويل في المعاملات ومرحلة العميل في غيرها، وجهة التمويل للمعاملات فقط. الموظف يحدد التكليف/الملكية في وحدات العملاء، والموظف/الفاعل في HR والتدقيق. الإعلانات وSheets لا يرتبطان بموظف. لكل وحدة أساس تاريخ موضح؛ اللقطات الحالية ليست تاريخاً للحالة. الرابط يحفظ المرشحات.</p>

  {loading&&<p role="status">جارٍ تحميل التقارير…</p>}
  {error&&<div role="alert" className="error">{error} <button onClick={()=>setRetry(n=>n+1)}>إعادة المحاولة</button></div>}
  {exportError&&<p role="alert" className="error">{exportError}</p>}

  {stateData&&isOverview&&(
   <div className="reports-overview" aria-label="لوحة نظرة عامة">
    <div className="reports-kpis" aria-label="مؤشرات رئيسية">
     <KpiCard value={fmt(employeesCount)} label="عدد الموظفين" icon={<Users size={18}/>} chip={employeesCount!=null?`نطاق ${role==='admin'?'الإدارة':'المستخدم'}`:undefined}/>
     <KpiCard value={fmt(scheduledFollowups)} label="معاينات / متابعات مجدولة" icon={<Calendar size={18}/>} chip={scheduledFollowups!=null&&clientsOk&&clientsOk.total>0?`${Math.round((scheduledFollowups/clientsOk.total)*100)}% من العملاء`:undefined}/>
     <KpiCard value={fmt(completedDeals)} label="المعاملات / الصفقات المكتملة" icon={<CheckCircle2 size={18}/>} chip={signedCount!=null&&clientsOk&&clientsOk.total>0?`${Math.round((signedCount/clientsOk.total)*100)}% وقع/أفرغ`:undefined}/>
     <KpiCard value={fmt(newClientsCount)} label="عدد العملاء" icon={<ClipboardList size={18}/>} chip={clientsOk?`${fmt(clientsOk.interested)} مهتم`:undefined}/>
     <KpiCard value={fmt(propsOk?.total)} label="عقارات الكتالوج" icon={<Building2 size={18}/>} chip={propsOk?`${fmt(propsOk.byNeighborhood.length)} أحياء`:undefined}/>
    </div>

    <div className="reports-charts" aria-label="رسوم بيانية">
     <div className="reports-chart-card panel report-chart">
      <h4><PieIcon size={16} aria-hidden="true"/> توزيع مراحل العملاء</h4>
      {stagePieData.length>0?(
       <ResponsiveContainer width="100%" height={280}>
        <PieChart>
         <Pie data={stagePieData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2}>
          {stagePieData.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}
         </Pie>
         <Tooltip/>
         <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{fontSize:12}}/>
        </PieChart>
       </ResponsiveContainer>
      ):<div className="reports-chart-empty" role="status"><p>لا تتوفر بيانات مراحل حالياً.</p></div>}
      {clientsOk?<p className="subtle reports-chart-caption">إجمالي العملاء: {fmt(clientsOk.total)}</p>:null}
     </div>

     {neighborhoodBars.length>0?(
      <HorizontalBars title="توزيع العقارات حسب الحي" items={neighborhoodBars}/>
     ):(
      <ChartEmpty title="توزيع العقارات حسب الحي" hint="لا تتوفر بيانات أحياء في الكتالوج حالياً."/>
     )}

     {report?.trend&&report.trend.points.length>1?(
      <div className="reports-chart-card panel report-chart">
       <h4><TrendingUp size={16} aria-hidden="true"/> المعاملات عبر الزمن</h4>
       <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={report.trend.points}>
         <defs>
          <linearGradient id="overviewTrendFill" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0%" stopColor="#3F1A44" stopOpacity={0.45}/>
           <stop offset="100%" stopColor="#3F1A44" stopOpacity={0.04}/>
          </linearGradient>
         </defs>
         <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
         <XAxis dataKey="day" tick={{fontSize:10}} minTickGap={18}/>
         <YAxis allowDecimals={false}/>
         <Tooltip/>
         <Area type="monotone" dataKey="count" name="السجلات" stroke="#3F1A44" strokeWidth={2} fill="url(#overviewTrendFill)" dot={{r:3,fill:'#3F1A44'}}/>
        </AreaChart>
       </ResponsiveContainer>
      </div>
     ):(
      <ChartEmpty title="المعاملات عبر الزمن" hint="الخط الزمني يظهر في التقارير التفصيلية التي تدعم الاتجاه. افتح وحدة المعاملات أو العملاء لعرضه."/>
     )}

     <div className="reports-chart-card panel report-chart">
      <h4><Layers size={16} aria-hidden="true"/> توزيع حسب الوحدة</h4>
      {moduleBars.length>0?(
       <ResponsiveContainer width="100%" height={280}>
        <BarChart data={moduleBars}>
         <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
         <XAxis dataKey="name" tick={{fontSize:11}} angle={-30} textAnchor="end" height={70}/>
         <YAxis allowDecimals={false}/>
         <Tooltip/>
         <Bar dataKey="value" name="السجلات" radius={[6,6,0,0]}>
          {moduleBars.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}
         </Bar>
        </BarChart>
       </ResponsiveContainer>
      ):<div className="reports-chart-empty" role="status"><p>لا تتوفر ملخصات وحدات حالياً.</p></div>}
     </div>
    </div>

    <div className="reports-perf panel" aria-label="أداء الموظفين">
     <div className="reports-perf-head">
      <div>
       <h3>أداء الموظفين ضمن النطاق</h3>
       <p className="subtle">عدد الموظفين: {fmt(employeesCount)}{clientsOk?` · إجمالي العملاء: ${fmt(clientsOk.total)}`:''}</p>
      </div>
      <CrmLink className="report-secondary-btn reports-perf-all" href="/crm?tab=users">عرض جميع الموظفين</CrmLink>
     </div>
     <div className="report-table-scroll" tabIndex={0} aria-label="جدول أداء الموظفين">
      <table className="reports-perf-table">
       <thead>
        <tr>
         <th>#</th>
         <th>الموظف</th>
         <th>المعرّف</th>
         <th>العملاء</th>
         <th>نسبة الإنجاز</th>
         <th></th>
        </tr>
       </thead>
       <tbody>
        {perfRows.length===0?(
         <tr><td colSpan={6}>لا يوجد موظفون في النطاق.</td></tr>
        ):perfRows.map(row=>(
         <tr key={row.id||row.name+row.rank}>
          <td>{row.rank}</td>
          <th scope="row">
           <span className="reports-perf-name">
            <span className="reports-perf-avatar" aria-hidden="true"><Users size={14}/></span>
            {row.name}
           </span>
          </th>
          <td>{row.id?<bdi>{row.id}</bdi>:'—'}</td>
          <td>{row.clients!=null?fmt(row.clients):'—'}</td>
          <td>
           {row.pct!=null?(
            <div className="reports-progress" title={`${row.pct}%`}>
             <span className="reports-progress-track"><span className="reports-progress-fill" style={{width:`${row.pct}%`}}/></span>
             <span className="reports-progress-label">{row.pct}%</span>
            </div>
           ):'—'}
          </td>
          <td>
           {row.linkEmployee?(
            <CrmLink href={href({module:'leads',reportEmployee:row.linkEmployee,page:'1'})}>عرض</CrmLink>
           ):null}
          </td>
         </tr>
        ))}
       </tbody>
      </table>
     </div>
    </div>

    <div className="reports-alerts panel" aria-label="تنبيهات وملاحظات">
     <div className="reports-alerts-head">
      <h3><Bell size={16} aria-hidden="true"/> التنبيهات والملاحظات</h3>
     </div>
     <ul className="reports-alerts-list">
      {alerts.map((a,i)=>(
       <li key={i} className={`reports-alert tone-${a.tone}`}>
        <span className="reports-alert-icon" aria-hidden="true">
         {a.tone==='warn'?<AlertCircle size={18}/>:a.tone==='info'?<Info size={18}/>:<Home size={18}/>}
        </span>
        <p className="reports-alert-msg">{a.message}</p>
        <span className="reports-alert-tag">{a.tag}</span>
        <time className="reports-alert-time">{a.time}</time>
       </li>
      ))}
     </ul>
     {snap?.note?<p className="subtle reports-alerts-note">{snap.note}</p>:null}
    </div>

    {stateData.summaries&&(
     <details className="reports-coverage panel">
      <summary>تغطية النظام ضمن الصلاحية — جداول الوحدات</summary>
      <div className="report-table-scroll" tabIndex={0} aria-label="ملخص الوحدات">
       <table>
        <thead><tr><th>التقرير</th><th>السجلات</th><th>أساس القراءة وحدودها</th><th>التفاصيل</th></tr></thead>
        <tbody>
         {stateData.summaries.map(s=>(
          <tr key={s.id}>
           <th scope="row">{s.label}</th>
           <td>{s.status==='ok'?s.total:'غير متاح'}</td>
           <td>
            <strong>{s.kind}</strong>
            <p>{s.status==='ok'?s.note:s.error}</p>
            {s.metrics?.slice(0,2).map((m,i)=><p key={i}>{m.label}: {m.value??'غير مسجل'}{m.missing?` · ${m.missing} غير مسجل`:''}</p>)}
           </td>
           <td><CrmLink href={href({module:s.id,page:'1'})}>عرض التفاصيل</CrmLink></td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     </details>
    )}
   </div>
  )}

  {report&&<>
   <div className="report-heading"><div><h3>{report.label}</h3><p>{report.kind}</p></div><div className="report-actions">{stateData?.canExport?<button className="report-primary-btn" disabled={exporting} onClick={()=>void download()}>{exporting?'جارٍ التصدير…':'تصدير CSV لكل النتائج'}</button>:<span>التصدير للإدارة فقط</span>}<button className="crm-button" onClick={()=>window.print()}>طباعة الصفحة الحالية</button></div></div>
   <p className="report-caveat">{report.note}</p><p>عدد السجلات المطابقة: <strong>{report.total}</strong> · الصفحة {page} من {pages} · قراءة <time dateTime={report.generatedAt} dir="ltr">{report.generatedAt}</time> · «—» تعني غير مسجل، لا صفراً. الحد الآمن 10000 سجل؛ تجاوز الحد يرفض القراءة والتصدير بدلاً من مجموع جزئي.</p>
   {report.metrics.length>0&&<dl className="report-metrics">{report.metrics.map((m,i)=><div key={i}><dt>{m.label}</dt><dd>{m.value??'غير مسجل'}{m.missing!==undefined&&m.missing>0&&<small> · غير مسجل في {m.missing} سجل</small>}</dd></div>)}</dl>}

   {(report.groups.stage?.length||report.groups.source?.length)?(
    <div className="report-charts-grid report-hbar-grid">
     {report.groups.stage?.length>0&&<HorizontalBars title="توزيع المراحل" items={report.groups.stage.map(g=>({label:g.label,count:g.count}))}/>}
     {report.groups.source?.length>0&&<HorizontalBars title="مصادر العملاء" items={report.groups.source.map(g=>({label:g.label,count:g.count}))}/>}
    </div>
   ):null}

   {salesGroups.length>0&&(
    <div className="report-team-card panel">
     <div className="report-team-head">
      <div>
       <h3>أداء فريق المبيعات</h3>
       <p className="subtle">عدد الصفوف: {salesGroups.length}</p>
      </div>
      <span className="report-total-badge">إجمالي العملاء: {report.total}</span>
     </div>
     <div className="report-table-scroll" tabIndex={0}>
      <table className="report-team-table">
       <thead><tr><th>الموظف</th><th>الإجمالي</th></tr></thead>
       <tbody>
        <tr className="report-team-total-row"><th scope="row">إجمالي الفريق</th><td><strong>{report.total}</strong></td></tr>
        {salesGroups.map(g=><tr key={g.label}><th scope="row">{g.label}</th><td><strong>{g.count}</strong></td></tr>)}
       </tbody>
      </table>
     </div>
    </div>
   )}

   {(metricsChart.length>0||groupsCharts||report.trend)&&<div className="report-charts-grid">
    {report.trend&&report.trend.points.length>1&&<div className="report-chart panel report-chart-wide"><h4>الخط الزمني — {report.trend.basis}</h4><ResponsiveContainer width="100%" height={260}><AreaChart data={report.trend.points}><defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3F1A44" stopOpacity={0.55}/><stop offset="100%" stopColor="#3F1A44" stopOpacity={0.05}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="day" tick={{fontSize:10}} minTickGap={18}/><YAxis allowDecimals={false}/><Tooltip/><Area type="monotone" dataKey="count" name="السجلات" stroke="#3F1A44" strokeWidth={2} fill="url(#trendFill)"/></AreaChart></ResponsiveContainer><p className="subtle">الأيام بلا سجلات تظهر صفراً وليست بيانات ناقصة.</p></div>}
    {metricsChart.length>0&&<div className="report-chart panel"><h4>المؤشرات الرقمية</h4><ResponsiveContainer width="100%" height={280}><BarChart data={metricsChart} layout="vertical"><CartesianGrid strokeDasharray="3 3"/><XAxis type="number"/><YAxis dataKey="name" type="category" width={160} tick={{fontSize:12}}/><Tooltip/><Bar dataKey="value" name="القيمة" radius={[0,6,6,0]}>{metricsChart.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer></div>}
    {groupsCharts?.filter(gc=>!['stage','source','sales'].includes(gc.gkey)).map(gc=>(
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

