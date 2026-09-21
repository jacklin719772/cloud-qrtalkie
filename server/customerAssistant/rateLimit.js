/**
 * Customer Assistant —— 访客侧/客服侧限流（单实例内存窗口）。
 *
 * 阈值来源：docs/customer-assistant/07_SECURITY_ANALYSIS.md §7.2
 *   取票 10/分/IP · 建会话 5/分/IP · 发消息 ≈1 条/秒（突发 5）· 历史 30/分/会话 · 公开 id 查询 60/分/IP
 *
 * 口径与既有实现一致（server/index.js:11694 getEcardClientIp、:11702 内存窗口）：
 *   固定窗口 Map + 过期清理；**单实例有效**。
 *   多实例下阈值会变成"配置值 × 节点数"，迁移目标见 10 §8.2（Redis INCR + EXPIRE）。
 */

const DEFAULT_LIMITS = {
  session: { limit: 10, windowMs: 60_000 }, // 取票（按 IP）
  conversation: { limit: 5, windowMs: 60_000 }, // 建会话（按 IP）
  visitorMessage: { limit: 5, windowMs: 5_000 }, // ≈1 条/秒，突发 5（按访客）
  agentMessage: { limit: 10, windowMs: 5_000 }, // ≈2 条/秒，突发 10（按客服）
  history: { limit: 30, windowMs: 60_000 }, // 历史拉取（按会话/访客）
  publicLookup: { limit: 60, windowMs: 60_000 }, // 公开 id 查询（按 IP，防枚举）
  resumeByIp: { limit: 10, windowMs: 3_600_000 }, // 聊天码找回（按 IP，防枚举）
  resumeByCode: { limit: 5, windowMs: 3_600_000 }, // 聊天码找回（按码哈希，防暴力猜测）
};

function envLimit(name, fallback) {
  const raw = process.env[`CA_RATE_${name.toUpperCase()}_LIMIT`];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const CA_RATE_LIMITS = Object.fromEntries(
  Object.entries(DEFAULT_LIMITS).map(([name, cfg]) => [name, { ...cfg, limit: envLimit(name, cfg.limit) }]),
);

const buckets = new Map(); // key → { windowEndsAt, count }
const SWEEP_INTERVAL_MS = 60_000;
let sweepTimer = null;

function sweep(now = Date.now()) {
  for (const [key, bucket] of buckets.entries()) {
    if (!bucket || bucket.windowEndsAt <= now) buckets.delete(key);
  }
}

function ensureSweeper() {
  if (sweepTimer) return;
  // unref：不因限流清扫阻止进程退出（与既有实现"随调用清理"等效，但不做 O(n) 每次调用）
  sweepTimer = setInterval(() => sweep(), SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

/**
 * 固定窗口计数。返回 { allowed, remaining, retryAfterMs }。
 * 用法：const verdict = allowRequest(`session:${ip}`, CA_RATE_LIMITS.session);
 */
export function allowRequest(key, { limit, windowMs }, now = Date.now()) {
  ensureSweeper();
  const current = buckets.get(key);
  if (!current || current.windowEndsAt <= now) {
    buckets.set(key, { windowEndsAt: now + windowMs, count: 1 });
    return { allowed: true, remaining: Math.max(limit - 1, 0), retryAfterMs: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(current.windowEndsAt - now, 0) };
  }
  current.count += 1;
  buckets.set(key, current);
  return { allowed: true, remaining: Math.max(limit - current.count, 0), retryAfterMs: 0 };
}

/** 客户端 IP：与 server/index.js:11694 getEcardClientIp 同口径（Apache 反代后取 X-Forwarded-For 首段） */
export function getClientIp(request) {
  const forwardedFor = String(request?.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const realIp = String(request?.headers?.["x-real-ip"] || "").trim();
  const cfIp = String(request?.headers?.["cf-connecting-ip"] || "").trim();
  const fallback = String(request?.ip || request?.socket?.remoteAddress || "").trim();
  return forwardedFor || realIp || cfIp || fallback || "unknown";
}

/** 限流命中时的统一响应（与项目既有风格一致：429 + code） */
export function rateLimitedResponse(response, retryAfterMs, message = "操作过于频繁，请稍后再试") {
  const retryAfterSec = Math.max(Math.ceil(retryAfterMs / 1000), 1);
  return response
    .status(429)
    .set("Retry-After", String(retryAfterSec))
    .json({ success: false, code: "RATE_LIMITED", message });
}

/** 仅测试用：清空计数与定时器 */
export function __resetRateLimitStoreForTest() {
  buckets.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
