/**
 * Web meet —— 发起会议（生成会议链接）。
 *
 * 端点：POST /api/google-meet/spaces（客服侧，requireSipUser）→ 返回会议链接。
 * 响应结构与旧版一致：{ success:true, meeting:{ name, meetingCode, meetingUri } } —— 三端 App 无需改动。
 *
 * Provider（环境变量 MEET_PROVIDER，默认 jitsi）：
 * - jitsi ：生成 meet.jit.si 随机房间链接（默认）。客户零账号零安装：点开链接即在浏览器进会。
 *           注意 meet.jit.si 为 8x8 公共服：新会议需「主持人先登录开房」，客服流程 = 先在电脑上
 *           打开链接登录开房，再发链接给客户。链接参数：禁深链跳 App、跳过 prejoin、预填显示名。
 * - google：原有 Google Meet 路径（OAuth refresh_token，2026-10-12 已修复不再 7 天过期），保留备用。
 *
 * 纪律：独立模块，对既有路由只增不改（与 customerAssistant/routes.js 同规则）。
 */
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const OAUTH_FILE = process.env.GOOGLE_MEET_OAUTH_FILE || "/etc/qrtalkie/google-meet-oauth.json";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SPACES_ENDPOINT = "https://meet.googleapis.com/v2/spaces";
const JITSI_DOMAIN = process.env.JITSI_DOMAIN || "meet.jit.si";
const JITSI_DISPLAY_NAME = process.env.JITSI_DISPLAY_NAME || "访客";

let cachedCredentials = null;
let cachedAccessToken = null; // { token, expiresAt }
let inflightTokenPromise = null; // 并发请求共用同一次换 token 的 Promise

function fail(response, status, code, message) {
  return response.status(status).json({ success: false, code, message });
}
function ok(response, payload = {}) {
  return response.json({ success: true, ...payload });
}

/** 生成 Jitsi 房间会议（默认 provider）：
    房间名随机不可猜；参数关闭「跳转 Jitsi App」的深链、跳过 prejoin 姓名页并预填显示名，
    客户点开即进浏览器会议（自建服务器同样适用，改 JITSI_DOMAIN 即可）。 */
function createJitsiMeeting() {
  const room = "QRTalkie-" + randomBytes(8).toString("hex");
  const params = [
    "config.disableDeepLinking=true",
    "config.prejoinPageEnabled=false",
    "config.prejoinConfig.enabled=false",
    `userInfo.displayName=${encodeURIComponent(JITSI_DISPLAY_NAME)}`,
  ].join("&");
  return {
    name: room,
    meetingCode: room,
    meetingUri: `https://${JITSI_DOMAIN}/${room}#${params}`,
  };
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

  // 发起 Web meet：调用方拿到 meetingUri 后自行发一条链接消息
  app.post("/api/google-meet/spaces", requireSipUser, async (request, response) => {
    try {
      const provider = (process.env.MEET_PROVIDER || "jitsi").toLowerCase();
      const meeting = provider === "google" ? await createMeetingSpace() : createJitsiMeeting();
      console.log(`[web-meet] sipUser=${request.admin?.id} 创建会议 ${meeting.meetingCode}（${provider}）`);
      return ok(response, { meeting });
    } catch (error) {
      console.error("[web-meet] 创建会议失败:", error?.message || error);
      return fail(response, 502, "GOOGLE_MEET_FAILED", String(error?.message || error));
    }
  });
}
