ALTER TABLE billing_orders
  ADD COLUMN IF NOT EXISTS review_note VARCHAR(500) NULL AFTER reviewed_by_platform_admin_id;

SET @billing_orders_review_fk_referenced_table = (
  SELECT REFERENCED_TABLE_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_orders'
    AND COLUMN_NAME = 'reviewed_by_platform_admin_id'
    AND CONSTRAINT_NAME = 'fk_billing_orders_reviewed_by'
  LIMIT 1
);

SET @drop_billing_orders_review_fk_sql = IF(
  @billing_orders_review_fk_referenced_table IS NOT NULL
    AND @billing_orders_review_fk_referenced_table != 'admin_users',
  'ALTER TABLE billing_orders DROP FOREIGN KEY fk_billing_orders_reviewed_by',
  'SELECT 1'
);

PREPARE stmt FROM @drop_billing_orders_review_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE billing_orders o
JOIN admin_users reviewer ON reviewer.legacy_platform_admin_user_id = o.reviewed_by_platform_admin_id
SET o.reviewed_by_platform_admin_id = reviewer.id
WHERE o.reviewed_by_platform_admin_id IS NOT NULL;

UPDATE billing_orders o
LEFT JOIN admin_users reviewer ON reviewer.id = o.reviewed_by_platform_admin_id
SET o.reviewed_by_platform_admin_id = NULL
WHERE o.reviewed_by_platform_admin_id IS NOT NULL
  AND reviewer.id IS NULL;

SET @add_billing_orders_review_fk_sql = IF(
  @billing_orders_review_fk_referenced_table != 'admin_users' OR @billing_orders_review_fk_referenced_table IS NULL,
  'ALTER TABLE billing_orders ADD CONSTRAINT fk_billing_orders_reviewed_by FOREIGN KEY (reviewed_by_platform_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @add_billing_orders_review_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
