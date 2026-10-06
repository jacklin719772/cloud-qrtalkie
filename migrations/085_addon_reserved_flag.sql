-- Migration: 085_addon_reserved_flag
-- 增值服務「保留」標記：平台自帶服務只可修改、不可刪除
--   · 保留集合（2026-10-06 確認）：ecard / callcenter / doorcontrol / aiassistant
--   · DELETE 接口據此攔截；頁面顯示為禁用刪除、服務編號鎖定
--
-- 幂等：ADD COLUMN IF NOT EXISTS，可安全重跑

ALTER TABLE billing_addons
  ADD COLUMN IF NOT EXISTS is_reserved TINYINT(1) NOT NULL DEFAULT 0 AFTER description;

UPDATE billing_addons
  SET is_reserved = 1
  WHERE addon_code IN ('ecard', 'callcenter', 'doorcontrol', 'aiassistant');
