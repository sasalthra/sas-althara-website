import {createHash} from 'node:crypto';
import {sheetRowKeyHash} from './sheet-keys';
import {composePlannedLead, parseSnapLeads, planSheetImport, snapPlatformLabel} from './sheet-snap';
import {
  isBlankSheetRow,
  isSheetUuid,
  publicSyncError,
  sameHeaders,
  sheetExternalId,
  sheetNameAndPhoneBlank,
  sheetRowProblem,
  type SheetLeadDraft,
  type SheetMapping,
} from './sheet-sync-config';
import {noteReregistration, type ExistingLead, type LeadDb} from './lead-reregistration';
import {
  indexLeadsByNormalizedPhone,
  SHEET_ROW_DUPLICATE,
  SHEET_ROW_IMPORTED,
  SHEET_SYNC_CREATED_VIA,
  type IndexedLead,
} from './sheet-duplicate-cleanup';
import {normalizeLeadPhone} from './phone';
import {stageLabel} from './lead-stages';
import {fieldDispatchWrite, rememberFieldDispatch} from './lead-stamps';
import {asBinary} from './sql-collation';
import {clipName, STAGE_NOTE_INSERT_SQL} from './stage-notes';

export {parseSnapLeads, planSheetImport, snapPlatformLabel};

export type StoredSheetSource = {
  id: string;
  sheetId: string;
  gid: string;
  label: string;
  campaign: string;
  mapping: SheetMapping;
  headers: string[];
  enabled: boolean;
};

export type SheetCreatedLead = {
  id: string;
  name: string;
  phone: string;
  source: string;
  campaign: string;
};

export type SheetReregistration = {
  lead: ExistingLead;
  source: string;
  submittedName: string;
  submittedNotes: string;
  campaign: string;
};

export type SheetImportResult = {
  ok: boolean;
  error: string;
  inserted: number;
  duplicates: number;
  invalid: number;
  unchanged: number;
  stagesUpdated: number;
  rowsRead: number;
  skippedRows: number;
  errors: string[];
  created: SheetCreatedLead[];
  reregistrations: SheetReregistration[];
};

const EMPTY: SheetImportResult = {
  ok: true,
  error: '',
  inserted: 0,
  duplicates: 0,
  invalid: 0,
  unchanged: 0,
  stagesUpdated: 0,
  rowsRead: 0,
  skippedRows: 0,
  errors: [],
  created: [],
  reregistrations: [],
};

export function sheetRowKey(rowNumber: number, cells: string[], externalId = '') {
  const id = externalId.trim().slice(0, 120);
  if (id) return `tt:${id}`;
  const hash = createHash('sha256')
    .update(cells.map(cell => String(cell ?? '')).join('\u001f'))
    .digest('hex')
    .slice(0, 24);
  return `${rowNumber}:${hash}`;
}

function emptyResult(error = ''): SheetImportResult {
  return {...EMPTY, ok: !error, error, errors: error ? [error] : [], created: [], reregistrations: []};
}

export async function importSheetGrid(
  db: LeadDb,
  source: StoredSheetSource,
  grid: string[][],
  ownerId: string
): Promise<SheetImportResult> {
  const header = (grid[0] || []).map(cell => String(cell ?? ''));
  const dataRows = Math.max(0, grid.length - 1);
  if (source.headers.length && !sameHeaders(source.headers, header)) {
    const failed = emptyResult('تغيرت عناوين الجدول؛ أوقفت المزامنة حتى يُراجع الربط');
    failed.rowsRead = dataRows;
    failed.skippedRows = dataRows;
    return failed;
  }
  const body = grid.slice(1).map(row => (row || []).map(cell => String(cell ?? '')));
  const plan = planSheetImport(header, body, source.mapping);
  const mapping = plan.mapping;
  if (mapping.name === undefined || mapping.phone === undefined) {
    const failed = emptyResult('ربط الاسم أو الجوال ناقص');
    failed.rowsRead = dataRows;
    failed.skippedRows = dataRows;
    return failed;
  }
  // A previous run must not block new leads by marking a row imported with no lead id.
  await db
    .prepare(
      `DELETE FROM crm_sheet_rows
       WHERE source_id = ?
         AND (lead_id IS NULL OR lead_id = '')
         AND status IN ('imported', 'processed', 'seen')`
    )
    .bind(source.id)
    .run();
  const lookup = await loadSheetLookup(db, source.id);
  const known = new Set(lookup.keys);
  const result = emptyResult();
  const now = new Date().toISOString();
  const leadRows = (
    await db
      .prepare(
        `SELECT id, name, phone, stage, IFNULL(assigned_to, '') AS assigned_to, IFNULL(source, '') AS source, created_at FROM leads`
      )
      .bind()
      .all()
  ).results;
  const stages = new Map<string, string>();
  for (const row of leadRows) stages.set(String(row.id ?? ''), String(row.stage ?? ''));
  const phones = indexLeadsByNormalizedPhone(leadRows);
  for (let index = 1; index < grid.length; index++) {
    const cells = (grid[index] || []).map(cell => String(cell ?? ''));
    const rowNumber = index + 1;
    result.rowsRead += 1;
    if (isBlankSheetRow(cells)) {
      result.skippedRows += 1;
      continue;
    }
    const snapLeadId = plan.snap && plan.leadIdIndex >= 0 ? String(cells[plan.leadIdIndex] ?? '').trim() : '';
    const externalId = plan.snap
      ? (isSheetUuid(snapLeadId) ? snapLeadId.slice(0, 120) : '')
      : sheetExternalId(cells, mapping);
    const stableKey = externalId ? sheetRowKey(rowNumber, cells, externalId) : '';
    const hashKey = sheetRowKey(rowNumber, cells);
    if ((stableKey && known.has(stableKey)) || known.has(hashKey)) {
      const draft = composePlannedLead(cells, source, plan);
      const upgradedId = await upgradeKnownRow(db, lookup, [stableKey, hashKey], draft, now, result, stages);
      if (upgradedId && draft.phone) {
        const cached = phones.get(normalizeLeadPhone(draft.phone));
        if (cached && cached.id === upgradedId) cached.stage = draft.stage;
      }
      if (!upgradedId) {
        result.unchanged += 1;
        result.skippedRows += 1;
      }
      continue;
    }
    if (sheetNameAndPhoneBlank(cells, mapping)) {
      result.skippedRows += 1;
      continue;
    }
    const draft = composePlannedLead(cells, source, plan);
    const problem = sheetRowProblem(draft);
    const key = problem ? hashKey : stableKey || hashKey;
    if (problem) {
      result.invalid += 1;
      result.skippedRows += 1;
      if (result.errors.length < 30) result.errors.push(`صف ${rowNumber}: ${problem}`);
      await remember(db, source.id, key, '', 'invalid', now);
      rememberLink(lookup, key, '', 'invalid');
      known.add(key);
      continue;
    }
    try {
      const phone = normalizeLeadPhone(draft.phone);
      const existing = phone ? phones.get(phone) : undefined;
      if (existing) {
        const lead = indexedLead(existing);
        await noteReregistration(db, {...lead, phone: existing.storedPhone || lead.phone}, {
          actorId: 'system',
          source: draft.source,
          submittedName: draft.name,
          submittedNotes: draft.notes,
          campaign: draft.campaign,
        });
        await remember(db, source.id, key, existing.id, SHEET_ROW_DUPLICATE, now);
        rememberLink(lookup, key, existing.id, SHEET_ROW_DUPLICATE);
        known.add(key);
        if (existing.stage === 'new' && draft.stage !== 'new') {
          try {
            if (lookup.importedLeads.has(existing.id) || lookup.excelLeads.has(existing.id)) {
              const upgraded = await upgradeNewStage(db, existing.id, draft.stage, now, stages);
              if (upgraded) {
                existing.stage = draft.stage;
                result.stagesUpdated += 1;
              }
            }
          } catch (error) {
            console.error('sheet stage was not upgraded', publicSyncError(error));
          }
        }
        result.duplicates += 1;
        result.reregistrations.push({
          lead,
          source: draft.source,
          submittedName: draft.name,
          submittedNotes: draft.notes,
          campaign: draft.campaign,
        });
        continue;
      }
      const id = crypto.randomUUID();
      await insertSheetLead(db, {
        id,
        ownerId,
        name: draft.name,
        phone: draft.phone,
        propertyOther: draft.propertyOther,
        source: draft.source,
        stage: draft.stage,
        notes: draft.notes,
        now,
        registeredAt: draft.registeredAt || '',
      });
      await db
        .prepare('INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
        .bind(
          crypto.randomUUID(),
          id,
          'system',
          'created',
          JSON.stringify({source: draft.source, stage: draft.stage, campaign: draft.campaign, via: SHEET_SYNC_CREATED_VIA})
        )
        .run();
      await remember(db, source.id, key, id, 'imported', now);
      rememberLink(lookup, key, id, SHEET_ROW_IMPORTED);
      known.add(key);
      stages.set(id, draft.stage);
      if (phone) {
        phones.set(phone, {
          id,
          name: draft.name,
          phone,
          storedPhone: phone,
          stage: draft.stage,
          assigned_to: '',
          source: draft.source,
          createdAt: now,
        });
      }
      result.inserted += 1;
      result.created.push({
        id,
        name: draft.name,
        phone: draft.phone,
        source: draft.source,
        campaign: draft.campaign,
      });
    } catch (error) {
      const message = publicSyncError(error);
      console.error('sheet row was not imported', message);
      result.ok = false;
      result.skippedRows += 1;
      if (!result.error) result.error = message;
      if (result.errors.length < 30) result.errors.push(`صف ${rowNumber}: ${message}`);
    }
  }
  return result;
}

function indexedLead(existing: IndexedLead): ExistingLead {
  return {
    id: existing.id,
    name: existing.name,
    phone: existing.phone,
    stage: existing.stage,
    assigned_to: existing.assigned_to,
    source: existing.source,
  };
}

async function insertSheetLead(
  db: LeadDb,
  lead: {
    id: string;
    ownerId: string;
    name: string;
    phone: string;
    propertyOther: string;
    source: string;
    stage: string;
    notes: string;
    now: string;
    registeredAt?: string;
  }
) {
  const createdAt = lead.registeredAt || lead.now;
  const values = [
    lead.id,
    lead.ownerId,
    lead.ownerId,
    lead.name,
    lead.phone,
    lead.propertyOther,
    lead.source,
    lead.stage,
    lead.notes,
    createdAt,
    lead.now,
  ];
  try {
    await db
      .prepare(
        `INSERT INTO leads (
          id, owner, assigned_to, field_assigned_to, created_by,
          name, phone, property_id, property_other, source, stage, notes, follow_up,
          created_at, updated_at, created_via
        ) VALUES (?, ?, '', '', ?, ?, ?, 'other', ?, ?, ?, ?, '', ?, ?, ?)`
      )
      .bind(...values, SHEET_SYNC_CREATED_VIA)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/created_via/i.test(message)) throw error;
    await db
      .prepare(
        `INSERT INTO leads (
          id, owner, assigned_to, field_assigned_to, created_by,
          name, phone, property_id, property_other, source, stage, notes, follow_up,
          created_at, updated_at
        ) VALUES (?, ?, '', '', ?, ?, ?, 'other', ?, ?, ?, ?, '', ?, ?)`
      )
      .bind(...values)
      .run();
  }
  const createdDispatch = fieldDispatchWrite({nextStage: lead.stage});
  if (createdDispatch.write) {
    await rememberFieldDispatch(db, lead.id, lead.now, createdDispatch.latest);
  }
}

function exactEq(column: string) {
  return `${column} = ${asBinary('?')}`;
}

type SheetLookup = {
  keys: string[];
  byStatusKey: Map<string, string>;
  importedLeads: Set<string>;
  excelLeads: Set<string>;
};

function statusKey(status: string, rowKey: string) {
  return `${status}\0${rowKey}`;
}

function rememberLink(lookup: SheetLookup, rowKey: string, leadId: string, status: string) {
  if (!rowKey) return;
  lookup.keys.push(rowKey);
  const id = leadId.trim();
  if (id) lookup.byStatusKey.set(statusKey(status, rowKey), id);
  if (status === SHEET_ROW_IMPORTED && id) lookup.importedLeads.add(id);
}

function linkedLeadId(lookup: SheetLookup, keys: string[], status: string) {
  for (const key of keys) {
    if (!key) continue;
    const id = lookup.byStatusKey.get(statusKey(status, key)) || '';
    if (id) return id;
  }
  return '';
}

/** One read of this source's sheet rows, plus one read of excel import ids. */
async function loadSheetLookup(db: LeadDb, sourceId: string): Promise<SheetLookup> {
  const lookup: SheetLookup = {keys: [], byStatusKey: new Map(), importedLeads: new Set(), excelLeads: new Set()};
  const rows = await db
    .prepare(`SELECT row_key, lead_id, status FROM crm_sheet_rows WHERE ${exactEq('source_id')}`)
    .bind(sourceId)
    .all();
  for (const row of rows.results || []) {
    const key = String(row.row_key ?? '');
    const leadId = String(row.lead_id ?? '').trim();
    const status = String(row.status ?? '');
    if (key) lookup.keys.push(key);
    if (key && leadId) lookup.byStatusKey.set(statusKey(status, key), leadId);
    if (status === SHEET_ROW_IMPORTED && leadId) lookup.importedLeads.add(leadId);
  }
  // A lead imported by any source still counts. One scan, not one query per row.
  try {
    const imported = await db
      .prepare(`SELECT lead_id FROM crm_sheet_rows WHERE ${exactEq('status')}`)
      .bind(SHEET_ROW_IMPORTED)
      .all();
    for (const row of imported.results || []) {
      const leadId = String(row.lead_id ?? '').trim();
      if (leadId) lookup.importedLeads.add(leadId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table|ER_NO_SUCH_TABLE|doesn't exist|does not exist/i.test(message)) throw error;
  }
  try {
    const excel = await db
      .prepare(`SELECT lead_id FROM crm_import_rows WHERE ${exactEq('source')}`)
      .bind('excel')
      .all();
    for (const row of excel.results || []) {
      const leadId = String(row.lead_id ?? '').trim();
      if (leadId) lookup.excelLeads.add(leadId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such table|ER_NO_SUCH_TABLE|doesn't exist|does not exist|no such column|unknown column/i.test(message)) throw error;
  }
  return lookup;
}

/** Raise a lead that is still `new`. A later manual stage is left alone. */
export async function upgradeNewStage(
  db: LeadDb,
  leadId: string,
  nextStage: string,
  now: string,
  stages?: Map<string, string>
) {
  if (!leadId || !nextStage || nextStage === 'new') return false;
  let current = stages?.get(leadId);
  if (current === undefined) {
    const row = await db
      .prepare(`SELECT stage FROM leads WHERE ${exactEq('id')} LIMIT 1`)
      .bind(leadId)
      .first<{stage?: string}>();
    current = String(row?.stage ?? '');
    stages?.set(leadId, current);
  }
  if (current !== 'new') return false;
  await db
    .prepare(`UPDATE leads SET stage = ?, updated_at = ? WHERE ${exactEq('id')} AND ${exactEq('stage')}`)
    .bind(nextStage, now, leadId, 'new')
    .run();
  const after = await db
    .prepare(`SELECT stage FROM leads WHERE ${exactEq('id')} LIMIT 1`)
    .bind(leadId)
    .first<{stage?: string}>();
  const stored = String(after?.stage ?? '');
  stages?.set(leadId, stored);
  if (stored !== nextStage) return false;
  const activityId = crypto.randomUUID();
  const note = `تم تحديث المرحلة من حالة الجدول إلى ${stageLabel(nextStage)}`;
  try {
    await db
      .prepare('INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
      .bind(activityId, leadId, 'system', 'stage_changed', JSON.stringify({previousStage: 'new', stage: nextStage, note}))
      .run();
  } catch (error) {
    console.error('sheet stage activity was not written', publicSyncError(error));
  }
  try {
    await db
      .prepare(STAGE_NOTE_INSERT_SQL)
      .bind(crypto.randomUUID(), leadId, nextStage, note, now, clipName('system'), 'النظام', activityId)
      .run();
  } catch (error) {
    console.error('sheet stage note was not written', publicSyncError(error));
  }
  const dispatchWrite = fieldDispatchWrite({previousStage: 'new', nextStage});
  if (dispatchWrite.write) {
    await rememberFieldDispatch(db, leadId, now, dispatchWrite.latest);
  }
  return true;
}

/** A duplicate row may point at an Excel lead that is still `new`. A manual lead is not upgraded. */
function excelDuplicateLeadId(lookup: SheetLookup, keys: string[]) {
  const leadId = linkedLeadId(lookup, keys, SHEET_ROW_DUPLICATE);
  if (!leadId || !lookup.excelLeads.has(leadId)) return '';
  return leadId;
}

async function upgradeKnownRow(
  db: LeadDb,
  lookup: SheetLookup,
  keys: string[],
  draft: SheetLeadDraft,
  now: string,
  result: SheetImportResult,
  stages: Map<string, string>
) {
  if (draft.stage === 'new' || sheetRowProblem(draft)) return '';
  try {
    const leadId = linkedLeadId(lookup, keys, SHEET_ROW_IMPORTED) || excelDuplicateLeadId(lookup, keys);
    if (!leadId) return '';
    const upgraded = await upgradeNewStage(db, leadId, draft.stage, now, stages);
    if (!upgraded) return '';
    result.stagesUpdated += 1;
    return leadId;
  } catch (error) {
    console.error('sheet stage was not upgraded', publicSyncError(error));
    return '';
  }
}

async function remember(db: LeadDb, sourceId: string, rowKey: string, leadId: string, status: string, now: string) {
  try {
    await db
      .prepare(
        'INSERT INTO crm_sheet_rows (id, source_id, row_key, row_key_hash, lead_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(crypto.randomUUID(), sourceId, rowKey, sheetRowKeyHash(sourceId, rowKey), leadId || null, status, now)
      .run();
  } catch (error) {
    if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
}
