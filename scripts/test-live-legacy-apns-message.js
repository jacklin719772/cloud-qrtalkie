import "../server/loadEnv.js";

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function maskToken(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}…${text.slice(-2)}`;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

const baseUrl = process.env.PUSH_GATEWAY_TEST_URL || "http://127.0.0.1:3001/api/push/flexisip";
const secret = String(process.env.PUSH_GATEWAY_SECRET || "").trim();
const secretHeader = String(process.env.PUSH_GATEWAY_SECRET_HEADER || "x-push-gateway-secret").trim() || "x-push-gateway-secret";
const token = String(process.env.PUSH_LIVE_TEST_TOKEN || "").trim();

if (!token) {
  console.error(JSON.stringify({ ok: false, error: "PUSH_LIVE_TEST_TOKEN_MISSING" }, null, 2));
  process.exit(1);
}

const liveEnabled = toBool(process.env.PUSH_GATEWAY_LIVE_TEST_ENABLED, false) && toBool(process.env.APNS_LIVE_TEST_ENABLED, false);
const payload = {
  event: "message",
  type: "apns",
  token,
  app_id: process.env.PUSH_LIVE_TEST_APP_ID || "com.qrtalkie.push.test",
  from_uri: process.env.PUSH_LIVE_TEST_FROM_URI || "sip:alice@sip.qrtalkie.org",
  to_uri: process.env.PUSH_LIVE_TEST_TO_URI || "sip:950001@sip.qrtalkie.org",
  call_id: "",
  msgid: process.env.PUSH_LIVE_TEST_MSGID || "live-apns-message-001",
  uid: process.env.PUSH_LIVE_TEST_UID || "live-apns-message-uid",
  sound: process.env.PUSH_LIVE_TEST_SOUND || "default",
  body: process.env.PUSH_LIVE_TEST_BODY || "live apns message test",
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

console.log(JSON.stringify({
  script: "test-live-legacy-apns-message",
  url: baseUrl,
  liveEnabled,
  token_hint: maskToken(token),
  status: response.status,
  ok: response.ok,
  code: parsed?.code || null,
  message: parsed?.message || null,
  data: parsed?.data || null,
}, null, 2));
