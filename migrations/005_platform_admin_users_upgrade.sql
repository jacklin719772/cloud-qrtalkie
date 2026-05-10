UPDATE platform_admin_users
SET display_name = email
WHERE display_name IS NULL OR display_name = '';

ALTER TABLE platform_admin_users
  MODIFY display_name VARCHAR(120) NOT NULL,
  MODIFY role ENUM('super_admin', 'admin', 'operator', 'finance', 'support', 'auditor') NOT NULL DEFAULT 'operator',
  MODIFY status ENUM('active', 'disabled', 'locked') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_by_platform_admin_id BIGINT UNSIGNED NULL AFTER last_login_at,
  ADD COLUMN IF NOT EXISTS updated_by_platform_admin_id BIGINT UNSIGNED NULL AFTER created_by_platform_admin_id,
  ADD KEY IF NOT EXISTS idx_platform_admin_users_role (role),
  ADD KEY IF NOT EXISTS idx_platform_admin_users_status (status),
  ADD KEY IF NOT EXISTS idx_platform_admin_users_created_by (created_by_platform_admin_id),
  ADD KEY IF NOT EXISTS idx_platform_admin_users_updated_by (updated_by_platform_admin_id);

SET @constraint_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'platform_admin_users'
    AND CONSTRAINT_NAME = 'fk_platform_admin_users_created_by'
);
SET @sql := IF(
  @constraint_exists = 0,
  'ALTER TABLE platform_admin_users ADD CONSTRAINT fk_platform_admin_users_created_by FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @constraint_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'platform_admin_users'
    AND CONSTRAINT_NAME = 'fk_platform_admin_users_updated_by'
);
SET @sql := IF(
  @constraint_exists = 0,
  'ALTER TABLE platform_admin_users ADD CONSTRAINT fk_platform_admin_users_updated_by FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
