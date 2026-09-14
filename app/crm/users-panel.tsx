'use client';

import {useCallback, useEffect, useState} from 'react';
import {CrmLink} from './navigation';

type CrmUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: 'admin' | 'supervisor' | 'sales' | 'field';
  active: number;
  created_at: string;
};

const roleLabels = {
  admin: 'مدير',
  supervisor: 'مشرف',
  sales: 'مبيعات',
  field: 'ميداني',
};

export default function UsersPanel() {
  const [users, setUsers] = useState<CrmUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    email: '',
    phone: '',
    role: 'sales' as CrmUser['role'],
  });

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/crm-users', {
        cache: 'no-store',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'تعذر تحميل المستخدمين');
      }

      setUsers(data);
      setError('');
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'تعذر تحميل المستخدمين'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller=new AbortController();
    fetch('/api/crm-users',{cache:'no-store',signal:controller.signal})
      .then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.error||'تعذر التحميل');setUsers(result);setError('');})
      .catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'تعذر التحميل');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  }, []);

  async function createUser(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/crm-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'تعذر إنشاء المستخدم');
      }

      setSuccess('تم إنشاء المستخدم بنجاح');

      setForm({
        username: '',
        password: '',
        name: '',
        email: '',
        phone: '',
        role: 'sales',
      });

      await loadUsers();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'تعذر إنشاء المستخدم'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="panel">
        <h2 className="mb-4 text-xl font-bold">
          إضافة مستخدم جديد
        </h2>

        <form
          onSubmit={createUser}
          className="grid gap-4 md:grid-cols-2"
        >
          <div>
            <label className="mb-1 block text-sm font-medium">
              الاسم
            </label>
            <input
              required
              value={form.name}
              onChange={e =>
                setForm({
                  ...form,
                  name: e.target.value,
                })
              }
              className="w-full rounded-lg border px-3 py-2"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              اسم المستخدم
            </label>
            <input
              required
              value={form.username}
              onChange={e =>
                setForm({
                  ...form,
                  username: e.target.value,
                })
              }
              className="w-full rounded-lg border px-3 py-2"
              dir="ltr"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              كلمة المرور
            </label>
            <input
              required
              minLength={8}
              type="password"
              value={form.password}
              onChange={e =>
                setForm({
                  ...form,
                  password: e.target.value,
                })
              }
              className="w-full rounded-lg border px-3 py-2"
              dir="ltr"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              الدور
            </label>
            <select
              value={form.role}
              onChange={e =>
                setForm({
                  ...form,
                  role: e.target.value as CrmUser['role'],
                })
              }
              className="w-full rounded-lg border px-3 py-2"
            >
              <option value="admin">مدير</option>
              <option value="supervisor">مشرف</option>
              <option value="sales">مبيعات</option>
              <option value="field">ميداني</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              البريد الإلكتروني
            </label>
            <input
              type="email"
              value={form.email}
              onChange={e =>
                setForm({
                  ...form,
                  email: e.target.value,
                })
              }
              className="w-full rounded-lg border px-3 py-2"
              dir="ltr"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              رقم الجوال
            </label>
            <input
              value={form.phone}
              onChange={e =>
                setForm({
                  ...form,
                  phone: e.target.value,
                })
              }
              className="w-full rounded-lg border px-3 py-2"
              dir="ltr"
            />
          </div>

          <div className="md:col-span-2">
            {error ? (
              <p className="mb-3 text-sm text-red-600">
                {error}
              </p>
            ) : null}

            {success ? (
              <p className="mb-3 text-sm text-green-700">
                {success}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={saving}
              className="primary"
            >
              {saving
                ? 'جاري إنشاء المستخدم...'
                : 'إضافة المستخدم'}
            </button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h2 className="mb-4 text-xl font-bold">
          المستخدمون
        </h2>

        {loading ? (
          <p>جاري تحميل المستخدمين...</p>
        ) : users.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="border-b">
                  <th className="p-3">الاسم</th>
                  <th className="p-3">اسم المستخدم</th>
                  <th className="p-3">الدور</th>
                  <th className="p-3">الجوال</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">الموظف</th>
                </tr>
              </thead>

              <tbody>
                {users.map(user => (
                  <tr
                    key={user.id}
                    className="border-b"
                  >
                    <td className="p-3">
                      {user.name}
                    </td>

                    <td className="p-3" dir="ltr">
                      {user.username}
                    </td>

                    <td className="p-3">
                      {roleLabels[user.role]}
                    </td>

                    <td className="p-3" dir="ltr">
                      {user.phone || '-'}
                    </td>

                    <td className="p-3">
                      {user.active
                        ? 'نشط'
                        : 'موقوف'}
                    </td>
                    <td className="p-3"><CrmLink className="crm-button" href={`/crm?tab=hr&hr=employees&employee=${encodeURIComponent(user.id)}`}>الملف الوظيفي</CrmLink></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>لا يوجد مستخدمون.</p>
        )}
      </div>
    </div>
  );
}