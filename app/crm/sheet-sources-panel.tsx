'use client';
import {useEffect, useState, type FormEvent} from 'react';
import {
  DEFAULT_SHEET_LABEL,
  SHEET_FIELDS,
  sheetFieldLabels,
  type SheetField,
  type SheetMapping,
} from '@/lib/sheet-sync-config';

type SourceResult = {
  inserted?: number;
  duplicates?: number;
  invalid?: number;
  unchanged?: number;
  error?: string;
  errors?: string[];
};

type SheetSource = {
  id: string;
  sheetId: string;
  gid: string;
  label: string;
  campaign: string;
  mapping: SheetMapping;
  headers: string[];
  enabled: boolean;
  lastRun: string;
  lastResult: SourceResult | null;
};

type Status = {
  sources: SheetSource[];
  intervalMs: number;
  cronReady: boolean;
  serviceAccount: boolean;
};

const emptyMapping = (): SheetMapping => ({});

function riyadh(value: string) {
  if (!value) return 'لم تتم بعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('ar-SA', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh'}).format(date);
  } catch {
    return value;
  }
}

function summarize(result: SourceResult | null) {
  if (!result) return 'لا توجد نتيجة';
  if (result.error) return result.error;
  return `جديد ${result.inserted ?? 0}، مكرر ${result.duplicates ?? 0}، غير صالح ${result.invalid ?? 0}، بلا تغيير ${result.unchanged ?? 0}`;
}

export default function SheetSourcesPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [editing, setEditing] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [gid, setGid] = useState('');
  const [label, setLabel] = useState(DEFAULT_SHEET_LABEL);
  const [campaign, setCampaign] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<SheetMapping>(emptyMapping);
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch('/api/integrations/sheet-sources', {cache: 'no-store'});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'تعذر تحميل المصادر');
    setStatus(data);
    return data as Status;
  }

  useEffect(() => {
    void load().catch(error => setMessage(error instanceof Error ? error.message : 'تعذر تحميل المصادر'));
  }, []);

  function fill(source: SheetSource) {
    setEditing(source.id);
    setSheetUrl(source.sheetId);
    setGid(source.gid || '');
    setLabel(source.label || DEFAULT_SHEET_LABEL);
    setCampaign(source.campaign || '');
    setHeaders(Array.isArray(source.headers) ? source.headers : []);
    setMapping(source.mapping || {});
    setEnabled(source.enabled);
    setMessage('');
  }

  function resetForm() {
    setEditing('');
    setSheetUrl('');
    setGid('');
    setLabel(DEFAULT_SHEET_LABEL);
    setCampaign('');
    setHeaders([]);
    setMapping(emptyMapping());
    setEnabled(true);
  }

  async function readHeaders() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/integrations/sheet-sources/preview', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sheetUrl, gid}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذر قراءة العناوين');
      setHeaders(data.headers || []);
      setMapping(data.mapping || {});
      if (data.gid) setGid(String(data.gid));
      setMessage('قُرئت العناوين واقتُرح الربط. راجعه ثم احفظ.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر قراءة العناوين');
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (!headers.length) throw Error('اقرأ العناوين أولاً ثم راجع الربط.');
      const response = await fetch('/api/integrations/sheet-sources', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          ...(editing ? {id: editing} : {}),
          sheetUrl,
          gid,
          label: label.trim() || DEFAULT_SHEET_LABEL,
          campaign,
          mapping,
          headers,
          enabled,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذر الحفظ');
      await load();
      setEditing(String(data.id || editing));
      setMessage('حُفظ المصدر. الصفوف الجديدة تُسحب تلقائياً، ويمكنك المزامنة الآن.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    if (!window.confirm('ستُستورد الصفوف الجديدة فقط إلى عملاء غير معيّنين. هل تريد المزامنة الآن؟')) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/integrations/sheet-sources/sync', {method: 'POST'});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذرت المزامنة');
      await load();
      if (data.skipped && data.reason) {
        setMessage(data.reason);
        return;
      }
      const errors = Array.isArray(data.errors) ? data.errors.filter(Boolean) : [];
      setMessage(
        `آخر مزامنة: جديد ${data.inserted ?? 0}، مكرر ${data.duplicates ?? 0}، غير صالح ${data.invalid ?? 0}، بلا تغيير ${data.unchanged ?? 0}${errors.length ? `. ${errors[0]}` : ''}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذرت المزامنة');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('حذف المصدر يوقف سحبه. لإيقافه مؤقتاً ألغِ التفعيل بدلاً من الحذف. هل تريد الحذف؟')) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/integrations/sheet-sources?id=${encodeURIComponent(id)}`, {method: 'DELETE'});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذر الحذف');
      if (editing === id) resetForm();
      await load();
      setMessage('حُذف المصدر. إن لم يبقَ أي مصدر، يُعاد جدول تيك توك المبدئي بعد إعادة تشغيل التطبيق.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر الحذف');
    } finally {
      setBusy(false);
    }
  }

  const minutes = status ? Math.round(status.intervalMs / 60000) : 3;

  return (
    <section dir="rtl" className="panel space-y-4">
      <h2>مصادر نماذج الإعلانات</h2>
      <p>
        كل صف جديد في الجدول يصبح عميلاً في مرحلة «عميل جديد»، المصدر تسمية المصدر مع اسم الحملة، والجوال بصيغة 05، ومن غير تعيين حتى يوزّعه المدير.
        أول مزامنة لمصدر جديد تُسجّل النشاط فقط، وترسل للإدارة ملخصاً واحداً بعدد الجدد والموجودين، دون بريد إعادة تسجيل.
        بعد ذلك، أكثر من خمس إعادات تسجيل في المزامنة نفسها تُجمع في بريد واحد للإدارة وبريد لكل مندوب بعملائه فقط.
        جدول تيك توك العام مضاف مسبقاً إن كانت القائمة فارغة عند أول تشغيل.
      </p>
      <p>
        {status && status.intervalMs > 0
          ? `المزامنة التلقائية تعمل كل ${minutes} دقائق تقريباً ما دام تطبيق Node يعمل، وتبدأ بعد نحو 20 ثانية من التشغيل.`
          : 'المزامنة داخل عملية Node متوقفة. يعتمد السحب على كرون الاستضافة فقط.'}
        {' '}مفتاح الجدولة: {status ? (status.cronReady ? 'مضبوط' : 'غير مضبوط') : '…'}
        {' '}— حساب خدمة للجداول الخاصة: {status ? (status.serviceAccount ? 'مضبوط' : 'غير مضبوط، والجداول العامة تُقرأ بدون حساب') : '…'}.
      </p>
      <button type="button" className="primary" disabled={busy} onClick={() => void syncNow()}>مزامنة الآن</button>
      <p role="status">{message}</p>
      {status?.sources?.length ? (
        <div className="space-y-3">
          {status.sources.map(source => (
            <article key={source.id} style={{border: '1px solid #d1d5db', padding: '12px 14px'}}>
              <strong>{source.label || DEFAULT_SHEET_LABEL}</strong>
              {source.campaign ? ` — ${source.campaign}` : ''}
              <p>المعرف: {source.sheetId}{source.gid ? ` — الورقة ${source.gid}` : ''}</p>
              <p>الحالة: {source.enabled ? 'مفعّل' : 'متوقف'}</p>
              <p>آخر مزامنة: {riyadh(source.lastRun)} — {summarize(source.lastResult)}</p>
              {source.lastResult?.errors?.length ? <p>{source.lastResult.errors.slice(0, 3).join('؛ ')}</p> : null}
              <p>
                <button type="button" disabled={busy} onClick={() => fill(source)}>تعديل الربط</button>{' '}
                <button type="button" disabled={busy} onClick={() => void remove(source.id)}>حذف</button>{' '}
                <a href={`https://docs.google.com/spreadsheets/d/${source.sheetId}/edit`} target="_blank" rel="noreferrer">فتح الجدول</a>
              </p>
            </article>
          ))}
        </div>
      ) : <p>لا توجد مصادر بعد. أضف رابط الجدول أدناه، أو أعد تشغيل التطبيق ليظهر جدول تيك توك المبدئي.</p>}
      <form className="fields" onSubmit={event => void save(event)}>
        <h3>{editing ? 'تعديل مصدر' : 'إضافة مصدر'}</h3>
        <label>رابط الجدول أو معرفه<input required value={sheetUrl} onChange={event => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" maxLength={500}/></label>
        <label>رقم الورقة gid (اختياري)<input value={gid} onChange={event => setGid(event.target.value.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" placeholder="0"/></label>
        <label>تسمية المصدر<input required value={label} onChange={event => setLabel(event.target.value)} maxLength={40}/></label>
        <label>اسم الحملة<input value={campaign} onChange={event => setCampaign(event.target.value)} maxLength={60} placeholder="تمويل عقارى 4 نوفمبر"/></label>
        <p>
          <button type="button" disabled={busy || !sheetUrl.trim()} onClick={() => void readHeaders()}>قراءة العناوين</button>
        </p>
        {headers.length > 0 && SHEET_FIELDS.map(key => (
          <label key={key}>{sheetFieldLabels[key as SheetField]}
            <select
              value={mapping[key as SheetField] ?? ''}
              onChange={event => {
                const next = {...mapping};
                if (event.target.value === '') delete next[key as SheetField];
                else next[key as SheetField] = Number(event.target.value);
                setMapping(next);
              }}
            >
              <option value="">غير مربوط</option>
              {headers.map((header, index) => <option key={index} value={index}>{index + 1}: {header || 'عنوان فارغ'}</option>)}
            </select>
          </label>
        ))}
        <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/> تفعيل المزامنة التلقائية لهذا المصدر</label>
        <p>الاسم والجوال مطلوبان. عمود الحملة يُذكر في الملاحظات، ويُستخدم كاسم الحملة فقط إذا تُرك حقل اسم الحملة فارغاً. الصف الذي عولج لا يُستورد مرة أخرى ما لم يتغير محتواه.</p>
        <button className="primary" disabled={busy || !headers.length}>حفظ المصدر</button>
        {editing ? <button type="button" disabled={busy} onClick={resetForm}>مصدر جديد</button> : null}
      </form>
    </section>
  );
}
