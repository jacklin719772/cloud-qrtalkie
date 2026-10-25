import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { hashPassword, verifyPassword } from "./security.js";
import {
  BACKUP_ROOT,
  createFullBackupArchive,
  getBackupPasswordForDate,
  isBackupActive,
  setBackupSuspended,
} from "./backupService.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INIT_BACKUP_ROOT = process.env.SYSTEM_INIT_BACKUP_DIR || "/data/qrtalkie-init-backups";
const QUARANTINE_ROOT = process.env.SYSTEM_INIT_QUARANTINE_DIR || "/data/qrtalkie-init-quarantine";
const TARGET_ADMIN_EMAIL = String(process.env.SYSTEM_INIT_ADMIN_EMAIL || "imflybird719772@gmail.com").trim().toLowerCase();
const TARGET_ADMIN_PASSWORD = String(process.env.SYSTEM_INIT_ADMIN_PASSWORD || "");
const CONFIRMATION_TEXT = "初始化";
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const LOCK_NAME = "qrtalkie_system_initialization";

const TABLE_GROUPS = [
  {
    key: "accounts",
    label: "帳號、會話與臨時策略",
    tables: [
      "admin_email_change_codes",
      "admin_sessions",
      "admin_user_sip_accounts",
      "password_reset_tokens",
      "email_verification_tokens",
      "web_users",
      "sip_users",
      "sip_external_accounts",
      "account_contacts_backup",
      "agents",
      "chatroom_ephemeral_policy",
      "user_reports",
      "platform_admin_users",
    ],
  },
  {
    key: "billing",
    label: "租戶、訂購與財務",
    tables: [
      "billing_orders",
      "billing_order_items",
      "billing_order_renewal_retained_accounts",
      "billing_order_retained_accounts",
      "billing_order_sip_accounts",
      "billing_order_status_history",
      "billing_order_web_accounts",
      "billing_payments",
      "order_invoice_logs",
      "order_payment_logs",
      "billing_tenant_coupons",
      "tenant_billing_addresses",
      "trial_assignments",
      "trial_notification_log",
    ],
  },
  {
    key: "contacts",
    label: "通訊錄、電子名片與帳號權益",
    tables: [
      "tenant_contact_books",
      "tenant_contact_book_assignments",
      "tenant_contact_book_entries",
      "tenant_ecards",
      "tenant_sip_account_entitlements",
      "tenant_web_account_entitlements",
    ],
  },
  {
    key: "callcenter",
    label: "呼叫中心",
    tables: [
      "call_centers",
      "call_center_categories",
      "call_center_category_agents",
      "call_center_visitor_inquiries",
      "call_center_visit_logs",
      "call_center_agent_action_logs",
    ],
  },
  {
    key: "access",
    label: "樓宇與門禁",
    tables: [
      "access_communities",
      "access_buildings",
      "access_entrances",
      "access_rooms",
      "access_room_entrance_auth",
      "gate_devices",
      "gate_device_assignment_history",
    ],
  },
  {
    key: "ca-ai",
    label: "客服、AI 與附件",
    tables: [
      "ca_archives",
      "ca_attachments",
      "ca_audit_log",
      "ca_conversations",
      "ca_ecard_settings",
      "ca_messages",
      "ca_resume_tokens",
      "ca_sessions",
      "ca_visitors",
      "ai_api_keys",
      "ai_attachments",
      "ai_bot_account_entitlements",
      "ai_bot_messages",
      "ai_bot_sessions",
      "ai_kb_chunks",
      "ai_kb_documents",
      "ai_knowledge_bases",
      "ai_message_reasoning",
      "ai_prompts",
      "ai_share_links",
    ],
  },
  {
    key: "telemetry",
    label: "通話、推送、在線狀態與郵件",
    tables: [
      "flexisip_call_devices",
      "flexisip_call_events",
      "flexisip_call_logs",
      "notification_events",
      "notification_receipts",
      "push_devices",
      "push_events",
      "webrtc_account_presence_events",
      "webrtc_account_presence_state",
      "email_outbox",
    ],
  },
  {
    key: "leftovers",
    label: "生產遷移遺留表",
    tables: ["sip_users_pending_bak_20261006", "billing_plan_addons_bak_20261006"],
  },
  {
    key: "backups",
    label: "備份記錄",
    tables: ["backup_records"],
  },
];

const CLEAR_TABLES = [...new Set(TABLE_GROUPS.flatMap((group) => group.tables))];

const FILE_RULES = [
  {
    key: "community",
    label: "社區／樓宇上傳圖片",
    dir: "assets/community-images",
    keep: ["locker-default-banner.png", "locker-default-banner2.png"],
  },
  {
    key: "callcenter",
    label: "呼叫中心圖片（保留系統預設 2 張）",
    dir: "assets/call-center-images",
    keep: ["cc-black-banner.png", "cc-default-banner.png"],
  },
  {
    key: "ecard",
    label: "電子名片圖片（保留預設模板引用）",
    dir: "assets/ecard-images",
    keepFromDb: true,
  },
  { key: "ai-attachments", label: "AI 附件", dir: "assets/ai-attachments" },
  { key: "ca-archives", label: "客服歸檔", dir: "assets/ca-archives" },
  { key: "ca-attachments", label: "客服附件", dir: "assets/ca-attachments" },
  { key: "payment-proofs", label: "付款憑證", dir: "assets/payment-proofs" },
  { key: "avatars", label: "帳號頭像", dir: "uploads/avatars" },
  { key: "backup-root", label: "SaaS 備份檔案", dir: BACKUP_ROOT, absolute: true, entries: true },
  {
    key: "project-backups",
    label: "遷移期備份與配置快照",
    dir: path.join(PROJECT_ROOT, "backups"),
    absolute: true,
    entries: true,
  },
];

const verificationTokens = new Map();
const backupJobs = new Map();
let activeRun = null;
let initializationActive = false;

function httpError(message, statusCode = 500, code = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function assertTargetAdminConfigured() {
  if (!TARGET_ADMIN_PASSWORD) {
    throw httpError("初始化密碼未配置（SYSTEM_INIT_ADMIN_PASSWORD）。", 500, "INIT_PASSWORD_NOT_CONFIGURED");
  }
}

async function ensureSystemInitSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS system_init_runs (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       run_id VARCHAR(64) NOT NULL,
       admin_user_id BIGINT UNSIGNED NULL,
       admin_email VARCHAR(255) NOT NULL,
       backup_filename VARCHAR(255) NOT NULL,
       backup_sha256 CHAR(64) NOT NULL,
       status ENUM('running','success','failed') NOT NULL DEFAULT 'running',
       summary_json LONGTEXT NULL,
       error_message TEXT NULL,
       started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       finished_at DATETIME NULL,
       UNIQUE KEY uk_run_id (run_id),
       KEY idx_started_at (started_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function getTargetAdmin(connection) {
  const rows = await connection.query(
    `SELECT id, email, password_hash, account_type, platform_role, status
     FROM admin_users
     WHERE LOWER(email) = ?
     LIMIT 1`,
    [TARGET_ADMIN_EMAIL]
  );
  return rows[0] || null;
}

async function getExistingTables(connection) {
  const rows = await connection.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  return new Set(rows.map((row) => String(row.name)));
}

async function loadEcardKeepFiles(connection) {
  const keep = new Set();
  try {
    const rows = await connection.query(
      `SELECT cover_image_url AS url FROM ecard_styles WHERE cover_image_url IS NOT NULL
       UNION
       SELECT image_url FROM ecard_style_backgrounds WHERE image_url IS NOT NULL
       UNION
       SELECT thumbnail_url FROM ecard_style_backgrounds WHERE thumbnail_url IS NOT NULL
       UNION
       SELECT image_url FROM ecard_style_samples WHERE image_url IS NOT NULL
       UNION
       SELECT thumbnail_url FROM ecard_style_samples WHERE thumbnail_url IS NOT NULL`
    );
    for (const row of rows) {
      const value = String(row.url || "").trim();
      if (!value) continue;
      let pathname = value;
      try {
        pathname = new URL(value, "http://localhost").pathname;
      } catch {}
      const basename = path.basename(pathname);
      if (basename) keep.add(basename);
    }
  } catch (error) {
    console.error("[SystemInit] load ecard keep files failed:", error?.message || error);
  }
  return keep;
}

async function listFilesRecursive(dir) {
  const results = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) results.push(full);
    }
  }
  await walk(dir);
  return results;
}

async function listTopEntries(dir) {
  const results = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() || entry.isDirectory()) results.push(path.join(dir, entry.name));
  }
  return results;
}

async function pathSize(target) {
  let info;
  try {
    info = await stat(target);
  } catch {
    return 0;
  }
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  let total = 0;
  for (const file of await listFilesRecursive(target)) {
    try {
      total += (await stat(file)).size;
    } catch {}
  }
  return total;
}

function basenameFromUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return path.basename(new URL(text, "http://localhost").pathname);
  } catch {
    return path.basename(text);
  }
}

async function loadOldReleaseRows(connection) {
  try {
    return await connection.query(
      `SELECT ar.id, ar.platform, ar.version, ar.download_url
       FROM app_releases ar
       JOIN (
         SELECT platform, MAX(version_code) AS max_code
         FROM app_releases
         WHERE platform IN ('android', 'windows')
         GROUP BY platform
       ) latest ON latest.platform = ar.platform
       WHERE ar.platform IN ('android', 'windows') AND ar.version_code < latest.max_code`
    );
  } catch {
    return [];
  }
}

async function loadLatestReleaseRows(connection) {
  try {
    return await connection.query(
      `SELECT ar.platform, ar.version, ar.download_url
       FROM app_releases ar
       JOIN (
         SELECT platform, MAX(version_code) AS max_code
         FROM app_releases
         GROUP BY platform
       ) latest ON latest.platform = ar.platform AND latest.max_code = ar.version_code`
    );
  } catch {
    return [];
  }
}

async function buildFileDeletionPlan(connection) {
  const plan = [];
  const groups = [];
  const ecardKeep = await loadEcardKeepFiles(connection);

  for (const rule of FILE_RULES) {
    const dir = rule.absolute ? rule.dir : path.join(PROJECT_ROOT, rule.dir);
    const candidates = rule.entries ? await listTopEntries(dir) : await listFilesRecursive(dir);
    const keep = new Set(rule.keep || []);
    if (rule.keepFromDb) {
      for (const name of ecardKeep) keep.add(name);
    }
    const deletable = [];
    for (const candidate of candidates) {
      if (keep.has(path.basename(candidate))) continue;
      deletable.push(candidate);
    }
    let bytes = 0;
    for (const candidate of deletable) bytes += await pathSize(candidate);
    plan.push(...deletable);
    if (deletable.length > 0) {
      groups.push({ key: rule.key, label: rule.label, count: deletable.length, bytes });
    }
  }

  const oldReleases = await loadOldReleaseRows(connection);
  const latestReleases = await loadLatestReleaseRows(connection);
  const keptNames = new Set(latestReleases.map((row) => basenameFromUrl(row.download_url)).filter(Boolean));
  const oldNames = new Set(oldReleases.map((row) => basenameFromUrl(row.download_url)).filter(Boolean));
  const installerFiles = [];
  for (const name of oldNames) {
    if (!name || keptNames.has(name)) continue;
    const full = path.join(PROJECT_ROOT, "public/download", name);
    if (existsSync(full)) installerFiles.push(full);
  }
  if (installerFiles.length > 0) {
    let bytes = 0;
    for (const file of installerFiles) bytes += await pathSize(file);
    plan.push(...installerFiles);
    groups.push({ key: "old-installers", label: "舊版本安裝包", count: installerFiles.length, bytes });
  }

  return { files: [...new Set(plan)], groups };
}

export async function buildSystemInitializationPreview() {
  await ensureSystemInitSchema();
  const connection = await pool.getConnection();
  try {
    const existing = await getExistingTables(connection);
    const tables = [];
    for (const group of TABLE_GROUPS) {
      for (const table of group.tables) {
        if (!existing.has(table)) continue;
        const rows = await connection.query(`SELECT COUNT(*) AS cnt FROM \`${table}\``);
        tables.push({
          group: group.key,
          groupLabel: group.label,
          table,
          count: Number(rows[0]?.cnt || 0),
        });
      }
    }

    const partials = [];
    if (existing.has("admin_users")) {
      const rows = await connection.query(
        "SELECT COUNT(*) AS cnt FROM admin_users WHERE LOWER(email) <> ?",
        [TARGET_ADMIN_EMAIL]
      );
      partials.push({
        key: "admin_users",
        label: `管理員帳號（保留 ${TARGET_ADMIN_EMAIL}）`,
        count: Number(rows[0]?.cnt || 0),
        action: "delete",
      });
    }
    if (existing.has("tenants")) {
      const rows = await connection.query("SELECT COUNT(*) AS cnt FROM tenants WHERE is_system = 0");
      partials.push({
        key: "tenants",
        label: "租戶（保留系統試用租戶）",
        count: Number(rows[0]?.cnt || 0),
        action: "delete",
      });
    }
    if (existing.has("app_releases")) {
      const rows = await loadOldReleaseRows(connection);
      partials.push({
        key: "app_releases",
        label: "App 舊版本記錄（每個平台保留最新版）",
        count: rows.length,
        action: "delete",
      });
    }
    if (existing.has("billing_coupons")) {
      const rows = await connection.query("SELECT COUNT(*) AS cnt FROM billing_coupons");
      partials.push({
        key: "billing_coupons",
        label: "優惠碼（保留，已兌換次數歸零）",
        count: Number(rows[0]?.cnt || 0),
        action: "reset",
      });
    }
    partials.push({
      key: "homepage_links",
      label: "首頁演示連結與在線客服帳號引用（重置為空）",
      count: 3,
      action: "reset",
    });

    const filePlan = await buildFileDeletionPlan(connection);
    const totalRows = tables.reduce((sum, row) => sum + row.count, 0)
      + partials.filter((row) => row.action === "delete").reduce((sum, row) => sum + row.count, 0);
    const totalFiles = filePlan.groups.reduce((sum, row) => sum + row.count, 0);
    const totalBytes = filePlan.groups.reduce((sum, row) => sum + row.bytes, 0);

    const latest = await loadLatestReleaseRows(connection);
    const kept = [
      `超級管理員 ${TARGET_ADMIN_EMAIL}（初始化後密碼重置）`,
      "系統試用租戶（is_system=1）",
      "平台計費目錄、支付方式、優惠碼定義",
      "電子名片預設模板與其引用圖片",
      "呼叫中心預設 banner、樓宇／訪客系統頁面與圖片",
      `目前 App 版本：${latest.map((row) => `${row.platform} ${row.version}`).join(" / ") || "無"}`,
      "首頁品牌資訊、備案號、iOS 連結、隱私政策、服務條款",
    ];

    return {
      generatedAt: new Date().toISOString(),
      targetAdminEmail: TARGET_ADMIN_EMAIL,
      tables,
      partials,
      files: filePlan.groups,
      totals: { rows: totalRows, files: totalFiles, bytes: totalBytes },
      kept,
    };
  } finally {
    connection.release();
  }
}

function pruneVerificationTokens() {
  const now = Date.now();
  for (const [token, record] of verificationTokens) {
    if (!record || record.expiresAt <= now) verificationTokens.delete(token);
  }
}

function requireVerificationToken(token, adminId) {
  pruneVerificationTokens();
  const record = verificationTokens.get(String(token || ""));
  if (!record) throw httpError("驗證已失效，請重新輸入超級管理員帳號密碼。", 401, "INIT_TOKEN_INVALID");
  if (record.expiresAt <= Date.now()) {
    verificationTokens.delete(String(token));
    throw httpError("驗證已過期，請重新輸入超級管理員帳號密碼。", 401, "INIT_TOKEN_EXPIRED");
  }
  if (Number(record.adminId) !== Number(adminId)) {
    throw httpError("驗證不屬於目前管理員。", 403, "INIT_TOKEN_OWNER_MISMATCH");
  }
  return record;
}

export async function verifySystemInitializationAdmin({ email, password }) {
  assertTargetAdminConfigured();
  await ensureSystemInitSchema();
  const normalized = normalizeEmail(email);
  if (normalized !== TARGET_ADMIN_EMAIL) {
    throw httpError("只能由指定的初始化超級管理員執行。", 403, "INIT_ADMIN_EMAIL_MISMATCH");
  }
  const connection = await pool.getConnection();
  let admin;
  try {
    admin = await getTargetAdmin(connection);
  } finally {
    connection.release();
  }
  if (!admin) throw httpError("初始化超級管理員帳號不存在。", 404, "INIT_ADMIN_NOT_FOUND");
  if (admin.status !== "active") throw httpError("初始化超級管理員帳號未啟用。", 403, "INIT_ADMIN_DISABLED");
  if (admin.account_type !== "platform" || admin.platform_role !== "super_admin") {
    throw httpError("指定帳號不是平台超級管理員。", 403, "INIT_ADMIN_NOT_SUPER");
  }
  if (!(await verifyPassword(String(password || ""), admin.password_hash))) {
    throw httpError("超級管理員帳號或密碼不正確。", 401, "INIT_ADMIN_CREDENTIALS_INVALID");
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  verificationTokens.set(token, {
    adminId: Number(admin.id),
    email: TARGET_ADMIN_EMAIL,
    expiresAt,
    usedAt: null,
  });
  const preview = await buildSystemInitializationPreview();
  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
    preview,
    warning: [
      "初始化會永久刪除租戶、帳號、訂單、客服、AI、門禁、通話與在線狀態等業務資料。",
      "伺服器上原有備份記錄與備份檔也會一併清除。",
      "執行前必須先建立並下載初始化備份，否則無法繼續。",
      "初始化完成後所有管理員會話失效，只能用初始化超級管理員重新登入。",
    ],
  };
}

export async function startInitializationBackup({ adminId, token }) {
  assertTargetAdminConfigured();
  requireVerificationToken(token, adminId);
  if (isBackupActive()) {
    throw httpError("目前有備份正在進行，請稍後再試。", 409, "BACKUP_IN_PROGRESS");
  }
  for (const job of backupJobs.values()) {
    if (job.status === "running") {
      throw httpError("初始化備份正在建立中，請稍候。", 409, "INIT_BACKUP_IN_PROGRESS");
    }
  }
  for (const oldJob of [...backupJobs.values()]) {
    if (Number(oldJob.adminId) !== Number(adminId)) continue;
    try { await unlink(oldJob.filePath); } catch {}
    try { await unlink(oldJob.metadataPath); } catch {}
    backupJobs.delete(oldJob.id);
  }

  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const compactDate = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const time = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  const id = randomBytes(12).toString("hex");
  const suffix = randomBytes(2).toString("hex");
  const filename = `qrtalkie-init-backup-${compactDate}-${time}-${suffix}.zip`;
  const downloadToken = randomBytes(32).toString("hex");
  const job = {
    id,
    adminId: Number(adminId),
    filename,
    version: `init-${compactDate}-${time}`,
    passwordDate: compactDate,
    downloadToken,
    downloadTokenExpiresAt: Date.now() + 2 * 60 * 60 * 1000,
    filePath: path.join(INIT_BACKUP_ROOT, filename),
    metadataPath: path.join(INIT_BACKUP_ROOT, `${filename}.json`),
    status: "running",
    sizeBytes: 0,
    sha256: "",
    downloadedAt: null,
    createdAt: now.toISOString(),
    finishedAt: null,
    error: "",
  };
  backupJobs.set(id, job);

  (async () => {
    setBackupSuspended(true);
    try {
      const result = await createFullBackupArchive({
        outputDir: INIT_BACKUP_ROOT,
        filename,
        version: job.version,
        passwordDate: compactDate,
        includeSaasData: true,
      });
      job.status = "success";
      job.filePath = result.filePath;
      job.sizeBytes = result.sizeBytes;
      job.sha256 = result.sha256;
      job.finishedAt = new Date().toISOString();
      await writeFile(
        job.metadataPath,
        JSON.stringify(
          {
            id: job.id,
            adminId: job.adminId,
            filename: job.filename,
            version: job.version,
            passwordDate: job.passwordDate,
            downloadToken: job.downloadToken,
            downloadTokenExpiresAt: job.downloadTokenExpiresAt,
            sizeBytes: job.sizeBytes,
            sha256: job.sha256,
            createdAt: job.createdAt,
            finishedAt: job.finishedAt,
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
      console.log(`[SystemInit] backup success: ${filename} (${result.sizeBytes} bytes)`);
    } catch (error) {
      job.status = "failed";
      job.error = String(error?.message || error).slice(0, 2000);
      job.finishedAt = new Date().toISOString();
      console.error("[SystemInit] backup failed:", job.error);
    } finally {
      setBackupSuspended(false);
    }
  })();

  return publicBackupJob(job);
}

function publicBackupJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    filename: job.filename,
    status: job.status,
    sizeBytes: job.sizeBytes,
    sha256: job.sha256,
    downloaded: Boolean(job.downloadedAt),
    downloadedAt: job.downloadedAt,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    error: job.error,
    password: job.status === "success" ? getBackupPasswordForDate(job.passwordDate) : "",
    downloadUrl:
      job.status === "success" && job.downloadToken && Number(job.downloadTokenExpiresAt || 0) > Date.now()
        ? `/api/platform/system-initialization/download/${job.downloadToken}`
        : "",
  };
}

export function getInitializationBackupJob(id) {
  return backupJobs.get(String(id || "")) || null;
}

export function getInitializationBackupJobByDownloadToken(token) {
  const value = String(token || "");
  if (!value) return null;
  for (const job of backupJobs.values()) {
    if (job.downloadToken !== value) continue;
    if (Number(job.downloadTokenExpiresAt || 0) <= Date.now()) return null;
    return job;
  }
  return null;
}

export function publicInitializationBackupJob(job) {
  return publicBackupJob(job);
}

export function markInitializationBackupDownloaded(id) {
  const job = backupJobs.get(String(id || ""));
  if (!job || job.status !== "success") return;
  job.downloadedAt = job.downloadedAt || new Date().toISOString();
}

export async function deleteInitializationBackupJob({ adminId, id }) {
  const job = backupJobs.get(String(id || ""));
  if (!job || Number(job.adminId) !== Number(adminId)) {
    throw httpError("初始化備份不存在。", 404, "INIT_BACKUP_NOT_FOUND");
  }
  if (job.status === "running") {
    throw httpError("初始化備份正在建立中，不能刪除。", 409, "INIT_BACKUP_RUNNING");
  }
  try { await unlink(job.filePath); } catch {}
  try { await unlink(job.metadataPath); } catch {}
  backupJobs.delete(job.id);
  return true;
}

export async function loadInitializationBackupsFromDisk() {
  let entries = [];
  try {
    entries = await readdir(INIT_BACKUP_ROOT, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".zip.json")) continue;
    try {
      const metadata = JSON.parse(await readFile(path.join(INIT_BACKUP_ROOT, entry.name), "utf8"));
      if (!metadata?.id || backupJobs.has(metadata.id)) continue;
      const filePath = path.join(INIT_BACKUP_ROOT, metadata.filename);
      if (!existsSync(filePath)) continue;
      backupJobs.set(metadata.id, {
        ...metadata,
        filePath,
        metadataPath: path.join(INIT_BACKUP_ROOT, entry.name),
        downloadToken: metadata.downloadToken || randomBytes(32).toString("hex"),
        downloadTokenExpiresAt: Number(metadata.downloadTokenExpiresAt || 0) || Date.now() + 2 * 60 * 60 * 1000,
        status: "success",
        downloadedAt: null,
        error: "",
      });
    } catch (error) {
      console.error("[SystemInit] load backup metadata failed:", error?.message || error);
    }
  }
}

export function getSystemInitializationState() {
  return {
    running: initializationActive,
    run: activeRun ? publicRun(activeRun) : null,
    targetAdminEmail: TARGET_ADMIN_EMAIL,
    backupDir: INIT_BACKUP_ROOT,
  };
}

function publicRun(run) {
  return {
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary || null,
    error: run.error || "",
    backup: run.backup || null,
    backupDeleted: Boolean(run.backupDeleted),
    purgeWarning: run.purgeWarning || "",
  };
}

export function isSystemInitializationRunning() {
  return initializationActive;
}

export async function startSystemInitialization({ adminId, email, token, backupId, confirmationText, backupConfirmed }) {
  assertTargetAdminConfigured();
  if (initializationActive) throw httpError("初始化正在進行中。", 409, "INIT_IN_PROGRESS");
  const tokenRecord = requireVerificationToken(token, adminId);
  if (tokenRecord.usedAt) throw httpError("此驗證已使用，請重新驗證。", 401, "INIT_TOKEN_USED");
  if (normalizeEmail(email) !== TARGET_ADMIN_EMAIL) {
    throw httpError("只能由指定的初始化超級管理員執行。", 403, "INIT_ADMIN_EMAIL_MISMATCH");
  }
  if (String(confirmationText || "").trim() !== CONFIRMATION_TEXT) {
    throw httpError(`請輸入「${CONFIRMATION_TEXT}」以確認執行。`, 400, "INIT_CONFIRMATION_MISMATCH");
  }
  if (!backupConfirmed) {
    throw httpError("請先確認已下載並校驗初始化備份。", 400, "INIT_BACKUP_NOT_CONFIRMED");
  }
  const job = backupJobs.get(String(backupId || ""));
  if (!job || Number(job.adminId) !== Number(adminId)) {
    throw httpError("初始化備份不存在或不屬於目前管理員。", 404, "INIT_BACKUP_NOT_FOUND");
  }
  if (job.status !== "success") throw httpError("初始化備份尚未完成。", 409, "INIT_BACKUP_NOT_READY");
  if (!job.downloadedAt) throw httpError("請先下載初始化備份並校驗 SHA256。", 400, "INIT_BACKUP_NOT_DOWNLOADED");

  tokenRecord.usedAt = new Date().toISOString();
  const statusToken = randomBytes(32).toString("hex");
  const runId = `init-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const run = {
    runId,
    statusToken,
    status: "running",
    adminId: Number(adminId),
    adminEmail: TARGET_ADMIN_EMAIL,
    backup: {
      id: job.id,
      filename: job.filename,
      sha256: job.sha256,
      sizeBytes: job.sizeBytes,
    },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summary: null,
    error: "",
    purgeWarning: "",
    backupDeleted: false,
  };
  activeRun = run;
  initializationActive = true;
  setBackupSuspended(true);

  executeInitialization(run, job).catch((error) => {
    run.status = "failed";
    run.error = String(error?.message || error).slice(0, 2000);
    run.finishedAt = new Date().toISOString();
    initializationActive = false;
    setBackupSuspended(false);
    console.error("[SystemInit] run failed:", run.error);
  });

  return { runId, statusToken, status: "running", backup: run.backup };
}

export function getSystemInitializationRun(runId, statusToken) {
  if (!activeRun || activeRun.runId !== String(runId || "")) return null;
  if (activeRun.statusToken !== String(statusToken || "")) return null;
  return publicRun(activeRun);
}

export async function deleteInitializationBackupFile(runId, statusToken) {
  if (!activeRun || activeRun.runId !== String(runId || "")) {
    throw httpError("初始化記錄不存在。", 404, "INIT_RUN_NOT_FOUND");
  }
  if (activeRun.statusToken !== String(statusToken || "")) {
    throw httpError("無權刪除初始化備份。", 403, "INIT_RUN_TOKEN_MISMATCH");
  }
  if (activeRun.status !== "success") {
    throw httpError("初始化尚未成功，不能刪除備份。", 409, "INIT_RUN_NOT_SUCCESS");
  }
  const job = backupJobs.get(String(activeRun.backup?.id || ""));
  if (job) {
    try { await unlink(job.filePath); } catch {}
    try { await unlink(job.metadataPath); } catch {}
    backupJobs.delete(job.id);
  }
  return true;
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function moveToQuarantine(files, runId) {
  const root = path.join(QUARANTINE_ROOT, runId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const moved = [];
  try {
    for (const source of files) {
      let info;
      try {
        info = await stat(source);
      } catch {
        continue;
      }
      if (!info.isFile() && !info.isDirectory()) continue;
      const relative = path.relative("/", source);
      if (!relative || relative.startsWith("..")) {
        throw new Error(`隔離路徑不合法：${source}`);
      }
      const destination = path.join(root, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      try {
        await rename(source, destination);
      } catch {
        await cp(source, destination, { recursive: true, force: true });
        await rm(source, { recursive: true, force: true });
      }
      moved.push({ source, destination });
    }
    await writeFile(path.join(root, "manifest.json"), JSON.stringify(moved, null, 2), { mode: 0o600 });
    return { root, moved };
  } catch (error) {
    await restoreQuarantine({ root, moved });
    throw error;
  }
}

async function restoreQuarantine({ root, moved }) {
  for (const item of [...moved].reverse()) {
    try {
      await mkdir(path.dirname(item.source), { recursive: true });
      try {
        await rename(item.destination, item.source);
      } catch {
        await cp(item.destination, item.source, { recursive: true, force: true });
        await rm(item.destination, { recursive: true, force: true });
      }
    } catch (error) {
      console.error("[SystemInit] restore failed:", item.source, error?.message || error);
    }
  }
  try { await rm(root, { recursive: true, force: true }); } catch {}
}

async function recordRun(run, status, errorMessage = "") {
  try {
    await ensureSystemInitSchema();
    await pool.query(
      `INSERT INTO system_init_runs
         (run_id, admin_user_id, admin_email, backup_filename, backup_sha256, status, summary_json, error_message, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        run.runId,
        run.adminId,
        run.adminEmail,
        run.backup?.filename || "",
        run.backup?.sha256 || "",
        status,
        run.summary ? JSON.stringify(run.summary) : null,
        errorMessage ? String(errorMessage).slice(0, 2000) : null,
        run.startedAt ? new Date(run.startedAt) : new Date(),
      ]
    );
  } catch (error) {
    console.error("[SystemInit] record run failed:", error?.message || error);
  }
}

async function executeInitialization(run, job) {
  let connection;
  let lockAcquired = false;
  let quarantine = null;
  try {
    // 維護模式已開啟，等待已進入的請求完成，避免刪除後又被寫入。
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (isBackupActive()) {
      throw new Error("目前有一般備份正在進行，請稍後再試。");
    }
    if (!existsSync(job.filePath)) throw new Error("初始化備份檔案不存在。");
    const backupInfo = await stat(job.filePath);
    if (!backupInfo.isFile() || backupInfo.size !== Number(job.sizeBytes)) {
      throw new Error("初始化備份檔案大小不一致。");
    }
    const actualSha256 = await hashFile(job.filePath);
    if (actualSha256 !== job.sha256) {
      throw new Error("初始化備份 SHA256 校驗失敗。");
    }

    connection = await pool.getConnection();
    const lockRows = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_NAME]);
    if (Number(lockRows[0]?.acquired || 0) !== 1) {
      throw new Error("無法取得初始化鎖，請稍後再試。");
    }
    lockAcquired = true;

    const target = await getTargetAdmin(connection);
    if (!target) throw new Error("初始化超級管理員帳號不存在。");
    if (target.status !== "active") throw new Error("初始化超級管理員帳號未啟用。");

    const existingTables = await getExistingTables(connection);
    const filePlan = await buildFileDeletionPlan(connection);
    quarantine = await moveToQuarantine(filePlan.files, run.runId);

    const summary = {
      tables: {},
      partials: {},
      files: filePlan.groups,
      fileCount: filePlan.files.length,
      settingsReset: [],
      startedAt: run.startedAt,
    };

    try {
      await connection.beginTransaction();
      await connection.query("SET FOREIGN_KEY_CHECKS=0");
      for (const table of CLEAR_TABLES) {
        if (!existingTables.has(table)) continue;
        const result = await connection.query(`DELETE FROM \`${table}\``);
        summary.tables[table] = Number(result.affectedRows || 0);
      }

      const adminDelete = await connection.query("DELETE FROM admin_users WHERE id <> ?", [target.id]);
      summary.partials.adminUsersDeleted = Number(adminDelete.affectedRows || 0);

      const tenantDelete = await connection.query("DELETE FROM tenants WHERE is_system = 0");
      summary.partials.tenantsDeleted = Number(tenantDelete.affectedRows || 0);

      const oldReleases = await loadOldReleaseRows(connection);
      if (oldReleases.length > 0) {
        const result = await connection.query(
          `DELETE ar FROM app_releases ar
           JOIN (
             SELECT platform, MAX(version_code) AS max_code
             FROM app_releases
             WHERE platform IN ('android', 'windows')
             GROUP BY platform
           ) latest ON latest.platform = ar.platform
           WHERE ar.platform IN ('android', 'windows') AND ar.version_code < latest.max_code`
        );
        summary.partials.appReleasesDeleted = Number(result.affectedRows || 0);
      } else {
        summary.partials.appReleasesDeleted = 0;
      }

      if (existingTables.has("billing_coupons")) {
        const result = await connection.query("UPDATE billing_coupons SET redeemed_count = 0");
        summary.partials.couponsReset = Number(result.affectedRows || 0);
      }

      const settings = [
        ["homepage_callcenter", JSON.stringify({ url: "" })],
        ["homepage_building", JSON.stringify({ url: "" })],
        ["homepage_livechat", JSON.stringify({ url: "", sipUserId: null })],
      ];
      for (const [key, value] of settings) {
        await connection.query(
          `INSERT INTO system_settings (setting_key, setting_value)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [key, value]
        );
        summary.settingsReset.push(key);
      }

      const passwordHash = await hashPassword(TARGET_ADMIN_PASSWORD);
      await connection.query(
        `UPDATE admin_users
         SET email = ?, password_hash = ?, display_name = COALESCE(display_name, 'Super Admin'),
             account_type = 'platform', tenant_id = NULL, role = 'admin', platform_role = 'super_admin',
             status = 'active', failed_login_count = 0, locked_until = NULL, last_login_at = NULL,
             email_verified_at = NOW()
         WHERE id = ?`,
        [TARGET_ADMIN_EMAIL, passwordHash, target.id]
      );
      await connection.query("DELETE FROM admin_sessions");

      await connection.query("SET FOREIGN_KEY_CHECKS=1");
      await connection.commit();
      if (quarantine) {
        try {
          await writeFile(path.join(quarantine.root, "COMMITTED"), new Date().toISOString(), { mode: 0o600 });
        } catch (error) {
          console.error("[SystemInit] write commit marker failed:", error?.message || error);
        }
      }
    } catch (error) {
      try { await connection.rollback(); } catch {}
      try { await connection.query("SET FOREIGN_KEY_CHECKS=1"); } catch {}
      throw error;
    }

    const committedQuarantine = quarantine;
    quarantine = null;
    try {
      await rm(committedQuarantine.root, { recursive: true, force: true });
    } catch (error) {
      run.purgeWarning = `隔離目錄清理失敗：${error?.message || error}`;
      console.error("[SystemInit]", run.purgeWarning);
    }

    run.summary = summary;
    run.status = "success";
    run.finishedAt = new Date().toISOString();
    await recordRun(run, "success");
    try {
      await unlink(job.filePath);
      try { await unlink(job.metadataPath); } catch {}
      backupJobs.delete(job.id);
      run.backupDeleted = true;
    } catch (error) {
      run.backupDeleted = false;
      run.purgeWarning = `${run.purgeWarning ? `${run.purgeWarning}；` : ""}伺服器備份自動刪除失敗：${error?.message || error}`;
      console.error("[SystemInit]", run.purgeWarning);
    }
    console.log(`[SystemInit] success: ${run.runId}`);
  } catch (error) {
    if (quarantine) {
      await restoreQuarantine(quarantine);
      quarantine = null;
    }
    run.status = "failed";
    run.error = String(error?.message || error).slice(0, 2000);
    run.finishedAt = new Date().toISOString();
    await recordRun(run, "failed", run.error);
    console.error("[SystemInit] failed:", run.error);
  } finally {
    if (lockAcquired && connection) {
      try { await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]); } catch {}
    }
    if (connection) connection.release();
    initializationActive = false;
    setBackupSuspended(false);
  }
}

async function recoverQuarantineDirectories() {
  let entries = [];
  try {
    entries = await readdir(QUARANTINE_ROOT, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(QUARANTINE_ROOT, entry.name);
    let moved = [];
    try {
      moved = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
    } catch {
      continue;
    }
    let committed = existsSync(path.join(root, "COMMITTED"));
    if (!committed) {
      try {
        const rows = await pool.query(
          "SELECT status FROM system_init_runs WHERE run_id = ? LIMIT 1",
          [entry.name]
        );
        committed = rows[0]?.status === "success";
      } catch {}
    }
    if (!committed) {
      try {
        const rows = await pool.query(
          "SELECT (SELECT COUNT(*) FROM tenants WHERE is_system = 0) AS tenant_count"
        );
        committed = Number(rows[0]?.tenant_count || 0) === 0;
      } catch {}
    }
    if (committed) {
      try { await rm(root, { recursive: true, force: true }); } catch {}
      console.log(`[SystemInit] cleaned committed quarantine: ${entry.name}`);
    } else {
      await restoreQuarantine({ root, moved });
      console.log(`[SystemInit] restored interrupted quarantine: ${entry.name}`);
    }
  }
}

async function cleanupStaleBackupTemps() {
  let entries = [];
  try {
    entries = await readdir(INIT_BACKUP_ROOT, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (entry.name.startsWith(".tmp-")) {
      try { await rm(path.join(INIT_BACKUP_ROOT, entry.name), { recursive: true, force: true }); } catch {}
      continue;
    }
    if (!entry.isFile() || (!entry.name.endsWith(".zip") && !entry.name.endsWith(".zip.json"))) continue;
    try {
      const info = await stat(path.join(INIT_BACKUP_ROOT, entry.name));
      if (info.mtimeMs < cutoff) {
        await unlink(path.join(INIT_BACKUP_ROOT, entry.name));
        console.log(`[SystemInit] removed stale init backup file: ${entry.name}`);
      }
    } catch {}
  }
}

(async () => {
  await cleanupStaleBackupTemps();
  await loadInitializationBackupsFromDisk();
  await recoverQuarantineDirectories();
})().catch((error) => {
  console.error("[SystemInit] startup recovery failed:", error?.message || error);
});
