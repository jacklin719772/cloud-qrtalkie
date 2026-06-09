import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getAsteriskPathConfig } from "../server/webrtcTemplateLoader.js";

const ASTERISK_PATHS = getAsteriskPathConfig();
const BACKUP_ROOT = ASTERISK_PATHS.backupRoot;

const FILES = [
  {
    path: ASTERISK_PATHS.customPostConf,
    candidateForModification: true,
    referenceOnly: false,
    coreCandidate: true,
  },
  {
    path: ASTERISK_PATHS.endpointCustomPostConf,
    candidateForModification: true,
    referenceOnly: false,
    coreCandidate: true,
  },
  {
    path: path.join(ASTERISK_PATHS.configDir, "pjsip_custom.conf"),
    candidateForModification: false,
    referenceOnly: true,
    coreCandidate: false,
  },
  {
    path: path.join(ASTERISK_PATHS.configDir, "pjsip.endpoint_custom.conf"),
    candidateForModification: false,
    referenceOnly: true,
    coreCandidate: false,
  },
  {
    path: path.join(ASTERISK_PATHS.configDir, "pjsip.transports_custom_post.conf"),
    candidateForModification: false,
    referenceOnly: true,
    coreCandidate: false,
  },
  {
    path: path.join(ASTERISK_PATHS.configDir, "pjsip.transports_custom.conf"),
    candidateForModification: false,
    referenceOnly: true,
    coreCandidate: false,
  },
  {
    path: path.join(ASTERISK_PATHS.configDir, "pjsip.conf"),
    candidateForModification: false,
    referenceOnly: true,
    coreCandidate: false,
  },
  {
    path: ASTERISK_PATHS.endpointConf,
    candidateForModification: false,
    referenceOnly: true,
    coreCandidate: false,
  },
  {
    path: ASTERISK_PATHS.authConf,
    candidateForModification: false,
    referenceOnly: true,
    coreCandidate: false,
  },
  {
    path: ASTERISK_PATHS.aorConf,
    candidateForModification: false,
    referenceOnly: true,
    coreCandidate: false,
  },
  {
    path: path.join(ASTERISK_PATHS.configDir, "pjsip.transports.conf"),
    candidateForModification: false,
    referenceOnly: true,
    coreCandidate: false,
  },
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

function formatMode(mode) {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

async function readNameMap(file, idIndex, nameIndex) {
  try {
    const text = await readFile(file, "utf8");
    const map = new Map();
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const parts = line.split(":");
      const id = Number(parts[idIndex]);
      const name = parts[nameIndex];
      if (Number.isInteger(id) && name) map.set(id, name);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function getNameMaps() {
  const [users, groups] = await Promise.all([
    readNameMap("/etc/passwd", 2, 0),
    readNameMap("/etc/group", 2, 0),
  ]);
  return { users, groups };
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

async function inspectFile(file, names) {
  const base = {
    path: file.path,
    exists: false,
    candidateForModification: file.candidateForModification,
    referenceOnly: file.referenceOnly,
  };

  try {
    const info = await stat(file.path);
    await access(file.path);
    return {
      ...base,
      exists: true,
      size: info.size,
      mode: formatMode(info.mode),
      uid: info.uid,
      gid: info.gid,
      owner: names.users.get(info.uid) || String(info.uid),
      group: names.groups.get(info.gid) || String(info.gid),
      mtime: info.mtime.toISOString(),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return base;
    return {
      ...base,
      exists: false,
      error: error?.message || "Unable to inspect file",
    };
  }
}

function timestampForDirectory(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

async function createBackup(inspections) {
  const createdAt = new Date();
  const backupDir = path.join(BACKUP_ROOT, timestampForDirectory(createdAt));
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await chmod(backupDir, 0o700);

  let copied = 0;
  let missing = 0;
  const warnings = [];
  const manifestFiles = [];

  for (const item of inspections) {
    const manifestItem = { ...item };
    if (!item.exists) {
      missing += 1;
      if (FILES.find((file) => file.path === item.path)?.coreCandidate) {
        warnings.push(`Core candidate file is missing: ${item.path}`);
      }
      manifestFiles.push(manifestItem);
      continue;
    }

    const backupPath = path.join(backupDir, path.basename(item.path));
    manifestItem.backupPath = backupPath;

    try {
      await copyFile(item.path, backupPath);
      manifestItem.sha256 = await sha256File(item.path);
      copied += 1;
    } catch (error) {
      manifestItem.error = error?.message || "Failed to copy file";
      warnings.push(`Failed to back up ${item.path}: ${manifestItem.error}`);
      if (FILES.find((file) => file.path === item.path)?.coreCandidate) {
        warnings.push(`Core candidate file could not be backed up: ${item.path}`);
      }
    }
    manifestFiles.push(manifestItem);
  }

  const manifest = {
    createdAt: createdAt.toISOString(),
    hostname: os.hostname(),
    backupRoot: BACKUP_ROOT,
    backupDir,
    files: manifestFiles,
    warnings,
  };

  const manifestPath = path.join(backupDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  return {
    backupDir,
    manifestPath,
    copied,
    missing,
    warnings,
  };
}

function printInspection(title, rows) {
  console.log(title);
  for (const row of rows) {
    const details = [
      `exists=${row.exists}`,
      row.exists ? `size=${row.size}` : null,
      row.exists ? `mtime=${row.mtime}` : null,
      row.exists ? `mode=${row.mode}` : null,
      row.exists ? `owner=${row.owner}` : null,
      row.exists ? `group=${row.group}` : null,
      row.error ? `error=${row.error}` : null,
    ].filter(Boolean).join(" ");
    console.log(`- ${row.path} ${details}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const confirm = args.confirm === "yes";
  const names = await getNameMaps();
  const inspections = await Promise.all(FILES.map((file) => inspectFile(file, names)));
  const candidateRows = inspections.filter((item) => item.candidateForModification);
  const referenceRows = inspections.filter((item) => item.referenceOnly);

  if (!confirm) {
    console.log("DRY RUN: no files will be copied");
    printInspection("Candidate files:", candidateRows);
    printInspection("Reference files:", referenceRows);
    console.log("Run with --confirm yes to create backup.");
    return;
  }

  const result = await createBackup(inspections);
  console.log("Backup created:");
  console.log(`Backup dir: ${result.backupDir}`);
  console.log(`Manifest: ${result.manifestPath}`);
  console.log(`Files copied: ${result.copied}`);
  console.log(`Files missing: ${result.missing}`);
  console.log(`Warnings: ${result.warnings.length}`);
  for (const warning of result.warnings) console.log(`- WARNING: ${warning}`);

  if (result.warnings.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error(`Backup failed: ${error?.message || String(error)}`);
  process.exitCode = 1;
});
