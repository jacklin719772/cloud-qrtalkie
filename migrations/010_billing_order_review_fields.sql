ALTER TABLE billing_orders
  MODIFY COLUMN order_status ENUM(
    'draft',
    'pending_payment',
    'payment_submitted',
    'pending_review',
    'review_approved',
    'review_rejected',
    'cancelled'
  ) NOT NULL DEFAULT 'pending_payment',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL AFTER expires_at,
  ADD COLUMN IF NOT EXISTS reviewed_by_platform_admin_id BIGINT UNSIGNED NULL AFTER reviewed_at,
  ADD COLUMN IF NOT EXISTS review_note VARCHAR(500) NULL AFTER reviewed_by_platform_admin_id,
  ADD KEY IF NOT EXISTS idx_billing_orders_reviewed_by (reviewed_by_platform_admin_id);

SET @fk_billing_orders_reviewed_by_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'billing_orders'
    AND CONSTRAINT_NAME = 'fk_billing_orders_reviewed_by'
);

SET @fk_billing_orders_reviewed_by_sql = IF(
  @fk_billing_orders_reviewed_by_exists = 0,
  'ALTER TABLE billing_orders ADD CONSTRAINT fk_billing_orders_reviewed_by FOREIGN KEY (reviewed_by_platform_admin_id) REFERENCES platform_admin_users (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @fk_billing_orders_reviewed_by_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE billing_order_items
  ADD COLUMN IF NOT EXISTS account_quantity INT UNSIGNED NULL AFTER description;
