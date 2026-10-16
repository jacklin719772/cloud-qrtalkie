// 試用帳號模組：管理端 API（庫存選號 / 分配 / 列表 / 提前結束·立即回庫）
// 方案：试用账号模块设计方案-实施参考.md（2026-10-14）
// 設計要點：試用帳號掛在保留租戶（is_system=1）名下；分配時為保留租戶靜默建一張
// order_type='trial' 的批次訂單（金額 0、已付款、已審核），後續回收/轉正均以 trial_assignments 為業務憑據。
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { pool } from "./db.js";
import { getAccount as flexisipGetAccount, updateAccount as flexisipUpdateAccount, activateAccount as flexisipActivateAccount, searchAccountBySip } from "./flexisipAccountManagerClient.js";
import { hashPassword } from "./security.js";
import { readAccountVcard, mergeAccountVcard, saveAccountAvatar } from "./accountProfileService.js";
import { activateTrialAccountInFlexisip, getReservedTrialTenantId, pauseTrialAssignment, reclaimTrialAssignment, resumeTrialAssignment } from "./trialService.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ecardImagesDir = path.join(projectRoot, "assets/ecard-images");
// 未上傳企業 Logo 時使用的默認品牌 Logo（渲染器支持 SVG；同目錄經 /ecard-images 對外）
const DEFAULT_ECARD_LOGO_FILE = path.join(ecardImagesDir, "qrtalkie-logo.svg");
const DEFAULT_ECARD_LOGO_URL = "/ecard-images/qrtalkie-logo.svg";

function parseJsonMaybe(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// 保存名片头像（data URL → /ecard-images/ 文件），与 index.js saveEcardImage 同规则（5MB 上限）
async function saveEcardImageFile(dataUrl) {
  const match = String(dataUrl || "").trim().match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const error = new Error("無效的圖片格式");
    error.statusCode = 400;
    throw error;
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) {
    const error = new Error("圖片不可超過 5MB。");
    error.statusCode = 400;
    throw error;
  }
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
  await mkdir(ecardImagesDir, { recursive: true });
  const filename = `ecard-${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(ecardImagesDir, filename), buffer);
  return `/ecard-images/${filename}`;
}

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

// 試用階段：active 且 7 天內到期 = 即將到期；active 且已到期 = 寬限期；其餘為終態
function trialPhase(row, today) {
  if (row.status === "converted") return "converted";
  if (row.status === "reclaimed") return "reclaimed";
  if (row.status === "paused") return "paused";
  const expires = String(row.expires_at || "").slice(0, 10);
  if (!expires) return "active";
  if (expires < today) return "grace";
  if (expires <= addDaysStr(today, 7)) return "expiring";
  return "active";
}

function addDaysStr(value, days) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function registerTrialManagementRoutes(app, { requireAdmin }) {
  // 庫存帳號查詢（添加表單選號用）：全量 SIP（tenant_id IS NULL 且 active）+ 隨機預配 Web 帳號
  app.get("/api/admin/trials/stock-accounts", requireAdmin, async (request, response) => {
    const keyword = clean(request.query?.q, 120);
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
      const sips = await connection.query(
        `SELECT id, username, sip_domain, display_name
         FROM sip_users
         WHERE ${where}
         ORDER BY username ASC`,
        params,
      );
      const webs = await connection.query(
        "SELECT id, username FROM web_users WHERE tenant_id IS NULL AND status = 'active' ORDER BY username ASC",
      );
      // 隨機預配：Web 池洗牌後按序對位（每次載入重新預配；提交時按所見配對校驗綁定）
      const shuffledWebs = webs.slice();
      for (let i = shuffledWebs.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledWebs[i], shuffledWebs[j]] = [shuffledWebs[j], shuffledWebs[i]];
      }
      return response.json({
        accounts: sips.map((row, index) => {
          const web = shuffledWebs[index];
          return {
            id: Number(row.id),
            username: row.username || "",
            sipDomain: row.sip_domain || "",
            displayName: row.display_name || "",
            webUserId: web ? Number(web.id) : null,
            webUsername: web ? (web.username || "") : "",
          };
        }),
        total: sips.length,
        webStock: webs.length,
      });
    } catch (error) {
      console.error("Failed to query trial stock accounts:", error);
      return response.status(500).json({ message: "讀取庫存帳號失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 管理員信箱查重（新建租戶表單的「校驗」按鈕）
  app.get("/api/admin/trials/check-admin-email", requireAdmin, async (request, response) => {
    if (request.admin.accountType !== "platform") {
      return response.status(403).json({ message: "只有平臺管理員可以檢查。" });
    }
    const email = clean(request.query?.email, 255).toLowerCase();
    if (!isEmailLike(email)) {
      return response.status(400).json({ message: "郵箱格式無效。" });
    }
    let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query("SELECT id FROM admin_users WHERE LOWER(email) = ? LIMIT 1", [email]);
      return response.json({ available: rows.length === 0 });
    } catch (error) {
      console.error("Failed to check admin email:", error);
      return response.status(500).json({ message: "檢查失敗，請重試。" });
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
    const agentFilter = clean(request.query?.agentId, 20);

    const whereClauses = [];
    const params = [];
    if (ownerFilter) {
      whereClauses.push("ta.owner_tenant_id = ?");
      params.push(ownerFilter);
    }
    if (agentFilter === "none") {
      whereClauses.push("ta.agent_id IS NULL");
    } else if (/^\d+$/.test(agentFilter) && Number(agentFilter) > 0) {
      whereClauses.push("ta.agent_id = ?");
      params.push(Number(agentFilter));
    }
    // 指定 ID 集合过滤（购买页按 trialIds 拉取保留清单明细）
    const idsFilter = String(request.query?.ids || "")
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 200);
    if (idsFilter.length > 0) {
      whereClauses.push(`ta.id IN (${idsFilter.map(() => "?").join(",")})`);
      params.push(...idsFilter);
    }
    if (statusFilter === "active") {
      whereClauses.push("ta.status = 'active' AND ta.expires_at > DATE_ADD(CURDATE(), INTERVAL 7 DAY)");
    } else if (statusFilter === "expiring") {
      whereClauses.push("ta.status = 'active' AND ta.expires_at >= CURDATE() AND ta.expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)");
    } else if (statusFilter === "grace") {
      whereClauses.push("ta.status = 'active' AND ta.expires_at < CURDATE()");
    } else if (statusFilter === "converted" || statusFilter === "reclaimed" || statusFilter === "paused") {
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
      const reservedTrialTenantId = await getReservedTrialTenantId(connection);
      const rows = await connection.query(
        `SELECT
           ta.id, ta.sip_user_id, ta.owner_tenant_id, ta.contact_name, ta.contact_email, ta.contact_phone,
           ta.company, DATE_FORMAT(ta.started_at, '%Y-%m-%d') AS started_at,
           DATE_FORMAT(ta.expires_at, '%Y-%m-%d') AS expires_at,
           ta.status, ta.ai_enabled, ta.batch_order_id, ta.converted_order_id, ta.notes,
           ta.created_at,
           u.username, u.sip_domain, u.display_name AS account_display_name,
           wu.username AS web_username,
           ai.enabled AS ai_live_enabled,
           ai.expires_at AS ai_live_expires_at,
           t.name AS owner_tenant_name
         FROM trial_assignments ta
         JOIN sip_users u ON u.id = ta.sip_user_id
         JOIN tenants t ON t.id = ta.owner_tenant_id
         LEFT JOIN tenant_web_account_entitlements we
           ON we.sip_user_id = ta.sip_user_id AND we.tenant_id = ?
         LEFT JOIN web_users wu ON wu.id = we.web_user_id
         LEFT JOIN ai_bot_account_entitlements ai ON ai.sip_user_id = ta.sip_user_id
         ${whereSql}
         ORDER BY ta.created_at DESC, ta.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
        [reservedTrialTenantId || 0, ...params],
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
          // AI 列显示「当前能否用」：以权益表实时状态为准（快照字段仅存档）
          aiEnabled: Number(row.ai_live_enabled || 0) === 1
            && (!row.ai_live_expires_at || new Date(row.ai_live_expires_at) > new Date()),
          batchOrderId: row.batch_order_id ? Number(row.batch_order_id) : null,
          convertedOrderId: row.converted_order_id ? Number(row.converted_order_id) : null,
          notes: row.notes || "",
          createdAt: row.created_at,
          username: row.username || "",
          sipDomain: row.sip_domain || "",
          accountDisplayName: row.account_display_name || "",
          webUsername: row.web_username || "",
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
    const agentId = Number(request.body?.agentId) || null;
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
    const requestedPairs = (Array.isArray(request.body?.pairs) ? request.body.pairs : [])
      .map((item) => ({
        sipUserId: Number(item?.sipUserId),
        webUserId: Number(item?.webUserId) || null,
      }))
      .filter((item) => Number.isInteger(item.sipUserId) && item.sipUserId > 0);
    const requestedCount = Number.parseInt(request.body?.count, 10);
    if (requestedPairs.length === 0 && requestedIds.length === 0 && !(Number.isInteger(requestedCount) && requestedCount > 0)) {
      return response.status(400).json({ message: "請選擇帳號或指定帳號數量。" });
    }
    if (requestedPairs.length > MAX_ASSIGN_COUNT || requestedIds.length > MAX_ASSIGN_COUNT || requestedCount > MAX_ASSIGN_COUNT) {
      return response.status(400).json({ message: `單次分配不得超過 ${MAX_ASSIGN_COUNT} 個帳號。` });
    }

    let connection;
    try {
      connection = await pool.getConnection();

      // 代理商（名錄選擇）：僅接受啟用中的登記錄項；先於 AM 動作校驗，無效請求不產生任何副作用
      if (agentId) {
        const agentRows = await connection.query(
          "SELECT id FROM agents WHERE id = ? AND status = 'active' LIMIT 1",
          [agentId],
        );
        if (!agentRows[0]) {
          return response.status(400).json({ message: "所選代理商不存在或已停用。" });
        }
      }

      // 先確保所選帳號在通訊核心（AM）處於啟用態（先 AM 後本地；失敗即中止，不產生任何本地數據）。
      // count 自動取號路徑帳號在事務內才確定，於選定後補激活。
      const preIds = requestedPairs.length > 0
        ? Array.from(new Set(requestedPairs.map((item) => item.sipUserId)))
        : requestedIds;
      const preActivated = preIds.length > 0;
      if (preActivated) {
        const preRows = await connection.query(
          `SELECT id, username FROM sip_users
           WHERE id IN (${preIds.map(() => "?").join(",")})
             AND tenant_id IS NULL AND status = 'active'`,
          preIds,
        );
        if (preRows.length !== preIds.length) {
          return response.status(409).json({ message: "部分所選帳號已被分配或不可用，請重新整理後重試。" });
        }
        for (const row of preRows) {
          try {
            await activateTrialAccountInFlexisip(Number(row.id), connection);
          } catch (flexisipError) {
            console.error("[trial-assign] AM activate failed:", row.username, flexisipError?.message || flexisipError);
            if (flexisipError?.code === "FLEXISIP_MAPPING_MISMATCH") {
              return response.status(409).json({
                message: `帳號 ${row.username} 在通訊核心的映射異常，無法安全開通，請更換帳號後重試。`,
              });
            }
            return response.status(502).json({
              message: `帳號 ${row.username} 在通訊核心（AM）啟用失敗，已取消本次添加，請稍後重試。`,
            });
          }
        }
      }

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

      // 選號：pairs（所見配對）優先，其次兼容 sipUserIds/自動取庫存；皆須為 tenant_id IS NULL 且 active
      let accounts = [];
      let pairsList = [];
      if (requestedPairs.length > 0) {
        const sipIds = Array.from(new Set(requestedPairs.map((item) => item.sipUserId)));
        accounts = await connection.query(
          `SELECT id, username, sip_domain, display_name
           FROM sip_users
           WHERE id IN (${sipIds.map(() => "?").join(",")})
             AND tenant_id IS NULL AND status = 'active'
           FOR UPDATE`,
          sipIds,
        );
        if (accounts.length !== sipIds.length) {
          await connection.rollback();
          return response.status(409).json({ message: "部分所選帳號已被分配或不可用，請重新整理後重試。" });
        }
        pairsList = sipIds.map((sipUserId) => {
          const found = requestedPairs.find((item) => item.sipUserId === sipUserId);
          return { sipUserId, webUserId: found?.webUserId || null };
        });
      } else if (requestedIds.length > 0) {
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
        pairsList = requestedIds.map((sipUserId) => ({ sipUserId, webUserId: null }));
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
        pairsList = accounts.map((row) => ({ sipUserId: Number(row.id), webUserId: null }));
      }
      const accountIds = pairsList.map((item) => item.sipUserId);
      if (!preActivated) {
        // count 自動取號路徑：在事務內補激活；失敗回滾（本地尚無任何寫入）
        for (const sipId of accountIds) {
          try {
            await activateTrialAccountInFlexisip(sipId, connection);
          } catch (flexisipError) {
            await connection.rollback();
            console.error("[trial-assign] AM activate failed (auto path):", sipId, flexisipError?.message || flexisipError);
            if (flexisipError?.code === "FLEXISIP_MAPPING_MISMATCH") {
              return response.status(409).json({ message: "所選帳號在通訊核心的映射異常，無法安全開通，請更換帳號後重試。" });
            }
            return response.status(502).json({ message: "帳號在通訊核心（AM）啟用失敗，已取消本次添加，請稍後重試。" });
          }
        }
      }
      const providedWebIdList = pairsList.map((item) => item.webUserId).filter((id) => Number.isInteger(id) && id > 0);
      if (new Set(providedWebIdList).size !== providedWebIdList.length) {
        await connection.rollback();
        return response.status(409).json({ message: "Web 配對重複，請重新整理後重新選號。" });
      }

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

      // 增值服務：與正式訂單同構，逐項寫入批次訂單明細（試用免費，金額按 0 計）
      const addonCodes = (Array.isArray(request.body?.addonCodes) ? request.body.addonCodes : [])
        .map((code) => String(code || "").trim())
        .filter(Boolean)
        .slice(0, 20);
      if (addonCodes.length > 0) {
        const addonRows = await connection.query(
          `SELECT id, addon_code, name
           FROM billing_addons
           WHERE addon_code IN (${addonCodes.map(() => "?").join(",")})
             AND status = 'active'
           ORDER BY sort_order ASC, id ASC`,
          addonCodes,
        );
        let addonSort = 20;
        for (const addon of addonRows) {
          await connection.query(
            `INSERT INTO billing_order_items (
               order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
               account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
             )
             VALUES (?, ?, 'addon', NULL, ?, NULL, ?, ?, NULL, 1, 1, 'USD', 0, 0, 0, ?)`,
            [batchOrderId, reservedTenantId, Number(addon.id), addon.addon_code, addon.name, addonSort],
          );
          addonSort += 1;
        }
      }
      // AI 開通來源：第 3 區塊獨立開關，或增值服務勾選「AI助手」（aiassistant）
      const aiRequested = aiEnabled || addonCodes.includes("aiassistant");

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

      // SIP+Web 配對：優先使用所見預配結果（校驗仍為庫存），缺配的從剩餘庫存隨機補
      let usedWebIds = new Set();
      if (providedWebIdList.length > 0) {
        const webRows = await connection.query(
          `SELECT id
           FROM web_users
           WHERE id IN (${providedWebIdList.map(() => "?").join(",")})
             AND tenant_id IS NULL AND status = 'active'
           FOR UPDATE`,
          providedWebIdList,
        );
        const validIds = new Set(webRows.map((row) => Number(row.id)));
        if (validIds.size !== providedWebIdList.length) {
          await connection.rollback();
          return response.status(409).json({ message: "部分所選 Web 配對已變動，請重新選號後重試。" });
        }
        usedWebIds = validIds;
      }
      const missingWebCount = pairsList.filter((item) => !(item.webUserId && usedWebIds.has(item.webUserId))).length;
      if (missingWebCount > 0) {
        const excludeIds = Array.from(usedWebIds);
        const excludeSql = excludeIds.length > 0 ? ` AND id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
        const fallbackRows = await connection.query(
          `SELECT id
           FROM web_users
           WHERE tenant_id IS NULL AND status = 'active'${excludeSql}
           ORDER BY RAND()
           LIMIT ${missingWebCount}
           FOR UPDATE`,
          excludeIds,
        );
        if (fallbackRows.length !== missingWebCount) {
          await connection.rollback();
          return response.status(409).json({
            message: `未分配 Web 帳號不足，還需要 ${missingWebCount - fallbackRows.length} 個用於試用配對。`,
          });
        }
        let cursor = 0;
        for (const item of pairsList) {
          if (item.webUserId && usedWebIds.has(item.webUserId)) continue;
          item.webUserId = Number(fallbackRows[cursor].id);
          cursor += 1;
          usedWebIds.add(item.webUserId);
        }
      }
      const webUserIds = pairsList.map((item) => item.webUserId);
      await connection.query(
        `UPDATE web_users
         SET tenant_id = ?,
             status = 'active',
             activated_at = COALESCE(activated_at, NOW()),
             service_expires_at = ?
         WHERE id IN (${webUserIds.map(() => "?").join(",")})`,
        [reservedTenantId, expiresAt, ...webUserIds],
      );
      for (let index = 0; index < accountIds.length; index += 1) {
        await connection.query(
          `INSERT INTO tenant_web_account_entitlements (
             tenant_id, web_user_id, sip_user_id, first_order_id, current_order_id, status,
             service_starts_at, service_expires_at, assigned_by_admin_user_id
           )
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             tenant_id = VALUES(tenant_id),
             sip_user_id = VALUES(sip_user_id),
             current_order_id = VALUES(current_order_id),
             status = 'active',
             service_starts_at = VALUES(service_starts_at),
             service_expires_at = VALUES(service_expires_at),
             assigned_by_admin_user_id = VALUES(assigned_by_admin_user_id)`,
          [reservedTenantId, webUserIds[index], accountIds[index], batchOrderId, batchOrderId, startedAt, expiresAt, request.admin.id],
        );
      }

      const createdTrials = [];
      for (const account of accounts) {
        const insertResult = await connection.query(
          `INSERT INTO trial_assignments (
             sip_user_id, owner_tenant_id, agent_id, contact_name, contact_email, contact_phone, company,
             started_at, expires_at, status, ai_enabled, batch_order_id, created_by_admin_user_id, notes
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
          [
            Number(account.id),
            ownerTenantId,
            agentId,
            contactName || null,
            contactEmail || null,
            contactPhone || null,
            company || null,
            startedAt,
            expiresAt,
            aiRequested ? 1 : 0,
            batchOrderId,
            request.admin.id,
            notes || null,
          ],
        );
        createdTrials.push({ id: Number(insertResult.insertId), sipUserId: Number(account.id), username: account.username || "" });
      }

      if (aiRequested) {
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
        message: `已添加 ${createdTrials.length} 個試用帳號（${startedAt} 至 ${expiresAt}）。`,
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
      return response.status(500).json({ message: "添加試用帳號失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 名片渲染預覽（不入庫）：按當前設置即時渲染 PNG 返回
  app.post("/api/admin/trials/ecards/preview", requireAdmin, async (request, response) => {
    const styleId = Number(request.body?.templateId) || 0;
    if (!styleId) return response.status(400).json({ message: "請選擇名片樣式。" });
    const backgroundId = Number(request.body?.backgroundId) || 0;
    const company = clean(request.body?.company, 120);
    const name = clean(request.body?.name, 120);
    const titleZh = clean(request.body?.titleZh, 120);
    const titleEn = request.body?.titleEn !== undefined ? clean(request.body.titleEn, 120) : undefined;
    const phone = clean(request.body?.phone, 40);
    const email = clean(request.body?.email, 255);
    const zipCode = request.body?.zipCode !== undefined ? clean(request.body.zipCode, 40) : undefined;
    const address = request.body?.address !== undefined ? clean(request.body.address, 240) : undefined;
    const qrDesc = request.body?.qrDesc !== undefined ? clean(request.body.qrDesc, 120) : undefined;
    const companyZh = request.body?.companyZh !== undefined ? clean(request.body.companyZh, 120) : undefined;
    const companyEn = request.body?.companyEn !== undefined ? clean(request.body.companyEn, 120) : undefined;
    const sloganZh = request.body?.sloganZh !== undefined ? clean(request.body.sloganZh, 160) : undefined;
    const sloganEn = request.body?.sloganEn !== undefined ? clean(request.body.sloganEn, 160) : undefined;
    const showQrCode = request.body?.showQrCode !== false;
    const avatarDataUrl = typeof request.body?.avatarDataUrl === "string" ? request.body.avatarDataUrl : "";
    const logoDataUrl = typeof request.body?.logoDataUrl === "string" ? request.body.logoDataUrl : "";

    let connection;
    try {
      connection = await pool.getConnection();
      const [styleRow] = await connection.query(
        "SELECT id, company_name_enabled FROM ecard_styles WHERE id = ? AND status = 'active' LIMIT 1",
        [styleId],
      );
      if (!styleRow) return response.status(400).json({ message: "名片樣式不存在或已停用。" });
      const bgRows = await connection.query(
        `SELECT id, image_url, layout_json, default_style_json, display_config_json
         FROM ecard_style_backgrounds
         WHERE style_id = ?${backgroundId ? " AND id = ?" : ""}
         ORDER BY sort_order ASC, id ASC LIMIT 1`,
        backgroundId ? [styleId, backgroundId] : [styleId],
      );
      const bgRow = bgRows[0];
      if (!bgRow) return response.status(400).json({ message: "名片背景不存在。" });

      const baseUrl = process.env.ECARD_APP_URL || "https://ecard.qrtalkie.org";
      let qrDataUrl = "";
      try {
        qrDataUrl = await QRCode.toDataURL(`${baseUrl}/u/ecard-preview`, { width: 512, margin: 2, errorCorrectionLevel: "M" });
      } catch (qrError) {
        console.error("[trial-ecard-preview] QR generation failed:", qrError?.message || qrError);
      }

      const cardData = {
        name,
        titleZh,
        titleEn: titleEn ?? "",
        phone,
        email,
        zipCode: zipCode ?? "",
        address: address ?? "",
        qrDesc: qrDesc ?? "掃碼二維碼 · 交換名片",
        companyZh: companyZh ?? company,
        companyEn: companyEn ?? (companyZh ?? company),
        sloganZh: sloganZh ?? "",
        sloganEn: sloganEn ?? "",
      };

      const { renderEcard } = await import("./ecardRenderer.js");
      const pngBuffer = await renderEcard({
        layoutJson: parseJsonMaybe(bgRow.layout_json, {}),
        defaultStyleJson: parseJsonMaybe(bgRow.default_style_json, {}),
        displayConfigJson: parseJsonMaybe(bgRow.display_config_json, {}),
        cardData,
        localStyles: {},
        localDisplayConfig: {},
        avatarUrl: avatarDataUrl.startsWith("data:") ? avatarDataUrl : null,
        logoUrl: logoDataUrl.startsWith("data:") ? logoDataUrl : DEFAULT_ECARD_LOGO_FILE,
        qrDataUrl,
        showQrCode,
        companyNameEnabled: Boolean(styleRow.company_name_enabled),
        backgroundImagePath: bgRow.image_url ? path.join(ecardImagesDir, path.basename(String(bgRow.image_url))) : null,
      });
      return response.json({ imageDataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}` });
    } catch (error) {
      console.error("Failed to render trial ecard preview:", error);
      return response.status(500).json({ message: "生成名片預覽失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 為本批試用帳號批量生成/更新電子名片（添加成功後的第二步）
  app.post("/api/admin/trials/ecards", requireAdmin, async (request, response) => {
    const isPlatform = request.admin.accountType === "platform";
    const ownTenantId = Number(request.admin.tenantId) || null;
    if (!isPlatform && !ownTenantId) {
      return response.status(403).json({ message: "沒有可用的租戶身分。" });
    }
    const styleId = Number(request.body?.templateId) || 0;
    if (!styleId) {
      return response.status(400).json({ message: "請選擇名片樣式。" });
    }
    let backgroundId = Number(request.body?.backgroundId) || 0;
    const company = clean(request.body?.company, 120);
    const logoDataUrl = typeof request.body?.logoDataUrl === "string" ? request.body.logoDataUrl : "";
    const rawAccounts = Array.isArray(request.body?.accounts) ? request.body.accounts : null;
    let accountsInput = [];
    if (rawAccounts) {
      accountsInput = rawAccounts
        .map((item) => ({
          trialId: Number(item?.trialId),
          name: clean(item?.name, 120),
          titleZh: clean(item?.titleZh, 120),
          titleEn: item?.titleEn !== undefined ? clean(item.titleEn, 120) : undefined,
          phone: clean(item?.phone, 40),
          email: clean(item?.email, 255),
          zipCode: item?.zipCode !== undefined ? clean(item.zipCode, 40) : undefined,
          address: item?.address !== undefined ? clean(item.address, 240) : undefined,
          qrDesc: item?.qrDesc !== undefined ? clean(item.qrDesc, 120) : undefined,
          companyZh: item?.companyZh !== undefined ? clean(item.companyZh, 120) : undefined,
          companyEn: item?.companyEn !== undefined ? clean(item.companyEn, 120) : undefined,
          sloganZh: item?.sloganZh !== undefined ? clean(item.sloganZh, 160) : undefined,
          sloganEn: item?.sloganEn !== undefined ? clean(item.sloganEn, 160) : undefined,
          showQrCode: item?.showQrCode !== undefined ? item.showQrCode !== false : undefined,
          avatarDataUrl: typeof item?.avatarDataUrl === "string" ? item.avatarDataUrl : "",
          enableVideoCall: item?.enableVideoCall !== false,
          enableTextChat: item?.enableTextChat !== false,
        }))
        .filter((item) => Number.isInteger(item.trialId) && item.trialId > 0)
        .slice(0, MAX_ASSIGN_COUNT);
    } else {
      // 兼容旧结构：trialIds + 统一 position/phone/开关
      const position = clean(request.body?.position, 120);
      const phone = clean(request.body?.phone, 40);
      const enableVideoCall = request.body?.enableVideoCall !== false;
      const enableTextChat = request.body?.enableTextChat !== false;
      const trialIds = normalizeIds(request.body?.trialIds).slice(0, MAX_ASSIGN_COUNT);
      accountsInput = trialIds.map((trialId) => ({
        trialId,
        name: "",
        titleZh: position,
        phone,
        email: "",
        avatarDataUrl: "",
        enableVideoCall,
        enableTextChat,
      }));
    }
    if (accountsInput.length === 0) {
      return response.status(400).json({ message: "請選擇要生成名片的帳號。" });
    }

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const [styleRow] = await connection.query(
        "SELECT id FROM ecard_styles WHERE id = ? AND status = 'active' LIMIT 1",
        [styleId],
      );
      if (!styleRow) {
        await connection.rollback();
        return response.status(400).json({ message: "名片樣式不存在或已停用。" });
      }
      if (backgroundId) {
        const [bgRow] = await connection.query(
          "SELECT id FROM ecard_style_backgrounds WHERE id = ? AND style_id = ? LIMIT 1",
          [backgroundId, styleId],
        );
        if (!bgRow) {
          await connection.rollback();
          return response.status(400).json({ message: "背景不屬於所選樣式。" });
        }
      } else {
        const [firstBg] = await connection.query(
          "SELECT id FROM ecard_style_backgrounds WHERE style_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1",
          [styleId],
        );
        backgroundId = firstBg ? Number(firstBg.id) : 0;
      }

      const reservedTenantId = await getReservedTrialTenantId(connection);
      const baseUrl = process.env.ECARD_APP_URL || "https://ecard.qrtalkie.org";
      const results = [];
      for (const input of accountsInput) {
        const trialId = input.trialId;
        const [trial] = await connection.query(
          `SELECT ta.id, ta.sip_user_id, ta.owner_tenant_id, ta.status, u.username, u.display_name
           FROM trial_assignments ta
           JOIN sip_users u ON u.id = ta.sip_user_id
           WHERE ta.id = ?
           FOR UPDATE`,
          [trialId],
        );
        if (!trial || (trial.status !== "active" && trial.status !== "paused")) {
          await connection.rollback();
          return response.status(409).json({ message: "部分試用記錄不存在或已結束，請重新整理後重試。" });
        }
        if (!isPlatform && Number(trial.owner_tenant_id) !== ownTenantId) {
          await connection.rollback();
          return response.status(403).json({ message: "只能操作本租戶發出的試用。" });
        }
        const sipUserId = Number(trial.sip_user_id);
        const [existing] = await connection.query(
          "SELECT id, access_slug, avatar_url, logo_url FROM tenant_ecards WHERE sip_user_id = ? LIMIT 1",
          [sipUserId],
        );
        const accessSlug = existing?.access_slug || `ec-${sipUserId}-${Math.random().toString(36).slice(2, 8)}`;
        // 頭像：本次提供 data URL 則存檔；未提供則沿用原頭像
        let avatarPath = "";
        if (input.avatarDataUrl) {
          try {
            avatarPath = await saveEcardImageFile(input.avatarDataUrl);
          } catch (imageError) {
            await connection.rollback();
            return response.status(imageError.statusCode || 400).json({ message: imageError.message || "頭像圖片無效。" });
          }
        } else {
          avatarPath = existing?.avatar_url || "";
        }
        // 企業 Logo：本次上傳 > 沿用原 Logo > 默認 QRTalkie Logo
        let logoPath = DEFAULT_ECARD_LOGO_URL;
        if (logoDataUrl) {
          try {
            logoPath = await saveEcardImageFile(logoDataUrl);
          } catch (imageError) {
            await connection.rollback();
            return response.status(imageError.statusCode || 400).json({ message: imageError.message || "Logo 圖片無效。" });
          }
        } else if (existing?.logo_url) {
          logoPath = existing.logo_url;
        }
        const cardData = {
          name: input.name || String(trial.display_name || trial.username || "").trim() || String(trial.username || ""),
          titleZh: input.titleZh,
          titleEn: input.titleEn ?? "",
          phone: input.phone,
          email: input.email,
          zipCode: input.zipCode ?? "",
          address: input.address ?? "",
          qrDesc: input.qrDesc ?? "掃碼二維碼 · 交換名片",
          companyZh: input.companyZh ?? company,
          companyEn: input.companyEn ?? (input.companyZh ?? company),
          sloganZh: input.sloganZh ?? "",
          sloganEn: input.sloganEn ?? "",
        };
        const ecardDataJson = {
          cardData,
          selectedTemplateId: styleId,
          selectedBackgroundId: backgroundId,
          showQrCode: input.showQrCode !== undefined ? input.showQrCode : (request.body?.showQrCode !== false),
          callPublicSlug: accessSlug,
          avatarDataUrl: avatarPath || "",
          logoDataUrl: logoPath,
        };
        await connection.query(
          `INSERT INTO tenant_ecards (
             tenant_id, sip_user_id, access_slug, status, enable_video_call, enable_text_chat,
             avatar_url, logo_url, created_by_admin_id, ecard_data_json, created_at, updated_at
           )
           VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE
             tenant_id = VALUES(tenant_id),
             access_slug = VALUES(access_slug),
             status = 'active',
             enable_video_call = VALUES(enable_video_call),
             enable_text_chat = VALUES(enable_text_chat),
             avatar_url = VALUES(avatar_url),
             logo_url = VALUES(logo_url),
             ecard_data_json = VALUES(ecard_data_json),
             updated_at = NOW()`,
          [
            reservedTenantId || 0,
            sipUserId,
            accessSlug,
            input.enableVideoCall ? 1 : 0,
            input.enableTextChat ? 1 : 0,
            avatarPath || null,
            logoPath,
            request.admin.id,
            JSON.stringify(ecardDataJson),
          ],
        );
        results.push({
          trialId,
          sipUserId,
          username: trial.username || "",
          displayName: trial.display_name || "",
          slug: accessSlug,
          url: `${baseUrl}/u/${accessSlug}`,
        });
      }

      await connection.commit();
      console.log(JSON.stringify({ src: "trial-ecard", ts: new Date().toISOString(), adminId: request.admin.id, count: results.length }));
      return response.json({
        message: `已生成 ${results.length} 張電子名片。`,
        data: { results },
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Failed to generate trial ecards:", error);
      return response.status(500).json({ message: "生成電子名片失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 恢復暫停的試用（僅限未到期；先啟用 AM 確認，再翻回本地狀態）
  app.post("/api/admin/trials/:id/resume", requireAdmin, async (request, response) => {
    const trialId = Number(request.params.id);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return response.status(400).json({ message: "試用記錄編號無效。" });
    }
    const isPlatform = request.admin.accountType === "platform";

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const rows = await connection.query(
        `SELECT ta.*, u.username, DATE_FORMAT(ta.expires_at, '%Y-%m-%d') AS expires_date
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
      if (trial.status !== "paused") {
        await connection.rollback();
        return response.status(409).json({ message: "該試用不在暫停狀態，無法恢復。" });
      }
      if (String(trial.expires_date || "") < todayDate()) {
        await connection.rollback();
        return response.status(409).json({ message: "試用已到期，無法恢復（可執行立即回庫）。" });
      }

      try {
        await resumeTrialAssignment(connection, { trialId, sipUserId: Number(trial.sip_user_id) });
      } catch (flexisipError) {
        await connection.rollback();
        console.error("Failed to resume trial (AM step):", flexisipError);
        if (flexisipError?.code === "FLEXISIP_MAPPING_MISMATCH") {
          return response.status(409).json({ message: "帳號在通訊核心的映射異常，無法安全恢復，請聯繫技術處理。" });
        }
        return response.status(502).json({ message: "帳號在通訊核心（AM）啟用確認失敗，恢復已取消，請稍後重試。" });
      }

      await connection.commit();
      console.log(JSON.stringify({
        src: "trial-resume",
        ts: new Date().toISOString(),
        adminId: request.admin.id,
        trialId,
        username: trial.username || "",
      }));
      return response.json({
        message: `試用帳號 ${trial.username || trial.sip_user_id} 已恢復，功能與帳號已重新啟用。`,
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Failed to resume trial assignment:", error);
      return response.status(500).json({ message: "恢復試用操作失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 試用帳號資訊設置（對齊租戶端「帳號管理」編輯彈窗）：顯示名/郵箱/電話/密碼
  // GET /api/admin/trials/:id/account-settings - 讀取當前帳號資訊（編輯回填）
  app.get("/api/admin/trials/:id/account-settings", requireAdmin, async (request, response) => {
    const trialId = Number(request.params.id);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return response.status(400).json({ message: "試用記錄編號無效。" });
    }
    const isPlatform = request.admin.accountType === "platform";
    let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query(
        `SELECT ta.id, ta.owner_tenant_id, ta.sip_user_id,
                u.username, u.sip_domain, u.display_name, u.email, u.phone_number, u.avatar_url
         FROM trial_assignments ta
         JOIN sip_users u ON u.id = ta.sip_user_id
         WHERE ta.id = ? LIMIT 1`,
        [trialId],
      );
      const row = rows[0];
      if (!row) return response.status(404).json({ message: "找不到試用記錄。" });
      if (!isPlatform && Number(row.owner_tenant_id) !== Number(request.admin.tenantId)) {
        return response.status(403).json({ message: "只能操作本租戶發出的試用。" });
      }
      let vcardData = null;
      try {
        const vcard = await readAccountVcard(row.username, row.sip_domain);
        vcardData = vcard?.data || null;
      } catch (vcardErr) {
        console.error("[trial-account-settings] vcard read failed:", vcardErr?.message || vcardErr);
      }
      // 首次設置（資料卡尚無公司）時以歸屬租戶名稱作默認值，用戶可再修改
      const [tenantRow] = await connection.query(
        `SELECT name FROM tenants WHERE id = ? LIMIT 1`,
        [row.owner_tenant_id],
      );
      return response.json({
        account: {
          id: Number(row.sip_user_id),
          username: row.username || "",
          displayName: row.display_name || "",
          email: row.email || "",
          phone: row.phone_number || "",
          company: vcardData?.company || tenantRow?.name || "",
          jobTitle: vcardData?.jobTitle || "",
          avatarUrl: row.avatar_url || vcardData?.photoUrl || "",
        },
      });
    } catch (error) {
      console.error("Failed to read trial account settings:", error);
      return response.status(500).json({ message: "讀取帳號資訊失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // GET /api/admin/trials/:id/ecard - 讀取當前電子名片（與租戶端 /tenant/ecard-accounts/:id/ecard 同形，供生成頁回填）
  app.get("/api/admin/trials/:id/ecard", requireAdmin, async (request, response) => {
    const trialId = Number(request.params.id);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return response.status(400).json({ message: "試用記錄編號無效。" });
    }
    const isPlatform = request.admin.accountType === "platform";
    let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query(
        `SELECT ta.id, ta.owner_tenant_id, ta.sip_user_id,
                DATE_FORMAT(ta.started_at, '%Y-%m-%d') AS started_date,
                DATE_FORMAT(ta.expires_at, '%Y-%m-%d') AS expires_date,
                u.username
         FROM trial_assignments ta
         JOIN sip_users u ON u.id = ta.sip_user_id
         WHERE ta.id = ? LIMIT 1`,
        [trialId],
      );
      const trial = rows[0];
      if (!trial) return response.status(404).json({ message: "找不到試用記錄。" });
      if (!isPlatform && Number(trial.owner_tenant_id) !== Number(request.admin.tenantId)) {
        return response.status(403).json({ message: "只能操作本租戶發出的試用。" });
      }
      const ecardRows = await connection.query(
        `SELECT ecard_data_json, card_data_json, thumbnail_url, avatar_url, access_slug, status
         FROM tenant_ecards WHERE sip_user_id = ? LIMIT 1`,
        [Number(trial.sip_user_id)],
      );
      const ecard = ecardRows[0];
      return response.json({
        ecardDataJson: parseJsonMaybe(ecard?.ecard_data_json || ecard?.card_data_json, {}) || {},
        thumbnailUrl: ecard?.thumbnail_url || null,
        avatarUrl: ecard?.avatar_url || null,
        accessSlug: ecard?.access_slug || null,
        validFrom: trial.started_date || null,
        validTo: trial.expires_date || null,
        status: ecard?.status || null,
      });
    } catch (error) {
      console.error("Failed to read trial ecard:", error);
      return response.status(500).json({ message: "讀取電子名片設置失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // POST /api/admin/trials/:id/ecard - 儲存電子名片（與租戶端同形 payload：cardData 全量 + 縮略圖；生成頁復用）
  app.post("/api/admin/trials/:id/ecard", requireAdmin, async (request, response) => {
    const trialId = Number(request.params.id);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return response.status(400).json({ message: "試用記錄編號無效。" });
    }
    const isPlatform = request.admin.accountType === "platform";
    const payload = request.body || {};
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const rows = await connection.query(
        `SELECT id, owner_tenant_id, sip_user_id, status FROM trial_assignments WHERE id = ? FOR UPDATE`,
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
      if (trial.status !== "active" && trial.status !== "paused") {
        await connection.rollback();
        return response.status(409).json({ message: "該試用已結束或已回收，無法編輯電子名片。" });
      }

      const sipUserId = Number(trial.sip_user_id);
      const reservedTenantId = await getReservedTrialTenantId(connection);
      const existingRows = await connection.query(
        "SELECT access_slug, avatar_url, logo_url FROM tenant_ecards WHERE sip_user_id = ? LIMIT 1",
        [sipUserId],
      );
      const existing = existingRows[0];

      let avatarUrl = typeof payload.avatarDataUrl === "string" ? payload.avatarDataUrl.trim() : "";
      if (avatarUrl.startsWith("data:")) {
        avatarUrl = await saveEcardImageFile(avatarUrl);
      } else if (/^https?:\/\//.test(avatarUrl)) {
        // 已托管地址（如帳號設置的頭像），直接採用
      } else {
        avatarUrl = existing?.avatar_url || "";
      }
      let logoUrl = typeof payload.logoDataUrl === "string" ? payload.logoDataUrl : "";
      if (logoUrl.startsWith("data:")) {
        logoUrl = await saveEcardImageFile(logoUrl);
      } else {
        logoUrl = existing?.logo_url || DEFAULT_ECARD_LOGO_URL;
      }
      let thumbnailUrl = typeof payload.thumbnailDataUrl === "string" ? payload.thumbnailDataUrl : "";
      if (thumbnailUrl.startsWith("data:")) {
        thumbnailUrl = await saveEcardImageFile(thumbnailUrl);
      } else {
        thumbnailUrl = "";
      }

      const ecardDataJson = parseJsonMaybe(payload.ecardDataJson, {}) || {};
      ecardDataJson.avatarDataUrl = avatarUrl;
      ecardDataJson.logoDataUrl = logoUrl;
      const enableVideoCall = payload.enableVideoCall !== false;
      const enableTextChat = payload.enableTextChat !== false;
      const accessSlug = clean(payload.accessSlug, 60)
        || existing?.access_slug
        || `ec-${sipUserId}-${Math.random().toString(36).slice(2, 8)}`;

      await connection.query(
        `INSERT INTO tenant_ecards (
           tenant_id, sip_user_id, access_slug, avatar_url, logo_url, thumbnail_url, status, enable_video_call, enable_text_chat,
           created_by_admin_id, ecard_data_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           tenant_id = VALUES(tenant_id),
           access_slug = VALUES(access_slug),
           avatar_url = VALUES(avatar_url),
           logo_url = VALUES(logo_url),
           thumbnail_url = VALUES(thumbnail_url),
           status = 'active',
           enable_video_call = VALUES(enable_video_call),
           enable_text_chat = VALUES(enable_text_chat),
           ecard_data_json = VALUES(ecard_data_json),
           updated_at = NOW()`,
        [
          reservedTenantId || 0,
          sipUserId,
          accessSlug,
          avatarUrl || null,
          logoUrl || null,
          thumbnailUrl || null,
          enableVideoCall ? 1 : 0,
          enableTextChat ? 1 : 0,
          request.admin.id,
          JSON.stringify(ecardDataJson),
        ],
      );
      await connection.commit();
      console.log(JSON.stringify({ src: "trial-ecard-save", ts: new Date().toISOString(), adminId: request.admin.id, trialId, sipUserId }));
      return response.json({ message: "電子名片已儲存", accessSlug });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Failed to save trial ecard:", error);
      return response.status(500).json({ message: "儲存失敗", detail: error.message || String(error) });
    } finally {
      if (connection) connection.release();
    }
  });

  // PUT /api/admin/trials/:id/account-settings - 更新帳號資訊（同步 Flexisip，保留激活態）
  app.put("/api/admin/trials/:id/account-settings", requireAdmin, async (request, response) => {
    const trialId = Number(request.params.id);
    if (!Number.isInteger(trialId) || trialId <= 0) {
      return response.status(400).json({ message: "試用記錄編號無效。" });
    }
    const isPlatform = request.admin.accountType === "platform";
    const displayName = clean(request.body?.displayName, 120);
    const email = clean(request.body?.email, 255);
    const phone = clean(request.body?.phone, 40);
    const password = String(request.body?.password || "");
    const confirmPassword = String(request.body?.confirmPassword || "");
    // 賬號資料卡字段（與 App 聯繫人編輯頁同一存儲；presence 判斷避免誤清空）
    const hasCompany = request.body?.company !== undefined;
    const company = hasCompany ? clean(request.body?.company, 120) : "";
    const hasJobTitle = request.body?.jobTitle !== undefined;
    const jobTitle = hasJobTitle ? clean(request.body?.jobTitle, 120) : "";
    const avatarDataUrl = typeof request.body?.avatarDataUrl === "string" ? request.body.avatarDataUrl : "";
    const removeAvatar = request.body?.removeAvatar === true;
    const hasProfileUpdate = hasCompany || hasJobTitle || Boolean(avatarDataUrl) || removeAvatar;
    if (email && !isEmailLike(email)) {
      return response.status(400).json({ message: "請輸入有效的電子郵箱。" });
    }
    if (password || confirmPassword) {
      if (password.length < 6) {
        return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
      }
      if (password !== confirmPassword) {
        return response.status(400).json({ message: "兩次輸入的密碼不一致。" });
      }
    }

    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const rows = await connection.query(
        `SELECT ta.id, ta.owner_tenant_id, ta.sip_user_id, ta.status,
                DATE_FORMAT(ta.expires_at, '%Y-%m-%d') AS expires_date, u.username
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
      if (String(trial.expires_date || "") < todayDate()) {
        await connection.rollback();
        return response.status(409).json({ message: "試用已到期，無法編輯帳號資訊。" });
      }

      const sipRows = await connection.query(
        `SELECT id, username, sip_domain, display_name, email, phone_number, status,
                flexisip_account_id, sip_uri, sync_status
         FROM sip_users WHERE id = ? LIMIT 1 FOR UPDATE`,
        [Number(trial.sip_user_id)],
      );
      const sipUser = sipRows[0];
      if (!sipUser) {
        await connection.rollback();
        return response.status(404).json({ message: "找不到帳號。" });
      }

      // ── 賬號資料卡（vCard）與頭像：寫入與 App 同源存儲（登錄後自動使用）──
      if (hasProfileUpdate) {
        try {
          const vcardUpdates = { displayName };
          vcardUpdates.phone = phone ? phone.replace(/[\s\-\(\)]/g, '') : "";
          if (hasCompany) vcardUpdates.company = company;
          if (hasJobTitle) vcardUpdates.jobTitle = jobTitle;
          let nextAvatarUrl = null;
          if (avatarDataUrl) nextAvatarUrl = await saveAccountAvatar(sipUser.username, avatarDataUrl);
          if (removeAvatar) nextAvatarUrl = "";
          if (nextAvatarUrl !== null) {
            vcardUpdates.photoUrl = nextAvatarUrl;
            await connection.query(`UPDATE sip_users SET avatar_url = ? WHERE id = ?`, [nextAvatarUrl || null, sipUser.id]);
          }
          await mergeAccountVcard(sipUser.username, sipUser.sip_domain, vcardUpdates);
        } catch (profileErr) {
          await connection.rollback();
          if (profileErr?.statusCode) {
            return response.status(profileErr.statusCode).json({ message: profileErr.message });
          }
          console.error("Trial account profile (vcard/avatar) update failed:", profileErr?.message || profileErr);
          return response.status(502).json({ message: "賬號資料卡儲存失敗，請稍後重試。", code: "ACCOUNT_PROFILE_FAILED" });
        }
      }

      // ── Flexisip 同步：updateAccount 會重置激活態——先讀前態，更新後恢復（暫停帳號保持停用，不會被誤激活）──
      let flexisipAccountId = sipUser.flexisip_account_id || null;
      if (!flexisipAccountId && sipUser.sip_uri) {
        try {
          const sr = await searchAccountBySip(sipUser.sip_uri);
          flexisipAccountId = sr?.id;
        } catch {}
      }
      if (!flexisipAccountId && sipUser.sip_domain) {
        try {
          const constructed = `sip:${sipUser.username}@${sipUser.sip_domain}`;
          const sr = await searchAccountBySip(constructed);
          flexisipAccountId = sr?.id;
          if (flexisipAccountId) {
            await connection.query(
              `UPDATE sip_users SET flexisip_account_id = ?, sip_uri = ? WHERE id = ?`,
              [flexisipAccountId, constructed, sipUser.id],
            );
          }
        } catch {}
      }

      if (flexisipAccountId) {
        const normalizedPhone = phone ? phone.replace(/[\s\-\(\)]/g, '') : '';
        const flexisipPayload = { username: sipUser.username, algorithm: "SHA-256" };
        flexisipPayload.display_name = displayName || null;
        flexisipPayload.email = email || null;
        flexisipPayload.phone = normalizedPhone || null;
        if (password) {
          flexisipPayload.password = password;
        }
        let wasActivated = false;
        try {
          const remote = await flexisipGetAccount(flexisipAccountId);
          wasActivated = remote?.activated === true || remote?.activated === 1;
        } catch {}
        try {
          await flexisipUpdateAccount(flexisipAccountId, flexisipPayload);
          if (wasActivated) {
            await flexisipActivateAccount(flexisipAccountId);
          }
        } catch (flexisipErr) {
          await connection.rollback();
          if (flexisipErr?.status === 404) {
            return response.status(502).json({ message: "遠端帳號不存在，無法更新。", code: "FLEXISIP_ACCOUNT_NOT_FOUND" });
          }
          // AM 的 422 校驗錯誤轉為中文提示（不向界面暴露英文技術文案）
          const errs = flexisipErr?.responseBody?.errors || {};
          const phoneMsgs = Array.isArray(errs.phone) ? errs.phone : [];
          if (phoneMsgs.length > 0) {
            const taken = phoneMsgs.some((m) => /already/i.test(String(m)));
            return response.status(400).json({
              message: taken ? "該電話號碼已被其他帳號使用。" : "電話號碼無效，請使用國際格式（如 +886912345678）。",
              code: "FLEXISIP_PHONE_REJECTED",
            });
          }
          if (errs.email) {
            return response.status(400).json({ message: "該電子郵箱已被其他帳號使用。", code: "FLEXISIP_EMAIL_REJECTED" });
          }
          console.error("Flexisip update rejected:", flexisipErr?.status, JSON.stringify(errs).substring(0, 500));
          return response.status(502).json({ message: "遠端帳號資訊同步失敗，請稍後重試。", code: "FLEXISIP_UPDATE_FAILED" });
        }
      }

      let updateSql = `UPDATE sip_users SET display_name = ?, email = ?, phone_number = ?`;
      const updateParams = [displayName || null, email, phone || null];
      if (password) {
        updateSql += `, password_hash = ?`;
        updateParams.push(await hashPassword(password));
      }
      updateSql += ` WHERE id = ?`;
      updateParams.push(Number(sipUser.id));
      await connection.query(updateSql, updateParams);

      await connection.commit();
      console.log(JSON.stringify({
        src: "trial-account-settings",
        ts: new Date().toISOString(),
        adminId: request.admin.id,
        trialId,
        username: sipUser.username || "",
      }));
      return response.json({
        message: "帳號資訊已更新。",
        account: { id: Number(sipUser.id), username: sipUser.username || "", displayName, email, phone },
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Failed to update trial account settings:", error);
      return response.status(500).json({ message: "帳號資訊更新失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });

  // 暫停（可恢復）/ 立即回庫（僅平台管理員）
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

      if (action === "end") {
        // 暫停（可恢復）：通訊核心停用 + 本地翻狀態；到期日/歸屬/配對全部保留
        await pauseTrialAssignment(connection, {
          trialId,
          sipUserId: Number(trial.sip_user_id),
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
          ? `試用帳號 ${trial.username || trial.sip_user_id} 已暫停（試用期不變，到期前可隨時恢復）。`
          : `試用帳號 ${trial.username || trial.sip_user_id} 已立即回庫。`,
      });
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      console.error("Failed to end trial assignment:", error);
      if (error?.code === "FLEXISIP_STATE_CONFIRM_FAILED") {
        return response.status(502).json({ message: "帳號在通訊核心（AM）停用確認失敗，本次操作已取消，請稍後重試。" });
      }
      return response.status(500).json({ message: "試用結束操作失敗。" });
    } finally {
      if (connection) connection.release();
    }
  });
}
