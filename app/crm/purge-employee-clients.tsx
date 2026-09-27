'use client';

import {useEffect, useState} from 'react';

import {
  confirmationMatches,
  PURGE_CONFIRMATION_WORD,
} from '@/lib/employee-client-purge';

type EmployeeOption = {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'supervisor' | 'sales' | 'field';
  active: number;
};

type Preview = {
  employee: {id: string; name: string};
  scope: 'assigned_to';
  salesAssigned: number;
  fieldOnly: number;
  fieldAssigned: number;
};

type PurgeResult = {
  deleted: number;
  activity: number;
  transactions: number;
  importRows: number;
  employeeName: string;
};

const roleLabels: Record<EmployeeOption['role'], string> = {
  admin: 'مدير',
  supervisor: 'مشرف',
  sales: 'مبيعات',
  field: 'ميداني',
};

export default function PurgeEmployeeClients({
  users,
  usersLoading,
}: {
  users: EmployeeOption[];
  usersLoading: boolean;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PurgeResult | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setConfirmation('');
    setResult(null);
    setError('');
  }, [employeeId]);

  useEffect(() => {
    if (window.location.hash !== '#purge-employee-clients') return;
    document.getElementById('purge-employee-clients')?.scrollIntoView({block: 'start'});
  }, []);

  useEffect(() => {
    if (!employeeId) {
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    setPreview(null);
    setPreviewLoading(true);
    setPreviewError('');
    fetch(`/api/crm-users/clients?userId=${encodeURIComponent(employeeId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر حساب العملاء');
        setPreview(data);
      })
      .catch(reason => {
        if (controller.signal.aborted) return;
        setPreview(null);
        setPreviewError(reason instanceof Error ? reason.message : 'تعذر حساب العملاء');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [employeeId, reload]);

  const ready = Boolean(preview && preview.employee.id === employeeId && !previewLoading);
  const salesAssigned = ready ? Number(preview?.salesAssigned ?? 0) : 0;
  const employeeName = ready ? String(preview?.employee.name ?? '') : '';
  const canConfirm = ready && salesAssigned > 0 && confirmationMatches(employeeName, confirmation);

  async function purge(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfirm || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/crm-users/clients', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({userId: employeeId, confirmation: confirmation.trim()}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر حذف العملاء');
      setResult(data);
      setConfirmation('');
      setReload(value => value + 1);
      window.dispatchEvent(new Event('crm:leads-changed'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر حذف العملاء');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="purge-employee-clients" className="panel purge-panel" dir="rtl">
      <h2 className="mb-2 text-xl font-bold">حذف عملاء موظف</h2>
      <p>
        يحذف نهائياً كل العملاء المعيّنين لهذا الموظف كمندوب مبيعات
        (الحقل assigned_to)، ومعهم سجل النشاط والملاحظات والمعاملات المالية
        وصفوف الاستيراد المرتبطة بهؤلاء العملاء فقط.
        لا يُحذف حساب الموظف.
        لا يُحذف عميل يكون هذا الموظف مندوبه الميداني فقط
        (الحقل field_assigned_to)، ولا عميل أنشأه أو يملكه دون تعيين مبيعات.
      </p>
      <p>هذا الحذف نهائي ولا يمكن التراجع عنه.</p>

      <form onSubmit={purge} className="mt-4 grid gap-4">
        <label>
          الموظف
          <select
            aria-label="الموظف المراد حذف عملائه"
            value={employeeId}
            disabled={usersLoading || busy}
            onChange={event => setEmployeeId(event.target.value)}
          >
            <option value="">
              {usersLoading ? 'جاري تحميل الموظفين...' : 'اختر موظفاً'}
            </option>
            {users.map(user => (
              <option key={user.id} value={user.id}>
                {user.name} — {roleLabels[user.role]} — {user.username}
                {user.active ? '' : ' — موقوف'}
              </option>
            ))}
          </select>
        </label>

        {previewLoading ? <p>جاري حساب العملاء المعيّنين...</p> : null}
        {previewError ? <p role="alert" className="error">{previewError}</p> : null}

        {ready ? (
          <div className="purge-count" role="status" data-purge-scope="assigned_to">
            <p>
              سيُحذف <strong>{salesAssigned}</strong> عميل لأن الموظف هو مندوب
              المبيعات المعيّن (assigned_to).
            </p>
            <p>
              لن يُحذف <strong>{Number(preview?.fieldOnly ?? 0)}</strong> عميل
              حيث الموظف مندوب ميداني فقط (field_assigned_to).
            </p>
            {Number(preview?.fieldAssigned ?? 0) > Number(preview?.fieldOnly ?? 0) ? (
              <p>
                يشمل الحذف العملاء المعيّنين في المبيعات والميدان معاً، لأن
                نطاق الحذف هو مندوب المبيعات.
              </p>
            ) : null}
            {salesAssigned === 0 ? (
              <p>لا يوجد عملاء ضمن نطاق مندوب المبيعات. لن يُحذف أي عميل.</p>
            ) : null}
          </div>
        ) : null}

        <label>
          للتأكيد اكتب اسم الموظف
          {employeeName.trim() ? ` «${employeeName.trim()}»` : ''} أو كلمة {PURGE_CONFIRMATION_WORD}
          <input
            aria-label="تأكيد الحذف"
            value={confirmation}
            autoComplete="off"
            maxLength={120}
            disabled={!ready || salesAssigned === 0 || busy}
            onChange={event => setConfirmation(event.target.value)}
          />
        </label>

        {error ? <p role="alert" className="error">{error}</p> : null}
        {result ? (
          <p role="status">
            تم الحذف. عدد العملاء المحذوفين: {result.deleted}. سجلات النشاط: {result.activity}.
            المعاملات: {result.transactions}. صفوف الاستيراد: {result.importRows}.
            حساب الموظف «{result.employeeName}» لم يُحذف.
          </p>
        ) : null}

        <button type="submit" className="danger" disabled={!canConfirm || busy}>
          {busy ? 'جاري حذف العملاء...' : 'حذف عملاء موظف'}
        </button>
      </form>
    </section>
  );
}
