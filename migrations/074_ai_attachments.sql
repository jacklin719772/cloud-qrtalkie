-- Migration: 074_ai_attachments
-- AI 助手 v2（只增不改）：消息附件元数据
-- 文件实体存对象存储；客户端解析后的文本随消息体上送（服务端不解析）

CREATE TABLE IF NOT EXISTS ai_attachments (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    message_id    BIGINT UNSIGNED NOT NULL,
    kind          VARCHAR(16) NOT NULL DEFAULT 'file',   -- file | image
    filename      VARCHAR(255) NOT NULL DEFAULT '',
    file_size     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    storage_key   VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ai_attach_msg (message_id),
    CONSTRAINT fk_ai_attach_msg
        FOREIGN KEY (message_id) REFERENCES ai_bot_messages(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
