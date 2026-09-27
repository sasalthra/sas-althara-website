-- 005: append the current pipeline stages and move retired ones.
--
-- Databases that already applied the original 003 ENUM do not re-run that
-- file. This ALTER keeps every previous member in its original position and
-- appends the new keys, so existing ENUM indexes are not remapped.
-- `won` stays; 004 already moves those rows. The statements below are
-- idempotent: after the UPDATE, a second run matches zero rows.
--
-- The app does the same work in lib/lead-schema.ts the first time the CRM
-- opens the database (Hostinger deploys do not run this file by hand).
--
-- RUN: after 004_lead_featured.sql. Back up `leads` first.

ALTER TABLE leads MODIFY COLUMN stage ENUM(
  'new','received','no_answer','contacted','data_received','calculation_done',
  'visit_qualified','property_visited','bank_approval','deposit_paid',
  'contract_signed','transferred','unqualified','not_interested',
  'viewing','negotiation','won','closed',
  'awaiting_offers','field_dispatch','bank_referred','postponed','properties_shown'
) NOT NULL DEFAULT 'new';

-- History first, then the stage change. A second run matches zero rows.

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'received', 'stage', 'contacted', 'note', 'تم اعتماد مرحلة تم التواصل')
FROM leads
WHERE stage = 'received';
UPDATE leads SET stage = 'contacted' WHERE stage = 'received';

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'data_received', 'stage', 'contacted', 'note', 'تم اعتماد مرحلة تم التواصل')
FROM leads
WHERE stage = 'data_received';
UPDATE leads SET stage = 'contacted' WHERE stage = 'data_received';

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'properties_shown', 'stage', 'awaiting_offers', 'note', 'تم اعتماد مرحلة بانتظار العروض')
FROM leads
WHERE stage = 'properties_shown';
UPDATE leads SET stage = 'awaiting_offers' WHERE stage = 'properties_shown';

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'تم عرض العقارات', 'stage', 'awaiting_offers', 'note', 'تم اعتماد مرحلة بانتظار العروض')
FROM leads
WHERE stage = 'تم عرض العقارات';
UPDATE leads SET stage = 'awaiting_offers' WHERE stage = 'تم عرض العقارات';

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'viewing', 'stage', 'field_dispatch', 'note', 'تم اعتماد مرحلة تفويج للميداني')
FROM leads
WHERE stage = 'viewing';
UPDATE leads SET stage = 'field_dispatch' WHERE stage = 'viewing';

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'visit_qualified', 'stage', 'field_dispatch', 'note', 'تم اعتماد مرحلة تفويج للميداني')
FROM leads
WHERE stage = 'visit_qualified';
UPDATE leads SET stage = 'field_dispatch' WHERE stage = 'visit_qualified';

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'calculation_done', 'stage', 'contacted', 'note', 'تم اعتماد مرحلة تم التواصل')
FROM leads
WHERE stage = 'calculation_done';
UPDATE leads SET stage = 'contacted' WHERE stage = 'calculation_done';

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'تم عمل حسبة للعميل', 'stage', 'contacted', 'note', 'تم اعتماد مرحلة تم التواصل')
FROM leads
WHERE stage = 'تم عمل حسبة للعميل';
UPDATE leads SET stage = 'contacted' WHERE stage = 'تم عمل حسبة للعميل';

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'bank_approval', 'stage', 'bank_referred', 'note', 'تم اعتماد مرحلة تمت إحالة معاملة العميل للبنك')
FROM leads
WHERE stage = 'bank_approval';
UPDATE leads SET stage = 'bank_referred' WHERE stage = 'bank_approval';

INSERT INTO lead_activity (id, lead_id, user_id, action, details)
SELECT UUID(), id, 'system', 'stage_changed',
  JSON_OBJECT('previousStage', 'مؤهل بانتظار موافقة البنك', 'stage', 'bank_referred', 'note', 'تم اعتماد مرحلة تمت إحالة معاملة العميل للبنك')
FROM leads
WHERE stage = 'مؤهل بانتظار موافقة البنك';
UPDATE leads SET stage = 'bank_referred' WHERE stage = 'مؤهل بانتظار موافقة البنك';
