// 代理商名录（登记表，迁移 090）：试用分配「代理商」选择与现场新建的数据源
// 银行账号为纯登记用途：列表/详情脱敏展示（尾 4 位），完整值仅经单条接口供编辑回填；全接口仅平台管理员
import { pool } from "./db.js";

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

// 银行账号脱敏：仅保留尾 4 位
function maskBankAccount(no) {
  const value = String(no || "").trim();
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `**** ${value.slice(-4)}`;
}

function mapAgent(row, { maskBank = true } = {}) {
  return {
    id: Number(row.id),
    name: row.name || "",
    contactName: row.contact_name || "",
    contactPhone: row.contact_phone || "",
    contactEmail: row.contact_email || "",
    notes: row.notes || "",
    payeeName: row.payee_name || "",
    bankName: row.bank_name || "",
    bankBranch: row.bank_branch || "",
    bankAccountNo: maskBank ? maskBankAccount(row.bank_account_no) : (row.bank_account_no || ""),
    hasBankAccount: Boolean(row.bank_account_no),
    swiftCode: row.swift_code || "",
    status: row.status || "active",
    createdByName: row.created_by_name || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pickAgentPayload(body) {
  return {
    contactName: clean(body?.contactName, 120),
    contactPhone: clean(body?.contactPhone, 40),
    contactEmail: clean(body?.contactEmail, 255),
    notes: clean(body?.notes, 500),
    payeeName: clean(body?.payeeName, 180),
    bankName: clean(body?.bankName, 180),
    bankBranch: clean(body?.bankBranch, 180),
    bankAccountNo: clean(body?.bankAccountNo, 120),
    swiftCode: clean(body?.swiftCode, 40),
  };
}

export function registerAgentRoutes(app, { requireAdmin }) {
  const requirePlatform = (request, response) => {
    if (request.admin.accountType !== "platform") {
      response.status(403).json({ message: "只有平臺管理員可以維護代理商名錄。" });
      return false;
    }
    return true;
  };

  // 列表（银行账号脱敏）
  app.get("/api/admin/agents", requireAdmin, async (request, response) => {
    if (!requirePlatform(request, response)) return;
    let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query(
        `SELECT a.*, u.display_name AS created_by_name
         FROM agents a
         LEFT JOIN admin_users u ON u.id = a.created_by_admin_user_id
         ORDER BY (a.status = 'active') DESC, a.created_at DESC, a.id DESC`,
      );
      return response.json({ agents: rows.map((row) => mapAgent(row, { maskBank: true })) });
    } catch (error) {
      console.error("Failed to list agents:", error);
      return response.status(500).json({ message: "讀取代理商名錄失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 单条（含完整银行账号；供編輯回填）
  app.get("/api/admin/agents/:id", requireAdmin, async (request, response) => {
    if (!requirePlatform(request, response)) return;
    const agentId = Number(request.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return response.status(400).json({ message: "代理商編號無效。" });
    }
    let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query(
        `SELECT a.*, u.display_name AS created_by_name
         FROM agents a
         LEFT JOIN admin_users u ON u.id = a.created_by_admin_user_id
         WHERE a.id = ? LIMIT 1`,
        [agentId],
      );
      if (!rows[0]) return response.status(404).json({ message: "找不到代理商。" });
      return response.json({ agent: mapAgent(rows[0], { maskBank: false }) });
    } catch (error) {
      console.error("Failed to fetch agent:", error);
      return response.status(500).json({ message: "讀取代理商失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 新建（名称必填、唯一）
  app.post("/api/admin/agents", requireAdmin, async (request, response) => {
    if (!requirePlatform(request, response)) return;
    const name = clean(request.body?.name, 160);
    if (!name) return response.status(400).json({ message: "請輸入代理商名稱。" });
    const payload = pickAgentPayload(request.body);
    if (payload.contactEmail && !isEmailLike(payload.contactEmail)) {
      return response.status(400).json({ message: "聯絡信箱格式無效。" });
    }
    let connection;
    try {
      connection = await pool.getConnection();
      const result = await connection.query(
        `INSERT INTO agents (
           name, contact_name, contact_phone, contact_email, notes,
           payee_name, bank_name, bank_branch, bank_account_no, swift_code,
           created_by_admin_user_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          payload.contactName || null,
          payload.contactPhone || null,
          payload.contactEmail || null,
          payload.notes || null,
          payload.payeeName || null,
          payload.bankName || null,
          payload.bankBranch || null,
          payload.bankAccountNo || null,
          payload.swiftCode || null,
          request.admin.id,
        ],
      );
      return response.json({ message: "代理商新增成功。", id: Number(result.insertId) });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        return response.status(409).json({ message: "代理商名稱已存在。" });
      }
      console.error("Failed to create agent:", error);
      return response.status(500).json({ message: "新增代理商失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 编辑（含银行信息；名称唯一）
  app.put("/api/admin/agents/:id", requireAdmin, async (request, response) => {
    if (!requirePlatform(request, response)) return;
    const agentId = Number(request.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return response.status(400).json({ message: "代理商編號無效。" });
    }
    const name = clean(request.body?.name, 160);
    if (!name) return response.status(400).json({ message: "請輸入代理商名稱。" });
    const payload = pickAgentPayload(request.body);
    if (payload.contactEmail && !isEmailLike(payload.contactEmail)) {
      return response.status(400).json({ message: "聯絡信箱格式無效。" });
    }
    let connection;
    try {
      connection = await pool.getConnection();
      const result = await connection.query(
        `UPDATE agents
         SET name = ?, contact_name = ?, contact_phone = ?, contact_email = ?, notes = ?,
             payee_name = ?, bank_name = ?, bank_branch = ?, bank_account_no = ?, swift_code = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          name,
          payload.contactName || null,
          payload.contactPhone || null,
          payload.contactEmail || null,
          payload.notes || null,
          payload.payeeName || null,
          payload.bankName || null,
          payload.bankBranch || null,
          payload.bankAccountNo || null,
          payload.swiftCode || null,
          agentId,
        ],
      );
      if (Number(result.affectedRows || 0) === 0) {
        return response.status(404).json({ message: "找不到代理商。" });
      }
      return response.json({ message: "代理商資料已儲存。" });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        return response.status(409).json({ message: "代理商名稱已存在。" });
      }
      console.error("Failed to update agent:", error);
      return response.status(500).json({ message: "儲存代理商失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 启用/停用
  app.put("/api/admin/agents/:id/status", requireAdmin, async (request, response) => {
    if (!requirePlatform(request, response)) return;
    const agentId = Number(request.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return response.status(400).json({ message: "代理商編號無效。" });
    }
    const status = clean(request.body?.status, 20);
    if (!["active", "disabled"].includes(status)) {
      return response.status(400).json({ message: "狀態無效。" });
    }
    let connection;
    try {
      connection = await pool.getConnection();
      const result = await connection.query(
        "UPDATE agents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [status, agentId],
      );
      if (Number(result.affectedRows || 0) === 0) {
        return response.status(404).json({ message: "找不到代理商。" });
      }
      return response.json({ message: status === "active" ? "代理商已啟用。" : "代理商已停用。" });
    } catch (error) {
      console.error("Failed to update agent status:", error);
      return response.status(500).json({ message: "更新代理商狀態失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 删除（关联的 trial_assignments.agent_id 由外键 ON DELETE SET NULL 自动置空）
  app.delete("/api/admin/agents/:id", requireAdmin, async (request, response) => {
    if (!requirePlatform(request, response)) return;
    const agentId = Number(request.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      return response.status(400).json({ message: "代理商編號無效。" });
    }
    let connection;
    try {
      connection = await pool.getConnection();
      const result = await connection.query("DELETE FROM agents WHERE id = ?", [agentId]);
      if (Number(result.affectedRows || 0) === 0) {
        return response.status(404).json({ message: "找不到代理商。" });
      }
      return response.json({ message: "代理商已刪除。" });
    } catch (error) {
      console.error("Failed to delete agent:", error);
      return response.status(500).json({ message: "刪除代理商失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });
}
