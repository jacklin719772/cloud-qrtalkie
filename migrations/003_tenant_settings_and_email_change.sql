ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tenant_number VARCHAR(40) NULL AFTER id,
  ADD COLUMN IF NOT EXISTS enterprise_email VARCHAR(255) NULL AFTER contact_email,
  ADD COLUMN IF NOT EXISTS contact_person VARCHAR(120) NULL AFTER enterprise_email,
  ADD COLUMN IF NOT EXISTS billing_address VARCHAR(500) NULL AFTER contact_phone,
  ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20) NULL AFTER billing_address,
  ADD UNIQUE KEY IF NOT EXISTS uq_tenants_tenant_number (tenant_number);

UPDATE tenants
SET tenant_number = CONCAT('TENANT-', LPAD(id, 6, '0'))
WHERE tenant_number IS NULL OR tenant_number = '';

CREATE TABLE IF NOT EXISTS admin_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_sessions_token_hash (token_hash),
  KEY idx_admin_sessions_admin_user_id (admin_user_id),
  CONSTRAINT fk_admin_sessions_admin_user
    FOREIGN KEY (admin_user_id) REFERENCES admin_users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_email_change_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  new_email VARCHAR(255) NOT NULL,
  new_password_hash VARCHAR(255) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_email_change_codes_admin_user_id (admin_user_id),
  KEY idx_admin_email_change_codes_new_email (new_email),
  KEY idx_admin_email_change_codes_created_at (created_at),
  CONSTRAINT fk_admin_email_change_codes_admin_user
    FOREIGN KEY (admin_user_id) REFERENCES admin_users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
