import "dotenv/config";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat, copyFile, chmod, chown, rename, mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { verifyPjsipExtension } from "../server/asteriskCommandService.js";
import { getWebrtcRuntimeConfig } from "../server/webrtcTemplateLoader.js";

const execFileAsync = promisify(execFile);
const EXTENSION_PATTERN = /^\d+$/;
const TARGET_FILE = "/etc/asterisk/pjsip_custom_post.conf";
const BACKUP_ROOT = "/var/backups/saas-asterisk-pjsip";
const REPORT_PREFIX = "/tmp/webrtc-runtime-overlay";
const PREVIEW_PREFIX = "/tmp/webrtc-runtime-overlay-preview";
const FINAL_REPORT_PREFIX = "/tmp/webrtc-runtime-overlay-final";
const WEBRTC_RUNTIME = getWebrtcRuntimeConfig();
const REFERENCE_EXTENSIONS = [
  WEBRTC_RUNTIME.fallbackReferenceExtension,
  WEBRTC_RUNTIME.referenceExtension,
  "9020",
];
const PREFERRED_REFERENCE_ORDER = [
  WEBRTC_RUNTIME.referenceExtension,
  WEBRTC_RUNTIME.fallbackReferenceExtension,
  "9020",
];
const SENSITIVE_FIELD_PATTERN = /password|secret|token|csrf|session|cookie/i;
const EXCLUDED_FIELDS = /^(auth|aors|callerid|accountcode|set_var|contact_user|from_user|outbound_proxy)\s*=/im;

const OVERLAY_FIELDS = [
  "allow_unauthenticated_options",
  "webrtc",
  "use_avpf",
  "ice_support",
  "rtcp_mux",
  "bundle",
  "dtls_auto_generate_cert",
  "dtls_setup",
  "media_encryption",
  "media_encryption_optimistic",
  "media_use_received_transport",
  "rtp_timeout",
  "rtp_timeout_hold",
  "disallow",
  "allow",
  "asymmetric_rtp_codec",
];

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

function assertValidExtension(extension) {
  if (!EXTENSION_PATTERN.test(String(extension || ""))) {
    const error = new Error("INVALID_WEBRTC_EXTENSION");
    error.code = "INVALID_WEBRTC_EXTENSION";
    throw error;
  }
}

function formatMode(mode) {
  return (mode & 0o7777).toString(8).padStart(4, "0");
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

function redactValue(value) {
  return SENSITIVE_FIELD_PATTERN.test(String(value || "")) ? "[REDACTED]" : value;
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

async function writeAtomicFile(filePath, content, mode) {
  const dir = dirname(filePath);
  const tempDir = await mkdtemp(join(dir, ".saas-overlay-"));
  const tempPath = join(tempDir, `.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tempPath, content, { mode });
  await rename(tempPath, filePath);
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}

async function captureAsteriskShow(kind, objectName, outPath) {
  const output = await runReadOnly("asterisk", ["-x", `pjsip show ${kind} ${objectName}`], {
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });
  await writeFile(outPath, output, "utf8");
  return output;
}

async function sudoFwconsoleReload() {
  return runReadOnly("sudo", ["fwconsole", "reload"], { timeout: 60000, maxBuffer: 1024 * 1024 });
}

async function coreShowChannels() {
  return runReadOnly("asterisk", ["-rx", "core show channels"], { timeout: 15000, maxBuffer: 1024 * 1024 });
}

function markerStart(extension) {
  return `; BEGIN SaaS WebRTC runtime overlay ${extension}`;
}

function markerEnd(extension) {
  return `; END SaaS WebRTC runtime overlay ${extension}`;
}

function parseOverlayBlock(text, extension) {
  const lines = String(text || "").split(/\n/);
  const start = lines.findIndex((line) => line.trim() === `[${extension}](+)`);
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^\[[^\]]+\]\(\+\)\s*$/.test(trimmed) || /^\[[^\]]+\]\s*$/.test(trimmed)) {
      end = index;
      break;
    }
  }
  const blockLines = lines.slice(start, end);
  return {
    extension,
    lines: blockLines,
    text: blockLines.join("\n").trimEnd(),
  };
}

function buildOverlayFromTemplate(extension, templateBlock) {
  const lines = [...templateBlock.lines];
  lines[0] = `[${extension}](+)`;
  const body = lines.join("\n").trimEnd();
  const text = [`${markerStart(extension)}`, body, `${markerEnd(extension)}`, ""].join("\n");
  return { body, text };
}

function upsertBlock(current, extension, block) {
  const start = markerStart(extension);
  const end = markerEnd(extension);
  const startIndex = current.indexOf(start);
  const endIndex = current.indexOf(end);
  const normalizedBlock = block.endsWith("\n") ? block : `${block}\n`;

  if (startIndex >= 0 && endIndex > startIndex) {
    const afterEnd = endIndex + end.length;
    const nextNewline = current.indexOf("\n", afterEnd);
    const replaceEnd = nextNewline >= 0 ? nextNewline + 1 : current.length;
    return {
      action: "replace",
      content: `${current.slice(0, startIndex)}${normalizedBlock}${current.slice(replaceEnd)}`,
    };
  }

  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  return {
    action: "append",
    content: `${current}${separator}${normalizedBlock}`,
  };
}

function validateOverlayPreview(extension, preview) {
  const start = markerStart(extension);
  const end = markerEnd(extension);
  if (!preview.includes(start) || !preview.includes(end)) {
    throw new Error("OVERLAY_PREVIEW_MARKERS_MISSING");
  }
  if (!preview.includes(`[${extension}](+)`)) {
    throw new Error("OVERLAY_PREVIEW_SECTION_MISMATCH");
  }
  if (EXCLUDED_FIELDS.test(preview)) {
    throw new Error("OVERLAY_PREVIEW_CONTAINS_EXCLUDED_FIELD");
  }
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

function compareTemplateBodies(referenceBlocks) {
  const entries = Object.entries(referenceBlocks).filter(([, block]) => Boolean(block));
  if (!entries.length) return { identical: false, source: null, diffs: ["No reference blocks found."] };
  const source = PREFERRED_REFERENCE_ORDER.find((ref) => referenceBlocks[ref]) || entries.find(([, block]) => block)?.[0] || null;
  const normalize = (block) => (block?.lines || [])
    .slice(1)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith(";");
    })
    .map((line) => line.trim())
    .join("\n")
    .trimEnd();
  const sourceBody = normalize(referenceBlocks[source]);
  const diffs = [];
  for (const [extension, block] of entries) {
    const body = normalize(block);
    if (body !== sourceBody) {
      diffs.push(`Overlay body for ${extension} differs from the chosen source template.`);
    }
  }
  return { identical: diffs.length === 0, source, diffs };
}

function buildReport({
  mode,
  extension,
  requestedExtension,
  referenceBlocks,
  selectedTemplateExtension,
  previewPath,
  reportPath,
  preview,
  backup,
  backupRequired,
  overlayInfo,
  currentSha256,
  shaMatchesBackup,
  endpointExists,
  formReloadExecuted,
  runtime,
  baseline9001,
  baseline9002,
  comparison9002,
  comparison9001,
  failedFields,
  warningFields,
  ignoreActiveChannels,
  channelsChecked,
  channelsOutput,
}) {
  const templateComparison = compareTemplateBodies(referenceBlocks);
  const templateSource = selectedTemplateExtension || templateComparison.source || WEBRTC_RUNTIME.referenceExtension;
  const refRows = Object.entries(referenceBlocks)
    .filter(([, block]) => Boolean(block))
    .map(([ref, block]) => ({
      ref,
      lines: block.lines.length,
      preview: block.text,
    }));
  const runtimeChecks = runtime?.webrtcChecks || {};
  const runtimeCheckRows = Object.entries(runtimeChecks).map(([key, value]) => ({
    key,
    value: value ? "yes" : "no",
  }));

  const report = [
    "# FreePBX Runtime Overlay Supplement Report",
    "",
    `- Time: ${new Date().toISOString()}`,
    `- Mode: ${mode}`,
    `- Requested extension: ${requestedExtension}`,
    `- Actual extension: ${extension}`,
    `- Template source extension: ${templateSource}`,
    `- Preview file: ${previewPath}`,
    `- Report file: ${reportPath}`,
    `- Backup required: ${backupRequired ? "true" : "false"}`,
    `- Backup dir: ${backup?.backupDir || "not run"}`,
    `- Manifest: ${backup?.manifest || "not run"}`,
    `- Current sha256 matches backup: ${typeof shaMatchesBackup === "boolean" ? String(shaMatchesBackup) : "not run"}`,
    `- Asterisk restart executed: false`,
    `- Reload executed: ${formReloadExecuted ? "true" : "false"}`,
    `- core show channels checked: ${channelsChecked ? "true" : "false"}`,
    `- active channels ignored: ${ignoreActiveChannels ? "true" : "false"}`,
    "",
    "## 1. Standard Overlay References",
    "",
    refRows.length
      ? refRows.map((row) => `- ${row.ref}: ${row.lines} lines`).join("\n")
      : "- No reference overlay blocks found.",
    "",
    "## 2. Template Comparison",
    "",
    templateComparison.diffs.length
      ? templateComparison.diffs.map((line) => `- ${line}`).join("\n")
      : "- 9001/9002/9020 overlay bodies are identical for the selected template fields.",
    "",
    "## 3. Overlay Preview",
    "",
    "```ini",
    preview.trimEnd(),
    "```",
    "",
    "## 4. Endpoint / Runtime Status",
    "",
    `- endpointExists: ${endpointExists ? "true" : "false"}`,
    `- authExists: ${runtime?.authExists ? "true" : "false"}`,
    `- aorExists: ${runtime?.aorExists ? "true" : "false"}`,
    `- runtimeVerified: ${runtime?.webrtcVerified ? "true" : "false"}`,
    "",
    "### Runtime checks",
    "",
    runtimeCheckRows.length ? runtimeCheckRows.map((row) => `- ${row.key}: ${row.value}`).join("\n") : "- none",
    "",
    "### Failed / Warning Fields",
    "",
    `- failedFields: ${failedFields.length ? failedFields.join(", ") : "none"}`,
    `- warningFields: ${warningFields.length ? warningFields.join(", ") : "none"}`,
    "",
    "## 5. Baseline Endpoints",
    "",
    `- 9001 endpointExists: ${baseline9001?.endpointExists ? "true" : "false"}`,
    `- 9001 authExists: ${baseline9001?.authExists ? "true" : "false"}`,
    `- 9001 aorExists: ${baseline9001?.aorExists ? "true" : "false"}`,
    `- 9002 endpointExists: ${baseline9002?.endpointExists ? "true" : "false"}`,
    `- 9002 authExists: ${baseline9002?.authExists ? "true" : "false"}`,
    `- 9002 aorExists: ${baseline9002?.aorExists ? "true" : "false"}`,
    "",
    "## 6. 9513 vs 9002 Runtime Comparison",
    "",
    comparison9002 || "- comparison not available",
    "",
    "## 7. 9513 vs 9001 Runtime Comparison",
    "",
    comparison9001 || "- comparison not available",
    "",
    "## 8. Files Modified",
    "",
    backupRequired
      ? `- ${TARGET_FILE}`
      : "- none (dry-run)",
    "",
    "## 9. Notes",
    "",
    "- This flow updates FreePBX-managed runtime overlay only; it does not directly edit generated endpoint/auth/aor files.",
    "- This flow does not restart Asterisk.",
    "- If a restore is needed, use the backup manifest to restore ${TARGET_FILE} and run sudo fwconsole reload.",
    "",
  ].join("\n");
  return report;
}

async function main() {
  const args = parseArgs(process.argv);
  const requestedExtension = String(args.extension || "").trim();
  const confirm = args.confirm === "yes";
  const ignoreActiveChannels = args["ignore-active-channels"] === "yes" || args["ignore-active-calls"] === "yes";
  const providedBackupDir = String(args["backup-dir"] || "").trim();
  assertValidExtension(requestedExtension);

  const extension = requestedExtension;
  const previewPath = `${PREVIEW_PREFIX}-${extension}.conf`;
  const reportPath = confirm
    ? `${FINAL_REPORT_PREFIX}-${extension}-report.md`
    : `${REPORT_PREFIX}-${extension}-dry-run-report.md`;
  const referenceText = await readFile(TARGET_FILE, "utf8");
  const referenceBlocks = Object.fromEntries(
    REFERENCE_EXTENSIONS.map((ref) => [ref, parseOverlayBlock(referenceText, ref)]),
  );

  const selectedTemplateExtension = PREFERRED_REFERENCE_ORDER.find((ref) => Boolean(referenceBlocks[ref])) || REFERENCE_EXTENSIONS.find((ref) => Boolean(referenceBlocks[ref])) || null;
  if (!selectedTemplateExtension) {
    throw new Error("REFERENCE_RUNTIME_OVERLAY_TEMPLATE_NOT_FOUND");
  }

  const overlayPreview = buildOverlayFromTemplate(extension, referenceBlocks[selectedTemplateExtension]);
  validateOverlayPreview(extension, overlayPreview.text);
  await writeFile(previewPath, overlayPreview.text, "utf8");

  const endpointStatus = await verifyPjsipExtension(extension);
  const baseline9001 = await verifyPjsipExtension("9001");
  const baseline9002 = await verifyPjsipExtension("9002");

  if (!confirm) {
    const report = buildReport({
      mode: "dry-run",
      extension,
      requestedExtension,
      referenceBlocks,
      selectedTemplateExtension,
      previewPath,
      reportPath,
      preview: overlayPreview.text,
      backup: null,
      backupRequired: false,
      overlayInfo: { action: "not-run" },
      currentSha256: null,
      shaMatchesBackup: null,
      endpointExists: endpointStatus.endpointExists,
      formReloadExecuted: false,
      runtime: endpointStatus,
      baseline9001,
      baseline9002,
      comparison9002: "- comparison not available in dry-run",
      comparison9001: "- comparison not available in dry-run",
      failedFields: [],
      warningFields: [
        "This is a dry-run; overlay not written.",
        ...(endpointStatus?.unsupportedOrUnverified?.map((item) => item.field) || []),
      ],
      ignoreActiveChannels,
      channelsChecked: false,
      channelsOutput: "",
    });
    await writeFile(reportPath, report, "utf8");
    console.log(JSON.stringify({
      success: true,
      dryRun: true,
      extension,
      templateSource: selectedTemplateExtension,
      previewPath,
      reportPath,
      overlayPreview: overlayPreview.text,
      actions: [
        "loadReferenceRuntimeOverlayTemplate",
        "buildRuntimeOverlayPreview",
        "verifyBaselineEndpoints(9001,9002)",
        "dryRunOnly(no write/no reload)",
      ],
    }, null, 2));
    return;
  }

  const channelsOutput = await coreShowChannels();
  const channelsChecked = true;
  const activeChannelsDetected = /active call|active channels/i.test(channelsOutput || "");
  if (activeChannelsDetected && !ignoreActiveChannels) {
    throw new Error("Active channels detected. Re-run with --ignore-active-channels yes to continue anyway.");
  }

  const backup = providedBackupDir
    ? { backupDir: providedBackupDir, manifest: `${providedBackupDir.replace(/\/+$/, "")}/manifest.json`, copied: null, missing: null, warnings: null }
    : await backupPjsipConfigs();
  if (!backup.backupDir) {
    throw new Error("BACKUP_FAILED");
  }
  const { manifestPath, targetEntry } = await loadBackupManifest(backup.backupDir);
  const currentSha256 = await sha256File(TARGET_FILE);
  const shaMatchesBackup = currentSha256 === targetEntry.sha256;
  const currentText = await readFile(TARGET_FILE, "utf8");
  const existingOverlayBlock = currentText.includes(markerStart(extension)) && currentText.includes(markerEnd(extension));
  const { action, content } = upsertBlock(currentText, extension, overlayPreview.text);
  const currentStat = await stat(TARGET_FILE);

  const reportBase = {
    mode: "real execution",
    extension,
    requestedExtension,
    referenceBlocks,
    selectedTemplateExtension,
    previewPath,
    reportPath,
    preview: overlayPreview.text,
    backup,
    backupRequired: true,
    overlayInfo: { action, existingOverlayBlock },
    currentSha256,
    shaMatchesBackup,
    endpointExists: endpointStatus.endpointExists,
    formReloadExecuted: false,
    runtime: endpointStatus,
    baseline9001,
    baseline9002,
    failedFields: [],
    warningFields: [],
    ignoreActiveChannels,
    channelsChecked,
    channelsOutput,
  };

  if (!endpointStatus.endpointExists || !shaMatchesBackup) {
    const report = buildReport({
      ...reportBase,
      backupRequired: true,
      warningFields: [
        ...(!endpointStatus.endpointExists ? ["Endpoint not found before overlay apply."] : []),
        ...(!shaMatchesBackup ? ["Current pjsip_custom_post.conf sha256 does not match backup manifest."] : []),
      ],
    });
    await writeFile(reportPath, report, "utf8");
    console.log(JSON.stringify({
      success: false,
      error: {
        code: !endpointStatus.endpointExists ? "ENDPOINT_NOT_FOUND" : "CURRENT_SHA256_DOES_NOT_MATCH_BACKUP",
        message: !endpointStatus.endpointExists
          ? `Endpoint ${extension} does not exist.`
          : "Current pjsip_custom_post.conf does not match the backup manifest.",
      },
      backupDir: backup.backupDir,
      manifestPath,
      previewPath,
      reportPath,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  let overlayWritten = false;
  let reloadExecuted = false;
  let runtime = endpointStatus;
  let failedFields = [];
  let warningFields = [];
  let comparison9002 = "- comparison not available";
  let comparison9001 = "- comparison not available";

  try {
    await writeAtomicFile(TARGET_FILE, content, currentStat.mode & 0o7777);
    await chown(TARGET_FILE, currentStat.uid, currentStat.gid);
    await chmod(TARGET_FILE, currentStat.mode & 0o7777);
    overlayWritten = true;

    const reloadOutput = await sudoFwconsoleReload();
    reloadExecuted = true;

    runtime = await verifyPjsipExtension(extension, {
      transport: WEBRTC_RUNTIME.transport,
      mediaAddress: WEBRTC_RUNTIME.mediaAddress,
      allowedCodecs: WEBRTC_RUNTIME.allowedCodecsString,
      rtpTimeout: "0",
      rtpTimeoutHold: "0",
    });
    failedFields = runtime.failedChecks || [];
    warningFields = (runtime.unsupportedOrUnverified || []).map((item) => item.field);

    const baselineAfter9001 = await verifyPjsipExtension("9001");
    const baselineAfter9002 = await verifyPjsipExtension("9002");
    const endpoint9513 = await captureAsteriskShow("endpoint", extension, `/tmp/pjsip-show-endpoint-${extension}-final.txt`);
    const endpoint9002 = await captureAsteriskShow("endpoint", "9002", `/tmp/pjsip-show-endpoint-9002-final.txt`);
    const endpoint9001 = await captureAsteriskShow("endpoint", "9001", `/tmp/pjsip-show-endpoint-9001-final.txt`);

    const comparisonFields = [
      "transport",
      "webrtc",
      "use_avpf",
      "ice_support",
      "rtcp_mux",
      "bundle",
      "media_encryption",
      "media_encryption_optimistic",
      "media_use_received_transport",
      "direct_media",
      "timers",
      "media_address",
      "rtp_timeout",
      "rtp_timeout_hold",
      "allow",
      "aggregate_mwi",
      "asymmetric_rtp_codec",
      "allow_unauthenticated_options",
      "dtls_auto_generate_cert",
      "dtls_setup",
      "dtls_verify",
      "mwi_subscribe_replaces_unsolicited",
      "mailboxes",
      "send_pai",
    ];

    function extractField(output, field) {
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = Array.from(String(output || "").matchAll(new RegExp(`^\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, "gim")));
      const match = matches[matches.length - 1];
      return match ? match[1].trim() : "";
    }

    function normalizeCompare(value) {
      return String(value || "")
        .trim()
        .replace(/^\((.*)\)$/, "$1")
        .toLowerCase();
    }

    comparison9002 = [
      "| field | 9513 | 9002 | status |",
      "|---|---|---|---|",
      ...comparisonFields.map((field) => {
        const a = extractField(endpoint9513, field);
        const b = extractField(endpoint9002, field);
        const status = normalizeCompare(a) === normalizeCompare(b) ? "match" : "diff";
        return `| ${field} | ${a || "-"} | ${b || "-"} | ${status} |`;
      }),
    ].join("\n");

    comparison9001 = [
      "| field | 9513 | 9001 | status |",
      "|---|---|---|---|",
      ...comparisonFields.map((field) => {
        const a = extractField(endpoint9513, field);
        const b = extractField(endpoint9001, field);
        const status = normalizeCompare(a) === normalizeCompare(b) ? "match" : "diff";
        return `| ${field} | ${a || "-"} | ${b || "-"} | ${status} |`;
      }),
    ].join("\n");

    const report = buildReport({
      ...reportBase,
      backup,
      backupRequired: true,
      overlayInfo: { action, existingOverlayBlock },
      currentSha256,
      shaMatchesBackup,
      endpointExists: runtime.endpointExists,
      formReloadExecuted: true,
      runtime,
      baseline9001: baselineAfter9001,
      baseline9002: baselineAfter9002,
      comparison9002,
      comparison9001,
      failedFields,
      warningFields,
      channelsChecked,
      channelsOutput,
    });
    await writeFile(reportPath, report, "utf8");

    console.log(JSON.stringify({
      success: true,
      dryRun: false,
      extension,
      backupDir: backup.backupDir,
      manifestPath,
      overlayWritten,
      reloadExecuted,
      asteriskRestartExecuted: false,
      runtimeVerified: Boolean(runtime.webrtcVerified),
      failedFields,
      warningFields,
      reportPath,
      overlayAction: action,
    }, null, 2));
  } catch (error) {
    let restorePath = "";
    try {
      if (overlayWritten) {
        restorePath = await restoreTargetFromBackup(backup.backupDir);
        await sudoFwconsoleReload();
      }
    } catch (restoreError) {
      warningFields.push(`Restore failed: ${restoreError?.message || String(restoreError)}`);
    }

    const failureReport = buildReport({
      ...reportBase,
      backup,
      backupRequired: true,
      overlayInfo: { action, existingOverlayBlock },
      currentSha256,
      shaMatchesBackup,
      endpointExists: endpointStatus.endpointExists,
      formReloadExecuted: reloadExecuted,
      runtime,
      baseline9001,
      baseline9002,
      comparison9002,
      comparison9001,
      failedFields: failedFields.length ? failedFields : [error?.code || "OVERLAY_RUNTIME_FAILURE"],
      warningFields: [
        ...warningFields,
        ...(restorePath ? [`Restored target file from backup: ${restorePath}`] : []),
        error?.message || String(error),
      ],
      channelsChecked,
      channelsOutput,
    });
    await writeFile(reportPath, failureReport, "utf8");
    console.log(JSON.stringify({
      success: false,
      error: {
        code: error?.code || "WEbrtc_RUNTIME_OVERLAY_FAILED",
        message: error?.message || "Runtime overlay apply failed.",
      },
      backupDir: backup.backupDir,
      manifestPath,
      overlayWritten,
      reloadExecuted,
      asteriskRestartExecuted: false,
      failedFields: failedFields.length ? failedFields : [error?.code || "OVERLAY_RUNTIME_FAILURE"],
      warningFields,
      reportPath,
    }, null, 2));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.code || error?.message || String(error));
  process.exitCode = 1;
});
