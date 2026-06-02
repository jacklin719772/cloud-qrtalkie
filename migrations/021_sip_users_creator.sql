ALTER TABLE sip_users
  ADD COLUMN IF NOT EXISTS created_by_admin_user_id BIGINT UNSIGNED NULL AFTER notes;

SET @fk_sip_users_creator_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sip_users'
    AND CONSTRAINT_NAME = 'fk_sip_users_creator'
);

SET @fk_sip_users_creator_sql = IF(
  @fk_sip_users_creator_exists = 0,
  'ALTER TABLE sip_users ADD CONSTRAINT fk_sip_users_creator FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @fk_sip_users_creator_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;