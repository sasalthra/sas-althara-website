'use client';
import {useState} from 'react';
import type {Lead} from '@/app/lead-form';
import {transactionFields,transactionSchema,confirmedDue,type TransactionInput} from '@/lib/transactions';
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '@/components/ui/table';
type RecordRow={id:string;version:number;data:TransactionInput;client_name:string;updated_at:string;confirmed_due:string|null};
export default function TransactionsPanel({leads,initialLeadId=''}:{leads:Lead[];initialLeadId?:string}){
 const [rows,setRows]=useState<RecordRow[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [form,setForm]=useState<TransactionInput>({leadId:initialLeadId,debtPayer:'unset'}),[id,setId]=useState(''),[version,setVersion]=useState(0),[confirmed,setConfirmed]=useState(false);
 async function load(){setBusy(true);try{const r=await fetch('/api/transactions');const d=await r.json();if(!r.ok)throw Error(d.error);setRows(d);setMessage('تم تحديث السجل');}catch(e){setMessage(e instanceof Error?e.message:'تعذر التحميل');}finally{setBusy(false);}}
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);try{const r=await fetch('/api/transactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id||crypto.randomUUID(),version,confirmed,data:form})});const d=await r.json();if(!r.ok)throw Error(d.error);setId(d.id);setVersion(d.version);setConfirmed(false);await load();setMessage('تم حفظ المعاملة');}catch(e){setMessage(e instanceof Error?e.message:'تعذر الحفظ');}finally{setBusy(false);}}
 const valid=transactionSchema.safeParse(form),lead=leads.find(l=>l.id===form.leadId);
 return <section dir="rtl" className="panel space-y-5"><h2>المعاملات والمالية</h2><p>الضريبة وصافي العمولة والإجماليات والرصيد إدخال يدوي حتى اعتماد القواعد. سداد العميل المباشر ليس تحصيلاً للشركة.</p><button onClick={()=>void load()} disabled={busy}>تحميل / تحديث السجل</button><p role="status">{message}</p>
 <Table><TableHeader><TableRow><TableHead>العميل</TableHead><TableHead>تاريخ التحديث</TableHead><TableHead>المديونية + السعي المؤكد</TableHead><TableHead>الإجراء</TableHead></TableRow></TableHeader><TableBody>{rows.map(r=><TableRow key={r.id}><TableCell><a href={`/crm/leads/${r.data.leadId}`}>{r.client_name}</a></TableCell><TableCell>{r.updated_at}</TableCell><TableCell>{r.confirmed_due??'غير مكتمل'}</TableCell><TableCell><button onClick={()=>{setId(r.id);setVersion(r.version);setForm(r.data);setConfirmed(false);}}>فتح المعاملة</button></TableCell></TableRow>)}</TableBody></Table>
 <button onClick={()=>{setId('');setVersion(0);setForm({leadId:'',debtPayer:'unset'});setConfirmed(false);}}>معاملة جديدة</button>
 <form onSubmit={save} className="fields"><label>العميل والعقار المرتبط<select required disabled={version>0} value={form.leadId} onChange={e=>setForm({...form,leadId:e.target.value})}><option value="">اختر العميل</option>{leads.map(l=><option key={l.id} value={l.id}>{l.name} — {l.phone}</option>)}</select></label>
 {lead&&<p>المصدر: {lead.source} | العقار: {lead.property_other||lead.property_id} | المبيعات: {lead.assigned_name||'غير معين'} | الميداني: {lead.field_assigned_name||'غير معين'}</p>}
 <label>جهة سداد المديونية<select value={form.debtPayer} onChange={e=>setForm({...form,debtPayer:e.target.value as TransactionInput['debtPayer']})}><option value="unset">لم يحدد</option><option value="company">الشركة</option><option value="client">العميل بنفسه</option></select></label>
 {transactionFields.map(f=><label key={f.key}>{f.label}{f.type==='employee'?' — معرف المستخدم (UUID)':''}<input type={f.type==='date'?'date':'text'} inputMode={f.type.includes('Money')||f.type==='money'?'decimal':'text'} value={form[f.key]||''} maxLength={3000} onChange={e=>{setForm({...form,[f.key]:e.target.value});setConfirmed(false);}}/></label>)}
 <p>الجزء المؤكد من المستحق (سداد الشركة + السعي فقط): {valid.success?confirmedDue(valid.data)??'أكمل القيم':'راجع القيم'} — لا يشمل بنوداً غير معتمدة.</p>
 <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>راجعت البيانات وأوافق على حفظ التغيير المالي</label><button className="primary" disabled={busy||!confirmed}>حفظ المعاملة</button></form></section>;
}
