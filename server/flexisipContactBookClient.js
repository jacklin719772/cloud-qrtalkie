const DEFAULT_BASE_URL = "http://account.qrtalkie.org/api";
const DEFAULT_TIMEOUT_MS = 10000;

export class FlexisipContactBookError extends Error {
  constructor(message, { status = 0, method = "", path = "", responseBody = null, cause = null } = {}) {
    super(message);
    this.name = "FlexisipContactBookError";
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

async function request(method, path, body) {
  const config = getConfig();
  const normalizedPath = normalizePath(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}${normalizedPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": config.apiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const responseBody = await parseResponse(response);
    if (!response.ok) {
      const message =
        responseBody && typeof responseBody === "object" && responseBody.message
          ? responseBody.message
          : `Flexisip contact book request failed with status ${response.status}.`;

      throw new FlexisipContactBookError(message, {
        status: response.status,
        method,
        path: normalizedPath,
        responseBody,
      });
    }

    return responseBody;
  } catch (error) {
    if (error instanceof FlexisipContactBookError) throw error;

    const isTimeout = error?.name === "AbortError";
    throw new FlexisipContactBookError(
      isTimeout ? `Flexisip contact book request timed out after ${config.timeoutMs}ms.` : "Flexisip contact book request failed.",
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

export function listContactLists() {
  return request("GET", "/contacts_lists");
}

export function getContactList(id) {
  return request("GET", `/contacts_lists/${encodeURIComponent(id)}`);
}

export function createContactList(payload) {
  return request("POST", "/contacts_lists", payload);
}

export function updateContactList(id, payload) {
  return request("PUT", `/contacts_lists/${encodeURIComponent(id)}`, payload);
}

export function deleteContactList(id) {
  return request("DELETE", `/contacts_lists/${encodeURIComponent(id)}`);
}

export function listAccountContacts(accountId) {
  return request("GET", `/accounts/${encodeURIComponent(accountId)}/contacts`);
}

export function addContactToAccount(accountId, contactId) {
  return request("POST", `/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(contactId)}`);
}

export function removeContactFromAccount(accountId, contactId) {
  return request("DELETE", `/accounts/${encodeURIComponent(accountId)}/contacts/${encodeURIComponent(contactId)}`);
}

export function addContactToContactList(contactListId, contactId) {
  return request("POST", `/contacts_lists/${encodeURIComponent(contactListId)}/contacts/${encodeURIComponent(contactId)}`);
}

export function removeContactFromContactList(contactListId, contactId) {
  return request("DELETE", `/contacts_lists/${encodeURIComponent(contactListId)}/contacts/${encodeURIComponent(contactId)}`);
}

export function assignContactListToAccount(accountId, contactListId) {
  return request("POST", `/accounts/${encodeURIComponent(accountId)}/contacts_lists/${encodeURIComponent(contactListId)}`);
}

export function unassignContactListFromAccount(accountId, contactListId) {
  return request("DELETE", `/accounts/${encodeURIComponent(accountId)}/contacts_lists/${encodeURIComponent(contactListId)}`);
}
