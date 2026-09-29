'use client';

import {FormEvent, useState} from 'react';

type PublicLeadFormProps = {
  source: 'contact' | 'property-inquiry';
  propertyId?: string;
  propertyTitle?: string;
  heading: string;
  intro: string;
  submitLabel: string;
};

export default function PublicLeadForm({
  source,
  propertyId,
  propertyTitle,
  heading,
  intro,
  submitLabel,
}: PublicLeadFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

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
          notes,
          company,
          source,
          propertyId: propertyId || '',
          propertyTitle: propertyTitle || '',
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
    <section className="public-lead">
      <h2>{heading}</h2>
      <p>{intro}</p>
      <form onSubmit={onSubmit}>
        <label>
          الاسم
          <input required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)} autoComplete="name" />
        </label>
        <label>
          رقم الجوال
          <input required value={phone} onChange={event => setPhone(event.target.value)} placeholder="05XXXXXXXX" autoComplete="tel" inputMode="tel" dir="ltr" />
        </label>
        <label>
          ملاحظتك
          <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} maxLength={2000} />
        </label>
        <label className="loan-hp" aria-hidden="true">
          الشركة
          <input tabIndex={-1} autoComplete="off" value={company} onChange={event => setCompany(event.target.value)} />
        </label>
        {error ? <p className="loan-error">{error}</p> : null}
        {done ? <p className="loan-success">تم استلام طلبك. سيتواصل معك فريق ساس الثراء.</p> : null}
        <button type="submit" disabled={busy}>{busy ? 'جارٍ الإرسال...' : submitLabel}</button>
      </form>
    </section>
  );
}
