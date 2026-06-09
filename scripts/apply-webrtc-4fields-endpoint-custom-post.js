import "dotenv/config";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat, copyFile, chmod, chown, rename, mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { verifyPjsipExtension } from "../server/asteriskCommandService.js";
import { getAsteriskPathConfig, getWebrtcRuntimeConfig } from "../server/webrtcTemplateLoader.js";

const execFileAsync = promisify(execFile);
const EXTENSION_PATTERN = /^\d+$/;
const ASTERISK_PATHS = getAsteriskPathConfig();
const WEBRTC_RUNTIME = getWebrtcRuntimeConfig();
const TARGET_FILE = ASTERISK_PATHS.endpointCustomPostConf;
const BACKUP_ROOT = ASTERISK_PATHS.backupRoot;
const PRIMARY_REFERENCE_EXTENSION = WEBRTC_RUNTIME.referenceExtension;
const FALLBACK_REFERENCE_EXTENSION = WEBRTC_RUNTIME.fallbackReferenceExtension;
const PREVIEW_FILE = (extension) => `/tmp/webrtc-4fields-endpoint-custom-post-preview-${extension}.conf`;
const REPORT_FILE = (extension, dryRun = false) =>
  dryRun
    ? `/tmp/webrtc-4fields-endpoint-custom-post-dry-run-${extension}.md`
    : `/tmp/webrtc-4fields-endpoint-custom-post-final-${extension}-report.md`;

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function assertExtension(extension) {
  if (!EXTENSION_PATTERN.test(String(extension || ""))) {
    const error = new Error("INVALID_WEBRTC_EXTENSION");
    error.code = "INVALID_WEBRTC_EXTENSION";
    throw error;
  }
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function runReadOnly(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: options.timeout || 15000,
    maxBuffer: options.maxBuffer || 1024 * 1024,
  });
  return `${stdout || ""}${stderr ? `\n${stderr}` : ""}`;
}

async function backupPjsipConfigs() {
  const output = await runReadOnly("node", ["scripts/backup-asterisk-pjsip-configs.js", "--confirm", "yes"], {
    timeout: 30000,
  });
  const backupDir = output.match(/Backup dir:\s*(\S+)/)?.[1] || "";
  const manifest = output.match(/Manifest:\s*(\S+)/)?.[1] || "";
  const copied = Number(output.match(/Files copied:\s*(\d+)/)?.[1] || 0);
  const missing = Number(output.match(/Files missing:\s*(\d+)/)?.[1] || 0);
  const warnings = Number(output.match(/Warnings:\s*(\d+)/)?.[1] || 0);
  return { output, backupDir, manifest, copied, missing, warnings };
}

function markerStart(extension) {
  return `; BEGIN SaaS WebRTC 4-field endpoint overlay ${extension}`;
}

function markerEnd(extension) {
  return `; END SaaS WebRTC 4-field endpoint overlay ${extension}`;
}

function buildPreview(extension) {
  return [
    markerStart(extension),
    `[${extension}](+)`,
    `allow_unauthenticated_options=yes`,
    `rtp_timeout=0`,
    `rtp_timeout_hold=0`,
    `asymmetric_rtp_codec=yes`,
    markerEnd(extension),
    "",
  ].join("\n");
}

function validatePreview(extension, preview) {
  if (!preview.includes(markerStart(extension)) || !preview.includes(markerEnd(extension))) {
    throw new Error("OVERLAY_PREVIEW_MARKERS_MISSING");
  }
  if (!preview.includes(`[${extension}](+)`)) {
    throw new Error("OVERLAY_PREVIEW_SECTION_MISMATCH");
  }
  const required = [
    "allow_unauthenticated_options=yes",
    "rtp_timeout=0",
    "rtp_timeout_hold=0",
    "asymmetric_rtp_codec=yes",
  ];
  for (const line of required) {
    if (!preview.includes(line)) {
      throw new Error(`OVERLAY_PREVIEW_MISSING_${line.replace(/[^A-Z0-9]+/gi, "_").toUpperCase()}`);
    }
  }
  const disallowed = /^(auth|aors|callerid|accountcode|username|password|secret|contact|set_var)\s*=/im;
  if (disallowed.test(preview)) {
    throw new Error("OVERLAY_PREVIEW_CONTAINS_DISALLOWED_FIELDS");
  }
}

function upsertBlock(current, extension, preview) {
  const start = markerStart(extension);
  const end = markerEnd(extension);
  const startIndex = current.indexOf(start);
  const endIndex = current.indexOf(end);
  const normalizedPreview = preview.endsWith("\n") ? preview : `${preview}\n`;

  if (startIndex >= 0 && endIndex > startIndex) {
    const afterEnd = endIndex + end.length;
    const nextNewline = current.indexOf("\n", afterEnd);
    const replaceEnd = nextNewline >= 0 ? nextNewline + 1 : current.length;
    return {
      action: "replace",
      content: `${current.slice(0, startIndex)}${normalizedPreview}${current.slice(replaceEnd)}`,
    };
  }

  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  return {
    action: "append",
    content: `${current}${separator}${normalizedPreview}`,
  };
}

async function loadBackupManifest(backupDir) {
  if (!backupDir || !backupDir.startsWith(BACKUP_ROOT)) {
    throw new Error("INVALID_BACKUP_DIR");
  }
  const manifestPath = `${backupDir.replace(/\/+$/, "")}/manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const targetEntry = (manifest.files || []).find((item) => item.path === TARGET_FILE);
  if (!targetEntry || !targetEntry.exists || !targetEntry.sha256 || !targetEntry.backupPath) {
    throw new Error("BACKUP_MANIFEST_TARGET_FILE_MISSING");
  }
  return { manifestPath, manifest, targetEntry };
}

async function restoreTargetFromBackup(backupDir) {
  const { targetEntry } = await loadBackupManifest(backupDir);
  const currentStat = await stat(TARGET_FILE);
  await copyFile(targetEntry.backupPath, TARGET_FILE);
  await chown(TARGET_FILE, currentStat.uid, currentStat.gid);
  await chmod(TARGET_FILE, currentStat.mode & 0o7777);
  return targetEntry.backupPath;
}

async function writeAtomicFile(filePath, content, mode) {
  const dir = dirname(filePath);
  const tempDir = await mkdtemp(join(dir, ".saas-overlay-"));
  const tempPath = join(tempDir, `.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tempPath, content, { mode });
  await rename(tempPath, filePath);
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}

function extractField(output, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(String(output || "").matchAll(new RegExp(`^\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, "gim")));
  const match = matches[matches.length - 1];
  return match ? match[1].trim() : "";
}

function normalizeValue(value) {
  return String(value || "")
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .toLowerCase();
}

async function captureEndpoint(extension, outPath) {
  const output = await runReadOnly(ASTERISK_PATHS.asteriskBin, ["-x", `pjsip show endpoint ${extension}`], {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  await writeFile(outPath, output, "utf8");
  return output;
}

async function sudoFwconsoleReload() {
  const parts = ASTERISK_PATHS.reloadCommand.split(/\s+/).filter(Boolean);
  return runReadOnly(parts[0], parts.slice(1), { timeout: 60000, maxBuffer: 1024 * 1024 });
}

async function coreShowChannels() {
  return runReadOnly(ASTERISK_PATHS.asteriskBin, ["-rx", "core show channels"], { timeout: 15000, maxBuffer: 1024 * 1024 });
}

function buildComparisonTable(extension, runtime4, baseline4) {
  const fields = [
    "allow_unauthenticated_options",
    "rtp_timeout",
    "rtp_timeout_hold",
    "asymmetric_rtp_codec",
  ];
  return [
    `| field | ${extension} runtime | ${PRIMARY_REFERENCE_EXTENSION} runtime | status |`,
    "|---|---|---|---|",
    ...fields.map((field) => {
      const a = runtime4[field] || "";
      const b = baseline4[field] || "";
      const status = normalizeValue(a) === normalizeValue(b) ? "match" : "diff";
      return `| ${field} | ${a || "-"} | ${b || "-"} | ${status} |`;
    }),
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const extension = String(args.extension || "9513").trim();
  const backupDir = String(args["backup-dir"] || "").trim();
  const confirm = args.confirm === "yes";
  const ignoreActiveChannels = args["ignore-active-channels"] === "yes";
  assertExtension(extension);

  const previewPath = PREVIEW_FILE(extension);
  const reportPath = REPORT_FILE(extension, !confirm);
  const preview = buildPreview(extension);
  validatePreview(extension, preview);
  await writeFile(previewPath, preview, "utf8");

  const endpointOutput = await captureEndpoint(extension, `/tmp/pjsip-show-endpoint-${extension}-4fields-final.txt`).catch(() => "");
  const baseline9002Output = await captureEndpoint(PRIMARY_REFERENCE_EXTENSION, `/tmp/pjsip-show-endpoint-${PRIMARY_REFERENCE_EXTENSION}-4fields-final.txt`).catch(() => "");
  const baseline9001Output = await captureEndpoint(FALLBACK_REFERENCE_EXTENSION, `/tmp/pjsip-show-endpoint-${FALLBACK_REFERENCE_EXTENSION}-4fields-final.txt`).catch(() => "");
  const current4 = {
    allow_unauthenticated_options: extractField(endpointOutput, "allow_unauthenticated_options"),
    rtp_timeout: extractField(endpointOutput, "rtp_timeout"),
    rtp_timeout_hold: extractField(endpointOutput, "rtp_timeout_hold"),
    asymmetric_rtp_codec: extractField(endpointOutput, "asymmetric_rtp_codec"),
  };
  const baseline4 = {
    allow_unauthenticated_options: extractField(baseline9002Output, "allow_unauthenticated_options"),
    rtp_timeout: extractField(baseline9002Output, "rtp_timeout"),
    rtp_timeout_hold: extractField(baseline9002Output, "rtp_timeout_hold"),
    asymmetric_rtp_codec: extractField(baseline9002Output, "asymmetric_rtp_codec"),
  };

  const endpointExists = new RegExp(`Endpoint:\\s+${extension}\\/${extension}`).test(endpointOutput);
  const baseline9001Exists = new RegExp(`Endpoint:\\s+${FALLBACK_REFERENCE_EXTENSION}\\/${FALLBACK_REFERENCE_EXTENSION}`).test(baseline9001Output);
  const baseline9002Exists = new RegExp(`Endpoint:\\s+${PRIMARY_REFERENCE_EXTENSION}\\/${PRIMARY_REFERENCE_EXTENSION}`).test(baseline9002Output);

  if (!confirm) {
    const report = [
      "# WebRTC 4-Field Endpoint Custom Post Dry Run",
      "",
      `- Time: ${new Date().toISOString()}`,
      `- Extension: ${extension}`,
      `- Preview file: ${previewPath}`,
      `- Target file: ${TARGET_FILE}`,
      `- Backup dir: ${backupDir || "not run"}`,
      `- Endpoint exists: ${endpointExists ? "true" : "false"}`,
      `- ${FALLBACK_REFERENCE_EXTENSION} endpointExists: ${baseline9001Exists ? "true" : "false"}`,
      `- ${PRIMARY_REFERENCE_EXTENSION} endpointExists: ${baseline9002Exists ? "true" : "false"}`,
      `- DRY RUN: no files will be modified`,
      `- Reload will be executed: false`,
      "",
      "## Preview",
      "",
      "```ini",
      preview.trimEnd(),
      "```",
      "",
      "## 4-Field Runtime Snapshot",
      "",
      buildComparisonTable(extension, current4, baseline4),
      "",
    ].join("\n");
    await writeFile(reportPath, report, "utf8");
    console.log(`DRY RUN: no files will be modified`);
    console.log(`Target: ${TARGET_FILE}`);
    console.log(`Extension: ${extension}`);
    console.log(`Action: preview-only`);
    console.log(`Endpoint exists: ${endpointExists}`);
    console.log(`Current sha256 matches backup: ${backupDir ? "not checked in dry-run" : "false"}`);
    console.log("Reload will be executed: false");
    console.log(`Report: ${reportPath}`);
    return;
  }

  const channelsOutput = await coreShowChannels();
  const activeChannelsDetected = /active call|active channels/i.test(channelsOutput || "");
  const backup = await backupPjsipConfigs();
  if (!backup.backupDir) throw new Error("BACKUP_FAILED");
  const { manifestPath, targetEntry } = await loadBackupManifest(backup.backupDir);
  const currentSha256 = await sha256File(TARGET_FILE);
  const shaMatchesBackup = currentSha256 === targetEntry.sha256;
  const currentText = await readFile(TARGET_FILE, "utf8");
  const { action, content } = upsertBlock(currentText, extension, preview);
  const currentStat = await stat(TARGET_FILE);

  if (!endpointExists) {
    const report = [
      "# WebRTC 4-Field Endpoint Custom Post Final Report",
      "",
      `- Time: ${new Date().toISOString()}`,
      `- Extension: ${extension}`,
      `- Backup dir: ${backup.backupDir}`,
      `- Manifest: ${manifestPath}`,
      `- Target file: ${TARGET_FILE}`,
      `- Current sha256 matches backup: ${shaMatchesBackup}`,
      `- Endpoint exists: false`,
      `- Asterisk restart executed: false`,
      `- Reload executed: false`,
      `- failedFields: endpoint_not_found`,
      `- warningFields: none`,
    ].join("\n");
    await writeFile(reportPath, report, "utf8");
    throw new Error("ENDPOINT_NOT_FOUND");
  }

  if (!shaMatchesBackup) {
    const report = [
      "# WebRTC 4-Field Endpoint Custom Post Final Report",
      "",
      `- Time: ${new Date().toISOString()}`,
      `- Extension: ${extension}`,
      `- Backup dir: ${backup.backupDir}`,
      `- Manifest: ${manifestPath}`,
      `- Target file: ${TARGET_FILE}`,
      `- Current sha256 matches backup: false`,
      `- Endpoint exists: true`,
      `- Asterisk restart executed: false`,
      `- Reload executed: false`,
      `- failedFields: current_sha256_mismatch`,
      `- warningFields: none`,
    ].join("\n");
    await writeFile(reportPath, report, "utf8");
    throw new Error("ASTERISK_CONFIG_CHANGED_SINCE_BACKUP");
  }

  if (!ignoreActiveChannels && activeChannelsDetected) {
    throw new Error("Active channels detected. Re-run with --ignore-active-channels yes to continue anyway.");
  }

  await writeAtomicFile(TARGET_FILE, content, currentStat.mode & 0o7777);
  await chown(TARGET_FILE, currentStat.uid, currentStat.gid);
  await chmod(TARGET_FILE, currentStat.mode & 0o7777);
  const oldSha256 = currentSha256;
  const newSha256 = await sha256File(TARGET_FILE);
  const reloadOutput = await sudoFwconsoleReload();

  const runtime9513Output = await captureEndpoint(extension, `/tmp/pjsip-show-endpoint-${extension}-4fields-final.txt`);
  const runtime9002Output = await captureEndpoint(PRIMARY_REFERENCE_EXTENSION, `/tmp/pjsip-show-endpoint-${PRIMARY_REFERENCE_EXTENSION}-4fields-final.txt`);
  const runtime9001Output = await captureEndpoint(FALLBACK_REFERENCE_EXTENSION, `/tmp/pjsip-show-endpoint-${FALLBACK_REFERENCE_EXTENSION}-4fields-final.txt`);
  const runtime4 = {
    allow_unauthenticated_options: extractField(runtime9513Output, "allow_unauthenticated_options"),
    rtp_timeout: extractField(runtime9513Output, "rtp_timeout"),
    rtp_timeout_hold: extractField(runtime9513Output, "rtp_timeout_hold"),
    asymmetric_rtp_codec: extractField(runtime9513Output, "asymmetric_rtp_codec"),
  };
  const baseline4After = {
    allow_unauthenticated_options: extractField(runtime9002Output, "allow_unauthenticated_options"),
    rtp_timeout: extractField(runtime9002Output, "rtp_timeout"),
    rtp_timeout_hold: extractField(runtime9002Output, "rtp_timeout_hold"),
    asymmetric_rtp_codec: extractField(runtime9002Output, "asymmetric_rtp_codec"),
  };

  const failedFields = [];
  for (const field of Object.keys(runtime4)) {
    if (normalizeValue(runtime4[field]) !== normalizeValue(baseline4After[field])) {
      failedFields.push(field);
    }
  }
  const warningFields = [];
  const baseline9001ExistsAfter = new RegExp(`Endpoint:\\s+${FALLBACK_REFERENCE_EXTENSION}\\/${FALLBACK_REFERENCE_EXTENSION}`).test(runtime9001Output);
  const baseline9002ExistsAfter = new RegExp(`Endpoint:\\s+${PRIMARY_REFERENCE_EXTENSION}\\/${PRIMARY_REFERENCE_EXTENSION}`).test(runtime9002Output);

  let rollbackInfo = "";
  if (failedFields.length) {
    const restorePath = await restoreTargetFromBackup(backup.backupDir);
    await sudoFwconsoleReload();
    rollbackInfo = `- Restored target file from backup: ${restorePath}`;
  }

  const finalReport = [
    "# WebRTC 4-Field Endpoint Custom Post Final Report",
    "",
    `- Time: ${new Date().toISOString()}`,
    `- Extension: ${extension}`,
    `- Backup dir: ${backup.backupDir}`,
    `- Manifest: ${manifestPath}`,
    `- Preview file: ${previewPath}`,
    `- Target file: ${TARGET_FILE}`,
    `- Action: ${action}`,
    `- Old sha256: ${oldSha256}`,
    `- New sha256: ${newSha256}`,
    `- Current sha256 matches backup: ${shaMatchesBackup}`,
    `- Reload command: sudo fwconsole reload`,
    `- Reload output captured: ${Boolean(reloadOutput).toString()}`,
    `- Asterisk restart executed: false`,
    `- core show channels checked: true`,
    `- active channels ignored for this test: ${String(ignoreActiveChannels)}`,
    `- ${FALLBACK_REFERENCE_EXTENSION} endpointExists: ${baseline9001ExistsAfter ? "true" : "false"}`,
    `- ${PRIMARY_REFERENCE_EXTENSION} endpointExists: ${baseline9002ExistsAfter ? "true" : "false"}`,
    "",
    "## Runtime Comparison",
    "",
    buildComparisonTable(extension, runtime4, baseline4After),
    "",
    "## failedFields",
    "",
    failedFields.length ? failedFields.join(", ") : "none",
    "",
    "## warningFields",
    "",
    warningFields.length ? warningFields.join(", ") : "none",
    "",
    "## Rollback",
    "",
    rollbackInfo || "- no rollback required",
    "",
    "## Constraints",
    "",
    `- modified /etc/asterisk/pjsip_custom_post.conf: false`,
    `- modified /etc/asterisk/pjsip.endpoint.conf: false`,
    `- modified /etc/asterisk/pjsip.auth.conf: false`,
    `- modified /etc/asterisk/pjsip.aor.conf: false`,
    `- wrote FreePBX database: false`,
    `- wrote SaaS database: false`,
  ].join("\n");
  await writeFile(reportPath, finalReport, "utf8");

  console.log(`Extension: ${extension}`);
  console.log(`Backup dir: ${backup.backupDir}`);
  console.log(`dry-run: false`);
  console.log(`overlay written: true`);
  console.log(`Target file: ${TARGET_FILE}`);
  console.log(`sudo fwconsole reload executed: true`);
  console.log(`Asterisk restart executed: false`);
  console.log(`4 fields all passed: ${failedFields.length === 0}`);
  console.log(`failedFields: ${failedFields.length ? failedFields.join(", ") : "none"}`);
  console.log(`${FALLBACK_REFERENCE_EXTENSION} / ${PRIMARY_REFERENCE_EXTENSION} normal: ${baseline9001ExistsAfter && baseline9002ExistsAfter}`);
  console.log(`rollback: ${failedFields.length ? "yes" : "no"}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error?.code || error?.message || String(error));
  process.exitCode = 1;
});
