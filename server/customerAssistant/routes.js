/**
 * Customer Assistant（ECard 访客聊天）——HTTP 路由。
 *
 * 端点定义：docs/customer-assistant/10_ECARD_VISITOR_CHAT_SOLUTION.md §7.1（访客）/ §7.2（客服）
 * 鉴权：访客侧 = Bearer accessToken（V1 允许 Cookie）；客服侧 = requireSipUser → caAgent.sipUserId（§12.1 命名约定）
 * 副作用纪律（§6.2）：**推送与 WS 事件一律在本文件的事务 COMMIT 之后触发**；
 *                   步骤 8/9 之前，本文件不产生任何外部副作用。
 */

import { pool } from "../db.js";
import { createRequireCaAgent, getCaAgentSipUserId, isSameSipUserId } from "./auth.js";
import * as sessions from "./sessionService.js";
import * as convs from "./conversationService.js";
import * as msgs from "./messageService.js";
import { newPublicId } from "./ids.js";
import { allowRequest, CA_RATE_LIMITS, getClientIp, rateLimitedResponse } from "./rateLimit.js";
import { issueTicket, isAgentAvailable, dispatchConversationEvent, dispatchToVisitor } from "./realtimeHub.js";
import { notifyVisitorMessage } from "./pushNotifier.js";
import { logCaEvent, CA_AUDIT_ACTIONS } from "./cleanupService.js";
import { decodeUploadData, saveAttachmentBuffer, openAttachmentStream, resolveStoragePath, statAttachmentByKey } from "./attachmentService.js";
import { rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  buildConversationArchive,
  isValidShareToken,
  openArchiveStream,
  removeArchiveFiles,
  saveArchiveFiles,
} from "./archiveService.js";

const MAX_CONTENT_LENGTH = 4000;
/** 允许的消息类型（P2 第二批新增 file/audio/sticker；text 行为不变） */
const ALLOWED_CONTENT_TYPES = new Set(["text", "image", "file", "audio", "sticker"]);
const SLUG_PATTERN = /^[A-Za-z0-9_-]+$/; // 与 server/index.js:11143 isValidEcardPublicSlug 同规则

/** 模式 B（显式存储）开关。默认 cookie：resumeToken 只经 HttpOnly Cookie 下发，不进 JSON body（评审意见 ⑭） */
const RESUME_DELIVERY = String(process.env.CA_RESUME_DELIVERY || "cookie").toLowerCase();
const ALLOW_BODY_RESUME = RESUME_DELIVERY === "body" || RESUME_DELIVERY === "both";

/**
 * 消息落库提交后的副作用挂载点（步骤 8 realtimeHub / 步骤 9 pushNotifier 在此接入）。
 * 现在为空实现——保证「先落库、后通知」的顺序纪律从第一天就成立。
 */
async function afterMessageCommitted({ conversation, message, duplicate }) {
  if (duplicate) return undefined; // 幂等命中不重复通知（评审意见 ⑬）
  dispatchConversationEvent({
    conversationId: conversation.id,
    conversationPublicId: conversation.publicId,
    sipUserId: conversation.sipUserId,
    seq: message.seq,
    frame: { type: "ca.message.new", data: message },
  });

  // 推送（§9）：仅访客消息、COMMIT 之后触发、异步不阻塞 HTTP 响应
  if (String(message.senderType) === "visitor") {
    notifyVisitorMessage({ conversation, message }).catch((error) =>
      console.error("[customerAssistant][push] 触发失败:", error?.message || error),
    );
  }
  return undefined;
}

/** CA 可用状态（§8.3：来自 Agent WS 连接 + 手动 away，而非 SIP presence） */
function buildAgentStatus(sipUserId, settings) {
  const manual = settings?.online_status || "auto";
  const available = manual === "away" ? false : isAgentAvailable(sipUserId);
  return { state: available ? "available" : "unavailable", manual };
}

/**
 * 附件下载的 Content-Disposition：仅图片/音频内联，其余一律 attachment。
 * 任意类型放开后，未知类型内联渲染会有 XSS/执行风险（如 HTML/SVG），故默认强制下载。
 */
function contentDispositionFor(mimeType, fileName) {
  const mime = String(mimeType || "").toLowerCase();
  const inline = /^image\/(jpeg|png|webp|gif)$/.test(mime) || /^audio\//.test(mime);
  return `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(String(fileName || "file"))}"`;
}

function fail(response, status, code, message) {
  return response.status(status).json({ success: false, code, message });
}
function ok(response, payload = {}) {
  return response.json({ success: true, ...payload });
}

function bearerToken(request) {
  const raw = String(request.headers?.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1].trim() : "";
}

async function loadEcardBySlug(connection, slug) {
  if (!SLUG_PATTERN.test(String(slug || "").trim())) return { error: { status: 400, code: "INVALID_ECARD_SLUG", message: "查詢引數格式不正確" } };
  const rows = await connection.query(
    `SELECT id, sip_user_id, status, valid_from, valid_to FROM tenant_ecards WHERE access_slug = ? LIMIT 1`,
    [String(slug).trim()],
  );
  const row = rows[0];
  if (!row) return { error: { status: 404, code: "INVALID_ECARD_SLUG", message: "電子名片不存在或不可用" } };
  if (String(row.status) !== "active") return { error: { status: 403, code: "ECARD_CHAT_DISABLED", message: "該名片目前未開放" } };
  const today = new Date().toISOString().slice(0, 10);
  const from = row.valid_from ? String(row.valid_from).slice(0, 10) : null;
  const to = row.valid_to ? String(row.valid_to).slice(0, 10) : null;
  if ((from && today < from) || (to && today > to)) {
    return { error: { status: 403, code: "ECARD_CHAT_DISABLED", message: "該名片目前未開放" } };
  }
  return { ecard: { id: Number(row.id), sipUserId: Number(row.sip_user_id) } };
}

/** ecard 聊天开关（缺省行视为未开启） */
async function loadEcardSettings(connection, ecardId) {
  const rows = await connection.query(
    `SELECT ecard_id, enabled, welcome_message, offline_message, notify_enabled, display_name, online_status
       FROM ca_ecard_settings WHERE ecard_id = ? LIMIT 1`,
    [ecardId],
  );
  return rows[0] || null;
}

function isChatEnabled(settings) {
  return Boolean(settings && Number(settings.enabled) === 1);
}

/**
 * 访客鉴权：Authorization: Bearer <accessToken>
 * （V1 取票不走本中间件——它要处理 resumeToken/Cookie 换票，单独实现）
 */
function createRequireVisitor() {
  return async (request, response, next) => {
    const token = bearerToken(request);
    if (!token) return fail(response, 401, "SESSION_EXPIRED", "請重新取得授權");
    let connection;
    try {
      connection = await pool.getConnection();
      const result = await sessions.resolveAccessToken(connection, token);
      if (!result.ok) return fail(response, 401, "SESSION_EXPIRED", "授權已過期，請重新取得");
      request.caVisitor = { visitorId: result.session.visitorId };
      return next();
    } catch (error) {
      console.error("[customerAssistant] requireVisitor error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      if (connection) connection.release();
    }
  };
}

export function registerCustomerAssistantRoutes(app, { requireSipUser } = {}) {
  const requireCaAgent = createRequireCaAgent(requireSipUser);
  const requireVisitorAuth = createRequireVisitor();

  /* ==================================================================
   * 访客侧（公开）
   * ================================================================== */

  // V1 取票：默认 Cookie 模式（resumeToken 经 Set-Cookie 下发，不进 body）；首次调用即建立唯一会话并插入欢迎语
  /**
   * 取票（V1）与登记（V0=chat-register）共用实现。
   * requireContact=true 时（登记接口）要求 body 带姓名/邮箱，并把登记信息写入访客行
   * （同时把 display_name 设为姓名 —— 会话名的来源，R3）。
   */
  async function handleVisitorSession(request, response, { requireContact = false } = {}) {
    const slug = String(request.params.slug || "").trim();
    const ip = getClientIp(request);
    const verdict = allowRequest(`session:${ip}`, CA_RATE_LIMITS.session);
    if (!verdict.allowed) return rateLimitedResponse(response, verdict.retryAfterMs);

    const connection = await pool.getConnection();
    try {
      const loaded = await loadEcardBySlug(connection, slug);
      if (loaded.error) return fail(response, loaded.error.status, loaded.error.code, loaded.error.message);
      const { ecard } = loaded;

      const settings = await loadEcardSettings(connection, ecard.id);
      if (!isChatEnabled(settings)) return fail(response, 403, "ECARD_CHAT_DISABLED", "該名片目前未開放線上諮詢");

      await connection.beginTransaction();

      // ① 访客识别：优先 resumeToken（Cookie 或 body 显式模式），其次新建
      const presentedResume = ALLOW_BODY_RESUME
        ? String(request.body?.resumeToken || "") || sessions.readResumeCookie(request) || ""
        : sessions.readResumeCookie(request) || "";

      let visitorId = null;
      let visitorPublicId = null;
      let issuedResumeToken = null;
      if (presentedResume) {
        const redeemed = await sessions.redeemResumeToken(connection, presentedResume);
        if (redeemed.ok) {
          const own = await connection.query("SELECT id, public_id, blocked, ecard_id FROM ca_visitors WHERE id = ? LIMIT 1", [redeemed.visitorId]);
          const visitor = own[0];
          if (!visitor || Number(visitor.ecard_id) !== ecard.id) {
            await connection.rollback();
            return fail(response, 403, "INVALID_VISITOR", "訪客身份不匹配");
          }
          if (Number(visitor.blocked) === 1) {
            await connection.rollback();
            await logCaEvent({
              action: CA_AUDIT_ACTIONS.SESSION_BLOCKED,
              actorType: "visitor",
              actorPublicId: visitor.public_id,
              targetType: "ecard",
              targetPublicId: slug,
              ip,
            });
            return fail(response, 403, "VISITOR_BLOCKED", "目前無法發送訊息");
          }
          visitorId = Number(visitor.id);
          visitorPublicId = visitor.public_id;
          issuedResumeToken = redeemed.resumeToken;
        } else if (redeemed.reason === "replayed") {
          // 重放：整链已撤销，按新访客处理（评审意见 ④）
          console.warn(`[customerAssistant] resumeToken 重放，已整链撤销 visitor=${redeemed.visitorId}`);
        }
      }

      // 登记信息（R1）：登记接口必填姓名/邮箱；取票接口若带 contact 也一并写入（用于"编辑资料"）
      let contact = null;
      if (requireContact || request.body?.contact) {
        const raw = request.body?.contact || {};
        const name = String(raw.name || "").trim().slice(0, 120);
        const email = String(raw.email || "").trim().slice(0, 128);
        const phone = String(raw.phone || "").trim().slice(0, 64);
        const subject = String(raw.subject || "").trim().slice(0, 200);
        if (requireContact && (!name || !email)) {
          return fail(response, 400, "CONTACT_REQUIRED", "請填寫姓名與電子郵件");
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return fail(response, 400, "INVALID_EMAIL", "電子郵件格式不正確");
        }
        contact = { name, email, phone, subject };
      }

      if (!visitorId) {
        visitorPublicId = newPublicId("vis");
        const inserted = await connection.query(
          `INSERT INTO ca_visitors (ecard_id, public_id, display_name, contact_name, contact_email, contact_phone, subject, first_ip, last_ip, last_user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ecard.id, visitorPublicId,
            contact?.name || null, contact?.name || null, contact?.email || null, contact?.phone || null, contact?.subject || null,
            ip, ip, String(request.headers?.["user-agent"] || "").slice(0, 1000) || null,
          ],
        );
        visitorId = Number(inserted.insertId);
      } else {
        await connection.query(
          `UPDATE ca_visitors
              SET last_seen_at = NOW(), last_ip = ?, last_user_agent = ?,
                  contact_name = COALESCE(?, contact_name),
                  contact_email = COALESCE(?, contact_email),
                  contact_phone = COALESCE(?, contact_phone),
                  subject = COALESCE(?, subject),
                  display_name = COALESCE(?, display_name)
            WHERE id = ?`,
          [
            ip, String(request.headers?.["user-agent"] || "").slice(0, 1000) || null,
            contact?.name || null, contact?.email || null, contact?.phone || null, contact?.subject || null,
            contact?.name || null, visitorId,
          ],
        );
      }

      if (!issuedResumeToken) {
        const resume = await sessions.issueResumeToken(connection, visitorId);
        issuedResumeToken = resume.token;
      }
      const access = await sessions.issueAccessToken(connection, visitorId, {
        ip,
        userAgent: String(request.headers?.["user-agent"] || "").slice(0, 1000) || null,
      });

      // ② 会话：同一访客身份唯一，首次创建插入欢迎语（sender_type=system）
      const ensured = await convs.ensureConversation(connection, { ecardId: ecard.id, visitorId, sipUserId: ecard.sipUserId });
      if (ensured.created && settings?.welcome_message) {
        await msgs.appendMessage(connection, {
          conversationId: ensured.conversationId,
          senderType: "system",
          content: String(settings.welcome_message),
          clientMsgId: `welcome-${ensured.conversationId}`,
        });
      }

      await connection.commit();

      // ③ 下发：默认 Cookie 模式，resumeToken 只进 Set-Cookie；模式 B 才回 body
      response.set("Set-Cookie", sessions.buildResumeCookie(issuedResumeToken, { path: `/api/ecard/public/${slug}/` }));
      if (contact?.name) {
        await logCaEvent({
          action: CA_AUDIT_ACTIONS.VISITOR_REGISTERED,
          actorType: "visitor",
          actorPublicId: visitorPublicId,
          targetType: "ecard",
          targetPublicId: slug,
          ip,
          meta: { name: contact.name, email: contact.email },
        });
      }
      await logCaEvent({
        action: CA_AUDIT_ACTIONS.SESSION_ISSUED,
        actorType: "visitor",
        actorPublicId: visitorPublicId,
        targetType: "ecard",
        targetPublicId: slug,
        ip,
        meta: { conversationId: ensured.publicId, newVisitor: !presentedResume },
      });
      const payload = {
        visitorId: visitorPublicId,
        accessToken: access.token,
        expiresAt: access.expiresAt,
        conversationId: ensured.publicId,
        displayName: settings?.display_name || null,
        welcomeMessage: settings?.welcome_message || null,
        agentStatus: buildAgentStatus(ecard.sipUserId, settings),
      };
      if (ALLOW_BODY_RESUME) payload.resumeToken = issuedResumeToken;
      return ok(response, payload);
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] chat-session error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  }

  // V1 取票（已登记访客：凭 Cookie 续期；也可带 contact 更新资料）
  app.post("/api/ecard/public/:slug/chat-session", (request, response) => handleVisitorSession(request, response));

  // V0 登记 + 取票（新访客首次进入：先登记姓名/邮箱，必要时电话/主题）
  app.post("/api/ecard/public/:slug/chat-register", (request, response) =>
    handleVisitorSession(request, response, { requireContact: true }),
  );

  // V2 取当前会话 + 历史
  app.get("/api/ecard/public/:slug/chat", requireVisitorAuth, async (request, response) => {
    const slug = String(request.params.slug || "").trim();
    const verdict = allowRequest(`history:${request.caVisitor.visitorId}`, CA_RATE_LIMITS.history);
    if (!verdict.allowed) return rateLimitedResponse(response, verdict.retryAfterMs);

    const connection = await pool.getConnection();
    try {
      const loaded = await loadEcardBySlug(connection, slug);
      if (loaded.error) return fail(response, loaded.error.status, loaded.error.code, loaded.error.message);

      const conversationRows = await connection.query(
        `SELECT id, public_id FROM ca_conversations WHERE ecard_id = ? AND visitor_id = ? LIMIT 1`,
        [loaded.ecard.id, request.caVisitor.visitorId],
      );
      if (!conversationRows[0]) return ok(response, { conversation: null, messages: [] });

      const conversation = await convs.findConversationByPublicId(connection, conversationRows[0].public_id);
      const messages = await msgs.listMessages(connection, conversation.conversationId, {
        before: request.query?.before ?? null,
        limit: request.query?.limit ?? 50,
      });
      const settings = await loadEcardSettings(connection, loaded.ecard.id);
      return ok(response, {
        conversation: {
          conversationId: conversation.publicId,
          status: conversation.status,
          lastSeq: conversation.lastSeq,
          unreadForVisitor: conversation.unreadForVisitor,
        },
        messages,
        agentStatus: buildAgentStatus(loaded.ecard.sipUserId, settings),
      });
    } catch (error) {
      console.error("[customerAssistant] visitor chat load error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // V3 访客发消息
  app.post("/api/ecard/public/:slug/chat/messages", requireVisitorAuth, async (request, response) => {
    const slug = String(request.params.slug || "").trim();
    const content = request.body?.content;
    const contentType = String(request.body?.contentType || "text");
    const clientMsgId = request.body?.clientMsgId ? String(request.body.clientMsgId).slice(0, 64) : null;

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return fail(response, 400, "UNSUPPORTED_CONTENT_TYPE", "\u4e0d\u652f\u63f4\u7684\u8a0a\u606f\u985e\u578b");
    const isTextMessage = contentType === "text";
    if (isTextMessage && (typeof content !== "string" || !content.trim())) return fail(response, 400, "EMPTY_CONTENT", "\u8a0a\u606f\u4e0d\u80fd\u70ba\u7a7a");
    if (typeof content === "string" && content.length > MAX_CONTENT_LENGTH) {
      return fail(response, 413, "CONTENT_TOO_LONG", `\u8a0a\u606f\u9577\u5ea6\u4e0a\u9650 ${MAX_CONTENT_LENGTH} \u5b57`);
    }
    let visitorAttachment = null;
    if (!isTextMessage) {
      const key = String(request.body?.attachment?.key || "");
      const stat = await statAttachmentByKey(key);
      if (!stat) return fail(response, 400, "ATTACHMENT_INVALID", "\u9644\u4ef6\u7121\u6548\u6216\u5df2\u904e\u671f");
      visitorAttachment = {
        storageKey: key,
        kind: stat.kind,
        fileName: request.body?.attachment?.fileName || stat.fileName,
        mimeType: stat.mimeType,
        fileSize: stat.size,
        durationMs: request.body?.attachment?.durationMs ?? null,
      };
    }

    const verdict = allowRequest(`visitor-msg:${request.caVisitor.visitorId}`, CA_RATE_LIMITS.visitorMessage);
    if (!verdict.allowed) return rateLimitedResponse(response, verdict.retryAfterMs);

    const connection = await pool.getConnection();
    try {
      const loaded = await loadEcardBySlug(connection, slug);
      if (loaded.error) return fail(response, loaded.error.status, loaded.error.code, loaded.error.message);
      const settings = await loadEcardSettings(connection, loaded.ecard.id);
      if (!isChatEnabled(settings)) return fail(response, 403, "ECARD_CHAT_DISABLED", "該名片目前未開放線上諮詢");

      const visitorRows = await connection.query("SELECT id, blocked FROM ca_visitors WHERE id = ? LIMIT 1", [request.caVisitor.visitorId]);
      if (!visitorRows[0]) return fail(response, 401, "SESSION_EXPIRED", "授權已過期，請重新取得");
      if (Number(visitorRows[0].blocked) === 1) return fail(response, 403, "VISITOR_BLOCKED", "目前無法發送訊息");

      await connection.beginTransaction();
      const ensured = await convs.ensureConversation(connection, {
        ecardId: loaded.ecard.id,
        visitorId: request.caVisitor.visitorId,
        sipUserId: loaded.ecard.sipUserId,
      });
      const appended = await msgs.appendMessage(connection, {
        conversationId: ensured.conversationId,
        conversationPublicId: ensured.publicId,
        senderType: "visitor",
        content,
        contentType,
        clientMsgId,
        attachment: visitorAttachment,
      });
      await connection.commit();

      await afterMessageCommitted({
        conversation: { id: ensured.conversationId, publicId: ensured.publicId, sipUserId: loaded.ecard.sipUserId },
        message: appended.message,
        senderType: "visitor",
        duplicate: appended.duplicate,
      });

      return response.status(appended.duplicate ? 200 : 201).json({ success: true, message: appended.message });
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] visitor send error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // V4 访客标记已读
  app.post("/api/ecard/public/:slug/chat/read", requireVisitorAuth, async (request, response) => {
    const slug = String(request.params.slug || "").trim();
    const connection = await pool.getConnection();
    try {
      const loaded = await loadEcardBySlug(connection, slug);
      if (loaded.error) return fail(response, loaded.error.status, loaded.error.code, loaded.error.message);
      const rows = await connection.query(
        `SELECT id FROM ca_conversations WHERE ecard_id = ? AND visitor_id = ? LIMIT 1`,
        [loaded.ecard.id, request.caVisitor.visitorId],
      );
      if (!rows[0]) return fail(response, 404, "CONVERSATION_NOT_FOUND", "會話不存在");

      await connection.beginTransaction();
      await convs.markRead(connection, Number(rows[0].id), "visitor", request.body?.uptoSeq);
      await connection.commit();
      return ok(response, {});
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] visitor read error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // V6 访客上传附件/语音（base64 → 落盘；key 绑定本会话）
  app.post("/api/ecard/public/:slug/chat/uploads", requireVisitorAuth, async (request, response) => {
    const slug = String(request.params.slug || "").trim();
    const verdict = allowRequest(`upload:${request.caVisitor.visitorId}`, CA_RATE_LIMITS.history);
    if (!verdict.allowed) return rateLimitedResponse(response, verdict.retryAfterMs);

    const connection = await pool.getConnection();
    try {
      const loaded = await loadEcardBySlug(connection, slug);
      if (loaded.error) return fail(response, loaded.error.status, loaded.error.code, loaded.error.message);
      const rows = await connection.query(
        `SELECT id, public_id FROM ca_conversations WHERE ecard_id = ? AND visitor_id = ? LIMIT 1`,
        [loaded.ecard.id, request.caVisitor.visitorId],
      );
      if (!rows[0]) return fail(response, 404, "CONVERSATION_NOT_FOUND", "會話不存在");

      const saved = await saveAttachmentBuffer({
        ecardId: loaded.ecard.id,
        conversationPublicId: rows[0].public_id,
        fileName: request.body?.filename,
        mimeType: request.body?.mimeType,
        durationMs: request.body?.durationMs,
        buffer: decodeUploadData(request.body?.data),
      });
      if (saved.error) return fail(response, saved.error.status, saved.error.code, saved.error.message);
      return ok(response, { key: saved.storageKey, kind: saved.kind, fileName: saved.fileName, mimeType: saved.mimeType, fileSize: saved.fileSize });
    } catch (error) {
      console.error("[customerAssistant] visitor upload error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // V7 访客下载附件（鉴权：必须属于本访客的会话；目录不静态暴露）
  app.get("/api/ecard/public/:slug/chat/attachments/:id", requireVisitorAuth, async (request, response) => {
    const connection = await pool.getConnection();
    try {
      const rows = await connection.query(
        `SELECT a.id, a.storage_key, a.file_name, a.mime_type, c.visitor_id
           FROM ca_attachments a
           JOIN ca_messages m ON m.id = a.message_id
           JOIN ca_conversations c ON c.id = m.conversation_id
          WHERE a.id = ? LIMIT 1`,
        [Number(request.params.id) || 0],
      );
      const row = rows[0];
      if (!row || !isSameSipUserId(row.visitor_id, request.caVisitor.visitorId)) {
        return fail(response, 404, "ATTACHMENT_NOT_FOUND", "檔案不存在");
      }
      const opened = await openAttachmentStream(row.storage_key);
      if (!opened) return fail(response, 404, "ATTACHMENT_NOT_FOUND", "檔案不存在");
      response.set("Content-Type", row.mime_type || "application/octet-stream");
      response.set("Content-Length", String(opened.size));
      response.set("Content-Disposition", contentDispositionFor(row.mime_type, row.file_name));
      return opened.stream.pipe(response);
    } catch (error) {
      console.error("[customerAssistant] visitor download error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // V5 WS ticket：一次性、TTL 30s、内含 role 与作用域（§8.1）
  app.get("/api/ecard/public/:slug/chat/ticket", requireVisitorAuth, async (request, response) => {
    const slug = String(request.params.slug || "").trim();
    const connection = await pool.getConnection();
    try {
      const loaded = await loadEcardBySlug(connection, slug);
      if (loaded.error) return fail(response, loaded.error.status, loaded.error.code, loaded.error.message);
      const rows = await connection.query(
        `SELECT id, public_id FROM ca_conversations WHERE ecard_id = ? AND visitor_id = ? LIMIT 1`,
        [loaded.ecard.id, request.caVisitor.visitorId],
      );
      if (!rows[0]) return fail(response, 404, "CONVERSATION_NOT_FOUND", "會話不存在");
      const issued = issueTicket({
        role: "visitor",
        visitorId: request.caVisitor.visitorId,
        ecardId: loaded.ecard.id,
        conversationId: Number(rows[0].id),
        conversationPublicId: rows[0].public_id,
        sipUserId: loaded.ecard.sipUserId,
      });
      return ok(response, { ticket: issued.ticket, expiresAt: issued.expiresAt, wsPath: "/ca/ws" });
    } catch (error) {
      console.error("[customerAssistant] visitor ticket error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  /* ==================================================================
   * 客服侧（requireSipUser → caAgent.sipUserId）
   * ================================================================== */

  /** 载入会话并校验归属；失败时已写入响应 */
  async function loadOwnedConversation(connection, publicId, sipUserId, response) {
    const conversation = await convs.findConversationByPublicId(connection, String(publicId || ""));
    if (!conversation) {
      fail(response, 404, "CONVERSATION_NOT_FOUND", "會話不存在");
      return null;
    }
    if (!isSameSipUserId(conversation.sipUserId, sipUserId)) {
      fail(response, 404, "CONVERSATION_NOT_FOUND", "會話不存在"); // 越权与不存在统一 404，避免枚举
      await logCaEvent({
        action: CA_AUDIT_ACTIONS.FORBIDDEN_ACCESS,
        actorType: "agent",
        actorPublicId: String(sipUserId),
        targetType: "conversation",
        targetPublicId: String(publicId || "").slice(0, 48),
        ip: getClientIp(response.req), // 注意：本函数没有 request 参数，用 Express 的 response.req
      });
      return null;
    }
    return conversation;
  }

  // A1 会话列表
  app.get("/api/visitor-assistant/conversations", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const items = await convs.listConversationsForAgent(connection, sipUserId, {
        status: String(request.query?.status || "active"),
        unreadOnly: String(request.query?.unreadOnly || "") === "1",
        limit: request.query?.limit ?? 50,
      });
      return ok(response, { conversations: items });
    } catch (error) {
      console.error("[customerAssistant] agent list error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A2 历史（完整）
  app.get("/api/visitor-assistant/conversations/:id/messages", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.params.id, sipUserId, response);
      if (!conversation) return undefined;
      const messages = await msgs.listMessages(connection, conversation.conversationId, {
        before: request.query?.before ?? null,
        after: request.query?.after ?? null,
        limit: request.query?.limit ?? 50,
      });
      return ok(response, { messages });
    } catch (error) {
      console.error("[customerAssistant] agent history error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A3 客服回复
  app.post("/api/visitor-assistant/conversations/:id/messages", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const content = request.body?.content;
    const contentType = String(request.body?.contentType || "text");
    const clientMsgId = request.body?.clientMsgId ? String(request.body.clientMsgId).slice(0, 64) : null;

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return fail(response, 400, "UNSUPPORTED_CONTENT_TYPE", "\u4e0d\u652f\u63f4\u7684\u8a0a\u606f\u985e\u578b");
    const isTextMessage = contentType === "text";
    if (isTextMessage && (typeof content !== "string" || !content.trim())) return fail(response, 400, "EMPTY_CONTENT", "\u8a0a\u606f\u4e0d\u80fd\u70ba\u7a7a");
    if (typeof content === "string" && content.length > MAX_CONTENT_LENGTH) {
      return fail(response, 413, "CONTENT_TOO_LONG", `\u8a0a\u606f\u9577\u5ea6\u4e0a\u9650 ${MAX_CONTENT_LENGTH} \u5b57`);
    }
    let agentAttachment = null;
    if (!isTextMessage) {
      const key = String(request.body?.attachment?.key || "");
      const stat = await statAttachmentByKey(key);
      if (!stat) return fail(response, 400, "ATTACHMENT_INVALID", "\u9644\u4ef6\u7121\u6548\u6216\u5df2\u904e\u671f");
      agentAttachment = {
        storageKey: key,
        kind: stat.kind,
        fileName: request.body?.attachment?.fileName || stat.fileName,
        mimeType: stat.mimeType,
        fileSize: stat.size,
        durationMs: request.body?.attachment?.durationMs ?? null,
      };
    }

    const verdict = allowRequest(`agent-msg:${sipUserId}`, CA_RATE_LIMITS.agentMessage);
    if (!verdict.allowed) return rateLimitedResponse(response, verdict.retryAfterMs);

    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.params.id, sipUserId, response);
      if (!conversation) return undefined;

      await connection.beginTransaction();
      const appended = await msgs.appendMessage(connection, {
        conversationId: conversation.conversationId,
        conversationPublicId: conversation.publicId,
        senderType: "agent",
        senderSipUserId: sipUserId,
        content,
        contentType,
        clientMsgId,
        attachment: agentAttachment,
      });
      await connection.commit();

      await afterMessageCommitted({
        conversation: { id: conversation.conversationId, publicId: conversation.publicId, sipUserId },
        message: appended.message,
        senderType: "agent",
        duplicate: appended.duplicate,
      });

      return response.status(appended.duplicate ? 200 : 201).json({ success: true, message: appended.message });
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] agent send error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A4 客服标记已读
  app.post("/api/visitor-assistant/conversations/:id/read", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.params.id, sipUserId, response);
      if (!conversation) return undefined;
      await connection.beginTransaction();
      await convs.markRead(connection, conversation.conversationId, "agent", request.body?.uptoSeq);
      await connection.commit();
      return ok(response, {});
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] agent read error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A5 归档 / 取消归档（归档 = 收件箱整理 + 清零未读）
  app.post("/api/visitor-assistant/conversations/:id/archive", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.params.id, sipUserId, response);
      if (!conversation) return undefined;
      await connection.beginTransaction();
      await convs.archiveConversation(connection, conversation.conversationId);
      await connection.commit();
      await logCaEvent({
        action: CA_AUDIT_ACTIONS.CONVERSATION_ARCHIVED,
        actorType: "agent",
        actorPublicId: String(sipUserId),
        targetType: "conversation",
        targetPublicId: conversation.publicId,
        ip: getClientIp(request),
      });
      return ok(response, { status: "archived" });
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] archive error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  app.post("/api/visitor-assistant/conversations/:id/unarchive", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.params.id, sipUserId, response);
      if (!conversation) return undefined;
      await connection.beginTransaction();
      await convs.unarchiveConversation(connection, conversation.conversationId);
      await connection.commit();
      return ok(response, { status: "active" });
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] unarchive error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A11b 客服上传附件/语音（指定会话并校验归属）
  app.post("/api/visitor-assistant/uploads", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.body?.conversationId, sipUserId, response);
      if (!conversation) return undefined;
      const saved = await saveAttachmentBuffer({
        ecardId: conversation.ecardId,
        conversationPublicId: conversation.publicId,
        fileName: request.body?.filename,
        mimeType: request.body?.mimeType,
        durationMs: request.body?.durationMs,
        buffer: decodeUploadData(request.body?.data),
      });
      if (saved.error) return fail(response, saved.error.status, saved.error.code, saved.error.message);
      return ok(response, { key: saved.storageKey, kind: saved.kind, fileName: saved.fileName, mimeType: saved.mimeType, fileSize: saved.fileSize });
    } catch (error) {
      console.error("[customerAssistant] agent upload error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A11c 客服下载附件（鉴权：必须属于本客服的会话）
  app.get("/api/visitor-assistant/attachments/:id", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const rows = await connection.query(
        `SELECT a.id, a.storage_key, a.file_name, a.mime_type, c.sip_user_id
           FROM ca_attachments a
           JOIN ca_messages m ON m.id = a.message_id
           JOIN ca_conversations c ON c.id = m.conversation_id
          WHERE a.id = ? LIMIT 1`,
        [Number(request.params.id) || 0],
      );
      const row = rows[0];
      if (!row || !isSameSipUserId(row.sip_user_id, sipUserId)) {
        return fail(response, 404, "ATTACHMENT_NOT_FOUND", "檔案不存在");
      }
      const opened = await openAttachmentStream(row.storage_key);
      if (!opened) return fail(response, 404, "ATTACHMENT_NOT_FOUND", "檔案不存在");
      response.set("Content-Type", row.mime_type || "application/octet-stream");
      response.set("Content-Length", String(opened.size));
      response.set("Content-Disposition", contentDispositionFor(row.mime_type, row.file_name));
      return opened.stream.pipe(response);
    } catch (error) {
      console.error("[customerAssistant] agent download error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A12 清空聊天内容（R4）：删消息、保留会话；last_seq 不回退（避免 seq 复用）
  app.delete("/api/visitor-assistant/conversations/:id/messages", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.params.id, sipUserId, response);
      if (!conversation) return undefined;
      await connection.beginTransaction();
      const removed = await convs.clearConversationMessages(connection, conversation.conversationId);
      await connection.commit();
      await logCaEvent({
        action: CA_AUDIT_ACTIONS.CONVERSATION_MESSAGES_CLEARED,
        actorType: "agent",
        actorPublicId: String(sipUserId),
        targetType: "conversation",
        targetPublicId: conversation.publicId,
        ip: getClientIp(request),
        meta: { removed },
      });
      return ok(response, { cleared: removed });
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] clear messages error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A12b 删除单条消息（含其附件：DB 行级联 + 磁盘文件；last_seq 不回退）
  app.delete("/api/visitor-assistant/conversations/:id/messages/:messageId", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.params.id, sipUserId, response);
      if (!conversation) return undefined;
      const messageId = Number(request.params.messageId) || 0;
      await connection.beginTransaction();
      const deleted = await convs.deleteMessage(connection, conversation.conversationId, messageId);
      await connection.commit();
      if (!deleted.deleted) return fail(response, 404, "MESSAGE_NOT_FOUND", "訊息不存在");
      // 磁盘文件（DB 行已随消息级联删除，文件需显式清理；失败不影响接口结果）
      if (deleted.storageKey) {
        const absolute = resolveStoragePath(deleted.storageKey);
        if (absolute) {
          await rm(absolute, { force: true }).catch((error) =>
            console.error("[customerAssistant] delete attachment file failed:", error?.message || error),
          );
        }
      }
      await logCaEvent({
        action: CA_AUDIT_ACTIONS.MESSAGE_DELETED,
        actorType: "agent",
        actorPublicId: String(sipUserId),
        targetType: "conversation",
        targetPublicId: conversation.publicId,
        ip: getClientIp(request),
        meta: { messageId },
      });
      // 对端感知：撤回/删除后访客页面实时移除（P3 Web 面板按此事件处理）
      dispatchToVisitor(conversation.conversationId, {
        type: "ca.message.deleted",
        conv: conversation.publicId,
        data: { messageId, seq: deleted.seq },
      });
      return ok(response, { deleted: true });
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] delete message error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A13 删除整个访客会话（R4）：级联删消息/附件；**访客身份保留**（下次再访新建会话）
  app.delete("/api/visitor-assistant/conversations/:id", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.params.id, sipUserId, response);
      if (!conversation) return undefined;
      await connection.beginTransaction();
      await convs.deleteConversation(connection, conversation.conversationId);
      await connection.commit();
      await logCaEvent({
        action: CA_AUDIT_ACTIONS.CONVERSATION_DELETED,
        actorType: "agent",
        actorPublicId: String(sipUserId),
        targetType: "conversation",
        targetPublicId: conversation.publicId,
        ip: getClientIp(request),
      });
      // 访客侧感知：告知会话已结束（其下次发消息会自动开新会话）
      dispatchToVisitor(conversation.conversationId, {
        type: "ca.conversation.deleted",
        conv: conversation.publicId,
        data: {},
      });
      return ok(response, { deleted: true });
    } catch (error) {
      await connection.rollback().catch(() => {});
      console.error("[customerAssistant] delete conversation error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  /* ------------------------------------------------------------------ *
   * A14–A16 内容归档（打包 ZIP + 只读预览页 + 分享链接）
   *   · 归档 = 快照：会话删除/清空都不影响归档包（不做级联删除）
   *   · 重复归档 = 覆盖：旧文件删除、新 token 生成（旧链接立即失效）
   *   · 公开访问只凭不可猜 token（免登录），预览页禁止脚本（CSP）
   * ------------------------------------------------------------------ */

  const publicBaseUrl = String(process.env.APP_URL || "https://cloud.qrtalkie.org").replace(/\/+$/, "");

  function archiveSummary(row) {
    return {
      id: Number(row.id),
      conversationId: row.conversation_public_id,
      visitorName: row.visitor_name || null,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      archivedAt: row.archived_at,
      fileSize: Number(row.file_size) || 0,
      messageCount: Number(row.message_count) || 0,
      attachmentCount: Number(row.attachment_count) || 0,
      shareUrl: `${publicBaseUrl}/api/public/ca-archive/${row.share_token}`,
    };
  }

  // A14 归档内容：打包消息 + 双方附件 → ZIP，登记并生成分享链接；同一会话覆盖
  app.post("/api/visitor-assistant/conversations/:id/archive-content", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const conversation = await loadOwnedConversation(connection, request.params.id, sipUserId, response);
      if (!conversation) return undefined;

      const rows = await connection.query(
        `SELECT m.seq, m.sender_type, m.content_type, m.content, m.created_at,
                a.id AS attachment_id, a.storage_key, a.file_name, a.file_size, a.mime_type
           FROM ca_messages m
           LEFT JOIN ca_attachments a ON a.message_id = m.id
          WHERE m.conversation_id = ?
          ORDER BY m.seq ASC`,
        [conversation.conversationId],
      );
      if (!rows.length) return fail(response, 400, "EMPTY_CONVERSATION", "沒有可歸檔的訊息");

      const visitorRows = await connection.query(
        `SELECT public_id, contact_name, display_name, contact_email, contact_phone, subject FROM ca_visitors WHERE id = ? LIMIT 1`,
        [conversation.visitorId],
      );
      const built = await buildConversationArchive({
        rows,
        visitor: visitorRows[0],
        ecardId: conversation.ecardId,
        conversationPublicId: conversation.publicId,
      });

      await removeArchiveFiles(conversation.ecardId, conversation.publicId); // 覆盖：先清旧文件
      await saveArchiveFiles(conversation.ecardId, conversation.publicId, built);

      const shareToken = randomBytes(32).toString("base64url"); // 43 字符，不可猜
      await connection.query(
        `INSERT INTO ca_archives
           (ecard_id, conversation_id, conversation_public_id, sip_user_id, visitor_public_id, visitor_name,
            share_token, file_size, message_count, attachment_count, started_at, ended_at, archived_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NULL)
         ON DUPLICATE KEY UPDATE
           share_token = VALUES(share_token), file_size = VALUES(file_size),
           message_count = VALUES(message_count), attachment_count = VALUES(attachment_count),
           started_at = VALUES(started_at), ended_at = VALUES(ended_at),
           archived_at = NOW(), revoked_at = NULL`,
        [
          conversation.ecardId,
          conversation.conversationId,
          conversation.publicId,
          sipUserId,
          visitorRows[0]?.public_id || null,
          (visitorRows[0]?.contact_name || visitorRows[0]?.display_name || "").slice(0, 128) || null,
          shareToken,
          built.zip.length,
          built.messageCount,
          built.attachmentCount,
          built.startedAt,
          built.endedAt,
        ],
      );
      // 归档同时把会话移入「已归档」（列表筛选口径统一）
      await connection.query(`UPDATE ca_conversations SET status = 'archived' WHERE id = ?`, [conversation.conversationId]);
      await logCaEvent({
        action: CA_AUDIT_ACTIONS.CONTENT_ARCHIVED,
        actorType: "agent",
        actorPublicId: String(sipUserId),
        targetType: "conversation",
        targetPublicId: conversation.publicId,
        ip: getClientIp(request),
        meta: { messageCount: built.messageCount, attachmentCount: built.attachmentCount, fileSize: built.zip.length, skipped: built.skipped },
      });
      return ok(response, {
        conversationId: conversation.publicId,
        visitorName: (visitorRows[0]?.contact_name || visitorRows[0]?.display_name || "").slice(0, 128) || null,
        startedAt: built.startedAt,
        endedAt: built.endedAt,
        archivedAt: new Date().toISOString(),
        fileSize: built.zip.length,
        messageCount: built.messageCount,
        attachmentCount: built.attachmentCount,
        shareUrl: `${publicBaseUrl}/api/public/ca-archive/${shareToken}`,
      });
    } catch (error) {
      console.error("[customerAssistant] archive content error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A15 归档记录列表（列表页「已归档」用）
  app.get("/api/visitor-assistant/archives", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const rows = await connection.query(
        `SELECT id, conversation_public_id, visitor_name, share_token, file_size, message_count,
                attachment_count, started_at, ended_at, archived_at
           FROM ca_archives
          WHERE sip_user_id = ? AND revoked_at IS NULL
          ORDER BY archived_at DESC
          LIMIT 200`,
        [sipUserId],
      );
      return ok(response, { archives: rows.map(archiveSummary) });
    } catch (error) {
      console.error("[customerAssistant] list archives error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A16 撤销归档：删除归档包与记录（分享链接立即失效）
  app.delete("/api/visitor-assistant/archives/:id", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const archiveId = Number(request.params.id) || 0;
    const connection = await pool.getConnection();
    try {
      const rows = await connection.query(
        `SELECT id, ecard_id, conversation_public_id, sip_user_id FROM ca_archives WHERE id = ? LIMIT 1`,
        [archiveId],
      );
      const row = rows[0];
      if (!row || !isSameSipUserId(row.sip_user_id, sipUserId)) {
        return fail(response, 404, "ARCHIVE_NOT_FOUND", "歸檔不存在");
      }
      await connection.query(`DELETE FROM ca_archives WHERE id = ?`, [archiveId]);
      await removeArchiveFiles(row.ecard_id, row.conversation_public_id).catch((error) =>
        console.error("[customerAssistant] remove archive files failed:", error?.message || error),
      );
      await logCaEvent({
        action: CA_AUDIT_ACTIONS.CONTENT_ARCHIVE_REVOKED,
        actorType: "agent",
        actorPublicId: String(sipUserId),
        targetType: "conversation",
        targetPublicId: row.conversation_public_id,
        ip: getClientIp(request),
      });
      return ok(response, { revoked: true });
    } catch (error) {
      console.error("[customerAssistant] revoke archive error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // 公开：归档预览页（免登录，凭 token；禁脚本）
  app.get("/api/public/ca-archive/:token", async (request, response) => {
    const token = String(request.params.token || "");
    if (!isValidShareToken(token)) return fail(response, 404, "ARCHIVE_NOT_FOUND", "歸檔不存在");
    const connection = await pool.getConnection();
    try {
      const rows = await connection.query(
        `SELECT ecard_id, conversation_public_id FROM ca_archives WHERE share_token = ? AND revoked_at IS NULL LIMIT 1`,
        [token],
      );
      if (!rows[0]) return fail(response, 404, "ARCHIVE_NOT_FOUND", "歸檔不存在");
      const opened = await openArchiveStream("html", rows[0].ecard_id, rows[0].conversation_public_id);
      if (!opened) return fail(response, 404, "ARCHIVE_NOT_FOUND", "歸檔不存在");
      response.set("Content-Type", "text/html; charset=utf-8");
      response.set("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'");
      response.set("X-Content-Type-Options", "nosniff");
      return opened.stream.pipe(response);
    } catch (error) {
      console.error("[customerAssistant] public archive preview error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // 公开：归档 ZIP 下载（免登录，凭 token）
  app.get("/api/public/ca-archive/:token/zip", async (request, response) => {
    const token = String(request.params.token || "");
    if (!isValidShareToken(token)) return fail(response, 404, "ARCHIVE_NOT_FOUND", "歸檔不存在");
    const connection = await pool.getConnection();
    try {
      const rows = await connection.query(
        `SELECT ecard_id, conversation_public_id, visitor_name FROM ca_archives WHERE share_token = ? AND revoked_at IS NULL LIMIT 1`,
        [token],
      );
      if (!rows[0]) return fail(response, 404, "ARCHIVE_NOT_FOUND", "歸檔不存在");
      const opened = await openArchiveStream("zip", rows[0].ecard_id, rows[0].conversation_public_id);
      if (!opened) return fail(response, 404, "ARCHIVE_NOT_FOUND", "歸檔不存在");
      const name = `${(rows[0].visitor_name || "visitor").slice(0, 40)}_chat_archive.zip`;
      response.set("Content-Type", "application/zip");
      response.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      response.set("X-Content-Type-Options", "nosniff");
      return opened.stream.pipe(response);
    } catch (error) {
      console.error("[customerAssistant] public archive download error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A6 拉黑 / 解除（按公开 visitorId，且必须属于该客服名下 ecard）
  async function setVisitorBlocked(request, response, blocked) {
    const sipUserId = getCaAgentSipUserId(request);
    const publicId = String(request.params.visitorId || "");
    const connection = await pool.getConnection();
    try {
      const rows = await connection.query(
        `SELECT v.id FROM ca_visitors v
           JOIN tenant_ecards e ON e.id = v.ecard_id
          WHERE v.public_id = ? AND e.sip_user_id = ? LIMIT 1`,
        [publicId, sipUserId],
      );
      if (!rows[0]) return fail(response, 404, "VISITOR_NOT_FOUND", "訪客不存在");
      await connection.query(
        `UPDATE ca_visitors SET blocked = ?, blocked_at = ${blocked ? "NOW()" : "NULL"} WHERE id = ?`,
        [blocked ? 1 : 0, Number(rows[0].id)],
      );
      await logCaEvent({
        action: blocked ? CA_AUDIT_ACTIONS.VISITOR_BLOCKED : CA_AUDIT_ACTIONS.VISITOR_UNBLOCKED,
        actorType: "agent",
        actorPublicId: String(sipUserId),
        targetType: "visitor",
        targetPublicId: publicId,
        ip: getClientIp(request),
      });
      return ok(response, { visitorId: publicId, blocked: Boolean(blocked) });
    } catch (error) {
      console.error("[customerAssistant] block error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  }

  app.post("/api/visitor-assistant/visitors/:visitorId/block", requireCaAgent, (request, response) => setVisitorBlocked(request, response, true));
  app.post("/api/visitor-assistant/visitors/:visitorId/unblock", requireCaAgent, (request, response) => setVisitorBlocked(request, response, false));

  // A7 未读总数（App 角标；与 SIP 未读分列）
  app.get("/api/visitor-assistant/unread-count", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const total = await convs.countUnreadForAgent(connection, sipUserId);
      return ok(response, { unread: total });
    } catch (error) {
      console.error("[customerAssistant] unread-count error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A8 设置（读写自己 ecard 的聊天配置）
  app.get("/api/visitor-assistant/settings", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const connection = await pool.getConnection();
    try {
      const ecardRows = await connection.query("SELECT id FROM tenant_ecards WHERE sip_user_id = ? LIMIT 1", [sipUserId]);
      if (!ecardRows[0]) return fail(response, 404, "ECARD_NOT_FOUND", "尚未建立電子名片");
      const settings = await loadEcardSettings(connection, Number(ecardRows[0].id));
      return ok(response, {
        settings: settings
          ? {
              enabled: Number(settings.enabled) === 1,
              welcomeMessage: settings.welcome_message,
              offlineMessage: settings.offline_message,
              notifyEnabled: Number(settings.notify_enabled) === 1,
              displayName: settings.display_name,
              onlineStatus: settings.online_status,
            }
          : { enabled: false, welcomeMessage: null, offlineMessage: null, notifyEnabled: true, displayName: null, onlineStatus: "auto" },
      });
    } catch (error) {
      console.error("[customerAssistant] settings get error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  app.put("/api/visitor-assistant/settings", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const body = request.body || {};
    const connection = await pool.getConnection();
    try {
      const ecardRows = await connection.query("SELECT id FROM tenant_ecards WHERE sip_user_id = ? LIMIT 1", [sipUserId]);
      if (!ecardRows[0]) return fail(response, 404, "ECARD_NOT_FOUND", "尚未建立電子名片");
      const ecardId = Number(ecardRows[0].id);

      const onlineStatus = ["auto", "available", "away"].includes(String(body.onlineStatus)) ? String(body.onlineStatus) : "auto";
      await connection.query(
        `INSERT INTO ca_ecard_settings
           (ecard_id, enabled, welcome_message, offline_message, notify_enabled, display_name, online_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           enabled = VALUES(enabled), welcome_message = VALUES(welcome_message),
           offline_message = VALUES(offline_message), notify_enabled = VALUES(notify_enabled),
           display_name = VALUES(display_name), online_status = VALUES(online_status)`,
        [
          ecardId,
          body.enabled ? 1 : 0,
          body.welcomeMessage ? String(body.welcomeMessage).slice(0, 500) : null,
          body.offlineMessage ? String(body.offlineMessage).slice(0, 500) : null,
          body.notifyEnabled === false ? 0 : 1,
          body.displayName ? String(body.displayName).slice(0, 120) : null,
          onlineStatus,
        ],
      );
      return ok(response, {});
    } catch (error) {
      console.error("[customerAssistant] settings put error:", error?.message || error);
      return fail(response, 500, "CA_INTERNAL_ERROR", "服務暫時不可用");
    } finally {
      connection.release();
    }
  });

  // A9 客服侧 WS ticket：作用域 = 该客服名下全部会话（§8.1）
  app.get("/api/visitor-assistant/ticket", requireCaAgent, async (request, response) => {
    const sipUserId = getCaAgentSipUserId(request);
    const issued = issueTicket({ role: "agent", sipUserId });
    return ok(response, { ticket: issued.ticket, expiresAt: issued.expiresAt, wsPath: "/ca/ws" });
  });
}
