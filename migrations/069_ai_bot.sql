-- Migration: 069_ai_bot
-- QRTalkie AI Chat Bot Phase 1

-- ① AI 账号权限表（必须先建，ai_bot_sessions 依赖其概念存在）
CREATE TABLE IF NOT EXISTS ai_bot_account_entitlements (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sip_user_id         BIGINT UNSIGNED NOT NULL,
    enabled             TINYINT(1) NOT NULL DEFAULT 0,
    daily_limit         INT UNSIGNED NOT NULL DEFAULT 50,
    monthly_limit       INT UNSIGNED NULL DEFAULT NULL,
    used_today          INT UNSIGNED NOT NULL DEFAULT 0,
    used_this_month     INT UNSIGNED NOT NULL DEFAULT 0,
    last_usage_reset_date DATE NULL,
    last_monthly_reset  VARCHAR(7) NULL,
    granted_by_admin_id BIGINT UNSIGNED NULL,
    granted_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          TIMESTAMP NULL DEFAULT NULL,
    notes               VARCHAR(255) NULL DEFAULT '',
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_ai_entitlement_sip_user (sip_user_id),
    INDEX idx_ai_entitlement_enabled (enabled),
    INDEX idx_ai_entitlement_expires (expires_at),
    CONSTRAINT fk_ai_entitlement_sip_user
        FOREIGN KEY (sip_user_id) REFERENCES sip_users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ② AI 会话表
CREATE TABLE IF NOT EXISTS ai_bot_sessions (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    owner_sip_user_id   BIGINT UNSIGNED NOT NULL,
    title               VARCHAR(255) DEFAULT 'AI 助手',
    status              VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_ai_session_owner_status (owner_sip_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ③ AI 消息表
CREATE TABLE IF NOT EXISTS ai_bot_messages (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id          BIGINT UNSIGNED NOT NULL,
    role                VARCHAR(16) NOT NULL,
    content             TEXT NOT NULL,
    message_type        VARCHAR(32) DEFAULT 'text',
    token_count         INT UNSIGNED DEFAULT 0,
    status              VARCHAR(16) DEFAULT 'completed',
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ai_msg_session (session_id),
    CONSTRAINT fk_ai_msg_session
        FOREIGN KEY (session_id) REFERENCES ai_bot_sessions(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
