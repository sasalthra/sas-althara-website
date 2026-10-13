'use client';

import {useEffect, useState} from 'react';

import {DEFAULT_PROPERTY_CLEANUP_LABELS} from '@/lib/property-cleanup-shared';

type Employee = {
  id: string;
  name: string;
  username: string;
  role: string;
  active: number;
};

type Match = {
  id: string;
  name: string;
  phone: string;
  propertyText: string;
};

type Preview = {
  count: number;
  labels: string[];
  employee: {id: string; name: string};
  leads: Match[];
};

export default function PropertyCleanup({onDone}: {onDone: () => void}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [labelA, setLabelA] = useState<string>(DEFAULT_PROPERTY_CLEANUP_LABELS[0]);
  const [labelB, setLabelB] = useState<string>(DEFAULT_PROPERTY_CLEANUP_LABELS[1]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (window.location.hash !== '#property-cleanup') return;
    document.getElementById('property-cleanup')?.scrollIntoView({block: 'start'});
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/leads/property-cleanup', {cache: 'no-store'})
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error || 'تعذر تحميل الموظفين');
        if (!cancelled) {
          setEmployees(Array.isArray(data.employees) ? data.employees : []);
          setLoadError('');
        }
      })
      .catch(error => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'تعذر تحميل الموظفين');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function labels() {
    return [labelA, labelB].map(label => label.trim()).filter(Boolean);
  }

  function clearPreview() {
    setPreview(null);
  }

  async function runPreview() {
    if (!employeeId) {
      setMessage('اختر الموظف أولاً.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/leads/property-cleanup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({employeeId, labels: labels()}),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذرت المعاينة');
      setPreview({
        count: Number(data.count ?? 0),
        labels: Array.isArray(data.labels) ? data.labels : labels(),
        employee: data.employee,
        leads: Array.isArray(data.leads) ? data.leads : [],
      });
      setMessage(Number(data.count ?? 0) ? '' : 'لا يوجد عملاء مطابقون. لم يُحذف شيء.');
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : 'تعذرت المعاينة');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!preview?.leads.length) return;
    const ids = preview.leads.map(lead => lead.id);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/leads/property-cleanup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          confirm: true,
          employeeId,
          labels: preview.labels,
          ids,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'تعذر الحذف');
      setPreview(null);
      setMessage(String(data.message || `تم حذف ${Number(data.deleted ?? 0)} عميل`));
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر الحذف');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="property-cleanup" data-property-cleanup className="space-y-3" style={{border: '1px solid #3F1A44', padding: '12px 14px', scrollMarginTop: 24}}>
      <h3 style={{color: '#3F1A44'}}>حذف عملاء حسب نص العقار</h3>
      <p>
        للإدارة والإشراف فقط. يعرض العملاء المسندين للموظف إذا كان نص العقار يحتوي إحدى العبارتين، ثم يحذف المعروضين فقط بعد التأكيد.
        «نورة» و«نوره» تُعدّان نفس الاسم. لا يُحذف عميل لمجرد أن مرحلته غير مهتم إذا كان نص العقار لا يحتوي العبارة.
      </p>
      {loadError ? <p role="alert" className="error">{loadError}</p> : null}
      <div className="fields">
        <label>الموظف
          <select
            aria-label="الموظف"
            value={employeeId}
            disabled={busy}
            onChange={event => {
              setEmployeeId(event.target.value);
              clearPreview();
            }}
          >
            <option value="">اختر الموظف</option>
            {employees.map(employee => (
              <option key={employee.id} value={employee.id}>
                {employee.name || employee.username || employee.id}
                {employee.username ? ` (${employee.username})` : ''}
                {employee.active ? '' : ' — غير نشط'}
              </option>
            ))}
          </select>
        </label>
        <label>العبارة الأولى
          <input
            aria-label="العبارة الأولى"
            value={labelA}
            maxLength={80}
            disabled={busy}
            onChange={event => {
              setLabelA(event.target.value);
              clearPreview();
            }}
          />
        </label>
        <label>العبارة الثانية
          <input
            aria-label="العبارة الثانية"
            value={labelB}
            maxLength={80}
            disabled={busy}
            onChange={event => {
              setLabelB(event.target.value);
              clearPreview();
            }}
          />
        </label>
      </div>
      <button type="button" disabled={busy || !employeeId} onClick={() => void runPreview()}>عرض المطابقين</button>
      {message ? <p role="status">{message}</p> : null}
      {preview && preview.count > 0 ? (
        <div data-property-cleanup-preview role="status">
          <p>سيُحذف <strong>{preview.count}</strong> عميل مسند إلى {preview.employee?.name || 'الموظف'}.</p>
          <ul style={{maxHeight: 320, overflow: 'auto'}}>
            {preview.leads.map(lead => (
              <li key={lead.id}>{lead.name || 'بدون اسم'} — {lead.phone || 'بدون جوال'} — {lead.propertyText || 'بدون عقار'}</li>
            ))}
          </ul>
          <button type="button" className="primary" style={{background: '#3F1A44', borderColor: '#3F1A44'}} disabled={busy} onClick={() => void confirmDelete()}>تأكيد الحذف</button>
        </div>
      ) : null}
    </section>
  );
}
