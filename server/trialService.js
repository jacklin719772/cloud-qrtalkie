// 试用账号模块：保留租户（is_system=1「產品試用」）定位辅助 + 试用状态流转共用逻辑
// 保留租户由迁移 087 幂等创建；此处缓存 id 供各查询排除与删除守卫使用
import { pool } from "./db.js";
import { sendTrialNotificationEmail } from "./email.js";
import {
  activateAccount as flexisipActivateAccount,
  deactivateAccount as flexisipDeactivateAccount,
  getAccount as flexisipGetAccount,
} from "./flexisipAccountManagerClient.js";

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

// 切換帳號在 Flexisip AM 的啟用狀態：先調用、後回讀確認（不信調用結果）；
// 帳號無 flexisip_account_id 時跳過（skipped）。失敗拋錯（FLEXISIP_STATE_CONFIRM_FAILED），
// 由呼叫方回滾本地並提示。
export async function setFlexisipActivated(sipUserId, activated, connection = null) {
  const runner = connection || pool;
  const [account] = await runner.query(
    "SELECT username, flexisip_account_id FROM sip_users WHERE id = ? LIMIT 1",
    [sipUserId],
  );
  const flexisipAccountId = account?.flexisip_account_id ? String(account.flexisip_account_id) : "";
  if (!flexisipAccountId) return { skipped: true, activated };

  const remote = await flexisipGetAccount(flexisipAccountId);
  // 映射防護：AM 帳號用戶名必須與本地帳號一致，否則停用/啟用會誤傷其他帳號
  //（存量存在「舊編號行與新編號行共用同一 AM 帳號」的錯位數據）
  if (String(remote?.username || "").toLowerCase() !== String(account.username || "").toLowerCase()) {
    const error = new Error("AM 帳號映射異常（用戶名不一致）");
    error.code = "FLEXISIP_MAPPING_MISMATCH";
    throw error;
  }
  const nowActivated = remote?.activated === true || remote?.activated === 1;
  if (nowActivated === activated) return { skipped: false, activated, already: true };

  if (activated) {
    await flexisipActivateAccount(flexisipAccountId);
  } else {
    await flexisipDeactivateAccount(flexisipAccountId);
  }
  const after = await flexisipGetAccount(flexisipAccountId);
  const afterActivated = after?.activated === true || after?.activated === 1;
  if (afterActivated !== activated) {
    const error = new Error(activated ? "AM 帳號啟用確認失敗" : "AM 帳號停用確認失敗");
    error.code = "FLEXISIP_STATE_CONFIRM_FAILED";
    throw error;
  }
  return { skipped: false, activated };
}

// 試用分配時使用：確保帳號在 AM 處於啟用態（覆蓋「本地 active 但 AM 被停用」的殘留態）。
// 在本地寫入前調用；失敗由呼叫方中止分配。
export async function activateTrialAccountInFlexisip(sipUserId, connection = null) {
  return setFlexisipActivated(sipUserId, true, connection);
}

// 暫停（可恢復）：先停用 AM 並回讀確認；本地只翻狀態位——
// 到期日/掛靠/配對/訂單/名片內容全部保留，恢復時原樣翻回（見 resumeTrialAssignment）。
export async function pauseTrialAssignment(connection, { trialId, sipUserId }) {
  // ① AM 停用確認（映射異常時跳過 AM 步驟，與回收一致；其餘失敗拋錯由呼叫方回滾）
  try {
    await setFlexisipActivated(sipUserId, false, connection);
  } catch (flexisipError) {
    if (flexisipError?.code === "FLEXISIP_MAPPING_MISMATCH") {
      console.warn("[trial-pause] AM mapping mismatch, skip AM deactivate:", sipUserId, flexisipError.message);
    } else {
      throw flexisipError;
    }
  }

  const reservedTenantId = await getReservedTrialTenantId(connection);
  // ② 本地：只翻狀態（服務到期日不動，恢復判據即「是否未到期」）
  await connection.query(
    "UPDATE trial_assignments SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [trialId],
  );
  await connection.query(
    "UPDATE tenant_sip_account_entitlements SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ? AND tenant_id = ? AND status = 'active'",
    [sipUserId, reservedTenantId || 0],
  );
  await connection.query(
    "UPDATE tenant_web_account_entitlements SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ? AND tenant_id = ? AND status = 'active'",
    [sipUserId, reservedTenantId || 0],
  );
  // AI：僅停用試用開通的行（歷史來源行不屬試用範圍，暫停不動）
  await connection.query(
    "UPDATE ai_bot_account_entitlements SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ? AND notes = '試用開通'",
    [sipUserId],
  );
  // 名片停用（恢復時翻回；僅動當前 active 的行）
  await connection.query(
    "UPDATE tenant_ecards SET status = 'disabled', updated_at = NOW() WHERE sip_user_id = ? AND status = 'active'",
    [sipUserId],
  );
  // 推送設備 + 登入會話（暫停期間不應再有來電推送/會話）
  const [account] = await connection.query(
    "SELECT username, sip_domain FROM sip_users WHERE id = ? LIMIT 1",
    [sipUserId],
  );
  if (account?.username) {
    await connection.query(
      "DELETE FROM push_devices WHERE sip_username = ? AND sip_domain = ?",
      [account.username, account.sip_domain || process.env.SIP_DOMAIN || ""],
    );
  }
  await connection.query(
    "DELETE FROM admin_sessions WHERE user_type = 'sip' AND sip_user_id = ?",
    [sipUserId],
  );
}

// 恢復（僅限未到期，由呼叫方前置校驗）：先啟用 AM 並回讀確認；再把暫停時翻掉的狀態原樣翻回。
// 到期日/掛靠/配對/訂單/名片內容在暫停時未動，無需重建。
export async function resumeTrialAssignment(connection, { trialId, sipUserId }) {
  // AM 啟用確認；映射異常或其他失敗直接拋錯，由呼叫方回滾（保持暫停態）
  await setFlexisipActivated(sipUserId, true, connection);

  const reservedTenantId = await getReservedTrialTenantId(connection);
  await connection.query(
    "UPDATE trial_assignments SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [trialId],
  );
  await connection.query(
    "UPDATE tenant_sip_account_entitlements SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ? AND tenant_id = ? AND status = 'inactive'",
    [sipUserId, reservedTenantId || 0],
  );
  await connection.query(
    "UPDATE tenant_web_account_entitlements SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ? AND tenant_id = ? AND status = 'inactive'",
    [sipUserId, reservedTenantId || 0],
  );
  await connection.query(
    "UPDATE ai_bot_account_entitlements SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ? AND notes = '試用開通' AND (expires_at IS NULL OR expires_at > NOW())",
    [sipUserId],
  );
  await connection.query(
    "UPDATE tenant_ecards SET status = 'active', updated_at = NOW() WHERE sip_user_id = ? AND status = 'disabled'",
    [sipUserId],
  );
}

// 回收（完整清理）：帳號回初始形態 + 清 AI 權限/Key + 停用 Ecard + 清推送設備/會話
// 手动「立即回庫」与到期自动回收共用此逻辑
export async function reclaimTrialAssignment(connection, { trialId, sipUserId }) {
  // ① 先停用通訊核心（AM）並回讀確認；失敗即拋錯，由呼叫方回滾本地（本地不動）+ 提示。
  //    方向安全：即使後續本地出錯回滾，帳號也只會停在「AM 已停用」一側，重試冪等。
  //    例外：映射異常（存量錯位數據，無法安全停用目標）→ 跳過 AM 步驟繼續本地回收，
  //    避免自動回收任務因無法修復的映射無限重試。
  try {
    await setFlexisipActivated(sipUserId, false, connection);
  } catch (flexisipError) {
    if (flexisipError?.code === "FLEXISIP_MAPPING_MISMATCH") {
      console.warn("[trial-reclaim] AM mapping mismatch, skip AM deactivate:", sipUserId, flexisipError.message);
    } else {
      throw flexisipError;
    }
  }

  const reservedTenantId = await getReservedTrialTenantId(connection);
  const [account] = await connection.query(
    "SELECT username, sip_domain FROM sip_users WHERE id = ? LIMIT 1",
    [sipUserId],
  );

  // ② SIP/Web 帳號恢復初始狀態（解掛靠、清到期、清激活時間）
  await connection.query(
    "UPDATE sip_users SET tenant_id = NULL, service_expires_at = NULL, activated_at = NULL WHERE id = ?",
    [sipUserId],
  );
  await connection.query(
    "DELETE FROM tenant_sip_account_entitlements WHERE sip_user_id = ? AND tenant_id = ?",
    [sipUserId, reservedTenantId || 0],
  );
  await connection.query(
    `UPDATE web_users w
     JOIN tenant_web_account_entitlements e ON e.web_user_id = w.id
     SET w.tenant_id = NULL, w.service_expires_at = NULL, w.activated_at = NULL
     WHERE e.sip_user_id = ? AND e.tenant_id = ?`,
    [sipUserId, reservedTenantId || 0],
  );
  await connection.query(
    "DELETE FROM tenant_web_account_entitlements WHERE sip_user_id = ? AND tenant_id = ?",
    [sipUserId, reservedTenantId || 0],
  );

  // 门禁房间：解除绑定，避免账号回收再分配后，原租户房间仍指向该账号
  await connection.query(
    "UPDATE access_rooms SET sip_user_id = NULL WHERE sip_user_id = ?",
    [sipUserId],
  );

  // ③ AI：刪除試用開通的行；其餘來源（歷史授予）僅禁用；該帳號 API Key 全刪
  await connection.query(
    "DELETE FROM ai_bot_account_entitlements WHERE sip_user_id = ? AND notes = '試用開通'",
    [sipUserId],
  );
  await connection.query(
    "UPDATE ai_bot_account_entitlements SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE sip_user_id = ?",
    [sipUserId],
  );
  await connection.query("DELETE FROM ai_api_keys WHERE sip_user_id = ?", [sipUserId]);

  // ④ Ecard：停用（現網約定軟刪；硬刪受訪客聊天歷史 RESTRICT 保護）
  await connection.query(
    "UPDATE tenant_ecards SET status = 'disabled', updated_at = NOW() WHERE sip_user_id = ?",
    [sipUserId],
  );

  // ⑤ 推送設備 + SIP 登入會話
  if (account?.username) {
    await connection.query(
      "DELETE FROM push_devices WHERE sip_username = ? AND sip_domain = ?",
      [account.username, account.sip_domain || process.env.SIP_DOMAIN || ""],
    );
  }
  await connection.query(
    "DELETE FROM admin_sessions WHERE user_type = 'sip' AND sip_user_id = ?",
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
