INSERT INTO admin_users (
  tenant_id,
  account_type,
  email,
  password_hash,
  display_name,
  role,
  platform_role,
  permissions_json,
  status,
  email_verified_at
)
VALUES (
  NULL,
  'platform',
  'imflybird719772@gmail.com',
  'scrypt:0dd1b37e6067cee55b63d6f286e1c8c6:e9d7c4f40cb03e34b2d56aa79d6b9132a7bf20b1124ce8828dda20df671608be5090a91acaf9ae64e365f87d13b9ff41e5e03f68effbde789037655fc73f4212',
  'Platform Super Admin',
  'admin',
  'super_admin',
  JSON_OBJECT('platformAdmins', JSON_OBJECT('manage', true), 'billing', JSON_OBJECT('manage', true), 'tenants', JSON_OBJECT('manage', true)),
  'active',
  CURRENT_TIMESTAMP
)
ON DUPLICATE KEY UPDATE
  tenant_id = NULL,
  account_type = 'platform',
  password_hash = VALUES(password_hash),
  display_name = COALESCE(NULLIF(display_name, ''), VALUES(display_name)),
  role = 'admin',
  platform_role = 'super_admin',
  permissions_json = VALUES(permissions_json),
  status = 'active',
  email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP);
