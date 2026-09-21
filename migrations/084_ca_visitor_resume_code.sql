-- Migration: 084_ca_visitor_resume_code
-- 访客「聊天码」（P2 身份续聊）：首次咨询生成、屏幕展示 + 可选邮件送达；
-- 下次任意浏览器/设备输入该码即可回到原会话。
--
-- 设计（用户 2026-09-21 确认）：
--   · 只存哈希（CHAR(64) sha256），明文仅在生成时返回一次
--   · 180 天滑动有效期（每次成功使用顺延）；可「更换」（旧码立即失效）
--   · 作用域 = 访客记录（即每张 ecard 一个码），与"一访客一会话"模型一致
--   · 无 Cookie 且无码 → 当作一次全新咨询（旧会话与归档不受影响）
--
-- 幂等：ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS，可安全重跑

ALTER TABLE ca_visitors
  ADD COLUMN IF NOT EXISTS resume_code_hash CHAR(64) NULL AFTER subject,
  ADD COLUMN IF NOT EXISTS resume_code_created_at DATETIME NULL AFTER resume_code_hash,
  ADD COLUMN IF NOT EXISTS resume_code_expires_at DATETIME NULL AFTER resume_code_created_at;

CREATE INDEX IF NOT EXISTS idx_ca_visitors_resume_code ON ca_visitors (ecard_id, resume_code_hash);
