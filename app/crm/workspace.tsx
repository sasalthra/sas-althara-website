'use client';

import {useCallback, useEffect, useState} from 'react';

import {LogoutButton} from './auth-buttons';
import UsersPanel from './users-panel';

import data from '@/data/properties.json';
import LeadForm, {Lead, stages} from '@/app/lead-form';

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

export default function CRM() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Lead | undefined>();

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/leads', {
        cache: 'no-store',
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error);
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

  const today = new Date().toLocaleDateString('en-CA');

  const shown = leads.filter(lead => {
    const property = data.find(
      property => property.id === lead.property_id
    );

    const searchable =
      lead.name +
      lead.phone +
      (property?.title || '');

    return searchable
      .toLowerCase()
      .includes(q.toLowerCase());
  });

  const followUps = leads.filter(
    lead =>
      lead.follow_up &&
      lead.follow_up <= today &&
      !['won', 'closed'].includes(lead.stage)
  ).length;

  return (
    <>
      <header className="crm-top">
        <div>
          <a href="/" className="brand">
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

            <TabsTrigger value="users">
              المستخدمون والصلاحيات
            </TabsTrigger>
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
                    onChange={event =>
                      setQ(event.target.value)
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        العميل
                      </TableHead>

                      <TableHead>
                        العقار
                      </TableHead>

                      <TableHead>
                        المرحلة
                      </TableHead>

                      <TableHead>
                        المتابعة
                      </TableHead>

                      <TableHead>
                        الإجراء
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {shown.map(lead => {
                      const property = data.find(
                        property =>
                          property.id ===
                          lead.property_id
                      );

                      return (
                        <TableRow
                          key={lead.id}
                        >
                          <TableCell>
                            <strong>
                              {lead.name}
                            </strong>

                            <div dir="ltr">
                              {lead.phone}
                            </div>
                          </TableCell>

                          <TableCell>
                            {property?.title ||
                              '-'}
                          </TableCell>

                          <TableCell>
                            {stages[
                              lead.stage
                            ]}
                          </TableCell>

                          <TableCell>
                            {lead.follow_up ||
                              'لم تحدد'}
                          </TableCell>

                          <TableCell>
                            <button
                              onClick={() => {
                                setEdit(lead);
                                setOpen(
                                  true
                                );
                              }}
                              className="underline"
                            >
                              تحديث
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                !error && (
                  <div className="empty">
                    <h3>
                      {q
                        ? 'لا توجد نتائج'
                        : 'لا توجد طلبات عملاء بعد'}
                    </h3>

                    <p>
                      أضف عميلًا أو سجّل طلب
                      اهتمام من صفحة العقار.
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
                  {data.map(property => (
                    <TableRow
                      key={property.id}
                    >
                      <TableCell>
                        <a
                          className="underline"
                          href={
                            '/properties/' +
                            property.id
                          }
                        >
                          {property.title}
                        </a>
                      </TableCell>

                      <TableCell>
                        {property.price.toLocaleString(
                          'ar-SA'
                        )}{' '}
                        ر.س
                      </TableCell>

                      <TableCell>
                        {property.area} م²
                      </TableCell>

                      <TableCell>
                        مسودة معاينة
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="users">
            <UsersPanel />
          </TabsContent>
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
              key={edit?.id || 'new'}
              initial={edit}
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