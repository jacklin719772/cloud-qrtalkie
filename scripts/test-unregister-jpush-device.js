import "../server/loadEnv.js";

function maskId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}…${text.slice(-2)}`;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

const baseUrl = process.env.PUSH_GATEWAY_BASE_URL || "http://127.0.0.1:3001";
const secret = String(process.env.PUSH_GATEWAY_SECRET || "").trim();
const secretHeader = String(process.env.PUSH_GATEWAY_SECRET_HEADER || "x-push-gateway-secret").trim() || "x-push-gateway-secret";
const unregisterUrl = `${baseUrl.replace(/\/+$/, "")}/api/push/devices/unregister`;

const payload = {
  device_id: process.env.PUSH_TEST_DEVICE_ID || "test-android-001",
  device_key: process.env.PUSH_TEST_DEVICE_KEY || "",
  sip_username: process.env.PUSH_TEST_SIP_USERNAME || "20010002",
  sip_domain: process.env.PUSH_TEST_SIP_DOMAIN || "sip.qrtalkie.org",
  sip_instance: process.env.PUSH_TEST_SIP_INSTANCE || "default",
  provider: "jpush",
  package_name: process.env.PUSH_TEST_PACKAGE_NAME || "com.qrtalkie.qrtalkie",
  token: process.env.PUSH_LIVE_TEST_JPUSH_REGISTRATION_ID || process.env.PUSH_TEST_TOKEN || "170976fa8BD61C1A6F5",
};

const headers = { "content-type": "application/json" };
if (secret) headers[secretHeader] = secret;

const response = await fetch(unregisterUrl, {
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
  script: "test-unregister-jpush-device",
  unregister_url: unregisterUrl,
  device_id_hint: maskId(payload.device_id),
  device_key_hint: maskId(payload.device_key || `device:${payload.device_id}|package:${payload.package_name}`),
  status: response.status,
  ok: response.ok,
  code: parsed?.code || null,
  message: parsed?.message || null,
  enabled: parsed?.data?.enabled ?? null,
  affectedRows: parsed?.data?.affectedRows ?? null,
}, null, 2));
