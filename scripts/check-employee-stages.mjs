import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const out = mkdtempSync(join(tmpdir(), 'sas-stages-'));
try {
  await build({
    entryPoints: ['lib/employee-stages.ts', 'lib/weekly-report.ts'],
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
  const require = createRequire(import.meta.url);
  const stages = require(join(out, 'employee-stages.js'));
  const weekly = require(join(out, 'weekly-report.js'));
  const columns = stages.employeeStageColumns();
  assert.ok(columns.some(column => column.stage === 'new'));
  assert.equal(columns.at(-1).stage, 'other');

  const leads = [
    {owner: 'عهود', stage: 'new'},
    {owner: 'عهود', stage: 'contacted'},
    {owner: 'عهود', stage: 'interested'},
    {owner: 'عهود', stage: 'not_interested'},
    {owner: 'عهود', stage: 'postponed'},
    {owner: 'عهود', stage: 'won'},
    {owner: 'نورة', stage: 'field_dispatch'},
    {owner: 'نورة', stage: 'mystery-stage'},
    {owner: 'تركي', stage: 'closed'},
  ];
  const rows = [];
  for (const lead of leads) {
    let row = rows.find(item => item.name === lead.owner);
    if (!row) {
      row = {name: lead.owner, total: 0, assigned: 0, stages: stages.emptyStageCounts()};
      rows.push(row);
    }
    stages.noteEmployeeLead(row, lead.stage);
    row.total = row.assigned;
  }
  assert.equal(stages.stageTableIsExact(rows, leads.length), true, 'stage columns and the totals row must equal every lead');
  const ohoud = rows.find(row => row.name === 'عهود');
  assert.equal(ohoud.assigned, 6);
  assert.equal(ohoud.stages.new, 1);
  assert.equal(ohoud.stages.contacted, 1);
  assert.equal(ohoud.stages.interested, 1);
  assert.equal(ohoud.stages.not_interested, 1);
  assert.equal(ohoud.stages.postponed, 1);
  assert.equal(ohoud.stages.contract_signed, 1, 'retired won counts in the current contract stage');
  assert.equal(stages.stageRowSum(ohoud), ohoud.assigned);
  const noura = rows.find(row => row.name === 'نورة');
  assert.equal(noura.stages.field_dispatch, 1);
  assert.equal(noura.stages.other, 1);
  assert.equal(stages.stageRowSum(noura), 2);
  const footer = stages.sumStageTable(rows);
  assert.equal(footer.total, leads.length);
  assert.equal(stages.stageRowSum(footer), leads.length);

  const report = weekly.buildWeeklyReport(
    [
      {id: '1', source: 'tiktok', stage: 'new', assigned_to: 'sales1', created_at: '2026-11-01T10:00:00.000Z', assigned_at: '2026-11-01T10:00:00.000Z'},
      {id: '2', source: 'tiktok', stage: 'interested', assigned_to: 'sales1', created_at: '2026-11-02T10:00:00.000Z', assigned_at: '2026-11-02T10:00:00.000Z'},
      {id: '3', source: 'tiktok', stage: 'postponed', assigned_to: 'sales1', created_at: '2026-11-03T10:00:00.000Z', assigned_at: '2026-11-03T10:00:00.000Z'},
    ],
    [{id: 'sales1', name: 'عهود', username: 'ohoud', role: 'sales'}],
    '2026-11-01',
    '2026-11-06',
  );
  const person = report.employees.find(row => row.name === 'عهود');
  assert.ok(person);
  assert.equal(person.assigned, 3);
  assert.equal(weekly.stageRowSum(person), person.assigned);
  assert.equal(person.stages.new + person.stages.interested + person.stages.postponed, 3);
  console.log('PASS employee stage columns sum to each lead count and the totals row');
} finally {
  rmSync(out, {recursive: true, force: true});
}
