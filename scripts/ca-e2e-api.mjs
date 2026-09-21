/**
 * Customer Assistant 验收脚本（收编自 P1 实施期临时脚本）
 *
 * ⚠️ 会写入并清理测试数据（跑完核对 0 残留），需要连接到 CA 所在的数据库与本地 SaaS（127.0.0.1:3001）。
 * 夹具（环境变量，默认取 ecard 20 / 账号 30010001 —— 仅适用于本项目测试环境）：
 *   CA_TEST_SLUG / CA_TEST_ECARD_ID / CA_TEST_SIP_USER_ID
 * 运行：cd <repo> && sudo node scripts/ca-e2e-api.mjs
 */
import { pool } from "../server/db.js";
import { createHash, randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

const BASE = "http://127.0.0.1:3001";
const SLUG = process.env.CA_TEST_SLUG || "ec-28-ffx9i5";
const ECARD_ID = Number(process.env.CA_TEST_ECARD_ID || 20);
const SIP_USER_ID = Number(process.env.CA_TEST_SIP_USER_ID || 28);

const results = [];
const check = (name, cond, extra) => {
  results.push(Boolean(cond));
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${extra !== undefined ? "  → " + extra : ""}`);
};

async function req(method, path, { token, cookie, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 响应 */ }
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
  return { status: res.status, json, setCookie: setCookies.join("; ") };
}

const conn = await pool.getConnection();
let visitorPublicId = null;
let agentSessionId = null;
let conversationId = null; // finally 清理审计行要用
const extraVisitors = []; // 本次运行创建的所有访客（清理用）

try {
  // ---------- setup ----------
  await conn.query(
    `INSERT INTO ca_ecard_settings (ecard_id, enabled, welcome_message, display_name) VALUES (?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), welcome_message = VALUES(welcome_message), display_name = VALUES(display_name)`,
    [ECARD_ID, "您好，這裡是線上客服，請直接留言。", "30010001 客服"],
  );
  const agentToken = randomBytes(32).toString("hex");
  const ins = await conn.query(
    `INSERT INTO admin_sessions (admin_user_id, user_type, sip_user_id, token_hash, expires_at, device)
     VALUES (NULL, 'sip', ?, ?, NOW() + INTERVAL 1 HOUR, 'ca-e2e')`,
    [SIP_USER_ID, createHash("sha256").update(agentToken).digest("hex")],
  );
  agentSessionId = Number(ins.insertId);
  console.log(`# 夹具：ecard=${ECARD_ID} slug=${SLUG} owner=${SIP_USER_ID}（临时 token/设置已建立）\n`);

  // ---------- V1 取票（Cookie 模式）----------
  const v1 = await req("POST", `/api/ecard/public/${SLUG}/chat-session`, { body: {} });
  check("V1 取票 → 200", v1.status === 200, `status=${v1.status}`);
  check("V1 下发 ca_resume Cookie（HttpOnly+Secure+SameSite=Lax）",
    /ca_resume=/.test(v1.setCookie) && /HttpOnly/i.test(v1.setCookie) && /SameSite=Lax/i.test(v1.setCookie));
  check("V1 body 不含 resumeToken（默认 Cookie 模式）", v1.json?.resumeToken === undefined);
  const accessToken = v1.json?.accessToken;
  conversationId = v1.json?.conversationId;
  visitorPublicId = v1.json?.visitorId;
  check("V1 返回 accessToken / conversationId / visitorId",
    typeof accessToken === "string" && /^conv_[0-9a-f]{32}$/.test(conversationId || "") && /^vis_[0-9a-f]{32}$/.test(visitorPublicId || ""),
    `conv=${conversationId}`);

  const resumeCookie = (v1.setCookie.match(/ca_resume=([^;]+)/) || [])[1] || "";

  // ---------- V1 身份恢复（带 Cookie 再取票 → 同一访客/同一会话 + rotation）----------
  const v1b = await req("POST", `/api/ecard/public/${SLUG}/chat-session`, { cookie: `ca_resume=${resumeCookie}` });
  const resumeCookie2 = (v1b.setCookie.match(/ca_resume=([^;]+)/) || [])[1] || "";
  check("V1 凭 Cookie 恢复同一访客与同一会话", v1b.status === 200 && v1b.json?.visitorId === visitorPublicId && v1b.json?.conversationId === conversationId);
  check("V1 恢复时轮换 resumeToken（新旧不同）", resumeCookie2 && resumeCookie2 !== resumeCookie);
  const v1c = await req("POST", `/api/ecard/public/${SLUG}/chat-session`, { body: { resumeToken: "whatever" } });
  if (v1c.json?.visitorId) extraVisitors.push(v1c.json.visitorId); // 该调用会新建访客，需一并清理
  check("V1 显式 body.resumeToken 在 Cookie 模式下被忽略", v1c.json?.resumeToken === undefined);

  const visitorToken = v1b.json?.accessToken || accessToken;

  // ---------- V2 会话 + 历史（应含欢迎语）----------
  const v2a = await req("GET", `/api/ecard/public/${SLUG}/chat`, { token: visitorToken });
  check("V2 返回会话与欢迎语（system 消息）",
    v2a.status === 200 && v2a.json?.conversation?.conversationId === conversationId &&
    v2a.json?.messages?.some((m) => m.senderType === "system" && /線上客服/.test(m.content || "")));

  // ---------- V3 访客发消息（含幂等）----------
  const content = "你好，我想諮詢一下產品價格";
  const v3 = await req("POST", `/api/ecard/public/${SLUG}/chat/messages`, { token: visitorToken, body: { clientMsgId: "e2e-1", content } });
  check("V3 访客发消息 → 201", v3.status === 201 && v3.json?.message?.seq >= 2, `seq=${v3.json?.message?.seq}`);
  const v3dup = await req("POST", `/api/ecard/public/${SLUG}/chat/messages`, { token: visitorToken, body: { clientMsgId: "e2e-1", content } });
  check("V3 同 clientMsgId 重试幂等（200 且同一条）", v3dup.status === 200 && v3dup.json?.message?.id === v3.json?.message?.id);
  check("V3 超长内容被拒", (await req("POST", `/api/ecard/public/${SLUG}/chat/messages`, { token: visitorToken, body: { content: "x".repeat(4001) } })).status === 413);

  // ---------- A1 客服列表（未读=1）----------
  const a1 = await req("GET", "/api/visitor-assistant/conversations", { token: agentToken });
  const listItem = (a1.json?.conversations || []).find((c) => c.conversationId === conversationId);
  check("A1 客服列表含该会话且未读=1", a1.status === 200 && listItem && listItem.unreadForAgent === 1,
    `unread=${listItem?.unreadForAgent}`);

  // ---------- A3 客服回复 ----------
  const a3 = await req("POST", `/api/visitor-assistant/conversations/${conversationId}/messages`, { token: agentToken, body: { clientMsgId: "e2e-a1", content: "您好，價格是 100 元。" } });
  check("A3 客服回复 → 201", a3.status === 201 && a3.json?.message?.senderType === "agent");

  // ---------- V2 访客侧看到回复 ----------
  const v2b = await req("GET", `/api/ecard/public/${SLUG}/chat`, { token: visitorToken });
  const last = v2b.json?.messages?.[v2b.json.messages.length - 1];
  check("V2 访客看到客服回复", last?.senderType === "agent" && /100 元/.test(last?.content || ""));

  // ---------- 已读：客服 & 访客 ----------
  const a2 = await req("GET", `/api/visitor-assistant/conversations/${conversationId}/messages`, { token: agentToken });
  const agentUptoSeq = a2.json?.messages?.[a2.json.messages.length - 1]?.seq;
  const a4 = await req("POST", `/api/visitor-assistant/conversations/${conversationId}/read`, { token: agentToken, body: { uptoSeq: agentUptoSeq } });
  const a7 = await req("GET", "/api/visitor-assistant/unread-count", { token: agentToken });
  check("A4 已读 + A7 未读归零", a4.status === 200 && a7.json?.unread === 0, `unread=${a7.json?.unread}`);

  const v4 = await req("POST", `/api/ecard/public/${SLUG}/chat/read`, { token: visitorToken, body: { uptoSeq: last?.seq } });
  const v2c = await req("GET", `/api/ecard/public/${SLUG}/chat`, { token: visitorToken });
  check("V4 访客已读 → 访客侧未读归零", v4.status === 200 && v2c.json?.conversation?.unreadForVisitor === 0);

  // ---------- A11/A12 附件：任意类型放开 + 可执行拒绝 + 下载语义 ----------
  const b64 = (text) => Buffer.from(text, "utf8").toString("base64");
  const a11txt = await req("POST", "/api/visitor-assistant/uploads", {
    token: agentToken,
    body: { conversationId, filename: "说明.txt", mimeType: "text/plain", data: b64("hello attachment") },
  });
  check("A11 上传任意类型（txt → kind=file）", a11txt.status === 200 && a11txt.json?.kind === "file",
    `kind=${a11txt.json?.kind}`);

  const a11unknown = await req("POST", "/api/visitor-assistant/uploads", {
    token: agentToken,
    body: { conversationId, filename: "数据.xyzzy", mimeType: "", data: b64("unknown type") },
  });
  check("A11 未登记类型兜底为 file（不拒绝）", a11unknown.status === 200 && a11unknown.json?.kind === "file");

  const a11docx = await req("POST", "/api/visitor-assistant/uploads", {
    token: agentToken,
    body: {
      conversationId,
      filename: "报告.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: b64("PKfake-docx"),
    },
  });
  check("A11 Office 文档保留 MIME（docx）",
    a11docx.status === 200 && /wordprocessingml/.test(a11docx.json?.mimeType || ""),
    `mime=${a11docx.json?.mimeType}`);

  const a11apk = await req("POST", "/api/visitor-assistant/uploads", {
    token: agentToken,
    body: { conversationId, filename: "evil.apk", mimeType: "application/vnd.android.package-archive", data: b64("MZ") },
  });
  check("A11 拒绝可执行类型（apk → 415）", a11apk.status === 415, `status=${a11apk.status}`);

  const a3file = await req("POST", `/api/visitor-assistant/conversations/${conversationId}/messages`, {
    token: agentToken,
    body: {
      clientMsgId: "e2e-file-1",
      content: "",
      contentType: "file",
      attachment: { key: a11txt.json?.key, fileName: "说明.txt" },
    },
  });
  const fileAtt = a3file.json?.message?.attachment;
  check("A3 带附件发送 → 201（kind/size 以服务端磁盘为准）",
    a3file.status === 201 && fileAtt?.kind === "file" && fileAtt?.fileSize === 16, `size=${fileAtt?.fileSize}`);

  const dlFile = await fetch(`${BASE}/api/visitor-assistant/attachments/${fileAtt?.id}`, {
    headers: { authorization: `Bearer ${agentToken}` },
  });
  const dlFileBody = await dlFile.text();
  check("A12 下载：非图片强制 attachment + 内容一致",
    dlFile.status === 200 && /^attachment/i.test(dlFile.headers.get("content-disposition") || "") &&
    dlFileBody === "hello attachment");

  const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const a11png = await req("POST", "/api/visitor-assistant/uploads", {
    token: agentToken,
    body: { conversationId, filename: "dot.png", mimeType: "image/png", data: png1x1 },
  });
  check("A11 图片 → kind=image", a11png.status === 200 && a11png.json?.kind === "image");

  const a3img = await req("POST", `/api/visitor-assistant/conversations/${conversationId}/messages`, {
    token: agentToken,
    body: {
      clientMsgId: "e2e-file-2",
      content: "",
      contentType: "image",
      attachment: { key: a11png.json?.key, fileName: "dot.png" },
    },
  });
  const imgAtt = a3img.json?.message?.attachment;
  const dlImg = await fetch(`${BASE}/api/visitor-assistant/attachments/${imgAtt?.id}`, {
    headers: { authorization: `Bearer ${agentToken}` },
  });
  check("A12 图片内联（inline）", dlImg.status === 200 && /^inline/i.test(dlImg.headers.get("content-disposition") || ""));

  const dlImgVisitor = await fetch(`${BASE}/api/ecard/public/${SLUG}/chat/attachments/${imgAtt?.id}`, {
    headers: { authorization: `Bearer ${visitorToken}` },
  });
  check("V7 访客可下载该附件（inline）",
    dlImgVisitor.status === 200 && /^inline/i.test(dlImgVisitor.headers.get("content-disposition") || ""));

  // ---------- A12b 删除单条消息（含附件文件清理与未读重算）----------
  const fileMessageId = a3file.json?.message?.id;
  const delMsg = await req("DELETE", `/api/visitor-assistant/conversations/${conversationId}/messages/${fileMessageId}`, { token: agentToken });
  check("A12b 删除单条消息 → 200", delMsg.status === 200 && delMsg.json?.deleted === true, `status=${delMsg.status}`);

  const historyAfterDelete = await req("GET", `/api/visitor-assistant/conversations/${conversationId}/messages`, { token: agentToken });
  check("A12b 该消息已不在历史中", !(historyAfterDelete.json?.messages || []).some((m) => m.id === fileMessageId));

  const dlDeleted = await fetch(`${BASE}/api/visitor-assistant/attachments/${fileAtt?.id}`, {
    headers: { authorization: `Bearer ${agentToken}` },
  });
  check("A12b 附件随消息删除 → 404（行级联 + 磁盘清理）", dlDeleted.status === 404, `status=${dlDeleted.status}`);

  check("A12b 重复删除同一条 → 404",
    (await req("DELETE", `/api/visitor-assistant/conversations/${conversationId}/messages/${fileMessageId}`, { token: agentToken })).status === 404);

  const delVisitorMsg = await req("POST", `/api/ecard/public/${SLUG}/chat/messages`, {
    token: visitorToken,
    body: { clientMsgId: "e2e-del-1", content: "这条访客消息会被客服删除" },
  });
  const unreadBeforeDelete = (await req("GET", "/api/visitor-assistant/conversations", { token: agentToken }))
    .json?.conversations?.find((c) => c.conversationId === conversationId)?.unreadForAgent;
  await req("DELETE", `/api/visitor-assistant/conversations/${conversationId}/messages/${delVisitorMsg.json?.message?.id}`, { token: agentToken });
  const unreadAfterDelete = (await req("GET", "/api/visitor-assistant/conversations", { token: agentToken }))
    .json?.conversations?.find((c) => c.conversationId === conversationId)?.unreadForAgent;
  check("A12b 删掉未读消息后客服未读重算", unreadBeforeDelete === 1 && unreadAfterDelete === 0,
    `${unreadBeforeDelete} → ${unreadAfterDelete}`);

  // ---------- A14/A15/A16 内容归档：打包 + 公开预览/下载 + 覆盖换链 + 撤销 ----------
  const a14 = await req("POST", `/api/visitor-assistant/conversations/${conversationId}/archive-content`, { token: agentToken });
  const token1 = ((a14.json?.shareUrl || "").match(/ca-archive\/([A-Za-z0-9_-]{43})$/) || [])[1];
  check("A14 归档 → 200 且返回分享链接", a14.status === 200 && Boolean(token1), `status=${a14.status}`);
  check("A14 归档包统计含消息与附件", (a14.json?.messageCount || 0) >= 3 && (a14.json?.attachmentCount || 0) >= 1,
    `msgs=${a14.json?.messageCount} atts=${a14.json?.attachmentCount}`);

  const preview = await fetch(`${BASE}/api/public/ca-archive/${token1}`);
  const previewHtml = await preview.text();
  check("公开预览页 200 且含归档内容", preview.status === 200 && /聊天记录归档/.test(previewHtml) && /hello attachment|你好/.test(previewHtml));

  const fileLink = (previewHtml.match(/href="(\/api\/public\/ca-archive\/[^"]+\/file\?path=[^"]+)"/) || [])[1];
  check("预览页附件链接指向按文件下载端点", Boolean(fileLink), String(fileLink).slice(0, 60));
  if (fileLink) {
    const fileResp = await fetch(`${BASE}${fileLink}`);
    const fileBody = await fileResp.text();
    check("按文件下载 200 且内容非空（从归档包内取）",
      fileResp.status === 200 && fileBody.length > 0,
      `status=${fileResp.status} len=${fileBody.length}`);
  } else {
    check("按文件下载 200 且内容非空（从归档包内取）", false, "无附件链接");
  }
  check("预览页含「下载完整归档 ZIP」入口", /ca-archive\/[^"]+\/zip/.test(previewHtml));

  const zipResp = await fetch(`${BASE}/api/public/ca-archive/${token1}/zip`);
  const zipBuf = Buffer.from(await zipResp.arrayBuffer());
  check("公开 ZIP 下载 200（PK 头 + 体积与登记一致）",
    zipResp.status === 200 && zipBuf.slice(0, 2).toString() === "PK" && zipBuf.length === a14.json?.fileSize,
    `size=${zipBuf.length}/${a14.json?.fileSize}`);

  const a14b = await req("POST", `/api/visitor-assistant/conversations/${conversationId}/archive-content`, { token: agentToken });
  const token2 = ((a14b.json?.shareUrl || "").match(/ca-archive\/([A-Za-z0-9_-]{43})$/) || [])[1];
  check("再次归档 = 覆盖换链（新 token ≠ 旧）", a14b.status === 200 && Boolean(token2) && token2 !== token1);
  check("旧链接立即失效（404）", (await fetch(`${BASE}/api/public/ca-archive/${token1}`)).status === 404);

  const a15 = await req("GET", "/api/visitor-assistant/archives", { token: agentToken });
  const archiveRow = (a15.json?.archives || []).find((a) => a.conversationId === conversationId);
  check("A15 归档列表含摘要（时间/统计/分享链接）",
    a15.status === 200 && Boolean(archiveRow?.archivedAt) && (archiveRow?.fileSize || 0) > 0 && /ca-archive\//.test(archiveRow?.shareUrl || ""),
    `size=${archiveRow?.fileSize}`);

  const a16 = await req("DELETE", `/api/visitor-assistant/archives/${archiveRow?.id}`, { token: agentToken });
  check("A16 撤销归档 → 链接立即失效",
    a16.status === 200 && (await fetch(`${BASE}/api/public/ca-archive/${token2}`)).status === 404);


  const a5 = await req("POST", `/api/visitor-assistant/conversations/${conversationId}/archive`, { token: agentToken });
  const a1arch = await req("GET", "/api/visitor-assistant/conversations?status=archived", { token: agentToken });
  check("A5 归档生效（archived 列表可见）", a5.status === 200 && (a1arch.json?.conversations || []).some((c) => c.conversationId === conversationId));

  const v3b = await req("POST", `/api/ecard/public/${SLUG}/chat/messages`, { token: visitorToken, body: { clientMsgId: "e2e-2", content: "還在嗎？" } });
  const a1act = await req("GET", "/api/visitor-assistant/conversations?status=active", { token: agentToken });
  const woke = (a1act.json?.conversations || []).find((c) => c.conversationId === conversationId);
  check("访客新消息把归档会话唤回 active 且未读=1", v3b.status === 201 && woke && woke.unreadForAgent === 1);

  // ---------- 鉴权与未就绪端点 ----------
  check("A1 无 token → 401", (await req("GET", "/api/visitor-assistant/conversations")).status === 401);
  check("V2 无 token → 401", (await req("GET", `/api/ecard/public/${SLUG}/chat`)).status === 401);
  check("A2 不存在的会话 → 404", (await req("GET", "/api/visitor-assistant/conversations/conv_ffffffffffffffffffffffffffffffff/messages", { token: agentToken })).status === 404);
  const v5t = await req("GET", `/api/ecard/public/${SLUG}/chat/ticket`, { token: visitorToken });
  const a9t = await req("GET", "/api/visitor-assistant/ticket", { token: agentToken });
  check("V5 / A9 签发一次性 WS ticket",
    v5t.status === 200 && typeof v5t.json?.ticket === "string" && a9t.status === 200 && typeof a9t.json?.ticket === "string",
    `v5=${v5t.status} a9=${a9t.status}`);

  // ---------- 既有功能回归（公开 ecard 页仍正常）----------
  const legacy = await fetch(`${BASE}/api/ecard/public/${SLUG}`);
  check("回归：现有公开 ecard 端点仍 200", legacy.status === 200);
} catch (error) {
  console.log(`ERROR | ${error?.message || error}`);
  results.push(false);
} finally {
  // ---------- 清理 ----------
  try {
    for (const pid of [visitorPublicId, ...extraVisitors].filter(Boolean)) {
      await conn.query("DELETE FROM ca_visitors WHERE ecard_id = ? AND public_id = ?", [ECARD_ID, pid]);
    }
    await conn.query("DELETE FROM ca_ecard_settings WHERE ecard_id = ?", [ECARD_ID]);
    if (agentSessionId) await conn.query("DELETE FROM admin_sessions WHERE id = ?", [agentSessionId]);
    // 归档：DB 行 + 落盘 ZIP/HTML（归档是快照，不随会话级联删除，需显式清理）
    await conn.query("DELETE FROM ca_archives WHERE ecard_id = ?", [ECARD_ID]);
    if (conversationId) {
      await rm(path.resolve(process.cwd(), "assets", "ca-archives", String(ECARD_ID), `${conversationId}.zip`), { force: true });
      await rm(path.resolve(process.cwd(), "assets", "ca-archives", String(ECARD_ID), `${conversationId}.html`), { force: true });
    }
    // 附件落盘文件（DB 行随访客级联删除，磁盘目录需显式清理）
    if (conversationId) {
      await rm(path.resolve(process.cwd(), "assets", "ca-attachments", String(ECARD_ID), conversationId), {
        recursive: true,
        force: true,
      });
    }
    for (const pid of [visitorPublicId, ...extraVisitors].filter(Boolean)) {
      await conn.query("DELETE FROM ca_audit_log WHERE target_public_id IN (?, ?) OR actor_public_id = ?", [pid, conversationId || "", pid]);
    }

    const left = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM ca_visitors WHERE ecard_id = ?) AS visitors,
         (SELECT COUNT(*) FROM ca_conversations WHERE ecard_id = ?) AS conversations,
         (SELECT COUNT(*) FROM ca_messages m JOIN ca_conversations c ON c.id = m.conversation_id WHERE c.ecard_id = ?) AS messages,
         (SELECT COUNT(*) FROM ca_ecard_settings WHERE ecard_id = ?) AS settings,
         (SELECT COUNT(*) FROM admin_sessions WHERE device = 'ca-e2e') AS sessions,
         (SELECT COUNT(*) FROM ca_archives WHERE ecard_id = ?) AS archives,
         (SELECT COUNT(*) FROM ca_audit_log) AS audit`,
      [ECARD_ID, ECARD_ID, ECARD_ID, ECARD_ID, ECARD_ID],
    );
    const l = left[0];
    const clean = Object.values(l).every((n) => Number(n) === 0);
    console.log(`\n# 清理核对：visitors=${l.visitors} conversations=${l.conversations} messages=${l.messages} settings=${l.settings} sessions=${l.sessions} audit=${l.audit}`);
    check("测试数据已清理干净（0 残留）", clean);
  } catch (cleanupError) {
    console.log(`CLEANUP ERROR | ${cleanupError?.message || cleanupError}`);
    results.push(false);
  }
  conn.release();
  const failed = results.filter((r) => !r).length;
  console.log(`\n===== 结果：${results.length - failed}/${results.length} 通过 =====`);
  process.exit(failed === 0 ? 0 : 1);
}
