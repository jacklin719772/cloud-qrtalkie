/**
 * Customer Assistant 验收脚本（收编自 P1 实施期临时脚本）
 *
 * ⚠️ 会写入并清理测试数据（跑完核对 0 残留），需要连接到 CA 所在的数据库与本地 SaaS（127.0.0.1:3001）。
 * 夹具（环境变量，默认取 ecard 20 / 账号 30010001 —— 仅适用于本项目测试环境）：
 *   CA_TEST_SLUG / CA_TEST_ECARD_ID / CA_TEST_SIP_USER_ID
 * 运行：cd <repo> && sudo node scripts/ca-push-dryrun.mjs
 */
import { pool } from "../server/db.js";
import * as sessions from "../server/customerAssistant/sessionService.js";
import * as convs from "../server/customerAssistant/conversationService.js";
import * as msgs from "../server/customerAssistant/messageService.js";
import { newPublicId } from "../server/customerAssistant/ids.js";
import {
  resolvePushTargets,
  notifyVisitorMessage,
  __resetPushWindowsForTest,
} from "../server/customerAssistant/pushNotifier.js";
import { issueTicket, __statsForTest } from "../server/customerAssistant/realtimeHub.js";
import WebSocket from "ws";
import { createHash, randomBytes } from "node:crypto";

const BASE = "http://127.0.0.1:3001";
async function httpReq(method, path, { token } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  let json = null; try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

const ECARD_ID = Number(process.env.CA_TEST_ECARD_ID || 20);
const SIP_USER_ID = Number(process.env.CA_TEST_SIP_USER_ID || 28);
const WS_BASE = "ws://127.0.0.1:3001";

const results = [];
const check = (name, cond, extra) => {
  results.push(Boolean(cond));
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${extra !== undefined ? "  → " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conn = await pool.getConnection();
let visitorId = null;
let visitorPublicId = null;
let conversationId = null;
let agentSocket = null;
let agentSessionId = null;
const createdPushEventMsgIds = [];

try {
  __resetPushWindowsForTest();
  await conn.query(
    `INSERT INTO ca_ecard_settings (ecard_id, enabled, notify_enabled, display_name) VALUES (?, 1, 1, ?)`,
    [ECARD_ID, "30010001 客服"],
  );

  // ---------- 目标解析 ----------
  const targets = await resolvePushTargets(conn, { sipUsername: "30010001", sipDomain: "sip.qrtalkie.org" });
  check("目标解析：30010001 未在 push_devices 登记 → 回退 Flexisip 注册", targets.length >= 1 && targets.every((t) => t.source === "flexisip"), `targets=${targets.length} source=${targets[0]?.source}`);
  check("按设备类型选通道：apns + 令牌来自 pn-prid(:remote)", targets[0]?.channel === "apns" && targets[0]?.token?.length > 20, `channel=${targets[0]?.channel} tokenLen=${targets[0]?.token?.length}`);
  check("环境判定：开发构建（apns.dev）→ appId 带 .dev（走沙箱端点）", String(targets[0]?.appId || "").endsWith(".dev"), targets[0]?.appId);

  // ---------- 两源并集（Android 已上报 + iOS 只在 Flexisip）----------
  await conn.query(
    `INSERT INTO push_devices (device_key, device_id, sip_username, sip_domain, sip_instance, app_region,
                               package_name, manufacturer, preferred_push_provider, platform, provider,
                               jpush_registration_id, last_seen_ip, last_seen_country, app_version, device_model, os_version, enabled)
     VALUES ('ca-e2e-union', 'ca-e2e-union', '30010001', 'sip.qrtalkie.org', 'default', 'china',
             'com.qrtalkie.qrtalkie', 'Xiaomi', 'jpush', 'android', 'jpush',
             'FAKE_JPUSH_REGID_CA', '', '', 'e2e', 'e2e', 'e2e', 1)`,
  );
  const unionTargets = await resolvePushTargets(conn, { sipUsername: "30010001", sipDomain: "sip.qrtalkie.org" });
  check("两源并集：Flexisip 的 iOS(apns) 与 push_devices 的 Android(jpush) 同时入列",
    unionTargets.some((t) => t.channel === "apns") && unionTargets.some((t) => t.source === "push_devices" && t.channel === "jpush"),
    unionTargets.map((t) => `${t.source}/${t.channel}`).join(", "));
  await conn.query("DELETE FROM push_devices WHERE device_key = 'ca-e2e-union'");

  // ---------- 造会话与访客消息 ----------
  visitorPublicId = newPublicId("vis");
  const vis = await conn.query(
    `INSERT INTO ca_visitors (ecard_id, public_id, display_name) VALUES (?, ?, ?)`,
    [ECARD_ID, visitorPublicId, "CA-PUSH-TEST"],
  );
  visitorId = Number(vis.insertId);
  const ensured = await convs.ensureConversation(conn, { ecardId: ECARD_ID, visitorId, sipUserId: SIP_USER_ID });
  conversationId = ensured.conversationId;
  const m1 = await msgs.appendMessage(conn, { conversationId, senderType: "visitor", content: "價格多少？", clientMsgId: "push-1" });

  // ---------- 首条：窗口为空 → 尝试推送（干跑）----------
  const t0 = Date.now();
  const first = await notifyVisitorMessage({ conversation: { id: conversationId, publicId: ensured.publicId }, message: m1.message, liveTest: false, now: t0 });
  check("首条访客消息 → 立即尝试推送（干跑）", first.targets >= 1 && first.sent === 0 && first.liveTest === false, JSON.stringify(first));
  createdPushEventMsgIds.push(`ca:${m1.message.id}`);

  const logged = await conn.query(`SELECT provider, status, event, provider_response FROM push_events WHERE msgid = ?`, [`ca:${m1.message.id}`]);
  check("写入 push_events（每个目标一行，event='ca_message'）",
    logged.length === first.targets && logged.every((r) => r.event === "ca_message" && r.provider === "apns"),
    `rows=${logged.length} targets=${first.targets} status=${logged[0]?.status}`);
  const descriptor = JSON.parse(logged[0]?.provider_response || "{}");
  check("干跑 descriptor 为消息类推送且 topic 指向 qrtalkie",
    ["remote", "message"].includes(descriptor.push_kind) && String(descriptor.bundle_id || "").includes("qrtalkie"),
    `kind=${descriptor.push_kind} bundle=${descriptor.bundle_id}`);

  // ---------- 窗口内第二条：不推送 ----------
  const m2 = await msgs.appendMessage(conn, { conversationId, senderType: "visitor", content: "在嗎？", clientMsgId: "push-2" });
  const second = await notifyVisitorMessage({ conversation: { id: conversationId, publicId: ensured.publicId }, message: m2.message, liveTest: false, now: t0 + 2000 });
  check("10s 窗口内的第二条 → 不推送（仅累计 unread）", second.skipped === "window_throttled", JSON.stringify(second));
  const unreadRow = await conn.query(`SELECT unread_for_agent FROM ca_conversations WHERE id = ?`, [conversationId]);
  check("未读已累计为 2", Number(unreadRow[0].unread_for_agent) === 2, `unread=${unreadRow[0].unread_for_agent}`);

  // ---------- 窗口过后：再推 ----------
  const third = await notifyVisitorMessage({ conversation: { id: conversationId, publicId: ensured.publicId }, message: m2.message, liveTest: false, now: t0 + 11000 });
  check("窗口过后（>10s）→ 再次尝试推送", third.targets >= 1, JSON.stringify(third));
  createdPushEventMsgIds.push(`ca:${m2.message.id}`);

  // ---------- 主人已读 → 窗口重置（立即再推）----------
  await convs.markRead(conn, conversationId, "agent", m2.message.seq);
  const m3 = await msgs.appendMessage(conn, { conversationId, senderType: "visitor", content: "第三條", clientMsgId: "push-3" });
  const afterRead = await notifyVisitorMessage({ conversation: { id: conversationId, publicId: ensured.publicId }, message: m3.message, liveTest: false, now: t0 + 12000 });
  check("主人已读后窗口重置 → 立即再推", afterRead.targets >= 1, JSON.stringify(afterRead));
  createdPushEventMsgIds.push(`ca:${m3.message.id}`);

  // ---------- 主人前台正在查看（Agent WS 在线且已读到最新）→ 不推 ----------
  const agentToken = randomBytes(32).toString("hex");
  const agentSession = await conn.query(
    `INSERT INTO admin_sessions (admin_user_id, user_type, sip_user_id, token_hash, expires_at, device) VALUES (NULL, 'sip', ?, ?, NOW() + INTERVAL 1 HOUR, 'ca-e2e')`,
    [SIP_USER_ID, createHash("sha256").update(agentToken).digest("hex")],
  );
  agentSessionId = Number(agentSession.insertId);
  const ticketResp = await httpReq("GET", "/api/visitor-assistant/ticket", { token: agentToken });
  check("A9 通过 HTTP 签发客服 ticket", ticketResp.status === 200 && !!ticketResp.json?.ticket);
  agentSocket = new WebSocket(`${WS_BASE}/ca/ws?ticket=${encodeURIComponent(ticketResp.json.ticket)}`);
  await new Promise((resolve, reject) => {
    agentSocket.once("open", resolve);
    agentSocket.once("error", reject);
  });
  await sleep(200);
  await convs.markRead(conn, conversationId, "agent", m3.message.seq);
  const m4 = await msgs.appendMessage(conn, { conversationId, senderType: "visitor", content: "第四條", clientMsgId: "push-4" });
  const watching = await notifyVisitorMessage({ conversation: { id: conversationId, publicId: ensured.publicId }, message: m4.message, liveTest: false, now: t0 + 60000 });
  createdPushEventMsgIds.push(`ca:${m4.message.id}`);
  // 说明：脚本进程与服务进程的模块实例相互隔离（agentSockets 注册在服务进程内），
  // 因此 "主人前台正在查看 → 不推送" 无法用本脚本直调验证；该分支将在 P2 接入 App（真实 Agent WS）后，
  // 由「服务端 V3 触发 + 断言无 push_events 行」的方式覆盖。此处仅断言两个前置条件成立：
  check("前置：Agent WS 已连接（服务进程中已注册；agent_watching 分支留待 P2 用服务端触发方式复验）",
    agentSocket?.readyState === 1,
    `readyState=${agentSocket?.readyState}`);

  // ---------- 主人下线后 → 恢复推送 ----------
  agentSocket.close();
  agentSocket = null;
  await sleep(300);
  const m5 = await msgs.appendMessage(conn, { conversationId, senderType: "visitor", content: "第五條", clientMsgId: "push-5" });
  const afterOffline = await notifyVisitorMessage({ conversation: { id: conversationId, publicId: ensured.publicId }, message: m5.message, liveTest: false, now: t0 + 70000 });
  check("主人下线后恢复推送", afterOffline.targets >= 1, JSON.stringify(afterOffline));
  createdPushEventMsgIds.push(`ca:${m5.message.id}`);

  // ---------- notify_enabled=0 → 不推 ----------
  await conn.query(`UPDATE ca_ecard_settings SET notify_enabled = 0 WHERE ecard_id = ?`, [ECARD_ID]);
  const m6 = await msgs.appendMessage(conn, { conversationId, senderType: "visitor", content: "第六條", clientMsgId: "push-6" });
  const disabled = await notifyVisitorMessage({ conversation: { id: conversationId, publicId: ensured.publicId }, message: m6.message, liveTest: false, now: t0 + 200000 });
  check("notify_enabled=0 → 不推送", disabled.skipped === "notify_disabled", JSON.stringify(disabled));
} catch (error) {
  console.log(`ERROR | ${error?.message || error}`);
  results.push(false);
} finally {
  try { if (agentSocket) agentSocket.close(); } catch { /* ignore */ }
  await sleep(150);
  try {
    if (visitorPublicId) await conn.query(`DELETE FROM ca_visitors WHERE ecard_id = ? AND public_id = ?`, [ECARD_ID, visitorPublicId]);
    for (const msgid of createdPushEventMsgIds) await conn.query(`DELETE FROM push_events WHERE msgid = ?`, [msgid]);
    await conn.query(`DELETE FROM push_events WHERE event = 'ca_message'`);
    if (agentSessionId) await conn.query(`DELETE FROM admin_sessions WHERE id = ?`, [agentSessionId]);
    await conn.query(`DELETE FROM ca_ecard_settings WHERE ecard_id = ?`, [ECARD_ID]);
    const left = await conn.query(
      `SELECT (SELECT COUNT(*) FROM ca_visitors) visitors, (SELECT COUNT(*) FROM ca_conversations) conversations,
              (SELECT COUNT(*) FROM ca_messages) messages, (SELECT COUNT(*) FROM ca_ecard_settings) settings,
              (SELECT COUNT(*) FROM push_events WHERE event='ca_message') ca_push_events`,
    );
    const l = left[0];
    console.log(`\n# 清理核对：visitors=${l.visitors} conversations=${l.conversations} messages=${l.messages} settings=${l.settings} ca_push_events=${l.ca_push_events}`);
    check("测试数据已清理干净（0 残留）", Object.values(l).every((n) => Number(n) === 0));
    console.log(`# realtimeHub 统计：${JSON.stringify(__statsForTest())}`);
  } catch (cleanupError) {
    console.log(`CLEANUP ERROR | ${cleanupError?.message || cleanupError}`);
    results.push(false);
  }
  conn.release();
  const failed = results.filter((r) => !r).length;
  console.log(`\n===== 结果：${results.length - failed}/${results.length} 通过 =====`);
  process.exit(failed === 0 ? 0 : 1);
}
