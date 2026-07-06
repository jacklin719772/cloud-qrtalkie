import "../server/loadEnv.js";

const baseUrl = process.env.PUSH_GATEWAY_TEST_URL || "http://127.0.0.1:3001/api/push/test/send";
const secret = String(process.env.PUSH_GATEWAY_SECRET || "").trim();
const secretHeader = String(process.env.PUSH_GATEWAY_SECRET_HEADER || "x-push-gateway-secret").trim() || "x-push-gateway-secret";

const payload = {
  event: "message",
  sip_username: "950001",
  sip_domain: "sip.qrtalkie.org",
  app_region: "overseas",
  platform: "android",
  preferred_push_provider: "fcm",
  package_name: "com.qrtalkie.push.test",
  manufacturer: "Google",
  has_gms: true,
  device_id: "route-overseas-fcm-001",
  token: "overseas-fcm-token-test",
  fcm_token: "overseas-fcm-token-test",
  from_uri: "sip:alice@sip.qrtalkie.org",
  to_uri: "sip:950001@sip.qrtalkie.org",
  msgid: "route-overseas-fcm-msg-001",
  call_id: "",
  deliver: false,
};

const headers = { "content-type": "application/json" };
if (secret) headers[secretHeader] = secret;

const response = await fetch(baseUrl, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
});

console.log(await response.text());
