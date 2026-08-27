-- Migration: 075_ai_knowledge_bases
-- AI 助手 v2（只增不改）：知识库 + 文档 + 向量块
-- 检索：BLOB 向量 + 暴力余弦（千级 chunk 无需向量库），解析与嵌入由独立旁路服务完成

CREATE TABLE IF NOT EXISTS ai_knowledge_bases (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    sip_user_id   BIGINT UNSIGNED NOT NULL,
    name          VARCHAR(100) NOT NULL,
    description   VARCHAR(500) NOT NULL DEFAULT '',
    doc_count     INT UNSIGNED NOT NULL DEFAULT 0,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_ai_kb_user (sip_user_id),
    CONSTRAINT fk_ai_kb_sip_user
        FOREIGN KEY (sip_user_id) REFERENCES sip_users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_kb_documents (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    kb_id         BIGINT UNSIGNED NOT NULL,
    filename      VARCHAR(255) NOT NULL,
    storage_key   VARCHAR(255) NOT NULL,
    file_size     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    status        VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending | parsing | ready | error
    chunk_count   INT UNSIGNED NOT NULL DEFAULT 0,
    error_code    VARCHAR(64) NOT NULL DEFAULT '',
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_ai_kbdoc_kb (kb_id),
    CONSTRAINT fk_ai_kbdoc_kb
        FOREIGN KEY (kb_id) REFERENCES ai_knowledge_bases(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_kb_chunks (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    doc_id        BIGINT UNSIGNED NOT NULL,
    kb_id         BIGINT UNSIGNED NOT NULL,
    seq           INT UNSIGNED NOT NULL,
    content       TEXT NOT NULL,
    embedding     BLOB NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ai_kbchunk_kb (kb_id),
    INDEX idx_ai_kbchunk_doc (doc_id),
    CONSTRAINT fk_ai_kbchunk_doc
        FOREIGN KEY (doc_id) REFERENCES ai_kb_documents(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
