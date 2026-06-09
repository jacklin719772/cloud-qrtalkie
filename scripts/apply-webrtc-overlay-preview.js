import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile, chmod, chown } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAsteriskPathConfig } from "../server/webrtcTemplateLoader.js";

const execFileAsync = promisify(execFile);
const EXTENSION_PATTERN = /^\d+$/;
const ASTERISK_PATHS = getAsteriskPathConfig();
const TARGET_FILE = ASTERISK_PATHS.customPostConf;
const BACKUP_ROOT = ASTERISK_PATHS.backupRoot;
const EXCLUDED_FIELDS = /^(auth|aors|callerid|accountcode|set_var|contact_user|from_user|outbound_proxy)\s*=/im;

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

async function showEndpointExists(extension) {
  const { stdout, stderr } = await execFileAsync(ASTERISK_PATHS.asteriskBin, ["-rx", `pjsip show endpoint ${extension}`], {
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  const output = `${stdout || ""}${stderr ? `\n${stderr}` : ""}`;
  const lower = output.toLowerCase();
  return output.includes(`Endpoint:  ${extension}/`) && !lower.includes("unable to find") && !lower.includes("not found");
}

function markerStart(extension) {
  return `; BEGIN SaaS WebRTC endpoint overlay ${extension}`;
}

function markerEnd(extension) {
  return `; END SaaS WebRTC endpoint overlay ${extension}`;
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

async function loadManifest(backupDir) {
  if (!backupDir || !backupDir.startsWith(BACKUP_ROOT)) {
    throw new Error("INVALID_BACKUP_DIR");
  }
  const manifestPath = `${backupDir.replace(/\/+$/, "")}/manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const targetEntry = (manifest.files || []).find((file) => file.path === TARGET_FILE);
  if (!targetEntry || !targetEntry.exists || !targetEntry.sha256) {
    throw new Error("BACKUP_MANIFEST_TARGET_FILE_MISSING");
  }
  return { manifestPath, manifest, targetEntry };
}

function validatePreview(extension, preview) {
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

async function main() {
  const args = parseArgs(process.argv);
  const extension = String(args.extension || "").trim();
  const backupDir = String(args["backup-dir"] || "").trim();
  const confirm = args.confirm === "yes";
  assertExtension(extension);

  const previewPath = `/tmp/webrtc-overlay-preview-${extension}.conf`;
  const reportPath = `/tmp/webrtc-overlay-apply-${extension}-report.md`;
  const preview = await readFile(previewPath, "utf8");
  validatePreview(extension, preview);

  const endpointExists = await showEndpointExists(extension);
  const { manifestPath, targetEntry } = await loadManifest(backupDir);
  const currentSha256 = await sha256File(TARGET_FILE);
  const shaMatchesBackup = currentSha256 === targetEntry.sha256;
  const current = await readFile(TARGET_FILE, "utf8");
  const existingOverlayBlock = current.includes(markerStart(extension)) && current.includes(markerEnd(extension));
  const { action, content } = upsertBlock(current, extension, preview);
  const newSha256 = createHash("sha256").update(content).digest("hex");
  const currentStat = await stat(TARGET_FILE);

  if (!endpointExists || !shaMatchesBackup) {
    const reason = !endpointExists ? "ENDPOINT_NOT_FOUND" : "CURRENT_SHA256_DOES_NOT_MATCH_BACKUP";
    console.log(`Endpoint exists: ${endpointExists}`);
    console.log(`Existing overlay block: ${existingOverlayBlock ? "found" : "not found"}`);
    console.log(`Action: ${action}`);
    console.log(`Current sha256 matches backup: ${shaMatchesBackup}`);
    console.log("Reload will be executed: false");
    console.log(`STOP: ${reason}`);
    process.exitCode = 1;
    return;
  }

  if (!confirm) {
    console.log("DRY RUN: no files will be modified");
    console.log(`Endpoint exists: ${endpointExists}`);
    console.log(`Existing overlay block: ${existingOverlayBlock ? "found" : "not found"}`);
    console.log(`Action: ${action}`);
    console.log(`Current sha256 matches backup: ${shaMatchesBackup}`);
    console.log("Reload will be executed: false");
    console.log(`Target file: ${TARGET_FILE}`);
    console.log(`Preview: ${previewPath}`);
    console.log(`Backup manifest: ${manifestPath}`);
    return;
  }

  await writeFile(TARGET_FILE, content, { mode: currentStat.mode & 0o7777 });
  await chown(TARGET_FILE, currentStat.uid, currentStat.gid);
  await chmod(TARGET_FILE, currentStat.mode & 0o7777);

  const report = `# WebRTC Overlay Apply Report

Generated at: ${new Date().toISOString()}

Extension: ${extension}

Target file: ${TARGET_FILE}

Backup dir: ${backupDir}

Backup manifest: ${manifestPath}

Endpoint exists: ${endpointExists}

Existing overlay block: ${existingOverlayBlock ? "found" : "not found"}

Action: ${action}

Current sha256 matches backup: ${shaMatchesBackup}

Old sha256: ${currentSha256}

New sha256: ${newSha256}

Reload executed: false

Asterisk restart executed: false

Files modified:

- ${TARGET_FILE}

Files not modified:

- /etc/asterisk/pjsip.endpoint_custom_post.conf
- /etc/asterisk/pjsip_custom.conf
- /etc/asterisk/pjsip.endpoint_custom.conf
- /etc/asterisk/pjsip.transports_custom_post.conf
- /etc/asterisk/pjsip.transports_custom.conf
- /etc/asterisk/pjsip.conf
- /etc/asterisk/pjsip.endpoint.conf
- /etc/asterisk/pjsip.auth.conf
- /etc/asterisk/pjsip.aor.conf
- /etc/asterisk/pjsip.transports.conf
`;
  await writeFile(reportPath, report, { mode: 0o600 });

  console.log("Overlay applied:");
  console.log(`Endpoint exists: ${endpointExists}`);
  console.log(`Existing overlay block: ${existingOverlayBlock ? "found" : "not found"}`);
  console.log(`Action: ${action}`);
  console.log(`Current sha256 matches backup: ${shaMatchesBackup}`);
  console.log(`Old sha256: ${currentSha256}`);
  console.log(`New sha256: ${newSha256}`);
  console.log("Reload will be executed: false");
  console.log(`Report: ${reportPath}`);
  console.log(`Modified file: ${TARGET_FILE}`);
}

main().catch((error) => {
  console.error(error?.code || error?.message || String(error));
  process.exitCode = 1;
});
