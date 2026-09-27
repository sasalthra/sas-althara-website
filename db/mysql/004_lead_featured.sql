-- 004: featured / VIP clients («عميل مميز») and retire stage `won`.
--
-- Additive and idempotent. Existing rows default to 0 (not featured).
-- `won` stays in the stage ENUM. Rows still stored as `won` are moved to
-- `contract_signed` and a lead_activity row records the change.
-- The app also does this on first CRM database access. This file remains
-- for `npm run db:migrate` / phpMyAdmin.
--
-- RUN: after 003_leads_expansion_columns.sql. Back up `leads` first.
-- Re-running changes nothing once `won` rows are gone.

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

CALL sas_add_lead_column('is_featured',
  'is_featured TINYINT(1) NOT NULL DEFAULT 0');

DROP PROCEDURE IF EXISTS sas_add_lead_column;

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

CALL sas_add_lead_index('leads_featured_idx', 'leads_featured_idx (is_featured, created_at)');
DROP PROCEDURE IF EXISTS sas_add_lead_index;

-- History first, then the stage change. A second run matches zero rows.
INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'won', 'stage', 'contract_signed', 'note', 'تم اعتماد مرحلة وقع عقد')
FROM leads
WHERE stage = 'won';

UPDATE leads SET stage = 'contract_signed' WHERE stage = 'won';

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads'
  AND COLUMN_NAME = 'is_featured';
