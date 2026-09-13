'use client';
import {useState} from 'react';
import {importFields,type Mapping} from '@/lib/lead-import';
import {sheetConfigSchema,type SheetConfig} from '@/lib/sheets-policy';

type Status={config:SheetConfig|null;lastRun?:string;lastResult?:unknown;credentialsReady:boolean;schedulerReady:boolean};
export default function SheetsPanel(){
 const [sheetId,setSheetId]=useState(''),[range,setRange]=useState(''),[headerText,setHeaderText]=useState('');
 const [mapping,setMapping]=useState<Mapping>({}),[enabled,setEnabled]=useState(false),[confirmed,setConfirmed]=useState(false);
 const [status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const headers=headerText.split('\n').map(h=>h.replace(/\r$/, ''));
 async function load(){
  const r=await fetch('/api/integrations/sheets',{cache:'no-store'}),d=await r.json();
  if(!r.ok)throw Error(d.error);setStatus(d);
  if(d.config){const c=sheetConfigSchema.parse(d.config);setSheetId(c.sheetId);setRange(c.range);setHeaderText(c.headers.join('\n'));setMapping(c.mapping);setEnabled(c.enabled);}
  setConfirmed(false);
 }
 async function perform(action:'load'|'save'|'sync'){
  setBusy(true);setMessage('');
  try{
   if(action==='load'){await load();setMessage('تم تحميل الإعدادات.');return;}
   if(action==='sync'){
    if(!window.confirm('ستضاف الصفوف الجديدة الصالحة من المصدر المحفوظ. هل تؤكد تشغيل المزامنة؟'))return;
    const r=await fetch('/api/integrations/sheets/sync',{method:'POST'}),d=await r.json();
    if(!r.ok)throw Error(d.error);await load();setMessage(`تمت المزامنة: ${d.inserted} جديد، ${d.duplicates} مكرر، ${d.invalid.length} غير صالح.`);return;
   }
   const c=sheetConfigSchema.safeParse({sheetId,range,headers,mapping,enabled,sourceConfirmed:confirmed});
   if(!c.success)throw Error('راجع معرف المصدر والنطاق والعناوين وربط الأعمدة وتأكيد المصدر.');
   const r=await fetch('/api/integrations/sheets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c.data)}),d=await r.json();
   if(!r.ok)throw Error(d.error);await load();setMessage('حُفظت الإعدادات وتمت قراءتها مجدداً. يلزم تفعيل الجدولة على الاستضافة لتعمل تلقائياً.');
  }catch(e){setMessage(e instanceof Error?e.message:'تعذر تنفيذ الطلب');}finally{setBusy(false);}
 }
 return <section dir="rtl" className="panel space-y-4"><h2>إعدادات Google Sheets</h2>
  <p>استيراد عملاء جدد فقط، وليس مزامنة تعديلات أو حذف. ملف المعاملات المرجعي ليس مصدر العملاء تلقائياً. يلزم حساب خدمة بصلاحية قراءة ومصدر معتمد وجدولة على الاستضافة.</p>
  <button disabled={busy} onClick={()=>void perform('load')}>تحميل الإعدادات والحالة</button><p role="status">{message}</p>
  {status&&<div><p>وصول الخادم: {status.credentialsReady?'مضبوط — لم يُختبر الاتصال':'غير مضبوط'}؛ مفتاح الجدولة: {status.schedulerReady?'مضبوط — لا يثبت تشغيل المجدول':'غير مضبوط'}.</p><p>آخر تشغيل: {status.lastRun||'لم يسجل تشغيل'}</p><pre className="whitespace-pre-wrap">{status.lastResult?typeof status.lastResult==='string'?status.lastResult:JSON.stringify(status.lastResult,null,2):''}</pre></div>}
  <form className="fields" onSubmit={e=>{e.preventDefault();void perform('save');}}>
   <label>معرف جدول Google (وليس الرابط الكامل)<input required value={sheetId} onChange={e=>{setSheetId(e.target.value);setConfirmed(false);}} maxLength={100}/></label>
   <label>النطاق: اسم الورقة!A1:D1001 مثلاً<input required value={range} onChange={e=>{setRange(e.target.value);setConfirmed(false);}} placeholder="Leads!A1:D1001" maxLength={180}/></label>
   <label>العناوين الأصلية بالترتيب — عنوان واحد في كل سطر<textarea required value={headerText} onChange={e=>{setHeaderText(e.target.value);setMapping({});setConfirmed(false);}}/></label>
   {Object.entries(importFields).map(([key,label])=><label key={key}>{label}<select value={mapping[key as keyof Mapping]??''} onChange={e=>{const next={...mapping};if(e.target.value==='')delete next[key as keyof Mapping];else next[key as keyof Mapping]=Number(e.target.value);setMapping(next);setConfirmed(false);}}><option value="">غير مربوط</option>{headers.map((h,i)=><option key={i} value={i}>{i+1}: {h||'عنوان فارغ'}</option>)}</select></label>)}
   <label><input type="checkbox" checked={enabled} onChange={e=>{setEnabled(e.target.checked);setConfirmed(false);}}/>تفعيل المزامنة المجدولة</label>
   <label><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>أؤكد أن هذا مصدر العملاء المعتمد وأن ترتيب العناوين والربط صحيح</label>
   <p>حد القراءة 1000 صف و100 عمود. عند تغيير أي عنوان تتوقف المزامنة. لا تُستبدل الأرقام المكررة. أخطاء الصفوف تظهر في نتيجة آخر تشغيل دون إظهار أسماء العملاء.</p>
   <button disabled={busy||!confirmed}>حفظ إعدادات المصدر</button>
  </form>
  <button disabled={busy||!status?.config?.enabled} onClick={()=>void perform('sync')}>تشغيل المصدر المحفوظ الآن مع تأكيد</button>
 </section>;
}
