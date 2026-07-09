import "../server/loadEnv.js";

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function maskId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}…${text.slice(-2)}`;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

const baseUrl = process.env.PUSH_GATEWAY_TEST_URL || "http://127.0.0.1:3001/api/push/flexisip";
const secret = String(process.env.PUSH_GATEWAY_SECRET || "").trim();
const secretHeader = String(process.env.PUSH_GATEWAY_SECRET_HEADER || "x-push-gateway-secret").trim() || "x-push-gateway-secret";
const registrationId = String(process.env.PUSH_LIVE_TEST_JPUSH_REGISTRATION_ID || process.env.PUSH_TEST_TOKEN || "").trim();
const liveEnabled = toBool(process.env.PUSH_GATEWAY_LIVE_TEST_ENABLED, false) && toBool(process.env.JPUSH_LIVE_TEST_ENABLED, false);

const payload = {
  event: "call",
  type: "jpush",
  provider: "jpush",
  token: registrationId || "test-jpush-token",
  jpush_registration_id: registrationId || "test-jpush-token",
  app_id: process.env.PUSH_LIVE_TEST_APP_ID || "com.qrtalkie.push.test.jpush",
  from_uri: process.env.PUSH_LIVE_TEST_FROM_URI || "sip:alice@sip.qrtalkie.org",
  to_uri: process.env.PUSH_LIVE_TEST_TO_URI || `sip:${process.env.PUSH_TEST_SIP_USERNAME || "20010002"}@${process.env.PUSH_TEST_SIP_DOMAIN || "sip.qrtalkie.org"}`,
  call_id: process.env.PUSH_LIVE_TEST_CALL_ID || "live-jpush-route-001",
  msgid: process.env.PUSH_LIVE_TEST_MSGID || "",
  uid: process.env.PUSH_LIVE_TEST_UID || "live-jpush-route-uid",
  sound: process.env.PUSH_LIVE_TEST_SOUND || "default",
  body: process.env.PUSH_LIVE_TEST_BODY || "live jpush route test",
  deliver: liveEnabled,
};

const headers = { "content-type": "application/json" };
if (secret) headers[secretHeader] = secret;

const response = await fetch(baseUrl, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});

const text = await response.text();
let parsed = null;
try {
  parsed = text ? JSON.parse(text) : null;
} catch {
  parsed = { raw: text };
}

const enhancedRoute = parsed?.data?.routePlan?.enhanced_route || [];
const legacyRoute = parsed?.data?.routePlan?.legacy_route || null;

console.log(JSON.stringify({
  script: "test-live-jpush-route",
  url: baseUrl,
  liveEnabled,
  registration_id_hint: maskId(registrationId),
  status: response.status,
  ok: response.ok,
  code: parsed?.code || null,
  message: parsed?.message || null,
  legacy_route: legacyRoute,
  enhanced_route: enhancedRoute,
  warnings: parsed?.data?.routePlan?.warnings || [],
  device_count: parsed?.data?.devicesCount ?? null,
}, null, 2));
