-- Migration: 076_ai_share_links
-- AI 助手 v2（只增不改）：会话分享链接（带过期时间）

CREATE TABLE IF NOT EXISTS ai_share_links (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id    BIGINT UNSIGNED NOT NULL,
    share_token   VARCHAR(64) NOT NULL,
    expires_at    TIMESTAMP NULL DEFAULT NULL,
    created_by    BIGINT UNSIGNED NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_ai_share_token (share_token),
    INDEX idx_ai_share_session (session_id),
    CONSTRAINT fk_ai_share_session
        FOREIGN KEY (session_id) REFERENCES ai_bot_sessions(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
