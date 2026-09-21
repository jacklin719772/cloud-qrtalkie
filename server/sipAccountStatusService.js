import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { readRegistrarKeys } from "./redisClient.js";

/**
 * 查詢指定 SIP 帳號的即時狀態（註冊 + 通話）。
 *
 * 資料來源全部來自 Flexisip（不經 Asterisk）：
 *   · 註冊狀態：Flexisip Registrar 的 Redis 鍵 fs:<account>@<domain>（當場查，無快取）
 *   · 通話狀態：Flexisip Event log 的兩個目錄
 *       - users/<domain>/<account>/calls/<YYYY-MM-DD>.log
 *           每行 = 一次呼叫嘗試的結果（200 Ok / Cancelled / 603 Decline …），
 *           行首時間戳 = 呼叫「發起」時刻；寫入時刻 = 該次嘗試得出結論時（接聽/拒接/取消）。
 *       - users/<domain>/<account>/statistics_reports/<YYYY-MM-DD>.log
 *           每塊 = 一次通話結束時客戶端上報的 VQSessionReport: CallTerm，
 *           寫入時刻 = 通話結束（實測延遲 0~8 秒）。
 *
 * 判定：當日「已接聽（2xx）」筆數 > 當日「CallTerm」筆數 ⇒ 仍有未結束的通話 ⇒ 忙。
 * 若未結束的通話已存在超過 SIP_STATUS_MAX_CALL_HOURS（預設 3 小時），
 * 視為客戶端未上報（崩潰/斷網）而無法判斷 ⇒ unknown，避免永久誤判為忙。
 */

const ACCOUNT_PATTERN = /^[A-Za-z0-9._+-]{1,64}$/;
const DOMAIN_PATTERN = /^[a-z0-9.-]{1,255}$/i;
const LOG_LINE_HEAD_RE = /^([A-Z][a-z]{2} [A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})(?::|\s)/;
const MAX_TAIL_BYTES = 1024 * 1024;
const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export class SipAccountStatusError extends Error {
  constructor(message, { code = "SIP_ACCOUNT_STATUS_FAILED", statusCode = 400 } = {}) {
    super(message);
    this.name = "SipAccountStatusError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizeAccount(value) {
  const account = String(value ?? "").trim();
  if (!account) {
    throw new SipAccountStatusError("缺少 account 參數。", { code: "SIP_ACCOUNT_MISSING" });
  }
  if (!ACCOUNT_PATTERN.test(account)) {
    throw new SipAccountStatusError("account 格式不合法。", { code: "SIP_ACCOUNT_INVALID" });
  }
  return account;
}

export function normalizeDomain(value) {
  const domain = String(value ?? (process.env.FLEXISIP_DEFAULT_DOMAIN || "sip.qrtalkie.org")).trim().toLowerCase();
  if (!DOMAIN_PATTERN.test(domain)) {
    throw new SipAccountStatusError("domain 格式不合法。", { code: "SIP_DOMAIN_INVALID" });
  }
  return domain;
}

function resolveEventLogDir() {
  return String(process.env.FLEXISIP_EVENT_LOG_DIR || "/var/opt/belledonne-communications/log/flexisip").trim();
}

function resolveMaxCallHours() {
  const value = Number(process.env.SIP_STATUS_MAX_CALL_HOURS);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

function parseLogTimestamp(text) {
  const match = /^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(String(text || "").trim());
  if (!match) return null;
  const month = MONTHS[match[2]];
  if (month === undefined) return null;
  // Flexisip 以伺服器本地時區寫入；此主機為 UTC
  return new Date(Date.UTC(Number(match[7]), month, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])));
}

function readTailText(filePath, maxBytes = MAX_TAIL_BYTES) {
  if (!existsSync(filePath)) return "";
  let fd = null;
  try {
    fd = openSync(filePath, "r");
    const size = fstatSync(fd).size;
    const start = size > maxBytes ? size - maxBytes : 0;
    const length = size - start;
    if (length <= 0) return "";
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function splitResult(raw) {
  const text = String(raw || "").trim();
  const lastGt = text.lastIndexOf(">");
  if (lastGt >= 0) {
    return { target: text.slice(0, lastGt + 1).trim(), result: text.slice(lastGt + 1).trim() };
  }
  return { target: text, result: "" };
}

/** 解析 calls/<day>.log：一次呼叫嘗試一行 */
export function parseCallLog(text) {
  const items = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const head = LOG_LINE_HEAD_RE.exec(line);
    if (!head) continue;
    const at = parseLogTimestamp(head[1]);
    if (!at) continue;
    const rest = line.slice(head[0].length).trim();
    const arrow = rest.indexOf("-->");
    if (arrow < 0) continue;
    const from = rest.slice(0, arrow).trim();
    const { target: to, result } = splitResult(rest.slice(arrow + 3));
    if (!result) continue;
    items.push({
      at,
      from,
      to,
      result,
      isChatroom: /chatroom-/i.test(`${from} ${to}`),
      isAnswered: /^2\d\d\b/.test(result),
    });
  }
  items.sort((a, b) => a.at - b.at);
  return items;
}

/** 解析 statistics_reports/<day>.log：通話結束時上報的 CallTerm */
export function parseStatisticsReports(text) {
  const reports = [];
  let current = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (/^\s*$/.test(line)) continue;
    const head = LOG_LINE_HEAD_RE.exec(line);
    if (head) {
      if (current) reports.push(current);
      const at = parseLogTimestamp(head[1]);
      current = /VQSessionReport/i.test(line) && /CallTerm/i.test(line)
        ? { at, callId: "", localId: "", remoteId: "", startIso: "", stopIso: "" }
        : null;
      continue;
    }
    if (!current) continue;
    const timestamps = /^\s*Timestamps:\s*START=(\S+)\s+STOP=(\S+)/.exec(line);
    if (timestamps && !current.startIso) {
      current.startIso = timestamps[1];
      current.stopIso = timestamps[2];
      continue;
    }
    const callId = /^\s*CallID:\s*(\S+)/.exec(line);
    if (callId && !current.callId) {
      current.callId = callId[1];
      continue;
    }
    const localId = /^\s*LocalID:\s*(.+?)\s*$/.exec(line);
    if (localId && !current.localId) {
      current.localId = localId[1];
      continue;
    }
    const remoteId = /^\s*RemoteID:\s*(.+?)\s*$/.exec(line);
    if (remoteId && !current.remoteId) {
      current.remoteId = remoteId[1];
    }
  }
  if (current) reports.push(current);
  return reports.filter((report) => report.at);
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function resolveCallState({ domain, account, now = new Date() }) {
  const baseDir = resolveEventLogDir();
  const userDir = path.join(baseDir, "users", domain, account);
  if (!existsSync(userDir)) {
    return {
      callState: "unknown",
      call: null,
      detail: { reason: "event-log-dir-missing", answered: 0, terminated: 0, unmatched: 0 },
    };
  }

  const days = [dayKey(now), dayKey(new Date(now.getTime() - 24 * 3600 * 1000))];
  const calls = [];
  const reports = [];
  for (const day of days) {
    calls.push(...parseCallLog(readTailText(path.join(userDir, "calls", `${day}.log`))));
    reports.push(...parseStatisticsReports(readTailText(path.join(userDir, "statistics_reports", `${day}.log`))));
  }

  const answered = calls.filter((item) => item.isAnswered && !item.isChatroom);
  const terminated = reports.length;
  const unmatched = Math.max(0, answered.length - terminated);
  const lastAnswered = answered.length ? answered[answered.length - 1] : null;
  const detail = { answered: answered.length, terminated, unmatched };

  if (unmatched === 0) {
    return { callState: "idle", call: null, detail };
  }

  const ageMs = lastAnswered ? now.getTime() - lastAnswered.at.getTime() : Number.POSITIVE_INFINITY;
  if (!lastAnswered || ageMs > resolveMaxCallHours() * 3600 * 1000) {
    return { callState: "unknown", call: null, detail: { ...detail, reason: "call-term-report-missing" } };
  }

  const peer = lastAnswered.to.includes(`sip:${account}@`) ? lastAnswered.from : lastAnswered.to;
  return {
    callState: "busy",
    call: { peer, startedAt: lastAnswered.at.toISOString() },
    detail,
  };
}

async function resolveRegistration({ account, domain }) {
  const key = `fs:${account}@${domain}`;
  try {
    const result = await readRegistrarKeys([key]);
    const entry = result.get(key);
    if (!entry || entry.type !== "hash" || entry.ttl === -2) return false;
    return (entry.entries || []).length > 0;
  } catch {
    return null;
  }
}

export async function getSipAccountStatus({ account, domain, now = new Date() } = {}) {
  const normalizedAccount = normalizeAccount(account);
  const normalizedDomain = normalizeDomain(domain);

  const registered = await resolveRegistration({ account: normalizedAccount, domain: normalizedDomain });
  const { callState, call, detail } = resolveCallState({
    account: normalizedAccount,
    domain: normalizedDomain,
    now,
  });

  let state = "unknown";
  if (registered === false) {
    state = "offline";
  } else if (registered === true && callState === "busy") {
    state = "online_busy";
  } else if (registered === true && callState === "idle") {
    state = "online_idle";
  }

  return {
    account: normalizedAccount,
    domain: normalizedDomain,
    state,
    registered,
    callState,
    call,
    checkedAt: now.toISOString(),
    sources: {
      registration: "flexisip-registrar-redis",
      call: "flexisip-event-log",
    },
    detail,
  };
}
