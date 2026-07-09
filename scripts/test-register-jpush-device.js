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

const baseUrl = process.env.PUSH_GATEWAY_BASE_URL || "http://127.0.0.1:3001";
const secret = String(process.env.PUSH_GATEWAY_SECRET || "").trim();
const secretHeader = String(process.env.PUSH_GATEWAY_SECRET_HEADER || "x-push-gateway-secret").trim() || "x-push-gateway-secret";
const registerUrl = `${baseUrl.replace(/\/+$/, "")}/api/push/devices/register`;
const listUrl = `${baseUrl.replace(/\/+$/, "")}/api/push/devices`;

const payload = {
  device_id: process.env.PUSH_TEST_DEVICE_ID || "test-android-001",
  device_key: process.env.PUSH_TEST_DEVICE_KEY || "",
  sip_username: process.env.PUSH_TEST_SIP_USERNAME || "20010002",
  sip_domain: process.env.PUSH_TEST_SIP_DOMAIN || "sip.qrtalkie.org",
  sip_instance: process.env.PUSH_TEST_SIP_INSTANCE || "default",
  platform: "android",
  provider: "jpush",
  token: process.env.PUSH_LIVE_TEST_JPUSH_REGISTRATION_ID || process.env.PUSH_TEST_TOKEN || "170976fa8BD61C1A6F5",
  jpush_registration_id: process.env.PUSH_LIVE_TEST_JPUSH_REGISTRATION_ID || "",
  app_region: "china",
  package_name: process.env.PUSH_TEST_PACKAGE_NAME || "com.qrtalkie.qrtalkie",
  manufacturer: process.env.PUSH_TEST_MANUFACTURER || "Xiaomi",
  preferred_push_provider: "jpush",
  device_model: process.env.PUSH_TEST_DEVICE_MODEL || "Redmi Note 12",
  os_version: process.env.PUSH_TEST_OS_VERSION || "13.0",
  app_version: process.env.PUSH_TEST_APP_VERSION || "1.0.0",
  has_gms: toBool(process.env.PUSH_TEST_HAS_GMS, false),
};

async function postJson(url, body) {
  const headers = { "content-type": "application/json" };
  if (secret) headers[secretHeader] = secret;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { response, parsed };
}

const first = await postJson(registerUrl, payload);
const second = await postJson(registerUrl, payload);

let count = null;
try {
  const headers = {};
  if (secret) headers[secretHeader] = secret;
  const listResponse = await fetch(`${listUrl}?device_id=${encodeURIComponent(payload.device_id)}&package_name=${encodeURIComponent(payload.package_name)}`, {
    headers,
  });
  const listText = await listResponse.text();
  const listParsed = listText ? JSON.parse(listText) : null;
  count = listParsed?.data?.count ?? null;
} catch {
  count = null;
}

console.log(JSON.stringify({
  script: "test-register-jpush-device",
  register_url: registerUrl,
  device_id_hint: maskId(payload.device_id),
  device_key_hint: maskId(payload.device_key || `device:${payload.device_id}|package:${payload.package_name}`),
  registration_id_hint: maskId(payload.jpush_registration_id || payload.token),
  first: {
    status: first.response.status,
    ok: first.response.ok,
    code: first.parsed?.code || null,
    message: first.parsed?.message || null,
    created_or_updated: first.parsed?.data?.created_or_updated || null,
    enabled: first.parsed?.data?.enabled ?? null,
    last_seen_at: first.parsed?.data?.last_seen_at || null,
  },
  second: {
    status: second.response.status,
    ok: second.response.ok,
    code: second.parsed?.code || null,
    message: second.parsed?.message || null,
    created_or_updated: second.parsed?.data?.created_or_updated || null,
    enabled: second.parsed?.data?.enabled ?? null,
    last_seen_at: second.parsed?.data?.last_seen_at || null,
  },
  device_count: count,
}, null, 2));
