-- Import once into a NEW empty CRM database, not the WordPress database.
CREATE TABLE IF NOT EXISTS leads (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(22) NOT NULL,
  property_id VARCHAR(32) NOT NULL,
  stage ENUM('new','contacted','viewing','negotiation','won','closed') NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL,
  follow_up VARCHAR(10) NOT NULL DEFAULT '',
  created_at VARCHAR(24) NOT NULL,
  updated_at VARCHAR(24) NOT NULL,
  INDEX leads_owner_created_idx (owner, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
