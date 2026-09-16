-- 003: bring the production `leads` table up to what the CRM expansion actually writes and reads.
--
-- WHY THIS EXISTS
-- 001_leads.sql created `leads` with: id, owner, name, phone, property_id, stage,
-- notes, follow_up, created_at, updated_at.
-- The expansion (lib/import-service.ts, app/api/leads/route.ts, lib/reports.ts)
-- reads and writes FIVE columns that were never added:
--   created_by, assigned_to, field_assigned_to, source, property_other
-- Result on a 001-only database: every leads-based query dies with
-- "Unknown column 'l.property_other' in 'field list'". The reports API catches
-- that and renders "تعذر قراءة المصدر" — which is a READ FAILURE, not a zero.
-- Because the properties report reuses the same leads FROM clause, properties
-- appear empty too even when data/properties.json holds every catalog entry.
--
-- It also widens `stage`: lib/lead-input.ts defines 18 stage keys, while the
-- 001 ENUM accepts only 6, so saving any newer stage fails or truncates.
--
-- SAFETY
-- Idempotent: re-running changes nothing. Additive only: no column is dropped or
-- renamed and no row is deleted. Backfill sets assignment columns to '' (the same
-- value import-service.ts writes for "unassigned") and source to 'manual'
-- (the schema default in lib/lead-input.ts), so existing leads stay visible to
-- their owner instead of silently leaving the authorized scope.
--
-- RUN ORDER: after 001_leads.sql and 002_expansion.sql. Back up `leads` first.

-- MySQL 8.0 has no "ADD COLUMN IF NOT EXISTS", so each column is guarded.
DROP PROCEDURE IF EXISTS sas_add_lead_column;
DELIMITER //
CREATE PROCEDURE sas_add_lead_column(IN col_name VARCHAR(64), IN col_ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = col_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE leads ADD COLUMN ', col_ddl);
    PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- Who created the lead. Authorization treats owner OR created_by as ownership,
-- so this must never be NULL or those rows drop out of every non-admin report.
CALL sas_add_lead_column('created_by',
  "created_by VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''");

-- Sales assignment. '' means unassigned (matches import-service.ts).
CALL sas_add_lead_column('assigned_to',
  "assigned_to VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''");

-- Field assignment. '' means unassigned.
CALL sas_add_lead_column('field_assigned_to',
  "field_assigned_to VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''");

-- Lead source. lib/lead-input.ts allows 1..80 chars, default 'manual'.
CALL sas_add_lead_column('source',
  "source VARCHAR(80) NOT NULL DEFAULT 'manual'");

-- Free-text property description used when property_id = 'other'.
-- lib/lead-input.ts caps it at 500 chars.
CALL sas_add_lead_column('property_other',
  "property_other VARCHAR(500) NOT NULL DEFAULT ''");

DROP PROCEDURE IF EXISTS sas_add_lead_column;

-- Backfill rows that existed before the columns did. Idempotent: only touches
-- rows still holding the placeholder, so a second run is a no-op.
UPDATE leads SET created_by = owner WHERE created_by = '';
UPDATE leads SET source = 'manual' WHERE source = '';

-- Widen `stage` to the 18 keys in lib/lead-input.ts (001 allowed only 6).
-- Existing values are a strict subset, so no row can be invalidated.
ALTER TABLE leads MODIFY COLUMN stage ENUM(
  'new','received','no_answer','contacted','data_received','calculation_done',
  'visit_qualified','property_visited','bank_approval','deposit_paid',
  'contract_signed','transferred','unqualified','not_interested',
  'viewing','negotiation','won','closed'
) NOT NULL DEFAULT 'new';

-- Indexes that the report scope filters actually use.
-- Guarded the same way: MySQL 8.0 has no "ADD INDEX IF NOT EXISTS".
DROP PROCEDURE IF EXISTS sas_add_lead_index;
DELIMITER //
CREATE PROCEDURE sas_add_lead_index(IN idx_name VARCHAR(64), IN idx_ddl TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND INDEX_NAME = idx_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE leads ADD INDEX ', idx_ddl);
    PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;
CALL sas_add_lead_index('leads_assigned_idx',      'leads_assigned_idx (assigned_to, created_at)');
CALL sas_add_lead_index('leads_field_idx',         'leads_field_idx (field_assigned_to, created_at)');
CALL sas_add_lead_index('leads_created_by_idx',    'leads_created_by_idx (created_by, created_at)');
CALL sas_add_lead_index('leads_source_idx',        'leads_source_idx (source)');
CALL sas_add_lead_index('leads_property_idx',      'leads_property_idx (property_id)');
DROP PROCEDURE IF EXISTS sas_add_lead_index;

-- Verify: expect 5 rows, one per added column.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads'
  AND COLUMN_NAME IN ('created_by','assigned_to','field_assigned_to','source','property_other')
ORDER BY COLUMN_NAME;
