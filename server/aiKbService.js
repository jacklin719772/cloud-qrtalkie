// server/aiKbService.js
// AI 助手 v2（只增不改）：知识库管理框架
// 文档解析/嵌入由阶段 C 独立服务完成；当前文档落库后保持 pending，test 返回空结果。

export async function listKnowledgeBases(sipUserId, connection) {
    const rows = await connection.query(
        `SELECT id, name, description, doc_count, created_at, updated_at
         FROM ai_knowledge_bases WHERE sip_user_id = ?
         ORDER BY updated_at DESC`,
        [sipUserId]
    );
    return rows.map(r => ({
        id: Number(r.id), name: r.name, description: r.description,
        doc_count: Number(r.doc_count || 0), created_at: r.created_at, updated_at: r.updated_at,
    }));
}

export async function createKnowledgeBase(sipUserId, { name, description }, connection) {
    const result = await connection.query(
        `INSERT INTO ai_knowledge_bases (sip_user_id, name, description) VALUES (?, ?, ?)`,
        [sipUserId, name, description || ""]
    );
    const [row] = await connection.query(
        `SELECT id, name, description, doc_count, created_at, updated_at
         FROM ai_knowledge_bases WHERE id = ?`,
        [Number(result.insertId)]
    );
    return {
        id: Number(row.id), name: row.name, description: row.description,
        doc_count: Number(row.doc_count || 0), created_at: row.created_at, updated_at: row.updated_at,
    };
}

export async function updateKnowledgeBase(kbId, sipUserId, { name, description }, connection) {
    const [existing] = await connection.query(
        `SELECT id FROM ai_knowledge_bases WHERE id = ? AND sip_user_id = ? LIMIT 1`,
        [kbId, sipUserId]
    );
    if (!existing) return null;

    if (name !== undefined && String(name).trim().length > 0) {
        await connection.query(`UPDATE ai_knowledge_bases SET name = ? WHERE id = ?`, [String(name).trim().slice(0, 100), kbId]);
    }
    if (description !== undefined) {
        await connection.query(`UPDATE ai_knowledge_bases SET description = ? WHERE id = ?`, [String(description).trim().slice(0, 500), kbId]);
    }
    const [row] = await connection.query(
        `SELECT id, name, description, doc_count, updated_at FROM ai_knowledge_bases WHERE id = ?`,
        [kbId]
    );
    return {
        id: Number(row.id), name: row.name, description: row.description,
        doc_count: Number(row.doc_count || 0), updated_at: row.updated_at,
    };
}

export async function deleteKnowledgeBase(kbId, sipUserId, connection) {
    const [existing] = await connection.query(
        `SELECT id FROM ai_knowledge_bases WHERE id = ? AND sip_user_id = ? LIMIT 1`,
        [kbId, sipUserId]
    );
    if (!existing) return false;
    await connection.query(`DELETE FROM ai_knowledge_bases WHERE id = ?`, [kbId]);
    return true;
}

export async function listKbDocuments(kbId, sipUserId, connection) {
    const [kb] = await connection.query(
        `SELECT id FROM ai_knowledge_bases WHERE id = ? AND sip_user_id = ? LIMIT 1`,
        [kbId, sipUserId]
    );
    if (!kb) return null;

    const rows = await connection.query(
        `SELECT id, filename, storage_key, file_size, status, chunk_count, error_code, created_at, updated_at
         FROM ai_kb_documents WHERE kb_id = ? ORDER BY created_at DESC`,
        [kbId]
    );
    return rows.map(r => ({
        id: Number(r.id), filename: r.filename, storage_key: r.storage_key,
        file_size: Number(r.file_size || 0), status: r.status,
        chunk_count: Number(r.chunk_count || 0), error_code: r.error_code,
        created_at: r.created_at, updated_at: r.updated_at,
    }));
}

export async function addKbDocument(kbId, sipUserId, { filename, storageKey, fileSize }, connection) {
    const [kb] = await connection.query(
        `SELECT id FROM ai_knowledge_bases WHERE id = ? AND sip_user_id = ? LIMIT 1`,
        [kbId, sipUserId]
    );
    if (!kb) return null;

    const result = await connection.query(
        `INSERT INTO ai_kb_documents (kb_id, filename, storage_key, file_size, status)
         VALUES (?, ?, ?, ?, 'pending')`,
        [kbId, filename, storageKey, fileSize]
    );
    await connection.query(
        `UPDATE ai_knowledge_bases SET doc_count = doc_count + 1 WHERE id = ?`,
        [kbId]
    );
    // TODO 阶段 C：通知解析服务（队列/直接调用）
    const [row] = await connection.query(
        `SELECT id, filename, file_size, status, chunk_count, created_at FROM ai_kb_documents WHERE id = ?`,
        [Number(result.insertId)]
    );
    return {
        id: Number(row.id), filename: row.filename, file_size: Number(row.file_size || 0),
        status: row.status, chunk_count: Number(row.chunk_count || 0), created_at: row.created_at,
    };
}

export async function deleteKbDocument(docId, kbId, sipUserId, connection) {
    const [kb] = await connection.query(
        `SELECT id FROM ai_knowledge_bases WHERE id = ? AND sip_user_id = ? LIMIT 1`,
        [kbId, sipUserId]
    );
    if (!kb) return false;
    const result = await connection.query(
        `DELETE FROM ai_kb_documents WHERE id = ? AND kb_id = ?`,
        [docId, kbId]
    );
    if (Number(result.affectedRows) > 0) {
        await connection.query(
            `UPDATE ai_knowledge_bases SET doc_count = GREATEST(doc_count - 1, 0) WHERE id = ?`,
            [kbId]
        );
        return true;
    }
    return false;
}

// RAG 测试检索：阶段 C 嵌入服务就位前返回空结果
export async function testKbRetrieval(kbId, sipUserId, query, connection) {
    const [kb] = await connection.query(
        `SELECT id FROM ai_knowledge_bases WHERE id = ? AND sip_user_id = ? LIMIT 1`,
        [kbId, sipUserId]
    );
    if (!kb) return null;
    // TODO 阶段 C：query 嵌入 → 余弦 top-K（阈值 0.5）→ [{content, score, documentId}]
    return [];
}
