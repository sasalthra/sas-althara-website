/**
 * Dry-run the Snap lead-gen sheet. Prints name, phone, and mapped fields.
 * Usage: node scripts/parse-snap-sheet.mjs [csv-path-or-https-url]
 */
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';

const input = process.argv[2] || 'https://docs.google.com/spreadsheets/d/1_lAoABagOV93EQPi_vNWct4ok3zCWE1plJFfbDzm6Nc/export?format=csv&gid=1645681762';
const csv = input.startsWith('http') ? await (await fetch(input)).text() : readFileSync(input, 'utf8');
const output = mkdtempSync(join(tmpdir(), 'sas-snap-'));
try {
  await build({
    entryPoints: {snap: 'lib/sheet-snap.ts', config: 'lib/sheet-sync-config.ts'},
    outdir: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
  });
  const require = createRequire(import.meta.url);
  const snap = require(join(output, 'snap.cjs'));
  const config = require(join(output, 'config.cjs'));
  const grid = config.parseCsv(csv);
  const leads = snap.parseSnapLeads(grid);
  if (!leads) {
    console.error('not a snap lead sheet');
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(leads.map(lead => ({
      name: lead.name,
      phone: lead.phone,
      source: lead.source,
      riyadhDay: lead.riyadhDay,
      registeredAt: lead.registeredAt,
      propertyType: lead.propertyType,
      location: lead.location,
      purchaseMethod: lead.purchaseMethod,
      salary: lead.salary,
      residency: lead.residency,
      timeline: lead.timeline,
      campaign: lead.campaign,
      adName: lead.adName,
      adSet: lead.adSet,
      leadId: lead.leadId,
      formName: lead.formName,
      extra: lead.extra,
    })), null, 2));
  }
} finally {
  rmSync(output, {recursive: true, force: true});
}
