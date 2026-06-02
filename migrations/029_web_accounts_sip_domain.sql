ALTER TABLE web_users
  ADD COLUMN IF NOT EXISTS sip_domain VARCHAR(255) NOT NULL DEFAULT 'sip.qrtalkie.org' AFTER username,
  ADD KEY IF NOT EXISTS idx_web_users_sip_domain (sip_domain);

SET @web_users_username_unique_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'web_users'
    AND INDEX_NAME = 'uq_web_users_username'
);

SET @drop_web_users_username_unique_sql = IF(
  @web_users_username_unique_exists > 0,
  'ALTER TABLE web_users DROP INDEX uq_web_users_username',
  'SELECT 1'
);

PREPARE stmt FROM @drop_web_users_username_unique_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE web_users
  ADD UNIQUE KEY IF NOT EXISTS uq_web_users_uri (username, sip_domain);

ALTER TABLE billing_order_web_accounts
  ADD COLUMN IF NOT EXISTS sip_domain VARCHAR(255) NOT NULL DEFAULT 'sip.qrtalkie.org' AFTER username,
  ADD KEY IF NOT EXISTS idx_billing_order_web_accounts_sip_domain (sip_domain);
