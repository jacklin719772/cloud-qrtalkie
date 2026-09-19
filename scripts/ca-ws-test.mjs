/**
 * Customer Assistant 验收脚本（收编自 P1 实施期临时脚本）
 *
 * ⚠️ 会写入并清理测试数据（跑完核对 0 残留），需要连接到 CA 所在的数据库与本地 SaaS（127.0.0.1:3001）。
 * 夹具（环境变量，默认取 ecard 20 / 账号 30010001 —— 仅适用于本项目测试环境）：
 *   CA_TEST_SLUG / CA_TEST_ECARD_ID / CA_TEST_SIP_USER_ID
 * 运行：cd <repo> && sudo node scripts/ca-ws-test.mjs
 */
import { pool } from "../server/db.js";
import { createHash, randomBytes } from "node:crypto";
import WebSocket from "ws";

const BASE = "http://127.0.0.1:3001";
const WS_BASE = "ws://127.0.0.1:3001";
const SLUG = process.env.CA_TEST_SLUG || "ec-28-ffx9i5";
const ECARD_ID = Number(process.env.CA_TEST_ECARD_ID || 20);
const SIP_USER_ID = Number(process.env.CA_TEST_SIP_USER_ID || 28);

const results = [];
const check = (name, cond, extra) => {
  results.push(Boolean(cond));
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${extra !== undefined ? "  → " + extra : ""}`);
};

async function req(method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

function connect(pathWithTicket) {
  const ws = new WebSocket(WS_BASE + pathWithTicket);
  ws.caFrames = [];
  ws.on("message", (raw) => {
    try { ws.caFrames.push(JSON.parse(String(raw))); } catch { /* ignore */ }
  });
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
    ws.once("unexpected-response", (_r, res) => reject(new Error(`unexpected-response ${res.statusCode}`)));
  });
}

function waitForFrame(ws, type, timeoutMs = 4000) {
  const existing = ws.caFrames.find((f) => f.type === type);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), timeoutMs);
    const onMessage = () => {
      const found = ws.caFrames.find((f) => f.type === type);
      if (found) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(found);
      }
    };
    ws.on("message", onMessage);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const closeAll = (...sockets) => sockets.filter(Boolean).forEach((ws) => { try { ws.close(); } catch { /* ignore */ } });

const conn = await pool.getConnection();
let visitorPublicId = null;
let agentSessionId = null;
const extraVisitors = [];
let visitorSocket = null;
let agentSocket = null;
let ticketReuseSocket = null;

try {
  // ---------- setup ----------
  await conn.query(
    `INSERT INTO ca_ecard_settings (ecard_id, enabled, welcome_message, display_name) VALUES (?, 1, ?, ?)`,
    [ECARD_ID, "您好，這裡是線上客服。", "30010001 客服"],
  );
  const agentToken = randomBytes(32).toString("hex");
  const ins = await conn.query(
    `INSERT INTO admin_sessions (admin_user_id, user_type, sip_user_id, token_hash, expires_at, device)
     VALUES (NULL, 'sip', ?, ?, NOW() + INTERVAL 1 HOUR, 'ca-e2e')`,
    [SIP_USER_ID, createHash("sha256").update(agentToken).digest("hex")],
  );
  agentSessionId = Number(ins.insertId);

  const v1 = await req("POST", `/api/ecard/public/${SLUG}/chat-session`, { body: {} });
  visitorPublicId = v1.json?.visitorId;
  const visitorToken = v1.json?.accessToken;
  const conversationId = v1.json?.conversationId;
  check("前置：V1 取票成功", v1.status === 200 && !!visitorToken && !!conversationId);
  check("前置：初始 agentStatus = unavailable（无 Agent WS）", v1.json?.agentStatus?.state === "unavailable", JSON.stringify(v1.json?.agentStatus));

  // ---------- V5 访客 ticket + 连接 ----------
  const v5 = await req("GET", `/api/ecard/public/${SLUG}/chat/ticket`, { token: visitorToken });
  check("V5 签发 ticket", v5.status === 200 && typeof v5.json?.ticket === "string" && v5.json?.wsPath === "/ca/ws");

  visitorSocket = await connect(`/ca/ws?ticket=${encodeURIComponent(v5.json.ticket)}`);
  const readyVisitor = await waitForFrame(visitorSocket, "ca.ready");
  check("访客 ca.ready 含自身会话与 lastSeq",
    readyVisitor.conv === conversationId && Number.isFinite(Number(readyVisitor.data?.lastSeq)),
    `conv=${readyVisitor.conv} lastSeq=${readyVisitor.data?.lastSeq}`);

  // ---------- ticket 一次性 ----------
  let reuseRejected = false;
  try {
    ticketReuseSocket = await connect(`/ca/ws?ticket=${encodeURIComponent(v5.json.ticket)}`);
    await sleep(300);
    reuseRejected = ticketReuseSocket.caFrames.some((f) => f.type === "ca.error" && f.data?.code === "TICKET_CONSUMED") ||
      ticketReuseSocket.readyState === WebSocket.CLOSED || ticketReuseSocket.readyState === WebSocket.CLOSING;
  } catch {
    reuseRejected = true; // 服务端直接关闭连接也算拒绝
  }
  check("同一 ticket 二次连接被拒（一次性消费）", reuseRejected);

  // ---------- 伪造 role 无效 ----------
  const v5b = await req("GET", `/api/ecard/public/${SLUG}/chat/ticket`, { token: visitorToken });
  const forged = await connect(`/ca/ws?ticket=${encodeURIComponent(v5b.json.ticket)}&role=agent`);
  const readyForged = await waitForFrame(forged, "ca.ready");
  check("客户端伪造 role=agent 无效（服务端按 ticket 判定为访客）", readyForged.conv === conversationId);

  // ---------- A9 客服 ticket + 连接（应广播 available）----------
  const a9 = await req("GET", "/api/visitor-assistant/ticket", { token: agentToken });
  check("A9 签发客服 ticket", a9.status === 200 && typeof a9.json?.ticket === "string");
  agentSocket = await connect(`/ca/ws?ticket=${encodeURIComponent(a9.json.ticket)}`);
  await waitForFrame(agentSocket, "ca.ready");
  const available = await waitForFrame(visitorSocket, "ca.agent.available");
  check("客服上线 → 访客收到 ca.agent.available", available.type === "ca.agent.available");

  // ---------- 双向消息事件 ----------
  visitorSocket.caFrames.length = 0;
  agentSocket.caFrames.length = 0;
  const v3 = await req("POST", `/api/ecard/public/${SLUG}/chat/messages`, { token: visitorToken, body: { clientMsgId: "ws-1", content: "訪客訊息（WS 測試）" } });
  const newToAgent = await waitForFrame(agentSocket, "ca.message.new");
  const newToVisitor = await waitForFrame(visitorSocket, "ca.message.new");
  check("访客 REST 发消息 → 客服 WS 实时收到 ca.message.new",
    v3.status === 201 && newToAgent.data?.clientMsgId === "ws-1" && newToAgent.data?.senderType === "visitor" && Number(newToAgent.seq) === v3.json?.message?.seq);
  check("同一条消息也回显给访客连接的其它标签页", newToVisitor.data?.clientMsgId === "ws-1");

  visitorSocket.caFrames.length = 0;
  agentSocket.caFrames.length = 0;
  const a3 = await req("POST", `/api/visitor-assistant/conversations/${conversationId}/messages`, { token: agentToken, body: { clientMsgId: "ws-a1", content: "客服回覆（WS 測試）" } });
  const replyToVisitor = await waitForFrame(visitorSocket, "ca.message.new");
  const replyToAgent = await waitForFrame(agentSocket, "ca.message.new");
  check("客服 REST 回复 → 访客 WS 实时收到 ca.message.new",
    a3.status === 201 && replyToVisitor.data?.senderType === "agent" && /WS 測試/.test(replyToVisitor.data?.content || ""));
  check("客服自己的连接也收到回显", replyToAgent.data?.senderType === "agent");

  // ---------- typing 转发 ----------
  visitorSocket.caFrames.length = 0;
  agentSocket.send(JSON.stringify({ type: "ca.typing.start", conv: conversationId }));
  const typing = await waitForFrame(visitorSocket, "ca.typing.start");
  check("客服 typing.start → 访客收到 ca.typing.start", typing.data?.by === "agent");

  // ---------- 上行已读 ----------
  agentSocket.caFrames.length = 0;
  visitorSocket.send(JSON.stringify({ type: "ca.message.read", conv: conversationId, data: { uptoSeq: v3.json.message.seq } }));
  const readEvent = await waitForFrame(agentSocket, "ca.message.read");
  check("访客上行已读 → 客服收到 ca.message.read", readEvent.data?.by === "visitor");

  // ---------- ca.message.send 指引 ----------
  agentSocket.caFrames.length = 0;
  agentSocket.send(JSON.stringify({ type: "ca.message.send", conv: conversationId, data: { content: "x" } }));
  const guidance = await waitForFrame(agentSocket, "ca.error");
  check("WS 发消息被引导到 REST（USE_REST_SEND）", guidance.data?.code === "USE_REST_SEND");

  // ---------- 逐帧越权拦截 ----------
  agentSocket.caFrames.length = 0;
  agentSocket.send(JSON.stringify({ type: "ca.message.read", conv: "conv_ffffffffffffffffffffffffffffffff", data: { uptoSeq: 1 } }));
  const forbidden = await waitForFrame(agentSocket, "ca.error");
  check("越权访问他人会话被拦截（CONVERSATION_NOT_FOUND）", ["CONVERSATION_NOT_FOUND", "FORBIDDEN_CONVERSATION"].includes(forbidden.data?.code), forbidden.data?.code);

  // ---------- 客服下线 → 访客收到 unavailable ----------
  visitorSocket.caFrames.length = 0;
  closeAll(agentSocket);
  agentSocket = null;
  const unavailable = await waitForFrame(visitorSocket, "ca.agent.unavailable");
  check("客服下线 → 访客收到 ca.agent.unavailable", unavailable.type === "ca.agent.unavailable");
} catch (error) {
  console.log(`ERROR | ${error?.message || error}`);
  results.push(false);
} finally {
  closeAll(visitorSocket, agentSocket, ticketReuseSocket);
  await sleep(150);
  try {
    for (const pid of [visitorPublicId, ...extraVisitors].filter(Boolean)) {
      await conn.query("DELETE FROM ca_visitors WHERE ecard_id = ? AND public_id = ?", [ECARD_ID, pid]);
    }
    await conn.query("DELETE FROM ca_ecard_settings WHERE ecard_id = ?", [ECARD_ID]);
    if (agentSessionId) await conn.query("DELETE FROM admin_sessions WHERE id = ?", [agentSessionId]);
    const left = await conn.query(
      `SELECT (SELECT COUNT(*) FROM ca_visitors) visitors, (SELECT COUNT(*) FROM ca_conversations) conversations,
              (SELECT COUNT(*) FROM ca_messages) messages, (SELECT COUNT(*) FROM ca_ecard_settings) settings,
              (SELECT COUNT(*) FROM admin_sessions WHERE device='ca-e2e') sessions`,
    );
    const l = left[0];
    console.log(`\n# 清理核对：visitors=${l.visitors} conversations=${l.conversations} messages=${l.messages} settings=${l.settings} sessions=${l.sessions}`);
    check("测试数据已清理干净（0 残留）", Object.values(l).every((n) => Number(n) === 0));
  } catch (cleanupError) {
    console.log(`CLEANUP ERROR | ${cleanupError?.message || cleanupError}`);
    results.push(false);
  }
  conn.release();
  const failed = results.filter((r) => !r).length;
  console.log(`\n===== 结果：${results.length - failed}/${results.length} 通过 =====`);
  process.exit(failed === 0 ? 0 : 1);
}
