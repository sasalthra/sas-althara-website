import {createHash} from 'node:crypto';
import {sheetRowKeyHash} from './sheet-keys';
import {
  composeSheetLead,
  isBlankSheetRow,
  publicSyncError,
  sameHeaders,
  sheetExternalId,
  sheetNameAndPhoneBlank,
  sheetRowProblem,
  type SheetMapping,
} from './sheet-sync-config';
import {noteReregistration, type ExistingLead, type LeadDb} from './lead-reregistration';
import {
  indexLeadsByNormalizedPhone,
  SHEET_ROW_DUPLICATE,
  SHEET_SYNC_CREATED_VIA,
  type IndexedLead,
} from './sheet-duplicate-cleanup';
import {normalizeLeadPhone} from './phone';

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
  if (source.mapping.name === undefined || source.mapping.phone === undefined) {
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
  const known = new Set(
    (await db.prepare('SELECT row_key FROM crm_sheet_rows WHERE source_id = ?').bind(source.id).all()).results.map(row =>
      String(row.row_key ?? '')
    )
  );
  const result = emptyResult();
  const now = new Date().toISOString();
  const phones = indexLeadsByNormalizedPhone(
    (await db
      .prepare(
        `SELECT id, name, phone, stage, IFNULL(assigned_to, '') AS assigned_to, IFNULL(source, '') AS source, created_at FROM leads`
      )
      .bind()
      .all()).results
  );
  for (let index = 1; index < grid.length; index++) {
    const cells = (grid[index] || []).map(cell => String(cell ?? ''));
    const rowNumber = index + 1;
    result.rowsRead += 1;
    if (isBlankSheetRow(cells)) {
      result.skippedRows += 1;
      continue;
    }
    const externalId = sheetExternalId(cells, source.mapping);
    const stableKey = externalId ? sheetRowKey(rowNumber, cells, externalId) : '';
    const hashKey = sheetRowKey(rowNumber, cells);
    if ((stableKey && known.has(stableKey)) || known.has(hashKey)) {
      result.unchanged += 1;
      result.skippedRows += 1;
      continue;
    }
    if (sheetNameAndPhoneBlank(cells, source.mapping)) {
      result.skippedRows += 1;
      continue;
    }
    const draft = composeSheetLead(cells, source, source.mapping);
    const problem = sheetRowProblem(draft);
    const key = problem ? hashKey : stableKey || hashKey;
    if (problem) {
      result.invalid += 1;
      result.skippedRows += 1;
      if (result.errors.length < 30) result.errors.push(`صف ${rowNumber}: ${problem}`);
      await remember(db, source.id, key, '', 'invalid', now);
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
        known.add(key);
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
        notes: draft.notes,
        now,
      });
      await db
        .prepare('INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
        .bind(
          crypto.randomUUID(),
          id,
          'system',
          'created',
          JSON.stringify({source: draft.source, stage: 'new', campaign: draft.campaign, via: SHEET_SYNC_CREATED_VIA})
        )
        .run();
      await remember(db, source.id, key, id, 'imported', now);
      known.add(key);
      if (phone) {
        phones.set(phone, {
          id,
          name: draft.name,
          phone,
          storedPhone: phone,
          stage: 'new',
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
    notes: string;
    now: string;
  }
) {
  const values = [
    lead.id,
    lead.ownerId,
    lead.ownerId,
    lead.name,
    lead.phone,
    lead.propertyOther,
    lead.source,
    lead.notes,
    lead.now,
    lead.now,
  ];
  try {
    await db
      .prepare(
        `INSERT INTO leads (
          id, owner, assigned_to, field_assigned_to, created_by,
          name, phone, property_id, property_other, source, stage, notes, follow_up,
          created_at, updated_at, created_via
        ) VALUES (?, ?, '', '', ?, ?, ?, 'other', ?, ?, 'new', ?, '', ?, ?, ?)`
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
        ) VALUES (?, ?, '', '', ?, ?, ?, 'other', ?, ?, 'new', ?, '', ?, ?)`
      )
      .bind(...values)
      .run();
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
