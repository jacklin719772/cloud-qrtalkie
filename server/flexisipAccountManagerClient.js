const DEFAULT_BASE_URL = "http://account.qrtalkie.org/api";
const DEFAULT_TIMEOUT_MS = 10000;

export class FlexisipAccountManagerError extends Error {
  constructor(message, { status = 0, method = "", path = "", responseBody = null, cause = null } = {}) {
    super(message);
    this.name = "FlexisipAccountManagerError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.responseBody = responseBody;
    if (cause) this.cause = cause;
  }
}

function getConfig() {
  const baseUrl = String(process.env.FLEXISIP_ACCOUNT_MANAGER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = String(process.env.FLEXISIP_ACCOUNT_MANAGER_API_KEY || "");
  const timeoutMs = Number(process.env.FLEXISIP_ACCOUNT_MANAGER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return {
    baseUrl,
    apiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function normalizePath(path) {
  return `/${String(path || "").replace(/^\/+/, "")}`;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}

async function request(method, path, body, options = {}) {
  const config = getConfig();
  const normalizedPath = normalizePath(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const apiKey = options.apiKey === undefined ? config.apiKey : String(options.apiKey || "");

  const fullUrl = `${config.baseUrl}${normalizedPath}`;
  console.log(`[flexisip] ${method} ${fullUrl}`, body ? `body=${JSON.stringify(body).substring(0, 300)}` : '');

  try {
    const response = await fetch(fullUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const responseBody = await parseResponse(response);
    console.log(`[flexisip] ${method} ${normalizedPath} => status=${response.status}, body=${JSON.stringify(responseBody).substring(0, 500)}`);
    if (!response.ok) {
      const message =
        responseBody && typeof responseBody === "object" && responseBody.message
          ? responseBody.message
          : `Flexisip Account Manager request failed with status ${response.status}.`;

      throw new FlexisipAccountManagerError(message, {
        status: response.status,
        method,
        path: normalizedPath,
        responseBody,
      });
    }

    return responseBody;
  } catch (error) {
    if (error instanceof FlexisipAccountManagerError) throw error;

    const isTimeout = error?.name === "AbortError";
    throw new FlexisipAccountManagerError(
      isTimeout
        ? `Flexisip Account Manager request timed out after ${config.timeoutMs}ms.`
        : "Flexisip Account Manager request failed.",
      {
        method,
        path: normalizedPath,
        cause: error,
      },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createAccount(payload) {
  return request("POST", "/accounts", payload);
}

export function listAccounts() {
  return request("GET", "/accounts");
}

export function getAccount(id) {
  return request("GET", `/accounts/${encodeURIComponent(id)}`);
}

export function searchAccountBySip(sip) {
  return request("GET", `/accounts/${encodeURIComponent(sip)}/search`);
}

export function searchAccountByEmail(email) {
  return request("GET", `/accounts/${encodeURIComponent(email)}/search-by-email`);
}

export function updateAccount(id, payload) {
  return request("PUT", `/accounts/${encodeURIComponent(id)}`, payload);
}

export function activateAccount(id) {
  return request("POST", `/accounts/${encodeURIComponent(id)}/activate`);
}

export function deactivateAccount(id) {
  return request("POST", `/accounts/${encodeURIComponent(id)}/deactivate`);
}

export function deleteAccount(id) {
  return request("DELETE", `/accounts/${encodeURIComponent(id)}`);
}

export function sendProvisioningEmail(accountId) {
  return request("POST", `/accounts/${encodeURIComponent(accountId)}/send_provisioning_email`);
}

export function sendResetPasswordEmail(accountId) {
  return request("POST", `/accounts/${encodeURIComponent(accountId)}/send_reset_password_email`);
}

export function requestEmailChange(userApiKey, newEmail) {
  return request("POST", "/accounts/me/email/request", { email: newEmail }, { apiKey: userApiKey });
}

export function changeEmail(userApiKey, newEmail, code) {
  return request("POST", "/accounts/me/email", { email: newEmail, code }, { apiKey: userApiKey });
}
