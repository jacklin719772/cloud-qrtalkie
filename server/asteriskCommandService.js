import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXTENSION_PATTERN = /^\d+$/;

export class AsteriskCommandError extends Error {
  constructor(message, { command = "", output = "", cause = null } = {}) {
    super(message);
    this.name = "AsteriskCommandError";
    this.command = command;
    this.output = output;
    if (cause) this.cause = cause;
  }
}

function assertValidExtension(extension) {
  if (!EXTENSION_PATTERN.test(String(extension || ""))) {
    throw new AsteriskCommandError("Invalid PJSIP extension.", { command: "validate-extension" });
  }
}

function extractLineValue(output, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(String(output || "").matchAll(new RegExp(`^\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, "gim")));
  const match = matches[matches.length - 1];
  return match ? match[1].trim() : "";
}

function parseAsteriskParameterTable(output) {
  const table = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = String(match[1] || "").trim();
    const value = String(match[2] || "").trim();
    if (!key) continue;
    table[key] = value;
  }
  return table;
}

function getTableValue(table, key) {
  if (!table || typeof table !== "object") return "";
  return String(table[key] ?? "").trim();
}

function parseBooleanTableValue(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function extractEndpointSummary(output) {
  const text = String(output || "");
  const endpointLineRaw = text.match(/^Endpoint:\s+(.+)$/im)?.[1]?.trim() || "";
  const contactLineRaw = text.match(/^Contact:\s+(.+)$/im)?.[1]?.trim() || "";
  const endpointLineParts = endpointLineRaw.split(/\s+/).filter(Boolean);
  const contactLineParts = contactLineRaw.split(/\s+/).filter(Boolean);
  const endpointStatusToken = endpointLineParts[2] || "";
  const endpointChannelToken = endpointLineParts[3] || "";
  const contactStatusToken = contactLineParts[2] || contactLineParts[1] || "";
  const contactRttToken = contactLineParts[contactLineParts.length - 1] || "";
  const contactRttValue = Number.parseFloat(String(contactRttToken).replace(/[^\d.]/g, ""));
  const channelCountMatch = endpointLineRaw.match(/\b(\d+)\s+of\s+/i);
  const transport = extractLineValue(text, "transport");
  const tech = extractLineValue(text, "aors") ? "PJSIP" : "";
  return {
    endpointLine: endpointLineRaw,
    contactLine: contactLineRaw,
    endpointStatusToken,
    endpointChannelToken,
    contactStatusToken,
    rttMs: Number.isFinite(contactRttValue) ? contactRttValue : null,
    channelCount: channelCountMatch ? Number(channelCountMatch[1] || 0) : null,
    transport,
    tech,
    aor: extractLineValue(text, "aors") || "",
    auth: extractLineValue(text, "auth") || "",
  };
}

function redactAsteriskOutput(output) {
  return String(output || "")
    .replace(/(password\s*:\s*).*/gi, "$1[REDACTED]")
    .replace(/(md5_cred\s*:\s*).*/gi, "$1[REDACTED]")
    .replace(/(secret\s*:\s*).*/gi, "$1[REDACTED]");
}

function summarizeExists(output, expectedText) {
  const text = String(output || "");
  const lower = text.toLowerCase();
  if (lower.includes("unable to setgid") || lower.includes("unable to connect")) return false;
  if (lower.includes("not found") || lower.includes("unable to find")) return false;
  return text.includes(expectedText);
}

function normalizeValue(value) {
  return String(value || "")
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .toLowerCase();
}

function extractEndpointValue(output, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(String(output || "").matchAll(new RegExp(`^\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, "gim")));
  const match = matches[matches.length - 1];
  return match ? match[1].trim() : "";
}

function isEnabledValue(value) {
  const normalized = normalizeValue(value);
  return normalized === "yes" || normalized === "true" || normalized === "1" || normalized === "enabled";
}

function isDisabledValue(value) {
  const normalized = normalizeValue(value);
  return normalized === "no" || normalized === "false" || normalized === "0" || normalized === "disabled";
}

function compareEndpointField(output, fields, predicate) {
  for (const field of fields) {
    const value = extractEndpointValue(output, field);
    if (value) return predicate(value);
  }
  return false;
}

function parseCodecs(value) {
  return normalizeValue(value)
    .replace(/[()]/g, "")
    .split(/[,&| ]+/)
    .map((codec) => codec.trim())
    .filter(Boolean);
}

function verifyWebrtcEndpointParameters(output, expected = {}) {
  const allowedCodecs = String(expected.allowedCodecs || "ulaw,h264")
    .split(",")
    .map((codec) => codec.trim().toLowerCase())
    .filter(Boolean);
  const checks = {
    transport: compareEndpointField(output, ["transport"], (value) => normalizeValue(value) === normalizeValue(expected.transport)),
    allowUnauthenticatedOptions: compareEndpointField(
      output,
      ["allow_unauthenticated_options"],
      isEnabledValue,
    ),
    webrtc: compareEndpointField(output, ["webrtc"], isEnabledValue),
    useAvpf: compareEndpointField(output, ["use_avpf", "avpf"], isEnabledValue),
    iceSupport: compareEndpointField(output, ["ice_support", "icesupport"], isEnabledValue),
    rtcpMux: compareEndpointField(output, ["rtcp_mux"], isEnabledValue),
    bundle: compareEndpointField(output, ["bundle"], isEnabledValue),
    mediaEncryption: compareEndpointField(output, ["media_encryption"], (value) => normalizeValue(value).includes("dtls")),
    mediaEncryptionOptimistic: compareEndpointField(
      output,
      ["media_encryption_optimistic"],
      isEnabledValue,
    ),
    dtlsAutoGenerateCert: compareEndpointField(output, ["dtls_auto_generate_cert"], isEnabledValue),
    mediaUseReceivedTransport: compareEndpointField(
      output,
      ["media_use_received_transport"],
      isEnabledValue,
    ),
    directMedia: compareEndpointField(output, ["direct_media"], isDisabledValue),
    sessionTimers: compareEndpointField(output, ["timers"], isDisabledValue),
    mediaAddress: compareEndpointField(
      output,
      ["media_address"],
      (value) => normalizeValue(value) === normalizeValue(expected.mediaAddress),
    ),
    rtpTimeout: compareEndpointField(output, ["rtp_timeout"], (value) => normalizeValue(value) === String(expected.rtpTimeout ?? "0")),
    rtpTimeoutHold: compareEndpointField(
      output,
      ["rtp_timeout_hold"],
      (value) => normalizeValue(value) === String(expected.rtpTimeoutHold ?? "0"),
    ),
    codecs: compareEndpointField(output, ["allow"], (value) => {
      const actual = parseCodecs(value);
      return allowedCodecs.every((codec) => actual.includes(codec));
    }),
    asymmetricRtpCodec: compareEndpointField(output, ["asymmetric_rtp_codec"], isEnabledValue),
    sendPai: compareEndpointField(output, ["send_pai"], isEnabledValue),
  };
  const unsupportedOrUnverified = [
    {
      field: "callWaitingTone",
      reason: "Not visible in pjsip show endpoint output",
    },
    {
      field: "removeExisting",
      reason: "Not visible in pjsip show endpoint output",
    },
    {
      field: "aggregateMwi",
      reason: "Not reliably visible in pjsip show endpoint output",
    },
  ];
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([field]) => field);

  return {
    webrtcChecks: checks,
    unsupportedOrUnverified,
    failedChecks,
    webrtcVerified: failedChecks.length === 0,
  };
}

async function runAsteriskPjsipShow(kind, objectName) {
  const command = `pjsip show ${kind} ${objectName}`;
  try {
    const { stdout, stderr } = await execFileAsync("asterisk", ["-x", command], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    return redactAsteriskOutput(`${stdout || ""}${stderr ? `\n${stderr}` : ""}`);
  } catch (error) {
    const output = redactAsteriskOutput(`${error?.stdout || ""}${error?.stderr ? `\n${error.stderr}` : ""}`);
    throw new AsteriskCommandError(`Asterisk command failed: ${command}`, {
      command,
      output,
      cause: error,
    });
  }
}

export async function showPjsipEndpoint(extension) {
  assertValidExtension(extension);
  return runAsteriskPjsipShow("endpoint", String(extension));
}

export async function showPjsipAuth(extension) {
  assertValidExtension(extension);
  return runAsteriskPjsipShow("auth", `${extension}-auth`);
}

export async function showPjsipAor(extension) {
  assertValidExtension(extension);
  return runAsteriskPjsipShow("aor", String(extension));
}

export async function verifyPjsipExtension(extension, expectedWebrtcConfig = null) {
  assertValidExtension(extension);
  const result = {
    endpointExists: false,
    authExists: false,
    aorExists: false,
    details: {},
  };

  try {
    const output = await showPjsipEndpoint(extension);
    result.endpointExists = summarizeExists(output, `Endpoint:  ${extension}/`);
    result.details.endpoint = result.endpointExists ? "found" : "not_found";
    if (result.endpointExists && expectedWebrtcConfig) {
      Object.assign(result, verifyWebrtcEndpointParameters(output, expectedWebrtcConfig));
    }
  } catch (error) {
    result.details.endpoint = error.output || error.message;
  }

  try {
    const output = await showPjsipAuth(extension);
    result.authExists = summarizeExists(output, `Auth:  ${extension}-auth/`);
    result.details.auth = result.authExists ? "found" : "not_found";
  } catch (error) {
    result.details.auth = error.output || error.message;
  }

  try {
    const output = await showPjsipAor(extension);
    result.aorExists = summarizeExists(output, `Aor:  ${extension}`);
    result.details.aor = result.aorExists ? "found" : "not_found";
  } catch (error) {
    result.details.aor = error.output || error.message;
  }

  result.verified =
    result.endpointExists &&
    result.authExists &&
    result.aorExists &&
    (expectedWebrtcConfig ? Boolean(result.webrtcVerified) : true);
  return result;
}

function normalizeContactStatus(value) {
  const normalized = normalizeValue(value);
  if (!normalized) return "";
  if (normalized.includes("avail") || normalized.includes("reach")) return "Avail";
  if (normalized.includes("unavail")) return "Unavailable";
  if (normalized.includes("unknown")) return "Unknown";
  if (normalized.includes("lapsed")) return "Lapsed";
  if (normalized.includes("nonqual")) return "NonQual";
  return value;
}

function mapStatusFromContact(output, exists) {
  if (!exists) {
    return {
      status: "not_found",
      statusText: "帳號不存在",
    };
  }
  const summary = extractEndpointSummary(output);
  const contactStatus = normalizeContactStatus(summary.contactStatusToken || summary.endpointStatusToken || summary.contactLine);
  const normalized = normalizeValue(contactStatus);
  if (normalized === "avail" || normalized === "reachable") {
    return {
      status: "online",
      statusText: "在線",
    };
  }
  if (normalized === "unavailable" || normalized === "unavail") {
    return {
      status: "offline",
      statusText: "離線",
    };
  }
  if (normalized === "unknown") {
    return {
      status: "unknown",
      statusText: "狀態未知",
    };
  }
  return {
    status: "offline",
    statusText: "離線",
  };
}

export async function getPjsipEndpointStatus(extension) {
  assertValidExtension(extension);
  const result = {
    extension: String(extension),
    exists: false,
    status: "unknown",
    statusText: "狀態未知",
    tech: "PJSIP",
    resource: String(extension),
    channelCount: 0,
    transport: "",
    contactStatus: "",
    aor: String(extension),
    auth: `${extension}-auth`,
    lastSeen: null,
    rttMs: null,
    source: "asterisk",
  };

  try {
    const output = await showPjsipEndpoint(extension);
    const summary = extractEndpointSummary(output);
    const identityPatterns = [
      new RegExp(`^\\s*Endpoint:\\s+${String(extension)}\\/${String(extension)}\\b`, "im"),
      new RegExp(`^\\s*InAuth:\\s+${String(extension)}-auth\\/${String(extension)}\\b`, "im"),
      new RegExp(`^\\s*Aor:\\s+${String(extension)}\\b`, "im"),
    ];
    const notFound = /unable to find object|endpoint not found|no such endpoint|not found|does not exist/i.test(output);
    const exists = identityPatterns.some((pattern) => pattern.test(output)) && !notFound;
    result.exists = exists;
    result.channelCount = Number.isFinite(summary.channelCount) ? summary.channelCount : 0;
    result.transport = summary.transport || "";
    result.tech = summary.tech || "PJSIP";
    result.aor = summary.aor || String(extension);
    result.auth = summary.auth || `${extension}-auth`;
    const contactStatusSource = summary.endpointStatusToken || summary.contactStatusToken || summary.contactLine;
    result.contactStatus = normalizeContactStatus(contactStatusSource);
    const mapped = mapStatusFromContact(output, exists);
    result.status = mapped.status;
    result.statusText = mapped.statusText;
    if (!exists) {
      result.status = "not_found";
      result.statusText = "帳號不存在";
      result.channelCount = 0;
      result.contactStatus = "";
    }
    if (exists && result.status === "unknown" && result.contactStatus) {
      const normalized = normalizeValue(result.contactStatus);
      if (normalized === "avail" || normalized === "reachable") {
        result.status = "online";
        result.statusText = "在線";
      } else if (normalized === "unavailable" || normalized === "unavail") {
        result.status = "offline";
        result.statusText = "離線";
      }
    }
    if (exists) {
      const rttMatch = String(summary.contactLine || "").match(/(?:\b|\s)(\d+(?:\.\d+)?)\s*ms\b/i)
        || String(summary.contactLine || "").match(/(?:\b|\s)(\d+(?:\.\d+)?)\s*$/i);
      if (rttMatch) {
        const parsed = Number.parseFloat(rttMatch[1]);
        result.rttMs = Number.isFinite(parsed) ? parsed : null;
      }
    }
  } catch (error) {
    result.status = "unknown";
    result.statusText = "狀態未知";
    result.error = error instanceof AsteriskCommandError ? error.message : "Asterisk status query failed.";
  }

  return result;
}

export async function getPjsipEndpointStatusBatch(extensions) {
  const list = Array.isArray(extensions) ? extensions : [];
  const items = [];
  for (const extension of list) {
    items.push(await getPjsipEndpointStatus(extension));
  }
  return {
    count: items.length,
    items,
  };
}

function parseEndpointRuntimeSummary(output, extension) {
  const text = String(output || "");
  const endpointLine = text.match(/^Endpoint:\s+(.+)$/im)?.[1]?.trim() || "";
  const endpointParts = endpointLine.split(/\s+/).filter(Boolean);
  const contactLine = text.match(/^Contact:\s+(.+)$/im)?.[1]?.trim() || "";
  const contactParts = contactLine.split(/\s+/).filter(Boolean);
  const contactStatusToken = contactParts[2] || contactParts[1] || "";
  const contactStatus = normalizeContactStatus(contactStatusToken);
  const endpointStatusToken = endpointParts[2] || "";
  const channelMatch = endpointLine.match(/\b(\d+)\s+of\s+/i);
  const endpointExists = new RegExp(`^\\s*Endpoint:\\s+${String(extension)}\\/${String(extension)}\\b`, "im").test(text)
    || new RegExp(`^\\s*InAuth:\\s+${String(extension)}-auth\\/${String(extension)}\\b`, "im").test(text)
    || new RegExp(`^\\s*Aor:\\s+${String(extension)}\\b`, "im").test(text);
  const notFound = /unable to find object|endpoint not found|no such endpoint|not found|does not exist/i.test(text);
  const exists = endpointExists && !notFound;
  const rttMatch = contactLine.match(/(?:\b|\s)(\d+(?:\.\d+)?)\s*ms\b/i)
    || contactLine.match(/(?:\b|\s)(\d+(?:\.\d+)?)\s*$/i);

  return {
    endpointExists: exists,
    authExists: new RegExp(`^\\s*InAuth:\\s+${String(extension)}-auth\\/${String(extension)}\\b`, "im").test(text),
    aorExists: new RegExp(`^\\s*Aor:\\s+${String(extension)}\\b`, "im").test(text),
    status: contactStatus === "Avail" ? "online" : contactStatus === "Unavailable" ? "offline" : exists ? "offline" : "not_found",
    statusText: contactStatus === "Avail" ? "在線" : contactStatus === "Unavailable" ? "離線" : exists ? "離線" : "帳號不存在",
    tech: "PJSIP",
    resource: String(extension),
    channelCount: channelMatch ? Number(channelMatch[1] || 0) : 0,
    transport: extractEndpointValue(text, "transport") || "",
    contactStatus,
    aor: extractEndpointValue(text, "aors") || String(extension),
    auth: extractEndpointValue(text, "auth") || `${extension}-auth`,
    lastSeen: null,
    rttMs: rttMatch ? Number.parseFloat(rttMatch[1]) || null : null,
    context: extractEndpointValue(text, "context") || "",
    callerid: extractEndpointValue(text, "callerid") || "",
    webrtc: isEnabledValue(extractEndpointValue(text, "webrtc")),
    use_avpf: isEnabledValue(extractEndpointValue(text, "use_avpf")) || isEnabledValue(extractEndpointValue(text, "avpf")),
    ice_support: isEnabledValue(extractEndpointValue(text, "ice_support")) || isEnabledValue(extractEndpointValue(text, "icesupport")),
    rtcp_mux: isEnabledValue(extractEndpointValue(text, "rtcp_mux")),
    bundle: isEnabledValue(extractEndpointValue(text, "bundle")),
    media_encryption: normalizeValue(extractEndpointValue(text, "media_encryption")).includes("dtls") ? "dtls" : normalizeValue(extractEndpointValue(text, "media_encryption")) || "",
    media_encryption_optimistic: isEnabledValue(extractEndpointValue(text, "media_encryption_optimistic")),
    media_use_received_transport: isEnabledValue(extractEndpointValue(text, "media_use_received_transport")),
    direct_media: isDisabledValue(extractEndpointValue(text, "direct_media")),
    timers: isDisabledValue(extractEndpointValue(text, "timers")) ? "no" : extractEndpointValue(text, "timers") || "",
    media_address: extractEndpointValue(text, "media_address") || "",
    allow: extractEndpointValue(text, "allow") || "",
    dtls_auto_generate_cert: extractEndpointValue(text, "dtls_auto_generate_cert") || "",
    dtls_setup: extractEndpointValue(text, "dtls_setup") || "",
    dtls_verify: extractEndpointValue(text, "dtls_verify") || "",
    send_pai: isEnabledValue(extractEndpointValue(text, "send_pai")),
    allow_unauthenticated_options: isEnabledValue(extractEndpointValue(text, "allow_unauthenticated_options")),
    rtp_timeout: Number.parseInt(extractEndpointValue(text, "rtp_timeout"), 10) || 0,
    rtp_timeout_hold: Number.parseInt(extractEndpointValue(text, "rtp_timeout_hold"), 10) || 0,
    asymmetric_rtp_codec: isEnabledValue(extractEndpointValue(text, "asymmetric_rtp_codec")),
    rawAvailable: Boolean(text && !notFound),
  };
}

export async function getPjsipEndpointConfig(extension) {
  assertValidExtension(extension);
  const endpointOutput = await showPjsipEndpoint(extension);
  const table = parseAsteriskParameterTable(endpointOutput);
  const summary = parseEndpointRuntimeSummary(endpointOutput, String(extension));
  try {
    const authOutput = await showPjsipAuth(extension);
    summary.authExists = summary.authExists || summarizeExists(authOutput, `Auth:  ${extension}-auth/`);
  } catch {
    summary.authExists = Boolean(summary.authExists);
  }
  try {
    const aorOutput = await showPjsipAor(extension);
    summary.aorExists = summary.aorExists || summarizeExists(aorOutput, `Aor:  ${extension}`);
  } catch {
    summary.aorExists = Boolean(summary.aorExists);
  }
  summary.transport = getTableValue(table, "transport");
  summary.allow = getTableValue(table, "allow");
  summary.context = getTableValue(table, "context");
  summary.callerid = getTableValue(table, "callerid");
  summary.media_address = getTableValue(table, "media_address");
  summary.direct_media = parseBooleanTableValue(getTableValue(table, "direct_media"));
  summary.webrtc = parseBooleanTableValue(getTableValue(table, "webrtc"));
  summary.use_avpf = parseBooleanTableValue(getTableValue(table, "use_avpf")) || parseBooleanTableValue(getTableValue(table, "avpf"));
  summary.ice_support = parseBooleanTableValue(getTableValue(table, "ice_support")) || parseBooleanTableValue(getTableValue(table, "icesupport"));
  summary.rtcp_mux = parseBooleanTableValue(getTableValue(table, "rtcp_mux"));
  summary.bundle = parseBooleanTableValue(getTableValue(table, "bundle"));
  summary.media_encryption = getTableValue(table, "media_encryption");
  summary.media_encryption_optimistic = parseBooleanTableValue(getTableValue(table, "media_encryption_optimistic"));
  summary.media_use_received_transport = parseBooleanTableValue(getTableValue(table, "media_use_received_transport"));
  summary.dtls_auto_generate_cert = getTableValue(table, "dtls_auto_generate_cert");
  summary.dtls_setup = getTableValue(table, "dtls_setup");
  summary.dtls_verify = getTableValue(table, "dtls_verify");
  summary.send_pai = parseBooleanTableValue(getTableValue(table, "send_pai"));
  summary.allow_unauthenticated_options = parseBooleanTableValue(getTableValue(table, "allow_unauthenticated_options"));
  summary.rtp_timeout = Number.parseInt(getTableValue(table, "rtp_timeout"), 10) || 0;
  summary.rtp_timeout_hold = Number.parseInt(getTableValue(table, "rtp_timeout_hold"), 10) || 0;
  summary.asymmetric_rtp_codec = parseBooleanTableValue(getTableValue(table, "asymmetric_rtp_codec"));
  summary.rawAvailable = true;
  return summary;
}
