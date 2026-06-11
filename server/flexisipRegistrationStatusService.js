import { createHash } from "node:crypto";
import { readRegistrarKeys, scanRegistrarKeys, RedisReadOnlyError } from "./redisClient.js";

const SOURCE = "flexisip-registrar-redis";
const DOMAIN_PATTERN = /^[a-z0-9.-]+$/i;

export class FlexisipRegistrationStatusError extends Error {
  constructor(message, { code = "FLEXISIP_REGISTRATION_STATUS_FAILED", cause = null } = {}) {
    super(message);
    this.name = "FlexisipRegistrationStatusError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export function buildRegistrarKey(username, domain) {
  const normalizedUsername = String(username || "").trim();
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  if (!normalizedUsername || !DOMAIN_PATTERN.test(normalizedDomain)) {
    throw new FlexisipRegistrationStatusError("Invalid registrar key input.", {
      code: "INVALID_REGISTRAR_KEY_INPUT",
    });
  }
  return `fs:${normalizedUsername}@${normalizedDomain}`;
}

function decodePart(value) {
  try {
    return decodeURIComponent(String(value || "").replace(/\+/g, "%20"));
  } catch {
    return String(value || "");
  }
}

function parsePairs(value, separator = ";") {
  const result = {};
  for (const part of String(value || "").split(separator)) {
    if (!part) continue;
    const index = part.indexOf("=");
    if (index === -1) {
      result[part.trim()] = true;
      continue;
    }
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    if (!key) continue;
    result[key] = decodePart(rawValue.replace(/^"|"$/g, ""));
  }
  return result;
}

function parseQuery(value) {
  const result = {};
  for (const part of String(value || "").split("&")) {
    if (!part) continue;
    const index = part.indexOf("=");
    const key = index === -1 ? part : part.slice(0, index);
    const rawValue = index === -1 ? "" : part.slice(index + 1);
    if (!key) continue;
    result[decodePart(key)] = decodePart(rawValue);
  }
  return result;
}

function parseBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function toIso(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function maskUniqueId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "masked";
  return createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

export function parseFlexisipContact(value, field, nowSeconds = Math.floor(Date.now() / 1000)) {
  const raw = String(value || "");
  const match = raw.match(/^<([^>]+)>(?:;(.*))?$/);
  if (!match) {
    throw new FlexisipRegistrationStatusError("Invalid Flexisip contact format.", {
      code: "CONTACT_PARSE_FAILED",
    });
  }

  const uriAndQuery = match[1] || "";
  const headerParams = parsePairs(match[2] || "", ";");
  const [uriPart, queryPart = ""] = uriAndQuery.split("?");
  const query = parseQuery(queryPart);
  const uriSegments = uriPart.split(";");
  const contactUri = uriSegments.shift() || "";
  const uriParams = parsePairs(uriSegments.join(";"), ";");
  const updatedAt = Number.parseInt(uriParams.updatedAt, 10);
  const expires = Number.parseInt(uriParams.expires, 10);
  const expiresAt = Number.isFinite(updatedAt) && Number.isFinite(expires) ? updatedAt + expires : null;
  const ttlSeconds = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - nowSeconds) : 0;
  const accept = String(query.accept || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    rawField: String(field || ""),
    uniqueId: String(headerParams["+sip.instance"] || field || ""),
    contactUri,
    transport: String(uriParams.transport || "").toLowerCase(),
    userAgent: String(query["user-agent"] || ""),
    accept,
    alias: parseBoolean(uriParams.alias),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    expires: Number.isFinite(expires) ? expires : null,
    expiresAt,
    ttlSeconds,
    valid: Number.isFinite(expiresAt) && expiresAt > nowSeconds,
  };
}

export function sanitizeContact(contact, _options = {}) {
  return {
    uniqueId: maskUniqueId(contact.uniqueId || contact.rawField),
    transport: contact.transport || "",
    userAgent: contact.userAgent || "",
    lastRegisterAt: toIso(contact.updatedAt),
    expiresAt: toIso(contact.expiresAt),
    ttlSeconds: contact.ttlSeconds,
    alias: Boolean(contact.alias),
    accept: Array.isArray(contact.accept) ? contact.accept : [],
  };
}

function accountToStatus(account, registrarResult, options, nowSeconds) {
  const warnings = [];
  const includeContacts = Boolean(options.includeContacts);
  const source = SOURCE;

  if (!registrarResult || registrarResult.type === "none" || registrarResult.ttl === -2) {
    return {
      ...account,
      aor: `sip:${account.username}@${account.domain}`,
      registered: false,
      status: "offline",
      contactsCount: 0,
      lastRegisterAt: null,
      expiresAt: null,
      ttlSeconds: 0,
      source,
      warnings,
      ...(includeContacts ? { contacts: [] } : {}),
    };
  }

  if (registrarResult.type !== "hash") {
    warnings.push({
      code: "UNEXPECTED_REDIS_KEY_TYPE",
      message: "註冊資料格式不正確",
    });
    return {
      ...account,
      aor: `sip:${account.username}@${account.domain}`,
      registered: false,
      status: "unknown",
      contactsCount: 0,
      lastRegisterAt: null,
      expiresAt: null,
      ttlSeconds: 0,
      source,
      warnings,
      ...(includeContacts ? { contacts: [] } : {}),
    };
  }

  const parsedContacts = [];
  for (const entry of registrarResult.entries || []) {
    try {
      parsedContacts.push(parseFlexisipContact(entry.value, entry.field, nowSeconds));
    } catch {
      warnings.push({
        code: "CONTACT_PARSE_FAILED",
        message: "部分註冊資訊解析失敗",
      });
    }
  }

  const validContacts = parsedContacts.filter((contact) => contact.valid);
  const lastRegisterAtSeconds = validContacts.reduce((max, contact) => Math.max(max, contact.updatedAt || 0), 0);
  const expiresAtSeconds = validContacts.reduce((max, contact) => Math.max(max, contact.expiresAt || 0), 0);
  const registered = validContacts.length > 0;
  const status = registered ? "online" : "offline";
  const result = {
    ...account,
    aor: `sip:${account.username}@${account.domain}`,
    registered,
    status,
    contactsCount: validContacts.length,
    lastRegisterAt: toIso(lastRegisterAtSeconds),
    expiresAt: toIso(expiresAtSeconds),
    ttlSeconds: expiresAtSeconds ? Math.max(0, expiresAtSeconds - nowSeconds) : 0,
    source,
    warnings,
  };

  if (includeContacts) {
    result.contacts = validContacts.map((contact) => sanitizeContact(contact, options));
  }

  return result;
}

export async function getRegistrationStatusForAccounts(accounts, options = {}) {
  const normalizedAccounts = accounts.map((account) => ({
    ...account,
    username: String(account.username || "").trim(),
    domain: String(account.domain || options.domain || "sip.qrtalkie.org").trim().toLowerCase(),
  }));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const keyByAccount = new Map();
  const keys = [];

  for (const account of normalizedAccounts) {
    const key = buildRegistrarKey(account.username, account.domain);
    keyByAccount.set(account.id, key);
    keys.push(key);
  }

  let redisResults;
  try {
    redisResults = await readRegistrarKeys(keys, { concurrency: options.concurrency || 10 });
  } catch (error) {
    const unavailable = error instanceof RedisReadOnlyError || error?.name === "RedisReadOnlyError";
    throw new FlexisipRegistrationStatusError("Flexisip Registrar Redis unavailable.", {
      code: unavailable ? "FLEXISIP_REGISTRAR_REDIS_UNAVAILABLE" : "FLEXISIP_REGISTRATION_STATUS_FAILED",
      cause: error,
    });
  }

  const items = normalizedAccounts.map((account) => {
    const key = keyByAccount.get(account.id);
    return accountToStatus(account, redisResults.get(key), options, nowSeconds);
  });

  return {
    checkedAt: new Date(nowSeconds * 1000).toISOString(),
    items,
  };
}

function parseAccountFromRedisKey(key, defaultDomain) {
  const accountPart = String(key).replace(/^fs:/, "");
  const atIndex = accountPart.lastIndexOf("@");
  const username = atIndex === -1 ? accountPart : accountPart.slice(0, atIndex);
  const domain = (atIndex === -1 ? defaultDomain : accountPart.slice(atIndex + 1)).toLowerCase();
  return { username, domain };
}

export async function discoverAccountsFromRedis(options = {}) {
  const defaultDomain = String(options.domain || "sip.qrtalkie.org").trim().toLowerCase();
  const includeContacts = Boolean(options.includeContacts);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const keys = await scanRegistrarKeys("fs:*");
  const sortedKeys = keys.sort();

  const batchSize = 200;
  const redisResults = new Map();
  for (let i = 0; i < sortedKeys.length; i += batchSize) {
    const batch = sortedKeys.slice(i, i + batchSize);
    let batchResults;
    try {
      batchResults = await readRegistrarKeys(batch);
    } catch (error) {
      const unavailable = error instanceof RedisReadOnlyError || error?.name === "RedisReadOnlyError";
      throw new FlexisipRegistrationStatusError("Flexisip Registrar Redis unavailable.", {
        code: unavailable ? "FLEXISIP_REGISTRAR_REDIS_UNAVAILABLE" : "FLEXISIP_REGISTRATION_STATUS_FAILED",
        cause: error,
      });
    }
    for (const [key, value] of batchResults) {
      redisResults.set(key, value);
    }
  }

  const allItems = [];
  for (const key of sortedKeys) {
    const { username, domain } = parseAccountFromRedisKey(key, defaultDomain);
    if (/^(chatroom|conference|videoconference)-/i.test(username)) continue;
    const account = { id: key, username, domain };
    const registrarResult = redisResults.get(key);
    const statusItem = accountToStatus(account, registrarResult || null, { ...options, includeContacts, domain: defaultDomain }, nowSeconds);
    allItems.push({
      ...statusItem,
      displayName: "",
      tenantId: null,
      tenantName: "",
      communityId: null,
      communityName: "",
      buildingId: null,
      buildingName: "",
      roomId: null,
      roomNumber: "",
      accountStatus: "active",
      flexisipAccountId: null,
      sipUri: `sip:${username}@${domain}`,
      syncStatus: "redis_only",
    });
  }

  return {
    checkedAt: new Date(nowSeconds * 1000).toISOString(),
    total: allItems.length,
    items: allItems,
  };
}

export async function getAccountRegistrationDetail(username, domain, options = {}) {
  const normalizedUsername = String(username || "").trim();
  const normalizedDomain = String(domain || options.domain || "sip.qrtalkie.org").trim().toLowerCase();
  if (!normalizedUsername || !DOMAIN_PATTERN.test(normalizedDomain)) {
    throw new FlexisipRegistrationStatusError("Invalid account detail input.", {
      code: "INVALID_ACCOUNT_DETAIL_INPUT",
    });
  }

  const key = buildRegistrarKey(normalizedUsername, normalizedDomain);
  const nowSeconds = Math.floor(Date.now() / 1000);

  let redisResults;
  try {
    redisResults = await readRegistrarKeys([key]);
  } catch (error) {
    const unavailable = error instanceof RedisReadOnlyError || error?.name === "RedisReadOnlyError";
    throw new FlexisipRegistrationStatusError("Flexisip Registrar Redis unavailable.", {
      code: unavailable ? "FLEXISIP_REGISTRAR_REDIS_UNAVAILABLE" : "FLEXISIP_REGISTRATION_STATUS_FAILED",
      cause: error,
    });
  }

  const registrarResult = redisResults.get(key);
  const account = { id: key, username: normalizedUsername, domain: normalizedDomain };

  if (!registrarResult || registrarResult.type === "none" || registrarResult.ttl === -2) {
    return {
      ...account,
      aor: `sip:${normalizedUsername}@${normalizedDomain}`,
      keyType: "none",
      ttl: -2,
      registered: false,
      status: "offline",
      lastRegisterAt: null,
      expiresAt: null,
      parsedContacts: [],
      rawEntries: [],
    };
  }

  if (registrarResult.type !== "hash") {
    return {
      ...account,
      aor: `sip:${normalizedUsername}@${normalizedDomain}`,
      keyType: registrarResult.type,
      ttl: registrarResult.ttl,
      registered: false,
      status: "unknown",
      lastRegisterAt: null,
      expiresAt: null,
      parsedContacts: [],
      rawEntries: registrarResult.entries,
    };
  }

  const parsedContacts = [];
  const warnings = [];
  for (const entry of registrarResult.entries) {
    try {
      const contact = parseFlexisipContact(entry.value, entry.field, nowSeconds);
      parsedContacts.push({
        ...sanitizeContact(contact, options),
        // include non-masked info for detail view
        updatedAt: contact.updatedAt,
        expires: contact.expires,
        expiresAt: contact.expiresAt,
        valid: contact.valid,
        contactUri: contact.contactUri,
      });
    } catch {
      warnings.push({
        code: "CONTACT_PARSE_FAILED",
        message: `無法解析 contact: ${String(entry.field || "").slice(0, 40)}`,
      });
    }
  }

  const validContacts = parsedContacts.filter((c) => c.valid);
  const allUpdatedAt = parsedContacts.reduce((max, c) => Math.max(max, c.updatedAt || 0), 0);
  const maxExpiresAt = validContacts.reduce((max, c) => Math.max(max, c.expiresAt || 0), 0);
  const registered = validContacts.length > 0;

  return {
    username: normalizedUsername,
    domain: normalizedDomain,
    aor: `sip:${normalizedUsername}@${normalizedDomain}`,
    keyType: registrarResult.type,
    ttl: registrarResult.ttl,
    registered,
    status: registered ? "online" : "offline",
    totalContacts: parsedContacts.length,
    validContacts: validContacts.length,
    lastRegisterAt: toIso(allUpdatedAt),
    expiresAt: toIso(maxExpiresAt),
    parsedContacts,
    warnings,
  };
}
