// server/aiPromptService.js
// AI 助手 v2（只增不改）：提示词库（按用户隔离，多端同步）

export async function listPrompts(sipUserId, connection) {
    const rows = await connection.query(
        `SELECT id, title, content, category, shortcut, usage_count, created_at, updated_at
         FROM ai_prompts WHERE sip_user_id = ?
         ORDER BY usage_count DESC, updated_at DESC`,
        [sipUserId]
    );
    return rows.map(r => ({
        id: Number(r.id),
        title: r.title,
        content: r.content,
        category: r.category,
        shortcut: r.shortcut,
        usage_count: Number(r.usage_count || 0),
        created_at: r.created_at,
        updated_at: r.updated_at,
    }));
}

export async function createPrompt(sipUserId, { title, content, category, shortcut }, connection) {
    const result = await connection.query(
        `INSERT INTO ai_prompts (sip_user_id, title, content, category, shortcut)
         VALUES (?, ?, ?, ?, ?)`,
        [sipUserId, title, content, category || "", shortcut || ""]
    );
    const [row] = await connection.query(
        `SELECT id, title, content, category, shortcut, usage_count, created_at, updated_at
         FROM ai_prompts WHERE id = ?`,
        [Number(result.insertId)]
    );
    return {
        id: Number(row.id), title: row.title, content: row.content,
        category: row.category, shortcut: row.shortcut,
        usage_count: Number(row.usage_count || 0), created_at: row.created_at, updated_at: row.updated_at,
    };
}

export async function updatePrompt(promptId, sipUserId, { title, content, category, shortcut }, connection) {
    const [existing] = await connection.query(
        `SELECT id FROM ai_prompts WHERE id = ? AND sip_user_id = ? LIMIT 1`,
        [promptId, sipUserId]
    );
    if (!existing) return null;

    const t = title !== undefined ? String(title).trim().slice(0, 100) : undefined;
    const c = content !== undefined ? String(content).trim().slice(0, 20000) : undefined;
    const cat = category !== undefined ? String(category).trim().slice(0, 50) : undefined;
    const sc = shortcut !== undefined ? String(shortcut).trim().slice(0, 50) : undefined;
    if (t !== undefined && t.length > 0) await connection.query(`UPDATE ai_prompts SET title = ? WHERE id = ?`, [t, promptId]);
    if (c !== undefined && c.length > 0) await connection.query(`UPDATE ai_prompts SET content = ? WHERE id = ?`, [c, promptId]);
    if (cat !== undefined) await connection.query(`UPDATE ai_prompts SET category = ? WHERE id = ?`, [cat, promptId]);
    if (sc !== undefined) await connection.query(`UPDATE ai_prompts SET shortcut = ? WHERE id = ?`, [sc, promptId]);

    const [row] = await connection.query(
        `SELECT id, title, content, category, shortcut, usage_count, updated_at
         FROM ai_prompts WHERE id = ?`,
        [promptId]
    );
    return {
        id: Number(row.id), title: row.title, content: row.content,
        category: row.category, shortcut: row.shortcut,
        usage_count: Number(row.usage_count || 0), updated_at: row.updated_at,
    };
}

export async function deletePrompt(promptId, sipUserId, connection) {
    const [existing] = await connection.query(
        `SELECT id FROM ai_prompts WHERE id = ? AND sip_user_id = ? LIMIT 1`,
        [promptId, sipUserId]
    );
    if (!existing) return false;
    await connection.query(`DELETE FROM ai_prompts WHERE id = ?`, [promptId]);
    return true;
}

export async function touchPromptUsage(promptId, sipUserId, connection) {
    const [existing] = await connection.query(
        `SELECT id FROM ai_prompts WHERE id = ? AND sip_user_id = ? LIMIT 1`,
        [promptId, sipUserId]
    );
    if (!existing) return false;
    await connection.query(`UPDATE ai_prompts SET usage_count = usage_count + 1 WHERE id = ?`, [promptId]);
    return true;
}
