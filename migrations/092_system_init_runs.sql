CREATE TABLE IF NOT EXISTS system_init_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(64) NOT NULL,
  admin_user_id BIGINT UNSIGNED NULL,
  admin_email VARCHAR(255) NOT NULL,
  backup_filename VARCHAR(255) NOT NULL,
  backup_sha256 CHAR(64) NOT NULL,
  status ENUM('running','success','failed') NOT NULL DEFAULT 'running',
  summary_json LONGTEXT NULL,
  error_message TEXT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  UNIQUE KEY uk_run_id (run_id),
  KEY idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
