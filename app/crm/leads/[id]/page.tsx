'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {useParams} from 'next/navigation';

import data from '@/data/properties.json';
import {
  Lead,
  stages,
} from '@/app/lead-form';

type LeadDetails = Lead & {
  source?: string | null;
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

export default function LeadDetailsPage() {
  const params = useParams<{
    id: string;
  }>();

  const [leads, setLeads] =
    useState<LeadDetails[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  useEffect(() => {
    async function load() {
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
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'تعذر تحميل العميل'
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

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
    <main
      dir="rtl"
      className="mx-auto max-w-7xl space-y-6 p-6"
    >
      <div className="flex flex-col gap-4 rounded-2xl border bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <a
            href="/crm"
            className="mb-3 inline-block text-sm text-muted-foreground hover:underline"
          >
            ← العودة إلى سجل العملاء
          </a>

          <h1 className="text-3xl font-bold text-[#43104d]">
            {lead.name}
          </h1>

          <p
            dir="ltr"
            className="mt-2 text-right text-muted-foreground"
          >
            {lead.phone}
          </p>
        </div>

        <span className="inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
          {stages[
            lead.stage
          ] || lead.stage}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border bg-white p-6 shadow-sm lg:col-span-2">
          <h2 className="mb-5 text-xl font-bold">
            بيانات العميل
          </h2>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="text-sm text-muted-foreground">
                اسم العميل
              </div>
              <div className="mt-1 font-medium">
                {lead.name}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground">
                الجوال
              </div>
              <div
                dir="ltr"
                className="mt-1 text-right font-medium"
              >
                {lead.phone}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground">
                العقار
              </div>
              <div className="mt-1 font-medium">
                {property?.title ||
                  lead.property_id}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground">
                مصدر العميل
              </div>
              <div className="mt-1 font-medium">
                {valueOrDash(
                  lead.source
                )}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground">
                مندوب المبيعات
              </div>
              <div className="mt-1 font-medium">
                {valueOrDash(
                  lead.assigned_name
                )}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground">
                الموظف الميداني
              </div>
              <div className="mt-1 font-medium">
                {valueOrDash(
                  lead.field_assigned_name
                )}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground">
                المتابعة القادمة
              </div>
              <div className="mt-1 font-medium">
                {valueOrDash(
                  lead.follow_up
                )}
              </div>
            </div>

            <div>
              <div className="text-sm text-muted-foreground">
                المرحلة
              </div>
              <div className="mt-1 font-medium">
                {stages[
                  lead.stage
                ] || lead.stage}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold">
            الملاحظات
          </h2>

          <p className="whitespace-pre-wrap text-sm leading-7">
            {valueOrDash(
              lead.notes
            )}
          </p>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">
              آخر تحديث للمبيعات
            </h2>

            <span className="text-xs text-muted-foreground">
              {formatDate(
                lead.sales_last_update_at
              )}
            </span>
          </div>

          <p className="whitespace-pre-wrap leading-7">
            {valueOrDash(
              lead.sales_last_update
            )}
          </p>
        </section>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">
              آخر تحديث للموظف الميداني
            </h2>

            <span className="text-xs text-muted-foreground">
              {formatDate(
                lead.field_last_update_at
              )}
            </span>
          </div>

          <p className="whitespace-pre-wrap leading-7">
            {valueOrDash(
              lead.field_last_update
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
