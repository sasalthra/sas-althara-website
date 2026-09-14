// Synthetic loopback browser + real HR route/transaction/SQL. No .env or production access.
// Only session and mysql driver boundaries are substituted. SQLite does not prove MySQL locks.
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/moudd/AppData/Local/Temp/sas-crm-browser/node_modules/playwright');
const out = resolve('test-output/hr-persistence');
mkdirSync(out, { recursive: true });
const employee = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const sql = new DatabaseSync(':memory:');
sql.exec(`
CREATE TABLE crm_users(id TEXT PRIMARY KEY,name TEXT,username TEXT,active INTEGER,role TEXT);
CREATE TABLE hr_profiles(user_id TEXT PRIMARY KEY,job_title TEXT,department TEXT,leave_balance REAL,schedule TEXT,updated_at TEXT);
CREATE TABLE hr_attendance(user_id TEXT,work_day TEXT,check_in TEXT,check_out TEXT,late_minutes INTEGER,in_key TEXT UNIQUE,out_key TEXT UNIQUE,in_distance INTEGER,in_accuracy REAL,out_distance INTEGER,out_accuracy REAL,PRIMARY KEY(user_id,work_day));
CREATE TABLE hr_requests(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,details TEXT,status TEXT,created_at TEXT,start_date TEXT,end_date TEXT,review_note TEXT,reviewed_by TEXT,reviewed_at TEXT);
CREATE TABLE hr_announcements(id TEXT PRIMARY KEY,title TEXT,details TEXT,created_at TEXT);
CREATE TABLE crm_audit(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,target_id TEXT,details TEXT,created_at TEXT);
`);
sql.prepare('INSERT INTO crm_users VALUES (?,?,?,1,?)').run(employee, 'موظف تجريبي', 'fixture.employee', 'sales');
sql.prepare('INSERT INTO crm_users VALUES (?,?,?,1,?)').run(other, 'موظف آخر', 'fixture.other', 'sales');
let failAudit = false;
const driver = {
  async execute(query, args) {
    if (failAudit && query.includes('INSERT INTO crm_audit')) throw Error('Synthetic audit unavailable');
    query = query.replace(/ FOR UPDATE/g, '').replace(/ON DUPLICATE KEY UPDATE /g, 'ON CONFLICT DO UPDATE SET ').replace(/VALUES\((\w+)\)/g, 'excluded.$1');
    const statement = sql.prepare(query);
    return /^SELECT/.test(query.trim()) ? [statement.all(...args)] : [{ affectedRows: Number(statement.run(...args).changes) }];
  },
  async beginTransaction() { sql.exec('BEGIN'); },
  async commit() { sql.exec('COMMIT'); },
  async rollback() { sql.exec('ROLLBACK'); },
  release() {},
};
globalThis.hrTestPool = { execute: driver.execute, async getConnection() { return driver; } };
globalThis.hrTestUser = { userId: 'google:synthetic', role: 'admin', name: 'Synthetic admin' };
Object.assign(process.env, { DB_HOST: 'synthetic', DB_USER: 'synthetic', DB_PASSWORD: 'synthetic', DB_NAME: 'synthetic' });
await build({ entryPoints: ['app/api/hr/route.ts'], outfile: resolve(out, 'route.cjs'), bundle: true, platform: 'node', format: 'cjs',
  // Freeze only the bundled server clock, so calendar/punch tests cannot cross midnight.
  banner: { js: 'const Date = class extends globalThis.Date { constructor(...args) { super(...(args.length ? args : ["2026-09-14T12:00:00.000Z"])); } static now() { return new globalThis.Date("2026-09-14T12:00:00.000Z").getTime(); } };' },
  plugins: [{
  name: 'isolated-boundaries', setup(b) {
    b.onResolve({ filter: /^mysql2\/promise$/ }, () => ({ path: 'mysql', namespace: 'test' }));
    b.onResolve({ filter: /[\\/]admin$/ }, () => ({ path: 'auth', namespace: 'test' }));
    b.onLoad({ filter: /.*/, namespace: 'test' }, a => ({ loader: 'js', contents: a.path === 'mysql' ? 'export default {createPool(){return globalThis.hrTestPool}}' : 'export async function getCrmUser(){return globalThis.hrTestUser}' }));
  },
}] });
const hr = require(resolve(out, 'route.cjs'));
await build({ stdin: {
  contents: `import React from 'react';import{createRoot}from'react-dom/client';import CRM from './app/crm/workspace';createRoot(document.getElementById('root')).render(<CRM role="admin"/>);`,
  resolveDir: process.cwd(), loader: 'tsx',
}, bundle: true, platform: 'browser', outfile: resolve(out, 'app.js'), define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, plugins: [{
  name: 'no-customer-data', setup(b) { b.onLoad({ filter: /data[\\/]properties\.json$/ }, () => ({ contents: '[]', loader: 'json' })); },
}] });
let origin;
const traffic = [];
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/api/hr') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      const response = await hr[req.method](request);
      const text = await response.text();
      traffic.push({ method: req.method, status: response.status, data: JSON.parse(text) });
      res.writeHead(response.status, Object.fromEntries(response.headers));res.end(text);return;
    }
    if (url.pathname === '/api/crm-users' || url.pathname === '/api/leads') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(url.pathname === '/api/crm-users' ? sql.prepare('SELECT * FROM crm_users').all() : []));return;
    }
    if (url.pathname === '/app.js' || url.pathname === '/app.css') {
      res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(readFileSync(resolve(out, url.pathname.slice(1))));return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<html dir="rtl"><head><link rel="stylesheet" href="/app.css"></head><body><div style="background:#ffeeba;color:#000">اختبار اصطناعي — SQLite محلي، ليس الإنتاج</div><div id="root"></div><script src="/app.js"></script></body></html>');
  } catch (e) { res.writeHead(500);res.end(String(e)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
origin = `http://127.0.0.1:${server.address().port}`;
process.env.NEXTAUTH_URL = origin;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const post = async data => hr.POST(new Request(origin + '/api/hr', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(data) }));
const profile = () => sql.prepare('SELECT * FROM hr_profiles WHERE user_id=?').get(employee);
try {
  await page.goto(origin + '/crm?tab=hr&hr=employees');
  await page.locator('select[name=userId]').selectOption(employee);
  const fields = { jobTitle: 'مسؤول متابعة', department: 'قسم تجريبي', leaveBalance: '23.5', start: '00:00', end: '23:59', grace: '10', timezone: 'UTC', latitude: '24', longitude: '46', radius: '100', maxAccuracy: '30' };
  for (const [key, value] of Object.entries(fields)) await page.locator(`[name=${key}]`).fill(value);
  for (let i = 0; i < 7; i++) await page.locator(`[name=days][value="${i}"]`).check();
  await page.locator('.hr-check input').check();
  await page.locator('[name=radius]').fill('');
  await page.locator('[name=end]').fill('00:00');
  await page.getByRole('button', { name: 'حفظ الملف والدوام', exact: true }).click();
  assert.equal(traffic.filter(t => t.method === 'POST').length, 0, 'invalid form blocked before real API');
  assert.equal(profile(), undefined, 'invalid form creates no SQL row');
  assert.equal(await page.locator('[name=radius]').inputValue(), '');
  assert.equal(await page.locator('[name=end]').getAttribute('aria-invalid'), 'true');
  for (const [key, value] of Object.entries(fields)) {
    if (!['radius', 'end'].includes(key)) assert.equal(await page.locator(`[name=${key}]`).inputValue(), value, `invalid submit retains ${key}`);
  }
  assert.equal(await page.locator('[name=days]:checked').count(), 7);
  assert.equal(await page.locator('.hr-check input').isChecked(), true);
  await page.locator('[name=radius]').fill(fields.radius);
  await page.locator('[name=end]').fill(fields.end);
  await page.getByRole('button', { name: 'حفظ الملف والدوام', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^تم الحفظ$/ }).waitFor();
  assert.equal(profile().job_title, fields.jobTitle);
  assert.equal(profile().leave_balance, 23.5);
  assert.equal(traffic.at(-1).data.profiles[0].job_title, fields.jobTitle);
  console.log('PASS browser form -> real POST -> SQL commit -> GET mapping');
  const savedBeforeInvalid = profile();
  const validSchedule = JSON.parse(savedBeforeInvalid.schedule);
  for (const invalid of [{latitude:null},{latitude:91},{longitude:-181},{radius:0},{radius:5001},{maxAccuracy:0},{maxAccuracy:501},{grace:1.5},{grace:121},{days:[]},{start:'24:00'},{end:'00:00'},{timezone:'Invalid/Zone'}]) {
    const response = await post({action:'profile',data:{userId:employee,jobTitle:fields.jobTitle,department:fields.department,leaveBalance:23.5,schedule:{...validSchedule,...invalid}}});
    assert.equal(response.status, 400, `real API rejects ${JSON.stringify(invalid)}`);
    assert.deepEqual(profile(), savedBeforeInvalid, 'API rejection preserves saved profile');
  }
  console.log('PASS real API schedule constraints unchanged; invalid direct requests cannot update saved row');
  await page.locator('.crm-sidebar a[href="/crm?tab=leads"]').click();
  assert.equal(await page.locator('.hr-workspace').count(), 0, 'actual HR unmount');
  await page.locator('.crm-sidebar a[href="/crm?tab=hr"]').click();
  await page.getByRole('link', { name: 'دليل الموظفين والدوام', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.hr-employee-form button')?.disabled || document.querySelector('.hr-directory button'));
  await page.locator('.hr-directory button').first().waitFor();
  await page.screenshot({ path: resolve(out, 'after-remount.png'), fullPage: true });
  assert.equal(profile().job_title, fields.jobTitle, 'SQL survives leaving HR');
  assert.equal(traffic.filter(t => t.method === 'GET').at(-1).data.profiles[0].job_title, fields.jobTitle, 'fresh GET returns persisted employee');
  assert.equal(await page.locator('[name=jobTitle]').inputValue(), fields.jobTitle, 'saved employee must remain selected after actual unmount/remount');
  await page.reload();
  await page.locator('[name=jobTitle]').waitFor();
  for (const [key, value] of Object.entries(fields)) assert.equal(await page.locator(`[name=${key}]`).inputValue(), value, `fresh reload ${key}`);
  assert.equal(await page.locator('[name=days]:checked').count(), 7);
  assert.equal(await page.locator('.hr-check input').isChecked(), false, 'confirmation resets on remount');
  console.log('PASS saved employee/schedule retained after true unmount and fresh browser reload');
  // A Google administrator must never be treated as the employee they edit.
  await page.getByRole('link', { name: 'ملفي', exact: true }).click();
  await page.getByText('ملفك الوظيفي غير مرتبط بعد', { exact: true }).waitFor();
  globalThis.hrTestUser = { userId: employee, role: 'sales', name: 'Synthetic employee' };
  assert.equal((await post({ action: 'punch', id: crypto.randomUUID(), kind: 'in', point: { latitude: 24, longitude: 46, accuracy: 10 } })).status, 200);
  globalThis.hrTestUser = { userId: 'google:synthetic', role: 'admin', name: 'Synthetic admin' };
  await page.getByRole('link', { name: 'الحضور', exact: true }).click();
  await page.getByRole('button', { name: 'تحديث البيانات', exact: true }).click();
  await page.locator('.hr-calendar-tools select').selectOption(employee);
  await page.getByLabel('تقويم الحضور', { exact: true }).waitFor();
  await page.locator('.crm-sidebar a[href="/crm?tab=leads"]').click();
  assert.equal(await page.locator('.hr-workspace').count(), 0);
  await page.locator('.crm-sidebar a[href="/crm?tab=hr"]').click();
  await page.getByRole('link', { name: 'الحضور', exact: true }).click();
  await page.locator('.hr-calendar-tools select').waitFor();
  assert.equal(await page.locator('.hr-calendar-tools select').inputValue(), employee, 'attendance employee selection survives remount without becoming Google self');
  await page.reload();
  await page.getByLabel('تقويم الحضور', { exact: true }).waitFor();
  assert.equal(await page.locator('.hr-calendar button[data-status=late],.hr-calendar button[data-status=present]').count(), 1);
  console.log('PASS attendance readback and selected employee after true unmount/reload; Google identity stays separate');
  // Switching employees and browser history must hydrate from the correct saved row.
  await page.getByRole('link', { name: 'دليل الموظفين والدوام', exact: true }).click();
  await page.locator('[name=jobTitle]').fill('مسمى محدث');
  await page.locator('[name=leaveBalance]').fill('31');
  await page.locator('.hr-check input').check();
  await page.getByRole('button', { name: 'حفظ الملف والدوام', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^تم الحفظ$/ }).waitFor();
  assert.equal(profile().job_title, 'مسمى محدث');
  await page.locator('.hr-directory button').filter({ hasText: 'fixture.other' }).click();
  assert.equal(await page.locator('[name=jobTitle]').inputValue(), '');
  await page.goBack();
  assert.equal(await page.locator('[name=jobTitle]').inputValue(), 'مسمى محدث');
  assert.equal(await page.locator('[name=leaveBalance]').inputValue(), '31');
  // A failed transaction is not a success, and the previous DB row survives.
  failAudit = true;
  await page.locator('[name=jobTitle]').fill('لن يحفظ');
  await page.locator('.hr-check input').check();
  await page.getByRole('button', { name: 'حفظ الملف والدوام', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'لم يتم تأكيد الحفظ' }).waitFor();
  assert.equal(traffic.at(-1).status, 503);
  assert.equal(profile().job_title, 'مسمى محدث', 'audit failure rolls back profile update');
  failAudit = false;
  await page.reload();
  await page.locator('[name=jobTitle]').waitFor();
  assert.equal(await page.locator('[name=jobTitle]').inputValue(), 'مسمى محدث');
  console.log('PASS profile update, account switching/back, failed audit rollback and no fake UI success');
  // Reproduce an old schema locally, never infer production's schema from this.
  sql.exec('ALTER TABLE hr_requests DROP COLUMN end_date');
  await page.locator('[name=jobTitle]').fill('حفظ مع فشل القراءة');
  await page.locator('.hr-check input').check();
  await page.getByRole('button', { name: 'حفظ الملف والدوام', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'تم الحفظ؛ تعذر تحديث العرض' }).waitFor();
  assert.equal(profile().job_title, 'حفظ مع فشل القراءة');
  assert.equal(traffic.at(-1).status, 503);
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'لم يتم تأكيد الحفظ' }).waitFor();
  assert.equal(await page.locator('.hr-employee-form').count(), 0, 'failed GET is not empty successful state');
  sql.exec('ALTER TABLE hr_requests ADD COLUMN end_date TEXT');
  await page.getByRole('button', { name: 'تحديث البيانات', exact: true }).click();
  await page.locator('[name=jobTitle]').waitFor();
  assert.equal(await page.locator('[name=jobTitle]').inputValue(), 'حفظ مع فشل القراءة');
  console.log('PASS missing-schema GET fails visibly; committed profile survives recovery (production schema unverified)');
  // Announcements and requests use the real UI -> route -> SQL path too.
  await page.getByRole('link', { name: 'الاعتمادات والإعلانات', exact: true }).click();
  await page.locator('[name=title]').fill('إعلان محفوظ تجريبي');
  await page.locator('[name=details]').fill('نص الإعلان المحفوظ في قاعدة الاختبار');
  await page.getByRole('button', { name: 'نشر الإعلان للموظفين', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^تم الحفظ$/ }).waitFor();
  assert.equal(sql.prepare('SELECT title FROM hr_announcements').get().title, 'إعلان محفوظ تجريبي');
  globalThis.hrTestUser = { userId: employee, role: 'sales', name: 'Synthetic employee' };
  await page.goto(origin + '/crm?tab=hr&hr=requests');
  await page.getByLabel('بداية الإجازة').fill('2026-10-01');
  await page.getByLabel('نهاية الإجازة').fill('2026-10-02');
  await page.locator('.hr-request-form textarea').fill('طلب إجازة تجريبي محفوظ');
  await page.getByRole('button', { name: 'إرسال الطلب', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /^تم الحفظ$/ }).waitFor();
  const savedRequest = sql.prepare('SELECT * FROM hr_requests').get();
  assert.equal(savedRequest.user_id, employee);
  await page.reload();
  await page.getByText('طلب إجازة تجريبي محفوظ', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'الرئيسية', exact: true }).click();
  await page.getByText('إعلان محفوظ تجريبي', { exact: true }).waitFor();
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 24, longitude: 46, accuracy: 10 });
  await page.getByRole('button', { name: 'تسجيل انصراف', exact: true }).click();
  await page.getByRole('button', { name: 'اكتمل تسجيل اليوم', exact: true }).waitFor();
  assert.ok(sql.prepare('SELECT check_out FROM hr_attendance').get().check_out);
  await page.reload();
  await page.getByRole('button', { name: 'اكتمل تسجيل اليوم', exact: true }).waitFor();
  assert.equal((await post({ action: 'review', data: { id: savedRequest.id, status: 'approved', note: 'غير مسموح' } })).status, 403);
  assert.equal((await post({ action: 'profile', data: {} })).status, 403);
  globalThis.hrTestUser = { userId: 'google:synthetic', role: 'admin', name: 'Synthetic admin' };
  assert.equal((await post({ action: 'review', data: { id: savedRequest.id, status: 'approved', note: 'موافقة اختبارية' } })).status, 200);
  assert.equal((await hr.POST(new Request(origin + '/api/hr', { method: 'POST', headers: { origin: 'https://wrong.invalid', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'announcement', data: { title: 'Denied', details: 'Denied' } }) }))).status, 403);
  const current = profile();
  const data = { userId: 'google:synthetic', jobTitle: 'Invalid', department: 'Test', leaveBalance: 1, schedule: JSON.parse(current.schedule) };
  assert.equal((await post({ action: 'profile', data })).status, 400, 'Google identity cannot be a UUID profile target');
  globalThis.hrTestUser = { userId: other, role: 'sales', name: 'Other employee' };
  const isolated = await (await hr.GET(new Request(origin + '/api/hr?month=2026-10'))).json();
  assert.equal(isolated.profiles.length, 0);assert.equal(isolated.attendance.length, 0);assert.equal(isolated.requests.length, 0);assert.equal(isolated.calendarLeaves.length, 0);
  globalThis.hrTestUser = null;
  assert.equal((await hr.GET(new Request(origin + '/api/hr'))).status, 401);
  assert.deepEqual(errors, []);
  console.log('PASS announcements/requests/checkout persist after reload; review, auth, CSRF, ownership and Google UUID rejection');
} finally {
  writeFileSync(resolve(out, 'traffic.json'), JSON.stringify({ traffic, errors }, null, 2));
  await browser.close();await new Promise(r => server.close(r));sql.close();
  delete globalThis.hrTestPool;delete globalThis.hrTestUser;
}
