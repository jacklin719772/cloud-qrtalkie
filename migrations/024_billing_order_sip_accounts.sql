CREATE TABLE IF NOT EXISTS billing_order_sip_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  sip_user_id BIGINT UNSIGNED NOT NULL,
  username VARCHAR(120) NOT NULL,
  sip_domain VARCHAR(255) NOT NULL DEFAULT 'sip.qrtalkie.org',
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
  UNIQUE KEY uq_billing_order_sip_accounts_order_user (order_id, sip_user_id),
  KEY idx_billing_order_sip_accounts_order (order_id, assigned_at),
  KEY idx_billing_order_sip_accounts_tenant (tenant_id, assigned_at),
  KEY idx_billing_order_sip_accounts_sip_user (sip_user_id),
  KEY idx_billing_order_sip_accounts_assigned_by (assigned_by_admin_user_id),
  CONSTRAINT fk_billing_order_sip_accounts_order
    FOREIGN KEY (order_id) REFERENCES billing_orders (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_sip_accounts_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_sip_accounts_sip_user
    FOREIGN KEY (sip_user_id) REFERENCES sip_users (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_billing_order_sip_accounts_assigned_by
    FOREIGN KEY (assigned_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
