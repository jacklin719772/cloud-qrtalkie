import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, chmod, chown, mkdir, readFile, stat, writeFile, rename, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import os from "node:os";
import { applyConfigAndWait as freepbxApplyConfigAndWait, deleteExtension as freepbxDeleteExtension, fetchExtension as freepbxFetchExtension } from "./freepbxApiClient.js";
import { verifyPjsipExtension } from "./asteriskCommandService.js";
import { getAsteriskPathConfig, getWebrtcRuntimeConfig } from "./webrtcTemplateLoader.js";

const ASTERISK_PATHS = getAsteriskPathConfig();
const BACKUP_ROOT = ASTERISK_PATHS.backupRoot;
const ENDPOINT_CUSTOM_POST_FILE = ASTERISK_PATHS.endpointCustomPostConf;

export const WEBRTC_WORKFLOW_STEP_DEFS = [
  {
    key: "validate_extension",
    label: "驗證 WebRTC 帳號格式",
    running: "正在驗證 WebRTC 帳號格式",
    success: "WebRTC 帳號格式正確",
    failed: "WebRTC 帳號必須為純數字",
  },
  {
    key: "check_existing_extension",
    label: "檢查 FreePBX 帳號是否已存在",
    running: "正在檢查 FreePBX 中是否已存在相同帳號",
    success: "FreePBX 中尚未存在相同帳號，可以繼續建立",
    failed: "該 WebRTC 帳號已存在，請更換帳號",
  },
  {
    key: "backup_asterisk_configs",
    label: "備份 Asterisk PJSIP 配置",
    running: "正在備份 Asterisk PJSIP 配置",
    success: "Asterisk PJSIP 配置備份完成",
    failed: "Asterisk PJSIP 配置備份失敗，已停止建立流程",
  },
  {
    key: "create_freepbx_extension",
    label: "建立 FreePBX 基礎分機",
    running: "正在建立 FreePBX 基礎 PJSIP 分機",
    success: "FreePBX 基礎 PJSIP 分機建立成功",
    failed: "FreePBX 基礎 PJSIP 分機建立失敗",
  },
  {
    key: "update_pjsip_password",
    label: "設定 PJSIP 註冊密碼",
    running: "正在設定 PJSIP 註冊密碼",
    success: "PJSIP 註冊密碼設定成功",
    failed: "PJSIP 註冊密碼設定失敗",
  },
  {
    key: "submit_freepbx_webrtc_form",
    label: "補全 FreePBX WebRTC 進階配置",
    running: "正在提交 FreePBX WebRTC 進階配置",
    success: "FreePBX WebRTC 進階配置提交成功",
    failed: "FreePBX WebRTC 進階配置提交失敗",
  },
  {
    key: "first_fwconsole_reload",
    label: "套用 FreePBX 配置",
    running: "正在執行 sudo fwconsole reload 套用 FreePBX 配置",
    success: "FreePBX 配置已成功套用",
    failed: "FreePBX 配置套用失敗",
  },
  {
    key: "verify_generated_endpoint",
    label: "驗證 FreePBX 生成的 Endpoint 配置",
    running: "正在驗證 FreePBX 生成的 pjsip.endpoint.conf 配置",
    success: "FreePBX 生成的 Endpoint 配置驗證通過",
    failed: "FreePBX 生成的 Endpoint 配置不符合 WebRTC 要求",
  },
  {
    key: "write_endpoint_custom_overlay",
    label: "補齊 WebRTC Runtime 參數",
    running: "正在寫入 WebRTC Runtime 補充參數",
    success: "WebRTC Runtime 補充參數寫入成功",
    failed: "WebRTC Runtime 補充參數寫入失敗",
  },
  {
    key: "second_fwconsole_reload",
    label: "重新套用 Runtime 補充配置",
    running: "正在重新套用 WebRTC Runtime 補充配置",
    success: "WebRTC Runtime 補充配置已套用",
    failed: "WebRTC Runtime 補充配置套用失敗",
  },
  {
    key: "verify_runtime_endpoint",
    label: "驗證 WebRTC Runtime 狀態",
    running: "正在驗證 Asterisk Runtime 中的 WebRTC 參數",
    success: "WebRTC Runtime 參數驗證通過",
    failed: "WebRTC Runtime 參數驗證失敗",
  },
  {
    key: "verify_baseline_endpoints",
    label: "確認既有標準帳號未受影響",
    running: "正在確認既有標準帳號狀態",
    success: "既有標準帳號狀態正常",
    failed: "既有標準帳號狀態異常，請立即檢查 Asterisk 配置",
  },
  {
    key: "rollback_freepbx_extension",
    label: "回滾 FreePBX WebRTC 帳號",
    running: "正在回滾 FreePBX WebRTC 帳號",
    success: "FreePBX WebRTC 帳號已回滾",
    failed: "FreePBX WebRTC 帳號回滾失敗，請人工檢查",
    skipped: "未觸發回滾",
    rollback: "FreePBX WebRTC 帳號已回滾",
  },
  {
    key: "rollback_endpoint_custom_overlay",
    label: "回滾 WebRTC Runtime 補充配置",
    running: "正在回滾 WebRTC Runtime 補充配置",
    success: "WebRTC Runtime 補充配置已回滾",
    failed: "WebRTC Runtime 補充配置回滾失敗，請人工檢查備份文件",
    skipped: "未觸發回滾",
    rollback: "WebRTC Runtime 補充配置已回滾",
  },
  {
    key: "rollback_apply_config",
    label: "重新套用回滾結果",
    running: "正在重新套用回滾結果",
    success: "回滾結果已重新套用",
    failed: "回滾結果套用失敗",
    skipped: "未觸發回滾",
    rollback: "回滾結果已重新套用",
  },
  {
    key: "rollback_verify_removed",
    label: "驗證回滾後帳號已移除",
    running: "正在驗證回滾後帳號是否已移除",
    success: "回滾後帳號已移除",
    failed: "回滾後帳號仍存在，請立即檢查",
    skipped: "未觸發回滾",
    rollback: "回滾後帳號已移除",
  },
  {
    key: "finalize",
    label: "完成建立流程",
    running: "正在完成 WebRTC 帳號建立流程",
    success: "WebRTC 帳號建立流程完成",
    failed: "WebRTC 帳號建立流程未完成",
  },
];

function formatMode(mode) {
  return (mode & 0o7777).toString(8).padStart(4, "0");
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .toLowerCase();
}

function parseCodecs(value) {
  return normalize(value)
    .replace(/[()]/g, "")
    .split(/[,&| ]+/)
    .map((codec) => codec.trim())
    .filter(Boolean);
}

export function createWorkflowSteps() {
  return WEBRTC_WORKFLOW_STEP_DEFS.map((item) => ({
    key: item.key,
    label: item.label,
    status: "pending",
    message: "",
    startedAt: "",
    finishedAt: "",
    details: {},
  }));
}

export function getStep(steps, key) {
  return steps.find((step) => step.key === key) || null;
}

export function setStepStatus(steps, key, status, message, details = {}) {
  const step = getStep(steps, key);
  if (!step) return null;
  if (!step.startedAt) step.startedAt = new Date().toISOString();
  step.status = status;
  step.message = message;
  step.details = { ...step.details, ...details };
  if (status !== "running" && !step.finishedAt) step.finishedAt = new Date().toISOString();
  if (status === "running") step.finishedAt = "";
  return step;
}

export function markStepRunning(steps, key) {
  const def = WEBRTC_WORKFLOW_STEP_DEFS.find((item) => item.key === key);
  return setStepStatus(steps, key, "running", def?.running || "正在處理中");
}

export function markStepSuccess(steps, key, details = {}) {
  const def = WEBRTC_WORKFLOW_STEP_DEFS.find((item) => item.key === key);
  return setStepStatus(steps, key, "success", def?.success || "處理成功", details);
}

export function markStepFailed(steps, key, details = {}) {
  const def = WEBRTC_WORKFLOW_STEP_DEFS.find((item) => item.key === key);
  return setStepStatus(steps, key, "failed", def?.failed || "處理失敗", details);
}

export function markStepSkipped(steps, key, message = "") {
  const def = WEBRTC_WORKFLOW_STEP_DEFS.find((item) => item.key === key);
  return setStepStatus(steps, key, "skipped", message || def?.skipped || "已略過");
}

export function markStepRollback(steps, key, details = {}) {
  const def = WEBRTC_WORKFLOW_STEP_DEFS.find((item) => item.key === key);
  return setStepStatus(steps, key, "rollback", def?.rollback || "已回滾", details);
}

export function skipRemainingSteps(steps, fromKey, message = "已略過") {
  const startIndex = steps.findIndex((step) => step.key === fromKey);
  if (startIndex < 0) return;
  for (let index = startIndex; index < steps.length; index += 1) {
    if (steps[index].status === "pending") {
      markStepSkipped(steps, steps[index].key, message);
    }
  }
}

export function buildFourFieldEndpointOverlay(extension) {
  const overlay = getWebrtcRuntimeConfig().endpointCustomPostOverlay || {};
  return [
    `; BEGIN SaaS WebRTC 4-field endpoint overlay ${extension}`,
    `[${extension}](+)`,
    `allow_unauthenticated_options=${overlay.allow_unauthenticated_options || "yes"}`,
    `rtp_timeout=${overlay.rtp_timeout || "0"}`,
    `rtp_timeout_hold=${overlay.rtp_timeout_hold || "0"}`,
    `asymmetric_rtp_codec=${overlay.asymmetric_rtp_codec || "yes"}`,
    `; END SaaS WebRTC 4-field endpoint overlay ${extension}`,
    "",
  ].join("\n");
}

export function buildFourFieldEndpointOverlayMarker(extension) {
  return {
    start: `; BEGIN SaaS WebRTC 4-field endpoint overlay ${extension}`,
    end: `; END SaaS WebRTC 4-field endpoint overlay ${extension}`,
  };
}

export function upsertMarkerBlock(current, extension, block) {
  const { start, end } = buildFourFieldEndpointOverlayMarker(extension);
  const startIndex = String(current || "").indexOf(start);
  const endIndex = String(current || "").indexOf(end);
  const normalizedBlock = block.endsWith("\n") ? block : `${block}\n`;

  if (startIndex >= 0 && endIndex > startIndex) {
    const afterEnd = endIndex + end.length;
    const nextNewline = String(current || "").indexOf("\n", afterEnd);
    const replaceEnd = nextNewline >= 0 ? nextNewline + 1 : String(current || "").length;
    return {
      action: "replace",
      content: `${String(current || "").slice(0, startIndex)}${normalizedBlock}${String(current || "").slice(replaceEnd)}`,
    };
  }

  const separator = String(current || "").endsWith("\n") ? "\n" : "\n\n";
  return {
    action: "append",
    content: `${String(current || "")}${separator}${normalizedBlock}`,
  };
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function loadEndpointCustomPostBackup(backupDir) {
  if (!backupDir || !String(backupDir).startsWith(BACKUP_ROOT)) {
    throw new Error("INVALID_BACKUP_DIR");
  }
  const manifestPath = `${String(backupDir).replace(/\/+$/, "")}/manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const targetFile = ENDPOINT_CUSTOM_POST_FILE;
  const targetEntry = (manifest.files || []).find((item) => item.path === targetFile);
  if (!targetEntry || !targetEntry.exists || !targetEntry.sha256 || !targetEntry.backupPath) {
    throw new Error("BACKUP_MANIFEST_TARGET_FILE_MISSING");
  }
  return { manifestPath, manifest, targetEntry };
}

export async function restoreEndpointCustomPostFromBackup(backupDir) {
  const { targetEntry } = await loadEndpointCustomPostBackup(backupDir);
  const currentStat = await stat(ENDPOINT_CUSTOM_POST_FILE);
  await copyFile(targetEntry.backupPath, ENDPOINT_CUSTOM_POST_FILE);
  await chown(ENDPOINT_CUSTOM_POST_FILE, currentStat.uid, currentStat.gid);
  await chmod(ENDPOINT_CUSTOM_POST_FILE, currentStat.mode & 0o7777);
  return targetEntry.backupPath;
}

export async function rollbackCreatedFreepbxAccount({
  extension,
  responseData,
  steps,
}) {
  const ext = String(extension || "").trim();
  if (!ext || !responseData?.createdInFreepbx) {
    return {
      attempted: false,
      success: null,
      deletedInFreepbx: false,
      overlayRemoved: false,
      applyConfigSuccess: null,
      verifyRemoved: null,
      message: "",
    };
  }

  if (responseData.rollbackExecuted) {
    return {
      attempted: true,
      success: Boolean(responseData.rollbackSuccess),
      deletedInFreepbx: Boolean(responseData.rollbackDetails?.deletedInFreepbx),
      overlayRemoved: Boolean(responseData.rollbackDetails?.overlayRemoved),
      applyConfigSuccess: Boolean(responseData.rollbackDetails?.applyConfigSuccess),
      verifyRemoved: Boolean(responseData.rollbackDetails?.verifyRemoved),
      message: responseData.rollbackMessage || "",
    };
  }

  responseData.rollbackExecuted = true;
  responseData.rollbackDetails = responseData.rollbackDetails || {};

  let deletedInFreepbx = false;
  let overlayRemoved = false;
  let applyConfigSuccess = false;
  let verifyRemoved = false;
  let rollbackMessage = "";

  markStepRunning(steps, "rollback_freepbx_extension");
  try {
    const existingBefore = await freepbxFetchExtension(ext);
    if (!existingBefore) {
      deletedInFreepbx = true;
      rollbackMessage = "FreePBX 帳號已不存在，略過刪除";
      markStepRollback(steps, "rollback_freepbx_extension", { deletedInFreepbx: false, notFound: true });
    } else {
      const deleteResult = await freepbxDeleteExtension(ext);
      deletedInFreepbx = Boolean(deleteResult?.status);
      if (deletedInFreepbx) {
        markStepRollback(steps, "rollback_freepbx_extension", {
          deletedInFreepbx: true,
          message: deleteResult?.message || "",
        });
      } else {
        markStepFailed(steps, "rollback_freepbx_extension", {
          deletedInFreepbx: false,
          message: deleteResult?.message || "delete failed",
        });
      }
      rollbackMessage = deleteResult?.message || rollbackMessage;
    }
  } catch (error) {
    markStepFailed(steps, "rollback_freepbx_extension", {
      deleteError: error?.code || error?.message || "error",
    });
  }

  markStepRunning(steps, "rollback_endpoint_custom_overlay");
  try {
    const currentOverlay = await readEndpointCustomPostOverlay(ext);
    if (currentOverlay.exists) {
      const currentText = await readFile(ENDPOINT_CUSTOM_POST_FILE, "utf8");
      const removed = removeEndpointCustomPostOverlay(currentText, ext);
      if (removed.removed) {
        const currentStat = await stat(ENDPOINT_CUSTOM_POST_FILE);
        await writeAtomicFile(ENDPOINT_CUSTOM_POST_FILE, removed.content, currentStat.mode & 0o7777);
        await chown(ENDPOINT_CUSTOM_POST_FILE, currentStat.uid, currentStat.gid);
        await chmod(ENDPOINT_CUSTOM_POST_FILE, currentStat.mode & 0o7777);
        overlayRemoved = true;
      }
    } else {
      overlayRemoved = true;
    }
    markStepRollback(steps, "rollback_endpoint_custom_overlay", {
      overlayRemoved,
      overlayExists: Boolean(currentOverlay.exists),
    });
  } catch (error) {
    markStepFailed(steps, "rollback_endpoint_custom_overlay", {
      rollbackError: error?.code || error?.message || "error",
    });
  }

  markStepRunning(steps, "rollback_apply_config");
  let applyConfig = null;
  try {
    applyConfig = await freepbxApplyConfigAndWait();
    applyConfigSuccess = Boolean(applyConfig?.success);
    if (applyConfigSuccess) {
      markStepRollback(steps, "rollback_apply_config", {
        success: true,
        transactionId: applyConfig?.transactionId || null,
        waitStrategy: applyConfig?.waitStrategy || null,
      });
    } else {
      markStepFailed(steps, "rollback_apply_config", {
        success: false,
        message: applyConfig?.message || "",
      });
    }
  } catch (error) {
    applyConfigSuccess = false;
    markStepFailed(steps, "rollback_apply_config", {
      success: false,
      message: error?.message || "reload failed",
    });
  }

  markStepRunning(steps, "rollback_verify_removed");
  let runtimeState = null;
  let freepbxState = null;
  try {
    freepbxState = await freepbxFetchExtension(ext);
  } catch {
    freepbxState = null;
  }
  try {
    runtimeState = await verifyPjsipExtension(ext, getWebrtcRuntimeConfig());
  } catch (error) {
    runtimeState = {
      endpointExists: false,
      authExists: false,
      aorExists: false,
      verified: false,
      failedChecks: ["runtime_error"],
      unsupportedOrUnverified: [],
      details: { runtimeError: error?.message || "runtime error" },
    };
  }
  const overlayState = await readEndpointCustomPostOverlay(ext).catch(() => ({ exists: false }));
  verifyRemoved = !freepbxState && !runtimeState?.endpointExists && !runtimeState?.authExists && !runtimeState?.aorExists && !overlayState?.exists;
  if (verifyRemoved) {
    markStepRollback(steps, "rollback_verify_removed", {
      freepbxExists: Boolean(freepbxState),
      endpointExists: Boolean(runtimeState?.endpointExists),
      authExists: Boolean(runtimeState?.authExists),
      aorExists: Boolean(runtimeState?.aorExists),
      overlayExists: Boolean(overlayState?.exists),
    });
  } else {
    markStepFailed(steps, "rollback_verify_removed", {
      freepbxExists: Boolean(freepbxState),
      endpointExists: Boolean(runtimeState?.endpointExists),
      authExists: Boolean(runtimeState?.authExists),
      aorExists: Boolean(runtimeState?.aorExists),
      overlayExists: Boolean(overlayState?.exists),
    });
  }

  responseData.rollbackDetails = {
    deletedInFreepbx,
    overlayRemoved,
    applyConfigSuccess,
    verifyRemoved,
    freepbxExistsAfterRollback: Boolean(freepbxState),
    runtime: runtimeState,
    overlay: overlayState,
  };
  responseData.rollbackSuccess = Boolean(deletedInFreepbx && overlayRemoved && applyConfigSuccess && verifyRemoved);
  responseData.rollbackMessage = responseData.rollbackSuccess
    ? "已刪除 FreePBX 帳號並清除 Runtime Overlay"
    : "回滾未完全完成，請人工檢查";

  return {
    attempted: true,
    success: responseData.rollbackSuccess,
    deletedInFreepbx,
    overlayRemoved,
    applyConfigSuccess,
    verifyRemoved,
    message: responseData.rollbackMessage,
  };
}

export async function writeAtomicFile(filePath, content, mode) {
  const dir = dirname(filePath);
  const tempDir = await mkdtemp(join(dir, ".saas-overlay-"));
  const tempPath = join(tempDir, `.tmp-${process.pid}-${Date.now()}`);
  await writeFile(tempPath, content, { mode });
  await rename(tempPath, filePath);
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}

export function parsePjsipSection(content, sectionName) {
  const lines = String(content || "").split(/\n/);
  const start = lines.findIndex((line) => line.trim() === `[${sectionName}]`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\[[^\]]+\]\s*$/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start, end);
  const fields = {};
  for (const line of body.slice(1)) {
    const match = line.match(/^\s*([^;#][^=]*)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    fields[key] = value;
  }
  return { sectionName, startLine: start + 1, endLine: end, body, fields };
}

export function parseEndpointCustomPostOverlay(content, extension) {
  const text = String(content || "");
  const startMarker = `; BEGIN SaaS WebRTC 4-field endpoint overlay ${extension}`;
  const endMarker = `; END SaaS WebRTC 4-field endpoint overlay ${extension}`;
  const startIndex = text.indexOf(startMarker);
  const endIndex = text.indexOf(endMarker);

  if (startIndex < 0 || endIndex < startIndex) {
    return {
      exists: false,
      fields: {},
      marker: {
        start: startMarker,
        end: endMarker,
      },
    };
  }

  const block = text.slice(startIndex, endIndex + endMarker.length);
  const fields = {};
  for (const line of block.split(/\n/)) {
    const match = line.match(/^\s*([^;#][^=]*)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    fields[key] = value;
  }

  return {
    exists: true,
    fields,
    marker: {
      start: startMarker,
      end: endMarker,
    },
  };
}

export function removeEndpointCustomPostOverlay(content, extension) {
  const text = String(content || "");
  const { start, end } = buildFourFieldEndpointOverlayMarker(String(extension));
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);

  if (startIndex < 0 || endIndex < startIndex) {
    return {
      removed: false,
      action: "none",
      content: text,
      marker: {
        start,
        end,
      },
    };
  }

  const afterEnd = endIndex + end.length;
  let replaceStart = startIndex;
  let replaceEnd = afterEnd;
  if (text.slice(replaceEnd, replaceEnd + 1) === "\r") {
    replaceEnd += 1;
  }
  if (text.slice(replaceEnd, replaceEnd + 1) === "\n") {
    replaceEnd += 1;
  }
  if (replaceStart >= 2 && text.slice(replaceStart - 2, replaceStart) === "\n\n") {
    replaceStart -= 1;
  } else if (replaceStart >= 1 && text.slice(replaceStart - 1, replaceStart) === "\n") {
    replaceStart -= 1;
  }

  const contentAfterRemoval = `${text.slice(0, replaceStart)}${text.slice(replaceEnd)}`.replace(/\n{3,}/g, "\n\n");
  return {
    removed: true,
    action: "remove",
    content: contentAfterRemoval,
    marker: {
      start,
      end,
    },
  };
}

export async function readEndpointCustomPostOverlay(extension) {
  const content = await readFile(ENDPOINT_CUSTOM_POST_FILE, "utf8").catch(() => "");
  const overlay = parseEndpointCustomPostOverlay(content, String(extension));
  return {
    file: ENDPOINT_CUSTOM_POST_FILE,
    exists: overlay.exists,
    fields: overlay.fields,
    marker: overlay.marker,
  };
}

export function buildExpectedGeneratedEndpointSection(extension, referenceFields = {}, defaults = {}) {
  const runtime = getWebrtcRuntimeConfig();
  const fields = {
    ...referenceFields,
    aors: extension,
    auth: `${extension}-auth`,
    callerid: `${runtime.displayNamePrefix}${extension} <${extension}>`,
  };
  fields.allow = String(defaults.allowedCodecsString || runtime.allowedCodecsString || "");
  fields.disallow = "all";
  fields.context = fields.context || defaults.context || runtime.context || "";
  fields.media_address = String(defaults.mediaAddress || fields.media_address || runtime.mediaAddress || "");
  fields.direct_media = "no";
  fields.transport = String(defaults.transport || fields.transport || runtime.transport || "");
  fields.aggregate_mwi = "yes";
  fields.use_avpf = "yes";
  fields.rtcp_mux = "yes";
  fields.bundle = "yes";
  fields.ice_support = "yes";
  fields.media_use_received_transport = "yes";
  fields.media_encryption = "dtls";
  fields.timers = "no";
  fields.media_encryption_optimistic = "yes";
  fields.refer_blind_progress = "yes";
  fields.send_pai = "yes";
  fields.dtls_verify = fields.dtls_verify || "fingerprint";
  fields.rtp_timeout = fields.rtp_timeout || "30";
  fields.rtp_timeout_hold = fields.rtp_timeout_hold || "300";
  fields.type = "endpoint";

  const order = [
    "type",
    "aors",
    "auth",
    "disallow",
    "allow",
    "context",
    "callerid",
    "media_address",
    "direct_media",
    "transport",
    "aggregate_mwi",
    "use_avpf",
    "rtcp_mux",
    "bundle",
    "ice_support",
    "media_use_received_transport",
    "media_encryption",
    "timers",
    "media_encryption_optimistic",
    "refer_blind_progress",
    "rtp_timeout",
    "rtp_timeout_hold",
    "send_pai",
    "dtls_verify",
  ];

  const lines = [`[${extension}]`];
  for (const key of order) {
    if (fields[key] !== undefined && fields[key] !== "") lines.push(`${key}=${fields[key]}`);
  }
  return { fields, text: lines.join("\n") };
}

export function compareEndpointFields(actualFields = {}, expectedFields = {}, fields = []) {
  return fields.map((field) => ({
    field,
    expected: expectedFields[field] ?? "",
    actual: actualFields[field] ?? "",
    passed: normalize(actualFields[field]) === normalize(expectedFields[field]),
  }));
}

function table(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(row[column.key] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

export function buildWorkflowReport(data) {
  const runtime = getWebrtcRuntimeConfig();
  const primaryReference = runtime.referenceExtension;
  const fallbackReference = runtime.fallbackReferenceExtension;
  const stepRows = (data.steps || []).map((step) => ({
    key: step.key,
    label: step.label,
    status: step.status,
    message: step.message || "",
    startedAt: step.startedAt || "",
    finishedAt: step.finishedAt || "",
  }));
  const compareRows = (data.endpointComparison || []).map((item) => ({
    field: item.field,
    expected: item.expected,
    actual: item.actual,
    passed: item.passed ? "yes" : "no",
  }));
  const failedFields = data.failedFields || [];
  const warningFields = data.warningFields || [];
  const runtimeDiagnostics = data.runtimeDiagnostics || {};
  const content = `# FreePBX WebRTC 帳號建立流程報告

## 1. 摘要

- 時間: ${new Date().toISOString()}
- extension: ${data.extension}
- 顯示名稱: ${data.displayName}
- success: ${data.success ? "true" : "false"}
- message: ${data.message}
- backupDir: ${data.backupDir || "not run"}
- reportPath: ${data.reportPath || "not set"}
- Asterisk restart executed: false
- rollbackExecuted: ${data.rollbackExecuted ? "true" : "false"}
- rollbackSuccess: ${data.rollbackSuccess === null ? "null" : String(data.rollbackSuccess)}

## 2. 執行步驟

${table(stepRows, [
  { key: "key", label: "key" },
  { key: "label", label: "label" },
  { key: "status", label: "status" },
  { key: "message", label: "message" },
  { key: "startedAt", label: "startedAt" },
  { key: "finishedAt", label: "finishedAt" },
])}

## 3. 主要結果

- createdInFreepbx: ${String(data.createdInFreepbx)}
- pjsipPasswordConfigured: ${String(data.pjsipPasswordConfigured)}
- webFormSubmitted: ${String(data.webFormSubmitted)}
- firstReloadExecuted: ${String(data.firstReloadExecuted)}
- generatedEndpointVerified: ${String(data.generatedEndpointVerified)}
- endpointCustomPostWritten: ${String(data.endpointCustomPostWritten)}
- secondReloadExecuted: ${String(data.secondReloadExecuted)}
- runtimeVerified: ${String(data.runtimeVerified)}
- baselineVerified: ${String(data.baselineVerified)}
- asteriskRestartExecuted: false

## 4. Endpoint 比對

${compareRows.length ? table(compareRows, [
  { key: "field", label: "field" },
  { key: "expected", label: "expected" },
  { key: "actual", label: "actual" },
  { key: "passed", label: "passed" },
]) : "not available"}

## 5. Failed / Warning

- failedFields: ${failedFields.length ? failedFields.join(", ") : "none"}
- warningFields: ${warningFields.length ? warningFields.join(", ") : "none"}
- runtimeRetryCount: ${runtimeDiagnostics.retryCount ?? 0}
- runtimeRetryDelayMs: ${runtimeDiagnostics.retryDelayMs ?? 0}
- runtimeExpectedOverlayPresent: ${runtimeDiagnostics.expectedOverlayPresent ? "yes" : "no"}
- runtimeFailedChecks: ${(runtimeDiagnostics.failedChecks || []).length ? runtimeDiagnostics.failedChecks.join(", ") : "none"}

## 6. Baseline

- ${fallbackReference} endpointExists: ${data.baseline?.[fallbackReference]?.endpointExists ? "true" : "false"}
- ${primaryReference} endpointExists: ${data.baseline?.[primaryReference]?.endpointExists ? "true" : "false"}
- ${fallbackReference} / ${primaryReference} normal: ${data.baselineNormal ? "true" : "false"}

## 7. 回滾

- rollbackExecuted: ${data.rollbackExecuted ? "true" : "false"}
- rollbackSuccess: ${data.rollbackSuccess === null ? "null" : String(data.rollbackSuccess)}
- rollbackMessage: ${data.rollbackMessage || "n/a"}

## 8. 安全摘要

- modified /etc/asterisk/pjsip_custom_post.conf: false
- modified /etc/asterisk/pjsip.endpoint.conf: false
- modified /etc/asterisk/pjsip.auth.conf: false
- modified /etc/asterisk/pjsip.aor.conf: false
- wrote FreePBX database: false
- wrote SaaS database: false
`;
  return content;
}

export function getEndpointComparisonFields() {
  return [
    "type",
    "aors",
    "auth",
    "disallow",
    "allow",
    "context",
    "callerid",
    "media_address",
    "direct_media",
    "transport",
    "aggregate_mwi",
    "use_avpf",
    "rtcp_mux",
    "bundle",
    "ice_support",
    "media_use_received_transport",
    "media_encryption",
    "timers",
    "media_encryption_optimistic",
    "refer_blind_progress",
    "rtp_timeout",
    "rtp_timeout_hold",
    "send_pai",
    "dtls_verify",
  ];
}
