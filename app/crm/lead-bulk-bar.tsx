'use client';

import {useEffect, useState} from 'react';

import {canBulkDelete, canBulkSelect} from '@/lib/bulk-lead-access';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type SalesEmployee = {
  id: string;
  name: string;
  role: string;
  active: number;
};

type LeadBulkBarProps = {
  role: string;
  ids: string[];
  onClear: () => void;
  onDone: (message: string) => void;
};

export default function LeadBulkBar({role, ids, onClear, onDone}: LeadBulkBarProps) {
  const [employees, setEmployees] = useState<SalesEmployee[]>([]);
  const [usersError, setUsersError] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const allowed = canBulkSelect(role);
  const count = ids.length;
  const picking = allowed && count > 0;

  useEffect(() => {
    if (!picking) return;
    let cancelled = false;
    async function load() {
      setLoadingUsers(true);
      setUsersError('');
      try {
        const response = await fetch('/api/crm-users?assignable=1', {cache: 'no-store'});
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'تعذر تحميل الموظفين');
        if (!cancelled) {
          setEmployees(
            (Array.isArray(result) ? result : []).filter(
              (user: SalesEmployee) => user.role === 'sales' && Number(user.active) === 1
            )
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setUsersError(loadError instanceof Error ? loadError.message : 'تعذر تحميل الموظفين');
        }
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [picking]);

  if (!allowed || count < 1) return null;

  const employee = employees.find(user => user.id === employeeId);
  const employeeName = employee?.name || 'مندوب المبيعات';

  async function assign() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/leads/bulk-assign', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ids, assignedTo: employeeId}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر الإسناد');
      setAssignOpen(false);
      setEmployeeId('');
      onDone(String(result.message || `تم إسناد ${result.assigned ?? count} عميل`));
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'تعذر الإسناد');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/leads/bulk-delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ids}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر الحذف');
      setDeleteOpen(false);
      onDone(String(result.message || `تم حذف ${count} عميل`));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'تعذر الحذف');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="crm-bulk-bar" role="region" aria-label="إجراءات العملاء المحددين">
        <strong>تم تحديد {count}</strong>
        <label className="crm-bulk-assign">
          <span>إسناد لموظف</span>
          <select
            aria-label="إسناد لموظف"
            value={employeeId}
            disabled={busy || loadingUsers}
            onChange={event => {
              setEmployeeId(event.target.value);
              setError('');
            }}
          >
            <option value="">{loadingUsers ? 'جارٍ تحميل الموظفين…' : 'اختر مندوب المبيعات'}</option>
            {employees.map(user => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary"
          disabled={busy || !employeeId}
          onClick={() => setAssignOpen(true)}
        >
          إسناد لموظف
        </button>
        {canBulkDelete(role) ? (
          <button type="button" className="danger" disabled={busy} onClick={() => setDeleteOpen(true)}>
            حذف المحددين
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={onClear}>
          إلغاء التحديد
        </button>
        {usersError ? <p role="alert">{usersError}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>

      <Dialog open={assignOpen} onOpenChange={open => { if (!busy) setAssignOpen(open); }}>
        <DialogContent dir="rtl" className="text-black">
          <DialogHeader>
            <DialogTitle>إسناد لموظف</DialogTitle>
            <DialogDescription className="text-black">
              إسناد {count} عميل إلى {employeeName}؟
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button type="button" className="primary" disabled={busy || !employeeId} onClick={() => void assign()}>
              {busy ? 'جارٍ الإسناد…' : 'تأكيد الإسناد'}
            </button>
            <button type="button" disabled={busy} onClick={() => setAssignOpen(false)}>إلغاء</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canBulkDelete(role) ? (
        <Dialog open={deleteOpen} onOpenChange={open => { if (!busy) setDeleteOpen(open); }}>
          <DialogContent dir="rtl" className="text-black">
            <DialogHeader>
              <DialogTitle>حذف المحددين</DialogTitle>
              <DialogDescription className="text-black">
                حذف {count} عميل نهائياً؟ لا يمكن التراجع عن هذا الحذف.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>
                {busy ? 'جارٍ الحذف…' : 'حذف المحددين'}
              </button>
              <button type="button" disabled={busy} onClick={() => setDeleteOpen(false)}>إلغاء</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
