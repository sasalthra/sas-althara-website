/**
 * Stage notes are a series, not one string.
 * Each save inserts {text, at, byUserId, byName, stage}.
 * A note on the same stage appends. Changing stage records a stage change
 * and starts the next note on the new stage. Older stages stay in the table.
 */

export const STAGE_NOTE_MAX = 2000;

export const STAGE_NOTES_DDL = `CREATE TABLE IF NOT EXISTS lead_stage_notes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  lead_id VARCHAR(64) NOT NULL,
  stage VARCHAR(64) NOT NULL,
  note_text TEXT NOT NULL,
  created_at VARCHAR(40) NOT NULL,
  by_user_id VARCHAR(191) NULL,
  by_name VARCHAR(191) NULL,
  source_activity_id CHAR(36) NULL
)`;

export const STAGE_NOTES_LEAD_INDEX = 'CREATE INDEX IF NOT EXISTS lead_stage_notes_lead_idx ON lead_stage_notes (lead_id)';
export const STAGE_NOTES_LEAD_INDEX_ALTER = 'ALTER TABLE lead_stage_notes ADD INDEX lead_stage_notes_lead_idx (lead_id)';
export const STAGE_NOTES_SOURCE_INDEX = 'CREATE UNIQUE INDEX IF NOT EXISTS lead_stage_notes_source_idx ON lead_stage_notes (source_activity_id)';
export const STAGE_NOTES_SOURCE_INDEX_ALTER = 'ALTER TABLE lead_stage_notes ADD UNIQUE INDEX lead_stage_notes_source_idx (source_activity_id)';

export const STAGE_CHANGED_NOTES_SQL = "SELECT id, lead_id, user_id, details, created_at FROM lead_activity WHERE action IN ('stage_changed', 'stage_note')";
export const STAGE_NOTE_SOURCES_SQL = 'SELECT source_activity_id FROM lead_stage_notes WHERE source_activity_id IS NOT NULL';

export const STAGE_NOTE_INSERT_SQL = `INSERT INTO lead_stage_notes (
  id, lead_id, stage, note_text, created_at, by_user_id, by_name, source_activity_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

export type StageActivityNote = {
  text: string;
  stage: string;
};

/** The single `note` string stored on a stage-change activity, if it has text. */
export function parseStageActivityNote(details: unknown): StageActivityNote | null {
  let value = details;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = typeof record.note === 'string' ? record.note.trim() : '';
  if (!text) return null;
  const stage = typeof record.stage === 'string' ? record.stage.trim().slice(0, 64) : '';
  return {text: text.slice(0, 8000), stage};
}

/** Store timestamps as ISO so newest-first ordering does not mix formats. */
export function normalizeNoteAt(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = String(value ?? '').trim();
  if (!text) return '1970-01-01T00:00:00.000Z';
  const withT = text.includes('T') ? text : text.replace(' ', 'T');
  const zoned = /Z$|[+-]\d\d:?\d\d$/.test(withT) ? withT : `${withT}Z`;
  const parsed = Date.parse(zoned);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return text.slice(0, 40);
}

export function clipName(value: string): string {
  return value.trim().slice(0, 191);
}
