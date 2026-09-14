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
const fieldLabels: Record<string, string> = {
  userId: "حساب الموظف", jobTitle: "المسمى الوظيفي", department: "القسم",
  leaveBalance: "رصيد إجازات يدوي", start: "بداية الدوام", end: "نهاية الدوام",
  grace: "السماح بالدقائق", timezone: "المنطقة الزمنية IANA", days: "أيام العمل",
  latitude: "خط العرض", longitude: "خط الطول", radius: "نصف القطر بالمتر",
  maxAccuracy: "أقصى دقة بالمتر", confirmation: "تأكيد المراجعة",
};
const scheduleHelp: Record<string, string> = {
  confirmation: "مطلوب قبل الحفظ: راجع البيانات المعتمدة ثم فعّل مربع تأكيد المراجعة.",
  latitude: "مطلوب: إحداثي معتمد من -90 إلى 90؛ الصفر قيمة صالحة وليس حقلاً فارغاً.",
  longitude: "مطلوب: إحداثي معتمد من -180 إلى 180؛ الصفر قيمة صالحة وليس حقلاً فارغاً.",
  radius: "مطلوب: أكبر من صفر وحتى 5000 متر، حسب النطاق المعتمد للحضور.",
  maxAccuracy: "مطلوب: أكبر من صفر وحتى 500 متر. تُرفض قراءة الموقع إذا تجاوز خطؤها هذه القيمة.",
  start: "مطلوب: وقت صحيح لبداية الدوام.",
  end: "مطلوب: وقت صحيح بعد بداية الدوام؛ الدوام الليلي يحتاج إعداداً منفصلاً.",
  grace: "مطلوب: عدد صحيح من 0 إلى 120 دقيقة.",
  days: "مطلوب: اختر يوم عمل واحداً على الأقل وفق الدوام المعتمد.",
  timezone: "مطلوب: منطقة زمنية IANA صحيحة، مثل Asia/Riyadh؛ المثال ليس قيمة محفوظة.",
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
  const [validation, setValidation] = useState<{ userId: string; fields: Record<string, string> }>({ userId: "", fields: {} });
  const fieldErrors = validation.userId === userId ? validation.fields : {};
  function fieldProps(key: string) {
    return {
      id: `employee-${key}`,
      "aria-invalid": Boolean(fieldErrors[key]),
      "aria-describedby": [scheduleHelp[key] && `employee-${key}-help`, fieldErrors[key] && `employee-${key}-error`].filter(Boolean).join(" ") || undefined,
    };
  }
  function feedback(key: string) {
    return <>
      {scheduleHelp[key] && <small className="hr-muted" id={`employee-${key}-help`}>{scheduleHelp[key]}</small>}
      {fieldErrors[key] && <small className="error" id={`employee-${key}-error`}>{fieldErrors[key]}</small>}
    </>;
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = e.currentTarget, f = new FormData(form),
      number = (key: string) => {
        const value = f.get(key);
        return typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
      };
    const errors: Record<string, string> = {};
    if (!account || !account.active) errors.userId = "اختر حساب CRM نشطاً من القائمة.";
    for (const key of ["jobTitle", "department"]) {
      const value = String(f.get(key) ?? "").trim();
      if (!value || value.length > 100) errors[key] = "مطلوب: نص من 1 إلى 100 حرف.";
    }
    const balance = number("leaveBalance");
    if (!Number.isFinite(balance) || balance < 0 || balance > 365) errors.leaveBalance = "مطلوب: رصيد من 0 إلى 365 يوماً.";
    const values = {
      latitude: number("latitude"),
      longitude: number("longitude"),
      radius: number("radius"),
      maxAccuracy: number("maxAccuracy"),
      start: f.get("start"),
      end: f.get("end"),
      grace: number("grace"),
      days: f.getAll("days").map(Number),
      timezone: f.get("timezone"),
    };
    // Validate each field independently: Zod may skip object refinements when a
    // different field has an invalid type (for example an empty numeric input).
    const shape = scheduleSchema.innerType().shape;
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      if (!shape[key].safeParse(values[key]).success) errors[key] = scheduleHelp[key];
    }
    if (!errors.start && !errors.end && String(values.end) <= String(values.start)) {
      errors.end = "يجب أن تكون نهاية الدوام بعد بدايته؛ الدوام الليلي يحتاج إعداداً منفصلاً.";
    }
    if (!f.has("confirmation")) errors.confirmation = "مطلوب: راجع الحساب والدوام والموقع ثم فعّل تأكيد المراجعة.";
    const schedule = scheduleSchema.safeParse(values);
    setValidation({ userId, fields: errors });
    if (Object.keys(errors).length) {
      // DOM order, not schema order, determines the first field needing attention.
      const first = Array.from(form.elements).find(el => errors[(el as HTMLInputElement).name]);
      (first as HTMLElement | undefined)?.focus();
      return;
    }
    if (!schedule.success || !account) return;
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
        noValidate
      >
        <h3>{selected ? "تعديل الملف والدوام" : "إنشاء وربط ملف وظيفي"}</h3>
        <p className="hr-muted">
          استخدم بيانات الدوام والموقع المعتمدة فقط. لا توجد قيم افتراضية لموقع
          الشركة.
        </p>
        <label>
          حساب الموظف
          <select
            {...fieldProps("userId")}
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
          {feedback("userId")}
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
                {...fieldProps("jobTitle")}
                name="jobTitle"
                required
                maxLength={100}
                defaultValue={selected?.job_title}
              />
              {feedback("jobTitle")}
            </label>
            <label>
              القسم
              <input
                {...fieldProps("department")}
                name="department"
                required
                maxLength={100}
                defaultValue={selected?.department}
              />
              {feedback("department")}
            </label>
            <label>
              رصيد إجازات يدوي
              <input
                {...fieldProps("leaveBalance")}
                name="leaveBalance"
                type="number"
                min="0"
                max="365"
                step="any"
                required
                defaultValue={selected?.leave_balance}
              />
              {feedback("leaveBalance")}
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>الدوام وأيام العمل</legend>
          <div className="hr-form-grid">
            <label>
              بداية الدوام
              <input
                {...fieldProps("start")}
                name="start"
                type="time"
                required
                defaultValue={selected?.schedule.start}
              />
              {feedback("start")}
            </label>
            <label>
              نهاية الدوام
              <input
                {...fieldProps("end")}
                name="end"
                type="time"
                required
                defaultValue={selected?.schedule.end}
              />
              {feedback("end")}
            </label>
            <label>
              السماح بالدقائق
              <input
                {...fieldProps("grace")}
                name="grace"
                type="number"
                min="0"
                max="120"
                required
                defaultValue={selected?.schedule.grace}
              />
              {feedback("grace")}
            </label>
            <label>
              المنطقة الزمنية IANA
              <input
                {...fieldProps("timezone")}
                name="timezone"
                dir="ltr"
                placeholder="Asia/Riyadh"
                required
                defaultValue={selected?.schedule.timezone}
              />
              {feedback("timezone")}
            </label>
          </div>
          <p id="employee-days-help" className="hr-muted">{scheduleHelp.days}</p>
          <div className="hr-weekdays" role="group" aria-label="أيام العمل المطلوبة" aria-describedby="employee-days-help">
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
                  {...fieldProps("days")}
                  id={i === 0 ? "employee-days" : `employee-days-${i}`}
                  name="days"
                  type="checkbox"
                  value={i}
                  defaultChecked={selected?.schedule.days.includes(i)}
                />
                {day}
              </label>
            ))}
          </div>
          {fieldErrors.days && <small className="error" id="employee-days-error">{fieldErrors.days}</small>}
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
                    {...fieldProps(key)}
                    name={key}
                    type="number"
                    step="any"
                    min={[-90, -180, 0, 0][i]}
                    max={[90, 180, 5000, 500][i]}
                    required
                    defaultValue={selected?.schedule[key]}
                  />
                  {feedback(key)}
                </label>
              ),
            )}
          </div>
        </fieldset>
        <label className="hr-check">
          <input {...fieldProps("confirmation")} name="confirmation" type="checkbox" required />
          راجعت الحساب والدوام والموقع وأوافق على حفظ الملف
        </label>
        {feedback("confirmation")}
        {Object.keys(fieldErrors).length > 0 && (
          <div role="alert" className="error">
            <p>لم يتم إرسال الملف للحفظ. بياناتك المدخلة باقية في النموذج؛ صحّح الحقول التالية ثم أعد الحفظ:</p>
            <ul>{Object.entries(fieldErrors).map(([key, message]) => (
              <li key={key}><a href={`#employee-${key}`} onClick={e => { e.preventDefault(); document.getElementById(`employee-${key}`)?.focus(); }}>{fieldLabels[key]}: {message}</a></li>
            ))}</ul>
          </div>
        )}
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
