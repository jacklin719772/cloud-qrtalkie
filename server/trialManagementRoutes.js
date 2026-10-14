// 試用帳號模組：管理端 API（庫存選號 / 分配 / 列表 / 提前結束·立即回庫）
// 方案：试用账号模块设计方案-实施参考.md（2026-10-14）
// 設計要點：試用帳號掛在保留租戶（is_system=1）名下；分配時為保留租戶靜默建一張
// order_type='trial' 的批次訂單（金額 0、已付款、已審核），後續回收/轉正均以 trial_assignments 為業務憑據。
import { pool } from "./db.js";
import { expireTrialAssignment, getReservedTrialTenantId, reclaimTrialAssignment } from "./trialService.js";

const MAX_ASSIGN_COUNT = 100;

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function makeBusinessNo(prefix) {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${prefix}${date}${random}`;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonthsMinusOneDay(value, monthCount) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + monthCount);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function isDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function normalizeIds(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map((value) => Number(value)).filter((id) => Number.isInteger(id) && id > 0)));
}

// 試用階段：active 且未到期 = 試用中；active 且已到期 = 寬限期；其餘為終態
function trialPhase(row, today) {
  if (row.status === "converted") return "converted";
  if (row.status === "reclaimed") return "reclaimed";
  const expires = String(row.expires_at || "").slice(0, 10);
  return expires && expires < today ? "grace" : "active";
}

export function registerTrialManagementRoutes(app, { requireAdmin }) {
  // 庫存帳號查詢（分配表單選號用）：tenant_id IS NULL 且 active
  app.get("/api/admin/trials/stock-accounts", requireAdmin, async (request, response) => {
    const keyword = clean(request.query?.q, 120);
    const limit = Math.min(200, Math.max(1, Number.parseInt(request.query?.limit || "100", 10) || 100));
    let connection;
    try {
      connection = await pool.getConnection();
      const params = [];
      let where = "tenant_id IS NULL AND status = 'active'";
      if (keyword) {
        where += " AND (username LIKE ? OR display_name LIKE ?)";
        const pattern = `%${keyword}%`;
        params.push(pattern, pattern);
      }
      const [countRow] = await connection.query(`SELECT COUNT(*) AS total FROM sip_users WHERE ${where}`, params);
      const accounts = await connection.query(
        `SELECT id, username, sip_domain, display_name
         FROM sip_users
         WHERE ${where}
         ORDER BY username ASC
         LIMIT ${limit}`,
        params,
      );
      return response.json({
        accounts: accounts.map((row) => ({
          id: Number(row.id),
          username: row.username || "",
          sipDomain: row.sip_domain || "",
          displayName: row.display_name || "",
        })),
        total: Number(countRow?.total || 0),
      });
    } catch (error) {
      console.error("Failed to query trial stock accounts:", error);
      return response.status(500).json({ message: "讀取庫存帳號失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 試用分配列表：平台管理員看全部，租戶管理員僅看本租戶發出的
  app.get("/api/admin/trials", requireAdmin, async (request, response) => {
    const isPlatform = request.admin.accountType === "platform";
    const ownTenantId = Number(request.admin.tenantId) || null;
    if (!isPlatform && !ownTenantId) {
      return response.status(403).json({ message: "沒有可用的租戶身分。" });
    }

    const page = Math.max(1, Number.parseInt(request.query?.page || "1", 10) || 1);
    const pageSize = Math.min(1000, Math.max(1, Number.parseInt(request.query?.pageSize || "50", 10) || 50));
    const offset = (page - 1) * pageSize;
    const statusFilter = clean(request.query?.status, 20) || "all";
    const keyword = clean(request.query?.q, 120);
    const ownerFilter = isPlatform ? Number(request.query?.ownerTenantId) || null : ownTenantId;

    const whereClauses = [];
    const params = [];
    if (ownerFilter) {
      whereClauses.push("ta.owner_tenant_id = ?");
      params.push(ownerFilter);
    }
    if (statusFilter === "active" || statusFilter === "converted" || statusFilter === "reclaimed") {
      whereClauses.push("ta.status = ?");
      params.push(statusFilter);
    }
    if (keyword) {
      const pattern = `%${keyword}%`;
      whereClauses.push("(ta.contact_name LIKE ? OR ta.company LIKE ? OR ta.contact_email LIKE ? OR u.username LIKE ?)");
      params.push(pattern, pattern, pattern, pattern);
    }
    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    let connection;
    try {
      connection = await pool.getConnection();
      const [countRow] = await connection.query(
        `SELECT COUNT(*) AS total
         FROM trial_assignments ta
         JOIN sip_users u ON u.id = ta.sip_user_id
         ${whereSql}`,
        params,
      );
      const rows = await connection.query(
        `SELECT
           ta.id, ta.sip_user_id, ta.owner_tenant_id, ta.contact_name, ta.contact_email, ta.contact_phone,
           ta.company, DATE_FORMAT(ta.started_at, '%Y-%m-%d') AS started_at,
           DATE_FORMAT(ta.expires_at, '%Y-%m-%d') AS expires_at,
           ta.status, ta.ai_enabled, ta.batch_order_id, ta.converted_order_id, ta.notes,
           ta.created_at,
           u.username, u.sip_domain, u.display_name AS account_display_name,
           t.name AS owner_tenant_name
         FROM trial_assignments ta
         JOIN sip_users u ON u.id = ta.sip_user_id
         JOIN tenants t ON t.id = ta.owner_tenant_id
         ${whereSql}
         ORDER BY ta.created_at DESC, ta.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        params,
      );
      const today = todayDate();
      return response.json({
        trials: rows.map((row) => ({
          id: Number(row.id),
          sipUserId: Number(row.sip_user_id),
          ownerTenantId: Number(row.owner_tenant_id),
          ownerTenantName: row.owner_tenant_name || "",
          contactName: row.contact_name || "",
          contactEmail: row.contact_email || "",
          contactPhone: row.contact_phone || "",
          company: row.company || "",
          startedAt: row.started_at || "",
          expiresAt: row.expires_at || "",
          status: row.status,
          phase: trialPhase(row, today),
          aiEnabled: Number(row.ai_enabled) === 1,
          batchOrderId: row.batch_order_id ? Number(row.batch_order_id) : null,
          convertedOrderId: row.converted_order_id ? Number(row.converted_order_id) : null,
          notes: row.notes || "",
          createdAt: row.created_at,
          username: row.username || "",
          sipDomain: row.sip_domain || "",
          accountDisplayName: row.account_display_name || "",
        })),
        total: Number(countRow?.total || 0),
        page,
        pageSize,
      });
    } catch (error) {
      console.error("Failed to list trial assignments:", error);
      return response.status(500).json({ message: "讀取試用列表失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 分配試用：選號（或自動取 N 個庫存）→ 靜默批次訂單 → 掛靠保留租戶 → 權益/試用記錄
  app.post("/api/admin/trials", requireAdmin, async (request, response) => {
    const isPlatform = request.admin.accountType === "platform";
    let ownerTenantId = Number(request.body?.ownerTenantId) || null;
    if (!isPlatform) ownerTenantId = Number(request.admin.tenantId) || null;
    if (!ownerTenantId) {
      return response.status(400).json({ message: "請選擇歸屬租戶。" });
    }

    const contactName = clean(request.body?.contactName, 120);
    const contactEmail = clean(request.body?.contactEmail, 255);
    const contactPhone = clean(request.body?.contactPhone, 40);
    const company = clean(request.body?.company, 160);
    const notes = clean(request.body?.notes, 1000);
    const aiEnabled = request.body?.aiEnabled === true;
    const today = todayDate();
    const startedAt = isDateString(request.body?.startedAt) ? String(request.body.startedAt) : today;
    const expiresAt = isDateString(request.body?.expiresAt)
      ? String(request.body.expiresAt)
      : addMonthsMinusOneDay(startedAt, 1);
    if (expiresAt < startedAt) {
      return response.status(400).json({ message: "試用結束日期不能早於開始日期。" });
    }
    if (contactEmail && !isEmailLike(contactEmail)) {
      return response.status(400).json({ message: "聯繫郵箱格式無效。" });
    }
    const requestedIds = normalizeIds(request.body?.sipUserIds);
    const requestedCount = Number.parseInt(request.body?.count, 10);
    if (requestedIds.length === 0 && !(Number.isInteger(requestedCount) && requestedCount > 0)) {
      return response.status(400).json({ message: "請選擇帳號或指定帳號數量。" });
    }
    if (requestedIds.length > MAX_ASSIGN_COUNT || requestedCount > MAX_ASSIGN_COUNT) {
      return response.status(400).json({ message: `單次分配不得超過 ${MAX_ASSIGN_COUNT} 個帳號。` });
    }

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const ownerRows = await connection.query(
        "SELECT id, name, status, is_system FROM tenants WHERE id = ? LIMIT 1",
        [ownerTenantId],
      );
      const owner = ownerRows[0];
      if (!owner || Number(owner.is_system) === 1) {
        await connection.rollback();
        return response.status(404).json({ message: "歸屬租戶不存在。" });
      }
      if (owner.status !== "active") {
        await connection.rollback();
        return response.status(409).json({ message: "歸屬租戶已停用，無法分配試用。" });
      }

      const reservedTenantId = await getReservedTrialTenantId(connection);
      if (!reservedTenantId) {
        await connection.rollback();
        return response.status(500).json({ message: "系統保留租戶缺失，請先執行資料庫遷移。" });
      }

      // 選號：指定帳號或自動取庫存；皆須為 tenant_id IS NULL 且 active
      let accounts = [];
      if (requestedIds.length > 0) {
        accounts = await connection.query(
          `SELECT id, username, sip_domain, display_name
           FROM sip_users
           WHERE id IN (${requestedIds.map(() => "?").join(",")})
             AND tenant_id IS NULL AND status = 'active'
           FOR UPDATE`,
          requestedIds,
        );
        if (accounts.length !== requestedIds.length) {
          await connection.rollback();
          return response.status(409).json({ message: "部分所選帳號已被分配或不可用，請重新整理後重試。" });
        }
      } else {
        accounts = await connection.query(
          `SELECT id, username, sip_domain, display_name
           FROM sip_users
           WHERE tenant_id IS NULL AND status = 'active'
           ORDER BY RAND()
           LIMIT ${requestedCount}
           FOR UPDATE`,
        );
        if (accounts.length !== requestedCount) {
          await connection.rollback();
          return response.status(409).json({ message: `庫存帳號不足，目前僅剩 ${accounts.length} 個可用。` });
        }
      }
      const accountIds = accounts.map((row) => Number(row.id));

      // 靜默批次訂單：order_type='trial'，金額 0、已付款、已審核；期限=該批試用週期
      const orderNo = makeBusinessNo("TRI");
      const orderResult = await connection.query(
        `INSERT INTO billing_orders (
           tenant_id, order_no, order_type, currency, subtotal_amount, discount_amount, payable_amount,
           paid_amount, order_status, payment_status, payment_method, payment_channel,
           effective_at, expires_at, notes, created_by_admin_user_id,
           reviewed_at, reviewed_by_platform_admin_id
         )
         VALUES (?, ?, 'trial', 'USD', 0, 0, 0, 0, 'review_approved', 'paid', 'offline', 'trial', ?, ?, ?, ?, NOW(), ?)`,
        [reservedTenantId, orderNo, startedAt, expiresAt, `試用批次（${accounts.length} 個帳號）`, request.admin.id, request.admin.id],
      );
      const batchOrderId = Number(orderResult.insertId);

      await connection.query(
        `UPDATE sip_users
         SET tenant_id = ?,
             status = 'active',
             activated_at = COALESCE(activated_at, NOW()),
             service_expires_at = ?
         WHERE id IN (${accountIds.map(() => "?").join(",")})`,
        [reservedTenantId, expiresAt, ...accountIds],
      );

      await connection.query(
        `INSERT INTO tenant_sip_account_entitlements (
           tenant_id, sip_user_id, first_order_id, current_order_id, status,
           service_starts_at, service_expires_at, assigned_by_admin_user_id
         )
         SELECT ?, u.id, ?, ?, 'active', ?, ?, ?
         FROM sip_users u
         WHERE u.id IN (${accountIds.map(() => "?").join(",")})
         ON DUPLICATE KEY UPDATE
           tenant_id = VALUES(tenant_id),
           current_order_id = VALUES(current_order_id),
           status = 'active',
           service_starts_at = VALUES(service_starts_at),
           service_expires_at = VALUES(service_expires_at),
           assigned_by_admin_user_id = VALUES(assigned_by_admin_user_id)`,
        [reservedTenantId, batchOrderId, batchOrderId, startedAt, expiresAt, request.admin.id, ...accountIds],
      );

      const createdTrials = [];
      for (const account of accounts) {
        const insertResult = await connection.query(
          `INSERT INTO trial_assignments (
             sip_user_id, owner_tenant_id, contact_name, contact_email, contact_phone, company,
             started_at, expires_at, status, ai_enabled, batch_order_id, created_by_admin_user_id, notes
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
          [
            Number(account.id),
            ownerTenantId,
            contactName || null,
            contactEmail || null,
            contactPhone || null,
            company || null,
            startedAt,
            expiresAt,
            aiEnabled ? 1 : 0,
            batchOrderId,
            request.admin.id,
            notes || null,
          ],
        );
        createdTrials.push({ id: Number(insertResult.insertId), sipUserId: Number(account.id), username: account.username || "" });
      }

      if (aiEnabled) {
        await connection.query(
          `INSERT INTO ai_bot_account_entitlements (sip_user_id, enabled, expires_at, granted_by_admin_id, notes)
           SELECT u.id, 1, ?, ?, '試用開通'
           FROM sip_users u
           WHERE u.id IN (${accountIds.map(() => "?").join(",")})
           ON DUPLICATE KEY UPDATE
             enabled = 1,
             expires_at = VALUES(expires_at),
             granted_by_admin_id = VALUES(granted_by_admin_id),
             notes = VALUES(notes)`,
          [`${expiresAt} 23:59:59`, request.admin.id, ...accountIds],
        );
      }

      await connection.commit();
      console.log(JSON.stringify({
        src: "trial-assign",
        ts: new Date().toISOString(),
        adminId: request.admin.id,
        ownerTenantId,
        count: createdTrials.length,
        batchOrderId,
      }));
      return response.json({
        message: `已分配 ${createdTrials.length} 個試用帳號（${startedAt} 至 ${expiresAt}）。`,
        data: {
          ownerTenantId,
          ownerTenantName: owner.name || "",
          startedAt,
          expiresAt,
          batchOrderId,
          orderNo,
          aiEnabled,
          trials: createdTrials,
        },
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Failed to assign trial accounts:", error);
      return response.status(500).json({ message: "分配試用帳號失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 提前結束（進寬限，功能即停）/ 立即回庫（僅平台管理員）
  app.post("/api/admin/trials/:id/end", requireAdmin, async (request, response) => {
    const trialId = Number(request.params.id);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return response.status(400).json({ message: "試用記錄編號無效。" });
    }
    const action = clean(request.body?.action, 20) || "end";
    if (!["end", "reclaim_now"].includes(action)) {
      return response.status(400).json({ message: "操作類型無效。" });
    }
    const isPlatform = request.admin.accountType === "platform";
    if (action === "reclaim_now" && !isPlatform) {
      return response.status(403).json({ message: "只有平臺管理員可以立即回庫。" });
    }

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const rows = await connection.query(
        `SELECT ta.*, u.username
         FROM trial_assignments ta
         JOIN sip_users u ON u.id = ta.sip_user_id
         WHERE ta.id = ?
         FOR UPDATE`,
        [trialId],
      );
      const trial = rows[0];
      if (!trial) {
        await connection.rollback();
        return response.status(404).json({ message: "找不到試用記錄。" });
      }
      if (!isPlatform && Number(trial.owner_tenant_id) !== Number(request.admin.tenantId)) {
        await connection.rollback();
        return response.status(403).json({ message: "只能操作本租戶發出的試用。" });
      }
      if (trial.status !== "active") {
        await connection.rollback();
        return response.status(409).json({ message: "該試用已結束或已回收。" });
      }

      const yesterday = addDays(todayDate(), -1);

      if (action === "end") {
        // 提前到期：功能即停（权益置 expired / AI 关闭），帐号留在宽限期可转正
        await expireTrialAssignment(connection, {
          trialId,
          sipUserId: Number(trial.sip_user_id),
          expiresAt: yesterday,
        });
      } else {
        // 立即回库：抹去挂靠与到期字段，帐号回到与库存一致的形态
        await reclaimTrialAssignment(connection, {
          trialId,
          sipUserId: Number(trial.sip_user_id),
        });
      }

      await connection.commit();
      console.log(JSON.stringify({
        src: "trial-end",
        ts: new Date().toISOString(),
        adminId: request.admin.id,
        trialId,
        action,
        username: trial.username || "",
      }));
      return response.json({
        message: action === "end"
          ? `試用帳號 ${trial.username || trial.sip_user_id} 已提前結束，進入寬限期（功能已停，可轉正）。`
          : `試用帳號 ${trial.username || trial.sip_user_id} 已立即回庫。`,
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Failed to end trial assignment:", error);
      return response.status(500).json({ message: "試用結束操作失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });
}
