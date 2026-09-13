-- New expansion tables. Run only after 001 in an isolated test database.
-- Existing installations must use a reviewed, backed-up staging migration.
CREATE TABLE IF NOT EXISTS crm_users (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 username VARCHAR(80) NOT NULL UNIQUE,password_hash VARCHAR(255) NOT NULL,
 name VARCHAR(100) NOT NULL,email VARCHAR(255),phone VARCHAR(30),
 role ENUM('admin','supervisor','sales','field') NOT NULL,active TINYINT NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS lead_activity (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id VARCHAR(255) NOT NULL,action VARCHAR(80) NOT NULL,details JSON NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX activity_lead_time (lead_id,created_at), FOREIGN KEY (lead_id) REFERENCES leads(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS crm_audit (
 id CHAR(36) PRIMARY KEY,actor_id VARCHAR(255) NOT NULL,action VARCHAR(80) NOT NULL,
 target_id VARCHAR(255) NOT NULL,details JSON NOT NULL,created_at VARCHAR(24) NOT NULL,
 INDEX audit_actor_time (actor_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS crm_transactions (
 id CHAR(36) PRIMARY KEY,lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 data JSON NOT NULL,confirmed_due DECIMAL(15,2) NULL,version INT NOT NULL DEFAULT 1,
 updated_at VARCHAR(24) NOT NULL,INDEX transactions_lead (lead_id),
 FOREIGN KEY (lead_id) REFERENCES leads(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS hr_profiles (
 user_id CHAR(36) PRIMARY KEY,job_title VARCHAR(100) NOT NULL,department VARCHAR(100) NOT NULL,
 leave_balance DECIMAL(6,2) NOT NULL DEFAULT 0,schedule JSON NOT NULL,updated_at VARCHAR(24) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS hr_attendance (
 user_id CHAR(36) NOT NULL,work_day CHAR(10) NOT NULL,check_in VARCHAR(24) NOT NULL,
 check_out VARCHAR(24),late_minutes INT NOT NULL DEFAULT 0,
 in_key CHAR(36) NOT NULL UNIQUE,out_key CHAR(36) UNIQUE,
 in_distance INT NOT NULL,in_accuracy DECIMAL(9,2) NOT NULL,
 out_distance INT,out_accuracy DECIMAL(9,2),PRIMARY KEY(user_id,work_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS hr_requests (
 id CHAR(36) PRIMARY KEY,user_id VARCHAR(255) NOT NULL,type VARCHAR(30) NOT NULL,
 details TEXT NOT NULL,status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
 created_at VARCHAR(24) NOT NULL,start_date CHAR(10),end_date CHAR(10),review_note TEXT,reviewed_by VARCHAR(255),reviewed_at VARCHAR(24),
 INDEX requests_user_time(user_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS hr_announcements (
 id CHAR(36) PRIMARY KEY,title VARCHAR(150) NOT NULL,details TEXT NOT NULL,created_at VARCHAR(24) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS crm_import_lock (id VARCHAR(30) PRIMARY KEY) ENGINE=InnoDB;
INSERT IGNORE INTO crm_import_lock (id) VALUES ('leads');
CREATE TABLE IF NOT EXISTS crm_import_rows (
 id CHAR(36) PRIMARY KEY,lead_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 source VARCHAR(80) NOT NULL,raw_data JSON NOT NULL,created_at VARCHAR(24) NOT NULL,
 INDEX import_lead (lead_id),FOREIGN KEY (lead_id) REFERENCES leads(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS crm_integrations (
 id VARCHAR(30) PRIMARY KEY,config JSON NOT NULL,updated_by VARCHAR(255) NOT NULL,
 last_run VARCHAR(24),last_result JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ai_settings (
 id VARCHAR(30) PRIMARY KEY,provider VARCHAR(30) NOT NULL,model VARCHAR(100) NOT NULL,
 encrypted_key TEXT NOT NULL,updated_at VARCHAR(24) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ai_usage (
 user_id VARCHAR(255) NOT NULL,hour_key CHAR(13) NOT NULL,requests INT NOT NULL,
 PRIMARY KEY(user_id,hour_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
