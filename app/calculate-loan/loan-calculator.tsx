'use client';

import {FormEvent, useMemo, useState} from 'react';

function money(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return `${Math.round(value).toLocaleString('ar-SA')} ر.س`;
}

function calcMonthly(principal: number, annualRate: number, years: number) {
  if (principal <= 0 || years <= 0) return 0;
  const months = years * 12;
  const r = annualRate / 100 / 12;
  if (r <= 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

export default function LoanCalculator() {
  const [propertyPrice, setPropertyPrice] = useState(800000);
  const [downPayment, setDownPayment] = useState(80000);
  const [years, setYears] = useState(25);
  const [annualRate, setAnnualRate] = useState(3.5);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('جدة');
  const [notes, setNotes] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const loanAmount = Math.max(propertyPrice - downPayment, 0);
  const monthly = useMemo(
    () => calcMonthly(loanAmount, annualRate, years),
    [loanAmount, annualRate, years],
  );
  const totalPaid = monthly * years * 12;
  const totalInterest = Math.max(totalPaid - loanAmount, 0);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setDone(false);
    try {
      const res = await fetch('/api/public/leads', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          name,
          phone,
          city,
          notes,
          company,
          propertyPrice,
          downPayment,
          years,
          annualRate,
          monthlyPayment: monthly,
        }),
      });
      const data = (await res.json()) as {ok?: boolean; error?: string};
      if (!res.ok || !data.ok) {
        setError(data.error || 'تعذر إرسال الطلب');
        return;
      }
      setDone(true);
      setName('');
      setPhone('');
      setNotes('');
    } catch {
      setError('تعذر الاتصال بالخادم، حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loan-layout">
      <section className="loan-card">
        <h2>حاسبة التمويل</h2>
        <p className="loan-muted">
          أدخل بيانات العقار لمعرفة القسط الشهري التقريبي، ثم أرسل طلبك لفريق ساس الثراء.
        </p>
        <label>
          سعر العقار (ر.س)
          <input type="number" min={0} step={1000} value={propertyPrice}
            onChange={e => setPropertyPrice(Number(e.target.value) || 0)} />
        </label>
        <label>
          الدفعة الأولى (ر.س)
          <input type="number" min={0} step={1000} value={downPayment}
            onChange={e => setDownPayment(Number(e.target.value) || 0)} />
        </label>
        <label>
          مدة التمويل (سنة)
          <input type="number" min={1} max={35} value={years}
            onChange={e => setYears(Number(e.target.value) || 1)} />
        </label>
        <label>
          نسبة التمويل السنوية التقريبية (%)
          <input type="number" min={0} max={20} step={0.1} value={annualRate}
            onChange={e => setAnnualRate(Number(e.target.value) || 0)} />
        </label>
        <div className="loan-results">
          <div><span>مبلغ التمويل</span><strong>{money(loanAmount)}</strong></div>
          <div><span>القسط الشهري التقريبي</span><strong>{money(monthly)}</strong></div>
          <div><span>إجمالي الفوائد التقريبي</span><strong>{money(totalInterest)}</strong></div>
          <div><span>الإجمالي التقريبي مع الفوائد</span><strong>{money(totalPaid)}</strong></div>
        </div>
        <p className="loan-note">
          الأرقام تقديرية للمساعدة في التخطيط، والتمويل النهائي يعتمد على جهة التمويل واعتماد العميل.
        </p>
      </section>

      <section className="loan-card">
        <h2>أرسل طلبك لفريق المبيعات</h2>
        <p className="loan-muted">
          بعد الإرسال يتواصل معك فريق ساس الثراء، ويُحفظ الطلب مباشرة في نظام العملاء.
        </p>
        <form className="loan-form" onSubmit={onSubmit}>
          <label>
            الاسم الكامل
            <input required value={name} onChange={e => setName(e.target.value)}
              placeholder="الاسم" autoComplete="name" />
          </label>
          <label>
            رقم الجوال
            <input required value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="05XXXXXXXX" autoComplete="tel" inputMode="tel" />
          </label>
          <label>
            المدينة
            <input value={city} onChange={e => setCity(e.target.value)} placeholder="جدة" />
          </label>
          <label>
            ملاحظات (اختياري)
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
              placeholder="مثلاً: نوع العقار، الحي، أو موعد مناسب للتواصل" />
          </label>
          <label className="loan-hp" aria-hidden="true">
            الشركة
            <input tabIndex={-1} autoComplete="off" value={company}
              onChange={e => setCompany(e.target.value)} />
          </label>
          {error ? <p className="loan-error">{error}</p> : null}
          {done ? (
            <p className="loan-success">
              تم استلام طلبك بنجاح. سيتواصل معك فريق ساس الثراء قريباً.
            </p>
          ) : null}
          <button type="submit" disabled={busy}>
            {busy ? 'جارٍ الإرسال...' : 'أرسل طلب التمويل'}
          </button>
        </form>
      </section>
    </div>
  );
}
