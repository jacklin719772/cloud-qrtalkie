SET @drop_assigned_fk := (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE billing_tenant_coupons DROP FOREIGN KEY fk_billing_tenant_coupons_assigned_by',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_tenant_coupons'
    AND CONSTRAINT_NAME = 'fk_billing_tenant_coupons_assigned_by'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
PREPARE stmt FROM @drop_assigned_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_revoked_fk := (
  SELECT IF(
    COUNT(*) > 0,
    'ALTER TABLE billing_tenant_coupons DROP FOREIGN KEY fk_billing_tenant_coupons_revoked_by',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_tenant_coupons'
    AND CONSTRAINT_NAME = 'fk_billing_tenant_coupons_revoked_by'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
PREPARE stmt FROM @drop_revoked_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_assigned_fk := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE billing_tenant_coupons ADD CONSTRAINT fk_billing_tenant_coupons_assigned_by FOREIGN KEY (assigned_by_platform_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_tenant_coupons'
    AND CONSTRAINT_NAME = 'fk_billing_tenant_coupons_assigned_by'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
PREPARE stmt FROM @add_assigned_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_revoked_fk := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE billing_tenant_coupons ADD CONSTRAINT fk_billing_tenant_coupons_revoked_by FOREIGN KEY (revoked_by_platform_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL',
    'SELECT 1'
  )
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_tenant_coupons'
    AND CONSTRAINT_NAME = 'fk_billing_tenant_coupons_revoked_by'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
PREPARE stmt FROM @add_revoked_fk;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
