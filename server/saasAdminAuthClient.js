import { getSaasAdminLoginConfig } from "./webrtcTemplateLoader.js";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

export class SaasAdminAuthError extends Error {
  constructor(message, { code = "SAAS_ADMIN_AUTH_ERROR", status = 0, details = null, cause = null } = {}) {
    super(message);
    this.name = "SaasAdminAuthError";
    this.code = code;
    this.status = status;
    if (details) this.details = details;
    if (cause) this.cause = cause;
  }
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function getSaasAdminAuthConfigForOutput() {
  const config = getSaasAdminLoginConfig();
  return {
    baseUrl: config.baseUrl,
    loginPath: config.loginPath,
    timeoutMs: config.timeoutMs,
    identifierField: config.identifierField,
    hasUsername: Boolean(config.username),
    hasPassword: Boolean(config.password),
  };
}

export async function getSaasAdminToken(forceRefresh = false) {
  const config = getSaasAdminLoginConfig();
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedTokenExpiresAt > now + 30000) {
    return cachedToken;
  }

  const identifier = config.username;
  if (!identifier || !config.password) {
    throw new SaasAdminAuthError("SaaS 管理員登入資訊未設定。", {
      code: "SAAS_ADMIN_AUTH_MISSING",
    });
  }

  const { controller, timeout } = withTimeout(config.timeoutMs);
  try {
    const body = {
      username: identifier,
      email: identifier,
      [config.identifierField || "email"]: identifier,
      password: config.password,
    };

    const response = await fetch(new URL(config.loginPath, `${config.baseUrl}/`).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
    });

    const responseBody = await parseResponse(response);
    if (!response.ok) {
      throw new SaasAdminAuthError("SaaS 管理員 Token 獲取失敗", {
        code: "SAAS_ADMIN_LOGIN_FAILED",
        status: response.status,
        details: {
          httpStatus: response.status,
          responseSummary: typeof responseBody === "string" ? responseBody.slice(0, 120) : "non-2xx response",
        },
      });
    }

    const token = responseBody?.token;
    if (!token) {
      throw new SaasAdminAuthError("SaaS 管理員 Token 獲取失敗", {
        code: "SAAS_ADMIN_TOKEN_MISSING",
        status: response.status,
        details: {
          httpStatus: response.status,
          responseSummary: "token missing from login response",
        },
      });
    }

    cachedToken = token;
    cachedTokenExpiresAt = now + 10 * 60 * 1000;
    return token;
  } catch (error) {
    if (error instanceof SaasAdminAuthError) throw error;
    throw new SaasAdminAuthError("SaaS 管理員 Token 獲取失敗", {
      code: error?.name === "AbortError" ? "SAAS_ADMIN_LOGIN_TIMEOUT" : "SAAS_ADMIN_LOGIN_FAILED",
      cause: error,
      details: {
        errorName: error?.name || "Error",
        errorMessage: error?.name === "AbortError" ? "Request timed out" : "Request failed",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
