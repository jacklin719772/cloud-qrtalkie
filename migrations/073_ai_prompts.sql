-- Migration: 073_ai_prompts
-- AI 助手 v2（只增不改）：提示词库（按用户隔离，多端同步）

CREATE TABLE IF NOT EXISTS ai_prompts (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sip_user_id   BIGINT UNSIGNED NOT NULL,
    title         VARCHAR(100) NOT NULL,
    content       TEXT NOT NULL,
    category      VARCHAR(50) NOT NULL DEFAULT '',
    shortcut      VARCHAR(50) NOT NULL DEFAULT '',
    usage_count   INT UNSIGNED NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_ai_prompts_user (sip_user_id),
    CONSTRAINT fk_ai_prompts_sip_user
        FOREIGN KEY (sip_user_id) REFERENCES sip_users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
