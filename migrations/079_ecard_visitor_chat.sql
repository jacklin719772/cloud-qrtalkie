-- Migration: 079_ecard_visitor_chat
-- ECard 访客聊天（Customer Assistant / Visitor Chat）P1 —— 7 张 ca_* 表
--
-- Schema 唯一来源：docs/customer-assistant/10_ECARD_VISITOR_CHAT_SOLUTION.md §6
--   （05_DATABASE_DESIGN.md 是通用版参考，其中 ca_agent_configs / ca_webchats
--     不在本次 P1 范围，切勿据此建表）
--
-- 删除策略（评审意见 ①，按"配置/身份/历史"分级）：
--   · 配置（ca_ecard_settings）        → ecard 删除时 CASCADE
--   · 身份/历史（ca_visitors / ca_conversations）→ ecard 用 RESTRICT
--     （ecard 现网只做软删：UPDATE tenant_ecards SET status，见 server/index.js:11974）
--   · 历史（ca_conversations.sip_user_id）→ 账号删除 SET NULL（列可空，历史保留）
--   · CA 内部 visitor→conversation→message→attachment → CASCADE（显式擦除路径）
--
-- 幂等：全部 CREATE TABLE IF NOT EXISTS，可安全重跑
-- 不修改任何既有表

-- ① ecard 聊天设置（配置类；不冗余 sip_user_id，owner 经 tenant_ecards 取得）
CREATE TABLE IF NOT EXISTS ca_ecard_settings (
    ecard_id          BIGINT UNSIGNED NOT NULL,
    enabled           TINYINT(1)      NOT NULL DEFAULT 0,
    welcome_message   VARCHAR(500)    NULL,                -- 首会话系统欢迎语
    offline_message   VARCHAR(500)    NULL,                -- 不可用时的自动回复
    notify_enabled    TINYINT(1)      NOT NULL DEFAULT 1,  -- 访客消息是否推送
    display_name      VARCHAR(120)    NULL,                -- 聊天面板显示名（优先于用户 display_name）
    online_status     VARCHAR(32)     NOT NULL DEFAULT 'auto', -- auto | available | away（CA 可用状态，非 SIP presence）
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ecard_id),
    CONSTRAINT fk_ca_set_ecard FOREIGN KEY (ecard_id) REFERENCES tenant_ecards (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ecard 访客聊天设置（配置类）';

-- ② 访客（身份类，按 ecard 隔离）
CREATE TABLE IF NOT EXISTS ca_visitors (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ecard_id          BIGINT UNSIGNED NOT NULL,
    public_id         VARCHAR(48)     NOT NULL,            -- vis_ + 32hex
    display_name      VARCHAR(120)    NULL,                -- 默认 "访客 #xxxx"
    first_ip          VARCHAR(64)     NULL,
    last_ip           VARCHAR(64)     NULL,
    last_country      VARCHAR(80)     NULL,
    last_user_agent   VARCHAR(1000)   NULL,
    meta              JSON            NULL,                -- 语言/时区/来源页（不做设备指纹）
    blocked           TINYINT(1)      NOT NULL DEFAULT 0,
    blocked_at        DATETIME        NULL,
    first_seen_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ca_visitors_public (ecard_id, public_id),
    KEY idx_ca_visitors_ecard_seen (ecard_id, last_seen_at),
    KEY idx_ca_visitors_blocked (ecard_id, blocked),
    CONSTRAINT fk_ca_vis_ecard FOREIGN KEY (ecard_id) REFERENCES tenant_ecards (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ecard 访客（身份类）';

-- ③ 短期访问令牌（accessToken）
CREATE TABLE IF NOT EXISTS ca_sessions (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    visitor_id        BIGINT UNSIGNED NOT NULL,
    token_hash        CHAR(64)        NOT NULL,            -- sha256(accessToken)，明文不落库
    client_ip         VARCHAR(64)     NULL,
    user_agent        VARCHAR(1000)   NULL,
    expires_at        DATETIME        NOT NULL,            -- 30 分钟滑动
    last_used_at      DATETIME        NULL,
    revoked_at        DATETIME        NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ca_sessions_token (token_hash),
    KEY idx_ca_sessions_visitor (visitor_id, expires_at),
    CONSTRAINT fk_ca_sess_visitor FOREIGN KEY (visitor_id) REFERENCES ca_visitors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='访客短期访问令牌';

-- ④ 长期恢复令牌（resumeToken，带 rotation 链）
CREATE TABLE IF NOT EXISTS ca_resume_tokens (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    visitor_id        BIGINT UNSIGNED NOT NULL,
    family_id         CHAR(32)        NOT NULL,            -- 令牌链标识（重放检测时整链撤销）
    token_hash        CHAR(64)        NOT NULL,
    issued_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at        DATETIME        NOT NULL,            -- 30 天绝对 + 7 天闲置
    last_used_at      DATETIME        NULL,
    revoked_at        DATETIME        NULL,
    replaced_by_id    BIGINT UNSIGNED NULL,                -- rotation 链式关系
    reused_at         DATETIME        NULL,                -- 检测到重放的时间（审计）
    PRIMARY KEY (id),
    UNIQUE KEY uq_ca_resume_token (token_hash),
    KEY idx_ca_resume_visitor (visitor_id, expires_at),
    KEY idx_ca_resume_family (family_id),
    CONSTRAINT fk_ca_resume_visitor FOREIGN KEY (visitor_id) REFERENCES ca_visitors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='访客长期恢复令牌（rotation 链）';

-- ⑤ 会话（历史类；同一访客身份唯一一条，永不新建）
CREATE TABLE IF NOT EXISTS ca_conversations (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id             VARCHAR(48)     NOT NULL,        -- conv_ + 32hex
    ecard_id              BIGINT UNSIGNED NOT NULL,
    visitor_id            BIGINT UNSIGNED NOT NULL,
    sip_user_id           BIGINT UNSIGNED NULL,            -- 当前归属（routing）+ 归属校验依据；账号删除 → SET NULL
    owner_changed_at      DATETIME        NULL,            -- owner 转交审计
    status                ENUM('active','archived') NOT NULL DEFAULT 'active',  -- 不设 closed
    archived_at           DATETIME        NULL,
    last_seq              BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_message_id       BIGINT UNSIGNED NULL,
    last_message_at       DATETIME        NULL,
    last_message_preview  VARCHAR(255)    NULL,
    unread_for_agent      INT UNSIGNED    NOT NULL DEFAULT 0,
    unread_for_visitor    INT UNSIGNED    NOT NULL DEFAULT 0,
    agent_last_read_seq   BIGINT UNSIGNED NOT NULL DEFAULT 0,
    visitor_last_read_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ca_conv_public (public_id),
    UNIQUE KEY uq_ca_conv_visitor (ecard_id, visitor_id),  -- ★ 同一访客身份一个会话
    KEY idx_ca_conv_agent (sip_user_id, status, last_message_at),
    KEY idx_ca_conv_recent (ecard_id, last_message_at),
    CONSTRAINT fk_ca_conv_ecard FOREIGN KEY (ecard_id) REFERENCES tenant_ecards (id) ON DELETE RESTRICT,
    CONSTRAINT fk_ca_conv_visitor FOREIGN KEY (visitor_id) REFERENCES ca_visitors (id) ON DELETE CASCADE,
    CONSTRAINT fk_ca_conv_owner FOREIGN KEY (sip_user_id) REFERENCES sip_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ecard 访客会话（历史类）';

-- ⑥ 消息（CA 域唯一消息存储；seq 会话内单调、不保证连续）
CREATE TABLE IF NOT EXISTS ca_messages (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    conversation_id     BIGINT UNSIGNED NOT NULL,
    seq                 BIGINT UNSIGNED NOT NULL,
    sender_type         ENUM('visitor','agent','system') NOT NULL,
    sender_sip_user_id  BIGINT UNSIGNED NULL,
    content_type        VARCHAR(32)     NOT NULL DEFAULT 'text',
    content             TEXT            NULL,
    client_msg_id       VARCHAR(64)     NULL,              -- 幂等（发送方生成）
    status              VARCHAR(32)     NOT NULL DEFAULT 'sent', -- sent|delivered|read|failed
    delivered_at        DATETIME        NULL,
    read_at             DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_ca_msg_seq (conversation_id, seq),
    UNIQUE KEY uq_ca_msg_client (conversation_id, sender_type, client_msg_id),
    KEY idx_ca_msg_conv_time (conversation_id, created_at),
    CONSTRAINT fk_ca_msg_conv FOREIGN KEY (conversation_id) REFERENCES ca_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ecard 访客消息';

-- ⑦ 附件（Phase 4 才写入数据；表结构先行冻结核对）
CREATE TABLE IF NOT EXISTS ca_attachments (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    message_id    BIGINT UNSIGNED NOT NULL,
    kind          VARCHAR(32)     NOT NULL,                -- image | file
    file_name     VARCHAR(255)    NULL,
    mime_type     VARCHAR(120)    NULL,
    file_size     INT UNSIGNED    NULL,
    storage_key   VARCHAR(255)    NOT NULL,
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ca_att_message (message_id),
    CONSTRAINT fk_ca_att_message FOREIGN KEY (message_id) REFERENCES ca_messages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ecard 访客消息附件（Phase 4）';
