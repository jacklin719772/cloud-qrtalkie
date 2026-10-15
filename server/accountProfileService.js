// 賬號資料卡（vCard）與頭像：與 App 側 external-api 共用同一數據源
// - vCard 存 Flexisip 庫 vcards_storage（App 聯繫人編輯頁寫入的同一張卡）
// - 頭像存 /opt/saas/uploads/avatars（App 上傳的同一目錄與 URL 規則）
import "dotenv/config";
import * as mariadb from "mariadb";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Canvas, loadImage } from "skia-canvas";

// Flexisip AM（Laravel）庫直連池：與 index.js 的 flexisipDbPool 同源配置
const flexisipDbPool = mariadb.createPool({
  host: process.env.FLEXISIP_DB_HOST || "127.0.0.1",
  port: Number(process.env.FLEXISIP_DB_PORT || 3306),
  database: process.env.FLEXISIP_DB_NAME || "flexisip",
  user: process.env.FLEXISIP_DB_USER || "flexisip",
  password: process.env.FLEXISIP_DB_PASSWORD || "",
  connectionLimit: 3,
});

export const AVATAR_DIR = "/opt/saas/uploads/avatars";
export const AVATAR_URL_PREFIX = "https://cloud.qrtalkie.org/api/avatars/";

export function vcardEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,");
}

export function vcardUnescape(value) {
  return String(value).replace(/\\n/g, "\n").replace(/\\,/g, ",");
}

// 解析 vCard 文本：displayName(FN) / photoUrl(PHOTO) / phone(TEL) / company(ORG) / jobTitle(TITLE)
// 兼容 RFC 6350 折行：行首空格/制表符的行是上一属性的续行
export function parseVcardText(text) {
  const data = { displayName: "", photoUrl: "", phone: "", company: "", jobTitle: "" };
  if (!text) return data;
  let lastProp = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (!rawLine.length) continue;
    if (rawLine[0] === " " || rawLine[0] === "\t") {
      const cont = vcardUnescape(rawLine.slice(1));
      if (lastProp === "FN") data.displayName += cont;
      else if (lastProp === "PHOTO") data.photoUrl += cont;
      else if (lastProp === "TEL") data.phone += cont;
      else if (lastProp === "ORG") data.company += cont;
      else if (lastProp === "TITLE") data.jobTitle += cont;
      continue;
    }
    const line = rawLine.trim();
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const prop = line.slice(0, idx).toUpperCase();
    const value = vcardUnescape(line.slice(idx + 1));
    lastProp = null;
    if (prop === "FN") { data.displayName = value; lastProp = "FN"; }
    else if (prop.startsWith("PHOTO")) { data.photoUrl = value; lastProp = "PHOTO"; }
    else if (prop.startsWith("TEL") && !data.phone) { data.phone = value.replace(/^tel:/i, ""); lastProp = "TEL"; }
    else if (prop === "ORG") { data.company = value.split(";")[0]; lastProp = "ORG"; }
    else if (prop === "TITLE") { data.jobTitle = value; lastProp = "TITLE"; }
  }
  return data;
}

// 合并式序列化：只更新传入字段，其余保留；无 UID 时生成新 UUID
export function mergeVcardText(existingText, username, domain, updates) {
  const cur = parseVcardText(existingText);
  const next = {
    displayName: updates.displayName !== undefined ? updates.displayName : cur.displayName,
    photoUrl: updates.photoUrl !== undefined ? updates.photoUrl : cur.photoUrl,
    phone: updates.phone !== undefined ? updates.phone : cur.phone,
    company: updates.company !== undefined ? updates.company : cur.company,
    jobTitle: updates.jobTitle !== undefined ? updates.jobTitle : cur.jobTitle,
  };
  let uid = null;
  if (existingText) {
    const m = String(existingText).match(/^UID:(.+)$/m);
    if (m && m[1]) uid = m[1].trim();
  }
  if (!uid) uid = "urn:uuid:" + randomUUID();
  const lines = ["BEGIN:VCARD", "VERSION:4.0"];
  lines.push("FN:" + vcardEscape(next.displayName || username));
  lines.push("UID:" + uid);
  lines.push("IMPP:sip:" + username + "@" + domain);
  if (next.photoUrl) lines.push("PHOTO;VALUE=URI:" + next.photoUrl);
  if (next.phone) lines.push("TEL;VALUE=URI:tel:" + vcardEscape(next.phone));
  if (next.company) lines.push("ORG:" + vcardEscape(next.company));
  if (next.jobTitle) lines.push("TITLE:" + vcardEscape(next.jobTitle));
  lines.push("END:VCARD");
  return { text: lines.join("\n") + "\n", uuid: uid };
}

// 讀取賬號 vCard（賬號不存在返回 found:false）
export async function readAccountVcard(username, domain) {
  let connection;
  try {
    connection = await flexisipDbPool.getConnection();
    const rows = await connection.query(
      "SELECT v.vcard FROM vcards_storage v JOIN accounts a ON a.id = v.account_id WHERE a.username = ? AND a.domain = ? ORDER BY v.id ASC LIMIT 1",
      [username, domain],
    );
    return { found: true, data: parseVcardText(rows[0] ? rows[0].vcard : "") };
  } finally {
    if (connection) connection.release();
  }
}

// 合并式更新賬號 vCard（賬號不存在返回 found:false，調用方決定是否報錯）
export async function mergeAccountVcard(username, domain, updates) {
  let connection;
  try {
    connection = await flexisipDbPool.getConnection();
    const accRows = await connection.query(
      "SELECT id FROM accounts WHERE username = ? AND domain = ? LIMIT 1",
      [username, domain],
    );
    if (!accRows.length) return { found: false, data: null };
    const accountId = accRows[0].id;
    const vRows = await connection.query(
      "SELECT uuid, vcard FROM vcards_storage WHERE account_id = ? ORDER BY id ASC LIMIT 1",
      [accountId],
    );
    const merged = mergeVcardText(vRows[0] ? String(vRows[0].vcard) : "", username, domain, updates);
    if (vRows[0]) {
      await connection.query(
        "UPDATE vcards_storage SET vcard = ?, updated_at = NOW() WHERE uuid = ? AND account_id = ?",
        [merged.text, vRows[0].uuid, accountId],
      );
    } else {
      const uuidPart = merged.uuid.startsWith("urn:uuid:") ? merged.uuid.slice(9) : merged.uuid;
      await connection.query(
        "INSERT INTO vcards_storage (uuid, vcard, account_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())",
        [uuidPart, merged.text, accountId],
      );
    }
    return { found: true, data: parseVcardText(merged.text) };
  } finally {
    if (connection) connection.release();
  }
}

// 保存頭像圖片（data URL 或裸 base64）→ 壓縮（對齊 App 端 compressAvatarImage：
// 長邊 512px、JPEG q0.8，僅縮小不放大）→ 寫文件並返回 URL；格式錯誤拋 { statusCode }
const AVATAR_MAX_DIMENSION = 512;
const AVATAR_JPEG_QUALITY = 0.8;

async function compressAvatarBuffer(input) {
  try {
    const image = await loadImage(input);
    const longest = Math.max(image.width, image.height);
    if (!longest) return null;
    const scale = Math.min(1, AVATAR_MAX_DIMENSION / longest);
    const canvas = new Canvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await canvas.toBuffer("jpeg", { quality: AVATAR_JPEG_QUALITY });
    return jpeg && jpeg.length ? Buffer.from(jpeg) : null;
  } catch (error) {
    console.error("[account-avatar] compress failed, fallback to raw:", error?.message || error);
    return null;
  }
}

export async function saveAccountAvatar(sipAccount, imageBase64) {
  const raw = String(imageBase64 || "");
  if (!raw || raw.length > 10 * 1024 * 1024) {
    const err = new Error("頭像圖片缺失或過大（上限約 10MB）。");
    err.statusCode = 400;
    throw err;
  }
  const buf = Buffer.from(raw.replace(/^data:image\/[a-zA-Z]+;base64,/, ""), "base64");
  if (!buf.length) {
    const err = new Error("頭像圖片無效。");
    err.statusCode = 400;
    throw err;
  }
  let outBuf = await compressAvatarBuffer(buf);
  let ext = "jpg";
  if (!outBuf) {
    // 解碼失敗回退原圖保存（保底不丟）
    outBuf = buf;
    ext = "png";
  }
  if (!existsSync(AVATAR_DIR)) mkdirSync(AVATAR_DIR, { recursive: true });
  const fileName = sipAccount + "-" + randomBytes(12).toString("hex") + "." + ext;
  writeFileSync(path.join(AVATAR_DIR, fileName), outBuf);
  return AVATAR_URL_PREFIX + fileName;
}
