/**
 * Customer Assistant —— 附件与语音通道（P2 服务端第二批）。
 *
 * 设计来源：docs/customer-assistant/11_APP_VISITOR_ASSISTANT_DESIGN.md §6
 *   · 上传：`POST …/chat/uploads`（访客）/ `POST /api/visitor-assistant/uploads`（客服）
 *     体为 `{ filename, data(dataURL), durationMs? }`，**复用 AI 助手已验证的 base64 上传范式**
 *   · 下载：`GET …/attachments/:id`（两侧都鉴权）——**目录绝不静态暴露**（参照 /ai-attachments 反面教训）
 *   · 存储：`assets/ca-attachments/<ecardId>/<conversationPublicId>/<random>.<ext>`
 *     key = `<conversationPublicId>/<random>.<ext>`，发送消息时校验 key 归属该会话
 *
 * 纯增量：本文件不被既有模块引用；调用方只在"带附件"时才会走到这里。
 */

import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const CA_ATTACHMENT_LIMITS = {
  maxBytes: 10 * 1024 * 1024, // 10MB
  maxVoiceDurationMs: 60_000, // 语音 ≤ 60s
  allowed: [
    { mime: "image/jpeg", ext: "jpg", kind: "image" },
    { mime: "image/png", ext: "png", kind: "image" },
    { mime: "image/webp", ext: "webp", kind: "image" },
    { mime: "image/gif", ext: "gif", kind: "sticker" },
    { mime: "application/pdf", ext: "pdf", kind: "file" },
    { mime: "audio/m4a", ext: "m4a", kind: "audio" },
    { mime: "audio/x-m4a", ext: "m4a", kind: "audio" },
    { mime: "audio/mp4", ext: "m4a", kind: "audio" },
    { mime: "audio/aac", ext: "aac", kind: "audio" },
    { mime: "audio/opus", ext: "opus", kind: "audio" },
    { mime: "audio/ogg", ext: "ogg", kind: "audio" },
  ],
  // 除下列可执行/脚本类外，任意文件类型都按通用 file 处理
  deniedExtensions: [
    "apk", "aab", "exe", "msi", "bat", "cmd", "com", "scr", "cpl",
    "dll", "so", "dex", "jar", "sh", "bash", "ps1", "vbs", "js", "jse",
    "wsf", "hta", "reg", "app", "dmg", "pkg", "deb", "rpm", "iso", "img",
  ],
};

/** 常见扩展名 → MIME（兜底类型用；statAttachmentByKey 也依赖它还原 mime） */
const MIME_BY_EXT = {
  txt: "text/plain", log: "text/plain", md: "text/markdown", csv: "text/csv",
  json: "application/json", xml: "application/xml", yml: "application/x-yaml", yaml: "application/x-yaml",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  tar: "application/x-tar", gz: "application/gzip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp3: "audio/mpeg", wav: "audio/wav", amr: "audio/amr",
  mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
  mkv: "video/x-matroska", webm: "video/webm", "3gp": "video/3gpp",
};

/** 扩展名白名单化：小写、仅 [a-z0-9]、最长 8 位；无扩展名回退 bin */
export function sanitizeExtension(fileName) {
  const raw = String(fileName || "").trim().toLowerCase();
  const dot = raw.lastIndexOf(".");
  const ext = dot >= 0 ? raw.slice(dot + 1).replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  return ext || "bin";
}

const STORAGE_ROOT = path.resolve(process.cwd(), "assets", "ca-attachments");

/** 依据 MIME（优先）或扩展名判断类型；可执行类返回 null（调用方 415） */
export function resolveAttachmentKind(fileName, mimeType) {
  const mime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  const ext = sanitizeExtension(fileName);
  if (CA_ATTACHMENT_LIMITS.deniedExtensions.includes(ext)) return null;
  const hit = CA_ATTACHMENT_LIMITS.allowed.find((item) => item.mime === mime);
  if (hit) return hit;
  const byExt = CA_ATTACHMENT_LIMITS.allowed.find((item) => item.ext === ext);
  if (byExt) return { ...byExt, mime: mime || byExt.mime };
  // 兜底：任意类型按通用文件
  return { mime: mime || MIME_BY_EXT[ext] || "application/octet-stream", ext, kind: "file" };
}

/** 解析 dataURL / 原始 base64 → Buffer；失败返回 null */
export function decodeUploadData(data) {
  const raw = String(data || "");
  if (!raw) return null;
  const base64 = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  try {
    const buffer = Buffer.from(base64, "base64");
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

/** 存储路径：**带越权防护**（storageKey 只允许 "<convPublicId>/<file>" 形式） */
export function resolveStoragePath(storageKey) {
  const key = String(storageKey || "");
  if (!/^conv_[0-9a-f]{32}\/[A-Za-z0-9._-]{1,80}$/.test(key)) return null;
  const absolute = path.resolve(STORAGE_ROOT, key);
  if (!absolute.startsWith(STORAGE_ROOT + path.sep)) return null; // 目录穿越防护
  return absolute;
}

/**
 * 落盘并返回元数据。key 同时是"会话归属凭据"——发送消息时用它校验。
 */
export async function saveAttachmentBuffer({ ecardId, conversationPublicId, fileName, mimeType, buffer, durationMs = null }) {
  const kindInfo = resolveAttachmentKind(fileName, mimeType);
  if (!kindInfo) return { error: { status: 415, code: "UNSUPPORTED_FILE_TYPE", message: "不支援的檔案類型" } };
  if (!buffer?.length) return { error: { status: 400, code: "EMPTY_FILE", message: "檔案為空" } };
  if (buffer.length > CA_ATTACHMENT_LIMITS.maxBytes) {
    return { error: { status: 413, code: "FILE_TOO_LARGE", message: `檔案大小上限 ${Math.round(CA_ATTACHMENT_LIMITS.maxBytes / 1048576)}MB` } };
  }
  if (kindInfo.kind === "audio" && durationMs && Number(durationMs) > CA_ATTACHMENT_LIMITS.maxVoiceDurationMs) {
    return { error: { status: 413, code: "VOICE_TOO_LONG", message: "語音訊息過長" } };
  }

  const random = randomBytes(16).toString("hex");
  const storageKey = `${conversationPublicId}/${random}.${kindInfo.ext}`;
  const absolute = resolveStoragePath(storageKey);
  if (!absolute) return { error: { status: 500, code: "CA_INTERNAL_ERROR", message: "服務暫時不可用" } };

  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);

  return {
    storageKey,
    fileName: String(fileName || `file.${kindInfo.ext}`).slice(0, 255),
    mimeType: kindInfo.mime,
    fileSize: buffer.length,
    kind: kindInfo.kind,
    durationMs: durationMs ? Number(durationMs) : null,
    ecardId: Number(ecardId),
  };
}

/**
 * 按 storageKey 取磁盘真实元数据（发送消息时以磁盘为准，不信任客户端回传的 size/mime）。
 * 返回 { size, mimeType, kind, fileName } 或 null（不存在/非法）。
 */
export async function statAttachmentByKey(storageKey) {
  const absolute = resolveStoragePath(storageKey);
  if (!absolute || !existsSync(absolute)) return null;
  const info = await stat(absolute);
  const kindInfo = resolveAttachmentKind(path.basename(storageKey), "");
  if (!kindInfo) return null;
  return { size: info.size, mimeType: kindInfo.mime, kind: kindInfo.kind, fileName: path.basename(storageKey) };
}

/** 读文件流（下载端点用）；不存在返回 null */
export async function openAttachmentStream(storageKey) {
  const absolute = resolveStoragePath(storageKey);
  if (!absolute || !existsSync(absolute)) return null;
  const info = await stat(absolute);
  return { stream: createReadStream(absolute), size: info.size };
}
