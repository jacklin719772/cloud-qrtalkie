-- 1. 在原有的 sip_users 表中新增 role 字段
ALTER TABLE sip_users
  ADD COLUMN IF NOT EXISTS role ENUM('admin', 'user') NOT NULL DEFAULT 'user' AFTER password_hash,
  MODIFY COLUMN status ENUM('pending', 'active', 'inactive', 'disabled', 'expired', 'rejected') NOT NULL DEFAULT 'pending',
  ADD KEY IF NOT EXISTS idx_sip_users_role (role);

-- 2. 新增 sip_external_accounts 表以存放 External Account 相关字段
CREATE TABLE IF NOT EXISTS sip_external_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sip_user_id BIGINT UNSIGNED NOT NULL,
  external_username VARCHAR(120) NOT NULL,
  external_domain VARCHAR(255) NOT NULL,
  external_password VARCHAR(255) NOT NULL,
  realm VARCHAR(255) NULL,
  registrar VARCHAR(255) NULL,
  outbound_proxy VARCHAR(255) NULL,
  protocol ENUM('UDP', 'TCP', 'TLS') NOT NULL DEFAULT 'UDP',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- 确保每个 SIP 账号只绑定一个默认的外部账号（如果需要支持多个，可移除此 UNIQUE KEY）
  UNIQUE KEY uq_sip_external_accounts_user (sip_user_id),
  CONSTRAINT fk_sip_external_accounts_user
    FOREIGN KEY (sip_user_id) REFERENCES sip_users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;