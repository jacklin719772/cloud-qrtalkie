import "dotenv/config";
import { readFileSync } from "node:fs";
import * as mariadb from "mariadb";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_OFFSET = 0;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

let celPool = null;

export class CelCallLogError extends Error {
  constructor(message, { code = "CEL_CALL_LOG_ERROR", cause = null } = {}) {
    super(message);
    this.name = "CelCallLogError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function readTextFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function parseSectionValue(text, section, key) {
  const sectionPattern = new RegExp(`^\\s*\\[${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*$`, "im");
  const sectionMatch = sectionPattern.exec(text);
  if (!sectionMatch) return "";
  const rest = text.slice(sectionMatch.index + sectionMatch[0].length);
  const nextSection = rest.search(/^\s*\[[^\]]+\]\s*$/m);
  const body = nextSection >= 0 ? rest.slice(0, nextSection) : rest;
  const keyPattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:=>|=)\\s*(.*?)\\s*$`, "im");
  return keyPattern.exec(body)?.[1]?.trim() || "";
}

function parseOdbcIniDsn(text, dsn) {
  return {
    server: parseSectionValue(text, dsn, "Server"),
    database: parseSectionValue(text, dsn, "Database"),
    port: parseSectionValue(text, dsn, "Port"),
    socket: parseSectionValue(text, dsn, "Socket"),
  };
}

function getCelDbConfig() {
  const resOdbcText = readTextFile(process.env.ASTERISK_RES_ODBC_CONF || "/etc/asterisk/res_odbc_additional.conf");
  const dsn = parseSectionValue(resOdbcText, "asteriskcdrdb", "dsn") || "MySQL-asteriskcdrdb";
  const odbcText = readTextFile(process.env.ODBC_INI_FILE || "/etc/odbc.ini");
  const odbc = parseOdbcIniDsn(odbcText, dsn);
  const port = Number(
    process.env.FREEPBX_CDR_DB_PORT ||
    process.env.CDR_DB_PORT ||
    parseSectionValue(resOdbcText, "asteriskcdrdb", "port") ||
    odbc.port ||
    3306,
  );

  return {
    host: process.env.FREEPBX_CDR_DB_HOST || process.env.CDR_DB_HOST || odbc.server || "127.0.0.1",
    port: Number.isFinite(port) && port > 0 ? port : 3306,
    database: process.env.FREEPBX_CDR_DB_NAME ||
      process.env.CDR_DB_NAME ||
      parseSectionValue(resOdbcText, "asteriskcdrdb", "database") ||
      odbc.database ||
      "asteriskcdrdb",
    user: process.env.FREEPBX_CDR_DB_USER ||
      process.env.CDR_DB_USER ||
      parseSectionValue(resOdbcText, "asteriskcdrdb", "username") ||
      process.env.DB_USER ||
      "",
    password: process.env.FREEPBX_CDR_DB_PASSWORD ||
      process.env.CDR_DB_PASSWORD ||
      parseSectionValue(resOdbcText, "asteriskcdrdb", "password") ||
      process.env.DB_PASSWORD ||
      "",
    socketPath: process.env.FREEPBX_CDR_DB_SOCKET || process.env.CDR_DB_SOCKET || odbc.socket || "",
    table: process.env.FREEPBX_CEL_DB_TABLE || process.env.CEL_DB_TABLE || "cel",
  };
}

function assertIdentifier(value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!IDENTIFIER_PATTERN.test(raw)) {
    throw new CelCallLogError("Invalid CEL table identifier.", { code: "INVALID_CEL_TABLE" });
  }
  return raw;
}

function getCelPool() {
  if (celPool) return celPool;
  const config = getCelDbConfig();
  if (!config.user) {
    throw new CelCallLogError("CEL database user is not configured.", { code: "CEL_DB_CONFIG_MISSING" });
  }

  celPool = mariadb.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    socketPath: config.socketPath || undefined,
    ssl: process.env.FREEPBX_CDR_DB_SSL === "true" || process.env.CDR_DB_SSL === "true",
    connectionLimit: Number(process.env.CEL_DB_CONNECTION_LIMIT || 3),
  });
  return celPool;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeLike(value) {
  return String(value || "").trim().slice(0, 128);
}

function normalizeOrder(value) {
  return String(value || "").toLowerCase() === "asc" ? "ASC" : "DESC";
}

function localDateBoundaryToUtcString(dateOnly, endOfDay, tzOffsetMinutes) {
  const match = String(dateOnly || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return `${String(dateOnly || "").slice(0, 10)} ${endOfDay ? "23:59:59" : "00:00:00"}`;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localMs = Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  const utc = new Date(localMs - tzOffsetMinutes * 60000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}`;
}

function buildFilters(filters = {}) {
  const clauses = ["1=1"];
  const values = [];
  const extension = String(filters.extension || "").trim();
  const parsedOffset = Number(filters.tzOffsetMinutes);
  const tzOffsetMinutes = Number.isFinite(parsedOffset) ? Math.min(840, Math.max(-840, parsedOffset)) : 0;

  if (extension) {
    clauses.push("(cid_num = ? OR exten = ? OR channame LIKE ?)");
    values.push(extension, extension, `%PJSIP/${extension}-%`);
  }

  if (filters.dateFrom) {
    clauses.push("eventtime >= ?");
    values.push(localDateBoundaryToUtcString(filters.dateFrom, false, tzOffsetMinutes));
  }

  if (filters.dateTo) {
    clauses.push("eventtime <= ?");
    values.push(localDateBoundaryToUtcString(filters.dateTo, true, tzOffsetMinutes));
  }

  const search = sanitizeLike(filters.search);
  if (search) {
    clauses.push("(cid_num LIKE ? OR cid_name LIKE ? OR exten LIKE ?)");
    values.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const source = sanitizeLike(filters.source);
  if (source) {
    clauses.push("(cid_num LIKE ? OR cid_name LIKE ?)");
    values.push(`%${source}%`, `%${source}%`);
  }

  const destination = sanitizeLike(filters.destination);
  if (destination) {
    clauses.push("exten LIKE ?");
    values.push(`%${destination}%`);
  }

  const eventType = sanitizeLike(filters.eventType).toUpperCase();
  if (eventType) {
    clauses.push("eventtype = ?");
    values.push(eventType);
  }

  const application = sanitizeLike(filters.application);
  if (application) {
    clauses.push("appname LIKE ?");
    values.push(`%${application}%`);
  }

  const linkedId = sanitizeLike(filters.linkedId);
  if (linkedId) {
    clauses.push("linkedid = ?");
    values.push(linkedId);
  }

  return {
    whereSql: clauses.join(" AND "),
    values,
  };
}

function toIsoString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function mapCelEvent(row = {}) {
  return {
    eventTime: toIsoString(row.eventtime),
    eventType: String(row.eventtype || ""),
    cidName: String(row.cid_name || ""),
    cidNumber: String(row.cid_num || ""),
    extension: String(row.exten || ""),
    context: String(row.context || ""),
    channelName: String(row.channame || ""),
    appName: String(row.appname || ""),
    appData: String(row.appdata || row.extra || ""),
    uniqueId: String(row.uniqueid || ""),
    linkedId: String(row.linkedid || ""),
    peer: String(row.peer || ""),
    userField: String(row.userfield || ""),
    userDefinedType: String(row.userdeftype || ""),
    eventExtra: String(row.eventextra || row.extra || ""),
  };
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function deriveCallResult({ answered, dialStatus, hangupCause }) {
  if (answered) return "answered";
  const byDialStatus = {
    NOANSWER: "missed",
    BUSY: "busy",
    CANCEL: "cancelled",
    CANCELLED: "cancelled",
    CONGESTION: "failed",
    CHANUNAVAIL: "failed",
  };
  const normalized = String(dialStatus || "").toUpperCase();
  if (byDialStatus[normalized]) return byDialStatus[normalized];
  if (Number.isFinite(hangupCause)) {
    if (hangupCause === 17) return "busy";
    if (hangupCause === 18 || hangupCause === 19) return "missed";
    if (hangupCause === 16) return "cancelled";
    if (hangupCause === 21) return "declined";
    if ([3, 20, 34, 38, 47, 127].includes(hangupCause)) return "failed";
  }
  return "unknown";
}

function summarizeCall(linkedId, rows) {
  const events = rows.map(mapCelEvent);
  const first = events[0] || {};
  const last = events[events.length - 1] || {};
  const primary = events.find((event) => event.cidNumber && event.extension)
    || events.find((event) => event.cidNumber)
    || first;
  const answerEvent = events.find((event) => event.eventType === "ANSWER") || null;
  const hangupEvents = events.filter((event) => event.eventType === "HANGUP");
  const talkEndEvent = hangupEvents[hangupEvents.length - 1] || last;
  const startMs = first.eventTime ? Date.parse(first.eventTime) : NaN;
  const answerMs = answerEvent?.eventTime ? Date.parse(answerEvent.eventTime) : NaN;
  const endMs = talkEndEvent.eventTime ? Date.parse(talkEndEvent.eventTime) : NaN;
  const answered = Boolean(answerEvent);
  const durationSeconds = answered && Number.isFinite(answerMs) && Number.isFinite(endMs) && endMs >= answerMs
    ? Math.round((endMs - answerMs) / 1000)
    : null;
  const ringSeconds = answered && Number.isFinite(startMs) && Number.isFinite(answerMs) && answerMs >= startMs
    ? Math.round((answerMs - startMs) / 1000)
    : null;

  const extras = hangupEvents.map((event) => parseJsonSafe(event.eventExtra)).filter(Boolean);
  const dialStatus = extras.map((extra) => String(extra.dialstatus || "")).find(Boolean) || "";
  const hangupCauseValue = extras.map((extra) => Number(extra.hangupcause)).find((value) => Number.isFinite(value));
  const hangupCause = Number.isFinite(hangupCauseValue) ? hangupCauseValue : null;

  return {
    linkedId: String(linkedId || ""),
    eventTime: first.eventTime || null,
    answerTime: answerEvent?.eventTime || null,
    endTime: talkEndEvent.eventTime || last.eventTime || null,
    durationSeconds,
    ringSeconds,
    answered,
    result: deriveCallResult({ answered, dialStatus, hangupCause }),
    dialStatus,
    hangupCause,
    cidName: primary.cidName || first.cidName || "",
    cidNumber: primary.cidNumber || first.cidNumber || "",
    extension: primary.extension || first.extension || "",
    channelName: primary.channelName || first.channelName || "",
    eventCount: events.length,
    events,
  };
}

export async function queryCelCallLogs(filters = {}) {
  const config = getCelDbConfig();
  const table = assertIdentifier(config.table, "cel");
  const limit = clampInteger(filters.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInteger(filters.offset, DEFAULT_OFFSET, 0, 100000);
  const order = normalizeOrder(filters.order);
  const { whereSql, values } = buildFilters(filters);
  const quotedTable = `\`${table}\``;
  const pool = getCelPool();
  let connection;

  try {
    connection = await pool.getConnection();
    const countRows = await connection.query(
      `SELECT COUNT(DISTINCT linkedid) AS total FROM ${quotedTable} WHERE ${whereSql}`,
      values,
    );
    const total = Number(countRows?.[0]?.total || 0);
    const linkedRows = await connection.query(
      `SELECT DISTINCT linkedid, MIN(eventtime) AS first_eventtime
       FROM ${quotedTable}
       WHERE ${whereSql}
       GROUP BY linkedid
       ORDER BY first_eventtime ${order}
       LIMIT ? OFFSET ?`,
      [...values, limit, offset],
    );
    const linkedIds = linkedRows.map((row) => String(row.linkedid || "")).filter(Boolean);
    if (!linkedIds.length) {
      return { total, limit, offset, count: 0, calls: [] };
    }

    const placeholders = linkedIds.map(() => "?").join(",");
    const eventRows = await connection.query(
      `SELECT *
       FROM ${quotedTable}
       WHERE linkedid IN (${placeholders})
       ORDER BY linkedid ASC, eventtime ASC, uniqueid ASC`,
      linkedIds,
    );
    const grouped = new Map(linkedIds.map((linkedId) => [linkedId, []]));
    for (const row of eventRows) {
      const linkedId = String(row.linkedid || "");
      if (grouped.has(linkedId)) grouped.get(linkedId).push(row);
    }

    const calls = linkedIds.map((linkedId) => summarizeCall(linkedId, grouped.get(linkedId) || []));
    return {
      total,
      limit,
      offset,
      count: calls.length,
      calls,
    };
  } catch (error) {
    if (error instanceof CelCallLogError) throw error;
    throw new CelCallLogError("CEL call log query failed.", {
      code: "CEL_CALL_LOG_QUERY_FAILED",
      cause: error,
    });
  } finally {
    if (connection) connection.release();
  }
}

export async function closeCelCallLogPool() {
  if (!celPool) return;
  const pool = celPool;
  celPool = null;
  await pool.end();
}
