const DEFAULT_WEB_TIMEOUT_MS = 15000;
const DEFAULT_CONFIG_PATH = "/admin/config.php";
const EXTENSION_PATTERN = /^\d+$/;

export class FreepbxWebSessionError extends Error {
  constructor(message, { code = "FREEPBX_WEB_SESSION_ERROR", status = 0, cause = null } = {}) {
    super(message);
    this.name = "FreepbxWebSessionError";
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  addFromHeaders(headers) {
    const setCookies = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : splitSetCookie(headers.get("set-cookie") || "");
    for (const cookie of setCookies) {
      const pair = String(cookie || "").split(";")[0];
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  header() {
    return Array.from(this.cookies.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function splitSetCookie(value) {
  if (!value) return [];
  return String(value).split(/,(?=\s*[^;,=\s]+=[^;,]*)/g);
}

function getConfig() {
  const timeoutMs = Number(process.env.FREEPBX_WEB_TIMEOUT_MS || process.env.FREEPBX_API_TIMEOUT_MS || DEFAULT_WEB_TIMEOUT_MS);
  return {
    baseUrl: String(process.env.FREEPBX_WEB_BASE_URL || process.env.FREEPBX_BASE_URL || "http://127.0.0.1").replace(/\/+$/, ""),
    username: String(process.env.FREEPBX_WEB_USERNAME || ""),
    password: String(process.env.FREEPBX_WEB_PASSWORD || ""),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_WEB_TIMEOUT_MS,
  };
}

function assertValidExtension(extension) {
  if (!EXTENSION_PATTERN.test(String(extension || ""))) {
    throw new FreepbxWebSessionError("Invalid FreePBX extension.", { code: "INVALID_WEBRTC_EXTENSION" });
  }
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseAttributes(tag) {
  const attrs = {};
  const text = String(tag || "");
  const attrRegex = /([:@\w.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRegex.exec(text))) {
    const name = match[1].toLowerCase();
    if (name === "input" || name === "form" || name === "select" || name === "option" || name === "textarea") continue;
    attrs[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function hasBooleanAttribute(tag, name) {
  return new RegExp(`\\s${name}(?:\\s|=|/|>)`, "i").test(String(tag || ""));
}

function findExtensionForm(html) {
  const text = String(html || "");
  const forms = text.match(/<form\b[\s\S]*?<\/form>/gi) || [];
  return forms.find((form) => /id=["']frm_extensions["']|name=["']frm_extensions["']/i.test(form)) || "";
}

function appendField(fields, name, value) {
  if (!name) return;
  if (!fields.has(name)) fields.set(name, []);
  fields.get(name).push(value);
}

function parseForm(html) {
  const formHtml = findExtensionForm(html);
  if (!formHtml) {
    throw new FreepbxWebSessionError("FreePBX extension form was not found.", {
      code: "FREEPBX_EXTENSION_FORM_NOT_FOUND",
    });
  }

  const formOpen = formHtml.match(/<form\b[^>]*>/i)?.[0] || "";
  const formAttrs = parseAttributes(formOpen);
  const fields = new Map();

  for (const match of formHtml.matchAll(/<input\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const name = attrs.name;
    const type = String(attrs.type || "text").toLowerCase();
    if (!name || ["submit", "button", "image", "file"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && !hasBooleanAttribute(match[0], "checked")) continue;
    appendField(fields, name, attrs.value || "");
  }

  for (const match of formHtml.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const attrs = parseAttributes(match[1]);
    appendField(fields, attrs.name, decodeHtml(match[2] || ""));
  }

  for (const match of formHtml.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attrs = parseAttributes(match[1]);
    if (!attrs.name) continue;
    const options = Array.from(match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi));
    const selected = options.find((option) => hasBooleanAttribute(option[1], "selected")) || options[0];
    if (!selected) {
      appendField(fields, attrs.name, "");
      continue;
    }
    const optionAttrs = parseAttributes(selected[1]);
    appendField(fields, attrs.name, optionAttrs.value ?? decodeHtml(selected[2] || ""));
  }

  return {
    formAction: decodeHtml(formAttrs.action || DEFAULT_CONFIG_PATH),
    method: String(formAttrs.method || "GET").toUpperCase(),
    fields,
    fieldNames: Array.from(fields.keys()).sort(),
  };
}

function fieldsToSearchParams(fields) {
  const body = new URLSearchParams();
  for (const [name, values] of fields.entries()) {
    for (const value of values) body.append(name, value);
  }
  return body;
}

function setField(fields, name, value) {
  if (!fields.has(name)) return false;
  fields.set(name, [String(value)]);
  return true;
}

function hasLoginForm(html) {
  return /id=["']loginform["']/i.test(String(html || "")) && /name=["']username["']/i.test(String(html || ""));
}

export function getFreepbxWebConfigForOutput() {
  const config = getConfig();
  return {
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    hasUsername: Boolean(config.username),
    hasPassword: Boolean(config.password),
  };
}

export class FreepbxWebSessionClient {
  constructor() {
    this.config = getConfig();
    this.jar = new CookieJar();
  }

  async request(pathOrUrl, options = {}) {
    const url = pathOrUrl.startsWith("http")
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl, `${this.config.baseUrl}/`);
    const { controller, timeout } = withTimeout(this.config.timeoutMs);
    try {
      const headers = {
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        ...(options.headers || {}),
      };
      const cookieHeader = this.jar.header();
      if (cookieHeader) headers.Cookie = cookieHeader;
      const response = await fetch(url, {
        ...options,
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
      this.jar.addFromHeaders(response.headers);
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get("location")) {
        return this.request(new URL(response.headers.get("location"), url).toString(), {
          method: "GET",
          headers: { Referer: url.toString() },
        });
      }
      const text = await response.text();
      return { response, text, url: url.toString() };
    } catch (error) {
      throw new FreepbxWebSessionError(
        error?.name === "AbortError"
          ? `FreePBX Web request timed out after ${this.config.timeoutMs}ms.`
          : "FreePBX Web request failed.",
        { code: "FREEPBX_WEB_REQUEST_FAILED", cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async login() {
    if (!this.config.username || !this.config.password) {
      throw new FreepbxWebSessionError("FreePBX Web username/password are not configured.", {
        code: "FREEPBX_WEB_CREDENTIALS_MISSING",
      });
    }

    const loginPage = await this.request(DEFAULT_CONFIG_PATH);
    if (!hasLoginForm(loginPage.text)) return true;

    const body = new URLSearchParams({
      username: this.config.username,
      password: this.config.password,
    });
    const result = await this.request(DEFAULT_CONFIG_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: loginPage.url,
      },
      body,
    });

    if (hasLoginForm(result.text)) {
      throw new FreepbxWebSessionError("FreePBX Web login failed.", {
        code: "FREEPBX_WEB_LOGIN_FAILED",
        status: result.response.status,
      });
    }
    return true;
  }

  async getExtensionForm(extension) {
    assertValidExtension(extension);
    await this.login();
    const path = `${DEFAULT_CONFIG_PATH}?display=extensions&extdisplay=${encodeURIComponent(extension)}`;
    const result = await this.request(path);
    if (!result.response.ok) {
      throw new FreepbxWebSessionError("FreePBX extension edit page request failed.", {
        code: "FREEPBX_EXTENSION_FORM_REQUEST_FAILED",
        status: result.response.status,
      });
    }
    const form = parseForm(result.text);
    return {
      pageUrl: result.url,
      ...form,
      hasCsrfToken: form.fieldNames.some((name) => /csrf|token/i.test(name)),
    };
  }

  async submitExtensionForm(form, fields) {
    const actionUrl = new URL(form.formAction, form.pageUrl || `${this.config.baseUrl}${DEFAULT_CONFIG_PATH}`);
    const body = fieldsToSearchParams(fields);
    const result = await this.request(actionUrl.toString(), {
      method: form.method === "GET" ? "GET" : "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: form.pageUrl || `${this.config.baseUrl}${DEFAULT_CONFIG_PATH}`,
      },
      body,
    });
    if (!result.response.ok) {
      throw new FreepbxWebSessionError("FreePBX extension form submit failed.", {
        code: "FREEPBX_EXTENSION_FORM_SUBMIT_FAILED",
        status: result.response.status,
      });
    }
    return {
      status: result.response.status,
      finalUrl: result.url,
      loginShown: hasLoginForm(result.text),
    };
  }
}

export function inspectWebrtcFormFields(fieldNames) {
  const targets = getWebrtcFormTargetFields();
  return targets.map((target) => ({
    target: target.name,
    desiredValue: target.value,
    fieldName: target.candidates.find((candidate) => fieldNames.includes(candidate)) || null,
  }));
}

export function getWebrtcFormTargetFields() {
  const mediaAddress = process.env.FREEPBX_WEBRTC_MEDIA_ADDRESS || "35.221.190.216";
  const transport = process.env.FREEPBX_WEBRTC_TRANSPORT || "0.0.0.0-wss";
  const codecs = String(process.env.FREEPBX_WEBRTC_ALLOW_CODECS || "ulaw,h264")
    .split(",")
    .map((codec) => codec.trim())
    .filter(Boolean)
    .join("&");

  return [
    { name: "displayName", value: null, candidates: ["name"] },
    { name: "voicemail", value: "disabled", candidates: ["vm"] },
    { name: "transport", value: transport, candidates: ["devinfo_transport", "transport"] },
    { name: "avpf", value: "yes", candidates: ["devinfo_avpf", "avpf"] },
    { name: "iceSupport", value: "yes", candidates: ["devinfo_icesupport", "icesupport"] },
    { name: "rtcpMux", value: "yes", candidates: ["devinfo_rtcp_mux", "rtcp_mux"] },
    { name: "disallow", value: "all", candidates: ["devinfo_disallow", "disallow"] },
    { name: "allow", value: codecs, candidates: ["devinfo_allow", "allow"] },
    { name: "mailbox", value: "", candidates: ["devinfo_mailbox", "mailbox"] },
    { name: "removeExisting", value: "yes", candidates: ["devinfo_remove_existing", "remove_existing"] },
    {
      name: "mediaUseReceivedTransport",
      value: "yes",
      candidates: ["devinfo_media_use_received_transport", "media_use_received_transport"],
    },
    { name: "aggregateMwi", value: "yes", candidates: ["devinfo_aggregate_mwi", "aggregate_mwi"] },
    { name: "webrtc", value: "yes", candidates: ["devinfo_webrtc", "webrtc"] },
    { name: "bundle", value: "yes", candidates: ["devinfo_bundle", "bundle"] },
    { name: "sessionTimers", value: "no", candidates: ["devinfo_timers", "timers"] },
    { name: "directMedia", value: "no", candidates: ["devinfo_direct_media", "direct_media"] },
    { name: "mediaAddress", value: mediaAddress, candidates: ["devinfo_media_address", "media_address"] },
    {
      name: "mediaEncryptionOptimistic",
      value: "yes",
      candidates: ["devinfo_media_encryption_optimistic", "media_encryption_optimistic"],
    },
    { name: "mediaEncryption", value: "dtls", candidates: ["devinfo_media_encryption", "media_encryption"] },
    { name: "dtlsEnable", value: "yes", candidates: ["dtls_enable"] },
    { name: "dtlsVerify", value: "fingerprint", candidates: ["dtls_verify"] },
    { name: "dtlsSetup", value: "actpass", candidates: ["dtls_setup"] },
    { name: "dtlsRekey", value: "0", candidates: ["dtls_rekey"] },
    { name: "dtlsAutoGenerateCert", value: "1", candidates: ["dtls_auto_generate_cert"] },
    { name: "callWaiting", value: "enabled", candidates: ["callwaiting"] },
    { name: "callWaitingTone", value: "enabled", candidates: ["cwtone"] },
    { name: "webrtcEnable", value: "yes", candidates: ["webrtc_enable"] },
  ];
}

function preferredFieldName(candidates) {
  return candidates.find((candidate) => candidate.startsWith("devinfo_")) || candidates[0] || "";
}

export function buildWebrtcFormUpdate(form, extension) {
  assertValidExtension(extension);
  const fields = new Map(Array.from(form.fields.entries()).map(([name, values]) => [name, [...values]]));
  const applied = [];
  const missing = [];

  setField(fields, "action", "edit");
  setField(fields, "extdisplay", extension);
  setField(fields, "extension", extension);
  setField(fields, "name", `訪客${extension}`);

  for (const target of getWebrtcFormTargetFields()) {
    const value = target.name === "displayName" ? `訪客${extension}` : target.value;
    const existingFieldName = target.candidates.find((candidate) => fields.has(candidate));
    const fieldName = existingFieldName || preferredFieldName(target.candidates);
    if (fieldName) {
      fields.set(fieldName, [String(value)]);
      applied.push({ target: target.name, fieldName, value });
    } else {
      missing.push({ target: target.name, candidates: target.candidates });
    }
  }

  return { fields, applied, missing };
}
