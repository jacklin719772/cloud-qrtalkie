import { isProviderConfigured, normalizeProvider } from "./pushRouteService.js";

const APPLE_LIKE_TYPES = new Set(["apple", "apns", "apns.dev", "apns.voip"]);
const FCM_LIKE_TYPES = new Set(["fcm", "firebase"]);

function trimText(value, maxLength = 255) {
  const text = String(value ?? "").trim();
  if (!maxLength || text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

function safeTokenHint(value) {
  const token = trimText(value, 2048);
  if (!token) return "";
  if (token.length <= 8) return `${token.slice(0, 2)}…${token.slice(-2)}`;
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

function normalizeEventName(value) {
  const event = trimText(value, 32).toLowerCase();
  if (event === "call" || event === "message") return event;
  return "";
}

function normalizeLegacyProviderType(value) {
  const type = trimText(value, 64).toLowerCase();
  if (!type) return "";
  if (type === "apple") return "apple";
  if (APPLE_LIKE_TYPES.has(type)) return type;
  if (FCM_LIKE_TYPES.has(type)) return "fcm";
  return normalizeProvider(type);
}

function resolveLegacyApnsAuthMode(config = {}) {
  const mode = trimText(config.apns?.authMode || process.env.APNS_AUTH_MODE || "p8", 16).toLowerCase();
  if (mode === "pem" || mode === "p8") return mode;
  return "invalid";
}

function buildLegacyRoutePlan(payload = {}, config = {}) {
  const event = normalizeEventName(payload.event);
  const type = normalizeLegacyProviderType(payload.type);
  const token = trimText(payload.token, 4096);
  const appId = trimText(payload.app_id || payload.appId || "", 256);
  const fromUri = trimText(payload.from_uri || payload.fromUri || "", 512);
  const toUri = trimText(payload.to_uri || payload.toUri || "", 512);
  const callId = trimText(payload.call_id || payload.callId || "", 255);
  const msgid = trimText(payload.msgid || payload.msgId || "", 255);
  const uid = trimText(payload.uid || "", 255);
  const sound = trimText(payload.sound || "", 255);
  const body = typeof payload.body === "string" ? payload.body : trimText(payload.body || "", 4096);

  const warnings = [];
  if (!appId) warnings.push("APP_ID_MISSING");

  let provider = "";
  let providerStatus = "not_configured";
  let routeReason = "";

  if (!event) {
    routeReason = "event_missing";
  } else if (!type) {
    routeReason = "unknown_provider_type";
  } else if (APPLE_LIKE_TYPES.has(type)) {
    provider = event === "call" ? "apns.voip" : "apns";
    routeReason = event === "call" ? "legacy_apple_call_apns_voip" : "legacy_apple_message_apns";
    providerStatus = isProviderConfigured(provider, config) ? "configured" : "not_configured";
  } else if (FCM_LIKE_TYPES.has(type)) {
    provider = "fcm";
    routeReason = event === "call" ? "legacy_fcm_call" : "legacy_fcm_message";
    providerStatus = isProviderConfigured(provider, config) ? "configured" : "not_configured";
  } else {
    routeReason = "unknown_provider_type";
  }

  const tokenPresent = Boolean(token);
  const providerReady = provider ? isProviderConfigured(provider, config) : false;
  let shouldSend = Boolean(event && provider && tokenPresent && providerReady);

  if (!tokenPresent) {
    routeReason = "no_token";
    shouldSend = false;
  } else if (provider && !providerReady) {
    routeReason = "provider_not_ready";
    shouldSend = false;
  }

  return {
    route_type: "legacy_route",
    event,
    type,
    provider,
    auth_mode: (provider === "apns" || provider === "apns.voip") ? resolveLegacyApnsAuthMode(config) : "",
    provider_status: providerStatus,
    route_reason: routeReason,
    token_type: "token",
    token_value_present: tokenPresent,
    token_hint: safeTokenHint(token),
    app_id: appId,
    app_id_present: Boolean(appId),
    from_uri: fromUri,
    to_uri: toUri,
    call_id: callId,
    msgid,
    uid,
    sound,
    body_present: Boolean(body),
    body_length: String(body || "").length,
    warnings,
    should_send: shouldSend,
    mode: "dry_run",
  };
}

function buildLegacyDispatchResult(payload = {}, config = {}) {
  const route = buildLegacyRoutePlan(payload, config);
  return {
    route,
    selected_provider: route.provider || "",
    route_reason: route.route_reason,
    token_type: route.token_type,
    token_value_present: route.token_value_present,
    should_send: route.should_send,
    provider_status: route.provider_status,
    route_type: route.route_type,
    mode: route.mode,
    status: "skipped",
    provider_response: {
      delivery_mode: "dry_run",
      route_type: route.route_type,
      event: route.event,
      type: route.type,
      provider: route.provider,
      auth_mode: route.auth_mode,
      route_reason: route.route_reason,
      token_type: route.token_type,
      token_value_present: route.token_value_present,
      token_hint: route.token_hint,
      app_id_present: route.app_id_present,
      warnings: route.warnings,
      should_send: route.should_send,
      provider_status: route.provider_status,
      auth_mode: route.auth_mode,
      payload_summary: {
        from_uri: route.from_uri,
        to_uri: route.to_uri,
        call_id: route.call_id,
        msgid: route.msgid,
        uid: route.uid,
        sound: route.sound,
        body_present: route.body_present,
        body_length: route.body_length,
      },
    },
  };
}

export {
  buildLegacyDispatchResult,
  buildLegacyRoutePlan,
  normalizeEventName,
  normalizeLegacyProviderType,
};
