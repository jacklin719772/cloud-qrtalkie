-- 租户账单地址簿（2026-10-16 方案）：购买套餐页「保存」按钮，下次购买自动带出，多条可下拉选择
-- 与 orders.billing_address 的每单快照、tenants.billing_address 的档案字段并存：地址簿仅服务购买页默认值
CREATE TABLE IF NOT EXISTS tenant_billing_addresses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  address VARCHAR(500) NOT NULL,
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_billing_address (tenant_id, address),
  KEY idx_tenant_billing_addresses_tenant (tenant_id, created_at),
  CONSTRAINT fk_tenant_billing_addresses_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_tenant_billing_addresses_created_by
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
