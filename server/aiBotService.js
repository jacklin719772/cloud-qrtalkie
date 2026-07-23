// server/aiBotService.js
// QRTalkie AI Chat Bot — Session & Message Management (ESM)

import { chat as aiChat } from "./aiModelClient.js";
import { ensureAiAllowed, incrementUsage } from "./aiEntitlementService.js";

const MAX_CONTEXT_MESSAGES = 10;
const MAX_USER_MESSAGE_LENGTH = 2000;

const SYSTEM_PROMPT = `你是 QRTalkie 的 AI 助手。你可以回答各类问题，对 QRTalkie 相关问题（账号设置、SIP 注册、推送通知、阅后即焚、环境检测、权限设置等）尤为专业。请用简洁友好的中文回答。`;

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

export async function sendMessage(sessionId, sipUserId, content, connection) {
    if (!content || String(content).trim().length === 0) {
        return { error: "AI_EMPTY_MESSAGE", message: "消息不能为空" };
    }
    const trimmed = String(content).trim().slice(0, MAX_USER_MESSAGE_LENGTH);

    // Verify ownership
    const [session] = await connection.query(
        `SELECT id FROM ai_bot_sessions WHERE id = ? AND owner_sip_user_id = ? LIMIT 1`,
        [sessionId, sipUserId]
    );
    if (!session) return { error: "AI_SESSION_NOT_FOUND", message: "会话不存在" };

    // Save user message
    await connection.query(
        `INSERT INTO ai_bot_messages (session_id, role, content, message_type, status) VALUES (?, 'user', ?, 'text', 'completed')`,
        [sessionId, trimmed]
    );

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
