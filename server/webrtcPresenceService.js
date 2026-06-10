import { pool } from "./db.js";
import { getPjsipEndpointStatusBatch } from "./asteriskCommandService.js";

const DEFAULT_POLL_INTERVAL_MS = 30000;
const DEFAULT_INITIAL_DELAY_MS = 10000;
const DEFAULT_BATCH_LIMIT = 500;
const EVENT_LIMIT = 20;

let pollTimer = null;
let initialTimer = null;
let polling = false;

function normalizeStatus(status) {
  const value = String(status || "unknown").trim().toLowerCase();
  if (["online", "offline", "not_found", "unknown"].includes(value)) return value;
  return "unknown";
}

function statusTextFor(status, fallback = "") {
  if (fallback) return String(fallback);
  if (status === "online") return "在線";
  if (status === "offline") return "離線";
  if (status === "not_found") return "帳號不存在";
  return "狀態未知";
}

function toIsoString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function configuredExtensionList() {
  return String(process.env.WEBRTC_PRESENCE_EXTENSIONS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d+$/.test(item));
}

async function loadPresenceExtensions(connection, domain, limit) {
  const configured = configuredExtensionList();
  if (configured.length) return configured.slice(0, limit);

  const rows = await connection.query(
    `SELECT DISTINCT username
     FROM web_users
     WHERE sip_domain = ?
       AND username REGEXP '^[0-9]+$'
       AND status NOT IN ('rejected', 'expired')
     ORDER BY username
     LIMIT ?`,
    [domain, limit],
  );
  return rows.map((row) => String(row.username || "")).filter(Boolean);
}

async function recordPresence(connection, item, checkedAt) {
  const extension = String(item?.extension || "").trim();
  if (!/^\d+$/.test(extension)) return;

  const status = normalizeStatus(item?.status);
  const statusText = statusTextFor(status, item?.statusText);
  const rows = await connection.query(
    "SELECT extension, status FROM webrtc_account_presence_state WHERE extension = ? LIMIT 1",
    [extension],
  );
  const previous = rows[0] || null;
  const previousStatus = previous ? normalizeStatus(previous.status) : null;
  const changed = !previous || previousStatus !== status;
  const onlineAt = status === "online" && changed ? checkedAt : null;
  const offlineAt = status !== "online" && changed ? checkedAt : null;
  const lastSeenAt = status === "online" ? checkedAt : null;

  if (!previous) {
    await connection.query(
      `INSERT INTO webrtc_account_presence_state
        (extension, status, status_text, previous_status, online_at, offline_at, last_seen_at, last_changed_at, last_checked_at, source)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'asterisk_poll')`,
      [extension, status, statusText, onlineAt, offlineAt, lastSeenAt, checkedAt, checkedAt],
    );
  } else if (changed) {
    await connection.query(
      `UPDATE webrtc_account_presence_state
       SET previous_status = status,
           status = ?,
           status_text = ?,
           online_at = COALESCE(?, online_at),
           offline_at = COALESCE(?, offline_at),
           last_seen_at = COALESCE(?, last_seen_at),
           last_changed_at = ?,
           last_checked_at = ?,
           source = 'asterisk_poll'
       WHERE extension = ?`,
      [status, statusText, onlineAt, offlineAt, lastSeenAt, checkedAt, checkedAt, extension],
    );
  } else {
    await connection.query(
      `UPDATE webrtc_account_presence_state
       SET status_text = ?,
           last_seen_at = COALESCE(?, last_seen_at),
           last_checked_at = ?,
           source = 'asterisk_poll'
       WHERE extension = ?`,
      [statusText, lastSeenAt, checkedAt, extension],
    );
  }

  if (changed) {
    await connection.query(
      `INSERT INTO webrtc_account_presence_events
        (extension, previous_status, status, status_text, changed_at, source)
       VALUES (?, ?, ?, ?, ?, 'asterisk_poll')`,
      [extension, previousStatus, status, statusText, checkedAt],
    );
  }
}

export async function pollWebrtcPresence({ domain, batchLimit = DEFAULT_BATCH_LIMIT } = {}) {
  if (polling) return { skipped: true, reason: "already_running" };
  polling = true;
  let connection;

  try {
    connection = await pool.getConnection();
    const checkedAt = new Date();
    const extensions = await loadPresenceExtensions(connection, domain, batchLimit);
    if (!extensions.length) {
      return { skipped: false, count: 0 };
    }

    const batch = await getPjsipEndpointStatusBatch(extensions);
    for (const item of batch.items || []) {
      await recordPresence(connection, item, checkedAt);
    }
    return { skipped: false, count: extensions.length };
  } finally {
    polling = false;
    if (connection) connection.release();
  }
}

export function startWebrtcPresencePolling({ domain } = {}) {
  if (process.env.WEBRTC_PRESENCE_POLL_ENABLED === "false") {
    console.log("[WebRTC Presence] Polling disabled");
    return;
  }
  if (pollTimer || initialTimer) return;

  const intervalMs = Number(process.env.WEBRTC_PRESENCE_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
  const initialDelayMs = Number(process.env.WEBRTC_PRESENCE_INITIAL_DELAY_MS || DEFAULT_INITIAL_DELAY_MS);
  const batchLimit = Number(process.env.WEBRTC_PRESENCE_BATCH_LIMIT || DEFAULT_BATCH_LIMIT);
  const run = () => {
    pollWebrtcPresence({ domain, batchLimit }).catch((error) => {
      console.error("[WebRTC Presence] Poll failed:", error?.message || error);
    });
  };

  initialTimer = setTimeout(run, Number.isFinite(initialDelayMs) && initialDelayMs >= 0 ? initialDelayMs : DEFAULT_INITIAL_DELAY_MS);
  pollTimer = setInterval(run, Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_POLL_INTERVAL_MS);
  console.log("[WebRTC Presence] Polling started");
}

export function stopWebrtcPresencePolling() {
  if (initialTimer) clearTimeout(initialTimer);
  if (pollTimer) clearInterval(pollTimer);
  initialTimer = null;
  pollTimer = null;
}

export async function getWebrtcPresence(extension) {
  const ext = String(extension || "").trim();
  if (!/^\d+$/.test(ext)) {
    const error = new Error("Invalid WebRTC extension.");
    error.code = "INVALID_WEBRTC_EXTENSION";
    throw error;
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT extension, status, status_text, previous_status, online_at, offline_at,
              last_seen_at, last_changed_at, last_checked_at, source
       FROM webrtc_account_presence_state
       WHERE extension = ?
       LIMIT 1`,
      [ext],
    );
    const state = rows[0] || null;
    const events = await connection.query(
      `SELECT previous_status, status, status_text, changed_at, source
       FROM webrtc_account_presence_events
       WHERE extension = ?
       ORDER BY changed_at DESC, id DESC
       LIMIT ?`,
      [ext, EVENT_LIMIT],
    );

    return {
      extension: ext,
      initialized: Boolean(state),
      status: state?.status || "unknown",
      statusText: state?.status_text || "狀態未知",
      previousStatus: state?.previous_status || null,
      onlineAt: toIsoString(state?.online_at),
      offlineAt: toIsoString(state?.offline_at),
      lastSeenAt: toIsoString(state?.last_seen_at),
      lastChangedAt: toIsoString(state?.last_changed_at),
      lastCheckedAt: toIsoString(state?.last_checked_at),
      source: state?.source || "saas_presence_history",
      recentEvents: events.map((event) => ({
        previousStatus: event.previous_status || null,
        status: event.status || "unknown",
        statusText: event.status_text || statusTextFor(event.status),
        changedAt: toIsoString(event.changed_at),
        source: event.source || "asterisk_poll",
      })),
    };
  } finally {
    if (connection) connection.release();
  }
}

export async function getWebrtcPresenceBatch(extensions) {
  const list = Array.isArray(extensions) ? extensions.filter(e => /^\d+$/.test(String(e))) : [];
  if (!list.length) return { items: [] };

  const connection = await pool.getConnection();
  try {
    const placeholders = list.map(() => '?').join(',');
    const rows = await connection.query(
      `SELECT extension, status, status_text, previous_status, online_at, offline_at,
              last_seen_at, last_changed_at, last_checked_at, source
       FROM webrtc_account_presence_state
       WHERE extension IN (${placeholders})
       ORDER BY extension`,
      list,
    );

    const items = list.map(ext => {
      const row = rows.find(r => String(r.extension) === String(ext));
      return {
        extension: ext,
        initialized: Boolean(row),
        status: row?.status || "unknown",
        statusText: row?.status_text || "狀態未知",
        previousStatus: row?.previous_status || null,
        onlineAt: row?.online_at ? new Date(row.online_at).toISOString() : null,
        offlineAt: row?.offline_at ? new Date(row.offline_at).toISOString() : null,
        lastSeenAt: row?.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
        lastCheckedAt: row?.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
        source: row?.source || "saas_presence",
      };
    });
    return { items };
  } finally {
    connection.release();
  }
}
