import "dotenv/config";
import { pool } from "./db.js";
import { hashPassword } from "./security.js";

export const TENANT_SUB_ADMIN_MODULES = [
  "tenant-account-management",
  "contact-books",
  "ecard-styles-management",
  "call-center",
  "access-control",
];

export class TenantSubAdminError extends Error {
  constructor(message, { statusCode = 400, code = "TENANT_SUB_ADMIN_ERROR" } = {}) {
    super(message);
    this.name = "TenantSubAdminError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function ensureTenantSubAdminSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS admin_user_sip_accounts (
       admin_user_id BIGINT UNSIGNED NOT NULL,
       sip_user_id BIGINT UNSIGNED NOT NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (admin_user_id, sip_user_id),
       KEY idx_ausa_sip (sip_user_id),
       CONSTRAINT fk_ausa_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
       CONSTRAINT fk_ausa_sip FOREIGN KEY (sip_user_id) REFERENCES sip_users(id) ON DELETE CASCADE
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

export function tenantSubAdminPermissions() {
  return { tenantSubAdmin: true, modules: [...TENANT_SUB_ADMIN_MODULES] };
}

export async function getManagedSipUserIds(adminUserId) {
  const rows = await pool.query(
    "SELECT sip_user_id FROM admin_user_sip_accounts WHERE admin_user_id = ?",
    [adminUserId],
  );
  return rows.map((row) => Number(row.sip_user_id)).filter((id) => Number.isInteger(id) && id > 0);
}

export async function listTenantSipAccounts(tenantId) {
  return pool.query(
    `SELECT s.id, s.username, s.display_name AS displayName, s.status,
            COALESCE(DATE_FORMAT(e.service_expires_at, '%Y-%m-%d'), DATE_FORMAT(s.service_expires_at, '%Y-%m-%d')) AS serviceExpiresAt
       FROM sip_users s
       LEFT JOIN tenant_sip_account_entitlements e
         ON e.sip_user_id = s.id AND e.status = 'active'
      WHERE COALESCE(e.tenant_id, s.tenant_id) = ?
        AND s.recycled_at IS NULL
      ORDER BY s.username`,
    [tenantId],
  );
}

async function validateManagedSipUserIds(connection, tenantId, sipUserIds) {
  const ids = [...new Set((Array.isArray(sipUserIds) ? sipUserIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await connection.query(
    `SELECT s.id
       FROM sip_users s
       LEFT JOIN tenant_sip_account_entitlements e
         ON e.sip_user_id = s.id AND e.status = 'active'
      WHERE s.id IN (${placeholders})
        AND COALESCE(e.tenant_id, s.tenant_id) = ?
        AND s.recycled_at IS NULL`,
    [...ids, tenantId],
  );
  const allowed = new Set(rows.map((row) => Number(row.id)));
  const invalid = ids.filter((id) => !allowed.has(id));
  if (invalid.length) {
    throw new TenantSubAdminError("包含不屬於本租戶的 SIP 帳號。", {
      statusCode: 400,
      code: "INVALID_MANAGED_ACCOUNTS",
    });
  }
  return ids;
}

async function replaceManagedAccounts(connection, adminUserId, tenantId, sipUserIds) {
  const ids = await validateManagedSipUserIds(connection, tenantId, sipUserIds);
  await connection.query("DELETE FROM admin_user_sip_accounts WHERE admin_user_id = ?", [adminUserId]);
  for (const sipUserId of ids) {
    await connection.query(
      "INSERT INTO admin_user_sip_accounts (admin_user_id, sip_user_id) VALUES (?, ?)",
      [adminUserId, sipUserId],
    );
  }
  return ids;
}

export async function listTenantSubAdmins(tenantId) {
  await ensureTenantSubAdminSchema();
  const rows = await pool.query(
    `SELECT a.id, a.email, a.display_name AS displayName, a.phone_number AS phoneNumber,
            a.status, a.created_at AS createdAt, a.last_login_at AS lastLoginAt,
            COUNT(s.sip_user_id) AS managedCount
       FROM admin_users a
       LEFT JOIN admin_user_sip_accounts s ON s.admin_user_id = a.id
      WHERE a.tenant_id = ?
        AND a.account_type = 'tenant'
        AND a.role = 'admin'
        AND JSON_EXTRACT(a.permissions_json, '$.tenantSubAdmin') = true
      GROUP BY a.id
      ORDER BY a.created_at DESC`,
    [tenantId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    email: row.email || "",
    displayName: row.displayName || "",
    phoneNumber: row.phoneNumber || "",
    status: row.status || "active",
    managedCount: Number(row.managedCount || 0),
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  }));
}

export async function createTenantSubAdmin({
  tenantId,
  email,
  password,
  displayName = "",
  phoneNumber = "",
  sipUserIds = [],
}) {
  await ensureTenantSubAdminSchema();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new TenantSubAdminError("請輸入有效的電子郵件。", { code: "INVALID_SUB_ADMIN_EMAIL" });
  }
  if (String(password || "").length < 8) {
    throw new TenantSubAdminError("密碼至少需要 8 位字元。", { code: "INVALID_SUB_ADMIN_PASSWORD" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query(
      "SELECT id FROM admin_users WHERE email = ? LIMIT 1",
      [normalizedEmail],
    );
    if (existing) {
      throw new TenantSubAdminError("該電子郵件已被使用。", {
        statusCode: 409,
        code: "SUB_ADMIN_EMAIL_EXISTS",
      });
    }
    const passwordHash = await hashPassword(password);
    const result = await connection.query(
      `INSERT INTO admin_users
         (tenant_id, email, password_hash, display_name, phone_number, account_type, role, permissions_json, status)
       VALUES (?, ?, ?, ?, ?, 'tenant', 'admin', ?, 'active')`,
      [
        tenantId,
        normalizedEmail,
        passwordHash,
        String(displayName || "").trim(),
        String(phoneNumber || "").trim(),
        JSON.stringify(tenantSubAdminPermissions()),
      ],
    );
    const adminId = Number(result.insertId);
    await replaceManagedAccounts(connection, adminId, tenantId, sipUserIds);
    await connection.commit();
    return adminId;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateTenantSubAdmin({
  tenantId,
  adminId,
  displayName,
  phoneNumber,
  status,
  password,
  sipUserIds,
}) {
  await ensureTenantSubAdminSchema();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [target] = await connection.query(
      `SELECT id FROM admin_users
        WHERE id = ? AND tenant_id = ? AND account_type = 'tenant' AND role = 'admin'
          AND JSON_EXTRACT(permissions_json, '$.tenantSubAdmin') = true
        LIMIT 1`,
      [adminId, tenantId],
    );
    if (!target) {
      throw new TenantSubAdminError("子管理員不存在。", {
        statusCode: 404,
        code: "SUB_ADMIN_NOT_FOUND",
      });
    }
    const sets = [];
    const params = [];
    if (displayName !== undefined) {
      sets.push("display_name = ?");
      params.push(String(displayName || "").trim());
    }
    if (phoneNumber !== undefined) {
      sets.push("phone_number = ?");
      params.push(String(phoneNumber || "").trim());
    }
    if (status !== undefined) {
      const nextStatus = String(status || "").toLowerCase();
      if (!["active", "disabled", "locked"].includes(nextStatus)) {
        throw new TenantSubAdminError("無效的帳號狀態。", { code: "INVALID_SUB_ADMIN_STATUS" });
      }
      sets.push("status = ?");
      params.push(nextStatus);
    }
    if (password !== undefined && String(password || "").length > 0) {
      if (String(password).length < 8) {
        throw new TenantSubAdminError("密碼至少需要 8 位字元。", { code: "INVALID_SUB_ADMIN_PASSWORD" });
      }
      sets.push("password_hash = ?");
      params.push(await hashPassword(password));
    }
    if (sets.length) {
      await connection.query(
        `UPDATE admin_users SET ${sets.join(", ")} WHERE id = ?`,
        [...params, adminId],
      );
    }
    if (status !== undefined && String(status).toLowerCase() !== "active") {
      await connection.query("DELETE FROM admin_sessions WHERE admin_user_id = ?", [adminId]);
    }
    if (sipUserIds !== undefined) {
      await replaceManagedAccounts(connection, adminId, tenantId, sipUserIds);
    }
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteTenantSubAdmin({ tenantId, adminId }) {
  await ensureTenantSubAdminSchema();
  const result = await pool.query(
    `DELETE FROM admin_users
      WHERE id = ? AND tenant_id = ? AND account_type = 'tenant' AND role = 'admin'
        AND JSON_EXTRACT(permissions_json, '$.tenantSubAdmin') = true`,
    [adminId, tenantId],
  );
  if (!result?.affectedRows) {
    throw new TenantSubAdminError("子管理員不存在。", {
      statusCode: 404,
      code: "SUB_ADMIN_NOT_FOUND",
    });
  }
  return true;
}

export async function getTenantSubAdminAccountIds(tenantId, adminId) {
  const rows = await pool.query(
    `SELECT s.sip_user_id
       FROM admin_user_sip_accounts s
       JOIN admin_users a ON a.id = s.admin_user_id
      WHERE a.id = ? AND a.tenant_id = ? AND a.account_type = 'tenant' AND a.role = 'admin'`,
    [adminId, tenantId],
  );
  return rows.map((row) => Number(row.sip_user_id));
}
