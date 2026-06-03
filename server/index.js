﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿import "dotenv/config";
import express from "express";
import { mkdir, unlink, writeFile, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { createEmailToken, createNumericCode, createSessionToken, hashPassword, hashToken, verifyPassword } from "./security.js";
import { queueLoginEmailChangeCode, queuePasswordResetEmail, queueVerificationEmail } from "./email.js";
import { startScheduler } from "./scheduler.js";

const app = express();
const port = Number(process.env.API_PORT || 3001);
const appUrl = process.env.APP_URL || "http://127.0.0.1:5173";
const sipDomain = process.env.SIP_DOMAIN || "sip.qrtalkie.org";
const webrtcDomain = process.env.WEBRTC_DOMAIN || process.env.webrtc_domain || "pbx.qrtalkie.org";
const callCenterBaseUrl = process.env.CALL_CENTER_BASE_URL || appUrl;
const accessBaseUrl = process.env.ACCESS_BASE_URL || appUrl;
const couponCurrencyCodes = new Set(["TWD", "CNY", "USD", "EUR"]);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paymentProofsDir = path.join(projectRoot, "assets/payment-proofs");
const paymentMethodIconsDir = path.join(projectRoot, "assets/payment-method-icons");
const ecardImagesDir = path.join(projectRoot, "assets/ecard-images");
const callCenterImagesDir = path.join(projectRoot, "assets/call-center-images");

app.use(express.json({ limit: "12mb" }));
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", appUrl);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  return next();
});
app.use("/payment-proofs", express.static(paymentProofsDir));
app.use("/payment-method-icons", express.static(paymentMethodIconsDir));
app.use("/ecard-images", express.static(ecardImagesDir));
app.use("/call-center-images", express.static(callCenterImagesDir));

// 为前端 Vite Proxy 代理提供支持，挂载带 /api 前缀的静态资源路径
app.use("/api/payment-proofs", express.static(paymentProofsDir));
app.use("/api/payment-method-icons", express.static(paymentMethodIconsDir));
app.use("/api/ecard-images", express.static(ecardImagesDir));
app.use("/api/call-center-images", express.static(callCenterImagesDir));
app.use("/visitor-assets", express.static(path.join(projectRoot, "public/visitor")));

// GET /access/visitor - 門禁入口訪客拜訪頁面（type=01社區/02樓宇 & lockId=設備UUID）
app.get("/access/visitor", async (request, response) => {
  const entranceType = request.query.type || '';
  const lockId = sanitizeString(String(request.query.lockId || ''), 120);
  if (!lockId || !['01','02'].includes(entranceType)) {
    return response.status(400).send("<h2 style='text-align:center;margin-top:20vh;'>400 Bad Request</h2><p style='text-align:center;'>無效的訪問鏈接。</p>");
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // Find entrance by device_uuid via gate_devices
    const [device] = await connection.query(
      "SELECT id, tenant_id FROM gate_devices WHERE device_uuid = ? LIMIT 1",
      [lockId]
    );
    if (!device) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>設備不存在。</p>");
    }

    // Find entrance bound to this device
    const entranceId = Number(request.query.entrance) || 0;
    let entrance;
    if (entranceId) {
      [entrance] = await connection.query(
        "SELECT id, name, community_id, building_id FROM access_entrances WHERE id = ? AND device_id = ? AND tenant_id = ?",
        [entranceId, device.id, device.tenant_id]
      );
    } else {
      [entrance] = await connection.query(
        "SELECT id, name, community_id, building_id FROM access_entrances WHERE device_id = ? AND tenant_id = ? LIMIT 1",
        [device.id, device.tenant_id]
      );
    }
    if (!entrance) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>該設備尚未綁定入口。</p>");
    }

    // Get community from entrance
    let communityId = null;
    if (entrance.community_id) {
      communityId = entrance.community_id;
    } else if (entrance.building_id) {
      const [bld] = await connection.query("SELECT community_id FROM access_buildings WHERE id = ?", [entrance.building_id]);
      if (bld) communityId = bld.community_id;
    }
    if (!communityId) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>所屬社區不存在。</p>");
    }

    const [community] = await connection.query(
      `SELECT id, tenant_id, name, address, slug, contact_person, contact_phone,
              logo_url, banner_url, visitor_title, show_tips, tips_text
       FROM access_communities WHERE id = ? AND is_active = 1 LIMIT 1`,
      [communityId]
    );
    if (!community) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>該社區不存在或已停用。</p>");
    }

    // Get authorized rooms for this entrance
    const authRows = await connection.query(
      "SELECT room_id FROM access_room_entrance_auth WHERE entrance_id = ? AND tenant_id = ?",
      [entrance.id, community.tenant_id]
    );
    const authorizedRoomIds = new Set(authRows.map(r => Number(r.room_id)));

    const buildings = await connection.query(
      "SELECT b.id, b.name FROM access_buildings b WHERE b.community_id = ? AND b.tenant_id = ? ORDER BY b.name",
      [community.id, community.tenant_id]
    );
    const bIds = buildings.map(b => b.id);
    let rooms = [];
    if (bIds.length > 0) {
      rooms = await connection.query(
        `SELECT r.id, r.building_id, r.room_number, r.floor,
                COALESCE(s.display_name, s.username, '') AS resident_name,
                s.username AS sip_username,
                wu.username AS web_username
         FROM access_rooms r
         LEFT JOIN sip_users s ON s.id = r.sip_user_id
         LEFT JOIN tenant_web_account_entitlements ent ON ent.sip_user_id = s.id AND ent.tenant_id = r.tenant_id AND ent.status = 'active'
         LEFT JOIN web_users wu ON wu.id = ent.web_user_id
         WHERE r.building_id IN (?) AND r.tenant_id = ? ORDER BY r.room_number`,
        [bIds, community.tenant_id]
      );
    }

    // Filter to authorized rooms only
    rooms = rooms.filter(r => authorizedRoomIds.has(Number(r.id)));
    const bldWithRooms = new Set(rooms.map(r => Number(r.building_id)));
    buildings.splice(0, buildings.length, ...buildings.filter(b => bldWithRooms.has(Number(b.id))));

    const [tenant] = await connection.query("SELECT name FROM tenants WHERE id = ?", [community.tenant_id]);
    const tenantName = tenant?.name || '';

    const data = {
      name: (community.visitor_title || community.name) + '訪客服務平台',
      tenantName: tenantName,
      communityName: community.name,
      address: community.address || '',
      logoUrl: community.logo_url || '',
      bannerUrl: community.banner_url || '',
      showTips: community.show_tips == null ? true : !!community.show_tips,
      tipsText: community.tips_text || '溫馨提示：如遇門禁問題或需要幫助，請聯繫對應樓宇或房間服務人員。',
      buildings: buildings.map(b => ({ id: Number(b.id), name: b.name })),
      rooms: rooms.map(r => ({
        id: Number(r.id), buildingId: Number(r.building_id),
        roomNumber: r.room_number, floor: r.floor || null,
        residentName: r.resident_name || null,
        sipAccount: r.sip_username || null,
        displayName: r.resident_name || null,
      })),
      sipAccounts: rooms.filter(r => r.sip_username).map(r => ({
        roomNumber: r.room_number,
        sipAccount: r.sip_username || '',
        webAccount: r.web_username || '',
        displayName: r.resident_name || '',
      })),
    };

    const templatePath = path.resolve(projectRoot, "public/visitor/access-platform.html");
    let html = await readFile(templatePath, "utf-8");
    html = html.replace("url('banner.png')", data.bannerUrl ? `url('${data.bannerUrl}')` : "url('/visitor-assets/banner.png')");
    html = html.replace('</head>', `<script>window.__ACCESS_DATA__ = ${JSON.stringify(data)};</script>\n</head>`);

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.send(html);
  } catch (error) {
    console.error("Failed to render visitor page:", error);
    return response.status(500).send("<h2 style='text-align:center;margin-top:20vh;'>500 Error</h2><p style='text-align:center;'>系統繁忙，請稍後再試。</p>");
  } finally {
    if (connection) connection.release();
  }
});

// GET /access/:slug - 門禁訪客拜訪頁面
app.get("/access/:slug", async (request, response) => {
  const slug = sanitizeString(request.params.slug, 100);
  if (!slug) return response.status(400).send("Invalid access URL.");

  const entranceId = Number(request.query.entrance) || 0;

  let connection;
  try {
    connection = await pool.getConnection();
    const [community] = await connection.query(
      `SELECT id, tenant_id, name, address, slug, contact_person, contact_phone,
              logo_url, banner_url, visitor_title, show_tips, tips_text
       FROM access_communities WHERE slug = ? AND is_active = 1 LIMIT 1`,
      [slug]
    );
    if (!community) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>該社區不存在或已停用。</p>");
    }

    // If entrance-specific access, get authorized room IDs
    let authorizedRoomIds = null;
    if (entranceId) {
      const authRows = await connection.query(
        "SELECT room_id FROM access_room_entrance_auth WHERE entrance_id = ? AND tenant_id = ?",
        [entranceId, community.tenant_id]
      );
      authorizedRoomIds = new Set(authRows.map(r => Number(r.room_id)));
    }

    const buildings = await connection.query(
      `SELECT b.id, b.name FROM access_buildings b WHERE b.community_id = ? AND b.tenant_id = ? ORDER BY b.name`,
      [community.id, community.tenant_id]
    );
    const bIds = buildings.map(b => b.id);
    let rooms = [];
    if (bIds.length > 0) {
      rooms = await connection.query(
        `SELECT r.id, r.building_id, r.room_number, r.floor,
                COALESCE(s.display_name, s.username, '') AS resident_name,
                s.username AS sip_username,
                wu.username AS web_username
         FROM access_rooms r
         LEFT JOIN sip_users s ON s.id = r.sip_user_id
         LEFT JOIN tenant_web_account_entitlements ent ON ent.sip_user_id = s.id AND ent.tenant_id = r.tenant_id AND ent.status = 'active'
         LEFT JOIN web_users wu ON wu.id = ent.web_user_id
         WHERE r.building_id IN (?) AND r.tenant_id = ? ORDER BY r.room_number`,
        [bIds, community.tenant_id]
      );
    }

    // Filter by authorized rooms if entrance-specific
    if (authorizedRoomIds) {
      rooms = rooms.filter(r => authorizedRoomIds.has(Number(r.id)));
      // Only keep buildings that have authorized rooms
      const bldWithRooms = new Set(rooms.map(r => Number(r.building_id)));
      buildings.splice(0, buildings.length, ...buildings.filter(b => bldWithRooms.has(Number(b.id))));
    }

    const [tenant] = await connection.query('SELECT name FROM tenants WHERE id = ?', [community.tenant_id]);
    const tenantName = tenant?.name || '';

    const data = {
      name: (community.visitor_title || community.name) + '訪客服務平台',
      tenantName: tenantName,
      communityName: community.name,
      address: community.address || '',
      logoUrl: community.logo_url || '',
      bannerUrl: community.banner_url || '',
      showTips: community.show_tips == null ? true : !!community.show_tips,
      tipsText: community.tips_text || '溫馨提示：如遇門禁問題或需要幫助，請聯繫對應樓宇或房間服務人員。',
      buildings: buildings.map(b => ({ id: Number(b.id), name: b.name })),
      rooms: rooms.map(r => ({
        id: Number(r.id), buildingId: Number(r.building_id),
        roomNumber: r.room_number, floor: r.floor || null,
        residentName: r.resident_name || null,
        sipAccount: r.sip_username || null,
        displayName: r.resident_name || null,
      })),
      sipAccounts: rooms.filter(r => r.sip_username).map(r => ({
        roomNumber: r.room_number,
        sipAccount: r.sip_username || '',
        webAccount: r.web_username || '',
        displayName: r.resident_name || '',
      })),
    };

    const templatePath = path.resolve(projectRoot, "public/visitor/access-platform.html");
    let html = await readFile(templatePath, "utf-8");
    html = html.replace('</head>', `<script>window.__ACCESS_DATA__ = ${JSON.stringify(data)};</script>\n</head>`);

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.send(html);
  } catch (error) {
    console.error("Failed to render access visitor page:", error);
    return response.status(500).send("<h2 style='text-align:center;margin-top:20vh;'>500 Error</h2>");
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sanitizeString(value, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

async function removePaymentProofFile(proofUrl) {
  if (!proofUrl || !String(proofUrl).startsWith("/payment-proofs/")) return;
  const fileName = path.basename(String(proofUrl));
  const filePath = path.resolve(paymentProofsDir, fileName);
  const proofDir = path.resolve(paymentProofsDir);
  if (!filePath.startsWith(`${proofDir}${path.sep}`)) return;
  await unlink(filePath).catch((error) => {
    if (error?.code !== "ENOENT") console.warn("Failed to delete payment proof file:", error);
  });
}

function generateMethodCode(displayName, takenCodes = new Set()) {
  let candidate = String(displayName || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^-+|-+$/g, "");

  if (!candidate) candidate = "payment-method";
  if (!/^[a-z0-9]/.test(candidate)) candidate = `m-${candidate}`;
  candidate = candidate.slice(0, 80);
  if (candidate.length < 2) candidate = candidate.padEnd(2, "0");

  let suffix = 0;
  let generated = candidate;
  while (takenCodes.has(generated)) {
    suffix += 1;
    const suffixText = `-${suffix}`;
    generated = `${candidate.slice(0, 80 - suffixText.length)}${suffixText}`;
  }

  return generated;
}

function generateGateDeviceUuid() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = Buffer.from(randomUUID().replace(/-/g, ""), "hex");
  let generated = "";
  for (let index = 0; generated.length < 19; index += 1) {
    generated += alphabet[bytes[index % bytes.length] % alphabet.length];
  }
  return generated;
}

async function savePaymentMethodIcon(dataUrl, methodCode) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return "";

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 512 * 1024) {
    const error = new Error("鍦栨妾旀涓嶅彲瓒呴亷 512KB銆?");
    error.statusCode = 400;
    throw error;
  }

  if (mimeType === "image/svg+xml") {
    const svgText = buffer.toString("utf8");
    if (/<script[\s>]/i.test(svgText) || /\son[a-z]+\s*=/i.test(svgText) || /javascript:/i.test(svgText)) {
      const error = new Error("SVG 鍦栨鍖呭惈涓嶅畨鍏ㄥ収瀹癸紝璜嬫洿鎻涙獢妗堛€?");
      error.statusCode = 400;
      throw error;
    }
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/svg+xml" ? "svg" : mimeType.split("/")[1];
  const safeCode = String(methodCode || "payment-method")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "payment-method";
  await mkdir(paymentMethodIconsDir, { recursive: true });
  const filename = `${safeCode}-${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(paymentMethodIconsDir, filename), buffer);
  return `/payment-method-icons/${filename}`;
}

async function saveEcardImage(dataUrl, originalFileName) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("無效的圖片格式");

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) {
    const error = new Error("圖片不可超過 5MB。");
    error.statusCode = 400;
    throw error;
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  await mkdir(ecardImagesDir, { recursive: true });
  const filename = `ecard-${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(ecardImagesDir, filename), buffer);
  return `/ecard-images/${filename}`;
}

async function saveCallCenterImage(dataUrl, originalFileName) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("無效的圖片格式");

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) {
    const error = new Error("圖片不可超過 5MB。");
    error.statusCode = 400;
    throw error;
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/svg+xml" ? "svg" : mimeType.split("/")[1];
  await mkdir(callCenterImagesDir, { recursive: true });
  const filename = `cc-${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(callCenterImagesDir, filename), buffer);
  return `/call-center-images/${filename}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (String(password || "").length < 8) return "瀵嗙⒓鑷冲皯闇€瑕?8 浣嶅瓧鍏冦€?";
  return "";
}

function parsePermissions(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function requireAdmin(request, response, next) {
  const token = getBearerToken(request);
  if (!token) return response.status(401).json({ message: "请重新登录。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         s.id AS session_id, s.expires_at, s.user_type, s.sip_user_id,
         a.id AS admin_id, a.tenant_id, a.account_type, a.email, a.display_name, a.nickname, a.phone_number,
         a.role, a.platform_role, a.permissions_json, a.status
       FROM admin_sessions s
       LEFT JOIN admin_users a ON a.id = s.admin_user_id AND s.user_type = 'admin'
       WHERE s.token_hash = ?
       LIMIT 1`,
      [hashToken(token)],
    );

    const session = rows[0];
    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      return response.status(401).json({ message: "请重新登录。" });
    }

    if (session.user_type === "sip" && session.sip_user_id) {
      const sipRows = await connection.query(
        `SELECT u.id, u.username, u.tenant_id, u.display_name, u.email, u.phone_number, u.status,
                e.status AS entitlement_status, e.service_expires_at
         FROM sip_users u
         INNER JOIN tenant_sip_account_entitlements e
           ON e.sip_user_id = u.id AND e.tenant_id = u.tenant_id AND e.status = 'active'
         WHERE u.id = ? AND u.status = 'active'
         LIMIT 1`,
        [Number(session.sip_user_id)],
      );
      const sipUser = sipRows[0];
      if (!sipUser) {
        return response.status(401).json({ message: "账号已失效，请重新登录。" });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const expiresAt = sipUser.service_expires_at ? new Date(sipUser.service_expires_at) : null;
      if (!expiresAt || expiresAt < today) {
        return response.status(403).json({ message: "此账号的服务已过期，请联系管理员续订。" });
      }

      request.admin = {
        id: Number(sipUser.id),
        tenantId: Number(sipUser.tenant_id),
        accountType: "sip_user",
        email: sipUser.email || sipUser.username,
        displayName: sipUser.display_name || sipUser.username,
        nickname: sipUser.display_name || "",
        phoneNumber: sipUser.phone_number || "",
        role: "",
        platformRole: "",
        permissions: {},
        username: sipUser.username,
      };
      return next();
    }

    if (!session.admin_id || session.admin_id === 0) {
      return response.status(401).json({ message: "请重新登录。" });
    }

    if (session.status !== 'active') {
      return response.status(401).json({ message: "请重新登录。" });
    }

    request.admin = {
      id: Number(session.admin_id),
      tenantId: session.tenant_id == null ? null : Number(session.tenant_id),
      accountType: session.account_type || "tenant",
      email: session.email,
      displayName: session.display_name || "",
      nickname: session.nickname || "",
      phoneNumber: session.phone_number || "",
      role: session.role || "",
      platformRole: session.platform_role || "",
      permissions: parsePermissions(session.permissions_json),
    };
    return next();
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "身份验证失败。" });
  } finally {
    if (connection) connection.release();
  }
}

// ==========================================
// Notification sync for ALL user types
// ==========================================

// Sync tenant admin notifications (order-related)
async function syncTenantNotifications(connection, admin) {
  if (!admin?.tenantId) return;
  const tenantId = admin.tenantId;
  const adminId = admin.id;

  // no_plan_purchased — only trigger when no valid (review_approved + not expired) orders
  const [orderCountRow] = await connection.query("SELECT COUNT(*) AS total FROM billing_orders WHERE tenant_id = ? AND order_status = 'review_approved' AND expires_at > CURDATE()", [tenantId]);
  const orderCount = Number(orderCountRow?.total || 0);
  const noPlanKey = `tenant:${tenantId}:no_plan_purchased`;
  if (orderCount === 0) {
    await connection.query(
      "INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'tenant', ?, 'no_plan_purchased', 'system', ?, '請購買套餐', '當前帳號尚未訂購任何套餐，請在【我的套餐】中购买套餐。', 'warning', 'active', 'domain') ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [tenantId, tenantId, noPlanKey]
    );
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND dedupe_key=? AND status='active'", [tenantId, noPlanKey]);
  }

  // payment_required
  const unpaidRows = await connection.query("SELECT id, order_no FROM billing_orders WHERE tenant_id=? AND payment_status<>'paid' AND order_status NOT IN ('cancelled','review_rejected') ORDER BY created_at DESC", [tenantId]);
  const unpaidKeys = [];
  for (const o of unpaidRows) {
    const key = `order:${o.id}:payment_required`;
    unpaidKeys.push(key);
    await connection.query("INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'billing_order', ?, 'payment_required', 'system', ?, '訂單待支付', ?, 'warning', 'active', 'domain') ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [tenantId, o.id, key, `订单 ${o.order_no || o.id} 尚未完成支付，请在"我的套餐"中处理。`]
    );
  }
  if (unpaidKeys.length > 0) {
    await connection.query(`UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND event_type='payment_required' AND status='active' AND dedupe_key NOT IN (${unpaidKeys.map(() => "?").join(",")})`, [tenantId, ...unpaidKeys]);
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND event_type='payment_required' AND status='active'", [tenantId]);
  }

  // review_submission_required
  const paidUnsubmitted = await connection.query("SELECT id, order_no FROM billing_orders WHERE tenant_id=? AND payment_status='paid' AND order_status='payment_submitted' ORDER BY created_at DESC", [tenantId]);
  const puKeys = [];
  for (const o of paidUnsubmitted) {
    const key = `order:${o.id}:review_submission_required`;
    puKeys.push(key);
    await connection.query("INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'billing_order', ?, 'review_submission_required', 'system', ?, '訂單待提交審核', ?, 'warning', 'active', 'domain') ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [tenantId, o.id, key, `订单 ${o.order_no || o.id} 已支付，請提交審核。`]
    );
  }
  if (puKeys.length > 0) {
    await connection.query(`UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND event_type='review_submission_required' AND status='active' AND dedupe_key NOT IN (${puKeys.map(() => "?").join(",")})`, [tenantId, ...puKeys]);
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND event_type='review_submission_required' AND status='active'", [tenantId]);
  }

  // Ensure receipts exist for all tenant admin users
  const tenantAdmins = await connection.query("SELECT id FROM admin_users WHERE tenant_id=? AND account_type='tenant' AND status='active'", [tenantId]);
  const activeEvents = await connection.query("SELECT id FROM notification_events WHERE tenant_id=? AND status='active'", [tenantId]);
  for (const ev of activeEvents) {
    for (const ad of tenantAdmins) {
      await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [ev.id, ad.id]);
    }
  }
}

// Sync platform admin notifications
async function syncPlatformNotifications(connection) {
  // pending_review orders (tenant submitted, platform needs to review)
  const pendingReviewRows = await connection.query("SELECT o.id, o.order_no, o.tenant_id, t.name AS tenant_name FROM billing_orders o JOIN tenants t ON t.id = o.tenant_id WHERE o.order_status='pending_review' ORDER BY o.created_at DESC");
  const prKeys = [];
  for (const o of pendingReviewRows) {
    const key = `platform:order:${o.id}:pending_review`;
    prKeys.push(key);
    await connection.query("INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'billing_order', ?, 'order_pending_review', 'tenant_admin', ?, '訂單待審核', ?, 'warning', 'active', NULL) ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [o.tenant_id, o.id, key, `租户 ${o.tenant_name} 的订单 ${o.order_no || o.id} 已提交审核。`]
    );
  }
  if (prKeys.length > 0) {
    await connection.query(`UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE event_type='order_pending_review' AND status='active' AND dedupe_key NOT IN (${prKeys.map(() => "?").join(",")})`, [...prKeys]);
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE event_type='order_pending_review' AND status='active'");
  }

  // Payment proof uploaded (needs platform verification)
  const proofUploadedRows = await connection.query("SELECT o.id, o.order_no, o.tenant_id, t.name AS tenant_name FROM billing_orders o JOIN tenants t ON t.id = o.tenant_id WHERE o.payment_status='paid' AND o.order_status='payment_submitted' AND o.payment_method='offline' ORDER BY o.created_at DESC");
  const ppKeys = [];
  for (const o of proofUploadedRows) {
    const key = `platform:order:${o.id}:proof_uploaded`;
    ppKeys.push(key);
    await connection.query("INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'billing_order', ?, 'proof_uploaded', 'tenant_admin', ?, '付款憑證已上傳', ?, 'info', 'active', NULL) ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [o.tenant_id, o.id, key, `租户 ${o.tenant_name} 的订单 ${o.order_no || o.id} 已上傳付款憑證，請審核。`]
    );
  }
  if (ppKeys.length > 0) {
    await connection.query(`UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE event_type='proof_uploaded' AND status='active' AND dedupe_key NOT IN (${ppKeys.map(() => "?").join(",")})`, [...ppKeys]);
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE event_type='proof_uploaded' AND status='active'");
  }

  // Ensure receipts for all platform admins
  const platformAdmins = await connection.query("SELECT id FROM admin_users WHERE account_type='platform' AND status='active'");
  const activePlatformEvents = await connection.query("SELECT id FROM notification_events WHERE event_type IN ('order_pending_review','proof_uploaded') AND status='active'");
  for (const ev of activePlatformEvents) {
    for (const ad of platformAdmins) {
      await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [ev.id, ad.id]);
    }
  }
}

// Unified sync function
async function syncNotificationEvents(connection, admin) {
  if (!admin) return;
  if (admin.accountType === 'tenant') {
    await syncTenantNotifications(connection, admin);
  }
  if (admin.accountType === 'platform') {
    await syncPlatformNotifications(connection);
  }
}


function validateRegistration(payload) {
  const companyName = String(payload.companyName || "").trim();
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const confirmPassword = String(payload.confirmPassword || "");

  if (!companyName) return { error: "璜嬭几鍏ュ叕鍙稿悕绋?" };
  if (!email || !email.includes("@")) return { error: "璜嬭几鍏ユ湁鏁堢殑闆诲瓙閮典欢" };
  if (password.length < 8) return { error: "瀵嗙⒓鑷冲皯闇€瑕?8 浣嶅瓧鍏?" };
  if (password !== confirmPassword) return { error: "鍏╂杓稿叆鐨勫瘑纰间笉涓€鑷?" };

  return { companyName, email, password };
}

app.post("/api/auth/register", async (request, response) => {
  const validated = validateRegistration(request.body);
  if (validated.error) {
    return response.status(400).json({ message: validated.error });
  }

  const { companyName, email, password } = validated;
  let connection;

  try {
    connection = await pool.getConnection();

    const existingUsers = await connection.query(
      `SELECT id FROM admin_users WHERE email = ? LIMIT 1`,
      [email],
    );
    if (existingUsers.length > 0) {
      return response.status(409).json({ message: "姝ら浕瀛愰兊浠跺凡琚ɑ鍐婏紝璜嬩娇鐢ㄧ郴绲卞収鏈ɑ鍐婄殑闆诲瓙閮典欢鎴栫洿鎺ョ櫥鍏ャ€?" });
    }

    await connection.beginTransaction();

    const tenantResult = await connection.query(
      `INSERT INTO tenants (name, sip_domain, contact_email, enterprise_email, plan_code, user_limit)
       VALUES (?, ?, ?, ?, 'starter', 100)`,
      [companyName, sipDomain, email, email],
    );
    const tenantId = Number(tenantResult.insertId);
    await connection.query(
      `UPDATE tenants
       SET tenant_number = ?
       WHERE id = ?`,
      [`TENANT-${String(tenantId).padStart(6, "0")}`, tenantId],
    );

    const passwordHash = await hashPassword(password);
    const adminResult = await connection.query(
      `INSERT INTO admin_users (tenant_id, email, password_hash, display_name, role, status)
       VALUES (?, ?, ?, ?, 'owner', 'disabled')`,
      [tenantId, email, passwordHash, companyName],
    );

    const { token, tokenHash } = createEmailToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await connection.query(
      `INSERT INTO email_verification_tokens (admin_user_id, token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [Number(adminResult.insertId), tokenHash, expiresAt],
    );

    const verificationUrl = `${appUrl}/?verifyEmailToken=${encodeURIComponent(token)}`;
    await queueVerificationEmail(connection, { email, verificationUrl });

    await connection.commit();

    return response.status(201).json({
      message: "瑷诲唺鎴愬姛锛岃珛鍓嶅線闆诲瓙閮典欢瀹屾垚椹楄瓑",
      devVerificationUrl: verificationUrl,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "瑷诲唺澶辨晽锛岃珛绋嶅緦鍐嶈│" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/login", async (request, response) => {
  const username = (request.body.username || request.body.email || "").trim();
  const password = String(request.body.password || "");

  if (!username || !password) {
    return response.status(400).json({ message: "请输入有效的登录账号和密码。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    if (isValidEmail(username)) {
      const adminRows = await connection.query(
        `SELECT id, tenant_id, account_type, email, password_hash, role, platform_role, permissions_json, status
         FROM admin_users
         WHERE email = ?
         LIMIT 1`,
        [normalizeEmail(username)],
      );
      const admin = adminRows[0];

      if (admin && (await verifyPassword(password, admin.password_hash))) {
        if (admin.status !== 'active') {
          return response.status(403).json({ message: "此管理员账号尚未启用。" });
        }

        const { token, tokenHash } = createSessionToken();
        const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

        await connection.query(
          `INSERT INTO admin_sessions (admin_user_id, user_type, token_hash, expires_at)
           VALUES (?, 'admin', ?, ?)`,
          [Number(admin.id), tokenHash, expiresAt],
        );
        await connection.query(`UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, [Number(admin.id)]);

        return response.json({
          token,
          userType: "admin",
          admin: {
            id: Number(admin.id),
            tenantId: admin.tenant_id == null ? null : Number(admin.tenant_id),
            accountType: admin.account_type || "tenant",
            role: admin.role || "",
            platformRole: admin.platform_role || "",
            permissions: parsePermissions(admin.permissions_json),
            email: admin.email,
          },
        });
      }
    }

    const sipRows = await connection.query(
      `SELECT u.id, u.username, u.tenant_id, u.password_hash, u.display_name, u.email, u.phone_number,
              u.status, e.status AS entitlement_status, e.service_expires_at, t.name AS tenant_name
       FROM sip_users u
       INNER JOIN tenant_sip_account_entitlements e
         ON e.sip_user_id = u.id AND e.tenant_id = u.tenant_id AND e.status = 'active'
       INNER JOIN tenants t ON t.id = u.tenant_id AND t.status = 'active'
       WHERE u.username = ?
       LIMIT 1`,
      [username],
    );
    const sipUser = sipRows[0];

    if (!sipUser) {
      return response.status(401).json({ message: "登录账号或密码不正确。" });
    }

    if (!(await verifyPassword(password, sipUser.password_hash))) {
      return response.status(401).json({ message: "登录账号或密码不正确。" });
    }

    if (sipUser.status !== 'active') {
      return response.status(403).json({ message: "此 SIP 账号尚未启用或已被停用。" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const serviceExpires = sipUser.service_expires_at ? new Date(sipUser.service_expires_at) : null;
    if (!serviceExpires || serviceExpires < today) {
      return response.status(403).json({ message: "此账号的服务已过期，请联系管理员续订。" });
    }

    const { token, tokenHash } = createSessionToken();
    const sessionExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

    await connection.query(
      `INSERT INTO admin_sessions (admin_user_id, user_type, sip_user_id, token_hash, expires_at)
       VALUES (0, 'sip', ?, ?, ?)`,
      [Number(sipUser.id), tokenHash, sessionExpiresAt],
    );

    return response.json({
      token,
      userType: "sip",
      admin: {
        id: Number(sipUser.id),
        tenantId: Number(sipUser.tenant_id),
        accountType: "sip_user",
        role: "",
        platformRole: "",
        permissions: {},
        email: sipUser.email || sipUser.username,
        displayName: sipUser.display_name || sipUser.username,
        username: sipUser.username,
        phoneNumber: sipUser.phone_number || "",
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "登录失败，请稍后再试。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/forgot-password", async (request, response) => {
  const email = normalizeEmail(request.body.email);
  if (!isValidEmail(email)) {
    return response.status(400).json({ message: "璜嬭几鍏ユ湁鏁堢殑闆诲瓙閮典欢鍦板潃銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id FROM admin_users WHERE email = ? LIMIT 1`,
      [email],
    );

    const admin = rows[0];
    if (!admin) {
      return response.status(404).json({ message: "瑭查兊绠变笉瀛樺湪锛岃珛纰鸿獚寰岄噸鏂拌几鍏ャ€?" });
    }

    const { token, tokenHash } = createEmailToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await connection.query(
      `INSERT INTO password_reset_tokens (admin_user_id, token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [Number(admin.id), tokenHash, expiresAt],
    );

    const resetUrl = `${appUrl}/?resetPasswordToken=${encodeURIComponent(token)}`;
    const delivery = await queuePasswordResetEmail(connection, { email, resetUrl });

    if (!delivery.sent) {
      return response.status(500).json({ message: "閲嶇疆閮典欢鐧奸€佸け鏁楋紝璜嬬◢寰屽啀瑭︺€?" });
    }

    return response.json({ message: "宸茬櫦閫佸瘑纰奸噸瑷€ｇ祼锛岃珛妾㈡煡鎮ㄧ殑閮电銆?" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶鐧奸€侀噸缃兊浠讹紝璜嬬◢寰屽啀瑭︺€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/reset-password", async (request, response) => {
  const token = String(request.body.token || "");
  const password = String(request.body.password || "");
  const confirmPassword = String(request.body.confirmPassword || "");
  const passwordError = validatePassword(password);

  if (!token) {
    return response.status(400).json({ message: "閲嶇疆閫ｇ祼鐒℃晥锛岃珛閲嶆柊鐢宠珛銆?" });
  }
  if (passwordError) {
    return response.status(400).json({ message: passwordError });
  }
  if (password !== confirmPassword) {
    return response.status(400).json({ message: "鍏╂杓稿叆鐨勫瘑纰间笉涓€鑷淬€?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT prt.id, prt.admin_user_id, prt.expires_at, prt.used_at, a.status
       FROM password_reset_tokens prt
       JOIN admin_users a ON a.id = prt.admin_user_id
       WHERE prt.token_hash = ?
       LIMIT 1`,
      [hashToken(token)],
    );
    const resetToken = rows[0];

    if (!resetToken || resetToken.used_at) {
      await connection.rollback();
      return response.status(400).json({ message: "閲嶇疆閫ｇ祼鐒℃晥鎴栧凡浣跨敤锛岃珛閲嶆柊鐢宠珛銆?" });
    }
    if (new Date(resetToken.expires_at).getTime() < Date.now()) {
      await connection.rollback();
      return response.status(400).json({ message: "閲嶇疆閫ｇ祼宸查亷鏈燂紝璜嬮噸鏂扮敵璜嬨€?" });
    }
    if (resetToken.status !== 'active') {
      await connection.rollback();
      return response.status(403).json({ message: "姝ょ鐞嗗摗甯宠櫉灏氭湭鍟熺敤銆?" });
    }

    const passwordHash = await hashPassword(password);
    await connection.query(
      `UPDATE admin_users
       SET password_hash = ?
       WHERE id = ?`,
      [passwordHash, Number(resetToken.admin_user_id)],
    );
    await connection.query(
      `UPDATE password_reset_tokens
       SET used_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [Number(resetToken.id)],
    );
    await connection.query(`DELETE FROM admin_sessions WHERE admin_user_id = ?`, [Number(resetToken.admin_user_id)]);

    await connection.commit();
    return response.json({ message: "瀵嗙⒓宸查噸缃紝璜嬩娇鐢ㄦ柊瀵嗙⒓鐧诲叆銆?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶閲嶇疆瀵嗙⒓锛岃珛绋嶅緦鍐嶈│銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/logout", requireAdmin, async (request, response) => {
  const token = getBearerToken(request);
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.query(`DELETE FROM admin_sessions WHERE token_hash = ?`, [hashToken(token)]);
    return response.json({ message: "宸查€€鍑虹郴绲便€?" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "閫€鍑虹郴绲卞け鏁楋紝璜嬬◢寰屽啀瑭︺€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/auth/verify-email", async (request, response) => {
  const token = String(request.query.token || "");
  if (!token) {
    return response.status(400).json({ message: "椹楄瓑閫ｇ祼鐒℃晥" });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const tokenHash = hashToken(token);
    const tokens = await connection.query(
      `SELECT id, admin_user_id, expires_at, used_at
       FROM email_verification_tokens
       WHERE token_hash = ?
       LIMIT 1`,
      [tokenHash],
    );

    const verification = tokens[0];
    if (!verification || verification.used_at) {
      await connection.rollback();
      return response.status(400).json({ message: "椹楄瓑閫ｇ祼鐒℃晥鎴栧凡浣跨敤" });
    }

    if (new Date(verification.expires_at).getTime() < Date.now()) {
      await connection.rollback();
      return response.status(400).json({ message: "椹楄瓑閫ｇ祼宸查亷鏈?" });
    }

    await connection.query(
      `UPDATE admin_users
       SET status = 'active', email_verified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [verification.admin_user_id],
    );

    await connection.query(
      `UPDATE email_verification_tokens
       SET used_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [verification.id],
    );

    await connection.commit();
    return response.json({ message: "闆诲瓙閮典欢椹楄瓑鎴愬姛锛岃珛鐧诲叆" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "椹楄瓑澶辨晽锛岃珛绋嶅緦鍐嶈│" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/me", requireAdmin, async (request, response) => {
  if (request.admin.accountType === "sip_user") {
    let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query(
        `SELECT t.id, t.name, t.sip_domain
         FROM tenants t
         WHERE t.id = ? AND t.status = 'active'
         LIMIT 1`,
        [request.admin.tenantId],
      );
      const row = rows[0];
      return response.json({
        userType: "sip",
        tenant: row ? {
          id: Number(row.id),
          companyName: row.name || "",
          sipDomain: row.sip_domain || "",
        } : null,
        admin: {
          id: request.admin.id,
          accountType: "sip_user",
          loginEmail: "",
          displayName: request.admin.displayName || "",
          nickname: "",
          phoneNumber: request.admin.phoneNumber || "",
          role: "",
          platformRole: "",
          permissions: {},
          username: request.admin.username || "",
          email: request.admin.email || "",
        },
      });
    } catch (error) {
      console.error(error);
      return response.status(500).json({ message: "无法读取账号信息。" });
    } finally {
      if (connection) connection.release();
    }
  }

  if (request.admin.accountType === 'platform') {
    return response.json({
      userType: "admin",
      tenant: null,
      admin: {
        id: request.admin.id,
        accountType: 'platform',
        loginEmail: request.admin.email,
        displayName: request.admin.displayName || request.admin.email,
        nickname: request.admin.nickname || "",
        phoneNumber: request.admin.phoneNumber || "",
        role: request.admin.role || "",
        platformRole: request.admin.platformRole || "",
        permissions: request.admin.permissions || {},
      },
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         t.id, t.tenant_number, t.name, t.contact_email, t.enterprise_email, t.contact_person,
         t.contact_phone, t.billing_address, t.postal_code, t.sip_domain, t.user_limit,
         a.email AS login_email, a.display_name AS admin_display_name, a.nickname AS admin_nickname, a.phone_number AS admin_phone
       FROM tenants t
       JOIN admin_users a ON a.tenant_id = t.id
       WHERE t.id = ? AND a.id = ?
       LIMIT 1`,
      [request.admin.tenantId, request.admin.id],
    );
    const row = rows[0];
    if (!row) return response.status(404).json({ message: "找不到租户资料。" });

    return response.json({
      userType: "admin",
      tenant: {
        id: Number(row.id),
        tenantNumber: row.tenant_number || `TENANT-${String(row.id).padStart(6, "0")}`,
        companyName: row.name || "",
        enterpriseEmail: row.enterprise_email || row.contact_email || "",
        contactPerson: row.contact_person || "",
        contactPhone: row.contact_phone || "",
        billingAddress: row.billing_address || "",
        postalCode: row.postal_code || "",
        sipDomain: row.sip_domain || "",
        userLimit: Number(row.user_limit || 0),
      },
      admin: {
        id: request.admin.id,
        accountType: request.admin.accountType || "tenant",
        loginEmail: row.login_email || "",
        displayName: row.admin_display_name || row.login_email || "",
        nickname: row.admin_nickname || "",
        phoneNumber: row.admin_phone || "",
        role: request.admin.role || "",
        platformRole: request.admin.platformRole || "",
        permissions: request.admin.permissions || {},
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "无法读取租户设定。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/notifications", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await syncNotificationEvents(connection, request.admin);

    const isSipUser = request.admin.accountType === 'sip_user';
    const userId = request.admin.id;
    const userField = isSipUser ? 'r.sip_user_id' : 'r.admin_user_id';

    const rows = await connection.query(
      `SELECT
         e.id, e.event_type, e.scope_type, e.scope_id, e.title, e.body,
         e.severity, e.status, e.target_view, e.created_at, e.updated_at,
         r.read_at, r.dismissed_at, r.deleted_at
       FROM notification_events e
       JOIN notification_receipts r ON r.event_id = e.id
       WHERE ${userField} = ?
         AND e.status = 'active'
         AND r.deleted_at IS NULL
         AND r.dismissed_at IS NULL
       ORDER BY
         CASE e.severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
         e.updated_at DESC,
         e.id DESC`,
      [userId],
    );

    const notifications = rows.map((row) => ({
      id: Number(row.id),
      eventType: row.event_type || "",
      scopeType: row.scope_type || "",
      scopeId: row.scope_id == null ? null : Number(row.scope_id),
      title: row.title || "",
      description: row.body || "",
      severity: row.severity || "info",
      status: row.status || 'active',
      targetView: row.target_view || "",
      isRead: Boolean(row.read_at),
      readAt: row.read_at ? String(row.read_at) : "",
      createdAt: row.created_at ? String(row.created_at) : "",
      updatedAt: row.updated_at ? String(row.updated_at) : "",
    }));

    return response.json({
      notifications,
      activeCount: notifications.length,
      unreadCount: notifications.filter((item) => !item.isRead).length,
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "读取消息失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/notifications/:id/read", requireAdmin, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return response.status(400).json({ message: "消息编号无效。" });

  const isSip = request.admin.accountType === "sip_user";
  const userField = isSip ? "r.sip_user_id" : "r.admin_user_id";

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE notification_receipts r
       JOIN notification_events e ON e.id = r.event_id
       SET r.read_at = COALESCE(r.read_at, CURRENT_TIMESTAMP)
       WHERE ${userField} = ? AND r.event_id = ? AND e.status = 'active' AND r.deleted_at IS NULL`,
      [request.admin.id, eventId],
    );
    if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "找不到消息。" });
    return response.json({ message: "消息已标记为已读。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "标记消息失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/notifications/:id/dismiss", requireAdmin, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return response.status(400).json({ message: "消息编号无效。" });

  const isSip = request.admin.accountType === "sip_user";
  const userField = isSip ? "r.sip_user_id" : "r.admin_user_id";

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE notification_receipts r
       JOIN notification_events e ON e.id = r.event_id
       SET r.read_at = COALESCE(r.read_at, CURRENT_TIMESTAMP),
           r.dismissed_at = COALESCE(r.dismissed_at, CURRENT_TIMESTAMP)
       WHERE ${userField} = ? AND r.event_id = ? AND e.status = 'active' AND r.deleted_at IS NULL`,
      [request.admin.id, eventId],
    );
    if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "找不到消息。" });
    return response.json({ message: "消息已忽略。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "忽略消息失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/notifications/:id", requireAdmin, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return response.status(400).json({ message: "消息编号无效。" });

  const isSip = request.admin.accountType === "sip_user";
  const userField = isSip ? "r.sip_user_id" : "r.admin_user_id";

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE notification_receipts r
       JOIN notification_events e ON e.id = r.event_id
       SET r.read_at = COALESCE(r.read_at, CURRENT_TIMESTAMP),
           r.deleted_at = COALESCE(r.deleted_at, CURRENT_TIMESTAMP)
       WHERE r.admin_user_id = ?
         AND r.event_id = ?
         AND r.deleted_at IS NULL`,
      [request.admin.id, eventId],
    );
    if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "找不到消息。" });
    return response.json({ message: "消息已刪除。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "删除消息失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/notifications/read-all - mark all notifications as read
app.post("/api/notifications/read-all", requireAdmin, async (request, response) => {
  const isSip = request.admin.accountType === "sip_user";
  const userField = isSip ? "r.sip_user_id" : "r.admin_user_id";
  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE notification_receipts r
       JOIN notification_events e ON e.id = r.event_id
       SET r.read_at = COALESCE(r.read_at, CURRENT_TIMESTAMP),
           r.dismissed_at = COALESCE(r.dismissed_at, CURRENT_TIMESTAMP)
       WHERE ${userField} = ?
         AND e.status = 'active'
         AND r.deleted_at IS NULL
         AND r.dismissed_at IS NULL`,
      [request.admin.id]
    );
    return response.json({ message: "所有消息已设为已读。", count: Number(result.affectedRows || 0) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "操作失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/tenant/sip-accounts/:id/config-status - 獲取 SIP 帳號配置狀態
// GET /api/tenant/payments - 獲取租戶付款記錄
app.get("/api/tenant/payments", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以查看付款記錄。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT p.id, p.order_id, o.order_no, p.payment_amount, p.payment_method, p.payment_channel,
              p.payment_status, DATE_FORMAT(p.paid_at, '%Y-%m-%d') AS paid_at,
              p.transaction_no, p.payment_proof_file_url
       FROM billing_payments p
       LEFT JOIN billing_orders o ON o.id = p.order_id
       WHERE p.tenant_id = ? AND p.payment_status = 'paid'
       ORDER BY p.paid_at DESC`,
      [request.admin.tenantId]
    );
    const totalAmount = rows.reduce((sum, r) => sum + (Number(r.payment_amount) || 0), 0);
    response.json({
      code: 0,
      data: {
        totalAmount: totalAmount.toFixed(2),
        totalCount: rows.length,
        payments: rows.map(r => ({
          id: Number(r.id),
          orderId: r.order_id ? Number(r.order_id) : null,
          orderNo: r.order_no || '',
          amount: Number(r.payment_amount) || 0,
          paymentMethod: r.payment_method || '',
          paymentChannel: r.payment_channel || '',
          paymentStatus: r.payment_status || '',
          paidAt: r.paid_at || '',
          transactionId: r.transaction_no || '',
          proofFileUrl: r.payment_proof_file_url || '',
        })),
      }
    });
  } catch (error) {
    console.error("獲取付款記錄失敗:", error);
    response.status(500).json({ message: "獲取付款記錄失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/sip-accounts/:id/config-status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以查看。" });
  }
  const accountId = Number(request.params.id);
  if (!accountId) return response.status(400).json({ message: "無效的帳號 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();
    // Find sip_user_id from billing_order_sip_accounts
    const [acct] = await connection.query("SELECT sip_user_id FROM billing_order_sip_accounts WHERE id = ? AND tenant_id = ?", [accountId, request.admin.tenantId]);
    if (!acct) return response.status(404).json({ message: "帳號不存在。" });
    const sipUserId = acct.sip_user_id;

    const [ecard] = await connection.query("SELECT id FROM tenant_ecards WHERE sip_user_id = ? AND tenant_id = ? LIMIT 1", [sipUserId, request.admin.tenantId]);
    const [agent] = await connection.query("SELECT id FROM call_center_category_agents WHERE sip_account_id = ? LIMIT 1", [sipUserId]);
    const [entrance] = await connection.query("SELECT id FROM access_room_entrance_auth WHERE tenant_id = ? AND room_id IN (SELECT id FROM access_rooms WHERE sip_user_id = ? AND tenant_id = ?) LIMIT 1", [request.admin.tenantId, sipUserId, request.admin.tenantId]);
    const [room] = await connection.query("SELECT id FROM access_rooms WHERE sip_user_id = ? AND tenant_id = ? LIMIT 1", [sipUserId, request.admin.tenantId]);

    response.json({
      code: 0,
      data: {
        ecard: !!ecard,
        agent: !!agent,
        entrance: !!entrance,
        room: !!room,
      }
    });
  } catch (error) {
    console.error("獲取配置狀態失敗:", error);
    response.status(500).json({ message: "獲取配置狀態失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/sip-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以查看帳號管理。" });
  }

  const query = sanitizeString(request.query?.q, 120);
  const orderQuery = /^ORD/i.test(query) ? query : "";
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = orderQuery
      ? await connection.query(
        `SELECT
           a.id, a.sip_user_id, a.username, a.sip_domain, a.display_name,
           a.email, a.phone_number, a.role, a.account_status,
           DATE_FORMAT(a.service_starts_at, '%Y-%m-%d') AS service_starts_at,
           DATE_FORMAT(a.service_expires_at, '%Y-%m-%d') AS service_expires_at,
           a.assigned_at,
           o.order_no,
           cba.contact_book_id,
           tcb.name AS contact_book_name,
           wu.username AS web_username
         FROM billing_order_sip_accounts a
         JOIN billing_orders o ON o.id = a.order_id
         LEFT JOIN tenant_tenant_contact_book_assignments cba
           ON cba.sip_user_id = a.sip_user_id
          AND cba.tenant_id = a.tenant_id
          AND cba.status = 'active'
         LEFT JOIN tenant_tenant_contact_books tcb
           ON tcb.id = cba.contact_book_id
          AND cb.tenant_id = a.tenant_id
         LEFT JOIN tenant_web_account_entitlements we ON we.sip_user_id = a.sip_user_id AND we.tenant_id = a.tenant_id AND we.status = 'active'
         LEFT JOIN web_users wu ON wu.id = we.web_user_id
         WHERE a.tenant_id = ?
           AND o.order_no LIKE ?
         ORDER BY a.assigned_at DESC, a.id DESC`,
        [request.admin.tenantId, `%${orderQuery}%`],
      )
      : await connection.query(
        `SELECT
           a.id, a.sip_user_id, a.username, a.sip_domain, a.display_name,
           a.email, a.phone_number, a.role, a.account_status,
           DATE_FORMAT(a.service_starts_at, '%Y-%m-%d') AS service_starts_at,
           DATE_FORMAT(a.service_expires_at, '%Y-%m-%d') AS service_expires_at,
           a.assigned_at,
           o.order_no,
           cba.contact_book_id,
           cb.name AS contact_book_name,
           wu.username AS web_username
         FROM billing_order_sip_accounts a
         JOIN tenant_sip_account_entitlements ent
           ON ent.tenant_id = a.tenant_id
          AND ent.sip_user_id = a.sip_user_id
          AND ent.current_order_id = a.order_id
          AND ent.status = 'active'
         JOIN billing_orders o ON o.id = a.order_id
         LEFT JOIN tenant_contact_book_assignments cba
           ON cba.sip_user_id = a.sip_user_id
          AND cba.tenant_id = a.tenant_id
          AND cba.status = 'active'
         LEFT JOIN tenant_contact_books cb
           ON cb.id = cba.contact_book_id
          AND cb.tenant_id = a.tenant_id
         LEFT JOIN tenant_web_account_entitlements we ON we.sip_user_id = a.sip_user_id AND we.tenant_id = a.tenant_id AND we.status = 'active'
         LEFT JOIN web_users wu ON wu.id = we.web_user_id
         WHERE a.tenant_id = ?
           AND a.service_expires_at >= CURDATE()
         ORDER BY a.assigned_at DESC, a.id DESC`,
        [request.admin.tenantId],
      );

    return response.json({
      accounts: rows.map((row) => ({
        id: Number(row.id),
        sipUserId: Number(row.sip_user_id),
        username: row.username || "",
        domain: row.sip_domain || "",
        displayName: row.display_name || "",
        email: row.email || "",
        phone: row.phone_number || "",
        role: row.role || "user",
        status: row.account_status || 'active',
        serviceStartsAt: row.service_starts_at || "",
        serviceExpiresAt: row.service_expires_at || "",
        assignedAt: row.assigned_at ? String(row.assigned_at) : "",
        orderNo: row.order_no || "",
        webAccount: row.web_username || "",
        contactBookId: row.contact_book_id == null ? null : Number(row.contact_book_id),
        contactBookName: row.contact_book_name || "",
      })),
    });
  } catch (error) {
    console.error("Failed to fetch tenant SIP accounts:", error);
    return response.status(500).json({ message: "無法读取帳號管理列表。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/sip-accounts/:id", requireAdmin, async (request, response, next) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以维护帳號。" });
  }

  const paramId = Number(request.params.id);
  if (!Number.isInteger(paramId) || paramId <= 0) {
    if (request.params.id === "contact-book") return next();
    return response.status(400).json({ message: "帳號编号无效。" });
  }

  const isSelfService = request.admin.accountType === "sip_user";
  const displayName = sanitizeString(request.body?.displayName, 120);
  const email = sanitizeString(request.body?.email, 255);
  const phone = sanitizeString(request.body?.phone, 40);
  const password = String(request.body?.password || "");
  const confirmPassword = String(request.body?.confirmPassword || "");

  if (email && !isValidEmail(email)) {
    return response.status(400).json({ message: "请输入有效的电子邮箱。" });
  }
  if (password || confirmPassword) {
    if (password.length < 6) {
      return response.status(400).json({ message: "密码至少需要 6 个字符。" });
    }
    if (password !== confirmPassword) {
      return response.status(400).json({ message: "两次输入的密码不一致。" });
    }
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let sipUserId;
    let assignedAccountId = paramId;
    if (isSelfService) {
      sipUserId = request.admin.id;
      if (sipUserId !== paramId) {
        await connection.rollback();
        return response.status(403).json({ message: "只能编辑自己的账号。" });
      }
    } else {
      const rows = await connection.query(
        `SELECT id, sip_user_id, service_expires_at
         FROM billing_order_sip_accounts
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [paramId, request.admin.tenantId],
      );
      const assignedAccount = rows[0];
      if (!assignedAccount) {
        await connection.rollback();
        return response.status(404).json({ message: "找不到帳號。" });
      }
      if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
        await connection.rollback();
        return response.status(409).json({ message: "已過期帳號不能编辑。" });
      }
      sipUserId = assignedAccount.sip_user_id;
    }

    let userUpdateSql = `UPDATE sip_users SET display_name = ?, email = ?, phone_number = ?`;
    const userUpdateParams = [displayName || null, email, phone || null];

    if (password) {
      const passwordHash = await hashPassword(password);
      userUpdateSql += `, password_hash = ?`;
      userUpdateParams.push(passwordHash);
    }

    userUpdateSql += ` WHERE id = ? AND tenant_id = ?`;
    userUpdateParams.push(Number(sipUserId), request.admin.tenantId);

    await connection.query(userUpdateSql, userUpdateParams);

    if (!isSelfService) {
      let snapshotUpdateSql = `UPDATE billing_order_sip_accounts SET display_name = ?, email = ?, phone_number = ?`;
      const snapshotUpdateParams = [displayName || null, email, phone || null];
      if (password) {
        snapshotUpdateSql += `, password_hash = ?`;
        snapshotUpdateParams.push(await hashPassword(password));
      }
      snapshotUpdateSql += ` WHERE id = ? AND tenant_id = ?`;
      snapshotUpdateParams.push(assignedAccountId, request.admin.tenantId);
      await connection.query(snapshotUpdateSql, snapshotUpdateParams);
    }

    await connection.commit();

    return response.json({
      message: "帳號已更新。",
      account: {
        id: assignedAccountId,
        displayName,
        email,
        phone,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant SIP account:", error);
    return response.status(500).json({ message: "帳號更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/sip-accounts/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以维护帳號。" });
  }

  const assignedAccountId = Number(request.params.id);
  if (!Number.isInteger(assignedAccountId) || assignedAccountId <= 0) {
    return response.status(400).json({ message: "帳號编号无效。" });
  }

  const status = sanitizeString(request.body?.status, 20);
  if (!['active', 'disabled'].includes(status)) {
    return response.status(400).json({ message: "帳號狀態无效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, sip_user_id, service_expires_at
       FROM billing_order_sip_accounts
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignedAccountId, request.admin.tenantId],
    );
    const assignedAccount = rows[0];
    if (!assignedAccount) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到帳號。" });
    }
    if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
      await connection.rollback();
      return response.status(409).json({ message: "已過期帳號不能启用或停用。" });
    }

    await connection.query(
      `UPDATE sip_users
       SET status = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [status, Number(assignedAccount.sip_user_id), request.admin.tenantId],
    );
    await connection.query(
      `UPDATE billing_order_sip_accounts
       SET account_status = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [status, assignedAccountId, request.admin.tenantId],
    );

    await connection.commit();
    return response.json({ message: status === 'active' ? "帳號已啟用。" : "帳號已停用。", account: { id: assignedAccountId, status } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant SIP account status:", error);
    return response.status(500).json({ message: "帳號狀態更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/sip-accounts/contact-book", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以配置通讯录。" });
  }

  const assignedAccountIds = Array.isArray(request.body?.accountIds)
    ? Array.from(new Set(request.body.accountIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)))
    : [];
  if (assignedAccountIds.length === 0) {
    return response.status(400).json({ message: "請選擇要配置通讯录的帳號。" });
  }

  const rawContactBookId = request.body?.contactBookId;
  const contactBookId = rawContactBookId === "" || rawContactBookId == null ? null : Number(rawContactBookId);
  if (contactBookId != null && (!Number.isInteger(contactBookId) || contactBookId <= 0)) {
    return response.status(400).json({ message: "通讯录编号无效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let contactBookName = "";
    if (contactBookId != null) {
      const [book] = await connection.query(
        `SELECT id, name
         FROM tenant_contact_books
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [contactBookId, request.admin.tenantId],
      );
      if (!book) {
        await connection.rollback();
        return response.status(404).json({ message: "找不到指定的通讯录。" });
      }
      contactBookName = book.name || "";
    }

    const placeholders = assignedAccountIds.map(() => "?").join(",");
    const rows = await connection.query(
      `SELECT id, sip_user_id, account_status, service_expires_at
       FROM billing_order_sip_accounts
       WHERE id IN (${placeholders})
         AND tenant_id = ?
       FOR UPDATE`,
      [...assignedAccountIds, request.admin.tenantId],
    );

    if (rows.length !== assignedAccountIds.length) {
      await connection.rollback();
      return response.status(404).json({ message: "部分帳號不存在，请刷新后重试。" });
    }

    const today = new Date().setHours(0, 0, 0, 0);
    const invalidAccount = rows.find((account) => (
      account.account_status !== 'active'
      || (account.service_expires_at && new Date(account.service_expires_at).getTime() < today)
    ));
    if (invalidAccount) {
      await connection.rollback();
      return response.status(409).json({ message: "只能为启用中且未过期的帳號配置通讯录。" });
    }

    const sipUserIds = rows.map((account) => Number(account.sip_user_id));
    await connection.query(
      `UPDATE tenant_contact_book_assignments
       SET status = 'revoked',
           revoked_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND sip_user_id IN (${sipUserIds.map(() => "?").join(",")})
         AND status = 'active'`,
      [request.admin.tenantId, ...sipUserIds],
    );

    if (contactBookId != null) {
      for (const sipUserId of sipUserIds) {
        await connection.query(
          `INSERT INTO tenant_contact_book_assignments (
             tenant_id, contact_book_id, sip_user_id, assigned_by_admin_id, status, assigned_at, revoked_at
           )
           VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
           ON DUPLICATE KEY UPDATE
             status = 'active',
             assigned_by_admin_id = VALUES(assigned_by_admin_id),
             assigned_at = CURRENT_TIMESTAMP,
             revoked_at = NULL`,
          [request.admin.tenantId, contactBookId, sipUserId, request.admin.id],
        );
      }
    }

    await connection.query(
      `UPDATE sip_users
       SET contact_book_id = ?
       WHERE id IN (${sipUserIds.map(() => "?").join(",")})
         AND tenant_id = ?`,
      [contactBookId, ...sipUserIds, request.admin.tenantId],
    );

    await connection.commit();
    return response.json({
      message: "通讯录配置已保存。",
      accountIds: assignedAccountIds,
      account: { contactBookId, contactBookName },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to batch configure contact book:", error);
    return response.status(500).json({ message: "批量配置通讯录失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/sip-accounts/:id/contact-book", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以配置通讯录。" });
  }

  const assignedAccountId = Number(request.params.id);
  if (!Number.isInteger(assignedAccountId) || assignedAccountId <= 0) {
    return response.status(400).json({ message: "帳號编号无效。" });
  }

  const rawContactBookId = request.body?.contactBookId;
  const contactBookId = rawContactBookId === "" || rawContactBookId == null ? null : Number(rawContactBookId);
  if (contactBookId != null && (!Number.isInteger(contactBookId) || contactBookId <= 0)) {
    return response.status(400).json({ message: "通讯录编号无效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, sip_user_id, account_status, service_expires_at
       FROM billing_order_sip_accounts
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignedAccountId, request.admin.tenantId],
    );
    const assignedAccount = rows[0];
    if (!assignedAccount) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到帳號。" });
    }
    if (assignedAccount.account_status !== 'active') {
      await connection.rollback();
      return response.status(409).json({ message: "只有启用中的帳號可以配置通讯录。" });
    }
    if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
      await connection.rollback();
      return response.status(409).json({ message: "已過期帳號不能配置通讯录。" });
    }

    let contactBookName = "";
    if (contactBookId != null) {
      const [book] = await connection.query(
        `SELECT id, name
         FROM tenant_contact_books
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [contactBookId, request.admin.tenantId],
      );
      if (!book) {
        await connection.rollback();
        return response.status(404).json({ message: "找不到指定的通讯录。" });
      }
      contactBookName = book.name || "";
    }

    await connection.query(
      `UPDATE tenant_contact_book_assignments
       SET status = 'revoked',
           revoked_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND sip_user_id = ?
         AND status = 'active'`,
      [request.admin.tenantId, Number(assignedAccount.sip_user_id)],
    );

    if (contactBookId != null) {
      await connection.query(
        `INSERT INTO tenant_contact_book_assignments (
           tenant_id, contact_book_id, sip_user_id, assigned_by_admin_id, status, assigned_at, revoked_at
         )
         VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
         ON DUPLICATE KEY UPDATE
           status = 'active',
           assigned_by_admin_id = VALUES(assigned_by_admin_id),
           assigned_at = CURRENT_TIMESTAMP,
           revoked_at = NULL`,
        [request.admin.tenantId, contactBookId, Number(assignedAccount.sip_user_id), request.admin.id],
      );
    }

    await connection.query(
      `UPDATE sip_users
       SET contact_book_id = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [contactBookId, Number(assignedAccount.sip_user_id), request.admin.tenantId],
    );

    await connection.commit();
    return response.json({
      message: "通讯录配置已保存。",
      account: {
        id: assignedAccountId,
        contactBookId,
        contactBookName,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to configure contact book:", error);
    return response.status(500).json({ message: "配置通讯录失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/web-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以查看 Web 帳號管理。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         a.id, a.web_user_id, a.username, a.sip_domain, a.display_name,
         a.email, a.phone_number, a.role, a.account_status,
         DATE_FORMAT(a.service_starts_at, '%Y-%m-%d') AS service_starts_at,
         DATE_FORMAT(a.service_expires_at, '%Y-%m-%d') AS service_expires_at,
         a.assigned_at,
         o.order_no
       FROM billing_order_web_accounts a
       JOIN billing_orders o ON o.id = a.order_id
       WHERE a.tenant_id = ?
       ORDER BY a.assigned_at DESC, a.id DESC`,
      [request.admin.tenantId],
    );

    return response.json({
      accounts: rows.map((row) => ({
        id: Number(row.id),
        webUserId: Number(row.web_user_id),
        username: row.username || "",
        domain: row.sip_domain || "",
        displayName: row.display_name || "",
        email: row.email || "",
        phone: row.phone_number || "",
        role: row.role || "user",
        status: row.account_status || 'active',
        serviceStartsAt: row.service_starts_at || "",
        serviceExpiresAt: row.service_expires_at || "",
        assignedAt: row.assigned_at ? String(row.assigned_at) : "",
        orderNo: row.order_no || "",
      })),
    });
  } catch (error) {
    console.error("Failed to fetch tenant Web accounts:", error);
    return response.status(500).json({ message: "無法读取 Web 帳號管理列表。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/web-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以维护 Web 帳號。" });
  }

  const assignedAccountId = Number(request.params.id);
  if (!Number.isInteger(assignedAccountId) || assignedAccountId <= 0) {
    return response.status(400).json({ message: "帳號编号无效。" });
  }

  const displayName = sanitizeString(request.body?.displayName, 120);
  const email = sanitizeString(request.body?.email, 255);
  const phone = sanitizeString(request.body?.phone, 40);
  const password = String(request.body?.password || "");
  const confirmPassword = String(request.body?.confirmPassword || "");

  if (email && !isValidEmail(email)) {
    return response.status(400).json({ message: "請輸入有效的电子郵箱。" });
  }
  if (password || confirmPassword) {
    if (password.length < 6) {
      return response.status(400).json({ message: "密碼至少需要 6 个字符。" });
    }
    if (password !== confirmPassword) {
      return response.status(400).json({ message: "两次输入的密碼不一致。" });
    }
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, web_user_id, service_expires_at
       FROM billing_order_web_accounts
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignedAccountId, request.admin.tenantId],
    );
    const assignedAccount = rows[0];
    if (!assignedAccount) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到 Web 帳號。" });
    }
    if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
      await connection.rollback();
      return response.status(409).json({ message: "已過期帳號不能编辑。" });
    }

    let userUpdateSql = `UPDATE web_users SET display_name = ?, email = ?, phone_number = ?`;
    const userUpdateParams = [displayName || null, email, phone || null];
    let snapshotUpdateSql = `UPDATE billing_order_web_accounts SET display_name = ?, email = ?, phone_number = ?`;
    const snapshotUpdateParams = [displayName || null, email, phone || null];

    if (password) {
      const passwordHash = await hashPassword(password);
      userUpdateSql += `, password_hash = ?`;
      userUpdateParams.push(passwordHash);
      snapshotUpdateSql += `, password_hash = ?`;
      snapshotUpdateParams.push(passwordHash);
    }

    userUpdateSql += ` WHERE id = ? AND tenant_id = ?`;
    userUpdateParams.push(Number(assignedAccount.web_user_id), request.admin.tenantId);
    snapshotUpdateSql += ` WHERE id = ? AND tenant_id = ?`;
    snapshotUpdateParams.push(assignedAccountId, request.admin.tenantId);

    await connection.query(userUpdateSql, userUpdateParams);
    await connection.query(snapshotUpdateSql, snapshotUpdateParams);
    await connection.commit();

    return response.json({
      message: "Web 帳號已更新。",
      account: {
        id: assignedAccountId,
        displayName,
        email,
        phone,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant Web account:", error);
    return response.status(500).json({ message: "Web 帳號更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/web-accounts/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以维护 Web 帳號。" });
  }

  const assignedAccountId = Number(request.params.id);
  if (!Number.isInteger(assignedAccountId) || assignedAccountId <= 0) {
    return response.status(400).json({ message: "帳號编号无效。" });
  }

  const status = sanitizeString(request.body?.status, 20);
  if (!['active', 'disabled'].includes(status)) {
    return response.status(400).json({ message: "帳號狀態无效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, web_user_id, service_expires_at
       FROM billing_order_web_accounts
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignedAccountId, request.admin.tenantId],
    );
    const assignedAccount = rows[0];
    if (!assignedAccount) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到 Web 帳號。" });
    }
    if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
      await connection.rollback();
      return response.status(409).json({ message: "已過期帳號不能启用或停用。" });
    }

    await connection.query(
      `UPDATE web_users
       SET status = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [status, Number(assignedAccount.web_user_id), request.admin.tenantId],
    );
    await connection.query(
      `UPDATE billing_order_web_accounts
       SET account_status = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [status, assignedAccountId, request.admin.tenantId],
    );

    await connection.commit();
    return response.json({ message: status === 'active' ? "Web 帳號已啟用。" : "Web 帳號已停用。", account: { id: assignedAccountId, status } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant Web account status:", error);
    return response.status(500).json({ message: "Web 帳號狀態更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/contact-books", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以查看通讯录。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT 
         cb.id,
         cb.name,
         cb.description,
         cb.created_at AS createdAt,
         a.nickname AS creatorName,
         a.display_name AS adminName,
         a.email AS creatorEmail,
         (SELECT COUNT(*) FROM tenant_contact_book_entries WHERE contact_book_id = cb.id) AS entryCount
       FROM tenant_contact_books cb
       LEFT JOIN admin_users a ON cb.created_by_admin_id = a.id
       WHERE cb.tenant_id = ?
       ORDER BY cb.created_at DESC`,
      [request.admin.tenantId]
    );

    const formattedRows = rows.map((row) => ({
      ...row,
      id: row.id ? row.id.toString() : null,
      creatorName: row.creatorName || row.creatorEmail || row.adminName || "",
      createdBy: row.creatorName || row.creatorEmail || row.adminName || "",
      entryCount: Number(row.entryCount) || 0
    }));

    return response.json({ contactBooks: formattedRows });
  } catch (error) {
    console.error("Failed to fetch contact books:", error);
    return response.status(500).json({ message: "获取通讯录列表失败" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/contact-books", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以创建通讯录。" });
  }

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 120);
  const description = sanitizeString(payload.description, 1000);
  const accountIds = Array.isArray(payload.accountIds) ? payload.accountIds.map(Number).filter(id => id > 0) : [];
  const assignedAccountIds = Array.isArray(payload.assignedAccountIds)
    ? Array.from(new Set(payload.assignedAccountIds.map(Number).filter(id => Number.isInteger(id) && id > 0)))
    : [];

  if (!name) return response.status(400).json({ message: "請輸入通讯录名稱。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const result = await connection.query(
      `INSERT INTO tenant_contact_books (tenant_id, name, description, created_by_admin_id)
       VALUES (?, ?, ?, ?)`,
      [request.admin.tenantId, name, description || null, request.admin.id]
    );

    const contactBookId = Number(result.insertId);

    if (accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(',');
      const validAccounts = await connection.query(
        `SELECT id FROM sip_users WHERE id IN (${placeholders}) AND tenant_id = ? AND status IN ('active', 'pending')`,
        [...accountIds, request.admin.tenantId]
      );
      
      const validAccountIds = validAccounts.map(a => Number(a.id));
      
      for (const id of validAccountIds) {
        await connection.query(
          `INSERT INTO tenant_contact_book_entries (contact_book_id, sip_user_id) VALUES (?, ?)`,
          [contactBookId, id]
        );
      }
    }

    if (assignedAccountIds.length > 0) {
      const placeholders = assignedAccountIds.map(() => '?').join(',');
      const validAssignedAccounts = await connection.query(
        `SELECT id FROM sip_users WHERE id IN (${placeholders}) AND tenant_id = ? AND status = 'active'`,
        [...assignedAccountIds, request.admin.tenantId]
      );

      for (const account of validAssignedAccounts) {
        await connection.query(
          `INSERT INTO tenant_contact_book_assignments (
             tenant_id, contact_book_id, sip_user_id, assigned_by_admin_id, status, assigned_at, revoked_at
           )
           VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
           ON DUPLICATE KEY UPDATE
             status = 'active',
             assigned_by_admin_id = VALUES(assigned_by_admin_id),
             assigned_at = CURRENT_TIMESTAMP,
             revoked_at = NULL`,
          [request.admin.tenantId, contactBookId, Number(account.id), request.admin.id]
        );
      }
    }

    await connection.commit();
    return response.status(201).json({ message: "通讯录创建成功", id: contactBookId });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to create contact book:", error);
    return response.status(500).json({ message: "创建通讯录失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/contact-books/available-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以查看通讯录可选帳號。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         id,
         username,
         sip_domain AS domain,
         display_name AS displayName,
         email,
         phone_number AS phone,
         status
       FROM sip_users
       WHERE tenant_id = ?
         AND status IN ('active', 'pending')
       ORDER BY username ASC`,
      [request.admin.tenantId]
    );

    return response.json({
      accounts: rows.map((row) => ({
        sipUserId: Number(row.id),
        username: row.username || "",
        domain: row.domain || "",
        displayName: row.displayName || "",
        email: row.email || "",
        phone: row.phone || "",
        status: row.status || "",
      })),
    });
  } catch (error) {
    console.error("Failed to fetch contact book available accounts:", error);
    return response.status(500).json({ message: "读取通讯录可选帳號失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/contact-books/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以查看通讯录详情。" });
  }

  const contactBookId = Number(request.params.id);
  if (!Number.isInteger(contactBookId) || contactBookId <= 0) {
    return response.status(400).json({ message: "無效的通讯录ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [book] = await connection.query(
      `SELECT id, name, description, created_at
       FROM tenant_contact_books
       WHERE id = ? AND tenant_id = ?`,
      [contactBookId, request.admin.tenantId]
    );

    if (!book) {
      return response.status(404).json({ message: "找不到指定的通讯录。" });
    }

    const entries = await connection.query(
      `SELECT
         su.id,
         su.username,
         su.sip_domain AS domain,
         su.display_name AS displayName,
         su.email,
         su.phone_number AS phone,
         su.status
       FROM tenant_contact_book_entries entry
       JOIN sip_users su
         ON su.id = entry.sip_user_id
        AND su.tenant_id = ?
       WHERE entry.contact_book_id = ?
       ORDER BY su.username ASC`,
      [request.admin.tenantId, contactBookId]
    );

    const assignments = await connection.query(
      `SELECT
         su.id,
         su.username,
         su.sip_domain AS domain,
         su.display_name AS displayName,
         su.email,
         su.phone_number AS phone,
         su.status,
         assign.assigned_at AS assignedAt
       FROM tenant_contact_book_assignments assign
       JOIN sip_users su
         ON su.id = assign.sip_user_id
        AND su.tenant_id = assign.tenant_id
        AND su.status = 'active'
       WHERE assign.contact_book_id = ?
         AND assign.tenant_id = ?
         AND assign.status = 'active'
       ORDER BY assign.assigned_at DESC, su.username ASC`,
      [contactBookId, request.admin.tenantId]
    );

    const formatAccount = (account) => ({
      sipUserId: Number(account.id),
      username: account.username || "",
      domain: account.domain || "",
      displayName: account.displayName || "",
      email: account.email || "",
      phone: account.phone || "",
      status: account.status || "",
      assignedAt: account.assignedAt || null
    });

    return response.json({
      contactBook: {
        id: book.id.toString(),
        name: book.name,
        description: book.description,
        accountIds: entries.map(e => Number(e.id)),
        assignedAccountIds: assignments.map(e => Number(e.id)),
        includedAccounts: entries.map(formatAccount),
        assignedAccounts: assignments.map(formatAccount)
      }
    });
  } catch (error) {
    console.error("Failed to fetch contact book details:", error);
    return response.status(500).json({ message: "获取通讯录详情失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/contact-books/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以编辑通讯录。" });
  }

  const contactBookId = Number(request.params.id);
  if (!Number.isInteger(contactBookId) || contactBookId <= 0) {
    return response.status(400).json({ message: "無效的通讯录ID。" });
  }

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 120);
  const description = sanitizeString(payload.description, 1000);
  const accountIds = Array.isArray(payload.accountIds)
    ? Array.from(new Set(payload.accountIds.map(Number).filter(id => Number.isInteger(id) && id > 0)))
    : [];
  const assignedAccountIds = Array.isArray(payload.assignedAccountIds)
    ? Array.from(new Set(payload.assignedAccountIds.map(Number).filter(id => Number.isInteger(id) && id > 0)))
    : [];

  if (!name) return response.status(400).json({ message: "請輸入通讯录名稱。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [book] = await connection.query(
      `SELECT id FROM tenant_contact_books WHERE id = ? AND tenant_id = ? FOR UPDATE`,
      [contactBookId, request.admin.tenantId]
    );
    if (!book) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到指定的通讯录。" });
    }

    await connection.query(
      `UPDATE tenant_contact_books
       SET name = ?, description = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, description || null, contactBookId, request.admin.tenantId]
    );

    const loadValidAccountIds = async (ids, statuses) => {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      const statusPlaceholders = statuses.map(() => "?").join(",");
      const rows = await connection.query(
        `SELECT id
         FROM sip_users
         WHERE id IN (${placeholders})
           AND tenant_id = ?
           AND status IN (${statusPlaceholders})`,
        [...ids, request.admin.tenantId, ...statuses]
      );
      return rows.map(row => Number(row.id));
    };

    const validEntryIds = await loadValidAccountIds(accountIds, ['active', "pending"]);
    const validAssignedIds = await loadValidAccountIds(assignedAccountIds, ['active']);

    await connection.query(`DELETE FROM tenant_contact_book_entries WHERE contact_book_id = ?`, [contactBookId]);
    for (const sipUserId of validEntryIds) {
      await connection.query(
        `INSERT INTO tenant_contact_book_entries (contact_book_id, sip_user_id)
         VALUES (?, ?)`,
        [contactBookId, sipUserId]
      );
    }

    await connection.query(
      `UPDATE tenant_contact_book_assignments
       SET status = 'revoked',
           revoked_at = CURRENT_TIMESTAMP
       WHERE contact_book_id = ?
         AND tenant_id = ?
         AND status = 'active'`,
      [contactBookId, request.admin.tenantId]
    );
    for (const sipUserId of validAssignedIds) {
      await connection.query(
        `INSERT INTO tenant_contact_book_assignments (
           tenant_id, contact_book_id, sip_user_id, assigned_by_admin_id, status, assigned_at, revoked_at
         )
         VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
         ON DUPLICATE KEY UPDATE
           status = 'active',
           assigned_by_admin_id = VALUES(assigned_by_admin_id),
           assigned_at = CURRENT_TIMESTAMP,
           revoked_at = NULL`,
        [request.admin.tenantId, contactBookId, sipUserId, request.admin.id]
      );
    }

    await connection.commit();
    return response.json({ message: "通讯录已保存。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update contact book:", error);
    return response.status(500).json({ message: "保存通讯录失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/contact-books/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以删除通讯录。" });
  }

  const contactBookId = Number(request.params.id);
  if (!Number.isInteger(contactBookId) || contactBookId <= 0) {
    return response.status(400).json({ message: "無效的通讯录ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [book] = await connection.query(
      `SELECT id FROM tenant_contact_books WHERE id = ? AND tenant_id = ?`,
      [contactBookId, request.admin.tenantId]
    );

    if (!book) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到指定的通讯录。" });
    }

    await connection.query(`DELETE FROM tenant_contact_book_entries WHERE contact_book_id = ?`, [contactBookId]);
    await connection.query(`DELETE FROM tenant_contact_books WHERE id = ?`, [contactBookId]);

    await connection.commit();
    return response.json({ message: "通讯录已成功删除。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete contact book:", error);
    return response.status(500).json({ message: "删除通讯录失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/tenants - 鐛插彇棣栭爜绉熸埗鍒楄〃鑸囩当瑷堣硣鏂?
app.get("/api/admin/tenants", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();

    // 鑱〃鏌ヨ锛氬彇寰楃鎴跺熀鏈硣瑷娿€佽▊璩兼暩閲?(user_limit) 鑸囩疮瑷堟敮浠?(totalPaid)
    const query = `
      SELECT 
        t.id,
        t.tenant_number AS tenantNumber,
        t.name AS companyName,
        t.created_at AS createdAt,
        t.user_limit AS userLimit,
        t.status,
        COALESCE(p.totalPaid, 0) AS totalPaid
      FROM tenants t
      LEFT JOIN (
        SELECT tenant_id, SUM(payment_amount) AS totalPaid
        FROM billing_payments
        WHERE payment_status = 'paid'
        GROUP BY tenant_id
      ) p ON t.id = p.tenant_id
      ORDER BY t.created_at DESC;
    `;

    const rows = await connection.query(query);

    // 鏍煎紡鍖栬硣鏂欏瀷鎱嬶紝纰轰繚 JSON 鍥炴噳鑸囧墠绔浉瀹?
    const formattedRows = rows.map((row) => ({
      ...row,
      id: row.id ? row.id.toString() : null, // 閬垮厤 BigInt 杞夋彌 JSON 鏅傜櫦鐢熷牨閷?
      totalPaid: Number(row.totalPaid) || 0,
    }));

    return response.json({ tenants: formattedRows });
  } catch (error) {
    console.error("Failed to fetch tenants:", error);
    return response.status(500).json({ message: "鐛插彇绉熸埗鍒楄〃澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/tenants/with-active-sip - 獲取有有效 SIP 帳號的租戶列表 (must be before /:id)
app.get("/api/admin/tenants/with-active-sip", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以查看。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT DISTINCT t.id, t.name,
              (SELECT MAX(su.service_expires_at) FROM sip_users su WHERE su.tenant_id = t.id AND su.status = 'active' AND (su.service_expires_at IS NULL OR su.service_expires_at > NOW())) AS latest_sip_expiry
       FROM tenants t
       INNER JOIN sip_users su2 ON su2.tenant_id = t.id AND su2.status = 'active' AND (su2.service_expires_at IS NULL OR su2.service_expires_at > NOW())
       ORDER BY t.name`
    );
    response.json({
      tenants: rows.map(r => ({
        id: Number(r.id),
        name: r.name,
        companyName: r.name,
        latestSipExpiry: r.latest_sip_expiry || null,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch tenants:", error);
    response.status(500).json({ message: "獲取租戶失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/tenants/:id - 鐛插彇鍠竴绉熸埗鐨勮┏绱拌硣瑷?
app.get("/api/admin/tenants/:id", requireAdmin, async (request, response) => {
  const tenantId = Number(request.params.id);
  if (!tenantId) return response.status(400).json({ message: "鐒℃晥鐨勭鎴?ID銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         t.id, t.tenant_number, t.name, t.contact_email, t.enterprise_email, t.contact_person,
         t.contact_phone, t.billing_address, t.postal_code, t.sip_domain, t.user_limit,
         t.status, t.created_at,
         a.email AS login_email, a.display_name AS admin_display_name, a.phone_number AS admin_phone,
         COALESCE(p.totalPaid, 0) AS totalPaid
       FROM tenants t
       LEFT JOIN admin_users a ON a.tenant_id = t.id AND a.role = 'owner'
       LEFT JOIN (
         SELECT tenant_id, SUM(payment_amount) AS totalPaid
         FROM billing_payments
         WHERE payment_status = 'paid'
         GROUP BY tenant_id
       ) p ON t.id = p.tenant_id
       WHERE t.id = ?
       LIMIT 1`,
      [tenantId]
    );
    const row = rows[0];
    if (!row) return response.status(404).json({ message: "鎵句笉鍒扮鎴惰硣鏂欍€?" });

    return response.json({
      tenant: {
        id: Number(row.id),
        tenantNumber: row.tenant_number || "",
        companyName: row.name || "",
        enterpriseEmail: row.enterprise_email || row.contact_email || "",
        contactPerson: row.contact_person || "",
        contactPhone: row.contact_phone || "",
        billingAddress: row.billing_address || "",
        postalCode: row.postal_code || "",
        sipDomain: row.sip_domain || "",
        userLimit: Number(row.user_limit || 0),
        status: row.status || "",
        createdAt: row.created_at,
        totalPaid: Number(row.totalPaid || 0),
        loginEmail: row.login_email || "",
        adminPhone: row.admin_phone || "",
        adminDisplayName: row.admin_display_name || "",
      }
    });
  } catch (error) {
    console.error("Failed to fetch tenant details:", error);
    return response.status(500).json({ message: "鐛插彇绉熸埗瑭虫儏澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/admin/tenants/:id/status - 鏇存柊绉熸埗鐙€鎱?
app.put("/api/admin/tenants/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍝″彲浠ュ煼琛屾鎿嶄綔銆?" });
  }

  const tenantId = Number(request.params.id);
  const { status } = request.body || {};

  if (!tenantId) return response.status(400).json({ message: "鐒℃晥鐨勭鎴?ID銆?" });
  if (!['active', "inactive", 'disabled'].includes(status)) {
    return response.status(400).json({ message: "鐒℃晥鐨勭媭鎱嬪€笺€?" });
  }

  // 灏囧墠绔彲鑳藉偝渚嗙殑 inactive 绲变竴鏄犲皠鐐鸿硣鏂欏韩鐨?disabled
  const dbStatus = status === "inactive" ? 'disabled' : status;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const result = await connection.query(`UPDATE tenants SET status = ? WHERE id = ?`, [dbStatus, tenantId]);
    if (Number(result.affectedRows || 0) === 0) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒版寚瀹氱殑绉熸埗銆?" });
    }

    // 鍚屾鏇存柊绉熸埗涓嬫墍鏈夌鐞嗗摗鐨勭媭鎱?    await connection.query(`UPDATE admin_users SET status = ? WHERE tenant_id = ?`, [dbStatus, tenantId]);

    // 鑻ュ仠鐢ㄧ鎴讹紝寮峰埗鐧诲嚭瑭茬鎴剁殑鎵€鏈夌鐞嗗摗
    if (dbStatus === 'disabled') {
      await connection.query(`DELETE s FROM admin_sessions s JOIN admin_users a ON s.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    }

    await connection.commit();
    return response.json({ message: "绉熸埗鐙€鎱嬪凡鏇存柊銆?" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant status:", error);
    return response.status(500).json({ message: "鏇存柊绉熸埗鐙€鎱嬪け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/admin/tenants/:id - 鏇存柊鍠竴绉熸埗鐨勮┏绱拌硣瑷?
app.put("/api/admin/tenants/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍝″彲浠ュ煼琛屾鎿嶄綔銆?" });
  }

  const tenantId = Number(request.params.id);
  if (!tenantId) return response.status(400).json({ message: "鐒℃晥鐨勭鎴?ID銆?" });

  const payload = request.body || {};
  const companyName = sanitizeString(payload.companyName, 160);
  const enterpriseEmail = normalizeEmail(payload.enterpriseEmail);
  const contactPerson = sanitizeString(payload.contactPerson, 120);
  const contactPhone = sanitizeString(payload.contactPhone, 40);
  const billingAddress = sanitizeString(payload.billingAddress, 500);
  const postalCode = sanitizeString(payload.postalCode, 20);

  if (!companyName) return response.status(400).json({ message: "璜嬭几鍏ュ叕鍙稿悕绋便€?" });
  if (enterpriseEmail && !isValidEmail(enterpriseEmail)) {
    return response.status(400).json({ message: "璜嬭几鍏ユ湁鏁堢殑浼佹キ淇＄銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE tenants
       SET name = ?, contact_email = ?, enterprise_email = ?, contact_person = ?,
           contact_phone = ?, billing_address = ?, postal_code = ?
       WHERE id = ?`,
      [companyName, enterpriseEmail || null, enterpriseEmail || null, contactPerson || null, contactPhone || null, billingAddress || null, postalCode || null, tenantId],
    );

    if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "鎵句笉鍒版寚瀹氱殑绉熸埗銆?" });
    return response.json({ message: "绉熸埗瑷畾宸插劜瀛樸€?" });
  } catch (error) {
    console.error("Failed to update tenant details:", error);
    return response.status(500).json({ message: "鏇存柊绉熸埗瑷畾澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/admin/tenants/:id - 寰瑰簳鍒櫎绉熸埗鍙婂叾鎵€鏈夐棞鑱硣鏂?
app.delete("/api/admin/tenants/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍝″彲浠ュ煼琛屾鎿嶄綔銆?" });
  }

  const tenantId = Number(request.params.id);
  if (!tenantId) return response.status(400).json({ message: "鐒℃晥鐨勭鎴?ID銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. 妾㈡煡绉熸埗鏄惁瀛樺湪鍙婂叾鐙€鎱?    const tenantRows = await connection.query(`SELECT id, status FROM tenants WHERE id = ?`, [tenantId]);
    const tenant = tenantRows[0];
    if (!tenant) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒版寚瀹氱殑绉熸埗銆?" });
    }

    if (tenant.status !== 'disabled') {
      await connection.rollback();
      return response.status(409).json({ message: "鍙湁铏曟柤鍋滅敤鐙€鎱嬬殑绉熸埗鎵嶅彲浠ヨ鍒櫎銆?" });
    }

    // 2. 妾㈡煡鏄惁鏈夋敮浠樼磤閷?    const paymentRows = await connection.query(`SELECT id FROM billing_payments WHERE tenant_id = ? LIMIT 1`, [tenantId]);
    if (paymentRows.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "瑭茬鎴跺凡鏈夋敮浠樼磤閷勶紝鐐轰繚闅滆病鍕欐暩鎿氬畬鏁存€э紝鐒℃硶鍒櫎銆?" });
    }

    // 3. 鍒櫎闂滆伅鐨?Token 鑸?Session (鑱〃鍒櫎)
    await connection.query(`DELETE s FROM admin_sessions s JOIN admin_users a ON s.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE e FROM email_verification_tokens e JOIN admin_users a ON e.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE p FROM password_reset_tokens p JOIN admin_users a ON p.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE c FROM admin_email_change_codes c JOIN admin_users a ON c.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    
    // 4. 鍒櫎绠＄悊鍝?    await connection.query(`DELETE FROM admin_users WHERE tenant_id = ?`, [tenantId]);

    // 5. 鍒櫎甯冲柈瑷傚柈鑸囩浉闂滄槑绱?    await connection.query(`DELETE FROM billing_order_status_history WHERE tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE FROM billing_order_items WHERE tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE FROM billing_orders WHERE tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE FROM billing_coupons WHERE tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE FROM billing_offline_payment_accounts WHERE tenant_id = ?`, [tenantId]);

    // 6. 鍒櫎绉熸埗涓昏〃
    await connection.query(`DELETE FROM tenants WHERE id = ?`, [tenantId]);

    await connection.commit();
    return response.json({ message: "绉熸埗鍙婂叾鎵€鏈夐棞鑱硣鏂欏凡寰瑰簳鍒櫎銆?" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete tenant:", error);
    return response.status(500).json({ message: "鍒櫎绉熸埗澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/tenant-coupons", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ユ煡鐪嬩紭鎯犵爜鍒嗛厤璧勬枡銆?" });
  }

  const page = Math.max(1, Number.parseInt(request.query.page || "1", 10));
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(request.query.pageSize || "10", 10)));
  const offset = (page - 1) * pageSize;
  const status = sanitizeString(request.query.status, 20);
  const keyword = sanitizeString(request.query.q, 120);
  const where = [];
  const params = [];

  if (["assigned", "used", "revoked", "expired"].includes(status)) {
    where.push("btc.status = ?");
    params.push(status);
  }
  if (keyword) {
    where.push(`(
      t.name LIKE ?
      OR t.tenant_number LIKE ?
      OR c.coupon_code LIKE ?
      OR c.display_name LIKE ?
    )`);
    const pattern = `%${keyword}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  let connection;
  try {
    connection = await pool.getConnection();
    const statRows = await connection.query(
      `SELECT status, COUNT(*) AS total
       FROM billing_tenant_coupons
       GROUP BY status`,
    );
    const stats = statRows.reduce((acc, row) => {
      acc[row.status || "assigned"] = Number(row.total || 0);
      acc.total += Number(row.total || 0);
      return acc;
    }, { total: 0, assigned: 0, used: 0, revoked: 0, expired: 0 });

    const countRows = await connection.query(
      `SELECT COUNT(*) AS total
       FROM billing_tenant_coupons btc
       JOIN tenants t ON t.id = btc.tenant_id
       JOIN billing_coupons c ON c.id = btc.coupon_id
       ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.total || 0);

    const rows = await connection.query(
      `SELECT
         btc.id, btc.tenant_id, btc.coupon_id, btc.status,
         btc.assigned_at, btc.used_at, btc.used_order_id, btc.notes,
         t.tenant_number, t.name AS tenant_name,
         c.coupon_code, c.display_name, c.discount_type, c.discount_value, c.currency,
         c.valid_from, DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS valid_until,
         o.order_no AS used_order_no
       FROM billing_tenant_coupons btc
       JOIN tenants t ON t.id = btc.tenant_id
       JOIN billing_coupons c ON c.id = btc.coupon_id
       LEFT JOIN billing_orders o ON o.id = btc.used_order_id
       ${whereSql}
       ORDER BY btc.assigned_at DESC, btc.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return response.json({
      stats,
      pagination: { page, pageSize, total },
      items: rows.map((row) => ({
        id: Number(row.id),
        tenantId: Number(row.tenant_id),
        tenantNumber: row.tenant_number || "",
        tenantName: row.tenant_name || "",
        couponId: Number(row.coupon_id),
        couponCode: row.coupon_code || "",
        displayName: row.display_name || "",
        discountType: row.discount_type || "percent",
        discountValue: Number(row.discount_value || 0),
        currency: row.currency || "",
        validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : "",
        validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
        status: row.status || "assigned",
        assignedAt: row.assigned_at || "",
        usedAt: row.used_at || "",
        usedOrderId: row.used_order_id == null ? null : Number(row.used_order_id),
        usedOrderNo: row.used_order_no || "",
        notes: row.notes || "",
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璇诲彇浼樻儬鐮佸垎閰嶅垪琛ㄥけ璐ャ€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/tenant-coupons", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ュ垎閰嶄紭鎯犵爜銆?" });
  }

  const tenantId = Number(request.body?.tenantId || 0);
  const couponId = Number(request.body?.couponId || 0);
  if (!Number.isFinite(tenantId) || tenantId <= 0) return response.status(400).json({ message: "璇烽€夋嫨鏈夋晥绉熸埛銆?" });
  if (!Number.isFinite(couponId) || couponId <= 0) return response.status(400).json({ message: "璇烽€夋嫨鏈夋晥浼樻儬鐮併€?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const tenantRows = await connection.query(
      `SELECT id FROM tenants WHERE id = ? AND status = 'active' LIMIT 1`,
      [tenantId],
    );
    if (!tenantRows[0]) {
      await connection.rollback();
      return response.status(404).json({ message: "绉熸埛涓嶅瓨鍦ㄦ垨鏈惎鐢ㄣ€?" });
    }

    const couponRows = await connection.query(
      `SELECT id
       FROM billing_coupons
       WHERE id = ?
         AND status = 'active'
         AND (valid_from IS NULL OR valid_from <= CURRENT_DATE())
         AND valid_until >= CURRENT_DATE()
         AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
       LIMIT 1`,
      [couponId],
    );
    if (!couponRows[0]) {
      await connection.rollback();
      return response.status(404).json({ message: "浼樻儬鐮佷笉瀛樺湪銆佹湭鍚敤鎴栦笉鍦ㄧ敓鏁堟湡鍐呫€?" });
    }

    const result = await connection.query(
      `INSERT INTO billing_tenant_coupons (
         tenant_id, coupon_id, status, assigned_by_platform_admin_id
       )
       VALUES (?, ?, 'assigned', ?)`,
      [tenantId, couponId, request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({ message: "浼樻儬鐮佸凡鍒嗛厤銆?", id: Number(result.insertId) });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "鍒嗛厤浼樻儬鐮佸け璐ャ€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/tenant-coupons/:id/revoke", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ユ挙閿€浼樻儬鐮併€?" });
  }

  const assignmentId = Number(request.params.id || 0);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return response.status(400).json({ message: "鏃犳晥鐨勪紭鎯犵爜鍒嗛厤璁板綍銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, status, used_order_id
       FROM billing_tenant_coupons
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignmentId],
    );
    const assignment = rows[0];
    if (!assignment) {
      await connection.rollback();
      return response.status(404).json({ message: "浼樻儬鐮佸垎閰嶈褰曚笉瀛樺湪銆?" });
    }
    if (assignment.status === "used" || assignment.used_order_id) {
      await connection.rollback();
      return response.status(409).json({ message: "宸蹭娇鐢ㄤ紭鎯犵爜涓嶈兘鎾ら攢銆?" });
    }
    if (assignment.status !== "assigned") {
      await connection.rollback();
      return response.status(409).json({ message: "褰撳墠鐘舵€佷笉鍏佽鎾ら攢銆?" });
    }

    await connection.query(
      `UPDATE billing_tenant_coupons
       SET status = 'revoked',
           revoked_at = CURRENT_TIMESTAMP,
           revoked_by_platform_admin_id = ?
       WHERE id = ?`,
      [request.admin.id, assignmentId],
    );

    await connection.commit();
    return response.json({ message: "浼樻儬鐮佸凡鎾ら攢銆?" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "鎾ら攢浼樻儬鐮佸け璐ャ€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/tenant-coupons/:id/enable", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ュ惎鐢ㄤ紭鎯犵爜銆?" });
  }

  const assignmentId = Number(request.params.id || 0);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return response.status(400).json({ message: "鏃犳晥鐨勪紭鎯犵爜鍒嗛厤璁板綍銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT btc.id, btc.status, btc.used_order_id, c.status AS coupon_status, c.valid_from, c.valid_until
       FROM billing_tenant_coupons btc
       JOIN billing_coupons c ON c.id = btc.coupon_id
       WHERE btc.id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignmentId],
    );
    const assignment = rows[0];
    if (!assignment) {
      await connection.rollback();
      return response.status(404).json({ message: "浼樻儬鐮佸垎閰嶈褰曚笉瀛樺湪銆?" });
    }
    if (assignment.status === "used" || assignment.used_order_id) {
      await connection.rollback();
      return response.status(409).json({ message: "宸蹭娇鐢ㄤ紭鎯犵爜涓嶈兘閲嶆柊鍚敤銆?" });
    }
    if (assignment.status !== "revoked") {
      await connection.rollback();
      return response.status(409).json({ message: "鍙湁鎾ら攢鐘舵€佺殑浼樻儬鐮佸彲浠ュ惎鐢ㄣ€?" });
    }
    if (assignment.coupon_status !== 'active') {
      await connection.rollback();
      return response.status(409).json({ message: "浼樻儬鐮佸熀纭€璧勬枡鏈惎鐢紝涓嶈兘鍚敤鍒嗛厤璁板綍銆?" });
    }

    await connection.query(
      `UPDATE billing_tenant_coupons
       SET status = 'assigned',
           revoked_at = NULL,
           revoked_by_platform_admin_id = NULL,
           revoke_reason = NULL
       WHERE id = ?`,
      [assignmentId],
    );

    await connection.commit();
    return response.json({ message: "浼樻儬鐮佸凡鍚敤銆?" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "鍚敤浼樻儬鐮佸け璐ャ€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/admin/tenant-coupons/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ュ垹闄や紭鎯犵爜鍒嗛厤璁板綍銆?" });
  }

  const assignmentId = Number(request.params.id || 0);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return response.status(400).json({ message: "鏃犳晥鐨勪紭鎯犵爜鍒嗛厤璁板綍銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, status, used_order_id
       FROM billing_tenant_coupons
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignmentId],
    );
    const assignment = rows[0];
    if (!assignment) {
      await connection.rollback();
      return response.status(404).json({ message: "浼樻儬鐮佸垎閰嶈褰曚笉瀛樺湪銆?" });
    }
    if (assignment.status === "used" || assignment.used_order_id) {
      await connection.rollback();
      return response.status(409).json({ message: "宸蹭娇鐢ㄤ紭鎯犵爜涓嶈兘鍒犻櫎銆?" });
    }
    if (assignment.status !== "revoked") {
      await connection.rollback();
      return response.status(409).json({ message: "鍙湁鎾ら攢鐘舵€佺殑浼樻儬鐮佸彲浠ュ垹闄ゃ€?" });
    }

    await connection.query(`DELETE FROM billing_tenant_coupons WHERE id = ?`, [assignmentId]);
    await connection.commit();
    return response.json({ message: "浼樻儬鐮佸垎閰嶈褰曞凡鍒犻櫎銆?" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "鍒犻櫎浼樻儬鐮佸垎閰嶈褰曞け璐ャ€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/offline-payment-account", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         id, account_code, display_name, payee_name, bank_name, bank_account_no,
         bank_branch, swift_code, currency, contact_name, contact_phone,
         contact_email, payment_notice
       FROM billing_offline_payment_accounts
       WHERE status = 'active'
         AND (tenant_id = ? OR tenant_id IS NULL)
       ORDER BY
         CASE WHEN tenant_id = ? THEN 0 ELSE 1 END,
         is_default DESC,
         sort_order ASC,
         id ASC
       LIMIT 1`,
      [request.admin.tenantId, request.admin.tenantId],
    );

    const row = rows[0];
    if (!row) {
      return response.status(404).json({ message: "鎵句笉鍒扮窔涓嬫敹娆捐硣瑷娿€?" });
    }

    return response.json({
      account: {
        id: Number(row.id),
        accountCode: row.account_code || "",
        displayName: row.display_name || "",
        payeeName: row.payee_name || "",
        bankName: row.bank_name || "",
        bankAccountNo: row.bank_account_no || "",
        bankBranch: row.bank_branch || "",
        swiftCode: row.swift_code || "",
        currency: row.currency || "",
        contactName: row.contact_name || "",
        contactPhone: row.contact_phone || "",
        contactEmail: row.contact_email || "",
        paymentNotice: row.payment_notice || "",
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栫窔涓嬫敹娆捐硣瑷婂け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/offline-payment-account", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍝″彲浠ョ董璀锋敹娆惧赋鎴躲€?" });
  }

  const payload = request.body || {};
  const accountCode = sanitizeString(payload.accountCode, 80) || "default-usd-bank";
  const displayName = sanitizeString(payload.displayName, 120);
  const payeeName = sanitizeString(payload.payeeName, 180);
  const bankName = sanitizeString(payload.bankName, 180);
  const bankAccountNo = sanitizeString(payload.bankAccountNo, 120);
  const bankBranch = sanitizeString(payload.bankBranch, 180);
  const swiftCode = sanitizeString(payload.swiftCode, 40);
  const currency = sanitizeString(payload.currency, 3).toUpperCase();
  const contactName = sanitizeString(payload.contactName, 120);
  const contactPhone = sanitizeString(payload.contactPhone, 40);
  const contactEmail = normalizeEmail(payload.contactEmail);
  const paymentNotice = sanitizeString(payload.paymentNotice, 255);

  if (!displayName) return response.status(400).json({ message: "璜嬭几鍏ュ赋鎴跺悕绋便€?" });
  if (!payeeName) return response.status(400).json({ message: "璜嬭几鍏ユ敹娆惧柈浣嶃€?" });
  if (!bankName) return response.status(400).json({ message: "璜嬭几鍏ラ枊鎴堕妧琛屻€?" });
  if (!bankAccountNo) return response.status(400).json({ message: "璜嬭几鍏ラ妧琛屽赋铏熴€?" });
  if (!/^[A-Z]{3}$/.test(currency)) return response.status(400).json({ message: "骞ｅ垾闇€鐐?3 浣嶈嫳鏂囦唬纰笺€?" });
  if (contactEmail && !isValidEmail(contactEmail)) return response.status(400).json({ message: "璜嬭几鍏ユ湁鏁堢殑鑱怠淇＄銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      `INSERT INTO billing_offline_payment_accounts (
         tenant_id, account_code, display_name, payee_name, bank_name, bank_account_no,
         bank_branch, swift_code, currency, contact_name, contact_phone, contact_email,
         payment_notice, status, is_default, sort_order
       )
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 10)
       ON DUPLICATE KEY UPDATE
         tenant_id = NULL,
         display_name = VALUES(display_name),
         payee_name = VALUES(payee_name),
         bank_name = VALUES(bank_name),
         bank_account_no = VALUES(bank_account_no),
         bank_branch = VALUES(bank_branch),
         swift_code = VALUES(swift_code),
         currency = VALUES(currency),
         contact_name = VALUES(contact_name),
         contact_phone = VALUES(contact_phone),
         contact_email = VALUES(contact_email),
         payment_notice = VALUES(payment_notice),
         status = 'active',
         is_default = 1,
         sort_order = 10`,
      [
        accountCode,
        displayName,
        payeeName,
        bankName,
        bankAccountNo,
        bankBranch || null,
        swiftCode || null,
        currency,
        contactName || null,
        contactPhone || null,
        contactEmail || null,
        paymentNotice || null,
      ],
    );

    return response.json({ message: "鏀舵甯虫埗宸插劜瀛樸€?" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶鍎插瓨鏀舵甯虫埗銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/addon-services", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, addon_code, name, description, billing_unit, status, sort_order
       FROM billing_addons
       WHERE status = 'active'
       ORDER BY sort_order ASC, id ASC`
    );

    const priceRows = await connection.query(
      `SELECT plan_id, addon_id, currency, unit_price, sync_with_plan_term, status, sort_order
       FROM billing_plan_addons
       WHERE status = 'active'
       ORDER BY CASE WHEN unit_price > 0 THEN 0 ELSE 1 END, sort_order ASC, id ASC`
    );

    const pricesByAddonId = priceRows.reduce((acc, row) => {
      const addonId = Number(row.addon_id);
      if (!acc[addonId]) acc[addonId] = [];
      acc[addonId].push({
        planId: Number(row.plan_id),
        currency: row.currency || "USD",
        unitPrice: Number(row.unit_price || 0),
        syncWithPlanTerm: Boolean(row.sync_with_plan_term),
        status: row.status || 'active',
      });
      return acc;
    }, {});
    const basePriceByAddonId = priceRows.reduce((acc, row) => {
      const addonId = Number(row.addon_id);
      if (!acc[addonId]) {
        acc[addonId] = {
          currency: row.currency || "USD",
          unitPrice: Number(row.unit_price || 0),
          syncWithPlanTerm: Boolean(row.sync_with_plan_term),
        };
      }
      return acc;
    }, {});

    return response.json({
      addons: rows.map((row) => ({
        id: Number(row.id),
        addonCode: row.addon_code || "",
        name: row.name || "",
        description: row.description || "",
        billingUnit: row.billing_unit || "account",
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || 0),
        baseCurrency: basePriceByAddonId[Number(row.id)]?.currency || "USD",
        baseUnitPrice: basePriceByAddonId[Number(row.id)]?.unitPrice || 0,
        baseSyncWithPlanTerm: basePriceByAddonId[Number(row.id)]?.syncWithPlanTerm ?? true,
        prices: pricesByAddonId[Number(row.id)] || [],
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璇诲彇澧炲€兼湇鍔″け璐ャ€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/plans", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const plans = await connection.query(`SELECT * FROM billing_plans ORDER BY sort_order ASC, id ASC`);
    const priceTiers = await connection.query(`SELECT * FROM billing_account_price_tiers`);
    const planAddons = await connection.query(`
      SELECT bpa.plan_id, ba.addon_code
      FROM billing_plan_addons bpa
      JOIN billing_addons ba ON bpa.addon_id = ba.id
    `);

    const priceTiersByPlanId = priceTiers.reduce((acc, tier) => {
      const planId = Number(tier.plan_id);
      if (!acc[planId]) acc[planId] = [];
      acc[planId].push({
        currency: tier.currency || 'USD',
        unitPrice: Number(tier.unit_price || 0),
        status: tier.status || 'active',
      });
      return acc;
    }, {});

    const addonsByPlanId = planAddons.reduce((acc, pa) => {
      const planId = Number(pa.plan_id);
      if (!acc[planId]) acc[planId] = [];
      acc[planId].push(pa.addon_code);
      return acc;
    }, {});

    const results = plans.map((plan) => ({
      id: Number(plan.id),
      planCode: plan.plan_code || "",
      name: plan.name || "",
      description: plan.description || "",
      accountQuantity: Number(plan.account_quantity || 0),
      featureSummary: plan.feature_summary || "",
      status: plan.status || 'active',
      sortOrder: Number(plan.sort_order || 0),
      addonServices: (addonsByPlanId[plan.id] || []).join(', '),
      priceTiers: priceTiersByPlanId[plan.id] || [],
    }));

    return response.json({ plans: results });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璇诲彇濂楅璧勬枡澶辫触銆?" });
  } finally {
    if (connection) connection.release();
  }
});

async function savePlanData(connection, payload, planId = null) {
  const {
    planCode, name, description, accountQuantity, featureSummary,
    status, sortOrder, priceTiers, addonServices
  } = payload;

  if (!planCode) throw { statusCode: 400, message: "璇疯緭鍏ュ椁愪唬鐮併€?" };
  if (!name) throw { statusCode: 400, message: "璇疯緭鍏ュ椁愬悕绉般€?" };

  if (planId) {
    await connection.query(
      `UPDATE billing_plans SET
         plan_code = ?, name = ?, description = ?, account_quantity = ?, feature_summary = ?,
         status = ?, sort_order = ?
       WHERE id = ?`,
      [planCode, name, description, accountQuantity, featureSummary, status, sortOrder, planId]
    );
  } else {
    const result = await connection.query(
      `INSERT INTO billing_plans (
         plan_code, name, description, account_quantity, feature_summary, status, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [planCode, name, description, accountQuantity, featureSummary, status, sortOrder]
    );
    planId = Number(result.insertId);
  }

  await connection.query(`DELETE FROM billing_account_price_tiers WHERE plan_id = ?`, [planId]);
  if (Array.isArray(priceTiers) && priceTiers.length > 0) {
    const tier = priceTiers[0]; // Assuming one tier for now
    await connection.query(
      `INSERT INTO billing_account_price_tiers (plan_id, account_quantity, currency, unit_price, status) VALUES (?, ?, ?, ?, ?)`,
      [planId, Number(accountQuantity || tier.accountQuantity || 0), tier.currency || 'TWD', Number(tier.unitPrice || 0), tier.status || 'active']
    );
  }

  await connection.query(`DELETE FROM billing_plan_addons WHERE plan_id = ?`, [planId]);
  const addonCodes = (addonServices || '').split(',').map(s => s.trim()).filter(Boolean);
  if (addonCodes.length > 0) {
    const addonRows = await connection.query(`SELECT id, addon_code FROM billing_addons WHERE addon_code IN (?)`, [addonCodes]);
    for (const addon of addonRows) {
      await connection.query(
        `INSERT INTO billing_plan_addons (plan_id, addon_id, currency, unit_price, sync_with_plan_term, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [planId, addon.id, 'USD', 0, 1, 'active']
      );
    }
  }

  return planId;
}

app.post("/api/billing/plans", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ョ淮鎶ゅ椁愯祫鏂欍€?" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const planId = await savePlanData(connection, request.body);
    await connection.commit();
    return response.status(201).json({ message: "濂楅宸插垱寤恒€?", id: planId });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    if (error?.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: "濂楅浠ｇ爜宸插瓨鍦ㄣ€?" });
    return response.status(error.statusCode || 500).json({ message: error.message || "鍒涘缓濂楅澶辫触銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/plans/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ョ淮鎶ゅ椁愯祫鏂欍€?" });
  }
  const planId = Number(request.params.id);
  if (!planId) return response.status(400).json({ message: "鏃犳晥鐨勫椁?ID銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await savePlanData(connection, request.body, planId);
    await connection.commit();
    return response.json({ message: "濂楅宸叉洿鏂般€?", id: planId });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    if (error?.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: "濂楅浠ｇ爜宸插瓨鍦ㄣ€?" });
    return response.status(error.statusCode || 500).json({ message: error.message || "鏇存柊濂楅澶辫触銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/billing/plans/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ョ淮鎶ゅ椁愯祫鏂欍€?" });
  }
  const planId = Number(request.params.id);
  if (!planId) return response.status(400).json({ message: "鏃犳晥鐨勫椁?ID銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const refs = await connection.query(`SELECT id FROM billing_order_items WHERE plan_id = ? LIMIT 1`, [planId]);
    if (refs.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "姝ゅ椁愬凡琚鍗曚娇鐢紝鏃犳硶鍒犻櫎銆傛偍鍙互灏嗗叾鐘舵€佹敼涓哄仠鐢ㄣ€?" });
    }

    await connection.query(`DELETE FROM billing_plan_addons WHERE plan_id = ?`, [planId]);
    await connection.query(`DELETE FROM billing_account_price_tiers WHERE plan_id = ?`, [planId]);
    const result = await connection.query(`DELETE FROM billing_plans WHERE id = ?`, [planId]);

    if (result.affectedRows === 0) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌鍒犻櫎鐨勫椁愩€?" });
    }

    await connection.commit();
    return response.json({ message: "濂楅宸插垹闄ゃ€?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "鍒犻櫎濂楅澶辫触銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/terms", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, term_code, display_name, months, discount_percent, status, sort_order
       FROM billing_terms
       WHERE status = 'active'
       ORDER BY sort_order ASC, id ASC`
    );

    return response.json({
      terms: rows.map((row) => ({
        id: Number(row.id),
        termCode: row.term_code || "",
        display_name: row.display_name || "",
        months: Number(row.months || 0),
        discount_percent: Number(row.discount_percent || 0),
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || 0),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璇诲彇璐拱鍛ㄦ湡澶辫触銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/purchase-options", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const planRows = await connection.query(
      `SELECT
         p.id, p.plan_code, p.name, p.description, p.account_quantity, p.feature_summary,
         t.currency, t.unit_price
       FROM billing_plans p
       JOIN billing_account_price_tiers t ON t.plan_id = p.id
       WHERE p.status = 'active'
         AND t.status = 'active'
       ORDER BY p.sort_order ASC, p.id ASC`,
    );
    const addonRows = await connection.query(
      `SELECT
         a.id, a.addon_code, a.name, a.description, a.billing_unit,
         pa.plan_id, pa.currency, pa.unit_price, pa.sync_with_plan_term
       FROM billing_addons a
       JOIN billing_plan_addons pa ON pa.addon_id = a.id
       JOIN billing_plans p ON p.id = pa.plan_id
       WHERE a.status = 'active'
         AND pa.status = 'active'
         AND p.status = 'active'
       ORDER BY a.sort_order ASC, a.id ASC, p.sort_order ASC`,
    );

    return response.json({
      plans: planRows.map((row) => ({
        id: Number(row.id),
        planCode: row.plan_code || "",
        name: row.name || "",
        description: row.description || "",
        accountQuantity: Number(row.account_quantity || 0),
        featureSummary: row.feature_summary || "",
        currency: row.currency || "USD",
        unitPrice: Number(row.unit_price || 0),
      })),
      addons: addonRows.map((row) => ({
        id: Number(row.id),
        addonCode: row.addon_code || "",
        name: row.name || "",
        description: row.description || "",
        billingUnit: row.billing_unit || "account",
        planId: Number(row.plan_id),
        currency: row.currency || "USD",
        unitPrice: Number(row.unit_price || 0),
        syncWithPlanTerm: Boolean(row.sync_with_plan_term),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栧椁愯硣鏂欏け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/coupons/validate", requireAdmin, async (request, response) => {
  const code = sanitizeString(request.query.code, 80).toUpperCase();
  if (!code) return response.status(400).json({ message: "璜嬭几鍏ュ劒鎯犵⒓銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    const row = await loadTenantCouponForOrder(connection, request.admin.tenantId, { couponCode: code });
    if (!row) return response.status(404).json({ message: "姝ょ鎴朵笉瀛樺湪瑭插劒鎯犵⒓銆?" });

    return response.json({
      coupon: {
        assignmentId: Number(row.tenant_coupon_id),
        id: Number(row.id),
        couponCode: row.coupon_code || "",
        displayName: row.display_name || "",
        discountType: row.discount_type || "",
        discountValue: Number(row.discount_value || 0),
        currency: row.currency || "",
        validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "椹楄瓑鍎儬纰煎け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

function mapAvailableTenantCoupon(row) {
  return {
    assignmentId: Number(row.tenant_coupon_id),
    couponId: Number(row.id),
    couponCode: row.coupon_code || "",
    displayName: row.display_name || "",
    discountType: row.discount_type || "percent",
    discountValue: Number(row.discount_value || 0),
    currency: row.currency || "",
    validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : "",
    validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
    assignedAt: row.assigned_at || "",
  };
}

async function loadTenantCouponForOrder(connection, tenantId, options = {}) {
  const tenantCouponId = Number(options.tenantCouponId || 0);
  const couponCode = sanitizeString(options.couponCode, 80).toUpperCase();
  const lockClause = options.forUpdate ? " FOR UPDATE" : "";
  const selectSql = `SELECT
       btc.id AS tenant_coupon_id, btc.assigned_at,
       c.id, c.coupon_code, c.display_name, c.discount_type, c.discount_value,
       c.currency, c.valid_from, DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS valid_until
     FROM billing_tenant_coupons btc
     JOIN billing_coupons c ON c.id = btc.coupon_id`;
  const activeSql = `btc.tenant_id = ?
       AND btc.status = 'assigned'
       AND btc.used_at IS NULL
       AND btc.used_order_id IS NULL
       AND c.status = 'active'
       AND (c.valid_from IS NULL OR c.valid_from <= CURRENT_DATE())
       AND c.valid_until >= CURRENT_DATE()
       AND (c.max_redemptions IS NULL OR c.redeemed_count < c.max_redemptions)`;

  if (tenantCouponId > 0) {
    const rows = await connection.query(
      `${selectSql}
       WHERE btc.id = ?
         AND ${activeSql}
       LIMIT 1${lockClause}`,
      [tenantCouponId, tenantId],
    );
    return rows[0] || null;
  }

  if (!couponCode) return null;
  const rows = await connection.query(
    `${selectSql}
     WHERE ${activeSql}
       AND c.coupon_code = ?
     ORDER BY btc.assigned_at ASC, btc.id ASC
     LIMIT 1${lockClause}`,
    [tenantId, couponCode],
  );
  return rows[0] || null;
}

app.get("/api/billing/available-coupons", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) return response.json({ coupons: [] });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         btc.id AS tenant_coupon_id, btc.assigned_at,
         c.id, c.coupon_code, c.display_name, c.discount_type, c.discount_value,
         c.currency, DATE_FORMAT(c.valid_from, '%Y-%m-%d') AS valid_from,
         DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS valid_until
       FROM billing_tenant_coupons btc
       JOIN billing_coupons c ON c.id = btc.coupon_id
       WHERE btc.tenant_id = ?
         AND btc.status = 'assigned'
         AND btc.used_at IS NULL
         AND btc.used_order_id IS NULL
         AND c.status = 'active'
         AND (c.valid_from IS NULL OR c.valid_from <= CURRENT_DATE())
         AND c.valid_until >= CURRENT_DATE()
         AND (c.max_redemptions IS NULL OR c.redeemed_count < c.max_redemptions)
       ORDER BY c.valid_until ASC, btc.assigned_at ASC, btc.id ASC`,
      [request.admin.tenantId],
    );

    return response.json({ coupons: rows.map(mapAvailableTenantCoupon) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璇诲彇鍙敤浼樻儬鐮佸け璐ャ€?" });
  } finally {
    if (connection) connection.release();
  }
});

function toDateValue(value) {
  const text = sanitizeString(value, 10);
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function mapCoupon(row) {
  return {
    id: Number(row.id),
    tenantId: row.tenant_id == null ? null : Number(row.tenant_id),
    couponCode: row.coupon_code || "",
    displayName: row.display_name || "",
    discountType: row.discount_type || "percent",
    discountValue: Number(row.discount_value || 0),
    currency: row.currency || "",
    validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : "",
    validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
    maxRedemptions: row.max_redemptions == null ? "" : Number(row.max_redemptions),
    redeemedCount: Number(row.redeemed_count || 0),
    status: row.status || 'active',
  };
}

app.get("/api/billing/coupon-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ョ淮鎶ゆ姌鎵ｈ祫鏂欍€?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         id, tenant_id, coupon_code, display_name, discount_type, discount_value,
         currency, DATE_FORMAT(valid_from, '%Y-%m-%d') AS valid_from,
         DATE_FORMAT(valid_until, '%Y-%m-%d') AS valid_until,
         max_redemptions, redeemed_count, status
       FROM billing_coupons
       ORDER BY status ASC, valid_until DESC, id DESC`,
    );

    return response.json({ coupons: rows.map(mapCoupon) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "鏃犳硶璇诲彇鎶樻墸璧勬枡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/coupon-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ョ淮鎶ゆ姌鎵ｈ祫鏂欍€?" });
  }

  const payload = request.body || {};
  const id = Number(payload.id || 0);
  const couponCode = sanitizeString(payload.couponCode, 80).toUpperCase();
  const displayName = sanitizeString(payload.displayName, 120);
  const discountType = sanitizeString(payload.discountType, 20);
  const discountValue = Number(payload.discountValue || 0);
  const currency = sanitizeString(payload.currency, 3).toUpperCase();
  const validFrom = toDateValue(payload.validFrom);
  const validUntil = toDateValue(payload.validUntil);
  const rawMaxRedemptions = payload.maxRedemptions === "" || payload.maxRedemptions == null ? null : Number(payload.maxRedemptions);
  const maxRedemptions = Number.isFinite(rawMaxRedemptions) && rawMaxRedemptions > 0 ? Math.floor(rawMaxRedemptions) : null;
  const status = sanitizeString(payload.status, 20);

  if (!couponCode) return response.status(400).json({ message: "璇疯緭鍏ユ姌鎵ｄ唬鐮併€?" });
  if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(couponCode)) return response.status(400).json({ message: "鎶樻墸浠ｇ爜鍙兘浣跨敤鑻辨枃澶у啓瀛楁瘝銆佹暟瀛椼€佸簳绾挎垨杩炲瓧绗︼紝涓旇嚦灏?2 涓瓧绗︺€?" });
  if (!displayName) return response.status(400).json({ message: "璇疯緭鍏ユ樉绀哄悕绉般€?" });
  if (!["percent", "fixed_amount"].includes(discountType)) return response.status(400).json({ message: "璇烽€夋嫨鎶樻墸绫诲瀷銆?" });
  if (!Number.isFinite(discountValue) || discountValue <= 0) return response.status(400).json({ message: "鎶樻墸鍊煎繀椤诲ぇ浜?0銆?" });
  if (discountType === "percent" && discountValue > 100) return response.status(400).json({ message: "鐧惧垎姣旀姌鎵ｄ笉鍙秴杩?100%銆?" });
  if (discountType === "fixed_amount" && !couponCurrencyCodes.has(currency)) return response.status(400).json({ message: "璇烽€夋嫨鏈夋晥甯佺銆?" });
  if (!validUntil) return response.status(400).json({ message: "璇烽€夋嫨鍒版湡鏃ユ湡銆?" });
  if (payload.validFrom && !validFrom) return response.status(400).json({ message: "鐢熸晥鏃ユ湡鏍煎紡鏃犳晥銆?" });
  if (payload.validUntil && !validUntil) return response.status(400).json({ message: "鍒版湡鏃ユ湡鏍煎紡鏃犳晥銆?" });
  if (validFrom && validUntil < validFrom) return response.status(400).json({ message: "鍒版湡鏃ユ湡涓嶅彲鏃╀簬鐢熸晥鏃ユ湡銆?" });
  if (!['active', 'disabled', "expired"].includes(status)) return response.status(400).json({ message: "璇烽€夋嫨鐘舵€併€?" });

  let connection;
  try {
    connection = await pool.getConnection();
    let savedId = Number.isFinite(id) && id > 0 ? id : null;
    if (Number.isFinite(id) && id > 0) {
      const result = await connection.query(
        `UPDATE billing_coupons
         SET coupon_code = ?, display_name = ?, discount_type = ?, discount_value = ?,
             currency = ?, valid_from = ?, valid_until = ?, max_redemptions = ?, status = ?
         WHERE id = ?`,
        [
          couponCode,
          displayName,
          discountType,
          discountValue,
          discountType === "fixed_amount" ? currency : null,
          validFrom || null,
          validUntil,
          maxRedemptions,
          status,
          id,
        ],
      );
      if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "鎶樻墸璧勬枡涓嶅瓨鍦ㄣ€?" });
    } else {
      const result = await connection.query(
        `INSERT INTO billing_coupons (
           tenant_id, coupon_code, display_name, discount_type, discount_value,
           currency, valid_from, valid_until, max_redemptions, status
         )
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          couponCode,
          displayName,
          discountType,
          discountValue,
          discountType === "fixed_amount" ? currency : null,
          validFrom || null,
          validUntil,
          maxRedemptions,
          status,
        ],
      );
      savedId = Number(result.insertId || 0);
    }

    return response.json({ message: "鎶樻墸璧勬枡宸蹭繚瀛樸€?", id: savedId });
  } catch (error) {
    console.error(error);
    if (error?.code === "ER_DUP_ENTRY") return response.status(409).json({ message: "鎶樻墸浠ｇ爜宸插瓨鍦紝璇锋洿鎹㈠悗鍐嶄繚瀛樸€?" });
    return response.status(500).json({ message: "鏃犳硶淇濆瓨鎶樻墸璧勬枡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/billing/coupon-settings/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍛樺彲浠ョ淮鎶ゆ姌鎵ｈ祫鏂欍€?" });
  }

  const couponId = Number(request.params.id || 0);
  if (!Number.isFinite(couponId) || couponId <= 0) return response.status(400).json({ message: "鎶樻墸璧勬枡涓嶅瓨鍦ㄣ€?" });

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(`DELETE FROM billing_coupons WHERE id = ?`, [couponId]);
    if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "鎶樻墸璧勬枡涓嶅瓨鍦ㄣ€?" });
    return response.json({ message: "鎶樻墸璧勬枡宸插垹闄ゃ€?" });
  } catch (error) {
    console.error(error);
    if (error?.code === "ER_ROW_IS_REFERENCED_2") {
      return response.status(409).json({ message: "姝ゆ姌鎵ｅ凡琚鍗曚娇鐢紝涓嶈兘鍒犻櫎锛涘彲鏀逛负鍋滅敤銆?" });
    }
    return response.status(500).json({ message: "鏃犳硶鍒犻櫎鎶樻墸璧勬枡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/payment-methods", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query( // Added status and sort_order
      `SELECT id, method_code, display_name, method_type, logo_class, icon_url, status, sort_order
       FROM billing_payment_methods
       WHERE status = 'active'
       ORDER BY method_type ASC, sort_order ASC, id ASC`,
    );

    return response.json({
      methods: rows.map((row) => ({
        id: Number(row.id),
        methodCode: row.method_code || "",
        displayName: row.display_name || "",
        methodType: row.method_type || "",
        logoClass: row.logo_class || "",
        iconUrl: row.icon_url || "",
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || 0),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栦粯娆炬柟寮忓け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/payment-method-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍝″彲浠ョ董璀蜂粯娆炬柟寮忋€?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, method_code, display_name, method_type, logo_class, icon_url, status, sort_order
       FROM billing_payment_methods
       ORDER BY sort_order ASC, id ASC`,
    );

    return response.json({
      methods: rows.map((row) => ({
        id: Number(row.id),
        methodCode: row.method_code || "",
        displayName: row.display_name || "",
        methodType: row.method_type || "online",
        logoClass: row.logo_class || "",
        iconUrl: row.icon_url || "",
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || 0),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栦粯娆炬柟寮忚ō瀹氬け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/payment-method-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍝″彲浠ョ董璀蜂粯娆炬柟寮忋€?" });
  }

  const methods = Array.isArray(request.body?.methods) ? request.body.methods.slice(0, 50) : [];
  if (methods.length === 0) return response.status(400).json({ message: "璜嬭嚦灏戞柊澧炰竴鍊嬩粯娆炬柟寮忋€?" });

  const seenCodes = new Set();
  const normalizedMethods = [];

  for (const method of methods) {
    const id = Number(method.id || 0);
    const displayName = sanitizeString(method.displayName, 120);
    const rawMethodCode = sanitizeString(method.methodCode, 80).toLowerCase();
    const methodCode = rawMethodCode || generateMethodCode(displayName, seenCodes);
    const methodType = sanitizeString(method.methodType, 20);
    const logoClass = sanitizeString(method.logoClass, 80);
    const iconDataUrl = String(method.iconDataUrl || "");
    let iconUrl = sanitizeString(method.iconUrl, 255);
    const status = sanitizeString(method.status, 20);
    const sortOrder = Math.max(0, Number(method.sortOrder || 0));

    if (!methodCode) return response.status(400).json({ message: "璜嬭几鍏ユ柟寮忎唬纰笺€?" });
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(methodCode)) {
      return response.status(400).json({ message: "鏂瑰紡浠ｇ⒓鍙兘浣跨敤鑻辨枃瀛楁瘝銆佹暩瀛椼€佸簳绶氭垨閫ｅ瓧铏燂紝涓旇嚦灏?2 鍊嬪瓧鍏冦€?" });
    }
    if (seenCodes.has(methodCode)) return response.status(400).json({ message: "鏂瑰紡浠ｇ⒓涓嶅彲閲嶈銆?" });
    seenCodes.add(methodCode);
    if (!displayName) return response.status(400).json({ message: "璜嬭几鍏ラ’绀哄悕绋便€?" });
    if (!["online", "offline"].includes(methodType)) return response.status(400).json({ message: "璜嬮伕鎿囦粯娆鹃鍨嬨€?" });
    if (!['active', 'disabled'].includes(status)) return response.status(400).json({ message: "璜嬮伕鎿囧暉鐢ㄧ媭鎱嬨€?" });
    if (iconUrl && !iconUrl.startsWith("/payment-method-icons/")) return response.status(400).json({ message: "浠樻鏂瑰紡鍦栨璺緫鐒℃晥銆?" });
    if (iconDataUrl) {
      try {
        iconUrl = await savePaymentMethodIcon(iconDataUrl, methodCode);
      } catch (error) {
        return response.status(error.statusCode || 400).json({ message: error.message || "鐒℃硶鍎插瓨浠樻鏂瑰紡鍦栨銆?" });
      }
    }

    normalizedMethods.push({
      id: Number.isFinite(id) && id > 0 ? id : null,
      methodCode,
      displayName,
      methodType,
      logoClass,
      iconUrl,
      status,
      sortOrder,
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    for (const method of normalizedMethods) {
      if (method.id) {
        await connection.query(
          `UPDATE billing_payment_methods
           SET method_code = ?, display_name = ?, method_type = ?, logo_class = ?, icon_url = ?,
               status = ?, sort_order = ?
           WHERE id = ?`,
          [
            method.methodCode,
            method.displayName,
            method.methodType,
            method.logoClass || null,
            method.iconUrl || null,
            method.status,
            method.sortOrder,
            method.id,
          ],
        );
      } else {
        await connection.query(
          `INSERT INTO billing_payment_methods (
             method_code, display_name, method_type, logo_class, icon_url, status, sort_order
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             display_name = VALUES(display_name),
             method_type = VALUES(method_type),
             logo_class = VALUES(logo_class),
             icon_url = VALUES(icon_url),
             status = VALUES(status),
             sort_order = VALUES(sort_order)`,
          [
            method.methodCode,
            method.displayName,
            method.methodType,
            method.logoClass || null,
            method.iconUrl || null,
            method.status,
            method.sortOrder,
          ],
        );
      }
    }

    await connection.commit();
    return response.json({ message: "浠樻鏂瑰紡宸插劜瀛樸€?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    if (error?.code === "ER_DUP_ENTRY") return response.status(409).json({ message: "鏂瑰紡浠ｇ⒓宸插瓨鍦紝璜嬫洿鎻涘緦鍐嶅劜瀛樸€?" });
    return response.status(500).json({ message: "鐒℃硶鍎插瓨浠樻鏂瑰紡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/billing/payment-method-settings/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁骞冲彴绠＄悊鍝″彲浠ョ董璀蜂粯娆炬柟寮忋€?" });
  }

  const methodId = Number(request.params.id || 0);
  if (!Number.isFinite(methodId) || methodId <= 0) {
    return response.status(400).json({ message: "浠樻鏂瑰紡涓嶅瓨鍦ㄣ€?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const countRows = await connection.query(`SELECT COUNT(*) AS total FROM billing_payment_methods`);
    const total = Number(countRows[0]?.total || 0);
    if (total <= 1) {
      await connection.rollback();
      return response.status(400).json({ message: "鑷冲皯闇€淇濈暀涓€鍊嬩粯娆炬柟寮忋€?" });
    }

    const result = await connection.query(`DELETE FROM billing_payment_methods WHERE id = ?`, [methodId]);
    if (Number(result.affectedRows || 0) === 0) {
      await connection.rollback();
      return response.status(404).json({ message: "浠樻鏂瑰紡涓嶅瓨鍦ㄣ€?" });
    }

    await connection.commit();
    return response.json({ message: "浠樻鏂瑰紡宸插埅闄ゃ€?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶鍒櫎浠樻鏂瑰紡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/orders", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
         o.currency, o.payable_amount, o.order_status, o.payment_status,
         o.payment_method, o.payment_channel, o.effective_at, o.expires_at, o.created_at,
         plan.item_name AS plan_name,
         plan.account_quantity,
         plan.months,
         GROUP_CONCAT(DISTINCT addon.item_name ORDER BY addon.sort_order SEPARATOR ', ') AS addon_names,
         p.paid_at,
         p.payment_proof_uploaded_at
       FROM billing_orders o
       LEFT JOIN billing_order_items plan
         ON plan.order_id = o.id
        AND plan.item_type = 'plan'
       LEFT JOIN billing_order_items addon
         ON addon.order_id = o.id
        AND addon.item_type = 'addon'
       LEFT JOIN billing_payments p
         ON p.order_id = o.id
       WHERE o.tenant_id = ?
       GROUP BY
          o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
          o.currency, o.payable_amount, o.order_status, o.payment_status,
         o.payment_method, o.payment_channel, o.effective_at, o.expires_at, o.created_at,
         plan.item_name, plan.account_quantity, plan.months, p.paid_at, p.payment_proof_uploaded_at
       ORDER BY o.created_at DESC, o.id DESC`,
      [request.admin.tenantId],
    );

    return response.json({
      orders: rows.map((row) => ({
        id: Number(row.id),
        orderNo: row.order_no || "",
        orderType: row.order_type || "new_purchase",
        renewalSourceOrderId: row.renewal_source_order_id == null ? null : Number(row.renewal_source_order_id),
        renewalBaseExpiresAt: row.renewal_base_expires_at ? String(row.renewal_base_expires_at).slice(0, 10) : "",
        planName: row.plan_name || "-",
        orderStatus: row.order_status || "",
        paymentStatus: row.payment_status || "",
        accountQuantity: Number(row.account_quantity || 0),
        addonNames: row.addon_names || "",
        months: Number(row.months || 0),
        effectiveAt: row.effective_at ? String(row.effective_at).slice(0, 10) : "",
        expiresAt: row.expires_at ? String(row.expires_at).slice(0, 10) : "",
        paymentMethod: row.payment_method || "",
        paymentChannel: row.payment_channel || "",
        paymentDate: row.paid_at ? String(row.paid_at).slice(0, 10) : row.payment_proof_uploaded_at ? String(row.payment_proof_uploaded_at).slice(0, 10) : "",
        currency: row.currency || "USD",
        payableAmount: Number(row.payable_amount || 0),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栬▊鍠垪琛ㄥけ鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

function makeBusinessNo(prefix) {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${prefix}${date}${random}`;
}

async function loadAddonOrderRows(connection, planId, addonCodes, currency) {
  if (!addonCodes.length) return [];

  const addonRows = await connection.query(
    `SELECT
       a.id, a.addon_code, a.name, a.sort_order,
       included.plan_id AS included_plan_id
     FROM billing_addons a
     LEFT JOIN billing_plan_addons included
       ON included.addon_id = a.id
      AND included.plan_id = ?
      AND included.status = 'active'
     WHERE a.addon_code IN (?)
       AND a.status = 'active'
     ORDER BY a.sort_order ASC, a.id ASC`,
    [planId, addonCodes],
  );
  if (!addonRows.length) return [];

  const addonIds = addonRows.map((addon) => Number(addon.id));
  const priceRows = await connection.query(
    `SELECT addon_id, currency, unit_price, sync_with_plan_term
     FROM billing_plan_addons
     WHERE addon_id IN (?)
       AND status = 'active'
     ORDER BY
       CASE WHEN currency = ? THEN 0 ELSE 1 END,
       CASE WHEN unit_price > 0 THEN 0 ELSE 1 END,
       sort_order ASC,
       id ASC`,
    [addonIds, currency],
  );
  const basePriceByAddonId = priceRows.reduce((acc, row) => {
    const addonId = Number(row.addon_id);
    if (!acc[addonId]) {
      acc[addonId] = {
        currency: row.currency || currency,
        unitPrice: Number(row.unit_price || 0),
        syncWithPlanTerm: Boolean(row.sync_with_plan_term),
      };
    }
    return acc;
  }, {});

  return addonRows.map((addon) => {
    const addonId = Number(addon.id);
    const isIncluded = Number(addon.included_plan_id || 0) === Number(planId);
    const basePrice = basePriceByAddonId[addonId] || { currency, unitPrice: 0, syncWithPlanTerm: true };
    return {
      id: addonId,
      addonCode: addon.addon_code,
      name: addon.name,
      unitPrice: isIncluded ? 0 : Number(basePrice.unitPrice || 0),
      currency: basePrice.currency || currency,
      syncWithPlanTerm: isIncluded ? true : basePrice.syncWithPlanTerm,
      isIncluded,
    };
  });
}

async function buildBillingOrderDraft(connection, request, payload) {
  const planCode = sanitizeString(payload.planCode, 80);
  const quantity = Math.max(1, Number(payload.quantity || 1));
  const months = Math.max(1, Number(payload.months || 1));
  const addonCodes = Array.isArray(payload.addonCodes) ? payload.addonCodes.map((code) => sanitizeString(code, 80)).filter(Boolean) : [];
  const couponCode = sanitizeString(payload.couponCode, 80).toUpperCase();
  const tenantCouponId = Number(payload.tenantCouponId || payload.couponAssignmentId || 0);

  if (!planCode) {
    const error = new Error("璜嬮伕鎿囧椁愩€?");
    error.statusCode = 400;
    throw error;
  }

  const planRows = await connection.query(
    `SELECT p.id, p.plan_code, p.name, p.account_quantity, t.currency, t.unit_price
     FROM billing_plans p
     JOIN billing_account_price_tiers t ON t.plan_id = p.id
     WHERE p.plan_code = ?
       AND p.status = 'active'
       AND t.status = 'active'
     LIMIT 1`,
    [planCode],
  );
  const plan = planRows[0];
  if (!plan) {
    const error = new Error("濂楅涓嶅瓨鍦ㄦ垨宸插仠鐢ㄣ€?");
    error.statusCode = 404;
    throw error;
  }

  const currency = plan.currency || "USD";
  const orderItems = [];
  let subtotal = Number(plan.unit_price) * quantity * months;
  orderItems.push({
    itemType: "plan",
    planId: Number(plan.id),
    addonId: null,
    couponId: null,
    itemCode: plan.plan_code,
    itemName: `${plan.name} 濂楅`,
    quantity,
    months,
    unitPrice: Number(plan.unit_price),
    discountAmount: 0,
    lineAmount: subtotal,
    accountQuantity: Number(plan.account_quantity || 0) * quantity,
    sortOrder: 10,
  });

  if (addonCodes.length > 0) {
    const addonRows = await loadAddonOrderRows(connection, Number(plan.id), addonCodes, currency);

    addonRows.forEach((addon, index) => {
      const lineMonths = addon.syncWithPlanTerm ? months : 1;
      const lineAmount = Number(addon.unitPrice) * quantity * lineMonths;
      subtotal += lineAmount;
      orderItems.push({
        itemType: "addon",
        planId: Number(plan.id),
        addonId: Number(addon.id),
        couponId: null,
        itemCode: addon.addonCode,
        itemName: addon.name,
        quantity,
        months: lineMonths,
        unitPrice: Number(addon.unitPrice),
        discountAmount: 0,
        lineAmount,
        accountQuantity: null,
        sortOrder: 20 + index,
      });
    });
  }

  let coupon = null;
  let discountAmount = 0;
  if (tenantCouponId > 0 || couponCode) {
    coupon = await loadTenantCouponForOrder(connection, request.admin.tenantId, { tenantCouponId, couponCode });
    if (!coupon) {
      const error = new Error("姝ょ鎴朵笉瀛樺湪瑭插劒鎯犵⒓銆?");
      error.statusCode = 404;
      throw error;
    }
    if (coupon.discount_type === "percent") discountAmount = subtotal * (Number(coupon.discount_value) / 100);
    if (coupon.discount_type === "fixed_amount") discountAmount = Math.min(subtotal, Number(coupon.discount_value));
    orderItems.push({
      itemType: "discount",
      planId: null,
      addonId: null,
      couponId: Number(coupon.id),
      itemCode: coupon.coupon_code,
      itemName: "鍎儬鎶樻墸",
      quantity: 1,
      months: 1,
      unitPrice: 0,
      discountAmount,
      lineAmount: -discountAmount,
      accountQuantity: null,
      sortOrder: 90,
    });
  }

  return {
    currency,
    subtotal,
    discountAmount,
    payableAmount: Math.max(0, subtotal - discountAmount),
    coupon,
    orderItems,
  };
}

async function findOfflinePaymentAccountId(connection, tenantId) {
  const rows = await connection.query(
    `SELECT id FROM billing_offline_payment_accounts
     WHERE status = 'active' AND (tenant_id = ? OR tenant_id IS NULL)
     ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, is_default DESC, sort_order ASC, id ASC
     LIMIT 1`,
    [tenantId, tenantId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

app.post("/api/billing/orders", requireAdmin, async (request, response) => {
  const payload = request.body || {};
  const planCode = sanitizeString(payload.planCode, 80);
  const quantity = Math.max(1, Number(payload.quantity || 1));
  const months = Math.max(1, Number(payload.months || 1));
  const addonCodes = Array.isArray(payload.addonCodes) ? payload.addonCodes.map((code) => sanitizeString(code, 80)).filter(Boolean) : [];
  const couponCode = sanitizeString(payload.couponCode, 80).toUpperCase();
  const tenantCouponId = Number(payload.tenantCouponId || payload.couponAssignmentId || 0);
  const paymentMethod = sanitizeString(payload.paymentMethod, 20);
  const paymentChannel = sanitizeString(payload.paymentChannel, 80);
  const billingAddress = sanitizeString(payload.billingAddress, 500);

  if (!planCode) return response.status(400).json({ message: "璜嬮伕鎿囧椁愩€?" });
  if (!["online", "offline"].includes(paymentMethod)) return response.status(400).json({ message: "璜嬮伕鎿囨敮浠樻柟寮忋€?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const planRows = await connection.query(
      `SELECT p.id, p.plan_code, p.name, p.account_quantity, t.currency, t.unit_price
       FROM billing_plans p
       JOIN billing_account_price_tiers t ON t.plan_id = p.id
       WHERE p.plan_code = ?
         AND p.status = 'active'
         AND t.status = 'active'
       LIMIT 1`,
      [planCode],
    );
    const plan = planRows[0];
    if (!plan) {
      await connection.rollback();
      return response.status(404).json({ message: "濂楅涓嶅瓨鍦ㄦ垨宸插仠鐢ㄣ€?" });
    }

    const currency = plan.currency || "USD";
    const orderItems = [];
    let subtotal = Number(plan.unit_price) * quantity * months;
    orderItems.push({
      itemType: "plan",
      planId: Number(plan.id),
      addonId: null,
      couponId: null,
      itemCode: plan.plan_code,
      itemName: `${plan.name} 濂楅`,
      quantity,
      months,
      unitPrice: Number(plan.unit_price),
      discountAmount: 0,
      lineAmount: subtotal,
      accountQuantity: Number(plan.account_quantity || 0) * quantity,
      sortOrder: 10,
    });

    if (addonCodes.length > 0) {
      const addonRows = await loadAddonOrderRows(connection, Number(plan.id), addonCodes, currency);

      addonRows.forEach((addon, index) => {
        const lineMonths = addon.syncWithPlanTerm ? months : 1;
        const lineAmount = Number(addon.unitPrice) * quantity * lineMonths;
        subtotal += lineAmount;
        orderItems.push({
          itemType: "addon",
          planId: Number(plan.id),
          addonId: Number(addon.id),
          couponId: null,
          itemCode: addon.addonCode,
          itemName: addon.name,
          quantity,
          months: lineMonths,
          unitPrice: Number(addon.unitPrice),
          discountAmount: 0,
          lineAmount,
          accountQuantity: null,
          sortOrder: 20 + index,
        });
      });
    }

    let coupon = null;
    let discountAmount = 0;
    if (tenantCouponId > 0 || couponCode) {
      coupon = await loadTenantCouponForOrder(connection, request.admin.tenantId, { tenantCouponId, couponCode, forUpdate: true });
      if (!coupon) {
        await connection.rollback();
        return response.status(404).json({ message: "姝ょ鎴朵笉瀛樺湪瑭插劒鎯犵⒓銆?" });
      }
      if (coupon.discount_type === "percent") discountAmount = subtotal * (Number(coupon.discount_value) / 100);
      if (coupon.discount_type === "fixed_amount") discountAmount = Math.min(subtotal, Number(coupon.discount_value));
      orderItems.push({
        itemType: "discount",
        planId: null,
        addonId: null,
        couponId: Number(coupon.id),
        itemCode: coupon.coupon_code,
        itemName: "鍎儬鎶樻墸",
        quantity: 1,
        months: 1,
        unitPrice: 0,
        discountAmount,
        lineAmount: -discountAmount,
        accountQuantity: null,
        sortOrder: 90,
      });
    }

    const payableAmount = Math.max(0, subtotal - discountAmount);
    const isOnlinePaid = paymentMethod === "online";
    const initialOrderStatus = isOnlinePaid ? "payment_submitted" : "pending_payment";
    const initialPaymentStatus = isOnlinePaid ? 'paid' : "unpaid";
    const initialPaymentRecordStatus = isOnlinePaid ? 'paid' : "pending";
    const orderNo = makeBusinessNo("ORD");
    const orderResult = await connection.query(
      `INSERT INTO billing_orders (
         tenant_id, order_no, currency, subtotal_amount, discount_amount, payable_amount,
         paid_amount, order_status, payment_status, payment_method, payment_channel, billing_address,
         coupon_id, coupon_code, coupon_discount_type, coupon_discount_value, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.admin.tenantId,
        orderNo,
        currency,
        subtotal,
        discountAmount,
        payableAmount,
        isOnlinePaid ? payableAmount : 0,
        initialOrderStatus,
        initialPaymentStatus,
        paymentMethod,
        paymentChannel || null,
        billingAddress || null,
        coupon ? Number(coupon.id) : null,
        coupon ? coupon.coupon_code : null,
        coupon ? coupon.discount_type : null,
        coupon ? Number(coupon.discount_value) : null,
        request.admin.id,
      ],
    );
    const orderId = Number(orderResult.insertId);

    for (const item of orderItems) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          item.itemType,
          item.planId,
          item.addonId,
          item.couponId,
          item.itemCode,
          item.itemName,
          item.accountQuantity,
          item.quantity,
          item.months,
          currency,
          item.unitPrice,
          item.discountAmount,
          item.lineAmount,
          item.sortOrder,
        ],
      );
    }

    if (coupon?.tenant_coupon_id) {
      await connection.query(
        `UPDATE billing_tenant_coupons
         SET status = 'used', used_at = CURRENT_TIMESTAMP, used_order_id = ?
         WHERE id = ? AND tenant_id = ? AND status = 'assigned'`,
        [orderId, Number(coupon.tenant_coupon_id), request.admin.tenantId],
      );
      await connection.query(
        `UPDATE billing_coupons
         SET redeemed_count = COALESCE(redeemed_count, 0) + 1
         WHERE id = ?`,
        [Number(coupon.id)],
      );
    }

    const offlineAccountRows =
      paymentMethod === "offline"
        ? await connection.query(
            `SELECT id FROM billing_offline_payment_accounts
             WHERE status = 'active' AND (tenant_id = ? OR tenant_id IS NULL)
             ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, is_default DESC, sort_order ASC, id ASC
             LIMIT 1`,
            [request.admin.tenantId, request.admin.tenantId],
          )
        : [];
    const paymentNo = makeBusinessNo("PAY");
    await connection.query(
      `INSERT INTO billing_payments (
         order_id, tenant_id, payment_no, payment_method, payment_channel,
         offline_payment_account_id, payment_currency, payment_amount, payment_status,
         paid_at, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        paymentNo,
        paymentMethod,
        paymentChannel || null,
        offlineAccountRows[0] ? Number(offlineAccountRows[0].id) : null,
        currency,
        payableAmount,
        initialPaymentRecordStatus,
        isOnlinePaid ? new Date() : null,
        request.admin.id,
      ],
    );

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, to_order_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, request.admin.tenantId, initialOrderStatus, initialPaymentStatus, "create_order", request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({
      message: paymentMethod === "offline" ? "瑷傚柈宸蹭繚瀛橈紝璜嬬窔涓嬩粯娆惧緦涓婂偝浠樻鎲戣瓑鎴湒銆?" : "瑷傚柈宸插缓绔嬨€?",
      order: { id: orderId, orderNo, currency, payableAmount },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "寤虹珛瑷傚柈澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/orders/:id", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "瑷傚柈绶ㄨ櫉鐒℃晥銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
         o.currency, o.subtotal_amount, o.discount_amount, o.payable_amount,
         o.order_status, o.payment_status, o.payment_method, o.payment_channel, o.billing_address,
         DATE_FORMAT(o.reviewed_at, '%Y-%m-%d') AS reviewed_at,
         DATE_FORMAT(o.effective_at, '%Y-%m-%d') AS effective_at,
         DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at,
         o.review_note,
         o.coupon_code, o.coupon_discount_type, o.coupon_discount_value,
         DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS coupon_valid_until
       FROM billing_orders o
       LEFT JOIN billing_coupons c ON c.id = o.coupon_id
       WHERE o.id = ? AND o.tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const order = rows[0];
    if (!order) return response.status(404).json({ message: "鎵句笉鍒拌▊鍠€?" });

    const itemRows = await connection.query(
      `SELECT
         item_type, item_code, item_name, account_quantity, quantity, months,
         currency, unit_price, discount_amount, line_amount, sort_order
       FROM billing_order_items
       WHERE order_id = ? AND tenant_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [orderId, request.admin.tenantId],
    );
    const planItem = itemRows.find((item) => item.item_type === "plan") || null;
    const addonItems = itemRows.filter((item) => item.item_type === "addon");
    const paymentRows = await connection.query(
      `SELECT
         payment_amount,
         DATE_FORMAT(paid_at, '%Y-%m-%d') AS paid_at,
         payment_proof_file_url,
         payment_proof_file_name,
         payment_proof_uploaded_at
       FROM billing_payments
       WHERE order_id = ? AND tenant_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const payment = paymentRows[0] || null;
    const renewalAccountRows = await connection.query(
      `SELECT
         e.id AS entitlement_id,
         e.sip_user_id,
         DATE_FORMAT(e.service_expires_at, '%Y-%m-%d') AS service_expires_at,
         u.username,
         u.sip_domain,
         u.display_name
       FROM tenant_sip_account_entitlements e
       JOIN sip_users u ON u.id = e.sip_user_id
       WHERE e.tenant_id = ?
         AND (e.first_order_id = ? OR e.current_order_id = ? OR e.last_renewal_order_id = ?)
       ORDER BY u.username ASC, e.id ASC`,
      [request.admin.tenantId, orderId, orderId, orderId],
    );
    const retainedRows = await connection.query(
      `SELECT sip_user_id
       FROM billing_order_renewal_retained_accounts
       WHERE tenant_id = ? AND order_id = ?
       ORDER BY id ASC`,
      [request.admin.tenantId, orderId],
    );

    return response.json({
      order: {
        id: Number(order.id),
        orderNo: order.order_no || "",
        orderType: order.order_type || "new_purchase",
        renewalSourceOrderId: order.renewal_source_order_id == null ? null : Number(order.renewal_source_order_id),
        renewalBaseExpiresAt: order.renewal_base_expires_at ? String(order.renewal_base_expires_at).slice(0, 10) : "",
        currency: order.currency || "USD",
        subtotalAmount: Number(order.subtotal_amount || 0),
        discountAmount: Number(order.discount_amount || 0),
        payableAmount: Number(order.payable_amount || 0),
        orderStatus: order.order_status || "",
        paymentStatus: order.payment_status || "",
        paymentMethod: order.payment_method || "",
        paymentChannel: order.payment_channel || "",
        billingAddress: order.billing_address || "",
        reviewedAt: order.reviewed_at || "",
        reviewNote: order.review_note || "",
        effectiveAt: order.effective_at || "",
        expiresAt: order.expires_at || "",
        payment: payment
          ? {
              actualAmount: Number(payment.payment_amount || 0),
              paymentDate: payment.paid_at || "",
              proofUrl: payment.payment_proof_file_url || "",
              proofFileName: payment.payment_proof_file_name || "",
              proofUploadedAt: payment.payment_proof_uploaded_at ? String(payment.payment_proof_uploaded_at) : "",
            }
          : null,
        editable: !["review_approved", "review_rejected"].includes(order.order_status),
        planCode: planItem?.item_code || "",
        quantity: Number(planItem?.quantity || 1),
        months: Number(planItem?.months || 1),
        addonCodes: addonItems.map((item) => item.item_code).filter(Boolean),
        renewalAccounts: renewalAccountRows.map((account) => ({
          entitlementId: Number(account.entitlement_id),
          sipUserId: Number(account.sip_user_id),
          username: account.username || "",
          sipDomain: account.sip_domain || "",
          displayName: account.display_name || "",
          serviceExpiresAt: account.service_expires_at || "",
        })),
        retainedSipUserIds: retainedRows.map((row) => Number(row.sip_user_id)),
        coupon: order.coupon_code
          ? {
              couponCode: order.coupon_code,
              discountType: order.coupon_discount_type || "",
              discountValue: Number(order.coupon_discount_value || 0),
              validUntil: order.coupon_valid_until ? String(order.coupon_valid_until).slice(0, 10) : "",
            }
          : null,
        items: itemRows.map((item) => ({
          itemType: item.item_type || "",
          itemCode: item.item_code || "",
          itemName: item.item_name || "",
          accountQuantity: item.account_quantity == null ? null : Number(item.account_quantity),
          quantity: Number(item.quantity || 0),
          months: Number(item.months || 0),
          currency: item.currency || "USD",
          unitPrice: Number(item.unit_price || 0),
          discountAmount: Number(item.discount_amount || 0),
          lineAmount: Number(item.line_amount || 0),
        })),
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栬▊鍠┏鎯呭け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/orders/:id", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "瑷傚柈绶ㄨ櫉鐒℃晥銆?" });

  const payload = request.body || {};
  const paymentMethod = sanitizeString(payload.paymentMethod, 20);
  const paymentChannel = sanitizeString(payload.paymentChannel, 80);
  const billingAddress = sanitizeString(payload.billingAddress, 500);
  if (!["online", "offline"].includes(paymentMethod)) return response.status(400).json({ message: "璜嬮伕鎿囨敮浠樻柟寮忋€?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const existingRows = await connection.query(
      `SELECT id, order_status, payment_status
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const existing = existingRows[0];
    if (!existing) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌▊鍠€?" });
    }
    if (["review_approved", "review_rejected"].includes(existing.order_status)) {
      await connection.rollback();
      return response.status(409).json({ message: "瀹℃牳閫氳繃鎴栧鏍告湭閫氳繃鐨勮鍗曚笉鍏佽淇敼銆?" });
    }

    const draft = await buildBillingOrderDraft(connection, request, payload);
    const nextOrderStatus = "pending_payment";
    const nextPaymentStatus = "unpaid";
    const nextPaymentRecordStatus = "pending";
    let staleProofUrl = "";
    await connection.query(
      `UPDATE billing_orders
       SET currency = ?, subtotal_amount = ?, discount_amount = ?, payable_amount = ?,
           paid_amount = ?, order_status = ?, payment_status = ?,
           payment_method = ?, payment_channel = ?, billing_address = ?,
           coupon_id = ?, coupon_code = ?, coupon_discount_type = ?, coupon_discount_value = ?,
           effective_at = NULL, expires_at = NULL,
           reviewed_at = NULL, reviewed_by_platform_admin_id = NULL, review_note = NULL,
           updated_by_admin_user_id = ?
       WHERE id = ? AND tenant_id = ?`,
      [
        draft.currency,
        draft.subtotal,
        draft.discountAmount,
        draft.payableAmount,
        0,
        nextOrderStatus,
        nextPaymentStatus,
        paymentMethod,
        paymentChannel || null,
        billingAddress || null,
        draft.coupon ? Number(draft.coupon.id) : null,
        draft.coupon ? draft.coupon.coupon_code : null,
        draft.coupon ? draft.coupon.discount_type : null,
        draft.coupon ? Number(draft.coupon.discount_value) : null,
        request.admin.id,
        orderId,
        request.admin.tenantId,
      ],
    );

    await connection.query(`DELETE FROM billing_order_items WHERE order_id = ? AND tenant_id = ?`, [orderId, request.admin.tenantId]);
    for (const item of draft.orderItems) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          item.itemType,
          item.planId,
          item.addonId,
          item.couponId,
          item.itemCode,
          item.itemName,
          item.accountQuantity,
          item.quantity,
          item.months,
          draft.currency,
          item.unitPrice,
          item.discountAmount,
          item.lineAmount,
          item.sortOrder,
        ],
      );
    }

    const offlineAccountId = paymentMethod === "offline" ? await findOfflinePaymentAccountId(connection, request.admin.tenantId) : null;
    const paymentRows = await connection.query(
      `SELECT id, payment_proof_file_url FROM billing_payments WHERE order_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    if (paymentRows[0]) {
      staleProofUrl = paymentRows[0].payment_proof_file_url || "";
      await connection.query(
        `UPDATE billing_payments
         SET payment_method = ?, payment_channel = ?, offline_payment_account_id = ?,
             payment_currency = ?, payment_amount = ?, payment_status = ?, paid_at = ?,
             payment_proof_file_url = NULL, payment_proof_file_name = NULL, payment_proof_uploaded_at = NULL,
             updated_by_admin_user_id = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          paymentMethod,
          paymentChannel || null,
          offlineAccountId,
          draft.currency,
          draft.payableAmount,
          nextPaymentRecordStatus,
          null,
          request.admin.id,
          Number(paymentRows[0].id),
          request.admin.tenantId,
        ],
      );
    } else {
      await connection.query(
        `INSERT INTO billing_payments (
           order_id, tenant_id, payment_no, payment_method, payment_channel,
           offline_payment_account_id, payment_currency, payment_amount, payment_status,
           paid_at, created_by_admin_user_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          makeBusinessNo("PAY"),
          paymentMethod,
          paymentChannel || null,
          offlineAccountId,
          draft.currency,
          draft.payableAmount,
          nextPaymentRecordStatus,
          null,
          request.admin.id,
        ],
      );
    }

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, from_order_status, to_order_status,
         from_payment_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        existing.order_status,
        nextOrderStatus,
        existing.payment_status,
        nextPaymentStatus,
        "update_order",
        request.admin.id,
      ],
    );

    await connection.commit();
    await removePaymentProofFile(staleProofUrl);
    return response.json({ message: "瑷傚柈宸叉洿鏂帮紝鍘熶粯娆惧嚟璇佸凡娓呯┖锛岃閲嶆柊涓婁紶浠樻鍑瘉銆?", order: { id: orderId, currency: draft.currency, payableAmount: draft.payableAmount } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "淇敼瑷傚柈澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/repurchase", requireAdmin, async (request, response) => {
  const sourceOrderId = Number(request.params.id);
  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) return response.status(400).json({ message: "璁㈠崟缂栧彿鏃犳晥銆?" });

  const payload = request.body || {};
  const requestedPaymentMethod = sanitizeString(payload.paymentMethod, 20);
  const requestedPaymentChannel = sanitizeString(payload.paymentChannel, 80);
  const requestedBillingAddress = sanitizeString(payload.billingAddress, 500);
  const requestedCouponCode = sanitizeString(payload.couponCode, 80).toUpperCase();
  const requestedTenantCouponId = Number(payload.tenantCouponId || payload.couponAssignmentId || 0);

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const sourceRows = await connection.query(
      `SELECT
         id, currency, subtotal_amount, discount_amount, payable_amount,
         payment_method, payment_channel, billing_address
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [sourceOrderId, request.admin.tenantId],
    );
    const source = sourceRows[0];
    if (!source) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒板師璁㈠崟銆?" });
    }

    const itemRows = await connection.query(
      `SELECT
         item.item_type, item.plan_id, item.addon_id, item.coupon_id, item.item_code, item.item_name, item.description,
         item.account_quantity, item.quantity, item.months, item.currency, item.unit_price, item.discount_amount,
         item.line_amount, item.sort_order, pa.sync_with_plan_term
       FROM billing_order_items
       AS item
       LEFT JOIN billing_plan_addons pa ON pa.plan_id = item.plan_id AND pa.addon_id = item.addon_id
       WHERE item.order_id = ? AND item.tenant_id = ?
       ORDER BY item.sort_order ASC, item.id ASC`,
      [sourceOrderId, request.admin.tenantId],
    );
    if (itemRows.length === 0) {
      await connection.rollback();
      return response.status(409).json({ message: "鍘熻鍗曟病鏈夊彲澶嶅埗鐨勬槑缁嗐€?" });
    }

    const paymentMethod = ["online", "offline"].includes(requestedPaymentMethod) ? requestedPaymentMethod : source.payment_method;
    const paymentChannel = requestedPaymentChannel || (paymentMethod === source.payment_method ? source.payment_channel : paymentMethod === "offline" ? "bank_transfer" : null);
    const billingAddress = requestedBillingAddress || source.billing_address || null;
    const isOnlinePaid = paymentMethod === "online";

    let coupon = null;
    let discountAmount = 0;
    if (requestedTenantCouponId > 0 || requestedCouponCode) {
      coupon = await loadTenantCouponForOrder(connection, request.admin.tenantId, { tenantCouponId: requestedTenantCouponId, couponCode: requestedCouponCode, forUpdate: true });
      if (!coupon) {
        await connection.rollback();
        return response.status(404).json({ message: "此租户不存在该优惠码或已被使用。" });
      }
      if (coupon.discount_type === "percent") discountAmount = Number(source.subtotal_amount || 0) * (Number(coupon.discount_value) / 100);
      if (coupon.discount_type === "fixed_amount") discountAmount = Math.min(Number(source.subtotal_amount || 0), Number(coupon.discount_value));
    }
    const payableAmount = Math.max(0, Number(source.subtotal_amount || 0) - discountAmount);

    const initialOrderStatus = isOnlinePaid ? "payment_submitted" : "pending_payment";
    const initialPaymentStatus = isOnlinePaid ? 'paid' : "unpaid";
    const initialPaymentRecordStatus = isOnlinePaid ? 'paid' : "pending";
    const orderNo = makeBusinessNo("ORD");
    const orderResult = await connection.query(
      `INSERT INTO billing_orders (
         tenant_id, order_no, currency, subtotal_amount, discount_amount, payable_amount,
         paid_amount, order_status, payment_status, payment_method, payment_channel, billing_address,
         coupon_id, coupon_code, coupon_discount_type, coupon_discount_value, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.admin.tenantId,
        orderNo,
        source.currency || "USD",
        Number(source.subtotal_amount || 0),
        discountAmount,
        payableAmount,
        isOnlinePaid ? payableAmount : 0,
        initialOrderStatus,
        initialPaymentStatus,
        paymentMethod,
        paymentChannel || null,
        billingAddress,
        coupon ? Number(coupon.id) : null,
        coupon ? coupon.coupon_code : null,
        coupon ? coupon.discount_type : null,
        coupon ? Number(coupon.discount_value) : null,
        request.admin.id,
      ],
    );
    const orderId = Number(orderResult.insertId);

    for (const item of itemRows) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           description, account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          item.item_type,
          item.plan_id == null ? null : Number(item.plan_id),
          item.addon_id == null ? null : Number(item.addon_id),
          item.coupon_id == null ? null : Number(item.coupon_id),
          item.item_code || null,
          item.item_name,
          item.description || null,
          item.account_quantity == null ? null : Number(item.account_quantity),
          Number(item.quantity || 1),
          Number(item.months || 1),
          item.currency || source.currency || "USD",
          Number(item.unit_price || 0),
          Number(item.discount_amount || 0),
          Number(item.line_amount || 0),
          Number(item.sort_order || 0),
        ],
      );
    }

    if (coupon && discountAmount > 0) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           description, account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, 'discount', NULL, NULL, ?, ?, '优惠折扣', NULL, NULL, 1, 1, ?, 0, ?, ?, 90)`,
        [orderId, request.admin.tenantId, Number(coupon.id), coupon.coupon_code, source.currency || "USD", discountAmount, -discountAmount],
      );
      await connection.query(
        `UPDATE billing_tenant_coupons SET used_at = NOW(), used_order_id = ? WHERE id = ?`,
        [orderId, Number(coupon.tenant_coupon_id)],
      );
      await connection.query(
        `UPDATE billing_coupons SET redeemed_count = redeemed_count + 1 WHERE id = ?`,
        [Number(coupon.id)],
      );
    }

    const offlineAccountId = paymentMethod === "offline" ? await findOfflinePaymentAccountId(connection, request.admin.tenantId) : null;
    await connection.query(
      `INSERT INTO billing_payments (
         order_id, tenant_id, payment_no, payment_method, payment_channel,
         offline_payment_account_id, payment_currency, payment_amount, payment_status,
         paid_at, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        makeBusinessNo("PAY"),
        paymentMethod,
        paymentChannel || null,
        offlineAccountId,
        source.currency || "USD",
        payableAmount,
        initialPaymentRecordStatus,
        isOnlinePaid ? new Date() : null,
        request.admin.id,
      ],
    );

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, to_order_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, request.admin.tenantId, initialOrderStatus, initialPaymentStatus, "repurchase_order", request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({
      message: paymentMethod === "offline" ? "閲嶆柊璐拱璁㈠崟宸蹭繚瀛樸€?" : "閲嶆柊璐拱璁㈠崟宸插缓绔嬨€?",
      order: {
        id: orderId,
        orderNo,
        sourceOrderId,
        currency: source.currency || "USD",
        payableAmount: payableAmount,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "閲嶆柊璐拱璁㈠崟鐢熸垚澶辫触銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/renew", requireAdmin, async (request, response) => {
  const sourceOrderId = Number(request.params.id);
  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) return response.status(400).json({ message: "訂單编号无效。" });

  const payload = request.body || {};
  const requestedPaymentMethod = sanitizeString(payload.paymentMethod, 20);
  const requestedPaymentChannel = sanitizeString(payload.paymentChannel, 80);
  const requestedBillingAddress = sanitizeString(payload.billingAddress, 500);
  const requestedQuantity = Math.max(1, Number(payload.quantity || 1));
  const requestedMonths = Math.max(1, Number(payload.months || 1));
  const requestedRetainedSipUserIds = Array.isArray(payload.retainedSipUserIds)
    ? Array.from(new Set(payload.retainedSipUserIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)))
    : [];
  const formatSqlDate = (value) => {
    if (!value) return null;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const sourceRows = await connection.query(
      `SELECT
         id, order_status, DATE_FORMAT(expires_at, '%Y-%m-%d') AS expires_at, currency, subtotal_amount, discount_amount, payable_amount,
         payment_method, payment_channel, billing_address,
         coupon_id, coupon_code, coupon_discount_type, coupon_discount_value
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [sourceOrderId, request.admin.tenantId],
    );
    const source = sourceRows[0];
    if (!source) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到原訂單。" });
    }
    if (source.order_status !== "review_approved") {
      await connection.rollback();
      return response.status(409).json({ message: "只有已生效或已過期的訂單可以进行訂單续订。" });
    }

    const entitlementRows = await connection.query(
      `SELECT
         e.id,
         e.sip_user_id,
         DATE_FORMAT(e.service_expires_at, '%Y-%m-%d') AS service_expires_at,
         u.username,
         u.sip_domain,
         u.display_name
       FROM tenant_sip_account_entitlements e
       JOIN sip_users u ON u.id = e.sip_user_id
       WHERE e.tenant_id = ?
         AND (e.first_order_id = ? OR e.current_order_id = ? OR e.last_renewal_order_id = ?)
       ORDER BY u.username ASC, e.id ASC
       FOR UPDATE`,
      [request.admin.tenantId, sourceOrderId, sourceOrderId, sourceOrderId],
    );
    if (entitlementRows.length === 0) {
      await connection.rollback();
      return response.status(409).json({ message: "原訂單没有可续订的帳號权益，请聯繫平台管理員处理。" });
    }

    const itemRows = await connection.query(
      `SELECT
         item.item_type, item.plan_id, item.addon_id, item.coupon_id, item.item_code, item.item_name, item.description,
         item.account_quantity, item.quantity, item.months, item.currency, item.unit_price, item.discount_amount,
         item.line_amount, item.sort_order, pa.sync_with_plan_term
       FROM billing_order_items AS item
       LEFT JOIN billing_plan_addons pa ON pa.plan_id = item.plan_id AND pa.addon_id = item.addon_id
       WHERE item.order_id = ? AND item.tenant_id = ?
       ORDER BY item.sort_order ASC, item.id ASC`,
      [sourceOrderId, request.admin.tenantId],
    );
    if (itemRows.length === 0) {
      await connection.rollback();
      return response.status(409).json({ message: "原訂單没有可续订的明细。" });
    }

    const paymentMethod = ["online", "offline"].includes(requestedPaymentMethod) ? requestedPaymentMethod : source.payment_method;
    const paymentChannel = requestedPaymentChannel || (paymentMethod === source.payment_method ? source.payment_channel : paymentMethod === "offline" ? "bank_transfer" : null);
    const billingAddress = requestedBillingAddress || source.billing_address || null;
    const isOnlinePaid = paymentMethod === "online";
    const initialOrderStatus = isOnlinePaid ? "payment_submitted" : "pending_payment";
    const initialPaymentStatus = isOnlinePaid ? 'paid' : "unpaid";
    const initialPaymentRecordStatus = isOnlinePaid ? 'paid' : "pending";
    const orderNo = makeBusinessNo("ORD");
    const renewalBaseExpiresAt = formatSqlDate(source.expires_at);
    console.log("[renew-debug] source.expires_at =", source.expires_at, "renewalBaseExpiresAt =", renewalBaseExpiresAt);
    const sourcePlanItem = itemRows.find((item) => item.item_type === "plan");
    if (!sourcePlanItem) {
      await connection.rollback();
      return response.status(409).json({ message: "原訂單缺少套餐明细，不能续订。" });
    }
    const sourceQuantity = Math.max(1, Number(sourcePlanItem.quantity || 1));
    const sourceAccountCount = Number(sourcePlanItem.account_quantity || entitlementRows.length || 0);
    const accountsPerQuantity = Math.max(1, Math.round(sourceAccountCount / sourceQuantity));
    const requestedAccountCount = accountsPerQuantity * requestedQuantity;
    if (requestedAccountCount > entitlementRows.length) {
      await connection.rollback();
      return response.status(409).json({ message: "当前续订暂不支持增加帳號數量，请使用重新购买或等待增量续订功能。" });
    }
    if (requestedRetainedSipUserIds.length > requestedAccountCount) {
      await connection.rollback();
      return response.status(400).json({ message: `本次续订最多保留 ${requestedAccountCount} 个帳號，请调整保留帳號选择。` });
    }
    const retainedEntitlements = entitlementRows.filter((item) => requestedRetainedSipUserIds.includes(Number(item.sip_user_id)));
    if (retainedEntitlements.length !== requestedRetainedSipUserIds.length) {
      await connection.rollback();
      return response.status(400).json({ message: "保留帳號中包含不属于原訂單的帳號，请刷新后重试。" });
    }

    const renewalItems = [];
    let subtotal = 0;
    itemRows.forEach((item) => {
      if (item.item_type === "discount") return;
      const quantity = requestedQuantity;
      const itemMonths = item.item_type === "plan"
        ? requestedMonths
        : item.sync_with_plan_term == null || Boolean(item.sync_with_plan_term)
          ? requestedMonths
          : Math.max(1, Number(item.months || 1));
      const lineAmount = Number(item.unit_price || 0) * quantity * itemMonths;
      subtotal += lineAmount;
      renewalItems.push({
        ...item,
        quantity,
        months: itemMonths,
        account_quantity: item.item_type === "plan" ? requestedAccountCount : item.account_quantity,
        lineAmount,
      });
    });
    let discountAmount = 0;
    if (source.coupon_discount_type === "percent") {
      discountAmount = subtotal * (Number(source.coupon_discount_value || 0) / 100);
    } else if (source.coupon_discount_type === "fixed_amount") {
      discountAmount = Math.min(subtotal, Number(source.coupon_discount_value || 0));
    }
    if (discountAmount > 0 || source.coupon_id) {
      renewalItems.push({
        item_type: "discount",
        plan_id: null,
        addon_id: null,
        coupon_id: source.coupon_id ? Number(source.coupon_id) : null,
        item_code: source.coupon_code || null,
        item_name: "优惠折扣",
        description: null,
        account_quantity: null,
        quantity: 1,
        months: 1,
        currency: source.currency || "USD",
        unit_price: 0,
        discount_amount: discountAmount,
        lineAmount: -discountAmount,
        sort_order: 90,
      });
    }
    const payableAmount = Math.max(0, subtotal - discountAmount);
    const orderResult = await connection.query(
      `INSERT INTO billing_orders (
         tenant_id, order_no, order_type, renewal_source_order_id, renewal_base_expires_at,
         currency, subtotal_amount, discount_amount, payable_amount,
         paid_amount, order_status, payment_status, payment_method, payment_channel, billing_address,
         coupon_id, coupon_code, coupon_discount_type, coupon_discount_value, created_by_admin_user_id
       )
       VALUES (?, ?, 'renewal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.admin.tenantId,
        orderNo,
        sourceOrderId,
        formatSqlDate(renewalBaseExpiresAt),
        source.currency || "USD",
        subtotal,
        discountAmount,
        payableAmount,
        isOnlinePaid ? payableAmount : 0,
        initialOrderStatus,
        initialPaymentStatus,
        paymentMethod,
        paymentChannel || null,
        billingAddress,
        source.coupon_id ? Number(source.coupon_id) : null,
        source.coupon_code || null,
        source.coupon_discount_type || null,
        source.coupon_discount_value == null ? null : Number(source.coupon_discount_value),
        request.admin.id,
      ],
    );
    const orderId = Number(orderResult.insertId);

    for (const item of renewalItems) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           description, account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          item.item_type,
          item.plan_id == null ? null : Number(item.plan_id),
          item.addon_id == null ? null : Number(item.addon_id),
          item.coupon_id == null ? null : Number(item.coupon_id),
          item.item_code || null,
          item.item_name,
          item.description || null,
          item.account_quantity == null ? null : Number(item.account_quantity),
          Number(item.quantity || 1),
          Number(item.months || 1),
          item.currency || source.currency || "USD",
          Number(item.unit_price || 0),
          Number(item.discount_amount || 0),
          Number(item.lineAmount || item.line_amount || 0),
          Number(item.sort_order || 0),
        ],
      );
    }

    for (const account of retainedEntitlements) {
      await connection.query(
        `INSERT INTO billing_order_renewal_retained_accounts (
           order_id, source_order_id, tenant_id, sip_user_id, entitlement_id,
           username, sip_domain, display_name, source_service_expires_at, created_by_admin_user_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          sourceOrderId,
          request.admin.tenantId,
          Number(account.sip_user_id),
          Number(account.id),
          account.username || null,
          account.sip_domain || null,
          account.display_name || null,
          account.service_expires_at || null,
          request.admin.id,
        ],
      );
    }

    const offlineAccountId = paymentMethod === "offline" ? await findOfflinePaymentAccountId(connection, request.admin.tenantId) : null;
    await connection.query(
      `INSERT INTO billing_payments (
         order_id, tenant_id, payment_no, payment_method, payment_channel,
         offline_payment_account_id, payment_currency, payment_amount, payment_status,
         paid_at, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        makeBusinessNo("PAY"),
        paymentMethod,
        paymentChannel || null,
        offlineAccountId,
        source.currency || "USD",
        payableAmount,
        initialPaymentRecordStatus,
        isOnlinePaid ? new Date() : null,
        request.admin.id,
      ],
    );

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, to_order_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, request.admin.tenantId, initialOrderStatus, initialPaymentStatus, "renewal_order", request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({
      message: paymentMethod === "offline" ? "訂單续订已保存。" : "訂單续订已建立。",
      order: {
        id: orderId,
        orderNo,
        sourceOrderId,
        orderType: "renewal",
        renewalBaseExpiresAt,
        currency: source.currency || "USD",
        payableAmount,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "訂單续订生成失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/payment-proof", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "璁㈠崟缂栧彿鏃犳晥銆?" });

  const payload = request.body || {};
  const actualAmount = Number(payload.actualAmount);
  const paymentDate = sanitizeString(payload.paymentDate, 20);
  const proofImageDataUrl = String(payload.proofImageDataUrl || "");
  const originalFileName = sanitizeString(payload.fileName, 255) || "payment-proof.png";

  if (!Number.isFinite(actualAmount) || actualAmount <= 0) return response.status(400).json({ message: "璇疯緭鍏ユ湁鏁堢殑瀹炰粯閲戦銆?" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return response.status(400).json({ message: "璇烽€夋嫨鏈夋晥鐨勪粯娆炬棩鏈熴€?" });

  const match = proofImageDataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return response.status(400).json({ message: "璇蜂笂浼犳垨绮樿创 PNG銆丣PG銆乄EBP 鏍煎紡鐨勪粯娆惧嚟璇佹埅鍥俱€?" });

  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) return response.status(400).json({ message: "浠樻鍑瘉鍥剧墖澶у皬闇€灏忎簬 8MB銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const orderRows = await connection.query(
      `SELECT id, order_status, payment_status, payment_method, currency, payable_amount
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const order = orderRows[0];
    if (!order) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌鍗曘€?" });
    }
    if (order.payment_method !== "offline") {
      await connection.rollback();
      return response.status(409).json({ message: "鍙湁绾夸笅鏀粯璁㈠崟鍙互涓婁紶浠樻鍑瘉銆?" });
    }
    if (!["pending_payment", "payment_submitted", "pending_review"].includes(order.order_status)) {
      await connection.rollback();
      return response.status(409).json({ message: "褰撳墠璁㈠崟鐘舵€佷笉鑳戒笂浼犱粯娆惧嚟璇併€?" });
    }

    const proofDir = path.resolve("assets/payment-proofs");
    await mkdir(proofDir, { recursive: true });
    const safeName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    const fileName = `${request.admin.tenantId}-${orderId}-${Date.now()}-${safeName.replace(/\.[^.]+$/, "")}.${ext}`;
    const filePath = path.join(proofDir, fileName);
    await writeFile(filePath, buffer);
    const proofUrl = `/payment-proofs/${fileName}`;

    const paymentRows = await connection.query(
      `SELECT id FROM billing_payments
       WHERE order_id = ? AND tenant_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const offlineAccountId = await findOfflinePaymentAccountId(connection, request.admin.tenantId);
    if (paymentRows[0]) {
      await connection.query(
        `UPDATE billing_payments
         SET payment_method = 'offline',
             payment_channel = COALESCE(payment_channel, 'bank_transfer'),
             offline_payment_account_id = ?,
             payment_currency = ?,
             payment_amount = ?,
             payment_status = 'paid',
             paid_at = ?,
             payment_proof_file_url = ?,
             payment_proof_file_name = ?,
             payment_proof_uploaded_at = NOW(),
             updated_by_admin_user_id = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          offlineAccountId,
          order.currency || "USD",
          actualAmount,
          paymentDate,
          proofUrl,
          originalFileName,
          request.admin.id,
          Number(paymentRows[0].id),
          request.admin.tenantId,
        ],
      );
    } else {
      await connection.query(
        `INSERT INTO billing_payments (
           order_id, tenant_id, payment_no, payment_method, payment_channel,
           offline_payment_account_id, payment_currency, payment_amount, payment_status,
           paid_at, payment_proof_file_url, payment_proof_file_name, payment_proof_uploaded_at,
           created_by_admin_user_id
         )
         VALUES (?, ?, ?, 'offline', 'bank_transfer', ?, ?, ?, 'paid', ?, ?, ?, NOW(), ?)`,
        [
          orderId,
          request.admin.tenantId,
          makeBusinessNo("PAY"),
          offlineAccountId,
          order.currency || "USD",
          actualAmount,
          paymentDate,
          proofUrl,
          originalFileName,
          request.admin.id,
        ],
      );
    }

    const nextOrderStatus = order.order_status === "pending_review" ? "pending_review" : "payment_submitted";
    const nextPaymentStatus = 'paid';
    await connection.query(
      `UPDATE billing_orders
       SET order_status = ?,
           payment_status = ?,
           paid_amount = ?,
           updated_by_admin_user_id = ?
       WHERE id = ? AND tenant_id = ?`,
      [nextOrderStatus, nextPaymentStatus, actualAmount, request.admin.id, orderId, request.admin.tenantId],
    );

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, from_order_status, to_order_status,
         from_payment_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        order.order_status,
        nextOrderStatus,
        order.payment_status,
        nextPaymentStatus,
        "upload_payment_proof",
        request.admin.id,
      ],
    );

    await connection.commit();
    return response.json({
      message: "浠樻鍑瘉宸蹭繚瀛橈紝骞跺凡鍏宠仈鍒拌璁㈠崟銆?",
      payment: {
        proofUrl,
        actualAmount,
        paymentDate,
        payableAmount: Number(order.payable_amount || 0),
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "浠樻鍑瘉淇濆瓨澶辫触銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/review-submission", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "璁㈠崟缂栧彿鏃犳晥銆?" });

  const action = sanitizeString(request.body?.action, 20);
  if (!["submit", "revoke"].includes(action)) return response.status(400).json({ message: "鎿嶄綔绫诲瀷鏃犳晥銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, order_status, payment_status
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const order = rows[0];
    if (!order) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌鍗曘€?" });
    }

    let nextOrderStatus = "";
    let reason = "";
    if (action === "submit") {
      if (order.order_status === "review_approved") {
        await connection.rollback();
        return response.status(409).json({ message: "审核通过的訂單不允許再次提交审核。" });
      }
      if (order.payment_status !== 'paid') {
        await connection.rollback();
        return response.status(409).json({ message: "訂單尚未完成支付，請先上传付款凭证或完成支付。" });
      }
      if (!["payment_submitted", "review_rejected"].includes(order.order_status)) {
        await connection.rollback();
        return response.status(409).json({ message: "只有已支付未提交或审核未通过的訂單可以提交审核。" });
      }
      nextOrderStatus = "pending_review";
      reason = order.order_status === "review_rejected" ? "resubmit_review" : "submit_review";
    }
    if (action === "revoke") {
      if (order.order_status !== "pending_review") {
        await connection.rollback();
        return response.status(409).json({ message: "鍙湁宸叉彁浜や笖鏈鏍哥殑璁㈠崟鍙互鎾ら攢鎻愪氦銆?" });
      }
      nextOrderStatus = "payment_submitted";
      reason = "revoke_review";
    }

    await connection.query(
      `UPDATE billing_orders
       SET order_status = ?,
           reviewed_at = NULL, reviewed_by_platform_admin_id = NULL, review_note = NULL,
           updated_by_admin_user_id = ?
       WHERE id = ? AND tenant_id = ?`,
      [nextOrderStatus, request.admin.id, orderId, request.admin.tenantId],
    );
    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, from_order_status, to_order_status,
         from_payment_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        order.order_status,
        nextOrderStatus,
        order.payment_status,
        order.payment_status,
        reason,
        request.admin.id,
      ],
    );

    await connection.commit();

    // Notify platform admins when tenant submits for review
    if (action === "submit") {
      const [tenantName] = await connection.query("SELECT name FROM tenants WHERE id = ?", [request.admin.tenantId]);
      const tn = tenantName ? (tenantName.name || "") : "";
      const dedupeKey = "platform:order:" + orderId + ":pending_review";
      await connection.query(
        "INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, sender_id, dedupe_key, title, body, severity, status) VALUES (?, 'billing_order', ?, 'order_pending_review', 'tenant_admin', ?, ?, ?, ?, 'warning', 'active') ON DUPLICATE KEY UPDATE status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
        [request.admin.tenantId, orderId, request.admin.id, dedupeKey, "訂單待審核", "租户 " + tn + " 的订单 " + (order.order_no || "") + " 已提交审核。"]
      );
      const platformAdmins = await connection.query("SELECT id FROM admin_users WHERE account_type='platform' AND status='active'");
      const [newEvent] = await connection.query("SELECT id FROM notification_events WHERE dedupe_key = ?", [dedupeKey]);
      if (newEvent) {
        for (const pa of platformAdmins) {
          await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [newEvent.id, pa.id]);
        }
      }
    }
    return response.json({ message: action === "submit" ? "璁㈠崟宸叉彁浜ゅ鏍搞€?" : "宸叉挙閿€鎻愪氦銆?" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "璁㈠崟瀹℃牳鎻愪氦鎿嶄綔澶辫触銆?" });
  } finally {
    if (connection) connection.release();
  }
});
app.delete("/api/billing/orders/:id", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "瑷傚柈绶ㄨ櫉鐒℃晥銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, order_status, payment_status
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const order = rows[0];
    if (!order) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌▊鍠€?" });
    }
    if (order.order_status !== "pending_payment" || order.payment_status !== "unpaid") {
      await connection.rollback();
      return response.status(409).json({ message: "鍙湁鏈敮浠樿▊鍠彲浠ュ埅闄ゃ€?" });
    }

    await connection.query(`DELETE FROM billing_orders WHERE id = ? AND tenant_id = ?`, [orderId, request.admin.tenantId]);
    await connection.commit();
    return response.json({ message: "瑷傚柈宸插埅闄ゃ€?" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "鍒櫎瑷傚柈澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/settings", requireAdmin, async (request, response) => {
  const payload = request.body || {};
  const companyName = sanitizeString(payload.companyName, 160);
  const enterpriseEmail = normalizeEmail(payload.enterpriseEmail);
  const contactPerson = sanitizeString(payload.contactPerson, 120);
  const contactPhone = sanitizeString(payload.contactPhone, 40);
  const billingAddress = sanitizeString(payload.billingAddress, 500);
  const postalCode = sanitizeString(payload.postalCode, 20);
  const adminNickname = sanitizeString(payload.adminNickname, 80);
  const adminPhone = sanitizeString(payload.adminPhone, 40);

  if (!companyName) return response.status(400).json({ message: "璜嬭几鍏ュ叕鍙稿悕绋便€?" });
  if (enterpriseEmail && !isValidEmail(enterpriseEmail)) {
    return response.status(400).json({ message: "璜嬭几鍏ユ湁鏁堢殑浼佹キ淇＄銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.query(
      `UPDATE tenants
       SET name = ?, contact_email = ?, enterprise_email = ?, contact_person = ?,
           contact_phone = ?, billing_address = ?, postal_code = ?
       WHERE id = ?`,
      [companyName, enterpriseEmail || null, enterpriseEmail || null, contactPerson || null, contactPhone || null, billingAddress || null, postalCode || null, request.admin.tenantId],
    );

    await connection.query(
      `UPDATE admin_users
       SET nickname = ?, phone_number = ?
       WHERE id = ?`,
      [adminNickname || null, adminPhone || null, request.admin.id],
    );

    await connection.commit();
    return response.json({ message: "绉熸埗瑷畾宸插劜瀛樸€?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶鍎插瓨绉熸埗瑷畾銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/login-email-change/request-code", requireAdmin, async (request, response) => {
  const newEmail = normalizeEmail(request.body.newEmail);
  const oldPassword = String(request.body.oldPassword || "");
  const newPassword = String(request.body.newPassword || "");
  const confirmPassword = String(request.body.confirmPassword || "");

  if (!isValidEmail(newEmail)) return response.status(400).json({ message: "璜嬭几鍏ユ湁鏁堢殑鏂扮櫥鍏ヤ俊绠便€?" });
  if (newPassword !== confirmPassword) return response.status(400).json({ message: "鍏╂杓稿叆鐨勬柊瀵嗙⒓涓嶄竴鑷淬€?" });
  const passwordError = validatePassword(newPassword);
  if (passwordError) return response.status(400).json({ message: passwordError });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const admins = await connection.query(
      `SELECT id, email, password_hash
       FROM admin_users
       WHERE id = ?
       LIMIT 1`,
      [request.admin.id],
    );
    const admin = admins[0];
    if (!admin || !(await verifyPassword(oldPassword, admin.password_hash))) {
      await connection.rollback();
      return response.status(401).json({ message: "鑸婂瘑纰间笉姝ｇ⒑銆?" });
    }

    const existing = await connection.query(
      `SELECT id FROM admin_users WHERE email = ? AND id <> ? LIMIT 1`,
      [newEmail, request.admin.id],
    );
    if (existing.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "姝ょ櫥鍏ヤ俊绠卞凡琚娇鐢ㄣ€?" });
    }

    const recentCodes = await connection.query(
      `SELECT created_at
       FROM admin_email_change_codes
       WHERE admin_user_id = ? AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 5`,
      [request.admin.id],
    );
    if (recentCodes[0] && Date.now() - new Date(recentCodes[0].created_at).getTime() < 60 * 1000) {
      await connection.rollback();
      return response.status(429).json({ message: "璜嬬瓑寰?60 绉掑緦鍐嶅偝閫佹柊鐨勯璀夌⒓銆?" });
    }
    const sentInTenMinutes = recentCodes.filter((code) => Date.now() - new Date(code.created_at).getTime() < 10 * 60 * 1000);
    if (sentInTenMinutes.length >= 5) {
      await connection.rollback();
      return response.status(429).json({ message: "椹楄瓑纰煎偝閫佹鏁搁亷澶氾紝璜嬬◢寰屽啀瑭︺€?" });
    }

    const code = createNumericCode();
    const newPasswordHash = await hashPassword(newPassword);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await connection.query(
      `INSERT INTO admin_email_change_codes (admin_user_id, new_email, new_password_hash, code_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [request.admin.id, newEmail, newPasswordHash, hashToken(code), expiresAt],
    );

    await queueLoginEmailChangeCode(connection, { email: newEmail, code });
    await connection.commit();

    return response.json({ message: "椹楄瓑纰煎凡鍌抽€佽嚦鏂扮殑鐧诲叆淇＄銆?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶鍌抽€侀璀夌⒓銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/login-email-change/confirm", requireAdmin, async (request, response) => {
  const newEmail = normalizeEmail(request.body.newEmail);
  const code = String(request.body.code || "").trim();

  if (!isValidEmail(newEmail) || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ message: "璜嬭几鍏ユ柊淇＄鑸?6 浣嶆暩瀛楅璀夌⒓銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, new_email, new_password_hash, code_hash, expires_at, attempt_count, used_at
       FROM admin_email_change_codes
       WHERE admin_user_id = ? AND new_email = ? AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [request.admin.id, newEmail],
    );
    const change = rows[0];
    if (!change || new Date(change.expires_at).getTime() < Date.now()) {
      await connection.rollback();
      return response.status(400).json({ message: "椹楄瓑纰肩劇鏁堟垨宸查亷鏈熴€?" });
    }
    if (Number(change.attempt_count) >= 5) {
      await connection.rollback();
      return response.status(429).json({ message: "鍢楄│娆℃暩閬庡锛岃珛閲嶆柊鍙栧緱椹楄瓑纰笺€?" });
    }

    if (change.code_hash !== hashToken(code)) {
      await connection.query(
        `UPDATE admin_email_change_codes SET attempt_count = attempt_count + 1 WHERE id = ?`,
        [Number(change.id)],
      );
      await connection.commit();
      return response.status(400).json({ message: "椹楄瓑纰间笉姝ｇ⒑銆?" });
    }

    const existing = await connection.query(
      `SELECT id FROM admin_users WHERE email = ? AND id <> ? LIMIT 1`,
      [newEmail, request.admin.id],
    );
    if (existing.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "姝ょ櫥鍏ヤ俊绠卞凡琚娇鐢ㄣ€?" });
    }

    await connection.query(
      `UPDATE admin_users
       SET email = ?, password_hash = ?, email_verified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newEmail, change.new_password_hash, request.admin.id],
    );
    await connection.query(
      `UPDATE admin_email_change_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [Number(change.id)],
    );
    await connection.query(`DELETE FROM admin_sessions WHERE admin_user_id = ?`, [request.admin.id]);

    await connection.commit();
    return response.json({ message: "鐧诲叆淇＄鑸囧瘑纰煎凡鏇存柊锛岃珛閲嶆柊鐧诲叆銆?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶鏇存柊鐧诲叆淇＄銆?" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/sip-accounts - 获取帳號列表
app.get("/api/admin/sip-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以查看 SIP 帳號。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`
      SELECT 
        u.id, 
        u.username, 
        u.sip_domain AS domain,
        u.display_name AS displayName,
        u.role, 
        u.phone_number AS phone, 
        u.email, 
        u.status, 
        u.created_at,
        c.display_name AS creator_name,
        e.external_username,
        e.external_domain AS externalDomain,
        e.external_password,
        e.realm,
        e.registrar,
        e.outbound_proxy,
        e.protocol,
        t.name AS tenant_name
      FROM sip_users u
      LEFT JOIN sip_external_accounts e ON u.id = e.sip_user_id
      LEFT JOIN admin_users c ON u.created_by_admin_user_id = c.id
      LEFT JOIN tenants t ON u.tenant_id = t.id
      ORDER BY u.created_at DESC
    `);
    
    const accounts = rows.map(r => ({
      id: Number(r.id),
      username: r.username,
      domain: r.domain || '',
      displayName: r.displayName || '',
      role: r.role,
      phone: r.phone,
      email: r.email,
      status: r.status,
      externalUsername: r.external_username || '',
      externalDomain: r.externalDomain,
      externalPassword: r.external_password || '',
      externalRealm: r.realm || '',
      externalRegistrar: r.registrar || '',
      externalOutboundProxy: r.outbound_proxy || '',
      externalProtocol: r.protocol || '',
      createdAt: r.created_at ? new Date(r.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-') : '',
      creatorName: r.creator_name || '-',
      tenantName: r.tenant_name || ''
    }));

    console.log('【后端 DEBUG】GET /api/admin/sip-accounts 从数据库查询到的条数:', accounts.length);
    return response.json({ accounts });
  } catch (error) {
    console.error('Failed to fetch sip accounts:', error);
    return response.status(500).json({ message: '無法读取 SIP 帳號列表' });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/admin/sip-accounts - 保存新登记的帳號
app.post("/api/admin/sip-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行帳號登记。" });
  }
  
  const payload = request.body || {};
  console.log('【后端 DEBUG】POST /api/admin/sip-accounts 接收到的新增参数:', payload);
  const username = String(payload.username || "").trim();
  const displayName = String(payload.displayName || "").trim();
  const domain = String(payload.domain || "").trim();
  const password = String(payload.password || "");
  const role = payload.role === "admin" ? "admin" : "user";
  const status = payload.status || 'active';
  const phone = String(payload.phone || "").trim();
  const email = String(payload.email || "").trim();

  if (!username || !domain || !password) return response.status(400).json({ message: "缺少必填参数。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 取消強制分配：若為平台管理員新增，tenantId 為 null，等待後續再進行分配
    let targetTenantId = request.admin.tenantId || null;

    const existing = await connection.query(`SELECT id FROM sip_users WHERE username = ? AND sip_domain = ? LIMIT 1`, [username, domain]);
    if (existing.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "该用户名已存在。" });
    }

    const passwordHash = await hashPassword(password);

    const userRes = await connection.query(
      `INSERT INTO sip_users (tenant_id, username, sip_domain, display_name, email, phone_number, password_hash, role, status, created_by_admin_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [targetTenantId, username, domain, displayName, email, phone, passwordHash, role, status, request.admin.id]
    );
    
    console.log('【后端 DEBUG】主帳號写入成功，生成的 ID 为:', userRes.insertId);
    if (payload.hasExternal) {
      const extUsername = String(payload.externalUsername || "").trim();
      const extDomain = String(payload.externalDomain || "").trim();
      const extPassword = String(payload.externalPassword || "").trim();
      const realm = String(payload.realm || "").trim() || null;
      const registrar = String(payload.registrar || "").trim() || null;
      const outboundProxy = String(payload.outboundProxy || "").trim() || null;
      const protocol = ["UDP", "TCP", "TLS"].includes(payload.protocol) ? payload.protocol : "UDP";

      await connection.query(
        `INSERT INTO sip_external_accounts (sip_user_id, external_username, external_domain, external_password, realm, registrar, outbound_proxy, protocol)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [Number(userRes.insertId), extUsername, extDomain, extPassword, realm, registrar, outboundProxy, protocol]
      );
    }

    await connection.commit();
    console.log('【后端 DEBUG】新增帳號数据库事务提交完毕！');
    return response.status(201).json({ message: "帳號登记成功" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Failed to save SIP account:", error);
    return response.status(500).json({ message: "帳號儲存失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/admin/sip-accounts/:id - 编辑帳號
app.put("/api/admin/sip-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行帳號登记。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  const payload = request.body || {};
  const displayName = String(payload.displayName || "").trim();
  const password = String(payload.password || "");
  const role = payload.role === "admin" ? "admin" : "user";
  const status = payload.status || 'active';
  const phone = String(payload.phone || "").trim();
  const email = String(payload.email || "").trim();

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(`SELECT id, tenant_id FROM sip_users WHERE id = ? LIMIT 1`, [accountId]);
    const account = rows[0];
    if (!account) {
      await connection.rollback();
      return response.status(404).json({ message: "帳號不存在。" });
    }
    if (account.tenant_id != null) {
      await connection.rollback();
      return response.status(409).json({ message: "已经分配给租戶的帳號不允許编辑。" });
    }

    let updateSql = `UPDATE sip_users SET display_name = ?, email = ?, phone_number = ?, role = ?, status = ?`;
    let updateParams = [displayName, email, phone, role, status];

    if (password) {
      const passwordHash = await hashPassword(password);
      updateSql += `, password_hash = ?`;
      updateParams.push(passwordHash);
    }
    updateSql += ` WHERE id = ?`;
    updateParams.push(accountId);

    await connection.query(updateSql, updateParams);

    if (payload.hasExternal) {
      const extUsername = String(payload.externalUsername || "").trim();
      const extDomain = String(payload.externalDomain || "").trim();
      const extPassword = String(payload.externalPassword || "").trim();
      const realm = String(payload.realm || "").trim() || null;
      const registrar = String(payload.registrar || "").trim() || null;
      const outboundProxy = String(payload.outboundProxy || "").trim() || null;
      const protocol = ["UDP", "TCP", "TLS"].includes(payload.protocol) ? payload.protocol : "UDP";

      const extRows = await connection.query(`SELECT id FROM sip_external_accounts WHERE sip_user_id = ? LIMIT 1`, [accountId]);
      if (extRows.length > 0) {
        let extUpdateSql = `UPDATE sip_external_accounts SET external_username = ?, external_domain = ?, realm = ?, registrar = ?, outbound_proxy = ?, protocol = ?`;
        let extUpdateParams = [extUsername, extDomain, realm, registrar, outboundProxy, protocol];
        if (extPassword) {
          extUpdateSql += `, external_password = ?`;
          extUpdateParams.push(extPassword);
        }
        extUpdateSql += ` WHERE sip_user_id = ?`;
        extUpdateParams.push(accountId);
        await connection.query(extUpdateSql, extUpdateParams);
      } else {
        await connection.query(
          `INSERT INTO sip_external_accounts (sip_user_id, external_username, external_domain, external_password, realm, registrar, outbound_proxy, protocol)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [accountId, extUsername, extDomain, extPassword, realm, registrar, outboundProxy, protocol]
        );
      }
    } else {
      await connection.query(`DELETE FROM sip_external_accounts WHERE sip_user_id = ?`, [accountId]);
    }

    await connection.commit();
    return response.json({ message: "帳號更新成功" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Failed to update SIP account:", error);
    return response.status(500).json({ message: "帳號更新失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/admin/sip-accounts/:id/unassign - 取消分配
app.post("/api/admin/sip-accounts/:id/unassign", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行帳號操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    
    const rows = await connection.query(`SELECT id FROM sip_users WHERE id = ? LIMIT 1`, [accountId]);
    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    await connection.query(`UPDATE sip_users SET tenant_id = NULL WHERE id = ?`, [accountId]);
    return response.json({ message: "帳號已成功取消分配。" });
  } catch (error) {
    console.error("Failed to unassign SIP account:", error);
    return response.status(500).json({ message: "取消分配失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/admin/sip-accounts/:id/reset-password - 重置密碼
app.put("/api/admin/sip-accounts/:id/reset-password", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行帳號操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  const password = String(request.body?.password || "");
  if (password.length < 6) {
    return response.status(400).json({ message: "密碼至少需要 6 个字符。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`SELECT id FROM sip_users WHERE id = ? LIMIT 1`, [accountId]);
    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    const passwordHash = await hashPassword(password);
    await connection.query(`UPDATE sip_users SET password_hash = ? WHERE id = ?`, [passwordHash, accountId]);
    return response.json({ message: "密碼重置成功。" });
  } catch (error) {
    console.error("Failed to reset SIP account password:", error);
    return response.status(500).json({ message: "密碼重設失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/admin/sip-accounts/:id - 删除帳號
app.delete("/api/admin/sip-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以删除帳號。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(`SELECT id, tenant_id FROM sip_users WHERE id = ? LIMIT 1`, [accountId]);
    const account = rows[0];
    if (!account) {
      await connection.rollback();
      return response.status(404).json({ message: "帳號不存在。" });
    }
    if (account.tenant_id != null) {
      await connection.rollback();
      return response.status(409).json({ message: "已经分配给租戶的帳號不允許删除。" });
    }

    await connection.query(`DELETE FROM sip_external_accounts WHERE sip_user_id = ?`, [accountId]);
    await connection.query(`DELETE FROM sip_users WHERE id = ?`, [accountId]);

    await connection.commit();
    return response.json({ message: "帳號已成功删除。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete SIP account:", error);
    return response.status(500).json({ message: "删除帳號失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/web-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以查看 Web 帳號。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`
      SELECT
        u.id,
        u.username,
        u.sip_domain AS domain,
        u.display_name AS displayName,
        u.role,
        u.phone_number AS phone,
        u.email,
        u.status,
        u.created_at,
        c.display_name AS creator_name,
        t.name AS tenant_name
      FROM web_users u
      LEFT JOIN admin_users c ON u.created_by_admin_user_id = c.id
      LEFT JOIN tenants t ON u.tenant_id = t.id
      ORDER BY u.created_at DESC
    `);

    const accounts = rows.map((row) => ({
      id: Number(row.id),
      username: row.username || "",
      domain: row.domain || "",
      displayName: row.displayName || "",
      role: row.role || "user",
      phone: row.phone || "",
      email: row.email || "",
      status: row.status || 'active',
      createdAt: row.created_at ? new Date(row.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-") : "",
      creatorName: row.creator_name || "-",
      tenantName: row.tenant_name || "",
    }));

    return response.json({ accounts });
  } catch (error) {
    console.error("Failed to fetch Web accounts:", error);
    return response.status(500).json({ message: "無法读取 Web 帳號列表" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/web-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行 Web 帳號登记。" });
  }

  const payload = request.body || {};
  const username = sanitizeString(payload.username, 120);
  const domain = sanitizeString(payload.domain || webrtcDomain, 255);
  const displayName = sanitizeString(payload.displayName, 120);
  const password = String(payload.password || "");
  const role = payload.role === "admin" ? "admin" : "user";
  const status = ['active', "inactive", 'disabled', "pending"].includes(payload.status) ? payload.status : 'active';
  const phone = sanitizeString(payload.phone, 40);
  const email = sanitizeString(payload.email, 255);

  if (!username || !domain || !password) return response.status(400).json({ message: "缺少必填参数。" });
  if (password.length < 6) return response.status(400).json({ message: "密碼至少需要 6 个字符。" });
  if (email && !isValidEmail(email)) return response.status(400).json({ message: "請輸入有效的电子郵箱。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const existing = await connection.query(`SELECT id FROM web_users WHERE username = ? AND sip_domain = ? LIMIT 1`, [username, domain]);
    if (existing.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "该用户名已存在。" });
    }

    const passwordHash = await hashPassword(password);
    await connection.query(
      `INSERT INTO web_users (
         tenant_id, username, sip_domain, display_name, email, phone_number,
         password_hash, role, status, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.admin.tenantId || null, username, domain, displayName || null, email, phone || null, passwordHash, role, status, request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({ message: "Web 帳號登记成功" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to save Web account:", error);
    return response.status(500).json({ message: "Web 帳號儲存失敗" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/web-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行 Web 帳號登记。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  const payload = request.body || {};
  const domain = sanitizeString(payload.domain || webrtcDomain, 255);
  const displayName = sanitizeString(payload.displayName, 120);
  const password = String(payload.password || "");
  const role = payload.role === "admin" ? "admin" : "user";
  const status = ['active', "inactive", 'disabled', "pending"].includes(payload.status) ? payload.status : 'active';
  const phone = sanitizeString(payload.phone, 40);
  const email = sanitizeString(payload.email, 255);

  if (password && password.length < 6) return response.status(400).json({ message: "密碼至少需要 6 个字符。" });
  if (email && !isValidEmail(email)) return response.status(400).json({ message: "請輸入有效的电子郵箱。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(`SELECT id, tenant_id FROM web_users WHERE id = ? LIMIT 1`, [accountId]);
    const account = rows[0];
    if (!account) {
      await connection.rollback();
      return response.status(404).json({ message: "帳號不存在。" });
    }
    if (account.tenant_id != null) {
      await connection.rollback();
      return response.status(409).json({ message: "已经分配给租戶的帳號不允許编辑。" });
    }
    const duplicateRows = await connection.query(
      `SELECT id FROM web_users WHERE username = (SELECT username FROM web_users WHERE id = ?) AND sip_domain = ? AND id <> ? LIMIT 1`,
      [accountId, domain, accountId],
    );
    if (duplicateRows.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "该域名下用户名已存在。" });
    }

    let updateSql = `UPDATE web_users SET sip_domain = ?, display_name = ?, email = ?, phone_number = ?, role = ?, status = ?`;
    const updateParams = [domain, displayName || null, email, phone || null, role, status];

    if (password) {
      const passwordHash = await hashPassword(password);
      updateSql += `, password_hash = ?`;
      updateParams.push(passwordHash);
    }
    updateSql += ` WHERE id = ?`;
    updateParams.push(accountId);

    await connection.query(updateSql, updateParams);
    await connection.commit();
    return response.json({ message: "Web 帳號更新成功" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update Web account:", error);
    return response.status(500).json({ message: "Web 帳號更新失敗" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/web-accounts/:id/unassign", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行帳號操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`SELECT id FROM web_users WHERE id = ? LIMIT 1`, [accountId]);
    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    await connection.query(`UPDATE web_users SET tenant_id = NULL WHERE id = ?`, [accountId]);
    return response.json({ message: "Web 帳號已成功取消分配。" });
  } catch (error) {
    console.error("Failed to unassign Web account:", error);
    return response.status(500).json({ message: "取消分配失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/web-accounts/:id/reset-password", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行帳號操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  const password = String(request.body?.password || "");
  if (password.length < 6) {
    return response.status(400).json({ message: "密碼至少需要 6 个字符。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`SELECT id FROM web_users WHERE id = ? LIMIT 1`, [accountId]);
    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    const passwordHash = await hashPassword(password);
    await connection.query(`UPDATE web_users SET password_hash = ? WHERE id = ?`, [passwordHash, accountId]);
    return response.json({ message: "密碼重置成功。" });
  } catch (error) {
    console.error("Failed to reset Web account password:", error);
    return response.status(500).json({ message: "密碼重設失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/admin/web-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以删除帳號。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(`SELECT id, tenant_id FROM web_users WHERE id = ? LIMIT 1`, [accountId]);
    const account = rows[0];
    if (!account) {
      await connection.rollback();
      return response.status(404).json({ message: "帳號不存在。" });
    }
    if (account.tenant_id != null) {
      await connection.rollback();
      return response.status(409).json({ message: "已经分配给租戶的帳號不允許删除。" });
    }

    await connection.query(`DELETE FROM web_users WHERE id = ?`, [accountId]);

    await connection.commit();
    return response.json({ message: "Web 帳號已成功删除。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete Web account:", error);
    return response.status(500).json({ message: "删除帳號失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/gate-devices", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以查看設備。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`
      SELECT
        d.id,
        d.device_uuid,
        d.relay_id,
        d.subscribe_topic,
        d.publish_topic,
        d.wifi_name,
        d.wifi_password,
        d.tenant_id,
        d.assignment_status,
        d.assigned_at,
        d.expires_at,
        d.created_at,
        c.display_name AS creator_name,
        a.display_name AS assigned_by_name,
        t.name AS tenant_name
      FROM gate_devices d
      LEFT JOIN admin_users c ON d.created_by_admin_user_id = c.id
      LEFT JOIN admin_users a ON d.assigned_by_admin_user_id = a.id
      LEFT JOIN tenants t ON d.tenant_id = t.id
      ORDER BY d.created_at DESC, d.id DESC
    `);

    return response.json({
      devices: rows.map((row) => ({
        id: Number(row.id),
        uuid: row.device_uuid || "",
        relayId: row.relay_id || "",
        subscribeTopic: row.subscribe_topic || "",
        publishTopic: row.publish_topic || "",
        wifiName: row.wifi_name || "",
        wifiPassword: row.wifi_password || "",
        status: row.assignment_status || "unassigned",
        tenantId: row.tenant_id ? Number(row.tenant_id) : null,
        tenantName: row.tenant_name || "",
        assignedByName: row.assigned_by_name || "",
        assignedAt: row.assigned_at ? new Date(row.assigned_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-") : "",
        expiresAt: row.expires_at ? new Date(row.expires_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-") : "",
        createdAt: row.created_at ? new Date(row.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-") : "",
        creatorName: row.creator_name || "-",
      })),
    });
  } catch (error) {
    console.error("Failed to fetch gate devices:", error);
    return response.status(500).json({ message: "無法读取設備列表。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/gate-devices", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以添加設備。" });
  }

  const payload = request.body || {};
  const uuid = sanitizeString(payload.uuid || generateGateDeviceUuid(), 120);
  const relayId = sanitizeString(payload.relayId, 120);
  const subscribeTopic = sanitizeString(payload.subscribeTopic, 255);
  const publishTopic = sanitizeString(payload.publishTopic, 255);
  const wifiName = sanitizeString(payload.wifiName, 120);
  const wifiPassword = sanitizeString(payload.wifiPassword, 255);
  const notes = sanitizeString(payload.notes, 1000);

  if (!subscribeTopic || !publishTopic) {
    return response.status(400).json({ message: "請填寫订阅主题和发布主题。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let deviceUuid = uuid;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const existing = await connection.query(`SELECT id FROM gate_devices WHERE device_uuid = ? LIMIT 1`, [deviceUuid]);
      if (existing.length === 0) break;
      if (payload.uuid) {
        await connection.rollback();
        return response.status(409).json({ message: "该設備 UUID 已存在。" });
      }
      deviceUuid = generateGateDeviceUuid();
    }

    const result = await connection.query(
      `INSERT INTO gate_devices (
         device_uuid, relay_id, subscribe_topic, publish_topic,
         wifi_name, wifi_password, assignment_status, created_by_admin_user_id, notes
       )
       VALUES (?, ?, ?, ?, ?, ?, 'unassigned', ?, ?)`,
      [deviceUuid, relayId || null, subscribeTopic, publishTopic, wifiName || null, wifiPassword || null, request.admin.id, notes || null],
    );
    await connection.query(
      `INSERT INTO gate_device_assignment_history (
         gate_device_id, tenant_id, from_status, to_status, changed_by_admin_user_id, change_reason
       )
       VALUES (?, NULL, NULL, 'unassigned', ?, 'device_created')`,
      [Number(result.insertId), request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({ message: "設備已新增。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to save gate device:", error);
    return response.status(500).json({ message: "設備儲存失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/gate-devices/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以维护設備。" });
  }

  const deviceId = Number(request.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return response.status(400).json({ message: "無效的設備 ID。" });
  }

  const payload = request.body || {};
  const relayId = sanitizeString(payload.relayId, 120);
  const subscribeTopic = sanitizeString(payload.subscribeTopic, 255);
  const publishTopic = sanitizeString(payload.publishTopic, 255);
  const wifiName = sanitizeString(payload.wifiName, 120);
  const wifiPassword = sanitizeString(payload.wifiPassword, 255);
  const notes = sanitizeString(payload.notes, 1000);

  if (!subscribeTopic || !publishTopic) {
    return response.status(400).json({ message: "請填寫订阅主题和发布主题。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`SELECT id FROM gate_devices WHERE id = ? LIMIT 1`, [deviceId]);
    if (rows.length === 0) return response.status(404).json({ message: "設備不存在。" });

    await connection.query(
      `UPDATE gate_devices
       SET relay_id = ?, subscribe_topic = ?, publish_topic = ?,
           wifi_name = ?, wifi_password = ?, notes = ?
       WHERE id = ?`,
      [relayId || null, subscribeTopic, publishTopic, wifiName || null, wifiPassword || null, notes || null, deviceId],
    );
    return response.json({ message: "設備已更新。" });
  } catch (error) {
    console.error("Failed to update gate device:", error);
    return response.status(500).json({ message: "設備更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/admin/gate-devices/:id/assign - 將設備分配給租戶
app.post("/api/admin/gate-devices/:id/assign", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行設備操作。" });
  }

  const deviceId = Number(request.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return response.status(400).json({ message: "無效的設備 ID。" });
  }

  const tenantId = Number(request.body.tenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return response.status(400).json({ message: "請選擇要分配的租戶。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [device] = await connection.query(
      "SELECT id, tenant_id, assignment_status FROM gate_devices WHERE id = ? LIMIT 1 FOR UPDATE",
      [deviceId]
    );
    if (!device) {
      await connection.rollback();
      return response.status(404).json({ message: "設備不存在。" });
    }
    if (device.assignment_status === 'disabled') {
      await connection.rollback();
      return response.status(400).json({ message: "已停用的設備無法分配。" });
    }
    if (device.assignment_status === "assigned" && Number(device.tenant_id) === tenantId) {
      await connection.rollback();
      return response.json({ message: "設備已分配给该租戶。" });
    }

    // 检查租戶是否存在且有有效 SIP 帳號
    const [tenant] = await connection.query(
      "SELECT id FROM tenants WHERE id = ?", [tenantId]
    );
    if (!tenant) {
      await connection.rollback();
      return response.status(404).json({ message: "租戶不存在。" });
    }

    // 获取租戶當前生效套餐的截止日期作为設備有效期
    const [planExpiry] = await connection.query(
      `SELECT MAX(expires_at) AS latest_expiry
       FROM billing_orders
       WHERE tenant_id = ? AND expires_at IS NOT NULL AND expires_at > NOW()`,
      [tenantId]
    );

    const expiresAt = planExpiry?.latest_expiry || null;

    const prevTenantId = device.tenant_id;
    const prevStatus = device.assignment_status;

    await connection.query(
      `UPDATE gate_devices
       SET tenant_id = ?,
           assignment_status = 'assigned',
           assigned_at = NOW(),
           assigned_by_admin_user_id = ?,
           expires_at = ?
       WHERE id = ?`,
      [tenantId, request.admin.id, expiresAt, deviceId]
    );

    await connection.query(
      `INSERT INTO gate_device_assignment_history (
         gate_device_id, tenant_id, from_status, to_status, expires_at, changed_by_admin_user_id, change_reason
       )
       VALUES (?, ?, ?, 'assigned', ?, ?, 'assign')`,
      [deviceId, tenantId, prevStatus, expiresAt, request.admin.id]
    );

    await connection.commit();
    return response.json({
      message: "設備已分配。",
      data: { id: deviceId, tenantId, expiresAt }
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to assign gate device:", error);
    return response.status(500).json({ message: "分配設備失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/gate-devices/:id/unassign", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以进行設備操作。" });
  }

  const deviceId = Number(request.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return response.status(400).json({ message: "無效的設備 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const rows = await connection.query(`SELECT id, tenant_id, assignment_status FROM gate_devices WHERE id = ? LIMIT 1 FOR UPDATE`, [deviceId]);
    const device = rows[0];
    if (!device) {
      await connection.rollback();
      return response.status(404).json({ message: "設備不存在。" });
    }
    if (device.assignment_status !== "assigned" || device.tenant_id == null) {
      await connection.rollback();
      return response.status(409).json({ message: "该設備尚未分配给租戶。" });
    }
    await connection.query(
      `UPDATE gate_devices
       SET tenant_id = NULL,
           assignment_status = 'unassigned',
           assigned_at = NULL,
           assigned_by_admin_user_id = NULL,
           expires_at = NULL
       WHERE id = ?`,
      [deviceId],
    );
    await connection.query(
      `INSERT INTO gate_device_assignment_history (
         gate_device_id, tenant_id, from_status, to_status, changed_by_admin_user_id, change_reason
       )
       VALUES (?, ?, ?, 'unassigned', ?, 'unassign')`,
      [deviceId, Number(device.tenant_id), device.assignment_status, request.admin.id],
    );
    await connection.commit();
    return response.json({ message: "設備已取消分配。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to unassign gate device:", error);
    return response.status(500).json({ message: "取消分配失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/admin/gate-devices/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以删除設備。" });
  }

  const deviceId = Number(request.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return response.status(400).json({ message: "無效的設備 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const rows = await connection.query(`SELECT id, tenant_id FROM gate_devices WHERE id = ? LIMIT 1`, [deviceId]);
    const device = rows[0];
    if (!device) {
      await connection.rollback();
      return response.status(404).json({ message: "設備不存在。" });
    }
    if (device.tenant_id != null) {
      await connection.rollback();
      return response.status(409).json({ message: "已经分配给租戶的設備不允許删除。" });
    }
    await connection.query(`DELETE FROM gate_devices WHERE id = ?`, [deviceId]);
    await connection.commit();
    return response.json({ message: "設備已刪除。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete gate device:", error);
    return response.status(500).json({ message: "設備刪除失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/billing-orders - 平台管理員获取所有訂單列表
app.get("/api/admin/billing-orders", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以查看所有訂單。" });
  }

  const page = Math.max(1, Number.parseInt(request.query.page || "1", 10));
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(request.query.pageSize || "10", 10)));
  const offset = (page - 1) * pageSize;
  const statusFilter = sanitizeString(request.query.status || "all", 40);
  const keyword = sanitizeString(request.query.q, 120);

  const whereClauses = [];
  const params = [];

  if (statusFilter !== "all") {
    // Map UI filters to DB order_status and payment_status
    if (statusFilter === 'active_effective') {
      whereClauses.push(`o.order_status = 'review_approved' AND o.effective_at <= CURDATE() AND o.expires_at >= CURDATE()`);
    } else if (statusFilter === 'inactive_expired') {
      whereClauses.push(`o.order_status = 'review_approved' AND o.expires_at < CURDATE()`);
      } else if (statusFilter === 'expiring_soon') {
        whereClauses.push(`o.order_status = 'review_approved' AND o.expires_at >= CURDATE() AND o.expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`);
    } else if (statusFilter === 'pending_review') {
      whereClauses.push(`o.order_status = 'pending_review'`);
      } else if (statusFilter === 'paid') {
        whereClauses.push(`p.paid_at IS NOT NULL`);
      } else if (statusFilter === 'unpaid') {
        whereClauses.push(`p.paid_at IS NULL`);
      } else if (statusFilter === 'reviewed') {
        whereClauses.push(`(o.order_status = 'review_approved' OR o.order_status = 'review_rejected')`);
    }
  }

  if (keyword) {
    const pattern = `%${keyword}%`;
    whereClauses.push(`(
      o.order_no LIKE ? OR
      t.name LIKE ? OR
      t.tenant_number LIKE ? OR
      plan.item_name LIKE ?
    )`);
    params.push(pattern, pattern, pattern, pattern);
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

  let connection;
  try {
    connection = await pool.getConnection();

    const countRows = await connection.query(`
      SELECT COUNT(DISTINCT o.id) AS total
      FROM billing_orders o
      LEFT JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN billing_order_items plan ON plan.order_id = o.id AND plan.item_type = 'plan'
      LEFT JOIN billing_payments p ON p.order_id = o.id
      ${whereSql}
    `, params);
    const totalItems = Number(countRows[0]?.total || 0);

    const statsQuery = `
      SELECT
        COUNT(DISTINCT o.id) AS total,
        COUNT(DISTINCT CASE WHEN o.order_status = 'review_approved' OR o.order_status = 'review_rejected' THEN o.id END) AS reviewed,
        COUNT(DISTINCT CASE WHEN o.order_status = 'pending_review' THEN o.id END) AS pending_review,
        COUNT(DISTINCT CASE WHEN o.order_status = 'review_approved' AND o.effective_at <= CURDATE() AND o.expires_at >= CURDATE() THEN o.id END) AS active,
        COUNT(DISTINCT CASE WHEN p.paid_at IS NOT NULL THEN o.id END) AS paid,
        COUNT(DISTINCT CASE WHEN p.paid_at IS NULL THEN o.id END) AS unpaid,
        COUNT(DISTINCT CASE WHEN o.order_status = 'review_approved' AND o.expires_at < CURDATE() THEN o.id END) AS expired,
        COUNT(DISTINCT CASE WHEN o.order_status = 'review_approved' AND o.expires_at >= CURDATE() AND o.expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN o.id END) AS expiring_soon
      FROM billing_orders o
      LEFT JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN billing_order_items plan ON plan.order_id = o.id AND plan.item_type = 'plan'
      LEFT JOIN billing_payments p ON p.order_id = o.id
      ${keyword ? `WHERE (o.order_no LIKE ? OR t.name LIKE ? OR t.tenant_number LIKE ? OR plan.item_name LIKE ?)` : ""}
    `;
    const statsRows = await connection.query(statsQuery, params);
    const stats = {
      total: Number(statsRows[0]?.total || 0),
      reviewed: Number(statsRows[0]?.reviewed || 0),
      pendingReview: Number(statsRows[0]?.pending_review || 0),
      active: Number(statsRows[0]?.active || 0),
      paid: Number(statsRows[0]?.paid || 0),
      unpaid: Number(statsRows[0]?.unpaid || 0),
      expired: Number(statsRows[0]?.expired || 0),
      expiringSoon: Number(statsRows[0]?.expiring_soon || 0)
    };

    const rows = await connection.query(`
      SELECT
        o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
        o.currency, o.payable_amount, o.order_status, o.payment_status,
        o.payment_method, o.payment_channel,
        DATE_FORMAT(o.effective_at, '%Y-%m-%d') AS effective_at,
        DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at,
        o.created_at, o.reviewed_at, o.reviewed_by_platform_admin_id, o.review_note,
        reviewer.display_name AS reviewer_name, reviewer.email AS reviewer_email,
        t.id AS tenant_id, t.tenant_number, t.name AS tenant_name,
        plan.item_name AS plan_name, plan.account_quantity, plan.months,
        GROUP_CONCAT(DISTINCT addon.item_name ORDER BY addon.sort_order SEPARATOR ', ') AS addon_names,
        MAX(p.payment_proof_uploaded_at) AS payment_proof_uploaded_at,
        MAX(p.payment_proof_file_url) AS payment_proof_file_url
      FROM billing_orders o
      LEFT JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN billing_order_items plan ON plan.order_id = o.id AND plan.item_type = 'plan'
      LEFT JOIN billing_order_items addon ON addon.order_id = o.id AND addon.item_type = 'addon'
      LEFT JOIN billing_payments p ON p.order_id = o.id
      LEFT JOIN admin_users reviewer ON reviewer.id = o.reviewed_by_platform_admin_id
      ${whereSql}
      GROUP BY
        o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
        o.currency, o.payable_amount, o.order_status, o.payment_status,
        o.payment_method, o.payment_channel, o.effective_at, o.expires_at, o.created_at,
        o.reviewed_at, o.reviewed_by_platform_admin_id, o.review_note,
        reviewer.display_name, reviewer.email,
        t.id, t.tenant_number, t.name,
        plan.item_name, plan.account_quantity, plan.months
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);

    return response.json({
      stats,
      orders: rows.map(r => ({
        id: Number(r.id),
        order_no: r.order_no,
        order_type: r.order_type || "new_purchase",
        orderType: r.order_type || "new_purchase",
        renewal_source_order_id: r.renewal_source_order_id == null ? null : Number(r.renewal_source_order_id),
        renewalSourceOrderId: r.renewal_source_order_id == null ? null : Number(r.renewal_source_order_id),
        renewal_base_expires_at: r.renewal_base_expires_at ? String(r.renewal_base_expires_at).slice(0, 10) : "",
        renewalBaseExpiresAt: r.renewal_base_expires_at ? String(r.renewal_base_expires_at).slice(0, 10) : "",
        currency: r.currency,
        payable_amount: Number(r.payable_amount || 0),
        order_status: r.order_status,
        payment_status: r.payment_status,
        payment_method: r.payment_method,
        payment_channel: r.payment_channel,
        effective_at: r.effective_at,
        expires_at: r.expires_at,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at,
        reviewed_by_platform_admin_id: r.reviewed_by_platform_admin_id != null ? Number(r.reviewed_by_platform_admin_id) : null,
        reviewer_name: r.reviewer_name || r.reviewer_email || '',
        review_note: r.review_note,
        tenant_id: Number(r.tenant_id),
        tenantId: Number(r.tenant_id),
        tenant_number: r.tenant_number,
        tenant_name: r.tenant_name,
        plan_name: r.plan_name,
        account_quantity: Number(r.account_quantity || 0),
        accountQuantity: Number(r.account_quantity || 0),
        months: Number(r.months || 0),
        addon_names: r.addon_names,
        payment_proof_uploaded_at: r.payment_proof_uploaded_at,
        payment_proof_file_url: r.payment_proof_file_url,
        payableAmount: Number(r.payable_amount || 0),
      })),
      pagination: { total: totalItems, page, pageSize }
    });
  } catch (error) {
    console.error("Failed to fetch all billing orders:", error);
    return response.status(500).json({ message: "無法读取所有訂單列表。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/billing-orders/:id/review", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以审核訂單。" });
  }

  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "訂單编号无效。" });

  const status = sanitizeString(request.body?.status, 40);
  const reviewNote = sanitizeString(request.body?.comments ?? request.body?.reviewNote, 500);
  const sipAccountIds = Array.isArray(request.body?.sipAccountIds)
    ? request.body.sipAccountIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  if (!["review_approved", "review_rejected"].includes(status)) {
    return response.status(400).json({ message: "审核结果无效。" });
  }
  if (status === "review_rejected" && !reviewNote) {
    return response.status(400).json({ message: "审核不通过时必须填写审核意见。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT
         o.id, o.tenant_id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
         o.order_status, o.payment_status,
         plan.months, plan.account_quantity
       FROM billing_orders o
       LEFT JOIN billing_order_items plan ON plan.order_id = o.id AND plan.item_type = 'plan'
       WHERE o.id = ?
       LIMIT 1
       FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到訂單。" });
    }
    if (order.order_status === "review_approved") {
      await connection.rollback();
      return response.status(409).json({ message: "审核通过的訂單不允許重复审核。" });
    }
    if (!["pending_review", "review_rejected"].includes(order.order_status)) {
      await connection.rollback();
      return response.status(409).json({ message: "只有待审核或审核未通过的訂單可以提交审核结果。" });
    }
    if (order.payment_status !== 'paid') {
      await connection.rollback();
      return response.status(409).json({ message: "訂單尚未完成支付，不能审核通过。" });
    }

    const months = Math.max(1, Number(order.months || 1));
    const requiredAccountCount = Number(order.account_quantity || 0);
    const uniqueSipAccountIds = Array.from(new Set(sipAccountIds));
    const isRenewalOrder = order.order_type === "renewal";
    const renewalSourceOrderId = Number(order.renewal_source_order_id || 0);
    const addonRows = await connection.query(
      `SELECT id
       FROM billing_order_items
       WHERE order_id = ?
         AND item_type = 'addon'
       LIMIT 1`,
      [orderId],
    );
    const requiresWebAccounts = addonRows.length > 0;
    let allRenewalEntitlements = [];
    let renewalEntitlements = [];
    let renewalReplacementAccounts = [];
    let renewalStartDate = "";
    let renewalExpiresDate = "";

    const dateOnly = (value) => {
      if (!value) return "";
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toISOString().slice(0, 10);
    };
    const addDays = (value, days) => {
      const date = new Date(`${dateOnly(value)}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const addMonthsMinusOneDay = (value, monthCount) => {
      const date = new Date(`${dateOnly(value)}T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + monthCount);
      date.setUTCDate(date.getUTCDate() - 1);
      return date.toISOString().slice(0, 10);
    };
    const todayDate = () => new Date().toISOString().slice(0, 10);
    const releaseWebAccountsForSip = async (sipUserIds, serviceExpiresAt) => {
      const ids = Array.from(new Set((sipUserIds || []).map((id) => Number(id)).filter((id) => id > 0)));
      if (!ids.length) return;
      const rows = await connection.query(
        `SELECT id, web_user_id
         FROM tenant_web_account_entitlements
         WHERE tenant_id = ?
           AND sip_user_id IN (${ids.map(() => "?").join(",")})
           AND status = 'active'
         FOR UPDATE`,
        [Number(order.tenant_id), ...ids],
      );
      const entitlementIds = rows.map((row) => Number(row.id)).filter((id) => id > 0);
      const webUserIds = rows.map((row) => Number(row.web_user_id)).filter((id) => id > 0);
      if (webUserIds.length > 0) {
        await connection.query(
          `UPDATE web_users
           SET tenant_id = NULL,
               status = 'active',
               service_expires_at = NULL
           WHERE tenant_id = ?
             AND id IN (${webUserIds.map(() => "?").join(",")})`,
          [Number(order.tenant_id), ...webUserIds],
        );
      }
      if (entitlementIds.length > 0) {
        await connection.query(
          `UPDATE tenant_web_account_entitlements
           SET status = 'revoked',
               current_order_id = NULL,
               service_expires_at = ?,
               renewed_at = NOW(),
               renewed_by_admin_user_id = ?
           WHERE id IN (${entitlementIds.map(() => "?").join(",")})`,
          [serviceExpiresAt, request.admin.id, ...entitlementIds],
        );
      }
    };
    const allocateWebAccountsForSip = async (sipUserIds, serviceStartsAt, serviceExpiresAt, reuseExisting) => {
      if (!requiresWebAccounts) return;
      const finalSipUserIds = Array.from(new Set((sipUserIds || []).map((id) => Number(id)).filter((id) => id > 0)));
      if (finalSipUserIds.length !== requiredAccountCount) {
        const error = new Error("SIP 帳號分配數量异常，不能继续分配 WebRTC 帳號。");
        error.httpStatus = 409;
        error.exposeMessage = true;
        throw error;
      }

      const assignments = [];
      const assignedSipIdSet = new Set();
      if (reuseExisting && finalSipUserIds.length > 0) {
        const reusableRows = await connection.query(
          `SELECT
             e.id AS entitlement_id,
             e.web_user_id,
             e.sip_user_id
           FROM tenant_web_account_entitlements e
           JOIN web_users u ON u.id = e.web_user_id
           WHERE e.tenant_id = ?
             AND e.sip_user_id IN (${finalSipUserIds.map(() => "?").join(",")})
             AND e.status = 'active'
           ORDER BY e.id ASC
           FOR UPDATE`,
          [Number(order.tenant_id), ...finalSipUserIds],
        );
        for (const row of reusableRows) {
          const sipUserId = Number(row.sip_user_id);
          if (assignedSipIdSet.has(sipUserId)) continue;
          assignedSipIdSet.add(sipUserId);
          assignments.push({
            sipUserId,
            webUserId: Number(row.web_user_id),
            entitlementId: Number(row.entitlement_id),
            reused: true,
          });
        }
      }

      const sipIdsNeedingWeb = finalSipUserIds.filter((id) => !assignedSipIdSet.has(id));
      if (sipIdsNeedingWeb.length > 0) {
        const webRows = await connection.query(
          `SELECT id
           FROM web_users
           WHERE tenant_id IS NULL
             AND status = 'active'
           ORDER BY RAND()
           LIMIT ${sipIdsNeedingWeb.length}
           FOR UPDATE`,
        );
        if (webRows.length !== sipIdsNeedingWeb.length) {
          const error = new Error(`未分配 WebRTC 帳號不足，还需要 ${sipIdsNeedingWeb.length} 个帳號用于訂單增值服务。`);
          error.httpStatus = 409;
          error.exposeMessage = true;
          throw error;
        }
        sipIdsNeedingWeb.forEach((sipUserId, index) => {
          assignments.push({
            sipUserId,
            webUserId: Number(webRows[index].id),
            entitlementId: null,
            reused: false,
          });
        });
      }

      const webUserIds = assignments.map((item) => item.webUserId);
      if (webUserIds.length > 0) {
        await connection.query(
          `UPDATE web_users
           SET tenant_id = ?,
               status = 'active',
               activated_at = COALESCE(activated_at, NOW()),
               service_expires_at = ?,
               reviewed_by_platform_admin_id = ?,
               reviewed_at = NOW()
           WHERE id IN (${webUserIds.map(() => "?").join(",")})`,
          [Number(order.tenant_id), serviceExpiresAt, request.admin.id, ...webUserIds],
        );
      }

      const reusedEntitlementIds = assignments.filter((item) => item.reused && item.entitlementId).map((item) => item.entitlementId);
      if (reusedEntitlementIds.length > 0) {
        await connection.query(
          `UPDATE tenant_web_account_entitlements
           SET current_order_id = ?,
               last_renewal_order_id = ?,
               status = 'active',
               service_starts_at = ?,
               service_expires_at = ?,
               renewed_at = NOW(),
               renewed_by_admin_user_id = ?
           WHERE id IN (${reusedEntitlementIds.map(() => "?").join(",")})`,
          [orderId, isRenewalOrder ? orderId : null, serviceStartsAt, serviceExpiresAt, request.admin.id, ...reusedEntitlementIds],
        );
      }

      for (const assignment of assignments.filter((item) => !item.reused)) {
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
             status = VALUES(status),
             service_starts_at = VALUES(service_starts_at),
             service_expires_at = VALUES(service_expires_at),
             assigned_by_admin_user_id = VALUES(assigned_by_admin_user_id)`,
          [
            Number(order.tenant_id),
            assignment.webUserId,
            assignment.sipUserId,
            orderId,
            orderId,
            serviceStartsAt,
            serviceExpiresAt,
            request.admin.id,
          ],
        );
      }

      await connection.query(`DELETE FROM billing_order_web_accounts WHERE order_id = ?`, [orderId]);
      await connection.query(
        `INSERT INTO billing_order_web_accounts (
           order_id, tenant_id, web_user_id, sip_user_id, entitlement_id, username, sip_domain, display_name,
           email, phone_number, password_hash, role, account_status,
           service_starts_at, service_expires_at, assigned_by_admin_user_id
         )
         SELECT
           ?, ?, u.id, e.sip_user_id, e.id, u.username, u.sip_domain, u.display_name,
           u.email, u.phone_number, u.password_hash, u.role, u.status,
           ?, ?, ?
         FROM tenant_web_account_entitlements e
         JOIN web_users u ON u.id = e.web_user_id
         WHERE e.current_order_id = ?
           AND e.sip_user_id IN (${finalSipUserIds.map(() => "?").join(",")})`,
        [orderId, Number(order.tenant_id), serviceStartsAt, serviceExpiresAt, request.admin.id, orderId, ...finalSipUserIds],
      );
    };

    if (status === "review_approved") {
      if (requiredAccountCount <= 0) {
        await connection.rollback();
        return response.status(409).json({ message: "訂單帳號數量无效，不能审核通过。" });
      }
      if (isRenewalOrder) {
        if (!renewalSourceOrderId) {
          await connection.rollback();
          return response.status(409).json({ message: "续订訂單缺少来源訂單，不能审核通过。" });
        }
        allRenewalEntitlements = await connection.query(
          `SELECT id, sip_user_id, service_expires_at
           FROM tenant_sip_account_entitlements
           WHERE tenant_id = ?
             AND (first_order_id = ? OR current_order_id = ? OR last_renewal_order_id = ?)
           ORDER BY id ASC
           FOR UPDATE`,
          [Number(order.tenant_id), renewalSourceOrderId, renewalSourceOrderId, renewalSourceOrderId],
        );
        const retainedRows = await connection.query(
          `SELECT entitlement_id, sip_user_id
           FROM billing_order_renewal_retained_accounts
           WHERE tenant_id = ? AND order_id = ?
           ORDER BY id ASC
           FOR UPDATE`,
          [Number(order.tenant_id), orderId],
        );
        if (allRenewalEntitlements.length < requiredAccountCount) {
          await connection.rollback();
          return response.status(409).json({ message: "当前续订訂單帳號數量大于原帳號數量，暂不支持审核通过。" });
        }
        const retainedEntitlementIds = new Set(retainedRows.map((item) => Number(item.entitlement_id)).filter((id) => id > 0));
        const retainedSipUserIds = new Set(retainedRows.map((item) => Number(item.sip_user_id)).filter((id) => id > 0));
        renewalEntitlements = allRenewalEntitlements.filter((item) => retainedEntitlementIds.has(Number(item.id)) || retainedSipUserIds.has(Number(item.sip_user_id)));
        if (renewalEntitlements.length !== retainedRows.length) {
          await connection.rollback();
          return response.status(409).json({ message: "续订訂單包含無效的保留帳號，请重新生成续订訂單。" });
        }
        if (renewalEntitlements.length > requiredAccountCount) {
          await connection.rollback();
          return response.status(409).json({ message: `续订訂單最多复用 ${requiredAccountCount} 个帳號。` });
        }
        const replacementAccountCount = requiredAccountCount - renewalEntitlements.length;
        if (replacementAccountCount > 0) {
          renewalReplacementAccounts = await connection.query(
            `SELECT id, username, sip_domain, display_name
             FROM sip_users
             WHERE tenant_id IS NULL
               AND status = 'active'
             ORDER BY RAND()
             LIMIT ${replacementAccountCount}
             FOR UPDATE`,
          );
          if (renewalReplacementAccounts.length !== replacementAccountCount) {
            await connection.rollback();
            return response.status(409).json({ message: `未分配 SIP 帳號不足，还需要 ${replacementAccountCount} 个帳號用于续订补分配。` });
          }
        }
        const today = new Date().toISOString().slice(0, 10);
        const baseCandidates = [
          dateOnly(order.renewal_base_expires_at),
          ...renewalEntitlements.map((item) => dateOnly(item.service_expires_at)),
        ].filter(Boolean).sort();
        const baseExpiresAt = baseCandidates[baseCandidates.length - 1] || "";
        renewalStartDate = baseExpiresAt && baseExpiresAt >= today ? addDays(baseExpiresAt, 1) : today;
        renewalExpiresDate = addMonthsMinusOneDay(renewalStartDate, months);
      } else {
        if (uniqueSipAccountIds.length !== requiredAccountCount) {
          await connection.rollback();
          return response.status(400).json({ message: `請選擇 ${requiredAccountCount} 个帳號后再提交审核。` });
        }

        const accountPlaceholders = uniqueSipAccountIds.map(() => "?").join(",");
        const selectedSipAccounts = await connection.query(
          `SELECT id, tenant_id, username
           FROM sip_users
           WHERE id IN (${accountPlaceholders})
           FOR UPDATE`,
          uniqueSipAccountIds,
        );

        if (selectedSipAccounts.length !== requiredAccountCount) {
          await connection.rollback();
          return response.status(404).json({ message: "部分待分配帳號不存在，请刷新后重试。" });
        }

        const assignedAccount = selectedSipAccounts.find((account) => account.tenant_id != null);
        if (assignedAccount) {
          await connection.rollback();
          return response.status(409).json({ message: `帳號 ${assignedAccount.username} 已被分配，请刷新后重新选择。` });
        }
      }
    }

    if (status === "review_approved") {
      if (isRenewalOrder) {
        const renewalSipUserIds = renewalEntitlements.map((item) => Number(item.sip_user_id));
        const renewalEntitlementIds = renewalEntitlements.map((item) => Number(item.id));
        const replacementSipUserIds = renewalReplacementAccounts.map((item) => Number(item.id));
        const allRenewalSipUserIds = [...renewalSipUserIds, ...replacementSipUserIds];
        const retainedEntitlementIdSet = new Set(renewalEntitlementIds);
        const releasedRenewalEntitlements = allRenewalEntitlements.filter((item) => !retainedEntitlementIdSet.has(Number(item.id)));
        const releasedSipUserIds = releasedRenewalEntitlements.map((item) => Number(item.sip_user_id));
        const releasedEntitlementIds = releasedRenewalEntitlements.map((item) => Number(item.id));
        await connection.query(
          `UPDATE billing_orders
           SET order_status = 'review_approved',
               reviewed_at = NOW(),
               reviewed_by_platform_admin_id = ?,
               review_note = ?,
               effective_at = ?,
               expires_at = ?,
               updated_by_admin_user_id = ?
           WHERE id = ?`,
          [request.admin.id, reviewNote || null, renewalStartDate, renewalExpiresDate, request.admin.id, orderId],
        );

        await connection.query(
          `UPDATE sip_users
           SET tenant_id = ?,
               status = 'active',
               activated_at = COALESCE(activated_at, NOW()),
               service_expires_at = ?,
               reviewed_by_platform_admin_id = ?,
               reviewed_at = NOW()
           WHERE id IN (${allRenewalSipUserIds.map(() => "?").join(",")})`,
          [Number(order.tenant_id), renewalExpiresDate, request.admin.id, ...allRenewalSipUserIds],
        );

        if (releasedSipUserIds.length > 0) {
          await connection.query(
            `UPDATE sip_users
             SET tenant_id = NULL,
                 status = 'active',
                 service_expires_at = NULL
             WHERE tenant_id = ?
               AND id IN (${releasedSipUserIds.map(() => "?").join(",")})`,
            [Number(order.tenant_id), ...releasedSipUserIds],
          );
        }

        if (releasedEntitlementIds.length > 0) {
          await connection.query(
            `UPDATE tenant_sip_account_entitlements
             SET status = 'revoked',
                 current_order_id = NULL,
                 service_expires_at = ?,
                 renewed_at = NOW(),
                 renewed_by_admin_user_id = ?
             WHERE id IN (${releasedEntitlementIds.map(() => "?").join(",")})`,
            [renewalStartDate, request.admin.id, ...releasedEntitlementIds],
          );
        }

        if (renewalEntitlementIds.length > 0) {
          await connection.query(
            `UPDATE tenant_sip_account_entitlements
             SET current_order_id = ?,
                 last_renewal_order_id = ?,
                 status = 'active',
                 service_starts_at = ?,
                 service_expires_at = ?,
                 renewed_at = NOW(),
                 renewed_by_admin_user_id = ?
             WHERE id IN (${renewalEntitlementIds.map(() => "?").join(",")})`,
            [orderId, orderId, renewalStartDate, renewalExpiresDate, request.admin.id, ...renewalEntitlementIds],
          );
        }

        if (replacementSipUserIds.length > 0) {
          await connection.query(
            `INSERT INTO tenant_sip_account_entitlements (
               tenant_id, sip_user_id, first_order_id, current_order_id, status,
               service_starts_at, service_expires_at, assigned_by_admin_user_id
             )
             SELECT
               ?, u.id, ?, ?, 'active',
               ?, ?, ?
             FROM sip_users u
             WHERE u.id IN (${replacementSipUserIds.map(() => "?").join(",")})
             ON DUPLICATE KEY UPDATE
               tenant_id = VALUES(tenant_id),
               current_order_id = VALUES(current_order_id),
               status = VALUES(status),
               service_starts_at = VALUES(service_starts_at),
               service_expires_at = VALUES(service_expires_at),
               assigned_by_admin_user_id = VALUES(assigned_by_admin_user_id)`,
            [Number(order.tenant_id), orderId, orderId, renewalStartDate, renewalExpiresDate, request.admin.id, ...replacementSipUserIds],
          );
        }

        await connection.query(`DELETE FROM billing_order_sip_accounts WHERE order_id = ?`, [orderId]);
        await connection.query(
          `INSERT INTO billing_order_sip_accounts (
             order_id, tenant_id, sip_user_id, entitlement_id, username, sip_domain, display_name,
             email, phone_number, password_hash, role, account_status,
             service_starts_at, service_expires_at, assigned_by_admin_user_id
           )
           SELECT
             ?, ?, u.id, e.id, u.username, u.sip_domain, u.display_name,
             u.email, u.phone_number, u.password_hash, u.role, u.status,
             ?, ?, ?
           FROM tenant_sip_account_entitlements e
           JOIN sip_users u ON u.id = e.sip_user_id
           WHERE e.current_order_id = ?
             AND e.sip_user_id IN (${allRenewalSipUserIds.map(() => "?").join(",")})`,
          [orderId, Number(order.tenant_id), renewalStartDate, renewalExpiresDate, request.admin.id, orderId, ...allRenewalSipUserIds],
        );

        if (requiresWebAccounts) {
          await releaseWebAccountsForSip(releasedSipUserIds, renewalStartDate);
          await allocateWebAccountsForSip(allRenewalSipUserIds, renewalStartDate, renewalExpiresDate, true);
        }
      } else {
        const serviceStartsAt = todayDate();
        const serviceExpiresAt = addMonthsMinusOneDay(serviceStartsAt, months);
        const serviceExpiresExpression = `DATE_SUB(DATE_ADD(CURDATE(), INTERVAL ? MONTH), INTERVAL 1 DAY)`;
        await connection.query(
          `UPDATE billing_orders
           SET order_status = 'review_approved',
               reviewed_at = NOW(),
               reviewed_by_platform_admin_id = ?,
               review_note = ?,
               effective_at = CURDATE(),
               expires_at = ${serviceExpiresExpression},
               updated_by_admin_user_id = ?
           WHERE id = ?`,
          [request.admin.id, reviewNote || null, months, request.admin.id, orderId],
        );

        await connection.query(
          `UPDATE sip_users
           SET tenant_id = ?,
               status = 'active',
               activated_at = COALESCE(activated_at, NOW()),
               service_expires_at = ${serviceExpiresExpression},
               reviewed_by_platform_admin_id = ?,
               reviewed_at = NOW()
           WHERE id IN (${uniqueSipAccountIds.map(() => "?").join(",")})`,
          [Number(order.tenant_id), months, request.admin.id, ...uniqueSipAccountIds],
        );

        await connection.query(`DELETE FROM billing_order_sip_accounts WHERE order_id = ?`, [orderId]);
        await connection.query(
          `INSERT INTO tenant_sip_account_entitlements (
             tenant_id, sip_user_id, first_order_id, current_order_id, status,
             service_starts_at, service_expires_at, assigned_by_admin_user_id
           )
           SELECT
             ?, u.id, ?, ?, 'active',
             CURDATE(), ${serviceExpiresExpression}, ?
           FROM sip_users u
           WHERE u.id IN (${uniqueSipAccountIds.map(() => "?").join(",")})
           ON DUPLICATE KEY UPDATE
             tenant_id = VALUES(tenant_id),
             current_order_id = VALUES(current_order_id),
             status = VALUES(status),
             service_expires_at = VALUES(service_expires_at),
             assigned_by_admin_user_id = VALUES(assigned_by_admin_user_id)`,
          [Number(order.tenant_id), orderId, orderId, months, request.admin.id, ...uniqueSipAccountIds],
        );

        await connection.query(
          `INSERT INTO billing_order_sip_accounts (
             order_id, tenant_id, sip_user_id, entitlement_id, username, sip_domain, display_name,
             email, phone_number, password_hash, role, account_status,
             service_starts_at, service_expires_at, assigned_by_admin_user_id
           )
           SELECT
             ?, ?, u.id, e.id, u.username, u.sip_domain, u.display_name,
             u.email, u.phone_number, u.password_hash, u.role, u.status,
             CURDATE(), ${serviceExpiresExpression}, ?
           FROM sip_users u
           JOIN tenant_sip_account_entitlements e ON e.sip_user_id = u.id
           WHERE u.id IN (${uniqueSipAccountIds.map(() => "?").join(",")})`,
          [orderId, Number(order.tenant_id), months, request.admin.id, ...uniqueSipAccountIds],
        );

        if (requiresWebAccounts) {
          await allocateWebAccountsForSip(uniqueSipAccountIds, serviceStartsAt, serviceExpiresAt, false);
        }
      }
    } else {
      await connection.query(
        `UPDATE billing_orders
         SET order_status = 'review_rejected',
             reviewed_at = NOW(),
             reviewed_by_platform_admin_id = ?,
             review_note = ?,
             effective_at = NULL,
             expires_at = NULL,
             updated_by_admin_user_id = ?
         WHERE id = ?`,
        [request.admin.id, reviewNote, request.admin.id, orderId],
      );
    }

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, from_order_status, to_order_status,
         from_payment_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        Number(order.tenant_id),
        order.order_status,
        status,
        order.payment_status,
        order.payment_status,
        status === "review_approved" ? "review_approved" : "review_rejected",
        request.admin.id,
      ],
    );

    const reviewResultText = status === "review_approved" ? "审核通过" : "审核未通过";
    const notificationTitle = status === "review_approved" ? "訂單审核通过" : "訂單审核未通过";
    const assignedAccountText = requiresWebAccounts
      ? `已为该訂單分配 ${requiredAccountCount} 个 SIP 帳號及对应 WebRTC 帳號`
      : `已为该訂單分配 ${requiredAccountCount} 个 SIP 帳號`;
    const notificationBody = status === "review_approved"
      ? `訂單 ${order.order_no || orderId} 的审核结果为：${reviewResultText}。${assignedAccountText}，请前往“帳號管理”查看已分配帳號。`
      : `訂單 ${order.order_no || orderId} 的审核结果为：${reviewResultText}。请前往“我的套餐”查看审核意见并重新提交审核。`;
    const notificationTargetView = status === "review_approved" ? "tenant-account-management" : "domain";
    const notificationResult = await connection.query(
      `INSERT INTO notification_events (
         tenant_id, scope_type, scope_id, event_type, sender_type, sender_id, dedupe_key,
         title, body, severity, status, target_view, resolved_at
       )
       VALUES (?, 'billing_order', ?, 'billing_order_review_result', 'platform_admin', ?, ?, ?, ?, ?, 'active', ?, NULL)`,
      [
        Number(order.tenant_id),
        orderId,
        request.admin.id,
        `order:${orderId}:review_result:${Date.now()}`,
        notificationTitle,
        notificationBody,
        status === "review_rejected" ? 'warning' : "info",
        notificationTargetView,
      ],
    );
    const notificationEventId = Number(notificationResult.insertId || 0);
    if (notificationEventId > 0) {
      await connection.query(
        `INSERT IGNORE INTO notification_receipts (event_id, admin_user_id)
         SELECT ?, id
         FROM admin_users
         WHERE tenant_id = ?
           AND account_type = 'tenant'
           AND status = 'active'`,
        [notificationEventId, Number(order.tenant_id)],
      );
    }

    await connection.commit();
    return response.json({ message: "审核结果已保存。", order: { id: orderId, orderStatus: status, reviewNote } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to review billing order:", error);
    if (error?.exposeMessage && error?.httpStatus) {
      return response.status(error.httpStatus).json({ message: error.message });
    }
    return response.status(500).json({ message: "保存审核结果失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/billing-orders/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以查看任意訂單详情。" });
  }

  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "訂單编号无效。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
         o.currency, o.subtotal_amount, o.discount_amount, o.payable_amount,
         o.order_status, o.payment_status, o.payment_method, o.payment_channel, o.billing_address,
         DATE_FORMAT(o.reviewed_at, '%Y-%m-%d') AS reviewed_at,
         DATE_FORMAT(o.effective_at, '%Y-%m-%d') AS effective_at,
         DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at,
         o.review_note,
         o.coupon_code, o.coupon_discount_type, o.coupon_discount_value,
         DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS coupon_valid_until,
         t.name AS tenant_name, t.tenant_number
       FROM billing_orders o
       LEFT JOIN tenants t ON t.id = o.tenant_id
       LEFT JOIN billing_coupons c ON c.id = o.coupon_id
       WHERE o.id = ?
       LIMIT 1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) return response.status(404).json({ message: "找不到訂單。" });

    const itemRows = await connection.query(
      `SELECT
         item_type, item_code, item_name, account_quantity, quantity, months,
         currency, unit_price, discount_amount, line_amount, sort_order
       FROM billing_order_items
       WHERE order_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [orderId],
    );
    const retainedRows = await connection.query(
      `SELECT
         r.sip_user_id,
         r.entitlement_id,
         r.username,
         r.sip_domain,
         r.display_name,
         DATE_FORMAT(r.source_service_expires_at, '%Y-%m-%d') AS source_service_expires_at
       FROM billing_order_renewal_retained_accounts r
       WHERE r.order_id = ?
       ORDER BY r.username ASC, r.id ASC`,
      [orderId],
    );

    return response.json({
      order: {
        id: Number(order.id),
        orderNo: order.order_no || "",
        order_type: order.order_type || "new_purchase",
        orderType: order.order_type || "new_purchase",
        renewal_source_order_id: order.renewal_source_order_id == null ? null : Number(order.renewal_source_order_id),
        renewalSourceOrderId: order.renewal_source_order_id == null ? null : Number(order.renewal_source_order_id),
        renewal_base_expires_at: order.renewal_base_expires_at ? String(order.renewal_base_expires_at).slice(0, 10) : "",
        renewalBaseExpiresAt: order.renewal_base_expires_at ? String(order.renewal_base_expires_at).slice(0, 10) : "",
        currency: order.currency || "USD",
        subtotalAmount: Number(order.subtotal_amount || 0),
        discountAmount: Number(order.discount_amount || 0),
        payableAmount: Number(order.payable_amount || 0),
        orderStatus: order.order_status || "",
        paymentStatus: order.payment_status || "",
        paymentMethod: order.payment_method || "",
        paymentChannel: order.payment_channel || "",
        billingAddress: order.billing_address || "",
        reviewedAt: order.reviewed_at || "",
        reviewNote: order.review_note || "",
        effectiveAt: order.effective_at || "",
        expiresAt: order.expires_at || "",
        tenantName: order.tenant_name || "",
        tenantNumber: order.tenant_number || "",
        coupon: order.coupon_code ? { couponCode: order.coupon_code } : null,
        retainedAccounts: retainedRows.map((account) => ({
          sipUserId: Number(account.sip_user_id),
          entitlementId: account.entitlement_id == null ? null : Number(account.entitlement_id),
          username: account.username || "",
          sipDomain: account.sip_domain || "",
          displayName: account.display_name || "",
          sourceServiceExpiresAt: account.source_service_expires_at || "",
        })),
        items: itemRows.map((item) => ({
          itemType: item.item_type || "",
          itemCode: item.item_code || "",
          itemName: item.item_name || "",
          accountQuantity: item.account_quantity == null ? null : Number(item.account_quantity),
          quantity: Number(item.quantity || 0),
          months: Number(item.months || 0),
          currency: item.currency || "USD",
          unitPrice: Number(item.unit_price || 0),
          discountAmount: Number(item.discount_amount || 0),
          lineAmount: Number(item.line_amount || 0),
        })),
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "读取訂單详情失败。" });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * ==========================================
 * Ecard 样式管理 API
 * ==========================================
 */

// GET /api/tenant/ecard-styles - 租戶侧获取已啟用的 Ecard 样式
app.get("/api/tenant/ecard-styles", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平台管理員请使用样式管理页面。" });
  }
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以查看 Ecard 样式。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    // 只读取启用的样式，按排序规则排列
    const styles = await connection.query(`
      SELECT 
        id, style_code, style_name, style_type, company_name_enabled, 
        description, cover_image_url, status, sort_order
      FROM ecard_styles
      WHERE status = 'active'
      ORDER BY sort_order ASC, id ASC
    `);

    if (styles.length === 0) {
      return response.json({ styles: [] });
    }

    // 批量读取这些样式的背景图片
    const styleIds = styles.map(s => s.id);
    const placeholders = styleIds.map(() => '?').join(',');
    const backgrounds = await connection.query(`
      SELECT id, style_id, background_name, image_url, layout_json, default_style_json, display_config_json
      FROM ecard_style_backgrounds
      WHERE style_id IN (${placeholders})
      ORDER BY sort_order ASC, id ASC
    `, styleIds);

    const bgMap = backgrounds.reduce((acc, bg) => {
      const sid = Number(bg.style_id);
      if (!acc[sid]) acc[sid] = [];
      acc[sid].push({
        id: Number(bg.id),
        imageUrl: bg.image_url,
        backgroundName: bg.background_name || '',
        layoutJson: typeof bg.layout_json === 'string' ? JSON.parse(bg.layout_json) : (bg.layout_json || null),
        defaultStyleJson: typeof bg.default_style_json === 'string' ? JSON.parse(bg.default_style_json) : (bg.default_style_json || null),
        displayConfigJson: typeof bg.display_config_json === 'string' ? JSON.parse(bg.display_config_json) : (bg.display_config_json || null)
      });
      return acc;
    }, {});

    const formattedStyles = styles.map(row => ({
      id: Number(row.id),
      styleCode: row.style_code,
      styleName: row.style_name,
      styleType: row.style_type,
      companyNameEnabled: Boolean(row.company_name_enabled),
      description: row.description || '',
      coverImageUrl: row.cover_image_url || '',
      status: row.status,
      sortOrder: Number(row.sort_order || 0),
      backgrounds: bgMap[Number(row.id)] || []
    }));

    return response.json({ styles: formattedStyles });
  } catch (error) {
    console.error('Failed to fetch tenant ecard styles:', error);
    return response.status(500).json({ message: '获取 Ecard 样式失败' });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/ecard-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平台管理員無法直接查看租戶电子名片。" });
  }
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以查看名片帳號列表。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         su.id AS sip_user_id,
         su.username AS sip_account,
         su.display_name AS user_name,
         wu.username AS web_account,
         ec.id AS ecard_id,
         ec.thumbnail_url,
         ec.avatar_url,
         DATE_FORMAT(COALESCE(ec.valid_from, su.activated_at), '%Y-%m-%d') AS valid_from,
         DATE_FORMAT(COALESCE(ec.valid_to, su.service_expires_at), '%Y-%m-%d') AS valid_to,
         ec.status AS ecard_status,
         ec.access_slug,
         au.display_name AS created_by,
         t.name AS tenant_name,
         DATE_FORMAT(ec.created_at, '%Y-%m-%d') AS created_at
       FROM sip_users su
       LEFT JOIN tenant_web_account_entitlements ent 
         ON su.id = ent.sip_user_id AND ent.tenant_id = su.tenant_id AND ent.status = 'active'
       LEFT JOIN web_users wu 
         ON ent.web_user_id = wu.id
       LEFT JOIN tenant_ecards ec 
         ON su.id = ec.sip_user_id AND ec.tenant_id = su.tenant_id
       LEFT JOIN tenants t
         ON su.tenant_id = t.id
       LEFT JOIN admin_users au 
         ON ec.created_by_admin_id = au.id
       LEFT JOIN tenant_contact_book_assignments cba ON cba.sip_user_id = su.id AND cba.status != 'revoked' LEFT JOIN tenant_contact_books tcb ON tcb.id = cba.contact_book_id AND tcb.tenant_id = su.tenant_id WHERE su.tenant_id = ? AND su.status = 'active'
       ORDER BY su.username ASC`,
      [request.admin.tenantId]
    );

    const baseUrl = process.env.ECARD_APP_URL || "https://ecard.qrtalkie.org";

    const accounts = rows.map(row => {
      const configured = row.ecard_id != null;
      const slug = row.access_slug || row.sip_account;
      return {
        id: Number(row.sip_user_id),
        userName: row.user_name || "",
        sipAccount: row.sip_account || "",
        webAccount: row.web_account || "",
        avatarUrl: row.avatar_url || "",
        ecardThumbnailUrl: row.thumbnail_url || "",
        configured: configured,
        enabled: configured && row.ecard_status === 'active',
        validFrom: row.valid_from || "",
        validTo: row.valid_to || "",
        downloadUrl: configured ? `${baseUrl}/d/${slug}` : "",
        accessUrl: configured ? `${baseUrl}/u/${slug}` : "",
        createdBy: row.created_by || "",
        createdAt: row.created_at || "",
        tenantName: row.tenant_name || "",
      };
    });

    return response.json({ accounts });
  } catch (error) {
    console.error('Failed to fetch tenant ecard accounts:', error);
    return response.status(500).json({ message: '获取名片帳號列表失败' });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * ==========================================
 * Ecard 样式管理 API (平台管理員)
 * ==========================================
 */
app.get("/api/admin/ecard-styles", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以查看 Ecard 样式。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`
      SELECT 
        e.id, e.style_code, e.style_name, e.style_type, e.company_name_enabled, 
        e.description, e.cover_image_url, e.sample_count, e.status, e.sort_order, 
        e.created_by, e.created_by_name, e.created_at, e.updated_at
      FROM ecard_styles e
      ORDER BY e.sort_order ASC, e.id DESC
    `);
    
    return response.json({
      styles: rows.map(row => ({
        id: Number(row.id),
        styleCode: row.style_code,
        styleName: row.style_name,
        styleType: row.style_type,
        companyNameEnabled: Boolean(row.company_name_enabled),
        description: row.description || '',
        coverImageUrl: row.cover_image_url || '',
        sampleCount: Number(row.sample_count || 0),
        status: row.status,
        sortOrder: Number(row.sort_order || 0),
        createdBy: row.created_by ? Number(row.created_by) : null,
        createdByName: row.created_by_name || '',
        createdAt: row.created_at ? new Date(row.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-") : '',
      }))
    });
  } catch (error) {
    console.error('Failed to fetch ecard styles:', error);
    return response.status(500).json({ message: '获取 Ecard 样式失败' });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/ecard-styles/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以查看 Ecard 样式。" });
  }
  
  const styleId = Number(request.params.id);
  if (!styleId) return response.status(400).json({ message: "無效的样式 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [styleRow] = await connection.query(`SELECT * FROM ecard_styles WHERE id = ?`, [styleId]);

    if (!styleRow) {
      return response.status(404).json({ message: "找不到指定的样式。" });
    }

    const sampleRows = await connection.query(`SELECT * FROM ecard_style_samples WHERE style_id = ? ORDER BY sort_order ASC, id ASC`, [styleId]);
    const bgRows = await connection.query(`SELECT * FROM ecard_style_backgrounds WHERE style_id = ? ORDER BY sort_order ASC, id ASC`, [styleId]);

    return response.json({
      style: {
        id: Number(styleRow.id),
        styleCode: styleRow.style_code,
        styleName: styleRow.style_name,
        styleType: styleRow.style_type,
        companyNameEnabled: Boolean(styleRow.company_name_enabled),
        description: styleRow.description || '',
        coverImageUrl: styleRow.cover_image_url || '',
        sampleCount: Number(styleRow.sample_count || 0),
        status: styleRow.status,
        sortOrder: Number(styleRow.sort_order || 0),
        samples: sampleRows.map(s => ({
          id: Number(s.id),
          imageUrl: s.image_url,
          isCover: Boolean(s.is_cover)
        })),
        backgrounds: bgRows.map(b => ({
          id: Number(b.id),
          imageUrl: b.image_url,
          backgroundName: b.background_name || '',
          layoutJson: typeof b.layout_json === 'string' ? JSON.parse(b.layout_json) : (b.layout_json || null),
          defaultStyleJson: typeof b.default_style_json === 'string' ? JSON.parse(b.default_style_json) : (b.default_style_json || null),
          displayConfigJson: typeof b.display_config_json === 'string' ? JSON.parse(b.display_config_json) : (b.display_config_json || null)
        }))
      }
    });
  } catch (error) {
    console.error('Failed to fetch ecard style details:', error);
    return response.status(500).json({ message: '获取样式详情失败' });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/ecard-styles", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以创建 Ecard 样式。" });
  }

  const payload = request.body || {};
  const styleCode = sanitizeString(payload.styleCode, 64);
  const styleName = sanitizeString(payload.styleName, 128);
  const styleType = sanitizeString(payload.styleType, 32);
  const status = sanitizeString(payload.status, 32);
  const description = sanitizeString(payload.description, 255);
  const sortOrder = Number(payload.sortOrder || 0);
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const backgrounds = Array.isArray(payload.backgrounds) ? payload.backgrounds : [];
  const companyNameEnabled = styleType === 'with_company' ? 1 : 0;

  if (!styleCode || !styleName) {
    return response.status(400).json({ message: "請填寫样式编号和名稱。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.query(`SELECT id FROM ecard_styles WHERE style_code = ?`, [styleCode]);
    if (existing) {
      await connection.rollback();
      return response.status(409).json({ message: "该样式编号已存在。" });
    }

    const styleResult = await connection.query(
      `INSERT INTO ecard_styles (style_code, style_name, style_type, company_name_enabled, description, status, sort_order, sample_count, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [styleCode, styleName, styleType, companyNameEnabled, description || null, status, sortOrder, samples.length, request.admin.id, request.admin.nickname || request.admin.displayName || '']
    );
    const styleId = styleResult.insertId;
    let coverImageUrl = null;
    let firstImageUrl = null;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      let imageUrl = sample.dataUrl ? await saveEcardImage(sample.dataUrl, sample.fileName) : '';
      if (i === 0) firstImageUrl = imageUrl;
      if (sample.isCover && !coverImageUrl) coverImageUrl = imageUrl;
      await connection.query(
        `INSERT INTO ecard_style_samples (style_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`,
        [styleId, imageUrl, sample.isCover ? 1 : 0, i]
      );
    }
    for (let i = 0; i < backgrounds.length; i++) {
      const bg = backgrounds[i];
      let bgImageUrl = bg.dataUrl ? await saveEcardImage(bg.dataUrl, bg.fileName) : '';
      await connection.query(
        `INSERT INTO ecard_style_backgrounds (style_id, background_name, image_url, sort_order, layout_json, default_style_json, display_config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [styleId, sanitizeString(bg.backgroundName, 128), bgImageUrl, i, bg.layoutJson ? JSON.stringify(bg.layoutJson) : null, bg.defaultStyleJson ? JSON.stringify(bg.defaultStyleJson) : null, bg.displayConfigJson ? JSON.stringify(bg.displayConfigJson) : null]
      );
    }

    coverImageUrl = coverImageUrl || firstImageUrl || null;
    await connection.query(`UPDATE ecard_styles SET cover_image_url = ? WHERE id = ?`, [coverImageUrl, styleId]);
    await connection.commit();
    return response.status(201).json({ message: "Ecard 样式创建成功" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to create Ecard style:", error);
    return response.status(500).json({ message: "创建 Ecard 样式失败" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/ecard-styles/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以修改 Ecard 样式。" });
  }

  const styleId = Number(request.params.id);
  if (!styleId) return response.status(400).json({ message: "無效的样式 ID。" });

  const payload = request.body || {};
  const styleName = sanitizeString(payload.styleName, 128);
  const styleType = sanitizeString(payload.styleType, 32);
  const status = sanitizeString(payload.status, 32);
  const description = sanitizeString(payload.description, 255);
  const sortOrder = Number(payload.sortOrder || 0);
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const backgrounds = Array.isArray(payload.backgrounds) ? payload.backgrounds : [];
  const companyNameEnabled = styleType === 'with_company' ? 1 : 0;

  if (!styleName) return response.status(400).json({ message: "請填寫样式名稱。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.query(`SELECT id FROM ecard_styles WHERE id = ?`, [styleId]);
    if (!existing) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到该样式。" });
    }

    await connection.query(
      `UPDATE ecard_styles SET style_name = ?, style_type = ?, company_name_enabled = ?, description = ?, status = ?, sort_order = ?, sample_count = ? WHERE id = ?`,
      [styleName, styleType, companyNameEnabled, description || null, status, sortOrder, samples.length, styleId]
    );

    let coverImageUrl = null;
    let firstImageUrl = null;
    await connection.query(`DELETE FROM ecard_style_samples WHERE style_id = ?`, [styleId]);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      let imageUrl = sample.dataUrl ? await saveEcardImage(sample.dataUrl, sample.fileName) : (sample.url || sample.imageUrl || '');
      if (i === 0) firstImageUrl = imageUrl;
      if (sample.isCover && !coverImageUrl) coverImageUrl = imageUrl;
      await connection.query(
        `INSERT INTO ecard_style_samples (style_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`,
        [styleId, imageUrl, sample.isCover ? 1 : 0, i]
      );
    }

    await connection.query(`DELETE FROM ecard_style_backgrounds WHERE style_id = ?`, [styleId]);
    for (let i = 0; i < backgrounds.length; i++) {
      const bg = backgrounds[i];
      let bgImageUrl = bg.dataUrl ? await saveEcardImage(bg.dataUrl, bg.fileName) : (bg.url || bg.imageUrl || '');
      await connection.query(
        `INSERT INTO ecard_style_backgrounds (style_id, background_name, image_url, sort_order, layout_json, default_style_json, display_config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [styleId, sanitizeString(bg.backgroundName, 128), bgImageUrl, i, bg.layoutJson ? JSON.stringify(bg.layoutJson) : null, bg.defaultStyleJson ? JSON.stringify(bg.defaultStyleJson) : null, bg.displayConfigJson ? JSON.stringify(bg.displayConfigJson) : null]
      );
    }

    coverImageUrl = coverImageUrl || firstImageUrl || null;
    await connection.query(`UPDATE ecard_styles SET cover_image_url = ? WHERE id = ?`, [coverImageUrl, styleId]);
    await connection.commit();
    return response.status(200).json({ message: "Ecard 样式更新成功" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update Ecard style:", error);
    return response.status(500).json({ message: "修改 Ecard 样式失败" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/ecard-style-backgrounds/:id/json-config", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以修改背景图配置。" });
  }

  const bgId = Number(request.params.id);
  if (!bgId) return response.status(400).json({ message: "無效的背景图 ID。" });

  const { configType, configJson } = request.body || {};
  if (!["layout_json", "default_style_json", "display_config_json"].includes(configType)) {
    return response.status(400).json({ message: "無效的配置類型。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const jsonString = configJson ? JSON.stringify(configJson) : null;
    const result = await connection.query(
      `UPDATE ecard_style_backgrounds SET ${configType} = ? WHERE id = ?`,
      [jsonString, bgId]
    );
    if (Number(result.affectedRows || 0) === 0) {
          const check = await connection.query('SELECT id FROM ecard_style_backgrounds WHERE id = ?', [bgId]);
          if (check.length === 0) {
            return response.status(404).json({ message: "找不到指定的背景图。" });
          }
    }
    return response.json({ message: "配置已保存。" });
  } catch (error) {
    console.error("Failed to update background json config:", error);
    return response.status(500).json({ message: "保存配置失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/ecard-styles/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以修改 Ecard 样式。" });
  }

  const styleId = Number(request.params.id);
  if (!styleId) return response.status(400).json({ message: "無效的样式 ID。" });

  const status = sanitizeString(request.body?.status, 32);
  if (!['active', 'disabled'].includes(status)) {
    return response.status(400).json({ message: "狀態无效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(`UPDATE ecard_styles SET status = ? WHERE id = ?`, [status, styleId]);
    if (Number(result.affectedRows || 0) === 0) {
      return response.status(404).json({ message: "找不到该样式。" });
    }
    return response.json({ message: "狀態更新成功" });
  } catch (error) {
    console.error("Failed to update ecard style status:", error);
    return response.status(500).json({ message: "更新狀態失败" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/admin/ecard-styles/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以删除 Ecard 样式。" });
  }
  const styleId = Number(request.params.id);
  if (!styleId) return response.status(400).json({ message: "無效的样式 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(`DELETE FROM ecard_styles WHERE id = ?`, [styleId]);
    return response.json({ message: "样式已成功删除。" });
  } catch (error) {
    console.error('Failed to delete ecard style:', error);
    return response.status(500).json({ message: '刪除失敗' });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/tenant/ecard-accounts/:sipUserId/ecard", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平台管理員無法访问租戶电子名片。" });
  }
  const sipUserId = Number(request.params.sipUserId);
  const payload = request.body || {};
  
  let connection;
  try {
    connection = await pool.getConnection();
    try {
      await connection.query(`ALTER TABLE tenant_ecards ADD COLUMN ecard_data_json LONGTEXT`);
    } catch (err) {
      // 列已存在时忽略错误
    }

    const [su] = await connection.query(`SELECT id FROM sip_users WHERE id = ? AND tenant_id = ?`, [sipUserId, request.admin.tenantId]);
    if (!su) {
      return response.status(404).json({ message: "SIP 帳號不存在或不属于当前租戶" });
    }

    let avatarUrl = payload.avatarDataUrl || "";
    if (avatarUrl.startsWith("data:")) {
      avatarUrl = await saveEcardImage(avatarUrl, "avatar.png");
    }
    
    let logoUrl = payload.logoDataUrl || "";
    if (logoUrl.startsWith("data:")) {
      logoUrl = await saveEcardImage(logoUrl, "logo.png");
    }
    
    let thumbnailUrl = payload.thumbnailDataUrl || "";
    if (thumbnailUrl.startsWith("data:")) {
      thumbnailUrl = await saveEcardImage(thumbnailUrl, "thumbnail.png");
    }
    
    const ecardDataJson = payload.ecardDataJson || {};
    ecardDataJson.avatarDataUrl = avatarUrl;
    ecardDataJson.logoDataUrl = logoUrl;

    await connection.query(
      `INSERT INTO tenant_ecards (
         tenant_id, sip_user_id, access_slug, avatar_url, thumbnail_url, status,
         created_by_admin_id, ecard_data_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         access_slug = VALUES(access_slug),
         avatar_url = VALUES(avatar_url),
         thumbnail_url = VALUES(thumbnail_url),
         ecard_data_json = VALUES(ecard_data_json),
         updated_at = NOW()`,
      [
        request.admin.tenantId,
        sipUserId,
        payload.accessSlug || null,
        avatarUrl || null,
        thumbnailUrl || null,
        request.admin.id,
        JSON.stringify(ecardDataJson)
      ]
    );

    return response.json({ message: "电子名片已保存" });
  } catch (err) {
    console.error("Save ecard failed", err);
    return response.status(500).json({ message: "儲存失敗" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/ecard-accounts/:sipUserId/ecard", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平台管理員無法访问租戶电子名片。" });
  }
  const sipUserId = Number(request.params.sipUserId);
  let connection;
  try {
    connection = await pool.getConnection();
    const [ec] = await connection.query(
      `SELECT ec.ecard_data_json, ec.thumbnail_url, ec.avatar_url, ec.access_slug,
              DATE_FORMAT(COALESCE(ec.valid_from, su.activated_at), '%Y-%m-%d') AS valid_from,
              DATE_FORMAT(COALESCE(ec.valid_to, su.service_expires_at), '%Y-%m-%d') AS valid_to,
              ec.status
       FROM sip_users su
       LEFT JOIN tenant_ecards ec ON ec.sip_user_id = su.id AND ec.tenant_id = su.tenant_id
       WHERE su.id = ? AND su.tenant_id = ?`,
      [sipUserId, request.admin.tenantId]
    );
    if (!ec) return response.status(404).json({ message: "SIP 账号不存在" });
    return response.json({
      ecardDataJson: ec.ecard_data_json ? JSON.parse(ec.ecard_data_json) : null,
      thumbnailUrl: ec.thumbnail_url || null,
      avatarUrl: ec.avatar_url || null,
      accessSlug: ec.access_slug || null,
      validFrom: ec.valid_from || null,
      validTo: ec.valid_to || null,
      status: ec.status || null,
    });
    return response.status(500).json({ message: "获取名片失败" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/ecard-accounts/:sipUserId/ecard/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平台管理員無法访问租戶电子名片。" });
  }
  const sipUserId = Number(request.params.sipUserId);
  const status = request.body?.status === 'active' ? 'active' : 'disabled';

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE tenant_ecards SET status = ?, updated_at = NOW() WHERE tenant_id = ? AND sip_user_id = ?`,
      [status, request.admin.tenantId, sipUserId]
    );
    if (result.affectedRows === 0) {
      // 优化：如果 affectedRows 为 0，可能只是狀態没变，而不是不存在。需进一步检查
      const [check] = await connection.query(
        `SELECT id FROM tenant_ecards WHERE tenant_id = ? AND sip_user_id = ?`,
        [request.admin.tenantId, sipUserId]
      );
      if (check.length === 0) {
        return response.status(404).json({ message: "该帳號尚未配置电子名片。" });
      }
    }
    return response.json({ message: status === 'active' ? "电子名片已啟用" : "电子名片已停用" });
  } catch (err) {
    console.error(err);
    return response.status(500).json({ message: "更新狀態失败" });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * ==========================================
 * 系统配置 API (隐私政策 / 服务条款等)
 * ==========================================
 */

// 读取隐私政策 (管理后台)
app.get("/api/admin/settings/privacy-policy", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以读取系统配置。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'privacy_policy'`
    );
    const content = rows.length > 0 ? rows[0].setting_value : "";
    return response.json({ content });
  } catch (error) {
    console.error("Failed to get privacy policy:", error);
    return response.status(500).json({ message: "读取隐私政策失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// 保存隐私政策 (管理后台)
app.put("/api/admin/settings/privacy-policy", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以修改系统配置。" });
  }
  const content = request.body?.content || "";
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      `INSERT INTO system_settings (setting_key, setting_value) 
       VALUES ('privacy_policy', ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [content, content]
    );
    return response.json({ message: "隐私政策已保存成功" });
  } catch (error) {
    console.error("Failed to save privacy policy:", error);
    return response.status(500).json({ message: "保存隐私政策失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// 读取服务条款 (管理后台)
app.get("/api/admin/settings/terms-of-service", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以读取系统配置。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'terms_of_service'`
    );
    const content = rows.length > 0 ? rows[0].setting_value : "";
    return response.json({ content });
  } catch (error) {
    console.error("Failed to get terms of service:", error);
    return response.status(500).json({ message: "读取服务条款失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// 保存服务条款 (管理后台)
app.put("/api/admin/settings/terms-of-service", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理員可以修改系统配置。" });
  }
  const content = request.body?.content || "";
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      `INSERT INTO system_settings (setting_key, setting_value) 
       VALUES ('terms_of_service', ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [content, content]
    );
    return response.json({ message: "服务条款已保存成功" });
  } catch (error) {
    console.error("Failed to save terms of service:", error);
    return response.status(500).json({ message: "保存服务条款失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// 开放接口：读取隐私政策 (供 Landing 落地页免登录读取)
app.get("/api/public/settings/privacy-policy", async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'privacy_policy'`
    );
    const content = rows.length > 0 ? rows[0].setting_value : "暂无隐私政策内容。";
    return response.json({ content });
  } catch (error) {
    console.error("Failed to get public privacy policy:", error);
    return response.status(500).json({ message: "获取隐私政策失败，請稍後再試" });
  } finally {
    if (connection) connection.release();
  }
});

// 开放接口：读取服务条款 (供 Landing 落地页免登录读取)
app.get("/api/public/settings/terms-of-service", async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'terms_of_service'`
    );
    const content = rows.length > 0 ? rows[0].setting_value : "暂无服务条款内容。";
    return response.json({ content });
  } catch (error) {
    console.error("Failed to get public terms of service:", error);
    return response.status(500).json({ message: "获取服务条款失败，請稍後再試" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/call-centers - 租戶获取呼叫中心配置列表
app.get("/api/call-centers", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以查看呼叫中心配置。" });
  }

  const limit = Math.max(1, parseInt(request.query.limit || "10", 10));
  const offset = Math.max(0, parseInt(request.query.offset || "0", 10));
  const keyword = sanitizeString(request.query.keyword, 120);
  const statusFilter = sanitizeString(request.query.status, 20);

  const whereClauses = ["tenant_id = ?"];
  const params = [request.admin.tenantId];

  if (statusFilter && statusFilter !== "all") {
    whereClauses.push("status = ?");
    params.push(statusFilter);
  }

  if (keyword) {
    whereClauses.push("(center_name LIKE ? OR center_url LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = "WHERE " + whereClauses.join(" AND ");

  let connection;
  try {
    connection = await pool.getConnection();

    // 0. 获取该租戶的套餐有效期并检查是否过期，若过期则自动停用
    const planRows = await connection.query(`
      SELECT DATE_FORMAT(MAX(expires_at), '%Y-%m-%d') as tenant_expires_at
      FROM billing_orders
      WHERE tenant_id = ? AND order_status = 'review_approved'
    `, [request.admin.tenantId]);
    const tenantExpiresAt = planRows[0]?.tenant_expires_at || null;

    let isExpired = true;
    if (tenantExpiresAt) {
      const expiresDate = new Date(`${tenantExpiresAt}T00:00:00Z`);
      const today = new Date();
      const diffTime = expiresDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 0) {
        isExpired = false;
      }
    }

    if (isExpired) {
      await connection.query(`
        UPDATE call_centers 
        SET status = 'disabled', updated_at = CURRENT_TIMESTAMP 
        WHERE tenant_id = ? AND status = 'active'
      `, [request.admin.tenantId]);
    }

    // 1. 获取该租戶的整体狀態统计
    const statsRows = await connection.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled,
        SUM(CASE WHEN require_visitor_info = 1 THEN 1 ELSE 0 END) as visitorEnabled
      FROM call_centers
      WHERE tenant_id = ?
    `, [request.admin.tenantId]);

    // 2. 获取分页总数
    const countRows = await connection.query(`SELECT COUNT(*) AS total FROM call_centers ${whereSql}`, params);
    const total = Number(countRows[0]?.total || 0);

    // 3. 获取当页数据
    const rows = await connection.query(`
      SELECT id, center_name, center_url, require_visitor_info, status, created_by_name, updated_at
      FROM call_centers ${whereSql}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    let expiringSoonCount = 0;
    if (!isExpired && tenantExpiresAt) {
      const expiresDate = new Date(`${tenantExpiresAt}T00:00:00Z`);
      const today = new Date();
      const diffTime = expiresDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays <= 7) {
        expiringSoonCount = Number(statsRows[0]?.total || 0);
      }
    }

    const formattedRows = rows.map(row => ({
      id: Number(row.id),
      centerName: row.center_name,
      centerUrl: row.center_url,
      requireVisitorInfo: Boolean(row.require_visitor_info),
      status: row.status,
      createdByName: row.created_by_name,
      updatedAt: row.updated_at,
      tenantExpiresAt: tenantExpiresAt
    }));

    const stats = statsRows[0] || { total: 0, active: 0, disabled: 0, visitorEnabled: 0 };
    return response.json({ code: 0, data: { list: formattedRows, total, stats: { total: Number(stats.total||0), active: Number(stats.active||0), disabled: Number(stats.disabled||0), visitorEnabled: Number(stats.visitorEnabled||0), expiringSoon: expiringSoonCount } } });
  } catch (error) {
    console.error("Failed to fetch call centers:", error);
    return response.status(500).json({ code: -1, message: "获取呼叫中心列表失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/call-centers - 租戶新增呼叫中心配置
app.post("/api/call-centers", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以配置呼叫中心。" });
  }

  const payload = request.body || {};
  const centerName = sanitizeString(payload.name, 100);
  const slug = sanitizeString(payload.slug, 100);
  if (!centerName || !slug) return response.status(400).json({ message: "缺少呼叫中心名稱或 Slug 参数。" });

  const centerUrl = `${callCenterBaseUrl}/callcenter?id=${slug}`;
  const visitorEnabled = payload.visitorEnabled ? 1 : 0;

  // 构建访客必填与选填字段 JSON
  const requiredFields = ["email"];
  if (payload.requireName) requiredFields.push("name");
  if (payload.requirePhone) requiredFields.push("phone");

  const optionalFields = [];
  if (payload.optionalCompany) optionalFields.push("company");
  if (payload.optionalContent) optionalFields.push("content");
  
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. 检查 slug 唯一性
    const [existing] = await connection.query(`SELECT id FROM call_centers WHERE center_slug = ? LIMIT 1`, [slug]);
    if (existing) {
      await connection.rollback();
      return response.status(409).json({ message: "该唯一标识 Slug 已被占用，请更换。" });
    }

    // 2. 处理图片文件上传及保存
    let logoUrl = null;
    if (payload.logoDataUrl?.startsWith('data:')) {
      logoUrl = await saveCallCenterImage(payload.logoDataUrl, 'logo.png');
    } else if (payload.logoDataUrl?.startsWith('/api/')) {
      logoUrl = payload.logoDataUrl.substring(4);
    } else if (payload.logoDataUrl) {
      logoUrl = payload.logoDataUrl;
    }
    
    let coverUrl = null;
    if (payload.coverDataUrl?.startsWith('data:')) {
      coverUrl = await saveCallCenterImage(payload.coverDataUrl, 'cover.png');
    } else if (payload.coverDataUrl?.startsWith('/api/')) {
      coverUrl = payload.coverDataUrl.substring(4);
    } else if (payload.coverDataUrl) {
      coverUrl = payload.coverDataUrl;
    }

    const creatorName = request.admin.nickname || request.admin.displayName || request.admin.email || "管理員";

    // 3. 落库：呼叫中心主表
    const ccResult = await connection.query(
      `INSERT INTO call_centers (
         tenant_id, center_name, center_slug, center_url, logo_url, cover_image_url,
         description, welcome_text, require_visitor_info, visitor_info_required_fields,
         visitor_info_optional_fields, visitor_info_form_title, visitor_info_form_desc,
         status, created_by, created_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        request.admin.tenantId, centerName, slug, centerUrl, logoUrl, coverUrl,
        payload.description || null, payload.welcomeMessage || null, visitorEnabled,
        JSON.stringify(requiredFields), JSON.stringify(optionalFields),
        payload.visitorTitle || null, payload.visitorDescription || null,
        request.admin.id, creatorName
      ]
    );
    
    const callCenterId = Number(ccResult.insertId);

    // 4. 落库：服务分类及坐席列表
    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const catName = sanitizeString(cat.name, 128);
      if (!catName) continue;

      // 插入分类
      const catResult = await connection.query(
        `INSERT INTO call_center_categories (
           call_center_id, tenant_id, category_name, sort_order
         ) VALUES (?, ?, ?, ?)`,
        [callCenterId, request.admin.tenantId, catName, i]
      );
      const categoryId = Number(catResult.insertId);

      if (Array.isArray(cat.agents)) {
        for (let j = 0; j < cat.agents.length; j++) {
          const agent = cat.agents[j];
          let avatarUrl = agent.avatarDataUrl || null;
          if (avatarUrl?.startsWith('data:')) {
            avatarUrl = await saveCallCenterImage(avatarUrl, 'avatar.png');
          } else if (avatarUrl?.startsWith('/api/')) {
            avatarUrl = avatarUrl.substring(4);
          }

          const sipAccountId = agent.ecardId;
          
          if (!sipAccountId) {
            await connection.rollback();
            return response.status(400).json({ message: `坐席 ${agent.name || '(未命名)'} 缺少必要的电子名片关联，請檢查配置。` });
          }
          // 插入分类下的坐席
          await connection.query(
            `INSERT INTO call_center_category_agents (
               call_center_id, category_id, tenant_id, sip_account_id, sip_number,
               display_name, avatar_url, job_title, phone, email, sort_order
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              callCenterId, categoryId, request.admin.tenantId, sipAccountId,
              agent.sip || '', agent.name || 'Unknown', avatarUrl, agent.title || null,
              agent.phone || null, agent.email || null, j
            ]
          );
        }
      }
    }

    await connection.commit();
    return response.status(201).json({ message: "呼叫中心配置已保存" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Failed to save call center:", error);
    return response.status(500).json({ message: "保存呼叫中心失败" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/call-centers/:id/status - 更新呼叫中心狀態
app.put("/api/call-centers/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以修改呼叫中心狀態。" });
  }

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心编号。" });

  const status = sanitizeString(request.body?.status, 20);
  if (!['active', 'disabled'].includes(status)) {
    return response.status(400).json({ code: -1, message: "狀態值无效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    if (status === 'active') {
      const planRows = await connection.query(`
        SELECT DATE_FORMAT(MAX(expires_at), '%Y-%m-%d') as tenant_expires_at
        FROM billing_orders
        WHERE tenant_id = ? AND order_status = 'review_approved'
      `, [request.admin.tenantId]);
      const tenantExpiresAt = planRows[0]?.tenant_expires_at || null;

      let isExpired = true;
      if (tenantExpiresAt) {
        const expiresDate = new Date(`${tenantExpiresAt}T00:00:00Z`);
        const today = new Date();
        const diffTime = expiresDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays >= 0) {
          isExpired = false;
        }
      }
      if (isExpired) {
        return response.status(403).json({ code: -1, message: "套餐已過期，無法启用。" });
      }
    }

    const result = await connection.query(
      `UPDATE call_centers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      [status, id, request.admin.tenantId]
    );

    if (Number(result.affectedRows || 0) === 0) {
      return response.status(404).json({ code: -1, message: "找不到呼叫中心。" });
    }

    return response.json({ code: 0, message: "狀態已更新。" });
  } catch (error) {
    console.error("Failed to update call center status:", error);
    return response.status(500).json({ code: -1, message: "更新狀態失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/call-centers/:id/visitor-info - 更新呼叫中心访客登记狀態
app.put("/api/call-centers/:id/visitor-info", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以修改呼叫中心配置。" });
  }

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心编号。" });

  const visitorEnabled = Boolean(request.body?.visitorEnabled) ? 1 : 0;

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE call_centers SET require_visitor_info = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      [visitorEnabled, id, request.admin.tenantId]
    );

    if (Number(result.affectedRows || 0) === 0) {
      return response.status(404).json({ code: -1, message: "找不到呼叫中心。" });
    }

    return response.json({ code: 0, message: "访客登记狀態已更新。" });
  } catch (error) {
    console.error("Failed to update visitor info status:", error);
    return response.status(500).json({ code: -1, message: "更新访客登记狀態失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/call-centers - 批量/单条删除呼叫中心
app.delete("/api/call-centers", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以删除呼叫中心。" });
  }

  const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(Number).filter(id => id > 0) : [];
  if (ids.length === 0) {
    return response.status(400).json({ code: -1, message: "請提供要删除的呼叫中心编号。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const placeholders = ids.map(() => "?").join(",");
    const rows = await connection.query(
      `SELECT id FROM call_centers WHERE id IN (${placeholders}) AND tenant_id = ? FOR UPDATE`,
      [...ids, request.admin.tenantId]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    const validIds = rows.map(r => Number(r.id));
    const validPlaceholders = validIds.map(() => "?").join(",");

    await connection.query(`DELETE FROM call_center_category_agents WHERE call_center_id IN (${validPlaceholders}) AND tenant_id = ?`, [...validIds, request.admin.tenantId]);
    await connection.query(`DELETE FROM call_center_categories WHERE call_center_id IN (${validPlaceholders}) AND tenant_id = ?`, [...validIds, request.admin.tenantId]);
    const result = await connection.query(`DELETE FROM call_centers WHERE id IN (${validPlaceholders}) AND tenant_id = ?`, [...validIds, request.admin.tenantId]);

    await connection.commit();
    return response.json({ code: 0, message: `成功删除 ${result.affectedRows} 个呼叫中心。` });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete call centers:", error);
    return response.status(500).json({ code: -1, message: "刪除失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/call-centers/:id - 获取呼叫中心详情
app.get("/api/call-centers/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以查看呼叫中心配置。" });
  }

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心编号。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [cc] = await connection.query(`
      SELECT * FROM call_centers WHERE id = ? AND tenant_id = ?
    `, [id, request.admin.tenantId]);

    if (!cc) {
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    const categoriesRows = await connection.query(`
      SELECT * FROM call_center_categories WHERE call_center_id = ? ORDER BY sort_order ASC
    `, [id]);

    const agentsRows = await connection.query(`
      SELECT * FROM call_center_category_agents WHERE call_center_id = ? ORDER BY category_id ASC, sort_order ASC
    `, [id]);

    const categories = categoriesRows.map(cat => {
      const agents = agentsRows.filter(a => a.category_id === cat.id).map(a => ({
        id: Number(a.id),
        ecardId: a.sip_account_id ? Number(a.sip_account_id) : null,
        sip: a.sip_number || '',
        name: a.display_name || '',
        avatarDataUrl: a.avatar_url ? (a.avatar_url.startsWith('/') && !a.avatar_url.startsWith('/api/') ? `/api${a.avatar_url}` : a.avatar_url) : '',
        title: a.job_title || '',
        phone: a.phone || '',
        email: a.email || ''
      }));
      return {
        id: Number(cat.id),
        name: cat.category_name,
        agentCount: agents.length,
        agents
      };
    });

    return response.json({
      code: 0,
      data: {
        id: Number(cc.id),
        name: cc.center_name,
        slug: cc.center_slug,
        url: cc.center_url,
        logoDataUrl: cc.logo_url ? (cc.logo_url.startsWith('/') && !cc.logo_url.startsWith('/api/') ? `/api${cc.logo_url}` : cc.logo_url) : '',
        coverDataUrl: cc.cover_image_url ? (cc.cover_image_url.startsWith('/') && !cc.cover_image_url.startsWith('/api/') ? `/api${cc.cover_image_url}` : cc.cover_image_url) : '',
        description: cc.description || '',
        welcomeMessage: cc.welcome_text || '',
        visitorEnabled: Boolean(cc.require_visitor_info),
        visitorTitle: cc.visitor_info_form_title || '',
        visitorDescription: cc.visitor_info_form_desc || '',
        requiredFields: (() => {
          try {
            if (typeof cc.visitor_info_required_fields === 'object') return cc.visitor_info_required_fields || [];
            return cc.visitor_info_required_fields ? JSON.parse(cc.visitor_info_required_fields) : [];
          } catch (e) {
            console.warn(`Failed to parse visitor_info_required_fields for call center ${id}:`, cc.visitor_info_required_fields, e);
            return [];
          }
        })(),
        optionalFields: (() => {
          try {
            if (typeof cc.visitor_info_optional_fields === 'object') return cc.visitor_info_optional_fields || [];
            return cc.visitor_info_optional_fields ? JSON.parse(cc.visitor_info_optional_fields) : [];
          } catch (e) {
            console.warn(`Failed to parse visitor_info_optional_fields for call center ${id}:`, cc.visitor_info_optional_fields, e);
            return [];
          }
        })(),
        categories
      }
    });

  } catch (error) {
    console.error("Failed to fetch call center details:", error);
    return response.status(500).json({ code: -1, message: "获取呼叫中心详情失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/call-centers/:id - 更新呼叫中心配置
app.put("/api/call-centers/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以配置呼叫中心。" });
  }

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心编号。" });

  const payload = request.body || {};
  const centerName = sanitizeString(payload.name, 100);
  const slug = sanitizeString(payload.slug, 100);
  if (!centerName || !slug) return response.status(400).json({ code: -1, message: "缺少呼叫中心名稱或 Slug 参数。" });

  const centerUrl = `${callCenterBaseUrl}/callcenter?id=${slug}`;
  const visitorEnabled = payload.visitorEnabled ? 1 : 0;

  const requiredFields = ["email"];
  if (payload.requireName) requiredFields.push("name");
  if (payload.requirePhone) requiredFields.push("phone");

  const optionalFields = [];
  if (payload.optionalCompany) optionalFields.push("company");
  if (payload.optionalContent) optionalFields.push("content");
  
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.query(`SELECT id FROM call_centers WHERE center_slug = ? AND id != ? LIMIT 1`, [slug, id]);
    if (existing) {
      await connection.rollback();
      return response.status(409).json({ code: -1, message: "该唯一标识 Slug 已被占用，请更换。" });
    }

    const [currentCc] = await connection.query(`SELECT logo_url, cover_image_url FROM call_centers WHERE id = ? AND tenant_id = ? FOR UPDATE`, [id, request.admin.tenantId]);
    if (!currentCc) {
      await connection.rollback();
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    let logoUrl = currentCc.logo_url;
    if (payload.logoDataUrl?.startsWith('data:')) {
      logoUrl = await saveCallCenterImage(payload.logoDataUrl, 'logo.png');
    } else if (payload.logoDataUrl === '') {
      logoUrl = null;
    } else if (payload.logoDataUrl?.startsWith('/api/')) {
      logoUrl = payload.logoDataUrl.substring(4);
    } else if (payload.logoDataUrl) {
      logoUrl = payload.logoDataUrl;
    }

    let coverUrl = currentCc.cover_image_url;
    if (payload.coverDataUrl?.startsWith('data:')) {
      coverUrl = await saveCallCenterImage(payload.coverDataUrl, 'cover.png');
    } else if (payload.coverDataUrl === '') {
      coverUrl = null;
    } else if (payload.coverDataUrl?.startsWith('/api/')) {
      coverUrl = payload.coverDataUrl.substring(4);
    } else if (payload.coverDataUrl) {
      coverUrl = payload.coverDataUrl;
    }

    await connection.query(
      `UPDATE call_centers SET
         center_name = ?, center_slug = ?, center_url = ?, logo_url = ?, cover_image_url = ?,
         description = ?, welcome_text = ?, require_visitor_info = ?, visitor_info_required_fields = ?,
         visitor_info_optional_fields = ?, visitor_info_form_title = ?, visitor_info_form_desc = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`,
      [
        centerName, slug, centerUrl, logoUrl, coverUrl,
        payload.description || null, payload.welcomeMessage || null, visitorEnabled,
        JSON.stringify(requiredFields), JSON.stringify(optionalFields),
        payload.visitorTitle || null, payload.visitorDescription || null,
        id, request.admin.tenantId
      ]
    );

    await connection.query(`DELETE FROM call_center_category_agents WHERE call_center_id = ? AND tenant_id = ?`, [id, request.admin.tenantId]);
    await connection.query(`DELETE FROM call_center_categories WHERE call_center_id = ? AND tenant_id = ?`, [id, request.admin.tenantId]);

    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const catName = sanitizeString(cat.name, 128);
      if (!catName) continue;

      const catResult = await connection.query(
        `INSERT INTO call_center_categories (
           call_center_id, tenant_id, category_name, sort_order
         ) VALUES (?, ?, ?, ?)`,
        [id, request.admin.tenantId, catName, i]
      );
      const categoryId = Number(catResult.insertId);

      if (Array.isArray(cat.agents)) {
        for (let j = 0; j < cat.agents.length; j++) {
          const agent = cat.agents[j];
          let avatarUrl = agent.avatarDataUrl || null;
          if (avatarUrl?.startsWith('data:')) {
            avatarUrl = await saveCallCenterImage(avatarUrl, 'avatar.png');
          } else if (avatarUrl?.startsWith('/api/')) {
            avatarUrl = avatarUrl.substring(4);
          }

          const sipAccountId = agent.ecardId;
          
          if (!sipAccountId) {
            await connection.rollback();
            return response.status(400).json({ code: -1, message: `坐席 ${agent.name || '(未命名)'} 缺少必要的电子名片关联，請檢查配置。` });
          }
          await connection.query(
            `INSERT INTO call_center_category_agents (
               call_center_id, category_id, tenant_id, sip_account_id, sip_number,
               display_name, avatar_url, job_title, phone, email, sort_order
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id, categoryId, request.admin.tenantId, sipAccountId,
              agent.sip || '', agent.name || 'Unknown', avatarUrl, agent.title || null,
              agent.phone || null, agent.email || null, j
            ]
          );
        }
      }
    }

    await connection.commit();
    return response.json({ code: 0, message: "呼叫中心配置已更新" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update call center:", error);
    return response.status(500).json({ code: -1, message: "更新呼叫中心失败" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /callcenter - 訪客端動態渲染頁
app.get("/callcenter", async (request, response) => {
  const slug = sanitizeString(String(request.query.id || ''), 100);
  if (!slug) return response.status(400).send("Invalid call center URL.");

  let connection;
  try {
    connection = await pool.getConnection();
    const [cc] = await connection.query(`SELECT * FROM call_centers WHERE center_slug = ? AND status = 'active' LIMIT 1`, [slug]);
    if (!cc) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>该呼叫中心不存在或已停用。</p>");
    }

    // 检查呼叫中心所属租戶套餐是否有效
    const planRows = await connection.query(`
      SELECT DATE_FORMAT(MAX(expires_at), '%Y-%m-%d') as tenant_expires_at
      FROM billing_orders
      WHERE tenant_id = ? AND order_status = 'review_approved'
    `, [cc.tenant_id]);
    
    const tenantExpiresAt = planRows[0]?.tenant_expires_at || null;
    if (tenantExpiresAt) {
      const expiresDate = new Date(`${tenantExpiresAt}T00:00:00Z`);
      const today = new Date();
      if (expiresDate.getTime() < today.getTime()) {
         return response.status(403).send("<h2 style='text-align:center;margin-top:20vh;color:red;'>403 Forbidden</h2><p style='text-align:center;'>服务不可用：企业套餐已過期。</p>");
      }
    } else {
       return response.status(403).send("<h2 style='text-align:center;margin-top:20vh;color:red;'>403 Forbidden</h2><p style='text-align:center;'>服务不可用：该企业未开通有效套餐。</p>");
    }

    const categoriesRows = await connection.query(`SELECT * FROM call_center_categories WHERE call_center_id = ? ORDER BY sort_order ASC`, [cc.id]);
    const agentsRows = await connection.query(`SELECT * FROM call_center_category_agents WHERE call_center_id = ? ORDER BY category_id ASC, sort_order ASC`, [cc.id]);

    // Get web accounts for agents with SIP accounts
    const agentSipIds = agentsRows.filter(a => a.sip_account_id).map(a => a.sip_account_id);
    let webAccountMap = {};
    if (agentSipIds.length > 0) {
      const webRows = await connection.query(
        `SELECT ent.sip_user_id, wu.username
         FROM tenant_web_account_entitlements ent
         JOIN web_users wu ON wu.id = ent.web_user_id
         WHERE ent.sip_user_id IN (?) AND ent.tenant_id = ? AND ent.status = 'active'`,
        [agentSipIds, cc.tenant_id]
      );
      webRows.forEach(r => { webAccountMap[Number(r.sip_user_id)] = r.username; });
    }

    const categories = categoriesRows.map(cat => {
      const agents = agentsRows.filter(a => a.category_id === cat.id).map(a => ({
        id: Number(a.id),
        ecardId: a.sip_account_id ? Number(a.sip_account_id) : null,
        sip: a.sip_number || '',
        web: a.sip_account_id ? (webAccountMap[Number(a.sip_account_id)] || '') : '',
        name: a.display_name || '',
        avatarDataUrl: a.avatar_url ? (a.avatar_url.startsWith('/') && !a.avatar_url.startsWith('/api/') ? `/api${a.avatar_url}` : a.avatar_url) : '',
        title: a.job_title || '',
        phone: a.phone || '',
        email: a.email || ''
      }));
      return { id: Number(cat.id), name: cat.category_name, agentCount: agents.length, agents };
    });

    const data = {
      id: Number(cc.id),
      name: cc.center_name,
      slug: cc.center_slug,
      logoDataUrl: cc.logo_url ? (cc.logo_url.startsWith('/') && !cc.logo_url.startsWith('/api/') ? `/api${cc.logo_url}` : cc.logo_url) : '',
      coverDataUrl: cc.cover_image_url ? (cc.cover_image_url.startsWith('/') && !cc.cover_image_url.startsWith('/api/') ? `/api${cc.cover_image_url}` : cc.cover_image_url) : '',
      description: cc.description || '',
      welcomeMessage: cc.welcome_text || '',
      visitorEnabled: Boolean(cc.require_visitor_info),
      visitorTitle: cc.visitor_info_form_title || '',
      visitorDescription: cc.visitor_info_form_desc || '',
      requiredFields: (() => { try { if (typeof cc.visitor_info_required_fields === 'object') return cc.visitor_info_required_fields || []; return cc.visitor_info_required_fields ? JSON.parse(cc.visitor_info_required_fields) : []; } catch(e) { return []; } })(),
      optionalFields: (() => { try { if (typeof cc.visitor_info_optional_fields === 'object') return cc.visitor_info_optional_fields || []; return cc.visitor_info_optional_fields ? JSON.parse(cc.visitor_info_optional_fields) : []; } catch(e) { return []; } })(),
      categories
    };

    // 载入模板、替换标题，注入动态数据
    const templatePath = path.resolve(projectRoot, "visitor-preview.html");
    let html = await readFile(templatePath, "utf-8");
    html = html.replace('<title>呼叫中心 - 訪客端預覽</title>', `<title>${data.name} - 企業呼叫中心</title>`);
    html = html.replace('</head>', `<script>window.__CALL_CENTER_DATA__ = ${JSON.stringify(data)};</script>\n</head>`);

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.send(html);
  } catch (error) {
    console.error("Failed to render visitor page:", error);
    return response.status(500).send("<h2 style='text-align:center;margin-top:20vh;'>500 Internal Error</h2><p style='text-align:center;'>系统繁忙，請稍後再試。</p>");
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/public/call-centers/:slug/visitor-submit - 访客提交登记表单
app.post("/api/public/call-centers/:slug/visitor-submit", async (request, response) => {
  const slug = sanitizeString(request.params.slug, 100);
  if (!slug) return response.status(400).json({ code: -1, message: "無效的链接。" });

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 128);
  const phone = sanitizeString(payload.phone, 64);
  const email = normalizeEmail(payload.email);
  const company = sanitizeString(payload.company, 128);
  const content = sanitizeString(payload.content, 1000);

  const visitorIp = request.ip || request.connection?.remoteAddress || "";
  const userAgent = request.get("user-agent") || "";

  let connection;
  try {
    connection = await pool.getConnection();
    const [cc] = await connection.query(`SELECT id, tenant_id, status FROM call_centers WHERE center_slug = ? LIMIT 1`, [slug]);
    
    if (!cc) return response.status(404).json({ code: -1, message: "该呼叫中心不存在。" });
    if (cc.status !== 'active') return response.status(403).json({ code: -1, message: "该呼叫中心已停用。" });

    await connection.query(
      `INSERT INTO call_center_visitor_inquiries (
         call_center_id, tenant_id, visitor_name, visitor_phone, visitor_email,
         visitor_company, visitor_message, visitor_ip, user_agent
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(cc.id), Number(cc.tenant_id),
        name || null, phone || null, email || '', company || null, content || null,
        visitorIp.slice(0, 64), userAgent.slice(0, 1000)
      ]
    );

    return response.json({ code: 0, message: "登记成功" });
  } catch (error) {
    console.error("Failed to save visitor submit:", error);
    return response.status(500).json({ code: -1, message: "系统繁忙，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/call-centers/:id/visitor-inquiries - 获取呼叫中心的访客记录
app.get("/api/call-centers/:id/visitor-inquiries", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以查看访客记录。" });
  }

  const callCenterId = Number(request.params.id);
  if (!Number.isInteger(callCenterId) || callCenterId <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心编号。" });

  const limit = Math.max(1, parseInt(request.query.limit || "10", 10));
  const offset = Math.max(0, parseInt(request.query.offset || "0", 10));
  const keyword = sanitizeString(request.query.keyword, 120);
  const startDate = sanitizeString(request.query.startDate, 20);
  const endDate = sanitizeString(request.query.endDate, 20);

  const whereClauses = ["tenant_id = ?", "call_center_id = ?"];
  const params = [request.admin.tenantId, callCenterId];

  if (keyword) {
    whereClauses.push("(visitor_name LIKE ? OR visitor_phone LIKE ? OR visitor_email LIKE ? OR visitor_company LIKE ? OR visitor_message LIKE ?)");
    const pattern = `%${keyword}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  if (startDate) {
    whereClauses.push("created_at >= ?");
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    whereClauses.push("created_at <= ?");
    params.push(`${endDate} 23:59:59`);
  }

  const whereSql = "WHERE " + whereClauses.join(" AND ");

  let connection;
  try {
    connection = await pool.getConnection();

    const [cc] = await connection.query(`SELECT id, center_name FROM call_centers WHERE id = ? AND tenant_id = ? LIMIT 1`, [callCenterId, request.admin.tenantId]);
    if (!cc) {
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    const countRows = await connection.query(`SELECT COUNT(*) AS total FROM call_center_visitor_inquiries ${whereSql}`, params);
    const total = Number(countRows[0]?.total || 0);

    const rows = await connection.query(`
      SELECT id, visitor_name, visitor_phone, visitor_email, visitor_company, visitor_message, inquiry_status, created_at
      FROM call_center_visitor_inquiries ${whereSql}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const formattedRows = rows.map(row => ({
      id: Number(row.id),
      visitorName: row.visitor_name || '-',
      visitorPhone: row.visitor_phone || '-',
      visitorEmail: row.visitor_email || '-',
      visitorCompany: row.visitor_company || '-',
      visitorMessage: row.visitor_message || '-',
      status: row.inquiry_status,
      createdAt: row.created_at
    }));

    return response.json({ code: 0, data: { list: formattedRows, total, centerName: cc.center_name } });
  } catch (error) {
    console.error("Failed to fetch visitor inquiries:", error);
    return response.status(500).json({ code: -1, message: "获取访客记录失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/call-centers/:callCenterId/visitor-inquiries - 批量/单条删除访客记录
app.delete("/api/call-centers/:callCenterId/visitor-inquiries", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以删除访客记录。" });
  }

  const callCenterId = Number(request.params.callCenterId);
  if (!Number.isInteger(callCenterId) || callCenterId <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心编号。" });

  const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(Number).filter(id => id > 0) : [];
  if (ids.length === 0) {
    return response.status(400).json({ code: -1, message: "請提供要删除的访客记录编号。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 校验呼叫中心是否存在且属于当前租戶
    const [cc] = await connection.query(`SELECT id FROM call_centers WHERE id = ? AND tenant_id = ? LIMIT 1`, [callCenterId, request.admin.tenantId]);
    if (!cc) {
      await connection.rollback();
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    // 删除记录，确保 tenant_id 和 call_center_id 匹配，防止越权删除
    const placeholders = ids.map(() => "?").join(",");
    const result = await connection.query(
      `DELETE FROM call_center_visitor_inquiries WHERE id IN (${placeholders}) AND tenant_id = ? AND call_center_id = ?`,
      [...ids, request.admin.tenantId, callCenterId]
    );

    await connection.commit();
    return response.json({ code: 0, message: `成功删除 ${result.affectedRows} 条访客记录。` });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete visitor inquiries:", error);
    return response.status(500).json({ code: -1, message: "删除访客记录失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/access-communities - 获取租戶的社區列表及统计
app.get("/api/access-communities", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以查看社區列表。" });
  }

  const keyword = sanitizeString(request.query.keyword, 120) || null;

  const whereClauses = ["tenant_id = ?"];
  const params = [request.admin.tenantId];
  if (keyword) {
    whereClauses.push("(name LIKE ? OR address LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = "WHERE " + whereClauses.join(" AND ");

  let connection;
  try {
    connection = await pool.getConnection();

    const statsRows = await connection.query(
      `SELECT COUNT(*) AS total FROM access_communities ${whereSql}`,
      params
    );
    const total = Number(statsRows[0]?.total || 0);

    const rows = await connection.query(
      `SELECT id, tenant_id, name, slug, address, latitude, longitude,
              service_scope, is_active, access_url, contact_person, contact_phone, contact_email,
              logo_url, banner_url, visitor_title, show_tips, tips_text,
              created_at, updated_at
       FROM access_communities ${whereSql}
       ORDER BY created_at DESC`,
      params
    );

    const communityIds = rows.map(r => r.id);

    // 查詢所有相關樓宇
    let buildingsMap = {};
    if (communityIds.length > 0) {
      try {
        const buildingRows = await connection.query(
          `SELECT b.id, b.tenant_id, b.community_id, b.name,
                  b.address, b.latitude, b.longitude, b.service_scope,
                  b.contact_person, b.contact_phone, b.contact_email,
                  b.created_at, b.updated_at
           FROM access_buildings b
           WHERE b.community_id IN (?) AND b.tenant_id = ?`,
          [communityIds, request.admin.tenantId]
        );

        const buildingIds = buildingRows.map(b => b.id);
        let roomsMap = {};
        if (buildingIds.length > 0) {
          try {
            const roomRows = await connection.query(
              `SELECT r.id, r.tenant_id, r.building_id, r.room_number, r.floor,
                      r.contact_person, r.contact_phone, r.contact_email,
                      r.sip_user_id,
                      COALESCE(s.display_name, s.username, '') AS sip_name,
                      COALESCE(s.username, '') AS sip_account
               FROM access_rooms r
               LEFT JOIN sip_users s ON s.id = r.sip_user_id
               WHERE r.building_id IN (?) AND r.tenant_id = ?`,
              [buildingIds, request.admin.tenantId]
            );
            for (const room of roomRows) {
              if (!roomsMap[String(room.building_id)]) roomsMap[String(room.building_id)] = [];
              roomsMap[String(room.building_id)].push({
                id: Number(room.id),
                buildingId: Number(room.building_id),
                roomNumber: room.room_number,
                floor: room.floor || null,
                contactPerson: room.contact_person || null,
                contactPhone: room.contact_phone || null,
                contactEmail: room.contact_email || null,
                sipUserId: room.sip_user_id ? Number(room.sip_user_id) : null,
                sipName: room.sip_name || null,
                sipAccount: room.sip_account || null,
              });
            }
          } catch (err) { console.error("查詢房間失敗:", err); }
        }

        // 查詢樓宇級入口
        let buildingEntrancesMap = {};
        if (buildingIds.length > 0) {
          try {
            const entRows = await connection.query(
              `SELECT e.id, e.name, e.community_id, e.building_id, e.device_id,
                      e.is_active,
                      COALESCE(g.device_uuid, '') AS device_name,
                      COALESCE(g.assignment_status, '') AS device_status,
                      e.address, e.latitude, e.longitude, e.service_scope,
                      e.contact_person, e.contact_phone, e.contact_email,
                      (SELECT COUNT(*) FROM access_room_entrance_auth WHERE entrance_id = e.id) AS auth_count
               FROM access_entrances e
               LEFT JOIN gate_devices g ON g.id = e.device_id
               WHERE e.building_id IN (?) AND e.tenant_id = ?`,
              [buildingIds, request.admin.tenantId]
            );
            for (const ent of entRows) {
              if (!buildingEntrancesMap[String(ent.building_id)]) buildingEntrancesMap[String(ent.building_id)] = [];
              buildingEntrancesMap[String(ent.building_id)].push({
                id: Number(ent.id),
                name: ent.name,
                isActive: ent.is_active == null ? true : !!ent.is_active,
                address: ent.address || null,
                latitude: ent.latitude,
                longitude: ent.longitude,
                serviceScope: ent.service_scope != null ? Number(ent.service_scope) : 0,
                contactPerson: ent.contact_person || null,
                contactPhone: ent.contact_phone || null,
                contactEmail: ent.contact_email || null,
                deviceId: ent.device_id ? Number(ent.device_id) : null,
                device: ent.device_name || null,
                deviceStatus: ent.device_status || "none",
                authCount: Number(ent.auth_count) || 0,
              });
            }
          } catch (err) { console.error("查詢樓宇入口失敗:", err); }
        }

        for (const b of buildingRows) {
          if (!buildingsMap[String(b.community_id)]) buildingsMap[String(b.community_id)] = [];
          buildingsMap[String(b.community_id)].push({
            id: Number(b.id),
            name: b.name,
            communityId: Number(b.community_id),
            address: b.address || null,
            latitude: b.latitude,
            longitude: b.longitude,
            serviceScope: b.service_scope != null ? Number(b.service_scope) : 0,
            contactPerson: b.contact_person || null,
            contactPhone: b.contact_phone || null,
            contactEmail: b.contact_email || null,
            rooms: roomsMap[String(b.id)] || [],
            entrances: buildingEntrancesMap[String(b.id)] || [],
          });
        }
      } catch (err) { console.error("查詢樓宇失敗:", err); }
    }

    // 查詢社區級入口
    let communityEntrancesMap = {};
    if (communityIds.length > 0) {
      try {
        const normalIds = communityIds.map(id => Number(id));
        const entRows = await connection.query(
          `SELECT e.id, e.name, e.community_id, e.building_id, e.device_id,
                  e.is_active,
                  COALESCE(g.device_uuid, '') AS device_name,
                  COALESCE(g.assignment_status, '') AS device_status,
                  e.address, e.latitude, e.longitude, e.service_scope,
                  e.contact_person, e.contact_phone, e.contact_email,
                  (SELECT COUNT(*) FROM access_room_entrance_auth WHERE entrance_id = e.id) AS auth_count
           FROM access_entrances e
           LEFT JOIN gate_devices g ON g.id = e.device_id
           WHERE e.community_id IN (?) AND e.tenant_id = ?`,
          [normalIds, request.admin.tenantId]
        );
        for (const ent of entRows) {
          if (!communityEntrancesMap[String(ent.community_id)]) communityEntrancesMap[String(ent.community_id)] = [];
          communityEntrancesMap[String(ent.community_id)].push({
            id: Number(ent.id),
            name: ent.name,
            isActive: ent.is_active == null ? true : !!ent.is_active,
            address: ent.address || null,
            latitude: ent.latitude,
            longitude: ent.longitude,
            serviceScope: ent.service_scope != null ? Number(ent.service_scope) : 0,
            contactPerson: ent.contact_person || null,
            contactPhone: ent.contact_phone || null,
            contactEmail: ent.contact_email || null,
            deviceId: ent.device_id ? Number(ent.device_id) : null,
            device: ent.device_name || null,
            deviceStatus: ent.device_status || "none",
            authCount: Number(ent.auth_count) || 0,
          });
        }
      } catch (err) { console.error("查詢社區入口失敗:", err); }
    }

    // 查詢權限矩陣
    let authMatrixMap = {};
    if (communityIds.length > 0) {
      try {
        const authRows = await connection.query(
          `SELECT ara.entrance_id, ara.room_id, r.building_id, b.community_id
           FROM access_room_entrance_auth ara
           JOIN access_rooms r ON r.id = ara.room_id
           JOIN access_buildings b ON b.id = r.building_id
           WHERE ara.tenant_id = ? AND b.community_id IN (?)`,
          [request.admin.tenantId, communityIds]
        );
        for (const a of authRows) {
          if (!authMatrixMap[String(a.community_id)]) authMatrixMap[String(a.community_id)] = {};
          if (!authMatrixMap[String(a.community_id)][String(a.entrance_id)]) authMatrixMap[String(a.community_id)][String(a.entrance_id)] = [];
          authMatrixMap[String(a.community_id)][String(a.entrance_id)].push(Number(a.room_id));
        }
      } catch (err) { console.error("查詢權限矩陣失敗:", err); }
    }

    response.json({
      code: 0,
      data: {
        total,
        list: rows.map(r => ({
          id: Number(r.id),
          tenantId: Number(r.tenant_id),
          name: r.name,
          slug: r.slug || null,
          address: r.address,
          latitude: r.latitude,
          longitude: r.longitude,
          serviceScope: r.service_scope,
          isActive: r.is_active == null ? true : !!r.is_active,
          accessUrl: r.access_url || null,
          logoUrl: r.logo_url || null,
          bannerUrl: r.banner_url || null,
          visitorTitle: r.visitor_title || null,
          showTips: r.show_tips == null ? true : !!r.show_tips,
          tipsText: r.tips_text || null,
          contactPerson: r.contact_person,
          contactPhone: r.contact_phone,
          contactEmail: r.contact_email,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          buildings: buildingsMap[String(r.id)] || [],
          communityEntrances: communityEntrancesMap[String(r.id)] || [],
          authMatrix: authMatrixMap[String(r.id)] || {},
        })),
      },
    });
  } catch (error) {
    console.error("獲取社區列表失敗:", error);
    response.status(500).json({ code: -1, message: "獲取社區列表失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-communities - 租戶新增社區
app.post("/api/access-communities", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理社區。" });
  }

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 100);
  if (!name) return response.status(400).json({ message: "請填寫社區名稱。" });

  const slug = sanitizeString(payload.slug, 64);
  if (!slug) return response.status(400).json({ message: "請提供唯一標識 Slug。" });

  const address = sanitizeString(payload.address, 500);
  if (!address) return response.status(400).json({ message: "請填寫社區地址。" });
  const latitude = payload.latitude != null && !isNaN(Number(payload.latitude)) ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null && !isNaN(Number(payload.longitude)) ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null && !isNaN(Number(payload.serviceScope)) ? Math.round(Number(payload.serviceScope)) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  const accessUrl = `${accessBaseUrl}/access/${slug}`;

  let connection;
  try {
    connection = await pool.getConnection();

    // 檢查 slug 唯一性
    const [existingSlug] = await connection.query(
      "SELECT id FROM access_communities WHERE slug = ? LIMIT 1",
      [slug]
    );
    if (existingSlug) return response.status(409).json({ message: "該唯一標識 Slug 已被佔用，請更換。" });

    const result = await connection.query(
      `INSERT INTO access_communities
         (tenant_id, name, slug, address, latitude, longitude, service_scope, contact_person, contact_phone, contact_email, access_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.admin.tenantId, name, slug, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, accessUrl]
    );
    response.status(201).json({
      code: 0,
      message: "社區已新增。",
      data: {
        id: Number(result.insertId),
        tenantId: request.admin.tenantId,
        name,
        slug,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
        accessUrl,
      }
    });
  } catch (error) {
    console.error("新增社區失敗:", error);
    response.status(500).json({ message: "新增社區失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-communities/:id - 編輯社區
app.put("/api/access-communities/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理社區。" });
  }

  const communityId = Number(request.params.id);
  if (!communityId) return response.status(400).json({ message: "無效的社區 ID。" });

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 100);
  if (!name) return response.status(400).json({ message: "請填寫社區名稱。" });

  const slug = sanitizeString(payload.slug, 64);
  if (!slug) return response.status(400).json({ message: "請提供唯一標識 Slug。" });

  const address = sanitizeString(payload.address, 500);
  if (!address) return response.status(400).json({ message: "請填寫社區地址。" });

  const latitude = payload.latitude != null && !isNaN(Number(payload.latitude)) ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null && !isNaN(Number(payload.longitude)) ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null && !isNaN(Number(payload.serviceScope)) ? Math.round(Number(payload.serviceScope)) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;
  const logoUrl = sanitizeString(payload.logoUrl, 500) || null;
  const bannerUrl = sanitizeString(payload.bannerUrl, 500) || null;
  const visitorTitle = sanitizeString(payload.visitorTitle, 255) || null;
  const showTips = payload.showTips != null ? (payload.showTips ? 1 : 0) : 1;
  const tipsText = sanitizeString(payload.tipsText, 500) || null;

  const accessUrl = `${accessBaseUrl}/access/${slug}`;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "社區不存在。" });

    // 檢查 slug 唯一性（排除自身）
    const [existingSlug] = await connection.query(
      "SELECT id FROM access_communities WHERE slug = ? AND id != ? LIMIT 1",
      [slug, communityId]
    );
    if (existingSlug) return response.status(409).json({ message: "該唯一標識 Slug 已被佔用，請更換。" });

    await connection.query(
      `UPDATE access_communities
       SET name = ?, slug = ?, address = ?, latitude = ?, longitude = ?, service_scope = ?,
           contact_person = ?, contact_phone = ?, contact_email = ?, access_url = ?,
           logo_url = ?, banner_url = ?, visitor_title = ?, show_tips = ?, tips_text = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, slug, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, accessUrl, logoUrl, bannerUrl, visitorTitle, showTips, tipsText, communityId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "社區已更新。",
      data: {
        id: communityId,
        tenantId: request.admin.tenantId,
        name,
        slug,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
        accessUrl,
      }
    });
  } catch (error) {
    console.error("編輯社區失敗:", error);
    response.status(500).json({ message: "編輯社區失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-communities/:id/toggle - 啟用/停用社區
app.put("/api/access-communities/:id/toggle", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理社區。" });
  }

  const communityId = Number(request.params.id);
  if (!communityId) return response.status(400).json({ message: "無效的社區 ID。" });

  const isActive = request.body && request.body.isActive ? 1 : 0;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, is_active FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "社區不存在。" });

    await connection.query(
      "UPDATE access_communities SET is_active = ? WHERE id = ? AND tenant_id = ?",
      [isActive, communityId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: isActive ? "社區已啟用。" : "社區已停用。",
      data: { id: communityId, isActive: !!isActive }
    });
  } catch (error) {
    console.error("切換社區狀態失敗:", error);
    response.status(500).json({ message: "操作失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-communities/:id - 刪除社區
app.delete("/api/access-communities/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理社區。" });
  }

  const communityId = Number(request.params.id);
  if (!communityId) return response.status(400).json({ message: "無效的社區 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "社區不存在。" });

    await connection.query(
      "DELETE FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );

    response.json({ code: 0, message: "社區已刪除。", data: { id: communityId } });
  } catch (error) {
    console.error("刪除社區失敗:", error);
    response.status(500).json({ message: "刪除社區失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-buildings - 新增樓宇
app.post("/api/access-buildings", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理樓宇。" });
  }

  const payload = request.body || {};
  const communityId = Number(payload.communityId);
  if (!communityId) return response.status(400).json({ message: "請提供所屬社區。" });

  const name = sanitizeString(payload.name, 255);
  if (!name) return response.status(400).json({ message: "請填寫樓宇名稱。" });

  const address = sanitizeString(payload.address, 500) || null;
  const latitude = payload.latitude != null ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null ? Number(payload.serviceScope) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  let connection;
  try {
    connection = await pool.getConnection();

    // 確認社區屬於該租戶
    const [community] = await connection.query(
      "SELECT id FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );
    if (!community) return response.status(404).json({ message: "社區不存在。" });

    const result = await connection.query(
      `INSERT INTO access_buildings
         (tenant_id, community_id, name, address, latitude, longitude, service_scope, contact_person, contact_phone, contact_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.admin.tenantId, communityId, name, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail]
    );
    response.status(201).json({
      code: 0,
      message: "樓宇已新增。",
      data: {
        id: Number(result.insertId),
        tenantId: request.admin.tenantId,
        communityId,
        name,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
        rooms: [],
        entrances: [],
      }
    });
  } catch (error) {
    console.error("新增樓宇失敗:", error);
    response.status(500).json({ message: "新增樓宇失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-buildings/:id - 編輯樓宇
app.put("/api/access-buildings/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理樓宇。" });
  }

  const buildingId = Number(request.params.id);
  if (!buildingId) return response.status(400).json({ message: "無效的樓宇 ID。" });

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 255);
  if (!name) return response.status(400).json({ message: "請填寫樓宇名稱。" });

  const address = sanitizeString(payload.address, 500) || null;
  const latitude = payload.latitude != null ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null ? Number(payload.serviceScope) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, community_id FROM access_buildings WHERE id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "樓宇不存在。" });

    await connection.query(
      `UPDATE access_buildings
       SET name = ?, address = ?, latitude = ?, longitude = ?, service_scope = ?,
           contact_person = ?, contact_phone = ?, contact_email = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, buildingId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "樓宇已更新。",
      data: {
        id: buildingId,
        tenantId: request.admin.tenantId,
        communityId: Number(existing.community_id),
        name,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
      }
    });
  } catch (error) {
    console.error("編輯樓宇失敗:", error);
    response.status(500).json({ message: "編輯樓宇失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-buildings/:id - 刪除樓宇
app.delete("/api/access-buildings/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理樓宇。" });
  }

  const buildingId = Number(request.params.id);
  if (!buildingId) return response.status(400).json({ message: "無效的樓宇 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, name FROM access_buildings WHERE id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "樓宇不存在。" });

    const [roomCount] = await connection.query(
      "SELECT COUNT(*) AS cnt FROM access_rooms WHERE building_id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );
    const [entranceCount] = await connection.query(
      "SELECT COUNT(*) AS cnt FROM access_entrances WHERE building_id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );

    const rooms = Number(roomCount.cnt) || 0;
    const entrances = Number(entranceCount.cnt) || 0;

    await connection.query(
      "DELETE FROM access_buildings WHERE id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "樓宇已刪除。",
      data: {
        id: buildingId,
        name: existing.name,
        roomsDeleted: rooms,
        entrancesDeleted: entrances,
      }
    });
  } catch (error) {
    console.error("刪除樓宇失敗:", error);
    response.status(500).json({ message: "刪除樓宇失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/sip-users/available - 獲取租戶可用的 SIP 用戶（已啟用且在有效期內）
app.get("/api/sip-users/available", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以查看 SIP 用戶。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT su.id, su.username, su.sip_domain, su.display_name, su.email,
              su.phone_number, su.status, su.service_expires_at,
              r2.id AS current_room_id,
              wu.username AS web_username
       FROM sip_users su
       LEFT JOIN access_rooms r2 ON r2.sip_user_id = su.id AND r2.tenant_id = su.tenant_id
       LEFT JOIN tenant_web_account_entitlements ent ON ent.sip_user_id = su.id AND ent.tenant_id = su.tenant_id AND ent.status = 'active'
       LEFT JOIN web_users wu ON wu.id = ent.web_user_id
       WHERE su.tenant_id = ?
         AND su.status = 'active'
         AND (su.service_expires_at IS NULL OR su.service_expires_at > NOW())
         AND (r2.id IS NULL OR r2.id = ?)
       ORDER BY su.username`,
      [request.admin.tenantId, Number(request.query.roomId) || 0]
    );
    const list = rows.map(r => ({
      id: Number(r.id),
      username: r.username,
      sipDomain: r.sip_domain,
      displayName: r.display_name || null,
      email: r.email,
      phoneNumber: r.phone_number || null,
      status: r.status,
      serviceExpiresAt: r.service_expires_at,
      currentRoomId: r.current_room_id ? Number(r.current_room_id) : null,
      webAccount: r.web_username || null,
    }));
    response.json({ code: 0, data: { list } });
  } catch (error) {
    console.error("獲取 SIP 用戶失敗:", error);
    response.status(500).json({ message: "獲取 SIP 用戶失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-rooms/:id/assign-sip - 為房間分配或取消 SIP 帳號
app.put("/api/access-rooms/:id/assign-sip", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理房間。" });
  }

  const roomId = Number(request.params.id);
  if (!roomId) return response.status(400).json({ message: "無效的房間 ID。" });

  const sipUserId = request.body.sipUserId != null ? Number(request.body.sipUserId) : null;

  let connection;
  try {
    connection = await pool.getConnection();

    const [room] = await connection.query(
      "SELECT id, room_number, building_id FROM access_rooms WHERE id = ? AND tenant_id = ?",
      [roomId, request.admin.tenantId]
    );
    if (!room) return response.status(404).json({ message: "房間不存在。" });

    if (sipUserId) {
      const [sipUser] = await connection.query(
        "SELECT id, username FROM sip_users WHERE id = ? AND tenant_id = ? AND status = 'active' AND (service_expires_at IS NULL OR service_expires_at > NOW())",
        [sipUserId, request.admin.tenantId]
      );
      if (!sipUser) return response.status(400).json({ message: "SIP 用戶不存在或已停用/過期。" });

      const [web] = await connection.query(
        `SELECT 1 FROM tenant_web_account_entitlements
         WHERE sip_user_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1`,
        [sipUserId, request.admin.tenantId]
      );
      if (!web) return response.status(400).json({ message: "該 SIP 帳號未配置 Web 帳號，無法分配。" });

      const [conflict] = await connection.query(
        "SELECT id, room_number FROM access_rooms WHERE sip_user_id = ? AND tenant_id = ? AND id != ?",
        [sipUserId, request.admin.tenantId, roomId]
      );
      if (conflict) return response.status(409).json({ message: `該 SIP 帳號已被房間「${conflict.room_number}」使用。` });
    }

    await connection.query(
      "UPDATE access_rooms SET sip_user_id = ? WHERE id = ? AND tenant_id = ?",
      [sipUserId, roomId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: sipUserId ? "SIP 帳號已分配。" : "SIP 帳號已取消分配。",
      data: { id: roomId, sipUserId }
    });
  } catch (error) {
    console.error("分配 SIP 帳號失敗:", error);
    response.status(500).json({ message: "操作失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-rooms - 新增房間
app.post("/api/access-rooms", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理房間。" });
  }

  const payload = request.body || {};
  const buildingId = Number(payload.buildingId);
  if (!buildingId) return response.status(400).json({ message: "請提供所屬樓宇。" });

  const roomNumber = sanitizeString(payload.roomNumber, 50);
  if (!roomNumber) return response.status(400).json({ message: "請填寫門牌號碼。" });

  const floor = sanitizeString(payload.floor, 50) || null;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;
  const sipUserId = payload.sipUserId != null ? Number(payload.sipUserId) : null;

  let connection;
  try {
    connection = await pool.getConnection();

    const [building] = await connection.query(
      "SELECT id FROM access_buildings WHERE id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );
    if (!building) return response.status(404).json({ message: "樓宇不存在。" });

    if (sipUserId) {
      const [sipUser] = await connection.query(
        "SELECT id FROM sip_users WHERE id = ? AND tenant_id = ?",
        [sipUserId, request.admin.tenantId]
      );
      if (!sipUser) return response.status(400).json({ message: "SIP 用戶不存在。" });
    }

    const [dup] = await connection.query(
      "SELECT id FROM access_rooms WHERE building_id = ? AND tenant_id = ? AND room_number = ?",
      [buildingId, request.admin.tenantId, roomNumber]
    );
    if (dup) return response.status(409).json({ message: `該樓宇下已存在門牌號碼「${roomNumber}」。` });

    const result = await connection.query(
      `INSERT INTO access_rooms
         (tenant_id, building_id, room_number, floor, contact_person, contact_phone, contact_email, sip_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.admin.tenantId, buildingId, roomNumber, floor, contactPerson, contactPhone, contactEmail, sipUserId]
    );
    response.status(201).json({
      code: 0,
      message: "房間已新增。",
      data: {
        id: Number(result.insertId),
        tenantId: request.admin.tenantId,
        buildingId,
        roomNumber,
        floor,
        contactPerson,
        contactPhone,
        contactEmail,
        sipUserId,
        sipName: null,
        sipAccount: null,
      }
    });
  } catch (error) {
    console.error("新增房間失敗:", error);
    response.status(500).json({ message: "新增房間失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-rooms/:id - 編輯房間
app.put("/api/access-rooms/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理房間。" });
  }

  const roomId = Number(request.params.id);
  if (!roomId) return response.status(400).json({ message: "無效的房間 ID。" });

  const payload = request.body || {};
  const roomNumber = sanitizeString(payload.roomNumber, 50);
  if (!roomNumber) return response.status(400).json({ message: "請填寫門牌號碼。" });

  const floor = sanitizeString(payload.floor, 50) || null;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, building_id FROM access_rooms WHERE id = ? AND tenant_id = ?",
      [roomId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "房間不存在。" });

    const [dup] = await connection.query(
      "SELECT id FROM access_rooms WHERE building_id = ? AND tenant_id = ? AND room_number = ? AND id != ?",
      [existing.building_id, request.admin.tenantId, roomNumber, roomId]
    );
    if (dup) return response.status(409).json({ message: `該樓宇下已存在門牌號碼「${roomNumber}」。` });

    await connection.query(
      `UPDATE access_rooms
       SET room_number = ?, floor = ?, contact_person = ?, contact_phone = ?, contact_email = ?
       WHERE id = ? AND tenant_id = ?`,
      [roomNumber, floor, contactPerson, contactPhone, contactEmail, roomId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "房間已更新。",
      data: {
        id: roomId,
        tenantId: request.admin.tenantId,
        buildingId: Number(existing.building_id),
        roomNumber,
        floor,
        contactPerson,
        contactPhone,
        contactEmail,
      }
    });
  } catch (error) {
    console.error("編輯房間失敗:", error);
    response.status(500).json({ message: "編輯房間失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-rooms/:id - 刪除房間
app.delete("/api/access-rooms/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理房間。" });
  }

  const roomId = Number(request.params.id);
  if (!roomId) return response.status(400).json({ message: "無效的房間 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, room_number FROM access_rooms WHERE id = ? AND tenant_id = ?",
      [roomId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "房間不存在。" });

    await connection.query(
      "DELETE FROM access_rooms WHERE id = ? AND tenant_id = ?",
      [roomId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "房間已刪除。",
      data: { id: roomId, roomNumber: existing.room_number }
    });
  } catch (error) {
    console.error("刪除房間失敗:", error);
    response.status(500).json({ message: "刪除房間失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-entrances - 新增入口
app.post("/api/access-entrances", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 255);
  if (!name) return response.status(400).json({ message: "請填寫入口名稱。" });

  const communityId = payload.communityId != null ? Number(payload.communityId) : null;
  const buildingId = payload.buildingId != null ? Number(payload.buildingId) : null;

  if ((communityId && buildingId) || (!communityId && !buildingId)) {
    return response.status(400).json({ message: "入口必須綁定社區或樓宇（二選一）。" });
  }

  const deviceId = payload.deviceId != null ? Number(payload.deviceId) : null;
  const address = sanitizeString(payload.address, 500) || null;
  const latitude = payload.latitude != null && !isNaN(Number(payload.latitude)) ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null && !isNaN(Number(payload.longitude)) ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null && !isNaN(Number(payload.serviceScope)) ? Math.round(Number(payload.serviceScope)) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  let connection;
  try {
    connection = await pool.getConnection();

    // 检查入口名稱唯一性（同一租戶下）
    const [existingName] = await connection.query(
      "SELECT id FROM access_entrances WHERE tenant_id = ? AND name = ? LIMIT 1",
      [request.admin.tenantId, name]
    );
    if (existingName) return response.status(409).json({ message: "該入口名稱已被佔用，請更換。" });

    if (communityId) {
      const [community] = await connection.query(
        "SELECT id FROM access_communities WHERE id = ? AND tenant_id = ?",
        [communityId, request.admin.tenantId]
      );
      if (!community) return response.status(404).json({ message: "社區不存在。" });
    }

    if (buildingId) {
      const [building] = await connection.query(
        "SELECT id FROM access_buildings WHERE id = ? AND tenant_id = ?",
        [buildingId, request.admin.tenantId]
      );
      if (!building) return response.status(404).json({ message: "樓宇不存在。" });
    }

    if (deviceId) {
      const [device] = await connection.query(
        "SELECT id FROM gate_devices WHERE id = ? AND tenant_id = ?",
        [deviceId, request.admin.tenantId]
      );
      if (!device) return response.status(400).json({ message: "設備不存在。" });
    }

    const result = await connection.query(
      `INSERT INTO access_entrances
         (tenant_id, community_id, building_id, name, address, latitude, longitude, service_scope, contact_person, contact_phone, contact_email, device_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [request.admin.tenantId, communityId, buildingId, name, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, deviceId]
    );
    response.status(201).json({
      code: 0,
      message: "入口已新增。",
      data: {
        id: Number(result.insertId),
        tenantId: request.admin.tenantId,
        communityId,
        buildingId,
        name,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
        deviceId,
        isActive: false,
        device: deviceId ? payload.deviceName || null : null,
        deviceStatus: deviceId ? "offline" : "none",
      }
    });
  } catch (error) {
    console.error("新增入口失敗:", error);
    response.status(500).json({ message: "新增入口失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-entrances/:id - 編輯入口
app.put("/api/access-entrances/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const entranceId = Number(request.params.id);
  if (!entranceId) return response.status(400).json({ message: "無效的入口 ID。" });

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 255);
  if (!name) return response.status(400).json({ message: "請填寫入口名稱。" });

  const address = sanitizeString(payload.address, 500) || null;
  const latitude = payload.latitude != null && !isNaN(Number(payload.latitude)) ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null && !isNaN(Number(payload.longitude)) ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null && !isNaN(Number(payload.serviceScope)) ? Math.round(Number(payload.serviceScope)) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  let connection;
  try {
    connection = await pool.getConnection();

    const [entrance] = await connection.query(
      "SELECT id, tenant_id, community_id, building_id FROM access_entrances WHERE id = ? AND tenant_id = ?",
      [entranceId, request.admin.tenantId]
    );
    if (!entrance) return response.status(404).json({ message: "入口不存在。" });

    // 檢查名稱唯一性（排除自身）
    const [existingName] = await connection.query(
      "SELECT id FROM access_entrances WHERE tenant_id = ? AND name = ? AND id != ? LIMIT 1",
      [request.admin.tenantId, name, entranceId]
    );
    if (existingName) return response.status(409).json({ message: "該入口名稱已被佔用，請更換。" });

    await connection.query(
      `UPDATE access_entrances
       SET name = ?, address = ?, latitude = ?, longitude = ?, service_scope = ?,
           contact_person = ?, contact_phone = ?, contact_email = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, entranceId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "入口已更新。",
      data: {
        id: entranceId,
        tenantId: request.admin.tenantId,
        communityId: entrance.community_id ? Number(entrance.community_id) : null,
        buildingId: entrance.building_id ? Number(entrance.building_id) : null,
        name,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
      }
    });
  } catch (error) {
    console.error("編輯入口失敗:", error);
    response.status(500).json({ message: "編輯入口失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/tenant/gate-devices - 租戶查看可用設備列表
app.get("/api/tenant/gate-devices", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以查看。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    // Show: unassigned devices + devices assigned to this tenant
    const entranceId = request.query.entranceId ? Number(request.query.entranceId) : 0;
    const allMode = request.query.all === '1';
    let rows;
    if (allMode) {
      // Return ALL devices for this tenant (for stats): unassigned + assigned to this tenant
      rows = await connection.query(
        `SELECT gd.id, gd.device_uuid, gd.relay_id, gd.assignment_status, gd.tenant_id, gd.assigned_at, gd.expires_at
         FROM gate_devices gd
         WHERE gd.assignment_status = 'unassigned'
            OR (gd.assignment_status = 'assigned' AND gd.tenant_id = ?)
         ORDER BY gd.device_uuid`,
        [request.admin.tenantId]
      );
    } else {
      rows = await connection.query(
        `SELECT gd.id, gd.device_uuid, gd.relay_id, gd.assignment_status, gd.tenant_id, gd.assigned_at, gd.expires_at
         FROM gate_devices gd
         WHERE (gd.assignment_status = 'unassigned'
                OR (gd.assignment_status = 'assigned' AND gd.tenant_id = ?)
                OR gd.id = (SELECT ae2.device_id FROM access_entrances ae2 WHERE ae2.id = ?))
           AND NOT EXISTS (SELECT 1 FROM access_entrances ae WHERE ae.device_id = gd.id AND ae.id != ?)
         ORDER BY gd.device_uuid`,
        [request.admin.tenantId, entranceId, entranceId]
      );
    }
    response.json({
      devices: rows.map(r => ({
        id: Number(r.id),
        uuid: r.device_uuid || '',
        relayId: r.relay_id || '',
        status: r.assignment_status || 'unassigned',
        tenantId: r.tenant_id ? Number(r.tenant_id) : null,
        assignedAt: r.assigned_at ? new Date(r.assigned_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-') : '',
        expiresAt: r.expires_at ? new Date(r.expires_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-') : '',
      })),
    });
  } catch (error) {
    console.error("Failed to fetch tenant devices:", error);
    response.status(500).json({ message: "獲取設備列表失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-entrances/:id/device - 為入口分配或更換設備
app.put("/api/access-entrances/:id/device", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const entranceId = Number(request.params.id);
  if (!entranceId) return response.status(400).json({ message: "無效的入口 ID。" });

  const deviceId = request.body.deviceId != null ? Number(request.body.deviceId) : null;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [entrance] = await connection.query(
      "SELECT id, name, device_id, tenant_id FROM access_entrances WHERE id = ? AND tenant_id = ? FOR UPDATE",
      [entranceId, request.admin.tenantId]
    );
    if (!entrance) {
      await connection.rollback();
      return response.status(404).json({ message: "入口不存在。" });
    }

    // Free the old device if any
    if (entrance.device_id) {
      await connection.query(
        "UPDATE gate_devices SET tenant_id = NULL, assignment_status = 'unassigned', assigned_at = NULL, expires_at = NULL WHERE id = ?",
        [Number(entrance.device_id)]
      );
    }

    // Assign new device if provided
    if (deviceId) {
      const [device] = await connection.query(
        "SELECT id, assignment_status FROM gate_devices WHERE id = ? FOR UPDATE",
        [deviceId]
      );
      if (!device) {
        await connection.rollback();
        return response.status(404).json({ message: "設備不存在。" });
      }
      // Check if device is already assigned to another entrance
      const [otherEntrance] = await connection.query(
        "SELECT id, name FROM access_entrances WHERE device_id = ? AND id != ?",
        [deviceId, entranceId]
      );
      if (otherEntrance) {
        await connection.rollback();
        return response.status(409).json({ message: `該設備已綁定入口「${otherEntrance.name}」。` });
      }

      // Calculate expiry from tenant's latest plan expiry
      const [planExpiry] = await connection.query(
        `SELECT MAX(expires_at) AS latest FROM billing_orders
         WHERE tenant_id = ? AND expires_at IS NOT NULL AND expires_at > NOW()`,
        [request.admin.tenantId]
      );
      const expiresAt = planExpiry?.latest || null;

      // Update device status
      await connection.query(
        "UPDATE gate_devices SET tenant_id = ?, assignment_status = 'assigned', assigned_at = NOW(), expires_at = ? WHERE id = ?",
        [request.admin.tenantId, expiresAt, deviceId]
      );
    }

    // Update entrance
    await connection.query(
      deviceId
        ? "UPDATE access_entrances SET device_id = ?, is_active = 1 WHERE id = ?"
        : "UPDATE access_entrances SET device_id = NULL, is_active = 0 WHERE id = ?",
      deviceId ? [deviceId, entranceId] : [entranceId]
    );

    await connection.commit();

    response.json({
      code: 0,
      message: deviceId ? "設備已綁定。" : "設備已取消綁定。",
      data: { entranceId, deviceId }
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("綁定設備失敗:", error);
    response.status(500).json({ message: "操作失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-entrances/:id/toggle - 啟用/停用入口
app.put("/api/access-entrances/:id/toggle", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const entranceId = Number(request.params.id);
  if (!entranceId) return response.status(400).json({ message: "無效的入口 ID。" });

  const isActive = request.body && request.body.isActive ? 1 : 0;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, is_active, device_id FROM access_entrances WHERE id = ? AND tenant_id = ?",
      [entranceId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "入口不存在。" });

    if (isActive && !existing.device_id) {
      return response.status(400).json({ message: "未綁定設備的入口無法啟用，請先綁定設備。" });
    }

    await connection.query(
      "UPDATE access_entrances SET is_active = ? WHERE id = ? AND tenant_id = ?",
      [isActive, entranceId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: isActive ? "入口已啟用。" : "入口已停用。",
      data: { id: entranceId, isActive: !!isActive }
    });
  } catch (error) {
    console.error("切換入口狀態失敗:", error);
    response.status(500).json({ message: "操作失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-entrances/:id - 刪除入口
app.delete("/api/access-entrances/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const entranceId = Number(request.params.id);
  if (!entranceId) return response.status(400).json({ message: "無效的入口 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [entrance] = await connection.query(
      "SELECT id FROM access_entrances WHERE id = ? AND tenant_id = ?",
      [entranceId, request.admin.tenantId]
    );
    if (!entrance) return response.status(404).json({ message: "入口不存在。" });

    await connection.query(
      "DELETE FROM access_entrances WHERE id = ? AND tenant_id = ?",
      [entranceId, request.admin.tenantId]
    );

    response.json({ code: 0, message: "入口已刪除。" });
  } catch (error) {
    console.error("刪除入口失敗:", error);
    response.status(500).json({ message: "刪除入口失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-entrances/:entranceId/auth/building/:buildingId - 批量授權樓宇全部房間
app.put("/api/access-entrances/:entranceId/auth/building/:buildingId", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const buildingId = Number(request.params.buildingId);
  if (!entranceId || !buildingId) return response.status(400).json({ message: "無效的參數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    // Verify entrance and building belong to tenant
    const [entrance] = await connection.query("SELECT id FROM access_entrances WHERE id = ? AND tenant_id = ?", [entranceId, request.admin.tenantId]);
    if (!entrance) return response.status(404).json({ message: "入口不存在。" });
    const [building] = await connection.query("SELECT id FROM access_buildings WHERE id = ? AND tenant_id = ?", [buildingId, request.admin.tenantId]);
    if (!building) return response.status(404).json({ message: "樓宇不存在。" });

    // Insert auth for all rooms in the building that don't already have it
    await connection.query(
      `INSERT IGNORE INTO access_room_entrance_auth (tenant_id, entrance_id, room_id)
       SELECT ?, ?, r.id FROM access_rooms r WHERE r.building_id = ? AND r.tenant_id = ?`,
      [request.admin.tenantId, entranceId, buildingId, request.admin.tenantId]
    );
    response.json({ code: 0, message: "樓宇全部房間已授權。" });
  } catch (error) {
    console.error("批量授權失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-entrances/:entranceId/auth/building/:buildingId - 批量取消樓宇全部房間授權
app.delete("/api/access-entrances/:entranceId/auth/building/:buildingId", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const buildingId = Number(request.params.buildingId);
  if (!entranceId || !buildingId) return response.status(400).json({ message: "無效的參數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `DELETE FROM access_room_entrance_auth
       WHERE entrance_id = ? AND tenant_id = ?
         AND room_id IN (SELECT id FROM access_rooms WHERE building_id = ? AND tenant_id = ?)`,
      [entranceId, request.admin.tenantId, buildingId, request.admin.tenantId]
    );
    response.json({ code: 0, message: `已取消 ${result.affectedRows} 個房間的授權。` });
  } catch (error) {
    console.error("批量取消授權失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-entrances/:entranceId/auth/rooms - 批量授權房間
app.post("/api/access-entrances/:entranceId/auth/rooms", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const roomIds = (request.body?.roomIds || []).map(Number).filter(Boolean);
  if (!entranceId || roomIds.length === 0) return response.status(400).json({ message: "無效的參數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [entrance] = await connection.query("SELECT id FROM access_entrances WHERE id = ? AND tenant_id = ?", [entranceId, request.admin.tenantId]);
    if (!entrance) return response.status(404).json({ message: "入口不存在。" });

    const placeholders = roomIds.map(() => "(?, ?, ?)").join(", ");
    const values = roomIds.flatMap(id => [request.admin.tenantId, entranceId, id]);
    await connection.query(
      `INSERT IGNORE INTO access_room_entrance_auth (tenant_id, entrance_id, room_id) VALUES ${placeholders}`,
      values
    );
    response.json({ code: 0, message: `已授權 ${roomIds.length} 個房間。` });
  } catch (error) {
    console.error("批量授權房間失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-entrances/:entranceId/auth/rooms - 批量取消房間授權
app.delete("/api/access-entrances/:entranceId/auth/rooms", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const roomIds = (request.body?.roomIds || []).map(Number).filter(Boolean);
  if (!entranceId || roomIds.length === 0) return response.status(400).json({ message: "無效的參數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const placeholders = roomIds.map(() => "?").join(", ");
    await connection.query(
      `DELETE FROM access_room_entrance_auth WHERE entrance_id = ? AND tenant_id = ? AND room_id IN (${placeholders})`,
      [entranceId, request.admin.tenantId, ...roomIds]
    );
    response.json({ code: 0, message: `已取消 ${roomIds.length} 個房間的授權。` });
  } catch (error) {
    console.error("批量取消授權失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-entrances/:entranceId/auth/:roomId - 取消房間授權
app.delete("/api/access-entrances/:entranceId/auth/:roomId", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const roomId = Number(request.params.roomId);
  if (!entranceId || !roomId) return response.status(400).json({ message: "無效的參數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      "DELETE FROM access_room_entrance_auth WHERE entrance_id = ? AND room_id = ? AND tenant_id = ?",
      [entranceId, roomId, request.admin.tenantId]
    );
    if (result.affectedRows === 0) return response.status(404).json({ message: "授權記錄不存在。" });
    response.json({ code: 0, message: "授權已取消。" });
  } catch (error) {
    console.error("取消授權失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/public/visitor/community/:slug - 訪客拜訪頁獲取社區資料
app.get("/api/public/visitor/community/:slug", async (request, response) => {
  const slug = request.params.slug;
  if (!slug) return response.status(400).json({ code: -1, message: "缺少社區參數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [community] = await connection.query(
      `SELECT id, tenant_id, name, address, slug, service_scope, contact_person, contact_phone, contact_email
       FROM access_communities WHERE slug = ? AND is_active = 1 LIMIT 1`,
      [slug]
    );
    if (!community) return response.status(404).json({ code: -1, message: "社區不存在或已停用。" });

    const buildings = await connection.query(
      `SELECT b.id, b.name, b.address
       FROM access_buildings b WHERE b.community_id = ? AND b.tenant_id = ?
       ORDER BY b.name`,
      [community.id, community.tenant_id]
    );

    const buildingIds = buildings.map(b => b.id);
    let rooms = [];
    if (buildingIds.length > 0) {
      rooms = await connection.query(
        `SELECT r.id, r.building_id, r.room_number, r.floor,
                COALESCE(s.display_name, s.username, '') AS resident_name
         FROM access_rooms r
         LEFT JOIN sip_users s ON s.id = r.sip_user_id
         WHERE r.building_id IN (?) AND r.tenant_id = ?
         ORDER BY r.room_number`,
        [buildingIds, community.tenant_id]
      );
    }

    response.json({
      code: 0,
      data: {
        id: Number(community.id),
        name: community.name,
        address: community.address || null,
        slug: community.slug,
        contactPerson: community.contact_person || null,
        contactPhone: community.contact_phone || null,
        buildings: buildings.map(b => ({
          id: Number(b.id),
          name: b.name,
          address: b.address || null,
        })),
        rooms: rooms.map(r => ({
          id: Number(r.id),
          buildingId: Number(r.building_id),
          roomNumber: r.room_number,
          floor: r.floor || null,
          residentName: r.resident_name || null,
        })),
      }
    });
  } catch (error) {
    console.error("獲取訪客社區資料失敗:", error);
    response.status(500).json({ code: -1, message: "獲取社區資料失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/upload/community-image - 上傳社區圖片（Logo / Banner）
app.post("/api/upload/community-image", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以上傳圖片。" });
  }

  const imageDir = path.join(projectRoot, "assets/community-images");
  try { await mkdir(imageDir, { recursive: true }); } catch {}

  const chunks = [];
  let boundary = null;
  const ct = request.get("content-type") || "";
  const bm = ct.match(/boundary=(.+)/);
  if (bm) boundary = bm[1];

  if (!boundary) {
    return response.status(400).json({ message: "無效的上傳請求。" });
  }

  request.on("data", chunk => chunks.push(chunk));
  request.on("end", async () => {
    try {
      let filename = `img-${Date.now()}-${Math.random().toString(36).slice(2,6)}.png`;
      const body = Buffer.concat(chunks);
      const str = body.toString("binary");
      const parts = str.split("--" + boundary);
      for (const part of parts) {
        if (!part.includes("filename=")) continue;
        const fnMatch = part.match(/filename="([^"]+)"/);
        if (fnMatch) {
          const ext = path.extname(fnMatch[1]) || ".png";
          filename = `cc-${Date.now()}-${Math.random().toString(36).slice(2,10)}${ext}`;
        }
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd < 0) continue;
        let fileData = part.substring(headerEnd + 4);
        if (fileData.endsWith("\r\n")) fileData = fileData.slice(0, -2);
        const savePath = path.join(imageDir, filename);
        await writeFile(savePath, Buffer.from(fileData, "binary"));
        const url = `/api/community-images/${filename}`;
        return response.json({ code: 0, url });
      }
      return response.status(400).json({ message: "未檢測到上傳文件。" });
    } catch (err) {
      console.error("Upload error:", err);
      return response.status(500).json({ message: "上傳失敗。" });
    }
  });
});

// Serve uploaded community images
app.use("/api/community-images", express.static(path.join(projectRoot, "assets/community-images")));


// ==========================================
// Platform Admin Management API (super_admin only)
// ==========================================

// GET /api/platform/admins - list all platform admins
app.get("/api/platform/admins", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超级管理员可以管理平台管理员。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const admins = await connection.query(
      "SELECT id, email, display_name, phone_number, platform_role, status, last_login_at, created_at FROM admin_users WHERE account_type = 'platform' ORDER BY created_at DESC"
    );
    return response.json({
      admins: admins.map(a => ({
        id: Number(a.id),
        email: a.email || "",
        displayName: a.display_name || "",
        phoneNumber: a.phone_number || "",
        platformRole: a.platform_role || "admin",
        status: a.status || 'active',
        lastLoginAt: a.last_login_at || null,
        createdAt: a.created_at || null,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch platform admins:", error);
    return response.status(500).json({ message: "获取管理员列表失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/platform/admins - create a platform admin
app.post("/api/platform/admins", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超级管理员可以管理平台管理员。" });
  }
  const email = sanitizeString(request.body?.email, 255);
  const password = String(request.body?.password || "");
  const displayName = sanitizeString(request.body?.displayName, 120);
  const phoneNumber = sanitizeString(request.body?.phoneNumber, 40);
  const platformRole = ["admin","operator","finance","support","auditor"].includes(request.body?.platformRole)
    ? request.body.platformRole : "admin";

  if (!email || !isValidEmail(email)) return response.status(400).json({ message: "请输入有效的电子邮箱。" });
  if (password.length < 6) return response.status(400).json({ message: "密码至少需要 6 个字符。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [existing] = await connection.query("SELECT id FROM admin_users WHERE email = ?", [email]);
    if (existing) {
      return response.status(409).json({ message: "该邮箱已被使用。" });
    }
    const passwordHash = await hashPassword(password);
    const result = await connection.query(
      "INSERT INTO admin_users (email, password_hash, display_name, phone_number, account_type, platform_role, status) VALUES (?, ?, ?, ?, 'platform', ?, 'active')",
      [email, passwordHash, displayName || null, phoneNumber || null, platformRole]
    );
    return response.status(201).json({
      message: "平台管理员已创建。",
      admin: { id: Number(result.insertId), email, displayName, platformRole, status: 'active' },
    });
  } catch (error) {
    console.error("Failed to create platform admin:", error);
    return response.status(500).json({ message: "创建管理员失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/platform/admins/:id - update a platform admin
app.put("/api/platform/admins/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超级管理员可以管理平台管理员。" });
  }
  const adminId = Number(request.params.id);
  if (!Number.isInteger(adminId) || adminId <= 0) return response.status(400).json({ message: "管理员编号无效。" });

  const email = sanitizeString(request.body?.email, 255);
  const displayName = sanitizeString(request.body?.displayName, 120);
  const phoneNumber = sanitizeString(request.body?.phoneNumber, 40);
  const platformRole = ["admin","operator","finance","support","auditor"].includes(request.body?.platformRole)
    ? request.body.platformRole : null;
  const password = String(request.body?.password || "");

  if (email && !isValidEmail(email)) return response.status(400).json({ message: "请输入有效的电子邮箱。" });
  if (password && password.length < 6) return response.status(400).json({ message: "密码至少需要 6 个字符。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [existing] = await connection.query("SELECT id FROM admin_users WHERE id = ? AND account_type = 'platform'", [adminId]);
    if (!existing) return response.status(404).json({ message: "管理员不存在。" });
    if (existing.platform_role === "super_admin" && adminId !== request.admin.id) {
      return response.status(403).json({ message: "不能修改超级管理员的角色。" });
    }

    let sql = "UPDATE admin_users SET ";
    const params = [];
    const sets = [];
    if (email) { sets.push("email = ?"); params.push(email); }
    if (displayName !== undefined) { sets.push("display_name = ?"); params.push(displayName || null); }
    if (phoneNumber !== undefined) { sets.push("phone_number = ?"); params.push(phoneNumber || null); }
    if (platformRole) { sets.push("platform_role = ?"); params.push(platformRole); }
    if (password) { sets.push("password_hash = ?"); params.push(await hashPassword(password)); }
    if (sets.length === 0) return response.status(400).json({ message: "没有要更新的字段。" });
    sql += sets.join(", ") + " WHERE id = ? AND account_type = 'platform'";
    params.push(adminId);
    await connection.query(sql, params);
    return response.json({ message: "管理员信息已更新。" });
  } catch (error) {
    console.error("Failed to update platform admin:", error);
    return response.status(500).json({ message: "更新管理员失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/platform/admins/:id/status - toggle platform admin status
app.put("/api/platform/admins/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超级管理员可以管理平台管理员。" });
  }
  const adminId = Number(request.params.id);
  if (!Number.isInteger(adminId) || adminId <= 0) return response.status(400).json({ message: "管理员编号无效。" });
  const status = request.body?.status === 'disabled' ? 'disabled' : 'active';

  let connection;
  try {
    connection = await pool.getConnection();
    const [existing] = await connection.query("SELECT id, platform_role FROM admin_users WHERE id = ? AND account_type = 'platform'", [adminId]);
    if (!existing) return response.status(404).json({ message: "管理员不存在。" });
    if (existing.platform_role === "super_admin") {
      return response.status(403).json({ message: "不能停用超级管理员。" });
    }
    await connection.query("UPDATE admin_users SET status = ? WHERE id = ?", [status, adminId]);
    return response.json({ message: status === 'active' ? "管理员已启 用。" : "管理员已停用。" });
  } catch (error) {
    console.error("Failed to toggle platform admin status:", error);
    return response.status(500).json({ message: "状态切换失败。" });
  } finally {
    if (connection) connection.release();
  }
});


// DELETE /api/platform/admins/:id - delete a platform admin
app.delete("/api/platform/admins/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超级管理员可以管理平台管理员。" });
  }
  const adminId = Number(request.params.id);
  if (!Number.isInteger(adminId) || adminId <= 0) return response.status(400).json({ message: "管理员编号无效。" });
  let connection;
  try {
    connection = await pool.getConnection();
    const [existing] = await connection.query("SELECT id, platform_role FROM admin_users WHERE id = ? AND account_type = 'platform'", [adminId]);
    if (!existing) return response.status(404).json({ message: "管理员不存在。" });
    if (existing.platform_role === "super_admin") return response.status(403).json({ message: "不能删除超级管理员。" });
    await connection.query("DELETE FROM admin_sessions WHERE admin_user_id = ?", [adminId]);
    await connection.query("DELETE FROM admin_users WHERE id = ?", [adminId]);
    return response.json({ message: "管理员已删除。" });
  } catch (error) {
    console.error("Failed to delete platform admin:", error);
    return response.status(500).json({ message: "删除管理员失败。" });
  } finally {
    if (connection) connection.release();
  }
});
// ==========================================
// Platform Health API (platform admin only)
// ==========================================

function readProcFile(filePath) {
  try { return readFileSync(filePath, "utf8"); } catch { return ""; }
}

function parseCpuUsage() {
  const content = readProcFile("/proc/stat");
  const cpuLine = content.split("\n").find(l => l.startsWith("cpu "));
  if (!cpuLine) return null;
  const fields = cpuLine.trim().split(/\s+/).slice(1).map(Number);
  const idle = fields[3] + (fields[4] || 0);
  const total = fields.reduce((a, b) => a + b, 0);
  return { idle, total };
}

let cpuSnapshot = null;
// Initialize snapshot immediately, then refresh every second
cpuSnapshot = parseCpuUsage();
setInterval(() => { cpuSnapshot = parseCpuUsage(); }, 1000);

function getCpuUsage() {
  const prev = cpuSnapshot;
  if (!prev) return null;
  const curr = parseCpuUsage();
  if (!curr) return null;
  const totalDiff = curr.total - prev.total;
  const idleDiff = curr.idle - prev.idle;
  if (totalDiff <= 0) return null;
  return Math.round((1 - idleDiff / totalDiff) * 100);
}

function getMemoryUsage() {
  const content = readProcFile("/proc/meminfo");
  const get = (key) => { const m = content.match(new RegExp(key + ":\\s+(\\d+)")); return m ? Number(m[1]) : 0; };
  const total = get("MemTotal");
  const available = get("MemAvailable");
  if (!total) return null;
  return Math.round(((total - available) / total) * 100);
}

function getDiskUsage() {
  try {
    // Try df --output=pcent first (GNU), fall back to parsing standard df output
    let out = "";
    try { out = execSync("df / --output=pcent 2>/dev/null | tail -1", { encoding: "utf8", timeout: 3000 }).trim(); }
    catch { out = execSync("df / | tail -1 | awk '{print $5}'", { encoding: "utf8", timeout: 3000, shell: true }).trim(); }
    const pct = parseInt(out.replace(/%/g, ""), 10);
    return isNaN(pct) ? null : pct;
  } catch { return null; }
}

function getUptime() {
  const content = readProcFile("/proc/uptime");
  const seconds = parseFloat(content.split(/\s+/)[0]);
  if (isNaN(seconds)) return null;
  const days = Math.floor(seconds / 86400);
  return { seconds, days, text: days > 0 ? days + " 天" : Math.floor(seconds / 3600) + " 小时" };
}

function getLoadAvg() {
  const content = readProcFile("/proc/loadavg");
  const fields = content.trim().split(/\s+/);
  return { load1: parseFloat(fields[0]) || 0, load5: parseFloat(fields[1]) || 0, load15: parseFloat(fields[2]) || 0 };
}

app.get("/api/platform/health", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理员可以查看平台健康状态。" });
  }
  try {
    const cpu = getCpuUsage();
    const memory = getMemoryUsage();
    const disk = getDiskUsage();
    const uptime = getUptime();
    const load = getLoadAvg();

    let dbStatus = "error";
    try {
      const conn = await pool.getConnection();
      await conn.query("SELECT 1");
      conn.release();
      dbStatus = "running";
    } catch { dbStatus = "error"; }

    return response.json({
      cpu: { usage: cpu, loadAvg: load.load5 },
      memory: { usage: memory },
      disk: { usage: disk },
      uptime: uptime,
      load: load,
      mariadb: dbStatus,
    });
  } catch (error) {
    console.error("Failed to read system health:", error);
    return response.status(500).json({ message: "读取平台健康状态失败。" });
  }
});

// GET /api/platform/stats - platform communication & operation stats
app.get("/api/platform/stats", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平台管理员可以查看平台统计。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const [sipCreated] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE status = 'active'");
    const [sipAssigned] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_sip_account_entitlements WHERE status = 'active' AND service_expires_at >= CURDATE()");
    const [webCreated] = await connection.query("SELECT COUNT(*) AS cnt FROM web_users WHERE status = 'active'");
    const [webAssigned] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_web_account_entitlements WHERE status = 'active' AND service_expires_at >= CURDATE()");
    const [tenantCount] = await connection.query("SELECT COUNT(*) AS cnt FROM tenants WHERE status = 'active'");
    const [orderCount] = await connection.query("SELECT COUNT(*) AS cnt FROM billing_orders WHERE order_status = 'review_approved'");
    const [pendingReviewCount] = await connection.query("SELECT COUNT(*) AS cnt FROM billing_orders WHERE order_status = 'pending_review'");
    const [pendingPaymentCount] = await connection.query("SELECT COUNT(*) AS cnt FROM billing_orders WHERE payment_status = 'unpaid' AND order_status = 'review_approved'");
    const [paidTotal] = await connection.query("SELECT COALESCE(SUM(payment_amount), 0) AS total FROM billing_payments WHERE payment_status = 'paid'");
    const [ecardCount] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards WHERE status = 'active'");
    const [deviceCount] = await connection.query("SELECT COUNT(*) AS cnt FROM gate_devices WHERE assignment_status = 'assigned'");
    const [communityCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_communities WHERE is_active = 1");
    const [roomCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_rooms");
    const [topPlan] = await connection.query(
      "SELECT i.item_name, COUNT(*) AS cnt FROM billing_order_items i JOIN billing_orders o ON o.id = i.order_id WHERE i.item_type = 'plan' AND o.order_status = 'review_approved' GROUP BY i.item_name ORDER BY cnt DESC LIMIT 1"
    );
    const [bottomPlan] = await connection.query(
      "SELECT i.item_name, COUNT(*) AS cnt FROM billing_order_items i JOIN billing_orders o ON o.id = i.order_id WHERE i.item_type = 'plan' AND o.order_status = 'review_approved' GROUP BY i.item_name ORDER BY cnt ASC LIMIT 1"
    );

    // 近7日数据
    const tenantTrend = await connection.query(
      "SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date, COUNT(*) AS cnt FROM tenants WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY date ORDER BY date ASC"
    );
    const paymentTrend = await connection.query(
      "SELECT DATE_FORMAT(paid_at, '%Y-%m-%d') AS date, COALESCE(SUM(payment_amount), 0) AS total FROM billing_payments WHERE payment_status = 'paid' AND paid_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY date ORDER BY date ASC"
    );

    return response.json({
      sipCreated: Number(sipCreated.cnt),
      sipAssigned: Number(sipAssigned.cnt),
      webCreated: Number(webCreated.cnt),
      webAssigned: Number(webAssigned.cnt),
      tenantCount: Number(tenantCount.cnt),
      orderCount: Number(orderCount.cnt),
      pendingReviewCount: Number(pendingReviewCount.cnt),
      pendingPaymentCount: Number(pendingPaymentCount.cnt),
      paidTotal: Number(paidTotal.total),
      ecardCount: Number(ecardCount.cnt),
      deviceCount: Number(deviceCount.cnt),
      communityCount: Number(communityCount.cnt),
      roomCount: Number(roomCount.cnt),
      topPlan: topPlan?.item_name || "-",
      bottomPlan: bottomPlan?.item_name || "-",
      tenantTrend: tenantTrend.map(r => ({ date: r.date, count: Number(r.cnt) })),
      paymentTrend: paymentTrend.map(r => ({ date: r.date, amount: Number(r.total) })),
    });
  } catch (error) {
    console.error("Failed to fetch platform stats:", error);
    return response.status(500).json({ message: "读取平台统计失败。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/tenant/dashboard - tenant dashboard data (tenant admin only)
// GET /api/tenant/dashboard - tenant dashboard data (tenant admin only)
app.get("/api/tenant/dashboard", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平台管理员请使用平台概览。" });
  }
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租户管理员可以查看租户概览。" });
  }
  const tenantId = request.admin.tenantId;
  let connection;
  try {
    connection = await pool.getConnection();

    // Tenant info
    const [tenant] = await connection.query(
      "SELECT id, name, sip_domain, contact_person, contact_phone, contact_email, status, created_at FROM tenants WHERE id = ?", [tenantId]
    );
    if (!tenant) return response.status(404).json({ message: "租户不存在。" });

    // Current plan
    const [plan] = await connection.query(
      "SELECT o.id, o.order_no, o.currency, o.payable_amount, DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at, DATE_FORMAT(o.created_at, '%Y-%m-%d') AS created_at, o.payment_method, i.account_quantity, i.item_name FROM billing_orders o JOIN billing_order_items i ON i.order_id = o.id AND i.item_type = 'plan' WHERE o.tenant_id = ? AND o.order_status = 'review_approved' ORDER BY o.expires_at DESC LIMIT 1",
      [tenantId]
    );
    const planAddons = plan ? await connection.query("SELECT i.item_name FROM billing_order_items i WHERE i.order_id = ? AND i.item_type = 'addon'", [plan.id]) : [];
    const planPayment = plan ? await connection.query("SELECT DATE_FORMAT(paid_at, '%Y-%m-%d') AS payment_date FROM billing_payments WHERE order_id = ? AND payment_status = 'paid' LIMIT 1", [plan.id]) : [];

    // Order list for plan history
    const orderList = await connection.query(
      "SELECT o.id, o.order_no, o.order_status, o.payable_amount, o.payment_method, o.payment_status, DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at, i.item_name AS plan_name FROM billing_orders o JOIN billing_order_items i ON i.order_id = o.id AND i.item_type = 'plan' WHERE o.tenant_id = ? ORDER BY o.created_at DESC",
      [tenantId]
    );

    // SIP account counts
    const [sipTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE tenant_id = ?", [tenantId]);
    const [sipEnabled] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE tenant_id = ? AND status = 'active'", [tenantId]);
    const [sipNoDisplayName] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE tenant_id = ? AND (display_name IS NULL OR display_name = '' OR display_name = username)", [tenantId]);
    const [sipNoEmail] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE tenant_id = ? AND (email IS NULL OR email = '')", [tenantId]);
    const [sipExpired] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users su JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' WHERE su.tenant_id = ? AND e.service_expires_at < CURDATE()", [tenantId]);
    const [sipExpiring] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users su JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' WHERE su.tenant_id = ? AND e.service_expires_at >= CURDATE() AND e.service_expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)", [tenantId]);
    const sipTotalCount = Number(sipTotal.cnt);
    const sipEnabledCount = Number(sipEnabled.cnt);
    const sipNoDisplayNameCount = Number(sipNoDisplayName.cnt);
    const sipNoEmailCount = Number(sipNoEmail.cnt);
    const sipExpiredCount = Number(sipExpired.cnt);
    const sipExpiringCount = Number(sipExpiring.cnt);

    const sipAccountList = await connection.query(
      "SELECT su.id, su.username, su.display_name, su.email, su.phone_number, su.status, DATE_FORMAT(e.service_expires_at, '%Y-%m-%d') AS service_expires_at, wu.username AS web_account, tcb.name AS contact_book FROM sip_users su LEFT JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' LEFT JOIN tenant_web_account_entitlements we ON we.sip_user_id = su.id AND we.tenant_id = su.tenant_id AND we.status = 'active' LEFT JOIN web_users wu ON wu.id = we.web_user_id LEFT JOIN tenant_contact_book_assignments cba ON cba.sip_user_id = su.id AND cba.status != 'revoked' LEFT JOIN tenant_contact_books tcb ON tcb.id = cba.contact_book_id AND tcb.tenant_id = su.tenant_id WHERE su.tenant_id = ? ORDER BY su.created_at DESC",
      [tenantId]
    );

    // Ecard counts
    const [ecardTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards WHERE tenant_id = ?", [tenantId]);
    const [ecardActive] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards WHERE tenant_id = ? AND status = 'active'", [tenantId]);
    const [ecardConfigured] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards WHERE tenant_id = ? AND ecard_data_json IS NOT NULL", [tenantId]);
    const ecardTotalCount = Number(ecardTotal.cnt);
    const ecardActiveCount = Number(ecardActive.cnt);
    const ecardConfiguredCount = Number(ecardConfigured.cnt);
    const [ecardExpired] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards te JOIN sip_users su ON su.id = te.sip_user_id LEFT JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' WHERE te.tenant_id = ? AND e.service_expires_at IS NOT NULL AND e.service_expires_at < CURDATE()", [tenantId]);
    const [ecardExpiring] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards te JOIN sip_users su ON su.id = te.sip_user_id LEFT JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' WHERE te.tenant_id = ? AND e.service_expires_at IS NOT NULL AND e.service_expires_at >= CURDATE() AND e.service_expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)", [tenantId]);
    const ecardExpiredCount = Number(ecardExpired.cnt);
    const ecardExpiringCount = Number(ecardExpiring.cnt);
    const ecardList = await connection.query("SELECT te.id, su.username AS sip_account, su.display_name AS user_name, wu.username AS web_account, te.status, DATE_FORMAT(COALESCE(te.valid_from, su.activated_at), '%Y-%m-%d') AS valid_from, DATE_FORMAT(COALESCE(te.valid_to, su.service_expires_at), '%Y-%m-%d') AS valid_to, DATE_FORMAT(te.created_at, '%Y-%m-%d') AS created_at FROM tenant_ecards te JOIN sip_users su ON su.id = te.sip_user_id LEFT JOIN tenant_web_account_entitlements we ON we.sip_user_id = su.id AND we.tenant_id = su.tenant_id AND we.status = 'active' LEFT JOIN web_users wu ON wu.id = we.web_user_id WHERE te.tenant_id = ? ORDER BY te.created_at DESC",  [tenantId]);

    // Device counts
    const [deviceTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM gate_devices WHERE tenant_id = ?", [tenantId]);
    const [deviceOnline] = await connection.query("SELECT COUNT(*) AS cnt FROM gate_devices WHERE tenant_id = ? AND assignment_status = 'assigned'", [tenantId]);
    const deviceTotalCount = Number(deviceTotal.cnt);
    const deviceOnlineCount = Number(deviceOnline.cnt);

    // Community & room counts
    const [communityCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_communities WHERE tenant_id = ? AND is_active = 1", [tenantId]);
    const [roomCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_rooms WHERE tenant_id = ?", [tenantId]);
    const [buildingCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_buildings WHERE tenant_id = ?", [tenantId]);
    const [entranceTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM access_entrances WHERE tenant_id = ?", [tenantId]);
    const [entranceBound] = await connection.query("SELECT COUNT(*) AS cnt FROM access_entrances WHERE tenant_id = ? AND device_id IS NOT NULL", [tenantId]);
    const communityList = await connection.query("SELECT id, name, address, is_active, DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at FROM access_communities WHERE tenant_id = ? ORDER BY created_at DESC",  [tenantId]);

    // Call center stats
    const [ccTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM call_centers WHERE tenant_id = ?", [tenantId]);
    const [ccActive] = await connection.query("SELECT COUNT(*) AS cnt FROM call_centers WHERE tenant_id = ? AND status = 'active'", [tenantId]);
    const [ccDisabled] = await connection.query("SELECT COUNT(*) AS cnt FROM call_centers WHERE tenant_id = ? AND status = 'disabled'", [tenantId]);
    const [ccVisitor] = await connection.query("SELECT COUNT(*) AS cnt FROM call_centers WHERE tenant_id = ? AND require_visitor_info = 1", [tenantId]);
    const [ccAgents] = await connection.query("SELECT COUNT(*) AS cnt FROM call_center_category_agents WHERE tenant_id = ?", [tenantId]);
    const ccTotalCount = Number(ccTotal.cnt);
    const ccActiveCount = Number(ccActive.cnt);
    const ccDisabledCount = Number(ccDisabled.cnt);
    const ccVisitorCount = Number(ccVisitor.cnt);
    const ccAgentCount = Number(ccAgents.cnt);
    const ccList = await connection.query("SELECT cc.id, cc.center_name, cc.center_url, cc.require_visitor_info, cc.status, DATE_FORMAT(cc.created_at, '%Y-%m-%d') AS created_at, COUNT(ca.id) AS agent_count FROM call_centers cc LEFT JOIN call_center_category_agents ca ON ca.call_center_id = cc.id WHERE cc.tenant_id = ? GROUP BY cc.id ORDER BY cc.created_at DESC",  [tenantId]);
    
    const [todayCalls] = await connection.query("SELECT COUNT(*) AS cnt FROM call_center_visitor_inquiries WHERE tenant_id = ? AND DATE(created_at) = CURDATE()", [tenantId]);
    const [monthCalls] = await connection.query("SELECT COUNT(*) AS cnt FROM call_center_visitor_inquiries WHERE tenant_id = ? AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())", [tenantId]);
const callTrend = await connection.query("SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date, COUNT(*) AS cnt FROM call_center_visitor_inquiries WHERE tenant_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY date ORDER BY date ASC", [tenantId]);

    // Last login
    const [lastLogin] = await connection.query("SELECT last_login_at FROM admin_users WHERE tenant_id = ? AND account_type = 'tenant' ORDER BY last_login_at DESC LIMIT 1", [tenantId]);

    // Plan usage limits
    const planLimit = (plan && plan.item_name && plan.item_name.includes('Pro')) ? { sip: 5000, device: 500, community: 100, room: 10000 } : { sip: 1000, device: 100, community: 20, room: 500 };

    // Recent call records
    const recentCalls = await connection.query(
      "SELECT vi.created_at, vi.sip_number AS caller_number, vi.visitor_phone AS callee_number, vi.inquiry_status AS status FROM call_center_visitor_inquiries vi WHERE vi.tenant_id = ? ORDER BY vi.created_at DESC LIMIT 4",
      [tenantId]
    );

    // Device alerts (mock for now)
    const alerts = [];

    return response.json({
      tenant: {
        id: Number(tenant.id),
        name: tenant.name || "",
        sipDomain: tenant.sip_domain || "",
        contactPerson: tenant.contact_person || "",
        contactPhone: tenant.contact_phone || "",
        contactEmail: tenant.contact_email || "",
        status: tenant.status || 'active',
        createdAt: tenant.created_at || null,
        lastLoginAt: lastLogin?.last_login_at || null,
      },
      plan: plan ? {
        orderNo: plan.order_no,
        planName: plan.item_name || "-",
        accountQuantity: plan.account_quantity || 0,
        addonNames: planAddons.map(a => a.item_name).join("、") || "-",
        payableAmount: Number(plan.payable_amount || 0),
        paymentMethod: plan.payment_method === 'offline' ? '线下支付' : plan.payment_method === 'online' ? '线上支付' : '-',
        paymentDate: (planPayment[0] && planPayment[0].payment_date) || "-",
        createdAt: plan.created_at || "-",
        expiresAt: plan.expires_at || null,
        daysLeft: plan.expires_at ? Math.max(0, Math.ceil((new Date(plan.expires_at + 'T00:00:00') - new Date()) / 86400000)) : 0,
        status: plan.expires_at && new Date(plan.expires_at + 'T00:00:00') > new Date() ? 'active' : "expired",
      } : null,
      orderList: orderList.map(o => ({
        id: Number(o.id),
        orderNo: o.order_no || "-",
        planName: o.plan_name || "-",
        orderStatus: o.order_status || "-",
        paymentStatus: o.payment_status || "-",
        payableAmount: Number(o.payable_amount || 0),
        expiresAt: o.expires_at || "-",
      })),
      sipAccounts: {
        total: sipTotalCount,
        enabled: sipEnabledCount,
        noDisplayName: sipNoDisplayNameCount,
        noEmail: sipNoEmailCount,
        expired: sipExpiredCount,
        expiring: sipExpiringCount,
        limit: planLimit.sip,
        list: sipAccountList.map(a => ({ id: Number(a.id), username: a.username, displayName: a.display_name, email: a.email, phone: a.phone_number, status: a.status, webAccount: a.web_account || '-', contactBook: a.contact_book || '-', expiresAt: a.service_expires_at || null })),
      },
      ecards: {
        total: ecardTotalCount,
        configured: ecardConfiguredCount,
        unconfigured: ecardTotalCount - ecardConfiguredCount,
        active: ecardActiveCount,
        expired: ecardExpiredCount,
        expiring: ecardExpiringCount,
        list: ecardList.map(e => ({ id: Number(e.id), sipAccount: e.sip_account, userName: e.user_name, webAccount: e.web_account || "-", status: e.status, validFrom: e.valid_from, validTo: e.valid_to, createdAt: e.created_at })),
      },
      devices: {
        total: deviceTotalCount,
        online: deviceOnlineCount,
        offline: deviceTotalCount - deviceOnlineCount,
        onlineRate: deviceTotalCount > 0 ? Math.round((deviceOnlineCount / deviceTotalCount) * 1000) / 10 : 0,
        limit: planLimit.device,
      },
      buildings: {
        communities: Number(communityCount.cnt),
        buildings: Number(buildingCount.cnt),
        rooms: Number(roomCount.cnt),
        entrances: Number(entranceTotal.cnt),
        entranceBound: Number(entranceBound.cnt),
        devices: deviceTotalCount,
        deviceBound: deviceOnlineCount,
        limit: planLimit.community,
        roomLimit: planLimit.room,
        list: communityList.map(r => ({ id: Number(r.id), name: r.name, address: r.address, isActive: r.is_active === 1, createdAt: r.created_at })),
      },
      callCenter: {
        total: ccTotalCount,
        active: ccActiveCount,
        disabled: ccDisabledCount,
        visitorEnabled: ccVisitorCount,
        expiring: 0,
        agents: ccAgentCount,
        list: ccList.map(r => ({ id: Number(r.id), name: r.center_name, url: r.center_url, visitorEnabled: r.require_visitor_info === 1, status: r.status, agentCount: Number(r.agent_count), createdAt: r.created_at })),
        todayCalls: Number(todayCalls.cnt),
        monthCalls: Number(monthCalls.cnt),
        callTrend: callTrend.map(r => ({ date: r.date, count: Number(r.cnt) })),
        recentCalls: recentCalls.map(c => ({
          time: c.created_at ? String(c.created_at).slice(11, 16) : "-",
          caller: c.caller_number || "-",
          callee: c.callee_number || "-",
          status: c.status || "completed",
        })),
      },
      alerts: alerts,
      cloudStorage: { used: 128, limit: 500 },
    });
  } catch (error) {
    console.error("Failed to fetch tenant dashboard:", error);
    return response.status(500).json({ message: "读取租户概览失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.listen(port, () => {
  console.log(`QRTalkie Cloud API listening on http://127.0.0.1:${port}`);
});
  startScheduler();
