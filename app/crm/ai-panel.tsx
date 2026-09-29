'use client';

import {FormEvent, useEffect, useRef, useState} from 'react';
import {AlertCircle, BadgeCheck, Building2, Wallet} from 'lucide-react';
import {OVERDUE_RULE, SUGGESTED_QUESTIONS} from '@/lib/admin-assistant';
import {envStatusLine} from '@/lib/ai-public';

type ChatMessage = {role: 'user' | 'assistant'; text: string};
type Spend = {available: boolean; total: number};
type Kpis = {overdue: number; conversions: number; properties: number; campaignSpend: Spend};
type AlertItem = {
  id: string;
  name: string;
  phone: string;
  stageLabel: string;
  salesName: string;
  days: number;
  line: string;
};

const HISTORY_KEY = 'sas-admin-assistant-chat';

function readHistory(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ChatMessage => item && (item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string')
      .slice(-40);
  } catch {
    return [];
  }
}

function spendText(spend: Spend | undefined) {
  if (!spend) return '0';
  if (!spend.available) return '0';
  return new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}).format(spend.total);
}

function spendHint(spend: Spend | undefined) {
  if (!spend || !spend.available) return 'لا يوجد حقل مصروف حملات في البيانات الحالية';
  if (!spend.total) return 'مجموع مصروف الحملات المسجّل هو صفر';
  return 'مجموع مصروف الحملات المسجّل في النظام';
}

export default function AiPanel({admin, envModel = null}: {admin: boolean; envModel?: string | null}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [rule, setRule] = useState(OVERDUE_RULE);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState('');
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [settingsStatus, setSettingsStatus] = useState(envModel ? envStatusLine(envModel) : 'لم تُفحص الإعدادات بعد');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [envLocked, setEnvLocked] = useState(Boolean(envModel));
  const [shownModel, setShownModel] = useState(envModel ?? '');
  const [historyReady, setHistoryReady] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(readHistory());
    setHistoryReady(true);
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      // Session storage can be blocked. The visible thread still stays in memory.
    }
  }, [messages, historyReady]);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch('/api/ai/assistant');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل المؤشرات');
        if (cancelled) return;
        setKpis(data.kpis);
        setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
        setAlertsTotal(Number(data.alertsTotal) || 0);
        if (typeof data.overdueRule === 'string') setRule(data.overdueRule);
        setConfigured(Boolean(data.configured));
        if (data.providerSource === 'env' && typeof data.model === 'string') {
          setEnvLocked(true);
          setShownModel(data.model);
          setSettingsStatus(envStatusLine(data.model));
        }
        setLoadError('');
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'تعذر تحميل المؤشرات');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadSettings() {
    try {
      const response = await fetch('/api/ai/settings');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر قراءة الإعدادات');
      if (data.source === 'env' && typeof data.model === 'string') {
        setEnvLocked(true);
        setShownModel(data.model);
        setSettingsStatus(envStatusLine(data.model));
        setSettingsMessage('');
        return;
      }
      if (data.configured) {
        setProvider(data.provider);
        setModel(data.model);
        setSettingsStatus(`المزود: ${data.provider} — الطراز: ${data.model} — آخر تحديث: ${data.updatedAt}`);
      } else {
        setSettingsStatus('لم يُحفظ مفتاح بعد');
      }
      setSettingsMessage('');
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'تعذر قراءة الإعدادات');
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSettingsMessage('');
    try {
      const response = await fetch('/api/ai/settings', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({provider, model, apiKey}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر حفظ الإعدادات');
      setApiKey('');
      setConfigured(true);
      setSettingsMessage('حُفظ المفتاح مشفراً على الخادم. لا يُختبر المزود إلا عند إرسال سؤال.');
      await loadSettings();
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : 'تعذر حفظ الإعدادات');
    } finally {
      setSaving(false);
    }
  }

  async function ask(raw: string) {
    const text = raw.trim();
    if (text.length < 2 || busy) return;
    setQuestion('');
    setBusy(true);
    setNotice('');
    setMessages(current => [...current, {role: 'user', text}]);
    try {
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({question: text}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ السؤال');
      const answer = typeof data.answer === 'string' ? data.answer : '';
      setMessages(current => [...current, {role: 'assistant', text: answer}]);
      if (typeof data.notice === 'string' && data.notice) setNotice(data.notice);
      else if (data.source === 'local') setNotice('الإجابة من بيانات النظام مباشرة.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'تعذر تنفيذ السؤال');
    } finally {
      setBusy(false);
    }
  }

  function submitQuestion(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  const cards = [
    {key: 'overdue', label: 'العملاء المتأخرون', value: kpis ? String(kpis.overdue) : '…', hint: 'مرحلة مفتوحة بلا نشاط منذ أكثر من 3 أيام', icon: AlertCircle},
    {key: 'conversions', label: 'إجمالي التحويلات', value: kpis ? String(kpis.conversions) : '…', hint: 'وقع عقد، دفع عربون، أو إفراغ', icon: BadgeCheck},
    {key: 'spend', label: 'مصروف الحملات', value: kpis ? spendText(kpis.campaignSpend) : '…', hint: spendHint(kpis?.campaignSpend), icon: Wallet},
    {key: 'properties', label: 'العقارات', value: kpis ? String(kpis.properties) : '…', hint: 'العقارات المنشورة في النظام', icon: Building2},
  ];

  return (
    <section className="admin-assistant" dir="rtl">
      <header className="assistant-head">
        <div>
          <h2>المساعد الإداري</h2>
          <p>مدير عمليات وتسويق مساعد مبني على بيانات النظام الحالية</p>
        </div>
        {configured === false && <p className="assistant-note">لا يوجد مزود مُعد؛ الإجابات تُبنى من بيانات النظام مباشرة.</p>}
        {configured === true && <p className="assistant-note">المزود مُعد. يُرسل إليه أسماء الموظفين والمجاميع فقط، دون أسماء العملاء أو الجوالات.</p>}
      </header>
      {loadError && <p role="alert">{loadError}</p>}
      <div className="assistant-kpis">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <article key={card.key} className="assistant-kpi" title={card.hint}>
              <span className="assistant-kpi-icon" aria-hidden="true"><Icon size={20} /></span>
              <strong>{card.value}</strong>
              <span>{card.label}</span>
              <small>{card.hint}</small>
            </article>
          );
        })}
      </div>
      <div className="assistant-layout">
        <section className="assistant-chat panel" aria-label="اسأل عن أداء الشركة">
          <h3>اسأل عن أداء الشركة</h3>
          <div className="assistant-log" ref={logRef} aria-live="polite">
            {messages.length === 0 && <p className="assistant-empty">اكتب سؤالاً عن أداء الفريق أو المراحل أو الحملات أو العملاء المتأخرين.</p>}
            {messages.map((message, index) => (
              <p key={`${message.role}-${index}`} className={`assistant-bubble ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}>
                {message.text}
              </p>
            ))}
            {busy && <p className="assistant-bubble is-assistant">جارٍ تجهيز الإجابة من بيانات النظام…</p>}
          </div>
          <div className="assistant-chips">
            {SUGGESTED_QUESTIONS.map(item => (
              <button key={item} type="button" onClick={() => void ask(item)} disabled={busy}>{item}</button>
            ))}
          </div>
          <form className="assistant-composer" onSubmit={submitQuestion}>
            <label className="assistant-question">
              السؤال
              <textarea
                value={question}
                onChange={event => setQuestion(event.target.value)}
                required
                minLength={2}
                maxLength={2000}
                placeholder="مثال: حلل أداء الموظفين"
              />
            </label>
            <button className="primary" type="submit" disabled={busy}>إرسال</button>
          </form>
          {notice && <p role="status">{notice}</p>}
        </section>
        <aside className="assistant-alerts panel" aria-label="تنبيهات تحتاج تدخل">
          <div className="assistant-alerts-head">
            <h3>تنبيهات تحتاج تدخل</h3>
            <span className="assistant-badge">{kpis ? alertsTotal : '…'}</span>
          </div>
          <ul className="assistant-alert-list">
            {alerts.length === 0 && <li className="assistant-empty">لا توجد تنبيهات حالياً.</li>}
            {alerts.map(alert => (
              <li key={alert.id}>
                <a href={`/crm/leads/${encodeURIComponent(alert.id)}`}>
                  <span>{alert.line || `العميل ${alert.name} دون متابعة منذ ${alert.days} أيام`}</span>
                  <small>
                    <bdi>{alert.phone || 'بدون جوال'}</bdi>
                    {' · '}
                    {alert.stageLabel}
                    {' · '}
                    {alert.salesName}
                  </small>
                </a>
              </li>
            ))}
          </ul>
          <p className="assistant-footnote">{rule}{alertsTotal > alerts.length ? ` يُعرض أقدم ${alerts.length} تنبيهاً.` : ''}</p>
        </aside>
      </div>
      {admin && envLocked && <p className="assistant-note" role="status">{envStatusLine(shownModel || 'gpt-4o-mini')}</p>}
      {admin && !envLocked && (
        <details className="assistant-settings panel" onToggle={event => { if (event.currentTarget.open) void loadSettings(); }}>
          <summary>إعدادات المزود</summary>
          <p role="status">{settingsStatus}</p>
          {settingsMessage && <p role="alert">{settingsMessage}</p>}
          <form className="fields" onSubmit={saveSettings}>
            <label>
              المزود
              <select value={provider} onChange={event => setProvider(event.target.value)}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </label>
            <label>
              معرف طراز مفعل لدى المزود
              <input required value={model} onChange={event => setModel(event.target.value)} maxLength={100} />
            </label>
            <label>
              مفتاح جديد للمزود
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={512}
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
              />
            </label>
            <p>يلزم APP_ENCRYPTION_KEY على الخادم. لا يمكن استرجاع المفتاح من الواجهة؛ إدخال مفتاح جديد يستبدل القديم.</p>
            <button className="primary" disabled={saving}>حفظ الإعدادات والمفتاح</button>
          </form>
        </details>
      )}
    </section>
  );
}
