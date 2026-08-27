// server/aiApiKeyService.js
// AI 助手 v2（只增不改）：个人 API Key 管理（OpenAI 兼容端点 /v1/* 鉴权用）

import { randomBytes, createHash } from "node:crypto";
import { hashToken } from "./security.js";

const KEY_PREFIX = "ak-";

export function generateApiKey() {
    return KEY_PREFIX + randomBytes(16).toString("hex");
}

export function hashApiKey(key) {
    return hashToken(key);
}

export async function createApiKey(sipUserId, name, connection) {
    const key = generateApiKey();
    await connection.query(
        `INSERT INTO ai_api_keys (sip_user_id, key_hash, name) VALUES (?, ?, ?)`,
        [sipUserId, hashApiKey(key), String(name || "").slice(0, 100)]
    );
    return key; // 明文仅此一次返回
}

export async function listApiKeys(sipUserId, connection) {
    const rows = await connection.query(
        `SELECT id, name, enabled, last_used_at, created_at, expires_at
         FROM ai_api_keys WHERE sip_user_id = ?
         ORDER BY created_at DESC`,
        [sipUserId]
    );
    return rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        enabled: !!Number(r.enabled || 0),
        last_used_at: r.last_used_at,
        created_at: r.created_at,
        expires_at: r.expires_at,
    }));
}

export async function deleteApiKey(keyId, sipUserId, connection) {
    const result = await connection.query(
        `DELETE FROM ai_api_keys WHERE id = ? AND sip_user_id = ?`,
        [keyId, sipUserId]
    );
    return Number(result.affectedRows) > 0;
}

// 校验 key → 返回 sip_user_id；无效/禁用/过期返回 null
export async function verifyApiKey(key, connection) {
    if (typeof key !== "string" || !key.startsWith(KEY_PREFIX) || key.length < 16) return null;
    const rows = await connection.query(
        `SELECT sip_user_id, enabled, expires_at FROM ai_api_keys WHERE key_hash = ? LIMIT 1`,
        [hashApiKey(key)]
    );
    const row = rows[0];
    if (!row) return null;
    if (!Number(row.enabled || 0)) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    return Number(row.sip_user_id);
}

export async function touchApiKeyLastUsed(key, connection) {
    if (typeof key !== "string" || !key.startsWith(KEY_PREFIX)) return;
    connection.query(
        `UPDATE ai_api_keys SET last_used_at = NOW() WHERE key_hash = ?`,
        [hashApiKey(key)]
    ).catch(() => {});
}
