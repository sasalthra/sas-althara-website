'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {Lead} from '@/app/lead-form';
import properties from '@/data/properties.json';
import {displayLeadPhone} from '@/lib/phone';
import {formatRiyadhDateTime} from '@/lib/lead-dates';
import {
  blankTransaction,
  canReviewTransactions,
  commissionTotal,
  confirmedDue,
  hiddenTransactionKeys,
  reviewStatusLabels,
  specialTransactionKeys,
  transactionFields,
  transactionFromRecord,
  transactionSchema,
  type ReviewStatus,
  type TransactionInput,
} from '@/lib/transactions';
import {Table,TableHeader,TableHead,TableBody,TableRow,TableCell} from '@/components/ui/table';

type RecordRow={
  id:string;
  version:number;
  data:TransactionInput & {reviewStatus?: string; reviewedByName?: string; reviewedAt?: string};
  client_name:string;
  property_id?: string;
  property_other?: string;
  updated_at:string;
  confirmed_due:string|null;
  review_status?: string;
  reviewed_by_name?: string;
  reviewed_at?: string;
};

type Choice = {id: string; label: string; hint: string};

function digits(value: string) {
  return value.replace(/\D/g, '');
}

function matchesQuery(query: string, ...parts: Array<string | null | undefined>) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  const phone = digits(text);
  return parts.some(part => {
    const value = String(part ?? '');
    if (value.toLowerCase().includes(text)) return true;
    return phone.length >= 3 && digits(value).includes(phone);
  });
}

function SearchPicker({
  label,
  placeholder,
  selected,
  query,
  onQuery,
  choices,
  onPick,
  disabled,
}: {
  label: string;
  placeholder: string;
  selected: string;
  query: string;
  onQuery: (value: string) => void;
  choices: Choice[];
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = choices.slice(0, 12);
  return <label className="relative block">{label}
    <input
      value={open ? query : selected}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => {if (!disabled) setOpen(true);}}
      onBlur={() => setTimeout(() => setOpen(false), 150)}
      onChange={event => {onQuery(event.target.value); setOpen(true);}}
    />
    {open && !disabled && <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow">
      {shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">لا توجد نتائج</li>}
      {shown.map(choice => <li key={choice.id}><button type="button" className="w-full px-3 py-2 text-right hover:bg-[#f3eaf4]" onClick={() => {onPick(choice.id); setOpen(false); onQuery('');}}>{choice.label}<span className="mt-0.5 block text-xs text-slate-500">{choice.hint}</span></button></li>)}
    </ul>}
  </label>;
}

function propertyTitle(id: string) {
  return properties.find(item => item.id === id)?.title || '';
}

export default function TransactionsPanel({
  leads = [],
  initialLeadId = '',
  highlightDebt = false,
  role = 'admin',
}: {
  leads?: Lead[];
  initialLeadId?: string;
  highlightDebt?: boolean;
  role?: string;
}){
 const [options, setOptions] = useState<Lead[]>(leads);
 const [rows,setRows]=useState<RecordRow[]>([]);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [canReview, setCanReview] = useState(canReviewTransactions(role));
 const [clientQuery, setClientQuery] = useState('');
 const [propertyQuery, setPropertyQuery] = useState('');
 const [form,setForm]=useState<TransactionInput>(() => blankTransaction(initialLeadId));
 const [id,setId]=useState('');
 const [version,setVersion]=useState(0);
 const [confirmed,setConfirmed]=useState(false);
 const [reviewStatus, setReviewStatus] = useState<string>('pending');
 const [reviewedByName, setReviewedByName] = useState('');
 const [reviewedAt, setReviewedAt] = useState('');
 const opened = useRef(false);

 useEffect(() => {
  const controller = new AbortController();
  fetch('/api/leads?picklist=1', {cache: 'no-store', signal: controller.signal})
    .then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر التحميل');
      const next = Array.isArray(result) ? result : result.leads;
      if (Array.isArray(next)) setOptions(next);
    })
    .catch(() => {});
  return () => controller.abort();
 }, []);

 async function load(){
  setBusy(true);
  try{
    const query = initialLeadId ? `?leadId=${encodeURIComponent(initialLeadId)}` : '';
    const response = await fetch(`/api/transactions${query}`);
    const payload = await response.json();
    if(!response.ok) throw Error(payload.error);
    const next = Array.isArray(payload) ? payload : payload.rows;
    const list = Array.isArray(next) ? next as RecordRow[] : [];
    setRows(list);
    if (!opened.current && initialLeadId) {
      const match = list.find(row => row.data?.leadId === initialLeadId);
      if (match) {
        opened.current = true;
        openRow(match);
      }
    }
    if (typeof payload.canReview === 'boolean') setCanReview(payload.canReview);
    setMessage('تم تحديث السجل');
  }catch(error){
    setMessage(error instanceof Error ? error.message : 'تعذر التحميل');
  }finally{
    setBusy(false);
  }
 }

 useEffect(() => { void load(); }, [initialLeadId]);

 function openRow(row: RecordRow) {
  setId(row.id);
  setVersion(row.version);
  setForm(transactionFromRecord(row.data));
  setConfirmed(false);
  setReviewStatus(row.review_status || row.data.reviewStatus || 'pending');
  setReviewedByName(row.reviewed_by_name || row.data.reviewedByName || '');
  setReviewedAt(row.reviewed_at || row.data.reviewedAt || '');
  setClientQuery('');
  setPropertyQuery('');
 }

 function startNew() {
  const lead = options.find(item => item.id === initialLeadId);
  const next = blankTransaction(initialLeadId);
  if (lead?.property_id) next.linkedPropertyId = lead.property_id;
  setId('');
  setVersion(0);
  setForm(next);
  setConfirmed(false);
  setReviewStatus('pending');
  setReviewedByName('');
  setReviewedAt('');
 }

 async function save(event?: React.FormEvent, decision?: 'approved' | 'rejected'){
  event?.preventDefault();
  setBusy(true);
  try{
    const response = await fetch('/api/transactions',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:id||crypto.randomUUID(), version, confirmed:true, decision, data:form}),
    });
    const payload = await response.json();
    if(!response.ok) throw Error(payload.error);
    setId(payload.id);
    setVersion(payload.version);
    setForm(current => ({...current, clientSerial: payload.clientSerial || current.clientSerial}));
    setReviewStatus(payload.reviewStatus || 'pending');
    setReviewedByName(payload.reviewedByName || '');
    setReviewedAt(payload.reviewedAt || '');
    setConfirmed(false);
    await load();
    setMessage(decision === 'approved' ? 'تم اعتماد المعاملة' : decision === 'rejected' ? 'تم رفض المعاملة' : 'تم حفظ المعاملة وبانتظار اعتماد الحسابات');
  }catch(error){
    setMessage(error instanceof Error ? error.message : 'تعذر الحفظ');
  }finally{
    setBusy(false);
  }
 }

 const valid=transactionSchema.safeParse(form);
 const lead=options.find(item => item.id === form.leadId);
 const clientChoices = useMemo<Choice[]>(() => options
  .filter(item => matchesQuery(clientQuery, item.name, item.phone, displayLeadPhone(item.phone), item.property_other))
  .map(item => ({id: item.id, label: item.name, hint: displayLeadPhone(item.phone)})), [options, clientQuery]);
 const propertyChoices = useMemo<Choice[]>(() => {
  const fromCatalog = properties
    .filter(item => matchesQuery(propertyQuery, item.title, item.city, item.address, item.id) || options.some(row => row.property_id === item.id && matchesQuery(propertyQuery, row.phone, row.name)))
    .map(item => ({id: item.id, label: item.title, hint: [item.city, item.id].filter(Boolean).join(' — ')}));
  const extras = options
    .filter(item => item.property_id === 'other' && matchesQuery(propertyQuery, item.property_other, item.name, item.phone))
    .map(item => ({id: `other:${item.id}`, label: item.property_other || 'عقار آخر', hint: item.name}));
  return [...fromCatalog, ...extras];
 }, [options, propertyQuery]);
 const selectedClient = lead ? `${lead.name} — ${displayLeadPhone(lead.phone)}` : '';
 const selectedProperty = propertyTitle(form.linkedPropertyId) || (form.linkedPropertyId.startsWith('other:') ? options.find(item => `other:${item.id}` === form.linkedPropertyId)?.property_other : '') || form.linkedPropertyId;
 const reviewKey: ReviewStatus = reviewStatus === 'approved' || reviewStatus === 'rejected' ? reviewStatus : 'pending';
 const visibleFields = transactionFields.filter(field => !hiddenTransactionKeys.has(field.key) && !specialTransactionKeys.has(field.key));

 return <section dir="rtl" className="panel space-y-5">
  <h2>{highlightDebt ? 'سداد مديونية' : 'المعاملات والمالية'}</h2>
  <p>يملأ موظف المبيعات البيانات، ثم يراجعها موظف الحسابات أو الإدارة ويعتمدها أو يرفضها. مسلسل العميل يُنشأ بعد الحفظ. الضريبة وصافي العمولة والإجماليات إدخال يدوي.</p>
  <button type="button" onClick={() => void load()} disabled={busy}>تحميل / تحديث السجل</button>
  <p role="status">{message}</p>
  <Table>
    <TableHeader><TableRow>
      <TableHead>المسلسل</TableHead>
      <TableHead>العميل</TableHead>
      <TableHead>العقار</TableHead>
      <TableHead>الاعتماد</TableHead>
      <TableHead>تاريخ عقد الوساطة</TableHead>
      <TableHead>العمولة من المالك</TableHead>
      <TableHead>العمولة من العميل</TableHead>
      <TableHead>إجمالي العمولة</TableHead>
      <TableHead>المبلغ المراد سداده</TableHead>
      <TableHead>تاريخ التحديث</TableHead>
      <TableHead>الإجراء</TableHead>
    </TableRow></TableHeader>
    <TableBody>{rows.map(row => {
      const status = row.review_status === 'approved' || row.review_status === 'rejected' ? row.review_status : 'pending';
      const property = propertyTitle(row.data.linkedPropertyId || '') || row.property_other || row.property_id || '—';
      return <TableRow key={row.id}>
        <TableCell>{row.data.clientSerial || '—'}</TableCell>
        <TableCell><a href={`/crm/leads/${row.data.leadId}`}>{row.client_name}</a></TableCell>
        <TableCell>{property}</TableCell>
        <TableCell>{reviewStatusLabels[status]}</TableCell>
        <TableCell>{row.data.contractDate || '—'}</TableCell>
        <TableCell>{row.data.ownerCommission || '—'}</TableCell>
        <TableCell>{row.data.clientCommission || '—'}</TableCell>
        <TableCell>{commissionTotal(row.data.ownerCommission, row.data.clientCommission)}</TableCell>
        <TableCell>{row.data.debtPayoffAmount || row.data.debtSettlement || '—'}</TableCell>
        <TableCell dir="ltr">{formatRiyadhDateTime(row.updated_at) || '—'}</TableCell>
        <TableCell><button type="button" onClick={() => openRow(row)}>فتح المعاملة</button></TableCell>
      </TableRow>;
    })}</TableBody>
  </Table>
  <button type="button" onClick={startNew}>معاملة جديدة</button>
  <form onSubmit={event => void save(event)} className="fields">
    <SearchPicker
      label="العميل"
      placeholder="ابحث بالاسم أو الجوال"
      selected={selectedClient}
      query={clientQuery}
      onQuery={setClientQuery}
      choices={clientChoices}
      disabled={version > 0}
      onPick={leadId => {
        const picked = options.find(item => item.id === leadId);
        setForm(current => ({
          ...current,
          leadId,
          linkedPropertyId: current.linkedPropertyId || picked?.property_id || '',
        }));
        setConfirmed(false);
      }}
    />
    <SearchPicker
      label="العقار المرتبط"
      placeholder="ابحث بالاسم أو الجوال أو الحي"
      selected={selectedProperty}
      query={propertyQuery}
      onQuery={setPropertyQuery}
      choices={propertyChoices}
      onPick={propertyId => {
        setForm(current => ({...current, linkedPropertyId: propertyId}));
        setConfirmed(false);
      }}
    />
    {lead && <p>المصدر: {lead.source} | عقار الملف: {lead.property_other || propertyTitle(lead.property_id) || lead.property_id} | المبيعات: {lead.assigned_name || 'غير معين'} | الميداني: {lead.field_assigned_name || 'غير معين'}</p>}
    <label>مسلسل العميل<input readOnly value={form.clientSerial || 'يُنشأ تلقائياً بعد حفظ المعاملة'} /></label>
    <p>حالة الاعتماد: {reviewStatusLabels[reviewKey]}{reviewedByName ? ` — ${reviewedByName}` : ''}{reviewedAt ? ` — ${formatRiyadhDateTime(reviewedAt) || reviewedAt}` : ''}</p>
    <div className={highlightDebt ? 'space-y-3 rounded-2xl border border-[#3F1A44]/30 bg-[#f3eaf4] p-4' : 'space-y-3 rounded-2xl border border-slate-200 p-4'}>
      <h3 className="font-semibold">سداد مديونية</h3>
      <label>جهة سداد المديونية<select value={form.debtPayer} onChange={event => {setForm({...form, debtPayer: event.target.value as TransactionInput['debtPayer']}); setConfirmed(false);}}>
        <option value="unset">لم يحدد</option>
        <option value="company">الشركة</option>
        <option value="client">العميل بنفسه</option>
      </select></label>
      <label>المبلغ المراد سداده<input inputMode="decimal" value={form.debtPayoffAmount || ''} onChange={event => {setForm({...form, debtPayoffAmount: event.target.value}); setConfirmed(false);}} /></label>
      <label>رقم الحساب<input value={form.debtAccountNumber || ''} maxLength={80} onChange={event => {setForm({...form, debtAccountNumber: event.target.value}); setConfirmed(false);}} /></label>
      <label>التاريخ<input type="date" value={form.debtPayoffDate || ''} onChange={event => {setForm({...form, debtPayoffDate: event.target.value}); setConfirmed(false);}} /></label>
      <label>رقم السداد<input value={form.debtPaymentRef || ''} maxLength={80} onChange={event => {setForm({...form, debtPaymentRef: event.target.value}); setConfirmed(false);}} /></label>
    </div>
    <label>العمولة من المالك<input inputMode="decimal" value={form.ownerCommission || ''} onChange={event => {setForm({...form, ownerCommission: event.target.value}); setConfirmed(false);}} /></label>
    <label>العمولة من العميل<input inputMode="decimal" value={form.clientCommission || ''} onChange={event => {setForm({...form, clientCommission: event.target.value}); setConfirmed(false);}} /></label>
    <label>إجمالي العمولة<input readOnly value={commissionTotal(form.ownerCommission, form.clientCommission)} /></label>
    {form.brokerage ? <p>ملاحظة عمولة سابقة: {form.brokerage}</p> : null}
    {visibleFields.map(field => <label key={field.key}>{field.label}{field.type === 'employee' ? ' — معرف المستخدم (UUID)' : ''}<input type={field.type === 'date' ? 'date' : 'text'} inputMode={field.type === 'money' || field.type === 'signedMoney' ? 'decimal' : 'text'} value={form[field.key] || ''} maxLength={3000} onChange={event => {setForm({...form, [field.key]: event.target.value}); setConfirmed(false);}} /></label>)}
    <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
      <label>استرداد دفعة<input inputMode="decimal" value={form.refund || ''} onChange={event => {setForm({...form, refund: event.target.value}); setConfirmed(false);}} /></label>
      <label>استرداد مبالغ أخرى<input inputMode="decimal" value={form.otherRefund || ''} onChange={event => {setForm({...form, otherRefund: event.target.value}); setConfirmed(false);}} /></label>
      <label>بيان استرداد المبالغ الأخرى<textarea value={form.otherRefundNote || ''} maxLength={1000} onChange={event => {setForm({...form, otherRefundNote: event.target.value}); setConfirmed(false);}} /></label>
    </div>
    <p>الجزء المؤكد من المستحق (سداد الشركة + السعي فقط): {valid.success ? confirmedDue(valid.data) ?? 'أكمل القيم' : 'راجع القيم'} — لا يشمل بنوداً غير معتمدة.</p>
    <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />راجعت البيانات وأوافق على حفظ التغيير المالي</label>
    <button className="primary" disabled={busy || !confirmed}>حفظ المعاملة</button>
    {canReview && <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !confirmed || !id} onClick={() => void save(undefined, 'approved')}>اعتماد</button>
      <button type="button" disabled={busy || !confirmed || !id} onClick={() => void save(undefined, 'rejected')}>رفض</button>
    </div>}
  </form>
 </section>;
}
