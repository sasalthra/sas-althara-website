import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'sas-report-return-'));
try {
  await build({
    entryPoints: ['lib/report-return.ts'],
    outfile: join(out, 'report-return.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
  const report = createRequire(import.meta.url)(join(out, 'report-return.cjs'));
  const path = report.buildReportPath({
    module: 'leads',
    from: '2026-09-01',
    to: '2026-09-30',
    reportEmployee: 'noura-id',
    stage: 'غير مهتم',
    source: 'excel',
    page: 2,
    pageSize: 50,
  });
  assert.equal(path.startsWith('/crm?'), true);
  const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
  assert.equal(query.get('tab'), 'reports');
  assert.equal(query.get('module'), 'leads');
  assert.equal(query.get('from'), '2026-09-01');
  assert.equal(query.get('to'), '2026-09-30');
  assert.equal(query.get('reportEmployee'), 'noura-id');
  assert.equal(query.get('stage'), 'غير مهتم');
  assert.equal(query.get('page'), '2');
  assert.equal(query.get('pageSize'), '50');
  assert.equal(report.buildReportPath({module: 'overview', page: 1, pageSize: 25}), '/crm?tab=reports');

  const href = report.leadReturnHref('abc-1', path);
  assert.match(href, /^\/crm\/leads\/abc-1\?returnTo=/);
  const returned = new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('returnTo');
  assert.equal(report.safeCrmReturn(returned), path);
  assert.equal(report.reportScrollKey(path), report.reportScrollKey(returned));
  const ampersand = report.buildReportPath({source: 'a&b', from: '2026-09-01', to: '2026-09-30'});
  const ampersandHref = report.leadReturnHref('abc-2', ampersand);
  const ampersandBack = report.safeCrmReturn(new URLSearchParams(ampersandHref.slice(ampersandHref.indexOf('?') + 1)).get('returnTo'));
  assert.equal(new URLSearchParams(ampersandBack.slice(ampersandBack.indexOf('?') + 1)).get('source'), 'a&b');

  assert.equal(report.safeCrmReturn('https://evil.test/crm'), null);
  assert.equal(report.safeCrmReturn('//evil.test'), null);
  assert.equal(report.safeCrmReturn('/crm/leads/1'), null);
  assert.equal(report.safeCrmReturn('2026-09-01'), null);
  assert.equal(report.safeCrmReturn('/crm?tab=reports&from=2026-09-01'), '/crm?tab=reports&from=2026-09-01');
  assert.equal(report.safeCrmReturn(encodeURIComponent('/crm?tab=reports&page=2')), '/crm?tab=reports&page=2');
  console.log('PASS report filters round-trip through returnTo and reject off-site targets');
} finally {
  rmSync(out, {recursive: true, force: true});
}
