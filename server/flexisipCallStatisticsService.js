import "dotenv/config";
import { createHash } from "node:crypto";
import { pool as dbPool } from "./db.js";

const SOURCE = "flexisip-call-events";
const DEFAULT_DRY_RUN = true;
const DIRECTION_UNKNOWN = "unknown";
const RESULT_UNKNOWN = "unknown";
const FINAL_STATUS_UNKNOWN = "unknown";

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function maskHash(value, prefix = 12) {
  const raw = String(value || "");
  return raw ? raw.slice(0, prefix) : "";
}

function parseMysqlDatetime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toMysqlDatetime(date) {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hour = String(parsed.getUTCHours()).padStart(2, "0");
  const minute = String(parsed.getUTCMinutes()).padStart(2, "0");
  const second = String(parsed.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function toIso(date) {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toJsonValue(value) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  return JSON.stringify(value);
}

function normalizeJsonString(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function compareMaybeJson(a, b) {
  return normalizeJsonString(a) === normalizeJsonString(b);
}

function compareRowShape(existing, desired, fields) {
  for (const field of fields) {
    const current = existing?.[field];
    const next = desired?.[field];
    if (field === "warnings") {
      if (!compareMaybeJson(current, next)) return false;
      continue;
    }
    if (current === null && (next === null || next === "")) continue;
    if (next === null && (current === null || current === "")) continue;
    if (String(current ?? "") !== String(next ?? "")) return false;
  }
  return true;
}

function groupEventsByCallKey(events) {
  const groups = new Map();
  for (const event of events) {
    if (!groups.has(event.call_key_hash)) {
      groups.set(event.call_key_hash, []);
    }
    groups.get(event.call_key_hash).push(event);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const aTime = parseMysqlDatetime(a.event_time)?.getTime() || 0;
      const bTime = parseMysqlDatetime(b.event_time)?.getTime() || 0;
      if (aTime !== bTime) return aTime - bTime;
      return Number(a.id || 0) - Number(b.id || 0);
    });
  }
  return groups;
}

function getEventTime(event) {
  return parseMysqlDatetime(event.event_time);
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function getInitialInvite(events) {
  return events.find((event) => event.event_type === "invite") || events[0] || null;
}

function inferDirection(summary) {
  if (!summary.from_user || !summary.to_user) return DIRECTION_UNKNOWN;
  if (summary.from_domain && summary.to_domain && summary.from_domain === summary.to_domain) {
    return summary.from_user === summary.to_user ? "internal" : "internal";
  }
  return DIRECTION_UNKNOWN;
}

function inferTerminalResultFromEvent(event) {
  const statusCode = Number(event?.status_code || 0) || null;
  if (event?.event_type === "busy") return { result: "busy", finalStatus: "busy", finalCode: statusCode || 486, finalReason: pickFirstText(event?.reason_phrase, "Busy Here") };
  if (event?.event_type === "declined") return { result: "declined", finalStatus: "declined", finalCode: statusCode || 603, finalReason: pickFirstText(event?.reason_phrase, "Declined") };
  if (event?.event_type === "timeout") return { result: "timeout", finalStatus: "timeout", finalCode: statusCode || 408, finalReason: pickFirstText(event?.reason_phrase, "Request Timeout") };
  if (event?.event_type === "failed") return { result: "failed", finalStatus: "failed", finalCode: statusCode || 500, finalReason: pickFirstText(event?.reason_phrase, "Server Failure") };
  if (event?.event_type === "unavailable") return { result: "failed", finalStatus: "failed", finalCode: statusCode || 480, finalReason: pickFirstText(event?.reason_phrase, "Temporarily Unavailable") };
  if (event?.event_type === "cancel") return { result: "cancelled", finalStatus: "cancelled", finalCode: statusCode || 487, finalReason: pickFirstText(event?.reason_phrase, "Request Terminated") };
  return null;
}

function aggregateCall(events) {
  const warnings = new Set();
  const invite = getInitialInvite(events);
  if (!invite) warnings.add("MISSING_INVITE");

  const summary = {
    call_key_hash: String(events[0]?.call_key_hash || ""),
    call_id_hash: sha256(String(events[0]?.call_key_hash || "")),
    from_user: String(invite?.from_user || events[0]?.from_user || ""),
    to_user: String(invite?.to_user || events[0]?.to_user || ""),
    from_domain: String(invite?.from_domain || events[0]?.from_domain || ""),
    to_domain: String(invite?.to_domain || events[0]?.to_domain || ""),
    direction: DIRECTION_UNKNOWN,
    initiated_at: null,
    ringing_at: null,
    answered_at: null,
    ended_at: null,
    estimated_duration_seconds: null,
    signaling_duration_seconds: null,
    final_status: FINAL_STATUS_UNKNOWN,
    final_code: null,
    final_reason: "",
    result: RESULT_UNKNOWN,
    cancelled_by: "",
    source: SOURCE,
    warnings: [],
  };

  let terminalCandidate = null;
  let provisionalSeen = false;

  for (const event of events) {
    const eventTime = getEventTime(event);
    if (!eventTime) {
      warnings.add("EVENT_TIME_INVALID");
      continue;
    }

    if (event.event_type === "invite") {
      if (!summary.initiated_at || eventTime < summary.initiated_at) {
        summary.initiated_at = eventTime;
      }
      if (!summary.from_user) summary.from_user = String(event.from_user || "");
      if (!summary.to_user) summary.to_user = String(event.to_user || "");
      if (!summary.from_domain) summary.from_domain = String(event.from_domain || "");
      if (!summary.to_domain) summary.to_domain = String(event.to_domain || "");
    }

    if (event.event_type === "ringing" || event.event_type === "progress") {
      if (!summary.ringing_at || eventTime < summary.ringing_at) {
        summary.ringing_at = eventTime;
      }
      provisionalSeen = true;
      if (!summary.answered_at) {
        summary.final_status = "provisional";
        summary.final_reason = pickFirstText(event.reason_phrase, "Ringing");
      }
      continue;
    }

    if (event.event_type === "answered") {
      if (!summary.answered_at || eventTime < summary.answered_at) {
        summary.answered_at = eventTime;
      }
      summary.result = "answered";
      summary.final_status = "answered";
      summary.final_code = 200;
      summary.final_reason = pickFirstText(event.reason_phrase, "Ok");
      continue;
    }

    if (event.event_type === "bye") {
      if (!summary.ended_at || eventTime < summary.ended_at) {
        summary.ended_at = eventTime;
      }
      continue;
    }

    const terminal = inferTerminalResultFromEvent(event);
    if (!terminal) continue;

    if (!summary.answered_at) {
      if (!terminalCandidate || eventTime < terminalCandidate.eventTime) {
        terminalCandidate = {
          eventTime,
          result: terminal.result,
          finalStatus: terminal.finalStatus,
          finalCode: terminal.finalCode,
          finalReason: pickFirstText(event.reason_phrase, terminal.finalReason),
          cancelledBy: event.event_type === "cancel"
            ? (event.from_user && event.from_user === summary.from_user ? "caller" : (event.from_user && event.from_user === summary.to_user ? "callee" : "proxy"))
            : "",
        };
      }
    }

    if (!summary.ended_at || eventTime < summary.ended_at) {
      summary.ended_at = eventTime;
    }
  }

  if (summary.answered_at) {
    summary.result = "answered";
    summary.final_status = "answered";
    summary.final_code = summary.final_code || 200;
    summary.final_reason = pickFirstText(summary.final_reason, "Ok");
  } else if (terminalCandidate) {
    summary.result = terminalCandidate.result;
    summary.final_status = terminalCandidate.finalStatus;
    summary.final_code = terminalCandidate.finalCode;
    summary.final_reason = terminalCandidate.finalReason;
    summary.cancelled_by = terminalCandidate.cancelledBy || "";
  } else if (summary.ringing_at || provisionalSeen) {
    summary.final_status = "provisional";
    summary.final_reason = pickFirstText(summary.final_reason, "Ringing");
  }

  if (summary.initiated_at && summary.ended_at) {
    const initiatedMs = summary.initiated_at.getTime();
    const endedMs = summary.ended_at.getTime();
    if (endedMs >= initiatedMs) {
      summary.signaling_duration_seconds = Math.floor((endedMs - initiatedMs) / 1000);
    }
  }

  if (summary.answered_at && summary.ended_at) {
    const answeredMs = summary.answered_at.getTime();
    const endedMs = summary.ended_at.getTime();
    if (endedMs >= answeredMs) {
      summary.estimated_duration_seconds = Math.floor((endedMs - answeredMs) / 1000);
    }
  }

  summary.direction = inferDirection(summary);
  summary.warnings = Array.from(warnings);
  return summary;
}

function buildDeviceRows(summary, events) {
  const invite = getInitialInvite(events);
  const callerUserAgent = pickFirstText(invite?.user_agent);
  const calleeUserAgent = pickFirstText(
    events.find((event) => event.event_type === "answered")?.user_agent,
    events.find((event) => event.event_type === "ringing")?.user_agent,
    invite?.user_agent,
  );

  const base = {
    call_key_hash: summary.call_key_hash,
    invited_at: summary.initiated_at ? toMysqlDatetime(summary.initiated_at) : null,
    ringing_at: summary.ringing_at ? toMysqlDatetime(summary.ringing_at) : null,
    answered_at: summary.answered_at ? toMysqlDatetime(summary.answered_at) : null,
    ended_at: summary.ended_at ? toMysqlDatetime(summary.ended_at) : null,
    final_code: summary.final_code,
    final_reason: summary.final_reason,
    result: summary.result,
  };

  const caller = {
    ...base,
    role: "caller",
    account: summary.from_user,
    domain: summary.from_domain,
    user_agent: callerUserAgent,
    transport: "unknown",
    device_id_hash: sha256(`${summary.call_key_hash}|caller|${summary.from_user}|${summary.from_domain}`),
    device_event_key_hash: sha256(`${summary.call_key_hash}|caller|${summary.from_user}|${summary.from_domain}`),
  };

  const callee = {
    ...base,
    role: "callee",
    account: summary.to_user,
    domain: summary.to_domain,
    user_agent: calleeUserAgent,
    transport: "unknown",
    device_id_hash: sha256(`${summary.call_key_hash}|callee|${summary.to_user}|${summary.to_domain}`),
    device_event_key_hash: sha256(`${summary.call_key_hash}|callee|${summary.to_user}|${summary.to_domain}`),
  };

  return [caller, callee];
}

function mapCallLogRow(summary) {
  return {
    call_id_hash: summary.call_id_hash,
    call_key_hash: summary.call_key_hash,
    from_user: summary.from_user,
    to_user: summary.to_user,
    from_domain: summary.from_domain,
    to_domain: summary.to_domain,
    direction: summary.direction || DIRECTION_UNKNOWN,
    initiated_at: summary.initiated_at ? toMysqlDatetime(summary.initiated_at) : null,
    ringing_at: summary.ringing_at ? toMysqlDatetime(summary.ringing_at) : null,
    answered_at: summary.answered_at ? toMysqlDatetime(summary.answered_at) : null,
    ended_at: summary.ended_at ? toMysqlDatetime(summary.ended_at) : null,
    estimated_duration_seconds: summary.estimated_duration_seconds,
    signaling_duration_seconds: summary.signaling_duration_seconds,
    final_status: summary.final_status || FINAL_STATUS_UNKNOWN,
    final_code: summary.final_code,
    final_reason: summary.final_reason || "",
    result: summary.result || RESULT_UNKNOWN,
    cancelled_by: summary.cancelled_by || "",
    source: summary.source || SOURCE,
    warnings: toJsonValue(summary.warnings),
  };
}

function mapDeviceRow(device) {
  return {
    call_key_hash: device.call_key_hash,
    device_event_key_hash: device.device_event_key_hash,
    device_id_hash: device.device_id_hash,
    account: device.account || "",
    domain: device.domain || "",
    role: device.role || "unknown",
    user_agent: device.user_agent || "",
    transport: device.transport || "",
    invited_at: device.invited_at,
    ringing_at: device.ringing_at,
    answered_at: device.answered_at,
    ended_at: device.ended_at,
    final_code: device.final_code,
    final_reason: device.final_reason || "",
    result: device.result || RESULT_UNKNOWN,
  };
}

async function readAllEvents(connection) {
  return connection.query(`
    SELECT
      id,
      event_key_hash,
      call_key_hash,
      event_time,
      event_type,
      method,
      status_code,
      reason_phrase,
      from_user,
      from_domain,
      to_user,
      to_domain,
      cseq_number,
      cseq_method,
      from_tag_hash,
      to_tag_hash,
      branch_hash,
      user_agent,
      raw_event_hash,
      source,
      warnings
    FROM flexisip_call_events
    ORDER BY event_time ASC, id ASC
  `);
}

async function fetchExistingRow(connection, table, keyColumn, keyValue) {
  const rows = await connection.query(`SELECT * FROM ${table} WHERE ${keyColumn} = ? LIMIT 1`, [keyValue]);
  return rows[0] || null;
}

async function insertCallLog(connection, row) {
  const result = await connection.query(
    `
      INSERT INTO flexisip_call_logs (
        call_id_hash,
        call_key_hash,
        from_user,
        to_user,
        from_domain,
        to_domain,
        direction,
        initiated_at,
        ringing_at,
        answered_at,
        ended_at,
        estimated_duration_seconds,
        signaling_duration_seconds,
        final_status,
        final_code,
        final_reason,
        result,
        cancelled_by,
        source,
        warnings
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    [
      row.call_id_hash,
      row.call_key_hash,
      row.from_user,
      row.to_user,
      row.from_domain,
      row.to_domain,
      row.direction,
      row.initiated_at,
      row.ringing_at,
      row.answered_at,
      row.ended_at,
      row.estimated_duration_seconds,
      row.signaling_duration_seconds,
      row.final_status,
      row.final_code,
      row.final_reason,
      row.result,
      row.cancelled_by,
      row.source,
      row.warnings,
    ],
  );
  const rows = await connection.query("SELECT id FROM flexisip_call_logs WHERE call_key_hash = ? LIMIT 1", [row.call_key_hash]);
  return { id: rows[0]?.id || result?.insertId || null };
}

async function updateCallLog(connection, row) {
  await connection.query(
    `
      UPDATE flexisip_call_logs
      SET
        call_id_hash = ?,
        from_user = ?,
        to_user = ?,
        from_domain = ?,
        to_domain = ?,
        direction = ?,
        initiated_at = ?,
        ringing_at = ?,
        answered_at = ?,
        ended_at = ?,
        estimated_duration_seconds = ?,
        signaling_duration_seconds = ?,
        final_status = ?,
        final_code = ?,
        final_reason = ?,
        result = ?,
        cancelled_by = ?,
        source = ?,
        warnings = ?
      WHERE call_key_hash = ?
    `,
    [
      row.call_id_hash,
      row.from_user,
      row.to_user,
      row.from_domain,
      row.to_domain,
      row.direction,
      row.initiated_at,
      row.ringing_at,
      row.answered_at,
      row.ended_at,
      row.estimated_duration_seconds,
      row.signaling_duration_seconds,
      row.final_status,
      row.final_code,
      row.final_reason,
      row.result,
      row.cancelled_by,
      row.source,
      row.warnings,
      row.call_key_hash,
    ],
  );
  const rows = await connection.query("SELECT id FROM flexisip_call_logs WHERE call_key_hash = ? LIMIT 1", [row.call_key_hash]);
  return { id: rows[0]?.id || null };
}

async function insertDevice(connection, row, callLogId) {
  await connection.query(
    `
      INSERT INTO flexisip_call_devices (
        call_log_id,
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
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    [
      callLogId,
      row.call_key_hash,
      row.device_event_key_hash,
      row.device_id_hash,
      row.account,
      row.domain,
      row.role,
      row.user_agent,
      row.transport,
      row.invited_at,
      row.ringing_at,
      row.answered_at,
      row.ended_at,
      row.final_code,
      row.final_reason,
      row.result,
    ],
  );
}

async function updateDevice(connection, row, callLogId) {
  await connection.query(
    `
      UPDATE flexisip_call_devices
      SET
        call_log_id = ?,
        call_key_hash = ?,
        device_id_hash = ?,
        account = ?,
        domain = ?,
        role = ?,
        user_agent = ?,
        transport = ?,
        invited_at = ?,
        ringing_at = ?,
        answered_at = ?,
        ended_at = ?,
        final_code = ?,
        final_reason = ?,
        result = ?
      WHERE device_event_key_hash = ?
    `,
    [
      callLogId,
      row.call_key_hash,
      row.device_id_hash,
      row.account,
      row.domain,
      row.role,
      row.user_agent,
      row.transport,
      row.invited_at,
      row.ringing_at,
      row.answered_at,
      row.ended_at,
      row.final_code,
      row.final_reason,
      row.result,
      row.device_event_key_hash,
    ],
  );
}

async function upsertCallLog(connection, summary, dryRun) {
  const row = mapCallLogRow(summary);
  const existing = await fetchExistingRow(connection, "flexisip_call_logs", "call_key_hash", row.call_key_hash);
  if (!existing) {
    if (!dryRun) {
      const { id } = await insertCallLog(connection, row);
      return { action: "inserted", id, row };
    }
    return { action: "inserted", id: null, row };
  }

  if (compareRowShape(existing, row, [
    "call_id_hash",
    "from_user",
    "to_user",
    "from_domain",
    "to_domain",
    "direction",
    "initiated_at",
    "ringing_at",
    "answered_at",
    "ended_at",
    "estimated_duration_seconds",
    "signaling_duration_seconds",
    "final_status",
    "final_code",
    "final_reason",
    "result",
    "cancelled_by",
    "source",
    "warnings",
  ])) {
    return { action: "skipped", id: existing.id, row };
  }

  if (!dryRun) {
    await updateCallLog(connection, row);
  }
  return { action: "updated", id: existing.id, row };
}

async function upsertCallDevice(connection, device, callLogId, dryRun) {
  const row = mapDeviceRow(device);
  const existing = await fetchExistingRow(connection, "flexisip_call_devices", "device_event_key_hash", row.device_event_key_hash);
  if (!existing) {
    if (!dryRun) {
      await insertDevice(connection, row, callLogId);
    }
    return { action: "inserted", row };
  }

  if (compareRowShape(existing, {
    ...row,
    call_log_id: callLogId,
  }, [
    "call_key_hash",
    "device_id_hash",
    "account",
    "domain",
    "role",
    "user_agent",
    "transport",
    "invited_at",
    "ringing_at",
    "answered_at",
    "ended_at",
    "final_code",
    "final_reason",
    "result",
  ])) {
    return { action: "skipped", row };
  }

  if (!dryRun) {
    await updateDevice(connection, row, callLogId);
  }
  return { action: "updated", row };
}

export function buildStatisticsSamples(callSummaries) {
  return callSummaries.slice(0, 3).map((summary) => ({
    callKeyHash: maskHash(summary.call_key_hash),
    callIdHash: maskHash(summary.call_id_hash),
    fromUser: summary.from_user,
    toUser: summary.to_user,
    direction: summary.direction,
    initiatedAt: toIso(summary.initiated_at),
    ringingAt: toIso(summary.ringing_at),
    answeredAt: toIso(summary.answered_at),
    endedAt: toIso(summary.ended_at),
    result: summary.result,
    finalStatus: summary.final_status,
    finalCode: summary.final_code,
    finalReason: summary.final_reason,
    devicesCount: 2,
  }));
}

export async function rebuildFlexisipCallStatisticsOnce(options = {}) {
  const dryRun = options.dryRun ?? String(process.env.FLEXISIP_CALL_STATS_DRY_RUN || "true").toLowerCase() !== "false";
  const pool = options.pool || dbPool;
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;

  try {
    const events = await readAllEvents(connection);
    const grouped = groupEventsByCallKey(events);
    const callSummaries = [];
    const deviceRows = [];

    for (const groupEvents of grouped.values()) {
      const summary = aggregateCall(groupEvents);
      callSummaries.push(summary);
      deviceRows.push(...buildDeviceRows(summary, groupEvents));
    }

    let callLogInserted = 0;
    let callLogUpdated = 0;
    let callLogSkipped = 0;
    let deviceInserted = 0;
    let deviceUpdated = 0;
    let deviceSkipped = 0;
    let failed = 0;

    if (!dryRun) {
      await connection.beginTransaction();
      try {
        for (const summary of callSummaries) {
          try {
            const callResult = await upsertCallLog(connection, summary, false);
            if (callResult.action === "inserted") callLogInserted += 1;
            else if (callResult.action === "updated") callLogUpdated += 1;
            else callLogSkipped += 1;

            const callLogId = callResult.id;
            for (const device of buildDeviceRows(summary, grouped.get(summary.call_key_hash) || [])) {
              try {
                const deviceResult = await upsertCallDevice(connection, device, callLogId, false);
                if (deviceResult.action === "inserted") deviceInserted += 1;
                else if (deviceResult.action === "updated") deviceUpdated += 1;
                else deviceSkipped += 1;
              } catch {
                failed += 1;
              }
            }
          } catch {
            failed += 1;
          }
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    } else {
      for (const summary of callSummaries) {
        try {
          const callResult = await upsertCallLog(connection, summary, true);
          if (callResult.action === "inserted") callLogInserted += 1;
          else if (callResult.action === "updated") callLogUpdated += 1;
          else callLogSkipped += 1;

          for (const device of buildDeviceRows(summary, grouped.get(summary.call_key_hash) || [])) {
            try {
              const deviceResult = await upsertCallDevice(connection, device, null, true);
              if (deviceResult.action === "inserted") deviceInserted += 1;
              else if (deviceResult.action === "updated") deviceUpdated += 1;
              else deviceSkipped += 1;
            } catch {
              failed += 1;
            }
          }
        } catch {
          failed += 1;
        }
      }
    }

    return {
      dryRun,
      eventCount: events.length,
      callCount: callSummaries.length,
      deviceCount: deviceRows.length,
      callLogInserted,
      callLogUpdated,
      callLogSkipped,
      deviceInserted,
      deviceUpdated,
      deviceSkipped,
      inserted: callLogInserted + deviceInserted,
      updated: callLogUpdated + deviceUpdated,
      skipped: callLogSkipped + deviceSkipped,
      failed,
      samples: buildStatisticsSamples(callSummaries),
    };
  } finally {
    if (ownsConnection) {
      connection.release();
    }
  }
}
