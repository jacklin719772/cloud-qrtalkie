ALTER TABLE admin_users
  MODIFY tenant_id BIGINT UNSIGNED NULL,
  MODIFY status ENUM('active', 'disabled', 'locked') NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS account_type ENUM('tenant', 'platform') NOT NULL DEFAULT 'tenant' AFTER tenant_id,
  ADD COLUMN IF NOT EXISTS platform_role ENUM('super_admin', 'admin', 'operator', 'finance', 'support', 'auditor') NULL AFTER role,
  ADD COLUMN IF NOT EXISTS permissions_json JSON NULL AFTER platform_role,
  ADD COLUMN IF NOT EXISTS legacy_platform_admin_user_id BIGINT UNSIGNED NULL AFTER last_login_at,
  ADD KEY IF NOT EXISTS idx_admin_users_account_type (account_type),
  ADD KEY IF NOT EXISTS idx_admin_users_platform_role (platform_role),
  ADD KEY IF NOT EXISTS idx_admin_users_status (status),
  ADD UNIQUE KEY IF NOT EXISTS uq_admin_users_legacy_platform (legacy_platform_admin_user_id);

UPDATE admin_users
SET account_type = 'tenant'
WHERE account_type IS NULL OR account_type = '';

INSERT INTO admin_users (
  tenant_id,
  account_type,
  email,
  password_hash,
  display_name,
  phone_number,
  role,
  platform_role,
  permissions_json,
  status,
  email_verified_at,
  failed_login_count,
  locked_until,
  last_login_at,
  legacy_platform_admin_user_id
)
SELECT
  NULL,
  'platform',
  p.email,
  p.password_hash,
  COALESCE(NULLIF(p.display_name, ''), p.email),
  p.phone_number,
  CASE WHEN p.role = 'admin' OR p.role = 'super_admin' THEN 'admin' ELSE 'viewer' END,
  p.role,
  NULL,
  p.status,
  p.email_verified_at,
  p.failed_login_count,
  p.locked_until,
  p.last_login_at,
  p.id
FROM platform_admin_users p
WHERE NOT EXISTS (
  SELECT 1
  FROM admin_users a
  WHERE a.email = p.email
     OR a.legacy_platform_admin_user_id = p.id
);
