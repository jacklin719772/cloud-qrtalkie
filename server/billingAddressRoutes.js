// 租户账单地址簿（迁移 091）：购买套餐页「保存」按钮的下游存储
// 仅租户管理员可维护，按 request.admin.tenantId 隔离；支持列表/保存（去重）/删除
import { pool } from "./db.js";

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

const MAX_ADDRESSES_PER_TENANT = 50;

export function registerBillingAddressRoutes(app, { requireAdmin }) {
  const requireTenant = (request, response) => {
    if (request.admin.accountType !== "tenant" || !request.admin.tenantId) {
      response.status(403).json({ message: "只有租戶管理員可以維護帳單地址。" });
      return false;
    }
    return true;
  };

  // 列表（最新在前）
  app.get("/api/billing/billing-addresses", requireAdmin, async (request, response) => {
    if (!requireTenant(request, response)) return;
    let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query(
        `SELECT id, address, created_at
         FROM tenant_billing_addresses
         WHERE tenant_id = ?
         ORDER BY created_at DESC, id DESC`,
        [request.admin.tenantId],
      );
      return response.json({
        addresses: rows.map((row) => ({
          id: Number(row.id),
          address: row.address || "",
          createdAt: row.created_at,
        })),
      });
    } catch (error) {
      console.error("Failed to list billing addresses:", error);
      return response.status(500).json({ message: "讀取帳單地址失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 保存（同租户同文本去重：已存在则直接返回已有记录）
  app.post("/api/billing/billing-addresses", requireAdmin, async (request, response) => {
    if (!requireTenant(request, response)) return;
    const address = clean(request.body?.address, 500);
    if (!address) return response.status(400).json({ message: "請輸入帳單地址。" });
    let connection;
    try {
      connection = await pool.getConnection();
      const existing = await connection.query(
        "SELECT id FROM tenant_billing_addresses WHERE tenant_id = ? AND address = ? LIMIT 1",
        [request.admin.tenantId, address],
      );
      if (existing[0]) {
        return response.json({ message: "該地址已保存過。", id: Number(existing[0].id), duplicated: true });
      }
      const countRows = await connection.query(
        "SELECT COUNT(*) AS total FROM tenant_billing_addresses WHERE tenant_id = ?",
        [request.admin.tenantId],
      );
      if (Number(countRows[0]?.total || 0) >= MAX_ADDRESSES_PER_TENANT) {
        return response.status(400).json({ message: `最多保存 ${MAX_ADDRESSES_PER_TENANT} 條帳單地址，請先刪除不再使用的地址。` });
      }
      const result = await connection.query(
        "INSERT INTO tenant_billing_addresses (tenant_id, address, created_by_admin_user_id) VALUES (?, ?, ?)",
        [request.admin.tenantId, address, request.admin.id],
      );
      return response.json({ message: "地址已保存。", id: Number(result.insertId) });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        return response.json({ message: "該地址已保存過。", duplicated: true });
      }
      console.error("Failed to save billing address:", error);
      return response.status(500).json({ message: "保存帳單地址失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 修改（文本更新；同租户已有相同文本时拒绝并指向已有记录）
  app.put("/api/billing/billing-addresses/:id", requireAdmin, async (request, response) => {
    if (!requireTenant(request, response)) return;
    const addressId = Number(request.params.id);
    if (!Number.isInteger(addressId) || addressId <= 0) {
      return response.status(400).json({ message: "地址編號無效。" });
    }
    const address = clean(request.body?.address, 500);
    if (!address) return response.status(400).json({ message: "請輸入帳單地址。" });
    let connection;
    try {
      connection = await pool.getConnection();
      const target = await connection.query(
        "SELECT id FROM tenant_billing_addresses WHERE id = ? AND tenant_id = ? LIMIT 1",
        [addressId, request.admin.tenantId],
      );
      if (!target[0]) return response.status(404).json({ message: "找不到該地址。" });
      const duplicated = await connection.query(
        "SELECT id FROM tenant_billing_addresses WHERE tenant_id = ? AND address = ? AND id <> ? LIMIT 1",
        [request.admin.tenantId, address, addressId],
      );
      if (duplicated[0]) {
        return response.status(409).json({ message: "該地址已存在，無需重複保存。", id: Number(duplicated[0].id) });
      }
      await connection.query(
        "UPDATE tenant_billing_addresses SET address = ? WHERE id = ? AND tenant_id = ?",
        [address, addressId, request.admin.tenantId],
      );
      return response.json({ message: "地址已更新。", id: addressId });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        return response.status(409).json({ message: "該地址已存在，無需重複保存。" });
      }
      console.error("Failed to update billing address:", error);
      return response.status(500).json({ message: "更新帳單地址失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 删除（仅限本租户记录）
  app.delete("/api/billing/billing-addresses/:id", requireAdmin, async (request, response) => {
    if (!requireTenant(request, response)) return;
    const addressId = Number(request.params.id);
    if (!Number.isInteger(addressId) || addressId <= 0) {
      return response.status(400).json({ message: "地址編號無效。" });
    }
    let connection;
    try {
      connection = await pool.getConnection();
      const result = await connection.query(
        "DELETE FROM tenant_billing_addresses WHERE id = ? AND tenant_id = ?",
        [addressId, request.admin.tenantId],
      );
      if (Number(result.affectedRows || 0) === 0) {
        return response.status(404).json({ message: "找不到該地址。" });
      }
      return response.json({ message: "地址已刪除。" });
    } catch (error) {
      console.error("Failed to delete billing address:", error);
      return response.status(500).json({ message: "刪除帳單地址失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });
}
