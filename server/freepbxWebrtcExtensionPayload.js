const EXTENSION_PATTERN = /^\d+$/;
const DEFAULT_WEBRTC_PASSWORD = "Lin1971wn719772";
const DEFAULT_MEDIA_ADDRESS = "35.221.190.216";
const DEFAULT_TRANSPORT = "0.0.0.0-wss";
const DEFAULT_ALLOWED_CODECS = "ulaw,h264";
const DEFAULT_MAX_CONTACTS = "20";

const WEBRTC_TARGET_FIELDS = [
  { field: "transport", target: DEFAULT_TRANSPORT, candidates: ["transport"] },
  { field: "avpf", target: "yes", candidates: ["avpf"] },
  { field: "iceSupport", target: "yes", candidates: ["icesupport", "iceSupport"] },
  { field: "rtcpMux", target: "yes", candidates: ["rtcp_mux", "rtcpMux"] },
  { field: "disallow", target: "all", candidates: ["disallow"] },
  { field: "allow", target: DEFAULT_ALLOWED_CODECS, candidates: ["allow"] },
  { field: "mailbox", target: "", candidates: ["mailbox"] },
  { field: "removeExisting", target: "yes", candidates: ["remove_existing", "removeExisting"] },
  {
    field: "mediaUseReceivedTransport",
    target: "yes",
    candidates: ["media_use_received_transport", "mediaUseReceivedTransport"],
  },
  { field: "aggregateMwi", target: "yes", candidates: ["aggregate_mwi", "aggregateMwi"] },
  { field: "webrtc", target: "yes", candidates: ["webrtc"] },
  { field: "sessionTimers", target: "no", candidates: ["timers", "sessionTimers"] },
  { field: "directMedia", target: "no", candidates: ["direct_media", "directMedia"] },
  { field: "mediaAddress", target: DEFAULT_MEDIA_ADDRESS, candidates: ["media_address", "mediaAddress"] },
  {
    field: "mediaEncryptionOptimistic",
    target: "yes",
    candidates: ["media_encryption_optimistic", "mediaEncryptionOptimistic", "allowNonEncryptedMedia"],
  },
  { field: "mediaEncryption", target: "dtls", candidates: ["media_encryption", "mediaEncryption"] },
  { field: "dtlsEnable", target: "yes", candidates: ["dtls_enable", "dtlsEnable"] },
  {
    field: "dtlsAutoGenerateCert",
    target: "yes",
    candidates: ["dtls_auto_generate_cert", "dtlsAutoGenerateCert"],
  },
  { field: "callWaitingTone", target: "enable", candidates: ["callWaitingTone", "callwaiting"] },
];

function readEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value).trim();
}

function normalizeCodecs(value) {
  const codecs = String(value || DEFAULT_ALLOWED_CODECS)
    .split(",")
    .map((codec) => codec.trim())
    .filter(Boolean);
  return codecs.length ? codecs : DEFAULT_ALLOWED_CODECS.split(",");
}

function assertValidExtension(extension) {
  if (!EXTENSION_PATTERN.test(String(extension || ""))) {
    throw new Error("WebRTC extension must be numeric.");
  }
}

function coerceValue(value, graphqlType) {
  if (graphqlType === "Boolean") {
    if (value === "yes" || value === "enable") return true;
    if (value === "no" || value === "disable") return false;
  }
  return value;
}

function setIfSupported(payload, schemaFields, candidates, value) {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(schemaFields, candidate)) {
      payload[candidate] = coerceValue(value, schemaFields[candidate]);
      return candidate;
    }
  }
  return null;
}

export function getFreepbxWebrtcDefaults() {
  const allowedCodecs = normalizeCodecs(readEnv("FREEPBX_WEBRTC_ALLOW_CODECS", DEFAULT_ALLOWED_CODECS));
  return {
    defaultPassword: readEnv("FREEPBX_WEBRTC_DEFAULT_PASSWORD", DEFAULT_WEBRTC_PASSWORD),
    mediaAddress: readEnv("FREEPBX_WEBRTC_MEDIA_ADDRESS", DEFAULT_MEDIA_ADDRESS),
    transport: readEnv("FREEPBX_WEBRTC_TRANSPORT", DEFAULT_TRANSPORT),
    allowedCodecs,
    allowedCodecsString: allowedCodecs.join(","),
    maxContacts: readEnv("FREEPBX_WEBRTC_MAX_CONTACTS", DEFAULT_MAX_CONTACTS),
  };
}

export function getFreepbxWebrtcPublicConfig(defaults = getFreepbxWebrtcDefaults()) {
  return {
    transport: defaults.transport,
    allowedCodecs: defaults.allowedCodecsString,
    mediaAddress: defaults.mediaAddress,
    maxContacts: defaults.maxContacts,
  };
}

export function buildFreepbxWebrtcExtensionPayloads(extension, email, schema) {
  assertValidExtension(extension);
  const defaults = getFreepbxWebrtcDefaults();
  const displayName = `訪客${extension}`;
  const addSchema = schema?.addExtensionInput || {};
  const updateSchema = schema?.updateExtensionInput || {};
  const addPayload = {};
  const updatePayload = {};
  const unsupportedByGraphql = [];
  const appliedFieldMappings = [];

  const addBase = {
    extensionId: String(extension),
    name: displayName,
    tech: "pjsip",
    email,
    vmEnable: false,
    maxContacts: defaults.maxContacts,
  };
  const updateBase = {
    name: displayName,
    tech: "pjsip",
    email,
    vmEnable: false,
    maxContacts: defaults.maxContacts,
    extPassword: defaults.defaultPassword,
  };

  for (const [key, value] of Object.entries(addBase)) {
    if (Object.prototype.hasOwnProperty.call(addSchema, key)) addPayload[key] = coerceValue(value, addSchema[key]);
  }
  for (const [key, value] of Object.entries(updateBase)) {
    if (Object.prototype.hasOwnProperty.call(updateSchema, key)) updatePayload[key] = coerceValue(value, updateSchema[key]);
  }

  const targets = WEBRTC_TARGET_FIELDS.map((target) => {
    if (target.field === "transport") return { ...target, target: defaults.transport };
    if (target.field === "allow") return { ...target, target: defaults.allowedCodecsString };
    if (target.field === "mediaAddress") return { ...target, target: defaults.mediaAddress };
    return target;
  });

  for (const target of targets) {
    const appliedField = setIfSupported(updatePayload, updateSchema, target.candidates, target.target);
    if (appliedField) {
      appliedFieldMappings.push({
        targetField: target.field,
        graphqlField: appliedField,
        target: target.target,
      });
    } else {
      unsupportedByGraphql.push({
        field: target.field,
        target: target.target,
        reason: "No matching field found in updateExtensionInput",
      });
    }
  }

  return {
    displayName,
    addPayload,
    updatePayload,
    updatePayloadForOutput: { ...updatePayload, extPassword: updatePayload.extPassword ? "[REDACTED]" : undefined },
    defaults,
    webrtcConfig: getFreepbxWebrtcPublicConfig(defaults),
    unsupportedByGraphql,
    appliedFieldMappings,
  };
}
