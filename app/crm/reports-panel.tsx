'use client';
import {Fragment,useEffect,useRef,useState,type FormEvent,type MouseEvent,type ReactNode} from 'react';
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,PieChart,Pie,Cell,Legend,CartesianGrid,AreaChart,Area,LineChart,Line} from 'recharts';
import {AlertCircle,BarChart3,Bell,Building2,Calendar,CheckCircle2,ClipboardList,Download,FileText,Filter,Home,Info,Layers,PieChart as PieIcon,TrendingUp,Users} from 'lucide-react';
import {allowedReports,type ReportResult} from '@/lib/report-catalog';
import type {EmployeeAssignmentReport,ReportDashboard} from '@/lib/reports';
import {isEverFieldDispatchFilter} from '@/lib/lead-cohorts';
import {canonicalStage, displayStage, stageChoices, stageLabel} from '@/lib/lead-stages';
import {riyadhDayKey} from '@/lib/lead-dates';
import {activeReportPreset, reportPresetRange} from '@/lib/report-presets';
import {employeeStageColumns, sumStageTable} from '@/lib/employee-stages';
import type {DashboardEmployee} from '@/lib/reports';
import {buildReportPath,leadReturnHref,rememberReportScroll,restoreReportScroll} from '@/lib/report-return';
import {CrmLink,navigateCrm,useCrmQuery} from './navigation';

type Summary={id:string;label:string;kind:string;note:string;status:string;total:number|null;error?:string;metrics?:ReportResult['metrics']};
type ReportSnapshotsPayload={
 note:string;
 clients:{status:'ok';total:number;interested:number;notInterested:number;byStage:{stage:string;label:string;count:number}[]}|{status:'unavailable';error:string};
 properties:{status:'ok';total:number;byNeighborhood:{label:string;count:number}[]}|{status:'unavailable';error:string};
};
type Payload={report?:ReportResult;summaries?:Summary[];snapshots?:ReportSnapshotsPayload;dashboard?:ReportDashboard|null;dashboardError?:string;assignment?:EmployeeAssignmentReport;employees:{id:string;name:string;username?:string;role?:string}[];canExport:boolean;filters:{from:string;to:string;employee:string;source:string;stage:string;funding:string;page:number;pageSize:number};generatedAt?:string};
type Metric=NonNullable<ReportResult['metrics']>[number];

const groupNames:Record<string,string>={source:'المصادر',stage:'المراحل',sales:'المبيعات',field:'الميدان',follow_up_age:'عمر المتابعة',city:'المدن',action:'الأعمال',user_id:'المستخدمون',name:'الموظفون',department:'الأقسام',schedule_status:'الدوام',type:'الخدمات',status:'الحالات',role:'الأدوار',active:'تفعيل الحساب',actor_id:'الفاعلون',fundingEntity:'جهات التمويل',debtPayer:'جهة السداد',requestStage:'مرحلة الطلب'};
const CHART_COLORS=['#3F1A44','#5B245F','#6B5A70','#4B5563','#8B6B90','#374151','#A78BAA','#6B7280','#542454','#1F2937','#7C6A86','#4A4450','#2E1233','#9CA3AF','#C4B5C8','#111827'];
const PURPLE='#3F1A44';
const GREY_BAR='#E5E7EB';
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
 return Math.round(n).toLocaleString('en-US');
}
function fmtMaybe(n:number|null|undefined,known=true):string{
 if(!known)return 'غير متاح';
 return fmt(n);
}
function fmtHours(n:number|null|undefined,known:boolean):string{
 if(!known)return 'غير متاح';
 if(n==null||!Number.isFinite(n))return '—';
 return `${n.toLocaleString('en-US',{maximumFractionDigits:1})} س`;
}
function pctOf(part:number,whole:number):string{
 if(!whole)return '—';
 return `${Math.round((part/whole)*100)}%`;
}
type SortKey='name'|'assigned'|'contacted'|'interested'|'signed'|'notInterested'|'overdue'|'completion'|'dispatched'|'visitsDone'|'reportsSubmitted'|'reportsOverdue'|'deals'|'transactions'|'avgHoursToFirstContact'|`stage:${string}`;
const STAGE_COLUMNS=employeeStageColumns();
function sortValue(row:DashboardEmployee,key:SortKey):number|string{
 if(key==='name')return row.name;
 if(key.startsWith('stage:'))return row.stages?.[key.slice(6)]||0;
 const value=row[key as keyof DashboardEmployee];
 if(typeof value==='number')return value;
 return -1;
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

function KpiCard({value,label,icon,chip,href}:{value:string|number;label:string;icon:ReactNode;chip?:string;href?:string}){
 const body=<>
  <div className="reports-kpi-icon" aria-hidden="true">{icon}</div>
  <strong className="reports-kpi-value">{value}</strong>
  <span className="reports-kpi-label">{label}</span>
  {chip?<span className="reports-kpi-chip">{chip}</span>:null}
 </>;
 return href?<CrmLink className="reports-kpi-card" href={href}>{body}</CrmLink>:<div className="reports-kpi-card">{body}</div>;
}

function stageFilterValue(raw:string){
 const text=raw.trim();
 if(!text)return '';
 const key=displayStage(canonicalStage(text)||text);
 return stageChoices().some(([stageKey])=>stageKey===key)?stageLabel(key):text;
}
function stageFilterExtra(raw:string){
 const selected=stageFilterValue(raw);
 if(!selected||stageChoices().some(([,label])=>label===selected))return null;
 return <option value={selected}>{selected}</option>;
}

function NumLink({href,children,onNavigate}:{href:string;children:ReactNode;onNavigate?:()=>void}){
 return <CrmLink className="reports-num-link" href={href} onNavigate={onNavigate}>{children}</CrmLink>;
}
function employeeOptionLabel(employee:{name:string;username?:string;role?:string}){
 const role=employee.role==='sales'?'مبيعات':employee.role==='field'?'ميدان':'';
 const base=employee.username?`${employee.name} (${employee.username})`:employee.name;
 return role?`${base} — ${role}`:base;
}
function SortHead({label,column,title,active,dir,onSort}:{label:string;column:SortKey;title?:string;active:SortKey;dir:'asc'|'desc';onSort:(key:SortKey)=>void}){
 const mark=active===column?(dir==='asc'?' ↑':' ↓'):'';
 return <th title={title} aria-sort={active===column?(dir==='asc'?'ascending':'descending'):'none'}><button type="button" className="reports-sort" onClick={()=>onSort(column)}>{label}{mark}</button></th>;
}
function StageLegend({items,hrefFor}:{items:{stage:string;label:string;count:number;pct:number;color:string}[];hrefFor:(stage:string)=>string}){
 return <ul className="reports-stage-legend">
  {items.map(item=><li key={item.stage}><CrmLink className="reports-stage-link" href={hrefFor(item.stage)}><span className="reports-stage-swatch" style={{background:item.color}} aria-hidden="true"/><span className="reports-stage-name">{item.label} — {fmt(item.count)} ({item.pct}%)</span></CrmLink></li>)}
 </ul>;
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
function chunkRows<T>(items:T[],size:number){
 const pages:T[][]=[];
 for(let i=0;i<items.length;i+=size)pages.push(items.slice(i,i+size));
 return pages.length?pages:[[]] as T[][];
}
function PrintBars({title,items}:{title:string;items:{label:string;count:number}[]}){
 const rows=items.filter(item=>item.count>0);
 const max=Math.max(1,...rows.map(item=>item.count));
 return <div className="pdf-card"><h2><span className="pdf-text">{title}</span></h2>{rows.length?<table className="pdf-bars"><tbody>{rows.map(item=><tr key={item.label}><td className="pdf-bar-name"><span className="pdf-text">{item.label}</span></td><td className="pdf-bar-track"><span className="pdf-bar-fill" style={{width:`${Math.max(item.count?4:0,Math.round((item.count/max)*100))}%`}}/></td><td className="pdf-bar-num"><span className="pdf-text">{fmt(item.count)}</span></td></tr>)}</tbody></table>:<p><span className="pdf-text">—</span></p>}</div>;
}
function PrintKpis({items}:{items:{label:string;value:string}[]}){
 const cells=[...items];
 while(cells.length%4)cells.push({label:'',value:''});
 const rows=chunkRows(cells,4);
 return <section className="pdf-block"><table className="pdf-kpis"><tbody>{rows.map((row,index)=><tr key={index}>{row.map((item,cell)=><td key={cell} className={item.label?'pdf-kpi':'pdf-kpi is-empty'}>{item.label?<><span className="pdf-kpi-label">{item.label}</span><b className="pdf-kpi-value">{item.value}</b></>:null}</td>)}</tr>)}</tbody></table></section>;
}
function PrintMatrix({title,rows,totalRows,columns,withTotal}:{title:string;rows:DashboardEmployee[];totalRows:DashboardEmployee[];columns:typeof STAGE_COLUMNS;withTotal:boolean}){
 const footer=sumStageTable(totalRows.map(row=>({total:row.assigned,stages:row.stages||{}})));
 const span=columns.length+(withTotal?3:1);
 return <section className="pdf-block"><h2><span className="pdf-text">{title}</span></h2><table className="reports-print-table reports-print-matrix"><thead><tr><th><span className="pdf-text">الموظف</span></th>{columns.map(column=><th key={column.stage} title={column.label}><span className="pdf-text">{column.short}</span></th>)}{withTotal?<><th><span className="pdf-text">الإجمالي</span></th><th><span className="pdf-text">النسبة</span></th></>:null}</tr></thead><tbody>{rows.length?rows.map(row=><tr key={row.id}><th><span className="pdf-text">{row.name}</span></th>{columns.map(column=><td key={column.stage}><span className="pdf-text">{fmt(row.stages?.[column.stage]||0)}</span></td>)}{withTotal?<><td><span className="pdf-text">{fmt(row.assigned)}</span></td><td><span className="pdf-text">{pctOf(row.assigned,footer.total)}</span></td></>:null}</tr>):<tr><td colSpan={span}><span className="pdf-text">—</span></td></tr>}</tbody>{rows.length?<tfoot><tr><th><span className="pdf-text">الإجمالي</span></th>{columns.map(column=><td key={column.stage}><span className="pdf-text">{fmt(footer.stages[column.stage]||0)}</span></td>)}{withTotal?<><td><span className="pdf-text">{fmt(footer.total)}</span></td><td><span className="pdf-text">{footer.total?'100%':'—'}</span></td></>:null}</tr></tfoot>:null}</table></section>;
}

export default function ReportsPanel({role}:{role:string}){
 const query=useCrmQuery(),modules=allowedReports(role),selectedModule=query.get('module')||'overview';
 const params=new URLSearchParams();for(const k of ['module','from','to','source','stage','funding','page','pageSize'])if(query.get(k))params.set(k,query.get(k)!);if(query.get('reportEmployee'))params.set('employee',query.get('reportEmployee')!);
 const key=params.toString();
 const [state,setState]=useState<{key:string;data?:Payload;error?:string}>({key:''});
 const [retry,setRetry]=useState(0),[exportError,setExportError]=useState(''),[exporting,setExporting]=useState(false),[pdfBusy,setPdfBusy]=useState(false);
 const [mailMenu,setMailMenu]=useState(false),[mailBusy,setMailBusy]=useState(false),[toast,setToast]=useState<{tone:'ok'|'error';text:string}|null>(null);
 const mailMenuRef=useRef<HTMLDivElement>(null);
 const [draftFrom,setDraftFrom]=useState(''),[draftTo,setDraftTo]=useState('');
 const [sortKey,setSortKey]=useState<SortKey>('assigned'),[sortDir,setSortDir]=useState<'asc'|'desc'>('desc');
 useEffect(()=>{const controller=new AbortController();fetch('/api/reports?'+key,{signal:controller.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||'تعذر تحميل التقرير');return data;}).then(data=>setState({key,data})).catch(e=>{if(!controller.signal.aborted)setState({key,error:e instanceof Error?e.message:'تعذر التحميل'});});return()=>controller.abort();},[key,retry]);
 const current=state.key===key,stateData=current?state.data:undefined,report=stateData?.report,error=current?state.error:undefined,loading=!error&&!stateData;
 const appliedFrom=stateData?.filters.from||'',appliedTo=stateData?.filters.to||'',appliedEmployee=stateData?.filters.employee||'',appliedSource=stateData?.filters.source||'',appliedStage=stateData?.filters.stage||'',appliedFunding=stateData?.filters.funding||'',appliedPage=stateData?.filters.page||1;
 const reportPath=buildReportPath({
  module:query.get('module')||'',
  from:query.get('from')||appliedFrom,
  to:query.get('to')||appliedTo,
  reportEmployee:query.get('reportEmployee')||appliedEmployee,
  source:query.get('source')||appliedSource,
  stage:query.get('stage')||appliedStage,
  funding:query.get('funding')||appliedFunding,
  page:query.get('page')||(appliedPage>1?appliedPage:''),
  pageSize:query.get('pageSize')||'',
 });
 useEffect(()=>{
  if(!stateData)return;
  const currentQuery=new URLSearchParams(window.location.search);
  if(currentQuery.get('tab')!=='reports')return;
  const desired=new URLSearchParams(currentQuery);
  const fill=(name:string,value:string)=>{if(value&&!currentQuery.get(name))desired.set(name,value);};
  fill('from',appliedFrom);fill('to',appliedTo);fill('reportEmployee',appliedEmployee);fill('source',appliedSource);fill('stage',appliedStage);fill('funding',appliedFunding);
  if(appliedPage>1&&!currentQuery.get('page'))desired.set('page',String(appliedPage));
  const next=desired.toString();
  if(next===currentQuery.toString())return;
  window.history.replaceState(window.history.state,'',window.location.pathname+'?'+next+window.location.hash);
  window.dispatchEvent(new Event('crm:navigate'));
 },[stateData,appliedFrom,appliedTo,appliedEmployee,appliedSource,appliedStage,appliedFunding,appliedPage]);
 useEffect(()=>{if(!stateData)return;restoreReportScroll(reportPath);},[stateData,reportPath]);
 useEffect(()=>{
  const save=()=>rememberReportScroll(reportPath);
  window.addEventListener('scroll',save,{passive:true});
  window.addEventListener('pagehide',save);
  return()=>{save();window.removeEventListener('scroll',save);window.removeEventListener('pagehide',save);};
 },[reportPath]);
 function href(changes:Record<string,string>){const q=new URLSearchParams(query);q.set('tab','reports');for(const [k,v] of Object.entries(changes)){if(v)q.set(k,v);else q.delete(k);}return '/crm?'+q.toString();}
 const urlFrom=query.get('from')||'',urlTo=query.get('to')||'';
 useEffect(()=>{setDraftFrom(urlFrom||appliedFrom);setDraftTo(urlTo||appliedTo);},[urlFrom,urlTo,appliedFrom,appliedTo]);
 function applyPreset(id:string){
  if(id==='custom'){document.querySelector<HTMLInputElement>('input[name="from"]')?.focus();return;}
  const range=reportPresetRange(id,riyadhDayKey(new Date()));
  if(!range)return;
  setDraftFrom(range.from);
  setDraftTo(range.to);
  navigateCrm(href({from:range.from,to:range.to,page:'1'}));
 }
 function printFallback(){
  document.documentElement.classList.add('reports-printing');
  const cleanup=()=>document.documentElement.classList.remove('reports-printing');
  window.addEventListener('afterprint',cleanup,{once:true});
  window.setTimeout(()=>window.print(),30);
 }
 async function exportPdf(){
  const root=document.getElementById('reports-print-sheet');
  const from=draftFrom||appliedFrom||query.get('from')||'';
  const to=draftTo||appliedTo||query.get('to')||'';
  if(!root){printFallback();return;}
  setPdfBusy(true);
  try{
   const {downloadReportPdf}=await import('@/lib/report-pdf');
   await downloadReportPdf(root,from,to,stateData?.generatedAt);
  }catch(error){
   console.error('pdf export failed',error);
   printFallback();
  }finally{setPdfBusy(false);}
 }
 useEffect(()=>{
  if(!toast)return;
  const timer=window.setTimeout(()=>setToast(null),7000);
  return()=>window.clearTimeout(timer);
 },[toast]);
 useEffect(()=>{
  if(!mailMenu)return;
  const close=(event:globalThis.MouseEvent)=>{
   const target=event.target;
   if(target instanceof Node&&mailMenuRef.current?.contains(target))return;
   setMailMenu(false);
  };
  document.addEventListener('mousedown',close);
  return()=>document.removeEventListener('mousedown',close);
 },[mailMenu]);
 async function postWeekly(period:'week'|'month'|'filters',preview=false){
  const from=draftFrom||appliedFrom||query.get('from')||'';
  const to=draftTo||appliedTo||query.get('to')||'';
  const popup=preview?window.open('','_blank'):null;
  if(preview&&!popup){setToast({tone:'error',text:'اسمح بالنوافذ المنبثقة لعرض المعاينة'});return;}
  setMailMenu(false);
  setMailBusy(true);
  try{
   const response=await fetch('/api/reports/weekly',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({period,from,to,preview})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||'تعذر إرسال التقرير');
   if(preview&&popup){
    popup.document.open();
    popup.document.write(String(data.html||''));
    popup.document.close();
    return;
   }
   setToast({tone:'ok',text:String(data.message||'تم إرسال التقرير')});
  }catch(error){
   popup?.close();
   setToast({tone:'error',text:error instanceof Error?error.message:'تعذر إرسال التقرير'});
  }finally{setMailBusy(false);}
 }
 function toggleSort(key:SortKey){
  if(sortKey===key)setSortDir(dir=>dir==='asc'?'desc':'asc');
  else{setSortKey(key);setSortDir(key==='name'?'asc':'desc');}
 }
 function chartPayload(state:unknown){
  const point=state as {activePayload?:{payload?:Record<string,unknown>}[];activeLabel?:unknown}|null;
  return point?.activePayload?.[0]?.payload||{};
 }
 function openTrendDay(state:unknown){
  const payload=chartPayload(state) as {day?:unknown};
  const label=(state as {activeLabel?:unknown}|null)?.activeLabel;
  const day=String(payload.day||label||'');
  if(/^\d{4}-\d{2}-\d{2}$/.test(day))navigateCrm(clientListHref({from:day,to:day}));
 }
 function openStageBar(state:unknown){
  const stage=String(chartPayload(state).stage||'');
  if(stage)navigateCrm(clientListHref({stage}));
 }
 function openSourceSlice(item:unknown){
  const key=String(((item as {payload?:{key?:unknown}}|null)?.payload?.key)||'');
  if(key)navigateCrm(clientListHref({source:key}));
 }
 function openEmployeeBar(state:unknown){
  const id=String(chartPayload(state).id||'');
  if(id)navigateCrm(clientListHref({employee:id}));
 }
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
 function deepLink(column:string,value:unknown){if(value===null||value===undefined||value==='')return '';if(column==='lead_id'||(column==='id'&&['leads','followups'].includes(selectedModule)))return leadReturnHref(String(value),reportPath);if(column==='property_id'||(column==='id'&&selectedModule==='properties'&&!['other'].includes(String(value))))return '/properties/'+encodeURIComponent(String(value));return '';}
 function openReportLead(event:MouseEvent<HTMLAnchorElement>){if(event.currentTarget.href.includes('returnTo='))rememberReportScroll(reportPath);}
 function clientListHref(extra:Record<string,string>){
  const q=new URLSearchParams();q.set('tab','leads');
  const from=query.get('from')||stateData?.filters.from||'';const to=query.get('to')||stateData?.filters.to||'';
  if(from)q.set('from',from);if(to)q.set('to',to);
  const source=query.get('source')||stateData?.filters.source||'';if(source){q.set('source',source);q.set('sourceExact','1');}else if(extra.source)q.set('source',extra.source);
  const stage=query.get('stage')||stateData?.filters.stage||'';
  const fieldPeriod=isEverFieldDispatchFilter(stage);
  if(fieldPeriod)q.set('dispatched','1');
  else if(stage&&!extra.stage&&!extra.stageGroup)q.set('stage',stage);
  const employee=extra.employee||query.get('reportEmployee')||stateData?.filters.employee||'';
  if(employee){
   q.set('employee',employee);
   const person=stateData?.employees.find(item=>item.id===employee)||stateData?.dashboard?.employees.find(item=>item.id===employee);
   const name=extra.employeeName||person?.name||'';const username=extra.employeeUser||person?.username||'';
   if(name)q.set('employeeName',name);if(username)q.set('employeeUser',username);
  }
  for(const [key,value] of Object.entries(extra)){if(!value||key==='employee'||key==='employeeName'||key==='employeeUser'||(key==='source'&&source))continue;q.set(key,value);}
  if(fieldPeriod&&extra.stage)q.set('stageNow','1');
  else if(!fieldPeriod&&q.get('stage'))q.set('stageNow','1');
  q.set('returnTo',reportPath);
  return '/crm?'+q.toString();
 }
 function assignmentListHref(stage?:string){
  const assignment=stateData?.assignment;
  if(!assignment||assignment.status!=='ok')return '/crm?tab=leads';
  if(assignment.dispatched)return dispatchListHref(stage?{stage}:{});
  const q=new URLSearchParams();
  q.set('tab','leads');
  q.set('employee',assignment.employeeId);
  if(assignment.employeeName)q.set('employeeName',assignment.employeeName);
  if(assignment.employeeUser)q.set('employeeUser',assignment.employeeUser);
  q.set('assignFrom',assignment.from);
  q.set('assignTo',assignment.to);
  q.set('assignRole',assignment.role);
  const source=query.get('source')||stateData?.filters.source||'';
  if(source){q.set('source',source);q.set('sourceExact','1');}
  const stageValue=stage||query.get('stage')||stateData?.filters.stage||'';
  if(stageValue){q.set('stage',stageValue);q.set('stageNow','1');}
  q.set('returnTo',reportPath);
  return '/crm?'+q.toString();
 }
 function dispatchListHref(extra:{stage?:string;fieldId?:string;fieldName?:string;fieldUser?:string;fieldUnassigned?:boolean}){
  const assignment=stateData?.assignment;
  if(!assignment)return '/crm?tab=leads';
  const q=new URLSearchParams();
  q.set('tab','leads');
  q.set('dispatched','1');
  q.set('from',assignment.from);
  q.set('to',assignment.to);
  if(assignment.employeeId){
   q.set('employee',assignment.employeeId);
   if(assignment.employeeName)q.set('employeeName',assignment.employeeName);
   if(assignment.employeeUser)q.set('employeeUser',assignment.employeeUser);
  }
  const source=query.get('source')||stateData?.filters.source||'';
  if(source){q.set('source',source);q.set('sourceExact','1');}
  if(extra.stage){q.set('stage',extra.stage);q.set('stageNow','1');}
  if(extra.fieldUnassigned)q.set('fieldUnassigned','1');
  else if(extra.fieldId||extra.fieldName){
   if(extra.fieldId)q.set('fieldEmployee',extra.fieldId);
   if(extra.fieldName)q.set('fieldEmployeeName',extra.fieldName);
   if(extra.fieldUser)q.set('fieldEmployeeUser',extra.fieldUser);
  }
  q.set('returnTo',reportPath);
  return '/crm?'+q.toString();
 }
 function openAssignmentList(){rememberReportScroll(reportPath);}
 function withReportReturn(href:string){
  if(!href||href.includes('returnTo='))return href;
  const url=new URL(href, 'https://crm.local');
  url.searchParams.set('returnTo', reportPath);
  return url.pathname+url.search;
 }

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
 const propsOk=snap?.properties.status==='ok'?snap.properties:null;
 const neighborhoodBars=propsOk?.byNeighborhood.slice(0,8).map(n=>({label:n.label,count:n.count}))||[];
 const salesGroups=report?.groups?.sales||[];
 const dash=stateData?.dashboard;
 const employeesCount=dash?dash.employees.length:null;
 const scheduledFollowups=dash?dash.scheduled:null;
 const completedDeals=dash?dash.signed:null;
 const clientsCount=dash?dash.total:null;

 const moduleBars=(stateData?.summaries||[])
  .filter(s=>s.status==='ok'&&s.total!==null)
  .map(s=>({name:s.label,value:s.total as number}));

 const stageLegend=(dash?.byStage||[]).filter(stage=>stage.count>0).map((stage,index)=>({...stage,color:CHART_COLORS[index%CHART_COLORS.length]}));
 const stageBars=(dash?.byStage||[]).map((stage,index)=>({...stage,color:CHART_COLORS[index%CHART_COLORS.length]}));
 const sortedEmployees=[...(dash?.employees||[])].sort((a,b)=>{
  const az=a.assigned===0?1:0,bz=b.assigned===0?1:0;
  if(az!==bz)return az-bz;
  const av=sortValue(a,sortKey),bv=sortValue(b,sortKey);
  const cmp=typeof av==='string'||typeof bv==='string'?String(av).localeCompare(String(bv),'ar'):Number(av)-Number(bv);
  return sortDir==='asc'?cmp:-cmp;
 });
 const perfRows=sortedEmployees.map((employee,index)=>({...employee,rank:index+1}));
 const preset=activeReportPreset(draftFrom||urlFrom||appliedFrom,draftTo||urlTo||appliedTo,riyadhDayKey(new Date()));
 const staffChoices=(stateData?.employees||[]).filter(employee=>!employee.role||employee.role==='sales'||employee.role==='field'||employee.id===(query.get('reportEmployee')||appliedEmployee));
 const focus=appliedEmployee?perfRows.find(row=>row.id===appliedEmployee)||(perfRows.length===1?perfRows[0]:undefined):undefined;
 const leadTrend=(dash?.trend.points||[]).map(point=>({...point,label:point.day.slice(5)}));
 const alerts=(()=>{
  const rows:{tone:'info'|'warn'|'muted';tag:string;message:string;time:string;href:string}[]=[];
  const gen=stateData?.generatedAt?new Date(stateData.generatedAt):new Date();
  const timeLabel=gen.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Riyadh'});
  if(dash)for(const alert of dash.alerts)rows.push({tone:alert.tone,tag:alert.tag,message:alert.message,time:timeLabel,href:alert.href?withReportReturn(alert.href):''});
  else if(stateData?.dashboardError)rows.push({tone:'warn',tag:'تنبيه',message:stateData.dashboardError,time:timeLabel,href:''});
  if(snap?.clients.status==='unavailable')rows.push({tone:'warn',tag:'تنبيه',message:`لقطة العملاء غير متاحة: ${snap.clients.error}`,time:timeLabel,href:''});
  if(snap?.properties.status==='unavailable')rows.push({tone:'warn',tag:'تنبيه',message:`لقطة العقارات غير متاحة: ${snap.properties.error}`,time:timeLabel,href:''});
  return rows.slice(0,12);
 })();

 const isOverview=selectedModule==='overview';
 const printFrom=draftFrom||appliedFrom||urlFrom;
 const printTo=draftTo||appliedTo||urlTo;
 const filterLine=`الموظف: ${focus?.name||'الكل'} · المرحلة: ${appliedStage||'الكل'} · المصدر: ${appliedSource||'الكل'} · التمويل: ${appliedFunding||'الكل'}`;
 const activeEmployees=perfRows.filter(row=>row.assigned>0);
 const employeeChunks=chunkRows(activeEmployees,8);
 const stagePrint=stageBars.filter(stage=>stage.count>0);
 const stageTotalCount=stagePrint.reduce((sum,row)=>sum+row.count,0);
 const stageChunks=chunkRows(stagePrint,14);
 const printSheet=<div id="reports-print-sheet" className="reports-print-sheet" dir="rtl" aria-hidden="true">
  <header className="pdf-block reports-print-head">
   <img src="/brand/logo.png" alt="" width={64} height={64}/>
   <div>
    <h1><span className="pdf-text">تقرير الأداء - ساس الثراء</span></h1>
    <p><span className="pdf-text">الفترة: {printFrom||'…'} — {printTo||'…'}</span></p>
    <p><span className="pdf-text">{filterLine}</span></p>
   </div>
  </header>
  {isOverview&&dash?(
   <>
    <PrintKpis items={[
     {label:'العملاء',value:fmt(dash.total)},
     {label:'مهتم',value:fmt(dash.interested)},
     {label:'غير مهتم',value:fmt(dash.notInterested)},
     {label:'متابعات',value:fmt(dash.scheduled)},
     {label:'صفقات',value:fmt(dash.signed)},
     {label:'الموظفون',value:fmt(employeesCount)},
     {label:'العقارات',value:fmt(propsOk?.total)},
    ]}/>
    <section className="pdf-block">
     <table className="pdf-split"><tbody><tr>
      <td><PrintBars title="المراحل" items={stageBars.map(stage=>({label:stage.label,count:stage.count}))}/></td>
      <td><PrintBars title="المصادر" items={(dash.sources||[]).map(source=>({label:source.label,count:source.total}))}/></td>
     </tr></tbody></table>
    </section>
    <section className="pdf-block">
     <table className="pdf-split"><tbody><tr>
      <td><PrintBars title="الموظفون" items={activeEmployees.slice(0,8).map(row=>({label:row.name,count:row.assigned}))}/></td>
      <td><PrintBars title="العملاء" items={leadTrend.map(point=>({label:point.label,count:point.count}))}/></td>
     </tr></tbody></table>
    </section>
    {employeeChunks.map((rows,index)=>{
     const part=employeeChunks.length>1?` ${index+1}`:'';
     const lead=STAGE_COLUMNS.slice(0,10);
     const rest=STAGE_COLUMNS.slice(10);
     return <Fragment key={`emp-${index}`}>
      <PrintMatrix title={`الموظفون${part}`} rows={rows} totalRows={activeEmployees} columns={lead} withTotal={false}/>
      <PrintMatrix title={`الموظفون${part} — تتمة المراحل`} rows={rows} totalRows={activeEmployees} columns={rest} withTotal/>
     </Fragment>;
    })}
    <section className="pdf-block">
     <h2><span className="pdf-text">نشاط الموظفين</span></h2>
     <table className="reports-print-table">
      <thead><tr><th><span className="pdf-text">الموظف</span></th><th><span className="pdf-text">زيارات</span></th><th><span className="pdf-text">تقارير</span></th><th><span className="pdf-text">متأخرة</span></th><th><span className="pdf-text">صفقات</span></th><th><span className="pdf-text">معاملات</span></th><th><span className="pdf-text">متابعات</span></th><th><span className="pdf-text">الإنجاز</span></th></tr></thead>
      <tbody>{activeEmployees.length?activeEmployees.map(row=><tr key={row.id}><th><span className="pdf-text">{row.name}</span></th><td><span className="pdf-text">{fmt(row.visitsDone)}</span></td><td><span className="pdf-text">{fmtMaybe(row.reportsSubmitted,Boolean(dash.reportsKnown))}</span></td><td><span className="pdf-text">{fmtMaybe(row.reportsOverdue,Boolean(dash.reportsKnown))}</span></td><td><span className="pdf-text">{fmt(row.deals)}</span></td><td><span className="pdf-text">{fmtMaybe(row.transactions,Boolean(dash.transactionsKnown))}</span></td><td><span className="pdf-text">{fmt(row.overdue)}</span></td><td><span className="pdf-text">{row.completion==null?'—':`${row.completion}%`}</span></td></tr>):<tr><td colSpan={8}><span className="pdf-text">—</span></td></tr>}</tbody>
     </table>
    </section>
    {stageChunks.map((rows,index)=>(
     <section className="pdf-block" key={`stage-${index}`}>
      <h2><span className="pdf-text">المراحل{stageChunks.length>1?` ${index+1}`:''}</span></h2>
      <table className="reports-print-table">
       <thead><tr><th><span className="pdf-text">المرحلة</span></th><th><span className="pdf-text">العدد</span></th><th><span className="pdf-text">النسبة</span></th></tr></thead>
       <tbody>{rows.length?rows.map(row=><tr key={row.stage}><th><span className="pdf-text">{row.label}</span></th><td><span className="pdf-text">{fmt(row.count)}</span></td><td><span className="pdf-text">{row.pct}%</span></td></tr>):<tr><td colSpan={3}><span className="pdf-text">—</span></td></tr>}</tbody>
       {index===stageChunks.length-1&&rows.length?<tfoot><tr><th><span className="pdf-text">الإجمالي</span></th><td><span className="pdf-text">{fmt(stageTotalCount)}</span></td><td><span className="pdf-text">{stageTotalCount?'100%':'—'}</span></td></tr></tfoot>:null}
      </table>
     </section>
    ))}
   </>
  ):report?(
   <>
    <PrintKpis items={[{label:'السجلات',value:fmt(report.total)},...report.metrics.slice(0,7).map(metric=>({label:metric.label,value:String(metric.value??'—')}))]}/>
    {(report.groups.stage?.length||report.groups.source?.length)?(
     <section className="pdf-block">
      <table className="pdf-split"><tbody><tr>
       <td>{report.groups.stage?.length?<PrintBars title="المراحل" items={report.groups.stage.map(group=>({label:group.label,count:group.count}))}/>:null}</td>
       <td>{report.groups.source?.length?<PrintBars title="المصادر" items={report.groups.source.map(group=>({label:group.label,count:group.count}))}/>:null}</td>
      </tr></tbody></table>
     </section>
    ):null}
   </>
  ):null}
 </div>;

 return <section className="reports-center reports-dash" aria-label="مركز التقارير">
  {toast?<div className="reports-toast" data-tone={toast.tone} role={toast.tone==='error'?'alert':'status'}>{toast.text}</div>:null}
  {printSheet}
  <div className="reports-screen">
  <div className="report-heading reports-dash-head">
   <div className="reports-dash-title">
    <h2><BarChart3 size={26} aria-hidden="true"/> التقارير</h2>
   </div>
   <div className="report-heading-actions">
    {role==='admin'?(
     <div className="reports-mail-menu" ref={mailMenuRef}>
      <button type="button" className="report-secondary-btn" disabled={mailBusy} aria-expanded={mailMenu} onClick={()=>setMailMenu(open=>!open)}>
       {mailBusy?'جارٍ الإرسال…':'إرسال التقرير بالإيميل'}
      </button>
      {mailMenu?(
       <div className="reports-mail-pop" role="menu">
        <button type="button" role="menuitem" onClick={()=>void postWeekly('week')}>آخر أسبوع</button>
        <button type="button" role="menuitem" onClick={()=>void postWeekly('month')}>آخر شهر</button>
        <button type="button" role="menuitem" onClick={()=>void postWeekly('filters')}>الفترة المحددة في الفلاتر</button>
       </div>
      ):null}
     </div>
    ):null}
    {role==='admin'?(
     <button type="button" className="report-secondary-btn" disabled={mailBusy} onClick={()=>void postWeekly(draftFrom&&draftTo?'filters':'week',true)}>معاينة البريد</button>
    ):null}
    <button type="button" className="report-secondary-btn" disabled={!stateData||pdfBusy} onClick={()=>void exportPdf()}>
     <Download size={16}/> {pdfBusy?'جارٍ إنشاء PDF…':'تصدير PDF'}
    </button>
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
   <div className="reports-presets" role="group" aria-label="فترات سريعة">
    {([['today','اليوم'],['week','هذا الأسبوع'],['month','هذا الشهر'],['30','آخر 30 يوماً'],['custom','مخصص']] as const).map(([id,label])=>(
     <button key={id} type="button" className="reports-preset" data-preset={id} data-active={preset===id||undefined} onClick={()=>applyPreset(id)}>{label}</button>
    ))}
   </div>
   <div className="report-filter-grid reports-filters-row">
    <label className="reports-filter-period">الفترة
     <div className="reports-date-range">
      <input type="date" name="from" aria-label="من تاريخ" value={draftFrom} onChange={event=>setDraftFrom(event.target.value)}/>
      <span aria-hidden="true">←</span>
      <input type="date" name="to" aria-label="إلى تاريخ" value={draftTo} onChange={event=>setDraftTo(event.target.value)}/>
     </div>
    </label>
    <label>مرحلة العميل<select name="stage" defaultValue={stageFilterValue(query.get('stage')||'')}><option value="">كل المراحل</option>{stageChoices().map(([key,label])=><option key={key} value={label}>{label}</option>)}{stageFilterExtra(query.get('stage')||'')}</select></label>
    <label>مصدر العميل<input name="source" list="report-sources" placeholder="كل المصادر" defaultValue={query.get('source')||''}/></label>
    <label>الموظف<select name="reportEmployee" defaultValue={query.get('reportEmployee')||''}><option value="">{role==='admin'?'كل المبيعات والميدان':'نطاقي فقط'}</option>{staffChoices.map(e=><option key={e.id} value={e.id}>{employeeOptionLabel(e)}</option>)}</select></label>
    <label>الوحدة التقريرية<select name="module" defaultValue={selectedModule}><option value="overview">نظرة عامة — كل المسموح</option>{modules.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <label>جهة التمويل<input name="funding" placeholder="كل الجهات" defaultValue={query.get('funding')||''}/></label>
    {!isOverview?(
     <label>حجم الصفحة<select name="pageSize" defaultValue={query.get('pageSize')||'25'}>{[25,50,100].map(n=><option key={n}>{n}</option>)}</select></label>
    ):<input type="hidden" name="pageSize" value={query.get('pageSize')||'25'}/>}
    <div className="report-filter-actions reports-filter-submit">
     <button className="primary report-primary-btn" type="submit">تطبيق</button>
     <CrmLink className="report-secondary-btn" href="/crm?tab=reports">إعادة ضبط</CrmLink>
    </div>
   </div>
   <datalist id="report-sources">{(dash?.sources||[]).map(source=><option key={source.key} value={source.label}/>)}</datalist>
  </form>

  {loading&&<p role="status">جارٍ تحميل التقارير…</p>}
  {error&&<div role="alert" className="error">{error} <button onClick={()=>setRetry(n=>n+1)}>إعادة المحاولة</button></div>}
  {exportError&&<p role="alert" className="error">{exportError}</p>}

  {stateData&&isOverview&&(
   <div className="reports-overview" aria-label="لوحة نظرة عامة">
    {stateData.assignment&&stateData.assignment.status!=='idle'&&stateData.assignment.status!=='unsupported'?(
     <section className="panel reports-assignment" aria-label="العملاء المسندون خلال الفترة">
      <div className="reports-perf-head">
       <div>
        <h3>{stateData.assignment.dispatched?'تفويج للميدان':'المسندون'}</h3>
       </div>
      </div>
      {stateData.assignment.status==='unavailable'?<p role="alert" className="error">{stateData.assignment.error||'تعذرت قراءة الإسناد'}</p>:null}
      {stateData.assignment.status==='ok'&&stateData.assignment.dispatched?(
       <>
        <p className="reports-dispatch-total">
         <NumLink href={dispatchListHref({})} onNavigate={openAssignmentList}><strong className="reports-kpi-value">{fmt(stateData.assignment.total)}</strong></NumLink>
         <span>عميل فُوِّج للميدان خلال الفترة</span>
        </p>
        <div className="report-table-scroll" tabIndex={0} aria-label="مراحل العملاء المفوجين">
         <table className="reports-perf-table">
          <thead><tr><th>المرحلة الحالية</th><th>العدد</th></tr></thead>
          <tbody>
           {stateData.assignment.byStage.length===0?(
            <tr><td colSpan={2}>لا عملاء مفوجون في هذه الفترة.</td></tr>
           ):stateData.assignment.byStage.map(row=>(
            <tr key={row.stage}>
             <th scope="row">{row.label}</th>
             <td><NumLink href={dispatchListHref({stage:row.stage})} onNavigate={openAssignmentList}>{fmt(row.count)}</NumLink></td>
            </tr>
           ))}
          </tbody>
         </table>
        </div>
        <div className="report-table-scroll" tabIndex={0} aria-label="موظفو الميدان للعملاء المفوجين">
         <table className="reports-perf-table">
          <thead><tr><th>موظف الميدان</th><th>العدد</th></tr></thead>
          <tbody>
           {(stateData.assignment.byField||[]).length===0?(
            <tr><td colSpan={2}>لا يوجد توزيع على موظفي الميدان.</td></tr>
           ):stateData.assignment.byField.map(row=>(
            <tr key={row.id||row.name}>
             <th scope="row">{row.name}</th>
             <td><NumLink href={dispatchListHref(row.id?{fieldId:row.id,fieldName:row.name,fieldUser:row.username}:{fieldUnassigned:true})} onNavigate={openAssignmentList}>{fmt(row.count)}</NumLink></td>
            </tr>
           ))}
          </tbody>
         </table>
        </div>
       </>
      ):stateData.assignment.status==='ok'?(
       <>
        <p>المسندون: <NumLink href={assignmentListHref()} onNavigate={openAssignmentList}>{fmt(stateData.assignment.total)}</NumLink></p>
        <div className="report-table-scroll" tabIndex={0} aria-label="مراحل العملاء المسندين">
         <table className="reports-perf-table">
          <thead><tr><th>المرحلة الحالية</th><th>العدد</th></tr></thead>
          <tbody>
           {stateData.assignment.byStage.map(row=>(
            <tr key={row.stage}>
             <th scope="row">{row.label}</th>
             <td><NumLink href={assignmentListHref(row.stage)} onNavigate={openAssignmentList}>{fmt(row.count)}</NumLink></td>
            </tr>
           ))}
          </tbody>
         </table>
        </div>
       </>
      ):null}
     </section>
    ):null}
    {focus?(
     <section className="panel reports-focus" aria-label="ملخص أداء الموظف">
      <div className="reports-perf-head">
       <div>
        <h3>{focus.name}</h3>
       </div>
      </div>
      <div className="reports-focus-grid">
       <KpiCard value={fmt(focus.assigned)} label="مسندون" icon={<ClipboardList size={18}/>} href={clientListHref({employee:focus.id})}/>
       <KpiCard value={fmt(focus.contacted)} label="تم التواصل" icon={<Users size={18}/>} href={clientListHref({employee:focus.id,stageGroup:'contacted'})} chip={pctOf(focus.contacted,focus.assigned)}/>
       <KpiCard value={fmt(focus.interested)} label="مهتم" icon={<TrendingUp size={18}/>} href={clientListHref({employee:focus.id,stageGroup:'interested'})} chip={pctOf(focus.interested,focus.assigned)}/>
       <KpiCard value={fmt(focus.dispatched)} label="تفويج للميدان" icon={<Layers size={18}/>} chip={pctOf(focus.dispatched,focus.assigned)}/>
       <KpiCard value={fmt(focus.visitsDone)} label="زيارات مكتملة" icon={<CheckCircle2 size={18}/>}/>
       <KpiCard value={fmtMaybe(focus.reportsSubmitted,Boolean(dash?.reportsKnown))} label="تقارير مقدمة" icon={<FileText size={18}/>}/>
       <KpiCard value={fmtMaybe(focus.reportsOverdue,Boolean(dash?.reportsKnown))} label="تقارير متأخرة" icon={<AlertCircle size={18}/>}/>
       <KpiCard value={fmt(focus.deals)} label="صفقات" icon={<Building2 size={18}/>} href={clientListHref({employee:focus.id,stageGroup:'signed'})} chip={`تحويل ${pctOf(focus.deals,focus.assigned)}`}/>
       <KpiCard value={fmtMaybe(focus.transactions,Boolean(dash?.transactionsKnown))} label="معاملات مالية" icon={<BarChart3 size={18}/>}/>
       <KpiCard value={fmtHours(focus.avgHoursToFirstContact,Boolean(dash?.firstContactKnown))} label="أول تواصل" icon={<Calendar size={18}/>}/>
      </div>
     </section>
    ):null}
    <div className="reports-kpis" aria-label="مؤشرات رئيسية">
     <KpiCard value={fmt(employeesCount)} label="الموظفون" icon={<Users size={18}/>}/>
     <KpiCard value={fmt(scheduledFollowups)} label="متابعات" icon={<Calendar size={18}/>} href={dash?clientListHref({scheduled:'1'}):undefined}/>
     <KpiCard value={fmt(completedDeals)} label="صفقات" icon={<CheckCircle2 size={18}/>} href={dash?clientListHref({stageGroup:'signed'}):undefined}/>
     <KpiCard value={fmt(clientsCount)} label="عدد العملاء" icon={<ClipboardList size={18}/>} href={dash?clientListHref({}):undefined}/>
     <KpiCard value={fmt(propsOk?.total)} label="عقارات الكتالوج" icon={<Building2 size={18}/>}/>
    </div>

    <div className="reports-charts" aria-label="رسوم بيانية">
     <div className="reports-chart-card panel report-chart">
      <h4><TrendingUp size={16} aria-hidden="true"/> العملاء عبر الزمن</h4>
      {leadTrend.length?(
       <ResponsiveContainer width="100%" height={260}>
        <LineChart data={leadTrend} onClick={openTrendDay}>
         <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
         <XAxis dataKey="day" tick={{fontSize:10}} minTickGap={18}/>
         <YAxis allowDecimals={false}/>
         <Tooltip formatter={(value)=>[fmt(Number(value)||0),'العملاء']}/>
         <Line type="monotone" dataKey="count" name="العملاء" stroke="#3F1A44" strokeWidth={2} dot={{r:3,fill:'#3F1A44'}} activeDot={{r:5}}/>
        </LineChart>
       </ResponsiveContainer>
      ):<div className="reports-chart-empty" role="status"><p>{stateData?.dashboardError||'لا تتوفر سلسلة زمنية ضمن الفلاتر.'}</p></div>}
     </div>
     <div className="reports-chart-card panel report-chart">
      <h4><BarChart3 size={16} aria-hidden="true"/> مسار المراحل</h4>
      {stageBars.some(stage=>stage.count>0)?(
       <ResponsiveContainer width="100%" height={280}>
        <BarChart data={stageBars} layout="vertical" onClick={openStageBar}>
         <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
         <XAxis type="number" allowDecimals={false}/>
         <YAxis type="category" dataKey="label" width={148} tick={{fontSize:11}} interval={0}/>
         <Tooltip formatter={(value)=>[fmt(Number(value)||0),'العملاء']}/>
         <Bar dataKey="count" name="العملاء" radius={[0,6,6,0]} style={{cursor:'pointer'}}>
          {stageBars.map(stage=><Cell key={stage.stage} fill={stage.color}/>)}
         </Bar>
        </BarChart>
       </ResponsiveContainer>
      ):<div className="reports-chart-empty" role="status"><p>{stateData?.dashboardError||'لا تتوفر بيانات مراحل حالياً.'}</p></div>}
     </div>
     <div className="reports-chart-card panel report-chart">
      <h4><PieIcon size={16} aria-hidden="true"/> مصادر العملاء</h4>
      {(dash?.sources.length||0)>0?(
       <ResponsiveContainer width="100%" height={260}>
        <PieChart>
         <Pie data={dash?.sources||[]} dataKey="total" nameKey="label" innerRadius={52} outerRadius={84} paddingAngle={2} onClick={openSourceSlice}>
          {(dash?.sources||[]).map((source,index)=><Cell key={source.key} fill={CHART_COLORS[index%CHART_COLORS.length]} style={{cursor:'pointer'}}/>)}
         </Pie>
         <Tooltip formatter={(value)=>[fmt(Number(value)||0),'العملاء']}/>
         <Legend/>
        </PieChart>
       </ResponsiveContainer>
      ):<div className="reports-chart-empty" role="status"><p>لا تتوفر مصادر ضمن الفلاتر.</p></div>}
     </div>
     <div className="reports-chart-card panel report-chart">
      <h4><Users size={16} aria-hidden="true"/> مقارنة الموظفين</h4>
      {perfRows.some(row=>row.assigned>0)?(
       <ResponsiveContainer width="100%" height={280}>
        <BarChart data={perfRows.filter(row=>row.assigned>0)} onClick={openEmployeeBar}>
         <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
         <XAxis dataKey="name" tick={{fontSize:11}} interval={0} angle={-25} textAnchor="end" height={88}/>
         <YAxis allowDecimals={false}/>
         <Tooltip formatter={(value)=>[fmt(Number(value)||0),'العملاء']}/>
         <Bar dataKey="assigned" name="العملاء" radius={[6,6,0,0]} style={{cursor:'pointer'}}>
          {perfRows.filter(row=>row.assigned>0).map((row,index)=><Cell key={row.id} fill={CHART_COLORS[index%CHART_COLORS.length]}/>)}
         </Bar>
        </BarChart>
       </ResponsiveContainer>
      ):<div className="reports-chart-empty" role="status"><p>{stateData?.dashboardError||'لا توجد مقارنة موظفين ضمن الفلاتر.'}</p></div>}
     </div>
     <div className="reports-chart-card panel report-chart reports-stage-card">
      <h4><PieIcon size={16} aria-hidden="true"/> توزيع مراحل العملاء</h4>
      {stageLegend.some(stage=>stage.count>0)?(
       <div className="reports-stage-layout">
        <div className="reports-stage-pie">
         <ResponsiveContainer width="100%" height={260}>
          <PieChart>
           <Pie data={stageLegend.filter(stage=>stage.count>0)} dataKey="count" nameKey="label" innerRadius={52} outerRadius={84} paddingAngle={2} onClick={item=>{const stage=String((item?.payload as {stage?:string}|undefined)?.stage||'');if(stage)navigateCrm(clientListHref({stage}));}}>
            {stageLegend.filter(stage=>stage.count>0).map(stage=><Cell key={stage.stage} fill={stage.color} style={{cursor:'pointer'}}/>)}
           </Pie>
           <Tooltip formatter={(value, _name, item)=>{const count=Number(value)||0;const pct=(item?.payload as {pct?:number}|undefined)?.pct??0;return [`${fmt(count)} (${pct}%)`,'العملاء'];}}/>
          </PieChart>
         </ResponsiveContainer>
        </div>
        <StageLegend items={stageLegend} hrefFor={stage=>clientListHref({stage})}/>
       </div>
      ):<div className="reports-chart-empty" role="status"><p>{stateData?.dashboardError||'لا تتوفر بيانات مراحل حالياً.'}</p></div>}
     </div>

     {neighborhoodBars.length>0?(
      <HorizontalBars title="الأحياء" items={neighborhoodBars}/>
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

    {dash&&(
     <div className="reports-sources panel" aria-label="أداء المصادر">
      <div className="reports-perf-head">
       <div>
        <h3>المصادر</h3>
       </div>
      </div>
      <div className="report-table-scroll" tabIndex={0} aria-label="جدول المصادر">
       <table className="reports-perf-table">
        <thead>
         <tr>
          <th>المصدر</th>
          <th>العملاء</th>
          <th>مهتم</th>
          <th>غير مهتم</th>
          <th>وقع / إفراغ</th>
          <th>مغلق</th>
          <th>جدد</th>
          <th>التحويل</th>
         </tr>
        </thead>
        <tbody>
         {dash.sources.length===0?(
          <tr><td colSpan={8}>لا توجد مصادر ضمن الفلاتر.</td></tr>
         ):dash.sources.map(source=>(
          <tr key={source.key}>
           <th scope="row">{source.label}</th>
           <td><NumLink href={clientListHref({source:source.key})}>{fmt(source.total)}</NumLink></td>
           <td><NumLink href={clientListHref({source:source.key,stageGroup:'interested'})}>{fmt(source.interested)}</NumLink></td>
           <td><NumLink href={clientListHref({source:source.key,stageGroup:'not_interested'})}>{fmt(source.notInterested)}</NumLink></td>
           <td><NumLink href={clientListHref({source:source.key,stageGroup:'signed'})}>{fmt(source.signed)}</NumLink></td>
           <td><NumLink href={clientListHref({source:source.key,stageGroup:'closed'})}>{fmt(source.closed)}</NumLink></td>
           <td><NumLink href={clientListHref({source:source.key,stageGroup:'unassigned_new'})}>{fmt(source.unassignedNew)}</NumLink></td>
           <td><NumLink href={clientListHref({source:source.key,stageGroup:'signed'})}>{source.conversion==null?'—':`${source.conversion}%`}</NumLink></td>
          </tr>
         ))}
        </tbody>
       </table>
      </div>
     </div>
    )}

    <div className="reports-perf panel" aria-label="أداء الموظفين">
     <div className="reports-perf-head">
      <div>
       <h3>الموظفون</h3>
      </div>
      <CrmLink className="report-secondary-btn reports-perf-all" href="/crm?tab=users">عرض جميع الموظفين</CrmLink>
     </div>
     <div className="report-table-scroll" tabIndex={0} aria-label="جدول أداء الموظفين">
      <table className="reports-perf-table reports-stage-matrix">
       <thead>
        <tr>
         <SortHead label="الموظف" column="name" active={sortKey} dir={sortDir} onSort={toggleSort}/>
         {STAGE_COLUMNS.map(column=><SortHead key={column.stage} label={column.short} title={column.label} column={`stage:${column.stage}`} active={sortKey} dir={sortDir} onSort={toggleSort}/>)}
         <SortHead label="الإجمالي" column="assigned" active={sortKey} dir={sortDir} onSort={toggleSort}/>
         <th>النسبة</th>
        </tr>
       </thead>
       <tbody>
        {perfRows.length===0?(
         <tr><td colSpan={STAGE_COLUMNS.length+3}>{stateData?.dashboardError||'لا يوجد موظفون في النطاق.'}</td></tr>
        ):perfRows.map(row=>{
         const footer=sumStageTable(perfRows.map(item=>({total:item.assigned,stages:item.stages||{}})));
         return (
         <tr key={row.id}>
          <th scope="row">
           <span className="reports-perf-name">
            <span className="reports-perf-avatar" aria-hidden="true"><Users size={14}/></span>
            {row.name}
           </span>
          </th>
          {STAGE_COLUMNS.map(column=>{
           const count=row.stages?.[column.stage]||0;
           const href=column.stage==='other'?'':clientListHref({employee:row.id,stage:stageLabel(column.stage)});
           return <td key={column.stage} className="num">{href?<NumLink href={href}>{fmt(count)}</NumLink>:fmt(count)}</td>;
          })}
          <td className="num"><NumLink href={clientListHref({employee:row.id})}>{fmt(row.assigned)}</NumLink></td>
          <td className="num">{pctOf(row.assigned,footer.total)}</td>
         </tr>
         );
        })}
       </tbody>
       {perfRows.length?(
        <tfoot>
         <tr>
          <th scope="row">الإجمالي</th>
          {STAGE_COLUMNS.map(column=><td key={column.stage} className="num">{fmt(perfRows.reduce((sum,row)=>sum+(row.stages?.[column.stage]||0),0))}</td>)}
          <td className="num">{fmt(perfRows.reduce((sum,row)=>sum+row.assigned,0))}</td>
          <td className="num">{perfRows.some(row=>row.assigned)?'100%':'—'}</td>
         </tr>
        </tfoot>
       ):null}
      </table>
     </div>
     <div className="reports-perf-head">
      <div>
       <h3>نشاط الموظفين</h3>
      </div>
     </div>
     <div className="report-table-scroll" tabIndex={0} aria-label="نشاط الموظفين">
      <table className="reports-perf-table">
       <thead>
        <tr>
         <SortHead label="الموظف" column="name" active={sortKey} dir={sortDir} onSort={toggleSort}/>
         <SortHead label="زيارات" column="visitsDone" active={sortKey} dir={sortDir} onSort={toggleSort}/>
         <SortHead label="تقارير" column="reportsSubmitted" active={sortKey} dir={sortDir} onSort={toggleSort}/>
         <SortHead label="تقارير متأخرة" column="reportsOverdue" active={sortKey} dir={sortDir} onSort={toggleSort}/>
         <SortHead label="صفقات" column="deals" active={sortKey} dir={sortDir} onSort={toggleSort}/>
         <SortHead label="معاملات" column="transactions" active={sortKey} dir={sortDir} onSort={toggleSort}/>
         <SortHead label="متابعات متأخرة" column="overdue" active={sortKey} dir={sortDir} onSort={toggleSort}/>
         <SortHead label="نسبة الإنجاز" column="completion" active={sortKey} dir={sortDir} onSort={toggleSort}/>
        </tr>
       </thead>
       <tbody>
        {perfRows.length===0?(
         <tr><td colSpan={8}>{stateData?.dashboardError||'لا يوجد موظفون في النطاق.'}</td></tr>
        ):perfRows.map(row=>(
         <tr key={row.id}>
          <th scope="row">{row.name}</th>
          <td className="num">{fmt(row.visitsDone)}</td>
          <td className="num">{fmtMaybe(row.reportsSubmitted,Boolean(dash?.reportsKnown))}</td>
          <td className="num">{fmtMaybe(row.reportsOverdue,Boolean(dash?.reportsKnown))}</td>
          <td className="num"><NumLink href={clientListHref({employee:row.id,stageGroup:'signed'})}>{fmt(row.deals)}</NumLink></td>
          <td className="num">{fmtMaybe(row.transactions,Boolean(dash?.transactionsKnown))}</td>
          <td className="num"><NumLink href={clientListHref({employee:row.id,overdue:'1'})}>{fmt(row.overdue)}</NumLink></td>
          <td className="num">{row.completion==null?'—':`${row.completion}%`}</td>
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
      {alerts.length===0?<li className="reports-alert tone-muted"><span className="reports-alert-icon" aria-hidden="true"><Info size={18}/></span><p className="reports-alert-msg">لا توجد تنبيهات ضمن الفلاتر الحالية.</p><span className="reports-alert-tag">ملاحظة</span></li>:alerts.map(a=>{
       const body=<><span className="reports-alert-icon" aria-hidden="true">{a.tone==='warn'?<AlertCircle size={18}/>:a.tone==='info'?<Info size={18}/>:<Home size={18}/>}</span><p className="reports-alert-msg">{a.message}</p><span className="reports-alert-tag">{a.tag}</span><time className="reports-alert-time">{a.time}</time></>;
       return a.href?<li key={a.href+a.message}><CrmLink className={`reports-alert tone-${a.tone}`} href={a.href}>{body}</CrmLink></li>:<li key={a.message} className={`reports-alert tone-${a.tone}`}>{body}</li>;
      })}
     </ul>
    </div>
   </div>
  )}

  {report&&<>
   <div className="report-heading"><div><h3>{report.label}</h3></div><div className="report-actions">{stateData?.canExport?<button className="report-primary-btn" disabled={exporting} onClick={()=>void download()}>{exporting?'جارٍ التصدير…':'تصدير CSV'}</button>:null}<span>السجلات: {report.total}</span></div></div>
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
       <thead><tr><th>الموظف</th><th>الإجمالي</th><th>النسبة</th></tr></thead>
       <tbody>
        {salesGroups.map(g=><tr key={g.label}><th scope="row">{g.label}</th><td className="num"><strong>{fmt(g.count)}</strong></td><td className="num">{pctOf(g.count,report.total)}</td></tr>)}
       </tbody>
       <tfoot>
        <tr className="report-team-total-row"><th scope="row">الإجمالي</th><td className="num"><strong>{fmt(report.total)}</strong></td><td className="num">{report.total?'100%':'—'}</td></tr>
       </tfoot>
      </table>
     </div>
    </div>
   )}

   {(metricsChart.length>0||groupsCharts||report.trend)&&<div className="report-charts-grid">
    {report.trend&&report.trend.points.length>1&&<div className="report-chart panel"><h4>الخط الزمني</h4><ResponsiveContainer width="100%" height={260}><AreaChart data={report.trend.points}><defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3F1A44" stopOpacity={0.55}/><stop offset="100%" stopColor="#3F1A44" stopOpacity={0.05}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="day" tick={{fontSize:10}} minTickGap={18}/><YAxis allowDecimals={false}/><Tooltip/><Area type="monotone" dataKey="count" name="السجلات" stroke="#3F1A44" strokeWidth={2} fill="url(#trendFill)"/></AreaChart></ResponsiveContainer></div>}
    {metricsChart.length>0&&<div className="report-chart panel"><h4>المؤشرات الرقمية</h4><ResponsiveContainer width="100%" height={280}><BarChart data={metricsChart} layout="vertical"><CartesianGrid strokeDasharray="3 3"/><XAxis type="number"/><YAxis dataKey="name" type="category" width={160} tick={{fontSize:12}}/><Tooltip/><Bar dataKey="value" name="القيمة" radius={[0,6,6,0]}>{metricsChart.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer></div>}
    {groupsCharts?.filter(gc=>!['stage','source','sales'].includes(gc.gkey)).map(gc=>(
      gc.data.length>1&&gc.data.length<=8?
       <div className="report-chart panel" key={gc.gkey}><h4>توزيع {gc.title}</h4><ResponsiveContainer width="100%" height={280}><PieChart><Pie data={gc.data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} label>{gc.data.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer></div>
      :
       <div className="report-chart panel" key={gc.gkey}><h4>توزيع {gc.title}</h4><ResponsiveContainer width="100%" height={280}><BarChart data={gc.data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name" tick={{fontSize:11}} angle={-35} textAnchor="end" height={70}/><YAxis allowDecimals={false}/><Tooltip/><Bar dataKey="value" name="السجلات" radius={[6,6,0,0]}>{gc.data.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer></div>
    ))}
   </div>}
   {Object.entries(report.groups).map(([gkey,groups])=>groups.length>0&&<details className="report-group" key={gkey}><summary>{groupNames[gkey]||gkey} — توزيع السجلات ({groups.length})</summary><ul>{groups.map(g=><li key={g.label}>{['source','stage'].includes(gkey)&&g.label!=='غير محدد'?<CrmLink href={href({[gkey]:g.label,page:'1'})}>{g.label}</CrmLink>:g.label} <strong>{g.count}</strong></li>)}</ul></details>)}
   {report.rows.length?<div className="report-table-scroll panel" tabIndex={0} aria-label="تفاصيل التقرير"><table className="report-detail-table"><thead><tr>{report.columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{report.rows.map((r,i)=><tr key={String(r.id||r.user_id||i)+i}>{report.columns.map(c=>{const link=deepLink(c.key,r[c.key]);const numeric=isNumericValue(r[c.key]);return <td key={c.key} className={numeric?'num':undefined} data-label={c.label}>{link?<a href={link} onClick={openReportLead}>{String(r[c.key])}</a>:<bdi>{r[c.key]??'—'}</bdi>}</td>;})}</tr>)}</tbody></table></div>:<p className="panel">{report.total?'هذه الصفحة خارج النتائج؛ انتقل إلى الصفحة الأولى.':'لا توجد سجلات مطابقة في المصدر المقروء بنجاح.'}</p>}
   <nav className="report-pagination" aria-label="صفحات التقرير">{page>1&&<CrmLink className="crm-button" href={href({page:String(page-1)})}>السابق</CrmLink>}<CrmLink className="crm-button" href={href({page:'1'})}>الصفحة الأولى</CrmLink>{page<pages&&<CrmLink className="crm-button" href={href({page:String(page+1)})}>التالي</CrmLink>}</nav>
  </>}
  </div>
 </section>;
}

