import "dotenv/config";
import { pool } from "../server/db.js";
import { createEmailToken, hashPassword } from "../server/security.js";
import { queueVerificationEmail } from "../server/email.js";

const testEmail = `dev-${Date.now()}@example.com`;
const companyName = "Dev Test Company";
const sipDomain = process.env.SIP_DOMAIN || "sip.qrtalkie.org";
const appUrl = process.env.APP_URL || "http://127.0.0.1:5173";

let connection;

try {
  connection = await pool.getConnection();

  const existingUsers = await connection.query("SELECT id FROM admin_users WHERE email = ? LIMIT 1", [testEmail]);
  if (existingUsers.length > 0) {
    throw new Error("Email uniqueness check failed");
  }

  await connection.beginTransaction();

  const tenantResult = await connection.query(
    `INSERT INTO tenants (name, sip_domain, contact_email, enterprise_email, plan_code, user_limit)
     VALUES (?, ?, ?, ?, 'starter', 100)`,
    [companyName, sipDomain, testEmail, testEmail],
  );
  const tenantId = Number(tenantResult.insertId);
  await connection.query(
    `UPDATE tenants
     SET tenant_number = ?
     WHERE id = ?`,
    [`TENANT-${String(tenantId).padStart(6, "0")}`, tenantId],
  );

  const passwordHash = await hashPassword("Password123");
  const adminResult = await connection.query(
    `INSERT INTO admin_users (tenant_id, email, password_hash, display_name, role, status)
     VALUES (?, ?, ?, ?, 'owner', 'disabled')`,
    [tenantId, testEmail, passwordHash, companyName],
  );

  const { token, tokenHash } = createEmailToken();
  await connection.query(
    `INSERT INTO email_verification_tokens (admin_user_id, token_hash, expires_at)
     VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 1 DAY))`,
    [Number(adminResult.insertId), tokenHash],
  );

  const verificationUrl = `${appUrl}/?verifyEmailToken=${encodeURIComponent(token)}`;
  await queueVerificationEmail(connection, { email: testEmail, verificationUrl });

  await connection.commit();

  console.log(`Registration flow ok: ${testEmail}`);
} finally {
  if (connection) connection.release();
  await pool.end();
}
