CREATE TABLE IF NOT EXISTS billing_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  account_quantity INT UNSIGNED NOT NULL,
  feature_summary VARCHAR(160) NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_plans_code (plan_code),
  KEY idx_billing_plans_status_sort (status, sort_order),
  KEY idx_billing_plans_created_by (created_by_platform_admin_id),
  KEY idx_billing_plans_updated_by (updated_by_platform_admin_id),
  CONSTRAINT fk_billing_plans_created_by
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_plans_updated_by
    FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_account_price_tiers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id BIGINT UNSIGNED NOT NULL,
  account_quantity INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  unit_price DECIMAL(12,2) NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_account_price_tiers_plan_qty_currency (plan_id, account_quantity, currency),
  KEY idx_billing_account_price_tiers_status_sort (status, sort_order),
  KEY idx_billing_account_price_tiers_created_by (created_by_platform_admin_id),
  KEY idx_billing_account_price_tiers_updated_by (updated_by_platform_admin_id),
  CONSTRAINT fk_billing_account_price_tiers_plan
    FOREIGN KEY (plan_id) REFERENCES billing_plans (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_account_price_tiers_created_by
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_account_price_tiers_updated_by
    FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_terms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  term_code VARCHAR(40) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  months INT UNSIGNED NOT NULL,
  discount_percent DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_terms_code (term_code),
  UNIQUE KEY uq_billing_terms_months (months),
  KEY idx_billing_terms_status_sort (status, sort_order),
  KEY idx_billing_terms_created_by (created_by_platform_admin_id),
  KEY idx_billing_terms_updated_by (updated_by_platform_admin_id),
  CONSTRAINT fk_billing_terms_created_by
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_terms_updated_by
    FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_plan_terms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NOT NULL,
  price_multiplier DECIMAL(8,4) NOT NULL DEFAULT 1.0000,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_plan_terms_plan_term (plan_id, term_id),
  KEY idx_billing_plan_terms_status_sort (status, sort_order),
  KEY idx_billing_plan_terms_created_by (created_by_platform_admin_id),
  KEY idx_billing_plan_terms_updated_by (updated_by_platform_admin_id),
  CONSTRAINT fk_billing_plan_terms_plan
    FOREIGN KEY (plan_id) REFERENCES billing_plans (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_plan_terms_term
    FOREIGN KEY (term_id) REFERENCES billing_terms (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_plan_terms_created_by
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_plan_terms_updated_by
    FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_addons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  addon_code VARCHAR(80) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  billing_unit ENUM('account', 'tenant', 'unit') NOT NULL DEFAULT 'account',
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_addons_code (addon_code),
  KEY idx_billing_addons_status_sort (status, sort_order),
  KEY idx_billing_addons_created_by (created_by_platform_admin_id),
  KEY idx_billing_addons_updated_by (updated_by_platform_admin_id),
  CONSTRAINT fk_billing_addons_created_by
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_addons_updated_by
    FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_plan_addons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_id BIGINT UNSIGNED NOT NULL,
  addon_id BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  unit_price DECIMAL(12,2) NOT NULL,
  sync_with_plan_term TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_plan_addons_plan_addon_currency (plan_id, addon_id, currency),
  KEY idx_billing_plan_addons_status_sort (status, sort_order),
  KEY idx_billing_plan_addons_created_by (created_by_platform_admin_id),
  KEY idx_billing_plan_addons_updated_by (updated_by_platform_admin_id),
  CONSTRAINT fk_billing_plan_addons_plan
    FOREIGN KEY (plan_id) REFERENCES billing_plans (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_plan_addons_addon
    FOREIGN KEY (addon_id) REFERENCES billing_addons (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_plan_addons_created_by
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_plan_addons_updated_by
    FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_coupons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NULL,
  coupon_code VARCHAR(80) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  discount_type ENUM('percent', 'fixed_amount') NOT NULL,
  discount_value DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NULL,
  valid_from DATE NULL,
  valid_until DATE NOT NULL,
  max_redemptions INT UNSIGNED NULL,
  redeemed_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('active', 'disabled', 'expired') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_coupons_code (coupon_code),
  KEY idx_billing_coupons_tenant_status (tenant_id, status, valid_until),
  KEY idx_billing_coupons_created_by (created_by_platform_admin_id),
  KEY idx_billing_coupons_updated_by (updated_by_platform_admin_id),
  CONSTRAINT fk_billing_coupons_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_coupons_created_by
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_coupons_updated_by
    FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO billing_plans (plan_code, name, description, account_quantity, feature_summary, status, sort_order)
SELECT 'pro', 'Pro', 'Entry plan for small teams', 100, '標準通訊功能', 'active', 10
WHERE NOT EXISTS (SELECT 1 FROM billing_plans WHERE plan_code = 'pro');

INSERT INTO billing_plans (plan_code, name, description, account_quantity, feature_summary, status, sort_order)
SELECT 'business', 'Business', 'Team management plan', 150, '含團隊管理', 'active', 20
WHERE NOT EXISTS (SELECT 1 FROM billing_plans WHERE plan_code = 'business');

INSERT INTO billing_plans (plan_code, name, description, account_quantity, feature_summary, status, sort_order)
SELECT 'enterprise', 'Enterprise', 'Advanced support plan', 300, '進階支援', 'active', 30
WHERE NOT EXISTS (SELECT 1 FROM billing_plans WHERE plan_code = 'enterprise');

INSERT INTO billing_plans (plan_code, name, description, account_quantity, feature_summary, status, sort_order)
SELECT 'ultimate', 'Ultimate', 'Full capability plan', 500, '完整功能', 'active', 40
WHERE NOT EXISTS (SELECT 1 FROM billing_plans WHERE plan_code = 'ultimate');

INSERT INTO billing_account_price_tiers (plan_id, account_quantity, currency, unit_price, status, sort_order)
SELECT id, 100, 'USD', 9.99, 'active', 10 FROM billing_plans WHERE plan_code = 'pro'
ON DUPLICATE KEY UPDATE unit_price = VALUES(unit_price), status = VALUES(status), sort_order = VALUES(sort_order);

INSERT INTO billing_account_price_tiers (plan_id, account_quantity, currency, unit_price, status, sort_order)
SELECT id, 150, 'USD', 14.99, 'active', 20 FROM billing_plans WHERE plan_code = 'business'
ON DUPLICATE KEY UPDATE unit_price = VALUES(unit_price), status = VALUES(status), sort_order = VALUES(sort_order);

INSERT INTO billing_account_price_tiers (plan_id, account_quantity, currency, unit_price, status, sort_order)
SELECT id, 300, 'USD', 24.99, 'active', 30 FROM billing_plans WHERE plan_code = 'enterprise'
ON DUPLICATE KEY UPDATE unit_price = VALUES(unit_price), status = VALUES(status), sort_order = VALUES(sort_order);

INSERT INTO billing_account_price_tiers (plan_id, account_quantity, currency, unit_price, status, sort_order)
SELECT id, 500, 'USD', 39.99, 'active', 40 FROM billing_plans WHERE plan_code = 'ultimate'
ON DUPLICATE KEY UPDATE unit_price = VALUES(unit_price), status = VALUES(status), sort_order = VALUES(sort_order);

INSERT INTO billing_terms (term_code, display_name, months, discount_percent, status, sort_order)
SELECT 'monthly', '月付', 1, 0.00, 'active', 10
WHERE NOT EXISTS (SELECT 1 FROM billing_terms WHERE term_code = 'monthly');

INSERT INTO billing_terms (term_code, display_name, months, discount_percent, status, sort_order)
SELECT 'quarterly', '三個月', 3, 3.00, 'active', 20
WHERE NOT EXISTS (SELECT 1 FROM billing_terms WHERE term_code = 'quarterly');

INSERT INTO billing_terms (term_code, display_name, months, discount_percent, status, sort_order)
SELECT 'half_year', '半年', 6, 6.00, 'active', 30
WHERE NOT EXISTS (SELECT 1 FROM billing_terms WHERE term_code = 'half_year');

INSERT INTO billing_terms (term_code, display_name, months, discount_percent, status, sort_order)
SELECT 'yearly', '年付', 12, 10.00, 'active', 40
WHERE NOT EXISTS (SELECT 1 FROM billing_terms WHERE term_code = 'yearly');

INSERT INTO billing_plan_terms (plan_id, term_id, price_multiplier, status, sort_order)
SELECT p.id, t.id, 1.0000, 'active', t.sort_order
FROM billing_plans p
JOIN billing_terms t ON t.status = 'active'
WHERE p.status = 'active'
ON DUPLICATE KEY UPDATE status = VALUES(status), sort_order = VALUES(sort_order);

INSERT INTO billing_addons (addon_code, name, description, billing_unit, status, sort_order)
SELECT 'ecard', 'Ecard', 'Electronic business card add-on', 'account', 'active', 10
WHERE NOT EXISTS (SELECT 1 FROM billing_addons WHERE addon_code = 'ecard');

INSERT INTO billing_addons (addon_code, name, description, billing_unit, status, sort_order)
SELECT 'call_center', 'Call Center', 'Call center capability add-on', 'account', 'active', 20
WHERE NOT EXISTS (SELECT 1 FROM billing_addons WHERE addon_code = 'call_center');

INSERT INTO billing_plan_addons (plan_id, addon_id, currency, unit_price, sync_with_plan_term, status, sort_order)
SELECT p.id, a.id, 'USD', 2.00, 1, 'active', a.sort_order
FROM billing_plans p
JOIN billing_addons a ON a.addon_code = 'ecard'
WHERE p.status = 'active'
ON DUPLICATE KEY UPDATE unit_price = VALUES(unit_price), sync_with_plan_term = VALUES(sync_with_plan_term), status = VALUES(status), sort_order = VALUES(sort_order);

INSERT INTO billing_plan_addons (plan_id, addon_id, currency, unit_price, sync_with_plan_term, status, sort_order)
SELECT p.id, a.id, 'USD', 5.00, 1, 'active', a.sort_order
FROM billing_plans p
JOIN billing_addons a ON a.addon_code = 'call_center'
WHERE p.status = 'active'
ON DUPLICATE KEY UPDATE unit_price = VALUES(unit_price), sync_with_plan_term = VALUES(sync_with_plan_term), status = VALUES(status), sort_order = VALUES(sort_order);

INSERT INTO billing_coupons (
  tenant_id, coupon_code, display_name, discount_type, discount_value, currency,
  valid_from, valid_until, max_redemptions, status
)
SELECT NULL, 'SAVE20', 'Demo 20% Discount', 'percent', 20.00, NULL, '2026-05-01', '2026-12-31', NULL, 'active'
WHERE NOT EXISTS (SELECT 1 FROM billing_coupons WHERE coupon_code = 'SAVE20');

INSERT INTO billing_coupons (
  tenant_id, coupon_code, display_name, discount_type, discount_value, currency,
  valid_from, valid_until, max_redemptions, status
)
SELECT NULL, 'FIXED50', 'Demo USD 50 Discount', 'fixed_amount', 50.00, 'USD', '2026-05-01', '2026-08-31', NULL, 'active'
WHERE NOT EXISTS (SELECT 1 FROM billing_coupons WHERE coupon_code = 'FIXED50');
