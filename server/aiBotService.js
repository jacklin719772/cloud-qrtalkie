// server/aiBotService.js
// QRTalkie AI Chat Bot — Session & Message Management (ESM)

import { chat as aiChat } from "./aiModelClient.js";
import { ensureAiAllowed, incrementUsage } from "./aiEntitlementService.js";
import { buildKbInjection, buildWebSearchInjection } from "./aiInjectionService.js";

const MAX_CONTEXT_MESSAGES = 10;
const MAX_USER_MESSAGE_LENGTH = 2000;

const SYSTEM_PROMPT = `你是 QRTalkie 的 AI 助手。你可以回答各類問題，對 QRTalkie 相關問題（賬號設定、SIP 註冊、推送通知、閱後即焚、環境檢測、許可權設定等）尤為專業。請用簡潔友好的中文回答。`;

export async function getOrCreateSession(sipUserId, connection) {
    const rows = await connection.query(
        `SELECT id, title, status, created_at, updated_at
         FROM ai_bot_sessions
         WHERE owner_sip_user_id = ? AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1`,
        [sipUserId]
    );
    if (rows.length > 0) {
        const s = rows[0];
        return { id: Number(s.id), title: s.title, status: s.status, created_at: s.created_at, updated_at: s.updated_at };
    }

    const result = await connection.query(
        `INSERT INTO ai_bot_sessions (owner_sip_user_id, title, status) VALUES (?, 'AI 助手', 'active')`,
        [sipUserId]
    );
    const [newSession] = await connection.query(
        `SELECT id, title, status, created_at, updated_at FROM ai_bot_sessions WHERE id = ?`,
        [Number(result.insertId)]
    );
    return { id: Number(newSession.id), title: newSession.title, status: newSession.status, created_at: newSession.created_at, updated_at: newSession.updated_at };
}

export async function getMessages(sessionId, sipUserId, connection) {
    const [session] = await connection.query(
        `SELECT id FROM ai_bot_sessions WHERE id = ? AND owner_sip_user_id = ? LIMIT 1`,
        [sessionId, sipUserId]
    );
    if (!session) return null;

    const rows = await connection.query(
        `SELECT id, session_id, role, content, message_type, token_count, status, created_at
         FROM ai_bot_messages WHERE session_id = ? ORDER BY created_at ASC`,
        [sessionId]
    );
    return rows.map(r => ({
        id: Number(r.id), session_id: Number(r.session_id), role: r.role,
        content: r.content, message_type: r.message_type,
        token_count: Number(r.token_count || 0), status: r.status, created_at: r.created_at
    }));
}

export async function sendMessage(sessionId, sipUserId, content, connection, options = undefined) {
    if (!content || String(content).trim().length === 0) {
        return { error: "AI_EMPTY_MESSAGE", message: "訊息不能為空" };
    }
    const trimmed = String(content).trim().slice(0, MAX_USER_MESSAGE_LENGTH);

    // Verify ownership
    const [session] = await connection.query(
        `SELECT id FROM ai_bot_sessions WHERE id = ? AND owner_sip_user_id = ? LIMIT 1`,
        [sessionId, sipUserId]
    );
    if (!session) return { error: "AI_SESSION_NOT_FOUND", message: "會話不存在" };

    // Save user message（记录 id 供附件关联）
    const userMsgResult = await connection.query(
        `INSERT INTO ai_bot_messages (session_id, role, content, message_type, status) VALUES (?, 'user', ?, 'text', 'completed')`,
        [sessionId, trimmed]
    );
    const userMessageId = Number(userMsgResult.insertId);

    // v2（只增不改）：附件元数据落库（可选字段，旧客户端不传则跳过）
    const attachments = Array.isArray(options?.attachments) ? options.attachments : [];
    for (const att of attachments.slice(0, 10)) {
        const key = String(att?.key || "").slice(0, 255);
        const name = String(att?.filename || "").slice(0, 255);
        if (!key || !name) continue;
        await connection.query(
            `INSERT INTO ai_attachments (message_id, kind, filename, file_size, storage_key)
             VALUES (?, ?, ?, ?, ?)`,
            [userMessageId,
             String(att?.kind || "file") === "image" ? "image" : "file",
             name,
             Number(att?.size) > 0 ? Number(att.size) : 0,
             key]
        );
    }

    // v2：检索/搜索注入（可选字段；未就绪/失败自动降级为普通对话）
    let finalUserContent = trimmed;
    const injectedParts = [];
    if (options?.knowledgeBaseId) {
        try {
            const kbCtx = await buildKbInjection(Number(options.knowledgeBaseId), trimmed, connection);
            if (kbCtx) injectedParts.push(kbCtx);
        } catch (error) {
            console.warn("[aiBotService] KB injection failed, degraded:", error?.message || error);
        }
    }
    if (options?.webSearch === true) {
        try {
            const wsCtx = await buildWebSearchInjection(trimmed, connection);
            if (wsCtx) injectedParts.push(wsCtx);
        } catch (error) {
            console.warn("[aiBotService] web search injection failed, degraded:", error?.message || error);
        }
    }
    if (injectedParts.length > 0) {
        finalUserContent = `${injectedParts.join("\n\n")}\n\n以上是可能相關的參考資料，僅供參考：如與用戶問題無關請忽略，直接按用戶要求回答；如相關請參考並標註來源。\n\n[用戶問題]\n${trimmed}`;
    }

    // Build context
    const historyRows = await connection.query(
        `SELECT role, content FROM ai_bot_messages
         WHERE session_id = ? AND status = 'completed' AND message_type = 'text'
         ORDER BY created_at DESC LIMIT ?`,
        [sessionId, MAX_CONTEXT_MESSAGES]
    );
    historyRows.reverse();

    const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...historyRows.map(r => ({ role: r.role, content: r.content })),
    ];
    // 注入后的用户消息覆盖历史中的原样消息（保证模型看到的是带参考资料的版本）
    if (injectedParts.length > 0) {
        messages.push({ role: "user", content: finalUserContent });
    }

    // Call AI
    const result = await aiChat(messages);

    if (!result.ok) {
        await connection.query(
            `UPDATE ai_bot_messages SET status = 'failed'
             WHERE session_id = ? AND role = 'user' AND id = (
                 SELECT id FROM (SELECT id FROM ai_bot_messages
                 WHERE session_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT 1) AS t
             )`,
            [sessionId, sessionId]
        );
        return { error: result.error, message: result.message };
    }

    // Save AI reply
    await connection.query(
        `INSERT INTO ai_bot_messages (session_id, role, content, message_type, token_count, status)
         VALUES (?, 'assistant', ?, 'text', ?, 'completed')`,
        [sessionId, result.content, result.tokenCount]
    );

    await incrementUsage(sipUserId, connection);

    const [aiMsg] = await connection.query(
        `SELECT id, session_id, role, content, token_count, created_at
         FROM ai_bot_messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1`,
        [sessionId]
    );

    return { message: {
        id: Number(aiMsg.id), session_id: Number(aiMsg.session_id), role: aiMsg.role,
        content: aiMsg.content, token_count: Number(aiMsg.token_count || 0), created_at: aiMsg.created_at
    }};
}

export async function deleteSession(sessionId, sipUserId, connection) {
    const [session] = await connection.query(
        `SELECT id FROM ai_bot_sessions WHERE id = ? AND owner_sip_user_id = ? LIMIT 1`,
        [sessionId, sipUserId]
    );
    if (!session) return false;
    await connection.query(`DELETE FROM ai_bot_sessions WHERE id = ?`, [sessionId]);
    return true;
}

// ── AI 助手 v2（只增不改）：会话增强 ──────────────────────────────

export async function updateSession(sessionId, sipUserId, { title, isFavorite }, connection) {
    const [session] = await connection.query(
        `SELECT id FROM ai_bot_sessions WHERE id = ? AND owner_sip_user_id = ? LIMIT 1`,
        [sessionId, sipUserId]
    );
    if (!session) return null;

    if (title !== undefined) {
        const t = String(title).trim().slice(0, 255);
        if (t.length > 0) {
            await connection.query(`UPDATE ai_bot_sessions SET title = ? WHERE id = ?`, [t, sessionId]);
        }
    }
    if (isFavorite !== undefined) {
        await connection.query(
            `UPDATE ai_bot_sessions SET is_favorite = ? WHERE id = ?`,
            [isFavorite ? 1 : 0, sessionId]
        );
    }
    const [row] = await connection.query(
        `SELECT id, title, is_favorite FROM ai_bot_sessions WHERE id = ?`,
        [sessionId]
    );
    return { id: Number(row.id), title: row.title, is_favorite: !!Number(row.is_favorite || 0) };
}

export async function searchSessions(sipUserId, q, connection) {
    const keyword = String(q || "").trim().slice(0, 120);
    if (!keyword) return [];

    const like = `%${keyword}%`;
    const sessions = await connection.query(
        `SELECT s.id, s.title, s.is_favorite, s.updated_at,
                (SELECT COUNT(*) FROM ai_bot_messages m WHERE m.session_id = s.id) AS message_count
         FROM ai_bot_sessions s
         WHERE s.owner_sip_user_id = ? AND s.status = 'active'
           AND (s.title LIKE ? OR EXISTS (
               SELECT 1 FROM ai_bot_messages m2
               WHERE m2.session_id = s.id AND m2.content LIKE ? LIMIT 1
           ))
         ORDER BY s.updated_at DESC LIMIT 50`,
        [sipUserId, like, like]
    );
    return sessions.map(s => ({
        id: Number(s.id),
        title: s.title,
        is_favorite: !!Number(s.is_favorite || 0),
        message_count: Number(s.message_count || 0),
        updated_at: s.updated_at,
    }));
}

export async function duplicateSession(sessionId, sipUserId, connection) {
    const [session] = await connection.query(
        `SELECT id, title FROM ai_bot_sessions WHERE id = ? AND owner_sip_user_id = ? LIMIT 1`,
        [sessionId, sipUserId]
    );
    if (!session) return null;

    const result = await connection.query(
        `INSERT INTO ai_bot_sessions (owner_sip_user_id, title, status, is_favorite) VALUES (?, ?, 'active', 0)`,
        [sipUserId, `${session.title}（副本）`]
    );
    const newId = Number(result.insertId);

    const messages = await connection.query(
        `SELECT role, content, message_type, token_count, status FROM ai_bot_messages
         WHERE session_id = ? ORDER BY created_at ASC`,
        [sessionId]
    );
    for (const m of messages) {
        await connection.query(
            `INSERT INTO ai_bot_messages (session_id, role, content, message_type, token_count, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [newId, m.role, m.content, m.message_type, m.token_count, m.status]
        );
    }
    const [row] = await connection.query(
        `SELECT id, title FROM ai_bot_sessions WHERE id = ?`,
        [newId]
    );
    return { id: Number(row.id), title: row.title };
}

export async function exportSession(sessionId, sipUserId, connection) {
    const [session] = await connection.query(
        `SELECT id, title FROM ai_bot_sessions WHERE id = ? AND owner_sip_user_id = ? LIMIT 1`,
        [sessionId, sipUserId]
    );
    if (!session) return null;

    const messages = await connection.query(
        `SELECT role, content FROM ai_bot_messages WHERE session_id = ? ORDER BY created_at ASC`,
        [sessionId]
    );
    const NL = "\n";
    let text = `會話：${session.title}${NL}${NL}`;
    for (const m of messages) {
        const name = m.role === "user" ? "用戶" : "AI";
        text += `【${name}】${NL}${m.content}${NL}${NL}`;
    }
    return { title: session.title, text };
}
