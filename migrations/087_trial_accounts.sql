-- 试用账号模块（2026-10-14 方案：试用账号模块设计方案-实施参考.md）
-- 1) tenants.is_system 标记 + 幂等创建「產品試用」保留租户
-- 2) trial_assignments：试用业务记录
-- 3) billing_order_retained_accounts：保留清单（泛化续费保留表，所有订单类型可用）
-- 4) billing_orders.order_type 扩展 'trial'（试用批次静默订单）

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS is_system TINYINT(1) NOT NULL DEFAULT 0 AFTER status;

-- 保留租户：is_system=1，独立 sip_domain 满足唯一键；重复执行安全
INSERT INTO tenants (name, sip_domain, status, is_system)
SELECT '產品試用', 'trial.qrtalkie.org', 'active', 1 FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM tenants WHERE is_system = 1 OR sip_domain = 'trial.qrtalkie.org'
);

CREATE TABLE IF NOT EXISTS trial_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sip_user_id BIGINT UNSIGNED NOT NULL,
  owner_tenant_id BIGINT UNSIGNED NOT NULL,
  contact_name VARCHAR(120) NULL,
  contact_email VARCHAR(255) NULL,
  contact_phone VARCHAR(40) NULL,
  company VARCHAR(160) NULL,
  started_at DATE NOT NULL,
  expires_at DATE NOT NULL,
  status ENUM('active', 'converted', 'reclaimed') NOT NULL DEFAULT 'active',
  ai_enabled TINYINT(1) NOT NULL DEFAULT 0,
  batch_order_id BIGINT UNSIGNED NULL,
  converted_order_id BIGINT UNSIGNED NULL,
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trial_assignments_sip_user (sip_user_id),
  KEY idx_trial_assignments_owner (owner_tenant_id, status, expires_at),
  KEY idx_trial_assignments_status_expires (status, expires_at),
  KEY idx_trial_assignments_batch_order (batch_order_id),
  KEY idx_trial_assignments_converted_order (converted_order_id),
  KEY idx_trial_assignments_created_by (created_by_admin_user_id),
  CONSTRAINT fk_trial_assignments_sip_user
    FOREIGN KEY (sip_user_id) REFERENCES sip_users (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_trial_assignments_owner_tenant
    FOREIGN KEY (owner_tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_trial_assignments_batch_order
    FOREIGN KEY (batch_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_trial_assignments_converted_order
    FOREIGN KEY (converted_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_trial_assignments_created_by
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_order_retained_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  sip_user_id BIGINT UNSIGNED NOT NULL,
  source ENUM('own', 'trial', 'stock') NOT NULL,
  origin_tenant_id BIGINT UNSIGNED NULL,
  trial_assignment_id BIGINT UNSIGNED NULL,
  trial_status_snapshot VARCHAR(20) NULL,
  username VARCHAR(120) NULL,
  display_name VARCHAR(120) NULL,
  status ENUM('pending', 'assigned', 'dropped') NOT NULL DEFAULT 'pending',
  drop_reason VARCHAR(255) NULL,
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_order_retained_order_user (order_id, sip_user_id),
  KEY idx_billing_order_retained_order (order_id, status),
  KEY idx_billing_order_retained_sip_user (sip_user_id),
  KEY idx_billing_order_retained_trial (trial_assignment_id),
  KEY idx_billing_order_retained_origin_tenant (origin_tenant_id),
  KEY idx_billing_order_retained_created_by (created_by_admin_user_id),
  CONSTRAINT fk_billing_order_retained_order
    FOREIGN KEY (order_id) REFERENCES billing_orders (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_retained_sip_user
    FOREIGN KEY (sip_user_id) REFERENCES sip_users (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_billing_order_retained_origin_tenant
    FOREIGN KEY (origin_tenant_id) REFERENCES tenants (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_order_retained_trial
    FOREIGN KEY (trial_assignment_id) REFERENCES trial_assignments (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_order_retained_created_by
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 试用批次订单：order_type='trial'（原有查询按 new_purchase/renewal 过滤，天然不含试用批次）
ALTER TABLE billing_orders
  MODIFY COLUMN order_type ENUM('new_purchase', 'renewal', 'trial') NOT NULL DEFAULT 'new_purchase';
