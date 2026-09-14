"use client";
import { useEffect, useState } from "react";
import { CrmLink, navigateCrm, useCrmQuery } from "./navigation";
import { scheduleSchema } from "@/lib/hr-policy";
export type EmployeeProfile = {
  user_id: string;
  name: string;
  job_title: string;
  department: string;
  leave_balance: number;
  schedule: {
    latitude: number;
    longitude: number;
    radius: number;
    maxAccuracy: number;
    start: string;
    end: string;
    grace: number;
    days: number[];
    timezone: string;
  };
};
type Account = {
  id: string;
  name: string;
  username: string;
  active: number;
  role: string;
};
export default function EmployeeAdmin({
  profiles,
  busy,
  send,
}: {
  profiles: EmployeeProfile[];
  busy: boolean;
  send: (data: unknown) => Promise<boolean>;
}) {
  const query = useCrmQuery(),
    requested = query.get("employee") || "";
  const [accounts, setAccounts] = useState<Account[]>([]),
    [error, setError] = useState("");
  const userId = requested,
    selected = profiles.find((p) => p.user_id === userId),
    account = accounts.find((a) => a.id === userId);
  function selectEmployee(id: string) {
    navigateCrm(`/crm?tab=hr&hr=employees&employee=${encodeURIComponent(id)}`);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/crm-users", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "تعذر تحميل الحسابات");
        setAccounts(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget),
      number = (key: string) => Number(f.get(key));
    if (!account || !account.active) {
      setError("اختر حساب CRM نشطاً من القائمة");
      return;
    }
    const schedule = scheduleSchema.safeParse({
      latitude: number("latitude"),
      longitude: number("longitude"),
      radius: number("radius"),
      maxAccuracy: number("maxAccuracy"),
      start: f.get("start"),
      end: f.get("end"),
      grace: number("grace"),
      days: f.getAll("days").map(Number),
      timezone: f.get("timezone"),
    });
    if (!schedule.success) {
      setError(
        "راجع الموقع ودقته، اختر أيام عمل، وتأكد أن نهاية الدوام بعد بدايته والمنطقة الزمنية صحيحة.",
      );
      return;
    }
    await send({
      action: "profile",
      data: {
        userId: account.id,
        jobTitle: f.get("jobTitle"),
        department: f.get("department"),
        leaveBalance: number("leaveBalance"),
        schedule: schedule.data,
      },
    });
  }
  return (
    <div className="hr-admin">
      <div className="hr-section-heading">
        <div>
          <h2>دليل الموظفين</h2>
          <p>ربط صريح بحساب CRM؛ لا يغيّر دور المستخدم أو صلاحياته.</p>
        </div>
        <CrmLink className="crm-button" href="/crm?tab=users">
          إنشاء حساب / الصلاحيات
        </CrmLink>
      </div>
      <div className="hr-directory">
        {accounts.map((a) => (
          <button
            type="button"
            key={a.id}
            aria-pressed={userId === a.id}
            onClick={() => selectEmployee(a.id)}
          >
            <strong>{a.name}</strong>
            <span dir="ltr">{a.username}</span>
            <small>
              {!a.active
                ? "حساب موقوف"
                : profiles.some((p) => p.user_id === a.id)
                  ? "ملف وظيفي مرتبط"
                  : "بانتظار إعداد الملف"}
            </small>
          </button>
        ))}
      </div>
      {!accounts.length && !error && <p>جارٍ تحميل حسابات الموظفين…</p>}
      <form
        key={userId + (selected ? "existing" : "new")}
        className="hr-card hr-employee-form"
        onSubmit={save}
      >
        <h3>{selected ? "تعديل الملف والدوام" : "إنشاء وربط ملف وظيفي"}</h3>
        <p className="hr-muted">
          استخدم بيانات الدوام والموقع المعتمدة فقط. لا توجد قيم افتراضية لموقع
          الشركة.
        </p>
        <label>
          حساب الموظف
          <select
            name="userId"
            required
            value={userId}
            onChange={(e) => selectEmployee(e.target.value)}
          >
            <option value="">اختر حساب CRM نشطاً</option>
            {accounts
              .filter((a) => a.active || a.id === userId)
              .map((a) => (
                <option key={a.id} value={a.id} disabled={!a.active}>
                  {a.name} — {a.username}
                </option>
              ))}
          </select>
        </label>
        {account && (
          <p className="hr-notice">
            سيتم حفظ الملف لحساب <strong>{account.name}</strong> (
            <bdi>{account.username}</bdi>) فقط. لا يؤدي الربط إلى نقل حضور
            مستخدم آخر.
          </p>
        )}
        <fieldset>
          <legend>البيانات الوظيفية</legend>
          <div className="hr-form-grid">
            <label>
              المسمى الوظيفي
              <input
                name="jobTitle"
                required
                maxLength={100}
                defaultValue={selected?.job_title}
              />
            </label>
            <label>
              القسم
              <input
                name="department"
                required
                maxLength={100}
                defaultValue={selected?.department}
              />
            </label>
            <label>
              رصيد إجازات يدوي
              <input
                name="leaveBalance"
                type="number"
                min="0"
                max="365"
                step="any"
                required
                defaultValue={selected?.leave_balance}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>الدوام وأيام العمل</legend>
          <div className="hr-form-grid">
            <label>
              بداية الدوام
              <input
                name="start"
                type="time"
                required
                defaultValue={selected?.schedule.start}
              />
            </label>
            <label>
              نهاية الدوام
              <input
                name="end"
                type="time"
                required
                defaultValue={selected?.schedule.end}
              />
            </label>
            <label>
              السماح بالدقائق
              <input
                name="grace"
                type="number"
                min="0"
                max="120"
                required
                defaultValue={selected?.schedule.grace}
              />
            </label>
            <label>
              المنطقة الزمنية IANA
              <input
                name="timezone"
                dir="ltr"
                placeholder="Asia/Riyadh"
                required
                defaultValue={selected?.schedule.timezone}
              />
            </label>
          </div>
          <div className="hr-weekdays">
            {[
              "الأحد",
              "الإثنين",
              "الثلاثاء",
              "الأربعاء",
              "الخميس",
              "الجمعة",
              "السبت",
            ].map((day, i) => (
              <label key={day}>
                <input
                  name="days"
                  type="checkbox"
                  value={i}
                  defaultChecked={selected?.schedule.days.includes(i)}
                />
                {day}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>الموقع المسموح للحضور</legend>
          <div className="hr-form-grid">
            {(["latitude", "longitude", "radius", "maxAccuracy"] as const).map(
              (key, i) => (
                <label key={key}>
                  {
                    [
                      "خط العرض",
                      "خط الطول",
                      "نصف القطر بالمتر",
                      "أقصى دقة بالمتر",
                    ][i]
                  }
                  <input
                    name={key}
                    type="number"
                    step="any"
                    min={[-90, -180, 1, 1][i]}
                    max={[90, 180, 5000, 500][i]}
                    required
                    defaultValue={selected?.schedule[key]}
                  />
                </label>
              ),
            )}
          </div>
        </fieldset>
        <label className="hr-check">
          <input type="checkbox" required />
          راجعت الحساب والدوام والموقع وأوافق على حفظ الملف
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || !account?.active}>
          حفظ الملف والدوام
        </button>
      </form>
    </div>
  );
}
