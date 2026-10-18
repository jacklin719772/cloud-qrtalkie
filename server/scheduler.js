// ==========================================
// Background Scheduler - Periodic scans & notifications
// ==========================================
import { pool } from "./db.js";
import { cleanupFlexisipCallLogs } from "./flexisipCallLogCleanupService.js";
import { cleanupCustomerAssistantData } from "./customerAssistant/cleanupService.js";
import { retryPendingSipAccountDeletes } from "./sipDeleteRetryService.js";
import { notifyTrialContactOnce, reclaimTrialAssignment, setFlexisipActivated } from "./trialService.js";
import { sendTrialNotificationEmail } from "./email.js";

let timers = [];

export function startScheduler() {
  console.log("[Scheduler] Starting background tasks...");

  // Run expiry scans every 30 minutes
  timers.push(setInterval(scanExpiringResources, 30 * 60 * 1000));
  // 服務啟動後 60 秒先跑一輪到期掃描，避免重啟後過期狀態/提醒滯後
  timers.push(setTimeout(scanExpiringResources, 60 * 1000));
  // Run call log cleanup every 24 hours
  timers.push(setInterval(cleanupFlexisipCallLogs, 24 * 60 * 60 * 1000));
  // Customer Assistant 过期令牌/访客/审计 清理（每日）
  timers.push(setInterval(cleanupCustomerAssistantData, 24 * 60 * 60 * 1000));
  // 重試未完成的帳號刪除（pending_delete 補償，每 5 分鐘）
  timers.push(setInterval(retryPendingSipAccountDeletes, 5 * 60 * 1000));
  timers.push(setTimeout(retryPendingSipAccountDeletes, 90 * 1000));
  // Run initial cleanup after 60 seconds
  timers.push(setTimeout(cleanupFlexisipCallLogs, 60 * 1000));

  console.log("[Scheduler] Background tasks started");
}

export function stopScheduler() {
  timers.forEach(t => clearInterval(t));
  timers = [];
}

async function scanExpiringResources() {
  let connection;
  try {
    connection = await pool.getConnection();
    await scanExpiringSipAccounts(connection);
    await scanExpiredSipAccounts(connection);
    await scanExpiredTrials(connection);
    await scanExpiringPlans(connection);
    await disableExpiredTenantEntrances(connection);
    await scanExpiringEcards(connection);
    console.log("[Scheduler] Expiry scan complete");
  } catch (error) {
    console.error("[Scheduler] Scan error:", error.message);
  } finally {
    if (connection) connection.release();
  }
}

// 套餐過期後自動停用該租戶所有入口
async function disableExpiredTenantEntrances(connection) {
  const result = await connection.query(
    `UPDATE access_entrances e
       JOIN (
         SELECT tenant_id
           FROM billing_orders
          WHERE order_status = 'review_approved'
          GROUP BY tenant_id
         HAVING MAX(expires_at) < CURDATE()
            AND SUM(CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END) = 0
       ) expired ON expired.tenant_id = e.tenant_id
        SET e.is_active = 0
      WHERE e.is_active = 1`
  );
  const affected = Number(result.affectedRows || 0);
  if (affected > 0) {
    console.log(`[Scheduler] Disabled ${affected} entrances for expired tenant plans`);
  }
}

// SIP accounts expiring within 7 days（站内信 + 邮件：租户管理员 + 账号登记邮箱；每阶段仅首建时发邮件）
async function scanExpiringSipAccounts(connection) {
  const rows = await connection.query(
    `SELECT su.id, su.username, e.tenant_id,
            DATE_FORMAT(e.service_expires_at, '%Y-%m-%d') AS expires_at,
            DATEDIFF(e.service_expires_at, CURDATE()) AS days_left
     FROM tenant_sip_account_entitlements e
     JOIN sip_users su ON su.id = e.sip_user_id
     JOIN tenants t ON t.id = e.tenant_id AND t.status = 'active' AND t.is_system = 0
     WHERE su.status = 'active'
       AND e.status = 'active'
       AND e.service_expires_at >= CURDATE()
       AND e.service_expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`
  );

  const title = 'SIP 帳號即將過期';
  for (const row of rows) {
    const daysLeft = Number(row.days_left);
    const dedupeKey = `tenant:${row.tenant_id}:sip:${row.id}:expiring`;
    const dayText = daysLeft <= 0
      ? `今日到期（${row.expires_at}）`
      : `將於 ${row.expires_at} 過期（剩餘 ${daysLeft} 天）`;
    const body = `SIP 帳號 ${row.username} ${dayText}，到期後服務將停止，請及時續訂。`;

    const [existingEvent] = await connection.query(
      'SELECT id FROM notification_events WHERE dedupe_key = ? LIMIT 1',
      [dedupeKey],
    );

    await connection.query(
      `INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status)
       VALUES (?, 'sip_account', ?, 'account_expiring', 'system', ?, ?, ?, 'warning', 'active')
       ON DUPLICATE KEY UPDATE body = VALUES(body), title = VALUES(title), updated_at = CURRENT_TIMESTAMP`,
      [row.tenant_id, row.id, dedupeKey, title, body]
    );

    // Create receipts for all tenant admins
    const [ev] = await connection.query("SELECT id FROM notification_events WHERE dedupe_key = ?", [dedupeKey]);
    if (ev) {
      const admins = await connection.query("SELECT id FROM admin_users WHERE tenant_id = ? AND account_type = 'tenant' AND status = 'active'", [row.tenant_id]);
      for (const ad of admins) {
        await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [ev.id, ad.id]);
      }
      // Also create receipt for the SIP user
      if (row.sip_user_id || row.id) {
        const sipId = row.sip_user_id || row.id;
        await connection.query("INSERT IGNORE INTO notification_receipts (event_id, sip_user_id, receiver_type) VALUES (?, ?, 'sip')", [ev.id, sipId]);
      }
    }

    if (!existingEvent) {
      await sendExpiryEmails(connection, {
        tenantId: row.tenant_id,
        sipUserId: row.id,
        subject: `${title}（${row.username}）`,
        body,
      });
    }
  }
}

// SIP accounts already expired（到期即停用：AM + 本地；站内信 + 邮件；AM 失败下一轮补偿重试）
async function scanExpiredSipAccounts(connection) {
  const rows = await connection.query(
    `SELECT e.id AS entitlement_id, su.id AS sip_user_id, su.username, e.tenant_id,
            t.is_system AS tenant_is_system,
            DATE_FORMAT(e.service_expires_at, '%Y-%m-%d') AS expires_at
     FROM tenant_sip_account_entitlements e
     JOIN sip_users su ON su.id = e.sip_user_id
     JOIN tenants t ON t.id = e.tenant_id
     WHERE e.status = 'active' AND e.service_expires_at < CURDATE()`
  );

  const title = 'SIP 帳號已過期';
  for (const row of rows) {
    // Mark entitlement as expired
    await connection.query(
      "UPDATE tenant_sip_account_entitlements SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [row.entitlement_id]
    );

    // 試用帳號（系統租戶）：狀態照常置 expired，停止/回收走試用通道
    if (Number(row.tenant_is_system) === 1) continue;

    // 到期即停用電子名片（終態：前端不再提供啟用入口）
    await connection.query(
      "UPDATE tenant_ecards SET status = 'disabled', updated_at = NOW() WHERE sip_user_id = ? AND status = 'active'",
      [row.sip_user_id]
    );

    // 到期自動停用：AM + 本地狀態
    await deactivateExpiredAccount(connection, row);

    const dedupeKey = `tenant:${row.tenant_id}:sip:${row.sip_user_id}:expired`;
    const body = `SIP 帳號 ${row.username} 已於 ${row.expires_at} 過期，服務已停止，帳號已停用。如需繼續使用請盡快續訂。`;

    const [existingEvent] = await connection.query(
      'SELECT id FROM notification_events WHERE dedupe_key = ? LIMIT 1',
      [dedupeKey],
    );

    await connection.query(
      `INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status)
       VALUES (?, 'sip_account', ?, 'account_expired', 'system', ?, ?, ?, 'error', 'active')
       ON DUPLICATE KEY UPDATE body = VALUES(body), title = VALUES(title), updated_at = CURRENT_TIMESTAMP`,
      [row.tenant_id, row.sip_user_id, dedupeKey, title, body]
    );

    const [ev] = await connection.query("SELECT id FROM notification_events WHERE dedupe_key = ?", [dedupeKey]);
    if (ev) {
      const admins = await connection.query("SELECT id FROM admin_users WHERE tenant_id = ? AND account_type = 'tenant' AND status = 'active'", [row.tenant_id]);
      for (const ad of admins) {
        await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [ev.id, ad.id]);
      }
      // Also create receipt for the SIP user
      if (row.sip_user_id || row.id) {
        const sipId = row.sip_user_id || row.id;
        await connection.query("INSERT IGNORE INTO notification_receipts (event_id, sip_user_id, receiver_type) VALUES (?, ?, 'sip')", [ev.id, sipId]);
      }
    }

    if (!existingEvent) {
      await sendExpiryEmails(connection, {
        tenantId: row.tenant_id,
        sipUserId: row.sip_user_id,
        subject: `${title}（${row.username}）`,
        body,
      });
    }
  }

  // 補償：已過期但本地仍 active（如上一輪 AM 停用失敗）→ 重試停用
  // 以權益表 tenant_id 為準（兼容 sip_users.tenant_id 為空的歷史賬號）；
  // 排除同一賬號仍有其他生效權益的情況
  const retryRows = await connection.query(
    `SELECT su.id AS sip_user_id, su.username, e.tenant_id
     FROM tenant_sip_account_entitlements e
     JOIN sip_users su ON su.id = e.sip_user_id
     JOIN tenants t ON t.id = e.tenant_id AND t.is_system = 0
     WHERE e.status = 'expired' AND su.status = 'active' AND e.service_expires_at < CURDATE()
       AND NOT EXISTS (
         SELECT 1 FROM tenant_sip_account_entitlements e2
         WHERE e2.sip_user_id = su.id AND e2.status = 'active'
       )`
  );
  for (const row of retryRows) {
    await connection.query(
      "UPDATE tenant_ecards SET status = 'disabled', updated_at = NOW() WHERE sip_user_id = ? AND status = 'active'",
      [row.sip_user_id]
    );
    await deactivateExpiredAccount(connection, row);
  }
}

// 到期停用：先 AM（含映射保護/回讀確認），成功後再置本地停用；
// AM 硬失敗時保留本地 active，交由下一輪補償掃描重試
async function deactivateExpiredAccount(connection, row) {
  try {
    await setFlexisipActivated(row.sip_user_id, false, connection);
  } catch (error) {
    if (error?.code === 'FLEXISIP_MAPPING_MISMATCH') {
      console.warn('[Scheduler] AM mapping mismatch, skip AM deactivate:', row.username || row.sip_user_id, error?.message || error);
    } else {
      console.error('[Scheduler] AM deactivate failed (will retry next scan):', row.username || row.sip_user_id, error?.message || error);
      return;
    }
  }
  await connection.query(
    "UPDATE sip_users SET status = 'disabled' WHERE id = ? AND status = 'active'",
    [row.sip_user_id]
  );
}

// 到期提示邮件：租户全部启用中的管理员 + 账号登记邮箱（跳过系统自动生成的占位地址）
async function sendExpiryEmails(connection, { tenantId, sipUserId, subject, body }) {
  const recipients = new Set();
  const admins = await connection.query(
    "SELECT email FROM admin_users WHERE tenant_id = ? AND account_type = 'tenant' AND status = 'active' AND email IS NOT NULL AND email <> ''",
    [tenantId]
  );
  for (const admin of admins) recipients.add(String(admin.email).trim());
  const [sipUser] = await connection.query("SELECT email FROM sip_users WHERE id = ? LIMIT 1", [sipUserId]);
  if (sipUser?.email) recipients.add(String(sipUser.email).trim());

  for (const email of recipients) {
    if (!email) continue;
    if (/@sip\.qrtalkie\.org$/i.test(email)) continue;
    try {
      await sendTrialNotificationEmail(connection, { to: email, subject, body });
    } catch (error) {
      console.error('[Scheduler] expiry email failed:', email, subject, error?.message || error);
    }
  }
}

// 试用账号：7 天到期提醒 / 到期提醒 / 到期逾 7 天自动回收（邮件通知登记联系人）
async function scanExpiredTrials(connection) {
  const rows = await connection.query(
    `SELECT ta.id, ta.sip_user_id, ta.contact_name, ta.contact_email, ta.company, ta.status AS trial_status,
            u.username, DATE_FORMAT(ta.expires_at, '%Y-%m-%d') AS expires_at,
            DATEDIFF(ta.expires_at, CURDATE()) AS days_left
     FROM trial_assignments ta
     JOIN sip_users u ON u.id = ta.sip_user_id
     WHERE ta.status IN ('active', 'paused')
       AND ta.expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`
  );

  for (const row of rows) {
    const daysLeft = Number(row.days_left);
    const trial = {
      id: Number(row.id),
      contact_email: row.contact_email,
      contact_name: row.contact_name,
      company: row.company,
    };
    const who = row.contact_name || row.company || "";
    const username = row.username || "";
    const greeting = who ? `${who} 您好：` : "您好：";

    if (daysLeft <= -8) {
      // 到期逾 7 天：回收（独立事务 + 行锁 + 状态复核，防与转正并发）
      try {
        await connection.beginTransaction();
        const [locked] = await connection.query(
          "SELECT id, status FROM trial_assignments WHERE id = ? FOR UPDATE",
          [Number(row.id)],
        );
        if (!locked || (locked.status !== "active" && locked.status !== "paused")) {
          await connection.rollback();
          continue;
        }
        await reclaimTrialAssignment(connection, { trialId: Number(row.id), sipUserId: Number(row.sip_user_id) });
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => {});
        console.error("Trial reclaim failed:", row.id, error && error.message);
        continue;
      }
      console.log(`[Scheduler] Trial reclaimed: ${username} (trial ${row.id})`);
      await notifyTrialContactOnce(connection, {
        trial,
        kind: "reclaimed",
        subject: `QRTalkie 試用帳號已回收（${username}）`,
        body: `${greeting}\n\n試用帳號 ${username} 已於 ${row.expires_at} 到期逾 7 天，系統已自動回收。\n如需繼續使用，歡迎隨時與我們聯繫。\n\nQRTalkie Cloud`,
      });
      continue;
    }

    if (row.trial_status === "paused") {
      // 暫停中：不發提醒/到期通知（管理員操作態），僅等待到期逾 7 天後回收
      continue;
    }

    if (daysLeft <= 0) {
      await notifyTrialContactOnce(connection, {
        trial,
        kind: "expired",
        subject: `QRTalkie 試用帳號已到期（${username}）`,
        body: `${greeting}\n\n試用帳號 ${username} 已於 ${row.expires_at} 到期，功能已停止。\n到期後 7 天內仍可轉為正式方案；逾期帳號將自動回收。\n\nQRTalkie Cloud`,
      });
      continue;
    }

    await notifyTrialContactOnce(connection, {
      trial,
      kind: "expiring_7d",
      subject: `QRTalkie 試用帳號即將到期（${username}）`,
      body: `${greeting}\n\n試用帳號 ${username} 將於 ${row.expires_at} 到期（剩餘 ${daysLeft} 天）。\n如需繼續使用，請與我們聯繫升級為正式方案。\n\nQRTalkie Cloud`,
    });
  }
}

// Plans expiring within 7 days
async function scanExpiringPlans(connection) {
  const rows = await connection.query(
    `SELECT o.id AS order_id, o.tenant_id, o.expires_at, t.name AS tenant_name, i.item_name AS plan_name
     FROM billing_orders o
     JOIN billing_order_items i ON i.order_id = o.id AND i.item_type = 'plan'
     JOIN tenants t ON t.id = o.tenant_id AND t.status = 'active'
     WHERE o.order_status = 'review_approved'
       AND o.expires_at >= CURDATE()
       AND o.expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`
  );

  for (const row of rows) {
    const daysLeft = Math.ceil((new Date(row.expires_at) - new Date()) / 86400000);
    const dedupeKey = `tenant:${row.tenant_id}:plan:${row.order_id}:expiring`;
    const body = `${row.plan_name || '套餐'} 將在 ${daysLeft} 天后到期（${String(row.expires_at).slice(0, 10)}），請及時續訂。`;

    await connection.query(
      `INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status)
       VALUES (?, 'billing_order', ?, 'plan_expiring', 'system', ?, '套餐即將到期', ?, 'warning', 'active')
       ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = CURRENT_TIMESTAMP`,
      [row.tenant_id, row.order_id, dedupeKey, body]
    );

    const [ev] = await connection.query("SELECT id FROM notification_events WHERE dedupe_key = ?", [dedupeKey]);
    if (ev) {
      const admins = await connection.query("SELECT id FROM admin_users WHERE tenant_id = ? AND account_type = 'tenant' AND status = 'active'", [row.tenant_id]);
      for (const ad of admins) {
        await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [ev.id, ad.id]);
      }
      // Also create receipt for the SIP user
      if (row.sip_user_id || row.id) {
        const sipId = row.sip_user_id || row.id;
        await connection.query("INSERT IGNORE INTO notification_receipts (event_id, sip_user_id, receiver_type) VALUES (?, ?, 'sip')", [ev.id, sipId]);
      }
    }
  }
}

// E-cards expiring within 7 days
async function scanExpiringEcards(connection) {
  const rows = await connection.query(
    `SELECT te.id AS ecard_id, te.tenant_id, su.username, su.display_name,
            COALESCE(te.valid_to, e.service_expires_at) AS expires_at
     FROM tenant_ecards te
     JOIN sip_users su ON su.id = te.sip_user_id
     LEFT JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active'
     WHERE te.status = 'active'
       AND COALESCE(te.valid_to, e.service_expires_at) >= CURDATE()
       AND COALESCE(te.valid_to, e.service_expires_at) <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`
  );

  for (const row of rows) {
    const daysLeft = Math.ceil((new Date(row.expires_at) - new Date()) / 86400000);
    const dedupeKey = `tenant:${row.tenant_id}:ecard:${row.ecard_id}:expiring`;
    const body = `電子名片 ${row.display_name || row.username} 將在 ${daysLeft} 天後過期（${String(row.expires_at).slice(0, 10)}），請及時續訂。`;

    await connection.query(
      `INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status)
       VALUES (?, 'ecard', ?, 'ecard_expiring', 'system', ?, '電子名片即將過期', ?, 'warning', 'active')
       ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = CURRENT_TIMESTAMP`,
      [row.tenant_id, row.ecard_id, dedupeKey, body]
    );

    const [ev] = await connection.query("SELECT id FROM notification_events WHERE dedupe_key = ?", [dedupeKey]);
    if (ev) {
      const admins = await connection.query("SELECT id FROM admin_users WHERE tenant_id = ? AND account_type = 'tenant' AND status = 'active'", [row.tenant_id]);
      for (const ad of admins) {
        await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [ev.id, ad.id]);
      }
      // Also create receipt for the SIP user
      if (row.sip_user_id || row.id) {
        const sipId = row.sip_user_id || row.id;
        await connection.query("INSERT IGNORE INTO notification_receipts (event_id, sip_user_id, receiver_type) VALUES (?, ?, 'sip')", [ev.id, sipId]);
      }
    }
  }
}
