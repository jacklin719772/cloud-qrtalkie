﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿import "./loadEnv.js";
// Global crash protection: prevent silent death on unhandled errors
process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
  setTimeout(function() { process.exit(1); }, 1000);
});
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught Exception:", error?.message || error);
  if (error?.stack) console.error(error.stack);
  setTimeout(function() { process.exit(1); }, 1000);
});
import express from "express";
import QRCode from "qrcode";
import { mkdir, unlink, writeFile, readFile, stat, chmod, chown } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, limePool } from "./db.js";
import { createEmailToken, createNumericCode, createSessionToken, hashPassword, hashToken, verifyPassword } from "./security.js";
import { queueLoginEmailChangeCode, queuePasswordResetEmail, queueVerificationEmail } from "./email.js";
import { startScheduler } from "./scheduler.js";
import { FlexisipTombstoneError, releaseAccountTombstone } from "./flexisipTombstoneClient.js";

function bigIntSafe(obj) { return JSON.parse(JSON.stringify(obj, (_, v) => typeof v === "bigint" ? Number(v) : v)); }
import { FlexisipAdminSessionError, getCallsStatistics } from "./flexisipAdminSessionClient.js";
import { buildFreepbxDisplayNameFormUpdate, buildWebrtcFormUpdate, FreepbxWebSessionClient } from "./freepbxWebSessionClient.js";
import { getAsteriskPathConfig, getWebrtcRuntimeConfig } from "./webrtcTemplateLoader.js";
import {
  FreepbxApiError,
  addExtension as freepbxAddExtension,
  applyConfigAndWait as freepbxApplyConfigAndWait,
  fetchExtension as freepbxFetchExtension,
  getExtensionInputSchema as freepbxGetExtensionInputSchema,
  deleteExtension as freepbxDeleteExtension,
  updateExtensionPassword as freepbxUpdateExtensionPassword,
  updateExtension as freepbxUpdateExtension,
} from "./freepbxApiClient.js";
import { verifyPjsipExtension } from "./asteriskCommandService.js";
import {
  getPjsipEndpointStatus,
  getPjsipEndpointStatusBatch,
  getPjsipEndpointConfig,
} from "./asteriskCommandService.js";
import { CelCallLogError, queryCelCallLogs } from "./celCallLogService.js";
import { getWebrtcPresence, getWebrtcPresenceBatch, startWebrtcPresencePolling } from "./webrtcPresenceService.js";
import { initGeoLookup } from "./geoLookupService.js";
import {
  FlexisipRegistrationStatusError,
  discoverAccountsFromRedis,
  getAccountRegistrationDetail,
} from "./flexisipRegistrationStatusService.js";
import { readRegistrarKeys, RedisReadOnlyError } from "./redisClient.js";
import {
  FlexisipCallLogQueryError,
  isValidIsoDateTime as isValidFlexisipCallLogIsoDateTime,
  queryFlexisipCallLogs,
} from "./flexisipCallLogQueryService.js";
import { buildFreepbxWebrtcExtensionPayloads } from "./freepbxWebrtcExtensionPayload.js";
import {
  buildExpectedGeneratedEndpointSection,
  buildFourFieldEndpointOverlay,
  buildWorkflowReport,
  compareEndpointFields,
  createWorkflowSteps,
  getEndpointComparisonFields,
  loadEndpointCustomPostBackup,
  markStepFailed,
  markStepRollback,
  markStepRunning,
  markStepSkipped,
  markStepSuccess,
  parsePjsipSection,
  parseEndpointCustomPostOverlay,
  readEndpointCustomPostOverlay,
  removeEndpointCustomPostOverlay,
  rollbackCreatedFreepbxAccount,
  restoreEndpointCustomPostFromBackup,
  sha256File,
  skipRemainingSteps,
  writeAtomicFile,
} from "./webrtcAccountWorkflow.js";
import {
  FlexisipAccountManagerError,
  searchAccountBySip,
  listAccounts as flexisipListAccounts,
  createAccount as flexisipCreateAccount,
  deleteAccount as flexisipDeleteAccount,
  getAccount as flexisipGetAccount,
  activateAccount as flexisipActivateAccount,
  deactivateAccount as flexisipDeactivateAccount,
  updateAccount as flexisipUpdateAccount,
  sendProvisioningEmail as flexisipSendProvisioningEmail,
  getAccountProvisionLink as flexisipGetProvisionLink,
  sendResetPasswordEmail as flexisipSendResetPasswordEmail,
} from "./flexisipAccountManagerClient.js";
import {
  createContactList,
  assignContactListToAccount,
  listContactLists,
  addContactToContactList,
  removeContactFromContactList,
  updateContactList,
  deleteContactList,
  unassignContactListFromAccount,
  FlexisipContactBookError,
} from "./flexisipContactBookClient.js";
import { registerPushGatewayRoutes } from "./pushGatewayService.js";
import { getOrCreateSession, getMessages, sendMessage, deleteSession } from "./aiBotService.js";
import { ensureAiAllowed, AiError } from "./aiEntitlementService.js";
import deviceMqttService from "./deviceMqttService.js";

const app = express();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = Number(process.env.API_PORT || 3001);
const appUrl = process.env.APP_URL || "http://127.0.0.1:5173";
const sipDomain = process.env.SIP_DOMAIN || "sip.qrtalkie.org";
const webrtcDomain = process.env.WEBRTC_DOMAIN || process.env.webrtc_domain || "pbx.qrtalkie.org";
const callCenterBaseUrl = process.env.CALL_CENTER_BASE_URL || appUrl;
const accessBaseUrl = process.env.ACCESS_BASE_URL || appUrl;
const couponCurrencyCodes = new Set(["TWD", "CNY", "USD", "EUR"]);
const healthInternalHost = process.env.HEALTH_INTERNAL_HOST || "127.0.0.1";
const healthSslPort = Number(process.env.HEALTH_SSL_PORT || 443);
const limeDomain = process.env.LIME_DOMAIN || "lime.qrtalkie.org";
const ftsDomain = process.env.FTS_DOMAIN || "fts.qrtalkie.org";
const accountDomain = process.env.ACCOUNT_DOMAIN || "account.qrtalkie.org";
const sslCheckDomain = process.env.SSL_CHECK_DOMAIN || "www.qrtalkie.org";
const asteriskLogDir = process.env.ASTERISK_LOG_DIR || "/var/log/asterisk";
const flexisipLogDir = process.env.FLEXISIP_LOG_DIR || "/var/opt/belledonne-communications/log/flexisip";
const aiComposeProject = process.env.AI_COMPOSE_PROJECT || "asterisk-ai-voice-agent";
const limeApacheConf = process.env.LIME_APACHE_CONF || "/etc/apache2/sites-available/lime.qrtalkie.org.conf";
const ftsApacheConf = process.env.FTS_APACHE_CONF || "/etc/apache2/sites-available/fts.qrtalkie.org.conf";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paymentProofsDir = path.join(projectRoot, "assets/payment-proofs");
const paymentMethodIconsDir = path.join(projectRoot, "assets/payment-method-icons");
const ecardImagesDir = path.join(projectRoot, "assets/ecard-images");
const callCenterImagesDir = path.join(projectRoot, "assets/call-center-images");
const ASTERISK_PATHS = (() => { try { return getAsteriskPathConfig(); } catch { return {}; } })();
const WEBRTC_RUNTIME = (() => { try { return getWebrtcRuntimeConfig(); } catch { return {}; } })();
const ECARD_CALL_SESSION_TTL_MS = 120000;

function safeSecretSummary(value) {
  const text = String(value || "").trim();
  return {
    present: Boolean(text),
    length: text.length,
    hashPrefix: text ? createHash("sha256").update(text).digest("hex").slice(0, 12) : "",
  };
}

app.use(express.json({ limit: "12mb" }));
app.use((request, response, next) => {
  const origin = request.get("origin") || request.get("referer")?.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "";
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  return next();
});
app.use("/payment-proofs", express.static(paymentProofsDir));
app.use("/payment-method-icons", express.static(paymentMethodIconsDir));
app.use("/ecard-images", express.static(ecardImagesDir));
app.use("/call-center-images", express.static(callCenterImagesDir));

// 为前端 Vite Proxy 代理提供支持，挂载带 /api 前缀的静态资源路径
app.use("/api/payment-proofs", express.static(paymentProofsDir));
app.use("/api/payment-method-icons", express.static(paymentMethodIconsDir));
app.use("/api/ecard-images", express.static(ecardImagesDir));
app.use("/api/call-center-images", express.static(callCenterImagesDir));
app.use("/visitor-assets", express.static(path.join(projectRoot, "public/visitor")));
app.use("/privacy-terms", express.static(path.join(projectRoot, "public/privacy-terms")));
app.use("/download", express.static(path.join(projectRoot, "public/download")));
registerPushGatewayRoutes(app, { requireAdmin });

// Serve JsSIP UMD bundle for visitor pages
app.get("/visitor-assets/jssip.min.js", (_req, res) => {
  res.sendFile(path.join(projectRoot, "node_modules/jssip/dist/jssip.min.js"));
});

// POST /api/access/room-call-session - 門禁房間語音/視頻呼叫會話
app.post("/api/access/room-call-session", async (request, response) => {
  const roomId = Number(request.body?.roomId);
  const lockId = sanitizeString(String(request.body?.lockId || ''), 120);
  if (!roomId || !lockId) return response.status(400).json({ success: false, message: "缺少引數" });

  const voiceEnabled = String(process.env.ECARD_ASTERISK_WEBRTC_ENABLE_VOICE_CALL || "").toLowerCase() === "true";
  const videoEnabled = String(process.env.ECARD_ASTERISK_WEBRTC_ENABLE_VIDEO_CALL || "").toLowerCase() === "true";
  if (!voiceEnabled && !videoEnabled) return response.status(403).json({ success: false, message: "通話功能未啟用" });

  const wssUrl = String(process.env.ECARD_ASTERISK_WEBRTC_WSS_URL || "").trim();
  const sharedPassword = String(process.env.ECARD_ASTERISK_WEBRTC_SHARED_PASSWORD || "").trim();
  const webrtcDomainValue = String(process.env.ECARD_ASTERISK_WEBRTC_DOMAIN || webrtcDomain || "").trim();
  const sipDomainValue = String(process.env.ECARD_FLEXISIP_SIP_DOMAIN || sipDomain || "").trim();
  const sipServerPublicIp = String(process.env.ECARD_ASTERISK_WEBRTC_SIP_SERVER_PUBLIC_IP || "").trim();

  if (!wssUrl || !sharedPassword || !webrtcDomainValue || !sipDomainValue) {
    return response.status(500).json({ success: false, message: "呼叫服務未配置" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // Verify device exists
    const [device] = await connection.query("SELECT id, tenant_id FROM gate_devices WHERE device_uuid = ? LIMIT 1", [lockId]);
    if (!device) return response.status(404).json({ success: false, message: "裝置不存在" });

    // Get room with SIP account
    const [room] = await connection.query(
      `SELECT r.id, r.room_number, r.tenant_id, s.username AS sip_account
       FROM access_rooms r
       LEFT JOIN sip_users s ON s.id = r.sip_user_id
       WHERE r.id = ? AND r.tenant_id = ? LIMIT 1`,
      [roomId, device.tenant_id]
    );
    if (!room || !room.sip_account) return response.status(404).json({ success: false, message: "該房間未配置SIP帳號" });

    // Get web account for this SIP user
    const [webRow] = await connection.query(
      `SELECT wu.username FROM tenant_web_account_entitlements ent
       JOIN web_users wu ON wu.id = ent.web_user_id
       WHERE ent.sip_user_id = (SELECT id FROM sip_users WHERE username = ? AND tenant_id = ? LIMIT 1)
         AND ent.tenant_id = ? AND ent.status = 'active' LIMIT 1`,
      [room.sip_account, room.tenant_id, room.tenant_id]
    );

    const webAccount = webRow?.username || `guest_${room.sip_account}`;
    const targetSipUri = `sip:${room.sip_account}@${sipDomainValue}`;
    const iceServers = parseEcardIceServers();

    // Check SIP registration status
    let sipOnline = false;
    try {
      const redisKey = `fs:${room.sip_account}@${sipDomainValue}`;
      const redisResult = await readRegistrarKeys([redisKey]);
      const regData = redisResult.get(redisKey);
      if (regData && regData.type === "hash" && regData.ttl !== -2) {
        sipOnline = (regData.entries || []).length > 0;
      }
    } catch {}

    return response.json({
      success: true,
      data: {
        webAccount,
        credential: { type: "shared-password", value: sharedPassword },
        webrtcDomain: webrtcDomainValue,
        wssUrl,
        targetSipUri,
        sipDomain: sipDomainValue,
        iceServers,
        sipServerPublicIp,
        enableVoice: voiceEnabled,
        enableVideo: videoEnabled,
        roomNumber: room.room_number,
        sipOnline,
        sipAccount: room.sip_account,
      },
    });
  } catch (error) {
    console.error("Room call session failed:", error);
    return response.status(500).json({ success: false, message: "系統繁忙" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/access/room-sip-status - 查詢房間 SIP 在線狀態
app.get("/api/access/room-sip-status", async (request, response) => {
  const roomId = Number(request.query.roomId);
  const lockId = sanitizeString(String(request.query.lockId || ''), 120);
  if (!roomId || !lockId) return response.status(400).json({ success: false });

  const sipDomainValue = String(process.env.ECARD_FLEXISIP_SIP_DOMAIN || sipDomain || "").trim();

  let connection;
  try {
    connection = await pool.getConnection();
    const [device] = await connection.query("SELECT id, tenant_id FROM gate_devices WHERE device_uuid = ? LIMIT 1", [lockId]);
    if (!device) return response.status(404).json({ success: false, message: "裝置不存在" });

    const [room] = await connection.query(
      `SELECT s.username AS sip_account FROM access_rooms r
       LEFT JOIN sip_users s ON s.id = r.sip_user_id
       WHERE r.id = ? AND r.tenant_id = ? LIMIT 1`,
      [roomId, device.tenant_id]
    );
    if (!room?.sip_account) return response.status(404).json({ success: false, message: "SIP帳號未配置" });

    let sipOnline = false;
    try {
      const redisKey = `fs:${room.sip_account}@${sipDomainValue}`;
      const redisResult = await readRegistrarKeys([redisKey]);
      const regData = redisResult.get(redisKey);
      if (regData && regData.type === "hash" && regData.ttl !== -2) {
        sipOnline = (regData.entries || []).length > 0;
      }
    } catch {}

    return response.json({ success: true, data: { sipOnline } });
  } catch (error) {
    return response.status(500).json({ success: false, message: "查詢失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /access/visitor - 門禁入口訪客拜訪頁面（type=01社區/02樓宇 & lockId=設備UUID）
app.get("/access/visitor", async (request, response) => {
  const entranceType = request.query.type || '';
  const lockId = sanitizeString(String(request.query.lockId || ''), 120);
  if (!lockId || !['01','02'].includes(entranceType)) {
    return response.status(400).send("<h2 style='text-align:center;margin-top:20vh;'>400 Bad Request</h2><p style='text-align:center;'>無效的訪問連結。</p>");
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // Find entrance by device_uuid via gate_devices
    const [device] = await connection.query(
      "SELECT id, tenant_id FROM gate_devices WHERE device_uuid = ? LIMIT 1",
      [lockId]
    );
    if (!device) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>裝置不存在。</p>");
    }

    // Find entrance bound to this device
    const entranceId = Number(request.query.entrance) || 0;
    let entrance;
    if (entranceId) {
      [entrance] = await connection.query(
        "SELECT id, name, community_id, building_id FROM access_entrances WHERE id = ? AND device_id = ? AND tenant_id = ?",
        [entranceId, device.id, device.tenant_id]
      );
    } else {
      [entrance] = await connection.query(
        "SELECT id, name, community_id, building_id FROM access_entrances WHERE device_id = ? AND tenant_id = ? LIMIT 1",
        [device.id, device.tenant_id]
      );
    }
    if (!entrance) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>該裝置尚未繫結入口。</p>");
    }

    // Get community from entrance
    let communityId = null;
    if (entrance.community_id) {
      communityId = entrance.community_id;
    } else if (entrance.building_id) {
      const [bld] = await connection.query("SELECT community_id FROM access_buildings WHERE id = ?", [entrance.building_id]);
      if (bld) communityId = bld.community_id;
    }
    if (!communityId) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>所屬社群不存在。</p>");
    }

    const [community] = await connection.query(
      `SELECT id, tenant_id, name, address, slug, contact_person, contact_phone,
              logo_url, banner_url, visitor_title, show_tips, tips_text
       FROM access_communities WHERE id = ? AND is_active = 1 LIMIT 1`,
      [communityId]
    );
    if (!community) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>該社群不存在或已停用。</p>");
    }

    // Get authorized rooms for this entrance
    const authRows = await connection.query(
      "SELECT room_id FROM access_room_entrance_auth WHERE entrance_id = ? AND tenant_id = ?",
      [entrance.id, community.tenant_id]
    );
    const authorizedRoomIds = new Set(authRows.map(r => Number(r.room_id)));

    const buildings = await connection.query(
      "SELECT b.id, b.name FROM access_buildings b WHERE b.community_id = ? AND b.tenant_id = ? ORDER BY b.name",
      [community.id, community.tenant_id]
    );
    const bIds = buildings.map(b => b.id);
    let rooms = [];
    if (bIds.length > 0) {
      rooms = await connection.query(
        `SELECT r.id, r.building_id, r.room_number, r.floor, r.allow_video_call,
                COALESCE(s.display_name, s.username, '') AS resident_name,
                s.username AS sip_username,
                wu.username AS web_username
         FROM access_rooms r
         LEFT JOIN sip_users s ON s.id = r.sip_user_id
         LEFT JOIN tenant_web_account_entitlements ent ON ent.sip_user_id = s.id AND ent.tenant_id = r.tenant_id AND ent.status = 'active'
         LEFT JOIN web_users wu ON wu.id = ent.web_user_id
         WHERE r.building_id IN (?) AND r.tenant_id = ? ORDER BY r.room_number`,
        [bIds, community.tenant_id]
      );
    }

    // Filter to authorized rooms only
    rooms = rooms.filter(r => authorizedRoomIds.has(Number(r.id)));
    const bldWithRooms = new Set(rooms.map(r => Number(r.building_id)));
    buildings.splice(0, buildings.length, ...buildings.filter(b => bldWithRooms.has(Number(b.id))));

    const [tenant] = await connection.query("SELECT name FROM tenants WHERE id = ?", [community.tenant_id]);
    const tenantName = tenant?.name || '';

    const data = {
      name: (community.visitor_title || community.name) + '訪客服務平臺',
      tenantName: tenantName,
      communityName: community.name,
      address: community.address || '',
      logoUrl: community.logo_url || '',
      bannerUrl: community.banner_url || '',
      showTips: community.show_tips == null ? true : !!community.show_tips,
      tipsText: community.tips_text || '溫馨提示：如遇門禁問題或需要幫助，請聯絡對應樓宇或房間服務人員。',
      buildings: buildings.map(b => ({ id: Number(b.id), name: b.name })),
      rooms: rooms.map(r => ({
        id: Number(r.id), buildingId: Number(r.building_id),
        roomNumber: r.room_number, floor: r.floor || null,
        residentName: r.resident_name || null,
        sipAccount: r.sip_username || null,
        displayName: r.resident_name || null,
        allowVideoCall: r.allow_video_call == null ? true : !!r.allow_video_call,
      })),
      sipAccounts: rooms.filter(r => r.sip_username).map(r => ({
        roomNumber: r.room_number,
        sipAccount: r.sip_username || '',
        webAccount: r.web_username || '',
        displayName: r.resident_name || '',
      })),
    };

    const templatePath = path.resolve(projectRoot, "public/visitor/access-platform.html");
    let html = await readFile(templatePath, "utf-8");
    html = html.replace("url('banner.png')", data.bannerUrl ? `url('${data.bannerUrl}')` : "url('/visitor-assets/banner.png')");
    html = html.replace('</head>', `<script>window.__ACCESS_DATA__ = ${JSON.stringify(data)};</script>\n</head>`);

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.send(html);
  } catch (error) {
    console.error("Failed to render visitor page:", error);
    return response.status(500).send("<h2 style='text-align:center;margin-top:20vh;'>500 Error</h2><p style='text-align:center;'>系統繁忙，請稍後再試。</p>");
  } finally {
    if (connection) connection.release();
  }
});

// GET /access/:slug - 門禁訪客拜訪頁面
app.get("/access/:slug", async (request, response) => {
  const slug = sanitizeString(request.params.slug, 100);
  if (!slug) return response.status(400).send("Invalid access URL.");

  const entranceId = Number(request.query.entrance) || 0;

  let connection;
  try {
    connection = await pool.getConnection();
    const [community] = await connection.query(
      `SELECT id, tenant_id, name, address, slug, contact_person, contact_phone,
              logo_url, banner_url, visitor_title, show_tips, tips_text
       FROM access_communities WHERE slug = ? AND is_active = 1 LIMIT 1`,
      [slug]
    );
    if (!community) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>該社群不存在或已停用。</p>");
    }

    // If entrance-specific access, get authorized room IDs
    let authorizedRoomIds = null;
    if (entranceId) {
      const authRows = await connection.query(
        "SELECT room_id FROM access_room_entrance_auth WHERE entrance_id = ? AND tenant_id = ?",
        [entranceId, community.tenant_id]
      );
      authorizedRoomIds = new Set(authRows.map(r => Number(r.room_id)));
    }

    const buildings = await connection.query(
      `SELECT b.id, b.name FROM access_buildings b WHERE b.community_id = ? AND b.tenant_id = ? ORDER BY b.name`,
      [community.id, community.tenant_id]
    );
    const bIds = buildings.map(b => b.id);
    let rooms = [];
    if (bIds.length > 0) {
      rooms = await connection.query(
        `SELECT r.id, r.building_id, r.room_number, r.floor, r.allow_video_call,
                COALESCE(s.display_name, s.username, '') AS resident_name,
                s.username AS sip_username,
                wu.username AS web_username
         FROM access_rooms r
         LEFT JOIN sip_users s ON s.id = r.sip_user_id
         LEFT JOIN tenant_web_account_entitlements ent ON ent.sip_user_id = s.id AND ent.tenant_id = r.tenant_id AND ent.status = 'active'
         LEFT JOIN web_users wu ON wu.id = ent.web_user_id
         WHERE r.building_id IN (?) AND r.tenant_id = ? ORDER BY r.room_number`,
        [bIds, community.tenant_id]
      );
    }

    // Filter by authorized rooms if entrance-specific
    if (authorizedRoomIds) {
      rooms = rooms.filter(r => authorizedRoomIds.has(Number(r.id)));
      // Only keep buildings that have authorized rooms
      const bldWithRooms = new Set(rooms.map(r => Number(r.building_id)));
      buildings.splice(0, buildings.length, ...buildings.filter(b => bldWithRooms.has(Number(b.id))));
    }

    const [tenant] = await connection.query('SELECT name FROM tenants WHERE id = ?', [community.tenant_id]);
    const tenantName = tenant?.name || '';

    const data = {
      name: (community.visitor_title || community.name) + '訪客服務平臺',
      tenantName: tenantName,
      communityName: community.name,
      address: community.address || '',
      logoUrl: community.logo_url || '',
      bannerUrl: community.banner_url || '',
      showTips: community.show_tips == null ? true : !!community.show_tips,
      tipsText: community.tips_text || '溫馨提示：如遇門禁問題或需要幫助，請聯絡對應樓宇或房間服務人員。',
      buildings: buildings.map(b => ({ id: Number(b.id), name: b.name })),
      rooms: rooms.map(r => ({
        id: Number(r.id), buildingId: Number(r.building_id),
        roomNumber: r.room_number, floor: r.floor || null,
        residentName: r.resident_name || null,
        sipAccount: r.sip_username || null,
        displayName: r.resident_name || null,
        allowVideoCall: r.allow_video_call == null ? true : !!r.allow_video_call,
      })),
      sipAccounts: rooms.filter(r => r.sip_username).map(r => ({
        roomNumber: r.room_number,
        sipAccount: r.sip_username || '',
        webAccount: r.web_username || '',
        displayName: r.resident_name || '',
      })),
    };

    const templatePath = path.resolve(projectRoot, "public/visitor/access-platform.html");
    let html = await readFile(templatePath, "utf-8");
    html = html.replace('</head>', `<script>window.__ACCESS_DATA__ = ${JSON.stringify(data)};</script>\n</head>`);

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.send(html);
  } catch (error) {
    console.error("Failed to render access visitor page:", error);
    return response.status(500).send("<h2 style='text-align:center;margin-top:20vh;'>500 Error</h2>");
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sanitizeString(value, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function parseNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseVersionCode(version) {
  // 从 "v10.0.1+0a31c27" 或 "10.0.2" 中提取主次修订号，计算可比整数
  const cleaned = String(version || "").replace(/^v/i, "").replace(/\+.*$/, "");
  const parts = cleaned.split(".");
  let code = 0;
  for (let i = 0; i < 3; i++) {
    code = code * 1000 + (parseInt(parts[i], 10) || 0);
  }
  return code;
}

async function removePaymentProofFile(proofUrl) {
  if (!proofUrl || !String(proofUrl).startsWith("/payment-proofs/")) return;
  const fileName = path.basename(String(proofUrl));
  const filePath = path.resolve(paymentProofsDir, fileName);
  const proofDir = path.resolve(paymentProofsDir);
  if (!filePath.startsWith(`${proofDir}${path.sep}`)) return;
  await unlink(filePath).catch((error) => {
    if (error?.code !== "ENOENT") console.warn("Failed to delete payment proof file:", error);
  });
}

function generateMethodCode(displayName, takenCodes = new Set()) {
  let candidate = String(displayName || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^-+|-+$/g, "");

  if (!candidate) candidate = "payment-method";
  if (!/^[a-z0-9]/.test(candidate)) candidate = `m-${candidate}`;
  candidate = candidate.slice(0, 80);
  if (candidate.length < 2) candidate = candidate.padEnd(2, "0");

  let suffix = 0;
  let generated = candidate;
  while (takenCodes.has(generated)) {
    suffix += 1;
    const suffixText = `-${suffix}`;
    generated = `${candidate.slice(0, 80 - suffixText.length)}${suffixText}`;
  }

  return generated;
}

function generateGateDeviceUuid() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = Buffer.from(randomUUID().replace(/-/g, ""), "hex");
  let generated = "";
  for (let index = 0; generated.length < 19; index += 1) {
    generated += alphabet[bytes[index % bytes.length] % alphabet.length];
  }
  return generated;
}

async function savePaymentMethodIcon(dataUrl, methodCode) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return "";

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 512 * 1024) {
    const error = new Error("鍦栨妾旀涓嶅彲瓚呴亷 512KB銆?");
    error.statusCode = 400;
    throw error;
  }

  if (mimeType === "image/svg+xml") {
    const svgText = buffer.toString("utf8");
    if (/<script[\s>]/i.test(svgText) || /\son[a-z]+\s*=/i.test(svgText) || /javascript:/i.test(svgText)) {
      const error = new Error("SVG 鍦栨鍖呭惈涓嶅畨鍏ㄥ収瀹癸紝璜嬫洿鎻涙獢妗堛€?");
      error.statusCode = 400;
      throw error;
    }
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/svg+xml" ? "svg" : mimeType.split("/")[1];
  const safeCode = String(methodCode || "payment-method")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "payment-method";
  await mkdir(paymentMethodIconsDir, { recursive: true });
  const filename = `${safeCode}-${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(paymentMethodIconsDir, filename), buffer);
  return `/payment-method-icons/${filename}`;
}

async function saveEcardImage(dataUrl, originalFileName) {
  const match = String(dataUrl || "").trim().match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("無效的圖片格式");

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) {
    const error = new Error("圖片不可超過 5MB。");
    error.statusCode = 400;
    throw error;
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  await mkdir(ecardImagesDir, { recursive: true });
  const filename = `ecard-${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(ecardImagesDir, filename), buffer);
  return `/ecard-images/${filename}`;
}

async function saveCallCenterImage(dataUrl, originalFileName) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|jpg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("無效的圖片格式");

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) {
    const error = new Error("圖片不可超過 5MB。");
    error.statusCode = 400;
    throw error;
  }

  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/svg+xml" ? "svg" : mimeType.split("/")[1];
  await mkdir(callCenterImagesDir, { recursive: true });
  const filename = `cc-${Date.now()}-${randomUUID()}.${extension}`;
  await writeFile(path.join(callCenterImagesDir, filename), buffer);
  return `/call-center-images/${filename}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  if (String(password || "").length < 8) return "密碼至少需要 8 位字元。";
  return "";
}

function parsePermissions(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function requireAdmin(request, response, next) {
  const token = getBearerToken(request);
  if (!token) return response.status(401).json({ message: "請重新登入。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         s.id AS session_id, s.expires_at, s.user_type, s.sip_user_id,
         a.id AS admin_id, a.tenant_id, a.account_type, a.email, a.display_name, a.nickname, a.phone_number,
         a.role, a.platform_role, a.permissions_json, a.status
       FROM admin_sessions s
       LEFT JOIN admin_users a ON a.id = s.admin_user_id AND s.user_type = 'admin'
       WHERE s.token_hash = ?
       LIMIT 1`,
      [hashToken(token)],
    );

    const session = rows[0];
    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      return response.status(401).json({ message: "請重新登入。" });
    }

    if (session.user_type === "sip" && session.sip_user_id) {
      const sipRows = await connection.query(
        `SELECT u.id, u.username, u.tenant_id, u.display_name, u.email, u.phone_number, u.status,
                e.status AS entitlement_status, e.service_expires_at
         FROM sip_users u
         INNER JOIN tenant_sip_account_entitlements e
           ON e.sip_user_id = u.id AND e.tenant_id = u.tenant_id AND e.status = 'active'
         WHERE u.id = ? AND u.status = 'active'
         LIMIT 1`,
        [Number(session.sip_user_id)],
      );
      const sipUser = sipRows[0];
      if (!sipUser) {
        return response.status(401).json({ message: "帳號已失效，請重新登入。" });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const expiresAt = sipUser.service_expires_at ? new Date(sipUser.service_expires_at) : null;
      if (!expiresAt || expiresAt < today) {
        return response.status(403).json({ message: "此帳號的服務已過期，請聯絡管理員續訂。" });
      }

      request.admin = {
        id: Number(sipUser.id),
        tenantId: Number(sipUser.tenant_id),
        accountType: "sip_user",
        email: sipUser.email || sipUser.username,
        displayName: sipUser.display_name || sipUser.username,
        nickname: sipUser.display_name || "",
        phoneNumber: sipUser.phone_number || "",
        role: "",
        platformRole: "",
        permissions: {},
        username: sipUser.username,
      };
      return next();
    }

    if (!session.admin_id || session.admin_id === 0) {
      return response.status(401).json({ message: "請重新登入。" });
    }

    if (session.status !== 'active') {
      return response.status(401).json({ message: "請重新登入。" });
    }

    request.admin = {
      id: Number(session.admin_id),
      tenantId: session.tenant_id == null ? null : Number(session.tenant_id),
      accountType: session.account_type || "tenant",
      email: session.email,
      displayName: session.display_name || "",
      nickname: session.nickname || "",
      phoneNumber: session.phone_number || "",
      role: session.role || "",
      platformRole: session.platform_role || "",
      permissions: parsePermissions(session.permissions_json),
    };
    return next();
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "身份驗證失敗。" });
  } finally {
    if (connection) connection.release();
  }
}
async function requireSipUser(request, response, next) {
  const token = getBearerToken(request);
  if (!token) return response.status(401).json({ message: "Please login again." });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      "SELECT s.id AS session_id, s.expires_at, s.user_type, s.sip_user_id FROM admin_sessions s WHERE s.token_hash = ? LIMIT 1",
      [hashToken(token)],
    );

    const session = rows[0];
    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      return response.status(401).json({ message: "Session expired." });
    }

    if (session.user_type !== "admin" && session.user_type !== "sip") {
      return response.status(403).json({ message: "Access denied." });
    }

    request.admin = { id: session.sip_user_id };
    // Sliding expiration: extend session expiry on each API call
    connection.query(
      "UPDATE admin_sessions SET expires_at = DATE_ADD(NOW(), INTERVAL 12 HOUR) WHERE id = ?",
      [session.session_id],
    ).catch(() => {}); // fire-and-forget, don't block the request
    next();
  } catch (error) {
    console.error("[requireSipUser] error:", error?.message || error);
    return response.status(500).json({ message: "Auth verification failed." });
  } finally {
    if (connection) connection.release();
  }
}
// ==========================================
// Notification sync for ALL user types
// ==========================================

// Sync tenant admin notifications (order-related)
async function syncTenantNotifications(connection, admin) {
  if (!admin?.tenantId) return;
  const tenantId = admin.tenantId;
  const adminId = admin.id;

  // no_plan_purchased — only trigger when no valid (review_approved + not expired) orders
  const [orderCountRow] = await connection.query("SELECT COUNT(*) AS total FROM billing_orders WHERE tenant_id = ? AND order_status = 'review_approved' AND expires_at > CURDATE()", [tenantId]);
  const orderCount = Number(orderCountRow?.total || 0);
  const noPlanKey = `tenant:${tenantId}:no_plan_purchased`;
  if (orderCount === 0) {
    await connection.query(
      "INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'tenant', ?, 'no_plan_purchased', 'system', ?, '請購買套餐', '當前帳號尚未訂購任何套餐，請在【我的套餐】中購買套餐。', 'warning', 'active', 'domain') ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [tenantId, tenantId, noPlanKey]
    );
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND dedupe_key=? AND status='active'", [tenantId, noPlanKey]);
  }

  // payment_required
  const unpaidRows = await connection.query("SELECT id, order_no FROM billing_orders WHERE tenant_id=? AND payment_status<>'paid' AND order_status NOT IN ('cancelled','review_rejected') ORDER BY created_at DESC", [tenantId]);
  const unpaidKeys = [];
  for (const o of unpaidRows) {
    const key = `order:${o.id}:payment_required`;
    unpaidKeys.push(key);
    await connection.query("INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'billing_order', ?, 'payment_required', 'system', ?, '訂單待支付', ?, 'warning', 'active', 'domain') ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [tenantId, o.id, key, `訂單 ${o.order_no || o.id} 尚未完成支付，請在"我的套餐"中處理。`]
    );
  }
  if (unpaidKeys.length > 0) {
    await connection.query(`UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND event_type='payment_required' AND status='active' AND dedupe_key NOT IN (${unpaidKeys.map(() => "?").join(",")})`, [tenantId, ...unpaidKeys]);
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND event_type='payment_required' AND status='active'", [tenantId]);
  }

  // review_submission_required
  const paidUnsubmitted = await connection.query("SELECT id, order_no FROM billing_orders WHERE tenant_id=? AND payment_status='paid' AND order_status='payment_submitted' ORDER BY created_at DESC", [tenantId]);
  const puKeys = [];
  for (const o of paidUnsubmitted) {
    const key = `order:${o.id}:review_submission_required`;
    puKeys.push(key);
    await connection.query("INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'billing_order', ?, 'review_submission_required', 'system', ?, '訂單待提交審核', ?, 'warning', 'active', 'domain') ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [tenantId, o.id, key, `訂單 ${o.order_no || o.id} 已支付，請提交審核。`]
    );
  }
  if (puKeys.length > 0) {
    await connection.query(`UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND event_type='review_submission_required' AND status='active' AND dedupe_key NOT IN (${puKeys.map(() => "?").join(",")})`, [tenantId, ...puKeys]);
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE tenant_id=? AND event_type='review_submission_required' AND status='active'", [tenantId]);
  }

  // Ensure receipts exist for all tenant admin users
  const tenantAdmins = await connection.query("SELECT id FROM admin_users WHERE tenant_id=? AND account_type='tenant' AND status='active'", [tenantId]);
  const activeEvents = await connection.query("SELECT id FROM notification_events WHERE tenant_id=? AND status='active'", [tenantId]);
  for (const ev of activeEvents) {
    for (const ad of tenantAdmins) {
      await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [ev.id, ad.id]);
    }
  }
}

// Sync platform admin notifications
async function syncPlatformNotifications(connection) {
  // pending_review orders (tenant submitted, platform needs to review)
  const pendingReviewRows = await connection.query("SELECT o.id, o.order_no, o.tenant_id, t.name AS tenant_name FROM billing_orders o JOIN tenants t ON t.id = o.tenant_id WHERE o.order_status='pending_review' ORDER BY o.created_at DESC");
  const prKeys = [];
  for (const o of pendingReviewRows) {
    const key = `platform:order:${o.id}:pending_review`;
    prKeys.push(key);
    await connection.query("INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'billing_order', ?, 'order_pending_review', 'tenant_admin', ?, '訂單待審核', ?, 'warning', 'active', NULL) ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [o.tenant_id, o.id, key, `租戶 ${o.tenant_name} 的訂單 ${o.order_no || o.id} 已提交稽核。`]
    );
  }
  if (prKeys.length > 0) {
    await connection.query(`UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE event_type='order_pending_review' AND status='active' AND dedupe_key NOT IN (${prKeys.map(() => "?").join(",")})`, [...prKeys]);
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE event_type='order_pending_review' AND status='active'");
  }

  // Payment proof uploaded (needs platform verification)
  const proofUploadedRows = await connection.query("SELECT o.id, o.order_no, o.tenant_id, t.name AS tenant_name FROM billing_orders o JOIN tenants t ON t.id = o.tenant_id WHERE o.payment_status='paid' AND o.order_status='payment_submitted' AND o.payment_method='offline' ORDER BY o.created_at DESC");
  const ppKeys = [];
  for (const o of proofUploadedRows) {
    const key = `platform:order:${o.id}:proof_uploaded`;
    ppKeys.push(key);
    await connection.query("INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, dedupe_key, title, body, severity, status, target_view) VALUES (?, 'billing_order', ?, 'proof_uploaded', 'tenant_admin', ?, '付款憑證已上傳', ?, 'info', 'active', NULL) ON DUPLICATE KEY UPDATE title=VALUES(title), body=VALUES(body), status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
      [o.tenant_id, o.id, key, `租戶 ${o.tenant_name} 的訂單 ${o.order_no || o.id} 已上傳付款憑證，請審核。`]
    );
  }
  if (ppKeys.length > 0) {
    await connection.query(`UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE event_type='proof_uploaded' AND status='active' AND dedupe_key NOT IN (${ppKeys.map(() => "?").join(",")})`, [...ppKeys]);
  } else {
    await connection.query("UPDATE notification_events SET status='resolved', resolved_at=COALESCE(resolved_at, CURRENT_TIMESTAMP) WHERE event_type='proof_uploaded' AND status='active'");
  }

  // Ensure receipts for all platform admins
  const platformAdmins = await connection.query("SELECT id FROM admin_users WHERE account_type='platform' AND status='active'");
  const activePlatformEvents = await connection.query("SELECT id FROM notification_events WHERE event_type IN ('order_pending_review','proof_uploaded') AND status='active'");
  for (const ev of activePlatformEvents) {
    for (const ad of platformAdmins) {
      await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [ev.id, ad.id]);
    }
  }
}

// Unified sync function
async function syncNotificationEvents(connection, admin) {
  if (!admin) return;
  if (admin.accountType === 'tenant') {
    await syncTenantNotifications(connection, admin);
  }
  if (admin.accountType === 'platform') {
    await syncPlatformNotifications(connection);
  }
}


function validateRegistration(payload) {
  const companyName = String(payload.companyName || "").trim();
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || "");
  const confirmPassword = String(payload.confirmPassword || "");

  if (!companyName) return { error: "請輸入公司名稱。" };
  if (!email || !email.includes("@")) return { error: "請輸入有效的電子郵件。" };
  if (password.length < 8) return { error: "密碼至少需要 8 位字元。" };
  if (password !== confirmPassword) return { error: "兩次輸入的密碼不一致。" };

  return { companyName, email, password };
}

app.post("/api/auth/register", async (request, response) => {
  const validated = validateRegistration(request.body);
  if (validated.error) {
    return response.status(400).json({ message: validated.error });
  }

  const { companyName, email, password } = validated;
  let connection;

  try {
    connection = await pool.getConnection();

    const existingUsers = await connection.query(
      `SELECT id, status FROM admin_users WHERE email = ? LIMIT 1`,
      [email],
    );
    if (existingUsers.length > 0) {
      const existing = existingUsers[0];
      if (existing.status === 'active') {
        return response.status(409).json({ message: "此電子郵件已被註冊，請直接登入。" });
      }
      // 未验证状态：返回特殊代码，前端引导用户重发验证邮件
      return response.status(409).json({
        message: "此電子郵件已註冊但尚未驗證，是否重新傳送驗證郵件？",
        code: "EMAIL_UNVERIFIED",
        email,
      });
    }

    await connection.beginTransaction();

    const tenantResult = await connection.query(
      `INSERT INTO tenants (name, sip_domain, contact_email, enterprise_email, plan_code, user_limit)
       VALUES (?, ?, ?, ?, 'starter', 100)`,
      [companyName, sipDomain, email, email],
    );
    const tenantId = Number(tenantResult.insertId);
    await connection.query(
      `UPDATE tenants
       SET tenant_number = ?
       WHERE id = ?`,
      [`TENANT-${String(tenantId).padStart(6, "0")}`, tenantId],
    );

    const passwordHash = await hashPassword(password);
    const adminResult = await connection.query(
      `INSERT INTO admin_users (tenant_id, email, password_hash, display_name, role, status)
       VALUES (?, ?, ?, ?, 'owner', 'disabled')`,
      [tenantId, email, passwordHash, companyName],
    );

    const { token, tokenHash } = createEmailToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await connection.query(
      `INSERT INTO email_verification_tokens (admin_user_id, token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [Number(adminResult.insertId), tokenHash, expiresAt],
    );

    const verificationUrl = `${appUrl}/?verifyEmailToken=${encodeURIComponent(token)}`;
    await queueVerificationEmail(connection, { email, verificationUrl });

    await connection.commit();

    return response.status(201).json({
      message: "註冊成功，請前往電子郵件完成驗證。",
      devVerificationUrl: verificationUrl,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "註冊失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/login", async (request, response) => {
  const username = (request.body.username || request.body.email || "").trim();
  const password = String(request.body.password || "");

  if (!username || !password) {
    return response.status(400).json({ message: "請輸入有效的登入帳號和密碼。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    if (isValidEmail(username)) {
      const adminRows = await connection.query(
        `SELECT id, tenant_id, account_type, email, password_hash, role, platform_role, permissions_json, status
         FROM admin_users
         WHERE email = ?
         LIMIT 1`,
        [normalizeEmail(username)],
      );
      const admin = adminRows[0];

      if (admin && (await verifyPassword(password, admin.password_hash))) {
        if (admin.status !== 'active') {
          return response.status(403).json({ message: "此管理員帳號尚未啟用。" });
        }

        const { token, tokenHash } = createSessionToken();
        const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

        await connection.query(
          `INSERT INTO admin_sessions (admin_user_id, user_type, token_hash, expires_at)
           VALUES (?, 'admin', ?, ?)`,
          [Number(admin.id), tokenHash, expiresAt],
        );
        await connection.query(`UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, [Number(admin.id)]);

        return response.json({
          token,
          userType: "admin",
          admin: {
            id: Number(admin.id),
            tenantId: admin.tenant_id == null ? null : Number(admin.tenant_id),
            accountType: admin.account_type || "tenant",
            role: admin.role || "",
            platformRole: admin.platform_role || "",
            permissions: parsePermissions(admin.permissions_json),
            email: admin.email,
          },
        });
      }
    }

    const sipRows = await connection.query(
      `SELECT u.id, u.username, u.tenant_id, u.password_hash, u.display_name, u.email, u.phone_number,
              u.status, e.status AS entitlement_status, e.service_expires_at, t.name AS tenant_name
       FROM sip_users u
       INNER JOIN tenant_sip_account_entitlements e
         ON e.sip_user_id = u.id AND e.tenant_id = u.tenant_id AND e.status = 'active'
       INNER JOIN tenants t ON t.id = u.tenant_id AND t.status = 'active'
       WHERE u.username = ?
       LIMIT 1`,
      [username],
    );
    const sipUser = sipRows[0];

    if (!sipUser) {
      return response.status(401).json({ message: "登入帳號或密碼不正確。" });
    }

    if (!(await verifyPassword(password, sipUser.password_hash))) {
      return response.status(401).json({ message: "登入帳號或密碼不正確。" });
    }

    if (sipUser.status !== 'active') {
      return response.status(403).json({ message: "此 SIP 帳號尚未啟用或已被停用。" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const serviceExpires = sipUser.service_expires_at ? new Date(sipUser.service_expires_at) : null;
    if (!serviceExpires || serviceExpires < today) {
      return response.status(403).json({ message: "此帳號的服務已過期，請聯絡管理員續訂。" });
    }

    const { token, tokenHash } = createSessionToken();
    const sessionExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

    await connection.query(
      `INSERT INTO admin_sessions (admin_user_id, user_type, sip_user_id, token_hash, expires_at)
       VALUES (NULL, 'sip', ?, ?, ?)`,
      [Number(sipUser.id), tokenHash, sessionExpiresAt],
    );

    return response.json({
      token,
      userType: "sip",
      admin: {
        id: Number(sipUser.id),
        tenantId: Number(sipUser.tenant_id),
        accountType: "sip_user",
        role: "",
        platformRole: "",
        permissions: {},
        email: sipUser.email || sipUser.username,
        displayName: sipUser.display_name || sipUser.username,
        username: sipUser.username,
        phoneNumber: sipUser.phone_number || "",
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "登入失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/auth/sip-provision - App 端获取 provisioning 下载链接
// 输入: { username, domain }  App 已通过 SIP REGISTER 在 Flexisip 验证密码，此处无需重复验证
// POST /api/auth/ai-login - AI Assistant token (no tenant/entitlement check)
app.post("/api/auth/ai-login", async (request, response) => {
  const username = (request.body.username || "").trim();
  const password = String(request.body.password || "");
  const device = (request.body.device || "").trim().slice(0, 32) || null;

  if (!username || !password) {
    return response.status(400).json({ message: "Please enter account and password." });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    const rows = await connection.query(
      "SELECT id, username, password_hash, status FROM sip_users WHERE username = ? LIMIT 1",
      [username],
    );
    const user = rows[0];

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return response.status(401).json({ message: "Invalid account or password." });
    }

    if (user.status !== "active") {
      return response.status(403).json({ message: "Account not activated." });
    }

    // Delete old sessions for this SIP user before creating a new one.
    // Sessions are scoped by device when provided (desktop), so Android and
    // Desktop tokens can coexist without invalidating each other. Clients
    // that don't send a device keep their legacy behavior (device IS NULL).
    if (device) {
      await connection.query(
        "DELETE FROM admin_sessions WHERE sip_user_id = ? AND device = ?",
        [Number(user.id), device],
      );
    } else {
      await connection.query(
        "DELETE FROM admin_sessions WHERE sip_user_id = ? AND device IS NULL",
        [Number(user.id)],
      );
    }

    const { token, tokenHash } = createSessionToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

    await connection.query(
      "INSERT INTO admin_sessions (admin_user_id, user_type, sip_user_id, token_hash, expires_at, device) VALUES (NULL, 'sip', ?, ?, ?, ?)",
      [Number(user.id), tokenHash, expiresAt, device],
    );

    return response.json({ token, userType: "sip" });
  } catch (error) {
    console.error("[ai-login] error:", error?.message || error);
    return response.status(502).json({ message: "Service unavailable." });
  }
});

app.post("/api/auth/sip-provision", async (request, response) => {
  const username = String(request.body.username || "").trim().toLowerCase();
  const domain = String(request.body.domain || "").trim() || "sip.qrtalkie.org";

  if (!username) {
    return response.status(400).json({ success: false, message: "請輸入使用者名稱。" });
  }

  try {
    const account = await searchAccountBySip(`${username}@${domain}`);
    if (!account) {
      return response.status(404).json({ success: false, message: "找不到該 SIP 帳號。" });
    }

    const accountId = account.id || account.account?.id;
    if (!accountId) {
      return response.status(502).json({ success: false, message: "Flexisip 返回格式異常。" });
    }

    const provResult = await flexisipGetProvisionLink(accountId);
    const host = (process.env.FLEXISIP_ACCOUNT_MANAGER_BASE_URL || "http://account.qrtalkie.org/api")
      .replace(/\/api\/?$/, "").replace(/^https?:\/\//, "");

    const provisionUrl = provResult?.provisioning_url
      || provResult?.provisioningUrl
      || provResult?.provision_url
      || provResult?.provisionUrl
      || provResult?.url
      || (provResult?.provisioning_token ? `https://${host}/provisioning/${provResult.provisioning_token}` : null)
      || null;

    if (!provisionUrl) {
      return response.status(502).json({ success: false, message: "Flexisip 未返回有效的 provisioning 連結。" });
    }

    // Download provisioning XML and save to a local file (tokens are one-time-use)
    // Return a server-hosted URL so the app can use core.provisioningUri (same as QR login)
    let provisionXml = null;
    try {
      const xmlResponse = await fetch(provisionUrl);
      if (xmlResponse.ok) {
        provisionXml = await xmlResponse.text();
      }
    } catch (xmlError) {
      console.error("[auth/sip-provision] Failed to download XML: " + (xmlError.message || xmlError));
    }

    if (!provisionXml) {
      return response.status(502).json({ success: false, message: "無法下載 provisioning 配置檔案。" });
    }

    // Save to a static file and return its URL
    const provDir = "/tmp/provisioning";
    if (!existsSync(provDir)) mkdirSync(provDir, { recursive: true });
    const fileId = randomBytes(12).toString("hex");
    const fileName = username + "_" + fileId + ".xml";
    const filePath = path.join(provDir, fileName);
    writeFileSync(filePath, provisionXml, "utf8");

    // Schedule cleanup after 10 minutes
    setTimeout(function() { try { unlinkSync(filePath); } catch(e) {} }, 600000);

    const appProvisionUrl = "https://cloud.qrtalkie.org/api/provisioning/" + fileName;

    return response.json({
      success: true,
      data: {
        provisionUrl: appProvisionUrl,
        username,
        domain,
      },
    });
    
  } catch (error) {
    if (error instanceof FlexisipAccountManagerError && error.status === 404) {
      return response.status(404).json({ success: false, message: "找不到該 SIP 帳號。" });
    }
    console.error(`[auth/sip-provision] username=${username}@${domain} failed:`, error?.message || error);
    return response.status(502).json({ success: false, message: "獲取 provisioning 連結失敗，請稍後重試。" });
  }
});


// GET /api/provisioning/:file - Serve downloaded provisioning XML files
app.get("/api/provisioning/:file", (request, response) => {
  const file = String(request.params.file || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  const filePath = "/tmp/provisioning/" + file;
  try {
    if (existsSync(filePath)) {
      response.setHeader("Content-Type", "application/xml");
      response.sendFile(filePath);
    } else {
      response.status(404).type("text/plain").send("Not found");
    }
  } catch (e) {
    response.status(404).type("text/plain").send("Not found");
  }
});

// POST /api/auth/change-password - App 端修改密码并同步到 Flexisip
app.post("/api/auth/change-password", async (request, response) => {
  const username = String(request.body.username || "").trim().toLowerCase();
  const oldPassword = String(request.body.oldPassword || "").trim();
  const newPassword = String(request.body.newPassword || "").trim();
  const domain = String(request.body.domain || "").trim() || "sip.qrtalkie.org";

  if (!username || !oldPassword || !newPassword) {
    return response.status(400).json({ success: false, message: "請填寫所有欄位。" });
  }
  if (newPassword.length < 6) {
    return response.status(400).json({ success: false, message: "新密碼長度至少 6 位。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // 1. 先查 sip_users 表
    const sipRows = await connection.query(
      `SELECT u.id, u.password_hash, u.flexisip_account_id
       FROM sip_users u
       WHERE u.username = ? AND u.sip_domain = ? AND u.status = 'active'
       LIMIT 1`,
      [username, domain],
    );
    const sipUser = sipRows[0];

    if (sipUser) {
      // SaaS 平台管理的账号：验证旧密码后更新
      if (!(await verifyPassword(oldPassword, sipUser.password_hash))) {
        return response.status(401).json({ success: false, message: "舊密碼不正確。" });
      }

      const newHash = await hashPassword(newPassword);
      await connection.query(`UPDATE sip_users SET password_hash = ? WHERE id = ?`, [newHash, sipUser.id]);

      if (sipUser.flexisip_account_id) {
        try {
          await flexisipUpdateAccount(sipUser.flexisip_account_id, {
            password: newPassword,
            algorithm: "SHA-256",
          });
          console.log(`[auth/change-password] synced to Flexisip accountId=${sipUser.flexisip_account_id}`);
        } catch (err) {
          console.error(`[auth/change-password] Flexisip sync failed:`, err?.message || err);
        }
      }

      return response.json({ success: true, message: "密碼已更新。" });
    }

    // 2. sip_users 中没有 → 查 Flexisip Account Manager
    const sip = `${username}@${domain}`;
    let flexisipAccount;
    try {
      flexisipAccount = await searchAccountBySip(sip);
    } catch (err) {
      if (!(err instanceof FlexisipAccountManagerError && err.status === 404)) {
        throw err;
      }
    }

    if (!flexisipAccount) {
      return response.status(404).json({ success: false, message: "找不到該帳號。" });
    }

    const accountId = flexisipAccount.id || flexisipAccount.account?.id;
    if (!accountId) {
      return response.status(502).json({ success: false, message: "Flexisip 返回格式異常。" });
    }

    // Flexisip 直建账号：无法验证旧密码，直接更新
    await flexisipUpdateAccount(accountId, {
      username,
      password: newPassword,
      algorithm: "SHA-256",
    });
    console.log(`[auth/change-password] Flexisip-direct account updated: ${sip}`);

    return response.json({ success: true, message: "密碼已更新。" });
  } catch (error) {
    console.error(`[auth/change-password] username=${username}@${domain} failed:`, error?.message || error);
    return response.status(500).json({ success: false, message: "密碼更新失敗，請稍後重試。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/forgot-password", async (request, response) => {
  const email = normalizeEmail(request.body.email);
  if (!isValidEmail(email)) {
    return response.status(400).json({ message: "請輸入有效的電子郵件位址。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id FROM admin_users WHERE email = ? LIMIT 1`,
      [email],
    );

    const admin = rows[0];
    if (!admin) {
      return response.status(404).json({ message: "該郵箱不存在，請確認後重新輸入。" });
    }

    const { token, tokenHash } = createEmailToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await connection.query(
      `INSERT INTO password_reset_tokens (admin_user_id, token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [Number(admin.id), tokenHash, expiresAt],
    );

    const resetUrl = `${appUrl}/?resetPasswordToken=${encodeURIComponent(token)}`;
    const delivery = await queuePasswordResetEmail(connection, { email, resetUrl });

    if (!delivery.sent) {
      return response.status(500).json({ message: "重置郵件傳送失敗，請稍後再試。" });
    }

    return response.json({ message: "已傳送密碼重置連結，請檢查您的郵箱。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "無法傳送重置郵件，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/reset-password", async (request, response) => {
  const token = String(request.body.token || "");
  const password = String(request.body.password || "");
  const confirmPassword = String(request.body.confirmPassword || "");
  const passwordError = validatePassword(password);

  if (!token) {
    return response.status(400).json({ message: "重置連結無效，請重新申請。" });
  }
  if (passwordError) {
    return response.status(400).json({ message: passwordError });
  }
  if (password !== confirmPassword) {
    return response.status(400).json({ message: "兩次輸入的密碼不一致。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT prt.id, prt.admin_user_id, prt.expires_at, prt.used_at, a.status
       FROM password_reset_tokens prt
       JOIN admin_users a ON a.id = prt.admin_user_id
       WHERE prt.token_hash = ?
       LIMIT 1`,
      [hashToken(token)],
    );
    const resetToken = rows[0];

    if (!resetToken || resetToken.used_at) {
      await connection.rollback();
      return response.status(400).json({ message: "重置連結無效或已使用，請重新申請。" });
    }
    if (new Date(resetToken.expires_at).getTime() < Date.now()) {
      await connection.rollback();
      return response.status(400).json({ message: "重置連結已過期，請重新申請。" });
    }
    if (resetToken.status !== 'active') {
      await connection.rollback();
      return response.status(403).json({ message: "此管理員帳號尚未啟用。" });
    }

    const passwordHash = await hashPassword(password);
    await connection.query(
      `UPDATE admin_users
       SET password_hash = ?
       WHERE id = ?`,
      [passwordHash, Number(resetToken.admin_user_id)],
    );
    await connection.query(
      `UPDATE password_reset_tokens
       SET used_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [Number(resetToken.id)],
    );
    await connection.query(`DELETE FROM admin_sessions WHERE admin_user_id = ?`, [Number(resetToken.admin_user_id)]);

    await connection.commit();
    return response.json({ message: "密碼已重置，請使用新密碼登入。" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "無法重置密碼，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/auth/logout", requireAdmin, async (request, response) => {
  const token = getBearerToken(request);
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.query(`DELETE FROM admin_sessions WHERE token_hash = ?`, [hashToken(token)]);
    return response.json({ message: "已退出系統。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "退出系統失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/auth/change-password - 当前登录用户修改自己的密码
app.put("/api/auth/change-password", requireAdmin, async (request, response) => {
  const password = String(request.body?.password || "");
  const confirmPassword = String(request.body?.confirmPassword || "");

  if (!password) return response.status(400).json({ message: "請輸入新密碼。" });
  if (password.length < 6) return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
  if (password !== confirmPassword) return response.status(400).json({ message: "兩次輸入的密碼不一致。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const passwordHash = await hashPassword(password);
    await connection.query(
      `UPDATE admin_users SET password_hash = ? WHERE id = ?`,
      [passwordHash, request.admin.id],
    );
    // 清除所有 session，强制重新登录
    await connection.query(`DELETE FROM admin_sessions WHERE admin_user_id = ?`, [request.admin.id]);
    return response.json({ message: "密碼已修改，請重新登入。" });
  } catch (error) {
    console.error("Failed to change password:", error);
    return response.status(500).json({ message: "修改密碼失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/auth/resend-verification - 重发邮箱验证邮件
app.post("/api/auth/resend-verification", async (request, response) => {
  const email = normalizeEmail(request.body.email);
  if (!isValidEmail(email)) {
    return response.status(400).json({ message: "請輸入有效的電子郵件位址。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, status FROM admin_users WHERE email = ? LIMIT 1`,
      [email],
    );
    const admin = rows[0];

    if (!admin) {
      return response.status(404).json({ message: "此郵箱尚未註冊。" });
    }
    if (admin.status === 'active') {
      return response.status(409).json({ message: "此郵箱已驗證，請直接登入。" });
    }

    // 生成新 token
    const { token, tokenHash } = createEmailToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 废弃旧 token
    await connection.query(
      `UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE admin_user_id = ? AND used_at IS NULL`,
      [Number(admin.id)],
    );
    // 创建新 token
    await connection.query(
      `INSERT INTO email_verification_tokens (admin_user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      [Number(admin.id), tokenHash, expiresAt],
    );

    const verificationUrl = `${appUrl}/?verifyEmailToken=${encodeURIComponent(token)}`;
    await queueVerificationEmail(connection, { email, verificationUrl });

    return response.json({
      message: "驗證郵件已重新傳送，請檢查您的郵箱。",
      devVerificationUrl: verificationUrl,
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "重新傳送驗證郵件失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/auth/verify-email", async (request, response) => {
  const token = String(request.query.token || "");
  if (!token) {
    return response.status(400).json({ message: "驗證連結無效" });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const tokenHash = hashToken(token);
    const tokens = await connection.query(
      `SELECT id, admin_user_id, expires_at, used_at
       FROM email_verification_tokens
       WHERE token_hash = ?
       LIMIT 1`,
      [tokenHash],
    );

    const verification = tokens[0];
    if (!verification || verification.used_at) {
      await connection.rollback();
      return response.status(400).json({ message: "驗證連結無效鎴栧凡浣跨敤" });
    }

    if (new Date(verification.expires_at).getTime() < Date.now()) {
      await connection.rollback();
      return response.status(400).json({ message: "驗證連結已過期。" });
    }

    await connection.query(
      `UPDATE admin_users
       SET status = 'active', email_verified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [verification.admin_user_id],
    );

    await connection.query(
      `UPDATE email_verification_tokens
       SET used_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [verification.id],
    );

    await connection.commit();
    return response.json({ message: "電子郵件驗證成功，請登入" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "驗證失敗，請稍後再試" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/me", requireAdmin, async (request, response) => {
  if (request.admin.accountType === "sip_user") {
    let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query(
        `SELECT t.id, t.name, t.sip_domain
         FROM tenants t
         WHERE t.id = ? AND t.status = 'active'
         LIMIT 1`,
        [request.admin.tenantId],
      );
      const row = rows[0];

      // Query sip_users for Flexisip sync and activation status
      let flexisipSyncStatus = 'local_only';
      let flexisipActivated = null;
      try {
        const [su] = await connection.query(
          `SELECT sync_status, flexisip_account_id, sip_uri FROM sip_users WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [request.admin.id, request.admin.tenantId]
        );
        if (su) {
          flexisipSyncStatus = su.sync_status || 'local_only';
          // Query Flexisip for activation status
          if (su.flexisip_account_id) {
            try {
              const remote = await flexisipGetAccount(su.flexisip_account_id);
              flexisipActivated = remote?.activated === true || remote?.activated === 1;
            } catch {}
          }
        }
      } catch {}

      return response.json({
        userType: "sip",
        tenant: row ? {
          id: Number(row.id),
          companyName: row.name || "",
          sipDomain: row.sip_domain || "",
        } : null,
        admin: {
          id: request.admin.id,
          accountType: "sip_user",
          loginEmail: "",
          displayName: request.admin.displayName || "",
          nickname: "",
          phoneNumber: request.admin.phoneNumber || "",
          role: "",
          platformRole: "",
          permissions: {},
          username: request.admin.username || "",
          email: request.admin.email || "",
          flexisipSyncStatus,
          flexisipActivated,
        },
      });
    } catch (error) {
      console.error(error);
      return response.status(500).json({ message: "無法讀取帳號資訊。" });
    } finally {
      if (connection) connection.release();
    }
  }

  if (request.admin.accountType === 'platform') {
    return response.json({
      userType: "admin",
      tenant: null,
      admin: {
        id: request.admin.id,
        accountType: 'platform',
        loginEmail: request.admin.email,
        displayName: request.admin.displayName || request.admin.email,
        nickname: request.admin.nickname || "",
        phoneNumber: request.admin.phoneNumber || "",
        role: request.admin.role || "",
        platformRole: request.admin.platformRole || "",
        permissions: request.admin.permissions || {},
      },
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         t.id, t.tenant_number, t.name, t.contact_email, t.enterprise_email, t.contact_person,
         t.contact_phone, t.billing_address, t.postal_code, t.sip_domain, t.user_limit,
         a.email AS login_email, a.display_name AS admin_display_name, a.nickname AS admin_nickname, a.phone_number AS admin_phone
       FROM tenants t
       JOIN admin_users a ON a.tenant_id = t.id
       WHERE t.id = ? AND a.id = ?
       LIMIT 1`,
      [request.admin.tenantId, request.admin.id],
    );
    const row = rows[0];
    if (!row) return response.status(404).json({ message: "找不到租戶資料。" });

    return response.json({
      userType: "admin",
      tenant: {
        id: Number(row.id),
        tenantNumber: row.tenant_number || `TENANT-${String(row.id).padStart(6, "0")}`,
        companyName: row.name || "",
        enterpriseEmail: row.enterprise_email || row.contact_email || "",
        contactPerson: row.contact_person || "",
        contactPhone: row.contact_phone || "",
        billingAddress: row.billing_address || "",
        postalCode: row.postal_code || "",
        sipDomain: row.sip_domain || "",
        userLimit: Number(row.user_limit || 0),
      },
      admin: {
        id: request.admin.id,
        accountType: request.admin.accountType || "tenant",
        loginEmail: row.login_email || "",
        displayName: row.admin_display_name || row.login_email || "",
        nickname: row.admin_nickname || "",
        phoneNumber: row.admin_phone || "",
        role: request.admin.role || "",
        platformRole: request.admin.platformRole || "",
        permissions: request.admin.permissions || {},
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "無法讀取租戶設定。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/notifications", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await syncNotificationEvents(connection, request.admin);

    const isSipUser = request.admin.accountType === 'sip_user';
    const userId = request.admin.id;
    const userField = isSipUser ? 'r.sip_user_id' : 'r.admin_user_id';

    const rows = await connection.query(
      `SELECT
         e.id, e.event_type, e.scope_type, e.scope_id, e.title, e.body,
         e.severity, e.status, e.target_view, e.created_at, e.updated_at,
         r.read_at, r.dismissed_at, r.deleted_at
       FROM notification_events e
       JOIN notification_receipts r ON r.event_id = e.id
       WHERE ${userField} = ?
         AND e.status = 'active'
         AND r.deleted_at IS NULL
         AND r.dismissed_at IS NULL
       ORDER BY
         CASE e.severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
         e.updated_at DESC,
         e.id DESC`,
      [userId],
    );

    const notifications = rows.map((row) => ({
      id: Number(row.id),
      eventType: row.event_type || "",
      scopeType: row.scope_type || "",
      scopeId: row.scope_id == null ? null : Number(row.scope_id),
      title: row.title || "",
      description: row.body || "",
      severity: row.severity || "info",
      status: row.status || 'active',
      targetView: row.target_view || "",
      isRead: Boolean(row.read_at),
      readAt: row.read_at ? String(row.read_at) : "",
      createdAt: row.created_at ? String(row.created_at) : "",
      updatedAt: row.updated_at ? String(row.updated_at) : "",
    }));

    return response.json({
      notifications,
      activeCount: notifications.length,
      unreadCount: notifications.filter((item) => !item.isRead).length,
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "讀取訊息失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/notifications/:id/read", requireAdmin, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return response.status(400).json({ message: "訊息編號無效。" });

  const isSip = request.admin.accountType === "sip_user";
  const userField = isSip ? "r.sip_user_id" : "r.admin_user_id";

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE notification_receipts r
       JOIN notification_events e ON e.id = r.event_id
       SET r.read_at = COALESCE(r.read_at, CURRENT_TIMESTAMP)
       WHERE ${userField} = ? AND r.event_id = ? AND e.status = 'active' AND r.deleted_at IS NULL`,
      [request.admin.id, eventId],
    );
    if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "找不到訊息。" });
    return response.json({ message: "訊息已標記為已讀。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "標記訊息失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/notifications/:id/dismiss", requireAdmin, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return response.status(400).json({ message: "訊息編號無效。" });

  const isSip = request.admin.accountType === "sip_user";
  const userField = isSip ? "r.sip_user_id" : "r.admin_user_id";

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE notification_receipts r
       JOIN notification_events e ON e.id = r.event_id
       SET r.read_at = COALESCE(r.read_at, CURRENT_TIMESTAMP),
           r.dismissed_at = COALESCE(r.dismissed_at, CURRENT_TIMESTAMP)
       WHERE ${userField} = ? AND r.event_id = ? AND e.status = 'active' AND r.deleted_at IS NULL`,
      [request.admin.id, eventId],
    );
    if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "找不到訊息。" });
    return response.json({ message: "訊息已忽略。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "忽略訊息失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/notifications/:id", requireAdmin, async (request, response) => {
  const eventId = Number(request.params.id);
  if (!Number.isInteger(eventId) || eventId <= 0) return response.status(400).json({ message: "訊息編號無效。" });

  const isSip = request.admin.accountType === "sip_user";
  const userField = isSip ? "r.sip_user_id" : "r.admin_user_id";

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE notification_receipts r
       JOIN notification_events e ON e.id = r.event_id
       SET r.read_at = COALESCE(r.read_at, CURRENT_TIMESTAMP),
           r.deleted_at = COALESCE(r.deleted_at, CURRENT_TIMESTAMP)
       WHERE r.admin_user_id = ?
         AND r.event_id = ?
         AND r.deleted_at IS NULL`,
      [request.admin.id, eventId],
    );
    if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "找不到訊息。" });
    return response.json({ message: "訊息已刪除。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "刪除訊息失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/notifications/read-all - mark all notifications as read
app.post("/api/notifications/read-all", requireAdmin, async (request, response) => {
  const isSip = request.admin.accountType === "sip_user";
  const userField = isSip ? "r.sip_user_id" : "r.admin_user_id";
  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE notification_receipts r
       JOIN notification_events e ON e.id = r.event_id
       SET r.read_at = COALESCE(r.read_at, CURRENT_TIMESTAMP),
           r.dismissed_at = COALESCE(r.dismissed_at, CURRENT_TIMESTAMP)
       WHERE ${userField} = ?
         AND e.status = 'active'
         AND r.deleted_at IS NULL
         AND r.dismissed_at IS NULL`,
      [request.admin.id]
    );
    return response.json({ message: "所有訊息已設為已讀。", count: Number(result.affectedRows || 0) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/tenant/sip-accounts/:id/config-status - 獲取 SIP 帳號配置狀態
// GET /api/tenant/payments - 獲取租戶付款記錄
app.get("/api/tenant/payments", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視付款記錄。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT p.id, p.order_id, o.order_no, p.payment_amount, p.payment_method, p.payment_channel,
              p.payment_status, DATE_FORMAT(p.paid_at, '%Y-%m-%d') AS paid_at,
              p.transaction_no, p.payment_proof_file_url
       FROM billing_payments p
       LEFT JOIN billing_orders o ON o.id = p.order_id
       WHERE p.tenant_id = ? AND p.payment_status = 'paid'
       ORDER BY p.paid_at DESC`,
      [request.admin.tenantId]
    );
    const totalAmount = rows.reduce((sum, r) => sum + (Number(r.payment_amount) || 0), 0);
    response.json({
      code: 0,
      data: {
        totalAmount: totalAmount.toFixed(2),
        totalCount: rows.length,
        payments: rows.map(r => ({
          id: Number(r.id),
          orderId: r.order_id ? Number(r.order_id) : null,
          orderNo: r.order_no || '',
          amount: Number(r.payment_amount) || 0,
          paymentMethod: r.payment_method || '',
          paymentChannel: r.payment_channel || '',
          paymentStatus: r.payment_status || '',
          paidAt: r.paid_at || '',
          transactionId: r.transaction_no || '',
          proofFileUrl: r.payment_proof_file_url || '',
        })),
      }
    });
  } catch (error) {
    console.error("獲取付款記錄失敗:", error);
    response.status(500).json({ message: "獲取付款記錄失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/sip-accounts/:id/config-status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視。" });
  }
  const accountId = Number(request.params.id);
  if (!accountId) return response.status(400).json({ message: "無效的帳號 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();
    // Find sip_user_id from billing_order_sip_accounts
    const [acct] = await connection.query("SELECT sip_user_id FROM billing_order_sip_accounts WHERE id = ? AND tenant_id = ?", [accountId, request.admin.tenantId]);
    if (!acct) return response.status(404).json({ message: "帳號不存在。" });
    const sipUserId = acct.sip_user_id;

    const [ecard] = await connection.query("SELECT id FROM tenant_ecards WHERE sip_user_id = ? AND tenant_id = ? LIMIT 1", [sipUserId, request.admin.tenantId]);
    const [agent] = await connection.query("SELECT id FROM call_center_category_agents WHERE sip_account_id = ? LIMIT 1", [sipUserId]);
    const [entrance] = await connection.query("SELECT id FROM access_room_entrance_auth WHERE tenant_id = ? AND room_id IN (SELECT id FROM access_rooms WHERE sip_user_id = ? AND tenant_id = ?) LIMIT 1", [request.admin.tenantId, sipUserId, request.admin.tenantId]);
    const [room] = await connection.query("SELECT id FROM access_rooms WHERE sip_user_id = ? AND tenant_id = ? LIMIT 1", [sipUserId, request.admin.tenantId]);

    response.json({
      code: 0,
      data: {
        ecard: !!ecard,
        agent: !!agent,
        entrance: !!entrance,
        room: !!room,
      }
    });
  } catch (error) {
    console.error("獲取配置狀態失敗:", error);
    response.status(500).json({ message: "獲取配置狀態失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/sip-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視帳號管理。" });
  }

  const query = sanitizeString(request.query?.q, 120);
  const orderQuery = /^ORD/i.test(query) ? query : "";
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = orderQuery
      ? await connection.query(
        `SELECT
           a.id, a.sip_user_id, a.username, a.sip_domain, a.display_name,
           a.email, a.phone_number, a.role, a.account_status,
           DATE_FORMAT(a.service_starts_at, '%Y-%m-%d') AS service_starts_at,
           DATE_FORMAT(a.service_expires_at, '%Y-%m-%d') AS service_expires_at,
           a.assigned_at,
           o.order_no,
           cba.contact_book_id,
           tcb.name AS contact_book_name,
           wu.username AS web_username
         FROM billing_order_sip_accounts a
         JOIN billing_orders o ON o.id = a.order_id
         LEFT JOIN tenant_tenant_contact_book_assignments cba
           ON cba.sip_user_id = a.sip_user_id
          AND cba.tenant_id = a.tenant_id
          AND cba.status = 'active'
         LEFT JOIN tenant_tenant_contact_books tcb
           ON tcb.id = cba.contact_book_id
          AND cb.tenant_id = a.tenant_id
         LEFT JOIN tenant_web_account_entitlements we ON we.sip_user_id = a.sip_user_id AND we.tenant_id = a.tenant_id AND we.status = 'active'
         LEFT JOIN web_users wu ON wu.id = we.web_user_id
         WHERE a.tenant_id = ?
           AND o.order_no LIKE ?
         ORDER BY a.assigned_at DESC, a.id DESC`,
        [request.admin.tenantId, `%${orderQuery}%`],
      )
      : await connection.query(
        `SELECT
           a.id, a.sip_user_id, a.username, a.sip_domain, a.display_name,
           a.email, a.phone_number, a.role, a.account_status,
           DATE_FORMAT(a.service_starts_at, '%Y-%m-%d') AS service_starts_at,
           DATE_FORMAT(a.service_expires_at, '%Y-%m-%d') AS service_expires_at,
           a.assigned_at,
           o.order_no,
           cba.contact_book_id,
           cb.name AS contact_book_name,
           wu.username AS web_username
         FROM billing_order_sip_accounts a
         JOIN tenant_sip_account_entitlements ent
           ON ent.tenant_id = a.tenant_id
          AND ent.sip_user_id = a.sip_user_id
          AND ent.current_order_id = a.order_id
          AND ent.status = 'active'
         JOIN billing_orders o ON o.id = a.order_id
         LEFT JOIN tenant_contact_book_assignments cba
           ON cba.sip_user_id = a.sip_user_id
          AND cba.tenant_id = a.tenant_id
          AND cba.status = 'active'
         LEFT JOIN tenant_contact_books cb
           ON cb.id = cba.contact_book_id
          AND cb.tenant_id = a.tenant_id
         LEFT JOIN tenant_web_account_entitlements we ON we.sip_user_id = a.sip_user_id AND we.tenant_id = a.tenant_id AND we.status = 'active'
         LEFT JOIN web_users wu ON wu.id = we.web_user_id
         WHERE a.tenant_id = ?
           AND a.service_expires_at >= CURDATE()
         ORDER BY a.assigned_at DESC, a.id DESC`,
        [request.admin.tenantId],
      );

    // Fetch sync_status from sip_users for all accounts
    const syncStatusMap = new Map();
    if (rows.length > 0) {
      const sipUserIds = [...new Set(rows.map(r => Number(r.sip_user_id)).filter(Boolean))];
      if (sipUserIds.length > 0) {
        const syncRows = await connection.query(
          `SELECT id, sync_status FROM sip_users WHERE id IN (${sipUserIds.map(() => '?').join(',')})`,
          sipUserIds,
        );
        for (const sr of syncRows) {
          syncStatusMap.set(Number(sr.id), sr.sync_status || 'local_only');
        }
      }
    }

    return response.json({
      accounts: rows.map((row) => ({
        id: Number(row.id),
        sipUserId: Number(row.sip_user_id),
        username: row.username || "",
        domain: row.sip_domain || "",
        displayName: row.display_name || "",
        email: row.email || "",
        phone: row.phone_number || "",
        role: row.role || "user",
        status: row.account_status || 'active',
        serviceStartsAt: row.service_starts_at || "",
        serviceExpiresAt: row.service_expires_at || "",
        assignedAt: row.assigned_at ? String(row.assigned_at) : "",
        orderNo: row.order_no || "",
        webAccount: row.web_username || "",
        contactBookId: row.contact_book_id == null ? null : Number(row.contact_book_id),
        contactBookName: row.contact_book_name || "",
        syncStatus: syncStatusMap.get(Number(row.sip_user_id)) || "local_only",
      })),
    });
  } catch (error) {
    console.error("Failed to fetch tenant SIP accounts:", error);
    return response.status(500).json({ message: "無法讀取帳號管理列表。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/sip-accounts/:id", requireAdmin, async (request, response, next) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以維護帳號。" });
  }

  const paramId = Number(request.params.id);
  if (!Number.isInteger(paramId) || paramId <= 0) {
    if (request.params.id === "contact-book") return next();
    return response.status(400).json({ message: "帳號編號無效。" });
  }

  const isSelfService = request.admin.accountType === "sip_user";
  const displayName = sanitizeString(request.body?.displayName, 120);
  const email = sanitizeString(request.body?.email, 255);
  const phone = sanitizeString(request.body?.phone, 40);
  const password = String(request.body?.password || "");
  const confirmPassword = String(request.body?.confirmPassword || "");

  if (email && !isValidEmail(email)) {
    return response.status(400).json({ message: "請輸入有效的電子郵箱。" });
  }
  if (password || confirmPassword) {
    if (password.length < 6) {
      return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
    }
    if (password !== confirmPassword) {
      return response.status(400).json({ message: "兩次輸入的密碼不一致。" });
    }
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let sipUserId;
    let assignedAccountId = paramId;
    if (isSelfService) {
      sipUserId = request.admin.id;
      if (sipUserId !== paramId) {
        await connection.rollback();
        return response.status(403).json({ message: "只能編輯自己的帳號。" });
      }
    } else {
      const rows = await connection.query(
        `SELECT id, sip_user_id, service_expires_at
         FROM billing_order_sip_accounts
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [paramId, request.admin.tenantId],
      );
      const assignedAccount = rows[0];
      if (!assignedAccount) {
        await connection.rollback();
        return response.status(404).json({ message: "找不到帳號。" });
      }
      if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
        await connection.rollback();
        return response.status(409).json({ message: "已過期帳號不能編輯。" });
      }
      sipUserId = assignedAccount.sip_user_id;
    }

    // Query sip_users for Flexisip sync fields
    const [sipUser] = await connection.query(
      `SELECT id, username, sip_domain, display_name, email, phone_number, status,
              flexisip_account_id, sip_uri, sync_status
       FROM sip_users WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
      [Number(sipUserId), request.admin.tenantId],
    );
    if (!sipUser) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到帳號。" });
    }

    // ── Flexisip sync (always attempt for data consistency) ──

    let flexisipAccountId = sipUser.flexisip_account_id || null;

      if (!flexisipAccountId && sipUser.sip_uri) {
        try {
          const sr = await searchAccountBySip(sipUser.sip_uri);
          flexisipAccountId = sr?.id;
        } catch {}
      }

      // Try to find by constructing sip URI from username + domain
      if (!flexisipAccountId && sipUser.sip_domain) {
        try {
          const sipUri = `sip:${sipUser.username}@${sipUser.sip_domain}`;
          const sr = await searchAccountBySip(sipUri);
          flexisipAccountId = sr?.id;
          if (flexisipAccountId) {
            await connection.query(`UPDATE sip_users SET flexisip_account_id = ?, sip_uri = ? WHERE id = ?`, [flexisipAccountId, sipUri, sipUser.id]);
          }
        } catch {}
      }

      if (flexisipAccountId) {
        const flexisipPayload = { username: sipUser.username, algorithm: "SHA-256" };
        // Always include all fields to prevent Flexisip from clearing unchanged values
        flexisipPayload.display_name = displayName || null;
        flexisipPayload.email = email || null;
        flexisipPayload.phone = phone || null;
        if (password) {
          flexisipPayload.password = password;
          flexisipPayload.algorithm = "SHA-256";
        }

        // Get current activation status before update (update deactivates the account)
        let wasActivated = false;
        try {
          const remote = await flexisipGetAccount(flexisipAccountId);
          wasActivated = remote?.activated === true || remote?.activated === 1;
        } catch {}

        try {
          await flexisipUpdateAccount(flexisipAccountId, flexisipPayload);
          // Restore previous activation status
          if (wasActivated) {
            await flexisipActivateAccount(flexisipAccountId);
          }
          if (sipUser.flexisip_account_id !== flexisipAccountId) {
            await connection.query(`UPDATE sip_users SET flexisip_account_id = ? WHERE id = ?`, [flexisipAccountId, sipUser.id]);
          }
        } catch (flexisipErr) {
          await connection.rollback();
          const errMsg = (flexisipErr?.message || String(flexisipErr)).substring(0, 500);
          if (flexisipErr?.status === 404) {
            return response.status(502).json({ message: "遠端帳號不存在，無法更新。", code: "FLEXISIP_ACCOUNT_NOT_FOUND" });
          }
          return response.status(502).json({ message: `Flexisip 更新失敗：${errMsg}`, code: "FLEXISIP_UPDATE_FAILED" });
        }
    }

    let userUpdateSql = `UPDATE sip_users SET display_name = ?, email = ?, phone_number = ?`;
    const userUpdateParams = [displayName || null, email, phone || null];

    if (password) {
      const passwordHash = await hashPassword(password);
      userUpdateSql += `, password_hash = ?`;
      userUpdateParams.push(passwordHash);
    }

    userUpdateSql += ` WHERE id = ? AND tenant_id = ?`;
    userUpdateParams.push(Number(sipUserId), request.admin.tenantId);

    await connection.query(userUpdateSql, userUpdateParams);

    // Always update the billing_order snapshot for tenant admin visibility
    let snapshotId = isSelfService ? null : assignedAccountId;
    if (isSelfService) {
      const [snapshot] = await connection.query(
        `SELECT id FROM billing_order_sip_accounts WHERE sip_user_id = ? AND tenant_id = ? LIMIT 1`,
        [Number(sipUserId), request.admin.tenantId]
      );
      if (snapshot) snapshotId = snapshot.id;
    }
    if (snapshotId) {
      let snapshotUpdateSql = `UPDATE billing_order_sip_accounts SET display_name = ?, email = ?, phone_number = ?`;
      const snapshotUpdateParams = [displayName || null, email, phone || null];
      if (password) {
        snapshotUpdateSql += `, password_hash = ?`;
        snapshotUpdateParams.push(await hashPassword(password));
      }
      snapshotUpdateSql += ` WHERE id = ? AND tenant_id = ?`;
      snapshotUpdateParams.push(snapshotId, request.admin.tenantId);
      await connection.query(snapshotUpdateSql, snapshotUpdateParams);
    }

    await connection.commit();

    return response.json({
      message: "帳號已更新。",
      account: {
        id: assignedAccountId,
        displayName,
        email,
        phone,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant SIP account:", error);
    return response.status(500).json({ message: "帳號更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/sip-accounts/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以維護帳號。" });
  }

  const assignedAccountId = Number(request.params.id);
  if (!Number.isInteger(assignedAccountId) || assignedAccountId <= 0) {
    return response.status(400).json({ message: "帳號編號無效。" });
  }

  const status = sanitizeString(request.body?.status, 20);
  if (!['active', 'disabled'].includes(status)) {
    return response.status(400).json({ message: "帳號狀態無效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, sip_user_id, service_expires_at
       FROM billing_order_sip_accounts
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignedAccountId, request.admin.tenantId],
    );
    const assignedAccount = rows[0];
    if (!assignedAccount) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到帳號。" });
    }
    if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
      await connection.rollback();
      return response.status(409).json({ message: "已過期帳號不能啟用或停用。" });
    }

    await connection.query(
      `UPDATE sip_users
       SET status = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [status, Number(assignedAccount.sip_user_id), request.admin.tenantId],
    );
    await connection.query(
      `UPDATE billing_order_sip_accounts
       SET account_status = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [status, assignedAccountId, request.admin.tenantId],
    );

    await connection.commit();
    return response.json({ message: status === 'active' ? "帳號已啟用。" : "帳號已停用。", account: { id: assignedAccountId, status } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant SIP account status:", error);
    return response.status(500).json({ message: "帳號狀態更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

async function loadTenantSipAccountForFlexisipEmail(connection, tenantId, accountId) {
  const [billingAccount] = await connection.query(
    `SELECT
       a.id AS account_id,
       a.sip_user_id,
       a.service_expires_at,
       su.id AS sip_user_id_resolved,
       su.username,
       su.sip_domain,
       su.flexisip_account_id,
       su.sync_status,
       su.status AS sip_status
     FROM billing_order_sip_accounts a
     INNER JOIN sip_users su ON su.id = a.sip_user_id
     WHERE a.id = ?
       AND a.tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId],
  );
  if (billingAccount) {
    return {
      source: "billing_order_sip_accounts",
      accountId: Number(billingAccount.account_id),
      sipUserId: Number(billingAccount.sip_user_id),
      serviceExpiresAt: billingAccount.service_expires_at ? String(billingAccount.service_expires_at) : "",
      username: billingAccount.username || "",
      domain: billingAccount.sip_domain || "",
      flexisipAccountId: billingAccount.flexisip_account_id || "",
      syncStatus: billingAccount.sync_status || "",
      status: billingAccount.sip_status || "",
    };
  }

  const [sipUser] = await connection.query(
    `SELECT
       id AS sip_user_id,
       username,
       sip_domain,
       flexisip_account_id,
       sync_status,
       status
     FROM sip_users
     WHERE id = ?
       AND tenant_id = ?
     LIMIT 1`,
    [accountId, tenantId],
  );
  if (!sipUser) return null;
  return {
    source: "sip_users",
    accountId: Number(sipUser.sip_user_id),
    sipUserId: Number(sipUser.sip_user_id),
    serviceExpiresAt: "",
    username: sipUser.username || "",
    domain: sipUser.sip_domain || "",
    flexisipAccountId: sipUser.flexisip_account_id || "",
    syncStatus: sipUser.sync_status || "",
    status: sipUser.status || "",
  };
}

async function sendTenantSipAccountFlexisipEmail(request, response, options) {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ success: false, message: "只有租戶管理員可以操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ success: false, message: "帳號編號無效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const account = await loadTenantSipAccountForFlexisipEmail(connection, request.admin.tenantId, accountId);
    if (!account) {
      return response.status(404).json({ success: false, message: "找不到帳號。" });
    }

    if (account.serviceExpiresAt) {
      const expiresAt = new Date(account.serviceExpiresAt);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!Number.isNaN(expiresAt.getTime())) {
        expiresAt.setHours(0, 0, 0, 0);
        if (expiresAt.getTime() < today.getTime()) {
          return response.status(409).json({ success: false, message: "已過期帳號不能傳送郵件。" });
        }
      }
    }

    if (!account.flexisipAccountId) {
      return response.status(400).json({ success: false, message: "該帳號尚未同步到 Flexisip，無法傳送郵件" });
    }

    try {
      await options.sendEmail(account.flexisipAccountId);
      console.log(`[flexisip-email] action=${options.action} tenant=${request.admin.tenantId} accountId=${account.accountId} sipUserId=${account.sipUserId} flexisipAccountId=${account.flexisipAccountId} status=queued`);
      return response.json({ success: true, message: "郵件傳送請求已提交" });
    } catch (error) {
      const isFlexisipError = error instanceof FlexisipAccountManagerError;
      const safeMessage =
        isFlexisipError && error.status === 404
          ? "Flexisip 帳號不存在，無法傳送郵件"
          : "傳送失敗，請稍後重試";
      console.error(`[flexisip-email] action=${options.action} tenant=${request.admin.tenantId} accountId=${account.accountId} sipUserId=${account.sipUserId} flexisipAccountId=${account.flexisipAccountId} failed:`, error?.message || error);
      return response.status(isFlexisipError && error.status === 404 ? 404 : 502).json({ success: false, message: safeMessage });
    }
  } catch (error) {
    console.error(`[flexisip-email] action=${options.action} unexpected error:`, error);
    return response.status(500).json({ success: false, message: "傳送失敗，請稍後重試" });
  } finally {
    if (connection) connection.release();
  }
}

app.post("/api/tenant/sip-accounts/:id/send-reset-password-email", requireAdmin, async (request, response) => {
  return sendTenantSipAccountFlexisipEmail(request, response, {
    action: "reset_password",
    sendEmail: flexisipSendResetPasswordEmail,
  });
});

app.post("/api/tenant/sip-accounts/:id/send-provisioning-email", requireAdmin, async (request, response) => {
  return sendTenantSipAccountFlexisipEmail(request, response, {
    action: "provisioning",
    sendEmail: flexisipSendProvisioningEmail,
  });
});

// GET /api/tenant/sip-accounts/:id/provisioning-url - 取得 provisioning 下载链接
app.get("/api/tenant/sip-accounts/:id/provisioning-url", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ success: false, message: "只有租戶管理員可以操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ success: false, message: "帳號編號無效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const account = await loadTenantSipAccountForFlexisipEmail(connection, request.admin.tenantId, accountId);
    if (!account) {
      return response.status(404).json({ success: false, message: "找不到帳號。" });
    }
    if (!account.flexisipAccountId) {
      return response.status(400).json({ success: false, message: "該帳號尚未同步到 Flexisip，無法生成二維碼。" });
    }

    try {
      const result = await flexisipGetProvisionLink(account.flexisipAccountId);
      const host = (process.env.FLEXISIP_ACCOUNT_MANAGER_BASE_URL || "http://account.qrtalkie.org/api")
        .replace(/\/api\/?$/, "").replace(/^https?:\/\//, "");

      // 按优先级取 provisioning URL
      let provisionUrl = result?.provisioning_url
        || result?.provisioningUrl
        || result?.provision_url
        || result?.provisionUrl
        || result?.url
        || null;

      // 回退：用 token 拼接
      if (!provisionUrl && result?.provisioning_token) {
        provisionUrl = `https://${host}/provisioning/${result.provisioning_token}`;
      }

      if (!provisionUrl) {
        return response.status(502).json({ success: false, message: "Flexisip 未返回有效的 provisioning 連結。" });
      }

      return response.json({
        success: true,
        data: {
          provisionUrl,
          expireAt: result?.provisioning_token_expire_at || result?.expire_at || result?.expireAt || null,
        },
      });
    } catch (error) {
      const isFlexisipError = error instanceof FlexisipAccountManagerError;
      console.error(`[flexisip-provisioning] tenant=${request.admin.tenantId} accountId=${accountId} flexisipAccountId=${account.flexisipAccountId} failed:`, error?.message || error);
      return response.status(isFlexisipError && error.status === 404 ? 404 : 502).json({
        success: false,
        message: isFlexisipError && error.status === 404
          ? "Flexisip 帳號不存在"
          : "獲取 provisioning 連結失敗，請稍後重試",
      });
    }
  } catch (error) {
    console.error(`[flexisip-provisioning] unexpected error:`, error);
    return response.status(500).json({ success: false, message: "獲取失敗，請稍後重試" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/sip-accounts/contact-book", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以配置通訊錄。" });
  }

  const assignedAccountIds = Array.isArray(request.body?.accountIds)
    ? Array.from(new Set(request.body.accountIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)))
    : [];
  if (assignedAccountIds.length === 0) {
    return response.status(400).json({ message: "請選擇要配置通訊錄的帳號。" });
  }

  const rawContactBookId = request.body?.contactBookId;
  const contactBookId = rawContactBookId === "" || rawContactBookId == null ? null : Number(rawContactBookId);
  if (contactBookId != null && (!Number.isInteger(contactBookId) || contactBookId <= 0)) {
    return response.status(400).json({ message: "通訊錄編號無效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let contactBookName = "";
    if (contactBookId != null) {
      const [book] = await connection.query(
        `SELECT id, name
         FROM tenant_contact_books
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [contactBookId, request.admin.tenantId],
      );
      if (!book) {
        await connection.rollback();
        return response.status(404).json({ message: "找不到指定的通訊錄。" });
      }
      contactBookName = book.name || "";
    }

    const placeholders = assignedAccountIds.map(() => "?").join(",");
    const rows = await connection.query(
      `SELECT id, sip_user_id, account_status, service_expires_at
       FROM billing_order_sip_accounts
       WHERE id IN (${placeholders})
         AND tenant_id = ?
       FOR UPDATE`,
      [...assignedAccountIds, request.admin.tenantId],
    );

    if (rows.length !== assignedAccountIds.length) {
      await connection.rollback();
      return response.status(404).json({ message: "部分帳號不存在，請重新整理後重試。" });
    }

    const today = new Date().setHours(0, 0, 0, 0);
    const invalidAccount = rows.find((account) => (
      account.account_status !== 'active'
      || (account.service_expires_at && new Date(account.service_expires_at).getTime() < today)
    ));
    if (invalidAccount) {
      await connection.rollback();
      return response.status(409).json({ message: "只能為啟用中且未過期的帳號配置通訊錄。" });
    }

    const sipUserIds = rows.map((account) => Number(account.sip_user_id));
    await connection.query(
      `UPDATE tenant_contact_book_assignments
       SET status = 'revoked',
           revoked_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND sip_user_id IN (${sipUserIds.map(() => "?").join(",")})
         AND status = 'active'`,
      [request.admin.tenantId, ...sipUserIds],
    );

    if (contactBookId != null) {
      for (const sipUserId of sipUserIds) {
        await connection.query(
          `INSERT INTO tenant_contact_book_assignments (
             tenant_id, contact_book_id, sip_user_id, assigned_by_admin_id, status, assigned_at, revoked_at
           )
           VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
           ON DUPLICATE KEY UPDATE
             status = 'active',
             assigned_by_admin_id = VALUES(assigned_by_admin_id),
             assigned_at = CURRENT_TIMESTAMP,
             revoked_at = NULL`,
          [request.admin.tenantId, contactBookId, sipUserId, request.admin.id],
        );
      }
    }

    await connection.query(
      `UPDATE sip_users
       SET contact_book_id = ?
       WHERE id IN (${sipUserIds.map(() => "?").join(",")})
         AND tenant_id = ?`,
      [contactBookId, ...sipUserIds, request.admin.tenantId],
    );

    await connection.commit();
    return response.json({
      message: "通訊錄配置已儲存。",
      accountIds: assignedAccountIds,
      account: { contactBookId, contactBookName },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to batch configure contact book:", error);
    return response.status(500).json({ message: "批次配置通訊錄失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/sip-accounts/:id/contact-book", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以配置通訊錄。" });
  }

  const assignedAccountId = Number(request.params.id);
  if (!Number.isInteger(assignedAccountId) || assignedAccountId <= 0) {
    return response.status(400).json({ message: "帳號編號無效。" });
  }

  const rawContactBookId = request.body?.contactBookId;
  const contactBookId = rawContactBookId === "" || rawContactBookId == null ? null : Number(rawContactBookId);
  if (contactBookId != null && (!Number.isInteger(contactBookId) || contactBookId <= 0)) {
    return response.status(400).json({ message: "通訊錄編號無效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, sip_user_id, account_status, service_expires_at
       FROM billing_order_sip_accounts
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignedAccountId, request.admin.tenantId],
    );
    const assignedAccount = rows[0];
    if (!assignedAccount) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到帳號。" });
    }
    if (assignedAccount.account_status !== 'active') {
      await connection.rollback();
      return response.status(409).json({ message: "只有啟用中的帳號可以配置通訊錄。" });
    }
    if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
      await connection.rollback();
      return response.status(409).json({ message: "已過期帳號不能配置通訊錄。" });
    }

    let contactBookName = "";
    if (contactBookId != null) {
      const [book] = await connection.query(
        `SELECT id, name
         FROM tenant_contact_books
         WHERE id = ?
           AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [contactBookId, request.admin.tenantId],
      );
      if (!book) {
        await connection.rollback();
        return response.status(404).json({ message: "找不到指定的通訊錄。" });
      }
      contactBookName = book.name || "";
    }

    await connection.query(
      `UPDATE tenant_contact_book_assignments
       SET status = 'revoked',
           revoked_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ?
         AND sip_user_id = ?
         AND status = 'active'`,
      [request.admin.tenantId, Number(assignedAccount.sip_user_id)],
    );

    if (contactBookId != null) {
      await connection.query(
        `INSERT INTO tenant_contact_book_assignments (
           tenant_id, contact_book_id, sip_user_id, assigned_by_admin_id, status, assigned_at, revoked_at
         )
         VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
         ON DUPLICATE KEY UPDATE
           status = 'active',
           assigned_by_admin_id = VALUES(assigned_by_admin_id),
           assigned_at = CURRENT_TIMESTAMP,
           revoked_at = NULL`,
        [request.admin.tenantId, contactBookId, Number(assignedAccount.sip_user_id), request.admin.id],
      );
    }

    await connection.query(
      `UPDATE sip_users
       SET contact_book_id = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [contactBookId, Number(assignedAccount.sip_user_id), request.admin.tenantId],
    );

    await connection.commit();
    return response.json({
      message: "通訊錄配置已儲存。",
      account: {
        id: assignedAccountId,
        contactBookId,
        contactBookName,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to configure contact book:", error);
    return response.status(500).json({ message: "配置通訊錄失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/web-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視 Web 帳號管理。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         a.id, a.web_user_id, a.username, a.sip_domain, a.display_name,
         a.email, a.phone_number, a.role, a.account_status,
         DATE_FORMAT(a.service_starts_at, '%Y-%m-%d') AS service_starts_at,
         DATE_FORMAT(a.service_expires_at, '%Y-%m-%d') AS service_expires_at,
         a.assigned_at,
         o.order_no
       FROM billing_order_web_accounts a
       JOIN billing_orders o ON o.id = a.order_id
       WHERE a.tenant_id = ?
       ORDER BY a.assigned_at DESC, a.id DESC`,
      [request.admin.tenantId],
    );

    return response.json({
      accounts: rows.map((row) => ({
        id: Number(row.id),
        webUserId: Number(row.web_user_id),
        username: row.username || "",
        domain: row.sip_domain || "",
        displayName: row.display_name || "",
        email: row.email || "",
        phone: row.phone_number || "",
        role: row.role || "user",
        status: row.account_status || 'active',
        serviceStartsAt: row.service_starts_at || "",
        serviceExpiresAt: row.service_expires_at || "",
        assignedAt: row.assigned_at ? String(row.assigned_at) : "",
        orderNo: row.order_no || "",
      })),
    });
  } catch (error) {
    console.error("Failed to fetch tenant Web accounts:", error);
    return response.status(500).json({ message: "無法讀取 Web 帳號管理列表。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/web-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以維護 Web 帳號。" });
  }

  const assignedAccountId = Number(request.params.id);
  if (!Number.isInteger(assignedAccountId) || assignedAccountId <= 0) {
    return response.status(400).json({ message: "帳號編號無效。" });
  }

  const displayName = sanitizeString(request.body?.displayName, 120);
  const email = sanitizeString(request.body?.email, 255);
  const phone = sanitizeString(request.body?.phone, 40);
  const password = String(request.body?.password || "");
  const confirmPassword = String(request.body?.confirmPassword || "");

  if (email && !isValidEmail(email)) {
    return response.status(400).json({ message: "請輸入有效的電子郵箱。" });
  }
  if (password || confirmPassword) {
    if (password.length < 6) {
      return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
    }
    if (password !== confirmPassword) {
      return response.status(400).json({ message: "兩次輸入的密碼不一致。" });
    }
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, web_user_id, service_expires_at
       FROM billing_order_web_accounts
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignedAccountId, request.admin.tenantId],
    );
    const assignedAccount = rows[0];
    if (!assignedAccount) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到 Web 帳號。" });
    }
    if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
      await connection.rollback();
      return response.status(409).json({ message: "已過期帳號不能編輯。" });
    }

    let userUpdateSql = `UPDATE web_users SET display_name = ?, email = ?, phone_number = ?`;
    const userUpdateParams = [displayName || null, email, phone || null];
    let snapshotUpdateSql = `UPDATE billing_order_web_accounts SET display_name = ?, email = ?, phone_number = ?`;
    const snapshotUpdateParams = [displayName || null, email, phone || null];

    if (password) {
      const passwordHash = await hashPassword(password);
      userUpdateSql += `, password_hash = ?`;
      userUpdateParams.push(passwordHash);
      snapshotUpdateSql += `, password_hash = ?`;
      snapshotUpdateParams.push(passwordHash);
    }

    userUpdateSql += ` WHERE id = ? AND tenant_id = ?`;
    userUpdateParams.push(Number(assignedAccount.web_user_id), request.admin.tenantId);
    snapshotUpdateSql += ` WHERE id = ? AND tenant_id = ?`;
    snapshotUpdateParams.push(assignedAccountId, request.admin.tenantId);

    await connection.query(userUpdateSql, userUpdateParams);
    await connection.query(snapshotUpdateSql, snapshotUpdateParams);
    await connection.commit();

    return response.json({
      message: "Web 帳號已更新。",
      account: {
        id: assignedAccountId,
        displayName,
        email,
        phone,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant Web account:", error);
    return response.status(500).json({ message: "Web 帳號更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/web-accounts/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以維護 Web 帳號。" });
  }

  const assignedAccountId = Number(request.params.id);
  if (!Number.isInteger(assignedAccountId) || assignedAccountId <= 0) {
    return response.status(400).json({ message: "帳號編號無效。" });
  }

  const status = sanitizeString(request.body?.status, 20);
  if (!['active', 'disabled'].includes(status)) {
    return response.status(400).json({ message: "帳號狀態無效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, web_user_id, service_expires_at
       FROM billing_order_web_accounts
       WHERE id = ?
         AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignedAccountId, request.admin.tenantId],
    );
    const assignedAccount = rows[0];
    if (!assignedAccount) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到 Web 帳號。" });
    }
    if (assignedAccount.service_expires_at && new Date(assignedAccount.service_expires_at).getTime() < new Date().setHours(0, 0, 0, 0)) {
      await connection.rollback();
      return response.status(409).json({ message: "已過期帳號不能啟用或停用。" });
    }

    await connection.query(
      `UPDATE web_users
       SET status = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [status, Number(assignedAccount.web_user_id), request.admin.tenantId],
    );
    await connection.query(
      `UPDATE billing_order_web_accounts
       SET account_status = ?
       WHERE id = ?
         AND tenant_id = ?`,
      [status, assignedAccountId, request.admin.tenantId],
    );

    await connection.commit();
    return response.json({ message: status === 'active' ? "Web 帳號已啟用。" : "Web 帳號已停用。", account: { id: assignedAccountId, status } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant Web account status:", error);
    return response.status(500).json({ message: "Web 帳號狀態更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/contact-books", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以檢視通訊錄。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT 
         cb.id,
         cb.name,
         cb.description,
         cb.created_at AS createdAt,
         a.nickname AS creatorName,
         a.display_name AS adminName,
         a.email AS creatorEmail,
         (SELECT COUNT(*) FROM tenant_contact_book_entries WHERE contact_book_id = cb.id) AS entryCount,
         (SELECT COUNT(*) FROM tenant_contact_book_assignments WHERE contact_book_id = cb.id AND status = 'active') AS assignedCount
       FROM tenant_contact_books cb
       LEFT JOIN admin_users a ON cb.created_by_admin_id = a.id
       WHERE cb.tenant_id = ?
       ORDER BY cb.created_at DESC`,
      [request.admin.tenantId]
    );

    const formattedRows = rows.map((row) => ({
      ...row,
      id: row.id ? row.id.toString() : null,
      creatorName: row.creatorName || row.creatorEmail || row.adminName || "",
      createdBy: row.creatorName || row.creatorEmail || row.adminName || "",
      entryCount: Number(row.entryCount) || 0,
      assignedCount: Number(row.assignedCount) || 0
    }));

    return response.json({ contactBooks: formattedRows });
  } catch (error) {
    console.error("Failed to fetch contact books:", error);
    return response.status(500).json({ message: "取得通訊錄列表失敗" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/contact-books", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以建立通訊錄。" });
  }

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 120);
  const description = sanitizeString(payload.description, 1000);
  const accountIds = Array.isArray(payload.accountIds) ? payload.accountIds.map(Number).filter(id => id > 0) : [];
  const assignedAccountIds = Array.isArray(payload.assignedAccountIds)
    ? Array.from(new Set(payload.assignedAccountIds.map(Number).filter(id => Number.isInteger(id) && id > 0)))
    : [];

  if (!name) return response.status(400).json({ message: "請輸入通訊錄名稱。" });

  let connection;
  try {
    // ── Step 1: 检查 Flexisip 端是否已存在同名通讯录 ──
    try {
      const existingLists = await listContactLists();
      const duplicate = Array.isArray(existingLists)
        ? existingLists.find(item => (item.title || item.name || '') === name)
        : null;
      if (duplicate) {
        return response.status(409).json({
          message: `通訊錄名稱「${name}」已存在，請更換名稱。`,
          code: "DUPLICATE_CONTACT_LIST",
        });
      }
    } catch (flexisipErr) {
      console.error("Failed to list Flexisip contact lists:", flexisipErr.message);
      return response.status(502).json({ message: "Flexisip 通訊錄服務不可用，請稍後重試。" });
    }

    // ── Step 2: 在 Flexisip Account Manager 创建通讯录 ──
    let flexisipContactListId;
    try {
      const flexisipResult = await createContactList({ title: name, description: description || '' });
      flexisipContactListId = flexisipResult?.id;
    } catch (flexisipErr) {
      console.error("Failed to create Flexisip contact list:", flexisipErr.message);
      if (flexisipErr instanceof FlexisipContactBookError) {
        return response.status(502).json({
          message: `Flexisip 通訊錄建立失敗：${flexisipErr.message}`,
          code: "FLEXISIP_CREATE_FAILED",
        });
      }
      return response.status(502).json({ message: "Flexisip 通訊錄服務不可用，請稍後重試。" });
    }

    // ── Step 2: 取得数据库连接 ──
    connection = await pool.getConnection();

    // ── Step 3: 将 accountIds 中的帳號添加为通讯录成员 ──
    const memberResults = { added: [], failed: [] };
    if (accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(',');
      const memberRows = await connection.query(
        `SELECT id, flexisip_account_id, username FROM sip_users WHERE id IN (${placeholders}) AND tenant_id = ?`,
        [...accountIds, request.admin.tenantId],
      );
      for (const row of memberRows) {
        if (!row.flexisip_account_id) continue;
        try {
          await addContactToContactList(flexisipContactListId, row.flexisip_account_id);
          memberResults.added.push(row.username);
        } catch (err) {
          console.error(`Failed to add account ${row.username} to contact list:`, err.message);
          memberResults.failed.push(row.username);
        }
      }
    }

    // ── Step 4: 查询待分配帳號的 Flexisip account_id ──
    const assignTargets = [];
    if (assignedAccountIds.length > 0) {
      const placeholders = assignedAccountIds.map(() => '?').join(',');
      const sipRows = await connection.query(
        `SELECT id, flexisip_account_id, username FROM sip_users WHERE id IN (${placeholders}) AND tenant_id = ? AND status = 'active'`,
        [...assignedAccountIds, request.admin.tenantId],
      );
      for (const row of sipRows) {
        if (row.flexisip_account_id) {
          assignTargets.push({ sipUserId: Number(row.id), flexisipAccountId: row.flexisip_account_id, username: row.username });
        }
      }
    }

    // ── Step 4: 在 Flexisip 分配通讯录给帳號 ──
    const failedAssignments = [];
    for (const target of assignTargets) {
      try {
        await assignContactListToAccount(target.flexisipAccountId, flexisipContactListId);
      } catch (err) {
        console.error(`Failed to assign contact list ${flexisipContactListId} to account ${target.flexisipAccountId}:`, err.message);
        failedAssignments.push(target.username);
      }
    }
    if (failedAssignments.length > 0) {
      connection.release();
      return response.status(502).json({
        message: `Flexisip 通訊錄分配失敗（${failedAssignments.join('、')}），通訊錄已建立但部分分配失敗，請在編輯頁面重新分配。`,
        code: "FLEXISIP_ASSIGN_PARTIAL",
        flexisipContactListId,
      });
    }

    // ── Step 5: 写入本地数据库 ──
    await connection.beginTransaction();

    const result = await connection.query(
      `INSERT INTO tenant_contact_books (tenant_id, name, description, created_by_admin_id, flexisip_contact_list_id)
       VALUES (?, ?, ?, ?, ?)`,
      [request.admin.tenantId, name, description || null, request.admin.id, flexisipContactListId || null]
    );

    const contactBookId = Number(result.insertId);

    if (accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(',');
      const validAccounts = await connection.query(
        `SELECT id FROM sip_users WHERE id IN (${placeholders}) AND tenant_id = ? AND status IN ('active', 'pending')`,
        [...accountIds, request.admin.tenantId]
      );

      const validAccountIds = validAccounts.map(a => Number(a.id));

      for (const id of validAccountIds) {
        await connection.query(
          `INSERT INTO tenant_contact_book_entries (contact_book_id, sip_user_id) VALUES (?, ?)`,
          [contactBookId, id]
        );
      }
    }

    if (assignedAccountIds.length > 0) {
      const placeholders = assignedAccountIds.map(() => '?').join(',');
      const validAssignedAccounts = await connection.query(
        `SELECT id FROM sip_users WHERE id IN (${placeholders}) AND tenant_id = ? AND status = 'active'`,
        [...assignedAccountIds, request.admin.tenantId]
      );

      for (const account of validAssignedAccounts) {
        await connection.query(
          `INSERT INTO tenant_contact_book_assignments (
             tenant_id, contact_book_id, sip_user_id, assigned_by_admin_id, status, assigned_at, revoked_at
           )
           VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
           ON DUPLICATE KEY UPDATE
             status = 'active',
             assigned_by_admin_id = VALUES(assigned_by_admin_id),
             assigned_at = CURRENT_TIMESTAMP,
             revoked_at = NULL`,
          [request.admin.tenantId, contactBookId, Number(account.id), request.admin.id]
        );
      }
    }

    await connection.commit();
    return response.status(201).json({
      message: "通訊錄建立成功",
      id: contactBookId,
      flexisipContactListId: flexisipContactListId || null,
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to create contact book:", error);
    return response.status(500).json({ message: "建立通訊錄失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/contact-books/available-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視通訊錄可選帳號。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         id,
         username,
         sip_domain AS domain,
         display_name AS displayName,
         email,
         phone_number AS phone,
         status
       FROM sip_users
       WHERE tenant_id = ?
         AND status IN ('active', 'pending')
       ORDER BY username ASC`,
      [request.admin.tenantId]
    );

    return response.json({
      accounts: rows.map((row) => ({
        sipUserId: Number(row.id),
        username: row.username || "",
        domain: row.domain || "",
        displayName: row.displayName || "",
        email: row.email || "",
        phone: row.phone || "",
        status: row.status || "",
      })),
    });
  } catch (error) {
    console.error("Failed to fetch contact book available accounts:", error);
    return response.status(500).json({ message: "讀取通訊錄可選帳號失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/contact-books/validate", requireAdmin, async (request, response) => {
  if (request.admin.accountType === "platform") {
    return response.status(403).json({ message: "只有租戶管理員可以執行資料校驗。" });
  }

  try {
    const connection = await pool.getConnection();
    let localBooks;
    try {
      localBooks = await connection.query(
        `SELECT id, name, flexisip_contact_list_id,
                (SELECT COUNT(*) FROM tenant_contact_book_entries WHERE contact_book_id = cb.id) AS entryCount,
                (SELECT COUNT(*) FROM tenant_contact_book_assignments WHERE contact_book_id = cb.id AND status = "active") AS assignedCount
         FROM tenant_contact_books cb
         WHERE tenant_id = ?
         ORDER BY id ASC`,
        [request.admin.tenantId]
      );
    } finally {
      connection.release();
    }

    let flexisipLists = [];
    let flexisipError = null;
    try {
      flexisipLists = await listContactLists();
      if (!Array.isArray(flexisipLists)) flexisipLists = [];
    } catch (err) {
      flexisipError = err.message || "Flexisip service unavailable";
    }

    const flexisipMap = new Map();
    for (const l of flexisipLists) flexisipMap.set(String(l.id), l);

    const results = [];

    for (const b of localBooks) {
      if (b.flexisip_contact_list_id && flexisipMap.has(b.flexisip_contact_list_id)) {
        const f = flexisipMap.get(b.flexisip_contact_list_id);
        results.push({
          name: b.name, status: "matched", localId: Number(b.id), flexisipId: b.flexisip_contact_list_id,
          localEntryCount: Number(b.entryCount), localAssignedCount: Number(b.assignedCount),
          flexisipTitle: f.title || f.name || "",
        });
        flexisipMap.delete(b.flexisip_contact_list_id);
      } else if (!b.flexisip_contact_list_id) {
        results.push({ name: b.name, status: "local_only", localId: Number(b.id), note: "本地通訊錄未關聯 Flexisip" });
      } else {
        results.push({ name: b.name, status: "missing_on_flexisip", localId: Number(b.id), flexisipId: b.flexisip_contact_list_id, note: "Flexisip 上不存在此通訊錄" });
      }
    }

    const allOk = results.every(r => r.status === "matched");

    return response.json({ success: true, allOk, flexisipError, total: results.length, results });
  } catch (error) {
    console.error("Failed to validate contact books:", error);
    return response.status(500).json({ message: "資料校驗失敗。" });
  }
});
app.get("/api/contact-books/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以檢視通訊錄詳情。" });
  }

  const contactBookId = Number(request.params.id);
  if (!Number.isInteger(contactBookId) || contactBookId <= 0) {
    return response.status(400).json({ message: "無效的通訊錄ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [book] = await connection.query(
      `SELECT id, name, description, created_at
       FROM tenant_contact_books
       WHERE id = ? AND tenant_id = ?`,
      [contactBookId, request.admin.tenantId]
    );

    if (!book) {
      return response.status(404).json({ message: "找不到指定的通訊錄。" });
    }

    const entries = await connection.query(
      `SELECT
         su.id,
         su.username,
         su.sip_domain AS domain,
         su.display_name AS displayName,
         su.email,
         su.phone_number AS phone,
         su.status
       FROM tenant_contact_book_entries entry
       JOIN sip_users su
         ON su.id = entry.sip_user_id
        AND su.tenant_id = ?
       WHERE entry.contact_book_id = ?
       ORDER BY su.username ASC`,
      [request.admin.tenantId, contactBookId]
    );

    const assignments = await connection.query(
      `SELECT
         su.id,
         su.username,
         su.sip_domain AS domain,
         su.display_name AS displayName,
         su.email,
         su.phone_number AS phone,
         su.status,
         assign.assigned_at AS assignedAt
       FROM tenant_contact_book_assignments assign
       JOIN sip_users su
         ON su.id = assign.sip_user_id
        AND su.tenant_id = assign.tenant_id
        AND su.status = 'active'
       WHERE assign.contact_book_id = ?
         AND assign.tenant_id = ?
         AND assign.status = 'active'
       ORDER BY assign.assigned_at DESC, su.username ASC`,
      [contactBookId, request.admin.tenantId]
    );

    const formatAccount = (account) => ({
      sipUserId: Number(account.id),
      username: account.username || "",
      domain: account.domain || "",
      displayName: account.displayName || "",
      email: account.email || "",
      phone: account.phone || "",
      status: account.status || "",
      assignedAt: account.assignedAt || null
    });

    return response.json({
      contactBook: {
        id: book.id.toString(),
        name: book.name,
        description: book.description,
        accountIds: entries.map(e => Number(e.id)),
        assignedAccountIds: assignments.map(e => Number(e.id)),
        includedAccounts: entries.map(formatAccount),
        assignedAccounts: assignments.map(formatAccount)
      }
    });
  } catch (error) {
    console.error("Failed to fetch contact book details:", error);
    return response.status(500).json({ message: "取得通訊錄詳情失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/contact-books/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以編輯通訊錄。" });
  }

  const contactBookId = Number(request.params.id);
  if (!Number.isInteger(contactBookId) || contactBookId <= 0) {
    return response.status(400).json({ message: "無效的通訊錄ID。" });
  }

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 120);
  const description = sanitizeString(payload.description, 1000);
  const accountIds = Array.isArray(payload.accountIds)
    ? Array.from(new Set(payload.accountIds.map(Number).filter(id => Number.isInteger(id) && id > 0)))
    : [];
  const assignedAccountIds = Array.isArray(payload.assignedAccountIds)
    ? Array.from(new Set(payload.assignedAccountIds.map(Number).filter(id => Number.isInteger(id) && id > 0)))
    : [];

  if (!name) return response.status(400).json({ message: "請輸入通訊錄名稱。" });

  let connection;
  try {
    connection = await pool.getConnection();

    // 查找本地通讯录，取得 flexisip_contact_list_id
    const [book] = await connection.query(
      `SELECT id, flexisip_contact_list_id FROM tenant_contact_books WHERE id = ? AND tenant_id = ? FOR UPDATE`,
      [contactBookId, request.admin.tenantId]
    );
    if (!book) {
      connection.release();
      return response.status(404).json({ message: "找不到指定的通訊錄。" });
    }

    // ── Flexisip sync: 更新通讯录名称和描述 ──
    const flexisipContactListId = book.flexisip_contact_list_id;
    if (flexisipContactListId) {
      try {
        await updateContactList(flexisipContactListId, { title: name, description: description || '' });
      } catch (flexisipErr) {
        connection.release();
        if (flexisipErr instanceof FlexisipContactBookError) {
          return response.status(502).json({
            message: `Flexisip 通訊錄更新失敗：${flexisipErr.message}`,
            code: "FLEXISIP_UPDATE_FAILED",
          });
        }
        return response.status(502).json({ message: "Flexisip 通訊錄服務不可用。" });
      }
    }

    // 查询旧数据用于 diff
    const oldEntryRows = await connection.query(
      `SELECT e.sip_user_id, su.flexisip_account_id FROM tenant_contact_book_entries e
       LEFT JOIN sip_users su ON su.id = e.sip_user_id
       WHERE e.contact_book_id = ?`, [contactBookId]
    );
    const oldAssignedRows = await connection.query(
      `SELECT a.sip_user_id, su.flexisip_account_id FROM tenant_contact_book_assignments a
       LEFT JOIN sip_users su ON su.id = a.sip_user_id
       WHERE a.contact_book_id = ? AND a.tenant_id = ? AND a.status = 'active'`,
      [contactBookId, request.admin.tenantId]
    );
    const oldEntryIds = new Set(oldEntryRows.map(r => Number(r.sip_user_id)));
    const oldAssignedIds = new Set(oldAssignedRows.map(r => Number(r.sip_user_id)));
    const newEntryIdSet = new Set(accountIds);
    const newAssignedIdSet = new Set(assignedAccountIds);

    await connection.beginTransaction();

    await connection.query(
      `UPDATE tenant_contact_books SET name = ?, description = ? WHERE id = ? AND tenant_id = ?`,
      [name, description || null, contactBookId, request.admin.tenantId]
    );

    const loadValidAccountIds = async (ids, statuses) => {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      const statusPlaceholders = statuses.map(() => "?").join(",");
      const rows = await connection.query(
        `SELECT id, flexisip_account_id FROM sip_users
         WHERE id IN (${placeholders}) AND tenant_id = ? AND status IN (${statusPlaceholders})`,
        [...ids, request.admin.tenantId, ...statuses]
      );
      return rows;
    };

    const validEntryRows = await loadValidAccountIds(accountIds, ['active', "pending"]);
    const validAssignedRows = await loadValidAccountIds(assignedAccountIds, ['active']);

    await connection.query(`DELETE FROM tenant_contact_book_entries WHERE contact_book_id = ?`, [contactBookId]);
    for (const row of validEntryRows) {
      await connection.query(`INSERT INTO tenant_contact_book_entries (contact_book_id, sip_user_id) VALUES (?, ?)`, [contactBookId, row.id]);
    }

    await connection.query(
      `UPDATE tenant_contact_book_assignments SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP
       WHERE contact_book_id = ? AND tenant_id = ? AND status = 'active'`,
      [contactBookId, request.admin.tenantId]
    );
    for (const row of validAssignedRows) {
      await connection.query(
        `INSERT INTO tenant_contact_book_assignments (
           tenant_id, contact_book_id, sip_user_id, assigned_by_admin_id, status, assigned_at, revoked_at
         ) VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, NULL)
         ON DUPLICATE KEY UPDATE status = 'active', assigned_by_admin_id = VALUES(assigned_by_admin_id),
         assigned_at = CURRENT_TIMESTAMP, revoked_at = NULL`,
        [request.admin.tenantId, contactBookId, row.id, request.admin.id]
      );
    }

    await connection.commit();

    // ── Flexisip sync: 成员和分配变更 ──
    if (flexisipContactListId) {
      for (const row of validEntryRows) {
        if (!oldEntryIds.has(row.id) && row.flexisip_account_id) {
          try { await addContactToContactList(flexisipContactListId, row.flexisip_account_id); } catch {}
        }
      }
      for (const row of oldEntryRows) {
        if (!newEntryIdSet.has(Number(row.sip_user_id)) && row.flexisip_account_id) {
          try { await removeContactFromContactList(flexisipContactListId, row.flexisip_account_id); } catch {}
        }
      }
      for (const row of validAssignedRows) {
        if (!oldAssignedIds.has(row.id) && row.flexisip_account_id) {
          try { await assignContactListToAccount(row.flexisip_account_id, flexisipContactListId); } catch {}
        }
      }
      for (const row of oldAssignedRows) {
        if (!newAssignedIdSet.has(Number(row.sip_user_id)) && row.flexisip_account_id) {
          try { await unassignContactListFromAccount(row.flexisip_account_id, flexisipContactListId); } catch {}
        }
      }
    }

    return response.json({ message: "通訊錄已儲存。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update contact book:", error);
    return response.status(500).json({ message: "儲存通訊錄失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/contact-books/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "只有租戶管理員可以刪除通訊錄。" });
  }

  const contactBookId = Number(request.params.id);
  if (!Number.isInteger(contactBookId) || contactBookId <= 0) {
    return response.status(400).json({ message: "無效的通訊錄ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    const [book] = await connection.query(
      `SELECT id, flexisip_contact_list_id FROM tenant_contact_books WHERE id = ? AND tenant_id = ?`,
      [contactBookId, request.admin.tenantId]
    );

    if (!book) {
      connection.release();
      return response.status(404).json({ message: "找不到指定的通訊錄。" });
    }

    // ── Flexisip sync: 刪除远端通讯录 ──
    if (book.flexisip_contact_list_id) {
      try {
        await deleteContactList(book.flexisip_contact_list_id);
      } catch (flexisipErr) {
        // 404 表示远端已刪除，可继续清理本地
        if (flexisipErr.status !== 404) {
          connection.release();
          if (flexisipErr instanceof FlexisipContactBookError) {
            return response.status(502).json({
              message: `Flexisip 通訊錄刪除失敗：${flexisipErr.message}`,
              code: "FLEXISIP_DELETE_FAILED",
            });
          }
          return response.status(502).json({ message: "Flexisip 通訊錄服務不可用。" });
        }
      }
    }

    await connection.beginTransaction();

    await connection.query(`DELETE FROM tenant_contact_book_entries WHERE contact_book_id = ?`, [contactBookId]);
    await connection.query(
      `DELETE FROM tenant_contact_book_assignments WHERE contact_book_id = ? AND tenant_id = ?`,
      [contactBookId, request.admin.tenantId]
    );
    await connection.query(`DELETE FROM tenant_contact_books WHERE id = ?`, [contactBookId]);

    await connection.commit();
    return response.json({ message: "通訊錄已成功刪除。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete contact book:", error);
    return response.status(500).json({ message: "刪除通訊錄失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/contact-books/validate


// GET /api/admin/tenants - 鐛插彇棣栭爜绉熸埗鍒楄〃鑸囩当瑷堣硣鏂?
app.get("/api/admin/tenants", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();

    // 鑱〃鏌ヨ锛氬彇寰楃鎴跺熀鏈硣瑷娿€佽▊璩兼暩閲?(user_limit) 鑸囩疮瑷堟敮浠?(totalPaid)
    const query = `
      SELECT 
        t.id,
        COALESCE(t.tenant_number, CONCAT('TENANT-', LPAD(t.id, 6, '0'))) AS tenantNumber,
        t.name AS companyName,
        t.created_at AS createdAt,
        t.user_limit AS userLimit,
        t.status,
        COALESCE(p.totalPaid, 0) AS totalPaid,
        (SELECT COUNT(*) FROM tenant_sip_account_entitlements WHERE tenant_id = t.id AND status = 'active' AND service_expires_at > NOW()) AS sipAccountCount
      FROM tenants t
      LEFT JOIN (
        SELECT tenant_id, SUM(payment_amount) AS totalPaid
        FROM billing_payments
        WHERE payment_status = 'paid'
        GROUP BY tenant_id
      ) p ON t.id = p.tenant_id
      ORDER BY t.created_at DESC;
    `;

    const rows = await connection.query(query);

    // 鏍煎紡鍖栬硣鏂欏瀷鎱嬶紝纰轰繚 JSON 鍥炴噳鑸囧墠绔浉瀹?
    const formattedRows = rows.map((row) => ({
      ...row,
      id: row.id ? row.id.toString() : null,
      totalPaid: Number(row.totalPaid) || 0,
      sipAccountCount: Number(row.sipAccountCount) || 0,
    }));

    return response.json({ tenants: formattedRows });
  } catch (error) {
    console.error("Failed to fetch tenants:", error);
    return response.status(500).json({ message: "讀取租戶列表失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/tenants/with-active-sip - 獲取有有效 SIP 帳號的租戶列表 (must be before /:id)
app.get("/api/admin/tenants/with-active-sip", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT DISTINCT t.id, t.name,
              (SELECT MAX(su.service_expires_at) FROM sip_users su WHERE su.tenant_id = t.id AND su.status = 'active' AND (su.service_expires_at IS NULL OR su.service_expires_at > NOW())) AS latest_sip_expiry
       FROM tenants t
       INNER JOIN sip_users su2 ON su2.tenant_id = t.id AND su2.status = 'active'
         AND (su2.service_expires_at IS NULL OR su2.service_expires_at > NOW())
       WHERE t.status = 'active'
       ORDER BY t.name`
    );
    response.json({
      tenants: rows.map(r => ({
        id: Number(r.id),
        name: r.name,
        companyName: r.name,
        latestSipExpiry: r.latest_sip_expiry || null,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch tenants:", error);
    response.status(500).json({ message: "獲取租戶失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/tenants/:id - 鐛插彇鍠竴绉熸埗鐨勮┏绱拌硣瑷?
app.get("/api/admin/tenants/:id", requireAdmin, async (request, response) => {
  const tenantId = Number(request.params.id);
  if (!tenantId) return response.status(400).json({ message: "鐒℃晥鐨勭鎴?ID銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         t.id, t.tenant_number, t.name, t.contact_email, t.enterprise_email, t.contact_person,
         t.contact_phone, t.billing_address, t.postal_code, t.sip_domain, t.user_limit,
         t.status, t.created_at,
         a.email AS login_email, a.display_name AS admin_display_name, a.phone_number AS admin_phone,
         COALESCE(p.totalPaid, 0) AS totalPaid,
         (SELECT COUNT(*) FROM tenant_sip_account_entitlements WHERE tenant_id = t.id AND status = 'active' AND service_expires_at > NOW()) AS sip_account_count
       FROM tenants t
       LEFT JOIN admin_users a ON a.tenant_id = t.id AND a.role = 'owner'
       LEFT JOIN (
         SELECT tenant_id, SUM(payment_amount) AS totalPaid
         FROM billing_payments
         WHERE payment_status = 'paid'
         GROUP BY tenant_id
       ) p ON t.id = p.tenant_id
       WHERE t.id = ?
       LIMIT 1`,
      [tenantId]
    );
    const row = rows[0];
    if (!row) return response.status(404).json({ message: "鎵句笉鍒扮鎴惰硣鏂欍€?" });

    return response.json({
      tenant: {
        id: Number(row.id),
        tenantNumber: row.tenant_number || `TENANT-${String(row.id).padStart(6, "0")}`,
        companyName: row.name || "",
        enterpriseEmail: row.enterprise_email || row.contact_email || "",
        contactPerson: row.contact_person || "",
        contactPhone: row.contact_phone || "",
        billingAddress: row.billing_address || "",
        postalCode: row.postal_code || "",
        sipDomain: row.sip_domain || "",
        userLimit: Number(row.user_limit || 0),
        sipAccountCount: Number(row.sip_account_count || 0),
        status: row.status || "",
        createdAt: row.created_at,
        totalPaid: Number(row.totalPaid || 0),
        loginEmail: row.login_email || "",
        adminPhone: row.admin_phone || "",
        adminDisplayName: row.admin_display_name || "",
      }
    });
  } catch (error) {
    console.error("Failed to fetch tenant details:", error);
    return response.status(500).json({ message: "讀取租戶詳情失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/admin/tenants/:id/status - 鏇存柊绉熸埗鐙€鎱?
app.put("/api/admin/tenants/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍝″彲浠ュ煼琛屾錼嶄綔銆?" });
  }

  const tenantId = Number(request.params.id);
  const { status } = request.body || {};

  if (!tenantId) return response.status(400).json({ message: "鐒℃晥鐨勭鎴?ID銆?" });
  if (!['active', "inactive", 'disabled'].includes(status)) {
    return response.status(400).json({ message: "鐒℃晥鐨勭嬃鎱嬪€箋€?" });
  }

  // 灏囧墠绔彲鑳藉偝渚嗙殑 inactive 绲变竴鏄犲皠鐐鸿硣鏂欏韩鐨?disabled
  const dbStatus = status === "inactive" ? 'disabled' : status;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const result = await connection.query(`UPDATE tenants SET status = ? WHERE id = ?`, [dbStatus, tenantId]);
    if (Number(result.affectedRows || 0) === 0) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到指定的租戶。" });
    }

    // 鍚屾鏇存柊绉熸埗涓嬫墍鏈夌鐞嗗摗鐨勭媭鎱?    await connection.query(`UPDATE admin_users SET status = ? WHERE tenant_id = ?`, [dbStatus, tenantId]);

    // 鑻ュ仠鐢ㄧ鎴讹紝寮峰埗鐧诲嚭瑭茬鎴剁殑鎵€鏈夌鐞嗗摗
    if (dbStatus === 'disabled') {
      await connection.query(`DELETE s FROM admin_sessions s JOIN admin_users a ON s.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    }

    await connection.commit();
    return response.json({ message: "租戶狀態已更新。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update tenant status:", error);
    return response.status(500).json({ message: "更新租戶狀態失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/admin/tenants/:id - 更新或新增租戶
app.put("/api/admin/tenants/:id", requireAdmin, async (request, response) => {
  console.log("[createTenant] Route matched, admin:", request.admin?.accountType, "tenantId:", request.params?.id);
  if (request.admin.accountType !== 'platform') {
    console.log("[createTenant] Rejected: not platform admin");
    return response.status(403).json({ message: "只有平臺管理員可以執行此操作。" });
  }

  const tenantId = Number(request.params.id);
  if (!Number.isFinite(tenantId) || tenantId < 0) return response.status(400).json({ message: "無效的租戶 ID。" });
  const isCreate = tenantId === 0;
  const payload = request.body || {};
  const companyName = sanitizeString(payload.companyName, 160);
  const enterpriseEmail = normalizeEmail(payload.enterpriseEmail);
  const contactPerson = sanitizeString(payload.contactPerson, 120);
  const contactPhone = sanitizeString(payload.contactPhone, 40);
  const billingAddress = sanitizeString(payload.billingAddress, 500);
  const postalCode = sanitizeString(payload.postalCode, 20);

  if (!companyName) return response.status(400).json({ message: "請輸入公司名稱。" });
  if (enterpriseEmail && !isValidEmail(enterpriseEmail)) {
    return response.status(400).json({ message: "請輸入有效的企業信箱。" });
  }

  let connection;
  try {
    console.log("[createTenant] Starting tenant creation, payload:", JSON.stringify({ companyName, enterpriseEmail, contactPerson, contactPhone, billingAddress, postalCode, loginEmail: payload.loginEmail, hasPassword: !!payload.password, adminPhone: payload.adminPhone }));
    connection = await pool.getConnection();

    if (isCreate) {
      await connection.query("START TRANSACTION");
      // Validate required fields for creation
      const loginEmail = normalizeEmail(payload.loginEmail);
      const password = String(payload.password || "");
      console.log("[createTenant] Validated - loginEmail:", loginEmail, "password length:", password.length);
      if (!loginEmail) return response.status(400).json({ message: "請輸入管理員信箱。" });
      if (password.length < 8) return response.status(400).json({ message: "密碼至少需要 8 位字元。" });

      // Create tenant
      console.log("[createTenant] Inserting tenant...");
      const insertTenant = await connection.query(
        `INSERT INTO tenants (name, contact_email, enterprise_email, contact_person, contact_phone, billing_address, postal_code, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
        [companyName, loginEmail, enterpriseEmail || null, contactPerson || null, contactPhone || null, billingAddress || null, postalCode || null],
      );
      const newTenantId = Number(insertTenant.insertId || 0);
      console.log("[createTenant] Tenant inserted, newTenantId:", newTenantId, "insertId:", insertTenant.insertId);
      if (!newTenantId) return response.status(500).json({ message: "建立租戶失敗。" });

      // Generate and set tenant_number
      const tenantNumber = `TENANT-${String(newTenantId).padStart(6, "0")}`;
      await connection.query(`UPDATE tenants SET tenant_number = ? WHERE id = ?`, [tenantNumber, newTenantId]);

      // Create admin account
      const adminPhone = sanitizeString(payload.adminPhone, 40);
      const passwordHash = await hashPassword(password);
      console.log("[createTenant] Hashing password done, creating admin_user...");
      await connection.query(
        `INSERT INTO admin_users (tenant_id, email, password_hash, phone_number, account_type, status)
         VALUES (?, ?, ?, ?, 'tenant', 'active')`,
        [newTenantId, loginEmail, passwordHash, adminPhone || null],
      );
      console.log("[createTenant] Admin user created, committing...");

      await connection.query("COMMIT");
      console.log("[createTenant] Transaction committed, success!");
      return response.json({ message: "租戶新增成功。", id: newTenantId });
    } else {
      // Update existing tenant
      const result = await connection.query(
        `UPDATE tenants
         SET name = ?, contact_email = ?, enterprise_email = ?, contact_person = ?,
             contact_phone = ?, billing_address = ?, postal_code = ?
         WHERE id = ?`,
        [companyName, enterpriseEmail || null, enterpriseEmail || null, contactPerson || null, contactPhone || null, billingAddress || null, postalCode || null, tenantId],
      );

      if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "找不到指定的租戶。" });
      return response.json({ message: "租戶設定已儲存。" });
    }
  } catch (error) {
    console.error("[createTenant] ERROR:", error?.message || error, "code:", error?.code, "sqlMessage:", error?.sqlMessage, "stack:", error?.stack?.substring(0, 300));
    if (connection) {
      try { await connection.query("ROLLBACK"); console.log("[createTenant] Rolled back"); } catch (rbErr) { console.error("[createTenant] Rollback failed:", rbErr?.message); }
    }
    if (error?.code === "ER_DUP_ENTRY") return response.status(409).json({ message: "管理員信箱已存在。" });
    return response.status(500).json({ message: (isCreate ? "新增租戶失敗。" : "更新租戶設定失敗。") + " 錯誤: " + (error?.sqlMessage || error?.message || "") });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/admin/tenants/:id - 寰瑰簳鍒櫎绉熸埗鍙婂叾鎵€鏈夐棞鑱硣鏂?
app.delete("/api/admin/tenants/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍝″彲浠ュ煼琛屾錼嶄綔銆?" });
  }

  const tenantId = Number(request.params.id);
  if (!tenantId) return response.status(400).json({ message: "鐒℃晥鐨勭鎴?ID銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Check tenant status
    const tenantRows = await connection.query(`SELECT id, status FROM tenants WHERE id = ?`, [tenantId]);
    const tenant = tenantRows[0];
    if (!tenant) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到指定的租戶。" });
    }

    if (tenant.status !== 'disabled') {
      await connection.rollback();
      return response.status(409).json({ message: "只有處於停用狀態的租戶才可以被刪除。" });
    }

    // Check payment records
    const paymentRows = await connection.query(`SELECT id FROM billing_payments WHERE tenant_id = ? LIMIT 1`, [tenantId]);
    if (paymentRows.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "該租戶已有支付記錄，為保障財務資料完整性，無法刪除。" });
    }

    // 3. 鍒櫎闂滆伅鐨?Token 鑸?Session (鑱〃鍒櫎)
    await connection.query(`DELETE s FROM admin_sessions s JOIN admin_users a ON s.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE e FROM email_verification_tokens e JOIN admin_users a ON e.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE p FROM password_reset_tokens p JOIN admin_users a ON p.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE c FROM admin_email_change_codes c JOIN admin_users a ON c.admin_user_id = a.id WHERE a.tenant_id = ?`, [tenantId]);
    
    // Delete admin users
    await connection.query(`DELETE FROM admin_users WHERE tenant_id = ?`, [tenantId]);
    // Delete billing records
    await connection.query(`DELETE FROM billing_order_status_history WHERE tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE FROM billing_order_items WHERE tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE FROM billing_orders WHERE tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE FROM billing_coupons WHERE tenant_id = ?`, [tenantId]);
    await connection.query(`DELETE FROM billing_offline_payment_accounts WHERE tenant_id = ?`, [tenantId]);

    // Delete entitlements and unlink SIP accounts
    await connection.query(`DELETE FROM tenant_sip_account_entitlements WHERE tenant_id = ?`, [tenantId]);
    await connection.query(`UPDATE sip_users SET tenant_id = NULL WHERE tenant_id = ?`, [tenantId]);

    // Delete tenant
    await connection.query(`DELETE FROM tenants WHERE id = ?`, [tenantId]);

    await connection.commit();
    return response.json({ message: "租戶及其所有關聯資料已徹底刪除。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete tenant:", error);
    return response.status(500).json({ message: "刪除租戶失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/tenant-coupons", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍛樺彲浠ユ煡鐪嬩紭鎯犵爜鍒嗛厤璧勬枡銆?" });
  }

  const page = Math.max(1, Number.parseInt(request.query.page || "1", 10));
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(request.query.pageSize || "10", 10)));
  const offset = (page - 1) * pageSize;
  const status = sanitizeString(request.query.status, 20);
  const keyword = sanitizeString(request.query.q, 120);
  const where = [];
  const params = [];

  if (["assigned", "used", "revoked", "expired"].includes(status)) {
    where.push("btc.status = ?");
    params.push(status);
  }
  if (keyword) {
    where.push(`(
      t.name LIKE ?
      OR t.tenant_number LIKE ?
      OR c.coupon_code LIKE ?
      OR c.display_name LIKE ?
    )`);
    const pattern = `%${keyword}%`;
    params.push(pattern, pattern, pattern, pattern);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  let connection;
  try {
    connection = await pool.getConnection();
    const statRows = await connection.query(
      `SELECT status, COUNT(*) AS total
       FROM billing_tenant_coupons
       GROUP BY status`,
    );
    const stats = statRows.reduce((acc, row) => {
      acc[row.status || "assigned"] = Number(row.total || 0);
      acc.total += Number(row.total || 0);
      return acc;
    }, { total: 0, assigned: 0, used: 0, revoked: 0, expired: 0 });

    const countRows = await connection.query(
      `SELECT COUNT(*) AS total
       FROM billing_tenant_coupons btc
       JOIN tenants t ON t.id = btc.tenant_id
       JOIN billing_coupons c ON c.id = btc.coupon_id
       ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.total || 0);

    const rows = await connection.query(
      `SELECT
         btc.id, btc.tenant_id, btc.coupon_id, btc.status,
         btc.assigned_at, btc.used_at, btc.used_order_id, btc.notes,
         t.tenant_number, t.name AS tenant_name,
         c.coupon_code, c.display_name, c.discount_type, c.discount_value, c.currency,
         c.valid_from, DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS valid_until,
         o.order_no AS used_order_no
       FROM billing_tenant_coupons btc
       JOIN tenants t ON t.id = btc.tenant_id
       JOIN billing_coupons c ON c.id = btc.coupon_id
       LEFT JOIN billing_orders o ON o.id = btc.used_order_id
       ${whereSql}
       ORDER BY btc.assigned_at DESC, btc.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    return response.json({
      stats,
      pagination: { page, pageSize, total },
      items: rows.map((row) => ({
        id: Number(row.id),
        tenantId: Number(row.tenant_id),
        tenantNumber: row.tenant_number || `TENANT-${String(row.id).padStart(6, "0")}`,
        tenantName: row.tenant_name || "",
        couponId: Number(row.coupon_id),
        couponCode: row.coupon_code || "",
        displayName: row.display_name || "",
        discountType: row.discount_type || "percent",
        discountValue: Number(row.discount_value || 0),
        currency: row.currency || "",
        validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : "",
        validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
        status: row.status || "assigned",
        assignedAt: row.assigned_at || "",
        usedAt: row.used_at || "",
        usedOrderId: row.used_order_id == null ? null : Number(row.used_order_id),
        usedOrderNo: row.used_order_no || "",
        notes: row.notes || "",
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "讀取優惠碼分配列表失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/tenant-coupons", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以分配優惠碼。" });
  }

  const tenantId = Number(request.body?.tenantId || 0);
  const couponId = Number(request.body?.couponId || 0);
  if (!Number.isFinite(tenantId) || tenantId <= 0) return response.status(400).json({ message: "請選擇有效租戶。" });
  if (!Number.isFinite(couponId) || couponId <= 0) return response.status(400).json({ message: "請選擇有效優惠碼。" });
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const tenantRows = await connection.query(
      `SELECT id FROM tenants WHERE id = ? AND status = 'active' LIMIT 1`,
      [tenantId],
    );
    if (!tenantRows[0]) {
      await connection.rollback();
      return response.status(404).json({ message: "租戶不存在或未啟用。" });
    }

    const couponRows = await connection.query(
      `SELECT id
       FROM billing_coupons
       WHERE id = ?
         AND status = 'active'
         AND (valid_from IS NULL OR valid_from <= CURRENT_DATE())
         AND valid_until >= CURRENT_DATE()
         AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
       LIMIT 1`,
      [couponId],
    );
    if (!couponRows[0]) {
      await connection.rollback();
      return response.status(404).json({ message: "優惠碼不存在、未啟用或已過期。" });
    }

    const result = await connection.query(
      `INSERT INTO billing_tenant_coupons (
         tenant_id, coupon_id, status, assigned_by_platform_admin_id
       )
       VALUES (?, ?, 'assigned', ?)`,
      [tenantId, couponId, request.admin.id],
    );
    const assignmentId = Number(result.insertId);

    // 發送站內通知給該租戶管理員
    const [couponInfo] = await connection.query(
      `SELECT coupon_code, display_name, discount_type, discount_value, currency
       FROM billing_coupons WHERE id = ?`, [couponId],
    );
    if (couponInfo) {
      const discountText = couponInfo.discount_type === 'fixed_amount'
        ? `${couponInfo.currency || 'USD'} ${Number(couponInfo.discount_value || 0).toFixed(2)}`
        : `${Number(couponInfo.discount_value || 0)}%`;
      const couponTitle = `優惠碼已分配：${couponInfo.coupon_code}`;
      const couponBody = `平臺已為您分配優惠碼「${couponInfo.display_name || couponInfo.coupon_code}」（${discountText} 折扣），購買套餐時輸入 ${couponInfo.coupon_code} 即可享受優惠。`;

      const dedupeKey = `coupon_assigned_${assignmentId}`;
      const notifResult = await connection.query(
        `INSERT INTO notification_events (
           tenant_id, scope_type, scope_id, event_type, sender_type, sender_id,
           dedupe_key, title, body, severity, status, target_view
         )
         VALUES (?, 'coupon', ?, 'coupon_assigned', 'platform_admin', ?,
                 ?, ?, ?, 'info', 'active', 'domain')`,
        [tenantId, assignmentId, request.admin.id, dedupeKey, couponTitle, couponBody],
      );
      const eventId = Number(notifResult.insertId || 0);
      if (eventId > 0) {
        const tenantAdmins = await connection.query(
          `SELECT id FROM admin_users WHERE tenant_id = ? AND status = 'active'`,
          [tenantId],
        );
        for (const ad of tenantAdmins) {
          await connection.query(
            `INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')`,
            [eventId, ad.id],
          );
        }
      }
    }

    await connection.commit();
    return response.status(201).json({ message: "優惠碼已分配。", id: Number(result.insertId) });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "分配優惠碼失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/tenant-coupons/:id/revoke", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以撤銷優惠碼。" });
  }

  const assignmentId = Number(request.params.id || 0);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return response.status(400).json({ message: "無效的優惠碼分配記錄。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, status, used_order_id
       FROM billing_tenant_coupons
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignmentId],
    );
    const assignment = rows[0];
    if (!assignment) {
      await connection.rollback();
      return response.status(404).json({ message: "優惠碼分配記錄不存在。" });
    }
    if (assignment.status === "used" || assignment.used_order_id) {
      await connection.rollback();
      return response.status(409).json({ message: "已使用的優惠碼不能撤銷。" });
    }
    if (assignment.status !== "assigned") {
      await connection.rollback();
      return response.status(409).json({ message: "當前狀態不允許撤銷。" });
    }

    await connection.query(
      `UPDATE billing_tenant_coupons
       SET status = 'revoked',
           revoked_at = CURRENT_TIMESTAMP,
           revoked_by_platform_admin_id = ?
       WHERE id = ?`,
      [request.admin.id, assignmentId],
    );

    await connection.commit();
    return response.json({ message: "優惠碼已撤銷。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "撤銷優惠碼失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/tenant-coupons/:id/enable", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以啟用優惠碼。" });
  }

  const assignmentId = Number(request.params.id || 0);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return response.status(400).json({ message: "鏃犳晥鐨勪紭鎯犵爜鍒嗛厤璁板綍銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT btc.id, btc.status, btc.used_order_id, c.status AS coupon_status, c.valid_from, c.valid_until
       FROM billing_tenant_coupons btc
       JOIN billing_coupons c ON c.id = btc.coupon_id
       WHERE btc.id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignmentId],
    );
    const assignment = rows[0];
    if (!assignment) {
      await connection.rollback();
      return response.status(404).json({ message: "浼樻儬鐮佸垎閰嶈褰曚笉瀛樺湪銆?" });
    }
    if (assignment.status === "used" || assignment.used_order_id) {
      await connection.rollback();
      return response.status(409).json({ message: "已使用的優惠碼不能重新啟用。" });
    }
    if (assignment.status !== "revoked") {
      await connection.rollback();
      return response.status(409).json({ message: "只有撤銷狀態的優惠碼可以啟用。" });
    }
    if (assignment.coupon_status !== 'active') {
      await connection.rollback();
      return response.status(409).json({ message: "優惠碼基礎資料未啟用，不能啟用分配記錄。" });
    }

    await connection.query(
      `UPDATE billing_tenant_coupons
       SET status = 'assigned',
           revoked_at = NULL,
           revoked_by_platform_admin_id = NULL,
           revoke_reason = NULL
       WHERE id = ?`,
      [assignmentId],
    );

    await connection.commit();
    return response.json({ message: "優惠碼已啟用。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "啟用優惠碼失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/admin/tenant-coupons/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以刪除優惠碼分配記錄。" });
  }

  const assignmentId = Number(request.params.id || 0);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return response.status(400).json({ message: "鏃犳晥鐨勪紭鎯犵爜鍒嗛厤璁板綍銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, status, used_order_id
       FROM billing_tenant_coupons
       WHERE id = ?
       LIMIT 1
       FOR UPDATE`,
      [assignmentId],
    );
    const assignment = rows[0];
    if (!assignment) {
      await connection.rollback();
      return response.status(404).json({ message: "浼樻儬鐮佸垎閰嶈褰曚笉瀛樺湪銆?" });
    }
    if (assignment.status === "used" || assignment.used_order_id) {
      await connection.rollback();
      return response.status(409).json({ message: "宸蹭嬌鐢ㄤ紭鎯犵爜涓嶈兘鍒犻櫎銆?" });
    }
    if (assignment.status !== "revoked") {
      await connection.rollback();
      return response.status(409).json({ message: "只有撤銷狀態的優惠碼可以刪除。" });
    }

    await connection.query(`DELETE FROM billing_tenant_coupons WHERE id = ?`, [assignmentId]);
    await connection.commit();
    return response.json({ message: "優惠碼分配記錄已刪除。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "鍒犻櫎浼樻儬鐮佸垎閰嶈褰曞け璐ャ€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/offline-payment-account", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         id, account_code, display_name, payee_name, bank_name, bank_account_no,
         bank_branch, swift_code, currency, contact_name, contact_phone,
         contact_email, payment_notice
       FROM billing_offline_payment_accounts
       WHERE status = 'active'
         AND (tenant_id = ? OR tenant_id IS NULL)
       ORDER BY
         CASE WHEN tenant_id = ? THEN 0 ELSE 1 END,
         is_default DESC,
         sort_order ASC,
         id ASC
       LIMIT 1`,
      [request.admin.tenantId, request.admin.tenantId],
    );

    const row = rows[0];
    if (!row) {
      return response.status(404).json({ message: "鎵句笉鍒扮窔涓嬫敹嬈捐硣璦娿€?" });
    }

    return response.json({
      account: {
        id: Number(row.id),
        accountCode: row.account_code || "",
        displayName: row.display_name || "",
        payeeName: row.payee_name || "",
        bankName: row.bank_name || "",
        bankAccountNo: row.bank_account_no || "",
        bankBranch: row.bank_branch || "",
        swiftCode: row.swift_code || "",
        currency: row.currency || "",
        contactName: row.contact_name || "",
        contactPhone: row.contact_phone || "",
        contactEmail: row.contact_email || "",
        paymentNotice: row.payment_notice || "",
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栫窔涓嬫敹嬈捐硣璦婂け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/offline-payment-account", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以管理收款帳戶。" });
  }

  const payload = request.body || {};
  const accountCode = sanitizeString(payload.accountCode, 80) || "default-usd-bank";
  const displayName = sanitizeString(payload.displayName, 120);
  const payeeName = sanitizeString(payload.payeeName, 180);
  const bankName = sanitizeString(payload.bankName, 180);
  const bankAccountNo = sanitizeString(payload.bankAccountNo, 120);
  const bankBranch = sanitizeString(payload.bankBranch, 180);
  const swiftCode = sanitizeString(payload.swiftCode, 40);
  const currency = sanitizeString(payload.currency, 3).toUpperCase();
  const contactName = sanitizeString(payload.contactName, 120);
  const contactPhone = sanitizeString(payload.contactPhone, 40);
  const contactEmail = normalizeEmail(payload.contactEmail);
  const paymentNotice = sanitizeString(payload.paymentNotice, 255);

  if (!displayName) return response.status(400).json({ message: "請輸入帳戶名稱。" });
  if (!payeeName) return response.status(400).json({ message: "請輸入收款單位。" });
  if (!bankName) return response.status(400).json({ message: "請輸入開戶銀行。" });
  if (!bankAccountNo) return response.status(400).json({ message: "請輸入銀行帳號。" });
  if (!/^[A-Z]{3}$/.test(currency)) return response.status(400).json({ message: "幣別需為 3 位英文程式碼。" });
  if (contactEmail && !isValidEmail(contactEmail)) return response.status(400).json({ message: "請輸入有效的聯絡信箱。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      `INSERT INTO billing_offline_payment_accounts (
         tenant_id, account_code, display_name, payee_name, bank_name, bank_account_no,
         bank_branch, swift_code, currency, contact_name, contact_phone, contact_email,
         payment_notice, status, is_default, sort_order
       )
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 10)
       ON DUPLICATE KEY UPDATE
         tenant_id = NULL,
         display_name = VALUES(display_name),
         payee_name = VALUES(payee_name),
         bank_name = VALUES(bank_name),
         bank_account_no = VALUES(bank_account_no),
         bank_branch = VALUES(bank_branch),
         swift_code = VALUES(swift_code),
         currency = VALUES(currency),
         contact_name = VALUES(contact_name),
         contact_phone = VALUES(contact_phone),
         contact_email = VALUES(contact_email),
         payment_notice = VALUES(payment_notice),
         status = 'active',
         is_default = 1,
         sort_order = 10`,
      [
        accountCode,
        displayName,
        payeeName,
        bankName,
        bankAccountNo,
        bankBranch || null,
        swiftCode || null,
        currency,
        contactName || null,
        contactPhone || null,
        contactEmail || null,
        paymentNotice || null,
      ],
    );

    return response.json({ message: "收款帳戶已儲存。" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "無法儲存收款帳戶。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/addon-services", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, addon_code, name, description, billing_unit, status, sort_order
       FROM billing_addons
       WHERE status = 'active'
       ORDER BY sort_order ASC, id ASC`
    );

    const priceRows = await connection.query(
      `SELECT plan_id, addon_id, currency, unit_price, sync_with_plan_term, status, sort_order
       FROM billing_plan_addons
       WHERE status = 'active'
       ORDER BY CASE WHEN unit_price > 0 THEN 0 ELSE 1 END, sort_order ASC, id ASC`
    );

    const pricesByAddonId = priceRows.reduce((acc, row) => {
      const addonId = Number(row.addon_id);
      if (!acc[addonId]) acc[addonId] = [];
      acc[addonId].push({
        planId: Number(row.plan_id),
        currency: row.currency || "USD",
        unitPrice: Number(row.unit_price || 0),
        syncWithPlanTerm: Boolean(row.sync_with_plan_term),
        status: row.status || 'active',
      });
      return acc;
    }, {});
    const basePriceByAddonId = priceRows.reduce((acc, row) => {
      const addonId = Number(row.addon_id);
      if (!acc[addonId]) {
        acc[addonId] = {
          currency: row.currency || "USD",
          unitPrice: Number(row.unit_price || 0),
          syncWithPlanTerm: Boolean(row.sync_with_plan_term),
        };
      }
      return acc;
    }, {});

    return response.json({
      addons: rows.map((row) => ({
        id: Number(row.id),
        addonCode: row.addon_code || "",
        name: row.name || "",
        description: row.description || "",
        billingUnit: row.billing_unit || "account",
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || 0),
        baseCurrency: basePriceByAddonId[Number(row.id)]?.currency || "USD",
        baseUnitPrice: basePriceByAddonId[Number(row.id)]?.unitPrice || 0,
        baseSyncWithPlanTerm: basePriceByAddonId[Number(row.id)]?.syncWithPlanTerm ?? true,
        prices: pricesByAddonId[Number(row.id)] || [],
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "讀取增值服務失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/billing/addon-services - 创建或更新增值服務
app.put("/api/billing/addon-services", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以管理增值服務。" });
  }

  const addon = request.body || {};
  const addonCode = String(addon.addonCode || '').trim();
  const name = String(addon.name || '').trim();
  const description = String(addon.description || '').trim();
  const billingUnit = ['account', 'extension', 'device'].includes(addon.billingUnit) ? addon.billingUnit : 'account';
  const status = ['active', 'disabled'].includes(addon.status) ? addon.status : 'active';
  const sortOrder = Math.max(0, Number(addon.sortOrder || 0));

  if (!addonCode || !name) return response.status(400).json({ message: "請輸入服務程式碼和名稱。" });
  if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(addonCode)) return response.status(400).json({ message: "服務程式碼格式無效。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      `SELECT id FROM billing_addons WHERE addon_code = ? LIMIT 1`, [addonCode]
    );

    if (existing) {
      await connection.query(
        `UPDATE billing_addons SET name = ?, description = ?, billing_unit = ?, status = ?, sort_order = ? WHERE addon_code = ?`,
        [name, description, billingUnit, status, sortOrder, addonCode]
      );
    } else {
      await connection.query(
        `INSERT INTO billing_addons (addon_code, name, description, billing_unit, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
        [addonCode, name, description, billingUnit, status, sortOrder]
      );
    }

    // Update plan-specific pricing
    if (Array.isArray(addon.prices)) {
      const addonRow = await connection.query(`SELECT id FROM billing_addons WHERE addon_code = ? LIMIT 1`, [addonCode]);
      const addonId = Number(addonRow[0].id);
      for (const price of addon.prices) {
        if (!price.planId) continue;
        const currency = price.currency || 'USD';
        const unitPrice = Math.max(0, Number(price.unitPrice || 0));
        const syncWithPlanTerm = price.syncWithPlanTerm !== false ? 1 : 0;
        const priceStatus = price.status || 'active';
        const priceSort = Number(price.sortOrder || 0);
        await connection.query(
          `INSERT INTO billing_plan_addons (plan_id, addon_id, currency, unit_price, sync_with_plan_term, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE currency = VALUES(currency), unit_price = VALUES(unit_price), sync_with_plan_term = VALUES(sync_with_plan_term), status = VALUES(status)`,
          [price.planId, addonId, currency, unitPrice, syncWithPlanTerm, priceStatus, priceSort]
        );
      }
    }

    return response.json({ message: "增值服務已儲存。" });
  } catch (error) {
    console.error("Failed to save addon service:", error);
    return response.status(500).json({ message: "儲存增值服務失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/billing/addon-services/:addonCode - 刪除增值服務
app.delete("/api/billing/addon-services/:addonCode", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以管理增值服務。" });
  }

  const addonCode = String(request.params.addonCode || '').trim();
  if (!addonCode) return response.status(400).json({ message: "請指定服務程式碼。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [row] = await connection.query(`SELECT id FROM billing_addons WHERE addon_code = ? LIMIT 1`, [addonCode]);
    if (row) {
      await connection.query(`DELETE FROM billing_plan_addons WHERE addon_id = ?`, [row.id]);
      await connection.query(`DELETE FROM billing_addons WHERE id = ?`, [row.id]);
    }
    return response.json({ message: "增值服務已刪除。" });
  } catch (error) {
    console.error("Failed to delete addon service:", error);
    return response.status(500).json({ message: "刪除增值服務失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/plans", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const plans = await connection.query(`SELECT * FROM billing_plans ORDER BY sort_order ASC, id ASC`);
    const priceTiers = await connection.query(`SELECT * FROM billing_account_price_tiers`);
    const planAddons = await connection.query(`
      SELECT bpa.plan_id, ba.addon_code
      FROM billing_plan_addons bpa
      JOIN billing_addons ba ON bpa.addon_id = ba.id
    `);

    const priceTiersByPlanId = priceTiers.reduce((acc, tier) => {
      const planId = Number(tier.plan_id);
      if (!acc[planId]) acc[planId] = [];
      acc[planId].push({
        currency: tier.currency || 'USD',
        unitPrice: Number(tier.unit_price || 0),
        status: tier.status || 'active',
      });
      return acc;
    }, {});

    const addonsByPlanId = planAddons.reduce((acc, pa) => {
      const planId = Number(pa.plan_id);
      if (!acc[planId]) acc[planId] = [];
      acc[planId].push(pa.addon_code);
      return acc;
    }, {});

    const results = plans.map((plan) => ({
      id: Number(plan.id),
      planCode: plan.plan_code || "",
      name: plan.name || "",
      description: plan.description || "",
      accountQuantity: Number(plan.account_quantity || 0),
      featureSummary: plan.feature_summary || "",
      status: plan.status || 'active',
      sortOrder: Number(plan.sort_order || 0),
      addonServices: (addonsByPlanId[plan.id] || []).join(', '),
      priceTiers: priceTiersByPlanId[plan.id] || [],
    }));

    return response.json({ plans: results });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "讀取套餐資料失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

async function savePlanData(connection, payload, planId = null) {
  const {
    planCode, name, description, accountQuantity, featureSummary,
    status, sortOrder, priceTiers, addonServices
  } = payload;

  if (!planCode) throw { statusCode: 400, message: "請輸入套餐程式碼。" };
  if (!name) throw { statusCode: 400, message: "請輸入套餐名稱。" };

  if (planId) {
    await connection.query(
      `UPDATE billing_plans SET
         plan_code = ?, name = ?, description = ?, account_quantity = ?, feature_summary = ?,
         status = ?, sort_order = ?
       WHERE id = ?`,
      [planCode, name, description, accountQuantity, featureSummary, status, sortOrder, planId]
    );
  } else {
    const result = await connection.query(
      `INSERT INTO billing_plans (
         plan_code, name, description, account_quantity, feature_summary, status, sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [planCode, name, description, accountQuantity, featureSummary, status, sortOrder]
    );
    planId = Number(result.insertId);
  }

  await connection.query(`DELETE FROM billing_account_price_tiers WHERE plan_id = ?`, [planId]);
  if (Array.isArray(priceTiers) && priceTiers.length > 0) {
    const tier = priceTiers[0]; // Assuming one tier for now
    await connection.query(
      `INSERT INTO billing_account_price_tiers (plan_id, account_quantity, currency, unit_price, status) VALUES (?, ?, ?, ?, ?)`,
      [planId, Number(accountQuantity || tier.accountQuantity || 0), tier.currency || 'TWD', Number(tier.unitPrice || 0), tier.status || 'active']
    );
  }

  await connection.query(`DELETE FROM billing_plan_addons WHERE plan_id = ?`, [planId]);
  const addonCodes = (addonServices || '').split(',').map(s => s.trim()).filter(Boolean);
  if (addonCodes.length > 0) {
    const addonRows = await connection.query(`SELECT id, addon_code FROM billing_addons WHERE addon_code IN (?)`, [addonCodes]);
    for (const addon of addonRows) {
      await connection.query(
        `INSERT INTO billing_plan_addons (plan_id, addon_id, currency, unit_price, sync_with_plan_term, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [planId, addon.id, 'USD', 0, 1, 'active']
      );
    }
  }

  return planId;
}

app.post("/api/billing/plans", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍛樺彲浠ョ淮鎶ゅ槨愯祫鏂欍€?" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const planId = await savePlanData(connection, request.body);
    await connection.commit();
    return response.status(201).json({ message: "套餐已建立。", id: planId });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    if (error?.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: "套餐程式碼已存在。" });
    return response.status(error.statusCode || 500).json({ message: error.message || "建立套餐失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/plans/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍛樺彲浠ョ淮鎶ゅ槨愯祫鏂欍€?" });
  }
  const planId = Number(request.params.id);
  if (!planId) return response.status(400).json({ message: "鏃犳晥鐨勫槨?ID銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await savePlanData(connection, request.body, planId);
    await connection.commit();
    return response.json({ message: "套餐已更新。", id: planId });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    if (error?.code === 'ER_DUP_ENTRY') return response.status(409).json({ message: "套餐程式碼已存在。" });
    return response.status(error.statusCode || 500).json({ message: error.message || "更新套餐失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/billing/plans/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍛樺彲浠ョ淮鎶ゅ槨愯祫鏂欍€?" });
  }
  const planId = Number(request.params.id);
  if (!planId) return response.status(400).json({ message: "鏃犳晥鐨勫槨?ID銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const refs = await connection.query(`SELECT id FROM billing_order_items WHERE plan_id = ? LIMIT 1`, [planId]);
    if (refs.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "姝ゅ槨愬凡琚鍗曚嬌鐢紝鏃犳硶鍒犻櫎銆傛偍鍙互灝嗗叾鐘舵€佹敼涓哄仠鐢ㄣ€?" });
    }

    await connection.query(`DELETE FROM billing_plan_addons WHERE plan_id = ?`, [planId]);
    await connection.query(`DELETE FROM billing_account_price_tiers WHERE plan_id = ?`, [planId]);
    const result = await connection.query(`DELETE FROM billing_plans WHERE id = ?`, [planId]);

    if (result.affectedRows === 0) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌鍒犻櫎鐨勫槨愩€?" });
    }

    await connection.commit();
    return response.json({ message: "套餐已刪除。" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "刪除套餐失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/terms", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, term_code, display_name, months, discount_percent, status, sort_order
       FROM billing_terms
       WHERE status = 'active'
       ORDER BY sort_order ASC, id ASC`
    );

    return response.json({
      terms: rows.map((row) => ({
        id: Number(row.id),
        termCode: row.term_code || "",
        display_name: row.display_name || "",
        months: Number(row.months || 0),
        discount_percent: Number(row.discount_percent || 0),
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || 0),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "讀取購買週期失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/purchase-options", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const planRows = await connection.query(
      `SELECT
         p.id, p.plan_code, p.name, p.description, p.account_quantity, p.feature_summary,
         t.currency, t.unit_price
       FROM billing_plans p
       JOIN billing_account_price_tiers t ON t.plan_id = p.id
       WHERE p.status = 'active'
         AND t.status = 'active'
       ORDER BY p.sort_order ASC, p.id ASC`,
    );
    const addonRows = await connection.query(
      `SELECT
         a.id, a.addon_code, a.name, a.description, a.billing_unit,
         pa.plan_id, pa.currency, pa.unit_price, pa.sync_with_plan_term
       FROM billing_addons a
       JOIN billing_plan_addons pa ON pa.addon_id = a.id
       JOIN billing_plans p ON p.id = pa.plan_id
       WHERE a.status = 'active'
         AND pa.status = 'active'
         AND p.status = 'active'
       ORDER BY a.sort_order ASC, a.id ASC, p.sort_order ASC`,
    );

    return response.json({
      plans: planRows.map((row) => ({
        id: Number(row.id),
        planCode: row.plan_code || "",
        name: row.name || "",
        description: row.description || "",
        accountQuantity: Number(row.account_quantity || 0),
        featureSummary: row.feature_summary || "",
        currency: row.currency || "USD",
        unitPrice: Number(row.unit_price || 0),
      })),
      addons: addonRows.map((row) => ({
        id: Number(row.id),
        addonCode: row.addon_code || "",
        name: row.name || "",
        description: row.description || "",
        billingUnit: row.billing_unit || "account",
        planId: Number(row.plan_id),
        currency: row.currency || "USD",
        unitPrice: Number(row.unit_price || 0),
        syncWithPlanTerm: Boolean(row.sync_with_plan_term),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栧槨愯硣鏂欏け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/coupons/validate", requireAdmin, async (request, response) => {
  const code = sanitizeString(request.query.code, 80).toUpperCase();
  if (!code) return response.status(400).json({ message: "請輸入優惠碼。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const row = await loadTenantCouponForOrder(connection, request.admin.tenantId, { couponCode: code });
    if (!row) return response.status(404).json({ message: "姝ょ鎴朵笉瀛樺湪瑭插劒鎯犵⒓銆?" });

    return response.json({
      coupon: {
        assignmentId: Number(row.tenant_coupon_id),
        id: Number(row.id),
        couponCode: row.coupon_code || "",
        displayName: row.display_name || "",
        discountType: row.discount_type || "",
        discountValue: Number(row.discount_value || 0),
        currency: row.currency || "",
        validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "椹楄瓑鍎儬紕煎け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

function mapAvailableTenantCoupon(row) {
  return {
    assignmentId: Number(row.tenant_coupon_id),
    couponId: Number(row.id),
    couponCode: row.coupon_code || "",
    displayName: row.display_name || "",
    discountType: row.discount_type || "percent",
    discountValue: Number(row.discount_value || 0),
    currency: row.currency || "",
    validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : "",
    validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
    assignedAt: row.assigned_at || "",
  };
}

async function loadTenantCouponForOrder(connection, tenantId, options = {}) {
  const tenantCouponId = Number(options.tenantCouponId || 0);
  const couponCode = sanitizeString(options.couponCode, 80).toUpperCase();
  const lockClause = options.forUpdate ? " FOR UPDATE" : "";
  const selectSql = `SELECT
       btc.id AS tenant_coupon_id, btc.assigned_at,
       c.id, c.coupon_code, c.display_name, c.discount_type, c.discount_value,
       c.currency, c.valid_from, DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS valid_until
     FROM billing_tenant_coupons btc
     JOIN billing_coupons c ON c.id = btc.coupon_id`;
  const activeSql = `btc.tenant_id = ?
       AND btc.status = 'assigned'
       AND btc.used_at IS NULL
       AND btc.used_order_id IS NULL
       AND c.status = 'active'
       AND (c.valid_from IS NULL OR c.valid_from <= CURRENT_DATE())
       AND c.valid_until >= CURRENT_DATE()
       AND (c.max_redemptions IS NULL OR c.redeemed_count < c.max_redemptions)`;

  if (tenantCouponId > 0) {
    const rows = await connection.query(
      `${selectSql}
       WHERE btc.id = ?
         AND ${activeSql}
       LIMIT 1${lockClause}`,
      [tenantCouponId, tenantId],
    );
    return rows[0] || null;
  }

  if (!couponCode) return null;
  const rows = await connection.query(
    `${selectSql}
     WHERE ${activeSql}
       AND c.coupon_code = ?
     ORDER BY btc.assigned_at ASC, btc.id ASC
     LIMIT 1${lockClause}`,
    [tenantId, couponCode],
  );
  return rows[0] || null;
}

app.get("/api/billing/available-coupons", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) return response.json({ coupons: [] });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         btc.id AS tenant_coupon_id, btc.assigned_at,
         c.id, c.coupon_code, c.display_name, c.discount_type, c.discount_value,
         c.currency, DATE_FORMAT(c.valid_from, '%Y-%m-%d') AS valid_from,
         DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS valid_until
       FROM billing_tenant_coupons btc
       JOIN billing_coupons c ON c.id = btc.coupon_id
       WHERE btc.tenant_id = ?
         AND btc.status = 'assigned'
         AND btc.used_at IS NULL
         AND btc.used_order_id IS NULL
         AND c.status = 'active'
         AND (c.valid_from IS NULL OR c.valid_from <= CURRENT_DATE())
         AND c.valid_until >= CURRENT_DATE()
         AND (c.max_redemptions IS NULL OR c.redeemed_count < c.max_redemptions)
       ORDER BY c.valid_until ASC, btc.assigned_at ASC, btc.id ASC`,
      [request.admin.tenantId],
    );

    return response.json({ coupons: rows.map(mapAvailableTenantCoupon) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璇誨彇鍙敤浼樻儬鐮佸け璐ャ€?" });
  } finally {
    if (connection) connection.release();
  }
});

function toDateValue(value) {
  const text = sanitizeString(value, 10);
  if (!text) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function mapCoupon(row) {
  return {
    id: Number(row.id),
    tenantId: row.tenant_id == null ? null : Number(row.tenant_id),
    couponCode: row.coupon_code || "",
    displayName: row.display_name || "",
    discountType: row.discount_type || "percent",
    discountValue: Number(row.discount_value || 0),
    currency: row.currency || "",
    validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : "",
    validUntil: row.valid_until ? String(row.valid_until).slice(0, 10) : "",
    maxRedemptions: row.max_redemptions == null ? "" : Number(row.max_redemptions),
    redeemedCount: Number(row.redeemed_count || 0),
    status: row.status || 'active',
  };
}

app.get("/api/billing/coupon-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍛樺彲浠ョ淮鎶ゆ姌鎵ｈ祫鏂欍€?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         id, tenant_id, coupon_code, display_name, discount_type, discount_value,
         currency, DATE_FORMAT(valid_from, '%Y-%m-%d') AS valid_from,
         DATE_FORMAT(valid_until, '%Y-%m-%d') AS valid_until,
         max_redemptions, redeemed_count, status
       FROM billing_coupons
       ORDER BY status ASC, valid_until DESC, id DESC`,
    );

    return response.json({ coupons: rows.map(mapCoupon) });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "鏃犳硶璇誨彇鎶樻墸璧勬枡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/coupon-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍛樺彲浠ョ淮鎶ゆ姌鎵ｈ祫鏂欍€?" });
  }

  const payload = request.body || {};
  const id = Number(payload.id || 0);
  const couponCode = sanitizeString(payload.couponCode, 80).toUpperCase();
  const displayName = sanitizeString(payload.displayName, 120);
  const discountType = sanitizeString(payload.discountType, 20);
  const discountValue = Number(payload.discountValue || 0);
  const currency = sanitizeString(payload.currency, 3).toUpperCase();
  const validFrom = toDateValue(payload.validFrom);
  const validUntil = toDateValue(payload.validUntil);
  const rawMaxRedemptions = payload.maxRedemptions === "" || payload.maxRedemptions == null ? null : Number(payload.maxRedemptions);
  const maxRedemptions = Number.isFinite(rawMaxRedemptions) && rawMaxRedemptions > 0 ? Math.floor(rawMaxRedemptions) : null;
  const status = sanitizeString(payload.status, 20);

  if (!couponCode) return response.status(400).json({ message: "璇瘋緭鍏ユ姌鎵ｄ唬鐮併€?" });
  if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(couponCode)) return response.status(400).json({ message: "鎶樻墸浠ｇ爜鍙兘浣跨敤鑻辨枃澶у啟瀛楁瘝銆佹暟瀛椼€佸簳綰挎垨榪炲瓧絎︼紝涓旇嚦灝?2 涓瓧絎︺€?" });
  if (!displayName) return response.status(400).json({ message: "請輸入顯示名稱。" });
  if (!["percent", "fixed_amount"].includes(discountType)) return response.status(400).json({ message: "請選擇折扣型別。" });
  if (!Number.isFinite(discountValue) || discountValue <= 0) return response.status(400).json({ message: "鎶樻墸鍊煎繀欏誨ぇ浜?0銆?" });
  if (discountType === "percent" && discountValue > 100) return response.status(400).json({ message: "鐧懼垎姣旀姌鎵ｄ笉鍙秴榪?100%銆?" });
  if (discountType === "fixed_amount" && !couponCurrencyCodes.has(currency)) return response.status(400).json({ message: "璇烽€夋嫨鏈夋晥甯佺銆?" });
  if (!validUntil) return response.status(400).json({ message: "璇烽€夋嫨鍒版湡鏃ユ湡銆?" });
  if (payload.validFrom && !validFrom) return response.status(400).json({ message: "鐢熸晥鏃ユ湡鏍煎紡鏃犳晥銆?" });
  if (payload.validUntil && !validUntil) return response.status(400).json({ message: "鍒版湡鏃ユ湡鏍煎紡鏃犳晥銆?" });
  if (validFrom && validUntil < validFrom) return response.status(400).json({ message: "鍒版湡鏃ユ湡涓嶅彲鏃╀簬鐢熸晥鏃ユ湡銆?" });
  if (!['active', 'disabled', "expired"].includes(status)) return response.status(400).json({ message: "璇烽€夋嫨鐘舵€併€?" });

  let connection;
  try {
    connection = await pool.getConnection();
    let savedId = Number.isFinite(id) && id > 0 ? id : null;
    if (Number.isFinite(id) && id > 0) {
      const result = await connection.query(
        `UPDATE billing_coupons
         SET coupon_code = ?, display_name = ?, discount_type = ?, discount_value = ?,
             currency = ?, valid_from = ?, valid_until = ?, max_redemptions = ?, status = ?
         WHERE id = ?`,
        [
          couponCode,
          displayName,
          discountType,
          discountValue,
          discountType === "fixed_amount" ? currency : null,
          validFrom || null,
          validUntil,
          maxRedemptions,
          status,
          id,
        ],
      );
      if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "鎶樻墸璧勬枡涓嶅瓨鍦ㄣ€?" });
    } else {
      const result = await connection.query(
        `INSERT INTO billing_coupons (
           tenant_id, coupon_code, display_name, discount_type, discount_value,
           currency, valid_from, valid_until, max_redemptions, status
         )
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          couponCode,
          displayName,
          discountType,
          discountValue,
          discountType === "fixed_amount" ? currency : null,
          validFrom || null,
          validUntil,
          maxRedemptions,
          status,
        ],
      );
      savedId = Number(result.insertId || 0);
    }

    return response.json({ message: "鎶樻墸璧勬枡宸蹭繚瀛樸€?", id: savedId });
  } catch (error) {
    console.error(error);
    if (error?.code === "ER_DUP_ENTRY") return response.status(409).json({ message: "鎶樻墸浠ｇ爜宸插瓨鍦紝璇鋒洿鎹㈠悗鍐嶄繚瀛樸€?" });
    return response.status(500).json({ message: "鏃犳硶淇濆瓨鎶樻墸璧勬枡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/billing/coupon-settings/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍛樺彲浠ョ淮鎶ゆ姌鎵ｈ祫鏂欍€?" });
  }

  const couponId = Number(request.params.id || 0);
  if (!Number.isFinite(couponId) || couponId <= 0) return response.status(400).json({ message: "鎶樻墸璧勬枡涓嶅瓨鍦ㄣ€?" });

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(`DELETE FROM billing_coupons WHERE id = ?`, [couponId]);
    if (Number(result.affectedRows || 0) === 0) return response.status(404).json({ message: "鎶樻墸璧勬枡涓嶅瓨鍦ㄣ€?" });
    return response.json({ message: "鎶樻墸璧勬枡宸插垹闄ゃ€?" });
  } catch (error) {
    console.error(error);
    if (error?.code === "ER_ROW_IS_REFERENCED_2") {
      return response.status(409).json({ message: "姝ゆ姌鎵ｅ凡琚鍗曚嬌鐢紝涓嶈兘鍒犻櫎錛涘彲鏀逛負鍋滅敤銆?" });
    }
    return response.status(500).json({ message: "鏃犳硶鍒犻櫎鎶樻墸璧勬枡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/payment-methods", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query( // Added status and sort_order
      `SELECT id, method_code, display_name, method_type, logo_class, icon_url, status, sort_order
       FROM billing_payment_methods
       WHERE status = 'active'
       ORDER BY method_type ASC, sort_order ASC, id ASC`,
    );

    return response.json({
      methods: rows.map((row) => ({
        id: Number(row.id),
        methodCode: row.method_code || "",
        displayName: row.display_name || "",
        methodType: row.method_type || "",
        logoClass: row.logo_class || "",
        iconUrl: row.icon_url || "",
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || 0),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栦粯嬈炬柟寮忓け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/payment-method-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍝″彲浠ョ董璀蜂粯嬈炬柟寮忋€?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, method_code, display_name, method_type, logo_class, icon_url, status, sort_order
       FROM billing_payment_methods
       ORDER BY sort_order ASC, id ASC`,
    );

    return response.json({
      methods: rows.map((row) => ({
        id: Number(row.id),
        methodCode: row.method_code || "",
        displayName: row.display_name || "",
        methodType: row.method_type || "online",
        logoClass: row.logo_class || "",
        iconUrl: row.icon_url || "",
        status: row.status || 'active',
        sortOrder: Number(row.sort_order || 0),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栦粯嬈炬柟寮忚ō瀹氬け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/payment-method-settings", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍝″彲浠ョ董璀蜂粯嬈炬柟寮忋€?" });
  }

  const methods = Array.isArray(request.body?.methods) ? request.body.methods.slice(0, 50) : [];
  if (methods.length === 0) return response.status(400).json({ message: "請至少新增一個付款方式。" });

  const seenCodes = new Set();
  const normalizedMethods = [];

  for (const method of methods) {
    const id = Number(method.id || 0);
    const displayName = sanitizeString(method.displayName, 120);
    const rawMethodCode = sanitizeString(method.methodCode, 80).toLowerCase();
    const methodCode = rawMethodCode || generateMethodCode(displayName, seenCodes);
    const methodType = sanitizeString(method.methodType, 20);
    const logoClass = sanitizeString(method.logoClass, 80);
    const iconDataUrl = String(method.iconDataUrl || "");
    let iconUrl = sanitizeString(method.iconUrl, 255);
    const status = sanitizeString(method.status, 20);
    const sortOrder = Math.max(0, Number(method.sortOrder || 0));

    if (!methodCode) return response.status(400).json({ message: "請輸入方式程式碼。" });
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(methodCode)) {
      return response.status(400).json({ message: "鏂瑰紡浠ｇ⒓鍙兘浣跨敤鑻辨枃瀛楁瘝銆佹暩瀛椼€佸簳綬氭垨閫ｅ瓧鉶燂紝涓旇嚦灝?2 鍊嬪瓧鍏冦€?" });
    }
    if (seenCodes.has(methodCode)) return response.status(400).json({ message: "鏂瑰紡浠ｇ⒓涓嶅彲閲嶈銆?" });
    seenCodes.add(methodCode);
    if (!displayName) return response.status(400).json({ message: "璜嬭幾鍏ラ’紺哄悕紼便€?" });
    if (!["online", "offline"].includes(methodType)) return response.status(400).json({ message: "請選擇付款型別。" });
    if (!['active', 'disabled'].includes(status)) return response.status(400).json({ message: "請選擇啟用狀態。" });
    if (iconUrl && !iconUrl.startsWith("/payment-method-icons/")) return response.status(400).json({ message: "浠樻鏂瑰紡鍦栨璺緫鐒℃晥銆?" });
    if (iconDataUrl) {
      try {
        iconUrl = await savePaymentMethodIcon(iconDataUrl, methodCode);
      } catch (error) {
        return response.status(error.statusCode || 400).json({ message: error.message || "鐒℃硶鍎插瓨浠樻鏂瑰紡鍦栨銆?" });
      }
    }

    normalizedMethods.push({
      id: Number.isFinite(id) && id > 0 ? id : null,
      methodCode,
      displayName,
      methodType,
      logoClass,
      iconUrl,
      status,
      sortOrder,
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    for (const method of normalizedMethods) {
      if (method.id) {
        await connection.query(
          `UPDATE billing_payment_methods
           SET method_code = ?, display_name = ?, method_type = ?, logo_class = ?, icon_url = ?,
               status = ?, sort_order = ?
           WHERE id = ?`,
          [
            method.methodCode,
            method.displayName,
            method.methodType,
            method.logoClass || null,
            method.iconUrl || null,
            method.status,
            method.sortOrder,
            method.id,
          ],
        );
      } else {
        await connection.query(
          `INSERT INTO billing_payment_methods (
             method_code, display_name, method_type, logo_class, icon_url, status, sort_order
           )
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             display_name = VALUES(display_name),
             method_type = VALUES(method_type),
             logo_class = VALUES(logo_class),
             icon_url = VALUES(icon_url),
             status = VALUES(status),
             sort_order = VALUES(sort_order)`,
          [
            method.methodCode,
            method.displayName,
            method.methodType,
            method.logoClass || null,
            method.iconUrl || null,
            method.status,
            method.sortOrder,
          ],
        );
      }
    }

    await connection.commit();
    return response.json({ message: "浠樻鏂瑰紡宸插劜瀛樸€?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    if (error?.code === "ER_DUP_ENTRY") return response.status(409).json({ message: "鏂瑰紡浠ｇ⒓宸插瓨鍦紝璜嬫洿鎻涘緦鍐嶅劜瀛樸€?" });
    return response.status(500).json({ message: "鐒℃硶鍎插瓨浠樻鏂瑰紡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/billing/payment-method-settings/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "鍙湁騫衝彴綆＄悊鍝″彲浠ョ董璀蜂粯嬈炬柟寮忋€?" });
  }

  const methodId = Number(request.params.id || 0);
  if (!Number.isFinite(methodId) || methodId <= 0) {
    return response.status(400).json({ message: "浠樻鏂瑰紡涓嶅瓨鍦ㄣ€?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const countRows = await connection.query(`SELECT COUNT(*) AS total FROM billing_payment_methods`);
    const total = Number(countRows[0]?.total || 0);
    if (total <= 1) {
      await connection.rollback();
      return response.status(400).json({ message: "鑷衝皯闇€淇濈暀涓€鍊嬩粯嬈炬柟寮忋€?" });
    }

    const result = await connection.query(`DELETE FROM billing_payment_methods WHERE id = ?`, [methodId]);
    if (Number(result.affectedRows || 0) === 0) {
      await connection.rollback();
      return response.status(404).json({ message: "浠樻鏂瑰紡涓嶅瓨鍦ㄣ€?" });
    }

    await connection.commit();
    return response.json({ message: "浠樻鏂瑰紡宸插埅闄ゃ€?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶鍒櫎浠樻鏂瑰紡銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/orders", requireAdmin, async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
         o.currency, o.payable_amount, o.order_status, o.payment_status,
         o.payment_method, o.payment_channel, o.effective_at, o.expires_at, o.created_at,
         plan.item_name AS plan_name,
         plan.account_quantity,
         plan.months,
         GROUP_CONCAT(DISTINCT addon.item_name ORDER BY addon.sort_order SEPARATOR ', ') AS addon_names,
         p.paid_at,
         p.payment_proof_uploaded_at
       FROM billing_orders o
       LEFT JOIN billing_order_items plan
         ON plan.order_id = o.id
        AND plan.item_type = 'plan'
       LEFT JOIN billing_order_items addon
         ON addon.order_id = o.id
        AND addon.item_type = 'addon'
       LEFT JOIN billing_payments p
         ON p.order_id = o.id
       WHERE o.tenant_id = ?
       GROUP BY
          o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
          o.currency, o.payable_amount, o.order_status, o.payment_status,
         o.payment_method, o.payment_channel, o.effective_at, o.expires_at, o.created_at,
         plan.item_name, plan.account_quantity, plan.months, p.paid_at, p.payment_proof_uploaded_at
       ORDER BY o.created_at DESC, o.id DESC`,
      [request.admin.tenantId],
    );

    return response.json({
      orders: rows.map((row) => ({
        id: Number(row.id),
        orderNo: row.order_no || "",
        orderType: row.order_type || "new_purchase",
        renewalSourceOrderId: row.renewal_source_order_id == null ? null : Number(row.renewal_source_order_id),
        renewalBaseExpiresAt: row.renewal_base_expires_at ? String(row.renewal_base_expires_at).slice(0, 10) : "",
        planName: row.plan_name || "-",
        orderStatus: row.order_status || "",
        paymentStatus: row.payment_status || "",
        accountQuantity: Number(row.account_quantity || 0),
        addonNames: row.addon_names || "",
        months: Number(row.months || 0),
        effectiveAt: row.effective_at ? String(row.effective_at).slice(0, 10) : "",
        expiresAt: row.expires_at ? String(row.expires_at).slice(0, 10) : "",
        paymentMethod: row.payment_method || "",
        paymentChannel: row.payment_channel || "",
        paymentDate: row.paid_at ? String(row.paid_at).slice(0, 10) : row.payment_proof_uploaded_at ? String(row.payment_proof_uploaded_at).slice(0, 10) : "",
        currency: row.currency || "USD",
        payableAmount: Number(row.payable_amount || 0),
      })),
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栬▊鍠垪琛ㄥけ鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

function makeBusinessNo(prefix) {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${prefix}${date}${random}`;
}

async function loadAddonOrderRows(connection, planId, addonCodes, currency) {
  if (!addonCodes.length) return [];

  const addonRows = await connection.query(
    `SELECT
       a.id, a.addon_code, a.name, a.sort_order,
       included.plan_id AS included_plan_id
     FROM billing_addons a
     LEFT JOIN billing_plan_addons included
       ON included.addon_id = a.id
      AND included.plan_id = ?
      AND included.status = 'active'
     WHERE a.addon_code IN (?)
       AND a.status = 'active'
     ORDER BY a.sort_order ASC, a.id ASC`,
    [planId, addonCodes],
  );
  if (!addonRows.length) return [];

  const addonIds = addonRows.map((addon) => Number(addon.id));
  const priceRows = await connection.query(
    `SELECT addon_id, currency, unit_price, sync_with_plan_term
     FROM billing_plan_addons
     WHERE addon_id IN (?)
       AND status = 'active'
     ORDER BY
       CASE WHEN currency = ? THEN 0 ELSE 1 END,
       CASE WHEN unit_price > 0 THEN 0 ELSE 1 END,
       sort_order ASC,
       id ASC`,
    [addonIds, currency],
  );
  const basePriceByAddonId = priceRows.reduce((acc, row) => {
    const addonId = Number(row.addon_id);
    if (!acc[addonId]) {
      acc[addonId] = {
        currency: row.currency || currency,
        unitPrice: Number(row.unit_price || 0),
        syncWithPlanTerm: Boolean(row.sync_with_plan_term),
      };
    }
    return acc;
  }, {});

  return addonRows.map((addon) => {
    const addonId = Number(addon.id);
    const isIncluded = Number(addon.included_plan_id || 0) === Number(planId);
    const basePrice = basePriceByAddonId[addonId] || { currency, unitPrice: 0, syncWithPlanTerm: true };
    return {
      id: addonId,
      addonCode: addon.addon_code,
      name: addon.name,
      unitPrice: isIncluded ? 0 : Number(basePrice.unitPrice || 0),
      currency: basePrice.currency || currency,
      syncWithPlanTerm: isIncluded ? true : basePrice.syncWithPlanTerm,
      isIncluded,
    };
  });
}

async function buildBillingOrderDraft(connection, request, payload) {
  const planCode = sanitizeString(payload.planCode, 80);
  const quantity = Math.max(1, Number(payload.quantity || 1));
  const months = Math.max(1, Number(payload.months || 1));
  const addonCodes = Array.isArray(payload.addonCodes) ? payload.addonCodes.map((code) => sanitizeString(code, 80)).filter(Boolean) : [];
  const couponCode = sanitizeString(payload.couponCode, 80).toUpperCase();
  const tenantCouponId = Number(payload.tenantCouponId || payload.couponAssignmentId || 0);

  if (!planCode) {
    const error = new Error("請選擇套餐。");
    error.statusCode = 400;
    throw error;
  }

  const planRows = await connection.query(
    `SELECT p.id, p.plan_code, p.name, p.account_quantity, t.currency, t.unit_price
     FROM billing_plans p
     JOIN billing_account_price_tiers t ON t.plan_id = p.id
     WHERE p.plan_code = ?
       AND p.status = 'active'
       AND t.status = 'active'
     LIMIT 1`,
    [planCode],
  );
  const plan = planRows[0];
  if (!plan) {
    const error = new Error("套餐不存在或已停用。");
    error.statusCode = 404;
    throw error;
  }

  const currency = plan.currency || "USD";
  const orderItems = [];
  let subtotal = Number(plan.unit_price) * quantity * months;
  orderItems.push({
    itemType: "plan",
    planId: Number(plan.id),
    addonId: null,
    couponId: null,
    itemCode: plan.plan_code,
    itemName: `${plan.name} 套餐`,
    quantity,
    months,
    unitPrice: Number(plan.unit_price),
    discountAmount: 0,
    lineAmount: subtotal,
    accountQuantity: Number(plan.account_quantity || 0) * quantity,
    sortOrder: 10,
  });

  if (addonCodes.length > 0) {
    const addonRows = await loadAddonOrderRows(connection, Number(plan.id), addonCodes, currency);

    addonRows.forEach((addon, index) => {
      const lineMonths = addon.syncWithPlanTerm ? months : 1;
      const lineAmount = Number(addon.unitPrice) * quantity * lineMonths;
      subtotal += lineAmount;
      orderItems.push({
        itemType: "addon",
        planId: Number(plan.id),
        addonId: Number(addon.id),
        couponId: null,
        itemCode: addon.addonCode,
        itemName: addon.name,
        quantity,
        months: lineMonths,
        unitPrice: Number(addon.unitPrice),
        discountAmount: 0,
        lineAmount,
        accountQuantity: null,
        sortOrder: 20 + index,
      });
    });
  }

  let coupon = null;
  let discountAmount = 0;
  if (tenantCouponId > 0 || couponCode) {
    coupon = await loadTenantCouponForOrder(connection, request.admin.tenantId, { tenantCouponId, couponCode });
    if (!coupon) {
      const error = new Error("姝ょ鎴朵笉瀛樺湪瑭插劒鎯犵⒓銆?");
      error.statusCode = 404;
      throw error;
    }
    if (coupon.discount_type === "percent") discountAmount = subtotal * (Number(coupon.discount_value) / 100);
    if (coupon.discount_type === "fixed_amount") discountAmount = Math.min(subtotal, Number(coupon.discount_value));
    orderItems.push({
      itemType: "discount",
      planId: null,
      addonId: null,
      couponId: Number(coupon.id),
      itemCode: coupon.coupon_code,
      itemName: "鍎儬鎶樻墸",
      quantity: 1,
      months: 1,
      unitPrice: 0,
      discountAmount,
      lineAmount: -discountAmount,
      accountQuantity: null,
      sortOrder: 90,
    });
  }

  return {
    currency,
    subtotal,
    discountAmount,
    payableAmount: Math.max(0, subtotal - discountAmount),
    coupon,
    orderItems,
  };
}

async function findOfflinePaymentAccountId(connection, tenantId) {
  const rows = await connection.query(
    `SELECT id FROM billing_offline_payment_accounts
     WHERE status = 'active' AND (tenant_id = ? OR tenant_id IS NULL)
     ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, is_default DESC, sort_order ASC, id ASC
     LIMIT 1`,
    [tenantId, tenantId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

app.post("/api/billing/orders", requireAdmin, async (request, response) => {
  const payload = request.body || {};
  const planCode = sanitizeString(payload.planCode, 80);
  const quantity = Math.max(1, Number(payload.quantity || 1));
  const months = Math.max(1, Number(payload.months || 1));
  const addonCodes = Array.isArray(payload.addonCodes) ? payload.addonCodes.map((code) => sanitizeString(code, 80)).filter(Boolean) : [];
  const couponCode = sanitizeString(payload.couponCode, 80).toUpperCase();
  const tenantCouponId = Number(payload.tenantCouponId || payload.couponAssignmentId || 0);
  const paymentMethod = sanitizeString(payload.paymentMethod, 20);
  const paymentChannel = sanitizeString(payload.paymentChannel, 80);
  const billingAddress = sanitizeString(payload.billingAddress, 500);

  if (!planCode) return response.status(400).json({ message: "請選擇套餐。" });
  if (!["online", "offline"].includes(paymentMethod)) return response.status(400).json({ message: "請選擇支付方式。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const planRows = await connection.query(
      `SELECT p.id, p.plan_code, p.name, p.account_quantity, t.currency, t.unit_price
       FROM billing_plans p
       JOIN billing_account_price_tiers t ON t.plan_id = p.id
       WHERE p.plan_code = ?
         AND p.status = 'active'
         AND t.status = 'active'
       LIMIT 1`,
      [planCode],
    );
    const plan = planRows[0];
    if (!plan) {
      await connection.rollback();
      return response.status(404).json({ message: "套餐不存在或已停用。" });
    }

    const currency = plan.currency || "USD";
    const orderItems = [];
    let subtotal = Number(plan.unit_price) * quantity * months;
    orderItems.push({
      itemType: "plan",
      planId: Number(plan.id),
      addonId: null,
      couponId: null,
      itemCode: plan.plan_code,
      itemName: `${plan.name} 套餐`,
      quantity,
      months,
      unitPrice: Number(plan.unit_price),
      discountAmount: 0,
      lineAmount: subtotal,
      accountQuantity: Number(plan.account_quantity || 0) * quantity,
      sortOrder: 10,
    });

    if (addonCodes.length > 0) {
      const addonRows = await loadAddonOrderRows(connection, Number(plan.id), addonCodes, currency);

      addonRows.forEach((addon, index) => {
        const lineMonths = addon.syncWithPlanTerm ? months : 1;
        const lineAmount = Number(addon.unitPrice) * quantity * lineMonths;
        subtotal += lineAmount;
        orderItems.push({
          itemType: "addon",
          planId: Number(plan.id),
          addonId: Number(addon.id),
          couponId: null,
          itemCode: addon.addonCode,
          itemName: addon.name,
          quantity,
          months: lineMonths,
          unitPrice: Number(addon.unitPrice),
          discountAmount: 0,
          lineAmount,
          accountQuantity: null,
          sortOrder: 20 + index,
        });
      });
    }

    let coupon = null;
    let discountAmount = 0;
    if (tenantCouponId > 0 || couponCode) {
      coupon = await loadTenantCouponForOrder(connection, request.admin.tenantId, { tenantCouponId, couponCode, forUpdate: true });
      if (!coupon) {
        await connection.rollback();
        return response.status(404).json({ message: "姝ょ鎴朵笉瀛樺湪瑭插劒鎯犵⒓銆?" });
      }
      if (coupon.discount_type === "percent") discountAmount = subtotal * (Number(coupon.discount_value) / 100);
      if (coupon.discount_type === "fixed_amount") discountAmount = Math.min(subtotal, Number(coupon.discount_value));
      orderItems.push({
        itemType: "discount",
        planId: null,
        addonId: null,
        couponId: Number(coupon.id),
        itemCode: coupon.coupon_code,
        itemName: "鍎儬鎶樻墸",
        quantity: 1,
        months: 1,
        unitPrice: 0,
        discountAmount,
        lineAmount: -discountAmount,
        accountQuantity: null,
        sortOrder: 90,
      });
    }

    const payableAmount = Math.max(0, subtotal - discountAmount);
    const isOnlinePaid = paymentMethod === "online";
    const initialOrderStatus = isOnlinePaid ? "payment_submitted" : "pending_payment";
    const initialPaymentStatus = isOnlinePaid ? 'paid' : "unpaid";
    const initialPaymentRecordStatus = isOnlinePaid ? 'paid' : "pending";
    const orderNo = makeBusinessNo("ORD");
    const orderResult = await connection.query(
      `INSERT INTO billing_orders (
         tenant_id, order_no, currency, subtotal_amount, discount_amount, payable_amount,
         paid_amount, order_status, payment_status, payment_method, payment_channel, billing_address,
         coupon_id, coupon_code, coupon_discount_type, coupon_discount_value, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.admin.tenantId,
        orderNo,
        currency,
        subtotal,
        discountAmount,
        payableAmount,
        isOnlinePaid ? payableAmount : 0,
        initialOrderStatus,
        initialPaymentStatus,
        paymentMethod,
        paymentChannel || null,
        billingAddress || null,
        coupon ? Number(coupon.id) : null,
        coupon ? coupon.coupon_code : null,
        coupon ? coupon.discount_type : null,
        coupon ? Number(coupon.discount_value) : null,
        request.admin.id,
      ],
    );
    const orderId = Number(orderResult.insertId);

    for (const item of orderItems) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          item.itemType,
          item.planId,
          item.addonId,
          item.couponId,
          item.itemCode,
          item.itemName,
          item.accountQuantity,
          item.quantity,
          item.months,
          currency,
          item.unitPrice,
          item.discountAmount,
          item.lineAmount,
          item.sortOrder,
        ],
      );
    }

    if (coupon?.tenant_coupon_id) {
      await connection.query(
        `UPDATE billing_tenant_coupons
         SET status = 'used', used_at = CURRENT_TIMESTAMP, used_order_id = ?
         WHERE id = ? AND tenant_id = ? AND status = 'assigned'`,
        [orderId, Number(coupon.tenant_coupon_id), request.admin.tenantId],
      );
      await connection.query(
        `UPDATE billing_coupons
         SET redeemed_count = COALESCE(redeemed_count, 0) + 1
         WHERE id = ?`,
        [Number(coupon.id)],
      );
    }

    const offlineAccountRows =
      paymentMethod === "offline"
        ? await connection.query(
            `SELECT id FROM billing_offline_payment_accounts
             WHERE status = 'active' AND (tenant_id = ? OR tenant_id IS NULL)
             ORDER BY CASE WHEN tenant_id = ? THEN 0 ELSE 1 END, is_default DESC, sort_order ASC, id ASC
             LIMIT 1`,
            [request.admin.tenantId, request.admin.tenantId],
          )
        : [];
    const paymentNo = makeBusinessNo("PAY");
    await connection.query(
      `INSERT INTO billing_payments (
         order_id, tenant_id, payment_no, payment_method, payment_channel,
         offline_payment_account_id, payment_currency, payment_amount, payment_status,
         paid_at, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        paymentNo,
        paymentMethod,
        paymentChannel || null,
        offlineAccountRows[0] ? Number(offlineAccountRows[0].id) : null,
        currency,
        payableAmount,
        initialPaymentRecordStatus,
        isOnlinePaid ? new Date() : null,
        request.admin.id,
      ],
    );

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, to_order_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, request.admin.tenantId, initialOrderStatus, initialPaymentStatus, "create_order", request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({
      message: paymentMethod === "offline" ? "璦傚柈宸蹭繚瀛橈紝璜嬬窔涓嬩粯嬈懼緦涓婂偝浠樻鎲戣瓑鎴湒銆?" : "璦傚柈宸插緩絝嬨€?",
      order: { id: orderId, orderNo, currency, payableAmount },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "寤虹珛璦傚柈澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/billing/orders/:id", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "璦傚柈綬ㄨ櫉鐒℃晥銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
         o.currency, o.subtotal_amount, o.discount_amount, o.payable_amount,
         o.order_status, o.payment_status, o.payment_method, o.payment_channel, o.billing_address,
         DATE_FORMAT(o.reviewed_at, '%Y-%m-%d') AS reviewed_at,
         DATE_FORMAT(o.effective_at, '%Y-%m-%d') AS effective_at,
         DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at,
         o.review_note,
         o.coupon_code, o.coupon_discount_type, o.coupon_discount_value,
         DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS coupon_valid_until
       FROM billing_orders o
       LEFT JOIN billing_coupons c ON c.id = o.coupon_id
       WHERE o.id = ? AND o.tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const order = rows[0];
    if (!order) return response.status(404).json({ message: "鎵句笉鍒拌▊鍠€?" });

    const itemRows = await connection.query(
      `SELECT
         item_type, item_code, item_name, account_quantity, quantity, months,
         currency, unit_price, discount_amount, line_amount, sort_order
       FROM billing_order_items
       WHERE order_id = ? AND tenant_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [orderId, request.admin.tenantId],
    );
    const planItem = itemRows.find((item) => item.item_type === "plan") || null;
    const addonItems = itemRows.filter((item) => item.item_type === "addon");
    const paymentRows = await connection.query(
      `SELECT
         payment_amount,
         DATE_FORMAT(paid_at, '%Y-%m-%d') AS paid_at,
         payment_proof_file_url,
         payment_proof_file_name,
         payment_proof_uploaded_at
       FROM billing_payments
       WHERE order_id = ? AND tenant_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const payment = paymentRows[0] || null;
    const renewalAccountRows = await connection.query(
      `SELECT
         e.id AS entitlement_id,
         e.sip_user_id,
         DATE_FORMAT(e.service_expires_at, '%Y-%m-%d') AS service_expires_at,
         u.username,
         u.sip_domain,
         u.display_name
       FROM tenant_sip_account_entitlements e
       JOIN sip_users u ON u.id = e.sip_user_id
       WHERE e.tenant_id = ?
         AND (e.first_order_id = ? OR e.current_order_id = ? OR e.last_renewal_order_id = ?)
       ORDER BY u.username ASC, e.id ASC`,
      [request.admin.tenantId, orderId, orderId, orderId],
    );
    const retainedRows = await connection.query(
      `SELECT sip_user_id
       FROM billing_order_renewal_retained_accounts
       WHERE tenant_id = ? AND order_id = ?
       ORDER BY id ASC`,
      [request.admin.tenantId, orderId],
    );

    return response.json({
      order: {
        id: Number(order.id),
        orderNo: order.order_no || "",
        orderType: order.order_type || "new_purchase",
        renewalSourceOrderId: order.renewal_source_order_id == null ? null : Number(order.renewal_source_order_id),
        renewalBaseExpiresAt: order.renewal_base_expires_at ? String(order.renewal_base_expires_at).slice(0, 10) : "",
        currency: order.currency || "USD",
        subtotalAmount: Number(order.subtotal_amount || 0),
        discountAmount: Number(order.discount_amount || 0),
        payableAmount: Number(order.payable_amount || 0),
        orderStatus: order.order_status || "",
        paymentStatus: order.payment_status || "",
        paymentMethod: order.payment_method || "",
        paymentChannel: order.payment_channel || "",
        billingAddress: order.billing_address || "",
        reviewedAt: order.reviewed_at || "",
        reviewNote: order.review_note || "",
        effectiveAt: order.effective_at || "",
        expiresAt: order.expires_at || "",
        payment: payment
          ? {
              actualAmount: Number(payment.payment_amount || 0),
              paymentDate: payment.paid_at || "",
              proofUrl: payment.payment_proof_file_url || "",
              proofFileName: payment.payment_proof_file_name || "",
              proofUploadedAt: payment.payment_proof_uploaded_at ? String(payment.payment_proof_uploaded_at) : "",
            }
          : null,
        editable: !["review_approved", "review_rejected"].includes(order.order_status),
        planCode: planItem?.item_code || "",
        quantity: Number(planItem?.quantity || 1),
        months: Number(planItem?.months || 1),
        addonCodes: addonItems.map((item) => item.item_code).filter(Boolean),
        renewalAccounts: renewalAccountRows.map((account) => ({
          entitlementId: Number(account.entitlement_id),
          sipUserId: Number(account.sip_user_id),
          username: account.username || "",
          sipDomain: account.sip_domain || "",
          displayName: account.display_name || "",
          serviceExpiresAt: account.service_expires_at || "",
        })),
        retainedSipUserIds: retainedRows.map((row) => Number(row.sip_user_id)),
        coupon: order.coupon_code
          ? {
              couponCode: order.coupon_code,
              discountType: order.coupon_discount_type || "",
              discountValue: Number(order.coupon_discount_value || 0),
              validUntil: order.coupon_valid_until ? String(order.coupon_valid_until).slice(0, 10) : "",
            }
          : null,
        items: itemRows.map((item) => ({
          itemType: item.item_type || "",
          itemCode: item.item_code || "",
          itemName: item.item_name || "",
          accountQuantity: item.account_quantity == null ? null : Number(item.account_quantity),
          quantity: Number(item.quantity || 0),
          months: Number(item.months || 0),
          currency: item.currency || "USD",
          unitPrice: Number(item.unit_price || 0),
          discountAmount: Number(item.discount_amount || 0),
          lineAmount: Number(item.line_amount || 0),
        })),
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "璁€鍙栬▊鍠┏鎯呭け鏁椼€?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/billing/orders/:id", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "璦傚柈綬ㄨ櫉鐒℃晥銆?" });

  const payload = request.body || {};
  const paymentMethod = sanitizeString(payload.paymentMethod, 20);
  const paymentChannel = sanitizeString(payload.paymentChannel, 80);
  const billingAddress = sanitizeString(payload.billingAddress, 500);
  if (!["online", "offline"].includes(paymentMethod)) return response.status(400).json({ message: "請選擇支付方式。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const existingRows = await connection.query(
      `SELECT id, order_status, payment_status
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const existing = existingRows[0];
    if (!existing) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌▊鍠€?" });
    }
    if (["review_approved", "review_rejected"].includes(existing.order_status)) {
      await connection.rollback();
      return response.status(409).json({ message: "瀹℃牳閫氳繃鎴栧鏍告湭閫氳繃鐨勮鍗曚笉鍏佽淇敼銆?" });
    }

    const draft = await buildBillingOrderDraft(connection, request, payload);
    const nextOrderStatus = "pending_payment";
    const nextPaymentStatus = "unpaid";
    const nextPaymentRecordStatus = "pending";
    let staleProofUrl = "";
    await connection.query(
      `UPDATE billing_orders
       SET currency = ?, subtotal_amount = ?, discount_amount = ?, payable_amount = ?,
           paid_amount = ?, order_status = ?, payment_status = ?,
           payment_method = ?, payment_channel = ?, billing_address = ?,
           coupon_id = ?, coupon_code = ?, coupon_discount_type = ?, coupon_discount_value = ?,
           effective_at = NULL, expires_at = NULL,
           reviewed_at = NULL, reviewed_by_platform_admin_id = NULL, review_note = NULL,
           updated_by_admin_user_id = ?
       WHERE id = ? AND tenant_id = ?`,
      [
        draft.currency,
        draft.subtotal,
        draft.discountAmount,
        draft.payableAmount,
        0,
        nextOrderStatus,
        nextPaymentStatus,
        paymentMethod,
        paymentChannel || null,
        billingAddress || null,
        draft.coupon ? Number(draft.coupon.id) : null,
        draft.coupon ? draft.coupon.coupon_code : null,
        draft.coupon ? draft.coupon.discount_type : null,
        draft.coupon ? Number(draft.coupon.discount_value) : null,
        request.admin.id,
        orderId,
        request.admin.tenantId,
      ],
    );

    await connection.query(`DELETE FROM billing_order_items WHERE order_id = ? AND tenant_id = ?`, [orderId, request.admin.tenantId]);
    for (const item of draft.orderItems) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          item.itemType,
          item.planId,
          item.addonId,
          item.couponId,
          item.itemCode,
          item.itemName,
          item.accountQuantity,
          item.quantity,
          item.months,
          draft.currency,
          item.unitPrice,
          item.discountAmount,
          item.lineAmount,
          item.sortOrder,
        ],
      );
    }

    const offlineAccountId = paymentMethod === "offline" ? await findOfflinePaymentAccountId(connection, request.admin.tenantId) : null;
    const paymentRows = await connection.query(
      `SELECT id, payment_proof_file_url FROM billing_payments WHERE order_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    if (paymentRows[0]) {
      staleProofUrl = paymentRows[0].payment_proof_file_url || "";
      await connection.query(
        `UPDATE billing_payments
         SET payment_method = ?, payment_channel = ?, offline_payment_account_id = ?,
             payment_currency = ?, payment_amount = ?, payment_status = ?, paid_at = ?,
             payment_proof_file_url = NULL, payment_proof_file_name = NULL, payment_proof_uploaded_at = NULL,
             updated_by_admin_user_id = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          paymentMethod,
          paymentChannel || null,
          offlineAccountId,
          draft.currency,
          draft.payableAmount,
          nextPaymentRecordStatus,
          null,
          request.admin.id,
          Number(paymentRows[0].id),
          request.admin.tenantId,
        ],
      );
    } else {
      await connection.query(
        `INSERT INTO billing_payments (
           order_id, tenant_id, payment_no, payment_method, payment_channel,
           offline_payment_account_id, payment_currency, payment_amount, payment_status,
           paid_at, created_by_admin_user_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          makeBusinessNo("PAY"),
          paymentMethod,
          paymentChannel || null,
          offlineAccountId,
          draft.currency,
          draft.payableAmount,
          nextPaymentRecordStatus,
          null,
          request.admin.id,
        ],
      );
    }

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, from_order_status, to_order_status,
         from_payment_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        existing.order_status,
        nextOrderStatus,
        existing.payment_status,
        nextPaymentStatus,
        "update_order",
        request.admin.id,
      ],
    );

    await connection.commit();
    await removePaymentProofFile(staleProofUrl);
    return response.json({ message: "璦傚柈宸叉洿鏂幫紝鍘熶粯嬈懼嚟璇佸凡娓呯┖錛岃閲嶆柊涓婁紶浠樻鍑瘉銆?", order: { id: orderId, currency: draft.currency, payableAmount: draft.payableAmount } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "淇敼璦傚柈澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/repurchase", requireAdmin, async (request, response) => {
  const sourceOrderId = Number(request.params.id);
  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) return response.status(400).json({ message: "璁㈠崟緙栧彿鏃犳晥銆?" });

  const payload = request.body || {};
  const requestedPaymentMethod = sanitizeString(payload.paymentMethod, 20);
  const requestedPaymentChannel = sanitizeString(payload.paymentChannel, 80);
  const requestedBillingAddress = sanitizeString(payload.billingAddress, 500);
  const requestedCouponCode = sanitizeString(payload.couponCode, 80).toUpperCase();
  const requestedTenantCouponId = Number(payload.tenantCouponId || payload.couponAssignmentId || 0);

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const sourceRows = await connection.query(
      `SELECT
         id, currency, subtotal_amount, discount_amount, payable_amount,
         payment_method, payment_channel, billing_address
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [sourceOrderId, request.admin.tenantId],
    );
    const source = sourceRows[0];
    if (!source) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒板師璁㈠崟銆?" });
    }

    const itemRows = await connection.query(
      `SELECT
         item.item_type, item.plan_id, item.addon_id, item.coupon_id, item.item_code, item.item_name, item.description,
         item.account_quantity, item.quantity, item.months, item.currency, item.unit_price, item.discount_amount,
         item.line_amount, item.sort_order, pa.sync_with_plan_term
       FROM billing_order_items
       AS item
       LEFT JOIN billing_plan_addons pa ON pa.plan_id = item.plan_id AND pa.addon_id = item.addon_id
       WHERE item.order_id = ? AND item.tenant_id = ?
       ORDER BY item.sort_order ASC, item.id ASC`,
      [sourceOrderId, request.admin.tenantId],
    );
    if (itemRows.length === 0) {
      await connection.rollback();
      return response.status(409).json({ message: "鍘熻鍗曟病鏈夊彲澶嶅埗鐨勬槑緇嗐€?" });
    }

    const paymentMethod = ["online", "offline"].includes(requestedPaymentMethod) ? requestedPaymentMethod : source.payment_method;
    const paymentChannel = requestedPaymentChannel || (paymentMethod === source.payment_method ? source.payment_channel : paymentMethod === "offline" ? "bank_transfer" : null);
    const billingAddress = requestedBillingAddress || source.billing_address || null;
    const isOnlinePaid = paymentMethod === "online";

    let coupon = null;
    let discountAmount = 0;
    if (requestedTenantCouponId > 0 || requestedCouponCode) {
      coupon = await loadTenantCouponForOrder(connection, request.admin.tenantId, { tenantCouponId: requestedTenantCouponId, couponCode: requestedCouponCode, forUpdate: true });
      if (!coupon) {
        await connection.rollback();
        return response.status(404).json({ message: "此租戶不存在該優惠碼或已被使用。" });
      }
      if (coupon.discount_type === "percent") discountAmount = Number(source.subtotal_amount || 0) * (Number(coupon.discount_value) / 100);
      if (coupon.discount_type === "fixed_amount") discountAmount = Math.min(Number(source.subtotal_amount || 0), Number(coupon.discount_value));
    }
    const payableAmount = Math.max(0, Number(source.subtotal_amount || 0) - discountAmount);

    const initialOrderStatus = isOnlinePaid ? "payment_submitted" : "pending_payment";
    const initialPaymentStatus = isOnlinePaid ? 'paid' : "unpaid";
    const initialPaymentRecordStatus = isOnlinePaid ? 'paid' : "pending";
    const orderNo = makeBusinessNo("ORD");
    const orderResult = await connection.query(
      `INSERT INTO billing_orders (
         tenant_id, order_no, currency, subtotal_amount, discount_amount, payable_amount,
         paid_amount, order_status, payment_status, payment_method, payment_channel, billing_address,
         coupon_id, coupon_code, coupon_discount_type, coupon_discount_value, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.admin.tenantId,
        orderNo,
        source.currency || "USD",
        Number(source.subtotal_amount || 0),
        discountAmount,
        payableAmount,
        isOnlinePaid ? payableAmount : 0,
        initialOrderStatus,
        initialPaymentStatus,
        paymentMethod,
        paymentChannel || null,
        billingAddress,
        coupon ? Number(coupon.id) : null,
        coupon ? coupon.coupon_code : null,
        coupon ? coupon.discount_type : null,
        coupon ? Number(coupon.discount_value) : null,
        request.admin.id,
      ],
    );
    const orderId = Number(orderResult.insertId);

    for (const item of itemRows) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           description, account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          item.item_type,
          item.plan_id == null ? null : Number(item.plan_id),
          item.addon_id == null ? null : Number(item.addon_id),
          item.coupon_id == null ? null : Number(item.coupon_id),
          item.item_code || null,
          item.item_name,
          item.description || null,
          item.account_quantity == null ? null : Number(item.account_quantity),
          Number(item.quantity || 1),
          Number(item.months || 1),
          item.currency || source.currency || "USD",
          Number(item.unit_price || 0),
          Number(item.discount_amount || 0),
          Number(item.line_amount || 0),
          Number(item.sort_order || 0),
        ],
      );
    }

    if (coupon && discountAmount > 0) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           description, account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, 'discount', NULL, NULL, ?, ?, '優惠折扣', NULL, NULL, 1, 1, ?, 0, ?, ?, 90)`,
        [orderId, request.admin.tenantId, Number(coupon.id), coupon.coupon_code, source.currency || "USD", discountAmount, -discountAmount],
      );
      await connection.query(
        `UPDATE billing_tenant_coupons SET used_at = NOW(), used_order_id = ? WHERE id = ?`,
        [orderId, Number(coupon.tenant_coupon_id)],
      );
      await connection.query(
        `UPDATE billing_coupons SET redeemed_count = redeemed_count + 1 WHERE id = ?`,
        [Number(coupon.id)],
      );
    }

    const offlineAccountId = paymentMethod === "offline" ? await findOfflinePaymentAccountId(connection, request.admin.tenantId) : null;
    await connection.query(
      `INSERT INTO billing_payments (
         order_id, tenant_id, payment_no, payment_method, payment_channel,
         offline_payment_account_id, payment_currency, payment_amount, payment_status,
         paid_at, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        makeBusinessNo("PAY"),
        paymentMethod,
        paymentChannel || null,
        offlineAccountId,
        source.currency || "USD",
        payableAmount,
        initialPaymentRecordStatus,
        isOnlinePaid ? new Date() : null,
        request.admin.id,
      ],
    );

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, to_order_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, request.admin.tenantId, initialOrderStatus, initialPaymentStatus, "repurchase_order", request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({
      message: paymentMethod === "offline" ? "閲嶆柊璐拱璁㈠崟宸蹭繚瀛樸€?" : "閲嶆柊璐拱璁㈠崟宸插緩絝嬨€?",
      order: {
        id: orderId,
        orderNo,
        sourceOrderId,
        currency: source.currency || "USD",
        payableAmount: payableAmount,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "閲嶆柊璐拱璁㈠崟鐢熸垚澶辮觸銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/renew", requireAdmin, async (request, response) => {
  const sourceOrderId = Number(request.params.id);
  if (!Number.isInteger(sourceOrderId) || sourceOrderId <= 0) return response.status(400).json({ message: "訂單編號無效。" });

  const payload = request.body || {};
  const requestedPaymentMethod = sanitizeString(payload.paymentMethod, 20);
  const requestedPaymentChannel = sanitizeString(payload.paymentChannel, 80);
  const requestedBillingAddress = sanitizeString(payload.billingAddress, 500);
  const requestedQuantity = Math.max(1, Number(payload.quantity || 1));
  const requestedMonths = Math.max(1, Number(payload.months || 1));
  const requestedRetainedSipUserIds = Array.isArray(payload.retainedSipUserIds)
    ? Array.from(new Set(payload.retainedSipUserIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)))
    : [];
  const formatSqlDate = (value) => {
    if (!value) return null;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const sourceRows = await connection.query(
      `SELECT
         id, order_status, DATE_FORMAT(expires_at, '%Y-%m-%d') AS expires_at, currency, subtotal_amount, discount_amount, payable_amount,
         payment_method, payment_channel, billing_address,
         coupon_id, coupon_code, coupon_discount_type, coupon_discount_value
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [sourceOrderId, request.admin.tenantId],
    );
    const source = sourceRows[0];
    if (!source) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到原訂單。" });
    }
    if (source.order_status !== "review_approved") {
      await connection.rollback();
      return response.status(409).json({ message: "只有已生效或已過期的訂單可以進行訂單續訂。" });
    }

    const entitlementRows = await connection.query(
      `SELECT
         e.id,
         e.sip_user_id,
         DATE_FORMAT(e.service_expires_at, '%Y-%m-%d') AS service_expires_at,
         u.username,
         u.sip_domain,
         u.display_name
       FROM tenant_sip_account_entitlements e
       JOIN sip_users u ON u.id = e.sip_user_id
       WHERE e.tenant_id = ?
         AND (e.first_order_id = ? OR e.current_order_id = ? OR e.last_renewal_order_id = ?)
       ORDER BY u.username ASC, e.id ASC
       FOR UPDATE`,
      [request.admin.tenantId, sourceOrderId, sourceOrderId, sourceOrderId],
    );
    if (entitlementRows.length === 0) {
      await connection.rollback();
      return response.status(409).json({ message: "原訂單沒有可續訂的帳號權益，請聯絡平臺管理員處理。" });
    }

    const itemRows = await connection.query(
      `SELECT
         item.item_type, item.plan_id, item.addon_id, item.coupon_id, item.item_code, item.item_name, item.description,
         item.account_quantity, item.quantity, item.months, item.currency, item.unit_price, item.discount_amount,
         item.line_amount, item.sort_order, pa.sync_with_plan_term
       FROM billing_order_items AS item
       LEFT JOIN billing_plan_addons pa ON pa.plan_id = item.plan_id AND pa.addon_id = item.addon_id
       WHERE item.order_id = ? AND item.tenant_id = ?
       ORDER BY item.sort_order ASC, item.id ASC`,
      [sourceOrderId, request.admin.tenantId],
    );
    if (itemRows.length === 0) {
      await connection.rollback();
      return response.status(409).json({ message: "原訂單沒有可續訂的明細。" });
    }

    const paymentMethod = ["online", "offline"].includes(requestedPaymentMethod) ? requestedPaymentMethod : source.payment_method;
    const paymentChannel = requestedPaymentChannel || (paymentMethod === source.payment_method ? source.payment_channel : paymentMethod === "offline" ? "bank_transfer" : null);
    const billingAddress = requestedBillingAddress || source.billing_address || null;
    const isOnlinePaid = paymentMethod === "online";
    const initialOrderStatus = isOnlinePaid ? "payment_submitted" : "pending_payment";
    const initialPaymentStatus = isOnlinePaid ? 'paid' : "unpaid";
    const initialPaymentRecordStatus = isOnlinePaid ? 'paid' : "pending";
    const orderNo = makeBusinessNo("ORD");
    const renewalBaseExpiresAt = formatSqlDate(source.expires_at);
    console.log("[renew-debug] source.expires_at =", source.expires_at, "renewalBaseExpiresAt =", renewalBaseExpiresAt);
    const sourcePlanItem = itemRows.find((item) => item.item_type === "plan");
    if (!sourcePlanItem) {
      await connection.rollback();
      return response.status(409).json({ message: "原訂單缺少套餐明細，不能續訂。" });
    }
    const sourceQuantity = Math.max(1, Number(sourcePlanItem.quantity || 1));
    const sourceAccountCount = Number(sourcePlanItem.account_quantity || entitlementRows.length || 0);
    const accountsPerQuantity = Math.max(1, Math.round(sourceAccountCount / sourceQuantity));
    const requestedAccountCount = accountsPerQuantity * requestedQuantity;
    if (requestedAccountCount > entitlementRows.length) {
      await connection.rollback();
      return response.status(409).json({ message: "當前續訂暫不支援增加帳號數量，請使用重新購買或等待增量續訂功能。" });
    }
    if (requestedRetainedSipUserIds.length > requestedAccountCount) {
      await connection.rollback();
      return response.status(400).json({ message: `本次續訂最多保留 ${requestedAccountCount} 個帳號，請調整保留帳號選擇。` });
    }
    const retainedEntitlements = entitlementRows.filter((item) => requestedRetainedSipUserIds.includes(Number(item.sip_user_id)));
    if (retainedEntitlements.length !== requestedRetainedSipUserIds.length) {
      await connection.rollback();
      return response.status(400).json({ message: "保留帳號中包含不屬於原訂單的帳號，請重新整理後重試。" });
    }

    const renewalItems = [];
    let subtotal = 0;
    itemRows.forEach((item) => {
      if (item.item_type === "discount") return;
      const quantity = requestedQuantity;
      const itemMonths = item.item_type === "plan"
        ? requestedMonths
        : item.sync_with_plan_term == null || Boolean(item.sync_with_plan_term)
          ? requestedMonths
          : Math.max(1, Number(item.months || 1));
      const lineAmount = Number(item.unit_price || 0) * quantity * itemMonths;
      subtotal += lineAmount;
      renewalItems.push({
        ...item,
        quantity,
        months: itemMonths,
        account_quantity: item.item_type === "plan" ? requestedAccountCount : item.account_quantity,
        lineAmount,
      });
    });
    let discountAmount = 0;
    if (source.coupon_discount_type === "percent") {
      discountAmount = subtotal * (Number(source.coupon_discount_value || 0) / 100);
    } else if (source.coupon_discount_type === "fixed_amount") {
      discountAmount = Math.min(subtotal, Number(source.coupon_discount_value || 0));
    }
    if (discountAmount > 0 || source.coupon_id) {
      renewalItems.push({
        item_type: "discount",
        plan_id: null,
        addon_id: null,
        coupon_id: source.coupon_id ? Number(source.coupon_id) : null,
        item_code: source.coupon_code || null,
        item_name: "優惠折扣",
        description: null,
        account_quantity: null,
        quantity: 1,
        months: 1,
        currency: source.currency || "USD",
        unit_price: 0,
        discount_amount: discountAmount,
        lineAmount: -discountAmount,
        sort_order: 90,
      });
    }
    const payableAmount = Math.max(0, subtotal - discountAmount);
    const orderResult = await connection.query(
      `INSERT INTO billing_orders (
         tenant_id, order_no, order_type, renewal_source_order_id, renewal_base_expires_at,
         currency, subtotal_amount, discount_amount, payable_amount,
         paid_amount, order_status, payment_status, payment_method, payment_channel, billing_address,
         coupon_id, coupon_code, coupon_discount_type, coupon_discount_value, created_by_admin_user_id
       )
       VALUES (?, ?, 'renewal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.admin.tenantId,
        orderNo,
        sourceOrderId,
        formatSqlDate(renewalBaseExpiresAt),
        source.currency || "USD",
        subtotal,
        discountAmount,
        payableAmount,
        isOnlinePaid ? payableAmount : 0,
        initialOrderStatus,
        initialPaymentStatus,
        paymentMethod,
        paymentChannel || null,
        billingAddress,
        source.coupon_id ? Number(source.coupon_id) : null,
        source.coupon_code || null,
        source.coupon_discount_type || null,
        source.coupon_discount_value == null ? null : Number(source.coupon_discount_value),
        request.admin.id,
      ],
    );
    const orderId = Number(orderResult.insertId);

    for (const item of renewalItems) {
      await connection.query(
        `INSERT INTO billing_order_items (
           order_id, tenant_id, item_type, plan_id, addon_id, coupon_id, item_code, item_name,
           description, account_quantity, quantity, months, currency, unit_price, discount_amount, line_amount, sort_order
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          request.admin.tenantId,
          item.item_type,
          item.plan_id == null ? null : Number(item.plan_id),
          item.addon_id == null ? null : Number(item.addon_id),
          item.coupon_id == null ? null : Number(item.coupon_id),
          item.item_code || null,
          item.item_name,
          item.description || null,
          item.account_quantity == null ? null : Number(item.account_quantity),
          Number(item.quantity || 1),
          Number(item.months || 1),
          item.currency || source.currency || "USD",
          Number(item.unit_price || 0),
          Number(item.discount_amount || 0),
          Number(item.lineAmount || item.line_amount || 0),
          Number(item.sort_order || 0),
        ],
      );
    }

    for (const account of retainedEntitlements) {
      await connection.query(
        `INSERT INTO billing_order_renewal_retained_accounts (
           order_id, source_order_id, tenant_id, sip_user_id, entitlement_id,
           username, sip_domain, display_name, source_service_expires_at, created_by_admin_user_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          sourceOrderId,
          request.admin.tenantId,
          Number(account.sip_user_id),
          Number(account.id),
          account.username || null,
          account.sip_domain || null,
          account.display_name || null,
          account.service_expires_at || null,
          request.admin.id,
        ],
      );
    }

    const offlineAccountId = paymentMethod === "offline" ? await findOfflinePaymentAccountId(connection, request.admin.tenantId) : null;
    await connection.query(
      `INSERT INTO billing_payments (
         order_id, tenant_id, payment_no, payment_method, payment_channel,
         offline_payment_account_id, payment_currency, payment_amount, payment_status,
         paid_at, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        makeBusinessNo("PAY"),
        paymentMethod,
        paymentChannel || null,
        offlineAccountId,
        source.currency || "USD",
        payableAmount,
        initialPaymentRecordStatus,
        isOnlinePaid ? new Date() : null,
        request.admin.id,
      ],
    );

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, to_order_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, request.admin.tenantId, initialOrderStatus, initialPaymentStatus, "renewal_order", request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({
      message: paymentMethod === "offline" ? "訂單續訂已儲存。" : "訂單續訂已建立。",
      order: {
        id: orderId,
        orderNo,
        sourceOrderId,
        orderType: "renewal",
        renewalBaseExpiresAt,
        currency: source.currency || "USD",
        payableAmount,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "訂單續訂生成失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/payment-proof", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "璁㈠崟緙栧彿鏃犳晥銆?" });

  const payload = request.body || {};
  const actualAmount = Number(payload.actualAmount);
  const paymentDate = sanitizeString(payload.paymentDate, 20);
  const proofImageDataUrl = String(payload.proofImageDataUrl || "");
  const originalFileName = sanitizeString(payload.fileName, 255) || "payment-proof.png";

  if (!Number.isFinite(actualAmount) || actualAmount <= 0) return response.status(400).json({ message: "請輸入有效的實付金額。" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return response.status(400).json({ message: "請選擇有效的付款日期。" });

  const match = proofImageDataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return response.status(400).json({ message: "璇蜂笂浼犳垨綺樿創 PNG銆丣PG銆乄EBP 鏍煎紡鐨勪粯嬈懼嚟璇佹埅鍥俱€?" });

  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) return response.status(400).json({ message: "浠樻鍑瘉鍥劇墖澶у皬闇€灝忎簬 8MB銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const orderRows = await connection.query(
      `SELECT id, order_status, payment_status, payment_method, currency, payable_amount
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const order = orderRows[0];
    if (!order) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌鍗曘€?" });
    }
    if (order.payment_method !== "offline") {
      await connection.rollback();
      return response.status(409).json({ message: "鍙湁綰誇笅鏀粯璁㈠崟鍙互涓婁紶浠樻鍑瘉銆?" });
    }
    if (!["pending_payment", "payment_submitted", "pending_review"].includes(order.order_status)) {
      await connection.rollback();
      return response.status(409).json({ message: "褰撳墠璁㈠崟鐘舵€佷笉鑳戒笂浼犱粯嬈懼嚟璇併€?" });
    }

    const proofDir = path.resolve("assets/payment-proofs");
    await mkdir(proofDir, { recursive: true });
    const safeName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
    const fileName = `${request.admin.tenantId}-${orderId}-${Date.now()}-${safeName.replace(/\.[^.]+$/, "")}.${ext}`;
    const filePath = path.join(proofDir, fileName);
    await writeFile(filePath, buffer);
    const proofUrl = `/payment-proofs/${fileName}`;

    const paymentRows = await connection.query(
      `SELECT id FROM billing_payments
       WHERE order_id = ? AND tenant_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const offlineAccountId = await findOfflinePaymentAccountId(connection, request.admin.tenantId);
    if (paymentRows[0]) {
      await connection.query(
        `UPDATE billing_payments
         SET payment_method = 'offline',
             payment_channel = COALESCE(payment_channel, 'bank_transfer'),
             offline_payment_account_id = ?,
             payment_currency = ?,
             payment_amount = ?,
             payment_status = 'paid',
             paid_at = ?,
             payment_proof_file_url = ?,
             payment_proof_file_name = ?,
             payment_proof_uploaded_at = NOW(),
             updated_by_admin_user_id = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          offlineAccountId,
          order.currency || "USD",
          actualAmount,
          paymentDate,
          proofUrl,
          originalFileName,
          request.admin.id,
          Number(paymentRows[0].id),
          request.admin.tenantId,
        ],
      );
    } else {
      await connection.query(
        `INSERT INTO billing_payments (
           order_id, tenant_id, payment_no, payment_method, payment_channel,
           offline_payment_account_id, payment_currency, payment_amount, payment_status,
           paid_at, payment_proof_file_url, payment_proof_file_name, payment_proof_uploaded_at,
           created_by_admin_user_id
         )
         VALUES (?, ?, ?, 'offline', 'bank_transfer', ?, ?, ?, 'paid', ?, ?, ?, NOW(), ?)`,
        [
          orderId,
          request.admin.tenantId,
          makeBusinessNo("PAY"),
          offlineAccountId,
          order.currency || "USD",
          actualAmount,
          paymentDate,
          proofUrl,
          originalFileName,
          request.admin.id,
        ],
      );
    }

    const nextOrderStatus = order.order_status === "pending_review" ? "pending_review" : "payment_submitted";
    const nextPaymentStatus = 'paid';
    await connection.query(
      `UPDATE billing_orders
       SET order_status = ?,
           payment_status = ?,
           paid_amount = ?,
           updated_by_admin_user_id = ?
       WHERE id = ? AND tenant_id = ?`,
      [nextOrderStatus, nextPaymentStatus, actualAmount, request.admin.id, orderId, request.admin.tenantId],
    );

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, from_order_status, to_order_status,
         from_payment_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        order.order_status,
        nextOrderStatus,
        order.payment_status,
        nextPaymentStatus,
        "upload_payment_proof",
        request.admin.id,
      ],
    );

    await connection.commit();
    return response.json({
      message: "浠樻鍑瘉宸蹭繚瀛橈紝騫跺凡鍏寵仈鍒拌璁㈠崟銆?",
      payment: {
        proofUrl,
        actualAmount,
        paymentDate,
        payableAmount: Number(order.payable_amount || 0),
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "浠樻鍑瘉淇濆瓨澶辮觸銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/billing/orders/:id/review-submission", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "璁㈠崟緙栧彿鏃犳晥銆?" });

  const action = sanitizeString(request.body?.action, 20);
  if (!["submit", "revoke"].includes(action)) return response.status(400).json({ message: "錼嶄綔綾誨瀷鏃犳晥銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, order_status, payment_status
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const order = rows[0];
    if (!order) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌鍗曘€?" });
    }

    let nextOrderStatus = "";
    let reason = "";
    if (action === "submit") {
      if (order.order_status === "review_approved") {
        await connection.rollback();
        return response.status(409).json({ message: "稽核通過的訂單不允許再次提交稽核。" });
      }
      if (order.payment_status !== 'paid') {
        await connection.rollback();
        return response.status(409).json({ message: "訂單尚未完成支付，請先上傳付款憑證或完成支付。" });
      }
      if (!["payment_submitted", "review_rejected"].includes(order.order_status)) {
        await connection.rollback();
        return response.status(409).json({ message: "只有已支付未提交或稽核未通過的訂單可以提交稽核。" });
      }
      nextOrderStatus = "pending_review";
      reason = order.order_status === "review_rejected" ? "resubmit_review" : "submit_review";
    }
    if (action === "revoke") {
      if (order.order_status !== "pending_review") {
        await connection.rollback();
        return response.status(409).json({ message: "鍙湁宸叉彁浜や笖鏈鏍哥殑璁㈠崟鍙互鎾ら攢鎻愪氦銆?" });
      }
      nextOrderStatus = "payment_submitted";
      reason = "revoke_review";
    }

    await connection.query(
      `UPDATE billing_orders
       SET order_status = ?,
           reviewed_at = NULL, reviewed_by_platform_admin_id = NULL, review_note = NULL,
           updated_by_admin_user_id = ?
       WHERE id = ? AND tenant_id = ?`,
      [nextOrderStatus, request.admin.id, orderId, request.admin.tenantId],
    );
    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, from_order_status, to_order_status,
         from_payment_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        request.admin.tenantId,
        order.order_status,
        nextOrderStatus,
        order.payment_status,
        order.payment_status,
        reason,
        request.admin.id,
      ],
    );

    await connection.commit();

    // Notify platform admins when tenant submits for review
    if (action === "submit") {
      const [tenantName] = await connection.query("SELECT name FROM tenants WHERE id = ?", [request.admin.tenantId]);
      const tn = tenantName ? (tenantName.name || "") : "";
      const dedupeKey = "platform:order:" + orderId + ":pending_review";
      await connection.query(
        "INSERT INTO notification_events (tenant_id, scope_type, scope_id, event_type, sender_type, sender_id, dedupe_key, title, body, severity, status) VALUES (?, 'billing_order', ?, 'order_pending_review', 'tenant_admin', ?, ?, ?, ?, 'warning', 'active') ON DUPLICATE KEY UPDATE status='active', resolved_at=NULL, updated_at=CURRENT_TIMESTAMP",
        [request.admin.tenantId, orderId, request.admin.id, dedupeKey, "訂單待審核", "租戶 " + tn + " 的訂單 " + (order.order_no || "") + " 已提交稽核。"]
      );
      const platformAdmins = await connection.query("SELECT id FROM admin_users WHERE account_type='platform' AND status='active'");
      const [newEvent] = await connection.query("SELECT id FROM notification_events WHERE dedupe_key = ?", [dedupeKey]);
      if (newEvent) {
        for (const pa of platformAdmins) {
          await connection.query("INSERT IGNORE INTO notification_receipts (event_id, admin_user_id, receiver_type) VALUES (?, ?, 'admin')", [newEvent.id, pa.id]);
        }
      }
    }
    return response.json({ message: action === "submit" ? "璁㈠崟宸叉彁浜ゅ鏍搞€?" : "宸叉挙閿€鎻愪氦銆?" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "璁㈠崟瀹℃牳鎻愪氦錼嶄綔澶辮觸銆?" });
  } finally {
    if (connection) connection.release();
  }
});
app.delete("/api/billing/orders/:id", requireAdmin, async (request, response) => {
  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "璦傚柈綬ㄨ櫉鐒℃晥銆?" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, order_status, payment_status
       FROM billing_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [orderId, request.admin.tenantId],
    );
    const order = rows[0];
    if (!order) {
      await connection.rollback();
      return response.status(404).json({ message: "鎵句笉鍒拌▊鍠€?" });
    }
    if (order.order_status !== "pending_payment" || order.payment_status !== "unpaid") {
      await connection.rollback();
      return response.status(409).json({ message: "鍙湁鏈敮浠樿▊鍠彲浠ュ埅闄ゃ€?" });
    }

    await connection.query(`DELETE FROM billing_orders WHERE id = ? AND tenant_id = ?`, [orderId, request.admin.tenantId]);
    await connection.commit();
    return response.json({ message: "璦傚柈宸插埅闄ゃ€?" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error(error);
    return response.status(500).json({ message: "鍒櫎璦傚柈澶辨晽銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/settings", requireAdmin, async (request, response) => {
  const payload = request.body || {};
  const companyName = sanitizeString(payload.companyName, 160);
  const enterpriseEmail = normalizeEmail(payload.enterpriseEmail);
  const contactPerson = sanitizeString(payload.contactPerson, 120);
  const contactPhone = sanitizeString(payload.contactPhone, 40);
  const billingAddress = sanitizeString(payload.billingAddress, 500);
  const postalCode = sanitizeString(payload.postalCode, 20);
  const adminNickname = sanitizeString(payload.adminNickname, 80);
  const adminPhone = sanitizeString(payload.adminPhone, 40);

  if (!companyName) return response.status(400).json({ message: "請輸入公司名稱。" });
  if (enterpriseEmail && !isValidEmail(enterpriseEmail)) {
    return response.status(400).json({ message: "請輸入有效的企業信箱。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    await connection.query(
      `UPDATE tenants
       SET name = ?, contact_email = ?, enterprise_email = ?, contact_person = ?,
           contact_phone = ?, billing_address = ?, postal_code = ?
       WHERE id = ?`,
      [companyName, enterpriseEmail || null, enterpriseEmail || null, contactPerson || null, contactPhone || null, billingAddress || null, postalCode || null, request.admin.tenantId],
    );

    await connection.query(
      `UPDATE admin_users
       SET nickname = ?, phone_number = ?
       WHERE id = ?`,
      [adminNickname || null, adminPhone || null, request.admin.id],
    );

    await connection.commit();
    return response.json({ message: "租戶設定已儲存。" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "無法儲存租戶設定。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/login-email-change/request-code", requireAdmin, async (request, response) => {
  const newEmail = normalizeEmail(request.body.newEmail);
  const oldPassword = String(request.body.oldPassword || "");
  const newPassword = String(request.body.newPassword || "");
  const confirmPassword = String(request.body.confirmPassword || "");

  if (!isValidEmail(newEmail)) return response.status(400).json({ message: "請輸入有效的新登入信箱。" });
  if (newPassword !== confirmPassword) return response.status(400).json({ message: "鍏╂杓稿靉鐨勬柊瀵嗙⒓涓嶄竴鑷淬€?" });
  const passwordError = validatePassword(newPassword);
  if (passwordError) return response.status(400).json({ message: passwordError });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const admins = await connection.query(
      `SELECT id, email, password_hash
       FROM admin_users
       WHERE id = ?
       LIMIT 1`,
      [request.admin.id],
    );
    const admin = admins[0];
    if (!admin || !(await verifyPassword(oldPassword, admin.password_hash))) {
      await connection.rollback();
      return response.status(401).json({ message: "鑸婂瘑紕間笉姝ｇ⒑銆?" });
    }

    const existing = await connection.query(
      `SELECT id FROM admin_users WHERE email = ? AND id <> ? LIMIT 1`,
      [newEmail, request.admin.id],
    );
    if (existing.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "姝ょ櫥鍏ヤ俊綆卞凡琚嬌鐢ㄣ€?" });
    }

    const recentCodes = await connection.query(
      `SELECT created_at
       FROM admin_email_change_codes
       WHERE admin_user_id = ? AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 5`,
      [request.admin.id],
    );
    if (recentCodes[0] && Date.now() - new Date(recentCodes[0].created_at).getTime() < 60 * 1000) {
      await connection.rollback();
      return response.status(429).json({ message: "璜嬬瓑寰?60 縐掑緦鍐嶅偝閫佹柊鐨勯璀夌⒓銆?" });
    }
    const sentInTenMinutes = recentCodes.filter((code) => Date.now() - new Date(code.created_at).getTime() < 10 * 60 * 1000);
    if (sentInTenMinutes.length >= 5) {
      await connection.rollback();
      return response.status(429).json({ message: "椹楄瓑紕煎偝閫佹鏁擱亷澶氾紝璜嬬◢寰屽啀瑭︺€?" });
    }

    const code = createNumericCode();
    const newPasswordHash = await hashPassword(newPassword);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await connection.query(
      `INSERT INTO admin_email_change_codes (admin_user_id, new_email, new_password_hash, code_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [request.admin.id, newEmail, newPasswordHash, hashToken(code), expiresAt],
    );

    await queueLoginEmailChangeCode(connection, { email: newEmail, code });
    await connection.commit();

    return response.json({ message: "椹楄瓑紕煎凡鍌抽€佽嚦鏂扮殑鐧誨靉淇＄銆?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶鍌抽€侀璀夌⒓銆?" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/login-email-change/confirm", requireAdmin, async (request, response) => {
  const newEmail = normalizeEmail(request.body.newEmail);
  const code = String(request.body.code || "").trim();

  if (!isValidEmail(newEmail) || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ message: "璜嬭幾鍏ユ柊淇＄鑸?6 浣嶆暩瀛楅璀夌⒓銆?" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, new_email, new_password_hash, code_hash, expires_at, attempt_count, used_at
       FROM admin_email_change_codes
       WHERE admin_user_id = ? AND new_email = ? AND used_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [request.admin.id, newEmail],
    );
    const change = rows[0];
    if (!change || new Date(change.expires_at).getTime() < Date.now()) {
      await connection.rollback();
      return response.status(400).json({ message: "椹楄瓑紕肩劇鏁堟垨宸查亷鏈熴€?" });
    }
    if (Number(change.attempt_count) >= 5) {
      await connection.rollback();
      return response.status(429).json({ message: "鍢楄│嬈℃暩閬庡錛岃珛閲嶆柊鍙栧緱椹楄瓑紕箋€?" });
    }

    if (change.code_hash !== hashToken(code)) {
      await connection.query(
        `UPDATE admin_email_change_codes SET attempt_count = attempt_count + 1 WHERE id = ?`,
        [Number(change.id)],
      );
      await connection.commit();
      return response.status(400).json({ message: "椹楄瓑紕間笉姝ｇ⒑銆?" });
    }

    const existing = await connection.query(
      `SELECT id FROM admin_users WHERE email = ? AND id <> ? LIMIT 1`,
      [newEmail, request.admin.id],
    );
    if (existing.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "姝ょ櫥鍏ヤ俊綆卞凡琚嬌鐢ㄣ€?" });
    }

    await connection.query(
      `UPDATE admin_users
       SET email = ?, password_hash = ?, email_verified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newEmail, change.new_password_hash, request.admin.id],
    );
    await connection.query(
      `UPDATE admin_email_change_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [Number(change.id)],
    );
    await connection.query(`DELETE FROM admin_sessions WHERE admin_user_id = ?`, [request.admin.id]);

    await connection.commit();
    return response.json({ message: "鐧誨靉淇＄鑸囧瘑紕煎凡鏇存柊錛岃珛閲嶆柊鐧誨靉銆?" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error(error);
    return response.status(500).json({ message: "鐒℃硶鏇存柊鐧誨靉淇＄銆?" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/sip-accounts - 取得帳號列表
app.get("/api/admin/sip-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視 SIP 帳號。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`
      SELECT
        u.id,
        u.username,
        u.sip_domain AS domain,
        u.display_name AS displayName,
        u.role,
        u.phone_number AS phone,
        u.email,
        u.status,
        u.created_at,
        c.display_name AS creator_name,
        e.external_username,
        e.external_domain AS externalDomain,
        e.external_password,
        e.realm,
        e.registrar,
        e.outbound_proxy,
        e.protocol,
        t.name AS tenant_name,
        ent.service_expires_at
      FROM sip_users u
      LEFT JOIN sip_external_accounts e ON u.id = e.sip_user_id
      LEFT JOIN admin_users c ON u.created_by_admin_user_id = c.id
      LEFT JOIN tenants t ON u.tenant_id = t.id
      LEFT JOIN tenant_sip_account_entitlements ent ON u.id = ent.sip_user_id AND u.tenant_id = ent.tenant_id AND ent.status = 'active'
      ORDER BY u.created_at DESC
    `);
    
    const accounts = rows.map(r => ({
      id: Number(r.id),
      username: r.username,
      domain: r.domain || '',
      displayName: r.displayName || '',
      role: r.role,
      phone: r.phone,
      email: r.email,
      status: r.status,
      externalUsername: r.external_username || '',
      externalDomain: r.externalDomain,
      externalPassword: r.external_password || '',
      externalRealm: r.realm || '',
      externalRegistrar: r.registrar || '',
      externalOutboundProxy: r.outbound_proxy || '',
      externalProtocol: r.protocol || '',
      createdAt: r.created_at ? new Date(r.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-') : '',
      creatorName: r.creator_name || '-',
      tenantName: r.tenant_name || '',
      expiresAt: r.service_expires_at || null
    }));

    console.log('【後端 DEBUG】GET /api/admin/sip-accounts 從資料庫查詢到的條數:', accounts.length);
    return response.json({ accounts });
  } catch (error) {
    console.error('Failed to fetch sip accounts:', error);
    return response.status(500).json({ message: '無法讀取 SIP 帳號列表' });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/admin/sip-accounts - 新增 SIP 帳號（整合 Flexisip Account Manager）
app.post("/api/admin/sip-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行帳號登記。" });
  }

  const payload = request.body || {};
  const username = String(payload.username || "").trim();
  const displayName = String(payload.displayName || "").trim();
  const domain = String(payload.domain || "").trim();
  const password = String(payload.password || "");
  const role = payload.role === "admin" ? "admin" : "user";
  const status = payload.status || 'active';
  const phone = String(payload.phone || "").trim();
  const email = String(payload.email || "").trim();

  // ── 步骤 1-2: 参数校验 ──
  if (!username || !domain || !password) {
    return response.status(400).json({ message: "缺少必填引數。" });
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(username)) {
    return response.status(400).json({ message: "使用者名稱格式無效。" });
  }
  if (password.length < 6) {
    return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
  }

  // ── 步骤 3: 本地唯一性校验 ──
  let connection;
  try {
    connection = await pool.getConnection();
    const existing = await connection.query(
      `SELECT id FROM sip_users WHERE username = ? AND sip_domain = ? LIMIT 1`,
      [username, domain],
    );
    if (existing.length > 0) {
      connection.release();
      return response.status(409).json({ message: "該使用者名稱已存在。" });
    }
    connection.release();
  } catch (err) {
    if (connection) connection.release();
    console.error("SIP account local duplicate check failed:", err.message);
    return response.status(500).json({ message: "帳號儲存失敗" });
  }

  // ── 步骤 4: 远端存在性检查 ──
  const sipUri = `sip:${username}@${domain}`;
  const sipAddress = `${username}@${domain}`;  // 用于 searchAccountBySip（不需要 sip: 前缀）
  let flexisipAccountId = null;
  let flexisipCreatePayload = null;

  try {
    await searchAccountBySip(sipAddress);
    // 远端帳號已存在
    return response.status(409).json({
      message: "該 SIP 帳號已在通訊服務中存在。",
      code: "FLEXISIP_ACCOUNT_ALREADY_EXISTS",
    });
  } catch (searchErr) {
    if (searchErr instanceof FlexisipAccountManagerError && searchErr.status === 404) {
      // 远端不存在，继续创建
    } else if (searchErr?.status === 404) {
      // 以其他方式返回的 404
    } else {
      console.error("Flexisip searchAccountBySip failed:", searchErr?.message || searchErr);
      return response.status(502).json({
        message: "無法驗證遠端帳號狀態，請稍後重試。",
        code: "FLEXISIP_SEARCH_FAILED",
      });
    }
  }

  // ── 步骤 5: 创建 Flexisip 帳號 ──
  // 测试已验证 createAccount 需要以下字段：
  //   username, sip (完整 SIP URI), password, algorithm ("SHA-256"), email, display_name
  flexisipCreatePayload = {
    username,
    sip: sipUri,
    password,
    algorithm: "SHA-256",  // Flexisip API 要求此字段，测试验证通过
    email: email || `${username}@${domain}`,
    display_name: displayName || username,
    ...(phone && /^\+?\d{7,}$/.test(phone.replace(/[\s\-\(\)]/g, '')) ? { phone: phone.replace(/[\s\-\(\)]/g, '') } : {}),
    role,
  };

  try {
    const flexisipResult = await flexisipCreateAccount(flexisipCreatePayload);
    // 提取远端 ID（测试确认返回格式为 { id: 64 }）
    flexisipAccountId = flexisipResult?.id || flexisipResult?.account?.id || flexisipResult?.userId;

    // 如果 createAccount 没有返回 id，尝试通过 search 查找
    if (!flexisipAccountId) {
      try {
        const searchResult = await searchAccountBySip(sipAddress);
        flexisipAccountId = searchResult?.id || searchResult?.account?.id;
      } catch {}
    }

    if (!flexisipAccountId) {
      console.error("Flexisip createAccount returned no id:", JSON.stringify(flexisipResult).substring(0, 200));
      return response.status(502).json({
        message: "遠端帳號建立成功但無法獲取 ID，請聯絡管理員。",
        code: "FLEXISIP_ACCOUNT_ID_MISSING",
      });
    }

    // createAccount 不会自动激活，必须显式调用 activateAccount
    await flexisipActivateAccount(flexisipAccountId);
  } catch (createErr) {
    console.error("Flexisip create/activate failed:", createErr?.message || createErr);

    // 检查 422 的具体原因：只有 username taken 才是 tombstone
    const is422 = createErr?.status === 422 || createErr?.status === 409;
    const errors = createErr?.responseBody?.errors || {};
    const isUsernameTaken = is422 && errors.username && errors.username.some(m => /already.*taken|has already/i.test(m));

    if (isUsernameTaken && !flexisipAccountId) {
      return response.status(409).json({
        message: "該 SIP 帳號已被刪除保留，是否徹底釋放後重新建立？",
        code: "FLEXISIP_USERNAME_TOMBSTONED",
        username,
        domain,
      });
    }

    // 其他 422 校验錯誤：直接返回 Flexisip 的錯誤訊息
    if (is422 && !flexisipAccountId) {
      const fieldErrors = Object.entries(errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ');
      return response.status(422).json({
        message: fieldErrors || createErr?.message || "遠端帳號建立失敗，請檢查輸入資料。",
        code: "FLEXISIP_VALIDATION_ERROR",
      });
    }

    // 如果依然沒有 flexisipAccountId（create 失敗且未恢復），回傳錯誤
    if (!flexisipAccountId) {
      return response.status(502).json({
        message: createErr?.status === 422 ? "該帳號已被佔用且無法恢復。" : "遠端通訊帳號建立失敗。",
        code: createErr?.status === 422 ? "FLEXISIP_USERNAME_TAKEN" : "FLEXISIP_CREATE_FAILED",
      });
    }

    // flexisipAccountId 有值但 activate 失敗 → 補償刪除
    console.error("Flexisip activate failed for id:", flexisipAccountId);
    try { await flexisipDeleteAccount(flexisipAccountId); } catch (cleanupErr) {
      console.error("FLEXISIP ACTIVATE FAILED - cleanup also failed. id:", flexisipAccountId, "sipUri:", sipUri, "cleanupErr:", cleanupErr?.message);
      return response.status(502).json({
        message: "遠端帳號建立後啟用失敗，且清理失敗，請聯絡管理員。",
        code: "FLEXISIP_ACTIVATE_FAILED_CLEANUP_FAILED",
      });
    }
    return response.status(502).json({
      message: "遠端帳號啟用失敗，已回滾。",
      code: "FLEXISIP_ACTIVATE_FAILED_ROLLED_BACK",
    });
  }

  // ── 步骤 6: 本地数据库写入 ──
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let targetTenantId = request.admin.tenantId || null;
    const passwordHash = await hashPassword(password);

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const userRes = await connection.query(
      `INSERT INTO sip_users (tenant_id, username, sip_domain, display_name, email, phone_number, password_hash, role, status, created_by_admin_user_id,
         flexisip_account_id, sip_uri, sync_status, sync_attempts, last_synced_at, created_in_flexisip_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
      [targetTenantId, username, domain, displayName, email, phone, passwordHash, role, status, request.admin.id,
       flexisipAccountId || null, sipUri, now, now],
    );

    if (payload.hasExternal) {
      const extUsername = String(payload.externalUsername || "").trim();
      const extDomain = String(payload.externalDomain || "").trim();
      const extPassword = String(payload.externalPassword || "").trim();
      const realm = String(payload.realm || "").trim() || null;
      const registrar = String(payload.registrar || "").trim() || null;
      const outboundProxy = String(payload.outboundProxy || "").trim() || null;
      const protocol = ["UDP", "TCP", "TLS"].includes(payload.protocol) ? payload.protocol : "UDP";

      await connection.query(
        `INSERT INTO sip_external_accounts (sip_user_id, external_username, external_domain, external_password, realm, registrar, outbound_proxy, protocol)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [Number(userRes.insertId), extUsername, extDomain, extPassword, realm, registrar, outboundProxy, protocol],
      );
    }

    await connection.commit();
    connection.release();

    return response.status(201).json({
      message: "帳號登記成功",
      id: Number(userRes.insertId),
      username,
      sip_domain: domain,
      sip_uri: sipUri,
      flexisip_account_id: flexisipAccountId,
    });
  } catch (dbErr) {
    // ── 步骤 7: 补偿刪除远端帳號 ──
    if (connection) {
      try { await connection.rollback(); } catch {}
      connection.release();
    }

    console.error("Local DB save failed for SIP account:", dbErr?.message);

    if (flexisipAccountId) {
      try {
        await flexisipDeleteAccount(flexisipAccountId);
        return response.status(500).json({
          message: "帳號儲存失敗，已回滾遠端帳號。",
          code: "LOCAL_DB_SAVE_FAILED_ROLLED_BACK",
        });
      } catch (cleanupErr) {
        console.error(
          "CRITICAL: Failed to cleanup Flexisip account after local DB failure.",
          "flexisipAccountId:", flexisipAccountId,
          "sipUri:", sipUri,
          "error:", cleanupErr?.message || cleanupErr,
        );
        return response.status(500).json({
          message: "帳號儲存失敗，遠端帳號清理失敗，請聯絡管理員。",
          code: "LOCAL_DB_SAVE_FAILED_FLEXISIP_CLEANUP_FAILED",
        });
      }
    }

    return response.status(500).json({ message: "帳號儲存失敗" });
  }
});

// POST /api/admin/sip-accounts/batch - 批量新增 SIP 帳號（同步 Flexisip）
app.post("/api/admin/sip-accounts/batch", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行批次操作。" });
  }

  const payload = request.body || {};
  const startStr = String(payload.startAccount || '').trim();
  const count = Number(payload.count || 0);
  const domain = String(payload.domain || '').trim();
  const password = String(payload.password || '');
  const role = payload.role === 'admin' ? 'admin' : 'user';

  // 纯数字校验
  if (!/^\d+$/.test(startStr)) {
    return response.status(400).json({ message: "起始 SIP 帳號必須為純數字。", code: "INVALID_BATCH_START_ACCOUNT" });
  }
  if (!Number.isInteger(count) || count <= 0 || count > 200) {
    return response.status(400).json({ message: "數量必須為 1-200 之間的正整數。" });
  }
  if (!domain || !password) {
    return response.status(400).json({ message: "缺少必填引數。" });
  }
  if (password.length < 6) {
    return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
  }

  const results = [];
  let created = 0, failed = 0, checked = 0, consistent = 0, inconsistent = 0;
  const createdLocalIds = [];

  for (let i = 0; i < count; i++) {
    const username = startStr.padStart(startStr.length, '0');
    const realUsername = String(BigInt(startStr) + BigInt(i)).padStart(startStr.length, '0');
    const sipUri = `sip:${realUsername}@${domain}`;
    let flexisipAccountId = null;

    console.log(`[batch] ===== 第 ${i+1}/${count} 個帳號: ${realUsername}, sipUri: ${sipUri} =====`);

    try {
      // 本地唯一性
      let conn = await pool.getConnection();
      console.log(`[batch] ${realUsername}: 檢查本地重複...`);
      const dup = await conn.query(`SELECT id FROM sip_users WHERE username = ? AND sip_domain = ? LIMIT 1`, [realUsername, domain]);
      conn.release();
      if (dup.length > 0) {
        console.log(`[batch] ${realUsername}: ❌ 本地已存在 (id=${dup[0].id})`);
        results.push({ username: realUsername, sipUri, success: false, errorCode: "DUPLICATE_LOCAL_SIP_ACCOUNT", message: "本地帳號已存在。" });
        failed++;
        continue;
      }
      console.log(`[batch] ${realUsername}: 本地無重複`);

      // 远端存在性检查
      let remoteExists = false;
      try {
        console.log(`[batch] ${realUsername}: 搜尋遠端 searchAccountBySip(${realUsername}@${domain})...`);
        await searchAccountBySip(`${realUsername}@${domain}`);
        remoteExists = true; // 未抛异常 = 远端已存在
        console.log(`[batch] ${realUsername}: 遠端已存在`);
      } catch (e) {
        console.log(`[batch] ${realUsername}: 遠端搜尋結果 - status=${e?.status}, message=${e?.message}`);
        if (e?.status !== 404) throw e;
        console.log(`[batch] ${realUsername}: 遠端不存在 (404)，繼續建立`);
      }
      if (remoteExists) {
        results.push({ username: realUsername, sipUri, success: false, errorCode: "FLEXISIP_ACCOUNT_ALREADY_EXISTS", message: "遠端帳號已存在。" });
        failed++;
        continue;
      }

      // Flexisip create (含 422 軟刪除恢復)
      console.log(`[batch] ${realUsername}: 呼叫 flexisipCreateAccount, payload:`, {
        username: realUsername, sip: sipUri, password: '***', algorithm: "SHA-256",
        display_name: realUsername, email: `${realUsername}@${domain}`,
      });
      let createErr = null;
      try {
        const flexisipResult = await flexisipCreateAccount({
          username: realUsername, sip: sipUri, password, algorithm: "SHA-256",
          display_name: realUsername, email: `${realUsername}@${domain}`,
        });
        console.log(`[batch] ${realUsername}: flexisipCreateAccount 返回:`, JSON.stringify(flexisipResult));
        flexisipAccountId = flexisipResult?.id;
      } catch (e) {
        createErr = e;
        console.log(`[batch] ${realUsername}: flexisipCreateAccount 失敗: status=${e?.status}, message=${e?.message}`);
      }

      // 422: 区分 username taken vs 其他校验錯誤
      if (!flexisipAccountId && createErr?.status === 422) {
        const errs422 = createErr?.responseBody?.errors || {};
        const isUsernameTaken = errs422.username && errs422.username.some(m => /already.*taken|has already/i.test(m));
        if (isUsernameTaken) {
          console.log(`[batch] ${realUsername}: 422 username taken（accounts_tombstones）`);
          results.push({
            username: realUsername, sipUri, success: false,
            errorCode: "FLEXISIP_USERNAME_TOMBSTONED",
            message: "該 SIP 帳號已被刪除保留，是否徹底釋放後重新建立？",
          });
        } else {
          const fieldErrors = Object.entries(errs422).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ');
          console.log(`[batch] ${realUsername}: 422 validation error:`, fieldErrors);
          results.push({
            username: realUsername, sipUri, success: false,
            errorCode: "FLEXISIP_VALIDATION_ERROR",
            message: fieldErrors || (createErr?.message || '服務端校驗失敗').substring(0, 200),
          });
        }
        failed++;
        continue;
      }

      if (!flexisipAccountId) {
        console.log(`[batch] ${realUsername}: ⚠️ flexisipResult 無 id，嘗試 searchAccountBySip 獲取...`);
        try {
          const sr = await searchAccountBySip(`${realUsername}@${domain}`);
          flexisipAccountId = sr?.id;
          console.log(`[batch] ${realUsername}: searchAccountBySip 返回 id=${flexisipAccountId}`);
        } catch (e2) {
          console.log(`[batch] ${realUsername}: searchAccountBySip 失敗:`, e2?.message);
        }
      }
      if (!flexisipAccountId) {
        const errMsg = createErr
          ? (createErr?.message || '服務端建立失敗').substring(0, 200)
          : "Flexisip 建立成功但無法獲取 ID。";
        console.log(`[batch] ${realUsername}: ❌ 無法獲取 flexisipAccountId`);
        results.push({ username: realUsername, sipUri, success: false, errorCode: "FLEXISIP_CREATE_FAILED", message: errMsg });
        failed++;
        continue;
      }

      console.log(`[batch] ${realUsername}: flexisipAccountId=${flexisipAccountId}, 開始 activate...`);
      // Flexisip activate
      await flexisipActivateAccount(flexisipAccountId);
      console.log(`[batch] ${realUsername}: activate 成功`);

      // 本地保存
      conn = await pool.getConnection();
      try {
        console.log(`[batch] ${realUsername}: 儲存到本地 DB...`);
        await conn.beginTransaction();
        const passwordHash = await hashPassword(password);
        const now = new Date().toISOString().slice(0, 19).replace("T", " ");
        const userRes = await conn.query(
          `INSERT INTO sip_users (tenant_id, username, sip_domain, email, display_name, password_hash, role, status, created_by_admin_user_id,
             flexisip_account_id, sip_uri, sync_status, sync_attempts, last_synced_at, created_in_flexisip_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active', 1, ?, ?)`,
          [null, realUsername, domain, `${realUsername}@${domain}`, realUsername, passwordHash, role, request.admin.id, flexisipAccountId, sipUri, now, now],
        );
        await conn.commit();
        conn.release();
        console.log(`[batch] ${realUsername}: ✅ 本地儲存成功 (localId=${Number(userRes.insertId)})`);
        createdLocalIds.push({ id: Number(userRes.insertId), username: realUsername, flexisipAccountId, sipUri });
        results.push({ username: realUsername, sipUri, success: true, localId: Number(userRes.insertId), flexisipAccountId: String(flexisipAccountId) });
        created++;
      } catch (dbErr) {
        console.log(`[batch] ${realUsername}: ❌ 本地 DB 儲存失敗:`, dbErr?.message, dbErr?.code);
        await conn.rollback().catch(() => {});
        conn.release();
        // 补偿刪除
        try { await flexisipDeleteAccount(flexisipAccountId); } catch {}
        results.push({ username: realUsername, sipUri, success: false, errorCode: "LOCAL_DB_SAVE_FAILED", message: "本地儲存失敗，已回滾。" });
        failed++;
      }
    } catch (err) {
      console.log(`[batch] ${realUsername}: ❌ 異常:`, err?.message, err?.code, err?.status, err?.responseBody);
      if (flexisipAccountId) { try { await flexisipDeleteAccount(flexisipAccountId); } catch {} }
      results.push({ username: realUsername, sipUri, success: false, errorCode: err?.code || "FLEXISIP_CREATE_FAILED", message: (err?.message || '建立失敗').substring(0, 200) });
      failed++;
    }
  }

  console.log(`[batch] ===== 批次完成: created=${created}, failed=${failed} =====`);

  // 批量一致性校验
  for (const item of createdLocalIds) {
    try {
      const conn = await pool.getConnection();
      const rows = await conn.query(`SELECT display_name, email, phone_number, role, status FROM sip_users WHERE id = ?`, [item.id]);
      conn.release();
      if (rows.length === 0) { results.find(r => r.username === item.username).check = { checked: false, message: "本地記錄未找到" }; continue; }
      const local = rows[0];

      let remote;
      try { remote = await flexisipGetAccount(item.flexisipAccountId); } catch {}
      if (!remote) { results.find(r => r.username === item.username).check = { checked: false, message: "遠端查詢失敗" }; continue; }

      const diffs = [];
      if ((local.display_name || '') !== (remote.display_name || '')) diffs.push({ field: 'display_name', label: '顯示名稱', localValue: local.display_name, remoteValue: remote.display_name });
      const rActive = remote.activated === true || remote.activated === 1;
      if (local.status !== 'active' || !rActive) diffs.push({ field: 'status', label: '啟用狀態', localValue: local.status, remoteValue: rActive ? 'active' : 'inactive' });

      const checkedObj = { checked: true, consistent: diffs.length === 0, differences: bigIntSafe(diffs) };
      results.find(r => r.username === item.username).check = checkedObj;
      checked++;
      if (diffs.length === 0) consistent++; else inconsistent++;
    } catch {
      results.find(r => r.username === item.username).check = { checked: false, message: "校驗異常" };
    }
  }

  return response.json(bigIntSafe({
    summary: { total: count, created, failed, checked, consistent, inconsistent },
    results,
  }));
});

// PUT /api/admin/sip-accounts/:id/status - 啟用/停用 SIP 帳號（同步 Flexisip）
app.put("/api/admin/sip-accounts/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以變更帳號狀態。" });
  }

  const accountId = Number(request.params.id);
  const newStatus = String(request.body?.status || "").trim();

  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }
  if (!['active', 'inactive', 'disabled'].includes(newStatus)) {
    return response.status(400).json({ message: "無效的狀態值。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, username, sip_domain, status, flexisip_account_id, sip_uri, sync_status
       FROM sip_users WHERE id = ? LIMIT 1`, [accountId],
    );
    const account = rows[0];
    if (!account) {
      connection.release();
      return response.status(404).json({ message: "帳號不存在。" });
    }

    const isActivating = newStatus === 'active';
    const actionText = isActivating ? '啟用' : '停用';
    let flexisipAccountId = account.flexisip_account_id;

    // ── 本地 only 帳號：只更新本地状态 ──
    if (account.sync_status === 'local_only' || (!flexisipAccountId && !account.sip_uri)) {
      connection.release();
      connection = await pool.getConnection();
      await connection.query(
        `UPDATE sip_users SET status = ?, sync_attempts = sync_attempts + 1, last_synced_at = NOW()
         WHERE id = ?`, [newStatus, accountId],
      );
      connection.release();
      return response.json({ message: `${actionText}成功`, status: newStatus, sync_status: 'local_only' });
    }

    connection.release();

    // ── 定位远端 ID ──
    if (!flexisipAccountId && account.sip_uri) {
      try {
        const searchResult = await searchAccountBySip(account.sip_uri);
        flexisipAccountId = searchResult?.id;
        if (flexisipAccountId) {
          connection = await pool.getConnection();
          await connection.query(`UPDATE sip_users SET flexisip_account_id = ? WHERE id = ?`, [flexisipAccountId, accountId]);
          connection.release();
        }
      } catch (searchErr) {
        if (searchErr?.status !== 404) {
          console.error("Flexisip search failed during status toggle:", searchErr?.message);
        }
      }
    }

    if (!flexisipAccountId) {
      return response.status(502).json({
        message: "無法找到對應的遠端帳號。",
        code: "FLEXISIP_ACCOUNT_NOT_FOUND",
      });
    }

    // ── 调用 Flexisip ──
    try {
      if (isActivating) {
        await flexisipActivateAccount(flexisipAccountId);
      } else {
        await flexisipDeactivateAccount(flexisipAccountId);
      }
    } catch (flexisipErr) {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const errMsg = (flexisipErr?.message || String(flexisipErr)).substring(0, 500);
      connection = await pool.getConnection();
      if (flexisipErr?.status === 404) {
        await connection.query(
          `UPDATE sip_users SET sync_status = 'flexisip_missing', sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`,
          [errMsg, now, accountId],
        );
        connection.release();
        return response.status(502).json({ message: "遠端帳號不存在。", code: "FLEXISIP_ACCOUNT_NOT_FOUND" });
      }
      await connection.query(
        `UPDATE sip_users SET sync_status = 'sync_failed', sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`,
        [errMsg, now, accountId],
      );
      connection.release();
      return response.status(502).json({
        message: `遠端${actionText}失敗。`,
        code: isActivating ? "FLEXISIP_ACTIVATE_FAILED" : "FLEXISIP_DEACTIVATE_FAILED",
      });
    }

    // ── 更新本地 ──
    connection = await pool.getConnection();
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const newSyncStatus = isActivating ? 'active' : 'disabled';
    await connection.query(
      `UPDATE sip_users SET status = ?, sync_status = ?, sync_error = NULL, sync_attempts = sync_attempts + 1, last_synced_at = ?
       WHERE id = ?`,
      [newStatus, newSyncStatus, now, accountId],
    );
    connection.release();
    return response.json({ message: `${actionText}成功`, status: newStatus, sync_status: newSyncStatus });
  } catch (error) {
    if (connection) { try { connection.release(); } catch {} }
    console.error("SIP status toggle failed:", error?.message);
    return response.status(500).json({ message: `${String(request.body?.status) === 'active' ? '啟用' : '停用'}失敗。` });
  }
});

// PUT /api/admin/sip-accounts/:id - 編輯帳號（同步 Flexisip）
app.put("/api/admin/sip-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行帳號登記。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  const payload = request.body || {};
  const displayName = String(payload.displayName || "").trim();
  const password = String(payload.password || "");
  const role = payload.role === "admin" ? "admin" : "user";
  const status = payload.status || 'active';
  const phone = String(payload.phone || "").trim();
  const email = String(payload.email || "").trim();

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, tenant_id, display_name, email, phone_number, role, status,
         username, sip_domain, flexisip_account_id, sip_uri, sync_status
       FROM sip_users WHERE id = ? LIMIT 1`, [accountId],
    );
    const account = rows[0];
    if (!account) {
      connection.release();
      return response.status(404).json({ message: "帳號不存在。" });
    }
    if (account.tenant_id != null) {
      connection.release();
      return response.status(409).json({ message: "已經分配給租戶的帳號不允許編輯。" });
    }

    // 禁止修改 username/domain（仅当与数据库值不同时才拒绝）
    const reqUsername = String(payload.username ?? '').trim();
    const reqDomain = String(payload.domain || payload.sip_domain || '').trim().toLowerCase();
    if (reqUsername && reqUsername !== account.username) {
      connection.release();
      return response.status(400).json({ message: "不允許修改 SIP 使用者名稱。", code: "SIP_IDENTITY_CHANGE_NOT_SUPPORTED" });
    }
    if (reqDomain && reqDomain !== (account.sip_domain || '').toLowerCase()) {
      connection.release();
      return response.status(400).json({ message: "不允許修改 SIP 域名。", code: "SIP_IDENTITY_CHANGE_NOT_SUPPORTED" });
    }

    // ── 变化检测 ──
    const changedFields = [];
    if (account.display_name !== displayName) changedFields.push('display_name');
    if (account.email !== email) changedFields.push('email');
    if (account.phone_number !== phone) changedFields.push('phone');
    if (account.role !== role) changedFields.push('role');
    if (account.status !== status) changedFields.push('status');
    if (password) changedFields.push('password');

    connection.release();

    // 如果没有任何字段变化，直接返回
    if (changedFields.length === 0) {
      return response.json({ success: true, no_change: true, message: "沒有可儲存的修改。" });
    }

    // ── Flexisip sync（非 local_only 帳號，且 display_name/email/phone 有变化）──
    const needsFlexisipSync = account.sync_status !== 'local_only' && (
      changedFields.some(f => ['display_name', 'email', 'phone'].includes(f))
    );

    if (needsFlexisipSync) {
      let flexisipAccountId = account.flexisip_account_id || null;

      if (!flexisipAccountId && account.sip_uri) {
        try {
          const sr = await searchAccountBySip(account.sip_uri);
          flexisipAccountId = sr?.id;
          if (flexisipAccountId) {
            const c2 = await pool.getConnection();
            await c2.query(`UPDATE sip_users SET flexisip_account_id = ? WHERE id = ?`, [flexisipAccountId, accountId]);
            c2.release();
          }
        } catch {}
      }

      if (flexisipAccountId) {
        const flexisipPayload = { username: account.username, algorithm: "SHA-256" };
        flexisipPayload.display_name = displayName || null;
        flexisipPayload.email = email || null;
        flexisipPayload.phone = phone || null;

        try {
          await flexisipUpdateAccount(flexisipAccountId, flexisipPayload);
          // updateAccount 可能重置状态，根据本地 status 恢复
          if (account.status === 'active') {
            await flexisipActivateAccount(flexisipAccountId);
          } else if (account.status === 'inactive' || account.status === 'disabled') {
            await flexisipDeactivateAccount(flexisipAccountId);
          }
        } catch (flexisipErr) {
          const now = new Date().toISOString().slice(0, 19).replace("T", " ");
          const errMsg = (flexisipErr?.message || String(flexisipErr)).substring(0, 500);
          const c3 = await pool.getConnection();
          if (flexisipErr?.status === 404) {
            await c3.query(
              `UPDATE sip_users SET sync_status = 'flexisip_missing', sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`,
              [errMsg, now, accountId],
            );
            c3.release();
            return response.status(502).json({ message: "遠端帳號不存在。", code: "FLEXISIP_ACCOUNT_NOT_FOUND" });
          }
          await c3.query(
            `UPDATE sip_users SET sync_status = 'sync_failed', sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`,
            [errMsg, now, accountId],
          );
          c3.release();
          return response.status(502).json({ message: `遠端帳號更新失敗：${errMsg}`, code: "FLEXISIP_UPDATE_FAILED" });
        }
      }
    }

    // ── 更新本地数据库 ──
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let updateSql = `UPDATE sip_users SET display_name = ?, email = ?, phone_number = ?, role = ?, status = ?, sync_error = NULL, sync_attempts = sync_attempts + 1, last_synced_at = NOW()`;
    let updateParams = [displayName, email, phone, role, status];

    if (password) {
      updateSql += `, password_hash = ?`;
      updateParams.push(await hashPassword(password));
    }
    updateSql += ` WHERE id = ?`;
    updateParams.push(accountId);

    await connection.query(updateSql, updateParams);

    if (payload.hasExternal) {
      const extUsername = String(payload.externalUsername || "").trim();
      const extDomain = String(payload.externalDomain || "").trim();
      const extPassword = String(payload.externalPassword || "").trim();
      const realm = String(payload.realm || "").trim() || null;
      const registrar = String(payload.registrar || "").trim() || null;
      const outboundProxy = String(payload.outboundProxy || "").trim() || null;
      const protocol = ["UDP", "TCP", "TLS"].includes(payload.protocol) ? payload.protocol : "UDP";

      const extRows = await connection.query(`SELECT id FROM sip_external_accounts WHERE sip_user_id = ? LIMIT 1`, [accountId]);
      if (extRows.length > 0) {
        let extUpdateSql = `UPDATE sip_external_accounts SET external_username = ?, external_domain = ?, realm = ?, registrar = ?, outbound_proxy = ?, protocol = ?`;
        let extUpdateParams = [extUsername, extDomain, realm, registrar, outboundProxy, protocol];
        if (extPassword) {
          extUpdateSql += `, external_password = ?`;
          extUpdateParams.push(extPassword);
        }
        extUpdateSql += ` WHERE sip_user_id = ?`;
        extUpdateParams.push(accountId);
        await connection.query(extUpdateSql, extUpdateParams);
      } else {
        await connection.query(
          `INSERT INTO sip_external_accounts (sip_user_id, external_username, external_domain, external_password, realm, registrar, outbound_proxy, protocol)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [accountId, extUsername, extDomain, extPassword, realm, registrar, outboundProxy, protocol]
        );
      }
    } else {
      await connection.query(`DELETE FROM sip_external_accounts WHERE sip_user_id = ?`, [accountId]);
    }

    await connection.commit();
    return response.json({ message: "帳號更新成功" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Failed to update SIP account:", error);
    return response.status(500).json({ message: "帳號更新失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/admin/sip-accounts/:id/unassign - 取消分配
app.post("/api/admin/sip-accounts/:id/unassign", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行帳號操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    
    const rows = await connection.query(`SELECT id FROM sip_users WHERE id = ? LIMIT 1`, [accountId]);
    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    await connection.query(`UPDATE sip_users SET tenant_id = NULL WHERE id = ?`, [accountId]);
    return response.json({ message: "帳號已成功取消分配。" });
  } catch (error) {
    console.error("Failed to unassign SIP account:", error);
    return response.status(500).json({ message: "取消分配失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/sip-accounts/:id/verify - 校验本地与 Flexisip 帳號数据一致性
app.get("/api/admin/sip-accounts/:id/verify", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行此操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, username, sip_domain, display_name, email, phone_number, role, status,
         flexisip_account_id, sip_uri, sync_status
       FROM sip_users WHERE id = ? LIMIT 1`, [accountId],
    );
    connection.release();

    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    const local = rows[0];

    if (!local.flexisip_account_id && !local.sip_uri) {
      return response.json({
        consistent: false, status: 'local_only',
        localData: { id: local.id, username: local.username, displayName: local.display_name, email: local.email, phone: local.phone_number, role: local.role, status: local.status },
        differences: [{ field: 'account', label: '遠端帳號', localValue: '僅本地存在', remoteValue: '未同步', syncable: false, reason: '該帳號僅存在於本地資料庫，未與 Flexisip 同步。' }],
      });
    }

    // 定位远端帳號
    let flexisipAccount = null;
    try {
      if (local.flexisip_account_id) {
        flexisipAccount = await flexisipGetAccount(local.flexisip_account_id);
      } else if (local.sip_uri) {
        flexisipAccount = await searchAccountBySip(local.sip_uri);
      }
    } catch (err) {
      if (err?.status === 404) {
        return response.json({
          consistent: false, status: 'flexisip_missing',
          localData: { id: local.id, username: local.username, displayName: local.display_name, email: local.email, phone: local.phone_number, role: local.role, status: local.status },
          differences: [{ field: 'account', label: '遠端帳號', localValue: '存在', remoteValue: '不存在', syncable: false, reason: 'Flexisip 遠端帳號不存在。' }],
        });
      }
      return response.status(502).json({ message: `無法連線服務端進行校驗：${err?.message || '未知錯誤'}` });
    }

    if (!flexisipAccount) {
      return response.json({
        consistent: false, status: 'flexisip_missing',
        localData: { id: local.id, username: local.username, displayName: local.display_name, email: local.email, phone: local.phone_number, role: local.role, status: local.status },
        differences: [{ field: 'account', label: '遠端帳號', localValue: '存在', remoteValue: '未找到', syncable: false, reason: 'Flexisip 遠端帳號未找到。' }],
      });
    }

    // 转换 BigInt 为 Number，避免 JSON 序列化錯誤
    const safeRemote = JSON.parse(JSON.stringify(flexisipAccount, (key, value) =>
      typeof value === 'bigint' ? Number(value) : value
    ));

    // 字段对比（含 syncable 标记）
    const differences = [];
    // Username — 不可同步
    if ((local.username || '') !== (safeRemote.username || '')) {
      differences.push({ field: 'username', label: '使用者名稱', localValue: local.username || '—', remoteValue: safeRemote.username || '—', syncable: false, reason: 'SIP 身份欄位不可自動同步。' });
    }
    // Domain — 不可同步
    const remoteDomain = (safeRemote.domain || safeRemote.sip || '').replace(/^sip:/, '').split('@').pop() || '';
    if ((local.sip_domain || '') !== remoteDomain) {
      differences.push({ field: 'domain', label: '域名', localValue: local.sip_domain || '—', remoteValue: remoteDomain || '—', syncable: false, reason: 'SIP 身份欄位不可自動同步。' });
    }
    // Display name — 可同步
    if ((local.display_name || '') !== (safeRemote.display_name || '')) {
      differences.push({ field: 'display_name', label: '顯示名稱', localValue: local.display_name || '—', remoteValue: safeRemote.display_name || '—', syncable: true });
    }
    // Email — 可同步
    const localEmail = (local.email || '').trim().toLowerCase();
    const remoteEmail = (safeRemote.email || '').trim().toLowerCase();
    if (localEmail !== remoteEmail) {
      differences.push({ field: 'email', label: 'Email', localValue: local.email || '—', remoteValue: safeRemote.email || '—', syncable: true });
    }
    // Phone — 可同步
    if ((local.phone_number || '') !== (safeRemote.phone || '')) {
      differences.push({ field: 'phone', label: '電話', localValue: local.phone_number || '—', remoteValue: safeRemote.phone || '—', syncable: true });
    }
    // Role — 可同步
    const localRole = local.role || 'user';
    const remoteRole = safeRemote.role || 'user';
    if (localRole !== remoteRole) {
      differences.push({ field: 'role', label: '角色', localValue: localRole, remoteValue: remoteRole, syncable: true });
    }
    // 状态
    const localActive = local.status === 'active';
    const remoteActive = safeRemote.activated === true || safeRemote.activated === 1;
    if (localActive !== remoteActive) {
      differences.push({ field: 'status', label: '啟用狀態', localValue: localActive ? '已啟用' : '已停用', remoteValue: remoteActive ? '已啟用' : '已停用', syncable: true });
    }

    return response.json(bigIntSafe({
      consistent: differences.length === 0,
      localData: { id: local.id, username: local.username, displayName: local.display_name, email: local.email, phone: local.phone_number, role: local.role, status: local.status },
      remoteData: { id: safeRemote.id, display_name: safeRemote.display_name, email: safeRemote.email, phone: safeRemote.phone, activated: safeRemote.activated },
      differences,
    }));
  } catch (error) {
    if (connection) { try { connection.release(); } catch {} }
    console.error("SIP account verify failed:", error?.message);
    return response.status(500).json({ message: `校驗失敗：${error?.message || '未知錯誤'}` });
  }
});

// POST /api/admin/sip-accounts/:id/sync-to-flexisip - 用本地數據同步 Flexisip
app.post("/api/admin/sip-accounts/:id/sync-to-flexisip", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行此操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, username, sip_domain, display_name, email, phone_number, role, status,
         flexisip_account_id, sip_uri, sync_status
       FROM sip_users WHERE id = ? LIMIT 1`, [accountId],
    );
    connection.release();

    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    const local = rows[0];

    // local_only 不允许同步
    if (local.sync_status === 'local_only' || (!local.flexisip_account_id && !local.sip_uri)) {
      return response.status(400).json({
        message: "該帳號僅存在於本地，無法同步到服務端。",
        code: "LOCAL_ONLY_ACCOUNT_CANNOT_SYNC_TO_FLEXISIP",
      });
    }

    // 定位远端
    let flexisipAccountId = local.flexisip_account_id || null;
    if (!flexisipAccountId && local.sip_uri) {
      try {
        const sr = await searchAccountBySip(local.sip_uri);
        flexisipAccountId = sr?.id;
        if (flexisipAccountId) {
          const c2 = await pool.getConnection();
          await c2.query(`UPDATE sip_users SET flexisip_account_id = ? WHERE id = ?`, [flexisipAccountId, accountId]);
          c2.release();
        }
      } catch {}
    }

    if (!flexisipAccountId) {
      return response.status(502).json({ message: "遠端帳號不存在。", code: "FLEXISIP_ACCOUNT_NOT_FOUND" });
    }

    let synced = false;

    // 1. 同步資料欄位
    const payload = { username: local.username, algorithm: "SHA-256" };
    payload.display_name = local.display_name || null;
    payload.email = local.email || null;
    payload.phone = local.phone_number || null;

    try {
      await flexisipUpdateAccount(flexisipAccountId, payload);
      synced = true;
    } catch (updateErr) {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const errMsg = (updateErr?.message || String(updateErr)).substring(0, 500);
      const c3 = await pool.getConnection();
      if (updateErr?.status === 404) {
        await c3.query(`UPDATE sip_users SET sync_status = 'flexisip_missing', sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`, [errMsg, now, accountId]);
        c3.release();
        return response.status(502).json({ message: "遠端帳號不存在。", code: "FLEXISIP_ACCOUNT_NOT_FOUND" });
      }
      await c3.query(`UPDATE sip_users SET sync_status = 'sync_failed', sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`, [errMsg, now, accountId]);
      c3.release();
      return response.status(502).json({ message: "同步失敗。", code: "FLEXISIP_SYNC_FAILED" });
    }

    // 2. 同步狀態
    const localActive = local.status === 'active';
    try {
      if (localActive) {
        await flexisipActivateAccount(flexisipAccountId);
      } else {
        await flexisipDeactivateAccount(flexisipAccountId);
      }
    } catch (statusErr) {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const errMsg = (statusErr?.message || String(statusErr)).substring(0, 500);
      const c4 = await pool.getConnection();
      await c4.query(`UPDATE sip_users SET sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`, [errMsg, now, accountId]);
      c4.release();
    }

    // 3. 更新本地同步字段
    connection = await pool.getConnection();
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    await connection.query(
      `UPDATE sip_users SET sync_error = NULL, sync_attempts = sync_attempts + 1, last_synced_at = ?, sync_status = ? WHERE id = ?`,
      [now, localActive ? 'active' : 'disabled', accountId],
    );
    connection.release();

    return response.json({ message: "同步成功。", synced });
  } catch (error) {
    if (connection) { try { connection.release(); } catch {} }
    console.error("SIP account sync failed:", error?.message);
    return response.status(500).json({ message: "同步失敗。" });
  }
});

// PUT /api/admin/sip-accounts/:id/reset-password - 重置密碼（同步 Flexisip）
app.put("/api/admin/sip-accounts/:id/reset-password", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行帳號操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  const password = String(request.body?.password || "");
  if (!password || password.length < 6) {
    return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, username, sip_domain, flexisip_account_id, sip_uri, sync_status
       FROM sip_users WHERE id = ? LIMIT 1`, [accountId],
    );
    if (rows.length === 0) {
      connection.release();
      return response.status(404).json({ message: "帳號不存在。" });
    }
    const account = rows[0];
    connection.release();

    // ── local_only 历史帳號：只更新本地 ──
    if (account.sync_status === 'local_only' || (!account.flexisip_account_id && !account.sip_uri)) {
      connection = await pool.getConnection();
      const passwordHash = await hashPassword(password);
      await connection.query(`UPDATE sip_users SET password_hash = ?, sync_attempts = sync_attempts + 1, last_synced_at = NOW() WHERE id = ?`, [passwordHash, accountId]);
      connection.release();
      return response.json({ message: "密碼重置成功。" });
    }

    // ── 定位远端 ID ──
    let flexisipAccountId = account.flexisip_account_id || null;
    if (!flexisipAccountId && account.sip_uri) {
      try {
        const sr = await searchAccountBySip(account.sip_uri);
        flexisipAccountId = sr?.id;
        if (flexisipAccountId) {
          const c2 = await pool.getConnection();
          await c2.query(`UPDATE sip_users SET flexisip_account_id = ? WHERE id = ?`, [flexisipAccountId, accountId]);
          c2.release();
        }
      } catch {}
    }

    if (!flexisipAccountId) {
      return response.status(502).json({
        message: "無法找到對應的遠端帳號。",
        code: "FLEXISIP_ACCOUNT_NOT_FOUND",
      });
    }

    // ── 同步 Flexisip 密码 ──
    try {
      await flexisipUpdateAccount(flexisipAccountId, {
        username: account.username,
        password,
        algorithm: "SHA-256",
      });
      // updateAccount may reset activation status; restore based on local status
      try {
        await flexisipActivateAccount(flexisipAccountId);
      } catch (activateErr) {
        console.error(`Failed to re-activate Flexisip account after password reset (id=${flexisipAccountId}):`, activateErr?.message);
      }
    } catch (flexisipErr) {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const errMsg = (flexisipErr?.message || String(flexisipErr)).substring(0, 500);
      const c3 = await pool.getConnection();
      if (flexisipErr?.status === 404) {
        await c3.query(
          `UPDATE sip_users SET sync_status = 'flexisip_missing', sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`,
          [errMsg, now, accountId],
        );
        c3.release();
        return response.status(502).json({ message: "遠端帳號不存在。", code: "FLEXISIP_ACCOUNT_NOT_FOUND" });
      }
      await c3.query(
        `UPDATE sip_users SET sync_status = 'sync_failed', sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`,
        [errMsg, now, accountId],
      );
      c3.release();
      return response.status(502).json({ message: "遠端密碼更新失敗。", code: "FLEXISIP_PASSWORD_UPDATE_FAILED" });
    }

    // ── 更新本地密码 ──
    connection = await pool.getConnection();
    const passwordHash = await hashPassword(password);
    await connection.query(
      `UPDATE sip_users SET password_hash = ?, sync_error = NULL, sync_attempts = sync_attempts + 1, last_synced_at = NOW() WHERE id = ?`,
      [passwordHash, accountId],
    );
    connection.release();
    return response.json({ message: "密碼重置成功。" });
  } catch (error) {
    if (connection) { try { connection.release(); } catch {} }
    console.error("Failed to reset SIP account password:", error?.message);
    return response.status(500).json({ message: "密碼重設失敗。" });
  }
});

// ── AI 授权管理 ──

// GET /api/admin/sip-accounts/:id/ai-entitlement - 查詢 AI 授權
app.get("/api/admin/sip-accounts/:id/ai-entitlement", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行帳號操作。" });
  }
  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const [row] = await connection.query(
      `SELECT id, sip_user_id, enabled, daily_limit, monthly_limit, used_today, used_this_month,
              expires_at, notes, granted_at
       FROM ai_bot_account_entitlements WHERE sip_user_id = ? LIMIT 1`,
      [accountId],
    );
    connection.release();
    return response.json(row || null);
  } catch (error) {
    if (connection) { try { connection.release(); } catch {} }
    console.error("Failed to get AI entitlement:", error?.message);
    return response.status(500).json({ message: "查詢 AI 授權失敗。" });
  }
});

// PUT /api/admin/sip-accounts/:id/ai-entitlement - 新增/修改 AI 授權
app.put("/api/admin/sip-accounts/:id/ai-entitlement", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行帳號操作。" });
  }
  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }
  const { enabled, daily_limit, monthly_limit, expires_at, notes } = request.body || {};
  if (enabled === undefined) {
    return response.status(400).json({ message: "請提供 enabled 欄位。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    // 先確認 sip_user 存在
    const [sipUser] = await connection.query(`SELECT id FROM sip_users WHERE id = ? LIMIT 1`, [accountId]);
    if (sipUser.length === 0) {
      connection.release();
      return response.status(404).json({ message: "帳號不存在。" });
    }
    await connection.query(
      `INSERT INTO ai_bot_account_entitlements (sip_user_id, enabled, daily_limit, monthly_limit, expires_at, notes, granted_by_admin_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         daily_limit = VALUES(daily_limit),
         monthly_limit = VALUES(monthly_limit),
         expires_at = VALUES(expires_at),
         notes = VALUES(notes),
         granted_by_admin_id = VALUES(granted_by_admin_id)`,
      [
        accountId,
        enabled ? 1 : 0,
        daily_limit ?? 50,
        monthly_limit ?? null,
        expires_at || null,
        notes || '',
        request.admin.id,
      ],
    );
    connection.release();
    return response.json({ message: "AI 授權設定成功。" });
  } catch (error) {
    if (connection) { try { connection.release(); } catch {} }
    console.error("Failed to save AI entitlement:", error?.message);
    return response.status(500).json({ message: "AI 授權儲存失敗。" });
  }
});

// DELETE /api/admin/sip-accounts/:id/ai-entitlement - 取消 AI 授權
app.delete("/api/admin/sip-accounts/:id/ai-entitlement", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行帳號操作。" });
  }
  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      `DELETE FROM ai_bot_account_entitlements WHERE sip_user_id = ?`,
      [accountId],
    );
    connection.release();
    return response.json({ message: "AI 授權已取消。" });
  } catch (error) {
    if (connection) { try { connection.release(); } catch {} }
    console.error("Failed to delete AI entitlement:", error?.message);
    return response.status(500).json({ message: "取消 AI 授權失敗。" });
  }
});

// DELETE /api/admin/sip-accounts/:id - 刪除帳號（同步 Flexisip）
app.delete("/api/admin/sip-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以刪除帳號。" });
  }

  const accountId = Number(request.params.id);
  const permanent = request.body?.permanent === true || String(request.query?.permanent || '').toLowerCase() === 'true';
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, tenant_id, username, sip_domain, flexisip_account_id, sip_uri, sync_status
       FROM sip_users WHERE id = ? LIMIT 1`, [accountId],
    );
    connection.release();

    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    const account = bigIntSafe(rows[0]);

    // 原有业务校验：已分配租户不能刪除
    if (account.tenant_id != null) {
      return response.status(409).json({ message: "已經分配給租戶的帳號不允許刪除。" });
    }

    // ── local_only 历史帳號：直接本地刪除 ──
    if (account.sync_status === 'local_only' || (!account.flexisip_account_id && !account.sip_uri)) {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      await connection.query(`DELETE FROM sip_external_accounts WHERE sip_user_id = ?`, [accountId]);
      await connection.query(`DELETE FROM sip_users WHERE id = ?`, [accountId]);
      await connection.commit();
      connection.release();
      return response.json({ message: "帳號已成功刪除。" });
    }

    // ── 定位远端 ID ──
    let flexisipAccountId = account.flexisip_account_id || null;
    if (!flexisipAccountId && account.sip_uri) {
      try {
        const sr = await searchAccountBySip(account.sip_uri);
        flexisipAccountId = sr?.id;
      } catch {}
    }
    if (!flexisipAccountId && account.username && account.sip_domain) {
      try {
        const sr = await searchAccountBySip(`${account.username}@${account.sip_domain}`);
        flexisipAccountId = sr?.id;
      } catch {}
    }

    // ── 刪除 Flexisip 远端帳號 ──
    let flexisipDeleted = false;
    if (flexisipAccountId) {
      try {
        await flexisipDeleteAccount(flexisipAccountId);
        flexisipDeleted = true;
      } catch (flexisipErr) {
        if (flexisipErr?.status === 404) {
          // 远端已不存在，视为刪除成功
          flexisipDeleted = true;
        } else {
          const now = new Date().toISOString().slice(0, 19).replace("T", " ");
          const errMsg = (flexisipErr?.message || String(flexisipErr)).substring(0, 500);
          const c3 = await pool.getConnection();
          await c3.query(
            `UPDATE sip_users SET sync_status = 'pending_delete', sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`,
            [errMsg, now, accountId],
          );
          c3.release();
          return response.status(502).json({
            message: "遠端帳號刪除失敗，本地帳號保留。",
            code: "FLEXISIP_DELETE_FAILED",
          });
        }
      }
    }
    // 没有远端 ID 的同步帳號：视为远端已不存在
    if (!flexisipAccountId) flexisipDeleted = true;

    // ── 徹底刪除：釋放 accounts_tombstones 保留 ──
    let tombstoneReleased = false;
    if (permanent && flexisipDeleted && account.username && account.sip_domain) {
      try {
        const release = await releaseAccountTombstone({ username: account.username, domain: account.sip_domain });
        tombstoneReleased = release?.released === true;
        console.log(`SIP account ${accountId} permanent delete: tombstone released=${tombstoneReleased}, username=${account.username}, domain=${account.sip_domain}`);
      } catch (tombstoneErr) {
        console.error(`SIP account ${accountId} permanent delete: tombstone release failed:`, tombstoneErr?.message);
        // tombstone release failure is non-fatal; continue with local delete
      }
    }

    // ── 本地刪除 ──
    connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(`DELETE FROM sip_external_accounts WHERE sip_user_id = ?`, [accountId]);
      await connection.query(`DELETE FROM sip_users WHERE id = ?`, [accountId]);
      await connection.commit();
      connection.release();
      return response.json({ message: "帳號已成功刪除。" });
    } catch (dbErr) {
      await connection.rollback().catch(() => {});
      connection.release();

      if (flexisipDeleted && flexisipAccountId) {
        // 远端已刪除但本地刪除失败，标记异常
        const now = new Date().toISOString().slice(0, 19).replace("T", " ");
        const errMsg = (dbErr?.message || String(dbErr)).substring(0, 500);
        const c4 = await pool.getConnection();
        await c4.query(
          `UPDATE sip_users SET sync_status = 'pending_delete', sync_error = ?, deleted_in_flexisip_at = ?, sync_attempts = sync_attempts + 1, last_synced_at = ? WHERE id = ?`,
          [errMsg, now, now, accountId],
        );
        c4.release();
        return response.status(500).json({
          message: "遠端已刪除但本地刪除失敗，請重試。",
          code: "LOCAL_DELETE_FAILED_AFTER_FLEXISIP_DELETE",
        });
      }

      return response.status(500).json({ message: "刪除帳號失敗。" });
    }
  } catch (error) {
    if (connection) { try { connection.release(); } catch {} }
    console.error("Failed to delete SIP account:", error?.message);
    return response.status(500).json({ message: "刪除帳號失敗。" });
  }
});

app.get("/api/admin/web-accounts", requireAdmin, async (request, response) => {
  const isPlatform = request.admin.accountType === 'platform';
  const tenantId = request.admin.tenantId;

  let connection;
  try {
    connection = await pool.getConnection();

    let whereClause = '';
    let params = [];
    if (!isPlatform && tenantId) {
      whereClause = 'WHERE u.tenant_id = ?';
      params.push(tenantId);
    }

    const rows = await connection.query(`
      SELECT
        u.id,
        u.username,
        u.sip_domain AS domain,
        u.display_name AS displayName,
        u.role,
        u.phone_number AS phone,
        u.email,
        u.status,
        u.created_at,
        u.tenant_id,
        c.display_name AS creator_name,
        t.name AS tenant_name
      FROM web_users u
      LEFT JOIN admin_users c ON u.created_by_admin_user_id = c.id
      LEFT JOIN tenants t ON u.tenant_id = t.id
      ${whereClause}
      ORDER BY u.created_at DESC
    `, params);

    const accounts = rows.map((row) => ({
      id: Number(row.id),
      username: row.username || "",
      domain: row.domain || "",
      displayName: row.displayName || "",
      role: row.role || "user",
      phone: row.phone || "",
      email: row.email || "",
      status: row.status || 'active',
      createdAt: row.created_at ? new Date(row.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-") : "",
      creatorName: row.creator_name || "-",
      tenantName: row.tenant_name || "",
      tenantId: row.tenant_id ? Number(row.tenant_id) : null,
    }));

    return response.json({ accounts });
  } catch (error) {
    console.error("Failed to fetch Web accounts:", error);
    return response.status(500).json({ message: "無法讀取 Web 帳號列表" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/web-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行 Web 帳號登記。" });
  }

  const payload = request.body || {};
  const username = sanitizeString(payload.username, 120);
  const domain = sanitizeString(payload.domain || webrtcDomain, 255);
  const displayName = sanitizeString(payload.displayName, 120);
  const password = String(payload.password || "");
  const role = payload.role === "admin" ? "admin" : "user";
  const status = ['active', "inactive", 'disabled', "pending"].includes(payload.status) ? payload.status : 'active';
  const phone = sanitizeString(payload.phone, 40);
  const email = sanitizeString(payload.email, 255);

  if (!username || !domain || !password) return response.status(400).json({ message: "缺少必填引數。" });
  if (password.length < 6) return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
  if (email && !isValidEmail(email)) return response.status(400).json({ message: "請輸入有效的電子郵箱。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const existing = await connection.query(`SELECT id FROM web_users WHERE username = ? AND sip_domain = ? LIMIT 1`, [username, domain]);
    if (existing.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "該使用者名稱已存在。" });
    }

    const passwordHash = await hashPassword(password);
    await connection.query(
      `INSERT INTO web_users (
         tenant_id, username, sip_domain, display_name, email, phone_number,
         password_hash, role, status, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.admin.tenantId || null, username, domain, displayName || null, email, phone || null, passwordHash, role, status, request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({ message: "Web 帳號登記成功" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to save Web account:", error);
    return response.status(500).json({ message: "Web 帳號儲存失敗" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/web-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行 Web 帳號登記。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  const payload = request.body || {};
  const domain = sanitizeString(payload.domain || webrtcDomain, 255);
  const displayName = sanitizeString(payload.displayName, 120);
  const password = String(payload.password || "");
  const role = payload.role === "admin" ? "admin" : "user";
  const status = ['active', "inactive", 'disabled', "pending"].includes(payload.status) ? payload.status : 'active';
  const phone = sanitizeString(payload.phone, 40);
  const email = sanitizeString(payload.email, 255);

  if (password && password.length < 6) return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
  if (email && !isValidEmail(email)) return response.status(400).json({ message: "請輸入有效的電子郵箱。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT id, tenant_id, username, sip_domain FROM web_users WHERE id = ? LIMIT 1`,
      [accountId],
    );
    const account = rows[0];
    if (!account) {
      await connection.rollback();
      return response.status(404).json({ message: "帳號不存在。" });
    }
    if (account.tenant_id != null) {
      await connection.rollback();
      return response.status(409).json({ message: "已經分配給租戶的帳號不允許編輯。" });
    }
    const duplicateRows = await connection.query(
      `SELECT id FROM web_users WHERE username = (SELECT username FROM web_users WHERE id = ?) AND sip_domain = ? AND id <> ? LIMIT 1`,
      [accountId, domain, accountId],
    );
    if (duplicateRows.length > 0) {
      await connection.rollback();
      return response.status(409).json({ message: "該域名下使用者名稱已存在。" });
    }

    let updateSql = `UPDATE web_users SET sip_domain = ?, display_name = ?, email = ?, phone_number = ?, role = ?, status = ?`;
    const updateParams = [domain, displayName || null, email, phone || null, role, status];

    if (password) {
      const passwordHash = await hashPassword(password);
      updateSql += `, password_hash = ?`;
      updateParams.push(passwordHash);
    }
    updateSql += ` WHERE id = ?`;
    updateParams.push(accountId);

    await connection.query(updateSql, updateParams);
    await connection.commit();
    return response.json({ message: "Web 帳號更新成功" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update Web account:", error);
    return response.status(500).json({ message: "Web 帳號更新失敗" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/web-accounts/:id/unassign", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行帳號操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`SELECT id FROM web_users WHERE id = ? LIMIT 1`, [accountId]);
    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    await connection.query(`UPDATE web_users SET tenant_id = NULL WHERE id = ?`, [accountId]);
    return response.json({ message: "Web 帳號已成功取消分配。" });
  } catch (error) {
    console.error("Failed to unassign Web account:", error);
    return response.status(500).json({ message: "取消分配失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/web-accounts/:id/reset-password", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行帳號操作。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  const password = String(request.body?.password || "");
  if (password.length < 6) {
    return response.status(400).json({ message: "密碼至少需要 6 個字元。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`SELECT id FROM web_users WHERE id = ? LIMIT 1`, [accountId]);
    if (rows.length === 0) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    const passwordHash = await hashPassword(password);
    await connection.query(`UPDATE web_users SET password_hash = ? WHERE id = ?`, [passwordHash, accountId]);
    return response.json({ message: "密碼重置成功。" });
  } catch (error) {
    console.error("Failed to reset Web account password:", error);
    return response.status(500).json({ message: "密碼重設失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/admin/web-accounts/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以刪除帳號。" });
  }

  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ message: "無效的帳號 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, tenant_id, username, sip_domain FROM web_users WHERE id = ? LIMIT 1`,
      [accountId],
    );
    const account = rows[0];
    if (!account) {
      return response.status(404).json({ message: "帳號不存在。" });
    }
    if (account.tenant_id != null) {
      return response.status(409).json({ message: "已經分配給租戶的帳號不允許刪除。" });
    }

    const remoteAccountName = String(rows[0].username || "").trim();
    const remoteSipDomain = String(rows[0].sip_domain || "").trim() || sipDomain;
    const remoteSipUri = remoteAccountName && remoteSipDomain ? `${remoteAccountName}@${remoteSipDomain}` : "";
    const remoteCleanup = {
      freepbxDeleted: false,
      flexisipDeleted: false,
    };

    if (remoteAccountName && /^\d+$/.test(remoteAccountName)) {
      try {
        const freepbxRecord = await freepbxFetchExtension(remoteAccountName).catch((error) => {
          if (error?.status === 404) return null;
          throw error;
        });
        if (freepbxRecord) {
          const deleteResult = await freepbxDeleteExtension(remoteAccountName);
          remoteCleanup.freepbxDeleted = Boolean(deleteResult?.status);
          if (!remoteCleanup.freepbxDeleted) {
            throw new Error(deleteResult?.message || "FreePBX extension delete failed");
          }
        } else {
          remoteCleanup.freepbxDeleted = true;
        }
      } catch (error) {
        console.error("Failed to delete FreePBX extension for Web account:", {
          accountId,
          username: remoteAccountName,
          message: error?.message || String(error),
          status: error?.status || null,
        });
        return response.status(502).json({
          message: "FreePBX 帳號刪除失敗。",
          code: "FREEPBX_EXTENSION_DELETE_FAILED",
        });
      }

      try {
        if (remoteSipUri) {
          const flexisipResult = await deleteFlexisipAccountBySipUri(remoteSipUri);
          remoteCleanup.flexisipDeleted = Boolean(flexisipResult?.deleted || flexisipResult?.matched);
          if (flexisipResult?.matched && !remoteCleanup.flexisipDeleted) {
            throw new Error("Flexisip account delete failed");
          }
        }
        const applyConfig = await freepbxApplyConfigAndWait().catch((error) => ({
          success: false,
          message: error?.message || "reload failed",
        }));
        if (!applyConfig?.success) {
          throw new Error(applyConfig?.message || "FreePBX apply config failed");
        }
      } catch (error) {
        console.error("Failed to delete Flexisip account for Web account:", {
          accountId,
          username: remoteAccountName,
          sipUri: remoteSipUri,
          message: error?.message || String(error),
          status: error?.status || null,
        });
        return response.status(502).json({
          message: "Flexisip 帳號刪除失敗。",
          code: "FLEXISIP_DELETE_FAILED",
        });
      }
    }

    await connection.beginTransaction();
    await connection.query(`DELETE FROM web_users WHERE id = ?`, [accountId]);
    await connection.commit();
    return response.json({
      message: "Web 帳號已成功刪除。",
      data: remoteCleanup,
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete Web account:", error);
    return response.status(500).json({ message: "刪除帳號失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/gate-devices", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視裝置。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`
      SELECT
        d.id,
        d.device_uuid,
        d.relay_id,
        d.subscribe_topic,
        d.publish_topic,
        d.wifi_name,
        d.wifi_password,
        d.tenant_id,
        d.assignment_status,
        d.assigned_at,
        d.expires_at,
        d.created_at,
        c.display_name AS creator_name,
        a.display_name AS assigned_by_name,
        t.name AS tenant_name
      FROM gate_devices d
      LEFT JOIN admin_users c ON d.created_by_admin_user_id = c.id
      LEFT JOIN admin_users a ON d.assigned_by_admin_user_id = a.id
      LEFT JOIN tenants t ON d.tenant_id = t.id
      ORDER BY d.created_at DESC, d.id DESC
    `);

    return response.json({
      devices: rows.map((row) => ({
        id: Number(row.id),
        uuid: row.device_uuid || "",
        relayId: row.relay_id || "",
        subscribeTopic: row.subscribe_topic || "",
        publishTopic: row.publish_topic || "",
        wifiName: row.wifi_name || "",
        wifiPassword: row.wifi_password || "",
        status: row.assignment_status || "unassigned",
        tenantId: row.tenant_id ? Number(row.tenant_id) : null,
        tenantName: row.tenant_name || "",
        assignedByName: row.assigned_by_name || "",
        assignedAt: row.assigned_at ? new Date(row.assigned_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-") : "",
        expiresAt: row.expires_at ? new Date(row.expires_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-") : "",
        createdAt: row.created_at ? new Date(row.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-") : "",
        creatorName: row.creator_name || "-",
      })),
    });
  } catch (error) {
    console.error("Failed to fetch gate devices:", error);
    return response.status(500).json({ message: "無法讀取裝置列表。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/gate-devices", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以新增裝置。" });
  }

  const payload = request.body || {};
  const uuid = sanitizeString(payload.uuid || generateGateDeviceUuid(), 120);
  const relayId = sanitizeString(payload.relayId, 120);
  const subscribeTopic = sanitizeString(payload.subscribeTopic, 255);
  const publishTopic = sanitizeString(payload.publishTopic, 255);
  const wifiName = sanitizeString(payload.wifiName, 120);
  const wifiPassword = sanitizeString(payload.wifiPassword, 255);
  const notes = sanitizeString(payload.notes, 1000);

  if (!subscribeTopic || !publishTopic) {
    return response.status(400).json({ message: "請填寫訂閱主題和釋出主題。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    let deviceUuid = uuid;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const existing = await connection.query(`SELECT id FROM gate_devices WHERE device_uuid = ? LIMIT 1`, [deviceUuid]);
      if (existing.length === 0) break;
      if (payload.uuid) {
        await connection.rollback();
        return response.status(409).json({ message: "該裝置 UUID 已存在。" });
      }
      deviceUuid = generateGateDeviceUuid();
    }

    const result = await connection.query(
      `INSERT INTO gate_devices (
         device_uuid, relay_id, subscribe_topic, publish_topic,
         wifi_name, wifi_password, assignment_status, created_by_admin_user_id, notes
       )
       VALUES (?, ?, ?, ?, ?, ?, 'unassigned', ?, ?)`,
      [deviceUuid, relayId || null, subscribeTopic, publishTopic, wifiName || null, wifiPassword || null, request.admin.id, notes || null],
    );
    await connection.query(
      `INSERT INTO gate_device_assignment_history (
         gate_device_id, tenant_id, from_status, to_status, changed_by_admin_user_id, change_reason
       )
       VALUES (?, NULL, NULL, 'unassigned', ?, 'device_created')`,
      [Number(result.insertId), request.admin.id],
    );

    await connection.commit();
    return response.status(201).json({ message: "裝置已新增。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to save gate device:", error);
    return response.status(500).json({ message: "裝置儲存失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/gate-devices/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以維護裝置。" });
  }

  const deviceId = Number(request.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return response.status(400).json({ message: "無效的裝置 ID。" });
  }

  const payload = request.body || {};
  const relayId = sanitizeString(payload.relayId, 120);
  const subscribeTopic = sanitizeString(payload.subscribeTopic, 255);
  const publishTopic = sanitizeString(payload.publishTopic, 255);
  const wifiName = sanitizeString(payload.wifiName, 120);
  const wifiPassword = sanitizeString(payload.wifiPassword, 255);
  const notes = sanitizeString(payload.notes, 1000);

  if (!subscribeTopic || !publishTopic) {
    return response.status(400).json({ message: "請填寫訂閱主題和釋出主題。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`SELECT id FROM gate_devices WHERE id = ? LIMIT 1`, [deviceId]);
    if (rows.length === 0) return response.status(404).json({ message: "裝置不存在。" });

    await connection.query(
      `UPDATE gate_devices
       SET relay_id = ?, subscribe_topic = ?, publish_topic = ?,
           wifi_name = ?, wifi_password = ?, notes = ?
       WHERE id = ?`,
      [relayId || null, subscribeTopic, publishTopic, wifiName || null, wifiPassword || null, notes || null, deviceId],
    );
    return response.json({ message: "裝置已更新。" });
  } catch (error) {
    console.error("Failed to update gate device:", error);
    return response.status(500).json({ message: "裝置更新失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/admin/gate-devices/:id/assign - 將設備分配給租戶
app.post("/api/admin/gate-devices/:id/assign", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行裝置操作。" });
  }

  const deviceId = Number(request.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return response.status(400).json({ message: "無效的裝置 ID。" });
  }

  const tenantId = Number(request.body.tenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return response.status(400).json({ message: "請選擇要分配的租戶。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [device] = await connection.query(
      "SELECT id, tenant_id, assignment_status FROM gate_devices WHERE id = ? LIMIT 1 FOR UPDATE",
      [deviceId]
    );
    if (!device) {
      await connection.rollback();
      return response.status(404).json({ message: "裝置不存在。" });
    }
    if (device.assignment_status === 'disabled') {
      await connection.rollback();
      return response.status(400).json({ message: "已停用的裝置無法分配。" });
    }
    if (device.assignment_status === "assigned" && Number(device.tenant_id) === tenantId) {
      await connection.rollback();
      return response.json({ message: "裝置已分配給該租戶。" });
    }

    // 检查租戶是否存在且有有效 SIP 帳號
    const [tenant] = await connection.query(
      "SELECT id FROM tenants WHERE id = ?", [tenantId]
    );
    if (!tenant) {
      await connection.rollback();
      return response.status(404).json({ message: "租戶不存在。" });
    }

    // 取得租戶當前生效套餐的截止日期作为設備有效期
    const [planExpiry] = await connection.query(
      `SELECT MAX(expires_at) AS latest_expiry
       FROM billing_orders
       WHERE tenant_id = ? AND expires_at IS NOT NULL AND expires_at > NOW()`,
      [tenantId]
    );

    const expiresAt = planExpiry?.latest_expiry || null;

    const prevTenantId = device.tenant_id;
    const prevStatus = device.assignment_status;

    await connection.query(
      `UPDATE gate_devices
       SET tenant_id = ?,
           assignment_status = 'assigned',
           assigned_at = NOW(),
           assigned_by_admin_user_id = ?,
           expires_at = ?
       WHERE id = ?`,
      [tenantId, request.admin.id, expiresAt, deviceId]
    );

    await connection.query(
      `INSERT INTO gate_device_assignment_history (
         gate_device_id, tenant_id, from_status, to_status, expires_at, changed_by_admin_user_id, change_reason
       )
       VALUES (?, ?, ?, 'assigned', ?, ?, 'assign')`,
      [deviceId, tenantId, prevStatus, expiresAt, request.admin.id]
    );

    await connection.commit();
    return response.json({
      message: "裝置已分配。",
      data: { id: deviceId, tenantId, expiresAt }
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to assign gate device:", error);
    return response.status(500).json({ message: "分配裝置失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/gate-devices/:id/unassign", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以進行裝置操作。" });
  }

  const deviceId = Number(request.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return response.status(400).json({ message: "無效的裝置 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const rows = await connection.query(`SELECT id, tenant_id, assignment_status FROM gate_devices WHERE id = ? LIMIT 1 FOR UPDATE`, [deviceId]);
    const device = rows[0];
    if (!device) {
      await connection.rollback();
      return response.status(404).json({ message: "裝置不存在。" });
    }
    if (device.assignment_status !== "assigned" || device.tenant_id == null) {
      await connection.rollback();
      return response.status(409).json({ message: "該裝置尚未分配給租戶。" });
    }
    await connection.query(
      `UPDATE gate_devices
       SET tenant_id = NULL,
           assignment_status = 'unassigned',
           assigned_at = NULL,
           assigned_by_admin_user_id = NULL,
           expires_at = NULL
       WHERE id = ?`,
      [deviceId],
    );
    await connection.query(
      `INSERT INTO gate_device_assignment_history (
         gate_device_id, tenant_id, from_status, to_status, changed_by_admin_user_id, change_reason
       )
       VALUES (?, ?, ?, 'unassigned', ?, 'unassign')`,
      [deviceId, Number(device.tenant_id), device.assignment_status, request.admin.id],
    );
    await connection.commit();
    return response.json({ message: "裝置已取消分配。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to unassign gate device:", error);
    return response.status(500).json({ message: "取消分配失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/admin/gate-devices/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以刪除裝置。" });
  }

  const deviceId = Number(request.params.id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return response.status(400).json({ message: "無效的裝置 ID。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const rows = await connection.query(`SELECT id, tenant_id FROM gate_devices WHERE id = ? LIMIT 1`, [deviceId]);
    const device = rows[0];
    if (!device) {
      await connection.rollback();
      return response.status(404).json({ message: "裝置不存在。" });
    }
    if (device.tenant_id != null) {
      await connection.rollback();
      return response.status(409).json({ message: "已經分配給租戶的裝置不允許刪除。" });
    }
    await connection.query(`DELETE FROM gate_devices WHERE id = ?`, [deviceId]);
    await connection.commit();
    return response.json({ message: "裝置已刪除。" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete gate device:", error);
    return response.status(500).json({ message: "裝置刪除失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/billing-orders - 平台管理員取得所有訂單列表
app.get("/api/admin/billing-orders", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視所有訂單。" });
  }

  const page = Math.max(1, Number.parseInt(request.query.page || "1", 10));
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(request.query.pageSize || "10", 10)));
  const offset = (page - 1) * pageSize;
  const statusFilter = sanitizeString(request.query.status || "all", 40);
  const keyword = sanitizeString(request.query.q, 120);

  const whereClauses = [];
  const params = [];

  if (statusFilter !== "all") {
    // Map UI filters to DB order_status and payment_status
    if (statusFilter === 'active_effective') {
      whereClauses.push(`o.order_status = 'review_approved' AND o.effective_at <= CURDATE() AND o.expires_at >= CURDATE()`);
    } else if (statusFilter === 'inactive_expired') {
      whereClauses.push(`o.order_status = 'review_approved' AND o.expires_at < CURDATE()`);
      } else if (statusFilter === 'expiring_soon') {
        whereClauses.push(`o.order_status = 'review_approved' AND o.expires_at >= CURDATE() AND o.expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)`);
    } else if (statusFilter === 'pending_review') {
      whereClauses.push(`o.order_status = 'pending_review'`);
      } else if (statusFilter === 'paid') {
        whereClauses.push(`p.paid_at IS NOT NULL`);
      } else if (statusFilter === 'unpaid') {
        whereClauses.push(`p.paid_at IS NULL`);
      } else if (statusFilter === 'reviewed') {
        whereClauses.push(`(o.order_status = 'review_approved' OR o.order_status = 'review_rejected')`);
    }
  }

  if (keyword) {
    const pattern = `%${keyword}%`;
    whereClauses.push(`(
      o.order_no LIKE ? OR
      t.name LIKE ? OR
      t.tenant_number LIKE ? OR
      plan.item_name LIKE ?
    )`);
    params.push(pattern, pattern, pattern, pattern);
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

  let connection;
  try {
    connection = await pool.getConnection();

    const countRows = await connection.query(`
      SELECT COUNT(DISTINCT o.id) AS total
      FROM billing_orders o
      LEFT JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN billing_order_items plan ON plan.order_id = o.id AND plan.item_type = 'plan'
      LEFT JOIN billing_payments p ON p.order_id = o.id
      ${whereSql}
    `, params);
    const totalItems = Number(countRows[0]?.total || 0);

    const statsQuery = `
      SELECT
        COUNT(DISTINCT o.id) AS total,
        COUNT(DISTINCT CASE WHEN o.order_status = 'review_approved' OR o.order_status = 'review_rejected' THEN o.id END) AS reviewed,
        COUNT(DISTINCT CASE WHEN o.order_status = 'pending_review' THEN o.id END) AS pending_review,
        COUNT(DISTINCT CASE WHEN o.order_status = 'review_approved' AND o.effective_at <= CURDATE() AND o.expires_at >= CURDATE() THEN o.id END) AS active,
        COUNT(DISTINCT CASE WHEN p.paid_at IS NOT NULL THEN o.id END) AS paid,
        COUNT(DISTINCT CASE WHEN p.paid_at IS NULL THEN o.id END) AS unpaid,
        COUNT(DISTINCT CASE WHEN o.order_status = 'review_approved' AND o.expires_at < CURDATE() THEN o.id END) AS expired,
        COUNT(DISTINCT CASE WHEN o.order_status = 'review_approved' AND o.expires_at >= CURDATE() AND o.expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN o.id END) AS expiring_soon
      FROM billing_orders o
      LEFT JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN billing_order_items plan ON plan.order_id = o.id AND plan.item_type = 'plan'
      LEFT JOIN billing_payments p ON p.order_id = o.id
      ${keyword ? `WHERE (o.order_no LIKE ? OR t.name LIKE ? OR t.tenant_number LIKE ? OR plan.item_name LIKE ?)` : ""}
    `;
    const statsRows = await connection.query(statsQuery, params);
    const stats = {
      total: Number(statsRows[0]?.total || 0),
      reviewed: Number(statsRows[0]?.reviewed || 0),
      pendingReview: Number(statsRows[0]?.pending_review || 0),
      active: Number(statsRows[0]?.active || 0),
      paid: Number(statsRows[0]?.paid || 0),
      unpaid: Number(statsRows[0]?.unpaid || 0),
      expired: Number(statsRows[0]?.expired || 0),
      expiringSoon: Number(statsRows[0]?.expiring_soon || 0)
    };

    const rows = await connection.query(`
      SELECT
        o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
        o.currency, o.payable_amount, o.order_status, o.payment_status,
        o.payment_method, o.payment_channel,
        DATE_FORMAT(o.effective_at, '%Y-%m-%d') AS effective_at,
        DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at,
        o.created_at, o.reviewed_at, o.reviewed_by_platform_admin_id, o.review_note,
        reviewer.display_name AS reviewer_name, reviewer.email AS reviewer_email,
        t.id AS tenant_id, t.tenant_number, t.name AS tenant_name,
        plan.item_name AS plan_name, plan.account_quantity, plan.months,
        GROUP_CONCAT(DISTINCT addon.item_name ORDER BY addon.sort_order SEPARATOR ', ') AS addon_names,
        MAX(p.payment_proof_uploaded_at) AS payment_proof_uploaded_at,
        MAX(p.payment_proof_file_url) AS payment_proof_file_url
      FROM billing_orders o
      LEFT JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN billing_order_items plan ON plan.order_id = o.id AND plan.item_type = 'plan'
      LEFT JOIN billing_order_items addon ON addon.order_id = o.id AND addon.item_type = 'addon'
      LEFT JOIN billing_payments p ON p.order_id = o.id
      LEFT JOIN admin_users reviewer ON reviewer.id = o.reviewed_by_platform_admin_id
      ${whereSql}
      GROUP BY
        o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
        o.currency, o.payable_amount, o.order_status, o.payment_status,
        o.payment_method, o.payment_channel, o.effective_at, o.expires_at, o.created_at,
        o.reviewed_at, o.reviewed_by_platform_admin_id, o.review_note,
        reviewer.display_name, reviewer.email,
        t.id, t.tenant_number, t.name,
        plan.item_name, plan.account_quantity, plan.months
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, pageSize, offset]);

    return response.json({
      stats,
      orders: rows.map(r => ({
        id: Number(r.id),
        order_no: r.order_no,
        order_type: r.order_type || "new_purchase",
        orderType: r.order_type || "new_purchase",
        renewal_source_order_id: r.renewal_source_order_id == null ? null : Number(r.renewal_source_order_id),
        renewalSourceOrderId: r.renewal_source_order_id == null ? null : Number(r.renewal_source_order_id),
        renewal_base_expires_at: r.renewal_base_expires_at ? String(r.renewal_base_expires_at).slice(0, 10) : "",
        renewalBaseExpiresAt: r.renewal_base_expires_at ? String(r.renewal_base_expires_at).slice(0, 10) : "",
        currency: r.currency,
        payable_amount: Number(r.payable_amount || 0),
        order_status: r.order_status,
        payment_status: r.payment_status,
        payment_method: r.payment_method,
        payment_channel: r.payment_channel,
        effective_at: r.effective_at,
        expires_at: r.expires_at,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at,
        reviewed_by_platform_admin_id: r.reviewed_by_platform_admin_id != null ? Number(r.reviewed_by_platform_admin_id) : null,
        reviewer_name: r.reviewer_name || r.reviewer_email || '',
        review_note: r.review_note,
        tenant_id: Number(r.tenant_id),
        tenantId: Number(r.tenant_id),
        tenant_number: r.tenant_number,
        tenant_name: r.tenant_name,
        plan_name: r.plan_name,
        account_quantity: Number(r.account_quantity || 0),
        accountQuantity: Number(r.account_quantity || 0),
        months: Number(r.months || 0),
        addon_names: r.addon_names,
        payment_proof_uploaded_at: r.payment_proof_uploaded_at,
        payment_proof_file_url: r.payment_proof_file_url,
        payableAmount: Number(r.payable_amount || 0),
      })),
      pagination: { total: totalItems, page, pageSize }
    });
  } catch (error) {
    console.error("Failed to fetch all billing orders:", error);
    return response.status(500).json({ message: "無法讀取所有訂單列表。" });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/billing-orders/:id/review", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以稽核訂單。" });
  }

  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "訂單編號無效。" });

  const status = sanitizeString(request.body?.status, 40);
  const reviewNote = sanitizeString(request.body?.comments ?? request.body?.reviewNote, 500);
  const sipAccountIds = Array.isArray(request.body?.sipAccountIds)
    ? request.body.sipAccountIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  if (!["review_approved", "review_rejected"].includes(status)) {
    return response.status(400).json({ message: "稽核結果無效。" });
  }
  if (status === "review_rejected" && !reviewNote) {
    return response.status(400).json({ message: "稽核不通過時必須填寫稽核意見。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const rows = await connection.query(
      `SELECT
         o.id, o.tenant_id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
         o.order_status, o.payment_status,
         plan.months, plan.account_quantity
       FROM billing_orders o
       LEFT JOIN billing_order_items plan ON plan.order_id = o.id AND plan.item_type = 'plan'
       WHERE o.id = ?
       LIMIT 1
       FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到訂單。" });
    }
    if (order.order_status === "review_approved") {
      await connection.rollback();
      return response.status(409).json({ message: "稽核通過的訂單不允許重複稽核。" });
    }
    if (!["pending_review", "review_rejected"].includes(order.order_status)) {
      await connection.rollback();
      return response.status(409).json({ message: "只有待稽核或稽核未通過的訂單可以提交稽核結果。" });
    }
    if (order.payment_status !== 'paid') {
      await connection.rollback();
      return response.status(409).json({ message: "訂單尚未完成支付，不能稽核通過。" });
    }

    const months = Math.max(1, Number(order.months || 1));
    const requiredAccountCount = Number(order.account_quantity || 0);
    const uniqueSipAccountIds = Array.from(new Set(sipAccountIds));
    const isRenewalOrder = order.order_type === "renewal";
    const renewalSourceOrderId = Number(order.renewal_source_order_id || 0);
    const addonRows = await connection.query(
      `SELECT id
       FROM billing_order_items
       WHERE order_id = ?
         AND item_type = 'addon'
       LIMIT 1`,
      [orderId],
    );
    const requiresWebAccounts = addonRows.length > 0;
    let allRenewalEntitlements = [];
    let renewalEntitlements = [];
    let renewalReplacementAccounts = [];
    let renewalStartDate = "";
    let renewalExpiresDate = "";

    const dateOnly = (value) => {
      if (!value) return "";
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toISOString().slice(0, 10);
    };
    const addDays = (value, days) => {
      const date = new Date(`${dateOnly(value)}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const addMonthsMinusOneDay = (value, monthCount) => {
      const date = new Date(`${dateOnly(value)}T00:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + monthCount);
      date.setUTCDate(date.getUTCDate() - 1);
      return date.toISOString().slice(0, 10);
    };
    const todayDate = () => new Date().toISOString().slice(0, 10);
    const releaseWebAccountsForSip = async (sipUserIds, serviceExpiresAt) => {
      const ids = Array.from(new Set((sipUserIds || []).map((id) => Number(id)).filter((id) => id > 0)));
      if (!ids.length) return;
      const rows = await connection.query(
        `SELECT id, web_user_id
         FROM tenant_web_account_entitlements
         WHERE tenant_id = ?
           AND sip_user_id IN (${ids.map(() => "?").join(",")})
           AND status = 'active'
         FOR UPDATE`,
        [Number(order.tenant_id), ...ids],
      );
      const entitlementIds = rows.map((row) => Number(row.id)).filter((id) => id > 0);
      const webUserIds = rows.map((row) => Number(row.web_user_id)).filter((id) => id > 0);
      if (webUserIds.length > 0) {
        await connection.query(
          `UPDATE web_users
           SET tenant_id = NULL,
               status = 'active',
               service_expires_at = NULL
           WHERE tenant_id = ?
             AND id IN (${webUserIds.map(() => "?").join(",")})`,
          [Number(order.tenant_id), ...webUserIds],
        );
      }
      if (entitlementIds.length > 0) {
        await connection.query(
          `UPDATE tenant_web_account_entitlements
           SET status = 'revoked',
               current_order_id = NULL,
               service_expires_at = ?,
               renewed_at = NOW(),
               renewed_by_admin_user_id = ?
           WHERE id IN (${entitlementIds.map(() => "?").join(",")})`,
          [serviceExpiresAt, request.admin.id, ...entitlementIds],
        );
      }
    };
    const allocateWebAccountsForSip = async (sipUserIds, serviceStartsAt, serviceExpiresAt, reuseExisting) => {
      if (!requiresWebAccounts) return;
      const finalSipUserIds = Array.from(new Set((sipUserIds || []).map((id) => Number(id)).filter((id) => id > 0)));
      if (finalSipUserIds.length !== requiredAccountCount) {
        const error = new Error("SIP 帳號分配數量異常，不能繼續分配 WebRTC 帳號。");
        error.httpStatus = 409;
        error.exposeMessage = true;
        throw error;
      }

      const assignments = [];
      const assignedSipIdSet = new Set();
      if (reuseExisting && finalSipUserIds.length > 0) {
        const reusableRows = await connection.query(
          `SELECT
             e.id AS entitlement_id,
             e.web_user_id,
             e.sip_user_id
           FROM tenant_web_account_entitlements e
           JOIN web_users u ON u.id = e.web_user_id
           WHERE e.tenant_id = ?
             AND e.sip_user_id IN (${finalSipUserIds.map(() => "?").join(",")})
             AND e.status = 'active'
           ORDER BY e.id ASC
           FOR UPDATE`,
          [Number(order.tenant_id), ...finalSipUserIds],
        );
        for (const row of reusableRows) {
          const sipUserId = Number(row.sip_user_id);
          if (assignedSipIdSet.has(sipUserId)) continue;
          assignedSipIdSet.add(sipUserId);
          assignments.push({
            sipUserId,
            webUserId: Number(row.web_user_id),
            entitlementId: Number(row.entitlement_id),
            reused: true,
          });
        }
      }

      const sipIdsNeedingWeb = finalSipUserIds.filter((id) => !assignedSipIdSet.has(id));
      if (sipIdsNeedingWeb.length > 0) {
        const webRows = await connection.query(
          `SELECT id
           FROM web_users
           WHERE tenant_id IS NULL
             AND status = 'active'
           ORDER BY RAND()
           LIMIT ${sipIdsNeedingWeb.length}
           FOR UPDATE`,
        );
        if (webRows.length !== sipIdsNeedingWeb.length) {
          const error = new Error(`未分配 WebRTC 帳號不足，還需要 ${sipIdsNeedingWeb.length} 個帳號用於訂單增值服務。`);
          error.httpStatus = 409;
          error.exposeMessage = true;
          throw error;
        }
        sipIdsNeedingWeb.forEach((sipUserId, index) => {
          assignments.push({
            sipUserId,
            webUserId: Number(webRows[index].id),
            entitlementId: null,
            reused: false,
          });
        });
      }

      const webUserIds = assignments.map((item) => item.webUserId);
      if (webUserIds.length > 0) {
        await connection.query(
          `UPDATE web_users
           SET tenant_id = ?,
               status = 'active',
               activated_at = COALESCE(activated_at, NOW()),
               service_expires_at = ?,
               reviewed_by_platform_admin_id = ?,
               reviewed_at = NOW()
           WHERE id IN (${webUserIds.map(() => "?").join(",")})`,
          [Number(order.tenant_id), serviceExpiresAt, request.admin.id, ...webUserIds],
        );
      }

      const reusedEntitlementIds = assignments.filter((item) => item.reused && item.entitlementId).map((item) => item.entitlementId);
      if (reusedEntitlementIds.length > 0) {
        await connection.query(
          `UPDATE tenant_web_account_entitlements
           SET current_order_id = ?,
               last_renewal_order_id = ?,
               status = 'active',
               service_starts_at = ?,
               service_expires_at = ?,
               renewed_at = NOW(),
               renewed_by_admin_user_id = ?
           WHERE id IN (${reusedEntitlementIds.map(() => "?").join(",")})`,
          [orderId, isRenewalOrder ? orderId : null, serviceStartsAt, serviceExpiresAt, request.admin.id, ...reusedEntitlementIds],
        );
      }

      for (const assignment of assignments.filter((item) => !item.reused)) {
        await connection.query(
          `INSERT INTO tenant_web_account_entitlements (
             tenant_id, web_user_id, sip_user_id, first_order_id, current_order_id, status,
             service_starts_at, service_expires_at, assigned_by_admin_user_id
           )
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             tenant_id = VALUES(tenant_id),
             sip_user_id = VALUES(sip_user_id),
             current_order_id = VALUES(current_order_id),
             status = VALUES(status),
             service_starts_at = VALUES(service_starts_at),
             service_expires_at = VALUES(service_expires_at),
             assigned_by_admin_user_id = VALUES(assigned_by_admin_user_id)`,
          [
            Number(order.tenant_id),
            assignment.webUserId,
            assignment.sipUserId,
            orderId,
            orderId,
            serviceStartsAt,
            serviceExpiresAt,
            request.admin.id,
          ],
        );
      }

      await connection.query(`DELETE FROM billing_order_web_accounts WHERE order_id = ?`, [orderId]);
      await connection.query(
        `INSERT INTO billing_order_web_accounts (
           order_id, tenant_id, web_user_id, sip_user_id, entitlement_id, username, sip_domain, display_name,
           email, phone_number, password_hash, role, account_status,
           service_starts_at, service_expires_at, assigned_by_admin_user_id
         )
         SELECT
           ?, ?, u.id, e.sip_user_id, e.id, u.username, u.sip_domain, u.display_name,
           u.email, u.phone_number, u.password_hash, u.role, u.status,
           ?, ?, ?
         FROM tenant_web_account_entitlements e
         JOIN web_users u ON u.id = e.web_user_id
         WHERE e.current_order_id = ?
           AND e.sip_user_id IN (${finalSipUserIds.map(() => "?").join(",")})`,
        [orderId, Number(order.tenant_id), serviceStartsAt, serviceExpiresAt, request.admin.id, orderId, ...finalSipUserIds],
      );
    };

    if (status === "review_approved") {
      if (requiredAccountCount <= 0) {
        await connection.rollback();
        return response.status(409).json({ message: "訂單帳號數量無效，不能稽核通過。" });
      }
      if (isRenewalOrder) {
        if (!renewalSourceOrderId) {
          await connection.rollback();
          return response.status(409).json({ message: "續訂訂單缺少來源訂單，不能稽核通過。" });
        }
        allRenewalEntitlements = await connection.query(
          `SELECT id, sip_user_id, service_expires_at
           FROM tenant_sip_account_entitlements
           WHERE tenant_id = ?
             AND (first_order_id = ? OR current_order_id = ? OR last_renewal_order_id = ?)
           ORDER BY id ASC
           FOR UPDATE`,
          [Number(order.tenant_id), renewalSourceOrderId, renewalSourceOrderId, renewalSourceOrderId],
        );
        const retainedRows = await connection.query(
          `SELECT entitlement_id, sip_user_id
           FROM billing_order_renewal_retained_accounts
           WHERE tenant_id = ? AND order_id = ?
           ORDER BY id ASC
           FOR UPDATE`,
          [Number(order.tenant_id), orderId],
        );
        if (allRenewalEntitlements.length < requiredAccountCount) {
          await connection.rollback();
          return response.status(409).json({ message: "當前續訂訂單帳號數量大於原帳號數量，暫不支援稽核通過。" });
        }
        const retainedEntitlementIds = new Set(retainedRows.map((item) => Number(item.entitlement_id)).filter((id) => id > 0));
        const retainedSipUserIds = new Set(retainedRows.map((item) => Number(item.sip_user_id)).filter((id) => id > 0));
        renewalEntitlements = allRenewalEntitlements.filter((item) => retainedEntitlementIds.has(Number(item.id)) || retainedSipUserIds.has(Number(item.sip_user_id)));
        if (renewalEntitlements.length !== retainedRows.length) {
          await connection.rollback();
          return response.status(409).json({ message: "續訂訂單包含無效的保留帳號，請重新生成續訂訂單。" });
        }
        if (renewalEntitlements.length > requiredAccountCount) {
          await connection.rollback();
          return response.status(409).json({ message: `續訂訂單最多複用 ${requiredAccountCount} 個帳號。` });
        }
        const replacementAccountCount = requiredAccountCount - renewalEntitlements.length;
        if (replacementAccountCount > 0) {
          renewalReplacementAccounts = await connection.query(
            `SELECT id, username, sip_domain, display_name
             FROM sip_users
             WHERE tenant_id IS NULL
               AND status = 'active'
             ORDER BY RAND()
             LIMIT ${replacementAccountCount}
             FOR UPDATE`,
          );
          if (renewalReplacementAccounts.length !== replacementAccountCount) {
            await connection.rollback();
            return response.status(409).json({ message: `未分配 SIP 帳號不足，還需要 ${replacementAccountCount} 個帳號用於續訂補分配。` });
          }
        }
        const today = new Date().toISOString().slice(0, 10);
        const baseCandidates = [
          dateOnly(order.renewal_base_expires_at),
          ...renewalEntitlements.map((item) => dateOnly(item.service_expires_at)),
        ].filter(Boolean).sort();
        const baseExpiresAt = baseCandidates[baseCandidates.length - 1] || "";
        renewalStartDate = baseExpiresAt && baseExpiresAt >= today ? addDays(baseExpiresAt, 1) : today;
        renewalExpiresDate = addMonthsMinusOneDay(renewalStartDate, months);
      } else {
        if (uniqueSipAccountIds.length !== requiredAccountCount) {
          await connection.rollback();
          return response.status(400).json({ message: `請選擇 ${requiredAccountCount} 個帳號後再提交稽核。` });
        }

        const accountPlaceholders = uniqueSipAccountIds.map(() => "?").join(",");
        const selectedSipAccounts = await connection.query(
          `SELECT id, tenant_id, username
           FROM sip_users
           WHERE id IN (${accountPlaceholders})
           FOR UPDATE`,
          uniqueSipAccountIds,
        );

        if (selectedSipAccounts.length !== requiredAccountCount) {
          await connection.rollback();
          return response.status(404).json({ message: "部分待分配帳號不存在，請重新整理後重試。" });
        }

        const assignedAccount = selectedSipAccounts.find((account) => account.tenant_id != null);
        if (assignedAccount) {
          await connection.rollback();
          return response.status(409).json({ message: `帳號 ${assignedAccount.username} 已被分配，請重新整理後重新選擇。` });
        }
      }
    }

    if (status === "review_approved") {
      if (isRenewalOrder) {
        const renewalSipUserIds = renewalEntitlements.map((item) => Number(item.sip_user_id));
        const renewalEntitlementIds = renewalEntitlements.map((item) => Number(item.id));
        const replacementSipUserIds = renewalReplacementAccounts.map((item) => Number(item.id));
        const allRenewalSipUserIds = [...renewalSipUserIds, ...replacementSipUserIds];
        const retainedEntitlementIdSet = new Set(renewalEntitlementIds);
        const releasedRenewalEntitlements = allRenewalEntitlements.filter((item) => !retainedEntitlementIdSet.has(Number(item.id)));
        const releasedSipUserIds = releasedRenewalEntitlements.map((item) => Number(item.sip_user_id));
        const releasedEntitlementIds = releasedRenewalEntitlements.map((item) => Number(item.id));
        await connection.query(
          `UPDATE billing_orders
           SET order_status = 'review_approved',
               reviewed_at = NOW(),
               reviewed_by_platform_admin_id = ?,
               review_note = ?,
               effective_at = ?,
               expires_at = ?,
               updated_by_admin_user_id = ?
           WHERE id = ?`,
          [request.admin.id, reviewNote || null, renewalStartDate, renewalExpiresDate, request.admin.id, orderId],
        );

        await connection.query(
          `UPDATE sip_users
           SET tenant_id = ?,
               status = 'active',
               activated_at = COALESCE(activated_at, NOW()),
               service_expires_at = ?,
               reviewed_by_platform_admin_id = ?,
               reviewed_at = NOW()
           WHERE id IN (${allRenewalSipUserIds.map(() => "?").join(",")})`,
          [Number(order.tenant_id), renewalExpiresDate, request.admin.id, ...allRenewalSipUserIds],
        );

        if (releasedSipUserIds.length > 0) {
          await connection.query(
            `UPDATE sip_users
             SET tenant_id = NULL,
                 status = 'active',
                 service_expires_at = NULL
             WHERE tenant_id = ?
               AND id IN (${releasedSipUserIds.map(() => "?").join(",")})`,
            [Number(order.tenant_id), ...releasedSipUserIds],
          );
        }

        if (releasedEntitlementIds.length > 0) {
          await connection.query(
            `UPDATE tenant_sip_account_entitlements
             SET status = 'revoked',
                 current_order_id = NULL,
                 service_expires_at = ?,
                 renewed_at = NOW(),
                 renewed_by_admin_user_id = ?
             WHERE id IN (${releasedEntitlementIds.map(() => "?").join(",")})`,
            [renewalStartDate, request.admin.id, ...releasedEntitlementIds],
          );
        }

        if (renewalEntitlementIds.length > 0) {
          await connection.query(
            `UPDATE tenant_sip_account_entitlements
             SET current_order_id = ?,
                 last_renewal_order_id = ?,
                 status = 'active',
                 service_starts_at = ?,
                 service_expires_at = ?,
                 renewed_at = NOW(),
                 renewed_by_admin_user_id = ?
             WHERE id IN (${renewalEntitlementIds.map(() => "?").join(",")})`,
            [orderId, orderId, renewalStartDate, renewalExpiresDate, request.admin.id, ...renewalEntitlementIds],
          );
        }

        if (replacementSipUserIds.length > 0) {
          await connection.query(
            `INSERT INTO tenant_sip_account_entitlements (
               tenant_id, sip_user_id, first_order_id, current_order_id, status,
               service_starts_at, service_expires_at, assigned_by_admin_user_id
             )
             SELECT
               ?, u.id, ?, ?, 'active',
               ?, ?, ?
             FROM sip_users u
             WHERE u.id IN (${replacementSipUserIds.map(() => "?").join(",")})
             ON DUPLICATE KEY UPDATE
               tenant_id = VALUES(tenant_id),
               current_order_id = VALUES(current_order_id),
               status = VALUES(status),
               service_starts_at = VALUES(service_starts_at),
               service_expires_at = VALUES(service_expires_at),
               assigned_by_admin_user_id = VALUES(assigned_by_admin_user_id)`,
            [Number(order.tenant_id), orderId, orderId, renewalStartDate, renewalExpiresDate, request.admin.id, ...replacementSipUserIds],
          );
        }

        await connection.query(`DELETE FROM billing_order_sip_accounts WHERE order_id = ?`, [orderId]);
        await connection.query(
          `INSERT INTO billing_order_sip_accounts (
             order_id, tenant_id, sip_user_id, entitlement_id, username, sip_domain, display_name,
             email, phone_number, password_hash, role, account_status,
             service_starts_at, service_expires_at, assigned_by_admin_user_id
           )
           SELECT
             ?, ?, u.id, e.id, u.username, u.sip_domain, u.display_name,
             u.email, u.phone_number, u.password_hash, u.role, u.status,
             ?, ?, ?
           FROM tenant_sip_account_entitlements e
           JOIN sip_users u ON u.id = e.sip_user_id
           WHERE e.current_order_id = ?
             AND e.sip_user_id IN (${allRenewalSipUserIds.map(() => "?").join(",")})`,
          [orderId, Number(order.tenant_id), renewalStartDate, renewalExpiresDate, request.admin.id, orderId, ...allRenewalSipUserIds],
        );

        if (requiresWebAccounts) {
          await releaseWebAccountsForSip(releasedSipUserIds, renewalStartDate);
          await allocateWebAccountsForSip(allRenewalSipUserIds, renewalStartDate, renewalExpiresDate, true);
        }
      } else {
        const serviceStartsAt = todayDate();
        const serviceExpiresAt = addMonthsMinusOneDay(serviceStartsAt, months);
        const serviceExpiresExpression = `DATE_SUB(DATE_ADD(CURDATE(), INTERVAL ? MONTH), INTERVAL 1 DAY)`;
        await connection.query(
          `UPDATE billing_orders
           SET order_status = 'review_approved',
               reviewed_at = NOW(),
               reviewed_by_platform_admin_id = ?,
               review_note = ?,
               effective_at = CURDATE(),
               expires_at = ${serviceExpiresExpression},
               updated_by_admin_user_id = ?
           WHERE id = ?`,
          [request.admin.id, reviewNote || null, months, request.admin.id, orderId],
        );

        await connection.query(
          `UPDATE sip_users
           SET tenant_id = ?,
               status = 'active',
               activated_at = COALESCE(activated_at, NOW()),
               service_expires_at = ${serviceExpiresExpression},
               reviewed_by_platform_admin_id = ?,
               reviewed_at = NOW()
           WHERE id IN (${uniqueSipAccountIds.map(() => "?").join(",")})`,
          [Number(order.tenant_id), months, request.admin.id, ...uniqueSipAccountIds],
        );

        await connection.query(`DELETE FROM billing_order_sip_accounts WHERE order_id = ?`, [orderId]);
        await connection.query(
          `INSERT INTO tenant_sip_account_entitlements (
             tenant_id, sip_user_id, first_order_id, current_order_id, status,
             service_starts_at, service_expires_at, assigned_by_admin_user_id
           )
           SELECT
             ?, u.id, ?, ?, 'active',
             CURDATE(), ${serviceExpiresExpression}, ?
           FROM sip_users u
           WHERE u.id IN (${uniqueSipAccountIds.map(() => "?").join(",")})
           ON DUPLICATE KEY UPDATE
             tenant_id = VALUES(tenant_id),
             current_order_id = VALUES(current_order_id),
             status = VALUES(status),
             service_expires_at = VALUES(service_expires_at),
             assigned_by_admin_user_id = VALUES(assigned_by_admin_user_id)`,
          [Number(order.tenant_id), orderId, orderId, months, request.admin.id, ...uniqueSipAccountIds],
        );

        await connection.query(
          `INSERT INTO billing_order_sip_accounts (
             order_id, tenant_id, sip_user_id, entitlement_id, username, sip_domain, display_name,
             email, phone_number, password_hash, role, account_status,
             service_starts_at, service_expires_at, assigned_by_admin_user_id
           )
           SELECT
             ?, ?, u.id, e.id, u.username, u.sip_domain, u.display_name,
             u.email, u.phone_number, u.password_hash, u.role, u.status,
             CURDATE(), ${serviceExpiresExpression}, ?
           FROM sip_users u
           JOIN tenant_sip_account_entitlements e ON e.sip_user_id = u.id
           WHERE u.id IN (${uniqueSipAccountIds.map(() => "?").join(",")})`,
          [orderId, Number(order.tenant_id), months, request.admin.id, ...uniqueSipAccountIds],
        );

        if (requiresWebAccounts) {
          await allocateWebAccountsForSip(uniqueSipAccountIds, serviceStartsAt, serviceExpiresAt, false);
        }
      }
    } else {
      await connection.query(
        `UPDATE billing_orders
         SET order_status = 'review_rejected',
             reviewed_at = NOW(),
             reviewed_by_platform_admin_id = ?,
             review_note = ?,
             effective_at = NULL,
             expires_at = NULL,
             updated_by_admin_user_id = ?
         WHERE id = ?`,
        [request.admin.id, reviewNote, request.admin.id, orderId],
      );
    }

    await connection.query(
      `INSERT INTO billing_order_status_history (
         order_id, tenant_id, from_order_status, to_order_status,
         from_payment_status, to_payment_status, change_reason, created_by_admin_user_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        Number(order.tenant_id),
        order.order_status,
        status,
        order.payment_status,
        order.payment_status,
        status === "review_approved" ? "review_approved" : "review_rejected",
        request.admin.id,
      ],
    );

    const reviewResultText = status === "review_approved" ? "稽核通過" : "稽核未通過";
    const notificationTitle = status === "review_approved" ? "訂單稽核通過" : "訂單稽核未通過";
    const assignedAccountText = requiresWebAccounts
      ? `已為該訂單分配 ${requiredAccountCount} 個 SIP 帳號及對應 WebRTC 帳號`
      : `已為該訂單分配 ${requiredAccountCount} 個 SIP 帳號`;
    const notificationBody = status === "review_approved"
      ? `訂單 ${order.order_no || orderId} 的稽核結果為：${reviewResultText}。${assignedAccountText}，請前往“帳號管理”檢視已分配帳號。`
      : `訂單 ${order.order_no || orderId} 的稽核結果為：${reviewResultText}。請前往“我的套餐”檢視稽核意見並重新提交稽核。`;
    const notificationTargetView = status === "review_approved" ? "tenant-account-management" : "domain";
    const notificationResult = await connection.query(
      `INSERT INTO notification_events (
         tenant_id, scope_type, scope_id, event_type, sender_type, sender_id, dedupe_key,
         title, body, severity, status, target_view, resolved_at
       )
       VALUES (?, 'billing_order', ?, 'billing_order_review_result', 'platform_admin', ?, ?, ?, ?, ?, 'active', ?, NULL)`,
      [
        Number(order.tenant_id),
        orderId,
        request.admin.id,
        `order:${orderId}:review_result:${Date.now()}`,
        notificationTitle,
        notificationBody,
        status === "review_rejected" ? 'warning' : "info",
        notificationTargetView,
      ],
    );
    const notificationEventId = Number(notificationResult.insertId || 0);
    if (notificationEventId > 0) {
      await connection.query(
        `INSERT IGNORE INTO notification_receipts (event_id, admin_user_id)
         SELECT ?, id
         FROM admin_users
         WHERE tenant_id = ?
           AND account_type = 'tenant'
           AND status = 'active'`,
        [notificationEventId, Number(order.tenant_id)],
      );
    }

    await connection.commit();
    return response.json({ message: "稽核結果已儲存。", order: { id: orderId, orderStatus: status, reviewNote } });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to review billing order:", error);
    if (error?.exposeMessage && error?.httpStatus) {
      return response.status(error.httpStatus).json({ message: error.message });
    }
    return response.status(500).json({ message: "儲存稽核結果失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/billing-orders/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視任意訂單詳情。" });
  }

  const orderId = Number(request.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) return response.status(400).json({ message: "訂單編號無效。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         o.id, o.order_no, o.order_type, o.renewal_source_order_id, o.renewal_base_expires_at,
         o.currency, o.subtotal_amount, o.discount_amount, o.payable_amount,
         o.order_status, o.payment_status, o.payment_method, o.payment_channel, o.billing_address,
         DATE_FORMAT(o.reviewed_at, '%Y-%m-%d') AS reviewed_at,
         DATE_FORMAT(o.effective_at, '%Y-%m-%d') AS effective_at,
         DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at,
         o.review_note,
         o.coupon_code, o.coupon_discount_type, o.coupon_discount_value,
         DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS coupon_valid_until,
         t.name AS tenant_name, t.tenant_number
       FROM billing_orders o
       LEFT JOIN tenants t ON t.id = o.tenant_id
       LEFT JOIN billing_coupons c ON c.id = o.coupon_id
       WHERE o.id = ?
       LIMIT 1`,
      [orderId],
    );
    const order = rows[0];
    if (!order) return response.status(404).json({ message: "找不到訂單。" });

    const itemRows = await connection.query(
      `SELECT
         item_type, item_code, item_name, account_quantity, quantity, months,
         currency, unit_price, discount_amount, line_amount, sort_order
       FROM billing_order_items
       WHERE order_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [orderId],
    );
    const retainedRows = await connection.query(
      `SELECT
         r.sip_user_id,
         r.entitlement_id,
         r.username,
         r.sip_domain,
         r.display_name,
         DATE_FORMAT(r.source_service_expires_at, '%Y-%m-%d') AS source_service_expires_at
       FROM billing_order_renewal_retained_accounts r
       WHERE r.order_id = ?
       ORDER BY r.username ASC, r.id ASC`,
      [orderId],
    );

    // Query assigned SIP accounts
    const sipAccountRows = await connection.query(
      `SELECT username, sip_domain, display_name, email, account_status,
              DATE_FORMAT(service_starts_at, '%Y-%m-%d') AS service_starts_at,
              DATE_FORMAT(service_expires_at, '%Y-%m-%d') AS service_expires_at
       FROM billing_order_sip_accounts
       WHERE order_id = ?
       ORDER BY username ASC`,
      [orderId],
    );

    // Query assigned Web accounts
    const webAccountRows = await connection.query(
      `SELECT username, display_name, sip_domain,
              DATE_FORMAT(service_starts_at, '%Y-%m-%d') AS service_starts_at,
              DATE_FORMAT(service_expires_at, '%Y-%m-%d') AS service_expires_at
       FROM billing_order_web_accounts
       WHERE order_id = ?
       ORDER BY username ASC`,
      [orderId],
    );

    return response.json({
      order: {
        id: Number(order.id),
        orderNo: order.order_no || "",
        order_type: order.order_type || "new_purchase",
        orderType: order.order_type || "new_purchase",
        renewal_source_order_id: order.renewal_source_order_id == null ? null : Number(order.renewal_source_order_id),
        renewalSourceOrderId: order.renewal_source_order_id == null ? null : Number(order.renewal_source_order_id),
        renewal_base_expires_at: order.renewal_base_expires_at ? String(order.renewal_base_expires_at).slice(0, 10) : "",
        renewalBaseExpiresAt: order.renewal_base_expires_at ? String(order.renewal_base_expires_at).slice(0, 10) : "",
        currency: order.currency || "USD",
        subtotalAmount: Number(order.subtotal_amount || 0),
        discountAmount: Number(order.discount_amount || 0),
        payableAmount: Number(order.payable_amount || 0),
        orderStatus: order.order_status || "",
        paymentStatus: order.payment_status || "",
        paymentMethod: order.payment_method || "",
        paymentChannel: order.payment_channel || "",
        billingAddress: order.billing_address || "",
        reviewedAt: order.reviewed_at || "",
        reviewNote: order.review_note || "",
        effectiveAt: order.effective_at || "",
        expiresAt: order.expires_at || "",
        tenantName: order.tenant_name || "",
        tenantNumber: order.tenant_number || "",
        coupon: order.coupon_code ? { couponCode: order.coupon_code } : null,
        retainedAccounts: retainedRows.map((account) => ({
          sipUserId: Number(account.sip_user_id),
          entitlementId: account.entitlement_id == null ? null : Number(account.entitlement_id),
          username: account.username || "",
          sipDomain: account.sip_domain || "",
          displayName: account.display_name || "",
          sourceServiceExpiresAt: account.source_service_expires_at || "",
        })),
        sipAccounts: (sipAccountRows || []).map(a => ({
          username: a.username || '',
          sipDomain: a.sip_domain || '',
          displayName: a.display_name || '',
          email: a.email || '',
          status: a.account_status || '',
          serviceStartsAt: a.service_starts_at || '',
          serviceExpiresAt: a.service_expires_at || '',
        })),
        webAccounts: (webAccountRows || []).map(a => ({
          username: a.username || '',
          displayName: a.display_name || '',
          domain: a.sip_domain || '',
          serviceStartsAt: a.service_starts_at || '',
          serviceExpiresAt: a.service_expires_at || '',
        })),
        items: itemRows.map((item) => ({
          itemType: item.item_type || "",
          itemCode: item.item_code || "",
          itemName: item.item_name || "",
          accountQuantity: item.account_quantity == null ? null : Number(item.account_quantity),
          quantity: Number(item.quantity || 0),
          months: Number(item.months || 0),
          currency: item.currency || "USD",
          unitPrice: Number(item.unit_price || 0),
          discountAmount: Number(item.discount_amount || 0),
          lineAmount: Number(item.line_amount || 0),
        })),
      },
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ message: "讀取訂單詳情失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * ==========================================
 * Ecard 样式管理 API
 * ==========================================
 */

// GET /api/tenant/ecard-styles - 租戶侧取得已啟用的 Ecard 样式
app.get("/api/tenant/ecard-styles", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平臺管理員請使用樣式管理頁面。" });
  }
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視 Ecard 樣式。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    // 只讀取启用的样式，按排序规则排列
    const styles = await connection.query(`
      SELECT 
        id, style_code, style_name, style_type, company_name_enabled, 
        description, cover_image_url, status, sort_order
      FROM ecard_styles
      WHERE status = 'active'
      ORDER BY sort_order ASC, id ASC
    `);

    if (styles.length === 0) {
      return response.json({ styles: [] });
    }

    // 批量讀取这些样式的背景图片
    const styleIds = styles.map(s => s.id);
    const placeholders = styleIds.map(() => '?').join(',');
    const backgrounds = await connection.query(`
      SELECT id, style_id, background_name, image_url, layout_json, default_style_json, display_config_json
      FROM ecard_style_backgrounds
      WHERE style_id IN (${placeholders})
      ORDER BY sort_order ASC, id ASC
    `, styleIds);

    const bgMap = backgrounds.reduce((acc, bg) => {
      const sid = Number(bg.style_id);
      if (!acc[sid]) acc[sid] = [];
      acc[sid].push({
        id: Number(bg.id),
        imageUrl: bg.image_url,
        backgroundName: bg.background_name || '',
        layoutJson: typeof bg.layout_json === 'string' ? JSON.parse(bg.layout_json) : (bg.layout_json || null),
        defaultStyleJson: typeof bg.default_style_json === 'string' ? JSON.parse(bg.default_style_json) : (bg.default_style_json || null),
        displayConfigJson: typeof bg.display_config_json === 'string' ? JSON.parse(bg.display_config_json) : (bg.display_config_json || null)
      });
      return acc;
    }, {});

    const formattedStyles = styles.map(row => ({
      id: Number(row.id),
      styleCode: row.style_code,
      styleName: row.style_name,
      styleType: row.style_type,
      companyNameEnabled: Boolean(row.company_name_enabled),
      description: row.description || '',
      coverImageUrl: row.cover_image_url || '',
      status: row.status,
      sortOrder: Number(row.sort_order || 0),
      backgrounds: bgMap[Number(row.id)] || []
    }));

    return response.json({ styles: formattedStyles });
  } catch (error) {
    console.error('Failed to fetch tenant ecard styles:', error);
    return response.status(500).json({ message: '取得 Ecard 樣式失敗' });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/ecard-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平臺管理員無法直接檢視租戶電子名片。" });
  }
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視名片帳號列表。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         su.id AS sip_user_id,
         su.username AS sip_account,
         su.display_name AS user_name,
         wu.username AS web_account,
         ec.id AS ecard_id,
         ec.thumbnail_url,
         ec.avatar_url,
         DATE_FORMAT(COALESCE(ec.valid_from, su.activated_at), '%Y-%m-%d') AS valid_from,
         DATE_FORMAT(COALESCE(ec.valid_to, su.service_expires_at), '%Y-%m-%d') AS valid_to,
         ec.status AS ecard_status,
         ec.access_slug,
         au.display_name AS created_by,
         t.name AS tenant_name,
         DATE_FORMAT(ec.created_at, '%Y-%m-%d') AS created_at
       FROM sip_users su
       LEFT JOIN tenant_web_account_entitlements ent 
         ON su.id = ent.sip_user_id AND ent.tenant_id = su.tenant_id AND ent.status = 'active'
       LEFT JOIN web_users wu 
         ON ent.web_user_id = wu.id
       LEFT JOIN tenant_ecards ec 
         ON su.id = ec.sip_user_id AND ec.tenant_id = su.tenant_id
       LEFT JOIN tenants t
         ON su.tenant_id = t.id
       LEFT JOIN admin_users au 
         ON ec.created_by_admin_id = au.id
       LEFT JOIN tenant_contact_book_assignments cba ON cba.sip_user_id = su.id AND cba.status != 'revoked' LEFT JOIN tenant_contact_books tcb ON tcb.id = cba.contact_book_id AND tcb.tenant_id = su.tenant_id WHERE su.tenant_id = ? AND su.status = 'active'
       ORDER BY su.username ASC`,
      [request.admin.tenantId]
    );

    const baseUrl = process.env.ECARD_APP_URL || "https://ecard.qrtalkie.org";

    const accounts = rows.map(row => {
      const configured = row.ecard_id != null;
      const slug = row.access_slug || row.sip_account;
      return {
        id: Number(row.sip_user_id),
        userName: row.user_name || "",
        sipAccount: row.sip_account || "",
        webAccount: row.web_account || "",
        avatarUrl: row.avatar_url || "",
        ecardThumbnailUrl: row.thumbnail_url || "",
        configured: configured,
        enabled: configured && row.ecard_status === 'active',
        validFrom: row.valid_from || "",
        validTo: row.valid_to || "",
        downloadUrl: configured ? `${baseUrl}/d/${slug}` : "",
        accessUrl: configured ? `${baseUrl}/u/${slug}` : "",
        createdBy: row.created_by || "",
        createdAt: row.created_at || "",
        tenantName: row.tenant_name || "",
      };
    });

    return response.json({ accounts });
  } catch (error) {
    console.error('Failed to fetch tenant ecard accounts:', error);
    return response.status(500).json({ message: '取得名片帳號列表失敗' });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * ==========================================
 * Ecard 样式管理 API (平台管理員)
 * ==========================================
 */
app.get("/api/admin/ecard-styles", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視 Ecard 樣式。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(`
      SELECT 
        e.id, e.style_code, e.style_name, e.style_type, e.company_name_enabled, 
        e.description, e.cover_image_url, e.sample_count, e.status, e.sort_order, 
        e.created_by, e.created_by_name, e.created_at, e.updated_at
      FROM ecard_styles e
      ORDER BY e.sort_order ASC, e.id DESC
    `);
    
    return response.json({
      styles: rows.map(row => ({
        id: Number(row.id),
        styleCode: row.style_code,
        styleName: row.style_name,
        styleType: row.style_type,
        companyNameEnabled: Boolean(row.company_name_enabled),
        description: row.description || '',
        coverImageUrl: row.cover_image_url || '',
        sampleCount: Number(row.sample_count || 0),
        status: row.status,
        sortOrder: Number(row.sort_order || 0),
        createdBy: row.created_by ? Number(row.created_by) : null,
        createdByName: row.created_by_name || '',
        createdAt: row.created_at ? new Date(row.created_at).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\//g, "-") : '',
      }))
    });
  } catch (error) {
    console.error('Failed to fetch ecard styles:', error);
    return response.status(500).json({ message: '取得 Ecard 樣式失敗' });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/admin/ecard-styles/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視 Ecard 樣式。" });
  }
  
  const styleId = Number(request.params.id);
  if (!styleId) return response.status(400).json({ message: "無效的樣式 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [styleRow] = await connection.query(`SELECT * FROM ecard_styles WHERE id = ?`, [styleId]);

    if (!styleRow) {
      return response.status(404).json({ message: "找不到指定的樣式。" });
    }

    const sampleRows = await connection.query(`SELECT * FROM ecard_style_samples WHERE style_id = ? ORDER BY sort_order ASC, id ASC`, [styleId]);
    const bgRows = await connection.query(`SELECT * FROM ecard_style_backgrounds WHERE style_id = ? ORDER BY sort_order ASC, id ASC`, [styleId]);

    return response.json({
      style: {
        id: Number(styleRow.id),
        styleCode: styleRow.style_code,
        styleName: styleRow.style_name,
        styleType: styleRow.style_type,
        companyNameEnabled: Boolean(styleRow.company_name_enabled),
        description: styleRow.description || '',
        coverImageUrl: styleRow.cover_image_url || '',
        sampleCount: Number(styleRow.sample_count || 0),
        status: styleRow.status,
        sortOrder: Number(styleRow.sort_order || 0),
        samples: sampleRows.map(s => ({
          id: Number(s.id),
          imageUrl: s.image_url,
          isCover: Boolean(s.is_cover)
        })),
        backgrounds: bgRows.map(b => ({
          id: Number(b.id),
          imageUrl: b.image_url,
          backgroundName: b.background_name || '',
          layoutJson: typeof b.layout_json === 'string' ? JSON.parse(b.layout_json) : (b.layout_json || null),
          defaultStyleJson: typeof b.default_style_json === 'string' ? JSON.parse(b.default_style_json) : (b.default_style_json || null),
          displayConfigJson: typeof b.display_config_json === 'string' ? JSON.parse(b.display_config_json) : (b.display_config_json || null)
        }))
      }
    });
  } catch (error) {
    console.error('Failed to fetch ecard style details:', error);
    return response.status(500).json({ message: '取得樣式詳情失敗' });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/admin/ecard-styles", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以建立 Ecard 樣式。" });
  }

  const payload = request.body || {};
  const styleCode = sanitizeString(payload.styleCode, 64);
  const styleName = sanitizeString(payload.styleName, 128);
  const styleType = sanitizeString(payload.styleType, 32);
  const status = sanitizeString(payload.status, 32);
  const description = sanitizeString(payload.description, 255);
  const sortOrder = Number(payload.sortOrder || 0);
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const backgrounds = Array.isArray(payload.backgrounds) ? payload.backgrounds : [];
  const companyNameEnabled = styleType === 'with_company' ? 1 : 0;

  if (!styleCode || !styleName) {
    return response.status(400).json({ message: "請填寫樣式編號和名稱。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.query(`SELECT id FROM ecard_styles WHERE style_code = ?`, [styleCode]);
    if (existing) {
      await connection.rollback();
      return response.status(409).json({ message: "該樣式編號已存在。" });
    }

    const styleResult = await connection.query(
      `INSERT INTO ecard_styles (style_code, style_name, style_type, company_name_enabled, description, status, sort_order, sample_count, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [styleCode, styleName, styleType, companyNameEnabled, description || null, status, sortOrder, samples.length, request.admin.id, request.admin.nickname || request.admin.displayName || '']
    );
    const styleId = styleResult.insertId;
    let coverImageUrl = null;
    let firstImageUrl = null;

    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      let imageUrl = sample.dataUrl ? await saveEcardImage(sample.dataUrl, sample.fileName) : '';
      if (i === 0) firstImageUrl = imageUrl;
      if (sample.isCover && !coverImageUrl) coverImageUrl = imageUrl;
      await connection.query(
        `INSERT INTO ecard_style_samples (style_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`,
        [styleId, imageUrl, sample.isCover ? 1 : 0, i]
      );
    }
    for (let i = 0; i < backgrounds.length; i++) {
      const bg = backgrounds[i];
      let bgImageUrl = bg.dataUrl ? await saveEcardImage(bg.dataUrl, bg.fileName) : '';
      await connection.query(
        `INSERT INTO ecard_style_backgrounds (style_id, background_name, image_url, sort_order, layout_json, default_style_json, display_config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [styleId, sanitizeString(bg.backgroundName, 128), bgImageUrl, i, bg.layoutJson ? JSON.stringify(bg.layoutJson) : null, bg.defaultStyleJson ? JSON.stringify(bg.defaultStyleJson) : null, bg.displayConfigJson ? JSON.stringify(bg.displayConfigJson) : null]
      );
    }

    coverImageUrl = coverImageUrl || firstImageUrl || null;
    await connection.query(`UPDATE ecard_styles SET cover_image_url = ? WHERE id = ?`, [coverImageUrl, styleId]);
    await connection.commit();
    return response.status(201).json({ message: "Ecard 樣式建立成功" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to create Ecard style:", error);
    return response.status(500).json({ message: "建立 Ecard 樣式失敗" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/ecard-styles/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以修改 Ecard 樣式。" });
  }

  const styleId = Number(request.params.id);
  if (!styleId) return response.status(400).json({ message: "無效的樣式 ID。" });

  const payload = request.body || {};
  const styleName = sanitizeString(payload.styleName, 128);
  const styleType = sanitizeString(payload.styleType, 32);
  const status = sanitizeString(payload.status, 32);
  const description = sanitizeString(payload.description, 255);
  const sortOrder = Number(payload.sortOrder || 0);
  const samples = Array.isArray(payload.samples) ? payload.samples : [];
  const backgrounds = Array.isArray(payload.backgrounds) ? payload.backgrounds : [];
  const companyNameEnabled = styleType === 'with_company' ? 1 : 0;

  if (!styleName) return response.status(400).json({ message: "請填寫樣式名稱。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.query(`SELECT id FROM ecard_styles WHERE id = ?`, [styleId]);
    if (!existing) {
      await connection.rollback();
      return response.status(404).json({ message: "找不到該樣式。" });
    }

    await connection.query(
      `UPDATE ecard_styles SET style_name = ?, style_type = ?, company_name_enabled = ?, description = ?, status = ?, sort_order = ?, sample_count = ? WHERE id = ?`,
      [styleName, styleType, companyNameEnabled, description || null, status, sortOrder, samples.length, styleId]
    );

    let coverImageUrl = null;
    let firstImageUrl = null;
    await connection.query(`DELETE FROM ecard_style_samples WHERE style_id = ?`, [styleId]);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      let imageUrl = sample.dataUrl ? await saveEcardImage(sample.dataUrl, sample.fileName) : (sample.url || sample.imageUrl || '');
      if (i === 0) firstImageUrl = imageUrl;
      if (sample.isCover && !coverImageUrl) coverImageUrl = imageUrl;
      await connection.query(
        `INSERT INTO ecard_style_samples (style_id, image_url, is_cover, sort_order) VALUES (?, ?, ?, ?)`,
        [styleId, imageUrl, sample.isCover ? 1 : 0, i]
      );
    }

    await connection.query(`DELETE FROM ecard_style_backgrounds WHERE style_id = ?`, [styleId]);
    for (let i = 0; i < backgrounds.length; i++) {
      const bg = backgrounds[i];
      let bgImageUrl = bg.dataUrl ? await saveEcardImage(bg.dataUrl, bg.fileName) : (bg.url || bg.imageUrl || '');
      await connection.query(
        `INSERT INTO ecard_style_backgrounds (style_id, background_name, image_url, sort_order, layout_json, default_style_json, display_config_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [styleId, sanitizeString(bg.backgroundName, 128), bgImageUrl, i, bg.layoutJson ? JSON.stringify(bg.layoutJson) : null, bg.defaultStyleJson ? JSON.stringify(bg.defaultStyleJson) : null, bg.displayConfigJson ? JSON.stringify(bg.displayConfigJson) : null]
      );
    }

    coverImageUrl = coverImageUrl || firstImageUrl || null;
    await connection.query(`UPDATE ecard_styles SET cover_image_url = ? WHERE id = ?`, [coverImageUrl, styleId]);
    await connection.commit();
    return response.status(200).json({ message: "Ecard 樣式更新成功" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update Ecard style:", error);
    return response.status(500).json({ message: "修改 Ecard 樣式失敗" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/ecard-style-backgrounds/:id/json-config", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以修改背景圖配置。" });
  }

  const bgId = Number(request.params.id);
  if (!bgId) return response.status(400).json({ message: "無效的背景圖 ID。" });

  const { configType, configJson } = request.body || {};
  if (!["layout_json", "default_style_json", "display_config_json"].includes(configType)) {
    return response.status(400).json({ message: "無效的配置型別。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const jsonString = configJson ? JSON.stringify(configJson) : null;
    const result = await connection.query(
      `UPDATE ecard_style_backgrounds SET ${configType} = ? WHERE id = ?`,
      [jsonString, bgId]
    );
    if (Number(result.affectedRows || 0) === 0) {
          const check = await connection.query('SELECT id FROM ecard_style_backgrounds WHERE id = ?', [bgId]);
          if (check.length === 0) {
            return response.status(404).json({ message: "找不到指定的背景圖。" });
          }
    }
    return response.json({ message: "配置已儲存。" });
  } catch (error) {
    console.error("Failed to update background json config:", error);
    return response.status(500).json({ message: "儲存配置失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/admin/ecard-styles/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以修改 Ecard 樣式。" });
  }

  const styleId = Number(request.params.id);
  if (!styleId) return response.status(400).json({ message: "無效的樣式 ID。" });

  const status = sanitizeString(request.body?.status, 32);
  if (!['active', 'disabled'].includes(status)) {
    return response.status(400).json({ message: "狀態無效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(`UPDATE ecard_styles SET status = ? WHERE id = ?`, [status, styleId]);
    if (Number(result.affectedRows || 0) === 0) {
      return response.status(404).json({ message: "找不到該樣式。" });
    }
    return response.json({ message: "狀態更新成功" });
  } catch (error) {
    console.error("Failed to update ecard style status:", error);
    return response.status(500).json({ message: "更新狀態失敗" });
  } finally {
    if (connection) connection.release();
  }
});

app.delete("/api/admin/ecard-styles/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以刪除 Ecard 樣式。" });
  }
  const styleId = Number(request.params.id);
  if (!styleId) return response.status(400).json({ message: "無效的樣式 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(`DELETE FROM ecard_styles WHERE id = ?`, [styleId]);
    return response.json({ message: "樣式已成功刪除。" });
  } catch (error) {
    console.error('Failed to delete ecard style:', error);
    return response.status(500).json({ message: '刪除失敗' });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/tenant/ecard-accounts/:sipUserId/ecard", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平臺管理員無法訪問租戶電子名片。" });
  }
  const sipUserId = Number(request.params.sipUserId);
  const payload = request.body || {};
  
  let connection;
  try {
    connection = await pool.getConnection();
    try {
      await connection.query(`ALTER TABLE tenant_ecards ADD COLUMN ecard_data_json LONGTEXT`);
    } catch (err) {
      if (err.errno !== 1060 && err.code !== 'ER_DUP_FIELDNAME') {
        throw err;
      }
    }

    const [su] = await connection.query(`SELECT id FROM sip_users WHERE id = ? AND tenant_id = ?`, [sipUserId, request.admin.tenantId]);
    if (!su) {
      return response.status(404).json({ message: "SIP 帳號不存在或不屬於當前租戶" });
    }

    let avatarUrl = payload.avatarDataUrl || "";
    if (avatarUrl.startsWith("data:")) {
      avatarUrl = await saveEcardImage(avatarUrl, "avatar.png");
    }
    
    let logoUrl = payload.logoDataUrl || "";
    if (logoUrl.startsWith("data:")) {
      logoUrl = await saveEcardImage(logoUrl, "logo.png");
    }
    
    let thumbnailUrl = payload.thumbnailDataUrl || "";
    if (thumbnailUrl.startsWith("data:")) {
      thumbnailUrl = await saveEcardImage(thumbnailUrl, "thumbnail.png");
    }
    
    const ecardDataJson = payload.ecardDataJson || {};
    ecardDataJson.avatarDataUrl = avatarUrl;
    ecardDataJson.logoDataUrl = logoUrl;
    const enableVideoCall = payload.enableVideoCall !== false; // 默认 true

    await connection.query(
      `INSERT INTO tenant_ecards (
         tenant_id, sip_user_id, access_slug, avatar_url, logo_url, thumbnail_url, status, enable_video_call,
         created_by_admin_id, ecard_data_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         access_slug = VALUES(access_slug),
         avatar_url = VALUES(avatar_url),
         logo_url = VALUES(logo_url),
         thumbnail_url = VALUES(thumbnail_url),
         enable_video_call = VALUES(enable_video_call),
         ecard_data_json = VALUES(ecard_data_json),
         updated_at = NOW()`,
      [
        request.admin.tenantId,
        sipUserId,
        payload.accessSlug || null,
        avatarUrl || null,
        logoUrl || null,
        thumbnailUrl || null,
        enableVideoCall ? 1 : 0,
        request.admin.id,
        JSON.stringify(ecardDataJson)
      ]
    );

    return response.json({ message: "電子名片已儲存" });
  } catch (err) {
    console.error("Save ecard failed", err);
    return response.status(500).json({ message: "儲存失敗", detail: err.message || String(err) });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/tenant/ecard-accounts/:sipUserId/ecard", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平臺管理員無法訪問租戶電子名片。" });
  }
  const sipUserId = Number(request.params.sipUserId);
  let connection;
  try {
    connection = await pool.getConnection();
    const [ec] = await connection.query(
      `SELECT ec.ecard_data_json, ec.card_data_json, ec.thumbnail_url, ec.avatar_url, ec.access_slug,
              DATE_FORMAT(COALESCE(ec.valid_from, su.activated_at), '%Y-%m-%d') AS valid_from,
              DATE_FORMAT(COALESCE(ec.valid_to, su.service_expires_at), '%Y-%m-%d') AS valid_to,
              ec.status
       FROM sip_users su
       LEFT JOIN tenant_ecards ec ON ec.sip_user_id = su.id AND ec.tenant_id = su.tenant_id
       WHERE su.id = ? AND su.tenant_id = ?`,
      [sipUserId, request.admin.tenantId]
    );
    if (!ec) return response.status(404).json({ message: "SIP 帳號不存在" });
    return response.json({
      ecardDataJson: parseEcardPublicJson(ec.ecard_data_json || ec.card_data_json),
      thumbnailUrl: ec.thumbnail_url || null,
      avatarUrl: ec.avatar_url || null,
      accessSlug: ec.access_slug || null,
      validFrom: ec.valid_from || null,
      validTo: ec.valid_to || null,
      status: ec.status || null,
    });
    return response.status(500).json({ message: "取得名片失敗" });
  } finally {
    if (connection) connection.release();
  }
});

function isValidEcardPublicSlug(slug) {
  return typeof slug === "string" && /^[A-Za-z0-9_-]+$/.test(slug.trim());
}

function safeEcardDateOnly(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function parseEcardPublicJson(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonMaybe(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

function getNestedObjectValue(source, path) {
  if (!source || typeof source !== "object" || !Array.isArray(path) || path.length === 0) return undefined;
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function resolveEcardAddressFromJson(ecardDataJson, sipUser) {
  const cardData = ecardDataJson && typeof ecardDataJson.cardData === "object" && ecardDataJson.cardData !== null
    ? ecardDataJson.cardData
    : {};
  const profile = ecardDataJson && typeof ecardDataJson.profile === "object" && ecardDataJson.profile !== null
    ? ecardDataJson.profile
    : {};
  const data = ecardDataJson && typeof ecardDataJson.data === "object" && ecardDataJson.data !== null
    ? ecardDataJson.data
    : {};
  const fields = ecardDataJson && typeof ecardDataJson.fields === "object" && ecardDataJson.fields !== null
    ? ecardDataJson.fields
    : {};
  const contact = ecardDataJson && typeof ecardDataJson.contact === "object" && ecardDataJson.contact !== null
    ? ecardDataJson.contact
    : {};
  return pickFirstString(
    cardData.address,
    cardData.addressText,
    cardData.addr,
    cardData.location,
    cardData.companyAddress,
    cardData.contactAddress,
    profile.address,
    profile.addressText,
    profile.addr,
    profile.location,
    profile.companyAddress,
    profile.contactAddress,
    data.address,
    data.addressText,
    data.addr,
    data.location,
    data.companyAddress,
    data.contactAddress,
    getNestedObjectValue(fields, ["address", "value"]),
    getNestedObjectValue(fields, ["address", "text"]),
    fields.address,
    contact.address,
    ecardDataJson.address,
    ecardDataJson.addressText,
    ecardDataJson.addr,
    ecardDataJson.location,
    ecardDataJson.companyAddress,
    ecardDataJson.contactAddress,
    sipUser?.address,
  );
}

function resolveEcardProfileFromJson(ecardDataJson, sipUser) {
  const cardData = ecardDataJson && typeof ecardDataJson.cardData === "object" && ecardDataJson.cardData !== null
    ? ecardDataJson.cardData
    : {};
  return {
    name: pickFirstString(cardData.name, ecardDataJson.name, sipUser?.display_name, sipUser?.username),
    duty: pickFirstString(cardData.titleZh, cardData.titleCn, cardData.title, cardData.titleEn, ecardDataJson.duty),
    email: pickFirstString(cardData.email, ecardDataJson.email, sipUser?.email),
    phone: pickFirstString(cardData.phone, cardData.phoneNumber, ecardDataJson.phone, ecardDataJson.phoneNumber, sipUser?.phone_number),
    address: resolveEcardAddressFromJson(ecardDataJson, sipUser),
    avatarUrl: pickFirstString(ecardDataJson.avatarDataUrl, ecardDataJson.avatarUrl, sipUser?.avatar_url),
  };
}

// ==========================================
// Ecard 访问链接与二维码（管理员 + SIP 用户）
// ==========================================

// 构造 ecard 访问信息（含二维码 data URL，512px 适配桌面端与手机端显示）
async function buildEcardAccessPayload(connection, sipUserId, tenantId) {
  const [ec] = await connection.query(
    `SELECT access_slug, status
     FROM tenant_ecards
     WHERE sip_user_id = ? AND tenant_id = ?
     LIMIT 1`,
    [sipUserId, tenantId],
  );
  if (!ec || ec.status !== "active") {
    return { configured: false };
  }
  const baseUrl = process.env.ECARD_APP_URL || "https://ecard.qrtalkie.org";
  const accessUrl = `${baseUrl}/u/${ec.access_slug}`;
  const downloadUrl = `${baseUrl}/d/${ec.access_slug}`;
  let qrcodeDataUrl = "";
  try {
    qrcodeDataUrl = await QRCode.toDataURL(accessUrl, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
    });
  } catch (qrError) {
    console.error("[buildEcardAccessPayload] QRCode generation failed:", qrError?.message || qrError);
  }
  return {
    configured: true,
    accessUrl,
    downloadUrl,
    qrcodeDataUrl,
  };
}

// 场景 A：租户管理员获取指定账号的 ecard 访问链接与二维码
// GET /api/tenant/ecard-accounts/:sipUserId/ecard/qrcode
app.get("/api/tenant/ecard-accounts/:sipUserId/ecard/qrcode", requireAdmin, async (request, response) => {
  if (request.admin.accountType === "platform") {
    return response.status(403).json({ message: "平台管理員無法訪問租戶電子名片。" });
  }
  const sipUserId = Number(request.params.sipUserId);
  if (!Number.isInteger(sipUserId) || sipUserId <= 0) {
    return response.status(400).json({ success: false, message: "SIP 帳號參數不正確。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const [su] = await connection.query(
      "SELECT id FROM sip_users WHERE id = ? AND tenant_id = ? LIMIT 1",
      [sipUserId, request.admin.tenantId],
    );
    if (!su) return response.status(404).json({ success: false, message: "SIP 帳號不存在" });
    const data = await buildEcardAccessPayload(connection, sipUserId, request.admin.tenantId);
    return response.json({ success: true, data });
  } catch (error) {
    console.error("[ecard/qrcode] error:", error?.message || error);
    return response.status(500).json({ success: false, message: "取得電子名片連結失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// 场景 C：Desktop 端专用——按用户名直接获取 ecard 内容（免认证）
// GET /api/desktop/ecard?username=<sip_username>&domain=<sip_domain>
app.get("/api/desktop/ecard", async (request, response) => {
  const username = sanitizeString(String(request.query.username || "").trim().toLowerCase(), 64);
  const domain = sanitizeString(String(request.query.domain || "sip.qrtalkie.org").trim(), 64);

  if (!username) {
    return response.status(400).json({ success: false, message: "缺少 username 參數" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [su] = await connection.query(
      "SELECT id, tenant_id FROM sip_users WHERE username = ? AND sip_domain = ? LIMIT 1",
      [username, domain],
    );
    if (!su) return response.status(404).json({ success: false, message: "SIP 帳號不存在。" });
    const data = await buildEcardAccessPayload(connection, su.id, su.tenant_id);
    return response.json({ success: true, data });
  } catch (error) {
    console.error("[desktop/ecard] error:", error?.message || error);
    return response.status(500).json({ success: false, message: "取得電子名片連結失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// 场景 B：SIP 用户获取自己的 ecard 访问链接与二维码（ai-login Bearer token 认证）
// GET /api/ecard/me
app.get("/api/ecard/me", requireSipUser, async (request, response) => {
  const sipUserId = Number(request.admin?.id);
  if (!Number.isInteger(sipUserId) || sipUserId <= 0) {
    // 管理员 token 没有 sip_user_id
    return response.status(403).json({ success: false, message: "此介面僅限 SIP 帳號使用。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const [su] = await connection.query(
      "SELECT id, tenant_id FROM sip_users WHERE id = ? LIMIT 1",
      [sipUserId],
    );
    if (!su) return response.status(404).json({ success: false, message: "SIP 帳號不存在。" });
    const data = await buildEcardAccessPayload(connection, sipUserId, su.tenant_id);
    return response.json({ success: true, data });
  } catch (error) {
    console.error("[ecard/me] error:", error?.message || error);
    return response.status(500).json({ success: false, message: "取得電子名片連結失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

async function loadEcardPublicViewData(connection, slug) {
  const ecardRows = await connection.query(
    `SELECT
       ec.id AS ecard_id,
       ec.tenant_id,
       ec.sip_user_id,
       ec.access_slug,
       ec.avatar_url,
       ec.thumbnail_url,
       ec.status AS ecard_status,
       ec.valid_from,
       ec.valid_to,
       ec.ecard_data_json,
       ec.card_data_json,
       ec.enable_video_call,
       su.username AS sip_account,
       su.display_name AS sip_display_name,
       su.email AS sip_email,
       su.phone_number AS sip_phone_number,
       su.sip_domain AS sip_domain,
       su.status AS sip_status,
       t.name AS tenant_name
     FROM tenant_ecards ec
     LEFT JOIN sip_users su ON su.id = ec.sip_user_id
     LEFT JOIN tenants t ON t.id = ec.tenant_id
     WHERE ec.access_slug = ?
     LIMIT 1`,
    [slug],
  );

  const ecardRow = ecardRows[0] || null;
  if (!ecardRow) {
    return { error: { status: 404, code: "ECARD_NOT_FOUND", message: "電子名片不存在或不可用" } };
  }

  if (!ecardRow.sip_user_id || !ecardRow.sip_account) {
    return { error: { status: 404, code: "ECARD_SIP_ACCOUNT_NOT_FOUND", message: "對應的 SIP 帳號不存在" } };
  }

  const ecardDataJson = parseEcardPublicJson(ecardRow.ecard_data_json || ecardRow.card_data_json);
  const today = new Date().toISOString().slice(0, 10);
  const validFrom = safeEcardDateOnly(ecardRow.valid_from);
  const validTo = safeEcardDateOnly(ecardRow.valid_to);
  const expired = Boolean((validFrom && today < validFrom) || (validTo && today > validTo));
  const enabled = String(ecardRow.ecard_status || "").toLowerCase() === "active" && !expired;

  const bindingRows = await connection.query(
    `SELECT
       wu.id AS web_user_id,
       wu.username AS web_account,
       wu.sip_domain AS web_domain,
       e.id AS entitlement_id
     FROM tenant_web_account_entitlements e
     JOIN web_users wu ON wu.id = e.web_user_id
     WHERE e.sip_user_id = ?
       AND e.tenant_id = ?
       AND e.status = 'active'
       AND (wu.status IS NULL OR wu.status = 'active')
     ORDER BY e.id ASC
     LIMIT 1`,
    [Number(ecardRow.sip_user_id), Number(ecardRow.tenant_id)],
  );

  const bindingRow = bindingRows[0] || null;

  const styleId = ecardDataJson.selectedTemplateId ?? ecardDataJson.templateId ?? null;
  const backgroundId = ecardDataJson.selectedBackgroundId ?? ecardDataJson.backgroundId ?? null;
  let resolvedBackground = null;

  if (styleId) {
    const styleRows = await connection.query(`SELECT id FROM ecard_styles WHERE id = ? LIMIT 1`, [styleId]);
    if (styleRows.length > 0) {
      const bgRows = await connection.query(
        `SELECT id, style_id, background_name, image_url, layout_json, default_style_json, display_config_json
         FROM ecard_style_backgrounds
         WHERE style_id = ?
           ${backgroundId ? "AND id = ?" : ""}
         ORDER BY sort_order ASC, id ASC
         LIMIT 1`,
        backgroundId ? [styleId, backgroundId] : [styleId],
      );
      resolvedBackground = bgRows[0] || null;
    }
  }

  const profile = resolveEcardProfileFromJson(ecardDataJson, ecardRow);
  const publicAccessUrl = `${process.env.ECARD_APP_URL || "https://ecard.qrtalkie.org"}/u/${ecardRow.access_slug}`;

  // 查询 SIP 注册状态
  let sipRegistrationStatus = "unknown";
  if (ecardRow.sip_account && ecardRow.sip_domain) {
    try {
      const redisKey = `fs:${ecardRow.sip_account}@${ecardRow.sip_domain}`;
      const redisResult = await readRegistrarKeys([redisKey]);
      const regData = redisResult.get(redisKey);
      if (regData && regData.type === "hash" && regData.ttl !== -2) {
        const hasValidContact = (regData.entries || []).length > 0;
        sipRegistrationStatus = hasValidContact ? "online" : "offline";
      } else {
        sipRegistrationStatus = "offline";
      }
    } catch { /* keep unknown */ }
  }

  return {
    data: {
      profile,
      media: {
        avatarUrl: pickFirstString(ecardRow.avatar_url, profile.avatarUrl),
        backgroundUrl: pickFirstString(resolvedBackground?.image_url, ecardDataJson.backgroundUrl, ecardDataJson.backgroundImageUrl),
        qrcodeUrl: publicAccessUrl,
        thumbnailUrl: pickFirstString(ecardRow.thumbnail_url),
      },
      template: {
        templateId: styleId ? String(styleId) : "",
        layoutJson: resolvedBackground?.layout_json
          ? parseJsonMaybe(resolvedBackground.layout_json, {
              selectedTemplateId: styleId ? String(styleId) : "",
              selectedBackgroundId: backgroundId ? String(backgroundId) : "",
            })
          : {
              selectedTemplateId: styleId ? String(styleId) : "",
              selectedBackgroundId: backgroundId ? String(backgroundId) : "",
              localStyles: ecardDataJson.localStyles || {},
              localDisplayConfig: ecardDataJson.localDisplayConfig || {},
              showQrCode: Boolean(ecardDataJson.showQrCode),
            },
      },
      publicStatus: {
        enabled,
        expired,
        validFrom: validFrom || "",
        validTo: validTo || "",
      },
      callCapabilities: {
        voice: process.env.ECARD_ASTERISK_WEBRTC_ENABLE_VOICE_CALL === "true",
        video: process.env.ECARD_ASTERISK_WEBRTC_ENABLE_VIDEO_CALL === "true" && ecardRow.enable_video_call !== 0,
        webrtc: Boolean(bindingRow),
      },
      sipRegistrationStatus,
      enableVideoCall: ecardRow.enable_video_call !== 0,
      callConfigSummary: {
        sipAccount: String(ecardRow.sip_account || ""),
        sipDomain: String(ecardRow.sip_domain || process.env.ECARD_FLEXISIP_SIP_DOMAIN || sipDomain || ""),
        webAccount: String(bindingRow?.web_account || ""),
        webrtcDomain: String(bindingRow?.web_domain || process.env.ECARD_ASTERISK_WEBRTC_DOMAIN || webrtcDomain || ""),
        accessSlug: String(ecardRow.access_slug || ""),
      },
      tenantName: String(ecardRow.tenant_name || ""),
    },
  };
}

const ECARD_CALL_SESSION_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const ECARD_CALL_SESSION_RATE_LIMIT_MAX = 10;
const ecardCallSessionStore = new Map();
const ecardCallSessionRateLimitStore = new Map();

function cleanupEcardCallSessionState(now = Date.now()) {
  for (const [sessionId, item] of ecardCallSessionStore.entries()) {
    if (!item || !item.expiresAtMs || item.expiresAtMs <= now) {
      ecardCallSessionStore.delete(sessionId);
    }
  }
  for (const [key, item] of ecardCallSessionRateLimitStore.entries()) {
    if (!item || !item.windowEndsAt || item.windowEndsAt <= now) {
      ecardCallSessionRateLimitStore.delete(key);
    }
  }
}

function getEcardClientIp(request) {
  const forwardedFor = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const realIp = String(request.headers["x-real-ip"] || "").trim();
  const cfIp = String(request.headers["cf-connecting-ip"] || "").trim();
  const fallback = String(request.ip || request.socket?.remoteAddress || "").trim();
  return forwardedFor || realIp || cfIp || fallback || "unknown";
}

function isEcardCallSessionAllowedByRateLimit(slug, request) {
  cleanupEcardCallSessionState();
  const ip = getEcardClientIp(request);
  const now = Date.now();
  const windowKey = `${slug}|${ip}`;
  const current = ecardCallSessionRateLimitStore.get(windowKey);
  if (!current || current.windowEndsAt <= now) {
    ecardCallSessionRateLimitStore.set(windowKey, {
      windowEndsAt: now + ECARD_CALL_SESSION_RATE_LIMIT_WINDOW_MS,
      count: 1,
    });
    return true;
  }
  if (current.count >= ECARD_CALL_SESSION_RATE_LIMIT_MAX) {
    return false;
  }
  current.count += 1;
  ecardCallSessionRateLimitStore.set(windowKey, current);
  return true;
}

function parseEcardIceServers() {
  const raw = String(process.env.ECARD_WEBRTC_ICE_SERVERS || "").trim();
  const stunServer = String(process.env.ECARD_WEBRTC_STUN_SERVER || "").trim();
  const turnUsername = String(process.env.ECARD_WEBRTC_TURN_USERNAME || "").trim();
  const turnPassword = String(process.env.ECARD_WEBRTC_TURN_PASSWORD || "").trim();
  const items = raw
    ? raw.split(",").map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const servers = [];
  for (const item of items) {
    if (item.startsWith("stun:")) {
      servers.push({ urls: item });
    } else if (item.startsWith("turn:")) {
      servers.push({ urls: item, username: turnUsername, credential: turnPassword });
    } else {
      servers.push({ urls: item });
    }
  }
  if (servers.length === 0 && stunServer) {
    servers.push({ urls: stunServer });
  }
  return servers;
}

async function loadEcardCallSessionContext(connection, slug) {
  const rows = await connection.query(
    `SELECT
       ec.id AS ecard_id,
       ec.tenant_id,
       ec.sip_user_id,
       ec.access_slug,
       ec.status AS ecard_status,
       ec.valid_from,
       ec.valid_to,
       ec.ecard_data_json,
       su.username AS sip_account,
       su.sip_domain AS sip_domain,
       su.status AS sip_status,
       wu.username AS web_account,
       wu.sip_domain AS web_domain,
       wu.status AS web_status,
       t.name AS tenant_name
     FROM tenant_ecards ec
     LEFT JOIN sip_users su ON su.id = ec.sip_user_id
     LEFT JOIN tenant_web_account_entitlements ent
       ON ent.sip_user_id = ec.sip_user_id
      AND ent.tenant_id = ec.tenant_id
      AND ent.status = 'active'
     LEFT JOIN web_users wu ON wu.id = ent.web_user_id
     LEFT JOIN tenants t ON t.id = ec.tenant_id
     WHERE ec.access_slug = ?
     LIMIT 1`,
    [slug],
  );

  const row = rows[0] || null;
  if (!row) {
    return { error: { status: 404, code: "ECARD_NOT_FOUND", message: "電子名片不存在或不可用" } };
  }

  if (String(row.ecard_status || "").toLowerCase() !== "active") {
    return { error: { status: 403, code: "ECARD_DISABLED", message: "此電子名片目前未啟用" } };
  }

  const today = new Date().toISOString().slice(0, 10);
  const validFrom = safeEcardDateOnly(row.valid_from);
  const validTo = safeEcardDateOnly(row.valid_to);
  const expired = Boolean((validFrom && today < validFrom) || (validTo && today > validTo));
  if (expired) {
    return { error: { status: 403, code: "ECARD_EXPIRED", message: "此電子名片已過期" } };
  }

  if (!row.sip_account) {
    return { error: { status: 404, code: "ECARD_SIP_ACCOUNT_NOT_FOUND", message: "對應的 SIP 帳號不存在" } };
  }

  if (!row.web_account) {
    return { error: { status: 404, code: "ECARD_WEB_ACCOUNT_NOT_BOUND", message: "此帳號尚未繫結 WebRTC 帳號" } };
  }

  const ecardDataJson = parseEcardPublicJson(row.ecard_data_json);
  return {
    row,
    ecardDataJson,
    validFrom,
    validTo,
    expired,
  };
}

app.get("/api/ecard/public/:slug", async (request, response) => {
  const slug = String(request.params.slug || "").trim();
  if (!isValidEcardPublicSlug(slug)) {
    return response.status(400).json({
      success: false,
      code: "INVALID_ECARD_SLUG",
      message: "查詢引數格式不正確",
    });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await loadEcardPublicViewData(connection, slug);
    if (result.error) {
      return response.status(result.error.status || 500).json({
        success: false,
        code: result.error.code || "ECARD_PUBLIC_QUERY_FAILED",
        message: result.error.message || "電子名片資料查詢失敗",
      });
    }

    return response.json({
      success: true,
      message: "電子名片資料已取得",
      data: result.data,
    });
  } catch (error) {
    console.error("Failed to fetch ecard public data:", error);
    return response.status(500).json({
      success: false,
      code: "ECARD_PUBLIC_QUERY_FAILED",
      message: "電子名片資料查詢失敗",
    });
  } finally {
    if (connection) connection.release();
  }
});

app.post("/api/ecard/public/:slug/call-session", async (request, response) => {
  const slug = String(request.params.slug || "").trim();
  if (!isValidEcardPublicSlug(slug)) {
    return response.status(400).json({
      success: false,
      code: "INVALID_ECARD_SLUG",
      message: "查詢引數格式不正確",
    });
  }

  if (!isEcardCallSessionAllowedByRateLimit(slug, request)) {
    return response.status(429).json({
      success: false,
      code: "ECARD_CALL_SESSION_FAILED",
      message: "呼叫會話建立過於頻繁，請稍後再試",
    });
  }

  const sessionId = randomUUID();
  let connection;
  try {
    connection = await pool.getConnection();
    const context = await loadEcardCallSessionContext(connection, slug);
    if (context.error) {
      return response.status(context.error.status || 500).json({
        success: false,
        code: context.error.code || "ECARD_CALL_SESSION_FAILED",
        message: context.error.message || "呼叫配置建立失敗，請稍後再試",
      });
    }

    const voiceEnabled = String(process.env.ECARD_ASTERISK_WEBRTC_ENABLE_VOICE_CALL || "").toLowerCase() === "true";
    const videoEnabled = String(process.env.ECARD_ASTERISK_WEBRTC_ENABLE_VIDEO_CALL || "").toLowerCase() === "true";
    if (!voiceEnabled && !videoEnabled) {
      return response.status(403).json({
        success: false,
        code: "ECARD_CALL_DISABLED",
        message: "目前未開放語音或影片呼叫",
      });
    }

    const wssUrl = String(process.env.ECARD_ASTERISK_WEBRTC_WSS_URL || "").trim();
    const sharedPassword = String(process.env.ECARD_ASTERISK_WEBRTC_SHARED_PASSWORD || "").trim();
    const webrtcDomainValue = String(context.row.web_domain || process.env.ECARD_ASTERISK_WEBRTC_DOMAIN || webrtcDomain || "").trim();
    const sipDomainValue = String(process.env.ECARD_FLEXISIP_SIP_DOMAIN || sipDomain || "").trim();
    const sipAccount = String(context.row.sip_account || "").trim();
    const targetSipUri = `sip:${sipAccount}@${sipDomainValue}`;
    const iceServers = parseEcardIceServers();
    const sipServerPublicIp = String(process.env.ECARD_ASTERISK_WEBRTC_SIP_SERVER_PUBLIC_IP || "").trim();
    const now = Date.now();
    const expiresAt = new Date(now + ECARD_CALL_SESSION_TTL_MS).toISOString();
    const credentialType = "shared-password";

    if (!wssUrl || !sharedPassword || !webrtcDomainValue || !sipDomainValue || !sipAccount) {
      return response.status(500).json({
        success: false,
        code: "ECARD_CALL_SESSION_FAILED",
        message: "呼叫配置建立失敗，請稍後再試",
      });
    }

    ecardCallSessionStore.set(sessionId, {
      slug,
      ip: getEcardClientIp(request),
      createdAtMs: now,
      expiresAtMs: now + ECARD_CALL_SESSION_TTL_MS,
    });

    const sharedPasswordSummary = safeSecretSummary(sharedPassword);
    console.log(
      `[EcardCallSession] slug=${slug} sessionId=${sessionId} success=true ` +
      `webAccount=${String(context.row.web_account || "")} ` +
      `webrtcDomain=${webrtcDomainValue} wssUrl=${wssUrl} targetSipUri=${targetSipUri} ` +
      `sharedPasswordPresent=${sharedPasswordSummary.present} ` +
      `sharedPasswordLength=${sharedPasswordSummary.length} ` +
      `sharedPasswordHashPrefix=${sharedPasswordSummary.hashPrefix}`,
    );

    return response.json({
      success: true,
      message: "呼叫會話已建立",
      data: {
        sessionId,
        expiresAt,
        webAccount: String(context.row.web_account || ""),
        credential: {
          type: credentialType,
          value: sharedPassword,
        },
        webrtcDomain: webrtcDomainValue,
        wssUrl,
        targetSipUri,
        sipDomain: sipDomainValue,
        iceServers,
        sipServerPublicIp,
        enableVoice: voiceEnabled,
        enableVideo: videoEnabled,
      },
    });
  } catch (error) {
    console.error(`[EcardCallSession] slug=${slug} success=false`, error?.message || error);
    return response.status(500).json({
      success: false,
      code: "ECARD_CALL_SESSION_FAILED",
      message: "呼叫配置建立失敗，請稍後再試",
    });
  } finally {
    if (connection) connection.release();
  }
});

app.put("/api/tenant/ecard-accounts/:sipUserId/ecard/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平臺管理員無法訪問租戶電子名片。" });
  }
  const sipUserId = Number(request.params.sipUserId);
  const status = request.body?.status === 'active' ? 'active' : 'disabled';

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE tenant_ecards SET status = ?, updated_at = NOW() WHERE tenant_id = ? AND sip_user_id = ?`,
      [status, request.admin.tenantId, sipUserId]
    );
    if (result.affectedRows === 0) {
      // 优化：如果 affectedRows 为 0，可能只是狀態没变，而不是不存在。需进一步检查
      const [check] = await connection.query(
        `SELECT id FROM tenant_ecards WHERE tenant_id = ? AND sip_user_id = ?`,
        [request.admin.tenantId, sipUserId]
      );
      if (check.length === 0) {
        return response.status(404).json({ message: "該帳號尚未配置電子名片。" });
      }
    }
    return response.json({ message: status === 'active' ? "電子名片已啟用" : "電子名片已停用" });
  } catch (err) {
    console.error(err);
    return response.status(500).json({ message: "更新狀態失敗" });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * ==========================================
 * 系统配置 API (隐私政策 / 服务条款等)
 * ==========================================
 */

// 讀取隐私政策 (管理后台)
app.get("/api/admin/settings/privacy-policy", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以讀取系統配置。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'privacy_policy'`
    );
    const content = rows.length > 0 ? rows[0].setting_value : "";
    return response.json({ content });
  } catch (error) {
    console.error("Failed to get privacy policy:", error);
    return response.status(500).json({ message: "讀取隱私政策失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// 保存隐私政策 (管理后台)
app.put("/api/admin/settings/privacy-policy", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以修改系統配置。" });
  }
  const content = request.body?.content || "";
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      `INSERT INTO system_settings (setting_key, setting_value) 
       VALUES ('privacy_policy', ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [content, content]
    );
    return response.json({ message: "隱私政策已儲存成功" });
  } catch (error) {
    console.error("Failed to save privacy policy:", error);
    return response.status(500).json({ message: "儲存隱私政策失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// 讀取服务条款 (管理后台)
app.get("/api/admin/settings/terms-of-service", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以讀取系統配置。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'terms_of_service'`
    );
    const content = rows.length > 0 ? rows[0].setting_value : "";
    return response.json({ content });
  } catch (error) {
    console.error("Failed to get terms of service:", error);
    return response.status(500).json({ message: "讀取服務條款失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// 保存服务条款 (管理后台)
app.put("/api/admin/settings/terms-of-service", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以修改系統配置。" });
  }
  const content = request.body?.content || "";
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      `INSERT INTO system_settings (setting_key, setting_value) 
       VALUES ('terms_of_service', ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [content, content]
    );
    return response.json({ message: "服務條款已儲存成功" });
  } catch (error) {
    console.error("Failed to save terms of service:", error);
    return response.status(500).json({ message: "儲存服務條款失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// 开放接口：讀取隐私政策 (供 Landing 落地页免登录讀取)
app.get("/api/public/settings/privacy-policy", async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'privacy_policy'`
    );
    const content = rows.length > 0 ? rows[0].setting_value : "暫無隱私政策內容。";
    return response.json({ content });
  } catch (error) {
    console.error("Failed to get public privacy policy:", error);
    return response.status(500).json({ message: "取得隱私政策失敗，請稍後再試" });
  } finally {
    if (connection) connection.release();
  }
});

// 开放接口：讀取服务条款 (供 Landing 落地页免登录讀取)
app.get("/api/public/settings/terms-of-service", async (request, response) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'terms_of_service'`
    );
    const content = rows.length > 0 ? rows[0].setting_value : "暫無服務條款內容。";
    return response.json({ content });
  } catch (error) {
    console.error("Failed to get public terms of service:", error);
    return response.status(500).json({ message: "取得服務條款失敗，請稍後再試" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/public/lime/status - 查詢用戶 LIME 加密密鑰是否就緒
app.get("/api/public/lime/status", async (request, response) => {
  const username = sanitizeString(String(request.query.username || ""), 64);
  const domain = sanitizeString(String(request.query.domain || "sip.qrtalkie.org"), 64);

  if (!username) {
    return response.status(400).json({ code: -1, message: "缺少 username 參數" });
  }

  try {
    const [row] = await limePool.query(
      `SELECT COUNT(*) AS key_count FROM OPk WHERE Uid = (SELECT id FROM accounts WHERE username = ? AND domain = ? LIMIT 1)`,
      [username, domain]
    );
    const ready = Number(row?.key_count || 0) > 0;
    return response.json({ code: 0, data: { ready, keyCount: Number(row?.key_count || 0) } });
  } catch (error) {
    console.error("LIME status check failed:", error.message);
    return response.json({ code: 0, data: { ready: false, keyCount: 0 } });
  }
});

// GET /api/call-centers - 租戶取得呼叫中心配置列表
app.get("/api/call-centers", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以檢視呼叫中心配置。" });
  }

  const limit = Math.max(1, parseInt(request.query.limit || "10", 10));
  const offset = Math.max(0, parseInt(request.query.offset || "0", 10));
  const keyword = sanitizeString(request.query.keyword, 120);
  const statusFilter = sanitizeString(request.query.status, 20);

  const whereClauses = ["tenant_id = ?"];
  const params = [request.admin.tenantId];

  if (statusFilter && statusFilter !== "all") {
    whereClauses.push("status = ?");
    params.push(statusFilter);
  }

  if (keyword) {
    whereClauses.push("(center_name LIKE ? OR center_url LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = "WHERE " + whereClauses.join(" AND ");

  let connection;
  try {
    connection = await pool.getConnection();

    // 0. 取得该租戶的套餐有效期并检查是否过期，若过期则自动停用
    const planRows = await connection.query(`
      SELECT DATE_FORMAT(MAX(expires_at), '%Y-%m-%d') as tenant_expires_at
      FROM billing_orders
      WHERE tenant_id = ? AND order_status = 'review_approved'
    `, [request.admin.tenantId]);
    const tenantExpiresAt = planRows[0]?.tenant_expires_at || null;

    let isExpired = true;
    if (tenantExpiresAt) {
      const expiresDate = new Date(`${tenantExpiresAt}T00:00:00Z`);
      const today = new Date();
      const diffTime = expiresDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 0) {
        isExpired = false;
      }
    }

    if (isExpired) {
      await connection.query(`
        UPDATE call_centers 
        SET status = 'disabled', updated_at = CURRENT_TIMESTAMP 
        WHERE tenant_id = ? AND status = 'active'
      `, [request.admin.tenantId]);
    }

    // 1. 取得该租戶的整体狀態统计
    const statsRows = await connection.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled,
        SUM(CASE WHEN require_visitor_info = 1 THEN 1 ELSE 0 END) as visitorEnabled
      FROM call_centers
      WHERE tenant_id = ?
    `, [request.admin.tenantId]);

    // 2. 取得分页总数
    const countRows = await connection.query(`SELECT COUNT(*) AS total FROM call_centers ${whereSql}`, params);
    const total = Number(countRows[0]?.total || 0);

    // 3. 取得当页数据
    const rows = await connection.query(`
      SELECT id, center_name, center_url, require_visitor_info, status, created_by_name, updated_at
      FROM call_centers ${whereSql}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    let expiringSoonCount = 0;
    if (!isExpired && tenantExpiresAt) {
      const expiresDate = new Date(`${tenantExpiresAt}T00:00:00Z`);
      const today = new Date();
      const diffTime = expiresDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays <= 7) {
        expiringSoonCount = Number(statsRows[0]?.total || 0);
      }
    }

    const formattedRows = rows.map(row => ({
      id: Number(row.id),
      centerName: row.center_name,
      centerUrl: row.center_url,
      requireVisitorInfo: Boolean(row.require_visitor_info),
      status: row.status,
      createdByName: row.created_by_name,
      updatedAt: row.updated_at,
      tenantExpiresAt: tenantExpiresAt
    }));

    const stats = statsRows[0] || { total: 0, active: 0, disabled: 0, visitorEnabled: 0 };
    return response.json({ code: 0, data: { list: formattedRows, total, stats: { total: Number(stats.total||0), active: Number(stats.active||0), disabled: Number(stats.disabled||0), visitorEnabled: Number(stats.visitorEnabled||0), expiringSoon: expiringSoonCount } } });
  } catch (error) {
    console.error("Failed to fetch call centers:", error);
    return response.status(500).json({ code: -1, message: "取得呼叫中心列表失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/call-centers - 租戶新增呼叫中心配置
app.post("/api/call-centers", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以配置呼叫中心。" });
  }

  const payload = request.body || {};
  const centerName = sanitizeString(payload.name, 100);
  const slug = sanitizeString(payload.slug, 100);
  if (!centerName || !slug) return response.status(400).json({ message: "缺少呼叫中心名稱或 Slug 引數。" });

  const centerUrl = `${callCenterBaseUrl}/callcenter?id=${slug}`;
  const visitorEnabled = payload.visitorEnabled ? 1 : 0;

  // 构建访客必填与选填字段 JSON
  const requiredFields = ["email"];
  if (payload.requireName) requiredFields.push("name");
  if (payload.requirePhone) requiredFields.push("phone");

  const optionalFields = [];
  if (payload.optionalCompany) optionalFields.push("company");
  if (payload.optionalContent) optionalFields.push("content");
  
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. 检查 slug 唯一性
    const [existing] = await connection.query(`SELECT id FROM call_centers WHERE center_slug = ? LIMIT 1`, [slug]);
    if (existing) {
      await connection.rollback();
      return response.status(409).json({ message: "該唯一標識 Slug 已被佔用，請更換。" });
    }

    // 2. 处理图片文件上传及保存
    let logoUrl = null;
    if (payload.logoDataUrl?.startsWith('data:')) {
      logoUrl = await saveCallCenterImage(payload.logoDataUrl, 'logo.png');
    } else if (payload.logoDataUrl?.startsWith('/api/')) {
      logoUrl = payload.logoDataUrl.substring(4);
    } else if (payload.logoDataUrl) {
      logoUrl = payload.logoDataUrl;
    }
    
    let coverUrl = null;
    if (payload.coverDataUrl?.startsWith('data:')) {
      coverUrl = await saveCallCenterImage(payload.coverDataUrl, 'cover.png');
    } else if (payload.coverDataUrl?.startsWith('/api/')) {
      coverUrl = payload.coverDataUrl.substring(4);
    } else if (payload.coverDataUrl) {
      coverUrl = payload.coverDataUrl;
    }

    const creatorName = request.admin.nickname || request.admin.displayName || request.admin.email || "管理員";

    // 3. 落库：呼叫中心主表
    const ccResult = await connection.query(
      `INSERT INTO call_centers (
         tenant_id, center_name, center_slug, center_url, logo_url, cover_image_url,
         description, welcome_text, require_visitor_info, visitor_info_required_fields,
         visitor_info_optional_fields, visitor_info_form_title, visitor_info_form_desc,
         status, created_by, created_by_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        request.admin.tenantId, centerName, slug, centerUrl, logoUrl, coverUrl,
        payload.description || null, payload.welcomeMessage || null, visitorEnabled,
        JSON.stringify(requiredFields), JSON.stringify(optionalFields),
        payload.visitorTitle || null, payload.visitorDescription || null,
        request.admin.id, creatorName
      ]
    );
    
    const callCenterId = Number(ccResult.insertId);

    // 4. 落库：服务分类及坐席列表
    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const catName = sanitizeString(cat.name, 128);
      if (!catName) continue;

      // 插入分类
      const catResult = await connection.query(
        `INSERT INTO call_center_categories (
           call_center_id, tenant_id, category_name, sort_order
         ) VALUES (?, ?, ?, ?)`,
        [callCenterId, request.admin.tenantId, catName, i]
      );
      const categoryId = Number(catResult.insertId);

      if (Array.isArray(cat.agents)) {
        for (let j = 0; j < cat.agents.length; j++) {
          const agent = cat.agents[j];
          let avatarUrl = agent.avatarDataUrl || null;
          if (avatarUrl?.startsWith('data:')) {
            avatarUrl = await saveCallCenterImage(avatarUrl, 'avatar.png');
          } else if (avatarUrl?.startsWith('/api/')) {
            avatarUrl = avatarUrl.substring(4);
          }

          const sipAccountId = agent.ecardId;
          
          if (!sipAccountId) {
            await connection.rollback();
            return response.status(400).json({ message: `坐席 ${agent.name || '(未命名)'} 缺少必要的電子名片關聯，請檢查配置。` });
          }
          // 插入分类下的坐席
          await connection.query(
            `INSERT INTO call_center_category_agents (
               call_center_id, category_id, tenant_id, sip_account_id, sip_number,
               display_name, avatar_url, job_title, phone, email, sort_order
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              callCenterId, categoryId, request.admin.tenantId, sipAccountId,
              agent.sip || '', agent.name || 'Unknown', avatarUrl, agent.title || null,
              agent.phone || null, agent.email || null, j
            ]
          );
        }
      }
    }

    await connection.commit();
    return response.status(201).json({ message: "呼叫中心配置已儲存" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Failed to save call center:", error);
    return response.status(500).json({ message: "儲存呼叫中心失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/call-centers/:id/status - 更新呼叫中心狀態
app.put("/api/call-centers/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以修改呼叫中心狀態。" });
  }

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心編號。" });

  const status = sanitizeString(request.body?.status, 20);
  if (!['active', 'disabled'].includes(status)) {
    return response.status(400).json({ code: -1, message: "狀態值無效。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    if (status === 'active') {
      const planRows = await connection.query(`
        SELECT DATE_FORMAT(MAX(expires_at), '%Y-%m-%d') as tenant_expires_at
        FROM billing_orders
        WHERE tenant_id = ? AND order_status = 'review_approved'
      `, [request.admin.tenantId]);
      const tenantExpiresAt = planRows[0]?.tenant_expires_at || null;

      let isExpired = true;
      if (tenantExpiresAt) {
        const expiresDate = new Date(`${tenantExpiresAt}T00:00:00Z`);
        const today = new Date();
        const diffTime = expiresDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays >= 0) {
          isExpired = false;
        }
      }
      if (isExpired) {
        return response.status(403).json({ code: -1, message: "套餐已過期，無法啟用。" });
      }
    }

    const result = await connection.query(
      `UPDATE call_centers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      [status, id, request.admin.tenantId]
    );

    if (Number(result.affectedRows || 0) === 0) {
      return response.status(404).json({ code: -1, message: "找不到呼叫中心。" });
    }

    return response.json({ code: 0, message: "狀態已更新。" });
  } catch (error) {
    console.error("Failed to update call center status:", error);
    return response.status(500).json({ code: -1, message: "更新狀態失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/call-centers/:id/visitor-info - 更新呼叫中心访客登记狀態
app.put("/api/call-centers/:id/visitor-info", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以修改呼叫中心配置。" });
  }

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心編號。" });

  const visitorEnabled = Boolean(request.body?.visitorEnabled) ? 1 : 0;

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `UPDATE call_centers SET require_visitor_info = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      [visitorEnabled, id, request.admin.tenantId]
    );

    if (Number(result.affectedRows || 0) === 0) {
      return response.status(404).json({ code: -1, message: "找不到呼叫中心。" });
    }

    return response.json({ code: 0, message: "訪客登記狀態已更新。" });
  } catch (error) {
    console.error("Failed to update visitor info status:", error);
    return response.status(500).json({ code: -1, message: "更新訪客登記狀態失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/call-centers - 批量/单条刪除呼叫中心
app.delete("/api/call-centers", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以刪除呼叫中心。" });
  }

  const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(Number).filter(id => id > 0) : [];
  if (ids.length === 0) {
    return response.status(400).json({ code: -1, message: "請提供要刪除的呼叫中心編號。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const placeholders = ids.map(() => "?").join(",");
    const rows = await connection.query(
      `SELECT id FROM call_centers WHERE id IN (${placeholders}) AND tenant_id = ? FOR UPDATE`,
      [...ids, request.admin.tenantId]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    const validIds = rows.map(r => Number(r.id));
    const validPlaceholders = validIds.map(() => "?").join(",");

    await connection.query(`DELETE FROM call_center_category_agents WHERE call_center_id IN (${validPlaceholders}) AND tenant_id = ?`, [...validIds, request.admin.tenantId]);
    await connection.query(`DELETE FROM call_center_categories WHERE call_center_id IN (${validPlaceholders}) AND tenant_id = ?`, [...validIds, request.admin.tenantId]);
    const result = await connection.query(`DELETE FROM call_centers WHERE id IN (${validPlaceholders}) AND tenant_id = ?`, [...validIds, request.admin.tenantId]);

    await connection.commit();
    return response.json({ code: 0, message: `成功刪除 ${result.affectedRows} 個呼叫中心。` });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete call centers:", error);
    return response.status(500).json({ code: -1, message: "刪除失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/call-centers/:id - 取得呼叫中心详情
app.get("/api/call-centers/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以檢視呼叫中心配置。" });
  }

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心編號。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [cc] = await connection.query(`
      SELECT * FROM call_centers WHERE id = ? AND tenant_id = ?
    `, [id, request.admin.tenantId]);

    if (!cc) {
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    const categoriesRows = await connection.query(`
      SELECT * FROM call_center_categories WHERE call_center_id = ? ORDER BY sort_order ASC
    `, [id]);

    const agentsRows = await connection.query(`
      SELECT * FROM call_center_category_agents WHERE call_center_id = ? ORDER BY category_id ASC, sort_order ASC
    `, [id]);

    const categories = categoriesRows.map(cat => {
      const agents = agentsRows.filter(a => a.category_id === cat.id).map(a => ({
        id: Number(a.id),
        ecardId: a.sip_account_id ? Number(a.sip_account_id) : null,
        sip: a.sip_number || '',
        name: a.display_name || '',
        avatarDataUrl: a.avatar_url ? (a.avatar_url.startsWith('/') && !a.avatar_url.startsWith('/api/') ? `/api${a.avatar_url}` : a.avatar_url) : '',
        title: a.job_title || '',
        phone: a.phone || '',
        email: a.email || ''
      }));
      return {
        id: Number(cat.id),
        name: cat.category_name,
        agentCount: agents.length,
        agents
      };
    });

    return response.json({
      code: 0,
      data: {
        id: Number(cc.id),
        name: cc.center_name,
        slug: cc.center_slug,
        url: cc.center_url,
        logoDataUrl: cc.logo_url ? (cc.logo_url.startsWith('/') && !cc.logo_url.startsWith('/api/') ? `/api${cc.logo_url}` : cc.logo_url) : '',
        coverDataUrl: cc.cover_image_url ? (cc.cover_image_url.startsWith('/') && !cc.cover_image_url.startsWith('/api/') ? `/api${cc.cover_image_url}` : cc.cover_image_url) : '/api/call-center-images/cc-black-banner.png',
        description: cc.description || '',
        welcomeMessage: cc.welcome_text || '',
        visitorEnabled: Boolean(cc.require_visitor_info),
        visitorTitle: cc.visitor_info_form_title || '',
        visitorDescription: cc.visitor_info_form_desc || '',
        requiredFields: (() => {
          try {
            if (typeof cc.visitor_info_required_fields === 'object') return cc.visitor_info_required_fields || [];
            return cc.visitor_info_required_fields ? JSON.parse(cc.visitor_info_required_fields) : [];
          } catch (e) {
            console.warn(`Failed to parse visitor_info_required_fields for call center ${id}:`, cc.visitor_info_required_fields, e);
            return [];
          }
        })(),
        optionalFields: (() => {
          try {
            if (typeof cc.visitor_info_optional_fields === 'object') return cc.visitor_info_optional_fields || [];
            return cc.visitor_info_optional_fields ? JSON.parse(cc.visitor_info_optional_fields) : [];
          } catch (e) {
            console.warn(`Failed to parse visitor_info_optional_fields for call center ${id}:`, cc.visitor_info_optional_fields, e);
            return [];
          }
        })(),
        categories
      }
    });

  } catch (error) {
    console.error("Failed to fetch call center details:", error);
    return response.status(500).json({ code: -1, message: "取得呼叫中心詳情失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/call-centers/:id - 更新呼叫中心配置
app.put("/api/call-centers/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以配置呼叫中心。" });
  }

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心編號。" });

  const payload = request.body || {};
  const centerName = sanitizeString(payload.name, 100);
  const slug = sanitizeString(payload.slug, 100);
  if (!centerName || !slug) return response.status(400).json({ code: -1, message: "缺少呼叫中心名稱或 Slug 引數。" });

  const centerUrl = `${callCenterBaseUrl}/callcenter?id=${slug}`;
  const visitorEnabled = payload.visitorEnabled ? 1 : 0;

  const requiredFields = ["email"];
  if (payload.requireName) requiredFields.push("name");
  if (payload.requirePhone) requiredFields.push("phone");

  const optionalFields = [];
  if (payload.optionalCompany) optionalFields.push("company");
  if (payload.optionalContent) optionalFields.push("content");
  
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.query(`SELECT id FROM call_centers WHERE center_slug = ? AND id != ? LIMIT 1`, [slug, id]);
    if (existing) {
      await connection.rollback();
      return response.status(409).json({ code: -1, message: "該唯一標識 Slug 已被佔用，請更換。" });
    }

    const [currentCc] = await connection.query(`SELECT logo_url, cover_image_url FROM call_centers WHERE id = ? AND tenant_id = ? FOR UPDATE`, [id, request.admin.tenantId]);
    if (!currentCc) {
      await connection.rollback();
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    let logoUrl = currentCc.logo_url;
    if (payload.logoDataUrl?.startsWith('data:')) {
      logoUrl = await saveCallCenterImage(payload.logoDataUrl, 'logo.png');
    } else if (payload.logoDataUrl === '') {
      logoUrl = null;
    } else if (payload.logoDataUrl?.startsWith('/api/')) {
      logoUrl = payload.logoDataUrl.substring(4);
    } else if (payload.logoDataUrl) {
      logoUrl = payload.logoDataUrl;
    }

    let coverUrl = currentCc.cover_image_url;
    if (payload.coverDataUrl?.startsWith('data:')) {
      coverUrl = await saveCallCenterImage(payload.coverDataUrl, 'cover.png');
    } else if (payload.coverDataUrl === '') {
      coverUrl = null;
    } else if (payload.coverDataUrl?.startsWith('/api/')) {
      coverUrl = payload.coverDataUrl.substring(4);
    } else if (payload.coverDataUrl) {
      coverUrl = payload.coverDataUrl;
    }

    await connection.query(
      `UPDATE call_centers SET
         center_name = ?, center_slug = ?, center_url = ?, logo_url = ?, cover_image_url = ?,
         description = ?, welcome_text = ?, require_visitor_info = ?, visitor_info_required_fields = ?,
         visitor_info_optional_fields = ?, visitor_info_form_title = ?, visitor_info_form_desc = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`,
      [
        centerName, slug, centerUrl, logoUrl, coverUrl,
        payload.description || null, payload.welcomeMessage || null, visitorEnabled,
        JSON.stringify(requiredFields), JSON.stringify(optionalFields),
        payload.visitorTitle || null, payload.visitorDescription || null,
        id, request.admin.tenantId
      ]
    );

    await connection.query(`DELETE FROM call_center_category_agents WHERE call_center_id = ? AND tenant_id = ?`, [id, request.admin.tenantId]);
    await connection.query(`DELETE FROM call_center_categories WHERE call_center_id = ? AND tenant_id = ?`, [id, request.admin.tenantId]);

    const categories = Array.isArray(payload.categories) ? payload.categories : [];
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const catName = sanitizeString(cat.name, 128);
      if (!catName) continue;

      const catResult = await connection.query(
        `INSERT INTO call_center_categories (
           call_center_id, tenant_id, category_name, sort_order
         ) VALUES (?, ?, ?, ?)`,
        [id, request.admin.tenantId, catName, i]
      );
      const categoryId = Number(catResult.insertId);

      if (Array.isArray(cat.agents)) {
        for (let j = 0; j < cat.agents.length; j++) {
          const agent = cat.agents[j];
          let avatarUrl = agent.avatarDataUrl || null;
          if (avatarUrl?.startsWith('data:')) {
            avatarUrl = await saveCallCenterImage(avatarUrl, 'avatar.png');
          } else if (avatarUrl?.startsWith('/api/')) {
            avatarUrl = avatarUrl.substring(4);
          }

          const sipAccountId = agent.ecardId;
          
          if (!sipAccountId) {
            await connection.rollback();
            return response.status(400).json({ code: -1, message: `坐席 ${agent.name || '(未命名)'} 缺少必要的電子名片關聯，請檢查配置。` });
          }
          await connection.query(
            `INSERT INTO call_center_category_agents (
               call_center_id, category_id, tenant_id, sip_account_id, sip_number,
               display_name, avatar_url, job_title, phone, email, sort_order
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id, categoryId, request.admin.tenantId, sipAccountId,
              agent.sip || '', agent.name || 'Unknown', avatarUrl, agent.title || null,
              agent.phone || null, agent.email || null, j
            ]
          );
        }
      }
    }

    await connection.commit();
    return response.json({ code: 0, message: "呼叫中心配置已更新" });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to update call center:", error);
    return response.status(500).json({ code: -1, message: "更新呼叫中心失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /callcenter - 訪客端動態渲染頁
app.get("/callcenter", async (request, response) => {
  const slug = sanitizeString(String(request.query.id || ''), 100);
  if (!slug) return response.status(400).send("Invalid call center URL.");

  let connection;
  try {
    connection = await pool.getConnection();
    const [cc] = await connection.query(`SELECT * FROM call_centers WHERE center_slug = ? AND status = 'active' LIMIT 1`, [slug]);
    if (!cc) {
      return response.status(404).send("<h2 style='text-align:center;margin-top:20vh;'>404 Not Found</h2><p style='text-align:center;'>該呼叫中心不存在或已停用。</p>");
    }

    // 检查呼叫中心所属租戶套餐是否有效
    const planRows = await connection.query(`
      SELECT DATE_FORMAT(MAX(expires_at), '%Y-%m-%d') as tenant_expires_at
      FROM billing_orders
      WHERE tenant_id = ? AND order_status = 'review_approved'
    `, [cc.tenant_id]);
    
    const tenantExpiresAt = planRows[0]?.tenant_expires_at || null;
    if (tenantExpiresAt) {
      const expiresDate = new Date(`${tenantExpiresAt}T00:00:00Z`);
      const today = new Date();
      if (expiresDate.getTime() < today.getTime()) {
         return response.status(403).send("<h2 style='text-align:center;margin-top:20vh;color:red;'>403 Forbidden</h2><p style='text-align:center;'>服務不可用：企業套餐已過期。</p>");
      }
    } else {
       return response.status(403).send("<h2 style='text-align:center;margin-top:20vh;color:red;'>403 Forbidden</h2><p style='text-align:center;'>服務不可用：該企業未開通有效套餐。</p>");
    }

    const categoriesRows = await connection.query(`SELECT * FROM call_center_categories WHERE call_center_id = ? ORDER BY sort_order ASC`, [cc.id]);
    const agentsRows = await connection.query(`SELECT * FROM call_center_category_agents WHERE call_center_id = ? ORDER BY category_id ASC, sort_order ASC`, [cc.id]);

    // Get web accounts for agents with SIP accounts
    const agentSipIds = agentsRows.filter(a => a.sip_account_id).map(a => a.sip_account_id);
    let webAccountMap = {};
    if (agentSipIds.length > 0) {
      const webRows = await connection.query(
        `SELECT ent.sip_user_id, wu.username
         FROM tenant_web_account_entitlements ent
         JOIN web_users wu ON wu.id = ent.web_user_id
         WHERE ent.sip_user_id IN (?) AND ent.tenant_id = ? AND ent.status = 'active'`,
        [agentSipIds, cc.tenant_id]
      );
      webRows.forEach(r => { webAccountMap[Number(r.sip_user_id)] = r.username; });
    }

    // Get ecard access slugs for agents
    let ecardSlugMap = {};
    if (agentSipIds.length > 0) {
      const ecardRows = await connection.query(
        `SELECT sip_user_id, access_slug FROM tenant_ecards WHERE sip_user_id IN (?) AND tenant_id = ? AND status = 'active'`,
        [agentSipIds, cc.tenant_id]
      );
      ecardRows.forEach(r => { ecardSlugMap[Number(r.sip_user_id)] = r.access_slug; });
    }

    const ecardBaseUrl = process.env.ECARD_APP_URL || "https://ecard.qrtalkie.org";

    const categories = categoriesRows.map(cat => {
      const agents = agentsRows.filter(a => a.category_id === cat.id).map(a => ({
        id: Number(a.id),
        ecardId: a.sip_account_id ? Number(a.sip_account_id) : null,
        ecardSlug: a.sip_account_id ? (ecardSlugMap[Number(a.sip_account_id)] || '') : '',
        sip: a.sip_number || '',
        web: a.sip_account_id ? (webAccountMap[Number(a.sip_account_id)] || '') : '',
        name: a.display_name || '',
        avatarDataUrl: a.avatar_url ? (a.avatar_url.startsWith('/') && !a.avatar_url.startsWith('/api/') ? `/api${a.avatar_url}` : a.avatar_url) : '',
        title: a.job_title || '',
        phone: a.phone || '',
        email: a.email || ''
      }));
      return { id: Number(cat.id), name: cat.category_name, agentCount: agents.length, agents };
    });

    const data = {
      id: Number(cc.id),
      name: cc.center_name,
      slug: cc.center_slug,
      logoDataUrl: cc.logo_url ? (cc.logo_url.startsWith('/') && !cc.logo_url.startsWith('/api/') ? `/api${cc.logo_url}` : cc.logo_url) : '',
      coverDataUrl: cc.cover_image_url ? (cc.cover_image_url.startsWith('/') && !cc.cover_image_url.startsWith('/api/') ? `/api${cc.cover_image_url}` : cc.cover_image_url) : '/api/call-center-images/cc-black-banner.png',
      description: cc.description || '',
      welcomeMessage: cc.welcome_text || '',
      visitorEnabled: Boolean(cc.require_visitor_info),
      visitorTitle: cc.visitor_info_form_title || '',
      visitorDescription: cc.visitor_info_form_desc || '',
      requiredFields: (() => { try { if (typeof cc.visitor_info_required_fields === 'object') return cc.visitor_info_required_fields || []; return cc.visitor_info_required_fields ? JSON.parse(cc.visitor_info_required_fields) : []; } catch(e) { return []; } })(),
      optionalFields: (() => { try { if (typeof cc.visitor_info_optional_fields === 'object') return cc.visitor_info_optional_fields || []; return cc.visitor_info_optional_fields ? JSON.parse(cc.visitor_info_optional_fields) : []; } catch(e) { return []; } })(),
      categories,
      sipDomain,
      ecardBaseUrl,
      allAgents: categories.flatMap(cat => cat.agents.map(a => ({
        id: a.id,
        name: a.name,
        title: a.title || '',
        sip: a.sip || '',
        web: a.web || '',
        categoryId: cat.id,
        categoryName: cat.name,
        ecardSlug: a.ecardSlug || ''
      })))
    };

    // 载入模板、替换标题，注入动态数据
    const templatePath = path.resolve(projectRoot, "visitor-preview.html");
    let html = await readFile(templatePath, "utf-8");
    html = html.replace('<title>呼叫中心 - 訪客端預覽</title>', `<title>${data.name} - 企業呼叫中心</title>`);
    html = html.replace('</head>', `<script>window.__CALL_CENTER_DATA__ = ${JSON.stringify(data)};</script>\n</head>`);

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.send(html);
  } catch (error) {
    console.error("Failed to render visitor page:", error);
    return response.status(500).send("<h2 style='text-align:center;margin-top:20vh;'>500 Internal Error</h2><p style='text-align:center;'>系統繁忙，請稍後再試。</p>");
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/public/call-centers/agent-status - 查询坐席 SIP 在线状态
app.get("/api/public/call-centers/agent-status", async (request, response) => {
  const account = sanitizeString(String(request.query.account || ''), 100);
  const domain = sanitizeString(String(request.query.domain || ''), 200);
  if (!account || !domain) return response.status(400).json({ code: -1, message: "缺少 account 或 domain 引數" });

  try {
    const redisKey = `fs:${account}@${domain}`;
    const redisResult = await readRegistrarKeys([redisKey]);
    const regData = redisResult.get(redisKey);
    let online = false;
    if (regData && regData.type === "hash" && regData.ttl !== -2) {
      online = (regData.entries || []).length > 0;
    }
    return response.json({ code: 0, data: { account, domain, online } });
  } catch (error) {
    console.error("Failed to query agent SIP status:", error);
    return response.status(500).json({ code: -1, message: "查詢失敗" });
  }
});

// POST /api/public/call-centers/:slug/visitor-submit - 访客提交登记表单
app.post("/api/public/call-centers/:slug/visitor-submit", async (request, response) => {
  const slug = sanitizeString(request.params.slug, 100);
  if (!slug) return response.status(400).json({ code: -1, message: "無效的連結。" });

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 128);
  const phone = sanitizeString(payload.phone, 64);
  const email = normalizeEmail(payload.email);
  const company = sanitizeString(payload.company, 128);
  const content = sanitizeString(payload.content, 1000);

  const visitorIp = request.ip || request.connection?.remoteAddress || "";
  const userAgent = request.get("user-agent") || "";

  let connection;
  try {
    connection = await pool.getConnection();
    const [cc] = await connection.query(`SELECT id, tenant_id, status FROM call_centers WHERE center_slug = ? LIMIT 1`, [slug]);
    
    if (!cc) return response.status(404).json({ code: -1, message: "該呼叫中心不存在。" });
    if (cc.status !== 'active') return response.status(403).json({ code: -1, message: "該呼叫中心已停用。" });

    await connection.query(
      `INSERT INTO call_center_visitor_inquiries (
         call_center_id, tenant_id, visitor_name, visitor_phone, visitor_email,
         visitor_company, visitor_message, visitor_ip, user_agent
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(cc.id), Number(cc.tenant_id),
        name || null, phone || null, email || '', company || null, content || null,
        visitorIp.slice(0, 64), userAgent.slice(0, 1000)
      ]
    );

    return response.json({ code: 0, message: "登記成功" });
  } catch (error) {
    console.error("Failed to save visitor submit:", error);
    return response.status(500).json({ code: -1, message: "系統繁忙，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/public/call-centers/:slug/visitor-message - 访客在線留言
app.post("/api/public/call-centers/:slug/visitor-message", async (request, response) => {
  const slug = sanitizeString(request.params.slug, 100);
  if (!slug) return response.status(400).json({ code: -1, message: "無效的連結。" });

  const { name, phone, email, company, content, agentId, agentName, agentSip, categoryId } = request.body || {};
  const visitorName = sanitizeString(String(name || ''), 100);
  const visitorPhone = sanitizeString(String(phone || ''), 50);
  const visitorEmail = sanitizeString(String(email || ''), 200);
  const visitorCompany = sanitizeString(String(company || ''), 200);
  const messageContent = sanitizeString(String(content || ''), 2000);
  const targetAgentId = agentId ? Number(agentId) : null;
  const targetAgentName = sanitizeString(String(agentName || ''), 100);
  const targetAgentSip = sanitizeString(String(agentSip || ''), 64);
  const targetCategoryId = categoryId ? Number(categoryId) : null;

  if (!visitorEmail) return response.status(400).json({ code: -1, message: "郵箱為必填項。" });
  if (!messageContent) return response.status(400).json({ code: -1, message: "諮詢內容為必填項。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [cc] = await connection.query(`SELECT id, tenant_id, status, center_name FROM call_centers WHERE center_slug = ? LIMIT 1`, [slug]);
    if (!cc || cc.status !== 'active') {
      return response.status(404).json({ code: -1, message: "該呼叫中心不存在或已停用。" });
    }

    // Look up agent sip_account_id if targeting a specific agent
    let agentSipAccountId = null;
    if (targetAgentId) {
      const [agentRow] = await connection.query(
        `SELECT sip_account_id FROM call_center_category_agents WHERE id = ? AND call_center_id = ? LIMIT 1`,
        [targetAgentId, cc.id]
      );
      if (agentRow) agentSipAccountId = agentRow.sip_account_id || null;
    }

    await connection.query(
      `INSERT INTO call_center_visitor_inquiries (
         call_center_id, tenant_id, category_id, agent_id, sip_account_id, sip_number,
         visitor_name, visitor_phone, visitor_email, visitor_company,
         visitor_message, visitor_ip, user_agent
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cc.id, cc.tenant_id, targetCategoryId, targetAgentId, agentSipAccountId, targetAgentSip || null,
       visitorName || null, visitorPhone || null, visitorEmail, visitorCompany || null,
       messageContent,
       (request.ip || request.connection?.remoteAddress || '').slice(0, 64), (request.headers['user-agent'] || '').slice(0, 1000)]
    );

    return response.json({ code: 0, message: "留言提交成功" });
  } catch (error) {
    console.error("Failed to save visitor message:", error.message, error.stack);
    return response.status(500).json({ code: -1, message: error.message || "系統繁忙，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/call-centers/:id/visitor-inquiries - 取得呼叫中心的访客记录
app.get("/api/call-centers/:id/visitor-inquiries", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以檢視訪客記錄。" });
  }

  const callCenterId = Number(request.params.id);
  if (!Number.isInteger(callCenterId) || callCenterId <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心編號。" });

  const limit = Math.max(1, parseInt(request.query.limit || "10", 10));
  const offset = Math.max(0, parseInt(request.query.offset || "0", 10));
  const keyword = sanitizeString(request.query.keyword, 120);
  const startDate = sanitizeString(request.query.startDate, 20);
  const endDate = sanitizeString(request.query.endDate, 20);

  const whereClauses = ["vi.tenant_id = ?", "vi.call_center_id = ?"];
  const params = [request.admin.tenantId, callCenterId];

  if (keyword) {
    whereClauses.push("(vi.visitor_name LIKE ? OR vi.visitor_phone LIKE ? OR vi.visitor_email LIKE ? OR vi.visitor_company LIKE ? OR vi.visitor_message LIKE ?)");
    const pattern = `%${keyword}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  if (startDate) {
    whereClauses.push("vi.created_at >= ?");
    params.push(`${startDate} 00:00:00`);
  }
  if (endDate) {
    whereClauses.push("vi.created_at <= ?");
    params.push(`${endDate} 23:59:59`);
  }

  const whereSql = "WHERE " + whereClauses.join(" AND ");

  let connection;
  try {
    connection = await pool.getConnection();

    const [cc] = await connection.query(`SELECT id, center_name FROM call_centers WHERE id = ? AND tenant_id = ? LIMIT 1`, [callCenterId, request.admin.tenantId]);
    if (!cc) {
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    const countRows = await connection.query(`SELECT COUNT(*) AS total FROM call_center_visitor_inquiries vi ${whereSql}`, params);
    const total = Number(countRows[0]?.total || 0);

    const rows = await connection.query(`
      SELECT vi.id, vi.visitor_name, vi.visitor_phone, vi.visitor_email, vi.visitor_company,
             vi.visitor_message, vi.inquiry_status, vi.created_at,
             ca.display_name AS agent_name,
             ccat.category_name,
             vi.sip_number
      FROM call_center_visitor_inquiries vi
      LEFT JOIN call_center_category_agents ca ON ca.id = vi.agent_id
      LEFT JOIN call_center_categories ccat ON ccat.id = vi.category_id
      ${whereSql}
      ORDER BY vi.created_at DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const formattedRows = rows.map(row => ({
      id: Number(row.id),
      visitorName: row.visitor_name || '-',
      visitorPhone: row.visitor_phone || '-',
      visitorEmail: row.visitor_email || '-',
      visitorCompany: row.visitor_company || '-',
      visitorMessage: row.visitor_message || '-',
      status: row.inquiry_status,
      createdAt: row.created_at,
      agentName: row.agent_name || null,
      categoryName: row.category_name || null,
    }));

    return response.json({ code: 0, data: { list: formattedRows, total, centerName: cc.center_name } });
  } catch (error) {
    console.error("Failed to fetch visitor inquiries:", error.message, error.stack);
    return response.status(500).json({ code: -1, message: error.message || "取得訪客記錄失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/call-centers/:callCenterId/visitor-inquiries - 批量/单条刪除访客记录
app.delete("/api/call-centers/:callCenterId/visitor-inquiries", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以刪除訪客記錄。" });
  }

  const callCenterId = Number(request.params.callCenterId);
  if (!Number.isInteger(callCenterId) || callCenterId <= 0) return response.status(400).json({ code: -1, message: "無效的呼叫中心編號。" });

  const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(Number).filter(id => id > 0) : [];
  if (ids.length === 0) {
    return response.status(400).json({ code: -1, message: "請提供要刪除的訪客記錄編號。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 校验呼叫中心是否存在且属于当前租戶
    const [cc] = await connection.query(`SELECT id FROM call_centers WHERE id = ? AND tenant_id = ? LIMIT 1`, [callCenterId, request.admin.tenantId]);
    if (!cc) {
      await connection.rollback();
      return response.status(404).json({ code: -1, message: "找不到指定的呼叫中心。" });
    }

    // 刪除记录，确保 tenant_id 和 call_center_id 匹配，防止越权刪除
    const placeholders = ids.map(() => "?").join(",");
    const result = await connection.query(
      `DELETE FROM call_center_visitor_inquiries WHERE id IN (${placeholders}) AND tenant_id = ? AND call_center_id = ?`,
      [...ids, request.admin.tenantId, callCenterId]
    );

    await connection.commit();
    return response.json({ code: 0, message: `成功刪除 ${result.affectedRows} 條訪客記錄。` });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("Failed to delete visitor inquiries:", error);
    return response.status(500).json({ code: -1, message: "刪除訪客記錄失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/access-communities - 取得租戶的社區列表及统计
app.get("/api/access-communities", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ code: -1, message: "只有租戶管理員可以檢視社群列表。" });
  }

  const keyword = sanitizeString(request.query.keyword, 120) || null;

  const whereClauses = ["tenant_id = ?"];
  const params = [request.admin.tenantId];
  if (keyword) {
    whereClauses.push("(name LIKE ? OR address LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = "WHERE " + whereClauses.join(" AND ");

  let connection;
  try {
    connection = await pool.getConnection();

    const statsRows = await connection.query(
      `SELECT COUNT(*) AS total FROM access_communities ${whereSql}`,
      params
    );
    const total = Number(statsRows[0]?.total || 0);

    const rows = await connection.query(
      `SELECT id, tenant_id, name, slug, address, latitude, longitude,
              service_scope, is_active, access_url, contact_person, contact_phone, contact_email,
              logo_url, banner_url, visitor_title, show_tips, tips_text,
              created_at, updated_at
       FROM access_communities ${whereSql}
       ORDER BY created_at DESC`,
      params
    );

    const communityIds = rows.map(r => r.id);

    // 查詢所有相關樓宇
    let buildingsMap = {};
    if (communityIds.length > 0) {
      try {
        const buildingRows = await connection.query(
          `SELECT b.id, b.tenant_id, b.community_id, b.name,
                  b.address, b.latitude, b.longitude, b.service_scope,
                  b.contact_person, b.contact_phone, b.contact_email,
                  b.created_at, b.updated_at
           FROM access_buildings b
           WHERE b.community_id IN (?) AND b.tenant_id = ?`,
          [communityIds, request.admin.tenantId]
        );

        const buildingIds = buildingRows.map(b => b.id);
        let roomsMap = {};
        if (buildingIds.length > 0) {
          try {
            const roomRows = await connection.query(
              `SELECT r.id, r.tenant_id, r.building_id, r.room_number, r.floor,
                      r.contact_person, r.contact_phone, r.contact_email,
                      r.sip_user_id, r.allow_video_call,
                      COALESCE(s.display_name, s.username, '') AS sip_name,
                      COALESCE(s.username, '') AS sip_account
               FROM access_rooms r
               LEFT JOIN sip_users s ON s.id = r.sip_user_id
               WHERE r.building_id IN (?) AND r.tenant_id = ?`,
              [buildingIds, request.admin.tenantId]
            );
            for (const room of roomRows) {
              if (!roomsMap[String(room.building_id)]) roomsMap[String(room.building_id)] = [];
              roomsMap[String(room.building_id)].push({
                id: Number(room.id),
                buildingId: Number(room.building_id),
                roomNumber: room.room_number,
                floor: room.floor || null,
                contactPerson: room.contact_person || null,
                contactPhone: room.contact_phone || null,
                contactEmail: room.contact_email || null,
                sipUserId: room.sip_user_id ? Number(room.sip_user_id) : null,
                sipName: room.sip_name || null,
                sipAccount: room.sip_account || null,
                allowVideoCall: room.allow_video_call == null ? true : !!room.allow_video_call,
              });
            }
          } catch (err) { console.error("查詢房間失敗:", err); }
        }

        // 查詢樓宇級入口
        let buildingEntrancesMap = {};
        if (buildingIds.length > 0) {
          try {
            const entRows = await connection.query(
              `SELECT e.id, e.name, e.community_id, e.building_id, e.device_id,
                      e.is_active,
                      COALESCE(g.device_uuid, '') AS device_name,
                      COALESCE(g.assignment_status, '') AS device_status,
                      e.address, e.latitude, e.longitude, e.service_scope,
                      e.contact_person, e.contact_phone, e.contact_email,
                      (SELECT COUNT(*) FROM access_room_entrance_auth WHERE entrance_id = e.id) AS auth_count
               FROM access_entrances e
               LEFT JOIN gate_devices g ON g.id = e.device_id
               WHERE e.building_id IN (?) AND e.tenant_id = ?`,
              [buildingIds, request.admin.tenantId]
            );
            for (const ent of entRows) {
              if (!buildingEntrancesMap[String(ent.building_id)]) buildingEntrancesMap[String(ent.building_id)] = [];
              buildingEntrancesMap[String(ent.building_id)].push({
                id: Number(ent.id),
                name: ent.name,
                isActive: ent.is_active == null ? true : !!ent.is_active,
                address: ent.address || null,
                latitude: ent.latitude,
                longitude: ent.longitude,
                serviceScope: ent.service_scope != null ? Number(ent.service_scope) : 0,
                contactPerson: ent.contact_person || null,
                contactPhone: ent.contact_phone || null,
                contactEmail: ent.contact_email || null,
                deviceId: ent.device_id ? Number(ent.device_id) : null,
                device: ent.device_name || null,
                deviceStatus: ent.device_status || "none",
                authCount: Number(ent.auth_count) || 0,
              });
            }
          } catch (err) { console.error("查詢樓宇入口失敗:", err); }
        }

        for (const b of buildingRows) {
          if (!buildingsMap[String(b.community_id)]) buildingsMap[String(b.community_id)] = [];
          buildingsMap[String(b.community_id)].push({
            id: Number(b.id),
            name: b.name,
            communityId: Number(b.community_id),
            address: b.address || null,
            latitude: b.latitude,
            longitude: b.longitude,
            serviceScope: b.service_scope != null ? Number(b.service_scope) : 0,
            contactPerson: b.contact_person || null,
            contactPhone: b.contact_phone || null,
            contactEmail: b.contact_email || null,
            rooms: roomsMap[String(b.id)] || [],
            entrances: buildingEntrancesMap[String(b.id)] || [],
          });
        }
      } catch (err) { console.error("查詢樓宇失敗:", err); }
    }

    // 查詢社區級入口
    let communityEntrancesMap = {};
    if (communityIds.length > 0) {
      try {
        const normalIds = communityIds.map(id => Number(id));
        const entRows = await connection.query(
          `SELECT e.id, e.name, e.community_id, e.building_id, e.device_id,
                  e.is_active,
                  COALESCE(g.device_uuid, '') AS device_name,
                  COALESCE(g.assignment_status, '') AS device_status,
                  e.address, e.latitude, e.longitude, e.service_scope,
                  e.contact_person, e.contact_phone, e.contact_email,
                  (SELECT COUNT(*) FROM access_room_entrance_auth WHERE entrance_id = e.id) AS auth_count
           FROM access_entrances e
           LEFT JOIN gate_devices g ON g.id = e.device_id
           WHERE e.community_id IN (?) AND e.tenant_id = ?`,
          [normalIds, request.admin.tenantId]
        );
        for (const ent of entRows) {
          if (!communityEntrancesMap[String(ent.community_id)]) communityEntrancesMap[String(ent.community_id)] = [];
          communityEntrancesMap[String(ent.community_id)].push({
            id: Number(ent.id),
            name: ent.name,
            isActive: ent.is_active == null ? true : !!ent.is_active,
            address: ent.address || null,
            latitude: ent.latitude,
            longitude: ent.longitude,
            serviceScope: ent.service_scope != null ? Number(ent.service_scope) : 0,
            contactPerson: ent.contact_person || null,
            contactPhone: ent.contact_phone || null,
            contactEmail: ent.contact_email || null,
            deviceId: ent.device_id ? Number(ent.device_id) : null,
            device: ent.device_name || null,
            deviceStatus: ent.device_status || "none",
            authCount: Number(ent.auth_count) || 0,
          });
        }
      } catch (err) { console.error("查詢社群入口失敗:", err); }
    }

    // 查詢權限矩陣
    let authMatrixMap = {};
    if (communityIds.length > 0) {
      try {
        const authRows = await connection.query(
          `SELECT ara.entrance_id, ara.room_id, r.building_id, b.community_id
           FROM access_room_entrance_auth ara
           JOIN access_rooms r ON r.id = ara.room_id
           JOIN access_buildings b ON b.id = r.building_id
           WHERE ara.tenant_id = ? AND b.community_id IN (?)`,
          [request.admin.tenantId, communityIds]
        );
        for (const a of authRows) {
          if (!authMatrixMap[String(a.community_id)]) authMatrixMap[String(a.community_id)] = {};
          if (!authMatrixMap[String(a.community_id)][String(a.entrance_id)]) authMatrixMap[String(a.community_id)][String(a.entrance_id)] = [];
          authMatrixMap[String(a.community_id)][String(a.entrance_id)].push(Number(a.room_id));
        }
      } catch (err) { console.error("查詢許可權矩陣失敗:", err); }
    }

    response.json({
      code: 0,
      data: {
        total,
        list: rows.map(r => ({
          id: Number(r.id),
          tenantId: Number(r.tenant_id),
          name: r.name,
          slug: r.slug || null,
          address: r.address,
          latitude: r.latitude,
          longitude: r.longitude,
          serviceScope: r.service_scope,
          isActive: r.is_active == null ? true : !!r.is_active,
          accessUrl: r.access_url || null,
          logoUrl: r.logo_url || null,
          bannerUrl: r.banner_url || null,
          visitorTitle: r.visitor_title || null,
          showTips: r.show_tips == null ? true : !!r.show_tips,
          tipsText: r.tips_text || null,
          contactPerson: r.contact_person,
          contactPhone: r.contact_phone,
          contactEmail: r.contact_email,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          buildings: buildingsMap[String(r.id)] || [],
          communityEntrances: communityEntrancesMap[String(r.id)] || [],
          authMatrix: authMatrixMap[String(r.id)] || {},
        })),
      },
    });
  } catch (error) {
    console.error("獲取社群列表失敗:", error);
    response.status(500).json({ code: -1, message: "獲取社群列表失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-communities - 租戶新增社區
app.post("/api/access-communities", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理社群。" });
  }

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 100);
  if (!name) return response.status(400).json({ message: "請填寫社群名稱。" });

  const slug = sanitizeString(payload.slug, 64);
  if (!slug) return response.status(400).json({ message: "請提供唯一標識 Slug。" });

  const address = sanitizeString(payload.address, 500);
  if (!address) return response.status(400).json({ message: "請填寫社群地址。" });
  const latitude = payload.latitude != null && !isNaN(Number(payload.latitude)) ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null && !isNaN(Number(payload.longitude)) ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null && !isNaN(Number(payload.serviceScope)) ? Math.round(Number(payload.serviceScope)) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  const accessUrl = `${accessBaseUrl}/access/${slug}`;

  let connection;
  try {
    connection = await pool.getConnection();

    // 檢查 slug 唯一性
    const [existingSlug] = await connection.query(
      "SELECT id FROM access_communities WHERE slug = ? LIMIT 1",
      [slug]
    );
    if (existingSlug) return response.status(409).json({ message: "該唯一標識 Slug 已被佔用，請更換。" });

    const logoUrl = sanitizeString(payload.logoUrl, 500) || null;
    const bannerUrl = sanitizeString(payload.bannerUrl, 500) || null;
    const visitorTitle = sanitizeString(payload.visitorTitle, 200) || null;
    const showTips = payload.showTips === false ? false : true;
    const tipsText = sanitizeString(payload.tipsText, 500) || null;

    const result = await connection.query(
      `INSERT INTO access_communities
         (tenant_id, name, slug, address, latitude, longitude, service_scope, contact_person, contact_phone, contact_email, access_url,
          logo_url, banner_url, visitor_title, show_tips, tips_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.admin.tenantId, name, slug, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, accessUrl,
       logoUrl, bannerUrl, visitorTitle, showTips, tipsText]
    );
    response.status(201).json({
      code: 0,
      message: "社群已新增。",
      data: {
        id: Number(result.insertId),
        tenantId: request.admin.tenantId,
        name,
        slug,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
        accessUrl,
        logoUrl,
        bannerUrl,
        visitorTitle,
        showTips,
        tipsText,
      }
    });
  } catch (error) {
    console.error("新增社群失敗:", error);
    response.status(500).json({ message: "新增社群失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-communities/:id - 編輯社區
app.put("/api/access-communities/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理社群。" });
  }

  const communityId = Number(request.params.id);
  if (!communityId) return response.status(400).json({ message: "無效的社群 ID。" });

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 100);
  if (!name) return response.status(400).json({ message: "請填寫社群名稱。" });

  const slug = sanitizeString(payload.slug, 64);
  if (!slug) return response.status(400).json({ message: "請提供唯一標識 Slug。" });

  const address = sanitizeString(payload.address, 500);
  if (!address) return response.status(400).json({ message: "請填寫社群地址。" });

  const latitude = payload.latitude != null && !isNaN(Number(payload.latitude)) ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null && !isNaN(Number(payload.longitude)) ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null && !isNaN(Number(payload.serviceScope)) ? Math.round(Number(payload.serviceScope)) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;
  const logoUrl = sanitizeString(payload.logoUrl, 500) || null;
  const bannerUrl = sanitizeString(payload.bannerUrl, 500) || null;
  const visitorTitle = sanitizeString(payload.visitorTitle, 255) || null;
  const showTips = payload.showTips != null ? (payload.showTips ? 1 : 0) : 1;
  const tipsText = sanitizeString(payload.tipsText, 500) || null;

  const accessUrl = `${accessBaseUrl}/access/${slug}`;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "社群不存在。" });

    // 檢查 slug 唯一性（排除自身）
    const [existingSlug] = await connection.query(
      "SELECT id FROM access_communities WHERE slug = ? AND id != ? LIMIT 1",
      [slug, communityId]
    );
    if (existingSlug) return response.status(409).json({ message: "該唯一標識 Slug 已被佔用，請更換。" });

    await connection.query(
      `UPDATE access_communities
       SET name = ?, slug = ?, address = ?, latitude = ?, longitude = ?, service_scope = ?,
           contact_person = ?, contact_phone = ?, contact_email = ?, access_url = ?,
           logo_url = ?, banner_url = ?, visitor_title = ?, show_tips = ?, tips_text = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, slug, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, accessUrl, logoUrl, bannerUrl, visitorTitle, showTips, tipsText, communityId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "社群已更新。",
      data: {
        id: communityId,
        tenantId: request.admin.tenantId,
        name,
        slug,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
        accessUrl,
        logoUrl,
        bannerUrl,
        visitorTitle,
        showTips: showTips === 1,
        tipsText,
      }
    });
  } catch (error) {
    console.error("編輯社群失敗:", error);
    response.status(500).json({ message: "編輯社群失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-communities/:id/toggle - 啟用/停用社區
app.put("/api/access-communities/:id/toggle", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理社群。" });
  }

  const communityId = Number(request.params.id);
  if (!communityId) return response.status(400).json({ message: "無效的社群 ID。" });

  const isActive = request.body && request.body.isActive ? 1 : 0;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, is_active FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "社群不存在。" });

    await connection.query(
      "UPDATE access_communities SET is_active = ? WHERE id = ? AND tenant_id = ?",
      [isActive, communityId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: isActive ? "社群已啟用。" : "社群已停用。",
      data: { id: communityId, isActive: !!isActive }
    });
  } catch (error) {
    console.error("切換社群狀態失敗:", error);
    response.status(500).json({ message: "操作失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-communities/:id - 刪除社區
app.delete("/api/access-communities/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理社群。" });
  }

  const communityId = Number(request.params.id);
  if (!communityId) return response.status(400).json({ message: "無效的社群 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "社群不存在。" });

    await connection.query(
      "DELETE FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );

    response.json({ code: 0, message: "社群已刪除。", data: { id: communityId } });
  } catch (error) {
    console.error("刪除社群失敗:", error);
    response.status(500).json({ message: "刪除社群失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-buildings - 新增樓宇
app.post("/api/access-buildings", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理樓宇。" });
  }

  const payload = request.body || {};
  const communityId = Number(payload.communityId);
  if (!communityId) return response.status(400).json({ message: "請提供所屬社群。" });

  const name = sanitizeString(payload.name, 255);
  if (!name) return response.status(400).json({ message: "請填寫樓宇名稱。" });

  const address = sanitizeString(payload.address, 500) || null;
  const latitude = payload.latitude != null ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null ? Number(payload.serviceScope) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  let connection;
  try {
    connection = await pool.getConnection();

    // 確認社區屬於該租戶
    const [community] = await connection.query(
      "SELECT id FROM access_communities WHERE id = ? AND tenant_id = ?",
      [communityId, request.admin.tenantId]
    );
    if (!community) return response.status(404).json({ message: "社群不存在。" });

    const result = await connection.query(
      `INSERT INTO access_buildings
         (tenant_id, community_id, name, address, latitude, longitude, service_scope, contact_person, contact_phone, contact_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.admin.tenantId, communityId, name, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail]
    );
    response.status(201).json({
      code: 0,
      message: "樓宇已新增。",
      data: {
        id: Number(result.insertId),
        tenantId: request.admin.tenantId,
        communityId,
        name,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
        rooms: [],
        entrances: [],
      }
    });
  } catch (error) {
    console.error("新增樓宇失敗:", error);
    response.status(500).json({ message: "新增樓宇失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-buildings/:id - 編輯樓宇
app.put("/api/access-buildings/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理樓宇。" });
  }

  const buildingId = Number(request.params.id);
  if (!buildingId) return response.status(400).json({ message: "無效的樓宇 ID。" });

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 255);
  if (!name) return response.status(400).json({ message: "請填寫樓宇名稱。" });

  const address = sanitizeString(payload.address, 500) || null;
  const latitude = payload.latitude != null ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null ? Number(payload.serviceScope) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, community_id FROM access_buildings WHERE id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "樓宇不存在。" });

    await connection.query(
      `UPDATE access_buildings
       SET name = ?, address = ?, latitude = ?, longitude = ?, service_scope = ?,
           contact_person = ?, contact_phone = ?, contact_email = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, buildingId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "樓宇已更新。",
      data: {
        id: buildingId,
        tenantId: request.admin.tenantId,
        communityId: Number(existing.community_id),
        name,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
      }
    });
  } catch (error) {
    console.error("編輯樓宇失敗:", error);
    response.status(500).json({ message: "編輯樓宇失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-buildings/:id - 刪除樓宇
app.delete("/api/access-buildings/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理樓宇。" });
  }

  const buildingId = Number(request.params.id);
  if (!buildingId) return response.status(400).json({ message: "無效的樓宇 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, name FROM access_buildings WHERE id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "樓宇不存在。" });

    const [roomCount] = await connection.query(
      "SELECT COUNT(*) AS cnt FROM access_rooms WHERE building_id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );
    const [entranceCount] = await connection.query(
      "SELECT COUNT(*) AS cnt FROM access_entrances WHERE building_id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );

    const rooms = Number(roomCount.cnt) || 0;
    const entrances = Number(entranceCount.cnt) || 0;

    await connection.query(
      "DELETE FROM access_buildings WHERE id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "樓宇已刪除。",
      data: {
        id: buildingId,
        name: existing.name,
        roomsDeleted: rooms,
        entrancesDeleted: entrances,
      }
    });
  } catch (error) {
    console.error("刪除樓宇失敗:", error);
    response.status(500).json({ message: "刪除樓宇失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/sip-users/available - 獲取租戶可用的 SIP 用戶（已啟用且在有效期內）
app.get("/api/sip-users/available", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視 SIP 使用者。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT su.id, su.username, su.sip_domain, su.display_name, su.email,
              su.phone_number, su.status, su.service_expires_at,
              r2.id AS current_room_id,
              wu.username AS web_username
       FROM sip_users su
       LEFT JOIN access_rooms r2 ON r2.sip_user_id = su.id AND r2.tenant_id = su.tenant_id
       LEFT JOIN tenant_web_account_entitlements ent ON ent.sip_user_id = su.id AND ent.tenant_id = su.tenant_id AND ent.status = 'active'
       LEFT JOIN web_users wu ON wu.id = ent.web_user_id
       WHERE su.tenant_id = ?
         AND su.status = 'active'
         AND (su.service_expires_at IS NULL OR su.service_expires_at > NOW())
         AND (r2.id IS NULL OR r2.id = ?)
       ORDER BY su.username`,
      [request.admin.tenantId, Number(request.query.roomId) || 0]
    );
    const list = rows.map(r => ({
      id: Number(r.id),
      username: r.username,
      sipDomain: r.sip_domain,
      displayName: r.display_name || null,
      email: r.email,
      phoneNumber: r.phone_number || null,
      status: r.status,
      serviceExpiresAt: r.service_expires_at,
      currentRoomId: r.current_room_id ? Number(r.current_room_id) : null,
      webAccount: r.web_username || null,
    }));
    response.json({ code: 0, data: { list } });
  } catch (error) {
    console.error("獲取 SIP 使用者失敗:", error);
    response.status(500).json({ message: "獲取 SIP 使用者失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-rooms/:id/assign-sip - 為房間分配或取消 SIP 帳號
app.put("/api/access-rooms/:id/assign-sip", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理房間。" });
  }

  const roomId = Number(request.params.id);
  if (!roomId) return response.status(400).json({ message: "無效的房間 ID。" });

  const sipUserId = request.body.sipUserId != null ? Number(request.body.sipUserId) : null;

  let connection;
  try {
    connection = await pool.getConnection();

    const [room] = await connection.query(
      "SELECT id, room_number, building_id FROM access_rooms WHERE id = ? AND tenant_id = ?",
      [roomId, request.admin.tenantId]
    );
    if (!room) return response.status(404).json({ message: "房間不存在。" });

    if (sipUserId) {
      const [sipUser] = await connection.query(
        "SELECT id, username FROM sip_users WHERE id = ? AND tenant_id = ? AND status = 'active' AND (service_expires_at IS NULL OR service_expires_at > NOW())",
        [sipUserId, request.admin.tenantId]
      );
      if (!sipUser) return response.status(400).json({ message: "SIP 使用者不存在或已停用/過期。" });

      const [web] = await connection.query(
        `SELECT 1 FROM tenant_web_account_entitlements
         WHERE sip_user_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1`,
        [sipUserId, request.admin.tenantId]
      );
      if (!web) return response.status(400).json({ message: "該 SIP 帳號未配置 Web 帳號，無法分配。" });

      const [conflict] = await connection.query(
        "SELECT id, room_number FROM access_rooms WHERE sip_user_id = ? AND tenant_id = ? AND id != ?",
        [sipUserId, request.admin.tenantId, roomId]
      );
      if (conflict) return response.status(409).json({ message: `該 SIP 帳號已被房間「${conflict.room_number}」使用。` });
    }

    await connection.query(
      "UPDATE access_rooms SET sip_user_id = ? WHERE id = ? AND tenant_id = ?",
      [sipUserId, roomId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: sipUserId ? "SIP 帳號已分配。" : "SIP 帳號已取消分配。",
      data: { id: roomId, sipUserId }
    });
  } catch (error) {
    console.error("分配 SIP 帳號失敗:", error);
    response.status(500).json({ message: "操作失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-rooms - 新增房間
app.post("/api/access-rooms", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理房間。" });
  }

  const payload = request.body || {};
  const buildingId = Number(payload.buildingId);
  if (!buildingId) return response.status(400).json({ message: "請提供所屬樓宇。" });

  const roomNumber = sanitizeString(payload.roomNumber, 50);
  if (!roomNumber) return response.status(400).json({ message: "請填寫門牌號碼。" });

  const floor = sanitizeString(payload.floor, 50) || null;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;
  const sipUserId = payload.sipUserId != null ? Number(payload.sipUserId) : null;
  const allowVideoCall = payload.allowVideoCall === true || payload.allowVideoCall === 1 ? 1 : 0;

  let connection;
  try {
    connection = await pool.getConnection();

    const [building] = await connection.query(
      "SELECT id FROM access_buildings WHERE id = ? AND tenant_id = ?",
      [buildingId, request.admin.tenantId]
    );
    if (!building) return response.status(404).json({ message: "樓宇不存在。" });

    if (sipUserId) {
      const [sipUser] = await connection.query(
        "SELECT id FROM sip_users WHERE id = ? AND tenant_id = ?",
        [sipUserId, request.admin.tenantId]
      );
      if (!sipUser) return response.status(400).json({ message: "SIP 使用者不存在。" });
    }

    const [dup] = await connection.query(
      "SELECT id FROM access_rooms WHERE building_id = ? AND tenant_id = ? AND room_number = ?",
      [buildingId, request.admin.tenantId, roomNumber]
    );
    if (dup) return response.status(409).json({ message: `該樓宇下已存在門牌號碼「${roomNumber}」。` });

    const result = await connection.query(
      `INSERT INTO access_rooms
         (tenant_id, building_id, room_number, floor, contact_person, contact_phone, contact_email, sip_user_id, allow_video_call)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [request.admin.tenantId, buildingId, roomNumber, floor, contactPerson, contactPhone, contactEmail, sipUserId, allowVideoCall]
    );
    response.status(201).json({
      code: 0,
      message: "房間已新增。",
      data: {
        id: Number(result.insertId),
        tenantId: request.admin.tenantId,
        buildingId,
        roomNumber,
        floor,
        contactPerson,
        contactPhone,
        contactEmail,
        sipUserId,
        sipName: null,
        sipAccount: null,
        allowVideoCall: allowVideoCall === 1,
      }
    });
  } catch (error) {
    console.error("新增房間失敗:", error);
    response.status(500).json({ message: "新增房間失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-rooms/:id - 編輯房間
app.put("/api/access-rooms/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理房間。" });
  }

  const roomId = Number(request.params.id);
  if (!roomId) return response.status(400).json({ message: "無效的房間 ID。" });

  const payload = request.body || {};
  const roomNumber = sanitizeString(payload.roomNumber, 50);
  if (!roomNumber) return response.status(400).json({ message: "請填寫門牌號碼。" });

  const floor = sanitizeString(payload.floor, 50) || null;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;
  const allowVideoCall = payload.allowVideoCall === true || payload.allowVideoCall === 1 ? 1 : 0;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, building_id FROM access_rooms WHERE id = ? AND tenant_id = ?",
      [roomId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "房間不存在。" });

    const [dup] = await connection.query(
      "SELECT id FROM access_rooms WHERE building_id = ? AND tenant_id = ? AND room_number = ? AND id != ?",
      [existing.building_id, request.admin.tenantId, roomNumber, roomId]
    );
    if (dup) return response.status(409).json({ message: `該樓宇下已存在門牌號碼「${roomNumber}」。` });

    await connection.query(
      `UPDATE access_rooms
       SET room_number = ?, floor = ?, contact_person = ?, contact_phone = ?, contact_email = ?, allow_video_call = ?
       WHERE id = ? AND tenant_id = ?`,
      [roomNumber, floor, contactPerson, contactPhone, contactEmail, allowVideoCall, roomId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "房間已更新。",
      data: {
        id: roomId,
        tenantId: request.admin.tenantId,
        buildingId: Number(existing.building_id),
        roomNumber,
        floor,
        contactPerson,
        contactPhone,
        contactEmail,
        allowVideoCall: allowVideoCall === 1,
      }
    });
  } catch (error) {
    console.error("編輯房間失敗:", error);
    response.status(500).json({ message: "編輯房間失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-rooms/:id - 刪除房間
app.delete("/api/access-rooms/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理房間。" });
  }

  const roomId = Number(request.params.id);
  if (!roomId) return response.status(400).json({ message: "無效的房間 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, room_number FROM access_rooms WHERE id = ? AND tenant_id = ?",
      [roomId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "房間不存在。" });

    await connection.query(
      "DELETE FROM access_rooms WHERE id = ? AND tenant_id = ?",
      [roomId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "房間已刪除。",
      data: { id: roomId, roomNumber: existing.room_number }
    });
  } catch (error) {
    console.error("刪除房間失敗:", error);
    response.status(500).json({ message: "刪除房間失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-entrances - 新增入口
app.post("/api/access-entrances", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 255);
  if (!name) return response.status(400).json({ message: "請填寫入口名稱。" });

  const communityId = payload.communityId != null ? Number(payload.communityId) : null;
  const buildingId = payload.buildingId != null ? Number(payload.buildingId) : null;

  if ((communityId && buildingId) || (!communityId && !buildingId)) {
    return response.status(400).json({ message: "入口必須繫結社群或樓宇（二選一）。" });
  }

  const deviceId = payload.deviceId != null ? Number(payload.deviceId) : null;
  const address = sanitizeString(payload.address, 500) || null;
  const latitude = payload.latitude != null && !isNaN(Number(payload.latitude)) ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null && !isNaN(Number(payload.longitude)) ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null && !isNaN(Number(payload.serviceScope)) ? Math.round(Number(payload.serviceScope)) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  let connection;
  try {
    connection = await pool.getConnection();

    // 检查入口名稱唯一性（同一租戶下）
    const [existingName] = await connection.query(
      "SELECT id FROM access_entrances WHERE tenant_id = ? AND name = ? LIMIT 1",
      [request.admin.tenantId, name]
    );
    if (existingName) return response.status(409).json({ message: "該入口名稱已被佔用，請更換。" });

    if (communityId) {
      const [community] = await connection.query(
        "SELECT id FROM access_communities WHERE id = ? AND tenant_id = ?",
        [communityId, request.admin.tenantId]
      );
      if (!community) return response.status(404).json({ message: "社群不存在。" });
    }

    if (buildingId) {
      const [building] = await connection.query(
        "SELECT id FROM access_buildings WHERE id = ? AND tenant_id = ?",
        [buildingId, request.admin.tenantId]
      );
      if (!building) return response.status(404).json({ message: "樓宇不存在。" });
    }

    if (deviceId) {
      const [device] = await connection.query(
        "SELECT id FROM gate_devices WHERE id = ? AND tenant_id = ?",
        [deviceId, request.admin.tenantId]
      );
      if (!device) return response.status(400).json({ message: "裝置不存在。" });
    }

    const result = await connection.query(
      `INSERT INTO access_entrances
         (tenant_id, community_id, building_id, name, address, latitude, longitude, service_scope, contact_person, contact_phone, contact_email, device_id, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [request.admin.tenantId, communityId, buildingId, name, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, deviceId]
    );
    response.status(201).json({
      code: 0,
      message: "入口已新增。",
      data: {
        id: Number(result.insertId),
        tenantId: request.admin.tenantId,
        communityId,
        buildingId,
        name,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
        deviceId,
        isActive: false,
        device: deviceId ? payload.deviceName || null : null,
        deviceStatus: deviceId ? "offline" : "none",
      }
    });
  } catch (error) {
    console.error("新增入口失敗:", error);
    response.status(500).json({ message: "新增入口失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-entrances/:id - 編輯入口
app.put("/api/access-entrances/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const entranceId = Number(request.params.id);
  if (!entranceId) return response.status(400).json({ message: "無效的入口 ID。" });

  const payload = request.body || {};
  const name = sanitizeString(payload.name, 255);
  if (!name) return response.status(400).json({ message: "請填寫入口名稱。" });

  const address = sanitizeString(payload.address, 500) || null;
  const latitude = payload.latitude != null && !isNaN(Number(payload.latitude)) ? Number(payload.latitude) : null;
  const longitude = payload.longitude != null && !isNaN(Number(payload.longitude)) ? Number(payload.longitude) : null;
  const serviceScope = payload.serviceScope != null && !isNaN(Number(payload.serviceScope)) ? Math.round(Number(payload.serviceScope)) : 0;
  const contactPerson = sanitizeString(payload.contactPerson, 120) || null;
  const contactPhone = sanitizeString(payload.contactPhone, 40) || null;
  const contactEmail = sanitizeString(payload.contactEmail, 255) || null;

  let connection;
  try {
    connection = await pool.getConnection();

    const [entrance] = await connection.query(
      "SELECT id, tenant_id, community_id, building_id FROM access_entrances WHERE id = ? AND tenant_id = ?",
      [entranceId, request.admin.tenantId]
    );
    if (!entrance) return response.status(404).json({ message: "入口不存在。" });

    // 檢查名稱唯一性（排除自身）
    const [existingName] = await connection.query(
      "SELECT id FROM access_entrances WHERE tenant_id = ? AND name = ? AND id != ? LIMIT 1",
      [request.admin.tenantId, name, entranceId]
    );
    if (existingName) return response.status(409).json({ message: "該入口名稱已被佔用，請更換。" });

    await connection.query(
      `UPDATE access_entrances
       SET name = ?, address = ?, latitude = ?, longitude = ?, service_scope = ?,
           contact_person = ?, contact_phone = ?, contact_email = ?
       WHERE id = ? AND tenant_id = ?`,
      [name, address, latitude, longitude, serviceScope, contactPerson, contactPhone, contactEmail, entranceId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: "入口已更新。",
      data: {
        id: entranceId,
        tenantId: request.admin.tenantId,
        communityId: entrance.community_id ? Number(entrance.community_id) : null,
        buildingId: entrance.building_id ? Number(entrance.building_id) : null,
        name,
        address,
        latitude,
        longitude,
        serviceScope,
        contactPerson,
        contactPhone,
        contactEmail,
      }
    });
  } catch (error) {
    console.error("編輯入口失敗:", error);
    response.status(500).json({ message: "編輯入口失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/tenant/gate-devices - 租戶查看可用設備列表
app.get("/api/tenant/gate-devices", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    // Show: unassigned devices + devices assigned to this tenant
    const entranceId = request.query.entranceId ? Number(request.query.entranceId) : 0;
    const allMode = request.query.all === '1';
    let rows;
    if (allMode) {
      // Return ALL devices for this tenant (for stats): unassigned + assigned to this tenant
      rows = await connection.query(
        `SELECT gd.id, gd.device_uuid, gd.relay_id, gd.assignment_status, gd.tenant_id, gd.assigned_at, gd.expires_at
         FROM gate_devices gd
         WHERE gd.assignment_status = 'unassigned'
            OR (gd.assignment_status = 'assigned' AND gd.tenant_id = ?)
         ORDER BY gd.device_uuid`,
        [request.admin.tenantId]
      );
    } else {
      rows = await connection.query(
        `SELECT gd.id, gd.device_uuid, gd.relay_id, gd.assignment_status, gd.tenant_id, gd.assigned_at, gd.expires_at
         FROM gate_devices gd
         WHERE (gd.assignment_status = 'unassigned'
                OR (gd.assignment_status = 'assigned' AND gd.tenant_id = ?)
                OR gd.id = (SELECT ae2.device_id FROM access_entrances ae2 WHERE ae2.id = ?))
           AND NOT EXISTS (SELECT 1 FROM access_entrances ae WHERE ae.device_id = gd.id AND ae.id != ?)
         ORDER BY gd.device_uuid`,
        [request.admin.tenantId, entranceId, entranceId]
      );
    }
    response.json({
      devices: rows.map(r => ({
        id: Number(r.id),
        uuid: r.device_uuid || '',
        relayId: r.relay_id || '',
        status: r.assignment_status || 'unassigned',
        tenantId: r.tenant_id ? Number(r.tenant_id) : null,
        assignedAt: r.assigned_at ? new Date(r.assigned_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-') : '',
        expiresAt: r.expires_at ? new Date(r.expires_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-') : '',
      })),
    });
  } catch (error) {
    console.error("Failed to fetch tenant devices:", error);
    response.status(500).json({ message: "獲取裝置列表失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-entrances/:id/device - 為入口分配或更換設備
app.put("/api/access-entrances/:id/device", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const entranceId = Number(request.params.id);
  if (!entranceId) return response.status(400).json({ message: "無效的入口 ID。" });

  const deviceId = request.body.deviceId != null ? Number(request.body.deviceId) : null;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [entrance] = await connection.query(
      "SELECT id, name, device_id, tenant_id FROM access_entrances WHERE id = ? AND tenant_id = ? FOR UPDATE",
      [entranceId, request.admin.tenantId]
    );
    if (!entrance) {
      await connection.rollback();
      return response.status(404).json({ message: "入口不存在。" });
    }

    // Free the old device if any
    if (entrance.device_id) {
      await connection.query(
        "UPDATE gate_devices SET tenant_id = NULL, assignment_status = 'unassigned', assigned_at = NULL, expires_at = NULL WHERE id = ?",
        [Number(entrance.device_id)]
      );
    }

    // Assign new device if provided
    if (deviceId) {
      const [device] = await connection.query(
        "SELECT id, assignment_status FROM gate_devices WHERE id = ? FOR UPDATE",
        [deviceId]
      );
      if (!device) {
        await connection.rollback();
        return response.status(404).json({ message: "裝置不存在。" });
      }
      // Check if device is already assigned to another entrance
      const [otherEntrance] = await connection.query(
        "SELECT id, name FROM access_entrances WHERE device_id = ? AND id != ?",
        [deviceId, entranceId]
      );
      if (otherEntrance) {
        await connection.rollback();
        return response.status(409).json({ message: `該裝置已繫結入口「${otherEntrance.name}」。` });
      }

      // Calculate expiry from tenant's latest plan expiry
      const [planExpiry] = await connection.query(
        `SELECT MAX(expires_at) AS latest FROM billing_orders
         WHERE tenant_id = ? AND expires_at IS NOT NULL AND expires_at > NOW()`,
        [request.admin.tenantId]
      );
      const expiresAt = planExpiry?.latest || null;

      // Update device status
      await connection.query(
        "UPDATE gate_devices SET tenant_id = ?, assignment_status = 'assigned', assigned_at = NOW(), expires_at = ? WHERE id = ?",
        [request.admin.tenantId, expiresAt, deviceId]
      );
    }

    // Update entrance
    await connection.query(
      deviceId
        ? "UPDATE access_entrances SET device_id = ?, is_active = 1 WHERE id = ?"
        : "UPDATE access_entrances SET device_id = NULL, is_active = 0 WHERE id = ?",
      deviceId ? [deviceId, entranceId] : [entranceId]
    );

    await connection.commit();

    response.json({
      code: 0,
      message: deviceId ? "裝置已繫結。" : "裝置已取消繫結。",
      data: { entranceId, deviceId }
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("繫結裝置失敗:", error);
    response.status(500).json({ message: "操作失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-entrances/:id/toggle - 啟用/停用入口
app.put("/api/access-entrances/:id/toggle", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const entranceId = Number(request.params.id);
  if (!entranceId) return response.status(400).json({ message: "無效的入口 ID。" });

  const isActive = request.body && request.body.isActive ? 1 : 0;

  let connection;
  try {
    connection = await pool.getConnection();

    const [existing] = await connection.query(
      "SELECT id, is_active, device_id FROM access_entrances WHERE id = ? AND tenant_id = ?",
      [entranceId, request.admin.tenantId]
    );
    if (!existing) return response.status(404).json({ message: "入口不存在。" });

    if (isActive && !existing.device_id) {
      return response.status(400).json({ message: "未繫結裝置的入口無法啟用，請先繫結裝置。" });
    }

    await connection.query(
      "UPDATE access_entrances SET is_active = ? WHERE id = ? AND tenant_id = ?",
      [isActive, entranceId, request.admin.tenantId]
    );

    response.json({
      code: 0,
      message: isActive ? "入口已啟用。" : "入口已停用。",
      data: { id: entranceId, isActive: !!isActive }
    });
  } catch (error) {
    console.error("切換入口狀態失敗:", error);
    response.status(500).json({ message: "操作失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-entrances/:id - 刪除入口
app.delete("/api/access-entrances/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform' || !request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理入口。" });
  }

  const entranceId = Number(request.params.id);
  if (!entranceId) return response.status(400).json({ message: "無效的入口 ID。" });

  let connection;
  try {
    connection = await pool.getConnection();

    const [entrance] = await connection.query(
      "SELECT id FROM access_entrances WHERE id = ? AND tenant_id = ?",
      [entranceId, request.admin.tenantId]
    );
    if (!entrance) return response.status(404).json({ message: "入口不存在。" });

    await connection.query(
      "DELETE FROM access_entrances WHERE id = ? AND tenant_id = ?",
      [entranceId, request.admin.tenantId]
    );

    response.json({ code: 0, message: "入口已刪除。" });
  } catch (error) {
    console.error("刪除入口失敗:", error);
    response.status(500).json({ message: "刪除入口失敗，請稍後再試。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/access-entrances/:entranceId/auth/building/:buildingId - 批量授權樓宇全部房間
app.put("/api/access-entrances/:entranceId/auth/building/:buildingId", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const buildingId = Number(request.params.buildingId);
  if (!entranceId || !buildingId) return response.status(400).json({ message: "無效的引數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    // Verify entrance and building belong to tenant
    const [entrance] = await connection.query("SELECT id FROM access_entrances WHERE id = ? AND tenant_id = ?", [entranceId, request.admin.tenantId]);
    if (!entrance) return response.status(404).json({ message: "入口不存在。" });
    const [building] = await connection.query("SELECT id FROM access_buildings WHERE id = ? AND tenant_id = ?", [buildingId, request.admin.tenantId]);
    if (!building) return response.status(404).json({ message: "樓宇不存在。" });

    // Insert auth for all rooms in the building that don't already have it
    await connection.query(
      `INSERT IGNORE INTO access_room_entrance_auth (tenant_id, entrance_id, room_id)
       SELECT ?, ?, r.id FROM access_rooms r WHERE r.building_id = ? AND r.tenant_id = ?`,
      [request.admin.tenantId, entranceId, buildingId, request.admin.tenantId]
    );
    response.json({ code: 0, message: "樓宇全部房間已授權。" });
  } catch (error) {
    console.error("批次授權失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-entrances/:entranceId/auth/building/:buildingId - 批量取消樓宇全部房間授權
app.delete("/api/access-entrances/:entranceId/auth/building/:buildingId", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const buildingId = Number(request.params.buildingId);
  if (!entranceId || !buildingId) return response.status(400).json({ message: "無效的引數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `DELETE FROM access_room_entrance_auth
       WHERE entrance_id = ? AND tenant_id = ?
         AND room_id IN (SELECT id FROM access_rooms WHERE building_id = ? AND tenant_id = ?)`,
      [entranceId, request.admin.tenantId, buildingId, request.admin.tenantId]
    );
    response.json({ code: 0, message: `已取消 ${result.affectedRows} 個房間的授權。` });
  } catch (error) {
    console.error("批次取消授權失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/access-entrances/:entranceId/auth/rooms - 批量授權房間
app.post("/api/access-entrances/:entranceId/auth/rooms", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const roomIds = (request.body?.roomIds || []).map(Number).filter(Boolean);
  if (!entranceId || roomIds.length === 0) return response.status(400).json({ message: "無效的引數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [entrance] = await connection.query("SELECT id FROM access_entrances WHERE id = ? AND tenant_id = ?", [entranceId, request.admin.tenantId]);
    if (!entrance) return response.status(404).json({ message: "入口不存在。" });

    const placeholders = roomIds.map(() => "(?, ?, ?)").join(", ");
    const values = roomIds.flatMap(id => [request.admin.tenantId, entranceId, id]);
    await connection.query(
      `INSERT IGNORE INTO access_room_entrance_auth (tenant_id, entrance_id, room_id) VALUES ${placeholders}`,
      values
    );
    response.json({ code: 0, message: `已授權 ${roomIds.length} 個房間。` });
  } catch (error) {
    console.error("批次授權房間失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-entrances/:entranceId/auth/rooms - 批量取消房間授權
app.delete("/api/access-entrances/:entranceId/auth/rooms", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const roomIds = (request.body?.roomIds || []).map(Number).filter(Boolean);
  if (!entranceId || roomIds.length === 0) return response.status(400).json({ message: "無效的引數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const placeholders = roomIds.map(() => "?").join(", ");
    await connection.query(
      `DELETE FROM access_room_entrance_auth WHERE entrance_id = ? AND tenant_id = ? AND room_id IN (${placeholders})`,
      [entranceId, request.admin.tenantId, ...roomIds]
    );
    response.json({ code: 0, message: `已取消 ${roomIds.length} 個房間的授權。` });
  } catch (error) {
    console.error("批次取消授權失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/access-entrances/:entranceId/auth/:roomId - 取消房間授權
app.delete("/api/access-entrances/:entranceId/auth/:roomId", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以管理授權。" });
  }
  const entranceId = Number(request.params.entranceId);
  const roomId = Number(request.params.roomId);
  if (!entranceId || !roomId) return response.status(400).json({ message: "無效的引數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      "DELETE FROM access_room_entrance_auth WHERE entrance_id = ? AND room_id = ? AND tenant_id = ?",
      [entranceId, roomId, request.admin.tenantId]
    );
    if (result.affectedRows === 0) return response.status(404).json({ message: "授權記錄不存在。" });
    response.json({ code: 0, message: "授權已取消。" });
  } catch (error) {
    console.error("取消授權失敗:", error);
    response.status(500).json({ message: "操作失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/public/visitor/community/:slug - 訪客拜訪頁獲取社區資料
app.get("/api/public/visitor/community/:slug", async (request, response) => {
  const slug = request.params.slug;
  if (!slug) return response.status(400).json({ code: -1, message: "缺少社群引數。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [community] = await connection.query(
      `SELECT id, tenant_id, name, address, slug, service_scope, contact_person, contact_phone, contact_email
       FROM access_communities WHERE slug = ? AND is_active = 1 LIMIT 1`,
      [slug]
    );
    if (!community) return response.status(404).json({ code: -1, message: "社群不存在或已停用。" });

    const buildings = await connection.query(
      `SELECT b.id, b.name, b.address
       FROM access_buildings b WHERE b.community_id = ? AND b.tenant_id = ?
       ORDER BY b.name`,
      [community.id, community.tenant_id]
    );

    const buildingIds = buildings.map(b => b.id);
    let rooms = [];
    if (buildingIds.length > 0) {
      rooms = await connection.query(
        `SELECT r.id, r.building_id, r.room_number, r.floor,
                COALESCE(s.display_name, s.username, '') AS resident_name
         FROM access_rooms r
         LEFT JOIN sip_users s ON s.id = r.sip_user_id
         WHERE r.building_id IN (?) AND r.tenant_id = ?
         ORDER BY r.room_number`,
        [buildingIds, community.tenant_id]
      );
    }

    response.json({
      code: 0,
      data: {
        id: Number(community.id),
        name: community.name,
        address: community.address || null,
        slug: community.slug,
        contactPerson: community.contact_person || null,
        contactPhone: community.contact_phone || null,
        buildings: buildings.map(b => ({
          id: Number(b.id),
          name: b.name,
          address: b.address || null,
        })),
        rooms: rooms.map(r => ({
          id: Number(r.id),
          buildingId: Number(r.building_id),
          roomNumber: r.room_number,
          floor: r.floor || null,
          residentName: r.resident_name || null,
        })),
      }
    });
  } catch (error) {
    console.error("獲取訪客社群資料失敗:", error);
    response.status(500).json({ code: -1, message: "獲取社群資料失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/upload/community-image - 上傳社區圖片（Logo / Banner）
app.post("/api/upload/community-image", requireAdmin, async (request, response) => {
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以上傳圖片。" });
  }

  const imageDir = path.join(projectRoot, "assets/community-images");
  try { await mkdir(imageDir, { recursive: true }); } catch {}

  const chunks = [];
  let boundary = null;
  const ct = request.get("content-type") || "";
  const bm = ct.match(/boundary=(.+)/);
  if (bm) boundary = bm[1];

  if (!boundary) {
    return response.status(400).json({ message: "無效的上傳請求。" });
  }

  request.on("data", chunk => chunks.push(chunk));
  request.on("end", async () => {
    try {
      let filename = `img-${Date.now()}-${Math.random().toString(36).slice(2,6)}.png`;
      const body = Buffer.concat(chunks);
      const str = body.toString("binary");
      const parts = str.split("--" + boundary);
      for (const part of parts) {
        if (!part.includes("filename=")) continue;
        const fnMatch = part.match(/filename="([^"]+)"/);
        if (fnMatch) {
          const ext = path.extname(fnMatch[1]) || ".png";
          filename = `cc-${Date.now()}-${Math.random().toString(36).slice(2,10)}${ext}`;
        }
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd < 0) continue;
        let fileData = part.substring(headerEnd + 4);
        if (fileData.endsWith("\r\n")) fileData = fileData.slice(0, -2);
        const savePath = path.join(imageDir, filename);
        await writeFile(savePath, Buffer.from(fileData, "binary"));
        const url = `/api/community-images/${filename}`;
        return response.json({ code: 0, url });
      }
      return response.status(400).json({ message: "未檢測到上傳文件。" });
    } catch (err) {
      console.error("Upload error:", err);
      return response.status(500).json({ message: "上傳失敗。" });
    }
  });
});

// Serve uploaded community images
app.use("/api/community-images", express.static(path.join(projectRoot, "assets/community-images")));

// POST /api/admin/releases/upload - 上傳 APK 檔案
app.post("/api/admin/releases/upload", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ code: -1, message: "僅平臺管理員可上傳 APK。" });
  }

  const downloadDir = path.join(projectRoot, "public/download");
  try { await mkdir(downloadDir, { recursive: true }); } catch {}

  const chunks = [];
  let boundary = null;
  const ct = request.get("content-type") || "";
  const bm = ct.match(/boundary=(.+)/);
  if (bm) boundary = bm[1];

  if (!boundary) {
    return response.status(400).json({ code: -1, message: "无效的上传请求。" });
  }

  request.on("data", chunk => chunks.push(chunk));
  request.on("end", async () => {
    try {
      let filename = `qrtalkie-v${Date.now()}.apk`;
      const body = Buffer.concat(chunks);
      const str = body.toString("binary");
      const parts = str.split("--" + boundary);
      for (const part of parts) {
        if (!part.includes("filename=")) continue;
        const fnMatch = part.match(/filename="([^"]+)"/);
        if (fnMatch) {
          const ext = path.extname(fnMatch[1]).toLowerCase();
          if (ext !== ".apk") {
            return response.status(400).json({ code: -1, message: "僅支援 .apk 檔案。" });
          }
          // 提取原始版本号作为文件名一部分
          const baseName = path.basename(fnMatch[1], ext).replace(/[^a-zA-Z0-9._-]/g, "_");
          filename = `${baseName}-${Date.now()}.apk`;
        }
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd < 0) continue;
        let fileData = part.substring(headerEnd + 4);
        if (fileData.endsWith("\r\n")) fileData = fileData.slice(0, -2);
        const fileBuffer = Buffer.from(fileData, "binary");
        const savePath = path.join(downloadDir, filename);
        await writeFile(savePath, fileBuffer);
        const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
        const url = `/download/${filename}`;
        return response.json({
          code: 0,
          data: {
            url,
            fullUrl: `https://cloud.qrtalkie.org${url}`,
            filename,
            fileSize: fileBuffer.length,
            sha256,
          },
        });
      }
      return response.status(400).json({ code: -1, message: "未檢測到上傳檔案。" });
    } catch (err) {
      console.error("APK upload error:", err);
      return response.status(500).json({ code: -1, message: "上傳失敗。" });
    }
  });
});


// ==========================================
// Platform Admin Management API (super_admin only)
// ==========================================

// GET /api/platform/admins - list all platform admins
app.get("/api/platform/admins", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超級管理員可以管理平臺管理員。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const admins = await connection.query(
      "SELECT id, email, display_name, phone_number, platform_role, status, last_login_at, created_at FROM admin_users WHERE account_type = 'platform' ORDER BY created_at DESC"
    );
    return response.json({
      admins: admins.map(a => ({
        id: Number(a.id),
        email: a.email || "",
        displayName: a.display_name || "",
        phoneNumber: a.phone_number || "",
        platformRole: a.platform_role || "admin",
        status: a.status || 'active',
        lastLoginAt: a.last_login_at || null,
        createdAt: a.created_at || null,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch platform admins:", error);
    return response.status(500).json({ message: "取得管理員列表失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/platform/admins - create a platform admin
app.post("/api/platform/admins", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超級管理員可以管理平臺管理員。" });
  }
  const email = sanitizeString(request.body?.email, 255);
  const password = String(request.body?.password || "");
  const displayName = sanitizeString(request.body?.displayName, 120);
  const phoneNumber = sanitizeString(request.body?.phoneNumber, 40);
  const platformRole = ["admin","operator","finance","support","auditor"].includes(request.body?.platformRole)
    ? request.body.platformRole : "admin";

  if (!email || !isValidEmail(email)) return response.status(400).json({ message: "請輸入有效的電子郵箱。" });
  if (password.length < 6) return response.status(400).json({ message: "密碼至少需要 6 個字元。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [existing] = await connection.query("SELECT id FROM admin_users WHERE email = ?", [email]);
    if (existing) {
      return response.status(409).json({ message: "該郵箱已被使用。" });
    }
    const passwordHash = await hashPassword(password);
    const result = await connection.query(
      "INSERT INTO admin_users (email, password_hash, display_name, phone_number, account_type, platform_role, status) VALUES (?, ?, ?, ?, 'platform', ?, 'active')",
      [email, passwordHash, displayName || null, phoneNumber || null, platformRole]
    );
    return response.status(201).json({
      message: "平臺管理員已建立。",
      admin: { id: Number(result.insertId), email, displayName, platformRole, status: 'active' },
    });
  } catch (error) {
    console.error("Failed to create platform admin:", error);
    return response.status(500).json({ message: "建立管理員失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/platform/admins/:id - update a platform admin
app.put("/api/platform/admins/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超級管理員可以管理平臺管理員。" });
  }
  const adminId = Number(request.params.id);
  if (!Number.isInteger(adminId) || adminId <= 0) return response.status(400).json({ message: "管理員編號無效。" });

  const email = sanitizeString(request.body?.email, 255);
  const displayName = sanitizeString(request.body?.displayName, 120);
  const phoneNumber = sanitizeString(request.body?.phoneNumber, 40);
  const platformRole = ["admin","operator","finance","support","auditor"].includes(request.body?.platformRole)
    ? request.body.platformRole : null;
  const password = String(request.body?.password || "");

  if (email && !isValidEmail(email)) return response.status(400).json({ message: "請輸入有效的電子郵箱。" });
  if (password && password.length < 6) return response.status(400).json({ message: "密碼至少需要 6 個字元。" });

  let connection;
  try {
    connection = await pool.getConnection();
    const [existing] = await connection.query("SELECT id FROM admin_users WHERE id = ? AND account_type = 'platform'", [adminId]);
    if (!existing) return response.status(404).json({ message: "管理員不存在。" });
    if (existing.platform_role === "super_admin" && adminId !== request.admin.id) {
      return response.status(403).json({ message: "不能修改超級管理員的角色。" });
    }

    let sql = "UPDATE admin_users SET ";
    const params = [];
    const sets = [];
    if (email) { sets.push("email = ?"); params.push(email); }
    if (displayName !== undefined) { sets.push("display_name = ?"); params.push(displayName || null); }
    if (phoneNumber !== undefined) { sets.push("phone_number = ?"); params.push(phoneNumber || null); }
    if (platformRole) { sets.push("platform_role = ?"); params.push(platformRole); }
    if (password) { sets.push("password_hash = ?"); params.push(await hashPassword(password)); }
    if (sets.length === 0) return response.status(400).json({ message: "沒有要更新的欄位。" });
    sql += sets.join(", ") + " WHERE id = ? AND account_type = 'platform'";
    params.push(adminId);
    await connection.query(sql, params);
    return response.json({ message: "管理員資訊已更新。" });
  } catch (error) {
    console.error("Failed to update platform admin:", error);
    return response.status(500).json({ message: "更新管理員失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/platform/admins/:id/status - toggle platform admin status
app.put("/api/platform/admins/:id/status", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超級管理員可以管理平臺管理員。" });
  }
  const adminId = Number(request.params.id);
  if (!Number.isInteger(adminId) || adminId <= 0) return response.status(400).json({ message: "管理員編號無效。" });
  const status = request.body?.status === 'disabled' ? 'disabled' : 'active';

  let connection;
  try {
    connection = await pool.getConnection();
    const [existing] = await connection.query("SELECT id, platform_role FROM admin_users WHERE id = ? AND account_type = 'platform'", [adminId]);
    if (!existing) return response.status(404).json({ message: "管理員不存在。" });
    if (existing.platform_role === "super_admin") {
      return response.status(403).json({ message: "不能停用超級管理員。" });
    }
    await connection.query("UPDATE admin_users SET status = ? WHERE id = ?", [status, adminId]);
    return response.json({ message: status === 'active' ? "管理員已啟用。" : "管理員已停用。" });
  } catch (error) {
    console.error("Failed to toggle platform admin status:", error);
    return response.status(500).json({ message: "狀態切換失敗。" });
  } finally {
    if (connection) connection.release();
  }
});


// DELETE /api/platform/admins/:id - delete a platform admin
app.delete("/api/platform/admins/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有超級管理員可以管理平臺管理員。" });
  }
  const adminId = Number(request.params.id);
  if (!Number.isInteger(adminId) || adminId <= 0) return response.status(400).json({ message: "管理員編號無效。" });
  let connection;
  try {
    connection = await pool.getConnection();
    const [existing] = await connection.query("SELECT id, platform_role FROM admin_users WHERE id = ? AND account_type = 'platform'", [adminId]);
    if (!existing) return response.status(404).json({ message: "管理員不存在。" });
    if (existing.platform_role === "super_admin") return response.status(403).json({ message: "不能刪除超級管理員。" });
    await connection.query("DELETE FROM admin_sessions WHERE admin_user_id = ?", [adminId]);
    await connection.query("DELETE FROM admin_users WHERE id = ?", [adminId]);
    return response.json({ message: "管理員已刪除。" });
  } catch (error) {
    console.error("Failed to delete platform admin:", error);
    return response.status(500).json({ message: "刪除管理員失敗。" });
  } finally {
    if (connection) connection.release();
  }
});
// ==========================================
// Platform Health API (platform admin only)
// ==========================================

function readProcFile(filePath) {
  try { return readFileSync(filePath, "utf8"); } catch { return ""; }
}

function parseCpuUsage() {
  const content = readProcFile("/proc/stat");
  const cpuLine = content.split("\n").find(l => l.startsWith("cpu "));
  if (!cpuLine) return null;
  const fields = cpuLine.trim().split(/\s+/).slice(1).map(Number);
  const idle = fields[3] + (fields[4] || 0);
  const total = fields.reduce((a, b) => a + b, 0);
  return { idle, total };
}

let cpuSnapshot = null;
// Initialize snapshot immediately, then refresh every second
cpuSnapshot = parseCpuUsage();
setInterval(() => { cpuSnapshot = parseCpuUsage(); }, 1000);

function getCpuUsage() {
  const prev = cpuSnapshot;
  if (!prev) return null;
  const curr = parseCpuUsage();
  if (!curr) return null;
  const totalDiff = curr.total - prev.total;
  const idleDiff = curr.idle - prev.idle;
  if (totalDiff <= 0) return null;
  return Math.round((1 - idleDiff / totalDiff) * 100);
}

function getMemoryUsage() {
  const content = readProcFile("/proc/meminfo");
  const get = (key) => { const m = content.match(new RegExp(key + ":\\s+(\\d+)")); return m ? Number(m[1]) : 0; };
  const total = get("MemTotal");
  const available = get("MemAvailable");
  if (!total) return null;
  return Math.round(((total - available) / total) * 100);
}

function getDiskUsage() {
  try {
    // Try df --output=pcent first (GNU), fall back to parsing standard df output
    let out = "";
    try { out = execSync("df / --output=pcent 2>/dev/null | tail -1", { encoding: "utf8", timeout: 3000 }).trim(); }
    catch { out = execSync("df / | tail -1 | awk '{print $5}'", { encoding: "utf8", timeout: 3000, shell: true }).trim(); }
    const pct = parseInt(out.replace(/%/g, ""), 10);
    return isNaN(pct) ? null : pct;
  } catch { return null; }
}

function getUptime() {
  const content = readProcFile("/proc/uptime");
  const seconds = parseFloat(content.split(/\s+/)[0]);
  if (isNaN(seconds)) return null;
  const days = Math.floor(seconds / 86400);
  return { seconds, days, text: days > 0 ? days + " 天" : Math.floor(seconds / 3600) + " 小時" };
}

function getLoadAvg() {
  const content = readProcFile("/proc/loadavg");
  const fields = content.trim().split(/\s+/);
  return { load1: parseFloat(fields[0]) || 0, load5: parseFloat(fields[1]) || 0, load15: parseFloat(fields[2]) || 0 };
}

app.get("/api/platform/health", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視平臺健康狀態。" });
  }
  try {
    const cpu = getCpuUsage();
    const memory = getMemoryUsage();
    const disk = getDiskUsage();
    const uptime = getUptime();
    const load = getLoadAvg();

    let dbStatus = "error";
    try {
      const conn = await pool.getConnection();
      await conn.query("SELECT 1");
      conn.release();
      dbStatus = "running";
    } catch { dbStatus = "error"; }

    let mongoStatus = "error";
    try {
      const { execSync } = await import("node:child_process");
      const out = execSync("systemctl is-active mongod 2>/dev/null || echo inactive", { encoding: "utf8", timeout: 3000 }).trim();
      mongoStatus = out === "active" ? "running" : "stopped";
    } catch { mongoStatus = "not_installed"; }

    let asteriskStatus = "error";
    try {
      const out = execSync("systemctl is-active asterisk 2>/dev/null || echo inactive", { encoding: "utf8", timeout: 3000 }).trim();
      asteriskStatus = out === "active" ? "running" : "stopped";
    } catch { asteriskStatus = "not_installed"; }

    let flexisipStatus = "error";
    try {
      const { execSync } = await import("node:child_process");
      const services = ["flexisip-proxy", "flexisip-presence", "flexisip-conference", "flexisip-regevent"];
      let running = 0;
      for (const svc of services) {
        const out = execSync(`systemctl is-active ${svc} 2>/dev/null || echo inactive`, { encoding: "utf8", timeout: 3000 }).trim();
        if (out === "active") running++;
      }
      flexisipStatus = running === 4 ? "running" : running > 0 ? "partial" : "stopped";
    } catch { flexisipStatus = "not_installed"; }

    let redisStatus = "error";
    try {
      const out = execSync("systemctl is-active redis-server 2>/dev/null || systemctl is-active redis 2>/dev/null || echo inactive", { encoding: "utf8", timeout: 3000 }).trim();
      redisStatus = out === "active" ? "running" : "stopped";
    } catch { redisStatus = "not_installed"; }

    let coturnStatus = "error";
    try {
      const out = execSync("systemctl is-active coturn 2>/dev/null || echo inactive", { encoding: "utf8", timeout: 3000 }).trim();
      coturnStatus = out === "active" ? "running" : "stopped";
    } catch { coturnStatus = "not_installed"; }

    let mqttStatus = "error";
    try {
      const out = execSync("systemctl is-active mosquitto 2>/dev/null || echo inactive", { encoding: "utf8", timeout: 3000 }).trim();
      mqttStatus = out === "active" ? "running" : "stopped";
    } catch { mqttStatus = "not_installed"; }

    let aiServiceStatus = "error";
    try {
      const out = execSync("docker compose -p " + aiComposeProject + " ps --format json 2>/dev/null || echo ''", { encoding: "utf8", timeout: 5000 }).trim();
      if (out) {
        const containers = JSON.parse(out.startsWith("[") ? out : "[" + out.split("\n").filter(Boolean).join(",") + "]");
        const adminUi = Array.isArray(containers) ? containers.find(c => c.Name && c.Name.includes("admin_ui")) : null;
        aiServiceStatus = adminUi && adminUi.State === "running" ? "running" : adminUi ? "stopped" : "not_found";
      } else {
        aiServiceStatus = "not_installed";
      }
    } catch { aiServiceStatus = "not_installed"; }

    let limeStatus = "error";
    try {
      const confExists = execSync("test -f " + limeApacheConf + " && echo yes || echo no", { encoding: "utf8", timeout: 3000 }).trim();
      if (confExists === "yes") {
        const apacheRunning = execSync("systemctl is-active apache2 2>/dev/null || echo inactive", { encoding: "utf8", timeout: 3000 }).trim();
        if (apacheRunning === "active") {
          const limeResp = execSync("curl -s -o /dev/null -w '%{http_code}' --max-time 5 -k -X POST -H 'From: sip:test@" + sipDomain + ";gr=test' -H 'Content-Type: application/x-lime+xml' -d '<request><getKeys/></request>' https://" + healthInternalHost + "/lime-server.php -H 'Host: " + limeDomain + "' 2>/dev/null", { encoding: "utf8", timeout: 8000 }).trim();
          limeStatus = limeResp === "401" ? "running" : "error";
        } else {
          limeStatus = "stopped";
        }
      } else {
        limeStatus = "not_installed";
      }
    } catch { limeStatus = "not_installed"; }

    let ftsStatus = "error";
    try {
      const confExists = execSync("test -f " + ftsApacheConf + " && echo yes || echo no", { encoding: "utf8", timeout: 3000 }).trim();
      if (confExists === "yes") {
        const apacheRunning = execSync("systemctl is-active apache2 2>/dev/null || echo inactive", { encoding: "utf8", timeout: 3000 }).trim();
        if (apacheRunning === "active") {
          const ftsResp = execSync("curl -s -o /dev/null -w '%{http_code}' --max-time 5 -k https://" + healthInternalHost + "/flexisip-http-file-transfer-server/hft.php -H 'Host: " + ftsDomain + "' 2>/dev/null", { encoding: "utf8", timeout: 8000 }).trim();
          ftsStatus = ftsResp === "200" || ftsResp === "401" ? "running" : "error";
        } else {
          ftsStatus = "stopped";
        }
      } else {
        ftsStatus = "not_installed";
      }
    } catch { ftsStatus = "not_installed"; }

    let accountManagerStatus = "error";
    try {
      const apacheRunning = execSync("systemctl is-active apache2 2>/dev/null || echo inactive", { encoding: "utf8", timeout: 3000 }).trim();
      if (apacheRunning === "active") {
        const resp = execSync("curl -s -o /dev/null -w '%{http_code}' --max-time 5 -k https://" + healthInternalHost + "/ -H 'Host: " + accountDomain + "' 2>/dev/null", { encoding: "utf8", timeout: 8000 }).trim();
        accountManagerStatus = (resp === "200" || resp === "401" || resp === "302") ? "running" : "not_installed";
      } else {
        accountManagerStatus = "stopped";
      }
    } catch { accountManagerStatus = "not_installed"; }

    let sslExpiry = null;
    try {
      const sslDomain = process.env.SSL_CHECK_DOMAIN || "www.qrtalkie.org";
      const out = execSync(`openssl s_client -servername ${sslDomain} -connect ${healthInternalHost}:${healthSslPort} </dev/null 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null`, { encoding: "utf8", timeout: 8000 }).trim();
      const match = out.match(/notAfter=(.+)/);
      if (match) {
        const expDate = new Date(match[1]);
        const daysLeft = Math.ceil((expDate - new Date()) / 86400000);
        sslExpiry = { date: expDate.toISOString().slice(0, 10), daysLeft, domain: sslDomain };
      }
    } catch { sslExpiry = null; }

    return response.json({
      cpu: { usage: cpu, loadAvg: load.load5 },
      memory: { usage: memory },
      disk: { usage: disk },
      uptime: uptime,
      load: load,
      mariadb: dbStatus,
      mongodb: mongoStatus,
      asterisk: asteriskStatus,
      flexisip: flexisipStatus,
      redis: redisStatus,
      coturn: coturnStatus,
      mqtt: mqttStatus,
      aiservice: aiServiceStatus,
      lime: limeStatus,
      fts: ftsStatus,
      accountManager: accountManagerStatus,
      ssl: sslExpiry,
    });
  } catch (error) {
    console.error("Failed to read system health:", error);
    return response.status(500).json({ message: "讀取平臺健康狀態失敗。" });
  }
});

// POST /api/platform/health/restart-ai - restart Web AI Docker service
app.post("/api/platform/health/restart-ai", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以重啟服務。" });
  }
  try {
    const { execSync } = await import("node:child_process");
    execSync("docker compose -p " + aiComposeProject + " restart admin_ui 2>&1", { encoding: "utf8", timeout: 15000 });
    return response.json({ message: "Web AI 服務已重啟。" });
  } catch (error) {
    console.error("Failed to restart AI service:", error);
    return response.status(500).json({ message: "重啟 Web AI 服務失敗：" + (error.message || "") });
  }
});



// POST /api/platform/health/clean-logs - clean Asterisk and Flexisip logs safely
app.post("/api/platform/health/clean-logs", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以清理日誌。" });
  }
  try {
    const { execSync } = await import("node:child_process");
    const results = { deleted: [], truncated: [], freedMB: 0 };

    // Clean Asterisk logs
    const asteriskDir = asteriskLogDir;
    try {
      execSync("find " + asteriskDir + " -type f \\( -name '*.gz' -o -name 'backup-*.log' -o -name '*.log.1' -o -name '*_log.1' -o -name 'queue_log.1' -o -name 'fwjobs.log' -o -name 'core-*.log.1' \\) -delete", { timeout: 5000 });
      // Truncate all full.* rotated logs and common error logs
      execSync("find " + asteriskDir + " -type f \\( -name 'full' -o -name 'full.*' -o -name 'ucp_err.log' -o -name 'ucp_out.log' \\) -exec truncate -s 0 {} \\;", { timeout: 5000 });
      results.freedMB = Math.round(Number(execSync("du -sm " + asteriskDir + " 2>/dev/null | cut -f1", { encoding: "utf8", timeout: 3000 }).trim() || 0));
    } catch {}

    // Clean Flexisip logs
    const flexisipDir = flexisipLogDir;
    try {
      execSync("find " + flexisipDir + " -type f -name '*.log.*.gz' -delete", { timeout: 5000 });
      const patterns = ["flexisip-proxy.log", "flexisip-presence.log", "flexisip-conference.log", "flexisip-regevent.log", "flexisip-b2bua.log"];
      for (const p of patterns) {
        try { execSync("truncate -s 0 " + flexisipDir + "/" + p, { timeout: 3000 }); results.truncated.push(p); } catch {}
      }
    } catch {}

    // Clean system logs
    const systemLogDir = "/var/log";
    try {
      // Delete all rotated .gz archives across system logs
      execSync("find " + systemLogDir + " -type f -name '*.gz' -delete", { timeout: 15000 });
      // Truncate huge raw logs
      const truncLogs = [
        "fail2ban.log", "fail2ban.log.1",
        "syslog", "syslog.1",
        "auth.log", "auth.log.1",
        "kern.log", "kern.log.1",
        "ufw.log", "ufw.log.1",
        "mail.log", "mail.log.1",
        "btmp", "btmp.1",
        "dpkg.log", "dpkg.log.1",
        "alternatives.log", "alternatives.log.1",
      ];
      for (const f of truncLogs) {
        try { execSync("truncate -s 0 " + systemLogDir + "/" + f, { timeout: 3000 }); results.truncated.push(f); } catch {}
      }
      // Clean service subdirectories
      for (const dir of ["apache2", "mosquitto", "coturn", "redis", "mongodb"]) {
        try { execSync("find " + systemLogDir + "/" + dir + " -type f -name '*.log*' -exec truncate -s 0 {} \\;", { timeout: 5000 }); } catch {}
      }
    } catch {}

    return response.json({ message: "日誌清理完成。當前日誌已清空，歸檔檔案已刪除。", ...results });
  } catch (error) {
    console.error("Failed to clean logs:", error);
    return response.status(500).json({ message: "清理日誌失敗：" + (error.message || "") });
  }
});

// POST /api/pbx/webrtc-accounts - phase-1 standalone FreePBX/Incredible PBX basic PJSIP account test.
async function resolveWebrtcAccountQuery(extension) {
  const matched = await freepbxFetchExtension(extension);
  if (!matched) {
    return {
      exists: false,
      source: "freepbx",
      summary: null,
    };
  }

  return {
    exists: true,
    source: "freepbx",
    summary: {
      extension: String(matched.extension || matched.extensionId || extension),
      name: String(matched.name || matched.user?.name || ""),
      tech: String(matched.tech || ""),
    },
  };
}

async function handleWebrtcAccountQuery(request, response) {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({
      success: false,
      message: "只有平臺管理員可以查詢 WebRTC 帳號。",
      error: {
        code: "WEBRTC_ACCOUNT_QUERY_FAILED",
        message: "只有平臺管理員可以查詢 WebRTC 帳號。",
      },
    });
  }

  const extension = String(request.params?.extension || request.query?.extension || "").trim();
  if (!/^\d+$/.test(extension)) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號格式不正確",
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
  }

  try {
    const result = await resolveWebrtcAccountQuery(extension);
    if (result.exists) {
      return response.json({
        success: true,
        message: "WebRTC 帳號已存在",
        data: {
          extension,
          exists: true,
          source: result.source,
          summary: result.summary,
        },
      });
    }

    return response.json({
      success: true,
      message: "WebRTC 帳號不存在，可以建立",
      data: {
        extension,
        exists: false,
        source: result.source,
        summary: null,
      },
    });
  } catch (error) {
    const isFreepbxError = error instanceof FreepbxApiError;
    return response.status(500).json({
      success: false,
      message: isFreepbxError ? (error?.message || "WebRTC 帳號查詢失敗") : "WebRTC 帳號查詢失敗",
      error: {
        code: isFreepbxError ? (error?.code || "FREEPBX_EXTENSION_QUERY_FAILED") : "FREEPBX_EXTENSION_QUERY_FAILED",
        message: isFreepbxError ? (error?.message || "WebRTC 帳號查詢失敗") : "WebRTC 帳號查詢失敗",
      },
    });
  }
}

function parseWebrtcStatusExtensions(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildWebrtcStatusResponseItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    extension: String(item?.extension || ""),
    exists: Boolean(item?.exists),
    status: item?.status || "unknown",
    statusText: item?.statusText || "狀態未知",
    tech: item?.tech || "PJSIP",
    resource: item?.resource || String(item?.extension || ""),
    channelCount: Number.isFinite(Number(item?.channelCount)) ? Number(item?.channelCount) : 0,
    transport: item?.transport || "",
    contactStatus: item?.contactStatus || "",
    aor: item?.aor || String(item?.extension || ""),
    auth: item?.auth || `${String(item?.extension || "")}-auth`,
    lastSeen: item?.lastSeen ?? null,
    rttMs: item?.rttMs ?? null,
    source: item?.source || "asterisk",
  }));
}

async function handleWebrtcAccountStatusQuery(request, response) {
  const isPlatform = request.admin.accountType === "platform";
  const tenantId = request.admin.tenantId;

  if (!isPlatform && !tenantId) {
    return response.status(403).json({
      success: false,
      message: "無許可權查詢 WebRTC 帳號狀態。",
    });
  }

  const rawFromPath = String(request.params?.extension || "").trim();
  const rawFromQuery = String(request.query?.extensions || request.query?.extension || "").trim();
  const rawValue = rawFromPath || rawFromQuery;
  let extensions = rawFromPath ? [rawFromPath] : parseWebrtcStatusExtensions(rawValue);

  if (!extensions.length) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號格式不正確",
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
  }

  if (extensions.length > 100) {
    return response.status(400).json({
      success: false,
      message: "查詢帳號數量過多",
      error: {
        code: "TOO_MANY_EXTENSIONS",
        message: "查詢帳號數量不得超過 100 筆",
      },
    });
  }

  if (extensions.some((extension) => !/^\d+$/.test(extension))) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號格式不正確",
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
  }

  // Tenant admin: filter extensions to only those belonging to their tenant
  if (!isPlatform && tenantId) {
    const dbConn = await pool.getConnection();
    try {
      const tenantExts = await dbConn.query(
        `SELECT u.username FROM web_users u WHERE u.username IN (${extensions.map(() => '?').join(',')}) AND u.tenant_id = ?`,
        [...extensions, tenantId]
      );
      const allowed = new Set(tenantExts.map(r => r.username));
      extensions = extensions.filter(e => allowed.has(e));
    } finally { dbConn.release(); }
  }

  try {
    const batch = await getPjsipEndpointStatusBatch(extensions);
    const items = buildWebrtcStatusResponseItems(batch.items);
    return response.json({
      success: true,
      message: "WebRTC 帳號狀態已取得",
      data: {
        count: items.length,
        items,
      },
    });
  } catch (error) {
    return response.status(500).json({
      success: false,
      message: "WebRTC 帳號狀態查詢失敗",
      error: {
        code: "WEBRTC_ACCOUNT_STATUS_QUERY_FAILED",
        message: "WebRTC 帳號狀態查詢失敗",
      },
    });
  }
}

async function handleWebrtcAccountPresenceQuery(request, response) {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({
      success: false,
      message: "只有平臺管理員可以查詢 WebRTC 線上狀態。",
      error: {
        code: "WEBRTC_PRESENCE_QUERY_FAILED",
        message: "只有平臺管理員可以查詢 WebRTC 線上狀態。",
      },
    });
  }

  const extension = String(request.params?.extension || request.query?.extension || "").trim();
  if (!/^\d+$/.test(extension)) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號格式不正確",
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
  }

  try {
    const presence = await getWebrtcPresence(extension);
    return response.json({
      success: true,
      message: "WebRTC 線上狀態已取得",
      data: presence,
    });
  } catch (error) {
    const missingTable = /webrtc_account_presence_/i.test(String(error?.message || error?.sqlMessage || ""));
    return response.status(missingTable ? 503 : 500).json({
      success: false,
      message: "WebRTC 線上狀態查詢失敗",
      error: {
        code: missingTable ? "WEBRTC_PRESENCE_TABLE_MISSING" : "WEBRTC_PRESENCE_QUERY_FAILED",
        message: "WebRTC 線上狀態查詢失敗",
      },
    });
  }
}

async function handleWebrtcAccountPresenceBatchQuery(request, response) {
  const isPlatform = request.admin.accountType === "platform";
  const tenantId = request.admin.tenantId;
  if (!isPlatform && !tenantId) {
    return response.status(403).json({ success: false, message: "無許可權查詢線上狀態。" });
  }
  const raw = String(request.query?.extensions || "").trim();
  let extensions = raw ? raw.split(",").map(e => e.trim()).filter(Boolean) : [];
  if (!extensions.length || extensions.length > 100) {
    return response.status(400).json({ success: false, message: "請提供 1-100 個分機號。" });
  }
  // Tenant admin: filter to only their tenant's extensions
  if (!isPlatform && tenantId) {
    const dbConn = await pool.getConnection();
    try {
      const placeholders = extensions.map(() => '?').join(',');
      const rows = await dbConn.query(
        `SELECT username FROM web_users WHERE username IN (${placeholders}) AND tenant_id = ?`,
        [...extensions, tenantId]
      );
      const allowed = new Set(rows.map(r => r.username));
      extensions = extensions.filter(e => allowed.has(e));
    } finally { dbConn.release(); }
  }
  if (!extensions.length) return response.json({ success: true, data: { items: [] } });
  try {
    const result = await getWebrtcPresenceBatch(extensions);
    return response.json({ success: true, data: result });
  } catch (error) {
    return response.status(500).json({ success: false, message: "批次線上狀態查詢失敗" });
  }
}

function isValidDateOnly(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime());
}

async function handleWebrtcAccountCallLogsQuery(request, response) {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({
      success: false,
      message: "只有平臺管理員可以查詢 WebRTC 呼叫日誌。",
      error: {
        code: "WEBRTC_CALL_LOG_QUERY_FAILED",
        message: "只有平臺管理員可以查詢 WebRTC 呼叫日誌。",
      },
    });
  }

  const extension = String(request.params?.extension || request.query?.extension || "").trim();
  if (!/^\d+$/.test(extension)) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號格式不正確",
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
  }

  const dateFrom = String(request.query?.dateFrom || request.query?.from || "").trim();
  const dateTo = String(request.query?.dateTo || request.query?.to || "").trim();
  if (!isValidDateOnly(dateFrom) || !isValidDateOnly(dateTo)) {
    return response.status(400).json({
      success: false,
      message: "日期格式不正確",
      error: {
        code: "INVALID_CALL_LOG_DATE",
        message: "日期格式必須為 YYYY-MM-DD",
      },
    });
  }

  try {
    const result = await queryCelCallLogs({
      extension,
      dateFrom,
      dateTo,
      source: request.query?.source,
      destination: request.query?.destination,
      eventType: request.query?.eventType,
      application: request.query?.application,
      linkedId: request.query?.linkedId,
      limit: request.query?.limit,
      offset: request.query?.offset,
      order: request.query?.order,
    });

    return response.json({
      success: true,
      message: "WebRTC 呼叫日誌已取得",
      data: {
        extension,
        source: "freepbx_cel",
        ...result,
      },
    });
  } catch (error) {
    const isConfigError = error instanceof CelCallLogError && error.code === "CEL_DB_CONFIG_MISSING";
    return response.status(isConfigError ? 503 : 500).json({
      success: false,
      message: "WebRTC 呼叫日誌查詢失敗",
      error: {
        code: error instanceof CelCallLogError ? error.code : "WEBRTC_CALL_LOG_QUERY_FAILED",
        message: "WebRTC 呼叫日誌查詢失敗",
      },
    });
  }
}

function sanitizeOverlayFields(fields = {}) {
  const allowed = ["allow_unauthenticated_options", "rtp_timeout", "rtp_timeout_hold", "asymmetric_rtp_codec"];
  const result = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      result[key] = String(fields[key]);
    }
  }
  return result;
}

async function handleWebrtcAccountConfigQuery(request, response) {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({
      success: false,
      message: "只有平臺管理員可以查詢 WebRTC 帳號配置。",
      error: {
        code: "WEBRTC_ACCOUNT_CONFIG_QUERY_FAILED",
        message: "只有平臺管理員可以查詢 WebRTC 帳號配置。",
      },
    });
  }

  const extension = String(request.params?.extension || "").trim();
  if (!/^\d+$/.test(extension)) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號格式不正確",
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
  }

  try {
    const freepbx = await freepbxFetchExtension(extension);
    if (!freepbx) {
      return response.status(404).json({
        success: false,
        message: "WebRTC 帳號不存在",
        error: {
          code: "WEBRTC_ACCOUNT_NOT_FOUND",
          message: "WebRTC 帳號不存在",
        },
      });
    }

    const runtime = await getPjsipEndpointConfig(extension);
    const overlay = await readEndpointCustomPostOverlay(extension).catch(() => ({
      file: ASTERISK_PATHS.endpointCustomPostConf,
      exists: false,
      fields: {},
    }));

    return response.json({
      success: true,
      message: "WebRTC 帳號配置已取得",
      data: {
        extension,
        exists: true,
        source: {
          freepbx: true,
          asteriskRuntime: Boolean(runtime?.rawAvailable),
          endpointCustomPostOverlay: Boolean(overlay?.exists),
        },
        freepbx: {
          extension: String(freepbx.extension || freepbx.extensionId || extension),
          name: String(freepbx.name || ""),
          tech: String(freepbx.tech || ""),
          email: String(freepbx.email || ""),
        },
        runtime: {
          endpointExists: Boolean(runtime?.endpointExists),
          authExists: Boolean(runtime?.authExists),
          aorExists: Boolean(runtime?.aorExists),
          transport: runtime?.transport || "",
          allow: runtime?.allow || "",
          context: runtime?.context || "",
          callerid: runtime?.callerid || "",
          media_address: runtime?.media_address || "",
          direct_media: Boolean(runtime?.direct_media),
          webrtc: Boolean(runtime?.webrtc),
          use_avpf: Boolean(runtime?.use_avpf),
          ice_support: Boolean(runtime?.ice_support),
          rtcp_mux: Boolean(runtime?.rtcp_mux),
          bundle: Boolean(runtime?.bundle),
          media_encryption: runtime?.media_encryption || "",
          media_encryption_optimistic: Boolean(runtime?.media_encryption_optimistic),
          media_use_received_transport: Boolean(runtime?.media_use_received_transport),
          dtls_auto_generate_cert: runtime?.dtls_auto_generate_cert || "",
          dtls_setup: runtime?.dtls_setup || "",
          dtls_verify: runtime?.dtls_verify || "",
          send_pai: Boolean(runtime?.send_pai),
          allow_unauthenticated_options: Boolean(runtime?.allow_unauthenticated_options),
          rtp_timeout: Number(runtime?.rtp_timeout ?? 0),
          rtp_timeout_hold: Number(runtime?.rtp_timeout_hold ?? 0),
          asymmetric_rtp_codec: Boolean(runtime?.asymmetric_rtp_codec),
        },
        overlay: {
          file: overlay?.file || ASTERISK_PATHS.endpointCustomPostConf,
          exists: Boolean(overlay?.exists),
          fields: sanitizeOverlayFields(overlay?.fields || {}),
        },
        warnings: [],
      },
    });
  } catch (error) {
    return response.status(500).json({
      success: false,
      message: "WebRTC 帳號配置查詢失敗",
      error: {
        code: error?.code === "ASTERISK_RUNTIME_QUERY_FAILED"
          ? "ASTERISK_RUNTIME_QUERY_FAILED"
          : "WEBRTC_ACCOUNT_CONFIG_QUERY_FAILED",
        message: "WebRTC 帳號配置查詢失敗",
      },
    });
  }
}

function isAsteriskNotFoundError(error) {
  const text = String(error?.output || error?.message || "");
  return /unable to find object|endpoint not found|no such endpoint|not found|does not exist/i.test(text);
}

function buildNotFoundPjsipConfig(extension) {
  return {
    endpointExists: false,
    authExists: false,
    aorExists: false,
    status: "not_found",
    statusText: "帳號不存在",
    tech: "PJSIP",
    resource: String(extension),
    channelCount: 0,
    transport: "",
    contactStatus: "",
    aor: String(extension),
    auth: `${extension}-auth`,
    lastSeen: null,
    rttMs: null,
    context: "",
    callerid: "",
    webrtc: false,
    use_avpf: false,
    ice_support: false,
    rtcp_mux: false,
    bundle: false,
    media_encryption: "",
    media_encryption_optimistic: false,
    media_use_received_transport: false,
    direct_media: false,
    timers: "",
    media_address: "",
    allow: "",
    dtls_auto_generate_cert: "",
    dtls_setup: "",
    dtls_verify: "",
    send_pai: false,
    allow_unauthenticated_options: false,
    rtp_timeout: 0,
    rtp_timeout_hold: 0,
    asymmetric_rtp_codec: false,
    rawAvailable: false,
  };
}

async function handleWebrtcAccountConsistencyQuery(request, response) {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({
      success: false,
      message: "只有平臺管理員可以查詢 WebRTC 帳號一致性。",
      error: {
        code: "WEBRTC_ACCOUNT_CONSISTENCY_QUERY_FAILED",
        message: "只有平臺管理員可以查詢 WebRTC 帳號一致性。",
      },
    });
  }

  const extension = String(request.params?.extension || request.query?.extension || "").trim();
  if (!/^\d+$/.test(extension)) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號格式不正確",
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
  }

  try {
    const [freepbx, status] = await Promise.all([
      freepbxFetchExtension(extension),
      getPjsipEndpointStatus(extension),
    ]);

    let config;
    try {
      config = await getPjsipEndpointConfig(extension);
    } catch (error) {
      if (!isAsteriskNotFoundError(error)) throw error;
      config = buildNotFoundPjsipConfig(extension);
    }

    const overlay = await readEndpointCustomPostOverlay(extension).catch(() => ({
      file: ASTERISK_PATHS.endpointCustomPostConf,
      exists: false,
      fields: {},
    }));
    const runtimeOverlayExpected = getWebrtcRuntimeConfig().endpointCustomPostOverlay || {};
    const overlayFields = sanitizeOverlayFields(overlay?.fields || {});
    const overlayMatchesExpected = !Object.keys(runtimeOverlayExpected).length || Object.entries(runtimeOverlayExpected).every(([key, expectedValue]) => {
      const actualValue = String(overlayFields[key] ?? "");
      return actualValue.trim().toLowerCase() === String(expectedValue ?? "").trim().toLowerCase();
    });

    const freepbxExists = Boolean(freepbx);
    const statusExists = Boolean(status?.exists);
    const configExists = Boolean(config?.endpointExists || config?.authExists || config?.aorExists);
    const existsConsistent = freepbxExists === statusExists && freepbxExists === configExists;
    const runtimeConsistent = configExists
      ? Boolean(config?.endpointExists && config?.authExists && config?.aorExists)
      : !statusExists && !freepbxExists;
    const overlayConsistent = !Object.keys(runtimeOverlayExpected).length || (overlay?.exists && overlayMatchesExpected);
    const overallConsistent = existsConsistent && runtimeConsistent && overlayConsistent;

    return response.json({
      success: true,
      message: "WebRTC 帳號一致性已取得",
      data: {
        extension,
        exists: freepbxExists && statusExists && configExists,
        overallConsistent,
        checks: {
          existsConsistent,
          runtimeConsistent,
          overlayConsistent,
        },
        freepbx: freepbx
          ? {
              exists: true,
              extension: String(freepbx.extension || freepbx.extensionId || extension),
              name: String(freepbx.name || ""),
              tech: String(freepbx.tech || ""),
              email: String(freepbx.email || ""),
            }
          : {
              exists: false,
              extension,
              name: "",
              tech: "",
              email: "",
            },
        status: {
          extension: String(status?.extension || extension),
          exists: Boolean(status?.exists),
          status: status?.status || "unknown",
          statusText: status?.statusText || "狀態未知",
          tech: status?.tech || "PJSIP",
          resource: status?.resource || extension,
          channelCount: Number.isFinite(Number(status?.channelCount)) ? Number(status?.channelCount) : 0,
          transport: status?.transport || "",
          contactStatus: status?.contactStatus || "",
          aor: status?.aor || extension,
          auth: status?.auth || `${extension}-auth`,
          lastSeen: status?.lastSeen ?? null,
          rttMs: status?.rttMs ?? null,
          source: status?.source || "asterisk",
        },
        config: {
          exists: configExists,
          source: {
            freepbx: Boolean(freepbxExists),
            asteriskRuntime: Boolean(config?.rawAvailable),
            endpointCustomPostOverlay: Boolean(overlay?.exists),
          },
          runtime: {
            endpointExists: Boolean(config?.endpointExists),
            authExists: Boolean(config?.authExists),
            aorExists: Boolean(config?.aorExists),
            transport: config?.transport || "",
            allow: config?.allow || "",
            context: config?.context || "",
            callerid: config?.callerid || "",
            media_address: config?.media_address || "",
            direct_media: Boolean(config?.direct_media),
            webrtc: Boolean(config?.webrtc),
            use_avpf: Boolean(config?.use_avpf),
            ice_support: Boolean(config?.ice_support),
            rtcp_mux: Boolean(config?.rtcp_mux),
            bundle: Boolean(config?.bundle),
            media_encryption: config?.media_encryption || "",
            media_encryption_optimistic: Boolean(config?.media_encryption_optimistic),
            media_use_received_transport: Boolean(config?.media_use_received_transport),
            dtls_auto_generate_cert: config?.dtls_auto_generate_cert || "",
            dtls_setup: config?.dtls_setup || "",
            dtls_verify: config?.dtls_verify || "",
            send_pai: Boolean(config?.send_pai),
            allow_unauthenticated_options: Boolean(config?.allow_unauthenticated_options),
            rtp_timeout: Number(config?.rtp_timeout ?? 0),
            rtp_timeout_hold: Number(config?.rtp_timeout_hold ?? 0),
            asymmetric_rtp_codec: Boolean(config?.asymmetric_rtp_codec),
          },
          overlay: {
            file: overlay?.file || ASTERISK_PATHS.endpointCustomPostConf,
            exists: Boolean(overlay?.exists),
            fields: overlayFields,
          },
        },
        warnings: [
          ...(!overlay?.exists && Object.keys(runtimeOverlayExpected).length ? ["overlay_missing"] : []),
          ...(overlay?.exists && !overlayMatchesExpected ? ["overlay_fields_mismatch"] : []),
        ],
      },
    });
  } catch (error) {
    const isFreepbxError = error instanceof FreepbxApiError;
    return response.status(500).json({
      success: false,
      message: "WebRTC 帳號一致性查詢失敗",
      error: {
        code: error?.code === "ASTERISK_RUNTIME_QUERY_FAILED"
          ? "ASTERISK_RUNTIME_QUERY_FAILED"
          : isFreepbxError
            ? (error?.code || "WEBRTC_ACCOUNT_CONSISTENCY_QUERY_FAILED")
            : "WEBRTC_ACCOUNT_CONSISTENCY_QUERY_FAILED",
        message: isFreepbxError ? (error?.message || "WebRTC 帳號一致性查詢失敗") : "WebRTC 帳號一致性查詢失敗",
      },
    });
  }
}

const DELETE_WEBRTC_WORKFLOW_STEP_DEFS = [
  {
    key: "validate_request",
    label: "驗證刪除請求",
    running: "正在驗證刪除請求",
    success: "刪除請求格式正確",
    failed: "刪除請求格式不正確",
  },
  {
    key: "backup_asterisk_configs",
    label: "備份 PJSIP 配置",
    running: "正在備份 PJSIP 配置",
    success: "PJSIP 配置備份完成",
    failed: "PJSIP 配置備份失敗，已停止刪除流程",
    skipped: "已略過",
  },
  {
    key: "check_extensions",
    label: "檢查 FreePBX 帳號是否存在",
    running: "正在檢查 FreePBX 帳號是否存在",
    success: "FreePBX 帳號存在性檢查完成",
    failed: "FreePBX 帳號存在性檢查失敗",
  },
  {
    key: "delete_freepbx_extensions",
    label: "刪除 FreePBX 分機",
    running: "正在刪除 FreePBX 分機",
    success: "FreePBX 分機刪除完成",
    failed: "FreePBX 分機刪除失敗",
    skipped: "已略過",
  },
  {
    key: "remove_endpoint_custom_overlays",
    label: "移除 WebRTC Runtime 疊加設定",
    running: "正在移除 WebRTC Runtime 疊加設定",
    success: "WebRTC Runtime 疊加設定已處理",
    failed: "WebRTC Runtime 疊加設定移除失敗",
    skipped: "已略過",
  },
  {
    key: "apply_freepbx_config",
    label: "套用 FreePBX 配置",
    running: "正在執行 sudo fwconsole reload 套用 FreePBX 配置",
    success: "FreePBX 配置已套用",
    failed: "FreePBX 配置套用失敗",
    skipped: "已略過",
  },
  {
    key: "verify_deleted",
    label: "驗證刪除結果",
    running: "正在驗證刪除結果",
    success: "WebRTC 帳號刪除驗證通過",
    failed: "WebRTC 帳號刪除驗證失敗",
    skipped: "已略過",
  },
  {
    key: "finalize",
    label: "完成刪除流程",
    running: "正在完成 WebRTC 帳號刪除流程",
    success: "WebRTC 帳號刪除流程完成",
    failed: "WebRTC 帳號刪除流程未完成",
  },
];

function createDeleteWorkflowSteps() {
  return DELETE_WEBRTC_WORKFLOW_STEP_DEFS.map((item) => ({
    key: item.key,
    label: item.label,
    status: "pending",
    message: "",
    startedAt: "",
    finishedAt: "",
    details: {},
  }));
}

function getDeleteStep(steps, key) {
  return steps.find((step) => step.key === key) || null;
}

function setDeleteStepStatus(steps, key, status, message, details = {}) {
  const step = getDeleteStep(steps, key);
  if (!step) return null;
  if (!step.startedAt) step.startedAt = new Date().toISOString();
  step.status = status;
  step.message = message;
  step.details = { ...step.details, ...details };
  if (status !== "running" && !step.finishedAt) step.finishedAt = new Date().toISOString();
  if (status === "running") step.finishedAt = "";
  return step;
}

function markDeleteStepRunning(steps, key) {
  const def = DELETE_WEBRTC_WORKFLOW_STEP_DEFS.find((item) => item.key === key);
  return setDeleteStepStatus(steps, key, "running", def?.running || "正在處理中");
}

function markDeleteStepSuccess(steps, key, details = {}) {
  const def = DELETE_WEBRTC_WORKFLOW_STEP_DEFS.find((item) => item.key === key);
  return setDeleteStepStatus(steps, key, "success", def?.success || "處理成功", details);
}

function markDeleteStepFailed(steps, key, details = {}) {
  const def = DELETE_WEBRTC_WORKFLOW_STEP_DEFS.find((item) => item.key === key);
  return setDeleteStepStatus(steps, key, "failed", def?.failed || "處理失敗", details);
}

function markDeleteStepSkipped(steps, key, message = "") {
  const def = DELETE_WEBRTC_WORKFLOW_STEP_DEFS.find((item) => item.key === key);
  return setDeleteStepStatus(steps, key, "skipped", message || def?.skipped || "已略過");
}

function skipDeleteSteps(steps, fromKey, message = "已略過") {
  const startIndex = steps.findIndex((step) => step.key === fromKey);
  if (startIndex < 0) return;
  for (let index = startIndex; index < steps.length; index += 1) {
    if (steps[index].status === "pending") {
      markDeleteStepSkipped(steps, steps[index].key, message);
    }
  }
}

function parseBackupScriptOutput(output) {
  const text = String(output || "");
  return {
    backupDir: text.match(/Backup dir:\s*(\S+)/)?.[1] || "",
    manifestPath: text.match(/Manifest:\s*(\S+)/)?.[1] || "",
    filesCopied: Number(text.match(/Files copied:\s*(\d+)/)?.[1] || 0),
    filesMissing: Number(text.match(/Files missing:\s*(\d+)/)?.[1] || 0),
    warnings: Number(text.match(/Warnings:\s*(\d+)/)?.[1] || 0),
  };
}

async function deleteFlexisipAccountBySipUri(sipUri) {
  const normalizedSipUri = String(sipUri || "").trim();
  if (!normalizedSipUri) {
    return { matched: false, deleted: false, flexisipAccountId: null };
  }

  let searchResult;
  try {
    searchResult = await searchAccountBySip(normalizedSipUri);
  } catch (error) {
    if (error?.status === 404) {
      return { matched: false, deleted: false, flexisipAccountId: null };
    }
    throw error;
  }
  const flexisipAccountId = searchResult?.id || searchResult?.account?.id || searchResult?.userId || null;
  if (!flexisipAccountId) {
    return { matched: false, deleted: false, flexisipAccountId: null };
  }

  try {
    await flexisipDeleteAccount(flexisipAccountId);
    return { matched: true, deleted: true, flexisipAccountId };
  } catch (error) {
    if (error?.status === 404) {
      return { matched: true, deleted: true, flexisipAccountId, remoteMissing: true };
    }
    throw error;
  }
}

async function handleWebrtcAccountDelete(request, response) {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({
      success: false,
      message: "只有平臺管理員可以刪除 WebRTC 帳號。",
      error: {
        code: "WEBRTC_ACCOUNT_DELETE_FAILED",
        message: "只有平臺管理員可以刪除 WebRTC 帳號。",
      },
    });
  }

  const rawFromPath = String(request.params?.extension || "").trim();
  const rawFromBody = Array.isArray(request.body?.extensions) ? request.body.extensions : [];
  const requested = rawFromPath ? [rawFromPath] : rawFromBody.map((item) => String(item || "").trim()).filter(Boolean);
  const uniqueRequested = Array.from(new Set(requested));
  const steps = createDeleteWorkflowSteps();
  const responseData = {
    requested: uniqueRequested,
    deleted: [],
    notFound: [],
    failed: [],
    backupDir: "",
    overlayUpdated: false,
    reloadExecuted: false,
    asteriskRestartExecuted: false,
    rollbackExecuted: false,
    rollbackSuccess: null,
    rollbackMessage: "",
    items: [],
    steps,
  };

  const finalizeDeleteResponse = async (success, message, error = null, httpStatus = 200) => {
    const finalizeStep = getDeleteStep(steps, "finalize");
    if (success) {
      if (finalizeStep && finalizeStep.status === "pending") {
        markDeleteStepSuccess(steps, "finalize", { success: true });
      }
    } else if (finalizeStep && (finalizeStep.status === "pending" || finalizeStep.status === "running")) {
      markDeleteStepFailed(steps, "finalize", { success: false });
    }
    return response.status(httpStatus).json({
      success,
      message,
      ...(error ? { error } : {}),
      data: responseData,
    });
  };

  if (!uniqueRequested.length) {
    markDeleteStepFailed(steps, "validate_request");
    skipDeleteSteps(steps, "check_extensions", "已略過");
    return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
      code: "INVALID_WEBRTC_EXTENSION",
      message: "WebRTC 帳號必須為純數字",
    }, 400);
  }

  if (uniqueRequested.length > 100) {
    markDeleteStepFailed(steps, "validate_request");
    skipDeleteSteps(steps, "check_extensions", "已略過");
    return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
      code: "TOO_MANY_EXTENSIONS",
      message: "刪除帳號數量不得超過 100 筆",
    }, 400);
  }

  if (uniqueRequested.some((extension) => !/^\d+$/.test(extension))) {
    markDeleteStepFailed(steps, "validate_request");
    skipDeleteSteps(steps, "check_extensions", "已略過");
    return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
      code: "INVALID_WEBRTC_EXTENSION",
      message: "WebRTC 帳號必須為純數字",
    }, 400);
  }

  try {
    markDeleteStepRunning(steps, "validate_request");
    markDeleteStepSuccess(steps, "validate_request", { requested: uniqueRequested });

    markDeleteStepRunning(steps, "check_extensions");
    const overlayContent = await readFile(ASTERISK_PATHS.endpointCustomPostConf, "utf8").catch(() => "");
    const overlays = new Map();
    const existing = [];
    const notFound = [];
    const items = [];

    for (const extension of uniqueRequested) {
      let existsBefore = false;
      let freepbxRecord = null;
      try {
        freepbxRecord = await freepbxFetchExtension(extension);
        existsBefore = Boolean(freepbxRecord);
      } catch (error) {
        responseData.failed.push({
          extension,
          code: error?.code || "FREEPBX_EXTENSION_QUERY_FAILED",
          message: "WebRTC 帳號刪除失敗",
          stage: "check",
        });
        items.push({
          extension,
          existsBefore: false,
          deletedInFreepbx: false,
          overlayRemoved: false,
          verifiedDeleted: false,
          queryFailed: true,
          status: "failed",
          message: "WebRTC 帳號刪除失敗",
        });
        continue;
      }
      const overlay = parseEndpointCustomPostOverlay(overlayContent, extension);
      overlays.set(extension, overlay);
      if (existsBefore) existing.push(extension);
      else notFound.push(extension);
      items.push({
        extension,
        existsBefore,
        deletedInFreepbx: false,
        overlayRemoved: false,
        verifiedDeleted: false,
        status: existsBefore ? "pending" : "not_found",
        message: existsBefore ? "正在刪除 WebRTC 帳號" : "WebRTC 帳號不存在",
      });
    }

    responseData.items = items;
    responseData.notFound = notFound.slice();
    markDeleteStepSuccess(steps, "check_extensions", {
      requested: uniqueRequested,
      existing: existing.slice(),
      notFound: notFound.slice(),
    });

    const needsOverlayChange = uniqueRequested.some((extension) => Boolean(overlays.get(extension)?.exists));
    const needsFreepbxDelete = existing.length > 0;
    if (!needsOverlayChange && !needsFreepbxDelete) {
      markDeleteStepSkipped(steps, "backup_asterisk_configs", "無需變更");
      markDeleteStepSkipped(steps, "delete_freepbx_extensions", "已略過");
      markDeleteStepSkipped(steps, "remove_endpoint_custom_overlays", "已略過");
      markDeleteStepSkipped(steps, "apply_freepbx_config", "已略過");
      markDeleteStepSkipped(steps, "verify_deleted", "已略過");
      responseData.overlayUpdated = false;
      responseData.reloadExecuted = false;
      responseData.items = items.map((item) => ({
        ...item,
        status: item.status === "pending" ? "not_found" : item.status,
        message: item.status === "pending" ? "WebRTC 帳號不存在" : item.message,
      }));
      responseData.notFound = responseData.items.filter((item) => item.status === "not_found").map((item) => item.extension);
      responseData.deleted = [];
      if (responseData.failed.length > 0) {
        markDeleteStepFailed(steps, "finalize", { failed: responseData.failed.map((item) => item.extension) });
        return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
          code: "WEBRTC_ACCOUNT_DELETE_FAILED",
          message: "WebRTC 帳號刪除過程中有專案失敗",
        }, 502);
      }
      // 同步刪除 SaaS 數據庫記錄
      const deletedExts = responseData.items.filter(i => i.status === 'deleted' || i.status === 'not_found').map(i => i.extension);
      if (deletedExts.length > 0) {
        try {
          const flexisipDeleteResults = [];
          for (const username of deletedExts) {
            const sipUri = `${username}@${sipDomain}`;
            try {
              const result = await deleteFlexisipAccountBySipUri(sipUri);
              if (result.matched) {
                flexisipDeleteResults.push({ username, sipUri, ...result });
              }
            } catch (flexisipErr) {
              console.error("Failed to cleanup Flexisip account after WebRTC delete:", {
                username,
                sipUri,
                message: flexisipErr?.message || String(flexisipErr),
                status: flexisipErr?.status || null,
              });
              return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
                code: "FLEXISIP_DELETE_FAILED",
                message: "Flexisip 帳號刪除失敗",
              }, 502);
            }
          }
          const dbConn = await pool.getConnection();
          try {
            await dbConn.query(
              `DELETE FROM web_users WHERE username IN (${deletedExts.map(() => '?').join(',')}) AND sip_domain = ?`,
              [...deletedExts, webrtcDomain],
            );
            responseData.dbCleanedUp = deletedExts.length;
            responseData.flexisipDeleted = flexisipDeleteResults.length;
          } finally {
            dbConn.release();
          }
        } catch (dbErr) {
          console.error("Failed to cleanup web_users after delete:", dbErr?.message);
        }
      }
      return finalizeDeleteResponse(true, "WebRTC 帳號刪除完成");
    }

    markDeleteStepRunning(steps, "backup_asterisk_configs");
    const backupOutput = execSync("node scripts/backup-asterisk-pjsip-configs.js --confirm yes", {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    const backupInfo = parseBackupScriptOutput(backupOutput);
    if (!backupInfo.backupDir || backupInfo.filesCopied <= 0) {
      markDeleteStepFailed(steps, "backup_asterisk_configs", backupInfo);
      skipDeleteSteps(steps, "delete_freepbx_extensions", "已略過");
      return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
        code: "ASTERISK_CONFIG_BACKUP_FAILED",
        message: "PJSIP 配置備份失敗，已停止刪除流程",
      }, 500);
    }
    responseData.backupDir = backupInfo.backupDir;
    responseData.backupSummary = backupInfo;
    markDeleteStepSuccess(steps, "backup_asterisk_configs", backupInfo);

    const backupInfoLoaded = await loadEndpointCustomPostBackup(responseData.backupDir);
    const currentSha256 = await sha256File(ASTERISK_PATHS.endpointCustomPostConf).catch(() => "");
    if (currentSha256 && backupInfoLoaded?.targetEntry?.sha256 && currentSha256 !== backupInfoLoaded.targetEntry.sha256) {
      markDeleteStepFailed(steps, "backup_asterisk_configs", {
        currentSha256,
        expectedSha256: backupInfoLoaded.targetEntry.sha256,
      });
      skipDeleteSteps(steps, "delete_freepbx_extensions", "已略過");
      return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
        code: "WEBRTC_ACCOUNT_DELETE_FAILED",
        message: "PJSIP 配置自備份後已變更",
      }, 409);
    }

    markDeleteStepRunning(steps, "delete_freepbx_extensions");
    const deleteResults = [];
    for (const extension of uniqueRequested) {
      const item = items.find((entry) => entry.extension === extension) || {
        extension,
        existsBefore: false,
        deletedInFreepbx: false,
        overlayRemoved: false,
        verifiedDeleted: false,
        status: "pending",
        message: "",
      };
      if (!item.existsBefore) {
        deleteResults.push(item);
        continue;
      }
      try {
        const deleteResult = await freepbxDeleteExtension(extension);
        const deleted = Boolean(deleteResult?.status);
        item.deletedInFreepbx = deleted;
        item.status = deleted ? "deleted" : "failed";
        item.message = deleted ? "WebRTC 帳號已刪除" : "WebRTC 帳號刪除失敗";
        if (!deleted) {
          responseData.failed.push({
            extension,
            code: "FREEPBX_EXTENSION_DELETE_FAILED",
            message: "WebRTC 帳號刪除失敗",
            stage: "delete",
          });
        } else {
          responseData.deleted.push(extension);
        }
      } catch (error) {
        item.deletedInFreepbx = false;
        item.status = "failed";
        item.message = "WebRTC 帳號刪除失敗";
        responseData.failed.push({
          extension,
          code: error?.code || "FREEPBX_EXTENSION_DELETE_FAILED",
          message: "WebRTC 帳號刪除失敗",
          stage: "delete",
        });
      }
      deleteResults.push(item);
    }
    responseData.items = deleteResults;
    markDeleteStepSuccess(steps, "delete_freepbx_extensions", {
      deleted: responseData.deleted.slice(),
      failed: responseData.failed.map((item) => item.extension),
    });

    const flexisipDeleteResults = [];
    for (const extension of uniqueRequested) {
      try {
        const result = await deleteFlexisipAccountBySipUri(`${extension}@${sipDomain}`);
        if (result.matched) {
          flexisipDeleteResults.push({ extension, ...result });
        }
      } catch (flexisipErr) {
        markDeleteStepFailed(steps, "delete_freepbx_extensions", {
          flexisipError: flexisipErr?.code || flexisipErr?.message || "error",
        });
        return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
          code: "FLEXISIP_DELETE_FAILED",
          message: "Flexisip 帳號刪除失敗",
        }, 502);
      }
    }
    responseData.flexisipDeleted = flexisipDeleteResults.length;

    markDeleteStepRunning(steps, "remove_endpoint_custom_overlays");
    const currentOverlayContent = await readFile(ASTERISK_PATHS.endpointCustomPostConf, "utf8").catch(() => "");
    let nextOverlayContent = currentOverlayContent;
    let overlayUpdated = false;
    for (const extension of uniqueRequested) {
      const removal = removeEndpointCustomPostOverlay(nextOverlayContent, extension);
      if (removal.removed) {
        overlayUpdated = true;
        nextOverlayContent = removal.content;
        const item = responseData.items.find((entry) => entry.extension === extension);
        if (item) item.overlayRemoved = true;
      }
    }

    if (overlayUpdated) {
      const currentStat = await stat(ASTERISK_PATHS.endpointCustomPostConf);
      await writeAtomicFile(ASTERISK_PATHS.endpointCustomPostConf, nextOverlayContent, currentStat.mode & 0o7777);
      await chown(ASTERISK_PATHS.endpointCustomPostConf, currentStat.uid, currentStat.gid);
      await chmod(ASTERISK_PATHS.endpointCustomPostConf, currentStat.mode & 0o7777);
    }
    responseData.overlayUpdated = overlayUpdated;
    markDeleteStepSuccess(steps, "remove_endpoint_custom_overlays", {
      overlayUpdated,
      removed: responseData.items.filter((item) => item.overlayRemoved).map((item) => item.extension),
    });

    markDeleteStepRunning(steps, "apply_freepbx_config");
    const applyConfig = await freepbxApplyConfigAndWait().catch((error) => ({
      success: false,
      message: error?.message || "reload failed",
    }));
    if (!applyConfig?.success) {
      markDeleteStepFailed(steps, "apply_freepbx_config", { success: false, message: applyConfig?.message || "" });
      responseData.rollbackExecuted = Boolean(overlayUpdated);
      if (overlayUpdated) {
        try {
          const restorePath = await restoreEndpointCustomPostFromBackup(responseData.backupDir);
          await freepbxApplyConfigAndWait();
          responseData.rollbackSuccess = true;
          responseData.rollbackMessage = `已從備份還原：${restorePath}`;
        } catch (rollbackError) {
          responseData.rollbackSuccess = false;
          responseData.rollbackMessage = rollbackError?.message || "回滾失敗";
          return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
            code: "WEBRTC_ACCOUNT_DELETE_FAILED",
            message: "WebRTC Runtime 疊加設定刪除後回滾失敗，請人工檢查備份檔案",
          }, 500);
        }
      }
      return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
        code: "FWCONSOLE_RELOAD_FAILED",
        message: "FreePBX 配置套用失敗",
      }, 502);
    }
    responseData.reloadExecuted = true;
    responseData.applyConfig = {
      success: true,
      transactionId: applyConfig.transactionId || null,
      waitStrategy: applyConfig.waitStrategy || null,
    };
    markDeleteStepSuccess(steps, "apply_freepbx_config", {
      transactionId: applyConfig.transactionId || null,
      waitStrategy: applyConfig.waitStrategy || null,
    });

    markDeleteStepRunning(steps, "verify_deleted");
    const verificationItems = [];
    let allVerified = true;
    for (const extension of uniqueRequested) {
      const freepbxAfter = await freepbxFetchExtension(extension).catch(() => null);
      const runtimeAfter = await getPjsipEndpointStatus(extension).catch(() => ({
        exists: false,
        status: "unknown",
        statusText: "狀態未知",
      }));
      const overlayAfter = await readEndpointCustomPostOverlay(extension).catch(() => ({
        exists: false,
        fields: {},
        file: ASTERISK_PATHS.endpointCustomPostConf,
      }));
      const verifiedDeleted = !freepbxAfter && !runtimeAfter?.exists;
      if (!verifiedDeleted) allVerified = false;
      const item = responseData.items.find((entry) => entry.extension === extension);
      if (item) {
        if (item.queryFailed) {
          allVerified = false;
          item.verifiedDeleted = false;
          verificationItems.push({
            extension,
            existsBefore: Boolean(item?.existsBefore),
            freepbxExistsAfter: Boolean(freepbxAfter),
            runtimeExistsAfter: Boolean(runtimeAfter?.exists),
            overlayExistsAfter: Boolean(overlayAfter?.exists),
            verifiedDeleted: false,
            queryFailed: true,
          });
          continue;
        }
        item.verifiedDeleted = verifiedDeleted;
        item.status = verifiedDeleted ? (item.existsBefore ? "deleted" : "not_found") : "failed";
        item.message = verifiedDeleted
          ? (item.existsBefore ? "WebRTC 帳號已刪除" : "WebRTC 帳號不存在")
          : "WebRTC 帳號刪除驗證失敗";
      }
      verificationItems.push({
        extension,
        existsBefore: Boolean(item?.existsBefore),
        freepbxExistsAfter: Boolean(freepbxAfter),
        runtimeExistsAfter: Boolean(runtimeAfter?.exists),
        overlayExistsAfter: Boolean(overlayAfter?.exists),
        verifiedDeleted,
      });
    }
    responseData.items = responseData.items.map((item) => ({
      ...item,
      status: item.verifiedDeleted ? (item.existsBefore ? "deleted" : "not_found") : item.status,
      message: item.verifiedDeleted
        ? (item.existsBefore ? "WebRTC 帳號已刪除" : "WebRTC 帳號不存在")
        : item.message,
    }));
    responseData.verified = allVerified;
    responseData.verification = verificationItems;
    if (!allVerified || responseData.failed.length > 0) {
      markDeleteStepFailed(steps, "verify_deleted", { failed: verificationItems.filter((item) => !item.verifiedDeleted).map((item) => item.extension) });
      responseData.rollbackExecuted = Boolean(overlayUpdated);
      if (overlayUpdated && responseData.rollbackSuccess !== true) {
        try {
          const restorePath = await restoreEndpointCustomPostFromBackup(responseData.backupDir);
          await freepbxApplyConfigAndWait();
          responseData.rollbackSuccess = true;
          responseData.rollbackMessage = `已從備份還原：${restorePath}`;
        } catch (rollbackError) {
          responseData.rollbackSuccess = false;
          responseData.rollbackMessage = rollbackError?.message || "回滾失敗";
          return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
            code: "WEBRTC_ACCOUNT_DELETE_FAILED",
            message: "WebRTC 帳號刪除驗證失敗，且回滾失敗",
          }, 500);
        }
      }
      return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
        code: "WEBRTC_ACCOUNT_DELETE_FAILED",
        message: responseData.failed.length > 0
          ? "WebRTC 帳號刪除過程中有專案失敗"
          : "WebRTC 帳號刪除驗證失敗",
      }, 502);
    }
    markDeleteStepSuccess(steps, "verify_deleted", {
      verified: verificationItems,
    });

    markDeleteStepSkipped(steps, "finalize", "未觸發回滾");
    responseData.rollbackExecuted = false;
    responseData.rollbackSuccess = null;
    responseData.deleted = responseData.items.filter((item) => item.status === "deleted").map((item) => item.extension);
    responseData.notFound = responseData.items.filter((item) => item.status === "not_found").map((item) => item.extension);
    responseData.failed = responseData.items.filter((item) => item.status === "failed").map((item) => ({
      extension: item.extension,
      code: "WEBRTC_ACCOUNT_DELETE_FAILED",
      message: item.message || "WebRTC 帳號刪除失敗",
    }));
    markDeleteStepRunning(steps, "finalize");
    markDeleteStepSuccess(steps, "finalize", { success: true });
    return finalizeDeleteResponse(true, "WebRTC 帳號刪除完成");
  } catch (error) {
    markDeleteStepFailed(steps, "finalize");
    return finalizeDeleteResponse(false, "WebRTC 帳號刪除失敗", {
      code: error?.code || "WEBRTC_ACCOUNT_DELETE_FAILED",
      message: "WebRTC 帳號刪除失敗",
    }, 500);
  }
}

app.get("/api/pbx/webrtc-accounts/status", requireAdmin, handleWebrtcAccountStatusQuery);
app.get("/api/pbx/webrtc-accounts/presence", requireAdmin, handleWebrtcAccountPresenceBatchQuery);
app.get("/api/pbx/webrtc-accounts/:extension/status", requireAdmin, handleWebrtcAccountStatusQuery);
app.get("/api/pbx/webrtc-accounts/:extension/presence", requireAdmin, handleWebrtcAccountPresenceQuery);
app.get("/api/pbx/webrtc-accounts/check", requireAdmin, handleWebrtcAccountQuery);
app.get("/api/pbx/webrtc-accounts/:extension/call-logs", requireAdmin, handleWebrtcAccountCallLogsQuery);
app.get("/api/pbx/webrtc-accounts/:extension/config", requireAdmin, handleWebrtcAccountConfigQuery);
app.get("/api/pbx/webrtc-accounts/check", requireAdmin, handleWebrtcAccountQuery);
app.get("/api/pbx/webrtc-accounts/:extension/consistency", requireAdmin, handleWebrtcAccountConsistencyQuery);
app.get("/api/pbx/webrtc-accounts/:extension", requireAdmin, handleWebrtcAccountQuery);
app.delete("/api/pbx/webrtc-accounts", requireAdmin, handleWebrtcAccountDelete);
app.delete("/api/pbx/webrtc-accounts/:extension", requireAdmin, handleWebrtcAccountDelete);
app.patch("/api/pbx/webrtc-accounts/:extension/display-name", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({
      success: false,
      message: "只有平臺管理員可以更新 WebRTC 帳號顯示名稱。",
      error: {
        code: "WEBRTC_DISPLAY_NAME_UPDATE_FAILED",
        message: "只有平臺管理員可以更新 WebRTC 帳號顯示名稱。",
      },
    });
  }

  const extension = String(request.params?.extension || "").trim();
  const displayName = sanitizeString(request.body?.displayName, 80);

  if (!/^\d+$/.test(extension)) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號格式不正確",
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
  }

  if (!displayName) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號顯示名稱不正確",
      error: {
        code: "INVALID_WEBRTC_DISPLAY_NAME",
        message: "WebRTC 帳號顯示名稱不可為空白",
      },
    });
  }

  if (displayName.length > 80) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號顯示名稱不正確",
      error: {
        code: "INVALID_WEBRTC_DISPLAY_NAME",
        message: "WebRTC 帳號顯示名稱長度不得超過 80 個字元",
      },
    });
  }

  try {
    const existing = await freepbxFetchExtension(extension);
    if (!existing) {
      return response.status(404).json({
        success: false,
        message: "WebRTC 帳號不存在",
        error: {
          code: "WEBRTC_ACCOUNT_NOT_FOUND",
          message: "WebRTC 帳號不存在",
        },
      });
    }

    const beforeConfig = await getPjsipEndpointConfig(extension).catch(() => null);
    const webClient = new FreepbxWebSessionClient();
    const form = await webClient.getExtensionForm(extension);
    const update = buildFreepbxDisplayNameFormUpdate(form, extension, displayName);
    const submitResult = await webClient.submitExtensionForm(form, update.fields);
    if (!submitResult || submitResult.loginShown) {
      return response.status(500).json({
        success: false,
        message: "WebRTC 帳號顯示名稱更新失敗",
        error: {
          code: "FREEPBX_DISPLAY_NAME_UPDATE_FAILED",
          message: "WebRTC 帳號顯示名稱更新失敗",
        },
        data: {
          extension,
          displayName,
          updated: false,
          needReload: false,
        },
      });
    }

    const refreshed = await freepbxFetchExtension(extension);
    const updated = Boolean(refreshed && String(refreshed.name || "") === displayName);
    if (!updated) {
      return response.status(500).json({
        success: false,
        message: "WebRTC 帳號顯示名稱更新失敗",
        error: {
          code: "WEBRTC_DISPLAY_NAME_UPDATE_FAILED",
          message: "WebRTC 帳號顯示名稱更新失敗",
        },
        data: {
          extension,
          displayName,
          updated: false,
          needReload: true,
        },
      });
    }

    const applyConfig = await freepbxApplyConfigAndWait().catch((error) => ({
      attempted: true,
      success: false,
      status: false,
      message: error?.message || "reload failed",
      transactionId: null,
      waitStrategy: "error",
      apiStatus: null,
    }));
    if (!applyConfig?.success) {
      return response.status(500).json({
        success: false,
        message: "WebRTC 帳號顯示名稱更新失敗",
        error: {
          code: "FWCONSOLE_RELOAD_FAILED",
          message: "FreePBX 套用配置失敗",
        },
        data: {
          extension,
          displayName,
          updated: true,
          needReload: true,
          applyConfigSuccess: false,
          applyConfig: {
            success: false,
            transactionId: applyConfig?.transactionId || null,
            waitStrategy: applyConfig?.waitStrategy || null,
          },
        },
      });
    }

    const afterConfig = await getPjsipEndpointConfig(extension).catch(() => null);
    const compareFields = [
      "transport",
      "allow",
      "media_address",
      "direct_media",
      "webrtc",
      "use_avpf",
      "ice_support",
      "rtcp_mux",
      "bundle",
      "media_encryption",
      "media_use_received_transport",
      "dtls_auto_generate_cert",
      "dtls_setup",
      "dtls_verify",
      "allow_unauthenticated_options",
      "rtp_timeout",
      "rtp_timeout_hold",
      "asymmetric_rtp_codec",
    ];
    const beforeFields = beforeConfig || {};
    const afterFields = afterConfig || {};
    const changedWebrtcFields = compareEndpointFields(beforeFields, afterFields, compareFields).filter((item) => !item.passed);
    if (changedWebrtcFields.length) {
      return response.status(500).json({
        success: false,
        message: "顯示名稱更新導致 WebRTC 配置改變，已停止操作",
        error: {
          code: "WEBRTC_DISPLAY_NAME_UPDATE_CHANGED_WEBRTC_CONFIG",
          message: "顯示名稱更新導致 WebRTC 配置改變，已停止操作",
        },
        data: {
          extension,
          displayName,
          updated: false,
          needReload: true,
          changedFields: changedWebrtcFields,
        },
      });
    }

    // 同步更新 SaaS 数据库中的显示名称
    let dbUpdated = false;
    try {
      const dbConn = await pool.getConnection();
      try {
        await dbConn.query(
          `UPDATE web_users SET display_name = ? WHERE username = ? AND sip_domain = ?`,
          [displayName, extension, webrtcDomain],
        );
        dbUpdated = true;
      } finally {
        dbConn.release();
      }
    } catch (dbErr) {
      console.error("Failed to sync display name to database:", dbErr?.message);
    }

    return response.json({
      success: true,
      message: "WebRTC 帳號顯示名稱已更新",
      data: {
        extension,
        displayName,
        updated,
        needReload: false,
        applyConfigSuccess: true,
        dbUpdated,
        applyConfig: {
          success: true,
          transactionId: applyConfig?.transactionId || null,
          waitStrategy: applyConfig?.waitStrategy || null,
        },
      },
    });
  } catch (error) {
    return response.status(500).json({
      success: false,
      message: "WebRTC 帳號顯示名稱更新失敗",
      error: {
        code: error?.code === "FREEPBX_DISPLAY_NAME_UPDATE_FAILED"
          ? "FREEPBX_DISPLAY_NAME_UPDATE_FAILED"
          : "WEBRTC_DISPLAY_NAME_UPDATE_FAILED",
        message: error?.message || "WebRTC 帳號顯示名稱更新失敗",
      },
      data: {
        extension,
        displayName,
        updated: false,
        needReload: false,
      },
    });
  }
});
app.patch("/api/pbx/webrtc-accounts/:extension/password", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({
      success: false,
      message: "只有平臺管理員可以更新 WebRTC 帳號密碼。",
      error: {
        code: "WEBRTC_PASSWORD_UPDATE_FAILED",
        message: "只有平臺管理員可以更新 WebRTC 帳號密碼。",
      },
    });
  }

  const extension = String(request.params?.extension || "").trim();
  const password = sanitizeString(request.body?.password ?? request.body?.newPassword, 128);

  if (!/^\d+$/.test(extension)) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號格式不正確",
      error: {
        code: "INVALID_WEBRTC_EXTENSION",
        message: "WebRTC 帳號必須為純數字",
      },
    });
  }

  if (!password) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號密碼不正確",
      error: {
        code: "INVALID_WEBRTC_PASSWORD",
        message: "WebRTC 帳號密碼不可為空白",
      },
    });
  }

  if (password.length > 128) {
    return response.status(400).json({
      success: false,
      message: "WebRTC 帳號密碼不正確",
      error: {
        code: "INVALID_WEBRTC_PASSWORD",
        message: "WebRTC 帳號密碼長度不得超過 128 個字元",
      },
    });
  }

  try {
    const existing = await freepbxFetchExtension(extension);
    if (!existing) {
      return response.status(404).json({
        success: false,
        message: "WebRTC 帳號不存在",
        error: {
          code: "WEBRTC_ACCOUNT_NOT_FOUND",
          message: "WebRTC 帳號不存在",
        },
      });
    }

    const updateResult = await freepbxUpdateExtensionPassword(extension, password);
    if (!updateResult?.status) {
      return response.status(500).json({
        success: false,
        message: "WebRTC 帳號密碼更新失敗",
        error: {
          code: "FREEPBX_PASSWORD_UPDATE_FAILED",
          message: "FreePBX 密碼更新失敗",
        },
        data: {
          extension,
          updated: false,
          needReload: false,
          stage: "update_extension_password",
          updateResult: {
            status: Boolean(updateResult?.status),
            message: updateResult?.message || null,
          },
        },
      });
    }

    // 同步更新 SaaS 数据库密码
    try {
      const dbConn = await pool.getConnection();
      try {
        const passwordHash = await hashPassword(password);
        await dbConn.query(
          `UPDATE web_users SET password_hash = ? WHERE username = ? AND sip_domain = ?`,
          [passwordHash, extension, webrtcDomain],
        );
      } finally {
        dbConn.release();
      }
    } catch (dbErr) {
      console.error("Failed to sync password to database:", dbErr?.message);
    }

    return response.json({
      success: true,
      message: "WebRTC 帳號密碼已更新",
      data: {
        extension,
        updated: true,
        needReload: false,
      },
    });
  } catch (error) {
    return response.status(500).json({
      success: false,
      message: "WebRTC 帳號密碼更新失敗",
      error: {
        code: error?.code === "FREEPBX_PASSWORD_UPDATE_FAILED"
          ? "FREEPBX_PASSWORD_UPDATE_FAILED"
          : "WEBRTC_PASSWORD_UPDATE_FAILED",
        message: error?.message || "WebRTC 帳號密碼更新失敗",
      },
      data: {
        extension,
        updated: false,
        needReload: false,
        stage: "update_extension_password",
        errorName: error?.name || null,
        errorMessage: error?.message || null,
        graphQLErrors: error?.responseBody?.errors || null,
      },
    });
  }
});
app.post("/api/pbx/webrtc-accounts", requireAdmin, async (request, response) => {
  // TODO: keep this endpoint restricted to trusted SaaS platform administrators before production use.
  if (request.admin.accountType !== "platform") {
    return response.status(403).json({
      success: false,
      message: "只有平臺管理員可以建立 PBX 測試帳號。",
      error: {
        code: "WEBRTC_ACCOUNT_CREATE_FAILED",
        message: "只有平臺管理員可以建立 PBX 測試帳號。",
      },
    });
  }

  const extension = String(request.body?.extension || "").trim();
  const displayName = `${WEBRTC_RUNTIME.displayNamePrefix || "訪客"}${extension || ""}`;
  const reportPath = `/tmp/freepbx-webrtc-create-final-${extension || "unknown"}-report.md`;
  const steps = createWorkflowSteps();
  const responseData = {
    extension: extension || "",
    displayName,
    createdInFreepbx: false,
    pjsipPasswordConfigured: false,
    webFormSubmitted: false,
    firstReloadExecuted: false,
    generatedEndpointVerified: false,
    endpointCustomPostWritten: false,
    secondReloadExecuted: false,
    runtimeVerified: false,
    baselineVerified: false,
    rollbackExecuted: false,
    rollbackSuccess: null,
    asteriskRestartExecuted: false,
    backupDir: "",
    reportPath,
    failedFields: [],
    warningFields: [],
    runtimeDiagnostics: {},
    steps,
  };

  const finalizeReport = async (success, message, error = null, httpStatus = 200) => {
    if (!success) {
      const finalizeStep = steps.find((step) => step.key === "finalize");
      if (finalizeStep && finalizeStep.status === "pending") {
        markStepFailed(steps, "finalize", { success: false });
      } else if (finalizeStep && finalizeStep.status === "running") {
        markStepFailed(steps, "finalize", { success: false });
      }
    } else {
      const finalizeStep = steps.find((step) => step.key === "finalize");
      if (finalizeStep && finalizeStep.status === "pending") {
        markStepSuccess(steps, "finalize", { success: true });
      }
    }
    const reportContent = buildWorkflowReport({
      success,
      message,
      extension,
      displayName,
      backupDir: responseData.backupDir,
      reportPath,
      createdInFreepbx: responseData.createdInFreepbx,
      pjsipPasswordConfigured: responseData.pjsipPasswordConfigured,
      webFormSubmitted: responseData.webFormSubmitted,
      firstReloadExecuted: responseData.firstReloadExecuted,
      generatedEndpointVerified: responseData.generatedEndpointVerified,
      endpointCustomPostWritten: responseData.endpointCustomPostWritten,
      secondReloadExecuted: responseData.secondReloadExecuted,
      runtimeVerified: responseData.runtimeVerified,
      baselineVerified: responseData.baselineVerified,
      rollbackExecuted: responseData.rollbackExecuted,
      rollbackSuccess: responseData.rollbackSuccess,
      rollbackMessage: responseData.rollbackMessage || "",
      runtimeDiagnostics: responseData.runtimeDiagnostics || {},
      baseline: responseData.baseline,
      baselineNormal: Boolean(
        responseData.baseline?.[WEBRTC_RUNTIME.fallbackReferenceExtension]?.verified &&
        responseData.baseline?.[WEBRTC_RUNTIME.referenceExtension]?.verified,
      ),
      failedFields: responseData.failedFields,
      warningFields: responseData.warningFields,
      steps,
      endpointComparison: responseData.endpointComparison || [],
    });
    await writeFile(reportPath, reportContent, "utf8").catch(() => {});
    return response.status(httpStatus).json({
      success,
      message,
      ...(error ? { error } : {}),
      data: responseData,
    });
  };

  if (!/^\d+$/.test(extension)) {
    markStepFailed(steps, "validate_extension");
    skipRemainingSteps(steps, "check_existing_extension", "已略過");
    return finalizeReport(false, "WebRTC 帳號建立失敗", {
      code: "INVALID_WEBRTC_EXTENSION",
      message: "WebRTC 帳號必須為純數字",
    }, 400);
  }

  const email = sanitizeString(request.body?.email || `${extension}@example.com`, 160);
  if (!isValidEmail(email)) {
    markStepFailed(steps, "validate_extension", { email });
    skipRemainingSteps(steps, "check_existing_extension", "已略過");
    return finalizeReport(false, "WebRTC 帳號建立失敗", {
      code: "WEBRTC_ACCOUNT_CREATE_FAILED",
      message: "電子郵件格式無效。",
    }, 400);
  }

  try {
    markStepRunning(steps, "validate_extension");
    markStepSuccess(steps, "validate_extension");

    markStepRunning(steps, "check_existing_extension");
    let existing;
    try {
      existing = await freepbxFetchExtension(extension);
    } catch (error) {
      markStepFailed(steps, "check_existing_extension", {
        errorCode: error?.code || "FREEPBX_EXTENSION_QUERY_FAILED",
        errorMessage: error?.message || "WebRTC 帳號查詢失敗",
      });
      skipRemainingSteps(steps, "backup_asterisk_configs", "已略過");
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: error?.code || "FREEPBX_EXTENSION_QUERY_FAILED",
        message: error?.message || "FreePBX extension query failed.",
      }, 500);
    }
    if (existing) {
      markStepFailed(steps, "check_existing_extension");
      skipRemainingSteps(steps, "backup_asterisk_configs", "已略過");
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "FREEPBX_EXTENSION_ALREADY_EXISTS",
        message: "該 WebRTC 帳號已存在，請更換帳號",
      }, 409);
    }
    markStepSuccess(steps, "check_existing_extension");

    markStepRunning(steps, "backup_asterisk_configs");
    const backupOutput = execSync("node scripts/backup-asterisk-pjsip-configs.js --confirm yes", {
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
    const backupDir = backupOutput.match(/Backup dir:\s*(\S+)/)?.[1] || "";
    const manifestPath = backupOutput.match(/Manifest:\s*(\S+)/)?.[1] || "";
    const filesCopied = Number(backupOutput.match(/Files copied:\s*(\d+)/)?.[1] || 0);
    const filesMissing = Number(backupOutput.match(/Files missing:\s*(\d+)/)?.[1] || 0);
    const warnings = Number(backupOutput.match(/Warnings:\s*(\d+)/)?.[1] || 0);
    if (!backupDir || filesCopied <= 0) {
      markStepFailed(steps, "backup_asterisk_configs", { backupDir, filesCopied, filesMissing, warnings });
      skipRemainingSteps(steps, "create_freepbx_extension", "已略過");
      responseData.backupDir = backupDir || "";
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "ASTERISK_CONFIG_BACKUP_FAILED",
        message: "PJSIP 配置備份失敗，已停止建立流程",
      }, 500);
    }
    responseData.backupDir = backupDir;
    responseData.manifestPath = manifestPath;
    responseData.backupSummary = { filesCopied, filesMissing, warnings };
    markStepSuccess(steps, "backup_asterisk_configs", { backupDir, manifestPath, filesCopied, filesMissing, warnings });

    const schema = await freepbxGetExtensionInputSchema();
    const {
      displayName,
      addPayload,
      updatePayload,
      webrtcConfig,
    } = buildFreepbxWebrtcExtensionPayloads(extension, email, schema);
    const rollbackCreatedAccount = async () => rollbackCreatedFreepbxAccount({
      extension,
      responseData,
      steps,
    });

    markStepRunning(steps, "create_freepbx_extension");
    let createResult;
    try {
      createResult = await freepbxAddExtension(addPayload);
    } catch (error) {
      markStepFailed(steps, "create_freepbx_extension", { createError: error?.code || error?.message || "error" });
      skipRemainingSteps(steps, "update_pjsip_password", "已略過");
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "FREEPBX_EXTENSION_CREATE_FAILED",
        message: "FreePBX 基礎 PJSIP 分機建立失敗",
      }, 502);
    }
    if (!createResult?.status) {
      markStepFailed(steps, "create_freepbx_extension", { createStatus: createResult?.status ?? null });
      skipRemainingSteps(steps, "update_pjsip_password", "已略過");
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "FREEPBX_EXTENSION_CREATE_FAILED",
        message: "FreePBX 基礎 PJSIP 分機建立失敗",
      }, 502);
    }
    responseData.createdInFreepbx = true;
    markStepSuccess(steps, "create_freepbx_extension", { createdInFreepbx: true });

    let pjsipPasswordConfigured = false;
    let passwordUpdateMessage = "";
    markStepRunning(steps, "update_pjsip_password");
    let updateResult;
    try {
      updateResult = await freepbxUpdateExtension(extension, updatePayload);
    } catch (error) {
      markStepFailed(steps, "update_pjsip_password", { updateError: error?.code || error?.message || "error" });
      skipRemainingSteps(steps, "submit_freepbx_webrtc_form", "已略過");
      await rollbackCreatedAccount().catch(() => {});
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "FREEPBX_PASSWORD_UPDATE_FAILED",
        message: "PJSIP 註冊密碼設定失敗",
      }, 502);
    }
    pjsipPasswordConfigured = Boolean(updateResult?.status);
    passwordUpdateMessage = updateResult?.message || "";
    if (!pjsipPasswordConfigured) {
      markStepFailed(steps, "update_pjsip_password", { pjsipPasswordConfigured: false });
      skipRemainingSteps(steps, "submit_freepbx_webrtc_form", "已略過");
      await rollbackCreatedAccount().catch(() => {});
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "FREEPBX_PASSWORD_UPDATE_FAILED",
        message: "PJSIP 註冊密碼設定失敗",
      }, 502);
    }
    responseData.pjsipPasswordConfigured = true;
    markStepSuccess(steps, "update_pjsip_password", { pjsipPasswordConfigured: true });

    markStepRunning(steps, "submit_freepbx_webrtc_form");
    const webClient = new FreepbxWebSessionClient();
    let form;
    let update;
    let formSubmitted;
    try {
      form = await webClient.getExtensionForm(extension);
      update = buildWebrtcFormUpdate(form, extension);
      formSubmitted = await webClient.submitExtensionForm(form, update.fields);
    } catch (error) {
      markStepFailed(steps, "submit_freepbx_webrtc_form", {
        formError: error?.code || error?.message || "error",
        ...(error?.details || {}),
        httpStatus: error?.status || error?.details?.httpStatus || null,
      });
      skipRemainingSteps(steps, "first_fwconsole_reload", "已略過");
      await rollbackCreatedAccount().catch(() => {});
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "FREEPBX_WEB_FORM_SUBMIT_FAILED",
        message: "FreePBX WebRTC 進階配置提交失敗",
      }, 502);
    }
    if (formSubmitted.loginShown) {
      markStepFailed(steps, "submit_freepbx_webrtc_form", { loginShown: true });
      skipRemainingSteps(steps, "first_fwconsole_reload", "已略過");
      await rollbackCreatedAccount().catch(() => {});
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "FREEPBX_WEB_FORM_SUBMIT_FAILED",
        message: "FreePBX WebRTC 進階配置提交失敗",
      }, 502);
    }
    responseData.webFormSubmitted = true;
    responseData.webForm = {
      fieldCount: form.fieldNames.length,
      appliedFields: update.applied.map((item) => ({
        target: item.target,
        fieldName: item.fieldName,
      })),
      missingFormFields: update.missing.map((item) => item.target),
    };
    markStepSuccess(steps, "submit_freepbx_webrtc_form", {
      fieldCount: form.fieldNames.length,
      missingFormFields: update.missing.map((item) => item.target),
    });

    markStepRunning(steps, "first_fwconsole_reload");
    let applyConfig1;
    try {
      applyConfig1 = await freepbxApplyConfigAndWait();
    } catch (error) {
      applyConfig1 = { success: false, message: error?.message || "reload failed" };
    }
    if (!applyConfig1.success) {
      markStepFailed(steps, "first_fwconsole_reload", { success: false, message: applyConfig1.message || "" });
      skipRemainingSteps(steps, "verify_generated_endpoint", "已略過");
      await rollbackCreatedAccount().catch(() => {});
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "FWCONSOLE_RELOAD_FAILED",
        message: "FreePBX 配置套用失敗",
      }, 502);
    }
    responseData.firstReloadExecuted = true;
    responseData.firstReload = {
      success: true,
      transactionId: applyConfig1.transactionId || null,
      waitStrategy: applyConfig1.waitStrategy || null,
    };
    markStepSuccess(steps, "first_fwconsole_reload", {
      transactionId: applyConfig1.transactionId || null,
      waitStrategy: applyConfig1.waitStrategy || null,
    });

    markStepRunning(steps, "verify_generated_endpoint");
    const endpointConf = await readFile(ASTERISK_PATHS.endpointConf, "utf8");
    const referenceSection = parsePjsipSection(endpointConf, WEBRTC_RUNTIME.referenceExtension || WEBRTC_RUNTIME.fallbackReferenceExtension || "");
    const generatedSection = parsePjsipSection(endpointConf, extension);
    const expectedSection = buildExpectedGeneratedEndpointSection(extension, referenceSection?.fields || {}, webrtcConfig);
    const endpointComparison = compareEndpointFields(
      generatedSection?.fields || {},
      expectedSection.fields,
      getEndpointComparisonFields(),
    );
    const generatedEndpointVerified = Boolean(generatedSection) && endpointComparison.every((item) => item.passed);
    responseData.generatedEndpointVerified = generatedEndpointVerified;
    responseData.generatedSection = generatedSection;
    responseData.endpointComparison = endpointComparison;
    responseData.failedFields = endpointComparison.filter((item) => !item.passed).map((item) => item.field);
    if (!generatedEndpointVerified) {
      markStepFailed(steps, "verify_generated_endpoint", { failedFields: responseData.failedFields });
      skipRemainingSteps(steps, "write_endpoint_custom_overlay", "已略過");
      await rollbackCreatedAccount().catch(() => {});
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "GENERATED_ENDPOINT_VERIFY_FAILED",
        message: "FreePBX 生成的 Endpoint 配置不符合 WebRTC 要求",
      }, 502);
    }
    markStepSuccess(steps, "verify_generated_endpoint", { passedFields: endpointComparison.filter((item) => item.passed).map((item) => item.field) });

    markStepRunning(steps, "write_endpoint_custom_overlay");
    const overlayPreview = buildFourFieldEndpointOverlay(extension);
    const targetFile = ASTERISK_PATHS.endpointCustomPostConf;
    let overlayManifestPath = "";
    let currentSha256 = "";
    let currentText = "";
    let currentStat = null;
    let upsert = null;
    let newSha256 = "";
    try {
      const backupInfo = await loadEndpointCustomPostBackup(responseData.backupDir);
      overlayManifestPath = backupInfo.manifestPath;
      currentSha256 = await sha256File(targetFile);
      if (currentSha256 !== backupInfo.targetEntry.sha256) {
        markStepFailed(steps, "write_endpoint_custom_overlay", { currentSha256, expectedSha256: backupInfo.targetEntry.sha256 });
        skipRemainingSteps(steps, "second_fwconsole_reload", "已略過");
        return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "WEBRTC_ACCOUNT_CREATE_FAILED",
          message: "PJSIP 配置自備份後已變更",
        }, 409);
      }
      currentText = await readFile(targetFile, "utf8");
      currentStat = await stat(targetFile);
      const start = `; BEGIN SaaS WebRTC 4-field endpoint overlay ${extension}`;
      const end = `; END SaaS WebRTC 4-field endpoint overlay ${extension}`;
      const startIndex = currentText.indexOf(start);
      const endIndex = currentText.indexOf(end);
      const normalized = overlayPreview.endsWith("\n") ? overlayPreview : `${overlayPreview}\n`;
      if (startIndex >= 0 && endIndex > startIndex) {
        const afterEnd = endIndex + end.length;
        const nextNewline = currentText.indexOf("\n", afterEnd);
        const replaceEnd = nextNewline >= 0 ? nextNewline + 1 : currentText.length;
        upsert = {
          action: "replace",
          content: `${currentText.slice(0, startIndex)}${normalized}${currentText.slice(replaceEnd)}`,
        };
      } else {
        const separator = currentText.endsWith("\n") ? "\n" : "\n\n";
        upsert = { action: "append", content: `${currentText}${separator}${normalized}` };
      }
      await writeAtomicFile(targetFile, upsert.content, currentStat.mode & 0o7777);
      await chown(targetFile, currentStat.uid, currentStat.gid);
      await chmod(targetFile, currentStat.mode & 0o7777);
      newSha256 = await sha256File(targetFile);
    } catch (error) {
      markStepFailed(steps, "write_endpoint_custom_overlay", { writeError: error?.code || error?.message || "error" });
      skipRemainingSteps(steps, "second_fwconsole_reload", "已略過");
      await rollbackCreatedAccount().catch(() => {});
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "ENDPOINT_CUSTOM_POST_WRITE_FAILED",
        message: "WebRTC Runtime 補充引數寫入失敗",
      }, 502);
    }
    responseData.endpointCustomPostWritten = true;
    responseData.endpointCustomPost = {
      targetFile,
      action: upsert.action,
      oldSha256: currentSha256,
      newSha256,
      manifestPath: overlayManifestPath,
    };
    markStepSuccess(steps, "write_endpoint_custom_overlay", {
      targetFile,
      action: upsert.action,
      oldSha256: currentSha256,
      newSha256,
    });

    markStepRunning(steps, "second_fwconsole_reload");
    const channelsOutput = execSync("asterisk -rx \"core show channels\"", { encoding: "utf8" });
    responseData.coreShowChannelsChecked = true;
    responseData.activeChannelsIgnored = /active call|active channels/i.test(String(channelsOutput || "")) ? true : false;
    let applyConfig2;
    try {
      applyConfig2 = await freepbxApplyConfigAndWait();
    } catch (error) {
      applyConfig2 = { success: false, message: error?.message || "reload failed" };
    }
    if (!applyConfig2.success) {
      markStepFailed(steps, "second_fwconsole_reload", { success: false, message: applyConfig2.message || "" });
      skipRemainingSteps(steps, "verify_runtime_endpoint", "已略過");
      await rollbackCreatedAccount().catch(() => {});
      if (responseData.rollbackExecuted && responseData.rollbackSuccess === false) {
        return finalizeReport(false, "WebRTC 帳號建立失敗", {
          code: "ROLLBACK_FAILED",
          message: "WebRTC 帳號回滾失敗，請人工檢查備份檔案",
        }, 500);
      }
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "FWCONSOLE_RELOAD_FAILED",
        message: "FreePBX 配置套用失敗",
      }, 502);
    }
    responseData.secondReloadExecuted = true;
    responseData.secondReload = {
      success: true,
      transactionId: applyConfig2.transactionId || null,
      waitStrategy: applyConfig2.waitStrategy || null,
    };
    markStepSuccess(steps, "second_fwconsole_reload", {
      transactionId: applyConfig2.transactionId || null,
      waitStrategy: applyConfig2.waitStrategy || null,
    });

    markStepRunning(steps, "verify_runtime_endpoint");
    let asterisk;
    try {
      const maxAttempts = Number(process.env.WEBRTC_RUNTIME_VERIFY_RETRIES || 12);
      const retryDelayMs = Number(process.env.WEBRTC_RUNTIME_VERIFY_DELAY_MS || 2000);
      let lastResult = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        lastResult = await verifyPjsipExtension(extension, webrtcConfig);
        responseData.runtimeRetryCount = attempt;
        responseData.runtimeRetryDelayMs = retryDelayMs;
        if (lastResult?.verified) break;
        if (attempt < maxAttempts) {
          await delay(retryDelayMs);
        }
      }
      asterisk = lastResult;
    } catch (error) {
      asterisk = {
        verified: false,
        endpointExists: false,
        authExists: false,
        aorExists: false,
        failedChecks: ["runtime_error"],
        unsupportedOrUnverified: [],
        details: { runtimeError: error?.message || "runtime error" },
      };
    }
    responseData.runtimeVerified = Boolean(asterisk.verified);
    responseData.runtime = asterisk;
    responseData.warningFields = (asterisk.unsupportedOrUnverified || []).map((item) => item.field);
    responseData.failedFields = asterisk.failedChecks || [];
    responseData.runtimeDiagnostics = {
      retryCount: responseData.runtimeRetryCount || 0,
      retryDelayMs: responseData.runtimeRetryDelayMs || 0,
      expectedOverlayPresent: Boolean(webrtcConfig?.endpointCustomPostOverlay),
      expectedOverlayFields: Object.keys(webrtcConfig?.endpointCustomPostOverlay || {}),
      endpointExists: Boolean(asterisk.endpointExists),
      authExists: Boolean(asterisk.authExists),
      aorExists: Boolean(asterisk.aorExists),
      verified: Boolean(asterisk.verified),
      failedChecks: asterisk.failedChecks || [],
      unsupportedOrUnverified: (asterisk.unsupportedOrUnverified || []).map((item) => item.field),
    };
    if (!asterisk.verified) {
      markStepFailed(steps, "verify_runtime_endpoint", {
        failedFields: responseData.failedFields,
        runtimeDiagnostics: responseData.runtimeDiagnostics,
      });
      await rollbackCreatedAccount().catch(() => {});
      if (responseData.rollbackExecuted && responseData.rollbackSuccess === false) {
        return finalizeReport(false, "WebRTC 帳號建立失敗", {
          code: "ROLLBACK_FAILED",
          message: "WebRTC 帳號回滾失敗，請人工檢查備份檔案",
        }, 500);
      }
      responseData.baseline = {
        [WEBRTC_RUNTIME.fallbackReferenceExtension]: await verifyPjsipExtension(WEBRTC_RUNTIME.fallbackReferenceExtension, webrtcConfig),
        [WEBRTC_RUNTIME.referenceExtension]: await verifyPjsipExtension(WEBRTC_RUNTIME.referenceExtension, webrtcConfig),
      };
      responseData.baselineVerified = Boolean(
        responseData.baseline[WEBRTC_RUNTIME.fallbackReferenceExtension]?.verified &&
        responseData.baseline[WEBRTC_RUNTIME.referenceExtension]?.verified,
      );
      responseData.baselineNormal = responseData.baselineVerified;
      markStepRunning(steps, "verify_baseline_endpoints");
      if (!responseData.baselineVerified) {
        markStepFailed(steps, "verify_baseline_endpoints");
        responseData.rollbackExecuted = true;
        return finalizeReport(false, "WebRTC 帳號建立失敗", {
          code: "BASELINE_ENDPOINT_VERIFY_FAILED",
          message: "既有標準帳號狀態異常，請立即檢查服務端配置",
        }, 502);
      }
      markStepSuccess(steps, "verify_baseline_endpoints", { baselineVerified: true });
      markStepRollback(steps, "rollback_verify_removed", { rollbackSuccess: true });
      markStepRunning(steps, "finalize");
      markStepFailed(steps, "finalize", { success: false });
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "RUNTIME_VERIFY_FAILED",
        message: "WebRTC Runtime 引數驗證失敗",
      }, 502);
    }
    markStepSuccess(steps, "verify_runtime_endpoint", {
      endpointExists: Boolean(asterisk.endpointExists),
      authExists: Boolean(asterisk.authExists),
      aorExists: Boolean(asterisk.aorExists),
    });

    markStepRunning(steps, "verify_baseline_endpoints");
    const baseline9001 = await verifyPjsipExtension(WEBRTC_RUNTIME.fallbackReferenceExtension, webrtcConfig);
    const baseline9002 = await verifyPjsipExtension(WEBRTC_RUNTIME.referenceExtension, webrtcConfig);
    responseData.baseline = {
      [WEBRTC_RUNTIME.fallbackReferenceExtension]: baseline9001,
      [WEBRTC_RUNTIME.referenceExtension]: baseline9002,
    };
    responseData.baselineVerified = Boolean(baseline9001?.verified && baseline9002?.verified);
    responseData.baselineNormal = responseData.baselineVerified;
    if (!responseData.baselineVerified) {
      markStepFailed(steps, "verify_baseline_endpoints", { baselineVerified: false });
      await rollbackCreatedAccount().catch(() => {});
      if (responseData.rollbackExecuted && responseData.rollbackSuccess === false) {
        return finalizeReport(false, "WebRTC 帳號建立失敗", {
          code: "ROLLBACK_FAILED",
          message: "WebRTC 帳號回滾失敗，請人工檢查備份檔案",
        }, 500);
      }
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: "BASELINE_ENDPOINT_VERIFY_FAILED",
        message: "既有標準帳號狀態異常，請立即檢查服務端配置",
      }, 502);
    }
    markStepSuccess(steps, "verify_baseline_endpoints", { baselineVerified: true });

    markStepSkipped(steps, "rollback_freepbx_extension", "未觸發回滾");
    markStepSkipped(steps, "rollback_endpoint_custom_overlay", "未觸發回滾");
    markStepSkipped(steps, "rollback_apply_config", "未觸發回滾");
    markStepSkipped(steps, "rollback_verify_removed", "未觸發回滾");
    responseData.rollbackExecuted = false;
    responseData.rollbackSuccess = null;
    markStepRunning(steps, "finalize");
    markStepSuccess(steps, "finalize", { success: true });

    // 同步到 SaaS 数据库
    try {
      const dbConn = await pool.getConnection();
      try {
        const passwordHash = await hashPassword(WEBRTC_RUNTIME.defaultPassword || "");
        await dbConn.query(
          `INSERT INTO web_users (tenant_id, username, sip_domain, display_name, email, password_hash, role, status, created_by_admin_user_id)
           VALUES (?, ?, ?, ?, ?, ?, 'user', 'active', ?)`,
          [null, extension, webrtcDomain, displayName, `${extension}@${webrtcDomain}`, passwordHash, request.admin.id],
        );
        responseData.savedToDatabase = true;
      } finally {
        dbConn.release();
      }
    } catch (dbErr) {
      console.error("Failed to save WebRTC account to database:", dbErr?.message);
      responseData.savedToDatabase = false;
    }

    return finalizeReport(true, "WebRTC 帳號已建立完成", null, 200);
  } catch (error) {
    if (responseData.createdInFreepbx && !responseData.rollbackExecuted) {
      await rollbackCreatedAccount().catch(() => {});
    }
    if (error instanceof FreepbxApiError) {
      console.error("FreePBX WebRTC basic account request failed:", {
        extension,
        code: error.code,
        status: error.status,
        message: error.message,
      });
      markStepFailed(steps, "finalize");
      return finalizeReport(false, "WebRTC 帳號建立失敗", {
        code: error.code || "WEBRTC_ACCOUNT_CREATE_FAILED",
        message: error.message || "WebRTC 帳號建立失敗",
      }, 500);
    }

    console.error("Failed to create FreePBX WebRTC basic account:", {
      extension,
      message: error?.message || String(error),
    });
    markStepFailed(steps, "finalize");
    return finalizeReport(false, "WebRTC 帳號建立失敗", {
      code: error?.code || "WEBRTC_ACCOUNT_CREATE_FAILED",
      message: error?.message || "WebRTC 帳號建立失敗",
    }, 500);
  }
});

// GET /api/flexisip/accounts/registration-status - Discover accounts from Redis, return registration status.
app.get("/api/flexisip/accounts/registration-status", requireAdmin, async (request, response) => {
  const isPlatform = request.admin.accountType === "platform";
  const tenantId = request.admin.tenantId;

  const domain = sanitizeString(request.query.domain || "", 255).toLowerCase();
  const includeContacts = String(request.query.includeContacts || "false").toLowerCase() === "true";
  const offset = parseNonNegativeInteger(request.query.offset, 0);
  const requestedLimit = parseNonNegativeInteger(request.query.limit, 50);
  const limit = Math.min(Math.max(requestedLimit || 50, 1), 100);

  if (domain && !/^[a-z0-9.-]+$/i.test(domain)) {
    return response.status(400).json({
      success: false,
      message: "查詢引數格式不正確",
      error: { code: "INVALID_REGISTRATION_STATUS_QUERY", message: "查詢引數格式不正確" },
    });
  }

  try {
    const statusResult = await discoverAccountsFromRedis({
      includeContacts,
      domain: domain || sipDomain,
    });

    let items = statusResult.items;
    if (domain) {
      items = items.filter((item) => item.domain === domain);
    }

    // Tenant filtering: only show accounts belonging to this tenant
    if (!isPlatform && tenantId) {
      const connection = await pool.getConnection();
      try {
        const tenantSipAccounts = await connection.query(
          "SELECT username FROM sip_users WHERE tenant_id = ?",
          [tenantId]
        );
        const tenantUsernames = new Set(tenantSipAccounts.map(r => r.username));
        items = items.filter((item) => tenantUsernames.has(item.username));
      } finally {
        connection.release();
      }
    }

    const total = items.length;
    const paginatedItems = items.slice(offset, offset + limit);
    const online = paginatedItems.filter((item) => item.status === "online").length;
    const offline = paginatedItems.filter((item) => item.status === "offline").length;
    const unknown = paginatedItems.filter((item) => item.status === "unknown").length;

    return response.json({
      success: true,
      message: "帳號註冊狀態已取得",
      data: {
        total,
        online,
        offline,
        unknown,
        limit,
        offset,
        checkedAt: statusResult.checkedAt,
        items: paginatedItems,
      },
    });
  } catch (error) {
    if (error instanceof FlexisipRegistrationStatusError && error.code === "FLEXISIP_REGISTRAR_REDIS_UNAVAILABLE") {
      console.error("Flexisip Registrar Redis unavailable:", {
        message: error.message,
      });
      return response.status(503).json({
        success: false,
        message: "註冊狀態服務暫時不可用",
        error: {
          code: "FLEXISIP_REGISTRAR_REDIS_UNAVAILABLE",
          message: "註冊狀態服務暫時不可用",
        },
      });
    }

    console.error("Failed to query Flexisip registration status:", {
      message: error?.message || String(error),
    });
    return response.status(500).json({
      success: false,
      message: "帳號註冊狀態查詢失敗",
      error: {
        code: "FLEXISIP_REGISTRATION_STATUS_QUERY_FAILED",
        message: "帳號註冊狀態查詢失敗",
      },
    });
  }
});

// GET /api/flexisip/accounts/registration-detail - full detail for a single account from Redis.
app.get("/api/flexisip/accounts/registration-detail", requireAdmin, async (request, response) => {
  const isPlatform = request.admin.accountType === "platform";
  const tenantId = request.admin.tenantId;

  const username = sanitizeString(request.query.username || "", 120);
  const domain = sanitizeString(request.query.domain || sipDomain, 255).toLowerCase();

  if (!username || (domain && !/^[a-z0-9.-]+$/i.test(domain))) {
    return response.status(400).json({
      success: false,
      message: "查詢引數格式不正確",
      error: { code: "INVALID_REGISTRATION_DETAIL_QUERY", message: "查詢引數格式不正確" },
    });
  }

  // Tenant admin: verify this account belongs to their tenant
  if (!isPlatform && tenantId) {
    const dbConn = await pool.getConnection();
    try {
      const [row] = await dbConn.query("SELECT id FROM sip_users WHERE username = ? AND tenant_id = ? LIMIT 1", [username, tenantId]);
      if (!row) {
        return response.status(403).json({ success: false, message: "無許可權檢視該帳號詳情" });
      }
    } finally { dbConn.release(); }
  }

  try {
    const detail = await getAccountRegistrationDetail(username, domain, { domain: domain || sipDomain });
    return response.json({ success: true, message: "帳號註冊詳情已取得", data: detail });
  } catch (error) {
    if (error instanceof FlexisipRegistrationStatusError && error.code === "FLEXISIP_REGISTRAR_REDIS_UNAVAILABLE") {
      return response.status(503).json({
        success: false,
        message: "註冊狀態服務暫時不可用",
        error: { code: "FLEXISIP_REGISTRAR_REDIS_UNAVAILABLE", message: "註冊狀態服務暫時不可用" },
      });
    }
    console.error("Failed to get Flexisip registration detail:", { message: error?.message || String(error) });
    return response.status(500).json({
      success: false,
      message: "帳號註冊詳情查詢失敗",
      error: { code: "FLEXISIP_REGISTRATION_DETAIL_QUERY_FAILED", message: "帳號註冊詳情查詢失敗" },
    });
  }
});

// GET /api/flexisip/call-logs/date-range - get the earliest and latest call record dates.
app.get("/api/flexisip/call-logs/date-range", requireAdmin, async (request, response) => {
  const isPlatform = request.admin.accountType === "platform";
  const tenantId = request.admin.tenantId;

  try {
    const connection = await pool.getConnection();
    try {
      let whereClause = "WHERE initiated_at IS NOT NULL";
      let params = [];

      if (!isPlatform && tenantId) {
        const tenantSips = await connection.query("SELECT username FROM sip_users WHERE tenant_id = ?", [tenantId]);
        const usernames = tenantSips.map(r => r.username);
        if (usernames.length === 0) {
          return response.json({ success: true, data: { earliest: null, latest: null } });
        }
        const placeholders = usernames.map(() => '?').join(',');
        whereClause += ` AND (from_user IN (${placeholders}) OR to_user IN (${placeholders}))`;
        params = [...usernames, ...usernames];
      }

      const [row] = await connection.query(
        `SELECT MIN(initiated_at) AS earliest, MAX(initiated_at) AS latest FROM flexisip_call_logs ${whereClause}`,
        params
      );
      return response.json({
        success: true,
        data: {
          earliest: row?.earliest ? String(row.earliest).slice(0, 10) : null,
          latest: row?.latest ? String(row.latest).slice(0, 10) : null,
        },
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Failed to query Flexisip call log date range:", error.message);
    return response.status(500).json({
      success: false,
      message: "Flexisip 通話記錄範圍查詢失敗",
      error: { code: "FLEXISIP_CALL_LOG_RANGE_FAILED", message: "Flexisip 通話記錄範圍查詢失敗" },
    });
  }
});

// GET /api/flexisip/call-logs/accounts - get distinct phone numbers from call logs.
app.get("/api/flexisip/call-logs/accounts", requireAdmin, async (request, response) => {
  const isPlatform = request.admin.accountType === "platform";
  const tenantId = request.admin.tenantId;

  try {
    const connection = await pool.getConnection();
    try {
      if (isPlatform) {
        const rows = await connection.query(
          "SELECT DISTINCT u.user FROM (SELECT from_user AS user FROM flexisip_call_logs WHERE from_user != '' UNION SELECT to_user AS user FROM flexisip_call_logs WHERE to_user != '') u ORDER BY u.user ASC",
        );
        const accounts = (rows || []).map((r) => String(r.user || "")).filter(Boolean);
        return response.json({ success: true, data: accounts });
      }

      if (!tenantId) {
        return response.json({ success: true, data: [] });
      }

      // Tenant admin: only return accounts belonging to their tenant's SIP users
      const sipRows = await connection.query(
        "SELECT username FROM sip_users WHERE tenant_id = ? AND status = 'active'",
        [tenantId]
      );
      const tenantAccounts = (sipRows || []).map(r => r.username).filter(Boolean);
      return response.json({ success: true, data: tenantAccounts });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Failed to query Flexisip call log accounts:", error.message);
    return response.status(500).json({
      success: false,
      message: "Flexisip 通話記錄帳號查詢失敗",
      error: { code: "FLEXISIP_CALL_LOG_ACCOUNTS_FAILED", message: "Flexisip 通話記錄帳號查詢失敗" },
    });
  }
});

// GET /api/flexisip/call-logs - read-only Flexisip call log summary query.
app.get("/api/flexisip/call-logs", requireAdmin, async (request, response) => {
  const isPlatform = request.admin.accountType === "platform";
  const tenantId = request.admin.tenantId;

  const account = sanitizeString(request.query.account || "", 120);
  const accounts = sanitizeString(request.query.accounts || "", 600);
  const domain = sanitizeString(request.query.domain || "", 255).toLowerCase();
  const direction = sanitizeString(request.query.direction || "all", 16).toLowerCase();
  const result = sanitizeString(request.query.result || "all", 16).toLowerCase();
  const includeDevices = String(request.query.includeDevices || "false").toLowerCase() === "true";
  const limit = parseNonNegativeInteger(request.query.limit, 50);
  const offset = parseNonNegativeInteger(request.query.offset, 0);
  const from = sanitizeString(request.query.from || "", 64);
  const to = sanitizeString(request.query.to || "", 64);

  const accountTokens = [account, accounts]
    .filter(Boolean)
    .flatMap((value) => String(value).split(",").map((item) => item.trim()).filter(Boolean));
  if (accountTokens.some((token) => !/^\d+$/.test(token))) {
    return response.status(400).json({
      success: false,
      message: "查詢引數格式不正確",
      error: {
        code: "INVALID_FLEXISIP_CALL_LOG_QUERY",
        message: "查詢引數格式不正確",
      },
    });
  }

  if (domain && !/^[a-z0-9.-]+$/i.test(domain)) {
    return response.status(400).json({
      success: false,
      message: "查詢引數格式不正確",
      error: {
        code: "INVALID_FLEXISIP_CALL_LOG_QUERY",
        message: "查詢引數格式不正確",
      },
    });
  }

  if (!["inbound", "outbound", "internal", "all"].includes(direction) ||
      !["answered", "missed", "cancelled", "busy", "declined", "timeout", "failed", "unknown", "all"].includes(result) ||
      !isValidFlexisipCallLogIsoDateTime(from) ||
      !isValidFlexisipCallLogIsoDateTime(to)) {
    return response.status(400).json({
      success: false,
      message: "查詢引數格式不正確",
      error: {
        code: "INVALID_FLEXISIP_CALL_LOG_QUERY",
        message: "查詢引數格式不正確",
      },
    });
  }

  try {
    // Tenant filtering: override accounts param with tenant's SIP accounts
    let queryAccounts = accounts;
    if (!isPlatform && tenantId) {
      const dbConn = await pool.getConnection();
      try {
        const tenantSips = await dbConn.query("SELECT username FROM sip_users WHERE tenant_id = ?", [tenantId]);
        queryAccounts = tenantSips.map(r => r.username).join(',');
        if (!queryAccounts) {
          return response.json({ success: true, message: "Flexisip 通話記錄已取得", data: { total: 0, items: [] } });
        }
      } finally { dbConn.release(); }
    }

    const data = await queryFlexisipCallLogs({
      account,
      accounts: queryAccounts,
      domain,
      direction,
      result,
      includeDevices,
      limit,
      offset,
      from,
      to,
    });

    return response.json({
      success: true,
      message: "Flexisip 通話記錄已取得",
      data,
    });
  } catch (error) {
    console.error("Failed to query Flexisip call logs:", {
      message: error?.message || String(error),
    });
    return response.status(500).json({
      success: false,
      message: "Flexisip 通話記錄查詢失敗",
      error: {
        code: error instanceof FlexisipCallLogQueryError ? error.code : "FLEXISIP_CALL_LOG_QUERY_FAILED",
        message: "Flexisip 通話記錄查詢失敗",
      },
    });
  }
});

// GET /api/flexisip/statistics/calls - proxy Flexisip Admin calls statistics.
app.get("/api/flexisip/statistics/calls", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視服務端通話統計。" });
  }

  const from = sanitizeString(request.query.from || "", 20);
  const to = sanitizeString(request.query.to || "", 20);
  const period = sanitizeString(request.query.period || request.query.by || "day", 20);
  const contactList = sanitizeString(request.query.contactList || request.query.contacts_list || "", 80);
  const allowedPeriods = new Set(["day", "week", "month", "year"]);

  if (period && !allowedPeriods.has(period)) {
    return response.status(400).json({ message: "統計粒度只能是 day、week、month 或 year。" });
  }
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return response.status(400).json({ message: "from 必須是 YYYY-MM-DD 格式。" });
  }
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return response.status(400).json({ message: "to 必須是 YYYY-MM-DD 格式。" });
  }

  try {
    // Flexisip Admin Statistics uses "by" for granularity and "contacts_list" for contact list filtering.
    const flexisipResponse = await getCallsStatistics({ from, to, period, contactList });
    const contentType = flexisipResponse.headers.get("content-type") || "";
    console.log("Flexisip calls statistics response:", {
      status: flexisipResponse.status,
      contentType,
    });

    if (!flexisipResponse.ok) {
      await flexisipResponse.text().catch(() => "");
      return response.status(502).json({
        success: false,
        error: "Flexisip Admin Statistics request failed",
        status: flexisipResponse.status,
        type: "calls",
        source: "flexisip-admin-statistics",
      });
    }

    if (contentType.includes("application/json")) {
      const data = await flexisipResponse.json();
      return response.json({
        success: true,
        type: "calls",
        from: from || null,
        to: to || null,
        period,
        contactList: contactList || null,
        data,
        source: "flexisip-admin-statistics",
        lastUpdatedAt: new Date().toISOString(),
      });
    }

    if (contentType.includes("text/html")) {
      await flexisipResponse.text().catch(() => "");
      return response.status(502).json({
        success: false,
        error: "Flexisip admin statistics returned HTML, JSON parsing is not implemented yet",
        type: "calls",
        source: "flexisip-admin-statistics",
      });
    }

    if (contentType.includes("text/csv")) {
      await flexisipResponse.text().catch(() => "");
      return response.status(502).json({
        success: false,
        error: "Flexisip admin statistics returned CSV, export handling is not implemented on this endpoint",
        type: "calls",
        source: "flexisip-admin-statistics",
      });
    }

    const text = await flexisipResponse.text();
    if (!text.trim()) {
      return response.status(502).json({
        success: false,
        error: "Flexisip admin statistics returned an empty response",
        type: "calls",
        source: "flexisip-admin-statistics",
      });
    }

    try {
      const data = JSON.parse(text);
      return response.json({
        success: true,
        type: "calls",
        from: from || null,
        to: to || null,
        period,
        contactList: contactList || null,
        data,
        source: "flexisip-admin-statistics",
        lastUpdatedAt: new Date().toISOString(),
      });
    } catch {
      return response.status(502).json({
        success: false,
        error: "Flexisip admin statistics returned an unsupported response format",
        type: "calls",
        source: "flexisip-admin-statistics",
      });
    }
  } catch (error) {
    if (error instanceof FlexisipAdminSessionError) {
      console.error("Flexisip Admin session error:", {
        status: error.status,
        path: error.path,
        contentType: error.contentType,
        message: error.message,
      });
      return response.status(502).json({
        success: false,
        error: "Flexisip Admin session request failed",
        type: "calls",
        source: "flexisip-admin-statistics",
      });
    }

    console.error("Failed to fetch Flexisip calls statistics:", error?.message || error);
    return response.status(502).json({
      success: false,
      error: "Flexisip Admin Statistics request failed",
      type: "calls",
      source: "flexisip-admin-statistics",
    });
  }
});

// GET /api/admin/flexisip/remote-accounts-not-local - 取得 Flexisip 中不在本地数据库的帳號列表
app.get("/api/admin/flexisip/remote-accounts-not-local", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以查詢 Flexisip 遠端帳號。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();

    // Get all local SIP URIs and flexisip_account_ids
    const localRows = await connection.query(
      `SELECT id, flexisip_account_id, sip_uri, username, sip_domain FROM sip_users`
    );
    const localSipUris = new Set();
    const localFlexisipIds = new Set();
    for (const r of localRows) {
      if (r.flexisip_account_id) localFlexisipIds.add(String(r.flexisip_account_id));
      const sipUri = r.sip_uri || `sip:${r.username}@${r.sip_domain || 'sip.qrtalkie.org'}`;
      localSipUris.add(sipUri);
    }

    // Fetch ALL remote Flexisip accounts: Account Manager (paginated) + Redis supplement
    let remoteAccounts = [];
    try {
      // First, get ALL Account Manager accounts via pagination
      const amAccountsMap = new Map(); // keyed by SIP URI
      const AM_PAGE_SIZE = 20; // Account Manager defaults to 20 per page
      let page = 1;
      while (true) {
        const raw = await flexisipListAccounts({ page: String(page) });
        let pageAccounts;
        if (Array.isArray(raw)) {
          pageAccounts = raw;
        } else if (raw && typeof raw === 'object') {
          pageAccounts = raw.accounts || raw.data || raw.results || raw.items || [];
        } else {
          break;
        }
        if (!pageAccounts || pageAccounts.length === 0) break;

        for (const acc of pageAccounts) {
          const role = String(acc.role || 'user').toLowerCase();
          if (role === 'admin') continue; // skip admin accounts
          const sip = acc.sip || `sip:${acc.username}@${acc.domain || sipDomain}`;
          if (!amAccountsMap.has(sip)) {
            amAccountsMap.set(sip, {
              id: acc.id,
              username: acc.username || '',
              domain: acc.domain || (acc.sip ? acc.sip.split('@')[1] || sipDomain : sipDomain),
              sip,
              displayName: acc.display_name || '',
              email: acc.email || '',
              phone: acc.phone || '',
              role: acc.role || 'user',
              activated: !!acc.activated,
            });
          }
        }
        console.log(`[flexisip-import] AM page ${page}: ${pageAccounts.length} accounts (total: ${amAccountsMap.size})`);
        if (pageAccounts.length < AM_PAGE_SIZE) break;
        page++;
      }

      // Supplement with Redis accounts not in Account Manager
      try {
        const redisResult = await discoverAccountsFromRedis({ includeContacts: false, domain: sipDomain });
        const redisItems = redisResult.items || [];
        let redisAdded = 0;
        for (const item of redisItems) {
          const sipUri = item.sipUri || `sip:${item.username}@${item.domain || sipDomain}`;
          if (!amAccountsMap.has(sipUri)) {
            amAccountsMap.set(sipUri, {
              id: item.id || sipUri,
              username: item.username,
              domain: item.domain,
              sip: sipUri,
              displayName: item.displayName || '',
              email: '',
              phone: '',
              role: 'user',
              activated: item.status === 'online',
            });
            redisAdded++;
          }
        }
        console.log(`[flexisip-import] Redis supplement: ${redisItems.length} discovered, ${redisAdded} new`);
      } catch (err) {
        console.log('[flexisip-import] Redis unavailable, using AM-only data');
      }

      remoteAccounts = Array.from(amAccountsMap.values());
      console.log('[flexisip-import] total remote accounts:', remoteAccounts.length);
    } catch (err) {
      console.error("Failed to discover Flexisip accounts:", err);
      return response.status(502).json({ message: "無法連線 Flexisip。" });
    }

    // Map all accounts with existsLocally flag
    console.log(`[flexisip-import] total remote: ${remoteAccounts.length}, local known ids: ${localFlexisipIds.size}, local known uris: ${localSipUris.size}`);
    if (remoteAccounts.length > 0) {
      console.log('[flexisip-import] first account keys:', Object.keys(remoteAccounts[0]).slice(0, 10));
    }

    const accounts = remoteAccounts.map(acc => {
      const accId = String(acc.id || '');
      const sipUri = acc.sip || '';
      const existsLocally = localFlexisipIds.has(accId) || localSipUris.has(sipUri);
      return {
        id: acc.id,
        username: acc.username || '',
        sip: acc.sip || '',
        domain: acc.domain || (acc.sip ? acc.sip.split('@')[1] : ''),
        displayName: acc.display_name || '',
        email: acc.email || '',
        phone: acc.phone || '',
        role: acc.role || 'user',
        activated: !!acc.activated,
        existsLocally,
      };
    });

    const notLocalCount = accounts.filter(a => !a.existsLocally).length;
    return response.json({ accounts, total: accounts.length, notLocalCount });
  } catch (err) {
    console.error("Failed to fetch remote accounts:", err);
    return response.status(500).json({ message: "獲取遠端帳號列表失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/admin/flexisip/import-remote-accounts - 批量导入 Flexisip 远端帳號到本地
app.post("/api/admin/flexisip/import-remote-accounts", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以匯入 Flexisip 遠端帳號。" });
  }
  const { accountIds } = request.body || {};
  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return response.status(400).json({ message: "請選擇至少一個要匯入的帳號。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // Fetch remote account details for each selected ID
    const results = { success: 0, fail: 0, errors: [] };

    for (const accId of accountIds) {
      let remoteAcc;
      try {
        remoteAcc = await flexisipGetAccount(accId);
      } catch (err) {
        results.fail++;
        results.errors.push(`ID ${accId}: 無法獲取遠端帳號資訊`);
        continue;
      }

      if (!remoteAcc) {
        results.fail++;
        results.errors.push(`ID ${accId}: 遠端帳號不存在`);
        continue;
      }

      const username = remoteAcc.username || (remoteAcc.sip ? remoteAcc.sip.replace(/^sip:/, '').split('@')[0] : '');
      const sipDomain = remoteAcc.domain || (remoteAcc.sip ? remoteAcc.sip.split('@')[1] || 'sip.qrtalkie.org' : 'sip.qrtalkie.org');
      const sipUri = remoteAcc.sip || `sip:${username}@${sipDomain}`;
      const activated = !!(remoteAcc.activated === true || remoteAcc.activated === 1 || remoteAcc.activated === '1');
      const accStatus = activated ? 'active' : 'disabled';
      const accSyncStatus = activated ? 'active' : 'disabled';

      try {
        // Check if already exists locally
        const [existing] = await connection.query(
          `SELECT id FROM sip_users WHERE flexisip_account_id = ? OR sip_uri = ? OR (username = ? AND sip_domain = ?) LIMIT 1`,
          [String(accId), sipUri, username, sipDomain]
        );
        if (existing) {
          results.fail++;
          results.errors.push(`${username}@${sipDomain}: 該帳號已存在於本地資料庫`);
          continue;
        }

        // Insert into sip_users
        // Set a default initial password for local SaaS login
        const initialPassword = process.env.SIP_IMPORT_DEFAULT_PASSWORD || '123456';
        const hashedPassword = await hashPassword(initialPassword);
        const insertResult = await connection.query(
          `INSERT INTO sip_users (username, sip_domain, password_hash, display_name, email, phone_number, role, status,
           flexisip_account_id, sip_uri, sync_status, created_in_flexisip_at, created_by_admin_user_id,
           created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW(), NOW())`,
          [
            username,
            sipDomain,
            hashedPassword,
            remoteAcc.display_name || '',
            remoteAcc.email || '',
            remoteAcc.phone || '',
            remoteAcc.role || 'user',
            accStatus,
            String(accId),
            sipUri,
            accSyncStatus,
            request.admin.id,
          ]
        );

        results.success++;
      } catch (err) {
        results.fail++;
        results.errors.push(`${username}@${sipDomain}: ${err.message || '導入失敗'}`);
      }
    }

    return response.json(results);
  } catch (err) {
    console.error("Failed to import remote accounts:", err);
    return response.status(500).json({ message: "匯入遠端帳號失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/flexisip/accounts/tombstones/release - release a deleted Flexisip username reservation.
app.post("/api/flexisip/accounts/tombstones/release", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有平臺超級管理員可以釋放已刪除的服務端使用者名稱。" });
  }

  const username = sanitizeString(request.body?.username, 64);
  const domain = sanitizeString(request.body?.domain, 64);
  const reason = sanitizeString(request.body?.reason, 500);

  if (!username || !domain) {
    return response.status(400).json({
      message: "username 和 domain 為必填項。",
      code: "FLEXISIP_TOMBSTONE_INVALID_INPUT",
    });
  }
  if (!reason) {
    return response.status(400).json({
      message: "請填寫釋放已刪除使用者名稱的原因。",
      code: "FLEXISIP_TOMBSTONE_REASON_REQUIRED",
    });
  }

  try {
    const result = await releaseAccountTombstone({ username, domain });
    console.warn("Flexisip account tombstone release requested:", {
      adminId: request.admin.id,
      username,
      domain,
      released: result.released,
      reason,
    });

    if (!result.released) {
      return response.status(404).json({
        success: false,
        code: "FLEXISIP_TOMBSTONE_NOT_FOUND",
        ...result,
      });
    }

    return response.json({
      success: true,
      code: "FLEXISIP_TOMBSTONE_RELEASED",
      ...result,
    });
  } catch (error) {
    if (error instanceof FlexisipTombstoneError) {
      console.error("Failed to release Flexisip account tombstone:", {
        code: error.code,
        status: error.status,
        message: error.message,
        username,
        domain,
      });
      return response.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    console.error("Unexpected Flexisip tombstone release error:", error?.message || error);
    return response.status(500).json({
      success: false,
      code: "FLEXISIP_TOMBSTONE_RELEASE_FAILED",
      message: "釋放已刪除的服務端使用者名稱失敗。",
    });
  }
});

// POST /api/flexisip/accounts/tombstones/batch-release - 批量释放已刪除的 Flexisip 用户名
app.post("/api/flexisip/accounts/tombstones/batch-release", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform' || request.admin.platformRole !== "super_admin") {
    return response.status(403).json({ message: "只有平臺超級管理員可以釋放已刪除的服務端使用者名稱。" });
  }

  const items = request.body?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
    return response.status(400).json({ message: "items 必須是 1-200 條記錄。" });
  }

  const reason = sanitizeString(request.body?.reason, 500) || '批次釋放';

  const results = [];
  for (const item of items) {
    const username = sanitizeString(item?.username, 64);
    const domain = sanitizeString(item?.domain, 64);
    if (!username || !domain) {
      results.push({ username, domain, released: false, error: '缺少 username 或 domain' });
      continue;
    }
    try {
      const r = await releaseAccountTombstone({ username, domain });
      results.push({ username, domain, released: r.released, ...r });
    } catch (e) {
      results.push({ username, domain, released: false, error: e?.message });
    }
  }

  console.warn("Flexisip batch tombstone release:", { adminId: request.admin.id, total: items.length, released: results.filter(r => r.released).length, reason });
  return response.json({ results });
});

// GET /api/platform/stats - platform communication & operation stats
app.get("/api/platform/stats", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ message: "只有平臺管理員可以檢視平臺統計。" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const [sipCreated] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE status = 'active'");
    const [sipAssigned] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_sip_account_entitlements WHERE status = 'active' AND service_expires_at >= CURDATE()");
    const [webCreated] = await connection.query("SELECT COUNT(*) AS cnt FROM web_users WHERE status = 'active'");
    const [webAssigned] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_web_account_entitlements WHERE status = 'active' AND service_expires_at >= CURDATE()");
    const [tenantCount] = await connection.query("SELECT COUNT(*) AS cnt FROM tenants WHERE status = 'active'");
    const [orderCount] = await connection.query("SELECT COUNT(*) AS cnt FROM billing_orders WHERE order_status = 'review_approved'");
    const [pendingReviewCount] = await connection.query("SELECT COUNT(*) AS cnt FROM billing_orders WHERE order_status = 'pending_review'");
    const [pendingPaymentCount] = await connection.query("SELECT COUNT(*) AS cnt FROM billing_orders WHERE payment_status = 'unpaid' AND order_status = 'review_approved'");
    const [paidTotal] = await connection.query("SELECT COALESCE(SUM(payment_amount), 0) AS total FROM billing_payments WHERE payment_status = 'paid'");
    const [ecardCount] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards WHERE status = 'active'");
    const [deviceCount] = await connection.query("SELECT COUNT(*) AS cnt FROM gate_devices WHERE assignment_status = 'assigned'");
    const [communityCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_communities WHERE is_active = 1");
    const [roomCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_rooms");
    const [topPlan] = await connection.query(
      "SELECT i.item_name, COUNT(*) AS cnt FROM billing_order_items i JOIN billing_orders o ON o.id = i.order_id WHERE i.item_type = 'plan' AND o.order_status = 'review_approved' GROUP BY i.item_name ORDER BY cnt DESC LIMIT 1"
    );
    const [bottomPlan] = await connection.query(
      "SELECT i.item_name, COUNT(*) AS cnt FROM billing_order_items i JOIN billing_orders o ON o.id = i.order_id WHERE i.item_type = 'plan' AND o.order_status = 'review_approved' GROUP BY i.item_name ORDER BY cnt ASC LIMIT 1"
    );

    // 近7日数据
    const tenantTrend = await connection.query(
      "SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date, COUNT(*) AS cnt FROM tenants WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY date ORDER BY date ASC"
    );
    const paymentTrend = await connection.query(
      "SELECT DATE_FORMAT(paid_at, '%Y-%m-%d') AS date, COALESCE(SUM(payment_amount), 0) AS total FROM billing_payments WHERE payment_status = 'paid' AND paid_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY date ORDER BY date ASC"
    );

    return response.json({
      sipCreated: Number(sipCreated.cnt),
      sipAssigned: Number(sipAssigned.cnt),
      webCreated: Number(webCreated.cnt),
      webAssigned: Number(webAssigned.cnt),
      tenantCount: Number(tenantCount.cnt),
      orderCount: Number(orderCount.cnt),
      pendingReviewCount: Number(pendingReviewCount.cnt),
      pendingPaymentCount: Number(pendingPaymentCount.cnt),
      paidTotal: Number(paidTotal.total),
      ecardCount: Number(ecardCount.cnt),
      deviceCount: Number(deviceCount.cnt),
      communityCount: Number(communityCount.cnt),
      roomCount: Number(roomCount.cnt),
      topPlan: topPlan?.item_name || "-",
      bottomPlan: bottomPlan?.item_name || "-",
      tenantTrend: tenantTrend.map(r => ({ date: r.date, count: Number(r.cnt) })),
      paymentTrend: paymentTrend.map(r => ({ date: r.date, amount: Number(r.total) })),
    });
  } catch (error) {
    console.error("Failed to fetch platform stats:", error);
    return response.status(500).json({ message: "讀取平臺統計失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/tenant/dashboard - tenant dashboard data (tenant admin only)
// GET /api/tenant/dashboard - tenant dashboard data (tenant admin only)
app.get("/api/tenant/dashboard", requireAdmin, async (request, response) => {
  if (request.admin.accountType === 'platform') {
    return response.status(403).json({ message: "平臺管理員請使用平臺概覽。" });
  }
  if (!request.admin.tenantId) {
    return response.status(403).json({ message: "只有租戶管理員可以檢視租戶概覽。" });
  }
  const tenantId = request.admin.tenantId;
  let connection;
  try {
    connection = await pool.getConnection();

    // Tenant info
    const [tenant] = await connection.query(
      "SELECT id, name, sip_domain, contact_person, contact_phone, contact_email, status, created_at FROM tenants WHERE id = ?", [tenantId]
    );
    if (!tenant) return response.status(404).json({ message: "租戶不存在。" });

    // Current plan
    const [plan] = await connection.query(
      "SELECT o.id, o.order_no, o.currency, o.payable_amount, DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at, DATE_FORMAT(o.created_at, '%Y-%m-%d') AS created_at, o.payment_method, i.account_quantity, i.item_name FROM billing_orders o JOIN billing_order_items i ON i.order_id = o.id AND i.item_type = 'plan' WHERE o.tenant_id = ? AND o.order_status = 'review_approved' ORDER BY o.expires_at DESC LIMIT 1",
      [tenantId]
    );
    const planAddons = plan ? await connection.query("SELECT i.item_name FROM billing_order_items i WHERE i.order_id = ? AND i.item_type = 'addon'", [plan.id]) : [];
    const planPayment = plan ? await connection.query("SELECT DATE_FORMAT(paid_at, '%Y-%m-%d') AS payment_date FROM billing_payments WHERE order_id = ? AND payment_status = 'paid' LIMIT 1", [plan.id]) : [];

    // Order list for plan history
    const orderList = await connection.query(
      "SELECT o.id, o.order_no, o.order_status, o.payable_amount, o.payment_method, o.payment_status, DATE_FORMAT(o.expires_at, '%Y-%m-%d') AS expires_at, i.item_name AS plan_name FROM billing_orders o JOIN billing_order_items i ON i.order_id = o.id AND i.item_type = 'plan' WHERE o.tenant_id = ? ORDER BY o.created_at DESC",
      [tenantId]
    );

    // SIP account counts
    const [sipTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE tenant_id = ?", [tenantId]);
    const [sipEnabled] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE tenant_id = ? AND status = 'active'", [tenantId]);
    const [sipNoDisplayName] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE tenant_id = ? AND (display_name IS NULL OR display_name = '' OR display_name = username)", [tenantId]);
    const [sipNoEmail] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users WHERE tenant_id = ? AND (email IS NULL OR email = '')", [tenantId]);
    const [sipExpired] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users su JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' WHERE su.tenant_id = ? AND e.service_expires_at < CURDATE()", [tenantId]);
    const [sipExpiring] = await connection.query("SELECT COUNT(*) AS cnt FROM sip_users su JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' WHERE su.tenant_id = ? AND e.service_expires_at >= CURDATE() AND e.service_expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)", [tenantId]);
    const sipTotalCount = Number(sipTotal.cnt);
    const sipEnabledCount = Number(sipEnabled.cnt);
    const sipNoDisplayNameCount = Number(sipNoDisplayName.cnt);
    const sipNoEmailCount = Number(sipNoEmail.cnt);
    const sipExpiredCount = Number(sipExpired.cnt);
    const sipExpiringCount = Number(sipExpiring.cnt);

    const sipAccountList = await connection.query(
      "SELECT su.id, su.username, su.display_name, su.email, su.phone_number, su.status, DATE_FORMAT(e.service_expires_at, '%Y-%m-%d') AS service_expires_at, wu.username AS web_account, tcb.name AS contact_book FROM sip_users su LEFT JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' LEFT JOIN tenant_web_account_entitlements we ON we.sip_user_id = su.id AND we.tenant_id = su.tenant_id AND we.status = 'active' LEFT JOIN web_users wu ON wu.id = we.web_user_id LEFT JOIN tenant_contact_book_assignments cba ON cba.sip_user_id = su.id AND cba.status != 'revoked' LEFT JOIN tenant_contact_books tcb ON tcb.id = cba.contact_book_id AND tcb.tenant_id = su.tenant_id WHERE su.tenant_id = ? ORDER BY su.created_at DESC",
      [tenantId]
    );

    // Ecard counts
    const [ecardTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards WHERE tenant_id = ?", [tenantId]);
    const [ecardActive] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards WHERE tenant_id = ? AND status = 'active'", [tenantId]);
    const [ecardConfigured] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards WHERE tenant_id = ? AND card_data_json IS NOT NULL", [tenantId]);
    const ecardTotalCount = Number(ecardTotal.cnt);
    const ecardActiveCount = Number(ecardActive.cnt);
    const ecardConfiguredCount = Number(ecardConfigured.cnt);
    const [ecardExpired] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards te JOIN sip_users su ON su.id = te.sip_user_id LEFT JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' WHERE te.tenant_id = ? AND e.service_expires_at IS NOT NULL AND e.service_expires_at < CURDATE()", [tenantId]);
    const [ecardExpiring] = await connection.query("SELECT COUNT(*) AS cnt FROM tenant_ecards te JOIN sip_users su ON su.id = te.sip_user_id LEFT JOIN tenant_sip_account_entitlements e ON e.sip_user_id = su.id AND e.tenant_id = su.tenant_id AND e.status = 'active' WHERE te.tenant_id = ? AND e.service_expires_at IS NOT NULL AND e.service_expires_at >= CURDATE() AND e.service_expires_at <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)", [tenantId]);
    const ecardExpiredCount = Number(ecardExpired.cnt);
    const ecardExpiringCount = Number(ecardExpiring.cnt);
    const ecardList = await connection.query("SELECT te.id, su.username AS sip_account, su.display_name AS user_name, wu.username AS web_account, te.status, DATE_FORMAT(COALESCE(te.valid_from, su.activated_at), '%Y-%m-%d') AS valid_from, DATE_FORMAT(COALESCE(te.valid_to, su.service_expires_at), '%Y-%m-%d') AS valid_to, DATE_FORMAT(te.created_at, '%Y-%m-%d') AS created_at FROM tenant_ecards te JOIN sip_users su ON su.id = te.sip_user_id LEFT JOIN tenant_web_account_entitlements we ON we.sip_user_id = su.id AND we.tenant_id = su.tenant_id AND we.status = 'active' LEFT JOIN web_users wu ON wu.id = we.web_user_id WHERE te.tenant_id = ? ORDER BY te.created_at DESC",  [tenantId]);

    // Device counts
    const [deviceTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM gate_devices WHERE tenant_id = ?", [tenantId]);
    const [deviceOnline] = await connection.query("SELECT COUNT(*) AS cnt FROM gate_devices WHERE tenant_id = ? AND assignment_status = 'assigned'", [tenantId]);
    const deviceTotalCount = Number(deviceTotal.cnt);
    const deviceOnlineCount = Number(deviceOnline.cnt);

    // Community & room counts
    const [communityCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_communities WHERE tenant_id = ? AND is_active = 1", [tenantId]);
    const [roomCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_rooms WHERE tenant_id = ?", [tenantId]);
    const [buildingCount] = await connection.query("SELECT COUNT(*) AS cnt FROM access_buildings WHERE tenant_id = ?", [tenantId]);
    const [entranceTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM access_entrances WHERE tenant_id = ?", [tenantId]);
    const [entranceBound] = await connection.query("SELECT COUNT(*) AS cnt FROM access_entrances WHERE tenant_id = ? AND device_id IS NOT NULL", [tenantId]);
    const communityList = await connection.query("SELECT id, name, address, is_active, DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at FROM access_communities WHERE tenant_id = ? ORDER BY created_at DESC",  [tenantId]);

    // Call center stats
    const [ccTotal] = await connection.query("SELECT COUNT(*) AS cnt FROM call_centers WHERE tenant_id = ?", [tenantId]);
    const [ccActive] = await connection.query("SELECT COUNT(*) AS cnt FROM call_centers WHERE tenant_id = ? AND status = 'active'", [tenantId]);
    const [ccDisabled] = await connection.query("SELECT COUNT(*) AS cnt FROM call_centers WHERE tenant_id = ? AND status = 'disabled'", [tenantId]);
    const [ccVisitor] = await connection.query("SELECT COUNT(*) AS cnt FROM call_centers WHERE tenant_id = ? AND require_visitor_info = 1", [tenantId]);
    const [ccAgents] = await connection.query("SELECT COUNT(*) AS cnt FROM call_center_category_agents WHERE tenant_id = ?", [tenantId]);
    const ccTotalCount = Number(ccTotal.cnt);
    const ccActiveCount = Number(ccActive.cnt);
    const ccDisabledCount = Number(ccDisabled.cnt);
    const ccVisitorCount = Number(ccVisitor.cnt);
    const ccAgentCount = Number(ccAgents.cnt);
    const ccList = await connection.query("SELECT cc.id, cc.center_name, cc.center_url, cc.require_visitor_info, cc.status, DATE_FORMAT(cc.created_at, '%Y-%m-%d') AS created_at, COUNT(ca.id) AS agent_count FROM call_centers cc LEFT JOIN call_center_category_agents ca ON ca.call_center_id = cc.id WHERE cc.tenant_id = ? GROUP BY cc.id ORDER BY cc.created_at DESC",  [tenantId]);
    
    const [todayCalls] = await connection.query("SELECT COUNT(*) AS cnt FROM call_center_visitor_inquiries WHERE tenant_id = ? AND DATE(created_at) = CURDATE()", [tenantId]);
    const [monthCalls] = await connection.query("SELECT COUNT(*) AS cnt FROM call_center_visitor_inquiries WHERE tenant_id = ? AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())", [tenantId]);
const callTrend = await connection.query("SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS date, COUNT(*) AS cnt FROM call_center_visitor_inquiries WHERE tenant_id = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY date ORDER BY date ASC", [tenantId]);

    // Last login
    const [lastLogin] = await connection.query("SELECT last_login_at FROM admin_users WHERE tenant_id = ? AND account_type = 'tenant' ORDER BY last_login_at DESC LIMIT 1", [tenantId]);

    // Plan usage limits
    const planLimit = (plan && plan.item_name && plan.item_name.includes('Pro')) ? { sip: 5000, device: 500, community: 100, room: 10000 } : { sip: 1000, device: 100, community: 20, room: 500 };

    // Recent call records
    const recentCalls = await connection.query(
      "SELECT vi.created_at, vi.sip_number AS caller_number, vi.visitor_phone AS callee_number, vi.inquiry_status AS status FROM call_center_visitor_inquiries vi WHERE vi.tenant_id = ? ORDER BY vi.created_at DESC LIMIT 4",
      [tenantId]
    );

    // Device alerts (mock for now)
    const alerts = [];

    return response.json(bigIntSafe({
      tenant: {
        id: Number(tenant.id),
        name: tenant.name || "",
        sipDomain: tenant.sip_domain || "",
        contactPerson: tenant.contact_person || "",
        contactPhone: tenant.contact_phone || "",
        contactEmail: tenant.contact_email || "",
        status: tenant.status || 'active',
        createdAt: tenant.created_at || null,
        lastLoginAt: lastLogin?.last_login_at || null,
      },
      plan: plan ? {
        orderNo: plan.order_no,
        planName: plan.item_name || "-",
        accountQuantity: plan.account_quantity || 0,
        addonNames: planAddons.map(a => a.item_name).join("、") || "-",
        payableAmount: Number(plan.payable_amount || 0),
        paymentMethod: plan.payment_method === 'offline' ? '線下支付' : plan.payment_method === 'online' ? '線上支付' : '-',
        paymentDate: (planPayment[0] && planPayment[0].payment_date) || "-",
        createdAt: plan.created_at || "-",
        expiresAt: plan.expires_at || null,
        daysLeft: plan.expires_at ? Math.max(0, Math.ceil((new Date(plan.expires_at + 'T00:00:00') - new Date()) / 86400000)) : 0,
        status: plan.expires_at && new Date(plan.expires_at + 'T00:00:00') > new Date() ? 'active' : "expired",
      } : null,
      orderList: orderList.map(o => ({
        id: Number(o.id),
        orderNo: o.order_no || "-",
        planName: o.plan_name || "-",
        orderStatus: o.order_status || "-",
        paymentStatus: o.payment_status || "-",
        payableAmount: Number(o.payable_amount || 0),
        expiresAt: o.expires_at || "-",
      })),
      sipAccounts: {
        total: sipTotalCount,
        enabled: sipEnabledCount,
        noDisplayName: sipNoDisplayNameCount,
        noEmail: sipNoEmailCount,
        expired: sipExpiredCount,
        expiring: sipExpiringCount,
        limit: planLimit.sip,
        list: sipAccountList.map(a => ({ id: Number(a.id), username: a.username, displayName: a.display_name, email: a.email, phone: a.phone_number, status: a.status, webAccount: a.web_account || '-', contactBook: a.contact_book || '-', expiresAt: a.service_expires_at || null })),
      },
      ecards: {
        total: ecardTotalCount,
        configured: ecardConfiguredCount,
        unconfigured: ecardTotalCount - ecardConfiguredCount,
        active: ecardActiveCount,
        expired: ecardExpiredCount,
        expiring: ecardExpiringCount,
        list: ecardList.map(e => ({ id: Number(e.id), sipAccount: e.sip_account, userName: e.user_name, webAccount: e.web_account || "-", status: e.status, validFrom: e.valid_from, validTo: e.valid_to, createdAt: e.created_at })),
      },
      devices: {
        total: deviceTotalCount,
        online: deviceOnlineCount,
        offline: deviceTotalCount - deviceOnlineCount,
        onlineRate: deviceTotalCount > 0 ? Math.round((deviceOnlineCount / deviceTotalCount) * 1000) / 10 : 0,
        limit: planLimit.device,
      },
      buildings: {
        communities: Number(communityCount.cnt),
        buildings: Number(buildingCount.cnt),
        rooms: Number(roomCount.cnt),
        entrances: Number(entranceTotal.cnt),
        entranceBound: Number(entranceBound.cnt),
        devices: deviceTotalCount,
        deviceBound: deviceOnlineCount,
        limit: planLimit.community,
        roomLimit: planLimit.room,
        list: communityList.map(r => ({ id: Number(r.id), name: r.name, address: r.address, isActive: r.is_active === 1, createdAt: r.created_at })),
      },
      callCenter: {
        total: ccTotalCount,
        active: ccActiveCount,
        disabled: ccDisabledCount,
        visitorEnabled: ccVisitorCount,
        expiring: 0,
        agents: ccAgentCount,
        list: ccList.map(r => ({ id: Number(r.id), name: r.center_name, url: r.center_url, visitorEnabled: r.require_visitor_info === 1, status: r.status, agentCount: Number(r.agent_count), createdAt: r.created_at })),
        todayCalls: Number(todayCalls.cnt),
        monthCalls: Number(monthCalls.cnt),
        callTrend: callTrend.map(r => ({ date: r.date, count: Number(r.cnt) })),
        recentCalls: recentCalls.map(c => ({
          time: c.created_at ? String(c.created_at).slice(11, 16) : "-",
          caller: c.caller_number || "-",
          callee: c.callee_number || "-",
          status: c.status || "completed",
        })),
      },
      alerts: alerts,
      cloudStorage: { used: 128, limit: 500 },
    }));
  } catch (error) {
    console.error("Failed to fetch tenant dashboard:", error);
    return response.status(500).json({ message: "讀取租戶概覽失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/chatroom/ephemeral-policy — 设置/更新聊天室阅后即焚策略
app.post("/api/chatroom/ephemeral-policy", async (request, response) => {
  const chatroomSipUri = sanitizeString(String(request.body?.chatroomSipUri || ""), 512);
  const senderUsername = sanitizeString(String(request.body?.senderUsername || ""), 120);
  const enabled = request.body?.enabled ? 1 : 0;
  const lifetimeSeconds = parseNonNegativeInteger(request.body?.lifetimeSeconds, 60);
  const setByUsername = sanitizeString(String(request.body?.setByUsername || senderUsername), 120);

  if (!chatroomSipUri || !senderUsername) {
    return response.status(400).json({ message: "缺少必要引數。" });
  }
  if (lifetimeSeconds < 1 || lifetimeSeconds > 604800) {
    if (enabled) {
      return response.status(400).json({ message: "lifetimeSeconds 必須在 1-604800 之間。" });
    }
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      `INSERT INTO chatroom_ephemeral_policy (chatroom_sip_uri, sender_username, enabled, lifetime_seconds, set_by_username, policy_version, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW())
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         lifetime_seconds = VALUES(lifetime_seconds),
         set_by_username = VALUES(set_by_username),
         policy_version = policy_version + 1,
         updated_at = NOW()`,
      [chatroomSipUri, senderUsername, enabled, lifetimeSeconds, setByUsername],
    );

    const [row] = await connection.query(
      "SELECT policy_version, updated_at FROM chatroom_ephemeral_policy WHERE chatroom_sip_uri = ? AND sender_username = ?",
      [chatroomSipUri, senderUsername],
    );

    return response.json({
      chatroomSipUri,
      senderUsername,
      enabled: enabled === 1,
      lifetimeSeconds,
      setByUsername,
      policyVersion: row.policy_version,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error("Failed to save ephemeral policy:", error);
    return response.status(500).json({ message: "儲存閱後即焚策略失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/chatroom/ephemeral-policy — 查询聊天室策略
app.get("/api/chatroom/ephemeral-policy", async (request, response) => {
  const chatroomSipUri = sanitizeString(String(request.query?.chatroom || ""), 512);
  const senderUsername = sanitizeString(String(request.query?.sender || ""), 120);
  if (!chatroomSipUri || !senderUsername) {
    return response.status(400).json({ message: "缺少 chatroom 或 sender 引數。" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [row] = await connection.query(
      "SELECT * FROM chatroom_ephemeral_policy WHERE chatroom_sip_uri = ? AND sender_username = ?",
      [chatroomSipUri, senderUsername],
    );

    if (!row) {
      return response.json({ chatroomSipUri, senderUsername, enabled: false, lifetimeSeconds: 60, policyVersion: 0 });
    }

    return response.json({
      chatroomSipUri: row.chatroom_sip_uri,
      senderUsername: row.sender_username,
      enabled: row.enabled === 1,
      lifetimeSeconds: row.lifetime_seconds,
      setByUsername: row.set_by_username,
      policyVersion: row.policy_version,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error("Failed to fetch ephemeral policy:", error);
    return response.status(500).json({ message: "查詢閱後即焚策略失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/chatroom/policies — 批量同步策略
app.get("/api/chatroom/policies", async (request, response) => {
  const chatroomSipUri = sanitizeString(String(request.query?.chatroom || ""), 512);

  let connection;
  try {
    connection = await pool.getConnection();
    let rows;
    if (chatroomSipUri) {
      rows = await connection.query(
        "SELECT * FROM chatroom_ephemeral_policy WHERE chatroom_sip_uri = ? ORDER BY sender_username",
        [chatroomSipUri],
      );
    } else {
      rows = await connection.query(
        "SELECT * FROM chatroom_ephemeral_policy ORDER BY updated_at DESC LIMIT 200",
      );
    }

    const policies = rows.map(row => ({
      chatroomSipUri: row.chatroom_sip_uri,
      senderUsername: row.sender_username,
      enabled: row.enabled === 1,
      lifetimeSeconds: row.lifetime_seconds,
      setByUsername: row.set_by_username,
      policyVersion: row.policy_version,
      updatedAt: row.updated_at,
    }));

    return response.json({ policies });
  } catch (error) {
    console.error("Failed to fetch ephemeral policies:", error);
    return response.status(500).json({ message: "批次查詢策略失敗。" });
  } finally {
    if (connection) connection.release();
  }
});

// ── AI Chat Bot API ──────────────────────────────────────────────

// POST /api/ai/chat/session — 创建或获取默认 AI 会话
app.post("/api/ai/chat/session", requireSipUser, async (request, response) => {
  const sipUserId = request.admin.id;
  let connection;
  try {
    connection = await pool.getConnection();
    await ensureAiAllowed(sipUserId, connection);
    const session = await getOrCreateSession(sipUserId, connection);
    return response.json({
      sessionId: Number(session.id),
      title: session.title,
      status: session.status,
      createdAt: session.created_at,
    });
  } catch (error) {
    if (error instanceof AiError) {
      return response.status(error.statusCode).json(error.toJSON());
    }
    console.error("Failed to create AI session:", error);
    return response.status(500).json({ message: "建立會話失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/ai/chat/sessions/:id/messages — 获取历史消息
app.get("/api/ai/chat/sessions/:id/messages", requireSipUser, async (request, response) => {
  const sipUserId = request.admin.id;
  const sessionId = parseInt(request.params.id, 10);
  if (!sessionId) return response.status(400).json({ message: "無效的會話 ID" });

  let connection;
  try {
    connection = await pool.getConnection();
    await ensureAiAllowed(sipUserId, connection);
    const messages = await getMessages(sessionId, sipUserId, connection);
    if (messages === null) {
      return response.status(404).json({ message: "會話不存在" });
    }
    return response.json({ messages });
  } catch (error) {
    if (error instanceof AiError) {
      return response.status(error.statusCode).json(error.toJSON());
    }
    console.error("Failed to fetch AI messages:", error);
    return response.status(500).json({ message: "獲取訊息失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/ai/chat/sessions/:id/messages — 发送消息并获取 AI 回复
app.post("/api/ai/chat/sessions/:id/messages", requireSipUser, async (request, response) => {
  const sipUserId = request.admin.id;
  const sessionId = parseInt(request.params.id, 10);
  const content = sanitizeString(String(request.body?.content || ""), 2000);

  if (!sessionId) return response.status(400).json({ message: "無效的會話 ID" });
  if (!content) return response.status(400).json({ message: "訊息不能為空" });

  let connection;
  try {
    connection = await pool.getConnection();
    await ensureAiAllowed(sipUserId, connection);
    const result = await sendMessage(sessionId, sipUserId, content, connection);

    if (result.error) {
      const statusCode = result.error === "AI_SESSION_NOT_FOUND" ? 404
        : result.error === "AI_EMPTY_MESSAGE" ? 400 : 500;
      return response.status(statusCode).json({ ok: false, error: result.error, message: result.message });
    }

    return response.json({ ok: true, message: result.message });
  } catch (error) {
    if (error instanceof AiError) {
      return response.status(error.statusCode).json(error.toJSON());
    }
    console.error("Failed to send AI message:", error);
    return response.status(500).json({ message: "傳送訊息失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/ai/chat/sessions/:id/messages — 清空会话消息
app.delete("/api/ai/chat/sessions/:id/messages", requireSipUser, async (request, response) => {
  const sipUserId = request.admin.id;
  const sessionId = parseInt(request.params.id, 10);
  if (!sessionId) return response.status(400).json({ message: "無效的會話 ID" });

  let connection;
  try {
    connection = await pool.getConnection();
    await ensureAiAllowed(sipUserId, connection);
    const [session] = await connection.query(
      `SELECT id FROM ai_bot_sessions WHERE id = ? AND owner_sip_user_id = ? LIMIT 1`,
      [sessionId, sipUserId]
    );
    if (!session) return response.status(404).json({ message: "會話不存在" });

    await connection.query(`DELETE FROM ai_bot_messages WHERE session_id = ?`, [sessionId]);
    return response.json({ ok: true, sessionId: Number(session.id), cleared: true });
  } catch (error) {
    if (error instanceof AiError) return response.status(error.statusCode).json(error.toJSON());
    console.error("Failed to clear AI messages:", error);
    return response.status(500).json({ message: "清空訊息失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/ai/chat/sessions/:id — 删除会话
app.delete("/api/ai/chat/sessions/:id", requireSipUser, async (request, response) => {
  const sipUserId = request.admin.id;
  const sessionId = parseInt(request.params.id, 10);
  if (!sessionId) return response.status(400).json({ message: "無效的會話 ID" });

  let connection;
  try {
    connection = await pool.getConnection();
    await ensureAiAllowed(sipUserId, connection);
    const deleted = await deleteSession(sessionId, sipUserId, connection);
    if (!deleted) return response.status(404).json({ message: "會話不存在" });
    return response.json({ ok: true });
  } catch (error) {
    if (error instanceof AiError) {
      return response.status(error.statusCode).json(error.toJSON());
    }
    console.error("Failed to delete AI session:", error);
    return response.status(500).json({ message: "刪除會話失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// ── 门禁设备 API ─────────────────────────────────────────────

// POST /api/external-api/get-door-info — 获取账号当前授权可用的门锁列表
// 返回按社区分组的门锁：社区级门锁 + 社区内每栋楼宇的门锁
// 认证方式与原 cc 接口一致（公开接口，按 sipAccount 查询）
app.post("/api/external-api/get-door-info", async (request, response) => {
  const sipAccount = sanitizeString(String(request.query.sipAccount || ""), 120);
  if (!sipAccount) {
    return response.status(400).json({ success: false, message: "Missing SIP accont info" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT
         d.device_uuid AS lock_id,
         d.relay_id,
         d.subscribe_topic,
         d.publish_topic,
         e.name AS entrance_name,
         e.building_id,
         b.name AS building_name,
         COALESCE(e.community_id, b.community_id) AS community_id,
         c.name AS community_name
       FROM sip_users s
       JOIN access_rooms r ON r.sip_user_id = s.id
       JOIN access_room_entrance_auth a ON a.room_id = r.id
       JOIN access_entrances e ON e.id = a.entrance_id AND e.is_active = 1
       JOIN gate_devices d ON d.id = e.device_id AND d.assignment_status = 'assigned'
       LEFT JOIN access_buildings b ON b.id = e.building_id
       LEFT JOIN access_communities c ON c.id = COALESCE(e.community_id, b.community_id)
       WHERE s.username = ?`,
      [sipAccount]
    );

    if (!rows.length) {
      return response.status(404).json({ message: "Not found staff or room for given sip account" });
    }

    // 分组：社区 → communityLocks（社区级门锁） + buildings[].locks（楼宇门锁）
    const communityMap = new Map();
    for (const row of rows) {
      const lockEntry = {
        lockId: row.lock_id,
        entranceName: row.entrance_name,
        relayId: row.relay_id,
        publicSubject: row.publish_topic,
        subscriptionSubject: row.subscribe_topic,
      };
      let community = communityMap.get(row.community_id);
      if (!community) {
        community = { communityName: row.community_name, communityLocks: [], buildings: [] };
        communityMap.set(row.community_id, community);
      }
      if (row.building_id == null) {
        // 社区级门锁（入口直接挂在社区上）
        if (!community.communityLocks.some((lock) => lock.lockId === lockEntry.lockId)) {
          community.communityLocks.push(lockEntry);
        }
      } else {
        // 楼宇门锁（入口挂在楼宇上）
        let building = community.buildings.find((b) => b.buildingName === row.building_name);
        if (!building) {
          building = { buildingName: row.building_name, locks: [] };
          community.buildings.push(building);
        }
        if (!building.locks.some((lock) => lock.lockId === lockEntry.lockId)) {
          building.locks.push(lockEntry);
        }
      }
    }

    return response.json({ communities: Array.from(communityMap.values()) });
  } catch (error) {
    console.error("[get-door-info] error:", error?.message || error);
    return response.status(500).json({ success: false, message: "Server error" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/external-api/device-status — 查询门禁设备在线状态（方案 A 缓存式）
// 状态由 SaaS 常驻 MQTT 客户端订阅设备主题并缓存（deviceMqttService）
app.get("/api/external-api/device-status", async (request, response) => {
  const lockId = sanitizeString(String(request.query.lockId || ""), 120);
  if (!lockId) {
    return response.status(400).json({ success: false, message: "Missing lockId" });
  }
  // 设备未上报过状态但存在订阅主题时仍返回 online=null（未知）
  const status = deviceMqttService.getStatus(lockId);
  return response.json({ success: true, data: status });
});

// GET /api/public/releases/check - App 版本检查（公开接口，无需认证）
// Linphone SDK 版本检查
// SDK 请求格式: GET {version_check_url_root}/{platform}/RELEASE
// SDK 期望响应格式: {version}\t{url}  （TAB 分隔的纯文本）
// SDK 内部自行比较版本号，无新版本时返回空文本即可
async function handleVersionCheck(request, response) {
  const platform = sanitizeString(String(request.params.platform || "android"), 20);

  let connection;
  try {
    connection = await pool.getConnection();
    const [latest] = await connection.query(
      `SELECT version, download_url
       FROM app_releases
       WHERE platform = ? AND status = 'published' AND released_at IS NOT NULL
       ORDER BY version_code DESC LIMIT 1`,
      [platform]
    );

    if (!latest) {
      return response.type("text/plain").send("");
    }

    // SDK 期望 TAB 分隔: version\turl
    return response.type("text/plain").send(`${latest.version}\t${latest.download_url}`);
  } catch (error) {
    console.error("Version check failed:", error);
    return response.type("text/plain").send("");
  } finally {
    if (connection) connection.release();
  }
}

// SDK 实际请求的 URL 格式: /releases/{platform}/RELEASE
app.get("/releases/:platform/RELEASE", handleVersionCheck);
// 兼容旧版查询参数格式
app.get("/api/public/releases/check", async (request, response) => {
  const currentVersion = sanitizeString(String(request.query.version || ""), 50);
  const platform = sanitizeString(String(request.query.platform || "android"), 20);
  if (!currentVersion) {
    return response.json({ update: false, message: "缺少 version 引數" });
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const [latest] = await connection.query(
      `SELECT version, version_code, download_url, file_size, sha256, release_notes
       FROM app_releases WHERE platform = ? AND status = 'published' AND released_at IS NOT NULL
       ORDER BY version_code DESC LIMIT 1`, [platform]
    );
    if (!latest) return response.json({ update: false, message: "暫無已釋出的版本" });
    const currentCode = parseVersionCode(currentVersion);
    if (latest.version_code > currentCode) {
      return response.json({ update: true, version: latest.version, versionCode: latest.version_code, url: latest.download_url, fileSize: latest.file_size, sha256: latest.sha256, notes: latest.release_notes || "" });
    }
    return response.json({ update: false, message: "已是最新版本" });
  } catch (error) {
    console.error("Version check failed:", error);
    return response.status(500).json({ update: false, message: "版本檢查失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// GET /api/admin/releases - 管理后台获取版本发布列表
app.get("/api/admin/releases", requireAdmin, async (request, response) => {
  if (!['platform', 'tenant'].includes(request.admin.accountType)) {
    return response.status(403).json({ code: -1, message: "僅管理員可檢視版本釋出" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT id, platform, version, version_code, download_url, file_size, sha256,
              release_notes, status, released_at, created_at, updated_at
       FROM app_releases
       ORDER BY version_code DESC`
    );
    return response.json({ code: 0, data: bigIntSafe(rows) });
  } catch (error) {
    console.error("Failed to fetch releases:", error);
    return response.status(500).json({ code: -1, message: "獲取版本列表失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// POST /api/admin/releases - 创建新版本发布
app.post("/api/admin/releases", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ code: -1, message: "僅平臺管理員可管理版本釋出" });
  }

  const { platform, version, versionCode, downloadUrl, fileSize, sha256, releaseNotes, status } = request.body || {};
  const p = sanitizeString(platform || "android", 32);
  const v = sanitizeString(version, 32);
  const vc = parseNonNegativeInteger(versionCode, 0);
  const url = sanitizeString(downloadUrl, 500);
  const notes = sanitizeString(releaseNotes || "", 5000);
  const s = sanitizeString(status || "draft", 16);

  if (!v || !url) {
    return response.status(400).json({ code: -1, message: "版本號和下載地址為必填項" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const result = await connection.query(
      `INSERT INTO app_releases (platform, version, version_code, download_url, file_size, sha256, release_notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [p, v, vc, url, fileSize || null, sha256 || null, notes || null, s]
    );
    return response.json({ code: 0, data: { id: Number(result.insertId) }, message: "版本釋出建立成功" });
  } catch (error) {
    console.error("Failed to create release:", error);
    return response.status(500).json({ code: -1, message: "建立版本釋出失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// PUT /api/admin/releases/:id - 更新版本发布
app.put("/api/admin/releases/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ code: -1, message: "僅平臺管理員可管理版本釋出" });
  }

  const id = parseNonNegativeInteger(request.params.id);
  if (!id) return response.status(400).json({ code: -1, message: "無效的版本 ID" });

  const { version, versionCode, downloadUrl, fileSize, sha256, releaseNotes, status, releasedAt } = request.body || {};
  const updates = [];
  const params = [];

  if (version !== undefined) { updates.push("version = ?"); params.push(sanitizeString(version, 32)); }
  if (versionCode !== undefined) { updates.push("version_code = ?"); params.push(parseNonNegativeInteger(versionCode, 0)); }
  if (downloadUrl !== undefined) { updates.push("download_url = ?"); params.push(sanitizeString(downloadUrl, 500)); }
  if (fileSize !== undefined) { updates.push("file_size = ?"); params.push(fileSize ? Number(fileSize) : null); }
  if (sha256 !== undefined) { updates.push("sha256 = ?"); params.push(sanitizeString(sha256, 64)); }
  if (releaseNotes !== undefined) { updates.push("release_notes = ?"); params.push(sanitizeString(releaseNotes, 5000)); }
  if (status !== undefined) { updates.push("status = ?"); params.push(sanitizeString(status, 16)); }
  if (releasedAt !== undefined) { updates.push("released_at = ?"); params.push(releasedAt || null); }

  if (updates.length === 0) {
    return response.status(400).json({ code: -1, message: "沒有需要更新的欄位" });
  }

  params.push(id);

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(`UPDATE app_releases SET ${updates.join(", ")} WHERE id = ?`, params);
    return response.json({ code: 0, message: "版本釋出更新成功" });
  } catch (error) {
    console.error("Failed to update release:", error);
    return response.status(500).json({ code: -1, message: "更新版本釋出失敗" });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE /api/admin/releases/:id - 删除版本发布
app.delete("/api/admin/releases/:id", requireAdmin, async (request, response) => {
  if (request.admin.accountType !== 'platform') {
    return response.status(403).json({ code: -1, message: "僅平臺管理員可管理版本釋出" });
  }

  const id = parseNonNegativeInteger(request.params.id);
  if (!id) return response.status(400).json({ code: -1, message: "無效的版本 ID" });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query("DELETE FROM app_releases WHERE id = ?", [id]);
    return response.json({ code: 0, message: "版本釋出已刪除" });
  } catch (error) {
    console.error("Failed to delete release:", error);
    return response.status(500).json({ code: -1, message: "刪除版本釋出失敗" });
  } finally {
    if (connection) connection.release();
  }
});

deviceMqttService.start();

app.listen(port, () => {
  console.log(`QRTalkie Cloud API listening on http://127.0.0.1:${port}`);
});
  startScheduler();
  startWebrtcPresencePolling({ domain: webrtcDomain });
  initGeoLookup().catch((err) => console.error("GeoIP init failed:", err.message));
