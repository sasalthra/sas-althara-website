import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const out = mkdtempSync(join(tmpdir(), 'sas-presets-'));
try {
  await build({
    entryPoints: ['lib/report-presets.ts'],
    outfile: join(out, 'presets.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
  const {reportPresetRange, activeReportPreset, startOfRiyadhWeek} = createRequire(import.meta.url)(join(out, 'presets.cjs'));
  const today = '2026-11-04';
  assert.equal(startOfRiyadhWeek('2026-11-01'), '2026-10-31', 'Sunday belongs to the Saturday-start week');
  assert.equal(startOfRiyadhWeek('2026-11-07'), '2026-11-07', 'Saturday is the first day of its week');
  assert.deepEqual(reportPresetRange('today', today), {from: '2026-11-04', to: '2026-11-04'});
  assert.deepEqual(reportPresetRange('week', today), {from: '2026-10-31', to: '2026-11-04'});
  assert.deepEqual(reportPresetRange('month', today), {from: '2026-11-01', to: '2026-11-04'});
  assert.deepEqual(reportPresetRange('30', today), {from: '2026-10-06', to: '2026-11-04'});
  assert.equal(reportPresetRange('custom', today), null);
  assert.equal(activeReportPreset('2026-10-31', '2026-11-04', today), 'week');
  assert.equal(activeReportPreset('2026-11-02', '2026-11-03', today), 'custom');
  assert.notEqual(reportPresetRange('week', '2026-11-01').from, '2026-11-01', 'this week must not collapse to Sunday');
  console.log('PASS report presets use Riyadh days and a Saturday week');
} finally {
  rmSync(out, {recursive: true, force: true});
}
