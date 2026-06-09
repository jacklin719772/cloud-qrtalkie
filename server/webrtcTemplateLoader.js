import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER_PATTERN = /\$\{([A-Z0-9_]+)\}/g;
const SENSITIVE_NAME_PATTERN = /password|secret|token|cookie|csrf/i;

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") {
    const error = new Error(`缺少必要環境變數：${name}`);
    error.code = "WEBRTC_CONFIG_MISSING_ENV";
    error.envName = name;
    throw error;
  }
  return String(value).trim();
}

function resolvePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
}

export function resolveTemplatePlaceholders(input, env = process.env) {
  if (Array.isArray(input)) {
    return input.map((item) => resolveTemplatePlaceholders(item, env));
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, resolveTemplatePlaceholders(value, env)]));
  }
  if (typeof input !== "string") return input;

  return input.replace(PLACEHOLDER_PATTERN, (_, name) => {
    const value = env[name];
    if (value === undefined || value === null || String(value).trim() === "") {
      const error = new Error(`WebRTC 設定模板缺少必要欄位：${name}`);
      error.code = "WEBRTC_TEMPLATE_MISSING_ENV";
      error.envName = name;
      throw error;
    }
    return String(value);
  });
}

function validateResolvedTemplate(template, templatePath) {
  const requiredTopLevel = ["name", "description", "sourceExtension", "fallbackSourceExtension", "identity", "freepbxWebForm", "endpointGeneratedExpected", "endpointCustomPostOverlay"];
  for (const key of requiredTopLevel) {
    if (template[key] === undefined || template[key] === null) {
      const error = new Error("WebRTC 設定模板缺少必要欄位");
      error.code = "WEBRTC_TEMPLATE_MISSING_FIELDS";
      error.templatePath = templatePath;
      throw error;
    }
  }

  const identityFields = ["displayNamePrefix", "emailDomain", "context", "tech", "vmEnable", "maxContacts", "mediaAddress", "transport"];
  for (const key of identityFields) {
    if (template.identity[key] === undefined || template.identity[key] === null) {
      const error = new Error("WebRTC 設定模板缺少必要欄位");
      error.code = "WEBRTC_TEMPLATE_MISSING_FIELDS";
      error.templatePath = templatePath;
      throw error;
    }
  }

  const containsSensitiveName = (value) => SENSITIVE_NAME_PATTERN.test(String(value || ""));
  if (containsSensitiveName(JSON.stringify(template))) {
    const error = new Error("WebRTC 設定模板包含敏感欄位");
    error.code = "WEBRTC_TEMPLATE_INVALID";
    error.templatePath = templatePath;
    throw error;
  }
}

export function loadWebrtcTemplate(templatePath = process.env.FREEPBX_WEBRTC_TEMPLATE_FILE) {
  const resolvedPath = resolvePath(templatePath);
  if (!resolvedPath) {
    const error = new Error("WebRTC 設定模板不存在");
    error.code = "WEBRTC_TEMPLATE_NOT_FOUND";
    throw error;
  }

  let rawText;
  try {
    rawText = readFileSync(resolvedPath, "utf8");
  } catch (error) {
    const wrapped = new Error("WebRTC 設定模板不存在");
    wrapped.code = "WEBRTC_TEMPLATE_NOT_FOUND";
    wrapped.cause = error;
    wrapped.templatePath = resolvedPath;
    throw wrapped;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const wrapped = new Error("WebRTC 設定模板解析失敗");
    wrapped.code = "WEBRTC_TEMPLATE_PARSE_FAILED";
    wrapped.cause = error;
    wrapped.templatePath = resolvedPath;
    throw wrapped;
  }

  const resolved = resolveTemplatePlaceholders(parsed);
  validateResolvedTemplate(resolved, resolvedPath);
  return {
    templatePath: resolvedPath,
    template: resolved,
  };
}

export function getWebrtcRuntimeConfig() {
  const { templatePath, template } = loadWebrtcTemplate();
  const formAllowCodecs = String(template.freepbxWebForm.devinfo_allow || "").trim();
  const endpointAllow = String(template.endpointGeneratedExpected.allow || "").trim();
  const mediaAddress = String(template.identity.mediaAddress || template.freepbxWebForm.devinfo_media_address || "").trim();
  const transport = String(template.identity.transport || template.freepbxWebForm.devinfo_transport || "").trim();
  const displayNamePrefix = String(template.identity.displayNamePrefix || "").trim();
  const emailDomain = String(template.identity.emailDomain || "").trim();
  const context = String(template.identity.context || "").trim();
  const maxContacts = String(template.identity.maxContacts || "").trim();
  const defaultPassword = String(process.env.FREEPBX_WEBRTC_DEFAULT_PASSWORD || "").trim();

  return {
    templatePath,
    template,
    templateMode: String(process.env.FREEPBX_WEBRTC_TEMPLATE_MODE || "file").trim(),
    referenceExtension: String(template.sourceExtension || "").trim(),
    fallbackReferenceExtension: String(template.fallbackSourceExtension || process.env.FREEPBX_WEBRTC_TEMPLATE_FALLBACK_EXTENSION || "").trim(),
    displayNamePrefix,
    emailDomain,
    context,
    tech: String(template.identity.tech || "pjsip").trim(),
    vmEnable: Boolean(template.identity.vmEnable),
    maxContacts,
    mediaAddress,
    transport,
    allowedCodecsString: endpointAllow,
    formAllowedCodecs: formAllowCodecs,
    disallowCodecs: String(template.freepbxWebForm.devinfo_disallow || "all").trim(),
    defaultPassword,
    endpointGeneratedExpected: template.endpointGeneratedExpected,
    endpointCustomPostOverlay: template.endpointCustomPostOverlay,
    freepbxWebForm: template.freepbxWebForm,
  };
}

export function getAsteriskPathConfig() {
  return {
    configDir: requireEnv("ASTERISK_CONFIG_DIR"),
    endpointConf: requireEnv("ASTERISK_PJSIP_ENDPOINT_CONF"),
    endpointCustomPostConf: requireEnv("ASTERISK_PJSIP_ENDPOINT_CUSTOM_POST_CONF"),
    customPostConf: requireEnv("ASTERISK_PJSIP_CUSTOM_POST_CONF"),
    authConf: requireEnv("ASTERISK_PJSIP_AUTH_CONF"),
    aorConf: requireEnv("ASTERISK_PJSIP_AOR_CONF"),
    backupRoot: requireEnv("ASTERISK_BACKUP_ROOT"),
    asteriskBin: requireEnv("ASTERISK_BIN"),
    fwconsoleBin: requireEnv("FWCONSOLE_BIN"),
    reloadCommand: requireEnv("ASTERISK_RELOAD_COMMAND"),
  };
}

export function getSaasAdminLoginConfig() {
  return {
    baseUrl: requireEnv("SAAS_API_BASE_URL"),
    username: requireEnv("SAAS_ADMIN_USERNAME"),
    password: requireEnv("SAAS_ADMIN_PASSWORD"),
    loginPath: requireEnv("SAAS_ADMIN_LOGIN_PATH"),
    timeoutMs: Number(process.env.SAAS_ADMIN_TOKEN_TIMEOUT_MS || 15000),
    identifierField: String(process.env.SAAS_ADMIN_IDENTIFIER_FIELD || "email").trim().toLowerCase() || "email",
  };
}

export function getFreepbxWebConfigForOutput() {
  return {
    baseUrl: String(process.env.FREEPBX_WEB_BASE_URL || process.env.FREEPBX_BASE_URL || "").trim(),
    pageTimeoutMs: Number(process.env.FREEPBX_WEB_PAGE_TIMEOUT_MS || 60000),
    submitTimeoutMs: Number(process.env.FREEPBX_WEB_SUBMIT_TIMEOUT_MS || 60000),
    hasUsername: Boolean(process.env.FREEPBX_WEB_USERNAME),
    hasPassword: Boolean(process.env.FREEPBX_WEB_PASSWORD),
  };
}
