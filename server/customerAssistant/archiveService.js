/**
 * Customer Assistant —— 内容归档（P2 归档能力）
 *
 * 约定（用户已确认）：
 *   · 归档 = 把会话的全部消息 + 双方附件打成一个 ZIP（同一会话重复归档 = 覆盖换链）
 *   · ZIP 内含 chat.html（可读问答记录）、info.json（结构化）、files/（附件，序号_原名）
 *   · 同时生成只读网页预览（免登录，凭不可猜 token），网页内提供 ZIP 下载
 *   · 归档动作会把会话标记为 archived（出现在列表的"已归档"里）
 *   · 删除会话/清空内容不影响已生成的归档包（归档即快照，不做级联删除）
 *
 * 无第三方依赖：ZIP 32 位格式自实现（deflateRaw + 手写头部，UTF-8 文件名）。
 */

import { deflateRawSync } from "node:zlib";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { openAttachmentStream, resolveStoragePath } from "./attachmentService.js";

const ARCHIVE_ROOT = path.resolve(process.cwd(), "assets", "ca-archives");
const MAX_PREVIEW_ATTACHMENT_INLINE_BYTES = 2 * 1024 * 1024; // 预览页内联 ≤2MB 的图片

/* ------------------------------------------------------------------ *
 * 最小 ZIP 写入
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const day = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date: day };
}

/** entries: [{ name, data: Buffer, mtime?: Date }] → Buffer（ZIP 文件内容） */
export function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(String(entry.name).replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || "");
    const deflated = deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const { time, date } = dosDateTime(entry.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

/* ------------------------------------------------------------------ *
 * 打包内容
 * ------------------------------------------------------------------ */

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function toLocalText(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function safeFilePart(name) {
  return String(name || "file").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

/**
 * 组装归档：读消息 + 附件文件 → ZIP + 预览 HTML。
 * 返回 { zip, previewHtml, messageCount, attachmentCount, startedAt, endedAt, skipped }
 */
export async function buildConversationArchive({ rows, visitor, ecardId, conversationPublicId }) {
  const entries = [];
  const attachmentsInZip = [];
  const attachmentRows = [];
  let index = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.attachment_id) continue;
    index += 1;
    const storageKey = row.storage_key;
    const absolute = storageKey ? resolveStoragePath(storageKey) : null;
    const zipName = `files/${String(index).padStart(3, "0")}_${safeFilePart(row.file_name)}`;
    let inlined = null;
    if (absolute && existsSync(absolute)) {
      const data = await readFile(absolute);
      entries.push({ name: zipName, data, mtime: row.created_at instanceof Date ? row.created_at : undefined });
      attachmentsInZip.push({ seq: Number(row.seq), fileName: row.file_name, zipName, fileSize: data.length });
      if (/^image\//.test(String(row.mime_type || "")) && data.length <= MAX_PREVIEW_ATTACHMENT_INLINE_BYTES) {
        inlined = `data:${row.mime_type};base64,${data.toString("base64")}`;
      }
    } else {
      skipped += 1;
    }
    attachmentRows.push({
      seq: Number(row.seq),
      senderType: row.sender_type,
      fileName: row.file_name,
      fileSize: Number(row.file_size) || 0,
      mimeType: row.mime_type || null,
      zipName: absolute && existsSync(absolute) ? zipName : null,
      inlined,
      createdAt: row.created_at,
    });
  }

  const startedAt = rows.length ? rows[0].created_at : null;
  const endedAt = rows.length ? rows[rows.length - 1].created_at : null;
  const archivedAt = new Date();

  const info = {
    conversationId: conversationPublicId,
    ecardId: Number(ecardId),
    archivedAt: archivedAt.toISOString(),
    startedAt,
    endedAt,
    visitor: visitor
      ? {
          name: visitor.contact_name || visitor.display_name || null,
          email: visitor.contact_email || null,
          phone: visitor.contact_phone || null,
          subject: visitor.contact_subject || null,
        }
      : null,
    messageCount: rows.length,
    attachmentCount: attachmentsInZip.length,
    messages: rows.map((row) => ({
      seq: Number(row.seq),
      senderType: row.sender_type,
      contentType: row.content_type,
      content: row.content || null,
      createdAt: row.created_at,
      attachment: row.attachment_id
        ? {
            fileName: row.file_name,
            fileSize: Number(row.file_size) || 0,
            mimeType: row.mime_type || null,
            zipName: attachmentsInZip.find((a) => a.seq === Number(row.seq))?.zipName || null,
          }
        : null,
    })),
  };

  const previewHtml = renderPreviewHtml({ info, attachmentRows, embedded: false });

  // chat.html：ZIP 内可离线阅读（附件用相对路径）
  const chatHtml = renderChatHtml({ info, attachmentRows, embedded: false });
  entries.push({ name: "chat.html", data: Buffer.from(chatHtml, "utf8") });
  entries.push({ name: "info.json", data: Buffer.from(JSON.stringify(info, null, 2), "utf8") });

  return {
    zip: buildZip(entries),
    previewHtml,
    messageCount: rows.length,
    attachmentCount: attachmentsInZip.length,
    startedAt,
    endedAt,
    skipped,
    archivedAt,
  };
}

/** 预览页（内联图片，便于直接看；ZIP 下载单独给） */
export function renderPreviewHtml({ info, attachmentRows }) {
  return renderChatHtml({ info, attachmentRows, embedded: true });
}

function renderChatHtml({ info, attachmentRows, embedded }) {
  const visitor = info.visitor || {};
  const title = `${escapeHtml(visitor.name || "访客")} · 聊天记录归档`;
  const rows = [];
  for (const row of info.messages) {
    const time = escapeHtml(toLocalText(row.createdAt));
    if (row.senderType === "system") {
      rows.push(`<div class="system">${escapeHtml(row.content)}<span class="t">${time}</span></div>`);
      continue;
    }
    const side = row.senderType === "agent" ? "out" : "in";
    const who = row.senderType === "agent" ? "客服" : escapeHtml(visitor.name || "访客");
    const body = [];
    if (row.content) body.push(`<div class="text">${escapeHtml(row.content).replace(/\n/g, "<br>")}</div>`);
    const att = attachmentRows.find((a) => a.seq === row.seq);
    if (att) {
      const size = formatBytes(att.fileSize);
      if (embedded && att.inlined) {
        body.push(`<div class="att"><img src="${att.inlined}" alt="${escapeHtml(att.fileName)}" /><div class="meta">${escapeHtml(att.fileName)} · ${size}</div></div>`);
      } else if (att.zipName) {
        body.push(`<div class="att"><a href="${escapeHtml(att.zipName)}">${escapeHtml(att.fileName)}</a> · ${size}</div>`);
      } else {
        body.push(`<div class="att missing">${escapeHtml(att.fileName)} · ${size}（归档时文件缺失）</div>`);
      }
    }
    rows.push(`<div class="row ${side}"><div class="who">${who}</div><div class="bubble">${body.join("")}<div class="t">${time}</div></div></div>`);
  }

  const filesSection = embedded
    ? ""
    : `<h2>附件清单</h2><ul>${attachmentRows
        .map((a) => `<li>${escapeHtml(a.fileName)} · ${formatBytes(a.fileSize)}${a.zipName ? ` → <code>${escapeHtml(a.zipName)}</code>` : "（缺失）"}</li>`)
        .join("")}</ul>`;

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
 body{font-family:-apple-system,"Segoe UI",Roboto,"Noto Sans SC",sans-serif;background:#eef6f8;margin:0;padding:16px;color:#22334d}
 .head{max-width:760px;margin:0 auto 16px;background:#fff;border-radius:14px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
 .head h1{font-size:18px;margin:0 0 8px}
 .head .meta{font-size:13px;color:#4e6074;line-height:1.7}
 .wrap{max-width:760px;margin:0 auto}
 .row{display:flex;flex-direction:column;margin:10px 0}
 .row.in{align-items:flex-start}
 .row.out{align-items:flex-end}
 .who{font-size:12px;color:#4e6074;margin:0 6px 4px}
 .bubble{max-width:78%;background:#fff;border-radius:14px;padding:10px 14px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
 .row.out .bubble{background:#dff0ff}
 .text{font-size:15px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
 .att{margin-top:8px;font-size:13px}
 .att img{max-width:100%;border-radius:8px;display:block;margin-bottom:4px}
 .att .meta{color:#4e6074}
 .att.missing{color:#b45309}
 .t{font-size:11px;color:#7b8ba1;margin-top:6px;text-align:right}
 .system{text-align:center;font-size:12px;color:#7b8ba1;margin:12px 0}
 .system .t{margin-left:8px;text-align:center}
 h2{font-size:15px;max-width:760px;margin:24px auto 8px}
 ul{max-width:760px;margin:0 auto;font-size:13px;color:#22334d;line-height:1.9}
 code{background:#e8eef3;border-radius:4px;padding:1px 5px}
</style></head>
<body>
<div class="head">
  <h1>${title}</h1>
  <div class="meta">
    访客：${escapeHtml(visitor.name || "-")}${visitor.email ? ` · ${escapeHtml(visitor.email)}` : ""}${visitor.phone ? ` · ${escapeHtml(visitor.phone)}` : ""}<br>
    ${visitor.subject ? `主题：${escapeHtml(visitor.subject)}<br>` : ""}
    沟通时间：${escapeHtml(toLocalText(info.startedAt))} ~ ${escapeHtml(toLocalText(info.endedAt))}<br>
    归档时间：${escapeHtml(toLocalText(info.archivedAt))} · 消息 ${info.messageCount} 条 · 附件 ${info.attachmentCount} 个
  </div>
</div>
<div class="wrap">${rows.join("\n")}</div>
${filesSection}
</body></html>`;
}

/* ------------------------------------------------------------------ *
 * 归档文件落盘
 * ------------------------------------------------------------------ */

const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function archiveDir(ecardId) {
  return path.join(ARCHIVE_ROOT, String(Number(ecardId) || 0));
}

export function archivePaths(ecardId, conversationPublicId) {
  const dir = archiveDir(ecardId);
  return {
    zip: path.join(dir, `${conversationPublicId}.zip`),
    html: path.join(dir, `${conversationPublicId}.html`),
  };
}

export async function saveArchiveFiles(ecardId, conversationPublicId, { zip, previewHtml }) {
  const dir = archiveDir(ecardId);
  await mkdir(dir, { recursive: true });
  const paths = archivePaths(ecardId, conversationPublicId);
  await writeFile(paths.zip, zip);
  await writeFile(paths.html, Buffer.from(previewHtml, "utf8"));
  return paths;
}

export async function removeArchiveFiles(ecardId, conversationPublicId) {
  const paths = archivePaths(ecardId, conversationPublicId);
  await rm(paths.zip, { force: true });
  await rm(paths.html, { force: true });
}

export function isValidShareToken(token) {
  return SHARE_TOKEN_PATTERN.test(String(token || ""));
}

/** 公开下载流（无鉴权，仅凭 token） */
export async function openArchiveStream(kind, ecardId, conversationPublicId) {
  const paths = archivePaths(ecardId, conversationPublicId);
  const file = kind === "zip" ? paths.zip : paths.html;
  if (!existsSync(file)) return null;
  return { path: file, stream: (await import("node:fs")).createReadStream(file) };
}
