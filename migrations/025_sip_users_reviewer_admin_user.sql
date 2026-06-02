SET @sip_users_review_fk_referenced_table = (
  SELECT REFERENCED_TABLE_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sip_users'
    AND COLUMN_NAME = 'reviewed_by_platform_admin_id'
    AND CONSTRAINT_NAME = 'fk_sip_users_platform_reviewer'
  LIMIT 1
);

SET @drop_sip_users_review_fk_sql = IF(
  @sip_users_review_fk_referenced_table IS NOT NULL
    AND @sip_users_review_fk_referenced_table != 'admin_users',
  'ALTER TABLE sip_users DROP FOREIGN KEY fk_sip_users_platform_reviewer',
  'SELECT 1'
);

PREPARE stmt FROM @drop_sip_users_review_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE sip_users u
JOIN admin_users reviewer ON reviewer.legacy_platform_admin_user_id = u.reviewed_by_platform_admin_id
SET u.reviewed_by_platform_admin_id = reviewer.id
WHERE u.reviewed_by_platform_admin_id IS NOT NULL;

UPDATE sip_users u
LEFT JOIN admin_users reviewer ON reviewer.id = u.reviewed_by_platform_admin_id
SET u.reviewed_by_platform_admin_id = NULL
WHERE u.reviewed_by_platform_admin_id IS NOT NULL
  AND reviewer.id IS NULL;

SET @add_sip_users_review_fk_sql = IF(
  @sip_users_review_fk_referenced_table != 'admin_users' OR @sip_users_review_fk_referenced_table IS NULL,
  'ALTER TABLE sip_users ADD CONSTRAINT fk_sip_users_platform_reviewer FOREIGN KEY (reviewed_by_platform_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @add_sip_users_review_fk_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
