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
    useAvpf: compareEndpointField(output, ["use_avpf", "avpf"], isEnabledValue),
    iceSupport: compareEndpointField(output, ["ice_support", "icesupport"], isEnabledValue),
    rtcpMux: compareEndpointField(output, ["rtcp_mux"], isEnabledValue),
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
    codecs: compareEndpointField(output, ["allow"], (value) => {
      const actual = parseCodecs(value);
      return allowedCodecs.every((codec) => actual.includes(codec));
    }),
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
