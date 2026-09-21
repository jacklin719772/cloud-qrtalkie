/**
 * Customer Assistant（ECard 访客聊天）——推送通知（访客消息 → 客服设备）。
 *
 * 规格来源：docs/customer-assistant/10_ECARD_VISITOR_CHAT_SOLUTION.md §9
 *   §9.1 触发链：访客消息 COMMIT → ca_conversations.sip_user_id → 目标设备 → 复用 pushGatewayService 发送端 → 写 push_events
 *   §9.2 leading-edge：**首条立即推送**；同一会话 10s 窗口内不重复推送（只累计 unread）；
 *        窗口**按会话隔离**；**主人已读该会话 → 窗口重置**；主人前台正在看（WS 在线且已读到最新）→ 不推送
 *   §9.3 payload：{ type:"ca_message", conversationId, visitorId, preview, unread, ts }；APNs 用 apns-collapse-id 折叠
 *
 * 目标解析（**两源并集**，因为同一 SIP 账号允许多台设备同时注册，必须全部推送）：
 *   ① `push_devices`（Android 上报：用于**逐设备**决定走 Google/FCM 还是极光 JPush）
 *   ② **Flexisip 注册信息**（Redis registrar；iOS 不上报 SaaS，token 在 pn-prid 里）
 *   ③ 逐设备按类型定通道：ios→apns（pn-provider 的 .dev/.prod 决定沙箱/生产）、android→fcm/jpush
 *   ④ 去重口径 (channel, token)；桌面端无推送通道（只有 WS/前台提示），不会出现在目标里
 *
 * 单实例假设（§8.2）：leading-edge 窗口在内存中；多实例下会退化为"每节点一份窗口"（重复推送），
 * 迁移目标为 Redis 键 + TTL。
 */

import { randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { createProvider, getGatewayConfig } from "../pushGatewayService.js";
import { readRegistrarKeys, RedisReadOnlyError } from "../redisClient.js";
import { isAgentAvailable } from "./realtimeHub.js";

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** leading-edge 窗口：conversationId → { lastPushAt, readSeqAtPush } */
const pushWindows = new Map();

export function __resetPushWindowsForTest() {
  pushWindows.clear();
}

/* ------------------------------------------------------------------ *
 * 目标解析
 * ------------------------------------------------------------------ */

function normalizeChannel(providerValue, platform) {
  const provider = String(providerValue || "").toLowerCase();
  if (platform === "ios" || provider.startsWith("apns")) return "apns";
  if (provider === "jpush" || provider === "jiguang") return "jpush";
  if (provider === "fcm" || provider === "google") return "fcm";
  return platform === "android" ? "fcm" : "apns";
}

/** ① push_devices：Android 上报的设备（token + 通道偏好） */
async function resolveFromPushDevices(connection, { sipUsername, sipDomain }) {
  const rows = await connection.query(
    `SELECT id, platform, provider, preferred_push_provider,
            token, apns_token, voip_token, fcm_token, jpush_registration_id
       FROM push_devices
      WHERE sip_username = ? AND (sip_domain = ? OR sip_domain = '') AND enabled = 1`,
    [sipUsername, sipDomain],
  );
  const targets = [];
  for (const row of rows) {
    const platform = String(row.platform || "").toLowerCase();
    const channel = normalizeChannel(row.preferred_push_provider || row.provider, platform);
    const token =
      channel === "apns"
        ? String(row.apns_token || row.token || "").trim() // 消息用 alert token，不用 voip_token
        : channel === "jpush"
          ? String(row.jpush_registration_id || row.token || "").trim()
          : String(row.fcm_token || row.token || "").trim();
    if (!token) continue;
    targets.push({ channel, token, source: "push_devices", deviceId: Number(row.id), platform });
  }
  return targets;
}

/** Contact 头里的 RFC8599 push 参数（pn-provider / pn-param / pn-prid） */
function parsePushParamsFromContact(contactValue) {
  // 注意：pn-prid 的多令牌用 `&` 连接（"<token>:voip&<token>:remote"），
  // 因此取值时**不能**把 `&` 当终止符，否则只会拿到第一条（voip）。
  const pick = (name) => {
    const raw = String(contactValue || "");
    const idx = raw.toLowerCase().indexOf(`${name.toLowerCase()}=`);
    if (idx < 0) return "";
    let rest = raw.slice(idx + name.length + 1);
    const end = rest.search(/[;?]/); // 值里允许 &（多令牌/多服务），只以 ; 或 ? 结束
    if (end >= 0) rest = rest.slice(0, end);
    return rest.replace(/^"|"$/g, "").trim();
  };
  const provider = pick("pn-provider");
  const param = pick("pn-param");
  const prid = pick("pn-prid");
  if (!param && !prid) return null;
  // pn-prid 形如 "<token>:voip&<token>:remote"；消息推送取 remote（无则取唯一一条）
  const parts = prid
    .split("&")
    .map((piece) => {
      const idx = piece.lastIndexOf(":");
      return idx > 0 ? { token: piece.slice(0, idx).trim(), service: piece.slice(idx + 1).trim() } : { token: piece.trim(), service: "" };
    })
    .filter((p) => p.token);
  if (!parts.length) return null;
  const chosen = parts.find((p) => p.service === "remote") || parts[0];
  return { provider, param, token: chosen.token, service: chosen.service, services: parts.map((p) => p.service) };
}

/** ② Flexisip 注册信息：iOS（不上报 push_devices）与未上报的 Android 都在这里 */
async function resolveFromFlexisipRegistrar({ sipUsername, sipDomain }) {
  const key = `fs:${sipUsername}@${sipDomain}`;
  let entries = [];
  try {
    const results = await readRegistrarKeys([key]);
    entries = results.get(key)?.entries || [];
  } catch (error) {
    if (error instanceof RedisReadOnlyError) {
      console.warn("[customerAssistant][push] 读取 Flexisip 注册信息失败:", error.message);
      return [];
    }
    throw error;
  }

  const targets = [];
  for (const entry of entries) {
    const parsed = parsePushParamsFromContact(String(entry?.value || ""));
    if (!parsed || !parsed.token) continue;
    const provider = parsed.provider.toLowerCase();
    const isApns = provider.startsWith("apns");
    targets.push({
      channel: isApns ? "apns" : normalizeChannel(provider, ""),
      token: parsed.token,
      provider,
      service: parsed.service,
      source: "flexisip",
      // apns.dev=开发构建 → 沙箱端点；apns=发布构建 → 生产端点（与推送网关的环境判定口径一致）
      appId: `com.qrtalkie.qrtalkie.remote${provider.endsWith(".dev") ? ".dev" : ".prod"}`,
    });
  }
  return targets;
}

/**
 * 目标 = **两源并集**（同一 SIP 账号可多设备同时注册，必须全部推送）：
 *   ① push_devices（Android 上报，用于逐设备决定 FCM/JPush 通道）
 *   ② Flexisip 注册信息（iOS 不上报 SaaS，注册项里带 pn-prid）
 * 混用场景（如 Android 已上报 + iOS 只在 Flexisip）必须两边都推，因此**不能**用"有空则回退"。
 * 去重口径：(channel, token) —— 同一设备在两会话源出现时只推一次。
 * 桌面端没有推送通道（无 FCM/APNs，只有 WS/前台提示），解析结果里自然不会出现。
 */
export async function resolvePushTargets(connection, { sipUsername, sipDomain }) {
  const [fromDevices, fromRegistrar] = await Promise.all([
    resolveFromPushDevices(connection, { sipUsername, sipDomain }),
    resolveFromFlexisipRegistrar({ sipUsername, sipDomain }),
  ]);

  // 去重按 **token**（而非 通道+token）：同一台设备可能同时出现在两处，
  // 且两处声明的通道未必一致（Android 在 push_devices 里按设备能力声明 jpush/fcm，
  // 而 SIP 注册里的 pn-provider 可能写死为 fcm）。以 push_devices 为准（先入列、不被覆盖），
  // 否则会用同一个 token 在两个通道各推一次，其中一个必然失败。
  const seenTokens = new Set();
  const merged = [];
  for (const target of [...fromDevices, ...fromRegistrar]) {
    if (!target?.token) continue;
    if (seenTokens.has(target.token)) continue;
    seenTokens.add(target.token);
    merged.push(target);
  }
  return merged;
}

/* ------------------------------------------------------------------ *
 * 通知主流程
 * ------------------------------------------------------------------ */

/**
 * 访客消息落库（COMMIT）后调用。
 * 返回 { skipped?: string, sent?: number, failed?: number, targets?: number }
 */
export async function notifyVisitorMessage({ conversation, message, liveTest = process.env.CA_PUSH_LIVE !== "false", force = false, now = Date.now() }) {
  if (!conversation?.id || !message) return { skipped: "bad_input" };
  if (String(message.senderType || "") !== "visitor") return { skipped: "not_visitor_message" };

  const connection = await pool.getConnection();
  try {
    const rows = await connection.query(
      `SELECT c.id, c.public_id, c.sip_user_id, c.agent_last_read_seq, c.unread_for_agent,
              v.public_id AS visitor_public_id, v.display_name AS visitor_display_name,
              su.username AS sip_username, su.sip_domain,
              s.notify_enabled, s.display_name AS agent_display_name
         FROM ca_conversations c
         JOIN ca_visitors v ON v.id = c.visitor_id
         LEFT JOIN sip_users su ON su.id = c.sip_user_id
         LEFT JOIN ca_ecard_settings s ON s.ecard_id = c.ecard_id
        WHERE c.id = ? LIMIT 1`,
      [conversation.id],
    );
    const row = rows[0];
    if (!row) return { skipped: "conversation_not_found" };
    if (row.notify_enabled !== null && Number(row.notify_enabled) === 0) return { skipped: "notify_disabled" };
    if (!row.sip_username || !row.sip_domain) return { skipped: "owner_missing" };

    const agentLastReadSeq = Number(row.agent_last_read_seq || 0);
    // 主人正在前台看该会话（WS 在线且已读到这条之前）→ 不推送
    if (!force && isAgentAvailable(row.sip_user_id) && agentLastReadSeq >= Number(message.seq) - 1) {
      return { skipped: "agent_watching" };
    }

    // leading-edge：窗口内不重复推送；主人已读（游标前移）即视为窗口重置
    const window = pushWindows.get(Number(conversation.id));
    if (!force && window && now - window.lastPushAt < positiveNumber(process.env.CA_PUSH_WINDOW_SECONDS, 10) * 1000) {
      if (agentLastReadSeq <= window.readSeqAtPush) return { skipped: "window_throttled" };
    }

    const targets = await resolvePushTargets(connection, { sipUsername: row.sip_username, sipDomain: row.sip_domain });
    if (!targets.length) return { skipped: "no_targets" };

    const config = getGatewayConfig();
    // 通知文案「去内容化」：只告知"有访客消息"，不带消息正文（避免被判营销推送封禁）
    const visitorName = String(row.visitor_display_name || "").trim();
    const caMessage = {
      title: "访客消息",
      body: visitorName ? `访客${visitorName}给您发送了一条消息` : "有访客给您发送了一条消息",
      conversationId: row.public_id,
      visitorId: row.visitor_public_id,
      unread: Number(row.unread_for_agent || 0),
      ts: new Date().toISOString(),
    };

    let sent = 0;
    let failed = 0;
    for (const target of targets) {
      let provider;
      try {
        provider = createProvider(target.channel, "message", config);
      } catch (error) {
        failed += 1;
        console.warn(`[customerAssistant][push] 通道不可用 ${target.channel}:`, error?.message || error);
        continue;
      }
      const result = await provider.send({
        liveTest,
        device: { sip_username: row.sip_username, sip_domain: row.sip_domain, provider: target.channel },
        tokenValue: target.token,
        event: "message",
        toUri: `sip:${row.sip_username}@${row.sip_domain}`,
        appId: target.appId,
        collapseId: `ca-${row.public_id}`,
        caMessage,
        // 通知模式：厂商通道（华为）只能投递通知消息；透传在后台必被系统杀
        jpush_payload_mode: "notification",
      });
      if (result.ok && result.status !== "skipped") sent += 1;
      else if (!result.ok) failed += 1;

      await connection.query(
        `INSERT INTO push_events (push_id, event, provider, sip_user, to_uri, msgid, status, error_code, provider_response, payload_summary)
         VALUES (?, 'ca_message', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          target.channel,
          `${row.sip_username}@${row.sip_domain}`,
          `sip:${row.sip_username}@${row.sip_domain}`,
          `ca:${message.id}`,
          result.status || (result.ok ? "sent" : "failed"),
          result.errorCode || "",
          JSON.stringify(result.providerResponse || {}).slice(0, 60000),
          JSON.stringify({ source: target.source, service: target.service || null, conversationId: row.public_id, liveTest, unread: caMessage.unread }).slice(0, 60000),
        ],
      );
    }

    pushWindows.set(Number(conversation.id), { lastPushAt: now, readSeqAtPush: agentLastReadSeq });
    return { sent, failed, targets: targets.length, liveTest };
  } catch (error) {
    console.error("[customerAssistant][push] notify 失败:", error?.message || error);
    return { skipped: "error", error: String(error?.message || error) };
  } finally {
    connection.release();
  }
}
