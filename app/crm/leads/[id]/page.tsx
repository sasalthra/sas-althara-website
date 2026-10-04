'use client';

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {useParams} from 'next/navigation';
import {getSession} from 'next-auth/react';
import {Star} from 'lucide-react';

import data from '@/data/properties.json';
import LeadForm, {
  Lead,
} from '@/app/lead-form';
import {formatRiyadhDate} from '@/lib/lead-dates';
import {canToggleFeatured, featuredControlsEnabled, isFeaturedValue} from '@/lib/lead-featured';
import NewLeadBadge from '@/components/new-lead-badge';
import {editableStage, stageChoices, stageLabel} from '@/lib/lead-stages';
import {displayLeadPhone} from '@/lib/phone';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type CrmRole =
  | 'admin'
  | 'supervisor'
  | 'sales'
  | 'field';

type LeadDetails = Lead & {
  source?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type Activity = {
  id: string;
  lead_id: string;
  user_id: string | null;
  action: string;
  details:
    | Record<string, unknown>
    | string
    | null;
  created_at: string;
  user_name: string | null;
  username: string | null;
  role: CrmRole | null;
};

type DialogMode =
  | 'edit'
  | 'followup'
  | 'stage'
  | 'dispatch'
  | 'field-update'
  | null;

type FieldEmployee = {
  id: string;
  name: string;
  username?: string;
};

function valueOrDash(
  value?: string | null
) {
  return value?.trim() || '-';
}

function formatDate(
  value?: string | null
) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return value;
  }

  return parsed.toLocaleDateString(
    'ar-SA',
    {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }
  );
}

function formatDateTime(
  value?: string | null
) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return value;
  }

  return parsed.toLocaleString(
    'ar-SA',
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  );
}

function roleLabel(
  role?: CrmRole | null
) {
  switch (role) {
    case 'admin':
      return 'مدير النظام';
    case 'supervisor':
      return 'مشرف';
    case 'sales':
      return 'مبيعات';
    case 'field':
      return 'ميداني';
    default:
      return 'النظام';
  }
}

function actionLabel(
  action: string
) {
  switch (action) {
    case 'created':
    case 'lead_created':
      return 'تم إنشاء العميل';
    case 'updated':
    case 'lead_updated':
      return 'تم تحديث بيانات العميل';
    case 'follow_up_added':
      return 'تمت إضافة متابعة';
    case 'stage_changed':
      return 'تم تغيير المرحلة';
    case 'featured_changed':
      return 'تم تحديث تمييز العميل';
    case 'field_dispatched':
      return 'تفويج للميداني';
    case 'field_update':
      return 'تحديث ميداني';
    case 'reregistered':
      return 'إعادة تسجيل';
    case 'phone_duplicate':
      return 'رقم مكرر';
    default:
      return action
        .replaceAll('_', ' ')
        .trim() || 'تحديث';
  }
}

function getActivityNote(
  activity: Activity
) {
  if (
    activity.details &&
    typeof activity.details === 'object' &&
    !Array.isArray(activity.details)
  ) {
    const note = activity.details.note;
    const followUp = activity.details.followUp;
    const stage = activity.details.stage;
    const previousStage = activity.details.previousStage;
    const fieldAssignedName = activity.details.fieldAssignedName;
    const dispatchedByName = activity.details.dispatchedByName;
    const parts: string[] = [];

    if (activity.action === 'field_dispatched') {
      const target =
        typeof fieldAssignedName === 'string'
          ? fieldAssignedName.trim()
          : '';
      const by =
        typeof dispatchedByName === 'string'
          ? dispatchedByName.trim()
          : '';
      if (target) {
        parts.push(`تم التفويج إلى ${target}`);
      }
      if (by) {
        parts.push(`بواسطة ${by}`);
      }
    }

    if (
      activity.action === 'stage_changed' &&
      typeof stage === 'string'
    ) {
      if (
        typeof previousStage === 'string' &&
        previousStage
      ) {
        parts.push(
          `${
            stageLabel(previousStage)
          } ← ${
            stageLabel(stage)
          }`
        );
      } else {
        parts.push(
          `المرحلة: ${stageLabel(stage)}`
        );
      }
    }

    if (
      activity.action === 'follow_up_added' &&
      typeof followUp === 'string' &&
      followUp
    ) {
      parts.push(
        `موعد المتابعة: ${followUp}`
      );
    }

    if (
      typeof note === 'string' &&
      note.trim()
    ) {
      parts.push(note.trim());
    }

    if (parts.length) {
      return parts.join(' • ');
    }

    if (
      typeof stage === 'string' &&
      stage
    ) {
      parts.push(
        `المرحلة: ${stageLabel(stage)}`
      );
    }

    if (
      typeof followUp === 'string' &&
      followUp
    ) {
      parts.push(
        `المتابعة: ${followUp}`
      );
    }

    if (parts.length) {
      return parts.join(' • ');
    }
  }

  if (
    typeof activity.details === 'string'
  ) {
    return activity.details;
  }

  return 'تم تسجيل تحديث على العميل.';
}

export default function LeadDetailsPage() {
  const params =
    useParams<{
      id: string;
    }>();

  const [leads, setLeads] =
    useState<LeadDetails[]>([]);

  const [activities, setActivities] =
    useState<Activity[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [activityLoading, setActivityLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [role, setRole] =
    useState<CrmRole>('sales');

  const [userId, setUserId] =
    useState('');

  const [featureBusy, setFeatureBusy] =
    useState(false);

  const [featureError, setFeatureError] =
    useState('');

  const [dialogMode, setDialogMode] =
    useState<DialogMode>(null);

  const [followUpDate, setFollowUpDate] =
    useState('');

  const [followUpNote, setFollowUpNote] =
    useState('');

  const [nextStage, setNextStage] =
    useState('new');

  const [stageNote, setStageNote] =
    useState('');

  const [fieldStaff, setFieldStaff] =
    useState<FieldEmployee[]>([]);

  const [fieldUserId, setFieldUserId] =
    useState('');

  const [dispatchNote, setDispatchNote] =
    useState('');

  const [fieldUpdateNote, setFieldUpdateNote] =
    useState('');

  const [saving, setSaving] =
    useState(false);

  const [dialogError, setDialogError] =
    useState('');

  const refresh = async () => {
    setLoading(true);

    try {
      const response =
        await fetch(
          '/api/leads',
          {
            cache: 'no-store',
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            'تعذر تحميل العميل'
        );
      }

      setLeads(result);
      setError('');
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'تعذر تحميل العميل'
      );
    } finally {
      setLoading(false);
    }
  };

  const refreshActivity =
    async () => {
      setActivityLoading(true);

      try {
        const response =
          await fetch(
            `/api/leads/${params.id}/activity`,
            {
              cache: 'no-store',
            }
          );

        const result =
          await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ||
              'تعذر تحميل سجل النشاط'
          );
        }

        setActivities(result);
      } catch {
        setActivities([]);
      } finally {
        setActivityLoading(false);
      }
    };

  useEffect(() => {
    void refresh();
    void refreshActivity();

    void getSession().then(
      session => {
        const crmSession =
          session as
            | (typeof session & {
                crmRole?: CrmRole;
                crmUserId?: string;
              })
            | null;

        if (
          crmSession?.crmRole
        ) {
          setRole(
            crmSession.crmRole
          );
        }

        if (
          crmSession?.crmUserId
        ) {
          setUserId(
            crmSession.crmUserId
          );
        }
      }
    );
  }, [params.id]);

  const lead = useMemo(
    () =>
      leads.find(
        item =>
          item.id === params.id
      ),
    [leads, params.id]
  );

  const property = useMemo(
    () =>
      lead
        ? data.find(
            item =>
              item.id ===
              lead.property_id
          )
        : undefined,
    [lead]
  );

  useEffect(() => {
    if (!lead) {
      return;
    }

    setFollowUpDate(
      lead.follow_up || ''
    );

    setNextStage(
      editableStage(lead.stage)
    );
  }, [lead]);

  async function toggleFeatured() {
    if (!lead || !canToggleFeatured({userId, role}, lead) || featureBusy) return;
    const next = !isFeaturedValue(lead.is_featured);
    setFeatureBusy(true);
    setFeatureError('');
    try {
      const response = await fetch(`/api/leads/${lead.id}/featured`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({featured: next}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر تحديث التمييز');
      await refresh();
    } catch (toggleError) {
      setFeatureError(toggleError instanceof Error ? toggleError.message : 'تعذر تحديث التمييز');
    } finally {
      setFeatureBusy(false);
    }
  }

  async function saveFollowUp(
    event: FormEvent
  ) {
    event.preventDefault();

    if (!followUpDate) {
      setDialogError(
        'حدد تاريخ المتابعة القادمة.'
      );
      return;
    }

    setSaving(true);
    setDialogError('');

    try {
      const response =
        await fetch(
          `/api/leads/${params.id}/followup`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              followUp:
                followUpDate,
              note: followUpNote,
            }),
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            'تعذر حفظ المتابعة'
        );
      }

      setDialogMode(null);
      setFollowUpNote('');

      await Promise.all([
        refresh(),
        refreshActivity(),
      ]);
    } catch (error) {
      setDialogError(
        error instanceof Error
          ? error.message
          : 'تعذر حفظ المتابعة'
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveStage(
    event: FormEvent
  ) {
    event.preventDefault();

    setSaving(true);
    setDialogError('');

    try {
      const response =
        await fetch(
          `/api/leads/${params.id}/stage`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              stage: nextStage,
              note: stageNote,
            }),
          }
        );

      const result =
        await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ||
            'تعذر تغيير المرحلة'
        );
      }

      setDialogMode(null);
      setStageNote('');

      await Promise.all([
        refresh(),
        refreshActivity(),
      ]);
    } catch (error) {
      setDialogError(
        error instanceof Error
          ? error.message
          : 'تعذر تغيير المرحلة'
      );
    } finally {
      setSaving(false);
    }
  }

  async function openDispatch() {
    setDialogError('');
    setDispatchNote('');
    setFieldUserId(lead?.field_assigned_to || '');
    setDialogMode('dispatch');
    try {
      const response = await fetch('/api/crm-users?field=1', {cache: 'no-store'});
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'تعذر تحميل الموظفين الميدانيين');
      }
      setFieldStaff(Array.isArray(result) ? result : []);
    } catch (loadError) {
      setFieldStaff([]);
      setDialogError(loadError instanceof Error ? loadError.message : 'تعذر تحميل الموظفين الميدانيين');
    }
  }

  async function saveDispatch(event: FormEvent) {
    event.preventDefault();
    if (!fieldUserId) {
      setDialogError('حدد الموظف الميداني.');
      return;
    }
    setSaving(true);
    setDialogError('');
    try {
      const response = await fetch(`/api/leads/${params.id}/dispatch`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({fieldUserId, note: dispatchNote}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر تفويج العميل');
      setDialogMode(null);
      setDispatchNote('');
      await Promise.all([refresh(), refreshActivity()]);
    } catch (saveError) {
      setDialogError(saveError instanceof Error ? saveError.message : 'تعذر تفويج العميل');
    } finally {
      setSaving(false);
    }
  }

  async function saveFieldUpdate(event: FormEvent) {
    event.preventDefault();
    if (fieldUpdateNote.trim().length < 2) {
      setDialogError('اكتب ملاحظة الزيارة (حرفان على الأقل).');
      return;
    }
    setSaving(true);
    setDialogError('');
    try {
      const response = await fetch(`/api/leads/${params.id}/field-update`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({note: fieldUpdateNote}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر حفظ التحديث الميداني');
      setDialogMode(null);
      setFieldUpdateNote('');
      await Promise.all([refresh(), refreshActivity()]);
    } catch (saveError) {
      setDialogError(saveError instanceof Error ? saveError.message : 'تعذر حفظ التحديث الميداني');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main
        dir="rtl"
        className="mx-auto max-w-7xl p-6"
      >
        جارٍ تحميل بيانات العميل…
      </main>
    );
  }

  if (error) {
    return (
      <main
        dir="rtl"
        className="mx-auto max-w-7xl p-6"
      >
        <a
          href="/crm"
          className="underline"
        >
          العودة إلى العملاء
        </a>

        <p className="mt-6 text-red-600">
          {error}
        </p>
      </main>
    );
  }

  if (!lead) {
    return (
      <main
        dir="rtl"
        className="mx-auto max-w-7xl p-6"
      >
        <a
          href="/crm"
          className="underline"
        >
          العودة إلى العملاء
        </a>

        <p className="mt-6">
          العميل غير موجود أو لا تملك صلاحية لعرضه.
        </p>
      </main>
    );
  }

  const latestDispatch = activities.find(
    item => item.action === 'field_dispatched'
  );
  const dispatchDetails =
    latestDispatch?.details &&
    typeof latestDispatch.details === 'object' &&
    !Array.isArray(latestDispatch.details)
      ? latestDispatch.details
      : null;
  const dispatchedByName =
    typeof dispatchDetails?.dispatchedByName === 'string'
      ? dispatchDetails.dispatchedByName
      : '';
  const fieldTimeline = activities.filter(
    item =>
      item.action === 'field_dispatched' ||
      item.action === 'field_update' ||
      item.role === 'field'
  );

  return (
    <>
      <main
        dir="rtl"
        className="mx-auto max-w-7xl space-y-6 p-6"
      >
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <a
                href="/crm"
                className="mb-4 inline-flex text-sm text-muted-foreground hover:text-[#3F1A44]"
              >
                ← العودة إلى سجل العملاء
              </a>

              <div className="flex flex-wrap items-center gap-3">
                <h1 className={`inline-flex items-center gap-2 text-3xl font-bold ${isFeaturedValue(lead.is_featured) ? 'text-[#3F1A44]' : 'text-slate-900'}`}>
                  {isFeaturedValue(lead.is_featured) && (
                    <Star className="size-6 fill-[#3F1A44] text-[#3F1A44]" aria-hidden />
                  )}
                  {lead.name}
                  <NewLeadBadge lead={lead} />
                </h1>

                {isFeaturedValue(lead.is_featured) && (
                  <span className="inline-flex rounded-full bg-[#3F1A44] px-2.5 py-1 text-xs font-semibold text-white">
                    عميل مميز
                  </span>
                )}

                <span className="inline-flex rounded-full border border-[#e8e3e9] bg-[#f3eaf4] px-2.5 py-1 text-[#3F1A44]">
                  {stageLabel(lead.stage)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span dir="ltr">
                  {displayLeadPhone(lead.phone)}
                </span>

                <span>
                  تاريخ التسجيل{' '}
                  {formatRiyadhDate(
                    lead.created_at
                  ) || '-'}
                </span>

                <span>
                  آخر تعديل{' '}
                  {formatDate(
                    lead.updated_at
                  )}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {role === 'admin' && <a href={`/crm?tab=transactions&lead=${encodeURIComponent(lead.id)}`} className="rounded-xl border border-[#3F1A44]/20 px-4 py-2.5 text-sm font-semibold text-[#3F1A44]">معاملات العميل والمالية</a>}
              <button
                type="button"
                onClick={() => {
                  setDialogError('');
                  setFollowUpDate(
                    lead.follow_up || ''
                  );
                  setFollowUpNote('');
                  setDialogMode(
                    'followup'
                  );
                }}
                className="rounded-xl border border-[#3F1A44]/20 bg-[#3F1A44]/5 px-4 py-2.5 text-sm font-semibold text-[#3F1A44] transition hover:bg-[#3F1A44]/10"
              >
                + إضافة متابعة
              </button>

              {featuredControlsEnabled(lead) && canToggleFeatured({userId, role}, lead) && (
                <button
                  type="button"
                  aria-pressed={isFeaturedValue(lead.is_featured)}
                  disabled={featureBusy}
                  onClick={() => void toggleFeatured()}
                  className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${isFeaturedValue(lead.is_featured) ? 'border-[#3F1A44] bg-[#3F1A44] text-white' : 'border-[#3F1A44]/20 bg-[#3F1A44]/5 text-[#3F1A44] hover:bg-[#3F1A44]/10'}`}
                >
                  <Star className={`size-4 ${isFeaturedValue(lead.is_featured) ? 'fill-white' : 'fill-[#3F1A44]'}`} aria-hidden />
                  {isFeaturedValue(lead.is_featured) ? 'إلغاء التمييز' : 'عميل مميز'}
                </button>
              )}

              {(role === 'admin' || role === 'supervisor' || role === 'sales') && (
                <button
                  type="button"
                  onClick={() => {void openDispatch();}}
                  className="rounded-xl border border-[#3F1A44]/20 bg-[#3F1A44]/5 px-4 py-2.5 text-sm font-semibold text-[#3F1A44] transition hover:bg-[#3F1A44]/10"
                >
                  تفويج للميداني
                </button>
              )}

              {role === 'field' && (
                <button
                  type="button"
                  onClick={() => {
                    setDialogError('');
                    setFieldUpdateNote('');
                    setDialogMode('field-update');
                  }}
                  className="rounded-xl border border-[#3F1A44]/20 bg-[#3F1A44]/5 px-4 py-2.5 text-sm font-semibold text-[#3F1A44] transition hover:bg-[#3F1A44]/10"
                >
                  تحديث ميداني
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setDialogError('');
                  setNextStage(
                    editableStage(lead.stage)
                  );
                  setStageNote('');
                  setDialogMode(
                    'stage'
                  );
                }}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                تغيير المرحلة
              </button>

              <button
                type="button"
                onClick={() => {
                  setDialogError('');
                  setDialogMode(
                    'edit'
                  );
                }}
                className="rounded-xl bg-[#3F1A44] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                تحديث بيانات العميل
              </button>
            </div>
            {featureError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {featureError}
              </p>
            )}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-muted-foreground">
              مندوب المبيعات
            </div>
            <div className="mt-2 font-semibold text-slate-900">
              {valueOrDash(
                lead.assigned_name
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-muted-foreground">
              الموظف الميداني
            </div>
            <div className="mt-2 font-semibold text-slate-900">
              {valueOrDash(
                lead.field_assigned_name
              )}
            </div>
            <div className="mt-2 text-sm text-slate-600">
              تاريخ التفويج{' '}
              {formatDateTime(latestDispatch?.created_at)}
            </div>
            {dispatchedByName && (
              <div className="mt-1 text-sm text-slate-600">
                بواسطة {dispatchedByName}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-muted-foreground">
              المتابعة القادمة
            </div>
            <div className="mt-2 font-semibold text-slate-900">
              {valueOrDash(
                lead.follow_up
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm text-muted-foreground">
              مصدر العميل
            </div>
            <div className="mt-2 font-semibold text-slate-900">
              {valueOrDash(
                lead.source
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h2 className="text-xl font-bold text-slate-900">
                  العقار المرتبط
                </h2>

                {property && (
                  <a
                    href={`/properties/${property.id}`}
                    className="text-sm font-semibold text-[#3F1A44] hover:underline"
                  >
                    فتح العقار ↗
                  </a>
                )}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="text-sm text-muted-foreground">
                    اسم العقار
                  </div>
                  <div className="mt-1 font-semibold">
                    {property?.title || lead.property_other ||
                                          lead.property_id}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-muted-foreground">
                    معرف العقار
                  </div>
                  <div className="mt-1 font-medium text-slate-700">
                    {lead.property_id}
                  </div>
                </div>

                {property && (
                  <>
                    <div>
                      <div className="text-sm text-muted-foreground">
                        السعر
                      </div>
                      <div className="mt-1 font-semibold">
                        {property.price.toLocaleString(
                          'ar-SA'
                        )}{' '}
                        ر.س
                      </div>
                    </div>

                    <div>
                      <div className="text-sm text-muted-foreground">
                        المساحة
                      </div>
                      <div className="mt-1 font-semibold">
                        {property.area}{' '}
                        م²
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">
                    آخر تحديث للمبيعات
                  </h2>

                  <span className="text-xs text-muted-foreground">
                    {formatDate(
                      lead.sales_last_update_at
                    )}
                  </span>
                </div>

                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {valueOrDash(
                    lead.sales_last_update
                  )}
                </p>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold">
                    آخر تحديث للميداني
                  </h2>

                  <span className="text-xs text-muted-foreground">
                    {formatDate(
                      lead.field_last_update_at
                    )}
                  </span>
                </div>

                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                  {valueOrDash(
                    lead.field_last_update
                  )}
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-[#3F1A44]/15 bg-white p-6 shadow-sm">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-xl font-bold text-[#3F1A44]">
                  متابعة الميداني
                </h2>
                <div className="text-sm text-slate-600">
                  {lead.field_assigned_name
                    ? lead.field_assigned_name
                    : 'لم يُعيَّن موظف ميداني'}
                  {' • '}
                  {formatDateTime(latestDispatch?.created_at)}
                </div>
              </div>
              {fieldTimeline.length ? (
                <div className="space-y-0">
                  {fieldTimeline.map((activity, index) => (
                    <div key={activity.id} className="relative flex gap-4 pb-6 last:pb-0">
                      {index < fieldTimeline.length - 1 && (
                        <div className="absolute right-[7px] top-5 h-[calc(100%-8px)] w-px bg-slate-200" />
                      )}
                      <div className="relative z-10 mt-1.5 h-4 w-4 shrink-0 rounded-full border-4 border-white bg-[#3F1A44] shadow-sm" />
                      <div className="min-w-0 flex-1 rounded-2xl bg-slate-50 p-4">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="font-semibold text-slate-900">
                              {actionLabel(activity.action)}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {activity.user_name || activity.username || 'النظام'}
                              {' • '}
                              {roleLabel(activity.role)}
                            </div>
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatDateTime(activity.created_at)}
                          </div>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {getActivityNote(activity)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  لا توجد تحديثات ميدانية بعد.
                </p>
              )}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-xl font-bold text-slate-900">
                سجل النشاط
              </h2>

              {activityLoading ? (
                <p className="text-sm text-muted-foreground">
                  جارٍ تحميل سجل النشاط…
                </p>
              ) : activities.length ? (
                <div className="space-y-0">
                  {activities.map(
                    (
                      activity,
                      index
                    ) => (
                      <div
                        key={
                          activity.id
                        }
                        className="relative flex gap-4 pb-6 last:pb-0"
                      >
                        {index <
                          activities.length -
                            1 && (
                          <div className="absolute right-[7px] top-5 h-[calc(100%-8px)] w-px bg-slate-200" />
                        )}

                        <div className="relative z-10 mt-1.5 h-4 w-4 shrink-0 rounded-full border-4 border-white bg-[#3F1A44] shadow-sm" />

                        <div className="min-w-0 flex-1 rounded-2xl bg-slate-50 p-4">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="font-semibold text-slate-900">
                                {actionLabel(
                                  activity.action
                                )}
                              </div>

                              <div className="mt-1 text-xs text-muted-foreground">
                                {activity.user_name ||
                                  activity.username ||
                                  'النظام'}{' '}
                                •{' '}
                                {roleLabel(
                                  activity.role
                                )}
                              </div>
                            </div>

                            <div className="text-xs text-muted-foreground">
                              {formatDateTime(
                                activity.created_at
                              )}
                            </div>
                          </div>

                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                            {getActivityNote(
                              activity
                            )}
                          </p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  لا يوجد نشاط مسجل حتى الآن.
                </p>
              )}
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-5 text-xl font-bold text-slate-900">
                بيانات العميل
              </h2>

              <div className="space-y-5">
                <div>
                  <div className="text-sm text-muted-foreground">
                    اسم العميل
                  </div>
                  <div className={`mt-1 inline-flex items-center gap-1.5 font-semibold ${isFeaturedValue(lead.is_featured) ? 'text-[#3F1A44]' : ''}`}>
                    {isFeaturedValue(lead.is_featured) && (
                      <Star className="size-4 fill-[#3F1A44] text-[#3F1A44]" aria-hidden />
                    )}
                    {lead.name}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-muted-foreground">
                    تاريخ التسجيل
                  </div>
                  <div className="mt-1 font-semibold">
                    {formatRiyadhDate(lead.created_at) || '-'}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-muted-foreground">
                    رقم الجوال
                  </div>
                  <div
                    dir="ltr"
                    className="mt-1 text-right font-semibold"
                  >
                    {displayLeadPhone(lead.phone)}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-muted-foreground">
                    المرحلة الحالية
                  </div>
                  <div className="mt-1 font-semibold">
                    {stageLabel(lead.stage)}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-muted-foreground">
                    المتابعة القادمة
                  </div>
                  <div className="mt-1 font-semibold">
                    {valueOrDash(
                      lead.follow_up
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-xl font-bold text-slate-900">
                الملاحظات
              </h2>

              <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                {valueOrDash(
                  lead.notes
                )}
              </p>
            </div>
          </aside>
        </section>
      </main>

      <Dialog
        open={
          dialogMode === 'followup'
        }
        onOpenChange={open => {
          if (!open) {
            setDialogMode(null);
            setDialogError('');
          }
        }}
      >
        <DialogContent
          dir="rtl"
          className="sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>
              إضافة متابعة
            </DialogTitle>

            <DialogDescription>
              حدد موعد المتابعة القادمة وأضف ملاحظة مختصرة.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-5"
            onSubmit={
              saveFollowUp
            }
          >
            <div>
              <label className="mb-2 block text-sm font-medium">
                تاريخ المتابعة القادمة
              </label>

              <input
                type="date"
                required
                value={
                  followUpDate
                }
                onChange={
                  event =>
                    setFollowUpDate(
                      event.target.value
                    )
                }
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[#3F1A44]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                ملاحظة المتابعة
              </label>

              <textarea
                rows={4}
                value={
                  followUpNote
                }
                onChange={
                  event =>
                    setFollowUpNote(
                      event.target.value
                    )
                }
                placeholder="مثال: التواصل مع العميل بعد موافقة البنك..."
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[#3F1A44]"
              />
            </div>

            {dialogError && (
              <p className="text-sm text-red-600">
                {dialogError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setDialogMode(null)
                }
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold"
              >
                إلغاء
              </button>

              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-[#3F1A44] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving
                  ? 'جارٍ الحفظ...'
                  : 'حفظ المتابعة'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          dialogMode === 'stage'
        }
        onOpenChange={open => {
          if (!open) {
            setDialogMode(null);
            setDialogError('');
          }
        }}
      >
        <DialogContent
          dir="rtl"
          className="sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>
              تغيير المرحلة
            </DialogTitle>

            <DialogDescription>
              اختر المرحلة الجديدة وسجّل سبب أو نتيجة التغيير.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-5"
            onSubmit={
              saveStage
            }
          >
            <div>
              <label className="mb-2 block text-sm font-medium">
                المرحلة الجديدة
              </label>

              <select
                value={nextStage}
                onChange={
                  event =>
                    setNextStage(
                      event.target.value
                    )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-[#3F1A44]"
              >
                {stageChoices(
                  nextStage
                ).map(
                  ([
                    value,
                    label,
                  ]) => (
                    <option
                      key={value}
                      value={value}
                    >
                      {label}
                    </option>
                  )
                )}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                ملاحظة التغيير
              </label>

              <textarea
                rows={4}
                value={stageNote}
                onChange={
                  event =>
                    setStageNote(
                      event.target.value
                    )
                }
                placeholder="مثال: تم التواصل مع العميل وتحديد موعد للمعاينة..."
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[#3F1A44]"
              />
            </div>

            {dialogError && (
              <p className="text-sm text-red-600">
                {dialogError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setDialogMode(null)
                }
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold"
              >
                إلغاء
              </button>

              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-[#3F1A44] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving
                  ? 'جارٍ الحفظ...'
                  : 'حفظ المرحلة'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogMode === 'dispatch'}
        onOpenChange={open => {
          if (!open) {
            setDialogMode(null);
            setDialogError('');
          }
        }}
      >
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تفويج للميداني</DialogTitle>
            <DialogDescription>
              اختر الموظف الميداني. تُحدَّث المرحلة إلى تفويج للميداني ويصله إشعار بالعميل.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={saveDispatch}>
            <div>
              <label className="mb-2 block text-sm font-medium">الموظف الميداني</label>
              <select
                value={fieldUserId}
                onChange={event => setFieldUserId(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-[#3F1A44]"
              >
                <option value="">اختر الموظف</option>
                {fieldStaff.map(employee => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name || employee.username}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">ملاحظة للميداني</label>
              <textarea
                rows={4}
                value={dispatchNote}
                onChange={event => setDispatchNote(event.target.value)}
                placeholder="مثال: العميل يفضل المعاينة مساءً..."
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[#3F1A44]"
              />
            </div>
            {dialogError && <p className="text-sm text-red-600">{dialogError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDialogMode(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">إلغاء</button>
              <button type="submit" disabled={saving || !fieldStaff.length} className="rounded-xl bg-[#3F1A44] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {saving ? 'جارٍ التفويج...' : 'تفويج للميداني'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={dialogMode === 'field-update'}
        onOpenChange={open => {
          if (!open) {
            setDialogMode(null);
            setDialogError('');
          }
        }}
      >
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تحديث ميداني</DialogTitle>
            <DialogDescription>
              سجّل ملاحظة الزيارة أو مستجدات الميدان. تظهر للمبيعات في متابعة العميل.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={saveFieldUpdate}>
            <div>
              <label className="mb-2 block text-sm font-medium">ملاحظة الزيارة</label>
              <textarea
                rows={5}
                value={fieldUpdateNote}
                onChange={event => setFieldUpdateNote(event.target.value)}
                placeholder="مثال: تمت معاينة العقار مع العميل وطلب صور إضافية..."
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-[#3F1A44]"
              />
            </div>
            {dialogError && <p className="text-sm text-red-600">{dialogError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDialogMode(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold">إلغاء</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-[#3F1A44] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {saving ? 'جارٍ الحفظ...' : 'حفظ التحديث'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          dialogMode === 'edit'
        }
        onOpenChange={open => {
          if (!open) {
            setDialogMode(null);
          }
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>
              تحديث بيانات العميل
            </DialogTitle>

            <DialogDescription>
              عدّل بيانات العميل والتعيينات وباقي المعلومات.
            </DialogDescription>
          </DialogHeader>

          <LeadForm
            key={`${lead.id}-edit`}
            initial={lead}
            role={role}
            onSaved={() => {
              setDialogMode(null);
              void refresh();
              void refreshActivity();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
