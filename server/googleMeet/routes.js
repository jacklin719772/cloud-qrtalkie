/**
 * Google Meet —— 发起会议（生成会议链接）。
 *
 * 端点：POST /api/google-meet/spaces（客服侧，requireSipUser）→ 创建一个 Meet 空间并返回链接。
 * 凭据：/etc/qrtalkie/google-meet-oauth.json（client_id / client_secret / refresh_token，
 *      由一次性 OAuth 授权取得；当前为「外部+测试」模式，refresh_token 7 天过期，需重新授权）。
 * 机制：refresh_token 换 access_token 并做进程内缓存（并发去重），再调用 Meet API。
 * 纪律：独立模块，对既有路由只增不改（与 customerAssistant/routes.js 同规则）。
 */
import { readFile } from "node:fs/promises";

const OAUTH_FILE = process.env.GOOGLE_MEET_OAUTH_FILE || "/etc/qrtalkie/google-meet-oauth.json";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SPACES_ENDPOINT = "https://meet.googleapis.com/v2/spaces";

let cachedCredentials = null;
let cachedAccessToken = null; // { token, expiresAt }
let inflightTokenPromise = null; // 并发请求共用同一次换 token 的 Promise

function fail(response, status, code, message) {
  return response.status(status).json({ success: false, code, message });
}
function ok(response, payload = {}) {
  return response.json({ success: true, ...payload });
}

async function loadCredentials() {
  if (cachedCredentials) return cachedCredentials;
  const raw = await readFile(OAUTH_FILE, "utf8");
  const parsed = JSON.parse(raw);
  for (const key of ["client_id", "client_secret", "refresh_token"]) {
    if (!parsed[key]) throw new Error(`凭据文件缺少 ${key}：${OAUTH_FILE}`);
  }
  cachedCredentials = parsed;
  return cachedCredentials;
}

async function requestAccessToken() {
  const credentials = await loadCredentials();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      refresh_token: credentials.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `换 token 失败（HTTP ${response.status}）`);
  }
  // 提前 60 秒视为过期，避免用临界 token
  const ttlMs = Math.max(60, Number(payload.expires_in || 3600) - 60) * 1000;
  return { token: payload.access_token, expiresAt: Date.now() + ttlMs };
}

async function getAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) return cachedAccessToken.token;
  if (!inflightTokenPromise) {
    inflightTokenPromise = requestAccessToken()
      .then((fresh) => {
        cachedAccessToken = fresh;
        return fresh.token;
      })
      .finally(() => {
        inflightTokenPromise = null;
      });
  }
  return inflightTokenPromise;
}

/** 创建一个 Google Meet 空间，返回 { name, meetingCode, meetingUri }
    accessType 必须显式 OPEN：默认 TRUSTED 只放行创建者组织内成员，
    个人 Gmail 授权时外部人会被拒（实测报「You can't join this video call」）。 */
async function createMeetingSpace() {
  const token = await getAccessToken();
  const response = await fetch(SPACES_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ config: { accessType: "OPEN" } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.meetingUri) {
    if (response.status === 401) cachedAccessToken = null; // 缓存的 token 已失效，下轮重取
    throw new Error(payload?.error?.message || `创建 Meet 失败（HTTP ${response.status}）`);
  }
  return { name: payload.name, meetingCode: payload.meetingCode, meetingUri: payload.meetingUri };
}

export function registerGoogleMeetRoutes(app, { requireSipUser } = {}) {
  if (typeof requireSipUser !== "function") {
    throw new Error("registerGoogleMeetRoutes 需要 requireSipUser 中间件");
  }

  // 发起 Google Meet：调用方拿到 meetingUri 后自行发一条链接消息
  app.post("/api/google-meet/spaces", requireSipUser, async (request, response) => {
    try {
      const meeting = await createMeetingSpace();
      console.log(`[google-meet] sipUser=${request.admin?.id} 创建会议 ${meeting.meetingCode}`);
      return ok(response, { meeting });
    } catch (error) {
      console.error("[google-meet] 创建会议失败:", error?.message || error);
      return fail(response, 502, "GOOGLE_MEET_FAILED", String(error?.message || error));
    }
  });
}
