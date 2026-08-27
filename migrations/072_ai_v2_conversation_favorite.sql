-- Migration: 072_ai_v2_conversation_favorite
-- AI 助手 v2（只增不改）：会话收藏

ALTER TABLE ai_bot_sessions ADD COLUMN IF NOT EXISTS is_favorite TINYINT(1) NOT NULL DEFAULT 0;
