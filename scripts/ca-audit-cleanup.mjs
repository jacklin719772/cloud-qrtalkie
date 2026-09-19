/**
 * Customer Assistant 验收脚本（收编自 P1 实施期临时脚本）
 *
 * ⚠️ 会写入并清理测试数据（跑完核对 0 残留），需要连接到 CA 所在的数据库与本地 SaaS（127.0.0.1:3001）。
 * 夹具（环境变量，默认取 ecard 20 / 账号 30010001 —— 仅适用于本项目测试环境）：
 *   CA_TEST_SLUG / CA_TEST_ECARD_ID / CA_TEST_SIP_USER_ID
 * 运行：cd <repo> && sudo node scripts/ca-audit-cleanup.mjs
 */
import { pool } from "../server/db.js";
import { createHash, randomBytes } from "node:crypto";
import { cleanupCustomerAssistantData } from "../server/customerAssistant/cleanupService.js";
import * as convs from "../server/customerAssistant/conversationService.js";
import { newPublicId } from "../server/customerAssistant/ids.js";

const BASE = "http://127.0.0.1:3001";
const SLUG = process.env.CA_TEST_SLUG || "ec-28-ffx9i5";
const ECARD_ID = Number(process.env.CA_TEST_ECARD_ID || 20);
const OWNER = Number(process.env.CA_TEST_SIP_USER_ID || 28);

const results = [];
const check = (name, cond, extra) => {
  results.push(Boolean(cond));
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${extra !== undefined ? "  → " + extra : ""}`);
};
async function req(method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}
async function mintSession(connection, sipUserId) {
  const token = randomBytes(32).toString("hex");
  const ins = await connection.query(
    `INSERT INTO admin_sessions (admin_user_id, user_type, sip_user_id, token_hash, expires_at, device) VALUES (NULL,'sip',?,?,NOW()+INTERVAL 1 HOUR,'ca-e2e')`,
    [sipUserId, createHash("sha256").update(token).digest("hex")],
  );
  return { token, sessionId: Number(ins.insertId) };
}

const conn = await pool.getConnection();
let visitorPublicId = null;
let ownerSessionId = null;
let otherSessionId = null;
let expiredSessionId = null;
let staleAuditId = null;
let conversationId = null; // finally 里清理审计要用

try {
  await conn.query(`INSERT INTO ca_ecard_settings (ecard_id, enabled, notify_enabled, display_name) VALUES (?,1,1,?)`, [ECARD_ID, "30010001 客服"]);

  // ---------- 取票 → session_issued ----------
  const v1 = await req("POST", `/api/ecard/public/${SLUG}/chat-session`, { body: {} });
  visitorPublicId = v1.json?.visitorId;
  const visitorToken = v1.json?.accessToken;
  conversationId = v1.json?.conversationId;
  const auditIssued = await conn.query(`SELECT id FROM ca_audit_log WHERE action='session_issued' AND actor_public_id=? ORDER BY id DESC LIMIT 1`, [visitorPublicId]);
  check("取票写审计 session_issued", v1.status === 200 && auditIssued.length === 1);

  // ---------- 拉黑 / 解除 ----------
  const owner = await mintSession(conn, OWNER);
  ownerSessionId = owner.sessionId;
  const other = await mintSession(conn, Number((await conn.query(`SELECT id FROM sip_users WHERE username='30010002' LIMIT 1`))[0].id));
  otherSessionId = other.sessionId;

  const block = await req("POST", `/api/visitor-assistant/visitors/${visitorPublicId}/block`, { token: owner.token });
  const unblock = await req("POST", `/api/visitor-assistant/visitors/${visitorPublicId}/unblock`, { token: owner.token });
  const blockedRow = await conn.query(`SELECT id FROM ca_audit_log WHERE action='visitor_blocked' AND target_public_id=?`, [visitorPublicId]);
  const unblockedRow = await conn.query(`SELECT id FROM ca_audit_log WHERE action='visitor_unblocked' AND target_public_id=?`, [visitorPublicId]);
  check("拉黑/解除写审计", block.status === 200 && unblock.status === 200 && blockedRow.length === 1 && unblockedRow.length === 1);

  // ---------- 归档 ----------
  const archive = await req("POST", `/api/visitor-assistant/conversations/${conversationId}/archive`, { token: owner.token });
  const archivedRow = await conn.query(`SELECT id FROM ca_audit_log WHERE action='conversation_archived' AND target_public_id=?`, [conversationId]);
  check("归档写审计 conversation_archived", archive.status === 200 && archivedRow.length === 1);

  // ---------- 越权（别的账号访问该会话）----------
  const forbidden = await req("GET", `/api/visitor-assistant/conversations/${conversationId}/messages`, { token: other.token });
  const forbiddenRow = await conn.query(`SELECT id, actor_public_id FROM ca_audit_log WHERE action='forbidden_access' AND target_public_id=?`, [conversationId]);
  check("越权访问被拒且写审计 forbidden_access", forbidden.status === 404 && forbiddenRow.length === 1, `status=${forbidden.status} actor=${forbiddenRow[0]?.actor_public_id}`);

  // ---------- 清理任务 ----------
  // 造两条"该被清理"的数据：过期 10 天的 access 令牌 + 200 天前的审计行
  const visitorRow = await conn.query(`SELECT id FROM ca_visitors WHERE ecard_id=? AND public_id=? LIMIT 1`, [ECARD_ID, visitorPublicId]);
  const visitorId = Number(visitorRow[0].id);
  const expired = await conn.query(
    `INSERT INTO ca_sessions (visitor_id, token_hash, expires_at) VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 10 DAY))`,
    [visitorId, createHash("sha256").update("expired-token").digest("hex")],
  );
  expiredSessionId = Number(expired.insertId);
  const stale = await conn.query(
    `INSERT INTO ca_audit_log (occurred_at, action, actor_type, actor_public_id) VALUES (DATE_SUB(NOW(), INTERVAL 200 DAY), 'session_issued', 'visitor', 'vis_stale_test')`,
  );
  staleAuditId = Number(stale.insertId);

  const summary = await cleanupCustomerAssistantData();
  const expiredGone = await conn.query(`SELECT id FROM ca_sessions WHERE id=?`, [expiredSessionId]);
  const staleGone = await conn.query(`SELECT id FROM ca_audit_log WHERE id=?`, [staleAuditId]);
  check("清理任务删除过期 access 令牌（>7 天）", expiredGone.length === 0 && summary.sessions >= 1, JSON.stringify(summary));
  check("清理任务删除超期审计行（>180 天）", staleGone.length === 0 && summary.auditRows >= 1);
} catch (error) {
  console.log(`ERROR | ${error?.message || error}`);
  results.push(false);
} finally {
  try {
    if (visitorPublicId) await conn.query(`DELETE FROM ca_visitors WHERE ecard_id=? AND public_id=?`, [ECARD_ID, visitorPublicId]);
    await conn.query(`DELETE FROM ca_ecard_settings WHERE ecard_id=?`, [ECARD_ID]);
    await conn.query(
      `DELETE FROM ca_audit_log WHERE actor_public_id IN (?, 'vis_stale_test') OR target_public_id IN (?, ?)`,
      [visitorPublicId || "", visitorPublicId || "", conversationId || ""],
    );
    for (const sid of [ownerSessionId, otherSessionId, expiredSessionId].filter(Boolean)) await conn.query(`DELETE FROM admin_sessions WHERE id=?`, [sid]);
    const left = await conn.query(
      `SELECT (SELECT COUNT(*) FROM ca_visitors) visitors, (SELECT COUNT(*) FROM ca_conversations) conversations,
              (SELECT COUNT(*) FROM ca_messages) messages, (SELECT COUNT(*) FROM ca_ecard_settings) settings,
              (SELECT COUNT(*) FROM ca_audit_log) audit`,
    );
    const l = left[0];
    console.log(`\n# 清理核对：visitors=${l.visitors} conversations=${l.conversations} messages=${l.messages} settings=${l.settings} audit=${l.audit}`);
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
