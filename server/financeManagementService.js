import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const financeFilesDir = path.join(projectRoot, "assets/payment-proofs");
const ALLOWED_FILE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export class FinanceError extends Error {
  constructor(message, { statusCode = 400, code = "FINANCE_ERROR" } = {}) {
    super(message);
    this.name = "FinanceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function ensureFinanceSchema() {
  await pool.query(
    "ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS receivable_amount DECIMAL(12,2) NULL AFTER payable_amount",
  );
  await pool.query(
    `CREATE TABLE IF NOT EXISTS order_payment_logs (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       order_id BIGINT UNSIGNED NOT NULL,
       tenant_id BIGINT UNSIGNED NOT NULL,
       payment_date DATE NOT NULL,
       receiving_account_id BIGINT UNSIGNED NULL,
       receiving_account_name VARCHAR(255) NOT NULL DEFAULT '',
       receiving_bank_name VARCHAR(255) NOT NULL DEFAULT '',
       receiving_account_no VARCHAR(120) NOT NULL DEFAULT '',
       amount DECIMAL(12,2) NOT NULL DEFAULT 0,
       currency VARCHAR(8) NOT NULL DEFAULT '',
       voucher_no VARCHAR(120) NOT NULL DEFAULT '',
       voucher_file VARCHAR(500) NOT NULL DEFAULT '',
       invoiced TINYINT(1) NOT NULL DEFAULT 0,
       invoice_no VARCHAR(120) NOT NULL DEFAULT '',
       invoice_code VARCHAR(120) NOT NULL DEFAULT '',
       invoice_date DATE NULL,
       invoice_amount DECIMAL(12,2) NULL,
       invoice_file VARCHAR(500) NOT NULL DEFAULT '',
       notes TEXT NULL,
       created_by_admin_id BIGINT UNSIGNED NULL,
       created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       KEY idx_opl_order (order_id),
       KEY idx_opl_tenant (tenant_id),
       KEY idx_opl_date (payment_date)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );
}

export async function saveFinanceFile(dataUrl, { orderId, prefix } = {}) {
  const raw = String(dataUrl || "");
  const match = raw.match(/^data:([a-z0-9+/.-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) {
    throw new FinanceError("檔案格式不正確。", { code: "INVALID_FINANCE_FILE" });
  }
  const mime = match[1].toLowerCase();
  const ext = ALLOWED_FILE_TYPES[mime];
  if (!ext) {
    throw new FinanceError("僅支持 PNG、JPG、WEBP 或 PDF 檔案。", { code: "UNSUPPORTED_FINANCE_FILE" });
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
    throw new FinanceError("檔案大小需小於 10MB。", { code: "FINANCE_FILE_TOO_LARGE" });
  }
  await mkdir(financeFilesDir, { recursive: true });
  const fileName = `finance-${prefix || "file"}-${orderId || 0}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  await writeFile(path.join(financeFilesDir, fileName), buffer, { mode: 0o600 });
  return `/payment-proofs/${fileName}`;
}

export async function listReceivingAccounts() {
  return pool.query(
    `SELECT id, display_name AS displayName, payee_name AS payeeName,
            bank_name AS bankName, bank_account_no AS bankAccountNo, currency
       FROM billing_offline_payment_accounts
      WHERE status = 'active'
      ORDER BY is_default DESC, sort_order ASC, id ASC`,
  );
}
