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
  new: 'عميل جديد',
  received: 'تم استلام العميل',
  no_answer: 'لم يتم الرد',
  contacted: 'تم التواصل',
  data_received: 'تم استلام بيانات العميل',
  calculation_done: 'تم عمل حسبة للعميل',
  visit_qualified: 'مؤهل زيارة',
  property_visited: 'تم زيارة العقار',
  bank_approval: 'مؤهل بانتظار موافقة البنك',
  deposit_paid: 'دفع عربون',
  contract_signed: 'وقع عقد',
  transferred: 'إفراغ',
  unqualified: 'غير مؤهل',
  not_interested: 'غير مهتم',
};

export const leadSources: Record<string, string> = {
  meta: 'ميتا',
  tiktok: 'تيك توك',
  snapchat: 'سناب',
  google: 'جوجل',
  management: 'الإدارة',
  other: 'أخرى',
};

const knownLeadSources = new Set([
  'meta',
  'tiktok',
  'snapchat',
  'google',
  'management',
]);

export type Lead = {
  id: string;
  name: string;
  phone: string;
  property_id: string;
  source?: string | null;
  stage: string;
  notes: string;
  follow_up: string;

  assigned_to?: string | null;
  assigned_name?: string | null;
  assigned_username?: string | null;

  field_assigned_to?: string | null;
  field_assigned_name?: string | null;
  field_assigned_username?: string | null;

  sales_last_update?: string | null;
  sales_last_update_at?: string | null;

  field_last_update?: string | null;
  field_last_update_at?: string | null;

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

  const initialSource =
    initial?.source?.trim() || '';

  const [sourceOption, setSourceOption] =
    useState(
      initialSource
        ? knownLeadSources.has(
            initialSource
          )
          ? initialSource
          : 'other'
        : 'management'
    );

  const [customSource, setCustomSource] =
    useState(
      initialSource &&
        !knownLeadSources.has(
          initialSource
        )
        ? initialSource
        : ''
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

  const [
    fieldAssignedTo,
    setFieldAssignedTo,
  ] = useState(
    initial?.field_assigned_to ||
      'unassigned'
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

  const salesUsers = users.filter(
    user =>
      user.role === 'sales' &&
      user.active === 1
  );

  const fieldUsers = users.filter(
    user =>
      user.role === 'field' &&
      user.active === 1
  );

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
              'تعذر تحميل الموظفين'
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
              : 'تعذر تحميل الموظفين'
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
      const resolvedSource =
        sourceOption === 'other'
          ? customSource.trim()
          : sourceOption;

      if (!resolvedSource) {
        setMessage(
          'اكتب مصدر العميل.'
        );
        setBusy(false);
        return;
      }

      const body: {
        id: string;
        name: string;
        phone: string;
        propertyId: string;
        source: string;
        stage: string;
        notes: string;
        followUp: string;
        assignedTo?: string | null;
        fieldAssignedTo?: string | null;
      } = {
        id,
        name,
        phone,
        propertyId: prop,
        source: resolvedSource,
        stage,
        notes,
        followUp: date,
      };

      if (canAssign) {
        body.assignedTo =
          assignedTo === 'unassigned'
            ? null
            : assignedTo;

        body.fieldAssignedTo =
          fieldAssignedTo === 'unassigned'
            ? null
            : fieldAssignedTo;
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
        initial
          ? 'تم حفظ تحديث العميل.'
          : 'تم حفظ العميل في النظام.'
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
        اسم العميل

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
            مصدر العميل

            <Select
              value={sourceOption}
              onValueChange={value => {
                setSourceOption(value);

                if (value !== 'other') {
                  setCustomSource('');
                }
              }}
              dir="rtl"
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="اختر مصدر العميل" />
              </SelectTrigger>

              <SelectContent>
                {Object.entries(
                  leadSources
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

          {sourceOption === 'other' && (
            <label>
              اكتب مصدر العميل

              <input
                required
                minLength={2}
                maxLength={80}
                value={customSource}
                onChange={event =>
                  setCustomSource(
                    event.target.value
                  )
                }
                placeholder="مثال: معرض عقاري، إحالة، حملة خاصة..."
              />
            </label>
          )}

          <label>
            مرحلة العميل

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
        <>
          <label>
            مندوب المبيعات

            {loadingUsers ? (
              <p>
                جاري تحميل موظفي المبيعات...
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
                  <SelectValue placeholder="اختر مندوب المبيعات" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="unassigned">
                    بدون تعيين
                  </SelectItem>

                  {salesUsers.map(user => (
                    <SelectItem
                      key={user.id}
                      value={user.id}
                    >
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </label>

          <label>
            الموظف الميداني

            {loadingUsers ? (
              <p>
                جاري تحميل الموظفين الميدانيين...
              </p>
            ) : (
              <Select
                value={fieldAssignedTo}
                onValueChange={
                  setFieldAssignedTo
                }
                dir="rtl"
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="اختر الموظف الميداني" />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="unassigned">
                    بدون تعيين
                  </SelectItem>

                  {fieldUsers.map(user => (
                    <SelectItem
                      key={user.id}
                      value={user.id}
                    >
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </label>

          {usersError ? (
            <span className="error">
              {usersError}
            </span>
          ) : null}
        </>
      )}

      <label>
        تحديث / ملاحظات العميل

        <textarea
          rows={3}
          maxLength={3000}
          value={notes}
          onChange={event =>
            setNotes(
              event.target.value
            )
          }
          placeholder={
            role === 'field'
              ? 'اكتب نتيجة الزيارة أو تحديث الموظف الميداني...'
              : role === 'sales'
              ? 'اكتب آخر تحديث بعد التواصل مع العميل...'
              : 'اكتب ملاحظات أو تحديث العميل...'
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
          : 'إضافة العميل'}
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