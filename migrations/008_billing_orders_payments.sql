CREATE TABLE IF NOT EXISTS billing_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  order_no VARCHAR(40) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  subtotal_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payable_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  order_status ENUM('draft', 'pending_payment', 'paid', 'pending_review', 'completed', 'cancelled', 'expired') NOT NULL DEFAULT 'pending_payment',
  payment_status ENUM('unpaid', 'pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'unpaid',
  payment_method ENUM('online', 'offline') NOT NULL,
  payment_channel VARCHAR(80) NULL,
  billing_address VARCHAR(500) NULL,
  coupon_id BIGINT UNSIGNED NULL,
  coupon_code VARCHAR(80) NULL,
  coupon_discount_type ENUM('percent', 'fixed_amount') NULL,
  coupon_discount_value DECIMAL(12,2) NULL,
  effective_at DATE NULL,
  expires_at DATE NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_admin_user_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_orders_order_no (order_no),
  KEY idx_billing_orders_tenant_created (tenant_id, created_at),
  KEY idx_billing_orders_status (order_status, payment_status),
  KEY idx_billing_orders_coupon (coupon_id),
  KEY idx_billing_orders_created_by (created_by_admin_user_id),
  KEY idx_billing_orders_updated_by (updated_by_admin_user_id),
  CONSTRAINT fk_billing_orders_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_orders_coupon
    FOREIGN KEY (coupon_id) REFERENCES billing_coupons (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_orders_created_by
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_orders_updated_by
    FOREIGN KEY (updated_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  item_type ENUM('plan', 'addon', 'discount') NOT NULL,
  plan_id BIGINT UNSIGNED NULL,
  addon_id BIGINT UNSIGNED NULL,
  coupon_id BIGINT UNSIGNED NULL,
  item_code VARCHAR(80) NULL,
  item_name VARCHAR(160) NOT NULL,
  description VARCHAR(255) NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  months INT UNSIGNED NOT NULL DEFAULT 1,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  line_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_billing_order_items_order (order_id, sort_order),
  KEY idx_billing_order_items_tenant (tenant_id),
  KEY idx_billing_order_items_plan (plan_id),
  KEY idx_billing_order_items_addon (addon_id),
  KEY idx_billing_order_items_coupon (coupon_id),
  CONSTRAINT fk_billing_order_items_order
    FOREIGN KEY (order_id) REFERENCES billing_orders (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_items_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_items_plan
    FOREIGN KEY (plan_id) REFERENCES billing_plans (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_order_items_addon
    FOREIGN KEY (addon_id) REFERENCES billing_addons (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_order_items_coupon
    FOREIGN KEY (coupon_id) REFERENCES billing_coupons (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  payment_no VARCHAR(40) NOT NULL,
  payment_method ENUM('online', 'offline') NOT NULL,
  payment_channel VARCHAR(80) NULL,
  offline_payment_account_id BIGINT UNSIGNED NULL,
  payment_currency CHAR(3) NOT NULL DEFAULT 'USD',
  payment_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_status ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending',
  transaction_no VARCHAR(120) NULL,
  paid_at TIMESTAMP NULL,
  payment_proof_file_url VARCHAR(500) NULL,
  payment_proof_file_name VARCHAR(255) NULL,
  payment_proof_uploaded_at TIMESTAMP NULL,
  verified_at TIMESTAMP NULL,
  verified_by_platform_admin_id BIGINT UNSIGNED NULL,
  verification_note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_admin_user_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_payments_payment_no (payment_no),
  KEY idx_billing_payments_order (order_id),
  KEY idx_billing_payments_tenant_created (tenant_id, created_at),
  KEY idx_billing_payments_status (payment_status),
  KEY idx_billing_payments_offline_account (offline_payment_account_id),
  KEY idx_billing_payments_verified_by (verified_by_platform_admin_id),
  KEY idx_billing_payments_created_by (created_by_admin_user_id),
  KEY idx_billing_payments_updated_by (updated_by_admin_user_id),
  CONSTRAINT fk_billing_payments_order
    FOREIGN KEY (order_id) REFERENCES billing_orders (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_payments_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_payments_offline_account
    FOREIGN KEY (offline_payment_account_id) REFERENCES billing_offline_payment_accounts (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_payments_verified_by
    FOREIGN KEY (verified_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_payments_created_by
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_payments_updated_by
    FOREIGN KEY (updated_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_order_status_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  from_order_status VARCHAR(40) NULL,
  to_order_status VARCHAR(40) NOT NULL,
  from_payment_status VARCHAR(40) NULL,
  to_payment_status VARCHAR(40) NULL,
  change_reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_billing_order_status_history_order (order_id, created_at),
  KEY idx_billing_order_status_history_tenant (tenant_id, created_at),
  KEY idx_billing_order_status_history_admin (created_by_admin_user_id),
  KEY idx_billing_order_status_history_platform_admin (created_by_platform_admin_id),
  CONSTRAINT fk_billing_order_status_history_order
    FOREIGN KEY (order_id) REFERENCES billing_orders (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_status_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_status_history_admin
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_order_status_history_platform_admin
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
