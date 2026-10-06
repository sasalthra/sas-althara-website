'use client';
import {useEffect, useState, type FormEvent} from 'react';
import {DEFAULT_SHEET_TEST_KEEP_PHONES} from '@/lib/sheet-test-purge';
import {
  DEFAULT_SHEET_LABEL,
  SHEET_FIELDS,
  sheetFieldLabels,
  SNAP_SHEET_GID,
  TIKTOK_SHEET_GID,
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

type SyncStep = {step: string; ok: boolean; detail: string};

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
  lastRunAt?: string;
  rowsRead?: number;
  created?: number;
  existing?: number;
  skipped?: number;
  errorMessage?: string;
};

type SheetTab = {gid: string; name: string};

type DuplicateCleanup = {
  deleted: number;
  totalDeleted: number;
  rowsMarked: number;
  ranAt: string;
};

type Status = {
  sources: SheetSource[];
  intervalMs: number;
  cronReady: boolean;
  serviceAccount: boolean;
  duplicateCleanup?: DuplicateCleanup | null;
};

const emptyMapping = (): SheetMapping => ({});

type PurgeLead = {id: string; name: string; phone: string; createdAt: string};

type PurgePreview = {
  aborted: boolean;
  skipped?: boolean;
  reason: string;
  cutoff: string;
  kept: PurgeLead[];
  delete: PurgeLead[];
  count: number;
  message?: string;
};

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

function summarize(source: SheetSource) {
  const result = source.lastResult;
  const error = source.errorMessage || result?.error || '';
  const created = source.created ?? result?.inserted ?? 0;
  const existing = source.existing ?? result?.duplicates ?? 0;
  const skipped = source.skipped ?? 0;
  const rowsRead = source.rowsRead ?? 0;
  if (!source.lastRunAt && !source.lastRun && !error) return 'لا توجد نتيجة';
  const counts = `قُرئ ${rowsRead}، جديد ${created}، موجود ${existing}، متخطى ${skipped}`;
  return error ? `${counts}. ${error}` : counts;
}

function healthLine(source: SheetSource) {
  const when = source.lastRunAt || source.lastRun;
  const label = source.label || DEFAULT_SHEET_LABEL;
  if (!when && !source.errorMessage) return `${label}: لم تتم أي مزامنة بعد`;
  const error = source.errorMessage ? ` الخطأ: ${source.errorMessage}` : ' لا يوجد خطأ.';
  return `${label}: آخر تشغيل ${riyadh(when)} — قُرئ ${source.rowsRead ?? 0}، جديد ${source.created ?? 0}، موجود ${source.existing ?? 0}، متخطى ${source.skipped ?? 0}.${error}`;
}

export default function SheetSourcesPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [editing, setEditing] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [gid, setGid] = useState('');
  const [label, setLabel] = useState(DEFAULT_SHEET_LABEL);
  const [campaign, setCampaign] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [headersGid, setHeadersGid] = useState('');
  const [mapping, setMapping] = useState<SheetMapping>(emptyMapping);
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState('');
  const [steps, setSteps] = useState<SyncStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [keepPhones, setKeepPhones] = useState<string[]>([...DEFAULT_SHEET_TEST_KEEP_PHONES]);
  const [purgePreview, setPurgePreview] = useState<PurgePreview | null>(null);
  const [purgeMessage, setPurgeMessage] = useState('');

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
    setHeadersGid(source.gid || '');
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
    setTabs([]);
    setHeadersGid('');
    setMapping(emptyMapping());
    setEnabled(true);
  }

  async function readHeaders(nextGid = gid) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/integrations/sheet-sources/preview', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({sheetUrl, gid: nextGid}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذر قراءة العناوين');
      const readGid = String(data.gid || nextGid || '');
      setGid(readGid);
      setHeadersGid(readGid);
      setHeaders(data.headers || []);
      setMapping(data.mapping || {});
      setTabs(Array.isArray(data.tabs) ? data.tabs : []);
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
      if ((gid || '') !== headersGid) throw Error('اقرأ العناوين لهذه الورقة قبل الحفظ.');
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
    setSteps([]);
    try {
      const response = await fetch('/api/integrations/sheet-sources/sync', {method: 'POST'});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || data.errorMessage || 'تعذرت المزامنة');
      await load();
      const nextSteps = Array.isArray(data.steps) ? data.steps as SyncStep[] : [];
      setSteps(nextSteps);
      if (data.skipped && data.reason) {
        setMessage(`${data.seeded ? 'أُضيفت ورقة تيك توك. ' : ''}${data.reason}`);
        return;
      }
      const errorText = data.errorMessage || (Array.isArray(data.errors) ? data.errors.filter(Boolean)[0] : '');
      const seededNote = data.seeded ? 'أُضيفت ورقة تيك توك. ' : '';
      const removed = Number(data.duplicatesRemoved ?? 0);
      setMessage(
        `${seededNote}آخر مزامنة: قُرئ ${data.rowsRead ?? 0}، جديد ${data.created ?? data.inserted ?? 0}، موجود ${data.existing ?? data.duplicates ?? 0}، متخطى ${data.skippedRows ?? 0}${errorText ? `. ${errorText}` : ''}. تم حذف ${removed} عميل مكرر من المزامنة`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذرت المزامنة');
    } finally {
      setBusy(false);
    }
  }

  async function diagnose() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/integrations/sheet-sources/diagnose', {method: 'POST'});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذر فحص قاعدة البيانات');
      const tables = data.tables || {};
      const names = ['crm_sheet_sources', 'crm_sheet_rows', 'crm_sheet_sync_lock'];
      const list = names.map(name => `${name}: ${tables[name] ? 'موجود' : 'غير موجود'}`).join('، ');
      const probe = data.insert === 'rolled-back' && !data.persisted
        ? 'تم إدراج صف تجريبي ثم التراجع عنه'
        : `الإدراج التجريبي: ${data.insert || 'غير معروف'}${data.persisted ? '، وبقي الصف بعد التراجع' : ''}`;
      setMessage(`إصدار قاعدة البيانات: ${data.version || 'غير معروف'}. ${list}. ${probe}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر فحص قاعدة البيانات');
    } finally {
      setBusy(false);
    }
  }

  async function cleanDuplicates() {
    if (!window.confirm('سيُحذف العملاء الأحدث الذين أنشأتهم المزامنة إذا كان رقمهم موجوداً على عميل أقدم. العميل الأقدم يبقى كما هو. هل تريد المتابعة؟')) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/integrations/sheet-sources/cleanup', {method: 'POST'});
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذر تنظيف المكررات');
      await load();
      if (data.skipped && data.reason) {
        setMessage(String(data.reason));
        return;
      }
      const deleted = Number(data.deleted ?? 0);
      const rowsMarked = Number(data.rowsMarked ?? 0);
      setMessage(
        `تم حذف ${deleted} عميل مكرر من المزامنة${rowsMarked ? `. عُلّمت ${rowsMarked} صفوف حتى لا تُستورد مرة أخرى` : ''}`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تنظيف المكررات');
    } finally {
      setBusy(false);
    }
  }

  function editKeepPhone(index: number, value: string) {
    setKeepPhones(current => current.map((phone, phoneIndex) => (phoneIndex === index ? value : phone)));
    setPurgePreview(null);
    setPurgeMessage('');
  }

  async function previewTestPurge() {
    setBusy(true);
    setPurgeMessage('');
    try {
      const response = await fetch('/api/integrations/sheet-sources/purge-tests', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({phones: keepPhones, confirm: false}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذرت المعاينة');
      setPurgePreview(data);
      setPurgeMessage(data.aborted ? String(data.reason || data.message || 'لم يُحذف شيء') : '');
    } catch (error) {
      setPurgePreview(null);
      setPurgeMessage(error instanceof Error ? error.message : 'تعذرت المعاينة');
    } finally {
      setBusy(false);
    }
  }

  async function confirmTestPurge() {
    const count = Number(purgePreview?.count ?? 0);
    if (!window.confirm(`سيُحذف ${count} عميل أنشأتهم مزامنة الجدول قبل العملاء الحقيقيين. لا يُرسل بريد، ولا يمكن التراجع. هل تريد المتابعة؟`)) return;
    setBusy(true);
    setPurgeMessage('');
    try {
      const response = await fetch('/api/integrations/sheet-sources/purge-tests', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({phones: keepPhones, confirm: true}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذر الحذف');
      if (data.skipped || data.aborted) {
        setPurgeMessage(String(data.reason || data.message || 'لم يُحذف شيء'));
        if (data.aborted) setPurgePreview(data);
        return;
      }
      setPurgePreview(null);
      setPurgeMessage(`تم حذف ${Number(data.deleted ?? 0)} عميل`);
    } catch (error) {
      setPurgeMessage(error instanceof Error ? error.message : 'تعذر الحذف');
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
      setMessage('حُذف المصدر. إن لم يبقَ أي مصدر، «مزامنة الآن» يعيد ورقة تيك توك ثم يسحبها.');
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
        إذا كان الجوال موجوداً لأي عميل، بأي مصدر أو حالة أو تعيين، لا يُنشأ عميل جديد ويُسجّل الصف مكرراً على العميل الأقدم.
        أول مزامنة لمصدر جديد تُسجّل النشاط فقط، وترسل للإدارة ملخصاً واحداً بعدد الجدد والموجودين، دون بريد إعادة تسجيل.
        بعد ذلك، أكثر من خمس إعادات تسجيل في المزامنة نفسها تُجمع في بريد واحد للإدارة وبريد لكل مندوب بعملائه فقط.
        الورقة المزروعة هي «تيك توك» برقم {TIKTOK_SHEET_GID}، بلا اسم حملة حتى يكتبه المدير. ورقة «اسناب يوليو» برقم {SNAP_SHEET_GID} تُضاف مرة واحدة إذا لم يكن نفس الجدول وهذه الورقة موجودين، ويُسجَّل عميلها مصدراً «سناب» ومن غير تعيين. ورقة meta لا تُزامَن.
      </p>
      <p>
        {status && status.intervalMs > 0
          ? `المزامنة التلقائية تعمل كل ${minutes} دقائق تقريباً ما دام تطبيق Node يعمل، وتبدأ بعد نحو 20 ثانية من التشغيل.`
          : 'المزامنة داخل عملية Node متوقفة. يعتمد السحب على كرون الاستضافة فقط.'}
        {' '}مفتاح الجدولة: {status ? (status.cronReady ? 'مضبوط' : 'غير مضبوط') : 'لم تُحمَّل الحالة'}
        {' '}— حساب خدمة للجداول الخاصة: {status ? (status.serviceAccount ? 'مضبوط' : 'غير مضبوط، والجداول العامة تُقرأ بدون حساب') : 'لم تُحمَّل الحالة'}.
      </p>
      <p data-sheet-health role="status">
        صحة المزامنة: {!status ? (message || 'لم تتم أي مزامنة بعد') : status.sources.length ? status.sources.map(healthLine).join(' ') : 'لم تتم أي مزامنة بعد'}
      </p>
      {status?.duplicateCleanup?.ranAt ? (
        <p data-sheet-cleanup role="status">تم حذف {status.duplicateCleanup.totalDeleted} عميل مكرر من المزامنة</p>
      ) : null}
      <button type="button" className="primary" disabled={busy} onClick={() => void syncNow()}>مزامنة الآن</button>{' '}
      <button type="button" disabled={busy} onClick={() => void diagnose()}>فحص قاعدة البيانات</button>{' '}
      <button type="button" disabled={busy} onClick={() => void cleanDuplicates()}>تنظيف المكررات من المزامنة</button>
      <p role="status">{message}</p>
      {steps.length ? (
        <ol>
          {steps.map((step, index) => (
            <li key={`${step.step}-${index}`}>{step.ok ? 'تم' : 'فشل'} — {step.step}: {step.detail}</li>
          ))}
        </ol>
      ) : null}
      <section data-sheet-test-purge-panel className="space-y-3" style={{border: '1px solid #3F1A44', padding: '12px 14px'}}>
        <h3 style={{color: '#3F1A44'}}>حذف عملاء التجربة</h3>
        <p>
          يحذف فقط العملاء الذين أنشأتهم مزامنة الجدول قبل أقدم تاريخ بين الأرقام الحقيقية أدناه.
          يبقى هؤلاء الثلاثة، وكل عميل تاريخه في نفس اللحظة أو بعدها، وكل عميل أُدخل يدوياً أو من إكسل أو نموذج الموقع أو تيليجرام.
          صفوف الجدول المرتبطة بالمحذوف تُعلَّم purged حتى لا تُستورد الاختبارات مرة أخرى. لا يُرسل بريد، ولا يعمل الحذف تلقائياً.
        </p>
        <div className="fields">
          {['الجوال الأول', 'الجوال الثاني', 'الجوال الثالث'].map((label, index) => (
            <label key={label}>{label}
              <input
                dir="ltr"
                value={keepPhones[index] || ''}
                onChange={event => editKeepPhone(index, event.target.value)}
                inputMode="tel"
                maxLength={40}
                placeholder="05XXXXXXXX"
              />
            </label>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={() => void previewTestPurge()}>معاينة حذف عملاء التجربة</button>
        {purgeMessage ? <p role="status">{purgeMessage}</p> : null}
        {purgePreview && !purgePreview.aborted ? (
          <div data-sheet-test-purge role="status">
            <p>
              سيُحذف <strong>{purgePreview.count}</strong> عميل من مزامنة الجدول
              {purgePreview.cutoff ? ` أقدم من ${riyadh(purgePreview.cutoff)}` : ''}.
            </p>
            <h4>ما سيُحذف</h4>
            {purgePreview.delete.length ? (
              <ul data-sheet-test-delete style={{maxHeight: 280, overflow: 'auto'}}>
                {purgePreview.delete.map(lead => (
                  <li key={lead.id}>{lead.name || 'بدون اسم'} — {lead.phone} — {riyadh(lead.createdAt)}</li>
                ))}
              </ul>
            ) : <p>لا يوجد عملاء تجربة أقدم من الحد.</p>}
            <h4>العملاء الحقيقيون المحتفظ بهم</h4>
            <ul data-sheet-test-kept>
              {purgePreview.kept.map(lead => (
                <li key={lead.id}>{lead.name || 'بدون اسم'} — {lead.phone} — {riyadh(lead.createdAt)}</li>
              ))}
            </ul>
            <button type="button" className="primary" style={{background: '#3F1A44', borderColor: '#3F1A44'}} disabled={busy} onClick={() => void confirmTestPurge()}>تأكيد الحذف</button>
          </div>
        ) : null}
      </section>
      {status?.sources?.length ? (
        <div className="space-y-3">
          {status.sources.map(source => (
            <article key={source.id} style={{border: '1px solid #d1d5db', padding: '12px 14px'}}>
              <strong>{source.label || DEFAULT_SHEET_LABEL}</strong>
              {source.campaign ? ` — ${source.campaign}` : ''}
              <p>المعرف: {source.sheetId}{source.gid ? ` — الورقة ${source.gid}` : ' — الورقة الأولى'}</p>
              <p>الحالة: {source.enabled ? 'مفعّل' : 'متوقف'}</p>
              <p>آخر مزامنة: {riyadh(source.lastRunAt || source.lastRun)} — {summarize(source)}</p>
              {source.errorMessage ? <p role="alert">{source.errorMessage}</p> : null}
              {source.lastResult?.errors?.length ? <p>{source.lastResult.errors.slice(0, 3).join('؛ ')}</p> : null}
              <p>
                <button type="button" disabled={busy} onClick={() => fill(source)}>تعديل الربط</button>{' '}
                <button type="button" disabled={busy} onClick={() => void remove(source.id)}>حذف</button>{' '}
                <a href={`https://docs.google.com/spreadsheets/d/${source.sheetId}/edit${source.gid ? `#gid=${source.gid}` : ''}`} target="_blank" rel="noreferrer">فتح الجدول</a>
              </p>
            </article>
          ))}
        </div>
      ) : <p>لا توجد مصادر بعد. أضف رابط الجدول أدناه، أو اضغط «مزامنة الآن» ليُضاف جدول تيك توك ثم يُسحب.</p>}
      <form className="fields" onSubmit={event => void save(event)}>
        <h3>{editing ? 'تعديل مصدر' : 'إضافة مصدر'}</h3>
        <label>رابط الجدول أو معرفه<input required value={sheetUrl} onChange={event => setSheetUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…/edit" maxLength={500}/></label>
        <label>الورقة
          <select
            value={tabs.some(tab => tab.gid === gid) ? gid : ''}
            onChange={event => {
              const next = event.target.value;
              setGid(next);
              setHeaders([]);
              setHeadersGid('');
              if (sheetUrl.trim() && next) void readHeaders(next);
            }}
          >
            <option value="">{gid && !tabs.some(tab => tab.gid === gid) ? `gid ${gid}` : 'اختر الورقة بعد قراءة العناوين، أو اكتب رقمها'}</option>
            {tabs.map(tab => <option key={tab.gid} value={tab.gid}>{tab.name} — {tab.gid}</option>)}
          </select>
        </label>
        <label>رقم الورقة gid<input value={gid} onChange={event => setGid(event.target.value.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" placeholder={TIKTOK_SHEET_GID}/></label>
        <label>تسمية المصدر<input required value={label} onChange={event => setLabel(event.target.value)} maxLength={40}/></label>
        <label>اسم الحملة (اختياري)<input value={campaign} onChange={event => setCampaign(event.target.value)} maxLength={60} placeholder="يُترك فارغاً ليبقى المصدر «تيك توك»"/></label>
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
        <p>الاسم والجوال مطلوبان. صف بلا اسم وبلا جوال يُتخطى. إن وُجد TikTok Lead ID فهو مفتاح الصف ولا يُعاد استيراده. أعمدة الحالة والإسناد تُنسخ في الملاحظات فقط؛ العميل الجديد يبقى «عميل جديد» وغير معيّن. اسم الحملة يُضاف إلى المصدر فقط إذا كُتب هنا.</p>
        <button className="primary" disabled={busy || !headers.length}>حفظ المصدر</button>
        {editing ? <button type="button" disabled={busy} onClick={resetForm}>مصدر جديد</button> : null}
      </form>
    </section>
  );
}
