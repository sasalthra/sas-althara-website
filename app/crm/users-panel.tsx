'use client';

import {useCallback, useEffect, useState} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {CrmLink} from './navigation';
import PurgeEmployeeClients from './purge-employee-clients';

const fieldClass =
  'w-full rounded-lg border border-[#d1d5db] bg-white px-3 py-2 text-black';

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

export default function UsersPanel({
  initialUsers,
}: {
  initialUsers?: CrmUser[];
} = {}) {
  const opened = initialUsers?.[0];
  const [users, setUsers] = useState<CrmUser[]>(initialUsers ?? []);
  const [loading, setLoading] = useState(!initialUsers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<string | null>(opened?.id ?? null);
  const [draft, setDraft] = useState({
    name: opened?.name ?? '',
    username: opened?.username ?? '',
    email: opened?.email ?? '',
    phone: opened?.phone ?? '',
  });
  const [contactSaving, setContactSaving] = useState(false);

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

  function startEdit(user: CrmUser) {
    setEditing(user.id);
    setDraft({
      name: user.name || '',
      username: user.username || '',
      email: user.email || '',
      phone: user.phone || '',
    });
    setError('');
    setSuccess('');
  }

  async function saveContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;

    setContactSaving(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/crm-users', {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          id: editing,
          name: draft.name,
          username: draft.username,
          email: draft.email,
          phone: draft.phone,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'تعذر حفظ بيانات الموظف');
      }

      if (data.self) {
        try {
          await fetch('/api/auth/session', {cache: 'no-store', credentials: 'same-origin'});
        } catch {
          // The open session is the user id. The next request reloads the username.
        }
      }

      setUsers(current =>
        current.map(user =>
          user.id === editing
            ? {
                ...user,
                name: data.name || draft.name.trim(),
                username: data.username || draft.username.trim().toLowerCase(),
                email: data.email || '',
                phone: data.phone || '',
              }
            : user
        )
      );
      setEditing(null);
      setSuccess(
        data.self
          ? 'تم تحديث بياناتك. جلستك الحالية تبقى مفتوحة، واستخدم اسم المستخدم الجديد عند تسجيل الدخول القادم.'
          : 'تم تحديث بيانات الموظف. يجب عليه استخدام اسم المستخدم الجديد لتسجيل الدخول.'
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'تعذر حفظ بيانات الموظف'
      );
    } finally {
      setContactSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PurgeEmployeeClients users={users} usersLoading={loading} />
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
              <p className="mb-3 text-sm text-[#3F1A44]">
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

        {error ? (
          <p className="mb-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mb-3 text-sm text-[#3F1A44]" role="status">
            {success}
          </p>
        ) : null}

        {loading ? (
          <p>جاري تحميل المستخدمين...</p>
        ) : users.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="border-b">
                  <th className="p-3">الاسم</th>
                  <th className="p-3">اسم المستخدم</th>
                  <th className="p-3">البريد الإلكتروني</th>
                  <th className="p-3">الجوال</th>
                  <th className="p-3">الدور</th>
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

                    <td className="p-3" dir="ltr">
                      {user.email || '—'}
                    </td>

                    <td className="p-3" dir="ltr">
                      {user.phone || '—'}
                    </td>

                    <td className="p-3">
                      {roleLabels[user.role]}
                    </td>

                    <td className="p-3">
                      {user.active
                        ? 'نشط'
                        : 'موقوف'}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <CrmLink className="crm-button" href={`/crm?tab=hr&hr=employees&employee=${encodeURIComponent(user.id)}`}>الملف الوظيفي</CrmLink>
                        <button type="button" className="crm-button" onClick={() => startEdit(user)}>
                          تعديل بيانات الموظف
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>لا يوجد مستخدمون.</p>
        )}

        <Dialog
          open={editing !== null}
          onOpenChange={open => {
            if (!open && !contactSaving) {
              setEditing(null);
            }
          }}
        >
          <DialogContent dir="rtl" className="border border-[#d1d5db] bg-white text-black sm:max-w-lg">
            <DialogHeader className="text-right sm:text-right">
              <DialogTitle className="text-black">تعديل بيانات الموظف</DialogTitle>
              <DialogDescription className="rounded-lg border border-[#d1d5db] bg-white px-3 py-2 text-sm text-black">
                يجب على الموظف استخدام اسم المستخدم الجديد لتسجيل الدخول. كلمة المرور تبقى كما هي.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={saveContact} className="space-y-3">
              <label className="block text-sm font-medium text-black">
                الاسم الظاهر
                <input
                  required
                  maxLength={100}
                  aria-label="الاسم الظاهر"
                  value={draft.name}
                  onChange={event => setDraft({...draft, name: event.target.value})}
                  className={`${fieldClass} mt-1`}
                />
              </label>
              <label className="block text-sm font-medium text-black">
                اسم المستخدم لتسجيل الدخول
                <input
                  required
                  maxLength={80}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="اسم المستخدم لتسجيل الدخول"
                  value={draft.username}
                  onChange={event => setDraft({...draft, username: event.target.value})}
                  className={`${fieldClass} mt-1`}
                  dir="ltr"
                />
              </label>
              <label className="block text-sm font-medium text-black">
                البريد الإلكتروني
                <input
                  type="email"
                  aria-label="البريد الإلكتروني"
                  value={draft.email}
                  onChange={event => setDraft({...draft, email: event.target.value})}
                  className={`${fieldClass} mt-1`}
                  dir="ltr"
                />
              </label>
              <label className="block text-sm font-medium text-black">
                الجوال
                <input
                  aria-label="الجوال"
                  value={draft.phone}
                  onChange={event => setDraft({...draft, phone: event.target.value})}
                  placeholder="05xxxxxxxx"
                  className={`${fieldClass} mt-1`}
                  dir="ltr"
                />
              </label>
              {error ? (
                <p className="text-sm text-red-600" role="alert">{error}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="rounded-lg border border-[#3F1A44] bg-[#3F1A44] px-4 py-2 font-semibold text-white disabled:opacity-60"
                  disabled={contactSaving}
                >
                  {contactSaving ? 'جارٍ الحفظ...' : 'حفظ'}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[#d1d5db] bg-white px-4 py-2 text-black"
                  onClick={() => setEditing(null)}
                  disabled={contactSaving}
                >
                  إلغاء
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}