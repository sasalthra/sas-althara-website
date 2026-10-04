import {createHash} from 'node:crypto';
import {
  composeSheetLead,
  isBlankSheetRow,
  sameHeaders,
  sheetRowProblem,
  type SheetMapping,
} from './sheet-sync-config';
import {findLeadByNormalizedPhone, noteReregistration, type ExistingLead, type LeadDb} from './lead-reregistration';
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
  errors: [],
  created: [],
  reregistrations: [],
};

export function sheetRowKey(rowNumber: number, cells: string[]) {
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
  if (source.headers.length && !sameHeaders(source.headers, header)) {
    return emptyResult('تغيرت عناوين الجدول؛ أوقفت المزامنة حتى يُراجع الربط');
  }
  if (source.mapping.name === undefined || source.mapping.phone === undefined) {
    return emptyResult('ربط الاسم أو الجوال ناقص');
  }
  const known = new Set(
    (await db.prepare('SELECT row_key FROM crm_sheet_rows WHERE source_id = ?').bind(source.id).all()).results.map(row =>
      String(row.row_key ?? '')
    )
  );
  const result = emptyResult();
  const now = new Date().toISOString();
  for (let index = 1; index < grid.length; index++) {
    const cells = (grid[index] || []).map(cell => String(cell ?? ''));
    const rowNumber = index + 1;
    if (isBlankSheetRow(cells)) continue;
    const key = sheetRowKey(rowNumber, cells);
    if (known.has(key)) {
      result.unchanged += 1;
      continue;
    }
    const draft = composeSheetLead(cells, source, source.mapping);
    const problem = sheetRowProblem(draft);
    if (problem) {
      result.invalid += 1;
      if (result.errors.length < 30) result.errors.push(`صف ${rowNumber}: ${problem}`);
      await remember(db, source.id, key, '', 'invalid', now);
      known.add(key);
      continue;
    }
    try {
      const existing = await findLeadByNormalizedPhone(db, draft.phone);
      if (existing) {
        const phone = normalizeLeadPhone(existing.phone) || existing.phone;
        await noteReregistration(db, {...existing, phone}, {
          actorId: 'system',
          source: draft.source,
          submittedName: draft.name,
          submittedNotes: draft.notes,
          campaign: draft.campaign,
        });
        await remember(db, source.id, key, existing.id, 'duplicate', now);
        known.add(key);
        result.duplicates += 1;
        result.reregistrations.push({
          lead: {...existing, phone},
          source: draft.source,
          submittedName: draft.name,
          submittedNotes: draft.notes,
          campaign: draft.campaign,
        });
        continue;
      }
      const id = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO leads (
            id, owner, assigned_to, field_assigned_to, created_by,
            name, phone, property_id, property_other, source, stage, notes, follow_up,
            created_at, updated_at
          ) VALUES (?, ?, '', '', ?, ?, ?, 'other', ?, ?, 'new', ?, '', ?, ?)`
        )
        .bind(id, ownerId, ownerId, draft.name, draft.phone, draft.propertyOther, draft.source, draft.notes, now, now)
        .run();
      await db
        .prepare('INSERT INTO lead_activity (id, lead_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
        .bind(
          crypto.randomUUID(),
          id,
          'system',
          'created',
          JSON.stringify({source: draft.source, stage: 'new', campaign: draft.campaign, via: 'google_sheet'})
        )
        .run();
      await remember(db, source.id, key, id, 'imported', now);
      known.add(key);
      result.inserted += 1;
      result.created.push({
        id,
        name: draft.name,
        phone: draft.phone,
        source: draft.source,
        campaign: draft.campaign,
      });
    } catch (error) {
      console.error('sheet row was not imported', error instanceof Error ? error.name : 'error');
      if (result.errors.length < 30) result.errors.push(`صف ${rowNumber}: تعذر الحفظ`);
    }
  }
  return result;
}

async function remember(db: LeadDb, sourceId: string, rowKey: string, leadId: string, status: string, now: string) {
  try {
    await db
      .prepare(
        'INSERT INTO crm_sheet_rows (id, source_id, row_key, lead_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(crypto.randomUUID(), sourceId, rowKey, leadId || null, status, now)
      .run();
  } catch (error) {
    if (/duplicate|UNIQUE|ER_DUP_ENTRY/i.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
}
