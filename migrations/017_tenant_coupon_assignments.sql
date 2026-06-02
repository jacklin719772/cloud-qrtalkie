CREATE TABLE IF NOT EXISTS billing_tenant_coupons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  coupon_id BIGINT UNSIGNED NOT NULL,
  status ENUM('assigned', 'used', 'revoked', 'expired') NOT NULL DEFAULT 'assigned',
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by_platform_admin_id BIGINT UNSIGNED NULL,
  used_at TIMESTAMP NULL,
  used_order_id BIGINT UNSIGNED NULL,
  revoked_at TIMESTAMP NULL,
  revoked_by_platform_admin_id BIGINT UNSIGNED NULL,
  revoke_reason VARCHAR(255) NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_billing_tenant_coupons_tenant_status (tenant_id, status, assigned_at),
  KEY idx_billing_tenant_coupons_tenant_coupon_status (tenant_id, coupon_id, status),
  KEY idx_billing_tenant_coupons_coupon_status (coupon_id, status),
  KEY idx_billing_tenant_coupons_used_order (used_order_id),
  KEY idx_billing_tenant_coupons_assigned_by (assigned_by_platform_admin_id),
  KEY idx_billing_tenant_coupons_revoked_by (revoked_by_platform_admin_id),
  CONSTRAINT fk_billing_tenant_coupons_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_tenant_coupons_coupon
    FOREIGN KEY (coupon_id) REFERENCES billing_coupons (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_tenant_coupons_used_order
    FOREIGN KEY (used_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_tenant_coupons_assigned_by
    FOREIGN KEY (assigned_by_platform_admin_id) REFERENCES admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_tenant_coupons_revoked_by
    FOREIGN KEY (revoked_by_platform_admin_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
