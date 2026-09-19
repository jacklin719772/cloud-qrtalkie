-- Migration: 082_ca_attachment_duration
-- 附件补充字段：语音讯息时长（P2 服务端第二批）
-- 幂等：ADD COLUMN IF NOT EXISTS

ALTER TABLE ca_attachments
  ADD COLUMN IF NOT EXISTS duration_ms INT UNSIGNED NULL AFTER file_size;
