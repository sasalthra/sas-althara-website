'use client';

import {useEffect, useState} from 'react';

type SyncRow = {
  id: string;
  action: string;
  note: string | null;
  propertyId: string | null;
  title: string | null;
  createdAt: string | null;
  chatId: string | null;
  messageId: string | null;
};

type MergeFragment = {id: string; title: string};
type MergePreview = {
  targetId: string;
  title: string;
  messageCount: number;
  photoCount: number;
  fragments: MergeFragment[];
};

type SeenChat = {
  chatId: string;
  title: string | null;
  chatType: string | null;
  lastMessageId: string | null;
  lastSeenAt: string | null;
};

type Status = {
  tokenConfigured: boolean;
  secretConfigured: boolean;
  channelId: string | null;
  siteUrl: string | null;
  webhookPath: string;
  bot: {id: number | null; username: string} | null;
  botError: string | null;
  webhook: {url: string; pendingUpdateCount: number; lastErrorMessage: string | null; lastErrorDate: number | null; allowedUpdates: string[]} | null;
  webhookError: string | null;
  recent: SyncRow[];
  seenChats: SeenChat[];
  lastChat: SeenChat | null;
  dbError: string | null;
  schemaIssues?: {area: string; statement: string; detail: string}[];
};

const fieldClass = 'w-full rounded-lg border border-[#d1d5db] bg-white px-3 py-2 text-black';

function offerRows(rows: SyncRow[]) {
  const seen = new Set<string>();
  const posts: SyncRow[] = [];
  for (const row of rows) {
    if (row.action !== 'created' && row.action !== 'updated' && row.action !== 'import') continue;
    const key = row.propertyId || row.id;
    if (row.propertyId && seen.has(key)) continue;
    if (row.propertyId) seen.add(key);
    posts.push(row);
  }
  return posts;
}

function isProblemRow(row: SyncRow) {
  if (row.action === 'separator' || row.note === 'فاصل بين العروض') return false;
  if (row.action === 'import') return false;
  if (row.action === 'created' || row.action === 'updated') return Boolean(row.note && row.note.includes('تعذر'));
  return row.action === 'error' || row.action === 'skipped' || Boolean(row.note);
}

function flag(ok: boolean) {
  return ok ? 'مضبوط' : 'غير مضبوط';
}

function when(value: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('ar-SA');
}

export default function TelegramPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState('');
  const [preview, setPreview] = useState<MergePreview[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch('/api/telegram/status', {cache: 'no-store'});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'تعذر قراءة الحالة');
    setStatus(body as Status);
  }

  useEffect(() => {
    refresh().catch(error => setMessage(error instanceof Error ? error.message : 'تعذر قراءة الحالة'));
  }, []);

  async function register() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/telegram/register', {method: 'POST'});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'تعذر تسجيل الويب هوك');
      setMessage(`تم تسجيل الويب هوك على ${body.url}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تسجيل الويب هوك');
    } finally {
      setBusy(false);
    }
  }

  async function regroup(apply: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/telegram/regroup', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({apply}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'تعذر إعادة تجميع العروض');
      const plans = Array.isArray(body.plans) ? body.plans as MergePreview[] : [];
      setPreview(plans);
      if (apply) {
        setMessage(plans.length ? `تم تجميع ${body.applied ?? plans.length} عرض. الروابط القديمة تفتح على الإعلان المدمج.` : 'لا توجد عروض بحاجة إلى تجميع.');
        setPreview(plans.length ? plans : []);
        await refresh();
      } else if (!plans.length) {
        setMessage('لا توجد عروض مكررة بين الفواصل. كل إعلان منشور هو عرض واحد.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر إعادة تجميع العروض');
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setMessage('');
    setSummary('');
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/telegram/import', {method: 'POST', body: form});
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'تعذر الاستيراد');
      const errors = Array.isArray(body.errors) && body.errors.length ? ` أخطاء: ${body.errors.join(' — ')}` : '';
      setSummary(`تم الاستيراد: ${body.created} جديد، ${body.updated} محدّث، ${body.skipped} متجاوز.${errors}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر الاستيراد');
    } finally {
      setBusy(false);
    }
  }

  const posts = offerRows(status?.recent ?? []);
  const errors = (status?.recent ?? []).filter(isProblemRow);

  return (
    <section dir="rtl" className="panel space-y-4 text-black">
      <h2 className="text-black">مزامنة التليجرام</h2>
      <p className="text-black">
        عروض القناة أو الجروب تُنشر مباشرة على الموقع، وليست مسودات. أنشئ بوتًا عند @BotFather بالأمر /newbot.
        للقناة أضف البوت مشرفًا حتى تصل المنشورات. للجروب أوقف وضع الخصوصية من @BotFather بالأمر /setprivacy ثم Disable، أو اجعل البوت مشرفًا، وإلا لن تصله رسائل الأعضاء.
        في متغيرات Hostinger ضع TELEGRAM_BOT_TOKEN وTELEGRAM_WEBHOOK_SECRET (8 أحرف على الأقل من الإنجليزية والأرقام و _ و -)،
        واختياريًا TELEGRAM_CHANNEL_ID لمعرّف قناة أو جروب واحد مثل -100xxxxxxxxxx. تأكد أن NEXTAUTH_URL هو https://sasalthra.sa ثم اضغط تسجيل الويب هوك.
        بعد هذا التحديث سجّل الويب هوك مرة أخرى ليستقبل رسائل الجروب.
        الملصق (ستكر) بين العروض يغلق العرض الحالي، والنص والصور بين ملصقين تصبح إعلانًا واحدًا.
        بعد النشر اضغط إعادة تجميع العروض لترى الإعلانات التي ستُدمج، ثم طبّق التجميع. الروابط القديمة تفتح على الإعلان المدمج.
      </p>
      <p className="text-black">
        لاستيراد السجل: من Telegram Desktop افتح القناة أو الجروب، ثم النقاط الثلاث، ثم Export chat history، واختر JSON مع الصور.
        التصدير يقبل قناة أو جروب من نوع private_supergroup أو public_supergroup.
        ارفع result.json أو أرشيفًا مضغوطًا يضم result.json ومجلد photos. حد الرفع على Hostinger غالبًا حوالي 128 ميجابايت عبر الوسيط
        (وقد يختلف حتى 256 ميجابايت حسب الخطة). إن كان الأرشيف أكبر، ارفع JSON وحده أو قسّم الصور. القراءة تتم على دفعات من القرص.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-lg bg-[#3F1A44] px-4 py-2 text-white" disabled={busy} onClick={() => void refresh().catch(error => setMessage(error instanceof Error ? error.message : 'تعذر قراءة الحالة'))}>
          تحديث الحالة
        </button>
        <button type="button" className="rounded-lg border border-[#d1d5db] bg-[#3F1A44] px-4 py-2 text-white" disabled={busy} onClick={() => void register()}>
          تسجيل الويب هوك
        </button>
        <button type="button" className="rounded-lg bg-[#3F1A44] px-4 py-2 text-white" disabled={busy} onClick={() => void regroup(false)}>
          إعادة تجميع العروض
        </button>
      </div>
      <p role="status" className="text-black">{message}</p>
      {status ? (
        <div className="space-y-2 rounded-lg border border-[#d1d5db] bg-white p-3 text-black">
          <p>رمز البوت: {flag(status.tokenConfigured)}{status.bot?.username ? ` — @${status.bot.username}` : ''}</p>
          <p>سر الويب هوك: {flag(status.secretConfigured)}</p>
          <p>القناة أو الجروب المقبول: {status.channelId || 'كل القنوات والجروبات التي يراها البوت'}</p>
          <p>رابط الموقع: {status.siteUrl || 'غير معروف — ضع NEXTAUTH_URL'}</p>
          <p>مسار الاستقبال: {status.webhookPath}</p>
          {status.botError ? <p>تعذر البوت: {status.botError}</p> : null}
          {status.webhook ? (
            <p>
              الويب هوك المسجل: {status.webhook.url || 'غير مسجل'} — انتظار: {status.webhook.pendingUpdateCount}
              {status.webhook.lastErrorMessage ? ` — آخر خطأ: ${status.webhook.lastErrorMessage}` : ''}
            </p>
          ) : null}
          {status.webhook?.allowedUpdates?.length ? <p>أنواع التحديثات: {status.webhook.allowedUpdates.join('، ')}</p> : null}
          {status.webhookError ? <p>تعذر الويب هوك: {status.webhookError}</p> : null}
          {status.schemaIssues?.length ? (
            <div>
              <p>تحذيرات تهيئة الجداول (الصفحة تبقى تعمل):</p>
              <ul className="list-disc pe-5">
                {status.schemaIssues.slice(0, 8).map((issue, index) => (
                  <li key={`${issue.area}-${index}`}>{issue.area}: {issue.detail}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {status.dbError ? <p>{status.dbError}</p> : (
            <>
              <p>آخر تحديث وصل من: {status.lastChat ? `${status.lastChat.title || 'بدون عنوان'} — ${status.lastChat.chatId}${status.lastChat.chatType ? ` (${status.lastChat.chatType})` : ''}` : 'لم يصل أي تحديث بعد'}</p>
              <div>
                <p>المحادثات التي رآها البوت:</p>
                <ul className="list-disc pe-5">
                  {status.seenChats?.length ? status.seenChats.map(chat => (
                    <li key={chat.chatId}>{chat.title || 'بدون عنوان'} — {chat.chatId}{chat.chatType ? ` — ${chat.chatType}` : ''}</li>
                  )) : <li>لا توجد محادثات بعد</li>}
                </ul>
              </div>
            </>
          )}
        </div>
      ) : null}
      <form className="space-y-2" onSubmit={event => event.preventDefault()}>
        <label className="block text-black">
          ملف السجل (JSON أو ZIP)
          <input
            className={fieldClass}
            type="file"
            accept=".json,.zip,application/json,application/zip"
            disabled={busy}
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
      </form>
      {summary ? <p className="text-black">{summary}</p> : null}
      {preview ? (
        <div className="space-y-2 rounded-lg border border-[#d1d5db] bg-white p-3 text-black">
          <h3>معاينة التجميع</h3>
          {preview.length ? preview.map(plan => (
            <div key={plan.targetId}>
              <p>{plan.title} — {plan.messageCount} رسائل، {plan.photoCount} صور</p>
              <ul className="list-disc pe-5">
                {plan.fragments.map(fragment => (
                  <li key={fragment.id}>{fragment.title || fragment.id} — {fragment.id}</li>
                ))}
              </ul>
            </div>
          )) : <p>لا توجد إعلانات ستُدمج.</p>}
          {preview.length ? (
            <button type="button" className="rounded-lg bg-[#3F1A44] px-4 py-2 text-white" disabled={busy} onClick={() => void regroup(true)}>
              تطبيق التجميع
            </button>
          ) : null}
        </div>
      ) : null}
      <div>
        <h3 className="mb-2 text-black">آخر العروض المتزامنة</h3>
        <div className="overflow-x-auto rounded-lg border border-[#d1d5db]">
          <table className="w-full border-collapse text-black">
            <thead>
              <tr className="border-b border-[#d1d5db]">
                <th className="p-2 text-start">العرض</th>
                <th className="p-2 text-start">الرسائل والصور</th>
                <th className="p-2 text-start">الحالة</th>
                <th className="p-2 text-start">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {posts.length ? posts.map(row => (
                <tr key={row.id} className="border-b border-[#d1d5db]">
                  <td className="p-2">
                    {row.propertyId ? <a className="underline" href={`/properties/${row.propertyId}`}>{row.title || row.propertyId}</a> : (row.note || 'استيراد')}
                  </td>
                  <td className="p-2">{row.note && row.note.startsWith('مدمج:') ? row.note.replace(/^مدمج:\s*/, '') : '—'}</td>
                  <td className="p-2">{row.action === 'created' ? 'منشور جديد' : row.action === 'updated' ? 'تحديث' : 'استيراد'}</td>
                  <td className="p-2">{when(row.createdAt)}</td>
                </tr>
              )) : (
                <tr><td className="p-2" colSpan={4}>لا توجد عروض متزامنة بعد</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-black">الأخطاء والرسائل المتجاوزة</h3>
        <ul className="space-y-1 rounded-lg border border-[#d1d5db] bg-white p-3 text-black">
          {errors.length ? errors.map(row => (
            <li key={row.id}>{when(row.createdAt)} — {row.note || row.action}{row.propertyId ? ` — ${row.propertyId}` : ''}</li>
          )) : <li>لا توجد أخطاء مسجلة</li>}
        </ul>
      </div>
    </section>
  );
}
