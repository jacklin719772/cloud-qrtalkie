ALTER TABLE tenants
  DROP INDEX IF EXISTS uq_tenants_sip_domain;

INSERT INTO tenants (
  tenant_number,
  name,
  sip_domain,
  contact_email,
  enterprise_email,
  plan_code,
  status,
  user_limit
)
SELECT
  CONCAT('TENANT-', LPAD(100000 + a.id, 6, '0')),
  a.display_name,
  t.sip_domain,
  a.email,
  a.email,
  t.plan_code,
  t.status,
  t.user_limit
FROM admin_users a
JOIN tenants t ON t.id = a.tenant_id
WHERE a.display_name IS NOT NULL
  AND a.display_name <> ''
  AND a.display_name <> t.name
  AND NOT EXISTS (
    SELECT 1
    FROM tenants existing
    WHERE existing.tenant_number = CONCAT('TENANT-', LPAD(100000 + a.id, 6, '0'))
  );

UPDATE admin_users a
JOIN tenants nt
  ON nt.tenant_number = CONCAT('TENANT-', LPAD(100000 + a.id, 6, '0'))
SET a.tenant_id = nt.id
WHERE a.display_name IS NOT NULL
  AND a.display_name <> ''
  AND a.display_name = nt.name;
