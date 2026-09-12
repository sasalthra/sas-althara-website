'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {useParams} from 'next/navigation';
import {getSession} from 'next-auth/react';

import data from '@/data/properties.json';
import LeadForm, {
  Lead,
  stages,
} from '@/app/lead-form';

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
  | null;

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
    !Array.isArray(
      activity.details
    )
  ) {
    const note =
      activity.details.note;

    if (
      typeof note === 'string' &&
      note.trim()
    ) {
      return note.trim();
    }

    const followUp =
      activity.details.followUp;

    const stage =
      activity.details.stage;

    const parts: string[] = [];

    if (
      typeof stage === 'string' &&
      stage
    ) {
      parts.push(
        `المرحلة: ${
          stages[stage] || stage
        }`
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

  const [dialogMode, setDialogMode] =
    useState<DialogMode>(null);

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
              })
            | null;

        if (
          crmSession?.crmRole
        ) {
          setRole(
            crmSession.crmRole
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

  const dialogTitle =
    dialogMode === 'stage'
      ? 'تغيير مرحلة العميل'
      : dialogMode === 'followup'
        ? 'إضافة متابعة'
        : 'تحديث بيانات العميل';

  const dialogDescription =
    dialogMode === 'stage'
      ? 'حدّث المرحلة الحالية وسجّل ملاحظتك.'
      : dialogMode === 'followup'
        ? 'حدد موعد المتابعة القادمة وسجّل آخر مستجد.'
        : 'حدّث بيانات العميل والتعيينات والمتابعة.';

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
                className="mb-4 inline-flex text-sm text-muted-foreground hover:text-[#53115c]"
              >
                ← العودة إلى سجل العملاء
              </a>

              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold text-[#43104d]">
                  {lead.name}
                </h1>

                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {stages[
                    lead.stage
                  ] || lead.stage}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span dir="ltr">
                  {lead.phone}
                </span>

                <span>
                  العميل منذ{' '}
                  {formatDate(
                    lead.created_at
                  )}
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
              <button
                type="button"
                onClick={() =>
                  setDialogMode(
                    'followup'
                  )
                }
                className="rounded-xl border border-[#53115c]/20 bg-[#53115c]/5 px-4 py-2.5 text-sm font-semibold text-[#53115c] transition hover:bg-[#53115c]/10"
              >
                + إضافة متابعة
              </button>

              <button
                type="button"
                onClick={() =>
                  setDialogMode(
                    'stage'
                  )
                }
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                تغيير المرحلة
              </button>

              <button
                type="button"
                onClick={() =>
                  setDialogMode(
                    'edit'
                  )
                }
                className="rounded-xl bg-[#53115c] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                تحديث بيانات العميل
              </button>
            </div>
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
                    className="text-sm font-semibold text-[#53115c] hover:underline"
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
                    {property?.title ||
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

                        <div className="relative z-10 mt-1.5 h-4 w-4 shrink-0 rounded-full border-4 border-white bg-[#53115c] shadow-sm" />

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
                  <div className="mt-1 font-semibold">
                    {lead.name}
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
                    {lead.phone}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-muted-foreground">
                    المرحلة الحالية
                  </div>
                  <div className="mt-1 font-semibold">
                    {stages[
                      lead.stage
                    ] || lead.stage}
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
          dialogMode !== null
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
              {dialogTitle}
            </DialogTitle>

            <DialogDescription>
              {dialogDescription}
            </DialogDescription>
          </DialogHeader>

          <LeadForm
            key={`${lead.id}-${dialogMode || 'edit'}`}
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
