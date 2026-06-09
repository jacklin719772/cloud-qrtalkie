import { getWebrtcRuntimeConfig } from "./webrtcTemplateLoader.js";

const EXTENSION_PATTERN = /^\d+$/;

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
  const runtime = getWebrtcRuntimeConfig();
  return {
    defaultPassword: runtime.defaultPassword,
    displayNamePrefix: runtime.displayNamePrefix,
    emailDomain: runtime.emailDomain,
    context: runtime.context,
    mediaAddress: runtime.mediaAddress,
    transport: runtime.transport,
    allowedCodecsString: runtime.allowedCodecsString,
    maxContacts: runtime.maxContacts,
    formAllowedCodecs: runtime.formAllowedCodecs,
    disallowCodecs: runtime.disallowCodecs,
    endpointGeneratedExpected: runtime.endpointGeneratedExpected,
    endpointCustomPostOverlay: runtime.endpointCustomPostOverlay,
  };
}

export function getFreepbxWebrtcPublicConfig(defaults = getFreepbxWebrtcDefaults()) {
  return {
    transport: defaults.transport,
    allowedCodecs: defaults.allowedCodecsString,
    mediaAddress: defaults.mediaAddress,
    displayNamePrefix: defaults.displayNamePrefix,
    emailDomain: defaults.emailDomain,
    context: defaults.context,
    maxContacts: defaults.maxContacts,
  };
}

function buildTargetFields(defaults) {
  return [
    { field: "transport", target: defaults.transport, candidates: ["transport"] },
    { field: "avpf", target: "yes", candidates: ["avpf"] },
    { field: "iceSupport", target: "yes", candidates: ["icesupport", "iceSupport"] },
    { field: "rtcpMux", target: "yes", candidates: ["rtcp_mux", "rtcpMux"] },
    { field: "disallow", target: defaults.disallowCodecs || "all", candidates: ["disallow"] },
    { field: "allow", target: defaults.formAllowedCodecs, candidates: ["allow"] },
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
    { field: "mediaAddress", target: defaults.mediaAddress, candidates: ["media_address", "mediaAddress"] },
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
    { field: "sendRpid", target: "pai", candidates: ["sendrpid", "sendRpid", "devinfo_sendrpid"] },
    { field: "callWaitingTone", target: "enable", candidates: ["callWaitingTone", "callwaiting"] },
    { field: "context", target: defaults.context, candidates: ["context"] },
    { field: "maxContacts", target: defaults.maxContacts, candidates: ["maxContacts", "max_contacts"] },
  ];
}

export function buildFreepbxWebrtcExtensionPayloads(extension, email, schema) {
  assertValidExtension(extension);
  const defaults = getFreepbxWebrtcDefaults();
  const displayName = `${defaults.displayNamePrefix}${extension}`;
  const addSchema = schema?.addExtensionInput || {};
  const updateSchema = schema?.updateExtensionInput || {};
  const addPayload = {};
  const updatePayload = {};
  const unsupportedByGraphql = [];
  const appliedFieldMappings = [];
  const targetFields = buildTargetFields(defaults);

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

  for (const target of targetFields) {
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
