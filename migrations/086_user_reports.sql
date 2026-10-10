-- Migration: 086_user_reports
-- UGC 舉報：App 內「檢舉」提交的用戶舉報記錄（平台可查可處置）
--   來源：Android/iOS App「聯絡人/會話 → 檢舉」對話框
--   被舉報人口徑：sip:user@domain 規範形式（與 App 端屏蔽名單同口徑）
--
-- 幂等：CREATE TABLE IF NOT EXISTS，可安全重跑

CREATE TABLE IF NOT EXISTS user_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_user_id BIGINT UNSIGNED NULL COMMENT '舉報人 sip_users.id（可能為第三方 SIP 帳號，允許空）',
  reporter_username VARCHAR(64) NOT NULL COMMENT '舉報人帳號名',
  reporter_tenant_id BIGINT UNSIGNED NULL COMMENT '舉報人所屬租戶（平台按租戶查看）',
  target_address VARCHAR(255) NOT NULL COMMENT '被舉報地址（sip:user@domain 規範形式）',
  reason VARCHAR(32) NOT NULL COMMENT 'harassment / spam / other',
  detail VARCHAR(1000) NULL COMMENT '補充說明',
  blocked TINYINT(1) NOT NULL DEFAULT 0 COMMENT '提交時是否同時屏蔽',
  app_version VARCHAR(64) NULL COMMENT 'App 版本（審計用）',
  status VARCHAR(16) NOT NULL DEFAULT 'new' COMMENT 'new / reviewing / handled / rejected',
  handled_by BIGINT UNSIGNED NULL COMMENT '處理人 admin_users.id',
  handled_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status_created (status, created_at),
  KEY idx_target (target_address),
  KEY idx_tenant (reporter_tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
