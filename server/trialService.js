// 试用账号模块：保留租户（is_system=1「產品試用」）定位辅助 + 试用状态流转共用逻辑
// 保留租户由迁移 087 幂等创建；此处缓存 id 供各查询排除与删除守卫使用
import { pool } from "./db.js";
import { sendTrialNotificationEmail } from "./email.js";

let cachedReservedTenantId = null;

export async function getReservedTrialTenantId(connection = null) {
  if (cachedReservedTenantId) return cachedReservedTenantId;
  const runner = connection || pool;
  const rows = await runner.query("SELECT id FROM tenants WHERE is_system = 1 LIMIT 1");
  const id = rows[0] ? Number(rows[0].id) : null;
  if (id) cachedReservedTenantId = id;
  return id;
}

export async function isReservedTrialTenant(tenantId) {
  const reservedId = await getReservedTrialTenantId();
  return Boolean(reservedId) && Number(tenantId) === reservedId;
}

// 提前到期：功能即停（权益置 expired / AI 关闭），帐号留在宽限期（挂靠保留，可转正）
export async function expireTrialAssignment(connection, { trialId, sipUserId, expiresAt }) {
  await connection.query(
    "UPDATE trial_assignments SET expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [expiresAt, trialId],
  );
  await connection.query(
    "UPDATE sip_users SET service_expires_at = ? WHERE id = ?",
    [expiresAt, sipUserId],
  );
  await connection.query(
    "UPDATE tenant_sip_account_entitlements SET status = 'expired', service_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ?",
    [expiresAt, sipUserId],
  );
  await connection.query(
    "UPDATE ai_bot_account_entitlements SET enabled = 0, expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ?",
    [`${expiresAt} 23:59:59`, sipUserId],
  );
}

// 回收：抹去挂靠与到期字段并删除试用权益行，帐号回到与库存完全一致的形态（可再次分配）
export async function reclaimTrialAssignment(connection, { trialId, sipUserId }) {
  await connection.query(
    "UPDATE sip_users SET tenant_id = NULL, service_expires_at = NULL WHERE id = ?",
    [sipUserId],
  );
  // 权益行直接删除（置 revoked 会在库存账号上留残行，与「回到库存形态」不符）；
  // 业务痕迹保留在 trial_assignments
  const reservedTenantId = await getReservedTrialTenantId(connection);
  await connection.query(
    "DELETE FROM tenant_sip_account_entitlements WHERE sip_user_id = ? AND tenant_id = ?",
    [sipUserId, reservedTenantId || 0],
  );
  await connection.query(
    "UPDATE ai_bot_account_entitlements SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ?",
    [sipUserId],
  );
  await connection.query(
    "UPDATE trial_assignments SET status = 'reclaimed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [trialId],
  );
}

// 按类去重发送试用邮件：同一 trial 每类通知仅一次（先发送后落日志；
// SMTP 失败也落日志，避免 30 分钟轮询反复重试刷爆 outbox）
export async function notifyTrialContactOnce(connection, { trial, kind, subject, body }) {
  const email = String(trial.contact_email || "").trim();
  if (!email) return { sent: false, reason: "no contact email" };

  const existing = await connection.query(
    "SELECT id FROM trial_notification_log WHERE trial_assignment_id = ? AND kind = ? LIMIT 1",
    [trial.id, kind],
  );
  if (existing.length > 0) return { sent: false, reason: "already notified" };

  const delivery = await sendTrialNotificationEmail(connection, { to: email, subject, body });
  await connection.query(
    "INSERT INTO trial_notification_log (trial_assignment_id, kind, recipient_email, email_status) VALUES (?, ?, ?, ?)",
    [trial.id, kind, email, delivery.sent ? "sent" : "failed"],
  );
  return delivery;
}
