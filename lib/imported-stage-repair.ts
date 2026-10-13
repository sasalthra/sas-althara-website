import {importedStageFromFields, stageLabel} from './lead-stages';
import type {LeadDb} from './lead-reregistration';
import {paramEq} from './sql-collation';
import {upgradeNewStage} from './sheet-sync';

const SAMPLE_LIMIT = 20;

export type ImportedStageSample = {
  id: string;
  name: string;
  phone: string;
  text: string;
  stage: string;
  label: string;
};

export type ImportedStageRepairResult = {
  ok: boolean;
  skipped: boolean;
  reason: string;
  count: number;
  sample: ImportedStageSample[];
  updated: number;
};

type Candidate = ImportedStageSample;

function exactEq(column: string) {
  return paramEq(column);
}

function resultOf(matches: Candidate[], extra: {skipped: boolean; reason: string; updated: number}): ImportedStageRepairResult {
  return {
    ok: true,
    skipped: extra.skipped,
    reason: extra.reason,
    count: matches.length,
    sample: matches.slice(0, SAMPLE_LIMIT),
    updated: extra.updated,
  };
}

export function skippedImportedStageRepair(reason = 'المزامنة تعمل بالفعل'): ImportedStageRepairResult {
  return resultOf([], {skipped: true, reason, updated: 0});
}

/** Leads still at `new` whose property text or notes status line is a stage label. */
export async function findImportedStageRepairs(db: LeadDb): Promise<Candidate[]> {
  const rows = await db
    .prepare(
      `SELECT id, name, phone, IFNULL(property_other, '') AS property_other, IFNULL(notes, '') AS notes
       FROM leads
       WHERE ${exactEq('stage')}
       ORDER BY id`
    )
    .bind('new')
    .all();
  const matches: Candidate[] = [];
  for (const row of rows.results || []) {
    const found = importedStageFromFields(String(row.property_other ?? ''), String(row.notes ?? ''));
    const id = String(row.id ?? '').trim();
    if (!found || !id) continue;
    matches.push({
      id,
      name: String(row.name ?? '').trim(),
      phone: String(row.phone ?? '').trim(),
      text: found.text,
      stage: found.stage,
      label: stageLabel(found.stage),
    });
  }
  return matches;
}

export async function previewImportedStageRepair(db: LeadDb): Promise<ImportedStageRepairResult> {
  return resultOf(await findImportedStageRepairs(db), {skipped: false, reason: '', updated: 0});
}

/**
 * Sets the stage only while the lead is still `new`, and writes the same
 * stage_changed activity and stage note as the sheet sync upgrade.
 * A stage changed after the preview is left alone.
 */
export async function applyImportedStageRepair(db: LeadDb): Promise<ImportedStageRepairResult> {
  const matches = await findImportedStageRepairs(db);
  const now = new Date().toISOString();
  let updated = 0;
  for (const match of matches) {
    if (await upgradeNewStage(db, match.id, match.stage, now)) updated += 1;
  }
  return resultOf(matches, {skipped: false, reason: '', updated});
}
