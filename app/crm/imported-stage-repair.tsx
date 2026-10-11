'use client';

import {useState} from 'react';

type Sample = {
  id: string;
  name: string;
  phone: string;
  text: string;
  label: string;
};

type RepairPreview = {
  count: number;
  sample: Sample[];
  skipped?: boolean;
  reason?: string;
  updated?: number;
  message?: string;
};

export default function ImportedStageRepair({onDone}: {onDone: () => void}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<RepairPreview | null>(null);

  async function run(confirm: boolean) {
    if (confirm) {
      const count = Number(preview?.count ?? 0);
      if (!window.confirm(`سيُصحَّح مرحلة ${count} عميل ما زالوا «عميل جديد». لن يُمس عميل تغيّرت مرحلته. هل تريد المتابعة؟`)) return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/leads/import/repair-stages', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({confirm}),
      });
      const data = (await response.json()) as RepairPreview & {error?: string};
      if (!response.ok) throw Error(data.error || 'تعذر التصحيح');
      if (data.skipped) {
        setMessage(String(data.reason || data.message || 'المزامنة تعمل بالفعل'));
        return;
      }
      if (!confirm) {
        setPreview(data);
        setMessage(data.count ? '' : 'لا يوجد عملاء في مرحلة «عميل جديد» يطابق وصفهم أو ملاحظاتهم مرحلة معروفة.');
        return;
      }
      setPreview(null);
      setMessage(`تم تصحيح مرحلة ${Number(data.updated ?? 0)} عميل`);
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر التصحيح');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-imported-stage-repair className="space-y-3" style={{border: '1px solid #3F1A44', padding: '12px 14px'}}>
      <h3 style={{color: '#3F1A44'}}>تصحيح مراحل العملاء المستوردين</h3>
      <p>
        يبحث عن العملاء الذين ما زالوا في مرحلة «عميل جديد» إذا كان وصف العقار، أو نص الحالة في الملاحظات، مطابقاً لمرحلة مثل «غير مهتم».
        يبقى النص في وصف العقار. لا يغيّر عميلاً نُقلت مرحلته بعد الاستيراد.
      </p>
      <button type="button" disabled={busy} onClick={() => void run(false)}>تصحيح مراحل العملاء المستوردين</button>
      {message ? <p role="status">{message}</p> : null}
      {preview && preview.count > 0 ? (
        <div data-imported-stage-preview role="status">
          <p>سيُصحَّح <strong>{preview.count}</strong> عميل.</p>
          <ul style={{maxHeight: 280, overflow: 'auto'}}>
            {preview.sample.map(row => (
              <li key={row.id}>{row.name || 'بدون اسم'} — {row.phone} — {row.text} — {row.label}</li>
            ))}
          </ul>
          {preview.count > preview.sample.length ? <p>عينة من {preview.sample.length} من أصل {preview.count}.</p> : null}
          <button type="button" className="primary" style={{background: '#3F1A44', borderColor: '#3F1A44'}} disabled={busy} onClick={() => void run(true)}>تأكيد التصحيح</button>
        </div>
      ) : null}
    </section>
  );
}
