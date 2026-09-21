-- Migration: 083_ca_archives
-- Customer Assistant 内容归档（P2 归档能力）
--
-- 约定（用户 2026-09-21 确认）：
--   · 归档 = 会话全部消息 + 双方附件打成 ZIP，同一会话重复归档 = 覆盖换链
--   · 分享链接永久有效，重新归档生成新 token（旧链接失效）；可「撤销归档」立即失效
--   · 归档动作同时把会话标记为 archived（出现在列表「已归档」）
--   · 删除会话/清空内容**不影响**归档包（归档即快照）——故本表不建外键
--
-- 幂等：IF NOT EXISTS，可安全重跑

CREATE TABLE IF NOT EXISTS ca_archives (
    id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ecard_id               BIGINT UNSIGNED NOT NULL,
    conversation_id        BIGINT UNSIGNED NULL,               -- 仅记录用，不建 FK（会话删除后归档保留）
    conversation_public_id VARCHAR(48)     NOT NULL,           -- conv_…
    sip_user_id            INT             NULL,               -- 归属客服（列表按此过滤）
    visitor_public_id      VARCHAR(48)     NULL,
    visitor_name           VARCHAR(128)    NULL,
    share_token            CHAR(43)        NOT NULL,           -- base64url(32B)，不可猜
    file_size              BIGINT UNSIGNED NOT NULL DEFAULT 0, -- ZIP 字节数
    message_count          INT UNSIGNED    NOT NULL DEFAULT 0,
    attachment_count       INT UNSIGNED    NOT NULL DEFAULT 0,
    started_at             DATETIME        NULL,               -- 首条消息时间
    ended_at               DATETIME        NULL,               -- 末条消息时间
    archived_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at             TIMESTAMP       NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ca_archives_conversation (conversation_public_id),
    UNIQUE KEY uq_ca_archives_token (share_token),
    KEY idx_ca_archives_owner (sip_user_id, archived_at),
    KEY idx_ca_archives_ecard (ecard_id, archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Customer Assistant 会话内容归档';
