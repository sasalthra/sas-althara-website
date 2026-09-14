// Isolated synthetic browser harness. Real React components; no Next server, auth or database.
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    "C:/Users/moudd/AppData/Local/Temp/sas-crm-browser/node_modules/playwright",
);
const out = resolve("test-output/crm-browser");
mkdirSync(out, { recursive: true });
const id = "11111111-1111-4111-8111-111111111111";
const account = {
  id,
  name: "موظف تجريبي",
  username: "fixture.employee",
  email: null,
  phone: null,
  role: "sales",
  active: 1,
  created_at: "2026-09-01",
};
const profile = {
  user_id: id,
  name: account.name,
  job_title: "اختصاصي مبيعات",
  department: "المبيعات",
  leave_balance: 12,
  schedule: {
    latitude: 24.7,
    longitude: 46.7,
    radius: 200,
    maxAccuracy: 50,
    start: "09:00",
    end: "17:00",
    grace: 15,
    days: [0, 1, 2, 3, 4],
    timezone: "Asia/Riyadh",
  },
};
await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import CRM from './app/crm/workspace';createRoot(document.getElementById('root')).render(<CRM role={new URLSearchParams(location.search).get('role')||'admin'}/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  platform: "browser",
  outfile: resolve(out, "app.js"),
  plugins: [
    {
      name: "synthetic-property-data",
      setup(b) {
        b.onLoad({ filter: /data[\\/]properties\.json$/ }, () => ({
          contents: JSON.stringify([
            {
              id: "fixture-property",
              title: "عقار تجريبي",
              price: 100000,
              area: 200,
            },
          ]),
          loader: "json",
        }));
      },
    },
  ],
});
const cssFiles = ["globals.css", "site.css", "sas-brand.css", "crm/crm.css"];
const css = cssFiles
  .filter((p) => existsSync("app/" + p))
  .map((p) => readFileSync("app/" + p, "utf8"))
  .join("\n");
const result = await postcss([tailwind()]).process(css, {
  from: resolve("app/globals.css"),
});
writeFileSync(resolve(out, "app.css"), result.css);
let writes = [];
let storedProfile = null;
let storedCheckOut = null;
const storedRequests = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/crm-users") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([account]));
    return;
  }
  if (url.pathname === "/api/leads") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify([
        {
          id: "fixture-lead",
          name: "عميل تجريبي",
          phone: "0000000000",
          property_id: "fixture-property",
          stage: "new",
          source: "fixture",
        },
      ]),
    );
    return;
  }
  if (url.pathname === "/api/hr") {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      let body = "";
      req.on("data", (v) => (body += v));
      req.on("end", () => {
        const v = JSON.parse(body);
        writes.push(v);
        if (v.action === "request") storedRequests.push({
          ...v.data, user_id: id, status: "pending",
          start_date: v.data.startDate, end_date: v.data.endDate,
        });
        if(v.action === "punch")storedCheckOut="2026-09-14T07:00:00Z";
        if (v.action === "profile")
          storedProfile = {
            ...profile,
            job_title: v.data.jobTitle,
            department: v.data.department,
            schedule: v.data.schedule,
          };
        res.end('{"ok":true}');
      });
      return;
    }
    const ref = new URL(req.headers.referer || "http://localhost");
    const fixture = ref.searchParams.get("fixture");
    const month = url.searchParams.get("month") || "2026-09";
    res.end(
      JSON.stringify({
        userId: fixture === "google" ? "google:synthetic" : id,
        month,
        serverTime: "2026-09-14T07:00:00Z",
        profiles:
          fixture === "unlinked" || fixture === "google"
            ? storedProfile
              ? [storedProfile]
              : []
            : [profile],
        attendance: month === "2026-09" ? [
          {
            user_id: id,
            work_day: "2026-09-14",
            check_in: "2026-09-14T06:00:00Z",
            check_out: storedCheckOut,
            late_minutes: 0,
          },
        ] : [],
        calendarLeaves: [],
        requests: storedRequests,
        announcements: [
          {
            id: "fixture-announcement",
            title: "إعلان تجريبي",
            details: "هذه بيانات اصطناعية لا تمثل بيانات الشركة.",
          },
        ],
      }),
    );
    return;
  }
  if (url.pathname === "/app.js" || url.pathname === "/app.css") {
    res.setHeader(
      "Content-Type",
      url.pathname.endsWith("css") ? "text/css" : "text/javascript",
    );
    res.end(readFileSync(resolve(out, url.pathname.slice(1))));
    return;
  }
  if (url.pathname.startsWith("/brand/")) {
    const path = resolve("public" + url.pathname);
    if (existsSync(path)) {
      res.end(readFileSync(path));
      return;
    }
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  // Screenshot-only fixture watermark; never added to production components.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const marker = document.createElement('div');
      marker.textContent = 'SYNTHETIC FIXTURE · بيانات اصطناعية';
      marker.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:#fff4c7;color:#302319;padding:2px 6px;font:10px sans-serif;pointer-events:none';
      document.body.append(marker);
    });
  });
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  async function capture(options){
    await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
    await page.screenshot({...options,fullPage:false});
  }
  await page.goto(origin + "/crm");
  await page.getByText("عميل تجريبي", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("كل متابعة، في مكان واحد.").count(),
    0,
    "operational shell must not render marketing hero",
  );
  await page
    .getByRole("link", { name: "الموظفون والحضور", exact: true })
    .click();
  await page.waitForURL("**tab=hr*");
  await page.getByRole("heading", { name: "يومي الوظيفي" }).waitFor();
  await capture({
    path: resolve(out, "desktop-hr.png"),
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("heading", { name: "يومي الوظيفي" }).waitFor();
  await page.getByRole("link", { name: "الحضور", exact: true }).click();
  await page.getByLabel("الشهر", { exact: true }).waitFor();
  await page.getByRole("button", { name: /2026-09-14/ }).click();
  await page.locator(".hr-day-detail").getByText("أول حضور").waitFor();
  await capture({
    path: resolve(out, "desktop-calendar.png"),
    fullPage: true,
  });
  await page.getByLabel("الشهر", {exact:true}).fill("2026-08");
  await page.getByRole("button", {name:"عرض الشهر",exact:true}).click();
  await page.getByText("الشهر المعروض: 2026-08").waitFor();
  await page.goBack();
  await page.getByRole("heading", { name: "يومي الوظيفي" }).waitFor();
  await page.getByRole("button", {name:"تسجيل انصراف",exact:true}).waitFor();
  await page
    .getByRole("link", { name: "المستخدمون والصلاحيات", exact: true })
    .click();
  await page.getByRole("link", { name: "الملف الوظيفي" }).click();
  await page.getByLabel("حساب الموظف").waitFor();
  assert.equal(await page.getByLabel("حساب الموظف").inputValue(), id);
  await page
    .getByRole("button", { name: "حفظ الملف والدوام", exact: true })
    .click();
  assert.equal(writes.length, 0, "unchecked account confirmation prevents submission");
  await capture({
    path: resolve(out, "desktop-employee-admin.png"),
    fullPage: true,
  });
  await page.goto(origin + "/crm?tab=hr&fixture=google");
  await page.getByText(/حساب Google إداري/).waitFor();
  await capture({
    path: resolve(out, "desktop-unlinked.png"),
    fullPage: true,
  });
  await page.goto(
    origin + "/crm?tab=hr&fixture=unlinked&hr=employees&employee=" + id,
  );
  await page.getByLabel("حساب الموظف").waitFor();
  await page.locator('[name="jobTitle"]').waitFor();
  await page.getByRole("button",{name:"حفظ الملف والدوام",exact:true}).click();
  assert.equal(writes.length,0,"required new employee schedule prevents submission");
  for (const [name, value] of Object.entries({
    jobTitle: "اختصاصي تجريبي",
    department: "فريق تجريبي",
    leaveBalance: "10",
    latitude: "24.7",
    longitude: "46.7",
    radius: "200",
    maxAccuracy: "50",
    grace: "15",
    start: "09:00",
    end: "17:00",
    timezone: "Asia/Riyadh",
  }))
    await page.locator(`[name="${name}"]`).fill(value);
  await page.locator('[name="days"][value="1"]').check();
  await page
    .getByLabel("راجعت الحساب والدوام والموقع وأوافق على حفظ الملف")
    .check();
  await page
    .getByRole("button", { name: "حفظ الملف والدوام", exact: true })
    .click();
  await page.getByText("تم الحفظ", { exact: true }).waitFor();
  assert.equal(writes.at(-1)?.data.userId, id);
  assert.equal(await page.locator('[name="jobTitle"]').inputValue(),"اختصاصي تجريبي","profile readback preserves selected employee change");
  await page.locator(".hr-employee-form").screenshot({path:resolve(out,"employee-form-full.png")});
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/crm?tab=hr");
  await page.getByRole("heading", { name: "يومي الوظيفي" }).waitFor();
  await capture({
    path: resolve(out, "mobile-hr.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "no mobile horizontal page overflow",
  );
  await page.locator('.hr-quick').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  assert.equal(await page.locator('.hr-quick').evaluate(el=>el.getBoundingClientRect().bottom < document.querySelector('.hr-nav').getBoundingClientRect().top),true,"quick actions can scroll clear of bottom navigation");
  await page.screenshot({path:resolve(out,'mobile-hr-scrolled.png')});
  await page.getByRole("link", { name: "الطلبات", exact: true }).click();
  await page.getByRole("button", { name: "إجازة", exact: true }).click();
  await page.getByRole("button", { name: "إرسال الطلب", exact: true }).click();
  assert.equal(
    writes.filter((v) => v.action === "request").length,
    0,
    "invalid leave blocked",
  );
  await capture({
    path: resolve(out, "mobile-requests.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "ملفي", exact: true }).click();
  await page.getByRole("link", { name: "الطلبات", exact: true }).click();
  await page.getByLabel("بداية الإجازة", {exact:true}).fill("2026-09-20");
  await page.getByLabel("نهاية الإجازة", {exact:true}).fill("2026-09-21");
  await page.getByLabel("التفاصيل والتواريخ والمبالغ المطلوبة").fill("طلب إجازة اصطناعي لا يمثل موظفاً حقيقياً");
  await page.getByRole("button", {name:"إرسال الطلب",exact:true}).click();
  await page.locator('.hr-request').getByText("طلب إجازة اصطناعي لا يمثل موظفاً حقيقياً",{exact:true}).waitFor();
  assert.equal(writes.filter(w=>w.action==='request').length,1,'valid leave submitted once and read back');
  assert.equal(writes.find(w=>w.action==='request').data.endDate,'2026-09-21');
  await page.locator('.hr-request').screenshot({path:resolve(out,'mobile-request-readback.png')});
  await page.getByRole("link", { name: "ملفي", exact: true }).click();
  await capture({
    path: resolve(out, "mobile-profile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button",{name:"فتح القائمة"}).getAttribute("aria-expanded"),"false","Escape closes mobile navigation");
  await page.getByRole("button", { name: "فتح القائمة" }).click();
  await page
    .getByRole("link", { name: "العملاء والمتابعات", exact: true })
    .click();
  await page.getByText("عميل تجريبي", { exact: true }).waitFor();
  await capture({
    path: resolve(out, "mobile-leads.png"),
    fullPage: true,
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+"/crm?tab=transactions&lead=fixture-lead");
  await page.getByLabel("العميل والعقار المرتبط").waitFor();
  assert.equal(await page.getByLabel("العميل والعقار المرتبط").inputValue(),"fixture-lead","lead deep link selects linked transaction customer");
  await page.getByRole("link",{name:"العملاء والمتابعات",exact:true}).click();
  await capture({path:resolve(out,"desktop-leads.png")});
  await page.goto(origin+"/crm?tab=hr&hr=employees&role=sales");
  await page.getByRole("heading",{name:"يومي الوظيفي"}).waitFor();
  assert.equal(await page.getByRole("link",{name:"المستخدمون والصلاحيات",exact:true}).count(),0);
  assert.equal(await page.getByLabel("حساب الموظف").count(),0,"employee cannot open admin form through query string");
  await page.setViewportSize({width:360,height:800});
  await capture({path:resolve(out,"mobile-employee-home-360.png")});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.goto(origin+"/crm?tab=hr&role=sales");
  await page.context().clearPermissions();
  await page.evaluate(() => {
    window.fixtureGetPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = (_success, error) => error({code:1,message:'Synthetic permission denial'});
  });
  await page.getByRole('button',{name:'تسجيل انصراف',exact:true}).click();
  await page.locator('.hr-location').filter({hasText:"تعذر تحديد الموقع. اسمح بالوصول واستخدم HTTPS ثم حاول مجدداً."}).waitFor();
  assert.equal(writes.filter(w=>w.action==='punch').length,0,'denied geolocation never submits attendance');
  await capture({path:resolve(out,'mobile-location-denied.png')});
  await page.evaluate(() => {navigator.geolocation.getCurrentPosition = window.fixtureGetPosition;});
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({latitude:24.7,longitude:46.7,accuracy:10});
  await page.getByRole('button',{name:'تسجيل انصراف',exact:true}).click();
  await page.getByRole('button',{name:'اكتمل تسجيل اليوم',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'اكتمل تسجيل اليوم',exact:true}).isDisabled(),true);
  assert.equal(writes.filter(w=>w.action==='punch').length,1,'one geolocated punch submitted and read back');
  await capture({path:resolve(out,'mobile-clocked-out.png')});
  await page.getByRole('link',{name:'الحضور',exact:true}).click();
  await page.getByRole('button',{name:/2026-09-14/}).click();
  await capture({path:resolve(out,'mobile-calendar.png')});
  await page.locator('.hr-day-detail').screenshot({path:resolve(out,'mobile-day-detail.png')});
  await page.locator('.hr-day-detail').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
  assert.equal(await page.locator('.hr-day-detail').evaluate(el=>el.getBoundingClientRect().bottom <= document.querySelector('.hr-nav').getBoundingClientRect().top),true,'day details can scroll clear of fixed navigation');
  await page.screenshot({path:resolve(out,'mobile-calendar-scrolled.png')});
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(out, "results.json"),
    JSON.stringify(
      {
        synthetic: true,
        checks: [
          "real React browser mount",
          "no marketing hero",
          "URL selection reload/back",
          "calendar day details",
          "users to employee deep link",
          "required schedule validation",
          "explicit employee save and read-back",
          "Google unlinked explanation",
          "mobile width",
          "leave validation",
          "valid leave submit and read-back",
          "geolocation denial prevents submission",
          "geolocated checkout read-back and duplicate-disabled action",
          "calendar month isolation from daily punch",
          "employee cannot open admin form via URL",
          "lead transaction deep link",
          "quick actions and day details scroll clear of navigation",
          "mobile drawer",
          "no page errors",
        ],
        writes: writes.map((w) => ({
          action: w.action,
          userId: w.data?.userId,
        })),
      },
      null,
      2,
    ),
  );
  console.log("PASS synthetic browser journeys; screenshots: " + out);
} finally {
  await browser?.close();
  server.close();
}
