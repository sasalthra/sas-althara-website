'use client';

import {useEffect, useState} from 'react';

import data from '@/data/properties.json';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const stages: Record<string, string> = {
  new: 'جديد',
  contacted: 'تم التواصل',
  viewing: 'موعد معاينة',
  negotiation: 'تفاوض',
  won: 'تمت الصفقة',
  closed: 'مغلق',
};

export type Lead = {
  id: string;
  name: string;
  phone: string;
  property_id: string;
  stage: string;
  notes: string;
  follow_up: string;
  assigned_to?: string | null;
  assigned_name?: string | null;
  assigned_username?: string | null;
  created_at?: string;
};

type CrmRole =
  | 'admin'
  | 'supervisor'
  | 'sales'
  | 'field';

type AssignableUser = {
  id: string;
  username: string;
  name: string;
  role: 'sales' | 'field';
  active: number;
};

type LeadFormProps = {
  propertyId?: string;
  initial?: Lead;
  onSaved?: () => void;
  role?: CrmRole;
};

export default function LeadForm({
  propertyId,
  initial,
  onSaved,
  role = 'sales',
}: LeadFormProps) {
  const [name, setName] = useState(
    initial?.name || ''
  );

  const [phone, setPhone] = useState(
    initial?.phone || ''
  );

  const [prop, setProp] = useState(
    initial?.property_id ||
      propertyId ||
      data[0].id
  );

  const [stage, setStage] = useState(
    initial?.stage || 'new'
  );

  const [notes, setNotes] = useState(
    initial?.notes || ''
  );

  const [date, setDate] = useState(
    initial?.follow_up || ''
  );

  const [assignedTo, setAssignedTo] =
    useState(
      initial?.assigned_to || 'unassigned'
    );

  const [users, setUsers] = useState<
    AssignableUser[]
  >([]);

  const [loadingUsers, setLoadingUsers] =
    useState(false);

  const [usersError, setUsersError] =
    useState('');

  const [id] = useState(
    () =>
      initial?.id ||
      crypto.randomUUID()
  );

  const [busy, setBusy] =
    useState(false);

  const [message, setMessage] =
    useState('');

  const [done, setDone] =
    useState(false);

  const canAssign =
    role === 'admin' ||
    role === 'supervisor';

  useEffect(() => {
    if (!canAssign) {
      return;
    }

    let cancelled = false;

    async function loadUsers() {
      setLoadingUsers(true);
      setUsersError('');

      try {
        const response = await fetch(
          '/api/crm-users?assignable=1',
          {
            cache: 'no-store',
          }
        );

        const result =
          await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ||
              'تعذر تحميل المندوبين'
          );
        }

        if (!cancelled) {
          setUsers(result);
        }
      } catch (error) {
        if (!cancelled) {
          setUsersError(
            error instanceof Error
              ? error.message
              : 'تعذر تحميل المندوبين'
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      }
    }

    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [canAssign]);

  async function submit(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setBusy(true);
    setMessage('');

    try {
      const body: {
        id: string;
        name: string;
        phone: string;
        propertyId: string;
        stage: string;
        notes: string;
        followUp: string;
        assignedTo?: string | null;
      } = {
        id,
        name,
        phone,
        propertyId: prop,
        stage,
        notes,
        followUp: date,
      };

      if (canAssign) {
        body.assignedTo =
          assignedTo === 'unassigned'
            ? null
            : assignedTo;
      }

      const response = await fetch(
        '/api/leads',
        {
          method: initial
            ? 'PATCH'
            : 'POST',

          headers: {
            'Content-Type':
              'application/json',
          },

          body: JSON.stringify(body),
        }
      );

      const result =
        (await response.json()) as {
          error?: string;
        };

      if (!response.ok) {
        throw new Error(result.error);
      }

      setDone(true);

      setMessage(
        'تم حفظ الطلب في لوحة العملاء.'
      );

      onSaved?.();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'تعذر الحفظ'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="fields"
      onSubmit={submit}
    >
      <label>
        الاسم

        <input
          required
          minLength={2}
          maxLength={100}
          value={name}
          onChange={event =>
            setName(event.target.value)
          }
          autoComplete="name"
        />
      </label>

      <label>
        رقم الجوال

        <input
          required
          type="tel"
          dir="ltr"
          maxLength={22}
          value={phone}
          onChange={event =>
            setPhone(event.target.value)
          }
          autoComplete="tel"
        />
      </label>

      {!propertyId && (
        <label>
          العقار

          <Select
            value={prop}
            onValueChange={setProp}
            dir="rtl"
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {data.map(property => (
                <SelectItem
                  key={property.id}
                  value={property.id}
                >
                  {property.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}

      {!propertyId && (
        <>
          <label>
            مرحلة الطلب

            <Select
              value={stage}
              onValueChange={setStage}
              dir="rtl"
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>

              <SelectContent>
                {Object.entries(
                  stages
                ).map(([key, value]) => (
                  <SelectItem
                    key={key}
                    value={key}
                  >
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label>
            المتابعة القادمة

            <input
              type="date"
              value={date}
              onChange={event =>
                setDate(
                  event.target.value
                )
              }
            />
          </label>
        </>
      )}

      {canAssign && (
        <label>
          المندوب المسؤول

          {loadingUsers ? (
            <p>
              جاري تحميل المندوبين...
            </p>
          ) : (
            <Select
              value={assignedTo}
              onValueChange={
                setAssignedTo
              }
              dir="rtl"
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="اختر المندوب" />
              </SelectTrigger>

              <SelectContent>
                <SelectItem value="unassigned">
                  بدون تعيين
                </SelectItem>

                {users.map(user => (
                  <SelectItem
                    key={user.id}
                    value={user.id}
                  >
                    {user.name} —{' '}
                    {user.role ===
                    'sales'
                      ? 'مبيعات'
                      : 'ميداني'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {usersError ? (
            <span className="error">
              {usersError}
            </span>
          ) : null}
        </label>
      )}

      <label>
        ملاحظات

        <textarea
          rows={3}
          maxLength={3000}
          value={notes}
          onChange={event =>
            setNotes(
              event.target.value
            )
          }
        />
      </label>

      <button
        className="primary"
        disabled={busy || done}
      >
        {busy
          ? 'جارٍ الحفظ…'
          : done
          ? 'تم الحفظ'
          : initial
          ? 'حفظ التحديث'
          : 'حفظ طلب الاهتمام'}
      </button>

      {message && (
        <p
          role="status"
          className={
            done
              ? 'success'
              : 'error'
          }
        >
          {message}
        </p>
      )}
    </form>
  );
}