/**
 * Customer Assistant —— 审计日志 / 数据清理（P1 步骤 10）。
 *
 * 审计范围（10_ECARD_VISITOR_CHAT_SOLUTION.md §7.4 第 9 条）：
 *   访客取票、被拒/被拉黑、会话归档、访客拉黑/解除、客服越权尝试。
 *   **不记录逐条消息**（避免噪音与体积）；消息本身已在 ca_messages 里可追溯。
 *
 * 纪律：审计写入**绝不影响业务**——任何失败只记 warning，不抛给调用方。
 *
 * 清理策略（同上 §5.3 生命周期表）：
 *   · ca_sessions：过期后再留 7 天
 *   · ca_resume_tokens：过期后再留 30 天（且已有使用/撤销记录）
 *   · ca_visitors：90 天无活动且无会话
 *   · ca_audit_log：保留 180 天
 */

import { pool } from "../db.js";

export const CA_AUDIT_ACTIONS = {
  SESSION_ISSUED: "session_issued",
  SESSION_BLOCKED: "session_blocked",
  CONVERSATION_ARCHIVED: "conversation_archived",
  VISITOR_BLOCKED: "visitor_blocked",
  VISITOR_UNBLOCKED: "visitor_unblocked",
  FORBIDDEN_ACCESS: "forbidden_access",
  VISITOR_REGISTERED: "visitor_registered",
  CONVERSATION_MESSAGES_CLEARED: "conversation_messages_cleared",
  CONVERSATION_DELETED: "conversation_deleted",
};

/**
 * 写一条审计记录。**永不抛错**（失败仅告警）。
 * @param {{action:string, actorType:"visitor"|"agent"|"system", actorPublicId?:string|null,
 *          targetType?:string|null, targetPublicId?:string|null, ip?:string|null, meta?:object|null}} entry
 */
export async function logCaEvent(entry) {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.query(
        `INSERT INTO ca_audit_log (action, actor_type, actor_public_id, target_type, target_public_id, ip, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          String(entry.action || "").slice(0, 64),
          entry.actorType === "agent" || entry.actorType === "system" ? entry.actorType : "visitor",
          entry.actorPublicId ? String(entry.actorPublicId).slice(0, 48) : null,
          entry.targetType ? String(entry.targetType).slice(0, 32) : null,
          entry.targetPublicId ? String(entry.targetPublicId).slice(0, 48) : null,
          entry.ip ? String(entry.ip).slice(0, 64) : null,
          entry.meta ? JSON.stringify(entry.meta).slice(0, 60000) : null,
        ],
      );
    } finally {
      connection.release();
    }
  } catch (error) {
    console.warn("[customerAssistant][audit] 写入失败:", error?.message || error);
  }
}

/** 查询审计（管理端/排障用，只读） */
export async function listCaAuditLog({ action = null, limit = 100 } = {}) {
  const connection = await pool.getConnection();
  try {
    const params = [];
    let where = "1=1";
    if (action) {
      where += " AND action = ?";
      params.push(String(action));
    }
    params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
    return await connection.query(
      `SELECT id, occurred_at, action, actor_type, actor_public_id, target_type, target_public_id, ip, meta
         FROM ca_audit_log WHERE ${where} ORDER BY id DESC LIMIT ?`,
      params,
    );
  } finally {
    connection.release();
  }
}

/**
 * 清理任务（由 server/scheduler.js 每日调用，与 flexisip 清理任务同模式）。
 * 返回各项删除条数。
 */
export async function cleanupCustomerAssistantData() {
  const connection = await pool.getConnection();
  try {
    const sessions = await connection.query(
      `DELETE FROM ca_sessions WHERE expires_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    );
    const resumeTokens = await connection.query(
      `DELETE FROM ca_resume_tokens
        WHERE expires_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
          AND (revoked_at IS NOT NULL OR last_used_at IS NOT NULL)`,
    );
    const visitors = await connection.query(
      `DELETE v FROM ca_visitors v
        LEFT JOIN ca_conversations c ON c.visitor_id = v.id
       WHERE c.id IS NULL
         AND v.last_seen_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
         AND v.blocked = 0`,
    );
    const audit = await connection.query(
      `DELETE FROM ca_audit_log WHERE occurred_at < DATE_SUB(NOW(), INTERVAL 180 DAY)`,
    );

    const summary = {
      sessions: Number(sessions.affectedRows || 0),
      resumeTokens: Number(resumeTokens.affectedRows || 0),
      visitors: Number(visitors.affectedRows || 0),
      auditRows: Number(audit.affectedRows || 0),
    };
    console.log(
      `[Scheduler] Customer Assistant cleanup: sessions=${summary.sessions} resumeTokens=${summary.resumeTokens} ` +
      `visitors=${summary.visitors} auditRows=${summary.auditRows}`,
    );
    return summary;
  } catch (error) {
    console.error("[Scheduler] Customer Assistant cleanup error:", error?.message || error);
    return { error: String(error?.message || error) };
  } finally {
    connection.release();
  }
}
