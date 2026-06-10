import { buildFreepbxPasswordUpdatePayload } from "./freepbxWebrtcExtensionPayload.js";

const DEFAULT_BASE_URL = "http://127.0.0.1";
const DEFAULT_TOKEN_PATH = "/admin/api/api/token";
const DEFAULT_GQL_PATH = "/admin/api/api/gql";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_APPLY_CONFIG_WAIT_MS = 5000;
const DEFAULT_APPLY_CONFIG_POLL_TIMEOUT_MS = 30000;
const DEFAULT_APPLY_CONFIG_POLL_INTERVAL_MS = 2000;

let cachedToken = null;
let cachedExtensionInputSchema = null;

export class FreepbxApiError extends Error {
  constructor(message, { status = 0, code = "FREEPBX_API_ERROR", responseBody = null, cause = null } = {}) {
    super(message);
    this.name = "FreepbxApiError";
    this.status = status;
    this.code = code;
    this.responseBody = responseBody;
    if (cause) this.cause = cause;
  }
}

function getConfig() {
  const timeoutMs = Number(process.env.FREEPBX_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const rawScope = Object.prototype.hasOwnProperty.call(process.env, "FREEPBX_API_SCOPE")
    ? process.env.FREEPBX_API_SCOPE
    : "";
  return {
    baseUrl: String(process.env.FREEPBX_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    tokenPath: normalizePath(process.env.FREEPBX_API_TOKEN_URL || DEFAULT_TOKEN_PATH),
    gqlPath: normalizePath(process.env.FREEPBX_API_GQL_URL || DEFAULT_GQL_PATH),
    clientId: String(process.env.FREEPBX_API_CLIENT_ID || ""),
    clientSecret: String(process.env.FREEPBX_API_CLIENT_SECRET || ""),
    scope: String(rawScope || "").trim(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

function normalizePath(value) {
  return `/${String(value || "").replace(/^\/+/, "")}`;
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

function safeGraphqlErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => ({
    message: typeof error?.message === "string" ? error.message : "GraphQL request failed",
    status: error?.status === false ? false : undefined,
  }));
}

function logPasswordUpdateDiagnostic(event, details = {}) {
  console.info("[freepbx:update_extension_password]", JSON.stringify({
    event,
    extension: details.extension ? String(details.extension) : "",
    operationName: details.operationName || "",
    mutationName: details.mutationName || "",
    variableKeys: Array.isArray(details.variableKeys) ? details.variableKeys : [],
    inputKeys: Array.isArray(details.inputKeys) ? details.inputKeys : [],
    hasExtPassword: Boolean(details.hasExtPassword),
    status: details.status === undefined ? null : Boolean(details.status),
    graphqlErrors: safeGraphqlErrors(details.graphqlErrors),
  }));
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeTransactionId(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function isApplyConfigFailure(apiStatus) {
  const message = String(apiStatus?.message || "").toLowerCase();
  return message.includes("failed") || message.includes("error");
}

function isApplyConfigComplete(apiStatus) {
  const message = String(apiStatus?.message || "").toLowerCase();
  return (
    message.includes("completed") ||
    message.includes("complete") ||
    message.includes("finished") ||
    message.includes("success") ||
    message.includes("executed") ||
    message.includes("reloaded") ||
    message.includes("done")
  );
}

export function getFreepbxConfigForDryRun() {
  const config = getConfig();
  return {
    baseUrl: config.baseUrl,
    tokenPath: config.tokenPath,
    gqlPath: config.gqlPath,
    scope: config.scope,
    timeoutMs: config.timeoutMs,
    hasClientId: Boolean(config.clientId),
    hasClientSecret: Boolean(config.clientSecret),
  };
}

export async function getAccessToken() {
  const config = getConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new FreepbxApiError("FreePBX API client credentials are not configured.", {
      code: "FREEPBX_API_CREDENTIALS_MISSING",
    });
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) {
    return cachedToken.accessToken;
  }

  const { controller, timeout } = withTimeout(config.timeoutMs);
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    if (config.scope) body.set("scope", config.scope);

    const response = await fetch(`${config.baseUrl}${config.tokenPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
    });

    const responseBody = await parseResponse(response);
    if (!response.ok) {
      throw new FreepbxApiError("FreePBX token request failed.", {
        status: response.status,
        code: "FREEPBX_TOKEN_REQUEST_FAILED",
        responseBody,
      });
    }

    const accessToken = responseBody?.access_token;
    if (!accessToken) {
      throw new FreepbxApiError("FreePBX token response did not include an access token.", {
        status: response.status,
        code: "FREEPBX_TOKEN_MISSING",
      });
    }

    const expiresIn = Number(responseBody?.expires_in || 3600);
    cachedToken = {
      accessToken,
      expiresAt: Date.now() + Math.max(60, expiresIn - 30) * 1000,
    };
    return accessToken;
  } catch (error) {
    if (error instanceof FreepbxApiError) throw error;
    throw new FreepbxApiError(
      error?.name === "AbortError"
        ? `FreePBX token request timed out after ${config.timeoutMs}ms.`
        : "FreePBX token request failed.",
      { code: "FREEPBX_TOKEN_REQUEST_FAILED", cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function graphql(query, variables = {}) {
  const config = getConfig();
  const token = await getAccessToken();
  const { controller, timeout } = withTimeout(config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}${config.gqlPath}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    const responseBody = await parseResponse(response);
    if (!response.ok || responseBody?.errors) {
      throw new FreepbxApiError("FreePBX GraphQL request failed.", {
        status: response.status,
        code: "FREEPBX_GRAPHQL_REQUEST_FAILED",
        responseBody: responseBody?.errors ? { errors: safeGraphqlErrors(responseBody.errors) } : responseBody,
      });
    }

    return responseBody;
  } catch (error) {
    if (error instanceof FreepbxApiError) throw error;
    throw new FreepbxApiError(
      error?.name === "AbortError"
        ? `FreePBX GraphQL request timed out after ${config.timeoutMs}ms.`
        : "FreePBX GraphQL request failed.",
      { code: "FREEPBX_GRAPHQL_REQUEST_FAILED", cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function addExtension(payload) {
  const query = `
    mutation AddExtension($input: addExtensionInput!) {
      addExtension(input: $input) {
        status
        message
      }
    }
  `;
  const result = await graphql(query, { input: payload });
  return result?.data?.addExtension || null;
}

export async function updateExtension(extension, payload) {
  const query = `
    mutation UpdateExtension($input: updateExtensionInput!) {
      updateExtension(input: $input) {
        status
        message
      }
    }
  `;
  const result = await graphql(query, { input: { extensionId: String(extension), ...payload } });
  return result?.data?.updateExtension || null;
}

export async function updateExtensionDisplayName(extension, displayName, schema = null) {
  const resolvedSchema = schema || (await getExtensionInputSchema());
  const updateSchema = resolvedSchema?.updateExtensionInput || {};
  const payload = {};
  const candidates = ["name", "displayName", "callerid", "callerId", "caller_id"];
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(updateSchema, key)) {
      payload[key] = displayName;
      break;
    }
  }

  if (!Object.keys(payload).length) {
    const error = new FreepbxApiError("FreePBX display name update field not supported.", {
      code: "FREEPBX_DISPLAY_NAME_UPDATE_FAILED",
    });
    throw error;
  }

  return updateExtension(extension, payload);
}

export async function updateExtensionPassword(extension, password, schema = null) {
  const resolvedSchema = schema || (await getExtensionInputSchema());
  let existing;
  try {
    existing = await fetchExtension(extension);
  } catch (error) {
    logPasswordUpdateDiagnostic("fetch_extension_failed", {
      extension,
      operationName: "FetchAllExtensions",
      variableKeys: ["first"],
      graphqlErrors: error?.responseBody?.errors,
    });
    throw error;
  }
  const payload = buildFreepbxPasswordUpdatePayload(extension, password, existing || {}, resolvedSchema);

  if (!Object.keys(payload).length) {
    const error = new FreepbxApiError("FreePBX password update field not supported.", {
      code: "FREEPBX_PASSWORD_UPDATE_FAILED",
    });
    throw error;
  }

  const inputKeys = ["extensionId", ...Object.keys(payload)];
  logPasswordUpdateDiagnostic("update_extension_request", {
    extension,
    operationName: "UpdateExtension",
    mutationName: "updateExtension",
    variableKeys: ["input"],
    inputKeys,
    hasExtPassword: Object.prototype.hasOwnProperty.call(payload, "extPassword"),
  });

  try {
    const result = await updateExtension(extension, payload);
    logPasswordUpdateDiagnostic("update_extension_response", {
      extension,
      operationName: "UpdateExtension",
      mutationName: "updateExtension",
      variableKeys: ["input"],
      inputKeys,
      hasExtPassword: Object.prototype.hasOwnProperty.call(payload, "extPassword"),
      status: result?.status,
    });
    return result;
  } catch (error) {
    logPasswordUpdateDiagnostic("update_extension_failed", {
      extension,
      operationName: "UpdateExtension",
      mutationName: "updateExtension",
      variableKeys: ["input"],
      inputKeys,
      hasExtPassword: Object.prototype.hasOwnProperty.call(payload, "extPassword"),
      graphqlErrors: error?.responseBody?.errors,
    });
    throw error;
  }
}

function simplifyGraphqlType(type) {
  if (!type) return "";
  if (type.name) return type.name;
  if (type.ofType) return simplifyGraphqlType(type.ofType);
  return type.kind || "";
}

export async function getExtensionInputSchema() {
  if (cachedExtensionInputSchema) return cachedExtensionInputSchema;
  const query = `
    query ExtensionInputSchema($add: String!, $update: String!) {
      add: __type(name: $add) {
        inputFields {
          name
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
      update: __type(name: $update) {
        inputFields {
          name
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  `;
  const result = await graphql(query, { add: "addExtensionInput", update: "updateExtensionInput" });
  const mapFields = (fields) =>
    Object.fromEntries((fields || []).map((field) => [field.name, simplifyGraphqlType(field.type)]));
  cachedExtensionInputSchema = {
    addExtensionInput: mapFields(result?.data?.add?.inputFields),
    updateExtensionInput: mapFields(result?.data?.update?.inputFields),
  };
  return cachedExtensionInputSchema;
}

export async function doReload() {
  const query = `
    mutation DoReload {
      doreload(input: {}) {
        status
        message
        transaction_id
      }
    }
  `;
  const result = await graphql(query);
  return result?.data?.doreload || null;
}

export async function fetchApiStatus(transactionId) {
  const query = `
    query FetchApiStatus($txnId: ID!) {
      fetchApiStatus(txnId: $txnId) {
        status
        message
        details
        event_output
      }
    }
  `;
  const result = await graphql(query, { txnId: normalizeTransactionId(transactionId) });
  return result?.data?.fetchApiStatus || null;
}

export async function applyConfigAndWait({
  pollTimeoutMs = DEFAULT_APPLY_CONFIG_POLL_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_APPLY_CONFIG_POLL_INTERVAL_MS,
  fallbackWaitMs = DEFAULT_APPLY_CONFIG_WAIT_MS,
} = {}) {
  const reload = await doReload();
  const transactionId = normalizeTransactionId(reload?.transaction_id || reload?.transactionId);
  const applyConfig = {
    attempted: true,
    success: Boolean(reload?.status),
    status: Boolean(reload?.status),
    message: reload?.message || null,
    transactionId: transactionId || null,
    waitStrategy: "none",
    apiStatus: null,
  };

  if (!reload?.status) return applyConfig;

  if (transactionId) {
    const startedAt = Date.now();
    try {
      while (Date.now() - startedAt < pollTimeoutMs) {
        await delay(pollIntervalMs);
        const apiStatus = await fetchApiStatus(transactionId);
        applyConfig.apiStatus = {
          status: Boolean(apiStatus?.status),
          message: apiStatus?.message || null,
          details: apiStatus?.details || null,
        };
        applyConfig.waitStrategy = "fetchApiStatus";

        if (isApplyConfigFailure(apiStatus)) {
          applyConfig.success = false;
          applyConfig.message = apiStatus?.message || applyConfig.message;
          return applyConfig;
        }
        if (isApplyConfigComplete(apiStatus)) {
          applyConfig.success = true;
          return applyConfig;
        }
      }
      applyConfig.waitStrategy = "fetchApiStatus_timeout";
      return applyConfig;
    } catch (error) {
      applyConfig.waitStrategy = "fixed_wait_after_status_poll_failed";
      applyConfig.apiStatus = {
        status: false,
        message: error?.message || "fetchApiStatus failed",
      };
    }
  } else {
    applyConfig.waitStrategy = "fixed_wait_no_transaction_id";
  }

  await delay(fallbackWaitMs);
  if (applyConfig.waitStrategy === "none") applyConfig.waitStrategy = "fixed_wait";
  return applyConfig;
}

export async function fetchExtension(extension) {
  const query = `
    query FetchAllExtensions($first: Int!) {
      fetchAllExtensions(first: $first) {
        status
        message
        extension {
          extensionId
          tech
          user {
            extension
            name
          }
        }
      }
    }
  `;

  try {
    const target = String(extension);
    const result = await graphql(query, { first: 1000 });
    const rows = result?.data?.fetchAllExtensions?.extension || [];
    const matched = Array.isArray(rows)
      ? rows.find((row) => {
          const candidates = [
            row?.extensionId,
            row?.extension,
            row?.user_extension,
            row?.user?.extension,
            row?.coreDevice?.deviceId,
          ];
          return candidates.some((value) => String(value || "") === target);
        })
      : null;

    if (!matched) return null;
    return {
      extensionId: matched.extensionId || matched.user?.extension || target,
      extension: matched.user?.extension || matched.extensionId || target,
      name: matched.user?.name || "",
      tech: matched.tech || "",
      status: true,
    };
  } catch (error) {
    throw error;
  }
}

export async function deleteExtension(extension) {
  const query = `
    mutation DeleteExtension($input: deleteExtensionInput!) {
      deleteExtension(input: $input) {
        status
        message
      }
    }
  `;
  const result = await graphql(query, { input: { extensionId: String(extension) } });
  return result?.data?.deleteExtension || null;
}
