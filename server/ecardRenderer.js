// ecardRenderer.js — 服务端名片渲染
// 与 cloud 前端 EcardGeneration.jsx 的 getMergedStyle 渲染模型一致：
// 位置尺寸 ← layoutJson.fields；基础样式 ← defaultStyleJson.styles；用户覆盖 ← localStyles
import { Canvas, Image } from "skia-canvas";
import path from "node:path";

// web 字体名 → 服务器可用字体族（fonts-noto-cjk 提供）
const FONT_MAP = {
  "noto sans sc": "Noto Sans CJK SC",
  "pingfang sc": "Noto Sans CJK SC",
  "microsoft yahei": "Noto Sans CJK SC",
  simhei: "Noto Sans CJK SC",
  "sans-serif": "Noto Sans CJK SC",
  simsun: "Noto Serif CJK SC",
  kaiti: "Noto Serif CJK SC",
  serif: "Noto Serif CJK SC",
  cursive: "Noto Serif CJK SC",
  monospace: "Noto Sans Mono CJK SC",
  arial: "DejaVu Sans",
  helvetica: "DejaVu Sans",
  "times new roman": "DejaVu Serif",
};

function parseJsonMaybe(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeColor(v, fallback) {
  if (!v || typeof v !== "string") return fallback;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s) || /^rgba?\([^)]*\)$/.test(s) || /^[a-z]+$/.test(s)) return s;
  return fallback;
}

function num(v, fallback) {
  const n = Number(String(v).replace(/px/g, "").replace(/%/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function mapFont(family) {
  const key = String(family || "").toLowerCase();
  return FONT_MAP[key] || "Noto Sans CJK SC";
}

function getMergedStyle(key, layoutFields, styleFields, localStyles) {
  const layout = layoutFields[key] || {};
  const base = styleFields[key] || {};
  const style = Object.assign({}, base, localStyles[key] || {});
  const borderRadiusRaw = layout.borderRadius != null ? String(layout.borderRadius) : "";
  const borderRadiusPct = borderRadiusRaw.endsWith("%") ? parseFloat(borderRadiusRaw) / 100 : -1;
  return {
    x: num(layout.x, 0),
    y: num(layout.y, 0),
    w: num(layout.width, 0),
    h: num(layout.height, 0),
    borderRadiusPct,
    borderRadius: num(layout.borderRadius, 0),
    objectFit: layout.objectFit || "cover",
    color: safeColor(style.color, "#ffffff"),
    fontFamily: mapFont(style.fontFamily),
    fontSize: num(style.fontSize, 24),
    fontWeight: num(style.fontWeight, 400),
    textAlign: style.textAlign || "left",
    letterSpacing: num(style.letterSpacing, 0),
    lineHeight: num(style.lineHeight, 1.2),
    backgroundColor: safeColor(style.backgroundColor, ""),
    borderColor: "",
    padding: num(style.padding, 0),
  };
}

// 从 CSS 简写 border（如 "1px solid #ffffff"）提取颜色
function borderColorOf(style) {
  const border = style && style.border ? String(style.border) : "";
  const m = border.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/);
  return m ? m[0] : "";
}

async function loadImage(src) {
  if (!src) return null;
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawText(ctx, s, text) {
  if (!text) return;
  ctx.save();
  ctx.font = `${s.fontWeight} ${s.fontSize}px "${s.fontFamily}"`;
  ctx.fillStyle = s.color;
  ctx.textBaseline = "top";
  ctx.letterSpacing = `${s.letterSpacing}px`;
  const pad = s.padding;
  const maxW = Math.max(1, s.w - pad * 2);
  const lines = String(text).split("\n");
  const lineH = s.fontSize * s.lineHeight;
  let y = s.y + pad;
  for (const rawLine of lines) {
    if (y > s.y + s.h + lineH) break;
    let line = rawLine;
    if (ctx.measureText(line).width > maxW) {
      // 简单截断（与 web 的 overflow hidden 一致）
      while (line.length > 1 && ctx.measureText(line + "…").width > maxW) line = line.slice(0, -1);
      line += "…";
    }
    const tw = ctx.measureText(line).width;
    let x = s.x + pad;
    if (s.textAlign === "center") x = s.x + (s.w - tw) / 2;
    else if (s.textAlign === "right") x = s.x + s.w - pad - tw;
    ctx.fillText(line, x, y);
    y += lineH;
  }
  ctx.restore();
}

function drawImageField(ctx, s, img, fallbackText) {
  ctx.save();
  if (s.borderRadiusPct >= 0 || s.borderRadius > 0) {
    const r = s.borderRadiusPct >= 0 ? s.borderRadiusPct * Math.min(s.w, s.h) : s.borderRadius;
    roundRectPath(ctx, s.x, s.y, s.w, s.h, r);
    ctx.clip();
  }
  if (img) {
    if (s.objectFit === "cover") {
      const iw = img.width, ih = img.height;
      const scale = Math.max(s.w / iw, s.h / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(img, s.x - (dw - s.w) / 2, s.y - (dh - s.h) / 2, dw, dh);
    } else {
      ctx.drawImage(img, s.x, s.y, s.w, s.h);
    }
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(s.x, s.y, s.w, s.h);
    if (fallbackText) {
      ctx.font = `400 ${Math.min(s.w, s.h) * 0.3}px "Noto Sans CJK SC"`;
      ctx.fillStyle = "#cbd5e1";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fallbackText, s.x + s.w / 2, s.y + s.h / 2);
    }
  }
  ctx.restore();
}

function drawShape(ctx, s, borderColor) {
  ctx.save();
  if (s.backgroundColor) {
    ctx.fillStyle = s.backgroundColor;
    ctx.fillRect(s.x, s.y, s.w, s.h);
  }
  if (borderColor) {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
  }
  ctx.restore();
}

function drawIcon(ctx, s, key) {
  // 简化图标（与 web 的 lucide 图标视觉近似）：电话听筒 / 信封 / 定位点
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = Math.max(2, s.h * 0.08);
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
  const r = Math.min(s.w, s.h) * 0.38;
  ctx.beginPath();
  if (key === "phoneIcon") {
    // 电话听筒轮廓
    ctx.moveTo(cx - r * 0.7, cy - r);
    ctx.quadraticCurveTo(cx - r * 1.1, cy - r * 0.4, cx - r * 0.7, cy + r * 0.2);
    ctx.lineTo(cx + r * 0.7, cy + r * 0.2);
    ctx.quadraticCurveTo(cx + r * 1.1, cy - r * 0.4, cx + r * 0.7, cy - r);
    ctx.quadraticCurveTo(cx + r * 0.5, cy - r * 1.2, cx - r * 0.5, cy - r * 1.2);
    ctx.quadraticCurveTo(cx - r * 0.7, cy - r * 1.2, cx - r * 0.7, cy - r);
  } else if (key === "emailIcon") {
    // 信封
    ctx.rect(cx - r, cy - r * 0.7, r * 2, r * 1.4);
    ctx.moveTo(cx - r, cy - r * 0.7);
    ctx.lineTo(cx, cy + r * 0.1);
    ctx.lineTo(cx + r, cy - r * 0.7);
  } else if (key === "addressIcon") {
    // 定位点：圆 + 三角
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.2, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.4, cy + r * 0.75);
    ctx.lineTo(cx, cy + r * 1.25);
    ctx.lineTo(cx + r * 0.4, cy + r * 0.75);
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

function drawQr(ctx, s, qrImg) {
  if (!qrImg) return;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(s.x, s.y, s.w, s.h);
  const size = Math.min(s.w, s.h);
  ctx.drawImage(qrImg, s.x + (s.w - size) / 2, s.y + (s.h - size) / 2, size, size);
  ctx.restore();
}

async function renderEcard(options) {
  const {
    layoutJson, defaultStyleJson, displayConfigJson,
    cardData, localStyles, localDisplayConfig,
    avatarUrl, logoUrl, qrDataUrl, showQrCode,
    companyNameEnabled, backgroundImagePath,
  } = options;

  const canvasW = num(layoutJson && layoutJson.canvas && layoutJson.canvas.width, 1536);
  const canvasH = num(layoutJson && layoutJson.canvas && layoutJson.canvas.height, 1024);
  const canvas = new Canvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");

  // 背景
  let bgImg = null;
  if (backgroundImagePath) {
    try { bgImg = await loadImage(backgroundImagePath); } catch { bgImg = null; }
  }
  if (bgImg) {
    ctx.drawImage(bgImg, 0, 0, canvasW, canvasH);
  } else {
    const grad = ctx.createLinearGradient(0, 0, canvasW, canvasH);
    grad.addColorStop(0, "#1e1e1e");
    grad.addColorStop(1, "#111111");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  const layoutFields = (layoutJson && layoutJson.fields) || {};
  const styleFields = (defaultStyleJson && (defaultStyleJson.styles || defaultStyleJson)) || {};
  const display = displayConfigJson || {};
  const showCfg = {
    showEnJobTitle: localDisplayConfig && localDisplayConfig.showEnJobTitle !== false,
    showEnCompanyName: localDisplayConfig && localDisplayConfig.showEnCompanyName !== false,
    showQrCodeDesc: localDisplayConfig && localDisplayConfig.showQrCodeDesc !== false,
    showSlogan: localDisplayConfig && localDisplayConfig.showSlogan !== false,
  };
  const showCompany = companyNameEnabled !== false;
  const titleText = showCfg.showEnJobTitle && cardData.titleEn
    ? `${cardData.titleZh} | ${cardData.titleEn}` : cardData.titleZh;
  const addressText = cardData.zipCode ? `${cardData.address}\n${cardData.zipCode}` : cardData.address;

  function isVisible(key) {
    const uc = "show" + key.charAt(0).toUpperCase() + key.slice(1);
    if (display[uc] === false || display[key] === false) return false;
    if (!showCompany && ["companyLogo", "companyNameCn", "companyNameEn", "companyDivider", "sloganCn", "sloganEn"].includes(key)) return false;
    if (key === "companyNameEn" && !showCfg.showEnCompanyName) return false;
    if (key === "qrCaption" && !showCfg.showQrCodeDesc) return false;
    if ((key === "sloganCn" || key === "sloganEn") && !showCfg.showSlogan) return false;
    if (["qrCode", "qrFrame", "qrCenterLogo"].includes(key) && !showQrCode) return false;
    return true;
  }
  function valueFor(key) {
    if (key === "name") return cardData.name;
    if (key === "title") return titleText;
    if (key === "phone") return cardData.phone;
    if (key === "email") return cardData.email;
    if (key === "address") return addressText;
    if (key === "qrCaption") return cardData.qrDesc;
    if (key === "companyNameCn") return cardData.companyZh;
    if (key === "companyNameEn") return cardData.companyEn;
    if (key === "sloganCn") return cardData.sloganZh;
    if (key === "sloganEn") return cardData.sloganEn;
    return "";
  }

  const images = {};
  if (avatarUrl) { try { images.avatar = await loadImage(avatarUrl); } catch { images.avatar = null; } }
  if (logoUrl) { try { images.companyLogo = await loadImage(logoUrl); } catch { images.companyLogo = null; } }
  if (qrDataUrl) { try { images.qrCode = await loadImage(qrDataUrl); } catch { images.qrCode = null; } }

  for (const [key, lf] of Object.entries(layoutFields)) {
    if (!isVisible(key)) continue;
    const s = getMergedStyle(key, layoutFields, styleFields, localStyles);
    const borderColor = borderColorOf((styleFields[key] || {}));
    switch (lf.type || "text") {
      case "text":
        drawText(ctx, s, valueFor(key));
        break;
      case "image":
        drawImageField(ctx, s, images[key], key === "companyLogo" ? "LOGO" : "");
        break;
      case "shape":
        drawShape(ctx, s, borderColor);
        break;
      case "icon":
        drawIcon(ctx, s, key);
        break;
      case "qrcode":
        drawQr(ctx, s, images.qrCode);
        break;
    }
  }

  return canvas.toBuffer("png");
}

export { renderEcard };
