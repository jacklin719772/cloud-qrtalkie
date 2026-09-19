-- Migration: 081_ca_visitor_contact_info
-- 访客登记信息（R1，2026-09-20）：姓名 / 电子邮件 / 电话 / 主题
--
-- 说明：会话名（R3）= ca_visitors.display_name，登记时由 contact_name 同步写入。
-- 兼容：旧访客（P1 测试数据）这些列为 NULL，展示回退为"访客"。
-- 幂等：ADD COLUMN IF NOT EXISTS（MariaDB 支持），可安全重跑。

ALTER TABLE ca_visitors
  ADD COLUMN IF NOT EXISTS contact_name  VARCHAR(120) NULL AFTER display_name,
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(128) NULL AFTER contact_name,
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(64)  NULL AFTER contact_email,
  ADD COLUMN IF NOT EXISTS subject       VARCHAR(200) NULL AFTER contact_phone;
