-- Migration: 078_ai_message_reasoning
-- AI 助手 v2：推理模型的 reasoning_content 留存与回填
-- DeepSeek 等推理模型要求多轮对话回传上次回复的 reasoning_content；
-- 客户端只存 content，故服务端按 (用户, 内容哈希) 留存并在转发时回填。

CREATE TABLE IF NOT EXISTS ai_message_reasoning (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sip_user_id       BIGINT UNSIGNED NOT NULL,
    content_hash      VARCHAR(64) NOT NULL,
    reasoning_content MEDIUMTEXT NOT NULL,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_ai_reasoning_user_hash (sip_user_id, content_hash),
    CONSTRAINT fk_ai_reasoning_sip_user
        FOREIGN KEY (sip_user_id) REFERENCES sip_users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
