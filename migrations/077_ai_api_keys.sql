-- Migration: 077_ai_api_keys
-- AI 助手 v2（只增不改）：个人 API Key（供 OpenAI 兼容端点 /v1/* 使用，本地AI 以 provider 方式接入）

CREATE TABLE IF NOT EXISTS ai_api_keys (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sip_user_id   BIGINT UNSIGNED NOT NULL,
    key_hash      VARCHAR(64) NOT NULL,
    name          VARCHAR(100) NOT NULL DEFAULT '',
    enabled       TINYINT(1) NOT NULL DEFAULT 1,
    last_used_at  TIMESTAMP NULL DEFAULT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    TIMESTAMP NULL DEFAULT NULL,

    UNIQUE KEY uq_ai_api_key_hash (key_hash),
    INDEX idx_ai_api_key_user (sip_user_id),
    CONSTRAINT fk_ai_api_key_sip_user
        FOREIGN KEY (sip_user_id) REFERENCES sip_users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
