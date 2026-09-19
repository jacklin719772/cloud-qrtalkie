-- Migration: 080_ca_audit_log
-- Customer Assistant 审计日志（P1 步骤 10）
--
-- 说明：方案 10_ECARD_VISITOR_CHAT_SOLUTION.md §6 原定义 7 张表；
-- 本表是步骤 10（审计）新增的第 8 张表，已在文档 §6/§18 同步登记。
-- 设计要点：**不建外键**（审计必须独立于业务数据的生命周期存活），
--           只存对外公开 id 与时间，不存令牌/明文内容以外的敏感信息。
--
-- 幂等：IF NOT EXISTS，可安全重跑

CREATE TABLE IF NOT EXISTS ca_audit_log (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    occurred_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    action            VARCHAR(64)     NOT NULL,                 -- session_issued / session_blocked / conversation_archived / visitor_blocked / visitor_unblocked / forbidden_access
    actor_type        ENUM('visitor','agent','system') NOT NULL,
    actor_public_id   VARCHAR(48)     NULL,                     -- vis_… / conv_… 等公开 id，不存内部自增 id
    target_type       VARCHAR(32)     NULL,                     -- ecard / visitor / conversation
    target_public_id  VARCHAR(48)     NULL,
    ip                VARCHAR(64)     NULL,
    meta              JSON            NULL,
    PRIMARY KEY (id),
    KEY idx_ca_audit_time (occurred_at),
    KEY idx_ca_audit_action (action, occurred_at),
    KEY idx_ca_audit_actor (actor_type, actor_public_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Customer Assistant 审计日志';
