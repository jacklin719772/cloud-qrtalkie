-- 允許 sip_users 表中的 tenant_id 為空，以便支援「未分配租戶」的帳號
ALTER TABLE sip_users
  MODIFY COLUMN tenant_id BIGINT UNSIGNED NULL;