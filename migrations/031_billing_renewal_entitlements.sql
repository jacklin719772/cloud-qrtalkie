ALTER TABLE billing_orders
  ADD COLUMN IF NOT EXISTS order_type ENUM('new_purchase', 'renewal') NOT NULL DEFAULT 'new_purchase' AFTER order_no,
  ADD COLUMN IF NOT EXISTS renewal_source_order_id BIGINT UNSIGNED NULL AFTER order_type,
  ADD COLUMN IF NOT EXISTS renewal_base_expires_at DATE NULL AFTER renewal_source_order_id;

ALTER TABLE billing_orders
  ADD KEY IF NOT EXISTS idx_billing_orders_order_type (order_type),
  ADD KEY IF NOT EXISTS idx_billing_orders_renewal_source (renewal_source_order_id);

SET @fk_billing_orders_renewal_source_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_orders'
    AND CONSTRAINT_NAME = 'fk_billing_orders_renewal_source'
);

SET @fk_billing_orders_renewal_source_sql = IF(
  @fk_billing_orders_renewal_source_exists = 0,
  'ALTER TABLE billing_orders ADD CONSTRAINT fk_billing_orders_renewal_source FOREIGN KEY (renewal_source_order_id) REFERENCES billing_orders (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @fk_billing_orders_renewal_source_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS tenant_sip_account_entitlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  sip_user_id BIGINT UNSIGNED NOT NULL,
  first_order_id BIGINT UNSIGNED NULL,
  current_order_id BIGINT UNSIGNED NULL,
  last_renewal_order_id BIGINT UNSIGNED NULL,
  status ENUM('active', 'inactive', 'disabled', 'expired', 'revoked') NOT NULL DEFAULT 'active',
  service_starts_at DATE NULL,
  service_expires_at DATE NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by_admin_user_id BIGINT UNSIGNED NULL,
  renewed_at TIMESTAMP NULL,
  renewed_by_admin_user_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_sip_entitlements_user (sip_user_id),
  KEY idx_tenant_sip_entitlements_tenant (tenant_id, status, service_expires_at),
  KEY idx_tenant_sip_entitlements_first_order (first_order_id),
  KEY idx_tenant_sip_entitlements_current_order (current_order_id),
  KEY idx_tenant_sip_entitlements_last_renewal_order (last_renewal_order_id),
  KEY idx_tenant_sip_entitlements_assigned_by (assigned_by_admin_user_id),
  KEY idx_tenant_sip_entitlements_renewed_by (renewed_by_admin_user_id),
  CONSTRAINT fk_tenant_sip_entitlements_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_tenant_sip_entitlements_user
    FOREIGN KEY (sip_user_id) REFERENCES sip_users (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_sip_entitlements_first_order
    FOREIGN KEY (first_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_tenant_sip_entitlements_current_order
    FOREIGN KEY (current_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_tenant_sip_entitlements_last_renewal_order
    FOREIGN KEY (last_renewal_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_tenant_sip_entitlements_assigned_by
    FOREIGN KEY (assigned_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_tenant_sip_entitlements_renewed_by
    FOREIGN KEY (renewed_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tenant_web_account_entitlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  web_user_id BIGINT UNSIGNED NOT NULL,
  first_order_id BIGINT UNSIGNED NULL,
  current_order_id BIGINT UNSIGNED NULL,
  last_renewal_order_id BIGINT UNSIGNED NULL,
  status ENUM('active', 'inactive', 'disabled', 'expired', 'revoked') NOT NULL DEFAULT 'active',
  service_starts_at DATE NULL,
  service_expires_at DATE NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by_admin_user_id BIGINT UNSIGNED NULL,
  renewed_at TIMESTAMP NULL,
  renewed_by_admin_user_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_web_entitlements_user (web_user_id),
  KEY idx_tenant_web_entitlements_tenant (tenant_id, status, service_expires_at),
  KEY idx_tenant_web_entitlements_first_order (first_order_id),
  KEY idx_tenant_web_entitlements_current_order (current_order_id),
  KEY idx_tenant_web_entitlements_last_renewal_order (last_renewal_order_id),
  KEY idx_tenant_web_entitlements_assigned_by (assigned_by_admin_user_id),
  KEY idx_tenant_web_entitlements_renewed_by (renewed_by_admin_user_id),
  CONSTRAINT fk_tenant_web_entitlements_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_tenant_web_entitlements_user
    FOREIGN KEY (web_user_id) REFERENCES web_users (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_tenant_web_entitlements_first_order
    FOREIGN KEY (first_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_tenant_web_entitlements_current_order
    FOREIGN KEY (current_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_tenant_web_entitlements_last_renewal_order
    FOREIGN KEY (last_renewal_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_tenant_web_entitlements_assigned_by
    FOREIGN KEY (assigned_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_tenant_web_entitlements_renewed_by
    FOREIGN KEY (renewed_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE billing_order_sip_accounts
  ADD COLUMN IF NOT EXISTS entitlement_id BIGINT UNSIGNED NULL AFTER sip_user_id,
  ADD KEY IF NOT EXISTS idx_billing_order_sip_accounts_entitlement (entitlement_id);

SET @fk_billing_order_sip_accounts_entitlement_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_order_sip_accounts'
    AND CONSTRAINT_NAME = 'fk_billing_order_sip_accounts_entitlement'
);

SET @fk_billing_order_sip_accounts_entitlement_sql = IF(
  @fk_billing_order_sip_accounts_entitlement_exists = 0,
  'ALTER TABLE billing_order_sip_accounts ADD CONSTRAINT fk_billing_order_sip_accounts_entitlement FOREIGN KEY (entitlement_id) REFERENCES tenant_sip_account_entitlements (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @fk_billing_order_sip_accounts_entitlement_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE billing_order_web_accounts
  ADD COLUMN IF NOT EXISTS entitlement_id BIGINT UNSIGNED NULL AFTER web_user_id,
  ADD KEY IF NOT EXISTS idx_billing_order_web_accounts_entitlement (entitlement_id);

SET @fk_billing_order_web_accounts_entitlement_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_order_web_accounts'
    AND CONSTRAINT_NAME = 'fk_billing_order_web_accounts_entitlement'
);

SET @fk_billing_order_web_accounts_entitlement_sql = IF(
  @fk_billing_order_web_accounts_entitlement_exists = 0,
  'ALTER TABLE billing_order_web_accounts ADD CONSTRAINT fk_billing_order_web_accounts_entitlement FOREIGN KEY (entitlement_id) REFERENCES tenant_web_account_entitlements (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @fk_billing_order_web_accounts_entitlement_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT IGNORE INTO tenant_sip_account_entitlements (
  tenant_id, sip_user_id, first_order_id, current_order_id, status,
  service_starts_at, service_expires_at, assigned_at, assigned_by_admin_user_id
)
SELECT
  latest.tenant_id,
  latest.sip_user_id,
  latest.first_order_id,
  latest.current_order_id,
  CASE
    WHEN latest.service_expires_at IS NOT NULL AND latest.service_expires_at < CURDATE() THEN 'expired'
    WHEN latest.account_status IN ('active', 'inactive', 'disabled', 'expired') THEN latest.account_status
    ELSE 'active'
  END,
  latest.service_starts_at,
  latest.service_expires_at,
  COALESCE(latest.assigned_at, CURRENT_TIMESTAMP),
  latest.assigned_by_admin_user_id
FROM (
  SELECT
    a.*,
    (SELECT MIN(a2.order_id)
     FROM billing_order_sip_accounts a2
     WHERE a2.tenant_id = a.tenant_id AND a2.sip_user_id = a.sip_user_id) AS first_order_id,
    a.order_id AS current_order_id
  FROM billing_order_sip_accounts a
  WHERE NOT EXISTS (
    SELECT 1
    FROM billing_order_sip_accounts newer
    WHERE newer.tenant_id = a.tenant_id
      AND newer.sip_user_id = a.sip_user_id
      AND (
        COALESCE(newer.service_expires_at, '1000-01-01') > COALESCE(a.service_expires_at, '1000-01-01')
        OR (
          COALESCE(newer.service_expires_at, '1000-01-01') = COALESCE(a.service_expires_at, '1000-01-01')
          AND newer.id > a.id
        )
      )
  )
) latest;

UPDATE billing_order_sip_accounts a
JOIN tenant_sip_account_entitlements e
  ON e.tenant_id = a.tenant_id AND e.sip_user_id = a.sip_user_id
SET a.entitlement_id = e.id
WHERE a.entitlement_id IS NULL;

INSERT IGNORE INTO tenant_web_account_entitlements (
  tenant_id, web_user_id, first_order_id, current_order_id, status,
  service_starts_at, service_expires_at, assigned_at, assigned_by_admin_user_id
)
SELECT
  latest.tenant_id,
  latest.web_user_id,
  latest.first_order_id,
  latest.current_order_id,
  CASE
    WHEN latest.service_expires_at IS NOT NULL AND latest.service_expires_at < CURDATE() THEN 'expired'
    WHEN latest.account_status IN ('active', 'inactive', 'disabled', 'expired') THEN latest.account_status
    ELSE 'active'
  END,
  latest.service_starts_at,
  latest.service_expires_at,
  COALESCE(latest.assigned_at, CURRENT_TIMESTAMP),
  latest.assigned_by_admin_user_id
FROM (
  SELECT
    a.*,
    (SELECT MIN(a2.order_id)
     FROM billing_order_web_accounts a2
     WHERE a2.tenant_id = a.tenant_id AND a2.web_user_id = a.web_user_id) AS first_order_id,
    a.order_id AS current_order_id
  FROM billing_order_web_accounts a
  WHERE NOT EXISTS (
    SELECT 1
    FROM billing_order_web_accounts newer
    WHERE newer.tenant_id = a.tenant_id
      AND newer.web_user_id = a.web_user_id
      AND (
        COALESCE(newer.service_expires_at, '1000-01-01') > COALESCE(a.service_expires_at, '1000-01-01')
        OR (
          COALESCE(newer.service_expires_at, '1000-01-01') = COALESCE(a.service_expires_at, '1000-01-01')
          AND newer.id > a.id
        )
      )
  )
) latest;

UPDATE billing_order_web_accounts a
JOIN tenant_web_account_entitlements e
  ON e.tenant_id = a.tenant_id AND e.web_user_id = a.web_user_id
SET a.entitlement_id = e.id
WHERE a.entitlement_id IS NULL;
