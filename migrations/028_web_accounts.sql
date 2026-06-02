CREATE TABLE IF NOT EXISTS web_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NULL,
  username VARCHAR(120) NOT NULL,
  display_name VARCHAR(120) NULL,
  email VARCHAR(255) NOT NULL,
  phone_number VARCHAR(40) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  status ENUM('pending', 'active', 'inactive', 'disabled', 'expired', 'rejected') NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TIMESTAMP NULL,
  service_expires_at TIMESTAMP NULL,
  reviewed_by_platform_admin_id BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  last_login_at TIMESTAMP NULL,
  last_seen_at TIMESTAMP NULL,
  last_user_agent VARCHAR(255) NULL,
  last_ip VARCHAR(45) NULL,
  notes TEXT NULL,
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_web_users_username (username),
  KEY idx_web_users_tenant_id (tenant_id),
  KEY idx_web_users_email (email),
  KEY idx_web_users_status (status),
  KEY idx_web_users_role (role),
  KEY idx_web_users_reviewed_by_platform_admin_id (reviewed_by_platform_admin_id),
  KEY idx_web_users_created_by_admin_user_id (created_by_admin_user_id),
  CONSTRAINT fk_web_users_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_web_users_platform_reviewer
    FOREIGN KEY (reviewed_by_platform_admin_id) REFERENCES admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_web_users_creator
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_order_web_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  web_user_id BIGINT UNSIGNED NOT NULL,
  username VARCHAR(120) NOT NULL,
  display_name VARCHAR(120) NULL,
  email VARCHAR(255) NULL,
  phone_number VARCHAR(40) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  account_status ENUM('pending', 'active', 'inactive', 'disabled', 'expired', 'rejected') NOT NULL DEFAULT 'active',
  service_starts_at DATE NULL,
  service_expires_at DATE NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by_admin_user_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_order_web_accounts_order_user (order_id, web_user_id),
  KEY idx_billing_order_web_accounts_order (order_id, assigned_at),
  KEY idx_billing_order_web_accounts_tenant (tenant_id, assigned_at),
  KEY idx_billing_order_web_accounts_web_user (web_user_id),
  KEY idx_billing_order_web_accounts_assigned_by (assigned_by_admin_user_id),
  CONSTRAINT fk_billing_order_web_accounts_order
    FOREIGN KEY (order_id) REFERENCES billing_orders (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_web_accounts_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_web_accounts_web_user
    FOREIGN KEY (web_user_id) REFERENCES web_users (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_billing_order_web_accounts_assigned_by
    FOREIGN KEY (assigned_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
