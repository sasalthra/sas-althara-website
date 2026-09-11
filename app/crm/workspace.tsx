'use client';

import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {LogoutButton} from './auth-buttons';
import UsersPanel from './users-panel';

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

function shortUpdate(
  value?: string | null
) {
  if (!value) {
    return 'لا يوجد تحديث';
  }

  const clean = value.trim();

  if (clean.length <= 65) {
    return clean;
  }

  return (
    clean.slice(0, 65) +
    '…'
  );
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

      const searchable =
        lead.name +
        lead.phone +
        (property?.title || '');

      return searchable
        .toLowerCase()
        .includes(
          q.toLowerCase()
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
          <TabsList>
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

          <TabsContent value="leads">
            <div className="panel">
              <div className="section-head">
                <h2>
                  سجل العملاء
                </h2>

                <label className="search">
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
                    placeholder="اسم العميل، الجوال أو العقار"
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
                <div className="w-full overflow-x-auto">
                  <Table className="min-w-[1450px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap text-center">
                          #
                        </TableHead>

                        <TableHead className="whitespace-nowrap">
                          اسم العميل
                        </TableHead>

                        <TableHead className="whitespace-nowrap">
                          الجوال
                        </TableHead>

                        <TableHead className="whitespace-nowrap">
                          العقار
                        </TableHead>

                        <TableHead className="whitespace-nowrap">
                          المرحلة
                        </TableHead>

                        <TableHead className="whitespace-nowrap">
                          مندوب المبيعات
                        </TableHead>

                        <TableHead className="whitespace-nowrap">
                          الموظف الميداني
                        </TableHead>

                        <TableHead className="min-w-[190px]">
                          آخر تحديث (المبيعات)
                        </TableHead>

                        <TableHead className="min-w-[190px]">
                          آخر تحديث (الميداني)
                        </TableHead>

                        <TableHead className="whitespace-nowrap">
                          المتابعة القادمة
                        </TableHead>

                        <TableHead className="whitespace-nowrap text-center">
                          الإجراء
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
                            >
                              <TableCell className="text-center text-muted-foreground">
                                {index +
                                  1}
                              </TableCell>

                              <TableCell className="font-medium whitespace-nowrap">
                                {
                                  lead.name
                                }
                              </TableCell>

                              <TableCell
                                dir="ltr"
                                className="whitespace-nowrap text-right"
                              >
                                {
                                  lead.phone
                                }
                              </TableCell>

                              <TableCell className="min-w-[170px]">
                                {property?.title ||
                                  '-'}
                              </TableCell>

                              <TableCell className="whitespace-nowrap">
                                <span className="inline-flex rounded-full border px-3 py-1 text-xs font-medium">
                                  {stages[
                                    lead
                                      .stage
                                  ] ||
                                    lead.stage}
                                </span>
                              </TableCell>

                              <TableCell className="whitespace-nowrap">
                                {lead.assigned_name ||
                                  'بدون تعيين'}
                              </TableCell>

                              <TableCell className="whitespace-nowrap">
                                {lead.field_assigned_name ||
                                  'بدون تعيين'}
                              </TableCell>

                              <TableCell className="min-w-[190px] max-w-[230px]">
                                <div
                                  className="truncate"
                                  title={
                                    lead.sales_last_update ||
                                    ''
                                  }
                                >
                                  {shortUpdate(
                                    lead.sales_last_update
                                  )}
                                </div>

                                {lead.sales_last_update_at && (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {formatUpdateDate(
                                      lead.sales_last_update_at
                                    )}
                                  </div>
                                )}
                              </TableCell>

                              <TableCell className="min-w-[190px] max-w-[230px]">
                                <div
                                  className="truncate"
                                  title={
                                    lead.field_last_update ||
                                    ''
                                  }
                                >
                                  {shortUpdate(
                                    lead.field_last_update
                                  )}
                                </div>

                                {lead.field_last_update_at && (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {formatUpdateDate(
                                      lead.field_last_update_at
                                    )}
                                  </div>
                                )}
                              </TableCell>

                              <TableCell className="whitespace-nowrap">
                                {lead.follow_up ||
                                  'لم تحدد'}
                              </TableCell>

                              <TableCell className="text-center">
                                <button
                                  onClick={() => {
                                    setEdit(
                                      lead
                                    );

                                    setOpen(
                                      true
                                    );
                                  }}
                                  className="underline whitespace-nowrap"
                                >
                                  تحديث
                                </button>
                              </TableCell>
                            </TableRow>
                          );
                        }
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                !error && (
                  <div className="empty">
                    <h3>
                      {q
                        ? 'لا توجد نتائج'
                        : 'لا توجد طلبات عملاء بعد'}
                    </h3>

                    <p>
                      أضف عميلًا أو
                      سجّل طلب اهتمام
                      من صفحة العقار.
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
                87 سجلًا مستوردًا
                للمعاينة، و30 سجلًا
                في قائمة المراجعة
                خارج هذه النسخة. لا
                يحدث نشر على الموقع
                الأصلي.
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