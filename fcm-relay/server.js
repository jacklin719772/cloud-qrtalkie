const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const fs = require("node:fs");

const PORT = Number(process.env.PORT || 3100);
const TOKEN = String(process.env.RELAY_TOKEN || "");
const SERVICE_ACCOUNT_PATH = String(process.env.FCM_SERVICE_ACCOUNT_PATH || "");
const FCM_TIMEOUT_MS = Number(process.env.FCM_TIMEOUT_MS || 10000);
const BODY_LIMIT = 64 * 1024;

let serviceAccount = null;
let cachedAccessToken = { value: "", expiresAt: 0 };

function loadServiceAccount() {
  if (serviceAccount) return serviceAccount;
  const parsed = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("SERVICE_ACCOUNT_INVALID");
  }
  serviceAccount = parsed;
  return serviceAccount;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function requestJson(urlString, { method = "POST", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === "http:" ? http : https;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    request.setTimeout(FCM_TIMEOUT_MS, () => request.destroy(new Error("UPSTREAM_TIMEOUT")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedAccessToken.value && now < cachedAccessToken.expiresAt) {
    return cachedAccessToken.value;
  }
  const account = loadServiceAccount();
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const issuedAt = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(account.private_key, "base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const assertion = `${signingInput}.${signature}`;

  const response = await requestJson(tokenUri, {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  let parsed = {};
  try {
    parsed = JSON.parse(response.body || "{}");
  } catch {}
  if (!response.ok || !parsed.access_token) {
    throw new Error(`FCM_OAUTH_FAILED ${response.status} ${String(response.body || "").slice(0, 200)}`);
  }
  const ttl = Number(parsed.expires_in || 3600);
  cachedAccessToken = { value: parsed.access_token, expiresAt: now + Math.max(60, ttl - 60) * 1000 };
  return cachedAccessToken.value;
}

function buildMessage(payload) {
  const ca = payload.ca && typeof payload.ca === "object" ? payload.ca : null;
  const data = {};
  if (payload.event === "ca_message" && ca) {
    data.type = "ca_message";
    data.conversation_id = String(ca.conversation_id || "");
    data.visitor_id = String(ca.visitor_id || "");
    data.visitor_name = String(ca.visitor_name || "");
    data.unread = String(ca.unread ?? "");
  }
  data.event = String(payload.event || "");
  data.call_id = String(payload.call_id || "");
  data.msgid = String(payload.msgid || "");
  data.from_uri = String(payload.from_uri || "");
  data.to_uri = String(payload.to_uri || "");
  data.uid = String(payload.uid || "");
  data.sound = String(payload.sound || "");
  data.sip_username = String(payload.sip_username || "");
  data.sip_domain = String(payload.sip_domain || "");
  data.package_name = String(payload.package_name || "");
  return {
    token: String(payload.token || ""),
    data,
    android: { priority: "HIGH" },
  };
}

async function sendFcm(message) {
  const account = loadServiceAccount();
  const accessToken = await getAccessToken();
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
  const response = await requestJson(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
  let fcmError = "";
  try {
    const parsed = JSON.parse(response.body || "{}");
    fcmError = parsed?.error?.status || "";
  } catch {}
  return {
    ok: response.ok,
    statusCode: response.status,
    fcmError,
    body: String(response.body || "").slice(0, 512),
  };
}

function tokenAuthorized(request) {
  if (!TOKEN) return false;
  const provided = String(request.headers["x-relay-token"] || "");
  const expected = Buffer.from(TOKEN);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function hintToken(token) {
  if (!token) return "";
  return token.length > 12 ? `${token.slice(0, 6)}...${token.slice(-6)}` : token;
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { ok: true, service: "fcm-relay" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/push/fcm") {
    sendJson(response, 404, { ok: false, error: "NOT_FOUND" });
    return;
  }
  if (!tokenAuthorized(request)) {
    sendJson(response, 401, { ok: false, error: "UNAUTHORIZED" });
    return;
  }

  let size = 0;
  const chunks = [];
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      sendJson(response, 413, { ok: false, error: "BODY_TOO_LARGE" });
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", async () => {
    const startedAt = Date.now();
    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(response, 400, { ok: false, error: "INVALID_JSON" });
      return;
    }
    const requestId = String(payload.request_id || "");
    const event = String(payload.event || "");
    if (!payload.token || !event) {
      sendJson(response, 400, { ok: false, error: "TOKEN_OR_EVENT_MISSING" });
      return;
    }
    try {
      const result = await sendFcm(buildMessage(payload));
      console.log(
        JSON.stringify({
          src: "fcm-relay",
          request_id: requestId,
          event,
          token_hint: hintToken(String(payload.token)),
          ok: result.ok,
          http_status: result.statusCode,
          fcm_error: result.fcmError,
          duration_ms: Date.now() - startedAt,
        })
      );
      sendJson(response, result.ok ? 200 : 502, {
        ok: result.ok,
        status: result.ok ? "success" : "failed",
        http_status: result.statusCode,
        fcm_error: result.fcmError,
        response_body: result.body,
      });
    } catch (error) {
      const message = String(error?.message || "RELAY_SEND_FAILED");
      console.error(
        JSON.stringify({
          src: "fcm-relay",
          request_id: requestId,
          event,
          token_hint: hintToken(String(payload.token)),
          ok: false,
          error: message,
          duration_ms: Date.now() - startedAt,
        })
      );
      sendJson(response, 502, { ok: false, status: "failed", error: message });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ src: "fcm-relay", action: "listening", port: PORT }));
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
