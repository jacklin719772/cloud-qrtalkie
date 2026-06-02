ALTER TABLE tenant_web_account_entitlements
  ADD COLUMN IF NOT EXISTS sip_user_id BIGINT UNSIGNED NULL AFTER web_user_id,
  ADD KEY IF NOT EXISTS idx_tenant_web_entitlements_sip_user (sip_user_id);

SET @fk_tenant_web_entitlements_sip_user_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tenant_web_account_entitlements'
    AND CONSTRAINT_NAME = 'fk_tenant_web_entitlements_sip_user'
);

SET @fk_tenant_web_entitlements_sip_user_sql = IF(
  @fk_tenant_web_entitlements_sip_user_exists = 0,
  'ALTER TABLE tenant_web_account_entitlements ADD CONSTRAINT fk_tenant_web_entitlements_sip_user FOREIGN KEY (sip_user_id) REFERENCES sip_users (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @fk_tenant_web_entitlements_sip_user_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE billing_order_web_accounts
  ADD COLUMN IF NOT EXISTS sip_user_id BIGINT UNSIGNED NULL AFTER web_user_id,
  ADD KEY IF NOT EXISTS idx_billing_order_web_accounts_sip_user (sip_user_id),
  ADD UNIQUE KEY IF NOT EXISTS uq_billing_order_web_accounts_order_sip (order_id, sip_user_id);

SET @fk_billing_order_web_accounts_sip_user_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_order_web_accounts'
    AND CONSTRAINT_NAME = 'fk_billing_order_web_accounts_sip_user'
);

SET @fk_billing_order_web_accounts_sip_user_sql = IF(
  @fk_billing_order_web_accounts_sip_user_exists = 0,
  'ALTER TABLE billing_order_web_accounts ADD CONSTRAINT fk_billing_order_web_accounts_sip_user FOREIGN KEY (sip_user_id) REFERENCES sip_users (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @fk_billing_order_web_accounts_sip_user_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
