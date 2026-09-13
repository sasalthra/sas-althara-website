'use client';

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {LogoutButton} from './auth-buttons';
import UsersPanel from './users-panel';
import HrPanel from './hr-panel';
import TransactionsPanel from './transactions-panel';
import ImportPanel from './import-panel';
import AiPanel from './ai-panel';
import SheetsPanel from './sheets-panel';

import data from '@/data/properties.json';
import LeadForm, {
  Lead,
  stages,
} from '@/app/lead-form';

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type CrmRole =
  | 'admin'
  | 'supervisor'
  | 'sales'
  | 'field';

type WorkspaceProps = {
  role: CrmRole;
};

function formatUpdateDate(
  value?: string | null
) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return '';
  }

  return parsed.toLocaleDateString(
    'ar-SA',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }
  );
}

function compactText(
  value?: string | null,
  limit = 22
) {
  if (!value?.trim()) {
    return 'لا يوجد';
  }

  const clean = value.trim();

  return clean.length <= limit
    ? clean
    : `${clean.slice(0, limit)}…`;
}

function compactPropertyTitle(
  value?: string
) {
  if (!value) {
    return '-';
  }

  const clean = value.trim();

  return clean.length <= 24
    ? clean
    : `${clean.slice(0, 24)}…`;
}

export default function CRM({
  role,
}: WorkspaceProps) {
  const [leads, setLeads] =
    useState<Lead[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [q, setQ] =
    useState('');

  const [open, setOpen] =
    useState(false);

  const [edit, setEdit] =
    useState<Lead | undefined>();

  const refresh =
    useCallback(async () => {
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
            result.error
          );
        }

        setLeads(result);
        setError('');
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'تعذر التحميل'
        );
      } finally {
        setLoading(false);
      }
    }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const today =
    new Date().toLocaleDateString(
      'en-CA'
    );

  const shown =
    leads.filter(lead => {
      const property =
        data.find(
          property =>
            property.id ===
            lead.property_id
        );

      const searchable = [
        lead.name,
        lead.phone,
        property?.title || lead.property_other || '',
        lead.assigned_name || '',
        lead.field_assigned_name || '',
      ].join(' ');

      return searchable
        .toLowerCase()
        .includes(
          q.trim().toLowerCase()
        );
    });

  const followUps =
    leads.filter(
      lead =>
        lead.follow_up &&
        lead.follow_up <= today &&
        ![
          'won',
          'closed',
        ].includes(
          lead.stage
        )
    ).length;

  return (
    <>
      <header className="crm-top">
        <div>
          <a
            href="/"
            className="brand"
          >
            ساس الثراء
          </a>

          <span>
            إدارة العملاء والعقارات
          </span>
        </div>

        <a href="/">
          معاينة الموقع ↗
        </a>
      </header>

      <div className="page-wrap">
        <LogoutButton />
      </div>

      <main className="crm-content">
        <div className="section-head">
          <div>
            <span className="eyebrow">
              مساحة العمل
            </span>

            <h2>
              كل متابعة، في مكان واحد.
            </h2>
          </div>

          <button
            className="primary"
            onClick={() => {
              setEdit(undefined);
              setOpen(true);
            }}
          >
            + إضافة عميل
          </button>
        </div>

        <div className="stats">
          <div className="panel">
            طلبات العملاء

            <strong>
              {leads.length}
            </strong>
          </div>

          <div className="panel">
            تحتاج متابعة

            <strong>
              {followUps}
            </strong>
          </div>

          <div className="panel">
            العقارات في المعاينة

            <strong>
              {data.length}
            </strong>
          </div>
        </div>

        <Tabs
          defaultValue="leads"
          dir="rtl"
        >
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="ai">المساعد الداخلي</TabsTrigger>
            {role === 'admin' && <TabsTrigger value="sheets">إعدادات Google Sheets</TabsTrigger>}
            {['admin','supervisor'].includes(role) && <TabsTrigger value="import">استيراد Excel</TabsTrigger>}
            <TabsTrigger value="hr">الموظفون والحضور</TabsTrigger>
            {role === 'admin' && <TabsTrigger value="transactions">المعاملات والمالية</TabsTrigger>}
            <TabsTrigger value="leads">
              العملاء والمتابعات
            </TabsTrigger>

            <TabsTrigger value="properties">
              العقارات
            </TabsTrigger>

            {role === 'admin' && (
              <TabsTrigger value="users">
                المستخدمون والصلاحيات
              </TabsTrigger>
            )}
          </TabsList>

          {role === 'admin' && <TabsContent value="transactions"><TransactionsPanel leads={leads}/></TabsContent>}
          <TabsContent value="hr"><HrPanel admin={role === 'admin'}/></TabsContent>
          <TabsContent value="ai"><AiPanel admin={role === 'admin'}/></TabsContent>
          {role === 'admin' && <TabsContent value="sheets"><SheetsPanel/></TabsContent>}
          {['admin','supervisor'].includes(role) && <TabsContent value="import"><ImportPanel onSaved={()=>void refresh()}/></TabsContent>}
          <TabsContent value="leads">
            <div className="panel !py-6">
              <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="mb-1">
                    سجل العملاء
                  </h2>

                  <p className="subtle">
                    اضغط على اسم العميل لعرض الملف الكامل.
                  </p>
                </div>

                <label className="search w-full lg:w-[420px]">
                  <input
                    aria-label="بحث العملاء"
                    value={q}
                    onChange={
                      event =>
                        setQ(
                          event.target
                            .value
                        )
                    }
                    placeholder="ابحث باسم العميل، الجوال أو العقار..."
                  />
                </label>
              </div>

              {error && (
                <p
                  role="alert"
                  className="error"
                >
                  {error}{' '}

                  <button
                    onClick={() =>
                      void refresh()
                    }
                  >
                    إعادة المحاولة
                  </button>
                </p>
              )}

              {loading ? (
                <p>
                  جارٍ تحميل العملاء…
                </p>
              ) : shown.length ? (
                <>
                  <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <Table className="w-full min-w-[1200px] table-fixed">
                      <TableHeader>
                        <TableRow className="bg-slate-50/80">
                          <TableHead className="w-[3%] px-2 text-center">
                            #
                          </TableHead>

                          <TableHead className="w-[12%] px-2">
                            اسم العميل
                          </TableHead>

                          <TableHead className="w-[11%] px-2">
                            الجوال
                          </TableHead>

                          <TableHead className="w-[14%] px-2">
                            العقار
                          </TableHead>

                          <TableHead className="w-[8%] px-2">
                            المرحلة
                          </TableHead>

                          <TableHead className="w-[10%] px-2">
                            المبيعات
                          </TableHead>

                          <TableHead className="w-[10%] px-2">
                            الميداني
                          </TableHead>

                          <TableHead className="w-[13%] px-2">
                            آخر تحديث مبيعات
                          </TableHead>

                          <TableHead className="w-[13%] px-2">
                            آخر تحديث ميداني
                          </TableHead>

                          <TableHead className="w-[6%] px-2">
                            المتابعة
                          </TableHead>
                        </TableRow>
                      </TableHeader>

                      <TableBody>
                        {shown.map(
                          (
                            lead,
                            index
                          ) => {
                            const property =
                              data.find(
                                property =>
                                  property.id ===
                                  lead.property_id
                              );

                            return (
                              <TableRow
                                key={
                                  lead.id
                                }
                                className="align-middle"
                              >
                                <TableCell className="px-2 text-center text-sm text-muted-foreground">
                                  {index + 1}
                                </TableCell>

                                <TableCell className="px-2">
                                  <a
                                    href={`/crm/leads/${lead.id}`}
                                    className="block truncate font-semibold text-[#5b2a72] underline decoration-[#5b2a72]/40 underline-offset-4 hover:decoration-[#5b2a72]"
                                    title={
                                      lead.name
                                    }
                                  >
                                    {lead.name}
                                  </a>
                                </TableCell>

                                <TableCell
                                  dir="ltr"
                                  className="px-2 text-right text-sm"
                                >
                                  <div
                                    className="truncate"
                                    title={
                                      lead.phone
                                    }
                                  >
                                    {lead.phone}
                                  </div>
                                </TableCell>

                                <TableCell className="px-2 text-sm">
                                  <div
                                    className="truncate"
                                    title={
                                      property?.title || lead.property_other ||
                                                                            '-'
                                    }
                                  >
                                    {compactPropertyTitle(
                                                                          property?.title || lead.property_other
                                    )}
                                  </div>
                                </TableCell>

                                <TableCell className="px-2">
                                  <span className="inline-flex max-w-full truncate rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                    {stages[
                                      lead
                                        .stage
                                    ] ||
                                      lead.stage}
                                  </span>
                                </TableCell>

                                <TableCell className="px-2 text-sm">
                                  <div
                                    className="truncate"
                                    title={
                                      lead.assigned_name ||
                                      'بدون تعيين'
                                    }
                                  >
                                    {lead.assigned_name ||
                                      'بدون تعيين'}
                                  </div>
                                </TableCell>

                                <TableCell className="px-2 text-sm">
                                  <div
                                    className="truncate"
                                    title={
                                      lead.field_assigned_name ||
                                      'بدون تعيين'
                                    }
                                  >
                                    {lead.field_assigned_name ||
                                      'بدون تعيين'}
                                  </div>
                                </TableCell>

                                <TableCell className="px-2 text-sm">
                                  <div
                                    className="truncate"
                                    title={
                                      lead.sales_last_update ||
                                      'لا يوجد تحديث'
                                    }
                                  >
                                    {compactText(
                                      lead.sales_last_update
                                    )}
                                  </div>

                                  {lead.sales_last_update_at && (
                                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                      {formatUpdateDate(
                                        lead.sales_last_update_at
                                      )}
                                    </div>
                                  )}
                                </TableCell>

                                <TableCell className="px-2 text-sm">
                                  <div
                                    className="truncate"
                                    title={
                                      lead.field_last_update ||
                                      'لا يوجد تحديث'
                                    }
                                  >
                                    {compactText(
                                      lead.field_last_update
                                    )}
                                  </div>

                                  {lead.field_last_update_at && (
                                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                      {formatUpdateDate(
                                        lead.field_last_update_at
                                      )}
                                    </div>
                                  )}
                                </TableCell>

                                <TableCell className="px-2 text-sm">
                                  <div className="truncate">
                                    {lead.follow_up ||
                                      '-'}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          }
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-3 text-sm text-muted-foreground">
                    عرض {shown.length} من أصل {leads.length} عميل
                  </div>
                </>
              ) : (
                !error && (
                  <div className="empty">
                    <h3>
                      {q
                        ? 'لا توجد نتائج'
                        : 'لا توجد طلبات عملاء بعد'}
                    </h3>

                    <p>
                      أضف عميلًا أو سجّل طلب اهتمام من صفحة العقار.
                    </p>
                  </div>
                )
              )}
            </div>
          </TabsContent>

          <TabsContent value="properties">
            <div className="panel">
              <h2>
                سجل العقارات
              </h2>

              <p className="subtle">
                87 سجلًا مستوردًا للمعاينة،
                و30 سجلًا في قائمة المراجعة
                خارج هذه النسخة. لا يحدث نشر
                على الموقع الأصلي.
              </p>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      العقار
                    </TableHead>

                    <TableHead>
                      السعر
                    </TableHead>

                    <TableHead>
                      المساحة
                    </TableHead>

                    <TableHead>
                      الحالة
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {data.map(
                    property => (
                      <TableRow
                        key={
                          property.id
                        }
                      >
                        <TableCell>
                          <a
                            className="underline"
                            href={
                              '/properties/' +
                              property.id
                            }
                          >
                            {
                              property.title
                            }
                          </a>
                        </TableCell>

                        <TableCell>
                          {property.price.toLocaleString(
                            'ar-SA'
                          )}{' '}
                          ر.س
                        </TableCell>

                        <TableCell>
                          {
                            property.area
                          }{' '}
                          م²
                        </TableCell>

                        <TableCell>
                          مسودة معاينة
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {role === 'admin' && (
            <TabsContent value="users">
              <UsersPanel />
            </TabsContent>
          )}
        </Tabs>

        <Dialog
          open={open}
          onOpenChange={setOpen}
        >
          <DialogContent
            dir="rtl"
            className="max-h-[90vh] overflow-y-auto"
          >
            <DialogHeader>
              <DialogTitle>
                {edit
                  ? 'تحديث العميل'
                  : 'إضافة عميل'}
              </DialogTitle>

              <DialogDescription>
                اختر العقار وحدد المرحلة
                وموعد المتابعة.
              </DialogDescription>
            </DialogHeader>

            <LeadForm
              key={
                edit?.id ||
                'new'
              }
              initial={edit}
              role={role}
              onSaved={() => {
                setOpen(false);
                void refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      </main>
    </>
  );
}
