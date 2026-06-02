// ==========================================
// Background Scheduler - Periodic scans & notifications
// ==========================================
import { pool } from "./db.js";

let timers = [];

export function startScheduler() {
  console.log("[Scheduler] Starting background tasks...");

  // Run expiry scans every 30 minutes
  timers.push(setInterval(scanExpiringResources, 30 * 60 * 1000));
  // Run initial scan after 30 seconds (give server time to start)
  timers.push(setTimeout(scanExpiringResources, 30 * 1000));

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
    await scanExpiringPlans(connection);
    await scanExpiringEcards(connection);
    console.log("[Scheduler] Expiry scan complete");
  } catch (error) {
    console.error("[Scheduler] Scan error:", error.message);
  } finally {
    if (connection) connection.release();
  }
}

// SIP accounts expiring within 7 days
async function scanExpiringSipAccounts(connection) {
  const rows = await connection.query(
    `SELECT su.id, su.username, su.tenant_id, t.name AS tenant_name, e.service_expires_at
     FROM sip_users su
     JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active'
     JOIN tenants t ON t.id = su.tenant_id AND t.status = 'active'
     WHERE su.status = 'active'
       AND e.service_expires_at >= CURDATE()
       AND e.service_expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`
  );

  for (const row of rows) {
    const daysLeft = Math.ceil((new Date(row.service_expires_at) - new Date()) / 86400000);
    const dedupeKey = `tenant:${row.tenant_id}:sip:${row.id}:expiring`;
    const body = `SIP 帳號 ${row.username} 将在 ${daysLeft} 天後過期（${String(row.service_expires_at).slice(0, 10)}），请及时續訂。`;

    await connection.query(
      `INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status)
       VALUES (?, 'sip_account', ?, 'account_expiring', 'system', ?, 'SIP 帳號即將過期', ?, 'warning', 'active')
       ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = CURRENT_TIMESTAMP`,
      [row.tenant_id, row.id, dedupeKey, body]
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
  }
}

// SIP accounts already expired (auto-update status)
async function scanExpiredSipAccounts(connection) {
  const rows = await connection.query(
    `SELECT e.id AS entitlement_id, su.id AS sip_user_id, su.username, su.tenant_id, t.name AS tenant_name
     FROM tenant_sip_account_entitlements e
     JOIN sip_users su ON su.id = e.sip_user_id
     JOIN tenants t ON t.id = su.tenant_id
     WHERE e.status = 'active' AND e.service_expires_at < CURDATE()`
  );

  for (const row of rows) {
    // Mark entitlement as expired
    await connection.query(
      "UPDATE tenant_sip_account_entitlements SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [row.entitlement_id]
    );

    const dedupeKey = `tenant:${row.tenant_id}:sip:${row.sip_user_id}:expired`;
    const body = `SIP 帳號 ${row.username} 已过期，系統已自動将其停用。`;

    await connection.query(
      `INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status)
       VALUES (?, 'sip_account', ?, 'account_expired', 'system', ?, 'SIP 帳號已過期', ?, 'error', 'active')
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
      [row.tenant_id, row.sip_user_id, dedupeKey, body]
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
    const body = `${row.plan_name || '套餐'} 将在 ${daysLeft} 天后到期（${String(row.expires_at).slice(0, 10)}），请及时續訂。`;

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
    const body = `電子名片 ${row.display_name || row.username} 将在 ${daysLeft} 天後過期（${String(row.expires_at).slice(0, 10)}），请及时續訂。`;

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
