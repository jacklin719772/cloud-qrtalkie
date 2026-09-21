/**
 * Customer Assistant —— 实时通道（WebSocket 事件总线）。
 *
 * 规格来源：docs/customer-assistant/10_ECARD_VISITOR_CHAT_SOLUTION.md §8
 *   §8.1 连接 `wss://<host>/ca/ws?ticket=…`（**无 role 参数**）；ticket 由服务端缓存保存，
 *        内含 role 与作用域（visitor：visitorId/ecardId/conversationId；agent：sipUserId），
 *        **取票即删（原子消费）**、TTL 30s；客户端伪造 role 无效；**逐帧重新校验归属**；ticket 不写日志
 *   §8.2 P1 为**单实例**内存实现——连接表/ticket/事件缓冲都在本进程；水平扩展时整体迁移到 Redis
 *        （失效清单与触发条件见文档；本文件顶部注明，禁止在多实例下直接启用）
 *   §8.3 可用状态 = 是否存在 CA Agent WS 连接（非 SIP presence）
 *   §8.4 事件清单：ca.message.new / delivered / read / typing.* / agent.available|unavailable /
 *        session.expired / error
 *
 * 上行约定（P1 简化，已在方案中标注）：
 *   · 支持 ca.typing.start / ca.typing.stop / ca.message.read / ca.message.delivered / ping
 *   · **发消息走 REST**（V3/A3）——保持单一路径与 HTTP 状态码/幂等语义；
 *     若客户端仍发 ca.message.send，返回 ca.error{ code: "USE_REST_SEND" } 并在方案文档同步说明。
 */

import { WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import * as convs from "./conversationService.js";
import * as msgs from "./messageService.js";
import { isSameSipUserId } from "./auth.js";
import { allowRequest } from "./rateLimit.js";
import { logCaEvent, CA_AUDIT_ACTIONS } from "./cleanupService.js";

const TICKET_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const IDLE_TIMEOUT_MS = 60_000;
const EVENT_BUFFER_PER_CONVERSATION = 500;
const TYPING_RATE_KEY_TTL_MS = 1_000;

/** ticket → { role, scope, expiresAt }；一次性消费（取票即删） */
const ticketStore = new Map();
/** visitorId → Set<ws> */
const visitorSockets = new Map();
/** sipUserId → Set<ws> */
const agentSockets = new Map();
/** conversationId → [{ seq, frame }]（断线追赶用；进程重启即丢，客户端另有 REST 兜底） */
const eventBuffers = new Map();
/** 心跳定时器 */
let heartbeatTimer = null;

/* ------------------------------------------------------------------ *
 * ticket
 * ------------------------------------------------------------------ */

function pruneTickets(now = Date.now()) {
  for (const [ticket, record] of ticketStore.entries()) {
    if (record.expiresAt <= now) ticketStore.delete(ticket);
  }
}

/**
 * 签发一次性 ticket。
 * @param {{role:"visitor"|"agent", visitorId?:number, ecardId?:number, conversationId?:number,
 *          conversationPublicId?:string, sipUserId?:number}} payload
 */
export function issueTicket(payload) {
  pruneTickets();
  const ticket = randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + TICKET_TTL_MS;
  const scope =
    payload.role === "agent"
      ? { sipUserId: Number(payload.sipUserId) }
      : {
          visitorId: Number(payload.visitorId),
          ecardId: Number(payload.ecardId),
          conversationId: Number(payload.conversationId),
          conversationPublicId: payload.conversationPublicId || null,
          sipUserId: Number(payload.sipUserId),
        };
  ticketStore.set(ticket, { role: payload.role, scope, expiresAt });
  return { ticket, expiresAt: new Date(expiresAt).toISOString() };
}

/** 原子消费：取出即删（Node 单线程内 get+delete 之间无 await，天然原子） */
export function consumeTicket(ticket) {
  const record = ticketStore.get(ticket);
  if (!record) return null;
  ticketStore.delete(ticket);
  if (record.expiresAt <= Date.now()) return null;
  return record;
}

/* ------------------------------------------------------------------ *
 * 可用状态（§8.3）
 * ------------------------------------------------------------------ */

export function isAgentAvailable(sipUserId) {
  const set = agentSockets.get(Number(sipUserId));
  return Boolean(set && set.size > 0);
}

/* ------------------------------------------------------------------ *
 * 事件分发
 * ------------------------------------------------------------------ */

function rememberEvent(conversationId, seq, frame) {
  const key = Number(conversationId);
  const buffer = eventBuffers.get(key) || [];
  buffer.push({ seq, frame });
  if (buffer.length > EVENT_BUFFER_PER_CONVERSATION) buffer.splice(0, buffer.length - EVENT_BUFFER_PER_CONVERSATION);
  eventBuffers.set(key, buffer);
}

function sendFrame(socket, frame) {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(frame));
  } catch (error) {
    console.warn("[customerAssistant][ws] send failed:", error?.message || error);
  }
}

/** 向该会话的访客连接 + 该会话归属客服的全部连接投递事件 */
export function dispatchConversationEvent({ conversationId, conversationPublicId, sipUserId, seq, frame }) {
  if (seq !== undefined && seq !== null) rememberEvent(conversationId, seq, frame);

  const payload = { ns: "ca", ts: new Date().toISOString(), conv: conversationPublicId, ...(seq !== null && seq !== undefined ? { seq } : {}), ...frame };

  const visitorSet = visitorSockets.get(Number(conversationId));
  if (visitorSet) for (const socket of visitorSet) sendFrame(socket, payload);

  const agentSet = agentSockets.get(Number(sipUserId));
  if (agentSet) for (const socket of agentSet) sendFrame(socket, payload);
}

/** 向某访客身份的全部连接投递（会话被归档等面向访客的事件） */
export function dispatchToVisitor(conversationId, frame) {
  const visitorSet = visitorSockets.get(Number(conversationId));
  const payload = { ns: "ca", ts: new Date().toISOString(), ...frame };
  if (visitorSet) for (const socket of visitorSet) sendFrame(socket, payload);
}

/** 客服可用状态变化 → 通知其名下会话的访客连接（§8.3） */
export function dispatchAgentAvailability(sipUserId, available, { manual = "auto" } = {}) {
  const frame = { ns: "ca", type: available ? "ca.agent.available" : "ca.agent.unavailable", ts: new Date().toISOString(), data: { manual } };
  for (const sockets of visitorSockets.values()) {
    for (const socket of sockets) {
      if (isSameSipUserId(socket.caScope?.sipUserId, sipUserId)) sendFrame(socket, frame);
    }
  }
}

/* ------------------------------------------------------------------ *
 * 上行帧处理
 * ------------------------------------------------------------------ */

async function handleUpstream(socket, frame) {
  const scope = socket.caScope || {};
  const type = String(frame?.type || "");

  if (type === "ping") {
    return sendFrame(socket, { ns: "ca", type: "pong", ts: new Date().toISOString() });
  }

  // 目标会话：访客只能用自己 ticket 里的会话；客服必须归属校验
  let conversationPublicId = String(frame?.conv || "").trim();
  if (scope.role === "visitor") {
    const allowed = socket.caConversationPublicId || scope.conversationPublicId;
    if (conversationPublicId && allowed && conversationPublicId !== allowed) {
      return sendFrame(socket, { ns: "ca", type: "ca.error", data: { code: "FORBIDDEN_CONVERSATION", message: "無權限操作該會話" } });
    }
    conversationPublicId = allowed || conversationPublicId;
  }

  if (type === "ca.message.send") {
    // P1 简化：发消息统一走 REST（V3/A3），保留单一路径与幂等语义
    return sendFrame(socket, {
      ns: "ca",
      type: "ca.error",
      data: { code: "USE_REST_SEND", message: "請改用 REST 發送訊息（POST …/chat/messages）" },
    });
  }

  if (type !== "ca.typing.start" && type !== "ca.typing.stop" && type !== "ca.message.read" && type !== "ca.message.delivered") {
    return sendFrame(socket, { ns: "ca", type: "ca.error", data: { code: "UNKNOWN_FRAME", message: "未知的訊息類型" } });
  }

  if (!conversationPublicId) {
    return sendFrame(socket, { ns: "ca", type: "ca.error", data: { code: "MISSING_CONVERSATION", message: "缺少 conv" } });
  }

  const connection = await pool.getConnection();
  try {
    const conversation = await convs.findConversationByPublicId(connection, conversationPublicId);
    if (!conversation) {
      return sendFrame(socket, { ns: "ca", type: "ca.error", data: { code: "CONVERSATION_NOT_FOUND", message: "會話不存在" } });
    }
    if (scope.role === "agent" && !isSameSipUserId(conversation.sipUserId, scope.sipUserId)) {
      await logCaEvent({
        action: CA_AUDIT_ACTIONS.FORBIDDEN_ACCESS,
        actorType: "agent",
        actorPublicId: String(scope.sipUserId),
        targetType: "conversation",
        targetPublicId: conversation.publicId,
        meta: { via: "ws" },
      });
      return sendFrame(socket, { ns: "ca", type: "ca.error", data: { code: "FORBIDDEN_CONVERSATION", message: "無權限操作該會話" } });
    }
    if (scope.role === "visitor" && !isSameSipUserId(conversation.visitorId, scope.visitorId)) {
      return sendFrame(socket, { ns: "ca", type: "ca.error", data: { code: "FORBIDDEN_CONVERSATION", message: "無權限操作該會話" } });
    }

    // typing：best-effort，节流到 1 条/秒
    if (type === "ca.typing.start" || type === "ca.typing.stop") {
      const key = `typing:${socket.caScope.role}:${socket.caScope.visitorId ?? socket.caScope.sipUserId}`;
      const verdict = allowRequest(key, { limit: 1, windowMs: TYPING_RATE_KEY_TTL_MS });
      if (!verdict.allowed) return undefined;
      dispatchConversationEvent({
        conversationId: conversation.conversationId,
        conversationPublicId: conversation.publicId,
        sipUserId: conversation.sipUserId,
        seq: null,
        frame: { type, data: { by: scope.role } },
      });
      return undefined;
    }

    // read / delivered：落库（各自事务）后再广播给对方
    await connection.beginTransaction();
    if (type === "ca.message.read") {
      await convs.markRead(connection, conversation.conversationId, scope.role, frame?.data?.uptoSeq ?? conversation.lastSeq);
    } else {
      await msgs.markDelivered(connection, conversation.conversationId, scope.role, frame?.data?.uptoSeq ?? conversation.lastSeq);
    }
    await connection.commit();

    dispatchConversationEvent({
      conversationId: conversation.conversationId,
      conversationPublicId: conversation.publicId,
      sipUserId: conversation.sipUserId,
      seq: null,
      frame: {
        type: type === "ca.message.read" ? "ca.message.read" : "ca.message.delivered",
        data: { by: scope.role, uptoSeq: frame?.data?.uptoSeq ?? conversation.lastSeq },
      },
    });
    return undefined;
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error("[customerAssistant][ws] upstream error:", error?.message || error);
    return sendFrame(socket, { ns: "ca", type: "ca.error", data: { code: "CA_INTERNAL_ERROR", message: "服務暫時不可用" } });
  } finally {
    connection.release();
  }
}

/* ------------------------------------------------------------------ *
 * 连接生命周期
 * ------------------------------------------------------------------ */

function registerSocket(socket, record) {
  const scope = record.scope;
  socket.caScope = { role: record.role, ...scope };
  socket.caAliveAt = Date.now();

  if (record.role === "visitor") {
    socket.caConversationPublicId = scope.conversationPublicId || null;
    const set = visitorSockets.get(Number(scope.conversationId)) || new Set();
    set.add(socket);
    visitorSockets.set(Number(scope.conversationId), set);
  } else {
    const set = agentSockets.get(Number(scope.sipUserId)) || new Set();
    const wasEmpty = set.size === 0;
    set.add(socket);
    agentSockets.set(Number(scope.sipUserId), set);
    if (wasEmpty) dispatchAgentAvailability(scope.sipUserId, true);
  }
}

function unregisterSocket(socket) {
  const scope = socket.caScope;
  if (!scope) return;
  if (scope.role === "visitor") {
    const set = visitorSockets.get(Number(scope.conversationId));
    if (set) {
      set.delete(socket);
      if (set.size === 0) visitorSockets.delete(Number(scope.conversationId));
    }
  } else {
    const set = agentSockets.get(Number(scope.sipUserId));
    if (set) {
      set.delete(socket);
      if (set.size === 0) {
        agentSockets.delete(Number(scope.sipUserId));
        dispatchAgentAvailability(scope.sipUserId, false);
      }
    }
  }
}

/**
 * 挂载 WS 服务：wss://<host>/ca/ws?ticket=…&since=<seq>
 * 单实例内存实现（§8.2）。
 */
export function attachCustomerAssistantWebSocketServer(httpServer, { path = "/ca/ws", extraPaths = [] } = {}) {
  // 多路径（默认 /ca/ws，生产另有 /api/ca/ws —— Apache 只反代 /api 与 /v1）：
  // 用 noServer + 手动 upgrade，避免多次挂载导致心跳定时器等重复实例。
  const acceptedPaths = new Set([path, ...extraPaths].filter(Boolean));
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      pathname = "";
    }
    if (!acceptedPaths.has(pathname)) return; // 非本模块路径：不处理，留给其它 upgrade 监听（当前无）
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", async (socket, request) => {
    const url = new URL(request.url, "http://localhost");
    const ticket = url.searchParams.get("ticket") || "";
    const since = Number(url.searchParams.get("since") || 0);

    const record = consumeTicket(ticket); // 取票即删；重放无效
    if (!record) {
      sendFrame(socket, { ns: "ca", type: "ca.error", data: { code: "TICKET_CONSUMED", message: "ticket 無效或已使用" } });
      return socket.close(4401, "invalid ticket");
    }

    registerSocket(socket, record);

    // ca.ready：含会话/游标信息（客服侧为空，用 REST 拉列表）
    let readyExtra = {};
    try {
      if (record.role === "visitor") {
        const connection = await pool.getConnection();
        try {
          const conversation = await convs.findConversationByPublicId(connection, record.scope.conversationPublicId || "");
          readyExtra = { conversationId: record.scope.conversationPublicId, lastSeq: conversation?.lastSeq ?? 0 };
        } finally {
          connection.release();
        }
      }
    } catch (error) {
      console.warn("[customerAssistant][ws] ready 探测失败:", error?.message || error);
    }

    sendFrame(socket, { ns: "ca", type: "ca.ready", ts: new Date().toISOString(), conv: record.scope.conversationPublicId || null, data: readyExtra });

    // 断线追赶：把缓冲中 > since 的事件补发（best-effort，缺口由 REST after= 兜底）
    const conversationId = Number(record.scope.conversationId);
    if (conversationId && since > 0) {
      const buffer = eventBuffers.get(conversationId) || [];
      for (const item of buffer) {
        if (item.seq > since) sendFrame(socket, item.frame);
      }
    }

    socket.on("pong", () => {
      socket.caAliveAt = Date.now();
    });
    socket.on("message", async (raw) => {
      socket.caAliveAt = Date.now();
      let frame = null;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return sendFrame(socket, { ns: "ca", type: "ca.error", data: { code: "BAD_FRAME", message: "無法解析的訊息" } });
      }
      await handleUpstream(socket, frame);
    });
    socket.on("close", () => unregisterSocket(socket));
    socket.on("error", (error) => {
      console.warn("[customerAssistant][ws] socket error:", error?.message || error);
      unregisterSocket(socket);
    });
  });

  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const socket of wss.clients) {
        if (now - (socket.caAliveAt || now) > IDLE_TIMEOUT_MS) {
          try { socket.terminate(); } catch { /* ignore */ }
          continue;
        }
        try { socket.ping(); } catch { /* ignore */ }
      }
    }, HEARTBEAT_INTERVAL_MS);
    if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();
  }

  return wss;
}

/** 仅测试用 */
export function __statsForTest() {
  return {
    tickets: ticketStore.size,
    visitorConversations: visitorSockets.size,
    agents: agentSockets.size,
    buffers: eventBuffers.size,
  };
}
