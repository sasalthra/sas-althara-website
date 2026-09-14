"use client";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  Clock3,
  House,
  MapPin,
  Plus,
  UserRound,
  ClipboardList,
  ArrowLeft,
  Bell,
} from "lucide-react";
import {
  serviceTypes,
  serviceSchema,
  attendanceCalendar,
  localDay,
} from "@/lib/hr-policy";
import EmployeeAdmin, { type EmployeeProfile } from "./employee-admin";
import { CrmLink, navigateCrm, useCrmQuery } from "./navigation";
type Kind = keyof typeof serviceTypes;
type State = {
  month: string;
  calendarLeaves: {
    user_id: string;
    type: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
  }[];
  userId: string;
  serverTime: string;
  profiles: EmployeeProfile[];
  attendance: {
    user_id: string;
    work_day: string;
    check_in: string;
    check_out: string | null;
    late_minutes: number;
  }[];
  requests: {
    id: string;
    user_id: string;
    name: string;
    type: Kind;
    details: string;
    status: string;
    start_date: string | null;
    end_date: string | null;
    review_note: string | null;
  }[];
  announcements: { id: string; title: string; details: string }[];
};
const sections = [
  { id: "home", name: "الرئيسية", icon: House },
  { id: "attendance", name: "الحضور", icon: CalendarDays },
  { id: "requests", name: "الطلبات", icon: ClipboardList },
  { id: "profile", name: "ملفي", icon: UserRound },
];
const statuses: Record<string, string> = {
  pending: "قيد المراجعة",
  approved: "معتمد",
  rejected: "مرفوض",
};
const dayLabels: Record<string, string> = {
  present: "حضور",
  late: "تأخير",
  leave: "إجازة معتمدة",
  off: "راحة",
  scheduled: "دوام مجدول",
  no_record: "لا يوجد تسجيل",
};
const categories: { title: string; kinds: Kind[] }[] = [
  {
    title: "الحضور والانصراف",
    kinds: ["overtime", "permission", "correction"],
  },
  { title: "المالية", kinds: ["loan", "expenses"] },
  { title: "الموارد البشرية", kinds: ["leave", "custody", "trip", "visa"] },
];
export default function HrPanel({ admin }: { admin: boolean }) {
  const query = useCrmQuery(),
    requested = query.get("hr") || "home";
  const calendarUser = admin ? query.get("attendanceEmployee") || "" : "";
  const section =
    sections.some((s) => s.id === requested) ||
    (admin && ["employees", "review"].includes(requested))
      ? requested
      : "home";
  const [dailyAttendance,setDailyAttendance]=useState<State["attendance"]>([]);
  const [state, setState] = useState<State | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(""),
    [loadError, setLoadError] = useState("");
  const [kind, setKind] = useState<Kind>("leave"),
    [details, setDetails] = useState(""),
    [month, setMonth] = useState(""),
    [day, setDay] = useState(""),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [search, setSearch] = useState(""),
    [locationState, setLocationState] = useState(
      "سيتم التحقق من موقعك عند التسجيل",
    );
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/hr", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "تعذر تحميل الملف");
        setState(d);
        setDailyAttendance(d.attendance);
        setMonth(d.month);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setLoadError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function load(requestedMonth=section === "attendance" ? month : "") {
    setLoading(true);
    setLoadError("");
    try {
      const r = await fetch(
        "/api/hr" + (requestedMonth ? "?month=" + encodeURIComponent(requestedMonth) : ""),
        { cache: "no-store" },
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "تعذر التحميل");
      setState(d);
      const own=d.profiles.find((p:EmployeeProfile)=>p.user_id===d.userId);
      if(own&&d.month===localDay(new Date(d.serverTime),own.schedule.timezone).slice(0,7))setDailyAttendance(d.attendance);
      setMonth(d.month);
      return true;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "تعذر التحميل");
      return false;
    } finally {
      setLoading(false);
    }
  }
  async function send(data: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/hr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "تعذر الحفظ");
      const refreshed = await load();
      setMessage(
        refreshed
          ? "تم الحفظ"
          : "تم الحفظ؛ تعذر تحديث العرض. أعد التحميل قبل أي إجراء آخر.",
      );
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "تعذر الحفظ");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function punch(kind: "in" | "out") {
    if (!navigator.geolocation) {
      setLocationState("الموقع غير متاح على هذا الجهاز");
      return;
    }
    setBusy(true);
    setLocationState("جارٍ تحديد الموقع والتحقق من النطاق…");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const ok = await send({
          action: "punch",
          id: crypto.randomUUID(),
          kind,
          point: {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
          },
        });
        setLocationState(
          ok
            ? "تم التحقق من الموقع عند التسجيل"
            : "لم يكتمل التسجيل — راجع رسالة التحقق",
        );
      },
      () => {
        setBusy(false);
        setLocationState(
          "تعذر تحديد الموقع. اسمح بالوصول واستخدم HTTPS ثم حاول مجدداً.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }
  const mine = state?.profiles.find((p) => p.user_id === state.userId),
    today =
      state && mine
        ? localDay(new Date(state.serverTime), mine.schedule.timezone)
        : "";
  const todayPunch = dailyAttendance.find(
    (a) => a.user_id === state?.userId && a.work_day === today,
  );
  const calendarProfile = state?.profiles.find(
    (p) => p.user_id === (calendarUser || state.userId),
  );
  const calendar =
    state && calendarProfile
      ? attendanceCalendar(
          state.month,
          state.attendance.filter((a) => a.user_id === calendarProfile.user_id),
          state.calendarLeaves.filter(
            (r) => r.user_id === calendarProfile.user_id,
          ),
          calendarProfile.schedule.days,
          localDay(
            new Date(state.serverTime),
            calendarProfile.schedule.timezone,
          ),
        )
      : [];
  const selectedDay =
    calendar.find((d) => d.day === day) ||
    calendar.find((d) => d.day === today) ||
    calendar[0];
  const ownRequests =
    state?.requests.filter((r) => r.user_id === state.userId) || [];
  const time = (value: string | null | undefined) =>
    value
      ? new Date(value).toLocaleTimeString("ar-SA", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone:
            calendarProfile?.schedule.timezone || mine?.schedule.timezone,
        })
      : "لا يوجد تسجيل";
  const missing = !loading && state && !mine;
  const missingCard = missing && (
    <div className="hr-notice">
      <h3>ملفك الوظيفي غير مرتبط بعد</h3>
      <p>
        {state.userId.startsWith("google:")
          ? "حساب Google إداري مستقل عن حسابات الموظفين. أنشئ حساب CRM محلياً باسمك إن لم يكن موجوداً، واضبط ملفه ثم سجّل الدخول به للحضور. لا نربطك تلقائياً بأي موظف."
          : "لم تضبط الإدارة ملف حسابك والدوام والموقع بعد. لا يمكن تسجيل الحضور قبل الإعداد."}
      </p>
      {admin ? (
        <CrmLink
          href={`/crm?tab=hr&hr=employees${state.userId.startsWith("google:") ? "" : "&employee=" + encodeURIComponent(state.userId)}`}
        >
          إعداد ملف موظف <ArrowLeft size={16} />
        </CrmLink>
      ) : (
        <p>تواصل مع مسؤول الموارد البشرية لإكمال الإعداد.</p>
      )}
    </div>
  );
  function requestCards(rows: State["requests"]) {
    return rows.length ? (
      rows.map((r) => (
        <article className="hr-request" key={r.id}>
          <div>
            <h3>{serviceTypes[r.type]}</h3>
            <span className="hr-status" data-status={r.status}>
              {statuses[r.status] || r.status}
            </span>
          </div>
          {section === "review" && <p>{r.name}</p>}
          <p>{r.details}</p>
          {r.start_date && (
            <p>
              <bdi>
                {r.start_date} — {r.end_date}
              </bdi>
            </p>
          )}
          {r.review_note && <p>ملاحظة الإدارة: {r.review_note}</p>}
          {section === "review" &&
            admin &&
            r.status === "pending" &&
            r.user_id !== state?.userId && (
              <form
                className="hr-review-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void send({
                    action: "review",
                    data: {
                      id: r.id,
                      status: f.get("status"),
                      note: f.get("note"),
                    },
                  });
                }}
              >
                <label>
                  ملاحظة الاعتماد
                  <input name="note" required minLength={3} maxLength={2000} />
                </label>
                <label>
                  القرار
                  <select name="status">
                    <option value="approved">اعتماد</option>
                    <option value="rejected">رفض</option>
                  </select>
                </label>
                <button disabled={busy}>حفظ القرار</button>
              </form>
            )}
        </article>
      ))
    ) : (
      <p className="hr-empty">لا توجد طلبات للعرض.</p>
    );
  }
  return (
    <section className="hr-workspace" dir="rtl">
      <div className="hr-section-heading">
        <div>
          <span className="hr-kicker">الموارد البشرية / الخدمة الذاتية</span>
          <h2>
            {section === "home"
              ? "يومي الوظيفي"
              : section === "attendance"
                ? "سجل الحضور"
                : section === "requests"
                  ? "طلباتي والخدمات"
                  : section === "profile"
                    ? "ملفي الوظيفي"
                    : section === "employees"
                      ? "إدارة الموظفين"
                      : "مراجعة الطلبات والإعلانات"}
          </h2>
        </div>
        <button
          onClick={() => void load()}
          disabled={busy || loading}
          className="crm-button"
        >
          {loading ? "جارٍ التحميل…" : "تحديث البيانات"}
        </button>
      </div>
      <nav className="hr-nav" aria-label="خدمات الموظف">
        {sections.map((s) => (
          <CrmLink
            key={s.id}
            href={`/crm?tab=hr&hr=${s.id}`}
            aria-current={section === s.id ? "page" : undefined}
          >
            <s.icon size={19} />
            {s.name}
          </CrmLink>
        ))}
      </nav>
      {admin && (
        <nav className="hr-admin-nav" aria-label="إدارة الموارد البشرية">
          <span>للإدارة فقط</span>
          <CrmLink
            href="/crm?tab=hr&hr=employees"
            aria-current={section === "employees" ? "page" : undefined}
          >
            دليل الموظفين والدوام
          </CrmLink>
          <CrmLink
            href="/crm?tab=hr&hr=review"
            aria-current={section === "review" ? "page" : undefined}
          >
            الاعتمادات والإعلانات
          </CrmLink>
        </nav>
      )}
      {loadError && (
        <p role="alert" className="hr-notice">
          {loadError} — استخدم تحديث البيانات لإعادة المحاولة.
        </p>
      )}
      {message && (
        <p role="status" className="hr-notice">
          {message}
        </p>
      )}
      {section === "home" && (
        <>
          <div className="hr-home-grid">
            <div className="hr-card hr-attendance">
              <div className="hr-card-heading">
                <h3>
                  <Clock3 size={20} /> حضور اليوم
                </h3>
                <span className="hr-status">
                  {todayPunch?.check_out
                    ? "اكتمل اليوم"
                    : todayPunch
                      ? "تم تسجيل حضورك"
                      : "لم يسجل الحضور"}
                </span>
              </div>
              <p>
                {mine ? `مرحباً، ${mine.name}` : "أهلاً بك في مساحة الموظف"}
              </p>
              <span className="hr-muted">وقت الخادم عند آخر تحديث</span>
              <strong className="hr-clock" dir="ltr">
                {state ? time(state.serverTime) : "—"}
              </strong>
              <p>
                {mine ? (
                  <>
                    <bdi dir="ltr">
                      {mine.schedule.start} — {mine.schedule.end}
                    </bdi>
                    <br />
                    <bdi>{mine.schedule.timezone}</bdi>
                  </>
                ) : (
                  "الدوام بانتظار الإعداد"
                )}
              </p>
              <div className="hr-punches">
                <span>
                  أول حضور<strong>{time(todayPunch?.check_in)}</strong>
                </span>
                <span>
                  آخر انصراف<strong>{time(todayPunch?.check_out)}</strong>
                </span>
              </div>
              <button
                className="primary hr-punch"
                disabled={
                  busy ||
                  loading ||
                  !!loadError ||
                  !mine ||
                  !!todayPunch?.check_out
                }
                onClick={() => punch(todayPunch ? "out" : "in")}
              >
                {busy
                  ? "جارٍ التحقق…"
                  : todayPunch?.check_out
                    ? "اكتمل تسجيل اليوم"
                    : todayPunch
                      ? "تسجيل انصراف"
                      : "تسجيل حضور"}
              </button>
              <div className="hr-location">
                <MapPin size={18} />
                <span>
                  {locationState}
                  {mine && (
                    <small>نطاق مسموح واحد · {mine.schedule.radius} متر</small>
                  )}
                </span>
              </div>
            </div>
            <div className="hr-overview">
              <div className="hr-card">
                <h3>عمليات سريعة</h3>
                <div className="hr-quick">
                  {(["leave", "correction"] as Kind[]).map((k) => (
                    <CrmLink
                      key={k}
                      href="/crm?tab=hr&hr=requests"
                      onNavigate={() => setKind(k)}
                    >
                      <Plus size={18} />
                      {serviceTypes[k]}
                    </CrmLink>
                  ))}
                  <CrmLink href="/crm?tab=hr&hr=profile">
                    <UserRound size={18} />
                    عرض ملفي
                  </CrmLink>
                </div>
              </div>
              <div className="hr-card hr-balances">
                <div>
                  <span>رصيد الإجازات</span>
                  <strong>
                    {mine?.leave_balance ?? "—"} <small>يوم</small>
                  </strong>
                  <p>رصيد معتمد يدوياً</p>
                </div>
                <div>
                  <span>طلبات قيد المراجعة</span>
                  <strong>
                    {ownRequests.filter((r) => r.status === "pending").length}
                  </strong>
                  <CrmLink href="/crm?tab=hr&hr=requests">عرض طلباتي ←</CrmLink>
                </div>
              </div>
              <div className="hr-card">
                <h3>
                  <Bell size={18} /> الإعلانات
                </h3>
                {state?.announcements.length ? (
                  state.announcements.slice(0, 3).map((a) => (
                    <article className="hr-announcement" key={a.id}>
                      <h4>{a.title}</h4>
                      <p>{a.details}</p>
                    </article>
                  ))
                ) : (
                  <p className="hr-empty">لا توجد إعلانات حالياً.</p>
                )}
              </div>
            </div>
          </div>
          {missingCard}
          <div className="hr-card">
            <div className="hr-card-heading">
              <h3>آخر طلباتي</h3>
              <CrmLink href="/crm?tab=hr&hr=requests">كل الطلبات ←</CrmLink>
            </div>
            {requestCards(ownRequests.slice(0, 3))}
          </div>
          <p className="hr-footnote">
            يُستخدم وقت الخادم عند التسجيل. الموقع يُفحص عند الإجراء، ولا يضمن
            المتصفح منع انتحال GPS.
          </p>
        </>
      )}
      {section === "attendance" && (
        <div className="hr-card">
          {missingCard}
          <div className="hr-calendar-tools">
            <label>
              الشهر
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
            <button
              className="crm-button"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              عرض الشهر
            </button>
            {admin && (
              <label>
                موظف التقويم
                <select
                  value={calendarUser}
                  onChange={(e) => {
                    navigateCrm(`/crm?tab=hr&hr=attendance&attendanceEmployee=${encodeURIComponent(e.target.value)}`);
                    setDay("");
                  }}
                >
                  <option value="">حسابي</option>
                  {state?.profiles.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="hr-muted">الشهر المعروض: {state?.month || "—"}</p>
          {calendar.length > 0 && (
            <>
              <div className="hr-calendar" aria-label="تقويم الحضور">
                {[
                  "أحد",
                  "إثنين",
                  "ثلاثاء",
                  "أربعاء",
                  "خميس",
                  "جمعة",
                  "سبت",
                ].map((d) => (
                  <span key={d}>{d}</span>
                ))}
                {Array.from({ length: calendar[0].weekday }, (_, i) => (
                  <span key={"blank" + i} />
                ))}
                {calendar.map((d) => (
                  <button
                    type="button"
                    key={d.day}
                    data-status={d.status}
                    aria-label={`${d.day} ${dayLabels[d.status]}`}
                    aria-pressed={selectedDay?.day === d.day}
                    onClick={() => setDay(d.day)}
                  >
                    <time dateTime={d.day}>{Number(d.day.slice(-2))}</time>
                    <small>{dayLabels[d.status]}</small>
                  </button>
                ))}
              </div>
              <p className="hr-footnote">
                الحضور بلون أخضر، التأخير كهرماني، الإجازة بنفسجي. عدم التسجيل
                ليس حكماً بالغياب أو خصماً.
              </p>
              {selectedDay && (
                <section className="hr-day-detail">
                  <h3>
                    تفاصيل يوم <bdi>{selectedDay.day}</bdi>
                  </h3>
                  <p>
                    الدوام: {calendarProfile?.schedule.start} —{" "}
                    {calendarProfile?.schedule.end}
                  </p>
                  <div className="hr-punches">
                    <span>
                      أول حضور<strong>{time(selectedDay.checkIn)}</strong>
                    </span>
                    <span>
                      آخر انصراف<strong>{time(selectedDay.checkOut)}</strong>
                    </span>
                    <span>
                      السماح
                      <strong>{calendarProfile?.schedule.grace} دقيقة</strong>
                    </span>
                    <span>
                      التأخير بعد السماح
                      <strong>{selectedDay.lateMinutes} دقيقة</strong>
                    </span>
                  </div>
                </section>
              )}
            </>
          )}
          <p className="hr-footnote">
            أيام العمل بحسب الإعداد الحالي؛ لا يوجد أرشيف لتغييرات الدوام.
          </p>
        </div>
      )}
      {section === "requests" && (
        <div className="hr-request-layout">
          <div className="hr-card">
            <h3>طلب جديد</h3>
            <label>
              بحث الخدمات
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث عن إجازة أو خدمة…"
              />
            </label>
            <div className="hr-categories">
              {categories.map((c) => (
                <div key={c.title}>
                  <h4>{c.title}</h4>
                  {c.kinds
                    .filter((k) => serviceTypes[k].includes(search.trim()))
                    .map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={kind === k}
                        onClick={() => setKind(k)}
                      >
                        {serviceTypes[k]}
                        <ArrowLeft size={16} />
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <div>
            <form
              className="hr-card hr-request-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const data = {
                  id: crypto.randomUUID(),
                  type: kind,
                  details,
                  ...(kind === "leave" ? { startDate, endDate } : {}),
                };
                if (!serviceSchema.safeParse(data).success) {
                  setMessage("راجع تفاصيل الطلب وتواريخ الإجازة");
                  return;
                }
                if (await send({ action: "request", data })) {
                  setDetails("");
                  setStartDate("");
                  setEndDate("");
                }
              }}
            >
              <h3>{serviceTypes[kind]}</h3>
              {kind === "leave" && (
                <div className="hr-form-grid">
                  <label>
                    بداية الإجازة
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </label>
                  <label>
                    نهاية الإجازة
                    <input
                      type="date"
                      required
                      min={startDate}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </label>
                </div>
              )}
              <label>
                التفاصيل والتواريخ والمبالغ المطلوبة
                <textarea
                  required
                  minLength={5}
                  maxLength={4000}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                />
              </label>
              <p className="hr-footnote">
                الطلب للمراجعة الإدارية فقط؛ لا يغيّر أرصدة الإجازات أو البصمات
                ولا يرحّل مبالغ للمالية تلقائياً.
              </p>
              <button
                className="primary"
                disabled={busy || loading || !state || !!loadError}
              >
                إرسال الطلب
              </button>
            </form>
            <div className="hr-card">
              <h3>متابعة طلباتي</h3>
              {requestCards(ownRequests)}
            </div>
          </div>
        </div>
      )}
      {section === "profile" && (
        <div className="hr-card hr-profile">
          {missingCard}
          {mine && (
            <>
              <div className="hr-profile-heading">
                <span className="hr-avatar">
                  <UserRound size={30} />
                </span>
                <div>
                  <h3>{mine.name}</h3>
                  <p>
                    {mine.job_title} · {mine.department}
                  </p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>حالة الربط</dt>
                  <dd>مرتبط بحسابك الحالي</dd>
                </div>
                <div>
                  <dt>رصيد الإجازة</dt>
                  <dd>{mine.leave_balance} يوم — يدوي</dd>
                </div>
                <div>
                  <dt>الدوام</dt>
                  <dd>
                    <bdi>
                      {mine.schedule.start} — {mine.schedule.end}
                    </bdi>
                  </dd>
                </div>
                <div>
                  <dt>المنطقة الزمنية</dt>
                  <dd>
                    <bdi>{mine.schedule.timezone}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>أيام العمل</dt>
                  <dd>
                    {mine.schedule.days
                      .map(
                        (d) =>
                          [
                            "الأحد",
                            "الإثنين",
                            "الثلاثاء",
                            "الأربعاء",
                            "الخميس",
                            "الجمعة",
                            "السبت",
                          ][d],
                      )
                      .join("، ")}
                  </dd>
                </div>
                <div>
                  <dt>الموقع المسموح</dt>
                  <dd>
                    نطاق {mine.schedule.radius} متر؛ الدقة القصوى{" "}
                    {mine.schedule.maxAccuracy} متر
                  </dd>
                </div>
              </dl>
              <p className="hr-footnote">
                تعديل الدوام والموقع والرصيد من اختصاص الإدارة.
              </p>
              {admin && (
                <CrmLink
                  className="crm-button"
                  href={`/crm?tab=hr&hr=employees&employee=${encodeURIComponent(mine.user_id)}`}
                >
                  إدارة ملفي والدوام
                </CrmLink>
              )}
            </>
          )}
        </div>
      )}
      {section === "employees" && admin && state && (
        <EmployeeAdmin
          key={query.get("employee") || "directory"}
          profiles={state?.profiles || []}
          busy={busy || loading || !!loadError}
          send={send}
        />
      )}
      {section === "review" && admin && (
        <>
          <div className="hr-card">
            <h3>طلبات الموظفين</h3>
            <p className="hr-footnote">
              لا يمكن اعتماد طلبك الشخصي. القرار لا ينفذ تعديلاً مالياً أو تصحيح
              حضور تلقائياً.
            </p>
            {requestCards(state?.requests || [])}
          </div>
          <form
            className="hr-card hr-request-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void send({
                action: "announcement",
                data: { title: f.get("title"), details: f.get("details") },
              });
            }}
          >
            <h3>إعلان جديد</h3>
            <label>
              العنوان
              <input name="title" required minLength={2} maxLength={150} />
            </label>
            <label>
              النص
              <textarea
                name="details"
                required
                minLength={2}
                maxLength={3000}
              />
            </label>
            <button className="primary" disabled={busy}>
              نشر الإعلان للموظفين
            </button>
          </form>
        </>
      )}
    </section>
  );
}
