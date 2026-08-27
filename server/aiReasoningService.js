// server/aiReasoningService.js
// AI 助手：推理模型 reasoning_content 留存与回填（只增不改）
// DeepSeek 等推理模型要求多轮对话回传上次回复的 reasoning_content；
// 客户端只保存 content，故服务端按 (sip_user_id, 内容哈希) 留存并在转发时回填。

import { hashToken } from "./security.js";

export function hashContent(content) {
    return hashToken(String(content));
}

// 留存某条助手回复的 reasoning_content（无内容则跳过）
export async function saveReasoning(sipUserId, content, reasoningContent, connection) {
    const text = String(content || "").trim();
    const reasoning = String(reasoningContent || "").trim();
    if (!text || !reasoning) return;
    await connection.query(
        `INSERT INTO ai_message_reasoning (sip_user_id, content_hash, reasoning_content)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reasoning_content = VALUES(reasoning_content)`,
        [sipUserId, hashContent(text), reasoning]
    );
}

// 为消息列表中的助手消息回填 reasoning_content
// 仅处理纯文本助手消息，且客户端未自带 reasoning_content 时按内容哈希注入
export async function injectReasoning(sipUserId, messages, connection) {
    const candidates = [];
    for (let i = 0; i < messages.length; ++i) {
        const m = messages[i];
        if (!m || m.role !== "assistant") continue;
        if (typeof m.content !== "string" || m.content.trim().length === 0) continue;
        if (m.reasoning_content) continue;
        candidates.push({ index: i, hash: hashContent(m.content) });
    }
    if (candidates.length === 0) return;

    const rows = await connection.query(
        `SELECT content_hash, reasoning_content FROM ai_message_reasoning
         WHERE sip_user_id = ? AND content_hash IN (?)`,
        [sipUserId, candidates.map((c) => c.hash)]
    );
    const byHash = new Map(rows.map((r) => [r.content_hash, r.reasoning_content]));
    for (const c of candidates) {
        const reasoning = byHash.get(c.hash);
        if (reasoning) {
            messages[c.index] = { ...messages[c.index], reasoning_content: reasoning };
        }
    }
}
