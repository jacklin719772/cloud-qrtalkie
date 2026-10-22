// 在线演示 AI 客服附件解析：图片直接转交多模态模型，文档提取文字
import { createRequire } from "node:module";
import path from "node:path";
import AdmZip from "adm-zip";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

export const AI_DEMO_MAX_ATTACHMENTS = 3;
export const AI_DEMO_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED = 8 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 8000;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/;
const TEXT_EXTS = new Set([".txt", ".md", ".markdown", ".csv", ".json", ".log", ".xml"]);

function decodeBase64Size(base64) {
  return Math.floor((String(base64).length * 3) / 4);
}

function extractDocxText(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("Word 文档无法解析");
  }
  const entry = zip.getEntry("word/document.xml");
  if (!entry) throw new Error("Word 文档内容缺失");
  if (entry.header.size > MAX_DOCX_UNCOMPRESSED) throw new Error("Word 文档内容过大");
  const xml = zip.readAsText(entry);
  return xml
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractFileText(name, mimeType, buffer) {
  const ext = path.extname(name || "").toLowerCase();
  if (ext === ".pdf" || mimeType === "application/pdf") {
    const data = await pdfParse(buffer);
    return String(data.text || "");
  }
  if (ext === ".docx") return extractDocxText(buffer);
  if (TEXT_EXTS.has(ext)) return buffer.toString("utf8");
  throw new Error(`暂不支持该文件类型${ext ? `（${ext}）` : ""}`);
}

export async function parseAiDemoAttachments(rawAttachments) {
  if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) return { attachments: [] };
  if (rawAttachments.length > AI_DEMO_MAX_ATTACHMENTS) {
    return { error: `最多上传 ${AI_DEMO_MAX_ATTACHMENTS} 个附件。` };
  }
  let totalBytes = 0;
  const attachments = [];
  for (const raw of rawAttachments) {
    const name = String(raw?.name || "附件").slice(0, 120);
    if (raw?.kind === "image") {
      const match = String(raw?.dataUrl || "").match(IMAGE_DATA_URL);
      if (!match) return { error: "图片格式不支持（仅支持 PNG/JPEG/WebP）。" };
      const bytes = decodeBase64Size(match[2]);
      if (bytes > MAX_IMAGE_BYTES) return { error: "图片不能超过 8MB。" };
      totalBytes += bytes;
      attachments.push({ kind: "image", name, dataUrl: raw.dataUrl });
      continue;
    }
    if (raw?.kind === "file") {
      const base64 = String(raw?.dataBase64 || "");
      if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) return { error: "文件内容无效。" };
      const bytes = decodeBase64Size(base64);
      if (bytes > MAX_FILE_BYTES) return { error: "文件不能超过 10MB。" };
      totalBytes += bytes;
      let text;
      try {
        text = await extractFileText(name, String(raw.mimeType || ""), Buffer.from(base64, "base64"));
      } catch (error) {
        return { error: `${name}：${error?.message || "文件解析失败"}` };
      }
      text = String(text || "").split(String.fromCharCode(0)).join("").trim();
      if (!text) return { error: `${name}：未提取到可读文字。` };
      attachments.push({ kind: "file", name, text: text.slice(0, MAX_EXTRACTED_CHARS) });
      continue;
    }
    return { error: "附件类型无效。" };
  }
  if (totalBytes > AI_DEMO_MAX_TOTAL_BYTES) {
    return { error: "附件总大小不能超过 15MB。" };
  }
  return { attachments };
}

export function buildAiDemoUserContent(text, attachments) {
  const images = attachments.filter((item) => item.kind === "image");
  const files = attachments.filter((item) => item.kind === "file");
  const parts = [];
  const trimmed = String(text || "").trim();
  if (trimmed) parts.push(trimmed);
  for (const file of files) {
    parts.push(`【附件：${file.name}】\n${file.text}`);
  }
  const combined = parts.join("\n\n") || "请分析我上传的内容。";
  if (images.length === 0) return combined;
  return [
    { type: "text", text: combined },
    ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
  ];
}
