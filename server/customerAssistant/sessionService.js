/**
 * Customer Assistant（ECard 访客聊天）——访客凭证服务。
 *
 * 规格来源（冻结口径）：
 *   docs/customer-assistant/10_ECARD_VISITOR_CHAT_SOLUTION.md
 *     §5.1 三凭证模型   visitorId（公开非凭证）/ accessToken（短期，内存）/ resumeToken（长期，只换票）
 *     §5.2 rotation + 重放检测（收到已撤销的 resumeToken → 撤销整条 family_id 链 + 该访客全部 accessToken）
 *     §5.3 下发方式     默认 Cookie 模式（HttpOnly + Secure + SameSite=Lax，不进 JSON body）；模式 B 才回 body
 *     §6   ca_sessions（access）/ ca_resume_tokens（resume，rotation 链）
 *
 * 约定：
 *   - 全部 token 明文只在签发那一刻返回，落库只存 sha256（对齐 aiApiKeyService.js:10-15 的做法）。
 *   - 所有函数接收"已取到的连接"（caller 负责 pool.getConnection()/release 与事务边界），
 *     便于与消息/会话服务共享同一事务。
 *   - 本文件不引入任何既有模块，也不被既有模块引用（接线在第 7 步），对线上零影响。
 */

import { createHash, randomBytes } from "node:crypto";

/* ------------------------------------------------------------------ *
 * 配置（冻结值见文档 §5.1，可用 CA_* 环境变量覆盖）
 * ------------------------------------------------------------------ */

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const CA_SESSION_CONFIG = {
  accessSlidingMs: positiveNumber(process.env.CA_ACCESS_TTL_MINUTES, 30) * 60_000, // 30 分钟滑动
  accessAbsoluteMs: positiveNumber(process.env.CA_ACCESS_ABSOLUTE_HOURS, 24) * 3_600_000, // 绝对上限 24h
  resumeAbsoluteMs: positiveNumber(process.env.CA_RESUME_TTL_DAYS, 30) * 86_400_000, // 30 天绝对
  resumeIdleMs: positiveNumber(process.env.CA_RESUME_IDLE_DAYS, 7) * 86_400_000, // 7 天闲置
  cookieName: String(process.env.CA_RESUME_COOKIE_NAME || "ca_resume"),
};

/* ------------------------------------------------------------------ *
 * 纯函数：token 生成 / 哈希 / Cookie 拼装与解析
 * ------------------------------------------------------------------ */

/** 256bit 随机 token（base64url，无 padding） */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

/** 16 字节随机 family id（32 hex），用于 resumeToken 的 rotation 链 */
export function newFamilyId() {
  return randomBytes(16).toString("hex");
}

/** 落库用：sha256 十六进制（不存明文） */
export function hashToken(token) {
  return createHash("sha256").update(String(token ?? "")).digest("hex");
}

/**
 * 拼装 ca_resume Cookie（模式 A 下发用）。
 * 默认 Path 指向取票端点所在前缀，避免随请求发往其它路径。
 */
export function buildResumeCookie(value, { path = "/api/ecard/", maxAgeSec = Math.floor(CA_SESSION_CONFIG.resumeAbsoluteMs / 1000), secure = true } = {}) {
  const parts = [
    `${CA_SESSION_CONFIG.cookieName}=${value}`,
    "HttpOnly",
    `SameSite=Lax`,
    `Path=${path}`,
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** 清除 Cookie（登出 / 已撤销时下发） */
export function buildClearResumeCookie({ path = "/api/ecard/" } = {}) {
  return `${CA_SESSION_CONFIG.cookieName}=; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=0`;
}

/** 从请求头解析 Cookie（不引第三方依赖，项目里也没有 cookie-parser） */
export function readResumeCookie(request) {
  const raw = request?.headers?.cookie;
  if (!raw) return null;
  for (const piece of String(raw).split(";")) {
    const idx = piece.indexOf("=");
    if (idx < 0) continue;
    if (piece.slice(0, idx).trim() === CA_SESSION_CONFIG.cookieName) {
      return decodeURIComponent(piece.slice(idx + 1).trim());
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * DB 操作（调用方负责事务）
 * ------------------------------------------------------------------ */

function toDate(ms) {
  return new Date(ms);
}

/**
 * 签发 accessToken（短期）。返回 { token, expiresAt }；明文 token 仅此一次返回。
 */
export async function issueAccessToken(connection, visitorId, { ip = null, userAgent = null } = {}) {
  const token = newToken();
  const now = Date.now();
  const expiresAt = toDate(now + CA_SESSION_CONFIG.accessSlidingMs);
  const result = await connection.query(
    `INSERT INTO ca_sessions (visitor_id, token_hash, client_ip, user_agent, expires_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [visitorId, hashToken(token), ip, userAgent, expiresAt],
  );
  return { id: result.insertId, token, expiresAt };
}

/**
 * 校验 accessToken：查哈希 → 未撤销 → 未过期（滑动续期，受绝对上限约束）。
 * 返回 { ok, reason?, session? }；reason: not_found | revoked | expired
 */
export async function resolveAccessToken(connection, token, { touch = true } = {}) {
  const digest = hashToken(token);
  const rows = await connection.query(
    `SELECT id, visitor_id, expires_at, revoked_at, created_at
       FROM ca_sessions WHERE token_hash = ? LIMIT 1`,
    [digest],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };

  const now = Date.now();
  const absoluteDeadline = new Date(row.created_at).getTime() + CA_SESSION_CONFIG.accessAbsoluteMs;
  if (new Date(row.expires_at).getTime() < now || now >= absoluteDeadline) {
    return { ok: false, reason: "expired" };
  }

  if (touch) {
    const nextExpiry = new Date(Math.min(now + CA_SESSION_CONFIG.accessSlidingMs, absoluteDeadline));
    await connection.query(`UPDATE ca_sessions SET expires_at = ?, last_used_at = NOW() WHERE id = ?`, [
      nextExpiry,
      row.id,
    ]);
  }
  return { ok: true, session: { id: row.id, visitorId: Number(row.visitor_id) } };
}

/**
 * 签发 resumeToken（长期）。familyId 为空时开启新链（= 新访客首次取票）。
 */
export async function issueResumeToken(connection, visitorId, { familyId = null } = {}) {
  const token = newToken();
  const now = Date.now();
  const expiresAt = toDate(now + CA_SESSION_CONFIG.resumeAbsoluteMs);
  const result = await connection.query(
    `INSERT INTO ca_resume_tokens (visitor_id, family_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
    [visitorId, familyId || newFamilyId(), hashToken(token), expiresAt],
  );
  return { id: result.insertId, token, expiresAt };
}

/**
 * 用 resumeToken 换新凭证（rotation + 重放检测）。
 *
 * 返回：
 *   { ok: true,  visitorId, resumeToken, newResumeTokenId }              正常轮换
 *   { ok: false, reason: "not_found" }                                    未知 token（按新访客处理）
 *   { ok: false, reason: "expired" }                                      绝对/闲置过期
 *   { ok: false, reason: "replayed", revokedAccess: n }                   **重放**：整链 + 该访客全部 accessToken 已撤销
 */
export async function redeemResumeToken(connection, token, { now = Date.now() } = {}) {
  const digest = hashToken(token);
  const rows = await connection.query(
    `SELECT id, visitor_id, family_id, expires_at, last_used_at, revoked_at
       FROM ca_resume_tokens WHERE token_hash = ? LIMIT 1`,
    [digest],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: "not_found" };

  // ① 重放：token 已被撤销却再次被使用 → 判定为窃取，整链 + 该访客全部 accessToken 一起撤销
  if (row.revoked_at) {
    await connection.query(`UPDATE ca_resume_tokens SET reused_at = NOW() WHERE id = ?`, [row.id]);
    await revokeFamily(connection, row.family_id);
    const revokedAccess = await revokeVisitorAccessTokens(connection, row.visitor_id);
    return { ok: false, reason: "replayed", revokedAccess };
  }

  // ② 过期（绝对 or 闲置）
  const idleBase = row.last_used_at ? new Date(row.last_used_at).getTime() : new Date(row.expires_at).getTime();
  if (new Date(row.expires_at).getTime() < now || idleBase + CA_SESSION_CONFIG.resumeIdleMs < now) {
    return { ok: false, reason: "expired" };
  }

  // ③ 正常轮换：先签发新链节点，再把旧节点标记撤销并指向新节点
  const next = await issueResumeToken(connection, row.visitor_id, { familyId: row.family_id });
  await connection.query(
    `UPDATE ca_resume_tokens SET revoked_at = NOW(), last_used_at = NOW(), replaced_by_id = ? WHERE id = ?`,
    [next.id, row.id],
  );
  return { ok: true, visitorId: Number(row.visitor_id), resumeToken: next.token, newResumeTokenId: next.id };
}

/** 撤销整条 rotation 链（重放检测 / 主动登出） */
export async function revokeFamily(connection, familyId) {
  const result = await connection.query(
    `UPDATE ca_resume_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL`,
    [familyId],
  );
  return Number(result.affectedRows || 0);
}

/** 撤销某访客的全部 accessToken（重放检测时与 revokeFamily 配套） */
export async function revokeVisitorAccessTokens(connection, visitorId) {
  const result = await connection.query(
    `UPDATE ca_sessions SET revoked_at = NOW() WHERE visitor_id = ? AND revoked_at IS NULL`,
    [visitorId],
  );
  return Number(result.affectedRows || 0);
}

/* ------------------------------------------------------------------ *
 * 清理（供第 10 步的定时任务调用）
 * ------------------------------------------------------------------ */

export async function purgeExpiredTokens(connection, { now = Date.now() } = {}) {
  const access = await connection.query(
    `DELETE FROM ca_sessions WHERE expires_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`,
  );
  const resume = await connection.query(
    `DELETE FROM ca_resume_tokens
      WHERE expires_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND (revoked_at IS NOT NULL OR last_used_at IS NOT NULL)`,
    [],
  );
  return { removedAccess: Number(access.affectedRows || 0), removedResume: Number(resume.affectedRows || 0) };
}
