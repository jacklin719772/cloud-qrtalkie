import "dotenv/config";
import express from "express";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";
import { createEmailToken, createNumericCode, createSessionToken, hashPassword, hashToken, verifyPassword } from "./security.js";
import { queueLoginEmailChangeCode, queuePasswordResetEmail, queueVerificationEmail } from "./email.js";

const app = express();
const port = Number(process.env.API_PORT || 3001);
const appUrl = process.env.APP_URL || "http://127.0.0.1:5173";
const sipDomain = process.env.SIP_DOMAIN || "sip.qrtalkie.org";

app.use(express.json({ limit: "12mb" }));
app.use("/payment-proofs", express.static(path.resolve("assets/payment-proofs")));
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", appUrl);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  return next();
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (String(password || "").length < 8) return "密碼至少需要 8 位字元。";
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
  if (!token) return response.status(401).json({ message: "請重新登入。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         s.id AS session_id, s.expires_at,
         a.id AS admin_id, a.tenant_id, a.account_type, a.email, a.display_name, a.nickname, a.phone_number,
         a.role, a.platform_role, a.permissions_json, a.status
       FROM admin_sessions s
       JOIN admin_users a ON a.id = s.admin_user_id
       WHERE s.token_hash = ?
       LIMIT 1`,
      [hashToken(token)],
    );

    const session = rows[0];
    if (!session || new Date(session.expires_at).getTime() < Date.now() || session.status !== "active") {
      return response.status(401).json({ message: "請重新登入。" });
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
    return response.status(500).json({ message: "身分驗證失敗。" });
  } finally {
    if (connection) connection.release();
  }
}

function validateRegistration(payload) {
  const companyName = String(payload.companyName || "").trim();
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const confirmPassword = String(payload.confirmPassword || "");

  if (!companyName) return { error: "請輸入公司名稱" };
  if (!email || !email.includes("@")) return { error: "請輸入有效的電子郵件" };
  if (password.length < 8) return { error: "密碼至少需要 8 位字元" };
  if (password !== confirmPassword) return { error: "兩次輸入的密碼不一致" };

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
      return response.status(409).json({ message: "此電子郵件已被註冊，請使用系統內未註冊的電子郵件或直接登入。" });
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
      message: "註冊成功，請前往電子郵件完成驗證",
      devVerificationUrl: verificationUrl,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "註冊失敗，請稍後再試" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/login", async (request, response) => {
  const email = normalizeEmail(request.body.email);
  const password = String(request.body.password || "");

  if (!isValidEmail(email) || !password) {
    return response.status(400).json({ message: "請輸入有效的登入信箱和密碼。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, tenant_id, account_type, email, password_hash, role, platform_role, permissions_json, status
       FROM admin_users
       WHERE email = ?
       LIMIT 1`,
      [email],
    );
    const admin = rows[0];

    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      return response.status(401).json({ message: "登入信箱或密碼不正確。" });
    }

    if (admin.status !== "active") {
      return response.status(403).json({ message: "此管理員帳號尚未啟用。" });
    }

    const { token, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

    await connection.query(
      `INSERT INTO admin_sessions (admin_user_id, token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [Number(admin.id), tokenHash, expiresAt],
    );
    await connection.query(`UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, [Number(admin.id)]);

    return response.json({
      token,
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
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "登入失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/forgot-password", async (request, response) => {
  const email = normalizeEmail(request.body.email);
  if (!isValidEmail(email)) {
    return response.status(400).json({ message: "請輸入有效的電子郵件地址。" });
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
      return response.status(404).json({ message: "該郵箱不存在，請確認後重新輸入。" });
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
      return response.status(500).json({ message: "重置郵件發送失敗，請稍後再試。" });
    }

    return response.json({ message: "已發送密碼重設連結，請檢查您的郵箱。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "無法發送重置郵件，請稍後再試。" });
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
    return response.status(400).json({ message: "重置連結無效，請重新申請。" });
  }
  if (passwordError) {
    return response.status(400).json({ message: passwordError });
  }
  if (password !== confirmPassword) {
    return response.status(400).json({ message: "兩次輸入的密碼不一致。" });
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
      return response.status(400).json({ message: "重置連結無效或已使用，請重新申請。" });
    }
    if (new Date(resetToken.expires_at).getTime() < Date.now()) {
      await connection.rollback();
      return response.status(400).json({ message: "重置連結已過期，請重新申請。" });
    }
    if (resetToken.status !== "active") {
      await connection.rollback();
      return response.status(403).json({ message: "此管理員帳號尚未啟用。" });
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
    return response.json({ message: "密碼已重置，請使用新密碼登入。" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "無法重置密碼，請稍後再試。" });
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
    return response.json({ message: "已退出系統。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "退出系統失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/auth/verify-email", async (request, response) => {
  const token = String(request.query.token || "");
  if (!token) {
    return response.status(400).json({ message: "驗證連結無效" });
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
      return response.status(400).json({ message: "驗證連結無效或已使用" });
    }

    if (new Date(verification.expires_at).getTime() < Date.now()) {
      await connection.rollback();
      return response.status(400).json({ message: "驗證連結已過期" });
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
    return response.json({ message: "電子郵件驗證成功，請登入" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "驗證失敗，請稍後再試" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/me", requireAdmin, async (request, response) => {
  if (request.admin.accountType === "platform") {
    return response.json({
      tenant: null,
      admin: {
        id: request.admin.id,
        accountType: "platform",
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
    if (!row) return response.status(404).json({ message: "找不到租戶資料。" });

    return response.json({
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
    return response.status(500).json({ message: "無法讀取租戶設定。" });
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
      return response.status(404).json({ message: "找不到線下收款資訊。" });
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
    return response.status(500).json({ message: "讀取線下收款資訊失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/offline-payment-account", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({ message: "只有平台管理員可以維護收款帳戶。" });
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

  if (!displayName) return response.status(400).json({ message: "請輸入帳戶名稱。" });
  if (!payeeName) return response.status(400).json({ message: "請輸入收款單位。" });
  if (!bankName) return response.status(400).json({ message: "請輸入開戶銀行。" });
  if (!bankAccountNo) return response.status(400).json({ message: "請輸入銀行帳號。" });
  if (!/^[A-Z]{3}$/.test(currency)) return response.status(400).json({ message: "幣別需為 3 位英文代碼。" });
  if (contactEmail && !isValidEmail(contactEmail)) return response.status(400).json({ message: "請輸入有效的聯絡信箱。" });

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

    return response.json({ message: "收款帳戶已儲存。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "無法儲存收款帳戶。" });
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
    return response.status(500).json({ message: "讀取套餐資料失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/coupons/validate", requireAdmin, async (request, response) => {
  const code = sanitizeString(request.query.code, 80).toUpperCase();
  if (!code) return response.status(400).json({ message: "請輸入優惠碼。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         id, tenant_id, coupon_code, display_name, discount_type, discount_value,
         currency, valid_from, DATE_FORMAT(valid_until, '%Y-%m-%d') AS valid_until, max_redemptions, redeemed_count
       FROM billing_coupons
       WHERE coupon_code = ?
         AND status = 'active'
         AND (tenant_id = ? OR tenant_id IS NULL)
         AND (valid_from IS NULL OR valid_from <= CURRENT_DATE())
         AND valid_until >= CURRENT_DATE()
         AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
       ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
      [code, request.admin.tenantId, request.admin.tenantId],
    );

    const row = rows[0];
    if (!row) return response.status(404).json({ message: "此租戶不存在該優惠碼。" });

    return response.json({
      coupon: {
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
    return response.status(500).json({ message: "驗證優惠碼失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/payment-methods", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, method_code, display_name, method_type, logo_class
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
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "讀取付款方式失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/payment-method-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({ message: "只有平台管理員可以維護付款方式。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, method_code, display_name, method_type, logo_class, status, sort_order
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
        status: row.status || "active",
        sortOrder: Number(row.sort_order || 0),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "讀取付款方式設定失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/payment-method-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({ message: "只有平台管理員可以維護付款方式。" });
  }

  const methods = Array.isArray(request.body?.methods) ? request.body.methods.slice(0, 50) : [];
  if (methods.length === 0) return response.status(400).json({ message: "請至少新增一個付款方式。" });

  const seenCodes = new Set();
  const normalizedMethods = [];

  for (const method of methods) {
    const id = Number(method.id || 0);
    const displayName = sanitizeString(method.displayName, 120);
    const rawMethodCode = sanitizeString(method.methodCode, 80).toLowerCase();
    const methodCode = rawMethodCode || generateMethodCode(displayName, seenCodes);
    const methodType = sanitizeString(method.methodType, 20);
    const logoClass = sanitizeString(method.logoClass, 80);
    const status = sanitizeString(method.status, 20);
    const sortOrder = Math.max(0, Number(method.sortOrder || 0));

    if (!methodCode) return response.status(400).json({ message: "請輸入方式代碼。" });
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(methodCode)) {
      return response.status(400).json({ message: "方式代碼只能使用英文字母、數字、底線或連字號，且至少 2 個字元。" });
    }
    if (seenCodes.has(methodCode)) return response.status(400).json({ message: "方式代碼不可重複。" });
    seenCodes.add(methodCode);
    if (!displayName) return response.status(400).json({ message: "請輸入顯示名稱。" });
    if (!["online", "offline"].includes(methodType)) return response.status(400).json({ message: "請選擇付款類型。" });
    if (!["active", "disabled"].includes(status)) return response.status(400).json({ message: "請選擇啟用狀態。" });

    normalizedMethods.push({
      id: Number.isFinite(id) && id > 0 ? id : null,
      methodCode,
      displayName,
      methodType,
      logoClass,
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
           SET method_code = ?, display_name = ?, method_type = ?, logo_class = ?,
               status = ?, sort_order = ?
           WHERE id = ?`,
          [
            method.methodCode,
            method.displayName,
            method.methodType,
            method.logoClass || null,
            method.status,
            method.sortOrder,
            method.id,
          ],
        );
      } else {
        await connection.query(
          `INSERT INTO billing_payment_methods (
             method_code, display_name, method_type, logo_class, status, sort_order
           )
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             display_name = VALUES(display_name),
             method_type = VALUES(method_type),
             logo_class = VALUES(logo_class),
             status = VALUES(status),
             sort_order = VALUES(sort_order)`,
          [
            method.methodCode,
            method.displayName,
            method.methodType,
            method.logoClass || null,
            method.status,
            method.sortOrder,
          ],
        );
      }
    }

    await connection.commit();
    return response.json({ message: "付款方式已儲存。" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    if (error?.code === "ER_DUP_ENTRY") return response.status(409).json({ message: "方式代碼已存在，請更換後再儲存。" });
    return response.status(500).json({ message: "無法儲存付款方式。" });
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
         o.id, o.order_no, o.currency, o.payable_amount, o.order_status, o.payment_status,
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
         o.id, o.order_no, o.currency, o.payable_amount, o.order_status, o.payment_status,
         o.payment_method, o.payment_channel, o.effective_at, o.expires_at, o.created_at,
         plan.item_name, plan.account_quantity, plan.months, p.paid_at, p.payment_proof_uploaded_at
       ORDER BY o.created_at DESC, o.id DESC`,
      [request.admin.tenantId],
    );

    return response.json({
      orders: rows.map((row) => ({
        id: Number(row.id),
        orderNo: row.order_no || "",
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
    return response.status(500).json({ message: "讀取訂單列表失敗。" });
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

async function buildBillingOrderDraft(connection, request, payload) {
  const planCode = sanitizeString(payload.planCode, 80);
  const quantity = Math.max(1, Number(payload.quantity || 1));
  const months = Math.max(1, Number(payload.months || 1));
  const addonCodes = Array.isArray(payload.addonCodes) ? payload.addonCodes.map((code) => sanitizeString(code, 80)).filter(Boolean) : [];
  const couponCode = sanitizeString(payload.couponCode, 80).toUpperCase();

  if (!planCode) {
    const error = new Error("請選擇套餐。");
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
    const error = new Error("套餐不存在或已停用。");
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
    itemName: `${plan.name} 套餐`,
    quantity,
    months,
    unitPrice: Number(plan.unit_price),
    discountAmount: 0,
    lineAmount: subtotal,
    accountQuantity: Number(plan.account_quantity || 0) * quantity,
    sortOrder: 10,
  });

  if (addonCodes.length > 0) {
    const addonRows = await connection.query(
      `SELECT a.id, a.addon_code, a.name, pa.unit_price, pa.currency
       FROM billing_addons a
       JOIN billing_plan_addons pa ON pa.addon_id = a.id
       WHERE pa.plan_id = ?
         AND a.addon_code IN (?)
         AND a.status = 'active'
         AND pa.status = 'active'
       ORDER BY a.sort_order ASC, a.id ASC`,
      [Number(plan.id), addonCodes],
    );

    addonRows.forEach((addon, index) => {
      const lineAmount = Number(addon.unit_price) * quantity * months;
      subtotal += lineAmount;
      orderItems.push({
        itemType: "addon",
        planId: Number(plan.id),
        addonId: Number(addon.id),
        couponId: null,
        itemCode: addon.addon_code,
        itemName: addon.name,
        quantity,
        months,
        unitPrice: Number(addon.unit_price),
        discountAmount: 0,
        lineAmount,
        accountQuantity: null,
        sortOrder: 20 + index,
      });
    });
  }

  let coupon = null;
  let discountAmount = 0;
  if (couponCode) {
    const couponRows = await connection.query(
      `SELECT id, coupon_code, discount_type, discount_value, currency
       FROM billing_coupons
       WHERE coupon_code = ?
         AND status = 'active'
         AND (tenant_id = ? OR tenant_id IS NULL)
         AND (valid_from IS NULL OR valid_from <= CURRENT_DATE())
         AND valid_until >= CURRENT_DATE()
         AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
       ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
      [couponCode, request.admin.tenantId, request.admin.tenantId],
    );
    coupon = couponRows[0] || null;
    if (!coupon) {
      const error = new Error("此租戶不存在該優惠碼。");
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
      itemName: "優惠折扣",
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
  const paymentMethod = sanitizeString(payload.paymentMethod, 20);
  const paymentChannel = sanitizeString(payload.paymentChannel, 80);
  const billingAddress = sanitizeString(payload.billingAddress, 500);

  if (!planCode) return response.status(400).json({ message: "請選擇套餐。" });
  if (!["online", "offline"].includes(paymentMethod)) return response.status(400).json({ message: "請選擇支付方式。" });

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
      return response.status(404).json({ message: "套餐不存在或已停用。" });
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
      itemName: `${plan.name} 套餐`,
      quantity,
      months,
      unitPrice: Number(plan.unit_price),
      discountAmount: 0,
      lineAmount: subtotal,
      accountQuantity: Number(plan.account_quantity || 0) * quantity,
      sortOrder: 10,
    });

    if (addonCodes.length > 0) {
      const addonRows = await connection.query(
        `SELECT a.id, a.addon_code, a.name, pa.unit_price, pa.currency
         FROM billing_addons a
         JOIN billing_plan_addons pa ON pa.addon_id = a.id
         WHERE pa.plan_id = ?
           AND a.addon_code IN (?)
           AND a.status = 'active'
           AND pa.status = 'active'
         ORDER BY a.sort_order ASC, a.id ASC`,
        [Number(plan.id), addonCodes],
      );

      addonRows.forEach((addon, index) => {
        const lineAmount = Number(addon.unit_price) * quantity * months;
        subtotal += lineAmount;
        orderItems.push({
          itemType: "addon",
          planId: Number(plan.id),
          addonId: Number(addon.id),
          couponId: null,
          itemCode: addon.addon_code,
          itemName: addon.name,
          quantity,
          months,
          unitPrice: Number(addon.unit_price),
          discountAmount: 0,
          lineAmount,
          accountQuantity: null,
          sortOrder: 20 + index,
        });
      });
    }

    let coupon = null;
    let discountAmount = 0;
    if (couponCode) {
      const couponRows = await connection.query(
        `SELECT id, coupon_code, discount_type, discount_value, currency
         FROM billing_coupons
         WHERE coupon_code = ?
           AND status = 'active'
           AND (tenant_id = ? OR tenant_id IS NULL)
           AND (valid_from IS NULL OR valid_from <= CURRENT_DATE())
           AND valid_until >= CURRENT_DATE()
           AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
         ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, id ASC
         LIMIT 1`,
        [couponCode, request.admin.tenantId, request.admin.tenantId],
      );
      coupon = couponRows[0] || null;
      if (!coupon) {
        await connection.rollback();
        return response.status(404).json({ message: "此租戶不存在該優惠碼。" });
      }
      if (coupon.discount_type === "percent") discountAmount = subtotal * (Number(coupon.discount_value) / 100);
      if (coupon.discount_type === "fixed_amount") discountAmount = Math.min(subtotal, Number(coupon.discount_value));
      orderItems.push({
        itemType: "discount",
        planId: null,
        addonId: null,
        couponId: Number(coupon.id),
        itemCode: coupon.coupon_code,
        itemName: "優惠折扣",
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
    const initialPaymentStatus = isOnlinePaid ? "paid" : "unpaid";
    const initialPaymentRecordStatus = isOnlinePaid ? "paid" : "pending";
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
      message: paymentMethod === "offline" ? "訂單已保存，請線下付款後上傳付款憑證截圖。" : "訂單已建立。",
      order: { id: orderId, orderNo, currency, payableAmount },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "建立訂單失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/orders/:id", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "訂單編號無效。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         o.id, o.order_no, o.currency, o.subtotal_amount, o.discount_amount, o.payable_amount,
         o.order_status, o.payment_status, o.payment_method, o.payment_channel, o.billing_address,
         o.coupon_code, o.coupon_discount_type, o.coupon_discount_value,
         DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS coupon_valid_until
       FROM billing_orders o
       LEFT JOIN billing_coupons c ON c.id = o.coupon_id
       WHERE o.id = ? AND o.tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const order = rows[0];
    if (!order) return response.status(404).json({ message: "找不到訂單。" });

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

    return response.json({
      order: {
        id: Number(order.id),
        orderNo: order.order_no || "",
        currency: order.currency || "USD",
        subtotalAmount: Number(order.subtotal_amount || 0),
        discountAmount: Number(order.discount_amount || 0),
        payableAmount: Number(order.payable_amount || 0),
        orderStatus: order.order_status || "",
        paymentStatus: order.payment_status || "",
        paymentMethod: order.payment_method || "",
        paymentChannel: order.payment_channel || "",
        billingAddress: order.billing_address || "",
        payment: payment
          ? {
              actualAmount: Number(payment.payment_amount || 0),
              paymentDate: payment.paid_at || "",
              proofUrl: payment.payment_proof_file_url || "",
              proofFileName: payment.payment_proof_file_name || "",
              proofUploadedAt: payment.payment_proof_uploaded_at ? String(payment.payment_proof_uploaded_at) : "",
            }
          : null,
        editable: order.order_status === "pending_payment" && order.payment_status === "unpaid",
        planCode: planItem?.item_code || "",
        quantity: Number(planItem?.quantity || 1),
        months: Number(planItem?.months || 1),
        addonCodes: addonItems.map((item) => item.item_code).filter(Boolean),
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
    return response.status(500).json({ message: "讀取訂單詳情失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/orders/:id", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "訂單編號無效。" });

  const payload = request.body || {};
  const paymentMethod = sanitizeString(payload.paymentMethod, 20);
  const paymentChannel = sanitizeString(payload.paymentChannel, 80);
  const billingAddress = sanitizeString(payload.billingAddress, 500);
  if (!["online", "offline"].includes(paymentMethod)) return response.status(400).json({ message: "請選擇支付方式。" });

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
      return response.status(404).json({ message: "找不到訂單。" });
    }
    if (["review_approved", "review_rejected"].includes(existing.order_status)) {
      await connection.rollback();
      return response.status(409).json({ message: "只有未支付訂單可以修改。" });
    }

    const draft = await buildBillingOrderDraft(connection, request, payload);
    const isOnlinePaid = paymentMethod === "online";
    const nextOrderStatus = isOnlinePaid ? "payment_submitted" : "pending_payment";
    const nextPaymentStatus = isOnlinePaid ? "paid" : "unpaid";
    const nextPaymentRecordStatus = isOnlinePaid ? "paid" : "pending";
    await connection.query(
      `UPDATE billing_orders
       SET currency = ?, subtotal_amount = ?, discount_amount = ?, payable_amount = ?,
           paid_amount = ?, order_status = ?, payment_status = ?,
           payment_method = ?, payment_channel = ?, billing_address = ?,
           coupon_id = ?, coupon_code = ?, coupon_discount_type = ?, coupon_discount_value = ?,
           updated_by_admin_user_id = ?
       WHERE id = ? AND tenant_id = ?`,
      [
        draft.currency,
        draft.subtotal,
        draft.discountAmount,
        draft.payableAmount,
        isOnlinePaid ? draft.payableAmount : 0,
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
      `SELECT id FROM billing_payments WHERE order_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    if (paymentRows[0]) {
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
          isOnlinePaid ? new Date() : null,
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
          isOnlinePaid ? new Date() : null,
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
    return response.json({ message: "訂單已更新。", order: { id: orderId, currency: draft.currency, payableAmount: draft.payableAmount } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "修改訂單失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/repurchase", requireAdmin, async (request, response) => {
  const sourceOrderId = Number(request.params.id);
  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) return response.status(400).json({ message: "订单编号无效。" });

  const payload = request.body || {};
  const requestedPaymentMethod = sanitizeString(payload.paymentMethod, 20);
  const requestedPaymentChannel = sanitizeString(payload.paymentChannel, 80);
  const requestedBillingAddress = sanitizeString(payload.billingAddress, 500);

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const sourceRows = await connection.query(
      `SELECT
         id, currency, subtotal_amount, discount_amount, payable_amount,
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
      return response.status(404).json({ message: "找不到原订单。" });
    }

    const itemRows = await connection.query(
      `SELECT
         item_type, plan_id, addon_id, coupon_id, item_code, item_name, description,
         account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
       FROM billing_order_items
       WHERE order_id = ? AND tenant_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [sourceOrderId, request.admin.tenantId],
    );
    if (itemRows.length === 0) {
      await connection.rollback();
      return response.status(409).json({ message: "原订单没有可复制的明细。" });
    }

    const paymentMethod = ["online", "offline"].includes(requestedPaymentMethod) ? requestedPaymentMethod : source.payment_method;
    const paymentChannel = requestedPaymentChannel || (paymentMethod === source.payment_method ? source.payment_channel : paymentMethod === "offline" ? "bank_transfer" : null);
    const billingAddress = requestedBillingAddress || source.billing_address || null;
    const isOnlinePaid = paymentMethod === "online";
    const initialOrderStatus = isOnlinePaid ? "payment_submitted" : "pending_payment";
    const initialPaymentStatus = isOnlinePaid ? "paid" : "unpaid";
    const initialPaymentRecordStatus = isOnlinePaid ? "paid" : "pending";
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
        Number(source.discount_amount || 0),
        Number(source.payable_amount || 0),
        isOnlinePaid ? Number(source.payable_amount || 0) : 0,
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
        Number(source.payable_amount || 0),
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
      message: paymentMethod === "offline" ? "重新购买订单已保存。" : "重新购买订单已建立。",
      order: {
        id: orderId,
        orderNo,
        sourceOrderId,
        currency: source.currency || "USD",
        payableAmount: Number(source.payable_amount || 0),
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "重新购买订单生成失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/payment-proof", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "订单编号无效。" });

  const payload = request.body || {};
  const actualAmount = Number(payload.actualAmount);
  const paymentDate = sanitizeString(payload.paymentDate, 20);
  const proofImageDataUrl = String(payload.proofImageDataUrl || "");
  const originalFileName = sanitizeString(payload.fileName, 255) || "payment-proof.png";

  if (!Number.isFinite(actualAmount) || actualAmount <= 0) return response.status(400).json({ message: "请输入有效的实付金额。" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return response.status(400).json({ message: "请选择有效的付款日期。" });

  const match = proofImageDataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return response.status(400).json({ message: "请上传或粘贴 PNG、JPG、WEBP 格式的付款凭证截图。" });

  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) return response.status(400).json({ message: "付款凭证图片大小需小于 8MB。" });

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
      return response.status(404).json({ message: "找不到订单。" });
    }
    if (order.payment_method !== "offline") {
      await connection.rollback();
      return response.status(409).json({ message: "只有线下支付订单可以上传付款凭证。" });
    }
    if (!["pending_payment", "payment_submitted", "pending_review"].includes(order.order_status)) {
      await connection.rollback();
      return response.status(409).json({ message: "当前订单状态不能上传付款凭证。" });
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
    const nextPaymentStatus = "paid";
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
      message: "付款凭证已保存，并已关联到该订单。",
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
    return response.status(500).json({ message: "付款凭证保存失败。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/review-submission", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "订单编号无效。" });

  const action = sanitizeString(request.body?.action, 20);
  if (!["submit", "revoke"].includes(action)) return response.status(400).json({ message: "操作类型无效。" });

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
      return response.status(404).json({ message: "找不到订单。" });
    }

    let nextOrderStatus = "";
    let reason = "";
    if (action === "submit") {
      if (order.order_status !== "payment_submitted") {
        await connection.rollback();
        return response.status(409).json({ message: "只有已支付且未提交审核的订单可以提交审核。" });
      }
      nextOrderStatus = "pending_review";
      reason = "submit_review";
    }
    if (action === "revoke") {
      if (order.order_status !== "pending_review") {
        await connection.rollback();
        return response.status(409).json({ message: "只有已提交且未审核的订单可以撤销提交。" });
      }
      nextOrderStatus = "payment_submitted";
      reason = "revoke_review";
    }

    await connection.query(
      `UPDATE billing_orders
       SET order_status = ?, updated_by_admin_user_id = ?
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
    return response.json({ message: action === "submit" ? "订单已提交审核。" : "已撤销提交。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "订单审核提交操作失败。" });
  } finally {
    if (connection) connection.release();
  }
});
app.delete("/api/billing/orders/:id", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "訂單編號無效。" });

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
      return response.status(404).json({ message: "找不到訂單。" });
    }
    if (["review_approved", "review_rejected"].includes(order.order_status)) {
      await connection.rollback();
      return response.status(409).json({ message: "只有未支付訂單可以刪除。" });
    }

    await connection.query(`DELETE FROM billing_orders WHERE id = ? AND tenant_id = ?`, [orderId, request.admin.tenantId]);
    await connection.commit();
    return response.json({ message: "訂單已刪除。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "刪除訂單失敗。" });
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

  if (!companyName) return response.status(400).json({ message: "請輸入公司名稱。" });
  if (enterpriseEmail && !isValidEmail(enterpriseEmail)) {
    return response.status(400).json({ message: "請輸入有效的企業信箱。" });
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
    return response.json({ message: "租戶設定已儲存。" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "無法儲存租戶設定。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/login-email-change/request-code", requireAdmin, async (request, response) => {
  const newEmail = normalizeEmail(request.body.newEmail);
  const oldPassword = String(request.body.oldPassword || "");
  const newPassword = String(request.body.newPassword || "");
  const confirmPassword = String(request.body.confirmPassword || "");

  if (!isValidEmail(newEmail)) return response.status(400).json({ message: "請輸入有效的新登入信箱。" });
  if (newPassword !== confirmPassword) return response.status(400).json({ message: "兩次輸入的新密碼不一致。" });
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
      return response.status(401).json({ message: "舊密碼不正確。" });
    }

    const existing = await connection.query(
      `SELECT id FROM admin_users WHERE email = ? AND id <> ? LIMIT 1`,
      [newEmail, request.admin.id],
    );
    if (existing.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "此登入信箱已被使用。" });
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
      return response.status(429).json({ message: "請等待 60 秒後再傳送新的驗證碼。" });
    }
    const sentInTenMinutes = recentCodes.filter((code) => Date.now() - new Date(code.created_at).getTime() < 10 * 60 * 1000);
    if (sentInTenMinutes.length >= 5) {
      await connection.rollback();
      return response.status(429).json({ message: "驗證碼傳送次數過多，請稍後再試。" });
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

    return response.json({ message: "驗證碼已傳送至新的登入信箱。" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "無法傳送驗證碼。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/login-email-change/confirm", requireAdmin, async (request, response) => {
  const newEmail = normalizeEmail(request.body.newEmail);
  const code = String(request.body.code || "").trim();

  if (!isValidEmail(newEmail) || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ message: "請輸入新信箱與 6 位數字驗證碼。" });
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
      return response.status(400).json({ message: "驗證碼無效或已過期。" });
    }
    if (Number(change.attempt_count) >= 5) {
      await connection.rollback();
      return response.status(429).json({ message: "嘗試次數過多，請重新取得驗證碼。" });
    }

    if (change.code_hash !== hashToken(code)) {
      await connection.query(
        `UPDATE admin_email_change_codes SET attempt_count = attempt_count + 1 WHERE id = ?`,
        [Number(change.id)],
      );
      await connection.commit();
      return response.status(400).json({ message: "驗證碼不正確。" });
    }

    const existing = await connection.query(
      `SELECT id FROM admin_users WHERE email = ? AND id <> ? LIMIT 1`,
      [newEmail, request.admin.id],
    );
    if (existing.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "此登入信箱已被使用。" });
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
    return response.json({ message: "登入信箱與密碼已更新，請重新登入。" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "無法更新登入信箱。" });
  } finally {
    if (connection) connection.release();
  }
});

app.listen(port, () => {
  console.log(`QRTalkie Cloud API listening on http://127.0.0.1:${port}`);
});
