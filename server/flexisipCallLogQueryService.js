import "dotenv/config";
import { pool as dbPool } from "./db.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const VALID_DIRECTIONS = new Set(["inbound", "outbound", "internal", "all"]);
const VALID_RESULTS = new Set(["answered", "missed", "cancelled", "busy", "declined", "timeout", "failed", "unknown", "all"]);

export class FlexisipCallLogQueryError extends Error {
  constructor(message, { code = "FLEXISIP_CALL_LOG_QUERY_FAILED", cause = null } = {}) {
    super(message);
    this.name = "FlexisipCallLogQueryError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export function parseAccountFilter(account, accounts) {
  const values = [];
  for (const source of [account, accounts]) {
    for (const item of String(source || "").split(",")) {
      const value = item.trim();
      if (/^\d+$/.test(value) && !values.includes(value)) values.push(value);
    }
  }
  return values;
}

export function isValidIsoDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  const date = new Date(text);
  return !Number.isNaN(date.getTime());
}

function parseLimit(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function parseOffset(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_OFFSET;
  return parsed;
}

function toMysqlDatetime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resultText(result) {
  const mapping = {
    answered: "已接通",
    missed: "未接",
    cancelled: "已取消",
    busy: "忙線",
    declined: "已拒接",
    timeout: "逾時",
    failed: "失敗",
    unknown: "未知",
  };
  return mapping[String(result || "unknown")] || mapping.unknown;
}

function sanitizeDevice(device) {
  return {
    role: device.role || "unknown",
    account: device.account || "",
    domain: device.domain || "",
    userAgent: device.user_agent || "",
    transport: device.transport || "",
    invitedAt: toIsoString(device.invited_at),
    ringingAt: toIsoString(device.ringing_at),
    answeredAt: toIsoString(device.answered_at),
    endedAt: toIsoString(device.ended_at),
    finalCode: device.final_code == null ? null : Number(device.final_code),
    finalReason: device.final_reason || "",
    result: device.result || "unknown",
  };
}

function sanitizeCallRow(row, devicesCount = 0, devices = null) {
  const item = {
    id: Number(row.id),
    callIdHash: row.call_id_hash || "",
    fromUser: row.from_user || "",
    toUser: row.to_user || "",
    fromDomain: row.from_domain || "",
    toDomain: row.to_domain || "",
    direction: row.direction || "unknown",
    initiatedAt: toIsoString(row.initiated_at),
    ringingAt: toIsoString(row.ringing_at),
    answeredAt: toIsoString(row.answered_at),
    endedAt: toIsoString(row.ended_at),
    estimatedDurationSeconds: row.estimated_duration_seconds == null ? null : Number(row.estimated_duration_seconds),
    signalingDurationSeconds: row.signaling_duration_seconds == null ? null : Number(row.signaling_duration_seconds),
    result: row.result || "unknown",
    resultText: resultText(row.result),
    finalStatus: row.final_status || "unknown",
    finalCode: row.final_code == null ? null : Number(row.final_code),
    finalReason: row.final_reason || "",
    cancelledBy: row.cancelled_by || "",
    source: row.source || "flexisip-call-events",
    devicesCount: Number(devicesCount || 0),
  };
  if (devices) item.devices = devices;
  return item;
}

function buildWhereClause({ accounts, direction, result, domain, from, to }) {
  const clauses = ["1=1"];
  const params = [];

  if (accounts.length) {
    if (direction === "outbound") {
      clauses.push("cl.from_user IN (?)");
      params.push(accounts);
    } else if (direction === "inbound") {
      clauses.push("cl.to_user IN (?)");
      params.push(accounts);
    } else if (direction === "internal") {
      clauses.push("cl.from_user IN (?) AND cl.to_user IN (?)");
      params.push(accounts, accounts);
    } else {
      clauses.push("(cl.from_user IN (?) OR cl.to_user IN (?))");
      params.push(accounts, accounts);
    }
  } else if (direction && direction !== "all") {
    clauses.push("cl.direction = ?");
    params.push(direction);
  }

  if (domain) {
    clauses.push("(cl.from_domain = ? OR cl.to_domain = ?)");
    params.push(domain, domain);
  }

  if (result && result !== "all") {
    clauses.push("cl.result = ?");
    params.push(result);
  }

  if (from) {
    clauses.push("cl.initiated_at >= ?");
    params.push(toMysqlDatetime(from));
  }

  if (to) {
    clauses.push("cl.initiated_at <= ?");
    params.push(toMysqlDatetime(to));
  }

  return {
    whereSql: clauses.join(" AND "),
    params,
  };
}

export async function queryFlexisipCallLogs(filters = {}) {
  const accounts = parseAccountFilter(filters.account, filters.accounts);
  const direction = String(filters.direction || "all").trim().toLowerCase();
  const result = String(filters.result || "all").trim().toLowerCase();
  const domain = String(filters.domain || "").trim().toLowerCase();
  const includeDevices = String(filters.includeDevices || "false").toLowerCase() === "true";
  const limit = parseLimit(filters.limit);
  const offset = parseOffset(filters.offset);
  const from = String(filters.from || "").trim();
  const to = String(filters.to || "").trim();

  if (!VALID_DIRECTIONS.has(direction) || !VALID_RESULTS.has(result)) {
    throw new FlexisipCallLogQueryError("Invalid Flexisip call log query.", {
      code: "INVALID_FLEXISIP_CALL_LOG_QUERY",
    });
  }

  if (domain && !/^[a-z0-9.-]+$/i.test(domain)) {
    throw new FlexisipCallLogQueryError("Invalid Flexisip call log query.", {
      code: "INVALID_FLEXISIP_CALL_LOG_QUERY",
    });
  }

  if (!isValidIsoDateTime(from) || !isValidIsoDateTime(to)) {
    throw new FlexisipCallLogQueryError("Invalid Flexisip call log query.", {
      code: "INVALID_FLEXISIP_CALL_LOG_QUERY",
    });
  }

  const { whereSql, params } = buildWhereClause({ accounts, direction, result, domain, from, to });
  const pool = dbPool;
  let connection;

  try {
    connection = await pool.getConnection();
    const countRows = await connection.query(
      `SELECT COUNT(*) AS total FROM flexisip_call_logs cl WHERE ${whereSql}`,
      params,
    );
    const total = Number(countRows?.[0]?.total || 0);

    const rows = await connection.query(
      `
        SELECT
          cl.id,
          cl.call_id_hash,
          cl.call_key_hash,
          cl.from_user,
          cl.to_user,
          cl.from_domain,
          cl.to_domain,
          cl.direction,
          cl.initiated_at,
          cl.ringing_at,
          cl.answered_at,
          cl.ended_at,
          cl.estimated_duration_seconds,
          cl.signaling_duration_seconds,
          cl.final_status,
          cl.final_code,
          cl.final_reason,
          cl.result,
          cl.cancelled_by,
          cl.source
        FROM flexisip_call_logs cl
        WHERE ${whereSql}
        ORDER BY cl.initiated_at IS NULL ASC, cl.initiated_at DESC, cl.id DESC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    );

    if (!rows.length) {
      return { total, limit, offset, items: [] };
    }

    const callKeyHashes = rows.map((row) => String(row.call_key_hash || "")).filter(Boolean);
    const callKeySet = new Set(callKeyHashes);

    const deviceCountRows = await connection.query(
      `
        SELECT call_key_hash, COUNT(*) AS devices_count
        FROM flexisip_call_devices
        WHERE call_key_hash IN (?)
        GROUP BY call_key_hash
      `,
      [callKeyHashes],
    );
    const deviceCountMap = new Map();
    for (const row of deviceCountRows) {
      deviceCountMap.set(String(row.call_key_hash || ""), Number(row.devices_count || 0));
    }

    let deviceMap = new Map();
    if (includeDevices) {
      const deviceRows = await connection.query(
        `
          SELECT
            id,
            call_key_hash,
            device_event_key_hash,
            device_id_hash,
            account,
            domain,
            role,
            user_agent,
            transport,
            invited_at,
            ringing_at,
            answered_at,
            ended_at,
            final_code,
            final_reason,
            result
          FROM flexisip_call_devices
          WHERE call_key_hash IN (?)
          ORDER BY call_key_hash ASC, role ASC, id ASC
        `,
        [callKeyHashes],
      );

      deviceMap = new Map([...callKeySet].map((key) => [key, []]));
      for (const row of deviceRows) {
        const key = String(row.call_key_hash || "");
        if (!deviceMap.has(key)) deviceMap.set(key, []);
        deviceMap.get(key).push(sanitizeDevice(row));
      }
    }

    const items = rows.map((row) => {
      const callKeyHash = String(row.call_key_hash || "");
      const devicesCount = deviceCountMap.get(callKeyHash) || 0;
      const devices = includeDevices ? (deviceMap.get(callKeyHash) || []) : null;
      return sanitizeCallRow(row, devicesCount, devices);
    });

    return {
      total,
      limit,
      offset,
      items,
    };
  } catch (error) {
    if (error instanceof FlexisipCallLogQueryError) throw error;
    throw new FlexisipCallLogQueryError("Flexisip call log query failed.", {
      code: "FLEXISIP_CALL_LOG_QUERY_FAILED",
      cause: error,
    });
  } finally {
    if (connection) connection.release();
  }
}
