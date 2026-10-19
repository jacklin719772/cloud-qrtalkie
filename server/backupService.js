import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { existsSync } from "node:fs";
import { pool } from "./db.js";

const BACKUP_ROOT = process.env.BACKUP_DIR || "/opt/backups/qrtalkie";
const PASSWORD_PREFIX = process.env.BACKUP_PASSWORD_PREFIX || "";
const RETENTION_DAYS = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 7));
const SCHEDULE_HOUR = Math.min(23, Math.max(0, Number(process.env.BACKUP_SCHEDULE_HOUR || 3)));
const TIMEZONE = process.env.BACKUP_TIMEZONE || "Asia/Hong_Kong";
const ENABLED = String(process.env.BACKUP_ENABLED || "true").toLowerCase() !== "false";
const SYSTEM_DATABASES = new Set(["information_schema", "performance_schema", "sys"]);

let activeBackup = null;
let scheduledTimer = null;

function getTimeParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    compactDate: `${parts.year}${parts.month}${parts.day}`,
    time: `${parts.hour}${parts.minute}${parts.second}`,
    hour: Number(parts.hour),
  };
}

function backupPassword(passwordDate) {
  if (!PASSWORD_PREFIX) {
    const error = new Error("備份下載密碼前綴未配置（BACKUP_PASSWORD_PREFIX）。");
    error.code = "BACKUP_PASSWORD_NOT_CONFIGURED";
    throw error;
  }
  return `${PASSWORD_PREFIX}${passwordDate}`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, env: process.env });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (data) => { stdout += data.toString(); });
    if (child.stderr) child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

async function ensureBackupSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS backup_records (
       id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       version VARCHAR(64) NOT NULL,
       filename VARCHAR(255) NOT NULL,
       size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
       sha256 CHAR(64) NOT NULL DEFAULT '',
       backup_type ENUM('manual','scheduled') NOT NULL DEFAULT 'manual',
       status ENUM('running','success','failed') NOT NULL DEFAULT 'running',
       error_message TEXT NULL,
       password_date CHAR(8) NOT NULL DEFAULT '',
       created_by_admin_id BIGINT UNSIGNED NULL,
       started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       finished_at DATETIME NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uk_backup_version (version),
       KEY idx_backup_created (created_at)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  await mkdir(BACKUP_ROOT, { recursive: true, mode: 0o700 });
}

async function listDatabases() {
  // 以 root 的 unix socket 權限列出全部資料庫；池連線只有業務庫權限
  const { stdout } = await run("mariadb", ["-N", "-B", "-e", "SHOW DATABASES"]);
  return stdout
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name && !SYSTEM_DATABASES.has(name));
}

async function dumpDatabase(connection, database, targetFile) {
  const args = [
    "--single-transaction",
    "--quick",
    "--routines",
    "--triggers",
    "--events",
    "--hex-blob",
    "--default-character-set=utf8mb4",
    "--databases",
    database,
  ];
  const dump = spawn("mariadb-dump", args, { env: process.env });
  const gzip = spawn("gzip", ["-9"]);
  let stderr = "";
  dump.stderr.on("data", (data) => { stderr += data.toString(); });
  gzip.stderr.on("data", (data) => { stderr += data.toString(); });
  const writeStream = createWriteStream(targetFile, { mode: 0o600 });
  dump.stdout.pipe(gzip.stdin);
  gzip.stdout.pipe(writeStream);
  const waitExit = (child) => new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`process exited ${code}: ${stderr.slice(-800)}`))));
  });
  await Promise.all([
    waitExit(dump),
    waitExit(gzip),
    new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    }),
  ]);
}

async function tarPaths(targetFile, relativePaths) {
  const existing = relativePaths.filter((rel) => existsSync(path.join("/", rel)));
  if (existing.length === 0) return false;
  await run("tar", ["-czf", targetFile, "-C", "/", ...existing]);
  return true;
}

async function collectFiles(dir, base = dir, result = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(full, base, result);
    else if (entry.isFile()) {
      try {
        const info = await stat(full);
        result.push({ path: path.relative(base, full).replace(/\\/g, "/"), size: info.size });
      } catch {}
    }
  }
  return result;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function runBackupJob(record) {
  const tempDir = await mkdtemp(path.join(BACKUP_ROOT, ".tmp-"));
  const buildDir = path.join(tempDir, "build");
  const databasesDir = path.join(buildDir, "databases");
  const configsDir = path.join(buildDir, "configs");
  const finalTmpZip = path.join(BACKUP_ROOT, `.${record.filename}`);
  const finalZip = path.join(BACKUP_ROOT, record.filename);
  let connection;
  try {
    await mkdir(databasesDir, { recursive: true });
    await mkdir(configsDir, { recursive: true });
    connection = await pool.getConnection();

    const databases = await listDatabases();
    for (const database of databases) {
      await dumpDatabase(connection, database, path.join(databasesDir, `${database}.sql.gz`));
    }

    // Asterisk：完整配置目录（含账号配置、证书、keys 等）
    await tarPaths(path.join(configsDir, "asterisk-config.tar.gz"), [
      "etc/asterisk",
      "etc/freepbx.conf",
      "etc/amportal.conf",
    ]);
    // Flexisip：主配置、APNs/Firebase 凭证等
    await tarPaths(path.join(configsDir, "flexisip-config.tar.gz"), ["etc/flexisip"]);
    // 系统相关配置
    await tarPaths(path.join(configsDir, "system-config.tar.gz"), [
      "etc/apache2",
      "etc/mysql",
      "etc/redis/redis.conf",
      "etc/turnserver.conf",
      "etc/default/coturn",
      "etc/mosquitto",
      "etc/letsencrypt",
      "etc/systemd/system",
      "etc/cron.d",
      "etc/crontab",
    ]);
    // Lime / File Transfer Server / Account Manager 配置与 SaaS 环境
    await tarPaths(path.join(configsDir, "apps-config.tar.gz"), [
      "opt/belledonne-communications/share/lime-server",
      "opt/belledonne-communications/share/flexisip-http-file-transfer-server",
      "etc/flexisip-account-manager",
      "opt/belledonne-communications/share/flexisip-account-manager/flexiapi/config",
      "opt/saas/.env",
      "opt/saas/.env.example",
      "opt/saas/package.json",
      "opt/saas/package-lock.json",
    ]);

    // Redis 注册缓存（能通过 redis-cli 导出则导出，否则复制现有 RDB）
    const redisDump = path.join(configsDir, "redis-dump.rdb");
    try {
      await run("redis-cli", ["--rdb", redisDump]);
    } catch {
      try { await copyFile("/var/lib/redis/dump.rdb", redisDump); } catch {}
    }

    const files = await collectFiles(buildDir);
    let saasCommit = "";
    try { saasCommit = (await run("git", ["-C", "/opt/saas", "rev-parse", "HEAD"])).stdout.trim(); } catch {}
    let mariadbVersion = "";
    try { mariadbVersion = (await run("mariadb-dump", ["--version"])).stdout.trim(); } catch {}
    let asteriskVersion = "";
    try { asteriskVersion = (await run("asterisk", ["-V"])).stdout.trim(); } catch {}

    const manifest = {
      version: record.version,
      filename: record.filename,
      createdAt: new Date().toISOString(),
      timezone: TIMEZONE,
      databases,
      files,
      versions: { saasCommit, mariadbVersion, asteriskVersion },
    };
    await writeFile(path.join(buildDir, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const sums = [];
    for (const file of files) sums.push(`${await sha256File(path.join(buildDir, file.path))}  ${file.path}`);
    await writeFile(path.join(buildDir, "SHA256SUMS"), sums.join("\n") + "\n", { mode: 0o600 });

    const password = backupPassword(record.password_date);
    await run("zip", ["-q", "-r", "-P", password, finalTmpZip, "."], { cwd: buildDir });
    await rename(finalTmpZip, finalZip);

    const zipStat = await stat(finalZip);
    const sha256 = await sha256File(finalZip);
    await connection.query(
      "UPDATE backup_records SET status='success', size_bytes=?, sha256=?, finished_at=NOW(), error_message=NULL WHERE id=?",
      [zipStat.size, sha256, record.id]
    );
    await pruneOldBackups(connection, record.id);
    console.log(`[Backup] success: ${record.filename} (${zipStat.size} bytes)`);
    return { ...record, status: "success", size_bytes: zipStat.size, sha256 };
  } catch (error) {
    try {
      if (connection) {
        await connection.query(
          "UPDATE backup_records SET status='failed', error_message=?, finished_at=NOW() WHERE id=?",
          [String(error?.message || error).slice(0, 2000), record.id]
        );
      }
    } catch {}
    console.error("[Backup] failed:", error?.message || error);
    throw error;
  } finally {
    if (connection) connection.release();
    try { await rm(tempDir, { recursive: true, force: true }); } catch {}
    try { await unlink(finalTmpZip); } catch {}
  }
}

async function pruneOldBackups(connection, keepId) {
  const rows = await connection.query(
    "SELECT id, filename FROM backup_records WHERE id <> ? AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
    [keepId, RETENTION_DAYS]
  );
  for (const row of rows) {
    try { await unlink(path.join(BACKUP_ROOT, row.filename)); } catch {}
    await connection.query("DELETE FROM backup_records WHERE id = ?", [row.id]);
  }
  if (rows.length > 0) console.log(`[Backup] pruned ${rows.length} backup(s) older than ${RETENTION_DAYS} days`);
}

export async function startBackup({ type = "manual", adminId = null } = {}) {
  await ensureBackupSchema();
  if (activeBackup) {
    const error = new Error("備份正在進行中，請稍後再試。");
    error.code = "BACKUP_IN_PROGRESS";
    error.statusCode = 409;
    throw error;
  }
  if (!PASSWORD_PREFIX) {
    const error = new Error("備份下載密碼前綴未配置（BACKUP_PASSWORD_PREFIX）。");
    error.code = "BACKUP_PASSWORD_NOT_CONFIGURED";
    error.statusCode = 500;
    throw error;
  }
  const parts = getTimeParts();
  const version = `v${parts.compactDate}-${parts.time}`;
  const filename = `qrtalkie-backup-${parts.compactDate}-${parts.time}.zip`;
  const connection = await pool.getConnection();
  let record;
  try {
    const result = await connection.query(
      `INSERT INTO backup_records (version, filename, backup_type, status, password_date, created_by_admin_id)
       VALUES (?, ?, ?, 'running', ?, ?)`,
      [version, filename, type === "scheduled" ? "scheduled" : "manual", parts.compactDate, adminId || null]
    );
    record = {
      id: Number(result.insertId),
      version,
      filename,
      backup_type: type,
      status: "running",
      password_date: parts.compactDate,
      password: `${PASSWORD_PREFIX}${parts.compactDate}`,
    };
  } finally {
    connection.release();
  }
  activeBackup = runBackupJob(record).finally(() => { activeBackup = null; });
  return record;
}

export async function listBackups() {
  await ensureBackupSchema();
  const rows = await pool.query(
    `SELECT id, version, filename, size_bytes, sha256, backup_type, status, error_message,
            password_date, started_at, finished_at, created_at
     FROM backup_records ORDER BY created_at DESC, id DESC LIMIT 100`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    version: row.version,
    filename: row.filename,
    sizeBytes: Number(row.size_bytes || 0),
    sha256: row.sha256 || "",
    type: row.backup_type,
    status: row.status,
    errorMessage: row.error_message || "",
    passwordDate: row.password_date || "",
    password: row.status === "success" && PASSWORD_PREFIX ? `${PASSWORD_PREFIX}${row.password_date}` : "",
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  }));
}

export async function getBackupById(id) {
  await ensureBackupSchema();
  const [row] = await pool.query("SELECT * FROM backup_records WHERE id = ? LIMIT 1", [id]);
  return row || null;
}

export function getBackupFilePath(record) {
  if (!record || record.status !== "success") return null;
  const filename = path.basename(String(record.filename || ""));
  if (!filename || filename !== record.filename) return null;
  const full = path.resolve(BACKUP_ROOT, filename);
  if (!full.startsWith(path.resolve(BACKUP_ROOT) + path.sep)) return null;
  return full;
}

export async function deleteBackup(id) {
  const record = await getBackupById(id);
  if (!record) {
    const error = new Error("備份不存在。");
    error.statusCode = 404;
    throw error;
  }
  const filePath = getBackupFilePath(record);
  if (filePath) { try { await unlink(filePath); } catch {} }
  await pool.query("DELETE FROM backup_records WHERE id = ?", [id]);
  return true;
}

export async function runScheduledBackupIfDue() {
  if (!ENABLED) return;
  try {
    await ensureBackupSchema();
    const parts = getTimeParts();
    if (parts.hour < SCHEDULE_HOUR) return;
    const [existing] = await pool.query(
      "SELECT id FROM backup_records WHERE backup_type='scheduled' AND password_date=? AND status IN ('running','success') LIMIT 1",
      [parts.compactDate]
    );
    if (existing) return;
    if (activeBackup) return;
    await startBackup({ type: "scheduled" });
    console.log(`[Backup] scheduled backup started for ${parts.date}`);
  } catch (error) {
    console.error("[Backup] scheduled backup error:", error?.message || error);
  }
}

export function startBackupScheduler() {
  if (!ENABLED) {
    console.log("[Backup] disabled by BACKUP_ENABLED");
    return;
  }
  if (scheduledTimer) return;
  scheduledTimer = setInterval(runScheduledBackupIfDue, 10 * 60 * 1000);
  setTimeout(runScheduledBackupIfDue, 60 * 1000);
  console.log(`[Backup] scheduler enabled, daily at ${SCHEDULE_HOUR}:00 ${TIMEZONE}, retention ${RETENTION_DAYS} days`);
}

export function stopBackupScheduler() {
  if (scheduledTimer) clearInterval(scheduledTimer);
  scheduledTimer = null;
}

export function getBackupSettings() {
  return {
    enabled: ENABLED,
    retentionDays: RETENTION_DAYS,
    scheduleHour: SCHEDULE_HOUR,
    timezone: TIMEZONE,
    passwordConfigured: Boolean(PASSWORD_PREFIX),
  };
}

export { ensureBackupSchema, BACKUP_ROOT, RETENTION_DAYS };
