'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Star} from 'lucide-react';

import Link from 'next/link';
import {CrmLink,navigateCrm,useCrmQuery,workspaceItems} from './navigation';
import './crm.css';
import {LogoutButton} from './auth-buttons';
import UsersPanel from './users-panel';
import HrPanel from './hr-panel';
import TransactionsPanel from './transactions-panel';
import ImportPanel from './import-panel';
import AiPanel from './ai-panel';
import SheetsPanel from './sheets-panel';
import TelegramPanel from './telegram-panel';
import ReportsPanel from './reports-panel';

import data from '@/data/properties.json';
import LeadForm, {
  Lead,
} from '@/app/lead-form';
import {formatRiyadhDate, riyadhDayKey} from '@/lib/lead-dates';
import {canBulkSelect} from '@/lib/bulk-lead-access';
import {canToggleFeatured, compareClients, featuredControlsEnabled, isFeaturedValue, isNewUnassignedLead} from '@/lib/lead-featured';
import LeadBulkBar from './lead-bulk-bar';
import NewLeadBadge from '@/components/new-lead-badge';
import {canonicalStage, displayStage, stageChoices, stageLabel} from '@/lib/lead-stages';
import {leadMatchesReportFilters} from '@/lib/lead-cohorts';
import {displayLeadPhone, leadPhoneMatchesQuery} from '@/lib/phone';

import {
  Tabs,
  TabsContent,
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
  userId?: string;
  aiEnvModel?: string | null;
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
  userId = '',
  aiEnvModel = null,
}: WorkspaceProps) {
  const query=useCrmQuery();
  const items=workspaceItems.filter(item=>item.roles.includes(role));
  const tab=items.some(item=>item.id===query.get('tab'))?query.get('tab')!:'leads';
  const [menuOpen,setMenuOpen]=useState(false);
  useEffect(()=>{
    if(!menuOpen)return;
    const sidebar=document.querySelector<HTMLElement>('.crm-sidebar');
    const previous=document.activeElement as HTMLElement|null;
    const links=Array.from(sidebar?.querySelectorAll<HTMLElement>('a,button')||[]).filter(el=>el.getClientRects().length>0);
    links[0]?.focus();
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    function keyboard(event:KeyboardEvent){
      if(event.key==='Escape'){event.preventDefault();setMenuOpen(false);}
      if(event.key==='Tab'&&links.length){
        const first=links[0],last=links[links.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    }
    window.addEventListener('keydown',keyboard);
    return()=>{window.removeEventListener('keydown',keyboard);document.body.style.overflow=overflow;previous?.focus();};
  },[menuOpen]);
  const [leads, setLeads] =
    useState<Lead[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [q, setQ] =
    useState('');

  const [stageFilter, setStageFilter] =
    useState('');
  const listStage = query.get('stage') || '';
  const listSource = query.get('source') || '';
  const listSourceExact = query.get('sourceExact') === '1';
  const listEmployee = query.get('employee') || '';
  const listEmployeeName = query.get('employeeName') || '';
  const listEmployeeUser = query.get('employeeUser') || '';
  const listOverdue = query.get('overdue') === '1';
  const listInactive = query.get('inactive') === '1' || query.get('noActivity') === '1';
  const listWaiting = query.get('waiting') === '1';
  const listGroup = query.get('stageGroup') || '';
  const listFrom = query.get('from') || '';
  const listTo = query.get('to') || '';
  const listScheduled = query.get('scheduled') === '1';
  const selectedStage = (() => {
    const raw = listStage || stageFilter;
    if (!raw) return '';
    const key = canonicalStage(raw) || displayStage(raw);
    return stageChoices().some(([stageKey]) => stageKey === key) ? key : '';
  })();

  const [leadView, setLeadView] =
    useState<'all' | 'followups'>('all');

  const [duplicateOnly, setDuplicateOnly] = useState(false);

  const [newOnly, setNewOnly] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [bulkNotice, setBulkNotice] = useState('');

  const pageSelectRef = useRef<HTMLInputElement>(null);

  const cardSelectRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] =
    useState(false);

  const [featureBusy, setFeatureBusy] =
    useState('');

  const [featureError, setFeatureError] =
    useState('');

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

  async function toggleFeatured(lead: Lead) {
    if (!canToggleFeatured({userId, role}, lead) || featureBusy) return;
    const next = !isFeaturedValue(lead.is_featured);
    setFeatureBusy(lead.id);
    setFeatureError('');
    try {
      const response = await fetch(`/api/leads/${lead.id}/featured`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({featured: next}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر تحديث التمييز');
      setLeads(current => current.map(item => item.id === lead.id ? {...item, is_featured: next ? 1 : 0} : item));
    } catch (toggleError) {
      setFeatureError(toggleError instanceof Error ? toggleError.message : 'تعذر تحديث التمييز');
    } finally {
      setFeatureBusy('');
    }
  }

  useEffect(() => {
    const controller=new AbortController();
    fetch('/api/leads',{cache:'no-store',signal:controller.signal})
      .then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.error||'تعذر التحميل');setLeads(result);setError('');})
      .catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'تعذر التحميل');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  }, []);

  useEffect(() => {
    function onLeadsChanged() {
      void refresh();
    }
    window.addEventListener('crm:leads-changed', onLeadsChanged);
    return () => window.removeEventListener('crm:leads-changed', onLeadsChanged);
  }, [refresh]);

  const today =
    new Date().toLocaleDateString(
      'en-CA'
    );

  const needsFollowUp = (lead: Lead) =>
    Boolean(
      lead.follow_up &&
      lead.follow_up <= today &&
      !['won', 'closed'].includes(lead.stage)
    );

  const duplicatePhones = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of leads) {
      const phone = displayLeadPhone(lead.phone);
      if (!phone) continue;
      counts.set(phone, (counts.get(phone) || 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1).map(([phone]) => phone);
  }, [leads]);
  const duplicatePhoneSet = useMemo(() => new Set(duplicatePhones), [duplicatePhones]);
  const canReviewDuplicates = role === 'admin' || role === 'supervisor';

  const shown =
    leads.filter(lead => {
      if (leadView === 'followups' && !needsFollowUp(lead)) {
        return false;
      }

      if (!listStage && stageFilter && displayStage(lead.stage) !== stageFilter) {
        return false;
      }

      if (!leadMatchesReportFilters(lead, {
        from: listFrom,
        to: listTo,
        stage: listStage,
        source: listSource,
        sourceExact: listSourceExact,
        employeeTokens: [listEmployee, listEmployeeName, listEmployeeUser],
        stageGroup: listGroup,
        overdue: listOverdue,
        inactive: listInactive,
        waiting: listWaiting,
        scheduled: listScheduled,
        today: riyadhDayKey(new Date()),
        nowMs: Date.now(),
      })) return false;

      if (duplicateOnly && canReviewDuplicates && !duplicatePhoneSet.has(displayLeadPhone(lead.phone))) {
        return false;
      }

      if (role === 'admin' && newOnly && !isNewUnassignedLead(lead)) {
        return false;
      }

      const property =
        data.find(
          property =>
            property.id ===
            lead.property_id
        );

      const phoneShown = displayLeadPhone(lead.phone);
      const queryText = q.trim();
      const searchable = [
        lead.name,
        phoneShown,
        property?.title || lead.property_other || '',
        lead.assigned_name || '',
        lead.field_assigned_name || '',
      ].join(' ');

      if (!queryText) return true;
      return searchable
        .toLowerCase()
        .includes(queryText.toLowerCase()) || leadPhoneMatchesQuery(phoneShown, queryText);
    }).sort((a, b) => compareClients(a, b));

  const followUps =
    leads.filter(needsFollowUp).length;

  const newUnassignedCount = leads.filter(isNewUnassignedLead).length;

  const bulkSelect = canBulkSelect(role);
  const shownIds = shown.map(lead => lead.id);
  const selectedOnPage = shownIds.filter(id => selectedIds.includes(id)).length;
  const pageAllSelected = shownIds.length > 0 && selectedOnPage === shownIds.length;

  useEffect(() => {
    const live = new Set(leads.map(lead => lead.id));
    setSelectedIds(current => {
      const next = current.filter(id => live.has(id));
      return next.length === current.length ? current : next;
    });
  }, [leads]);

  useEffect(() => {
    const indeterminate = selectedOnPage > 0 && !pageAllSelected;
    if (pageSelectRef.current) pageSelectRef.current.indeterminate = indeterminate;
    if (cardSelectRef.current) cardSelectRef.current.indeterminate = indeterminate;
  }, [selectedOnPage, pageAllSelected]);

  function toggleLead(id: string) {
    setBulkNotice('');
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function togglePage() {
    setBulkNotice('');
    setSelectedIds(current => {
      if (pageAllSelected) return current.filter(id => !shownIds.includes(id));
      return [...new Set([...current, ...shownIds])];
    });
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  return (
    <>
      <div className="crm-shell" dir="rtl">
      <a className="crm-skip" href="#crm-main">تخطي إلى المحتوى</a>
      {menuOpen&&<button className="crm-scrim" aria-label="إغلاق القائمة" onClick={()=>setMenuOpen(false)}/>}
      <aside className={`crm-sidebar ${menuOpen?'is-open':''}`} aria-label="قائمة مساحة العمل">
        <Link href="/" className="crm-wordmark">ساس الثراء<span>مساحة العمل</span></Link>
        <button className="crm-menu-close" onClick={()=>setMenuOpen(false)}>إغلاق القائمة ×</button>
        <nav aria-label="التنقل الرئيسي">{['إدارة الأعمال','مساحة الموظف','إدارة النظام'].map(group=>{
          const entries=items.filter(item=>item.group===group);
          return entries.length>0&&<div className="crm-nav-group" key={group}><h2>{group}</h2>{entries.map(item=><CrmLink key={item.id} href={`/crm?tab=${item.id}`} aria-current={tab===item.id?'page':undefined} onNavigate={()=>setMenuOpen(false)}>{item.label}</CrmLink>)}</div>;
        })}</nav>
        <div className="crm-sidebar-footer"><span>جلسة {({admin:'الإدارة',supervisor:'الإشراف',sales:'المبيعات',field:'الميدان'})[role]}</span><LogoutButton /></div>
      </aside>
      <div className="crm-stage" inert={menuOpen||undefined}>
      <header className="crm-toolbar">
        <button className="crm-menu-toggle" aria-label="فتح القائمة" aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)}>☰</button>
        <div><span className="crm-breadcrumb">مساحة العمل /</span><h1>{items.find(item=>item.id===tab)?.label}</h1></div>
        <Link href="/" className="crm-site-link">معاينة الموقع ↗</Link>
        {tab==='leads'&&<button className="primary" onClick={()=>{setEdit(undefined);setOpen(true);}}>+ إضافة عميل</button>}
      </header>
      <main className="crm-main" id="crm-main">
        {tab==='leads'&&<div className="crm-summary"><button type="button" className="crm-summary-btn" data-active={leadView==='all'} onClick={()=>setLeadView('all')}>طلبات العملاء <strong>{loading?'—':leads.length}</strong></button><button type="button" className="crm-summary-btn" data-active={leadView==='followups'} onClick={()=>setLeadView('followups')}>تحتاج متابعة <strong>{loading?'—':followUps}</strong></button><span>العقارات <strong>{data.length}</strong></span></div>}
        <Tabs value={tab} dir="rtl">
          <TabsContent value="reports"><ReportsPanel role={role}/></TabsContent>
          {role === 'admin' && <TabsContent value="transactions"><TransactionsPanel key={query.get('lead')||'all'} leads={leads} initialLeadId={query.get('lead')||''}/></TabsContent>}
          <TabsContent value="hr"><HrPanel admin={role === 'admin'}/></TabsContent>
          {['admin', 'supervisor'].includes(role) && <TabsContent value="ai"><AiPanel admin={role === 'admin'} envModel={aiEnvModel}/></TabsContent>}
          {role === 'admin' && <TabsContent value="sheets"><SheetsPanel/></TabsContent>}
          {role === 'admin' && <TabsContent value="telegram"><TelegramPanel/></TabsContent>}
          {['admin','supervisor'].includes(role) && <TabsContent value="import"><ImportPanel onSaved={()=>void refresh()}/></TabsContent>}
          <TabsContent value="leads">
            <div className="panel !py-6">
              <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="mb-1">
                    {leadView === 'followups' ? 'المتابعات المستحقة' : 'سجل العملاء'}
                  </h2>

                  <p className="subtle">
                    {leadView === 'followups'
                      ? 'العملاء الذين موعد متابعتهم اليوم أو قبله، باستثناء المغلق.'
                      : 'اضغط على اسم العميل لعرض الملف الكامل.'}
                  </p>
                  {role === 'admin' ? (
                    <p className="mt-3">
                      <CrmLink className="crm-button" href="/crm?tab=users#purge-employee-clients">
                        حذف عملاء موظف
                      </CrmLink>
                    </p>
                  ) : null}
                </div>

                <label className="w-full lg:w-56">
                  <span className="mb-1 block text-sm text-black">المرحلة</span>
                  <select
                    aria-label="تصفية المرحلة"
                    value={selectedStage}
                    onChange={event => {
                      const value = event.target.value;
                      setStageFilter(value);
                      const next = new URLSearchParams(query);
                      next.set('tab', 'leads');
                      if (value) next.set('stage', value); else next.delete('stage');
                      navigateCrm('/crm?' + next.toString());
                    }}
                    className="w-full rounded-lg border border-[#d1d5db] bg-white px-3 py-2 text-black"
                  >
                    <option value="">كل المراحل</option>
                    {stageChoices().map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </label>

                {role === 'admin' ? (
                  <button
                    type="button"
                    className="w-full rounded-lg border border-[#d1d5db] bg-white px-3 py-2 text-right text-black lg:w-auto"
                    style={newOnly ? {background: '#3F1A44', color: '#fff', borderColor: '#3F1A44'} : undefined}
                    aria-pressed={newOnly}
                    onClick={() => setNewOnly(value => !value)}
                  >
                    جدد غير مسندين <strong>{loading ? '—' : newUnassignedCount}</strong>
                  </button>
                ) : null}

                {canReviewDuplicates ? (
                  <div className="w-full rounded-lg border border-[#d1d5db] bg-white p-3 text-black lg:w-[280px]">
                    <button
                      type="button"
                      className="w-full rounded-lg border border-[#d1d5db] px-3 py-2 text-right text-black"
                      style={duplicateOnly ? {background: '#3F1A44', color: '#fff', borderColor: '#3F1A44'} : undefined}
                      aria-pressed={duplicateOnly}
                      onClick={() => setDuplicateOnly(value => !value)}
                    >
                      أرقام مكررة <strong>{duplicatePhones.length}</strong>
                    </button>
                    {duplicatePhones.length ? (
                      <ul className="mt-2 space-y-1 text-sm text-black">
                        {duplicatePhones.map(phone => (
                          <li key={phone} dir="ltr" className="truncate">{phone}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-black">لا توجد أرقام مكررة.</p>
                    )}
                  </div>
                ) : null}

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

              {featureError && (
                <p role="alert" className="error">
                  {featureError}
                </p>
              )}

              {bulkNotice ? (
                <p role="status" className="crm-bulk-status">{bulkNotice}</p>
              ) : null}

              <LeadBulkBar
                role={role}
                ids={selectedIds}
                onClear={clearSelection}
                onDone={message => {
                  setBulkNotice(message);
                  setSelectedIds([]);
                  void refresh();
                }}
              />

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

              {(listStage || listSource || listEmployee || listEmployeeName || listOverdue || listInactive || listWaiting || listGroup || listFrom || listTo) ? (
                <div className="reports-filter-banner" role="status">
                  <p>
                    {listOverdue ? 'مواعيد متابعة متأخرة: الموظف في عمود المبيعات، والموعد في عمود المتابعة. ' : ''}
                    {listWaiting ? 'عملاء جدد غير مسندين منذ أكثر من 24 ساعة. ' : ''}
                    {listInactive ? 'عملاء بلا تحديث منذ 7 أيام أو أكثر. ' : ''}
                    {listGroup === 'interested' ? 'المهتمون ومن بعدهم في مسار العمل. ' : ''}
                    {listGroup === 'not_interested' ? 'غير مهتم أو غير مؤهل. ' : ''}
                    {listGroup === 'signed' ? 'وقع عقد أو إفراغ. ' : ''}
                    {listGroup === 'closed' ? 'مرحلة مغلق. ' : ''}
                    {listGroup === 'unassigned_new' ? 'عملاء جدد بلا إسناد. ' : ''}
                    {listGroup === 'contacted' ? 'مرحلة تم التواصل. ' : ''}
                    {listSource ? `المصدر: ${listSource}. ` : ''}
                    {(listEmployeeName || listEmployeeUser || listEmployee) ? `الموظف: ${listEmployeeName || listEmployeeUser || 'المحدد'}. ` : ''}
                    {(listFrom || listTo) ? `الفترة: ${listFrom || '…'} — ${listTo || '…'}. ` : ''}
                    الظاهر {shown.length} عميلاً.
                  </p>
                  <CrmLink href="/crm?tab=leads">مسح فلاتر القائمة</CrmLink>
                </div>
              ) : null}

              {loading ? (
                <p>
                  جارٍ تحميل العملاء…
                </p>
              ) : shown.length ? (
                <>
                  <div className="crm-lead-cards">
                    {bulkSelect ? (
                      <label className="crm-check crm-page-select">
                        <input
                          ref={cardSelectRef}
                          type="checkbox"
                          checked={pageAllSelected}
                          onChange={togglePage}
                          aria-label="تحديد الكل في هذه الصفحة"
                        />
                        <span>تحديد الكل في هذه الصفحة</span>
                      </label>
                    ) : null}
                    {shown.map((lead, index) => {
                      const property = data.find(item => item.id === lead.property_id);
                      const featured = isFeaturedValue(lead.is_featured);
                      const allowFeature = featuredControlsEnabled(lead) && canToggleFeatured({userId, role}, lead);
                      return (
                        <article key={lead.id} className={`crm-lead-card${featured ? ' is-featured' : ''}`}>
                          <div className="crm-lead-card-head">
                            {bulkSelect ? (
                              <label className="crm-check">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(lead.id)}
                                  onChange={() => toggleLead(lead.id)}
                                  aria-label={`تحديد ${lead.name}`}
                                />
                              </label>
                            ) : null}
                            <span className="crm-lead-index">{index + 1}</span>
                            {allowFeature ? (
                              <button
                                type="button"
                                aria-pressed={featured}
                                aria-label={featured ? `إلغاء تمييز ${lead.name}` : `تعليم ${lead.name} كعميل مميز`}
                                title={featured ? 'عميل مميز' : 'تعليم كعميل مميز'}
                                disabled={featureBusy === lead.id}
                                onClick={() => void toggleFeatured(lead)}
                                className={`inline-flex shrink-0 items-center justify-center rounded-full border p-1 disabled:opacity-60 ${featured ? 'border-[#3F1A44] bg-white text-[#3F1A44]' : 'border-slate-200 text-slate-400 hover:border-[#3F1A44] hover:text-[#3F1A44]'}`}
                              >
                                <Star className={`size-3.5 ${featured ? 'fill-[#3F1A44]' : ''}`} aria-hidden />
                              </button>
                            ) : featured ? (
                              <Star className="size-3.5 shrink-0 fill-[#3F1A44] text-[#3F1A44]" aria-hidden />
                            ) : null}
                            <a href={`/crm/leads/${lead.id}`} className="crm-lead-card-name">{lead.name}</a>
                            <NewLeadBadge lead={lead} />
                          </div>
                          {featured ? <span className="mt-1 inline-flex rounded-full bg-[#3F1A44] px-1.5 py-0.5 text-[10px] font-semibold text-white">عميل مميز</span> : null}
                          <p dir="ltr">{displayLeadPhone(lead.phone)}</p>
                          <p>{stageLabel(lead.stage)} · {lead.assigned_name || 'بدون تعيين'}</p>
                          <p>{compactPropertyTitle(property?.title || lead.property_other)}</p>
                        </article>
                      );
                    })}
                  </div>
                  <div className="crm-lead-table w-full overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <Table className="w-full min-w-[1380px] table-fixed">
                      <TableHeader>
                        <TableRow className="bg-slate-50/80">
                          {bulkSelect ? (
                            <TableHead className="w-10 px-2 text-center">
                              <input
                                ref={pageSelectRef}
                                type="checkbox"
                                checked={pageAllSelected}
                                onChange={togglePage}
                                aria-label="تحديد الكل في هذه الصفحة"
                              />
                            </TableHead>
                          ) : null}
                          <TableHead className="w-[3%] px-2 text-center">
                            #
                          </TableHead>

                          <TableHead className="w-[12%] px-2">
                            اسم العميل
                          </TableHead>

                          <TableHead className="w-[9%] px-2" title="بتوقيت الرياض">
                            تاريخ التسجيل
                          </TableHead>

                          <TableHead className="w-[10%] px-2">
                            الجوال
                          </TableHead>

                          <TableHead className="w-[12%] px-2">
                            العقار
                          </TableHead>

                          <TableHead className="w-[8%] px-2">
                            المرحلة
                          </TableHead>

                          <TableHead className="w-[9%] px-2">
                            المبيعات
                          </TableHead>

                          <TableHead className="w-[9%] px-2">
                            الميداني
                          </TableHead>

                          <TableHead className="w-[11%] px-2">
                            آخر تحديث مبيعات
                          </TableHead>

                          <TableHead className="w-[11%] px-2">
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

                            const featured = isFeaturedValue(lead.is_featured);
                            const allowFeature = featuredControlsEnabled(lead) && canToggleFeatured({userId, role}, lead);

                            return (
                              <TableRow
                                key={
                                  lead.id
                                }
                                className={`align-middle ${featured ? 'bg-[#f3eaf4]/60' : ''}`}
                              >
                                {bulkSelect ? (
                                  <TableCell className="px-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.includes(lead.id)}
                                      onChange={() => toggleLead(lead.id)}
                                      aria-label={`تحديد ${lead.name}`}
                                    />
                                  </TableCell>
                                ) : null}
                                <TableCell className="px-2 text-center text-sm text-muted-foreground">
                                  {index + 1}
                                </TableCell>

                                <TableCell className="px-2">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    {allowFeature ? (
                                      <button
                                        type="button"
                                        aria-pressed={featured}
                                        aria-label={featured ? `إلغاء تمييز ${lead.name}` : `تعليم ${lead.name} كعميل مميز`}
                                        title={featured ? 'عميل مميز' : 'تعليم كعميل مميز'}
                                        disabled={featureBusy === lead.id}
                                        onClick={() => void toggleFeatured(lead)}
                                        className={`inline-flex shrink-0 items-center justify-center rounded-full border p-1 disabled:opacity-60 ${featured ? 'border-[#3F1A44] bg-white text-[#3F1A44]' : 'border-slate-200 text-slate-400 hover:border-[#3F1A44] hover:text-[#3F1A44]'}`}
                                      >
                                        <Star className={`size-3.5 ${featured ? 'fill-[#3F1A44]' : ''}`} aria-hidden />
                                      </button>
                                    ) : featured ? (
                                      <Star className="size-3.5 shrink-0 fill-[#3F1A44] text-[#3F1A44]" aria-hidden />
                                    ) : null}
                                    <a
                                      href={`/crm/leads/${lead.id}`}
                                      className={`block min-w-0 truncate font-semibold underline underline-offset-4 ${featured ? 'font-bold text-[#3F1A44] decoration-[#3F1A44]/50' : 'text-[#5b2a72] decoration-[#5b2a72]/40 hover:decoration-[#5b2a72]'}`}
                                      title={lead.name}
                                    >
                                      {lead.name}
                                    </a>
                                    <NewLeadBadge lead={lead} />
                                  </div>
                                  {featured && (
                                    <span className="mt-1 inline-flex rounded-full bg-[#3F1A44] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                      عميل مميز
                                    </span>
                                  )}
                                </TableCell>

                                <TableCell className="px-2 text-sm whitespace-nowrap" title={riyadhDayKey(lead.created_at) || undefined}>
                                  {formatRiyadhDate(lead.created_at) || '—'}
                                </TableCell>

                                <TableCell
                                  dir="ltr"
                                  className="px-2 text-right text-sm"
                                >
                                  <div
                                    className="truncate"
                                    title={
                                      displayLeadPhone(lead.phone)
                                    }
                                  >
                                    {displayLeadPhone(lead.phone)}
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
                                  <span className="inline-flex max-w-full truncate rounded-full border border-[#e8e3e9] bg-[#f3eaf4] px-2.5 py-1 text-xs font-medium text-[#3F1A44]">
                                    {stageLabel(
                                      lead.stage
                                    )}
                                  </span>
                                </TableCell>

                                <TableCell className="px-2 text-sm">
                                  <div
                                    className="truncate"
                                    title={
                                      lead.assigned_name ||
                                      lead.assigned_username ||
                                      lead.assigned_to ||
                                      'بدون تعيين'
                                    }
                                  >
                                    {lead.assigned_name ||
                                      lead.assigned_username ||
                                      lead.assigned_to ||
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
                        : leadView === 'followups'
                          ? 'لا توجد متابعات مستحقة'
                          : 'لا توجد طلبات عملاء بعد'}
                    </h3>

                    <p>
                      {leadView === 'followups'
                        ? 'يظهر هنا من له تاريخ متابعة في ملف العميل بعد الاستيراد أو التعديل.'
                        : 'أضف عميلًا أو سجّل طلب اهتمام من صفحة العقار.'}
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
      </div></div>
    </>
  );
}
