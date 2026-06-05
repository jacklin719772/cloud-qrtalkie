const DEFAULT_WEB_BASE_URL = "http://account.qrtalkie.org";
const DEFAULT_LOGIN_PATH = "/login";
const DEFAULT_STATISTICS_PATH = "/admin/statistics";
const DEFAULT_TIMEOUT_MS = 10000;

export class FlexisipAdminSessionError extends Error {
  constructor(message, { status = 0, path = "", contentType = "", cause = null } = {}) {
    super(message);
    this.name = "FlexisipAdminSessionError";
    this.status = status;
    this.path = path;
    this.contentType = contentType;
    if (cause) this.cause = cause;
  }
}

let cookieHeader = "";
let sessionReady = false;
let loginPromise = null;

function getConfig() {
  const baseUrl = String(process.env.FLEXISIP_ADMIN_BASE_URL || DEFAULT_WEB_BASE_URL).replace(/\/+$/, "");
  const loginPath = normalizePath(process.env.FLEXISIP_ADMIN_LOGIN_PATH || DEFAULT_LOGIN_PATH);
  const statisticsPath = normalizePath(process.env.FLEXISIP_ADMIN_STATISTICS_PATH || DEFAULT_STATISTICS_PATH);
  const username = String(process.env.FLEXISIP_ADMIN_USERNAME || "");
  const password = String(process.env.FLEXISIP_ADMIN_PASSWORD || "");
  const timeoutMs = Number(process.env.FLEXISIP_ACCOUNT_MANAGER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    baseUrl,
    loginPath,
    statisticsPath,
    username,
    password,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function normalizePath(path) {
  return `/${String(path || "").replace(/^\/+/, "")}`;
}

function resolveUrl(path) {
  const config = getConfig();
  return new URL(normalizePath(path), `${config.baseUrl}/`).toString();
}

function mergeSetCookie(headers) {
  const setCookie = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const fallback = setCookie.length > 0 ? setCookie : [headers.get("set-cookie")].filter(Boolean);
  if (fallback.length === 0) return;

  const jar = new Map(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
      }),
  );

  for (const rawCookie of fallback) {
    for (const cookiePart of splitSetCookie(rawCookie)) {
      const cookie = cookiePart.split(";")[0]?.trim();
      if (!cookie) continue;
      const index = cookie.indexOf("=");
      if (index === -1) continue;
      jar.set(cookie.slice(0, index), cookie.slice(index + 1));
    }
  }

  cookieHeader = Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
}

function splitSetCookie(value) {
  if (!value) return [];
  return String(value).split(/,(?=\s*[^;,=\s]+=[^;,]+)/);
}

function extractCsrfToken(html) {
  const metaMatch = String(html).match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i);
  if (metaMatch) return decodeHtml(metaMatch[1]);

  const inputMatch = String(html).match(/<input[^>]+name=["']_token["'][^>]+value=["']([^"']+)["']/i);
  return inputMatch ? decodeHtml(inputMatch[1]) : "";
}

function extractFormAction(html, fallbackPath) {
  const match = String(html).match(/<form[^>]+method=["']POST["'][^>]+action=["']([^"']+)["']/i);
  if (!match) return fallbackPath;
  const action = decodeHtml(match[1]);
  try {
    return new URL(action).pathname;
  } catch {
    return normalizePath(action);
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function fetchWithTimeout(url, options = {}) {
  const config = getConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers = {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      ...(options.headers || {}),
    };
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(url, {
      ...options,
      headers,
      redirect: options.redirect || "manual",
      signal: controller.signal,
    });
    mergeSetCookie(response.headers);
    return response;
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    throw new FlexisipAdminSessionError(
      isTimeout ? `Flexisip Admin request timed out after ${config.timeoutMs}ms.` : "Flexisip Admin request failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureAdminSession() {
  if (sessionReady) return;
  if (!loginPromise) {
    loginPromise = loginAdmin().finally(() => {
      loginPromise = null;
    });
  }
  await loginPromise;
}

async function loginAdmin() {
  const config = getConfig();
  if (!config.username || !config.password) {
    throw new FlexisipAdminSessionError("Flexisip Admin username or password is not configured.");
  }

  cookieHeader = "";
  sessionReady = false;

  const loginResponse = await fetchWithTimeout(resolveUrl(config.loginPath), { method: "GET" });
  const loginHtml = await loginResponse.text();
  if (!loginResponse.ok) {
    throw new FlexisipAdminSessionError("Flexisip Admin login page request failed.", {
      status: loginResponse.status,
      path: config.loginPath,
      contentType: loginResponse.headers.get("content-type") || "",
    });
  }

  const csrfToken = extractCsrfToken(loginHtml);
  const actionPath = extractFormAction(loginHtml, "/authenticate");
  const body = new URLSearchParams();
  if (csrfToken) body.set("_token", csrfToken);
  body.set("username", config.username);
  body.set("password", config.password);

  const authResponse = await fetchWithTimeout(resolveUrl(actionPath), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: resolveUrl(config.loginPath),
    },
    body,
  });

  const location = authResponse.headers.get("location") || "";
  if (![200, 302, 303].includes(authResponse.status)) {
    throw new FlexisipAdminSessionError("Flexisip Admin login failed.", {
      status: authResponse.status,
      path: actionPath,
      contentType: authResponse.headers.get("content-type") || "",
    });
  }
  if (authResponse.status === 200) {
    const text = await authResponse.text();
    if (/name=["']password["']/i.test(text) || /name=["']username["']/i.test(text)) {
      throw new FlexisipAdminSessionError("Flexisip Admin login did not create an authenticated session.", {
        status: authResponse.status,
        path: actionPath,
        contentType: authResponse.headers.get("content-type") || "",
      });
    }
  }
  if (authResponse.status >= 300 && /login/i.test(location)) {
    throw new FlexisipAdminSessionError("Flexisip Admin login was redirected back to login page.", {
      status: authResponse.status,
      path: actionPath,
    });
  }

  sessionReady = true;
}

export async function requestAdmin(path, options = {}) {
  await ensureAdminSession();
  let response = await fetchWithTimeout(resolveUrl(path), options);

  if (isLoginRedirect(response)) {
    sessionReady = false;
    await ensureAdminSession();
    response = await fetchWithTimeout(resolveUrl(path), options);
  }

  return response;
}

function isLoginRedirect(response) {
  if (![302, 303, 401, 419].includes(response.status)) return false;
  const location = response.headers.get("location") || "";
  return response.status === 401 || response.status === 419 || /login/i.test(location);
}

export async function getCallsStatistics(params = {}) {
  const config = getConfig();
  const query = new URLSearchParams();

  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.period) query.set("by", params.period);
  if (params.contactList) query.set("contacts_list", params.contactList);

  const path = `${config.statisticsPath}/calls${query.toString() ? `?${query.toString()}` : ""}`;
  return requestAdmin(path, {
    method: "GET",
    headers: {
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    },
  });
}
