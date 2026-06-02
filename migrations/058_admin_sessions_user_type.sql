ALTER TABLE admin_sessions ADD COLUMN user_type ENUM('admin','sip') NOT NULL DEFAULT 'admin' AFTER admin_user_id;
ALTER TABLE admin_sessions ADD COLUMN sip_user_id INT NULL AFTER user_type;
ALTER TABLE admin_sessions ADD INDEX idx_user_type_sip (user_type, sip_user_id);
