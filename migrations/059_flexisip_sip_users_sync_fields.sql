-- Migration: 059_flexisip_sip_users_sync_fields
-- 为 sip_users 表新增 Flexisip Account Manager 同步字段

ALTER TABLE sip_users
  ADD COLUMN flexisip_account_id VARCHAR(64) NULL AFTER created_by_admin_user_id,
  ADD COLUMN sip_uri VARCHAR(255) NULL AFTER flexisip_account_id,
  ADD COLUMN sync_status VARCHAR(32) NOT NULL DEFAULT 'local_only' AFTER sip_uri,
  ADD COLUMN sync_error TEXT NULL AFTER sync_status,
  ADD COLUMN sync_attempts INT NOT NULL DEFAULT 0 AFTER sync_error,
  ADD COLUMN last_synced_at DATETIME NULL AFTER sync_attempts,
  ADD COLUMN created_in_flexisip_at DATETIME NULL AFTER last_synced_at,
  ADD COLUMN deleted_in_flexisip_at DATETIME NULL AFTER created_in_flexisip_at;

-- 索引：加速按 Flexisip ID 和 SIP URI 查找
CREATE INDEX idx_sip_users_flexisip_account_id ON sip_users(flexisip_account_id);
CREATE INDEX idx_sip_users_sip_uri ON sip_users(sip_uri);
CREATE INDEX idx_sip_users_sync_status ON sip_users(sync_status);

-- 将历史已有账号的 sync_status 设为 'local_only'
UPDATE sip_users SET sync_status = 'local_only' WHERE sync_status IS NULL OR sync_status = '';
