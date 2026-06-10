import "dotenv/config";
import { readFileSync, statSync } from "node:fs";
import { pool as dbPool } from "./db.js";
import { hasSensitiveLeak, parseFlexisipCallLog, summarizeEvents } from "./flexisipCallLogParser.js";

const DEFAULT_TAIL_LINES = 100000;
const SOURCE = "flexisip-proxy-log";

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeLine(line) {
  return String(line || "").replace(/\r$/, "");
}

function readTailText(path, tailLines) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").map(normalizeLine);
  const start = Math.max(0, lines.length - tailLines);
  return {
    text: lines.slice(start).join("\n"),
    totalLines: lines.length,
    readLines: lines.length - start,
    fileSize: statSync(path).size,
  };
}

function toMysqlDatetime(isoString) {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function toJsonValue(value) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  return JSON.stringify(value);
}

export function mapEventToDbRow(event) {
  return {
    event_key_hash: String(event.event_key_hash || ""),
    call_key_hash: String(event.call_key_hash || ""),
    event_time: toMysqlDatetime(event.event_time),
    event_type: String(event.event_type || ""),
    method: String(event.method || ""),
    status_code: event.status_code ?? null,
    reason_phrase: String(event.reason_phrase || ""),
    from_user: String(event.from_user || ""),
    from_domain: String(event.from_domain || ""),
    to_user: String(event.to_user || ""),
    to_domain: String(event.to_domain || ""),
    cseq_number: event.cseq_number ?? null,
    cseq_method: String(event.cseq_method || ""),
    from_tag_hash: String(event.from_tag_hash || ""),
    to_tag_hash: String(event.to_tag_hash || ""),
    branch_hash: String(event.branch_hash || ""),
    user_agent: String(event.user_agent || ""),
    raw_event_hash: String(event.raw_event_hash || ""),
    source: String(event.source || SOURCE),
    warnings: toJsonValue(event.warnings),
  };
}

function buildInsertSql() {
  return `
    INSERT INTO flexisip_call_events (
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
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON DUPLICATE KEY UPDATE
      call_key_hash = VALUES(call_key_hash),
      event_time = VALUES(event_time),
      event_type = VALUES(event_type),
      method = VALUES(method),
      status_code = VALUES(status_code),
      reason_phrase = VALUES(reason_phrase),
      from_user = VALUES(from_user),
      from_domain = VALUES(from_domain),
      to_user = VALUES(to_user),
      to_domain = VALUES(to_domain),
      cseq_number = VALUES(cseq_number),
      cseq_method = VALUES(cseq_method),
      from_tag_hash = VALUES(from_tag_hash),
      to_tag_hash = VALUES(to_tag_hash),
      branch_hash = VALUES(branch_hash),
      user_agent = VALUES(user_agent),
      raw_event_hash = VALUES(raw_event_hash),
      source = VALUES(source),
      warnings = VALUES(warnings)
  `;
}

export async function upsertFlexisipCallEvent(connection, event) {
  const row = mapEventToDbRow(event);
  const existing = await connection.query(
    "SELECT id FROM flexisip_call_events WHERE event_key_hash = ? LIMIT 1",
    [row.event_key_hash],
  );

  const values = [
    row.event_key_hash,
    row.call_key_hash,
    row.event_time,
    row.event_type,
    row.method,
    row.status_code,
    row.reason_phrase,
    row.from_user,
    row.from_domain,
    row.to_user,
    row.to_domain,
    row.cseq_number,
    row.cseq_method,
    row.from_tag_hash,
    row.to_tag_hash,
    row.branch_hash,
    row.user_agent,
    row.raw_event_hash,
    row.source,
    row.warnings,
  ];

  if (existing.length > 0) {
    const updateResult = await connection.query(
      `
        UPDATE flexisip_call_events
        SET
          call_key_hash = ?,
          event_time = ?,
          event_type = ?,
          method = ?,
          status_code = ?,
          reason_phrase = ?,
          from_user = ?,
          from_domain = ?,
          to_user = ?,
          to_domain = ?,
          cseq_number = ?,
          cseq_method = ?,
          from_tag_hash = ?,
          to_tag_hash = ?,
          branch_hash = ?,
          user_agent = ?,
          raw_event_hash = ?,
          source = ?,
          warnings = ?
        WHERE event_key_hash = ?
      `,
      [...values.slice(1), row.event_key_hash],
    );
    return {
      action: "updated",
      id: existing[0].id,
      affectedRows: updateResult?.affectedRows || 0,
    };
  }

  const insertResult = await connection.query(buildInsertSql(), values);
  return {
    action: "inserted",
    id: insertResult?.insertId || null,
    affectedRows: insertResult?.affectedRows || 0,
  };
}

export async function collectFlexisipCallEventsOnce(options = {}) {
  const logPath = String(options.logPath || process.env.FLEXISIP_CALL_LOG_PATH || "").trim();
  if (!logPath) {
    throw new Error("Missing FLEXISIP_CALL_LOG_PATH.");
  }

  const tailLines = clampInteger(
    options.tailLines ?? process.env.FLEXISIP_CALL_TAIL_LINES ?? process.env.FLEXISIP_CALL_LOG_TAIL_LINES,
    DEFAULT_TAIL_LINES,
    100,
    200000,
  );
  const dryRun = options.dryRun ?? String(process.env.FLEXISIP_CALL_COLLECTOR_DRY_RUN || "true").toLowerCase() !== "false";
  const input = readTailText(logPath, tailLines);
  const parsed = parseFlexisipCallLog(input.text);
  const stats = summarizeEvents(parsed.events);

  let inserted = 0;
  let updatedSkipped = 0;
  let failed = 0;

  if (!dryRun) {
    const pool = options.pool || dbPool;
    const connection = await pool.getConnection();
    try {
      for (const event of parsed.events) {
        try {
          const result = await upsertFlexisipCallEvent(connection, event);
          if (result.action === "inserted") inserted += 1;
          else updatedSkipped += 1;
        } catch {
          failed += 1;
        }
      }
    } finally {
      connection.release();
    }
  } else {
    updatedSkipped = parsed.events.length;
  }

  const output = {
    logPath,
    fileSize: input.fileSize,
    requestedTailLines: tailLines,
    readLines: input.readLines,
    parserEvents: parsed.events.length,
    eventTypeCounts: stats,
    dryRun,
    inserted,
    updatedSkipped,
    failed,
    sensitiveLeakDetected: hasSensitiveLeak({
      logPath,
      readLines: input.readLines,
      parserEvents: parsed.events.length,
      eventTypeCounts: stats,
      dryRun,
      inserted,
      updatedSkipped,
      failed,
      parserWarnings: parsed.warnings,
    }),
    parserWarnings: parsed.warnings,
  };

  return output;
}

