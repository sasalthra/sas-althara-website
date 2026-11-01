import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const job = readFileSync('lib/weekly-report-job.server.ts', 'utf8');
const route = readFileSync('app/api/cron/weekly-report/route.ts', 'utf8');
const schema = readFileSync('lib/lead-schema.ts', 'utf8');
const interval = readFileSync('lib/sheet-sync-job.server.ts', 'utf8');
const mail = readFileSync('lib/mail.ts', 'utf8');
assert.match(job, /sendMail/);
assert.match(job, /CRM_MAIL_FROM/);
assert.match(job, /CAST\(\? AS BINARY\)|asBinary\('\?'\)/);
assert.doesNotMatch(job, /CONVERT_TZ/);
assert.doesNotMatch(job, /info@/);
assert.match(schema, /crm_weekly_report_sends/);
assert.match(schema, /week_key VARCHAR\(16\) NOT NULL PRIMARY KEY/);
assert.doesNotMatch(schema, /week_key TEXT/);
assert.match(interval, /sendWeeklyReportIfDue/);
assert.match(route, /preview/);
assert.match(route, /force/);
assert.match(route, /CRON_SECRET|cronAuthorized/);
assert.match(mail, /sasalthra\.sa@gmail\.com/);
assert.match(mail, /info@/);
assert.match(mail, /resolveFrom/);

const out = mkdtempSync(join(tmpdir(), 'sas-weekly-'));
try {
  await build({
    entryPoints: ['lib/weekly-report.ts', 'lib/report-pdf.ts'],
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['html2canvas', 'jspdf'],
  });
  const require = createRequire(import.meta.url);
  const weekly = require(join(out, 'weekly-report.js'));
  const pdf = require(join(out, 'report-pdf.js'));
  const saturdayMorning = new Date('2026-11-07T08:00:00.000Z');
  const saturdayEarly = new Date('2026-11-07T07:59:00.000Z');
  const friday = new Date('2026-11-06T08:00:00.000Z');
  const due = weekly.weeklyReportWindow(saturdayMorning);
  assert.equal(due.due, true);
  assert.equal(due.weekKey, '2026-11-07');
  assert.equal(due.from, '2026-10-31');
  assert.equal(due.to, '2026-11-06');
  assert.equal(weekly.weeklyReportWindow(saturdayEarly).due, false);
  assert.equal(weekly.weeklyReportWindow(friday).due, false);
  assert.equal(weekly.riyadhMidnightUtc('2026-11-01'), '2026-10-31 21:00:00');
  assert.deepEqual(weekly.weeklyReportRecipients(''), ['sasalthra.sa@gmail.com']);
  assert.deepEqual(weekly.weeklyReportRecipients(undefined), ['sasalthra.sa@gmail.com']);
  assert.equal(weekly.weeklySendDecision({due: true, alreadySent: true, force: false, preview: false}), 'skip');
  assert.equal(weekly.weeklySendDecision({due: false, alreadySent: false, force: true, preview: false}), 'send');
  assert.equal(weekly.weeklySendDecision({due: false, alreadySent: false, force: false, preview: true}), 'preview');

  const leads = [
    {id: '1', source: 'tiktok', stage: 'interested', assigned_to: 'sales1', created_at: '2026-11-01T10:00:00.000Z', assigned_at: '2026-11-01T10:00:00.000Z'},
    {id: '2', source: 'snapchat', stage: 'not_interested', assigned_to: 'sales1', created_at: '2026-11-02T10:00:00.000Z', assigned_at: '2026-11-02T10:00:00.000Z'},
    {id: '3', source: 'excel', stage: 'property_visited', assigned_to: 'sales1', field_assigned_to: 'field1', created_at: '2026-10-01T10:00:00.000Z', assigned_at: '2026-10-01T10:00:00.000Z', field_dispatched_at: '2026-11-03T10:00:00.000Z', field_report: 'تمت الزيارة', field_report_at: '2026-11-04T10:00:00.000Z'},
    {id: '4', source: 'website', stage: 'new', created_at: '2026-11-05T10:00:00.000Z'},
    {id: '5', source: 'excel', stage: 'contacted', created_at: '2026-11-08T10:00:00.000Z', assigned_to: 'sales1', assigned_at: '2026-11-08T10:00:00.000Z'},
  ];
  const users = [
    {id: 'sales1', name: 'سارة', username: 'sara', role: 'sales'},
    {id: 'field1', name: 'فهد', username: 'fahad', role: 'field'},
  ];
  const report = weekly.buildWeeklyReport(leads, users, due.from, due.to, due.weekKey);
  assert.equal(report.newLeads, 3);
  assert.equal(report.interested, 1);
  assert.equal(report.notInterested, 1);
  assert.equal(report.dispatched, 1);
  assert.deepEqual(report.bySource.map(row => row.label).sort(), ['الموقع', 'تيك توك', 'سناب'].sort());
  const sara = report.employees.find(row => row.name === 'سارة');
  const fahad = report.employees.find(row => row.name === 'فهد');
  assert.ok(sara);
  assert.equal(sara.assigned, 2);
  assert.equal(sara.contacted, 0);
  assert.equal(sara.interested, 1);
  assert.equal(sara.notInterested, 1);
  assert.equal(sara.dispatched, 1);
  assert.equal(sara.visits, 1);
  assert.equal(sara.reports, 1);
  assert.ok(fahad);
  assert.equal(fahad.assigned, 1);
  assert.equal(fahad.dispatched, 1);
  assert.equal(fahad.visits, 1);
  assert.equal(fahad.reports, 1);
  const columns = weekly.employeeStageColumns();
  for (const row of report.employees) {
    const sum = columns.reduce((total, column) => total + (row.stages[column.stage] || 0), 0);
    assert.equal(sum, row.assigned, `${row.name} stage columns must equal assigned leads`);
  }
  const footer = weekly.sumStageTable(report.employees.map(row => ({total: row.assigned, stages: row.stages})));
  assert.equal(weekly.stageRowSum(footer), footer.total);
  assert.equal(footer.total, report.employees.reduce((total, row) => total + row.assigned, 0));
  assert.equal(weekly.stageTableIsExact(report.employees.map(row => ({total: row.assigned, stages: row.stages})), footer.total), true);
  assert.deepEqual(weekly.manualReportRange('week', '2026-11-01'), {from: '2026-10-26', to: '2026-11-01'});
  assert.deepEqual(weekly.manualReportRange('month', '2026-11-01'), {from: '2026-10-03', to: '2026-11-01'});
  assert.equal(weekly.validReportRange('2026-11-02', '2026-11-01'), false);
  assert.equal(weekly.weeklyReportSubject(report).includes(report.from), true);
  assert.equal(weekly.weeklyReportSubject(report).includes(report.to), true);
  const html = weekly.renderWeeklyReportHtml(report);
  assert.match(html, /عملاء جدد: 3/);
  assert.match(html, /تيك توك/);
  assert.match(html, /سناب/);
  assert.match(html, /مهتم/);
  assert.match(html, /غير مهتم/);
  assert.match(html, /تفويج للميدان: 1/);
  assert.match(html, /سارة/);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /background:#3F1A44/);
  assert.match(html, /الإجمالي/);
  assert.match(html, /تحديثات العملاء القدامى/);
  assert.doesNotMatch(html, /نشاط الموظفين/);
  assert.ok(html.includes(report.from));
  assert.doesNotMatch(html, /info@/);
  const adminRoute = readFileSync('app/api/reports/weekly/route.ts', 'utf8');
  const panel = readFileSync('app/crm/reports-panel.tsx', 'utf8');
  assert.match(adminRoute, /actor\(req,\s*\['admin'\]\)/);
  assert.match(adminRoute, /from:\s*range\.from/);
  assert.match(adminRoute, /force:\s*true/);
  assert.match(job, /options\.from/);
  assert.match(job, /recordSend = !preview && !force/);
  assert.doesNotMatch(job, /rememberWeek/);
  assert.match(panel, /إرسال التقرير بالإيميل/);
  assert.match(panel, /آخر أسبوع/);
  assert.match(panel, /آخر شهر/);
  assert.match(panel, /الفترة المحددة في الفلاتر/);
  assert.match(panel, /معاينة البريد/);
  assert.match(readFileSync('lib/reports.ts', 'utf8'), /noteEmployeeLead\(stat, row\.stage\)/);
  assert.equal(pdf.reportPdfFilename('2026-10-31', '2026-11-06'), 'report-2026-10-31-2026-11-06.pdf');
  console.log('PASS weekly report window, tables, sender guard, and PDF filename');
} finally {
  rmSync(out, {recursive: true, force: true});
}
