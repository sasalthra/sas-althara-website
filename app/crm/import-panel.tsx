'use client';
import {useEffect,useMemo,useState} from 'react';
import {UserPlus,Users} from 'lucide-react';
import {importFields,suggestMapping,type Assignment,type Mapping} from '@/lib/lead-import';
import {stageLabel} from '@/lib/lead-stages';
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '@/components/ui/table';

type Preview={row:number;status:string;errors:string[];warnings?:string[];raw:string[];lead:{name:string;phone:string;propertyOther:string;stage?:string;followUp?:string}|null};
type AssignableUser={id:string;username:string;name:string;role:'sales'|'field';active:number};

function stringifyCell(cell:unknown){
 if(cell==null||cell==='')return '';
 if(cell instanceof Date && !Number.isNaN(cell.getTime())){
  const y=cell.getFullYear(),m=String(cell.getMonth()+1).padStart(2,'0'),d=String(cell.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
 }
 if(typeof cell==='number' && Number.isFinite(cell))return Number.isInteger(cell)?String(cell):String(cell);
 return String(cell);
}
function asGrid(rows:unknown):string[][]{
 if(!Array.isArray(rows))return [];
 return rows.map(row=>Array.isArray(row)?row.map(stringifyCell):[stringifyCell(row)]);
}
async function readWorkbook(file:File){
 const excel=await import('read-excel-file/browser');
 const read=excel.default as (input:File,options?:{sheet?:string|number})=>Promise<unknown>;
 const readSheetNames=(excel as {readSheetNames?:(input:File)=>Promise<string[]>}).readSheetNames;
 const names=typeof readSheetNames==='function'?await readSheetNames(file):[];
 if(names.length){
  const sheets=[];
  for(const name of names){
   const rows=await read(file,{sheet:name});
   sheets.push({sheet:String(name),data:asGrid(rows)});
  }
  return sheets;
 }
 const rows=await read(file);
 if(Array.isArray(rows)&&rows[0]&&typeof rows[0]==='object'&&!Array.isArray(rows[0])&&'data' in (rows[0] as object)){
  return (rows as {sheet?:string;data:unknown}[]).map((sheet,index)=>({sheet:sheet.sheet||`ورقة ${index+1}`,data:asGrid(sheet.data)}));
 }
 return [{sheet:'Sheet1',data:asGrid(rows)}];
}

export default function ImportPanel({onSaved}:{onSaved:()=>void}){
 const [sheets,setSheets]=useState<{sheet:string;data:string[][]}[]>([]),[sheet,setSheet]=useState(0),[header,setHeader]=useState(0),[mapping,setMapping]=useState<Mapping>({}),[preview,setPreview]=useState<Preview[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
 const [assignMode,setAssignMode]=useState<Assignment['mode']>('one');
 const [selected,setSelected]=useState<string[]>([]);
 const [users,setUsers]=useState<AssignableUser[]>([]);
 const [usersError,setUsersError]=useState('');
 const raw=sheets[sheet]?.data||[],headers=raw[header]||[],rows=raw.slice(header+1);
 const sales=useMemo(()=>users.filter(user=>user.role==='sales'&&user.active===1),[users]);
 const readyCount=preview.filter(row=>row.status==='ready').length;
 const assignment:Assignment|undefined=assignMode==='unassigned'?{mode:'unassigned',userIds:[]}:assignMode==='one'?{mode:'one',userIds:selected.slice(0,1)}:{mode:'distribute',userIds:selected};
 const canCommit=confirmed&&readyCount>0&&(assignMode==='unassigned'||(assignMode==='one'&&selected.length===1)||(assignMode==='distribute'&&selected.length>=2));
 function reset(){setPreview([]);setConfirmed(false);}
 function applyHeaders(nextSheets:{sheet:string;data:string[][]}[],sheetIndex:number,headerRow:number){
  setSheets(nextSheets);setSheet(sheetIndex);setHeader(headerRow);setMapping(suggestMapping(nextSheets[sheetIndex]?.data[headerRow]||[]));reset();
 }
 async function open(file:File|undefined){
  if(!file)return;setBusy(true);reset();setSheets([]);
  try{
   if(file.size>2000000||!file.name.toLowerCase().endsWith('.xlsx'))throw Error('اختر ملف xlsx بحجم لا يتجاوز 2 ميجابايت');
   const workbook=await readWorkbook(file);
   if(!workbook.length||workbook.every(item=>!item.data.length))throw Error('الملف لا يحتوي صفوفاً قابلة للقراءة');
   if(workbook.some(item=>item.data.length>1001||item.data.some(row=>row.length>100)))throw Error('الحد 1000 صف بيانات و100 عمود لكل ورقة؛ قسّم الملف دون فقد البيانات');
   applyHeaders(workbook,0,0);
   setMessage('اختر الورقة وصف العناوين ثم راجع ربط الأعمدة. لا يتم حفظ شيء قبل التأكيد.');
  }catch(e){setMessage(e instanceof Error?e.message:'تعذر قراءة الملف');}
  finally{setBusy(false);}
 }
 async function run(mode:'preview'|'commit'){
  setBusy(true);
  try{
   if(mode==='commit'){
    if(assignMode==='one'&&selected.length!==1)throw Error('اختر مندوباً واحداً لتعيين كل العملاء حتى يظهروا في العملاء والمتابعات');
    if(assignMode==='distribute'&&selected.length<2)throw Error('للتوزيع بالتساوي اختر مندوبين أو أكثر');
   }
   const r=await fetch('/api/leads/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows,mapping,mode,confirmed,assignment:mode==='commit'?assignment:undefined})});
   const d=await r.json();
   if(!r.ok)throw Error(d.error);
   setPreview(d.rows);
   if(mode==='commit'){
    setMessage(`تم استيراد ${d.inserted} عميل إلى سجل العملاء والمتابعات. بقيت الصفوف الأصلية والمعاينة دون تغيير.`);
    setConfirmed(false);onSaved();
   }else setMessage('المعاينة جاهزة. يتم إعادة فحص التكرار على الخادم عند الحفظ.');
  }catch(e){setMessage(e instanceof Error?e.message:'تعذر الاستيراد');}
  finally{setBusy(false);}
 }
 function download(){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify({sheet:sheets[sheet]?.sheet,header,mapping,rows:preview},null,2)],{type:'application/json'}));a.href=url;a.download='import-review.json';a.click();URL.revokeObjectURL(url);}
 function toggleRep(id:string){
  setSelected(current=>{
   if(assignMode==='one')return [id];
   return current.includes(id)?current.filter(item=>item!==id):[...current,id];
  });
 }
 function pickOneMode(){
  setAssignMode('one');
  setSelected(current=>{
   const keep=current.find(id=>sales.some(user=>user.id===id));
   return keep?[keep]:sales[0]?[sales[0].id]:[];
  });
 }
 useEffect(()=>{
  let cancelled=false;
  fetch('/api/crm-users?assignable=1',{cache:'no-store'})
   .then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.error||'تعذر تحميل المندوبين');if(!cancelled){setUsers(Array.isArray(result)?result:[]);setUsersError('');}})
   .catch(error=>{if(!cancelled)setUsersError(error instanceof Error?error.message:'تعذر تحميل المندوبين');});
  return()=>{cancelled=true;};
 },[]);
 useEffect(()=>{
  if(assignMode!=='one')return;
  const valid=selected.find(id=>sales.some(user=>user.id===id));
  if(valid){
   if(selected.length!==1||selected[0]!==valid)setSelected([valid]);
   return;
  }
  if(sales[0])setSelected([sales[0].id]);
  else if(selected.length)setSelected([]);
 },[assignMode,sales,selected]);
 return <section dir="rtl" className="panel space-y-4">
  <h2>استيراد العملاء من Excel</h2>
  <p>الاسم والجوال فقط مطلوبان لاستيراد الصف. الأعمدة غير المربوطة (الطلب، المصدر، الملاحظات، المرحلة، التواريخ…) اختيارية ولا تُبطل الصف. إن كان الطلب فارغاً أو «-» يُحفظ «غير محدد». أرقام الجوال السعودية تُوحّد للمقارنة. التكرار بحسب الجوال؛ لا يستبدل أي عميل موجود. المرحلة تُطابق مراحل النظام فقط. الصفوف غير الصالحة لا تُحذف من الملف. افتراضياً يُعيَّن كل العملاء لمندوب مبيعات واحد حتى يظهروا في العملاء والمتابعات.</p>
  <input type="file" accept=".xlsx" aria-label="ملف العملاء" disabled={busy} onChange={e=>void open(e.target.files?.[0])}/>
  <p role="status">{message}</p>
  {sheets.length>0&&<>
   <label>الورقة<select value={sheet} onChange={e=>applyHeaders(sheets,Number(e.target.value),0)}>{sheets.map((item,i)=><option key={item.sheet} value={i}>{item.sheet}</option>)}</select></label>
   <label>رقم صف العناوين<input type="number" min={1} max={raw.length} value={header+1} onChange={e=>applyHeaders(sheets,sheet,Math.max(0,Number(e.target.value)-1))}/></label>
   <div className="fields">{Object.entries(importFields).map(([key,label])=><label key={key}>{label}{(key==='name'||key==='phone')?' *':''}<select value={mapping[key as keyof Mapping]??''} onChange={e=>{const next={...mapping};if(e.target.value==='')delete next[key as keyof Mapping];else next[key as keyof Mapping]=Number(e.target.value);setMapping(next);reset();}}><option value="">غير مربوط</option>{headers.map((h,i)=><option key={i} value={i}>{i+1}: {h||'بدون عنوان'}</option>)}</select></label>)}</div>
   <button disabled={busy||!rows.length} onClick={()=>void run('preview')}>معاينة وفحص التكرار</button>
   <Table><TableHeader><TableRow><TableHead>الصف</TableHead>{headers.map((h,i)=><TableHead key={i}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.slice(0,10).map((r,i)=><TableRow key={i}><TableCell>{header+i+2}</TableCell>{headers.map((_,c)=><TableCell key={c}>{r[c]}</TableCell>)}</TableRow>)}</TableBody></Table>
   <p>معاينة أول 10 صفوف من {rows.length} — كل الصفوف تُفحص على الخادم.</p>
  </>}
  <div className="import-assign">
   <h3>تعيين العملاء المستوردين</h3>
   <p className="subtle">الوضع الافتراضي: تعيين الكل لمندوب مبيعات واحد حتى يظهروا في العملاء والمتابعات تحت ذلك المندوب. التوزيع بالتساوي اختياري. بدون تعيين يظهر العميل للإدارة والإشراف فقط.</p>
   {usersError&&<p role="alert" className="error">{usersError}</p>}
   <div className="import-assign-options">
    <button type="button" className="import-assign-option" data-primary="true" data-active={assignMode==='one'} aria-pressed={assignMode==='one'} onClick={pickOneMode}>
     <UserPlus className="import-assign-icon" aria-hidden="true" size={20}/>
     <span><strong>تعيين الكل لمندوب واحد</strong><small>كل الصفوف الجاهزة تُسند لنفس مندوب المبيعات (الافتراضي)</small></span>
    </button>
    <button type="button" className="import-assign-option" data-active={assignMode==='distribute'} aria-pressed={assignMode==='distribute'} onClick={()=>setAssignMode('distribute')}>
     <Users className="import-assign-icon" aria-hidden="true" size={20}/>
     <span><strong>توزيع بالتساوي على عدة مناديب</strong><small>توزيع دوري بالترتيب على المندوبين المحددين</small></span>
    </button>
    <button type="button" className="import-assign-option" data-active={assignMode==='unassigned'} aria-pressed={assignMode==='unassigned'} onClick={()=>{setAssignMode('unassigned');setSelected([]);}}>
     <span className="import-assign-icon" aria-hidden="true">—</span>
     <span><strong>بدون تعيين</strong><small>يظهر للإدارة والإشراف فقط حتى يُعيَّن لاحقاً</small></span>
    </button>
   </div>
   {assignMode!=='unassigned'&&(
    <div className="import-assign-reps">
     <p>{assignMode==='one'?'مندوب المبيعات الذي سيُسند إليه كل العملاء المستوردين':'حدد مندوبين أو أكثر'}</p>
     {sales.length===0&&!usersError&&<p className="subtle">لا يوجد مندوبو مبيعات نشطون. أضف مندوباً أو اختر بدون تعيين.</p>}
     <ul>
      {sales.map(user=>(
       <li key={user.id}>
        <label className="import-assign-rep">
         <input type={assignMode==='one'?'radio':'checkbox'} name="import-rep" checked={selected.includes(user.id)} onChange={()=>toggleRep(user.id)}/>
         {user.name} <span className="subtle">@{user.username}</span>
        </label>
       </li>
      ))}
     </ul>
    </div>
   )}
  </div>
  {preview.length>0&&<>
   <p>جاهز: {readyCount}، مكرر: {preview.filter(r=>r.status==='duplicate').length}، غير صالح: {preview.filter(r=>r.status==='invalid').length}، تنبيهات: {preview.filter(r=>r.warnings?.length).length}</p>
   <Table><TableHeader><TableRow><TableHead>الصف</TableHead><TableHead>الاسم / الجوال</TableHead><TableHead>المرحلة</TableHead><TableHead>النتيجة</TableHead></TableRow></TableHeader><TableBody>{preview.map(r=><TableRow key={r.row}><TableCell>{r.row+header+1}</TableCell><TableCell>{r.lead?.name} {r.lead?.phone}</TableCell><TableCell>{r.lead?.stage?stageLabel(r.lead.stage):'—'}</TableCell><TableCell>{({ready:'جاهز',invalid:'غير صالح',duplicate:'مكرر'} as Record<string,string>)[r.status]} {[...r.errors,...(r.warnings||[])].join('، ')}</TableCell></TableRow>)}</TableBody></Table>
   <button onClick={download}>تنزيل تقرير المراجعة بكل الصفوف الأصلية</button>
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>راجعت المعاينة وأوافق على إدخال الصفوف الجاهزة فقط</label>
   <button className="primary" disabled={busy||!canCommit} onClick={()=>void run('commit')}>تأكيد الاستيراد</button>
  </>}
 </section>;
}
