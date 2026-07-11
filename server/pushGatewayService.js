import express from "express";
import { createHash, createPrivateKey, randomUUID, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import http2 from "node:http2";
import { pool } from "./db.js";
import { buildRoutePlan } from "./pushRouteService.js";
import { buildLegacyDispatchResult } from "./legacyFlexisipRouteService.js";

const DEFAULT_LIMIT = 50;
const DEFAULT_PUSH_GATEWAY_SECRET_HEADER = "x-push-gateway-secret";

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function trimText(value, maxLength = 255) {
  const text = String(value ?? "").trim();
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function safeJson(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safeTokenHint(value) {
  const token = trimText(value, 2048);
  if (!token) return "";
  if (token.length <= 8) return `${token.slice(0, 2)}…${token.slice(-2)}`;
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function toSafeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeBuffer(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function readJsonFile(filePath) {
  const path = trimText(filePath, 1024);
  if (!path) return null;
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

function resolveApnsHost(config) {
  const env = trimText(config.apns?.environment || process.env.APNS_ENV || "production", 32).toLowerCase();
  if (env === "sandbox" || env === "development" || env === "dev") {
    return "api.sandbox.push.apple.com";
  }
  return "api.push.apple.com";
}

function resolveApnsAuthMode(config) {
  const mode = trimText(config.apns?.authMode || process.env.APNS_AUTH_MODE || "p8", 16).toLowerCase();
  if (mode === "pem" || mode === "p8") return mode;
  return "invalid";
}

async function buildApnsAuthToken(config) {
  const keyPem = await readFile(trimText(config.apns.keyPath, 1024), "utf8");
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = { alg: "ES256", kid: trimText(config.apns.keyId, 64) };
  const jwtPayload = { iss: trimText(config.apns.teamId, 64), iat: now };
  const jwt = `${base64UrlEncode(JSON.stringify(jwtHeader))}.${base64UrlEncode(JSON.stringify(jwtPayload))}`;
  const privateKey = createPrivateKey(keyPem);
  const jwtSignature = sign("sha256", Buffer.from(jwt), privateKey);
  return `${jwt}.${base64UrlEncodeBuffer(jwtSignature)}`;
}

async function loadApnsPemCredentials(config, providerName) {
  const certPath = providerName === "apns.voip"
    ? trimText(config.apns.voipCertPath, 1024)
    : trimText(config.apns.certPath, 1024);
  if (!certPath) {
    const error = new Error("APNS PEM certificate path missing.");
    error.code = providerName === "apns.voip" ? "APNS_VOIP_CERT_PATH_MISSING" : "APNS_CERT_PATH_MISSING";
    error.statusCode = 500;
    throw error;
  }

  const pem = await readFile(certPath, "utf8");
  return {
    certPath,
    cert: pem,
    key: pem,
  };
}

async function sendApnsLiveNotification(context, config, providerName) {
  const topic = providerName === "apns.voip"
    ? (config.apns.voipBundleId || config.apns.bundleId || "")
    : (config.apns.bundleId || "");
  if (!topic) {
    const error = new Error("APNS topic missing.");
    error.code = "APNS_TOPIC_MISSING";
    error.statusCode = 500;
    throw error;
  }

  const deviceToken = trimText(context.tokenValue, 4096);
  if (!deviceToken) {
    const error = new Error("APNS device token missing.");
    error.code = "APNS_TOKEN_MISSING";
    error.statusCode = 400;
    throw error;
  }

  const host = resolveApnsHost(config);
  const path = `/3/device/${deviceToken}`;
  const payload = providerName === "apns.voip"
    ? {
        aps: {
          "content-available": 1,
        },
        event: context.event,
        call_id: context.callId || "",
        msgid: context.msgid || "",
        from_uri: context.fromUri || "",
        to_uri: context.toUri || "",
        uid: context.uid || "",
        sound: context.sound || "",
      }
    : {
        aps: {
          alert: context.event === "call" ? "Incoming call" : "New message",
          badge: 1,
          sound: context.sound || "default",
          "content-available": 1,
          "mutable-content": 1,
        },
        event: context.event,
        call_id: context.callId || "",
        msgid: context.msgid || "",
        from_uri: context.fromUri || "",
        to_uri: context.toUri || "",
        uid: context.uid || "",
        sound: context.sound || "",
      };

  const authMode = resolveApnsAuthMode(config);
  const usePemAuth = authMode === "pem";
  let clientOptions = {};
  let requestHeaders = {
    ":method": "POST",
    ":path": path,
    "apns-topic": topic,
    "apns-push-type": providerName === "apns.voip" ? "voip" : "alert",
    "apns-priority": "10",
  };

  if (usePemAuth) {
    const pem = await loadApnsPemCredentials(config, providerName);
    clientOptions = {
      cert: pem.cert,
      key: pem.key,
      rejectUnauthorized: true,
    };
  } else {
    const authToken = await buildApnsAuthToken(config);
    requestHeaders = {
      ...requestHeaders,
      authorization: `bearer ${authToken}`,
    };
  }

  const client = http2.connect(`https://${host}`, clientOptions);
  const response = await new Promise((resolve, reject) => {
    const req = client.request(requestHeaders);

    let body = "";
    let responseHeaders = {};
    req.setEncoding("utf8");
    req.on("response", (headers) => {
      responseHeaders = headers || {};
    });
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      client.close();
      resolve({
        status: Number(responseHeaders[":status"] || 0),
        apnsId: responseHeaders["apns-id"] ? String(responseHeaders["apns-id"]) : "",
        body,
      });
    });
    req.on("error", (error) => {
      client.close();
      reject(error);
    });
    req.end(JSON.stringify(payload));
  });

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status >= 200 && response.status < 300 ? "success" : "failed",
    provider: providerName,
    providerResponse: {
      delivery_mode: "live_test",
      provider: providerName,
      auth_mode: authMode,
      apns_host: host,
      apns_topic: topic,
      apns_push_type: providerName === "apns.voip" ? "voip" : "alert",
      http_status: response.status,
      apns_id_present: Boolean(response.apnsId),
      response_body_present: Boolean(response.body),
      response_body_length: response.body.length,
    },
  };
}

function parseServiceAccountJsonFile(filePath) {
  return readJsonFile(filePath);
}

function base64UrlEncodeJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signJwtEs256({ header, payload, privateKeyPem }) {
  const unsigned = `${base64UrlEncodeJson(header)}.${base64UrlEncodeJson(payload)}`;
  const signature = sign("sha256", Buffer.from(unsigned), createPrivateKey(privateKeyPem));
  return `${unsigned}.${base64UrlEncodeBuffer(signature)}`;
}

async function getFcmAccessToken(config) {
  const serviceAccount = await parseServiceAccountJsonFile(config.fcm.serviceAccountPath);
  if (!serviceAccount || !serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.token_uri) {
    const error = new Error("FCM service account configuration missing.");
    error.code = "FCM_SERVICE_ACCOUNT_INVALID";
    error.statusCode = 500;
    throw error;
  }

  const jwt = signJwtEs256({
    header: { alg: "RS256", typ: "JWT" },
    payload: {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: serviceAccount.token_uri,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    privateKeyPem: serviceAccount.private_key,
  });

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }).toString();

  const response = await fetch(serviceAccount.token_uri, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const error = new Error("FCM OAuth token request failed.");
    error.code = "FCM_TOKEN_REQUEST_FAILED";
    error.statusCode = response.status || 500;
    error.details = text ? text.slice(0, 512) : "";
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }

  if (!parsed.access_token) {
    const error = new Error("FCM OAuth token missing access token.");
    error.code = "FCM_TOKEN_MISSING";
    error.statusCode = 500;
    throw error;
  }

  return {
    accessToken: parsed.access_token,
    expiresIn: Number(parsed.expires_in || 3600),
    tokenType: parsed.token_type || "Bearer",
    scope: parsed.scope || "",
  };
}

async function sendFcmLiveNotification(context, config) {
  const serviceAccount = await parseServiceAccountJsonFile(config.fcm.serviceAccountPath);
  if (!serviceAccount || !serviceAccount.project_id) {
    const error = new Error("FCM project id missing.");
    error.code = "FCM_PROJECT_ID_MISSING";
    error.statusCode = 500;
    throw error;
  }

  const { accessToken } = await getFcmAccessToken(config);
  const payload = {
    message: {
      token: context.tokenValue,
      data: {
        event: context.event,
        call_id: context.callId || "",
        msgid: context.msgid || "",
        from_uri: context.fromUri || "",
        to_uri: context.toUri || "",
        uid: context.uid || "",
        sound: context.sound || "",
        sip_username: context.device?.sip_username || "",
        sip_domain: context.device?.sip_domain || "",
        package_name: context.device?.package_name || "",
      },
      android: {
        priority: "HIGH",
      },
    },
  };

  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text().catch(() => "");
  return {
    ok: response.ok,
    status: response.ok ? "success" : "failed",
    provider: "fcm",
    providerResponse: {
      delivery_mode: "live_test",
      project_id: serviceAccount.project_id,
      http_status: response.status,
      response_body_present: Boolean(text),
      response_body_length: text.length,
      response_body: text ? text.slice(0, 512) : "",
    },
  };
}

function canLiveSendProvider(providerName, config) {
  const provider = normalizeProvider(providerName);
  if (!config.liveTest?.enabled) return false;
  if (provider === "apns" || provider === "apns.voip") {
    if (!config.apns?.liveTestEnabled || !config.apns?.enabled) return false;
    if (resolveApnsAuthMode(config) === "pem") {
      return Boolean(provider === "apns.voip" ? config.apns?.voipCertPath : config.apns?.certPath);
    }
    return Boolean(config.apns?.keyPath && config.apns?.keyId && config.apns?.teamId);
  }
  if (provider === "fcm") return Boolean(config.fcm?.liveTestEnabled && config.fcm?.enabled && config.fcm?.serviceAccountPath);
  if (provider === "jpush") return Boolean(config.jpush?.enabled && config.jpush?.liveTestEnabled && config.jpush?.appKey && config.jpush?.masterSecret && config.jpush?.apiUrl);
  return false;
}

function normalizeProvider(value) {
  const provider = trimText(value, 64).toLowerCase();
  if (!provider) return "";
  if (provider === "apple") return "apns";
  if (provider === "firebase") return "fcm";
  if (provider === "ios") return "apns";
  if (provider === "android") return "fcm";
  return provider;
}

function normalizeEventName(value) {
  const event = trimText(value, 32).toLowerCase();
  if (event === "call" || event === "message") return event;
  return "";
}

function normalizePlatform(value, provider = "") {
  const platform = trimText(value, 32).toLowerCase();
  if (platform) return platform;
  if (provider === "apns" || provider === "apns.dev") return "ios";
  if (provider === "fcm") return "android";
  return "other";
}

function normalizeUri(value) {
  return trimText(value, 512);
}

function parseSipUri(value) {
  const uri = normalizeUri(value);
  const match = uri.match(/^sip:([^@;>]+)@([^;>]+)/i);
  if (!match) return { username: "", domain: "" };
  return { username: match[1] || "", domain: match[2] || "" };
}

function normalizeBodyPayload(rawBody) {
  if (rawBody === undefined || rawBody === null) return {};
  if (typeof rawBody === "object") return rawBody;
  const text = String(rawBody || "").trim();
  if (!text) return {};
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // keep as raw text below
    }
  }
  return { body: text };
}

function normalizeFlexisipPushInput(request) {
  const body = normalizeBodyPayload(request.body);
  const query = request.query || {};
  const merged = { ...query, ...body };

  const event = normalizeEventName(merged.event);
  const type = normalizeProvider(merged.type);
  const token = trimText(merged.token, 4096);
  const appId = trimText(merged.app_id ?? merged.appId, 256);
  const fromUri = normalizeUri(merged.from_uri ?? merged.fromUri ?? merged["from-uri"]);
  const fromName = trimText(merged.from_name ?? merged.fromName ?? merged["from-name"], 255);
  const fromTag = trimText(merged.from_tag ?? merged.fromTag ?? merged["from-tag"], 255);
  const toUri = normalizeUri(merged.to_uri ?? merged.toUri);
  const callId = trimText(merged.call_id ?? merged.callId, 255);
  const msgid = trimText(merged.msgid ?? merged.msgId, 255);
  const uid = trimText(merged.uid, 255);
  const sound = trimText(merged.sound, 255);
  const appRegion = normalizeAppRegion(merged.app_region ?? merged.appRegion);
  const packageName = trimText(merged.package_name ?? merged.packageName, 255);
  const manufacturer = trimText(merged.manufacturer ?? merged.device_manufacturer, 80);
  const preferredPushProvider = normalizeProvider(merged.preferred_push_provider ?? merged.preferredPushProvider ?? "");
  const hasGms = merged.has_gms === undefined ? null : toBool(merged.has_gms, false);
  const deliver = merged.deliver === undefined ? false : toBool(merged.deliver, false);
  const rawTextBody = typeof request.body === "string" ? request.body : normalizeUri(merged.body);
  const bodyLength = rawTextBody ? String(rawTextBody).length : 0;

  return {
    event,
    type,
    token,
    tokenHint: safeTokenHint(token),
    appId,
    fromUri,
    fromName,
    fromTag,
    toUri,
    callId,
    msgid,
    uid,
    sound,
    appRegion,
    packageName,
    manufacturer,
    preferredPushProvider,
    hasGms,
    deliver,
    body: rawTextBody,
    bodyLength,
    raw: merged,
  };
}

function getGatewayConfig() {
  const secret = trimText(process.env.PUSH_GATEWAY_SECRET, 512);
  return {
    enabled: toBool(process.env.PUSH_GATEWAY_ENABLED, false),
    liveTest: {
      enabled: toBool(process.env.PUSH_GATEWAY_LIVE_TEST_ENABLED, false),
    },
    secret,
    secretHeader: trimText(process.env.PUSH_GATEWAY_SECRET_HEADER, 80) || DEFAULT_PUSH_GATEWAY_SECRET_HEADER,
    apns: {
      enabled: toBool(process.env.APNS_ENABLED, false),
      liveTestEnabled: toBool(process.env.APNS_LIVE_TEST_ENABLED, false),
      environment: trimText(process.env.APNS_ENV, 32) || "production",
      authMode: trimText(process.env.APNS_AUTH_MODE, 16) || "p8",
      certPath: trimText(process.env.APNS_CERT_PATH, 1024),
      voipCertPath: trimText(process.env.APNS_VOIP_CERT_PATH, 1024),
      teamId: trimText(process.env.APNS_TEAM_ID, 64),
      keyId: trimText(process.env.APNS_KEY_ID, 64),
      bundleId: trimText(process.env.APNS_BUNDLE_ID, 255),
      voipBundleId: trimText(process.env.APNS_VOIP_BUNDLE_ID, 255),
      keyPath: trimText(process.env.APNS_KEY_PATH, 1024),
    },
    fcm: {
      enabled: toBool(process.env.FCM_ENABLED, false),
      liveTestEnabled: toBool(process.env.FCM_LIVE_TEST_ENABLED, false),
      serviceAccountPath: trimText(process.env.FCM_SERVICE_ACCOUNT_PATH, 1024),
    },
    jpush: {
      enabled: toBool(process.env.JPUSH_ENABLED, false),
      liveTestEnabled: toBool(process.env.JPUSH_LIVE_TEST_ENABLED, false),
      appKey: trimText(process.env.JPUSH_APP_KEY, 255),
      masterSecret: trimText(process.env.JPUSH_MASTER_SECRET, 255),
      apiUrl: trimText(process.env.JPUSH_API_URL, 255) || "https://api.jpush.cn/v3/push",
    },
  };
}

function isGatewayRequestAuthorized(request) {
  const config = getGatewayConfig();
  if (!config.secret) return true;

  const candidates = [
    request.get(config.secretHeader),
    request.get("authorization"),
    request.query?.secret,
    request.body?.secret,
  ].filter(Boolean);

  for (const value of candidates) {
    const text = String(value).trim();
    if (!text) continue;
    if (text === config.secret) return true;
    if (/^Bearer\s+/i.test(text) && text.slice(7).trim() === config.secret) return true;
  }

  return false;
}

function safeDeviceSummary(row) {
  const source = row || {};
  const token = String(source.token || "");
  const fcmToken = String(source.fcm_token || "");
  const jpushRegistrationId = String(source.jpush_registration_id || "");
  const apnsToken = String(source.apns_token || "");
  const voipToken = String(source.voip_token || "");
  return {
    id: toSafeNumber(source.id),
    device_key: source.device_key || "",
    device_id: source.device_id || "",
    tenant_id: toSafeNumber(source.tenant_id),
    sip_user_id: toSafeNumber(source.sip_user_id),
    sip_username: source.sip_username || "",
    sip_domain: source.sip_domain || "",
    sip_instance: source.sip_instance || "",
    platform: source.platform || "",
    provider: source.provider || "",
    app_region: source.app_region || "",
    package_name: source.package_name || "",
    manufacturer: source.manufacturer || "",
    has_gms: Boolean(source.has_gms),
    preferred_push_provider: source.preferred_push_provider || "",
    token_present: Boolean(token),
    token_length: token.length,
    token_hint: safeTokenHint(token),
    fcm_token_present: Boolean(fcmToken),
    fcm_token_length: fcmToken.length,
    fcm_token_hint: safeTokenHint(fcmToken),
    jpush_registration_id_present: Boolean(jpushRegistrationId),
    jpush_registration_id_length: jpushRegistrationId.length,
    jpush_registration_id_hint: safeTokenHint(jpushRegistrationId),
    apns_token_present: Boolean(apnsToken),
    apns_token_length: apnsToken.length,
    apns_token_hint: safeTokenHint(apnsToken),
    voip_token_present: Boolean(voipToken),
    voip_token_length: voipToken.length,
    voip_token_hint: safeTokenHint(voipToken),
    app_version: source.app_version || "",
    device_model: source.device_model || "",
    os_version: source.os_version || "",
    last_seen_ip: source.last_seen_ip || "",
    last_seen_country: source.last_seen_country || "",
    enabled: Boolean(source.enabled),
    last_seen_at: source.last_seen_at || null,
    created_at: source.created_at || null,
    updated_at: source.updated_at || null,
  };
}

function parseDateValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getPushDeviceStaleDays() {
  const days = Number(process.env.PUSH_DEVICE_STALE_DAYS || 30);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

function getPushDeviceStaleCutoff() {
  return Date.now() - getPushDeviceStaleDays() * 24 * 60 * 60 * 1000;
}

function isPushDeviceFresh(row) {
  const lastSeen = parseDateValue(row?.last_seen_at);
  if (!lastSeen) return false;
  return lastSeen.getTime() >= getPushDeviceStaleCutoff();
}

function preferIncomingText(currentValue, incomingValue, { preserveEmpty = true } = {}) {
  if (incomingValue === undefined || incomingValue === null) return currentValue;
  const text = String(incomingValue).trim();
  if (!text && preserveEmpty) return currentValue;
  return text;
}

function preferIncomingNumber(currentValue, incomingValue) {
  if (incomingValue === undefined || incomingValue === null || incomingValue === "") return currentValue;
  const number = Number(incomingValue);
  return Number.isFinite(number) ? number : currentValue;
}

function sqlValue(value, fallback = null) {
  return value === undefined ? fallback : value;
}

function pickBestDeviceRow(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[0] || null;
}

function isSuccessfulProviderResult(entry = {}) {
  if (!entry || entry.mode !== "live_test") return false;
  if (entry.status === "success") return true;
  const httpStatus = Number(entry.providerResponse?.http_status);
  return Number.isFinite(httpStatus) && httpStatus >= 200 && httpStatus < 300;
}

function getDeviceRegistrationHints(device = {}) {
  return {
    device_id_hint: safeTokenHint(device.device_id || ""),
    device_key_hint: safeTokenHint(device.device_key || ""),
    registration_id_hint: safeTokenHint(device.jpush_registration_id || device.token || ""),
  };
}

function normalizeRegisterPayload(payload = {}) {
  const jpushRegistrationId = trimText(
    payload.jpush_registration_id ||
      payload.jpushRegistrationId ||
      payload.registration_id ||
      payload.registrationId ||
      "",
    4096,
  );
  return {
    ...payload,
    token: trimText(payload.token || jpushRegistrationId || "", 4096),
    jpush_registration_id: jpushRegistrationId,
    fcm_token: trimText(payload.fcm_token || payload.fcmToken || "", 4096),
    apns_token: trimText(payload.apns_token || payload.apnsToken || "", 4096),
    voip_token: trimText(payload.voip_token || payload.voipToken || "", 4096),
    clear_tokens: toBool(payload.clear_tokens || payload.clearTokens, false),
  };
}

function normalizeAppRegion(value) {
  const region = trimText(value, 32).toLowerCase();
  if (!region) return "";
  if (region === "overseas" || region === "global" || region === "intl" || region === "international") return "overseas";
  if (region === "china" || region === "cn" || region === "mainland") return "china";
  return region;
}

function normalizeManufacturer(value) {
  return trimText(value, 80);
}

function buildDeviceKey(payload = {}) {
  const deviceId = trimText(payload.device_id || payload.deviceId || "", 255);
  const sipInstance = trimText(payload.sip_instance || payload.sipInstance || "", 255);
  const packageName = trimText(payload.package_name || payload.packageName || "", 255);

  if (deviceId && packageName) return `device:${deviceId}|package:${packageName}`;
  if (sipInstance && packageName) return `instance:${sipInstance}|package:${packageName}`;
  if (deviceId) return `device:${deviceId}`;
  if (sipInstance) return `instance:${sipInstance}`;

  const sipUsername = trimText(payload.sip_username, 120);
  const sipDomain = trimText(payload.sip_domain, 255);
  const provider = normalizeProvider(payload.provider || payload.pn_provider || "");
  const token = trimText(payload.token, 4096);
  return `fingerprint:${hashText([sipUsername, sipDomain, packageName, provider, token || "device"].join("|"))}`;
}

async function findExistingPushDevice(connection, payload = {}) {
  const deviceKey = trimText(payload.device_key || payload.deviceKey || "", 512);
  const deviceId = trimText(payload.device_id || payload.deviceId || "", 255);
  const provider = normalizeProvider(payload.provider || payload.pn_provider || "");
  const token = trimText(payload.token || "", 4096);
  const jpushRegistrationId = trimText(payload.jpush_registration_id || payload.jpushRegistrationId || "", 4096) || (provider === "jpush" ? token : "");
  const fcmToken = trimText(payload.fcm_token || payload.fcmToken || "", 4096) || (provider === "fcm" ? token : "");
  const apnsToken = trimText(payload.apns_token || payload.apnsToken || "", 4096) || (provider === "apns" ? token : "");
  const voipToken = trimText(payload.voip_token || payload.voipToken || "", 4096) || (provider === "apns.voip" ? token : "");

  const searchOrder = [
    deviceKey ? ["device_key = ?", [deviceKey]] : null,
    jpushRegistrationId ? ["jpush_registration_id = ?", [jpushRegistrationId]] : null,
    fcmToken ? ["fcm_token = ?", [fcmToken]] : null,
    apnsToken ? ["apns_token = ?", [apnsToken]] : null,
    voipToken ? ["voip_token = ?", [voipToken]] : null,
    token ? ["token = ?", [token]] : null,
    deviceId ? ["device_id = ?", [deviceId]] : null,
  ].filter(Boolean);

  for (const [where, params] of searchOrder) {
    const rows = await query(connection, `SELECT * FROM push_devices WHERE ${where} LIMIT 1`, params);
    const row = pickBestDeviceRow(rows);
    if (row) return row;
  }

  return null;
}

function buildPushDeviceRecord(existingRow, payload = {}) {
  const clearTokens = toBool(payload.clear_tokens || payload.clearTokens, false);
  const provider = normalizeProvider(payload.provider || payload.pn_provider || existingRow?.provider || "");
  const token = trimText(payload.token || "", 4096);
  const deviceKeyIncoming = trimText(payload.device_key || payload.deviceKey || "", 512) || buildDeviceKey(payload);
  const deviceIdIncoming = trimText(payload.device_id || payload.deviceId || "", 255) || deviceKeyIncoming.slice(0, 255);
  const jpushRegistrationIdIncoming = trimText(payload.jpush_registration_id || payload.jpushRegistrationId || "", 4096) || (provider === "jpush" ? token : "");
  const fcmTokenIncoming = trimText(payload.fcm_token || payload.fcmToken || "", 4096) || (provider === "fcm" ? token : "");
  const apnsTokenIncoming = trimText(payload.apns_token || payload.apnsToken || "", 4096) || (provider === "apns" ? token : "");
  const voipTokenIncoming = trimText(payload.voip_token || payload.voipToken || "", 4096) || (provider === "apns.voip" ? token : "");
  const base = existingRow ? { ...existingRow } : {};

  return {
    device_key: preferIncomingText(base.device_key || deviceKeyIncoming, deviceKeyIncoming),
    device_id: preferIncomingText(base.device_id || deviceIdIncoming, deviceIdIncoming),
    tenant_id: preferIncomingNumber(base.tenant_id, payload.tenant_id ?? payload.tenantId),
    sip_user_id: preferIncomingNumber(base.sip_user_id, payload.sip_user_id ?? payload.sipUserId),
    sip_username: preferIncomingText(base.sip_username || "", payload.sip_username ?? payload.sipUserName),
    sip_domain: preferIncomingText(base.sip_domain || "", payload.sip_domain ?? payload.sipDomain),
    sip_instance: preferIncomingText(base.sip_instance || "", payload.sip_instance ?? payload.sipInstance),
    app_region: normalizeAppRegion(preferIncomingText(base.app_region || "", payload.app_region ?? payload.appRegion)),
    package_name: preferIncomingText(base.package_name || "", payload.package_name ?? payload.packageName),
    manufacturer: normalizeManufacturer(preferIncomingText(base.manufacturer || "", payload.manufacturer ?? payload.device_manufacturer)),
    has_gms: payload.has_gms === undefined ? (base.has_gms === undefined ? null : (base.has_gms ? 1 : 0)) : (toBool(payload.has_gms, false) ? 1 : 0),
    preferred_push_provider: normalizeProvider(preferIncomingText(base.preferred_push_provider || "", payload.preferred_push_provider ?? payload.preferredPushProvider)),
    platform: normalizePlatform(preferIncomingText(base.platform || "", payload.platform), provider || base.provider || ""),
    provider,
    token: clearTokens ? token : (token || String(base.token || "")),
    fcm_token: clearTokens ? fcmTokenIncoming : (fcmTokenIncoming || String(base.fcm_token || "")),
    jpush_registration_id: clearTokens ? jpushRegistrationIdIncoming : (jpushRegistrationIdIncoming || String(base.jpush_registration_id || "")),
    apns_token: clearTokens ? apnsTokenIncoming : (apnsTokenIncoming || String(base.apns_token || "")),
    voip_token: clearTokens ? voipTokenIncoming : (voipTokenIncoming || String(base.voip_token || "")),
    last_seen_ip: preferIncomingText(base.last_seen_ip || "", payload.last_seen_ip ?? payload.lastSeenIp),
    last_seen_country: preferIncomingText(base.last_seen_country || "", payload.last_seen_country ?? payload.lastSeenCountry),
    app_version: preferIncomingText(base.app_version || "", payload.app_version ?? payload.appVersion),
    device_model: preferIncomingText(base.device_model || "", payload.device_model ?? payload.deviceModel),
    os_version: preferIncomingText(base.os_version || "", payload.os_version ?? payload.osVersion),
    enabled: payload.enabled === undefined ? true : toBool(payload.enabled, true),
    last_seen_at: new Date(),
    updated_at: new Date(),
  };
}

class BasePushProvider {
  constructor(config = {}) {
    this.config = config;
  }

  get providerName() {
    return "base";
  }

  get platformName() {
    return "unknown";
  }

  isConfigured() {
    return true;
  }

  getConfigWarnings() {
    return [];
  }

  buildRequestDescriptor(context) {
    return {
      provider: this.providerName,
      platform: this.platformName,
      event: context.event,
      type: context.type,
      app_id: context.appId,
      from_uri: context.fromUri,
      to_uri: context.toUri,
      call_id: context.callId,
      msgid: context.msgid,
      uid: context.uid,
      sound: context.sound,
      body_length: context.bodyLength,
      token_hint: context.tokenHint,
      target_device_count: context.devices?.length || 0,
      delivery_mode: "dry_run",
    };
  }

  async send(context) {
    const descriptor = this.buildRequestDescriptor(context);
    return {
      ok: true,
      status: "dry_run",
      provider: this.providerName,
      providerResponse: descriptor,
    };
  }
}

class ApnsProvider extends BasePushProvider {
  get providerName() {
    return "apns";
  }

  get platformName() {
    return "ios";
  }

  isConfigured() {
    const { apns } = this.config;
    if (!apns.enabled) return false;
    const authMode = resolveApnsAuthMode(this.config);
    if (authMode === "pem") {
      return Boolean(apns.certPath && apns.voipCertPath && (apns.bundleId || apns.voipBundleId));
    }
    return Boolean(apns.teamId && apns.keyId && apns.keyPath && (apns.bundleId || apns.voipBundleId));
  }

  getConfigWarnings() {
    const { apns } = this.config;
    const warnings = [];
    if (!apns.enabled) warnings.push("APNS_DISABLED");
    const authMode = resolveApnsAuthMode(this.config);
    if (authMode === "invalid") warnings.push("APNS_AUTH_MODE_INVALID");
    else warnings.push(`APNS_AUTH_MODE_${authMode.toUpperCase()}`);
    if (!apns.liveTestEnabled) warnings.push("APNS_LIVE_TEST_DISABLED");
    if (!apns.bundleId) warnings.push("APNS_BUNDLE_ID_MISSING");
    if (!apns.voipBundleId) warnings.push("APNS_VOIP_BUNDLE_ID_MISSING");
    if (authMode === "pem") {
      if (!apns.certPath) warnings.push("APNS_CERT_PATH_MISSING");
      if (!apns.voipCertPath) warnings.push("APNS_VOIP_CERT_PATH_MISSING");
    } else {
      if (!apns.teamId) warnings.push("APNS_TEAM_ID_MISSING");
      if (!apns.keyId) warnings.push("APNS_KEY_ID_MISSING");
      if (!apns.keyPath) warnings.push("APNS_KEY_PATH_MISSING");
    }
    return warnings;
  }

  buildRequestDescriptor(context) {
    return {
      ...super.buildRequestDescriptor(context),
      auth_mode: resolveApnsAuthMode(this.config),
      push_kind: context.event === "call" ? "voip" : "remote",
      push_type: context.event === "call" ? "PushKit" : "RemoteWithMutableContent",
      bundle_id: context.event === "call"
        ? (this.config.apns.voipBundleId || this.config.apns.bundleId || "")
        : (this.config.apns.bundleId || ""),
    };
  }

  async send(context) {
    const descriptor = this.buildRequestDescriptor(context);
    if (!context.liveTest || !this.isConfigured() || !context.tokenValue) {
      return {
        ok: true,
        status: "skipped",
        provider: this.providerName,
        providerResponse: {
          ...descriptor,
          delivery_mode: "dry_run",
          provider_ready: this.isConfigured(),
          live_test_enabled: Boolean(context.liveTest),
        },
      };
    }

    const sendResult = await sendApnsLiveNotification(context, this.config, context.event === "call" ? "apns.voip" : "apns");
    return {
      ok: sendResult.ok,
      status: sendResult.status,
      provider: this.providerName,
      providerResponse: {
        ...descriptor,
        ...sendResult.providerResponse,
        delivery_mode: "live_test",
        live_test_enabled: true,
      },
    };
  }
}

class ApnsVoipProvider extends ApnsProvider {
  get providerName() {
    return "apns.voip";
  }

  buildRequestDescriptor(context) {
    return {
      ...super.buildRequestDescriptor(context),
      push_kind: "voip",
      push_type: "PushKit",
      bundle_id: this.config.apns.voipBundleId || this.config.apns.bundleId || "",
    };
  }
}

class FcmProvider extends BasePushProvider {
  get providerName() {
    return "fcm";
  }

  get platformName() {
    return "android";
  }

  isConfigured() {
    const { fcm } = this.config;
    return Boolean(fcm.enabled && fcm.serviceAccountPath);
  }

  getConfigWarnings() {
    const { fcm } = this.config;
    const warnings = [];
    if (!fcm.enabled) warnings.push("FCM_DISABLED");
    if (!fcm.serviceAccountPath) warnings.push("FCM_SERVICE_ACCOUNT_PATH_MISSING");
    return warnings;
  }

  buildRequestDescriptor(context) {
    return {
      ...super.buildRequestDescriptor(context),
      push_kind: context.event,
      message_type: context.event === "call" ? "call" : "message",
      delivery: "android_fcm",
    };
  }

  async send(context) {
    const descriptor = this.buildRequestDescriptor(context);
    if (!context.liveTest || !this.isConfigured() || !context.tokenValue) {
      return {
        ok: true,
        status: "skipped",
        provider: this.providerName,
        providerResponse: {
          ...descriptor,
          delivery_mode: "dry_run",
          provider_ready: this.isConfigured(),
          live_test_enabled: Boolean(context.liveTest),
        },
      };
    }

    const sendResult = await sendFcmLiveNotification(context, this.config);
    return {
      ok: sendResult.ok,
      status: sendResult.status,
      provider: this.providerName,
      providerResponse: {
        ...descriptor,
        ...sendResult.providerResponse,
        delivery_mode: "live_test",
        live_test_enabled: true,
      },
    };
  }
}

class HuaweiProvider extends BasePushProvider {
  get providerName() { return "huawei"; }
  get platformName() { return "android"; }
}

class XiaomiProvider extends BasePushProvider {
  get providerName() { return "xiaomi"; }
  get platformName() { return "android"; }
}

class OppoProvider extends BasePushProvider {
  get providerName() { return "oppo"; }
  get platformName() { return "android"; }
}

class VivoProvider extends BasePushProvider {
  get providerName() { return "vivo"; }
  get platformName() { return "android"; }
}

class HonorProvider extends BasePushProvider {
  get providerName() { return "honor"; }
  get platformName() { return "android"; }
}

class JPushProvider extends BasePushProvider {
  get providerName() {
    return "jpush";
  }

  get platformName() {
    return "android";
  }

  isConfigured() {
    const { jpush } = this.config;
    return Boolean(jpush.enabled && jpush.appKey && jpush.masterSecret && jpush.apiUrl);
  }

  getConfigWarnings() {
    const { jpush } = this.config;
    const warnings = [];
    if (!jpush.enabled) warnings.push("JPUSH_DISABLED");
    if (!jpush.appKey) warnings.push("JPUSH_APP_KEY_MISSING");
    if (!jpush.masterSecret) warnings.push("JPUSH_MASTER_SECRET_MISSING");
    if (!jpush.apiUrl) warnings.push("JPUSH_API_URL_MISSING");
    return warnings;
  }

  buildRequestDescriptor(context) {
    const target = context.tokenValue ? { registration_id: [context.tokenValue] } : {};
    const callId = context.callId || context.call_id || "";
    const msgid = context.msgid || context.msg_id || context.messageId || context.message_id || "";
    const fromUri = context.fromUri || context.from_uri || "";
    const toUri = context.toUri || context.to_uri || "";
    const sipUsername = context.device?.sip_username || context.sip_username || "";
    const sipDomain = context.device?.sip_domain || context.sip_domain || "";
    const packageName = context.device?.package_name || context.package_name || "";
    const provider = context.device?.provider || context.provider || "jpush";
    const payloadMode = context.jpush_payload_mode || "notification";
    const isCustomMessage = payloadMode === "custom_message";

    const extras = {
      event: context.event,
      call_id: callId,
      msgid,
      from_uri: fromUri,
      to_uri: toUri,
      sip_username: sipUsername,
      sip_domain: sipDomain,
      package_name: packageName,
      provider,
      push_channel: "jpush",
    };

    const msgContent = {
      event: context.event,
      call_id: callId,
      msgid,
      from_uri: fromUri,
      to_uri: toUri,
      sip_username: sipUsername,
      sip_domain: sipDomain,
      package_name: packageName,
      provider,
    };

    const descriptor = {
      ...super.buildRequestDescriptor(context),
      push_kind: context.event,
      delivery: "jpush",
      platform: "android",
      audience: target,
      jpush_payload_mode: payloadMode,
      message: {
        msg_content: JSON.stringify(msgContent),
        title: "QRTalkie Push",
      },
    };

    if (!isCustomMessage) {
      descriptor.notification = {
        android: {
          alert: context.event === "call" ? "Incoming call" : (context.body || "New message"),
          title: context.event === "call" ? "來電" : "新訊息",
          priority: 2,
          extras,
        },
      };
    }

    return descriptor;
  }

  async send(context) {
    const descriptor = this.buildRequestDescriptor(context);
    const liveAllowed = Boolean(context.liveTest && this.config.jpush?.liveTestEnabled && this.isConfigured() && context.tokenValue);
    if (!liveAllowed) {
      return {
        ok: true,
        status: "dry_run",
        provider: this.providerName,
        providerResponse: {
          ...descriptor,
          delivery_mode: "dry_run",
          provider_ready: this.isConfigured(),
          live_test_enabled: Boolean(context.liveTest),
          jpush_live_test_enabled: Boolean(this.config.jpush?.liveTestEnabled),
        },
      };
    }

    const auth = Buffer.from(`${this.config.jpush.appKey}:${this.config.jpush.masterSecret}`).toString("base64");
    const payloadMode = context.jpush_payload_mode || "notification";
    const payload = {
      platform: "android",
      audience: {
        registration_id: [context.tokenValue],
      },
      message: descriptor.message,
      options: {
        apns_production: true,
        time_to_live: payloadMode === "custom_message" ? 86400 : 600,
      },
    };
    if (payloadMode !== "custom_message") {
      payload.notification = descriptor.notification;
    }

    const response = await fetch(this.config.jpush.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    let responseText = "";
    try {
      responseText = await response.text();
    } catch {
      responseText = "";
    }

    let parsed = null;
    try {
      parsed = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsed = null;
    }

    const apiErrorCode = parsed?.error?.code ?? parsed?.errorCode ?? parsed?.code ?? "";
    const apiErrorMessage = parsed?.error?.message ?? parsed?.errorMessage ?? parsed?.message ?? "";
    const msgId = parsed?.msg_id ?? parsed?.msgId ?? parsed?.message_id ?? "";
    const returnedSendno = parsed?.sendno ?? parsed?.sendNo ?? "";

    return {
      ok: response.ok,
      status: response.ok ? "success" : "failed",
      provider: this.providerName,
      errorCode: response.ok ? "" : (apiErrorCode ? `JPUSH_API_${String(apiErrorCode).toString().toUpperCase()}` : `JPUSH_HTTP_${response.status}`),
      providerResponse: {
        ...descriptor,
        delivery_mode: "live_test",
        http_status: response.status,
        response_body_present: Boolean(responseText),
        response_body_length: responseText.length,
        msg_id: msgId,
        ...(returnedSendno ? { sendno: returnedSendno } : {}),
        error_code: apiErrorCode || (response.ok ? "" : `JPUSH_HTTP_${response.status}`),
        error_message: apiErrorMessage || (response.ok ? "" : `HTTP ${response.status}`),
        registration_id_hint: safeTokenHint(context.tokenValue),
        payload_summary: {
          ...descriptor,
          delivery_mode: "live_test",
          jpush_payload_mode: (context.jpush_payload_mode || "notification"),
          audience: { registration_id: [safeTokenHint(context.tokenValue)] },
        },
      },
    };
  }

  async sendCallPush(context) {
    return this.send({ ...context, event: "call" });
  }

  async sendMessagePush(context) {
    return this.send({ ...context, event: "message" });
  }
}

const CUSTOM_PROVIDER_CLASSES = new Map([
  ["apns", ApnsProvider],
  ["apns.dev", ApnsProvider],
  ["fcm", FcmProvider],
  ["huawei", HuaweiProvider],
  ["xiaomi", XiaomiProvider],
  ["oppo", OppoProvider],
  ["vivo", VivoProvider],
  ["honor", HonorProvider],
  ["jpush", JPushProvider],
]);

function createProvider(providerName, event, config) {
  const normalized = normalizeProvider(providerName);
  if (normalized === "apns" || normalized === "apns.dev" || normalized === "apns.voip") {
    return event === "call" ? new ApnsVoipProvider(config) : new ApnsProvider(config);
  }

  const ProviderClass = CUSTOM_PROVIDER_CLASSES.get(normalized) || BasePushProvider;
  return new ProviderClass(config);
}

async function query(connection, sql, params = []) {
  return connection.query(sql, params);
}

async function insertPushEvent(connection, row) {
  const pushId = row.push_id || randomUUID();
  await query(
    connection,
    `INSERT INTO push_events (
       push_id, event, provider, sip_user, to_uri, call_id, msgid,
       status, error_code, provider_response, payload_summary, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      pushId,
      row.event || "",
      row.provider || "",
      row.sip_user || "",
      row.to_uri || "",
      row.call_id || "",
      row.msgid || "",
      row.status || "received",
      row.error_code || "",
      row.provider_response || null,
      row.payload_summary || null,
    ],
  );
  return pushId;
}

async function updatePushEvent(connection, pushId, patch) {
  const sets = [];
  const params = [];

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(value);
  }

  if (!sets.length) return;
  params.push(pushId);
  await query(connection, `UPDATE push_events SET ${sets.join(", ")}, updated_at = NOW() WHERE push_id = ?`, params);
}

async function upsertPushDevice(connection, payload) {
  const normalizedPayload = normalizeRegisterPayload(payload);
  const existingRow = await findExistingPushDevice(connection, normalizedPayload);
  const merged = buildPushDeviceRecord(existingRow, normalizedPayload);

  if (existingRow?.id) {
    await query(
      connection,
      `UPDATE push_devices
         SET device_key = ?, device_id = ?, tenant_id = ?, sip_user_id = ?, sip_username = ?, sip_domain = ?, sip_instance = ?,
             app_region = ?, package_name = ?, manufacturer = ?, has_gms = ?, preferred_push_provider = ?,
             platform = ?, provider = ?, token = ?, fcm_token = ?, jpush_registration_id = ?, apns_token = ?, voip_token = ?,
             last_seen_ip = ?, last_seen_country = ?, app_version = ?, device_model = ?, os_version = ?,
             enabled = ?, last_seen_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        sqlValue(merged.device_key, ""),
        sqlValue(merged.device_id, ""),
        sqlValue(merged.tenant_id, null),
        sqlValue(merged.sip_user_id, null),
        sqlValue(merged.sip_username, ""),
        sqlValue(merged.sip_domain, ""),
        sqlValue(merged.sip_instance, ""),
        sqlValue(merged.app_region, ""),
        sqlValue(merged.package_name, ""),
        sqlValue(merged.manufacturer, ""),
        sqlValue(merged.has_gms, null),
        sqlValue(merged.preferred_push_provider, ""),
        sqlValue(merged.platform, ""),
        sqlValue(merged.provider, ""),
        sqlValue(merged.token, ""),
        sqlValue(merged.fcm_token, null),
        sqlValue(merged.jpush_registration_id, null),
        sqlValue(merged.apns_token, null),
        sqlValue(merged.voip_token, null),
        sqlValue(merged.last_seen_ip, ""),
        sqlValue(merged.last_seen_country, ""),
        sqlValue(merged.app_version, ""),
        sqlValue(merged.device_model, ""),
        sqlValue(merged.os_version, ""),
        sqlValue(merged.enabled ? 1 : 0, 1),
        sqlValue(merged.last_seen_at, new Date()),
        sqlValue(merged.updated_at, new Date()),
        existingRow.id,
      ],
    );
  } else {
    await query(
      connection,
      `INSERT INTO push_devices (
         device_key, device_id, tenant_id, sip_user_id, sip_username, sip_domain, sip_instance,
         app_region, package_name, manufacturer, has_gms, preferred_push_provider,
         platform, provider, token, fcm_token, jpush_registration_id, apns_token, voip_token,
         last_seen_ip, last_seen_country, app_version, device_model, os_version,
         enabled, last_seen_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        sqlValue(merged.device_key, ""),
        sqlValue(merged.device_id, ""),
        sqlValue(merged.tenant_id, null),
        sqlValue(merged.sip_user_id, null),
        sqlValue(merged.sip_username, ""),
        sqlValue(merged.sip_domain, ""),
        sqlValue(merged.sip_instance, ""),
        sqlValue(merged.app_region, ""),
        sqlValue(merged.package_name, ""),
        sqlValue(merged.manufacturer, ""),
        sqlValue(merged.has_gms, null),
        sqlValue(merged.preferred_push_provider, ""),
        sqlValue(merged.platform, ""),
        sqlValue(merged.provider, ""),
        sqlValue(merged.token, ""),
        sqlValue(merged.fcm_token, null),
        sqlValue(merged.jpush_registration_id, null),
        sqlValue(merged.apns_token, null),
        sqlValue(merged.voip_token, null),
        sqlValue(merged.last_seen_ip, ""),
        sqlValue(merged.last_seen_country, ""),
        sqlValue(merged.app_version, ""),
        sqlValue(merged.device_model, ""),
        sqlValue(merged.os_version, ""),
        sqlValue(merged.enabled ? 1 : 0, 1),
        sqlValue(merged.last_seen_at, new Date()),
      ],
    );
  }

  const rows = await query(connection, "SELECT * FROM push_devices WHERE device_key = ? LIMIT 1", [merged.device_key]);
  return {
    device: pickBestDeviceRow(rows) || existingRow || null,
    createdOrUpdated: existingRow ? "updated" : "created",
  };
}

async function disablePushDevice(connection, payload) {
  const deviceId = trimText(payload.device_id || payload.deviceId || "", 255);
  const deviceKey = trimText(payload.device_key || payload.deviceKey || "", 512);
  const token = trimText(payload.token, 4096);
  const sipUsername = trimText(payload.sip_username, 120);
  const sipDomain = trimText(payload.sip_domain, 255);
  const provider = normalizeProvider(payload.provider || payload.pn_provider || "");
  const packageName = trimText(payload.package_name || payload.packageName || "", 255);
  const sipInstance = trimText(payload.sip_instance || payload.sipInstance || "", 255);

  const clauses = [];
  const params = [];

  if (deviceKey) {
    clauses.push("device_key = ?");
    params.push(deviceKey);
  }
  if (deviceId) {
    clauses.push("device_id = ?");
    params.push(deviceId);
  }
  if (sipInstance) {
    clauses.push("sip_instance = ?");
    params.push(sipInstance);
  }
  if (packageName) {
    clauses.push("package_name = ?");
    params.push(packageName);
  }
  if (token) {
    clauses.push("token = ?");
    params.push(token);
  }
  if (sipUsername) {
    clauses.push("sip_username = ?");
    params.push(sipUsername);
  }
  if (sipDomain) {
    clauses.push("sip_domain = ?");
    params.push(sipDomain);
  }
  if (provider) {
    clauses.push("provider = ?");
    params.push(provider);
  }

  if (!clauses.length) return 0;

  const result = await query(
    connection,
    `UPDATE push_devices
        SET enabled = 0, updated_at = NOW(), last_seen_at = NOW()
      WHERE ${clauses.join(" OR ")}`,
    params,
  );

  return Number(result?.affectedRows || 0);
}

async function listPushDevices(connection, filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.tenant_id !== undefined && filters.tenant_id !== "") {
    clauses.push("tenant_id = ?");
    params.push(Number(filters.tenant_id));
  }
  if (filters.device_key) {
    clauses.push("device_key = ?");
    params.push(trimText(filters.device_key, 512));
  }
  if (filters.sip_user_id !== undefined && filters.sip_user_id !== "") {
    clauses.push("sip_user_id = ?");
    params.push(Number(filters.sip_user_id));
  }
  if (filters.sip_username) {
    clauses.push("sip_username = ?");
    params.push(trimText(filters.sip_username, 120));
  }
  if (filters.sip_domain) {
    clauses.push("sip_domain = ?");
    params.push(trimText(filters.sip_domain, 255));
  }
  if (filters.provider) {
    clauses.push("provider = ?");
    params.push(normalizeProvider(filters.provider));
  }
  if (filters.app_region) {
    clauses.push("app_region = ?");
    params.push(normalizeAppRegion(filters.app_region));
  }
  if (filters.platform) {
    clauses.push("platform = ?");
    params.push(normalizePlatform(filters.platform));
  }
  if (filters.package_name) {
    clauses.push("package_name = ?");
    params.push(trimText(filters.package_name, 255));
  }
  if (filters.preferred_push_provider) {
    clauses.push("preferred_push_provider = ?");
    params.push(normalizeProvider(filters.preferred_push_provider));
  }
  if (filters.manufacturer) {
    clauses.push("manufacturer = ?");
    params.push(trimText(filters.manufacturer, 80));
  }
  if (filters.enabled !== undefined && filters.enabled !== "") {
    clauses.push("enabled = ?");
    params.push(toBool(filters.enabled, true) ? 1 : 0);
  }

  const limit = Math.min(Math.max(Number(filters.limit || DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), 500);
  const offset = Math.max(Number(filters.offset || 0) || 0, 0);

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await query(
    connection,
    `SELECT * FROM push_devices ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map((row) => safeDeviceSummary(row));
}

function buildEventSummary(payload) {
  return {
    event: payload.event,
    type: payload.type,
    app_id: payload.appId,
    app_region: payload.appRegion || "",
    from_uri: payload.fromUri,
    to_uri: payload.toUri,
    call_id: payload.callId,
    msgid: payload.msgid,
    uid: payload.uid,
    sound: payload.sound,
    package_name: payload.packageName || "",
    manufacturer: payload.manufacturer || "",
    preferred_push_provider: payload.preferredPushProvider || "",
    has_gms: payload.hasGms === null ? null : Boolean(payload.hasGms),
    body_present: Boolean(payload.bodyLength),
    body_length: payload.bodyLength,
    token_present: Boolean(payload.token),
    token_length: String(payload.token || "").length,
    token_hint: payload.tokenHint,
  };
}

function buildEnhancedDispatchResult({ planEntry, config }) {
  const providerName = planEntry.selected_provider;
  const providerWarnings = selectedPushProviderWarnings(providerName, config);
  return {
    device: safeDeviceSummary(planEntry.device),
    route_type: "enhanced_route",
    provider: providerName,
    mode: "dry_run",
    status: "skipped",
    route: {
      selected_provider: providerName,
      route_reason: planEntry.route.route_reason,
      token_type: planEntry.route.token_type,
      token_value_present: planEntry.route.token_value_present,
      should_send: planEntry.route.should_send,
      provider_status: planEntry.route.provider_status,
      app_region: planEntry.route.app_region,
    },
    providerResponse: {
      device_id: planEntry.device.device_id,
      package_name: planEntry.device.package_name || "",
      app_region: planEntry.route.app_region,
      route_reason: planEntry.route.route_reason,
      selected_provider: planEntry.route.selected_provider,
      provider_status: planEntry.route.provider_status,
      token_type: planEntry.route.token_type,
      token_value_present: planEntry.route.token_value_present,
      token_hint: planEntry.route.token_hint,
      should_send: planEntry.route.should_send,
      delivery_mode: "dry_run",
      config_warnings: providerWarnings,
    },
  };
}

async function resolveTargetDevices(connection, payload, filters = {}) {
  const packageName = trimText(filters.package_name || filters.packageName || payload.package_name || payload.packageName || "", 255);
  const sipInstance = trimText(filters.sip_instance || filters.sipInstance || payload.sip_instance || payload.sipInstance || "", 255);
  const deviceKey = trimText(filters.device_key || filters.deviceKey || payload.device_key || payload.deviceKey || "", 512);
  const toUri = payload.toUri || payload.to_uri || filters.toUri || filters.to_uri || "";
  const payloadSipUsername = trimText(payload.sip_username || payload.sipUserName || filters.sip_username || filters.sipUserName || "", 120);
  const payloadSipDomain = trimText(payload.sip_domain || payload.sipDomain || filters.sip_domain || filters.sipDomain || "", 255);
  const warnings = [];
  const debugEnabled = toBool(process.env.PUSH_DEVICE_QUERY_DEBUG, false);

  const applyPackageFilters = (rows) => rows.filter((row) => {
    if (packageName && row.package_name && row.package_name !== packageName) return false;
    if (sipInstance && row.sip_instance && row.sip_instance !== sipInstance) return false;
    return true;
  });

  const applyFreshFilters = (rows) => rows.filter((row) => isPushDeviceFresh(row));
  const normalizeEnabled = (rows) => rows.filter((row) => toBool(row.enabled, false) || row.enabled === 1 || row.enabled === true);

  const loadRows = async (where, params) => {
    const rows = await query(connection, `SELECT * FROM push_devices WHERE ${where} ORDER BY updated_at DESC, id DESC`, params);
    return Array.isArray(rows) ? rows : [];
  };

  const pickActiveRows = async (where, params) => {
    const rows = normalizeEnabled(await loadRows(where, params));
    if (!rows.length) return null;
    const packageFiltered = applyPackageFilters(rows);
    if (!packageFiltered.length) return { rows: [], stale: false };
    const freshRows = applyFreshFilters(packageFiltered);
    if (packageFiltered.length > freshRows.length) warnings.push("DEVICE_REGISTRATION_STALE");
    if (!freshRows.length) return { rows: [], stale: true };
    return { rows: [freshRows[0]], stale: packageFiltered.length > freshRows.length || freshRows.length > 1 };
  };

  if (deviceKey) {
    if (debugEnabled) console.log(JSON.stringify({ stage: "device_key", deviceKey }, null, 2));
    const result = await pickActiveRows("device_key = ?", [deviceKey]);
    if (result) return { devices: result.rows, warnings };
  }

  if (payload.deviceId || payload.device_id || filters.device_id || filters.deviceId) {
    const candidateKey = buildDeviceKey({
      device_id: filters.device_id || filters.deviceId || payload.device_id || payload.deviceId || "",
      package_name: packageName,
      sip_instance: sipInstance,
      provider: filters.provider || payload.provider || "",
      token: payload.token || filters.token || "",
      sip_username: payload.sip_username || filters.sip_username || "",
      sip_domain: payload.sip_domain || filters.sip_domain || "",
    });
    if (debugEnabled) console.log(JSON.stringify({ stage: "device_id", candidateKey }, null, 2));
    const result = await pickActiveRows("device_key = ?", [candidateKey]);
    if (result) return { devices: result.rows, warnings };
  }

  const tokens = [payload.token, payload.jpush_registration_id, payload.fcm_token, payload.apns_token, payload.voip_token].filter((v) => String(v || "").trim());
  for (const token of tokens) {
    if (debugEnabled) console.log(JSON.stringify({ stage: "token", token_hint: safeTokenHint(token) }, null, 2));
    const result = await pickActiveRows("token = ?", [token]);
    if (result) return { devices: result.rows, warnings };
  }

  const parsedSipUri = parseSipUri(toUri);
  const username = payloadSipUsername || parsedSipUri.username;
  const domain = payloadSipDomain || parsedSipUri.domain;
  if (debugEnabled) console.log(JSON.stringify({ stage: "sip_lookup", toUri, payloadSipUsername, payloadSipDomain, parsedSipUri, username, domain }, null, 2));
  if (!username || !domain) return { devices: [], warnings };

  const rows = normalizeEnabled(await loadRows("sip_username = ? AND sip_domain = ?", [username, domain]));
  if (debugEnabled) console.log(JSON.stringify({ stage: "sip_rows", count: rows.length, sample: rows[0] ? safeDeviceSummary(rows[0]) : null }, null, 2));
  const filtered = applyPackageFilters(rows);
  if (debugEnabled) console.log(JSON.stringify({ stage: "sip_filtered", count: filtered.length }, null, 2));
  const fresh = applyFreshFilters(filtered);
  if (debugEnabled) console.log(JSON.stringify({ stage: "sip_fresh", count: fresh.length }, null, 2));
  if (filtered.length > fresh.length) warnings.push("DEVICE_REGISTRATION_STALE");
  return { devices: fresh, warnings };
}

async function dispatchFlexisipEvent(connection, payload) {
  const config = getGatewayConfig();
  const event = normalizeEventName(payload.event);
  if (!event) {
    const error = new Error("Invalid push event.");
    error.statusCode = 400;
    error.code = "PUSH_EVENT_INVALID";
    throw error;
  }

  const provider = normalizeProvider(payload.type || "");
  const eventSummary = buildEventSummary(payload);
  const pushId = randomUUID();
  await insertPushEvent(connection, {
    push_id: pushId,
    event,
    provider,
    sip_user: parseSipUri(payload.toUri).username ? `${parseSipUri(payload.toUri).username}@${parseSipUri(payload.toUri).domain}` : "",
    to_uri: payload.toUri || "",
    call_id: payload.callId || "",
    msgid: payload.msgid || "",
    status: "received",
    payload_summary: safeJson(eventSummary),
  });

  const legacyDispatch = buildLegacyDispatchResult(payload, config);
  const legacyProvider = createProvider(legacyDispatch.route.provider, event, config);
  const legacyLiveEnabled = Boolean(payload.deliver && canLiveSendProvider(legacyDispatch.route.provider, config) && legacyDispatch.route.should_send);
  const legacyTokenValue = legacyDispatch.route.token_value_present ? (payload.token || "") : "";
  let legacySendResult = {
    ok: true,
    status: "skipped",
    provider: legacyProvider.providerName,
    providerResponse: {
      ...legacyDispatch.provider_response,
      delivery_mode: "dry_run",
    },
  };
  if (legacyLiveEnabled) {
    try {
      legacySendResult = await legacyProvider.send({
        ...payload,
        device: {
          sip_username: parseSipUri(payload.toUri).username || "",
          sip_domain: parseSipUri(payload.toUri).domain || "",
          provider: legacyDispatch.route.provider || "",
        },
        devices: [],
        tokenValue: legacyTokenValue,
        tokenType: legacyDispatch.route.token_type,
        liveTest: true,
      });
    } catch (error) {
      legacySendResult = {
        ok: false,
        status: "failed",
        provider: legacyProvider.providerName,
        errorCode: error?.code || "PUSH_PROVIDER_SEND_FAILED",
        providerResponse: {
          delivery_mode: "live_test",
          provider: legacyProvider.providerName,
          error_code: error?.code || "PUSH_PROVIDER_SEND_FAILED",
          error_message: trimText(error?.message || "Push provider send failed.", 255),
        },
      };
    }
  }

  const targetDevices = await resolveTargetDevices(connection, payload);
  const devices = targetDevices.devices || [];
  const routePlan = buildRoutePlan({ event, payload, devices, config });
  const enhancedDispatches = routePlan.devices.map((planEntry) => buildEnhancedDispatchResult({ planEntry, config }));
  const legacyResult = {
    route_type: "legacy_route",
    provider: legacyProvider.providerName,
    mode: legacyLiveEnabled ? "live_test" : "dry_run",
    status: legacySendResult.status,
    error_code: legacySendResult.errorCode || legacySendResult.providerResponse?.error_code || "",
    route: legacyDispatch.route,
    providerResponse: {
      ...legacyDispatch.provider_response,
      ...legacySendResult.providerResponse,
      delivery_mode: legacyLiveEnabled ? "live_test" : "dry_run",
      route_type: "legacy_route",
      token_present: Boolean(legacyTokenValue),
      app_id_present: Boolean(legacyDispatch.route.app_id_present),
      route_reason: legacyDispatch.route.route_reason,
      error_code: legacySendResult.errorCode || legacySendResult.providerResponse?.error_code || "",
      dry_run: !legacyLiveEnabled,
    },
  };
  const results = [legacyResult, ...enhancedDispatches];
  const routePlanSummary = {
    warnings: Array.from(new Set([
      ...(targetDevices.warnings || []),
      ...routePlan.devices.filter((entry) => entry.route.route_reason === "provider_not_ready").map(() => "JPUSH_PROVIDER_NOT_READY"),
      ...routePlan.devices.filter((entry) => entry.route.route_reason === "provider_not_ready" || !entry.route.should_send).map(() => "FALLBACK_TO_LEGACY_ROUTE"),
      ...(routePlan.devices.length === 0 ? ["FALLBACK_TO_LEGACY_ROUTE"] : []),
    ])),
    legacy_route: {
      route_type: legacyDispatch.route_type,
      route_reason: legacyDispatch.route.route_reason,
      provider: legacyDispatch.route.provider,
      auth_mode: legacyDispatch.route.auth_mode,
      token_type: legacyDispatch.route.token_type,
      token_value_present: legacyDispatch.route.token_value_present,
      should_send: legacyDispatch.route.should_send,
      warnings: legacyDispatch.route.warnings,
      mode: legacyLiveEnabled ? "live_test" : "dry_run",
      status: legacySendResult.status,
      error_code: legacySendResult.errorCode || legacySendResult.providerResponse?.error_code || "",
    },
    enhanced_route: routePlan.devices.map((entry) => ({
      device_id: entry.device.device_id,
      device_key: entry.device.device_key || "",
      package_name: entry.device.package_name || "",
      app_region: entry.route.app_region,
      selected_provider: entry.route.selected_provider,
      route_reason: entry.route.route_reason,
      token_type: entry.route.token_type,
      token_value_present: entry.route.token_value_present,
      should_send: entry.route.should_send,
      provider_status: entry.route.provider_status,
    })),
  };

  await updatePushEvent(connection, pushId, {
    status: "processed",
    error_code: "",
    provider_response: safeJson({
      mode: legacyLiveEnabled ? "live_test" : "dry_run",
      event,
      provider,
      devicesCount: devices.length,
      routePlan: routePlanSummary,
      results,
      gatewayEnabled: config.enabled,
    }),
  });

  return {
    pushId,
    event,
    provider,
    devicesCount: devices.length,
    mode: legacyLiveEnabled ? "live_test" : "dry_run",
    status: "processed",
    routePlan: routePlanSummary,
    results,
    gatewayEnabled: config.enabled,
  };
}

function selectedPushProviderWarnings(providerName, config) {
  const provider = normalizeProvider(providerName);
  if (provider === "apns" || provider === "apns.voip") {
    const warnings = [];
    if (!config.apns?.enabled) warnings.push("APNS_DISABLED");
    const authMode = resolveApnsAuthMode(config);
    if (authMode === "invalid") warnings.push("APNS_AUTH_MODE_INVALID");
    else warnings.push(`APNS_AUTH_MODE_${authMode.toUpperCase()}`);
    if (!config.apns?.liveTestEnabled) warnings.push("APNS_LIVE_TEST_DISABLED");
    if (!config.apns?.bundleId) warnings.push("APNS_BUNDLE_ID_MISSING");
    if (!config.apns?.voipBundleId) warnings.push("APNS_VOIP_BUNDLE_ID_MISSING");
    if (authMode === "pem") {
      if (!config.apns?.certPath) warnings.push("APNS_CERT_PATH_MISSING");
      if (!config.apns?.voipCertPath) warnings.push("APNS_VOIP_CERT_PATH_MISSING");
    } else {
      if (!config.apns?.teamId) warnings.push("APNS_TEAM_ID_MISSING");
      if (!config.apns?.keyId) warnings.push("APNS_KEY_ID_MISSING");
      if (!config.apns?.keyPath) warnings.push("APNS_KEY_PATH_MISSING");
    }
    return warnings;
  }
  if (provider === "fcm") {
    const warnings = [];
    if (!config.fcm?.enabled) warnings.push("FCM_DISABLED");
    if (!config.fcm?.serviceAccountPath) warnings.push("FCM_SERVICE_ACCOUNT_PATH_MISSING");
    return warnings;
  }
  if (provider === "jpush") {
    const warnings = [];
    if (!config.jpush?.enabled) warnings.push("JPUSH_DISABLED");
    if (!config.jpush?.appKey) warnings.push("JPUSH_APP_KEY_MISSING");
    if (!config.jpush?.masterSecret) warnings.push("JPUSH_MASTER_SECRET_MISSING");
    if (!config.jpush?.apiUrl) warnings.push("JPUSH_API_URL_MISSING");
    return warnings;
  }
  if (["huawei", "xiaomi", "oppo", "vivo", "honor"].includes(provider)) {
    return ["PROVIDER_PLACEHOLDER"];
  }
  return [];
}

async function dispatchTestPush(connection, payload, { deliver = false } = {}) {
  const config = getGatewayConfig();
  const event = normalizeEventName(payload.event);
  if (!event) {
    const error = new Error("Invalid push event.");
    error.statusCode = 400;
    error.code = "PUSH_EVENT_INVALID";
    throw error;
  }

  const targetDevices = await resolveTargetDevices(connection, payload, payload);
  const devices = targetDevices.devices || [];
  const routePlan = buildRoutePlan({ event, payload, devices, config });
  const pushId = randomUUID();
  await insertPushEvent(connection, {
    push_id: pushId,
    event,
    provider: normalizeProvider(payload.type || payload.provider || payload.preferred_push_provider || ""),
    sip_user: trimText(payload.sip_username || payload.sipUserName || "", 255),
    to_uri: payload.toUri || payload.to_uri || "",
    call_id: payload.callId || payload.call_id || "",
    msgid: payload.msgid || payload.msgId || "",
    status: "received",
    payload_summary: safeJson({
      event,
      route_only: true,
      deliver,
      filters: {
        sip_username: payload.sip_username || payload.sipUserName || "",
        sip_domain: payload.sip_domain || payload.sipDomain || "",
        app_region: payload.app_region || payload.appRegion || "",
        package_name: payload.package_name || payload.packageName || "",
      },
    }),
  });

  const results = [];
  for (const planEntry of routePlan.devices) {
    const providerName = planEntry.selected_provider;
    const provider = createProvider(providerName, event, config);
    const route = planEntry.route;
    const selectedDevice = planEntry.device;
    const tokenValue = route.token_value_present
      ? (selectedDevice[route.token_type] || selectedDevice.token || "")
      : "";
    const liveTestAllowed = canLiveSendProvider(providerName, config);
    const liveTestEnabled = Boolean(deliver && route.should_send && liveTestAllowed);

    let sendResult = {
      ok: true,
      status: "skipped",
      provider: provider.providerName,
      providerResponse: {
        delivery_mode: "dry_run",
      },
    };

    if (liveTestEnabled) {
      try {
        sendResult = await provider.send({
          ...payload,
          event,
          device: selectedDevice,
          devices,
          tokenValue,
          tokenType: route.token_type,
          liveTest: true,
          jpush_payload_mode: payload.jpush_payload_mode || "",
          callId: payload.callId || payload.call_id || "",
          fromUri: payload.fromUri || payload.from_uri || "",
          toUri: payload.toUri || payload.to_uri || "",
          msgid: payload.msgid || payload.msgId || payload.msg_id || payload.messageId || payload.message_id || "",
        });
      } catch (error) {
        sendResult = {
          ok: false,
          status: "failed",
          provider: provider.providerName,
          errorCode: error?.code || "PUSH_PROVIDER_SEND_FAILED",
          providerResponse: {
            delivery_mode: "live_test",
            provider: provider.providerName,
            error_code: error?.code || "PUSH_PROVIDER_SEND_FAILED",
            error_message: trimText(error?.message || "Push provider send failed.", 255),
          },
        };
      }
    }

    const errorCode = sendResult.errorCode || sendResult.providerResponse?.error_code || "";

    results.push({
      device: safeDeviceSummary(selectedDevice),
      route_type: "legacy_route",
      route: {
        selected_provider: providerName,
        route_reason: route.route_reason,
        token_type: route.token_type,
        token_value_present: route.token_value_present,
        should_send: route.should_send,
        provider_status: route.provider_status,
        app_region: route.app_region,
      },
      provider: provider.providerName,
      status: sendResult.status,
      mode: liveTestEnabled ? "live_test" : "dry_run",
      error_code: errorCode,
      providerResponse: {
        ...sendResult.providerResponse,
        config_warnings: selectedPushProviderWarnings(providerName, config),
        dry_run: !liveTestEnabled,
        route_type: "legacy_route",
        token_present: Boolean(tokenValue),
        app_id_present: Boolean(trimText(payload.app_id || payload.appId || "", 256)),
        route_reason: route.route_reason,
        error_code: errorCode,
      },
    });
  }

  await updatePushEvent(connection, pushId, {
    status: "processed",
    error_code: "",
    provider_response: safeJson({
      mode: results.some((entry) => entry.mode === "live_test") ? "live_test" : "dry_run",
      event,
      warnings: Array.from(new Set([
        ...(targetDevices.warnings || []),
        ...routePlan.devices.filter((entry) => entry.route.route_reason === "provider_not_ready").map(() => "JPUSH_PROVIDER_NOT_READY"),
        ...routePlan.devices.filter((entry) => entry.route.route_reason === "provider_not_ready" || !entry.route.should_send).map(() => "FALLBACK_TO_LEGACY_ROUTE"),
        ...(routePlan.devices.length === 0 ? ["FALLBACK_TO_LEGACY_ROUTE"] : []),
      ])),
      routePlan: routePlan.devices.map((entry) => ({
        route_type: "legacy_route",
        device_id: entry.device.device_id,
        device_key: entry.device.device_key || "",
        package_name: entry.device.package_name || "",
        app_region: entry.route.app_region,
        selected_provider: entry.route.selected_provider,
        route_reason: entry.route.route_reason,
        token_type: entry.route.token_type,
        token_value_present: entry.route.token_value_present,
        should_send: entry.route.should_send,
        provider_status: entry.route.provider_status,
      })),
      results,
      delivered: results.some((entry) => isSuccessfulProviderResult(entry)),
    }),
  });

  return {
    pushId,
    event,
    mode: results.some((entry) => entry.mode === "live_test") ? "live_test" : "dry_run",
    devicesCount: devices.length,
    warnings: Array.from(new Set([
      ...(targetDevices.warnings || []),
      ...routePlan.devices.filter((entry) => entry.route.route_reason === "provider_not_ready").map(() => "JPUSH_PROVIDER_NOT_READY"),
      ...routePlan.devices.filter((entry) => entry.route.route_reason === "provider_not_ready" || !entry.route.should_send).map(() => "FALLBACK_TO_LEGACY_ROUTE"),
      ...(routePlan.devices.length === 0 ? ["FALLBACK_TO_LEGACY_ROUTE"] : []),
    ])),
    results,
    delivered: results.some((entry) => isSuccessfulProviderResult(entry)),
  };
}

function readFlexisipRequest(request) {
  const payload = normalizeFlexisipPushInput(request);
  if (!payload.event) {
    const error = new Error("Missing event.");
    error.statusCode = 400;
    error.code = "PUSH_EVENT_MISSING";
    throw error;
  }
  if (!payload.type) {
    const error = new Error("Missing type.");
    error.statusCode = 400;
    error.code = "PUSH_TYPE_MISSING";
    throw error;
  }
  return payload;
}

export function registerPushGatewayRoutes(app, { requireAdmin } = {}) {
  const pushTextParser = express.text({ type: ["text/plain", "application/octet-stream", "*/*"], limit: "1mb" });
  const jsonParser = express.json({ limit: "1mb" });

  app.post("/api/push/flexisip", pushTextParser, async (request, response) => {
    if (!isGatewayRequestAuthorized(request)) {
      return response.status(401).json({ success: false, code: "PUSH_GATEWAY_UNAUTHORIZED", message: "Unauthorized." });
    }

    const payload = readFlexisipRequest(request);

    // Log Flexisip external-push callback with all parameters
    console.log(JSON.stringify({
      src: "flexisip-external-push",
      event: payload.event,
      type: payload.type,
      token_hint: payload.tokenHint,
      app_id: payload.appId,
      from_uri: payload.fromUri,
      from_name: payload.fromName || "",
      from_tag: payload.fromTag || "",
      to_uri: payload.toUri,
      call_id: payload.callId,
      msgid: payload.msgid,
      uid: payload.uid,
      sound: payload.sound,
      body_length: payload.bodyLength || 0,
      deliver: payload.deliver,
      timestamp: new Date().toISOString(),
    }));

    let connection;
    try {
      connection = await pool.getConnection();
      const result = await dispatchFlexisipEvent(connection, payload);
      return response.json({
        success: true,
        code: "PUSH_GATEWAY_EVENT_ACCEPTED",
        message: "Push event accepted.",
        data: {
          pushId: result.pushId,
          event: result.event,
          provider: result.provider,
          devicesCount: result.devicesCount,
          mode: result.mode,
          status: result.status,
          gatewayEnabled: result.gatewayEnabled,
          routePlan: result.routePlan,
          results: result.results,
        },
      });
    } catch (error) {
      const statusCode = error?.statusCode || 500;
      return response.status(statusCode).json({
        success: false,
        code: error?.code || "PUSH_GATEWAY_EVENT_FAILED",
        message: error?.message || "Push gateway failed.",
      });
    } finally {
      if (connection) connection.release();
    }
  });

  app.post("/api/push/devices/register", jsonParser, async (request, response) => {
    if (!isGatewayRequestAuthorized(request)) {
      return response.status(401).json({ success: false, code: "PUSH_GATEWAY_UNAUTHORIZED", message: "Unauthorized." });
    }

    const payload = request.body || {};
    let connection;
    try {
      connection = await pool.getConnection();
      const result = await upsertPushDevice(connection, payload);
      return response.json({
        success: true,
        code: "PUSH_DEVICE_REGISTERED",
        message: "Push device saved.",
        data: {
          created_or_updated: result.createdOrUpdated,
          ...getDeviceRegistrationHints(result.device || {}),
          enabled: true,
          last_seen_at: result.device?.last_seen_at || null,
          device: safeDeviceSummary(result.device || {}),
        },
      });
    } catch (error) {
      return response.status(error?.statusCode || 500).json({
        success: false,
        code: error?.code || "PUSH_DEVICE_REGISTER_FAILED",
        message: "Failed to register push device.",
        detail: trimText(error?.message || error?.code || "Push device registration failed.", 255),
      });
    } finally {
      if (connection) connection.release();
    }
  });

  app.post("/api/push/devices/unregister", jsonParser, async (request, response) => {
    if (!isGatewayRequestAuthorized(request)) {
      return response.status(401).json({ success: false, code: "PUSH_GATEWAY_UNAUTHORIZED", message: "Unauthorized." });
    }

      const payload = request.body || {};
      let connection;
      try {
        connection = await pool.getConnection();
        const affectedRows = await disablePushDevice(connection, payload);
        return response.json({
          success: true,
          code: "PUSH_DEVICE_UNREGISTERED",
          message: "Push device disabled.",
          data: {
            affectedRows,
            enabled: false,
            device_key_hint: safeTokenHint(payload.device_key || payload.deviceKey || ""),
            device_id_hint: safeTokenHint(payload.device_id || payload.deviceId || ""),
          },
        });
    } catch (error) {
      return response.status(error?.statusCode || 500).json({
        success: false,
        code: error?.code || "PUSH_DEVICE_UNREGISTER_FAILED",
        message: error?.message || "Push device unregister failed.",
      });
    } finally {
      if (connection) connection.release();
    }
  });

  app.post("/api/push/test/send", jsonParser, async (request, response) => {
    if (!isGatewayRequestAuthorized(request)) {
      return response.status(401).json({ success: false, code: "PUSH_GATEWAY_UNAUTHORIZED", message: "Unauthorized." });
    }

    const payload = request.body || {};
    const deliver = toBool(payload.deliver, false);
    let connection;
    try {
      connection = await pool.getConnection();
      const result = await dispatchTestPush(connection, payload, { deliver });
      return response.json({
        success: true,
        code: "PUSH_TEST_SEND_OK",
        message: "Push test processed.",
        data: result,
      });
    } catch (error) {
      return response.status(error?.statusCode || 500).json({
        success: false,
        code: error?.code || "PUSH_TEST_SEND_FAILED",
        message: error?.message || "Push test send failed.",
      });
    } finally {
      if (connection) connection.release();
    }
  });

  if (typeof requireAdmin === "function") {
    app.get("/api/push/devices", requireAdmin, async (request, response) => {
      let connection;
      try {
        connection = await pool.getConnection();
        const devices = await listPushDevices(connection, request.query || {});
        return response.json({
          success: true,
          code: "PUSH_DEVICE_LIST_OK",
          data: {
            devices,
            count: devices.length,
          },
        });
      } catch (error) {
        return response.status(error?.statusCode || 500).json({
          success: false,
          code: error?.code || "PUSH_DEVICE_LIST_FAILED",
          message: error?.message || "Push device listing failed.",
        });
      } finally {
        if (connection) connection.release();
      }
    });
  }
}

export {
  ApnsProvider,
  ApnsVoipProvider,
  FcmProvider,
  JPushProvider,
  HuaweiProvider,
  XiaomiProvider,
  OppoProvider,
  VivoProvider,
  HonorProvider,
  buildEventSummary,
  createProvider,
  dispatchFlexisipEvent,
  getGatewayConfig,
  isGatewayRequestAuthorized,
  listPushDevices,
  normalizeFlexisipPushInput,
  normalizeProvider,
  parseSipUri,
  safeDeviceSummary,
  upsertPushDevice,
  disablePushDevice,
};
