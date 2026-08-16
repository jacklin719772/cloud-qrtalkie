-- Migration: 071_ai_session_device
-- AI 助手 token 按设备隔离（桌面版与安卓同账号并存，互不踢下线）

ALTER TABLE admin_sessions ADD COLUMN device VARCHAR(32) NULL;
