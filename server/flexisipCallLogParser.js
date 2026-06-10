import { createHash } from "node:crypto";

const SOURCE = "flexisip-proxy-log";
const REQUEST_METHODS = new Set(["INVITE", "ACK", "BYE", "CANCEL"]);
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "contact",
  "path",
  "record-route",
  "route",
  "via",
  "www-authenticate",
  "proxy-authenticate",
]);

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function hashOrNull(value) {
  const raw = String(value || "").trim();
  return raw ? sha256(raw) : null;
}

function decodeToken(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeLine(line) {
  return String(line || "").replace(/\r$/, "");
}

function parseLogTimestamp(line) {
  const match = String(line || "").match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}):(\d{3})\b/);
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}.${match[3]}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseStartLine(line) {
  const normalized = normalizeLine(line).trim();
  const response = normalized.match(/^SIP\/2\.0\s+(\d{3})(?:\s+(.+?))?\s*$/i);
  if (response) {
    return {
      kind: "response",
      statusCode: Number.parseInt(response[1], 10),
      reasonPhrase: sanitizeReason(response[2] || ""),
      method: null,
    };
  }

  const request = normalized.match(/^([A-Z]+)\s+\S+\s+SIP\/2\.0\s*$/i);
  if (request) {
    return {
      kind: "request",
      method: request[1].toUpperCase(),
      statusCode: null,
      reasonPhrase: null,
    };
  }

  return null;
}

function unfoldHeaderLines(lines) {
  const unfolded = [];
  for (const line of lines) {
    const normalized = normalizeLine(line);
    if (/^\s/.test(normalized) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ` ${normalized.trim()}`;
    } else {
      unfolded.push(normalized);
    }
  }
  return unfolded;
}

function parseHeaders(lines) {
  const headers = new Map();
  for (const line of unfoldHeaderLines(lines)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const rawName = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    const name = normalizeHeaderName(rawName);
    if (!name) continue;
    if (!headers.has(name)) headers.set(name, []);
    headers.get(name).push(value);
  }
  return headers;
}

function normalizeHeaderName(name) {
  const lower = String(name || "").trim().toLowerCase();
  if (lower === "i") return "call-id";
  if (lower === "f") return "from";
  if (lower === "t") return "to";
  if (lower === "v") return "via";
  if (lower === "c") return "content-type";
  return lower;
}

function firstHeader(headers, name) {
  return headers.get(name)?.[0] || "";
}

function parseCseq(value) {
  const match = String(value || "").match(/^\s*(\d+)\s+([A-Z]+)\s*$/i);
  if (!match) {
    return { cseqNumber: null, cseqMethod: "" };
  }
  return {
    cseqNumber: Number.parseInt(match[1], 10),
    cseqMethod: match[2].toUpperCase(),
  };
}

function parseSipIdentity(value) {
  const raw = String(value || "");
  const uriMatch = raw.match(/sip:([^@\s;>]+)@([^;\s>]+)/i);
  const tagMatch = raw.match(/(?:^|[;\s])tag=([^;\s>]+)/i);
  return {
    user: uriMatch ? sanitizeSipUser(decodeToken(uriMatch[1])) : "",
    domain: uriMatch ? sanitizeDomain(uriMatch[2]) : "",
    tag: tagMatch ? tagMatch[1] : "",
  };
}

function parseBranch(headers) {
  const via = firstHeader(headers, "via");
  const match = via.match(/(?:^|[;\s])branch=([^;\s]+)/i);
  return match ? match[1] : "";
}

function sanitizeSipUser(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w.+-]/g, "")
    .slice(0, 128);
}

function sanitizeDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "")
    .slice(0, 255);
}

function sanitizeReason(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w .,'()/-]/g, "")
    .slice(0, 128);
}

function sanitizeUserAgent(value) {
  return String(value || "")
    .trim()
    .replace(/[\r\n]/g, " ")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[redacted]")
    .slice(0, 255);
}

function mapEventType(startLine, cseqMethod) {
  if (startLine.kind === "request") {
    if (!REQUEST_METHODS.has(startLine.method)) return "";
    return startLine.method.toLowerCase();
  }

  if (cseqMethod !== "INVITE") return "";

  if (startLine.statusCode === 180) return "ringing";
  if (startLine.statusCode === 183) return "progress";
  if (startLine.statusCode === 200) return "answered";
  if (startLine.statusCode === 486) return "busy";
  if (startLine.statusCode === 480) return "unavailable";
  if (startLine.statusCode === 603) return "declined";
  if (startLine.statusCode === 408) return "timeout";
  if (startLine.statusCode >= 500 && startLine.statusCode <= 599) return "failed";
  return "";
}

function buildHashBasis({ callId, fromTag, cseqNumber, cseqMethod, statusCode, eventType, branch, rawEventHash }) {
  return [
    callId,
    fromTag,
    cseqNumber || "",
    cseqMethod || "",
    statusCode || "",
    eventType || "",
    branch || "",
    rawEventHash || "",
  ].join("|");
}

function buildRawEventHash(startLineText, headers, cseq) {
  const safeParts = [
    startLineText.trim(),
    `call-id:${firstHeader(headers, "call-id")}`,
    `from:${hashOrNull(firstHeader(headers, "from")) || ""}`,
    `to:${hashOrNull(firstHeader(headers, "to")) || ""}`,
    `cseq:${cseq.cseqNumber || ""} ${cseq.cseqMethod || ""}`,
    `branch:${hashOrNull(parseBranch(headers)) || ""}`,
  ];
  return sha256(safeParts.join("\n"));
}

function parseSipMessageBlock(block) {
  const warnings = [];
  const startLineIndex = block.lines.findIndex((line) => parseStartLine(line));
  if (startLineIndex < 0) return null;

  const startLineText = normalizeLine(block.lines[startLineIndex]);
  const startLine = parseStartLine(startLineText);
  if (!startLine) return null;

  const headerLines = [];
  for (let index = startLineIndex + 1; index < block.lines.length; index += 1) {
    const line = normalizeLine(block.lines[index]);
    if (!line.trim()) break;
    headerLines.push(line);
  }

  const headers = parseHeaders(headerLines);
  const cseq = parseCseq(firstHeader(headers, "cseq"));
  const eventType = mapEventType(startLine, cseq.cseqMethod);
  if (!eventType) return null;

  const callId = firstHeader(headers, "call-id");
  if (!callId) warnings.push("CALL_ID_MISSING");
  if (!cseq.cseqMethod) warnings.push("CSEQ_MISSING");

  const from = parseSipIdentity(firstHeader(headers, "from"));
  const to = parseSipIdentity(firstHeader(headers, "to"));
  const branch = parseBranch(headers);
  const rawEventHash = buildRawEventHash(startLineText, headers, cseq);
  const callKeyBasis = callId ? `call:${callId}|from-tag:${from.tag || ""}` : rawEventHash;
  const callKeyHash = sha256(callKeyBasis);
  const eventKeyHash = sha256(buildHashBasis({
    callId,
    fromTag: from.tag,
    cseqNumber: cseq.cseqNumber,
    cseqMethod: cseq.cseqMethod,
    statusCode: startLine.statusCode,
    eventType,
    branch,
    rawEventHash,
  }));

  return {
    event_key_hash: eventKeyHash,
    call_key_hash: callKeyHash,
    event_time: block.eventTime,
    event_type: eventType,
    method: startLine.kind === "request" ? startLine.method : null,
    status_code: startLine.statusCode,
    reason_phrase: startLine.reasonPhrase,
    from_user: from.user,
    from_domain: from.domain,
    to_user: to.user,
    to_domain: to.domain,
    cseq_number: cseq.cseqNumber,
    cseq_method: cseq.cseqMethod,
    from_tag_hash: hashOrNull(from.tag),
    to_tag_hash: hashOrNull(to.tag),
    branch_hash: hashOrNull(branch),
    user_agent: sanitizeUserAgent(firstHeader(headers, "user-agent")),
    raw_event_hash: rawEventHash,
    source: SOURCE,
    warnings,
  };
}

function isMessageMarker(line) {
  return /Receiving new (Request|Response) SIP message/i.test(line);
}

function collectSipBlocks(text) {
  const lines = String(text || "").split("\n").map(normalizeLine);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isMessageMarker(line)) continue;

    const eventTime = parseLogTimestamp(line);
    const blockLines = [line];
    let sawStartLine = false;
    let sawHeaderTerminator = false;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const current = lines[cursor];
      if (isMessageMarker(current)) break;
      if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}:\d{3}\b/.test(current) && sawHeaderTerminator) break;

      blockLines.push(current);
      if (parseStartLine(current)) sawStartLine = true;
      if (sawStartLine && !current.trim()) {
        sawHeaderTerminator = true;
        break;
      }
    }

    blocks.push({ eventTime, lines: blockLines });
  }

  return blocks;
}

export function parseFlexisipCallLog(text, _options = {}) {
  const events = [];
  const warnings = [];
  const blocks = collectSipBlocks(text);

  for (const block of blocks) {
    try {
      const event = parseSipMessageBlock(block);
      if (event) events.push(event);
    } catch {
      warnings.push("SIP_MESSAGE_PARSE_FAILED");
    }
  }

  return {
    events,
    stats: summarizeEvents(events),
    warnings,
  };
}

export function summarizeEvents(events) {
  const callKeys = new Set();
  const byType = {};
  for (const event of events || []) {
    if (event.call_key_hash) callKeys.add(event.call_key_hash);
    byType[event.event_type] = (byType[event.event_type] || 0) + 1;
  }

  return {
    events: events?.length || 0,
    callIds: callKeys.size,
    invite: byType.invite || 0,
    ack: byType.ack || 0,
    bye: byType.bye || 0,
    cancel: byType.cancel || 0,
    ringing: byType.ringing || 0,
    progress: byType.progress || 0,
    answered: byType.answered || 0,
    busy: byType.busy || 0,
    unavailable: byType.unavailable || 0,
    declined: byType.declined || 0,
    timeout: byType.timeout || 0,
    failed: byType.failed || 0,
  };
}

export function hasSensitiveLeak(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return false;
  const checks = [
    /\b(?:Proxy-)?Authorization\b/i,
    /\bContact\s*:/i,
    /\b(?:token|secret|cookie|csrf)\b/i,
    /\bpn-prid\b/i,
    /\bpush\b.*\btoken\b/i,
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
    /(?:^|[\s"{,])(?:v|o|s|c|t|m|a)=/i,
  ];
  return checks.some((pattern) => pattern.test(text));
}

export function maskHash(value, prefix = 12) {
  const raw = String(value || "");
  return raw ? raw.slice(0, prefix) : "";
}

export function toSafeSample(event) {
  return {
    eventTime: event.event_time,
    eventType: event.event_type,
    method: event.method,
    statusCode: event.status_code,
    reasonPhrase: event.reason_phrase,
    fromUser: event.from_user,
    fromDomain: event.from_domain,
    toUser: event.to_user,
    toDomain: event.to_domain,
    cseqNumber: event.cseq_number,
    cseqMethod: event.cseq_method,
    callKeyHash: maskHash(event.call_key_hash),
    eventKeyHash: maskHash(event.event_key_hash),
    fromTagHash: maskHash(event.from_tag_hash),
    toTagHash: maskHash(event.to_tag_hash),
    branchHash: maskHash(event.branch_hash),
    userAgent: event.user_agent,
    source: event.source,
    warnings: event.warnings,
  };
}

