import "../server/loadEnv.js";

const baseUrl = process.env.PUSH_GATEWAY_TEST_URL || "http://127.0.0.1:3001/api/push/flexisip";
const secret = String(process.env.PUSH_GATEWAY_SECRET || "").trim();
const secretHeader = String(process.env.PUSH_GATEWAY_SECRET_HEADER || "x-push-gateway-secret").trim() || "x-push-gateway-secret";

const payload = {
  event: "call",
  type: "apns",
  token: "test-token-call",
  app_id: "com.qrtalkie.push.test",
  from_uri: "sip:alice@sip.qrtalkie.org",
  to_uri: "sip:bob@sip.qrtalkie.org",
  call_id: "call-test-001",
  msgid: "",
  uid: "uid-call-001",
  sound: "default",
  body: "call push test",
};

const headers = {
  "content-type": "application/json",
};

if (secret) headers[secretHeader] = secret;

const response = await fetch(baseUrl, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});

const text = await response.text();
let parsed;
try {
  parsed = text ? JSON.parse(text) : null;
} catch {
  parsed = { raw: text };
}

console.log(JSON.stringify({
  url: baseUrl,
  status: response.status,
  ok: response.ok,
  code: parsed?.code || null,
  message: parsed?.message || null,
  data: parsed?.data || null,
}, null, 2));
