CREATE TABLE IF NOT EXISTS billing_order_renewal_retained_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  source_order_id BIGINT UNSIGNED NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  sip_user_id BIGINT UNSIGNED NOT NULL,
  entitlement_id BIGINT UNSIGNED NULL,
  username VARCHAR(80) NULL,
  sip_domain VARCHAR(255) NULL,
  display_name VARCHAR(120) NULL,
  source_service_expires_at DATE NULL,
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_order_renewal_retained_order_user (order_id, sip_user_id),
  UNIQUE KEY uq_billing_order_renewal_retained_order_entitlement (order_id, entitlement_id),
  KEY idx_billing_order_renewal_retained_order (order_id, created_at),
  KEY idx_billing_order_renewal_retained_source_order (source_order_id),
  KEY idx_billing_order_renewal_retained_tenant (tenant_id, created_at),
  KEY idx_billing_order_renewal_retained_sip_user (sip_user_id),
  KEY idx_billing_order_renewal_retained_entitlement (entitlement_id),
  KEY idx_billing_order_renewal_retained_created_by (created_by_admin_user_id),
  CONSTRAINT fk_billing_order_renewal_retained_order
    FOREIGN KEY (order_id) REFERENCES billing_orders (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_renewal_retained_source_order
    FOREIGN KEY (source_order_id) REFERENCES billing_orders (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_order_renewal_retained_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_order_renewal_retained_sip_user
    FOREIGN KEY (sip_user_id) REFERENCES sip_users (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_billing_order_renewal_retained_entitlement
    FOREIGN KEY (entitlement_id) REFERENCES tenant_sip_account_entitlements (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_order_renewal_retained_created_by
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
