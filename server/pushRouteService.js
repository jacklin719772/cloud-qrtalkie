const CHINA_COUNTRY_CODES = new Set([
  "cn",
  "chn",
  "china",
  "mainland",
  "中国",
  "中國",
]);

const CHINA_VENDOR_PROVIDERS = new Set([
  "jpush",
  "huawei",
  "honor",
  "xiaomi",
  "oppo",
  "vivo",
]);

const IOS_PROVIDERS = new Set(["apns", "apns.voip", "apns.dev"]);
const ANDROID_PROVIDERS = new Set(["fcm", "jpush", "huawei", "honor", "xiaomi", "oppo", "vivo"]);

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

function normalizeProvider(value) {
  const provider = trimText(value, 64).toLowerCase();
  if (!provider) return "";
  if (provider === "apple") return "apns";
  if (provider === "apns.dev") return "apns.dev";
  if (provider === "apns.voip") return "apns.voip";
  if (provider === "firebase") return "fcm";
  if (provider === "ios") return "apns";
  if (provider === "android") return "fcm";
  return provider;
}

function normalizeAppRegion(value) {
  const region = trimText(value, 32).toLowerCase();
  if (!region) return "";
  if (region === "overseas" || region === "global" || region === "intl" || region === "international") return "overseas";
  if (region === "china" || region === "cn" || region === "mainland") return "china";
  return region;
}

function normalizePreferredPushProvider(value) {
  const provider = normalizeProvider(value);
  if (!provider) return "";
  if (provider === "apns" || provider === "apns.voip" || provider === "fcm" || provider === "jpush") return provider;
  if (CHINA_VENDOR_PROVIDERS.has(provider)) return provider;
  return provider;
}

function normalizePlatform(value, provider = "") {
  const platform = trimText(value, 32).toLowerCase();
  if (platform) return platform;
  const normalizedProvider = normalizeProvider(provider);
  if (normalizedProvider.startsWith("apns")) return "ios";
  if (normalizedProvider === "fcm" || CHINA_VENDOR_PROVIDERS.has(normalizedProvider)) return "android";
  return "other";
}

function normalizeBoolean(value) {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function inferAppRegion(device = {}) {
  const direct = normalizeAppRegion(device.app_region || device.appRegion || "");
  if (direct) return direct;

  const preferred = normalizePreferredPushProvider(device.preferred_push_provider || device.preferredPushProvider || "");
  const provider = normalizeProvider(device.provider || "");
  const platform = normalizePlatform(device.platform, provider);
  const hasGms = normalizeBoolean(device.has_gms ?? device.hasGms);
  const manufacturer = trimText(device.manufacturer || "", 64).toLowerCase();
  const country = trimText(device.last_seen_country || device.lastSeenCountry || "", 32).toLowerCase();

  if (preferred === "jpush" || CHINA_VENDOR_PROVIDERS.has(preferred)) return "china";
  if (platform === "ios") return "overseas";
  if (provider === "fcm" || hasGms) return "overseas";
  if (manufacturer.includes("huawei") || manufacturer.includes("xiaomi") || manufacturer.includes("oppo") || manufacturer.includes("vivo") || manufacturer.includes("honor")) {
    return "china";
  }
  if (CHINA_COUNTRY_CODES.has(country)) return "china";
  return "overseas";
}

function isProviderConfigured(providerName, config = {}) {
  const provider = normalizeProvider(providerName);
  if (provider === "apns") {
    return Boolean(config.apns?.enabled && config.apns?.teamId && config.apns?.keyId && config.apns?.keyPath && (config.apns?.bundleId || config.apns?.voipBundleId));
  }
  if (provider === "apns.voip") {
    return Boolean(config.apns?.enabled && config.apns?.teamId && config.apns?.keyId && config.apns?.keyPath && (config.apns?.voipBundleId || config.apns?.bundleId));
  }
  if (provider === "fcm") {
    return Boolean(config.fcm?.enabled && config.fcm?.serviceAccountPath);
  }
  if (provider === "jpush") {
    return Boolean(config.jpush?.enabled && config.jpush?.appKey && config.jpush?.masterSecret && config.jpush?.apiUrl);
  }
  if (CHINA_VENDOR_PROVIDERS.has(provider)) {
    return false;
  }
  return false;
}

function resolveTokenType(device = {}, selectedProvider = "", event = "") {
  const provider = normalizeProvider(selectedProvider);
  const isCall = normalizeProvider(event) === "call";
  const tokenFields = [
    { type: "voip_token", value: device.voip_token },
    { type: "apns_token", value: device.apns_token },
    { type: "fcm_token", value: device.fcm_token },
    { type: "jpush_registration_id", value: device.jpush_registration_id },
    { type: "token", value: device.token },
  ];

  const preferredOrder = [];
  if (provider === "apns.voip") {
    if (isCall) preferredOrder.push("voip_token", "apns_token", "token");
    else preferredOrder.push("apns_token", "token", "voip_token");
  } else if (provider === "apns") {
    preferredOrder.push("apns_token", "token", "voip_token");
  } else if (provider === "fcm") {
    preferredOrder.push("fcm_token", "token");
  } else if (provider === "jpush") {
    preferredOrder.push("jpush_registration_id", "token");
  } else if (CHINA_VENDOR_PROVIDERS.has(provider)) {
    preferredOrder.push("jpush_registration_id", "token", "fcm_token", "apns_token", "voip_token");
  } else {
    preferredOrder.push("token", "apns_token", "voip_token", "fcm_token", "jpush_registration_id");
  }

  for (const type of preferredOrder) {
    const field = tokenFields.find((item) => item.type === type);
    if (field && String(field.value || "").trim()) {
      return {
        tokenType: field.type,
        tokenValue: String(field.value || "").trim(),
        tokenValuePresent: true,
        tokenHint: safeTokenHint(field.value),
      };
    }
  }

  return {
    tokenType: preferredOrder[0] || "token",
    tokenValue: "",
    tokenValuePresent: false,
    tokenHint: "",
  };
}

function routeDevicePush({ event, device = {}, config = {} }) {
  const normalizedEvent = normalizeProvider(event);
  const platform = normalizePlatform(device.platform, device.provider);
  const appRegion = inferAppRegion(device);
  const preferred = normalizePreferredPushProvider(device.preferred_push_provider || device.preferredPushProvider || "");
  const baseProvider = normalizeProvider(device.provider || "");
  const manufacturer = trimText(device.manufacturer || "", 64);
  const hasGms = normalizeBoolean(device.has_gms ?? device.hasGms);
  const resolvedToken = resolveTokenType(device, preferred || baseProvider, normalizedEvent);

  let selectedProvider = "";
  let routeReason = "";
  let providerReady = false;

  if (platform === "ios") {
    selectedProvider = normalizedEvent === "call" ? "apns.voip" : "apns";
    routeReason = normalizedEvent === "call" ? "ios_call_apns_voip" : "ios_message_apns";
    providerReady = isProviderConfigured(selectedProvider, config);
  } else if (platform === "android") {
    if (appRegion === "china") {
      selectedProvider = preferred || "jpush";
      routeReason = preferred ? "android_china_preferred_provider" : "android_china_default_jpush";
      providerReady = isProviderConfigured(selectedProvider, config);
    } else {
      selectedProvider = "fcm";
      routeReason = "android_overseas_fcm";
      providerReady = isProviderConfigured("fcm", config);
    }
  } else {
    selectedProvider = preferred || baseProvider || "fcm";
    routeReason = platform === "other" ? "unknown_platform_fallback" : "generic_fallback";
    providerReady = isProviderConfigured(selectedProvider, config);
  }

  if (!resolvedToken.tokenValuePresent) {
    routeReason = "no_token";
  } else if (!providerReady) {
    routeReason = "provider_not_ready";
  }

  const shouldSend = Boolean(resolvedToken.tokenValuePresent && providerReady);
  const providerStatus = isProviderConfigured(selectedProvider, config) ? "configured" : (CHINA_VENDOR_PROVIDERS.has(selectedProvider) ? "placeholder" : "not_configured");

  return {
    event: normalizedEvent,
    platform,
    app_region: appRegion,
    route_reason: routeReason,
    selected_provider: selectedProvider,
    provider_status: providerStatus,
    token_type: resolvedToken.tokenType,
    token_value_present: resolvedToken.tokenValuePresent,
    token_hint: resolvedToken.tokenHint,
    should_send: shouldSend,
    token_source: resolvedToken.tokenType,
    manufacturer,
    has_gms: hasGms,
    preferred_push_provider: preferred,
    base_provider: baseProvider,
  };
}

function buildRoutePlan({ event, payload = {}, devices = [], config = {} }) {
  const devicePlans = devices.map((device) => {
    const route = routeDevicePush({ event, device, config });
    return {
      device,
      route,
      selected_provider: route.selected_provider,
      route_reason: route.route_reason,
      token_type: route.token_type,
      token_value_present: route.token_value_present,
      should_send: route.should_send,
      provider_status: route.provider_status,
    };
  });

  return {
    event: normalizeProvider(event),
    payload_summary: {
      from_uri: trimText(payload.fromUri || payload.from_uri || "", 512),
      to_uri: trimText(payload.toUri || payload.to_uri || "", 512),
      call_id: trimText(payload.callId || payload.call_id || "", 255),
      msgid: trimText(payload.msgid || payload.msgId || "", 255),
      uid: trimText(payload.uid || "", 255),
      sound: trimText(payload.sound || "", 255),
    },
    devices: devicePlans,
    counts: {
      total: devicePlans.length,
      should_send: devicePlans.filter((item) => item.should_send).length,
      no_token: devicePlans.filter((item) => item.route_reason === "no_token").length,
      provider_not_ready: devicePlans.filter((item) => item.route_reason === "provider_not_ready").length,
    },
  };
}

export {
  buildRoutePlan,
  inferAppRegion,
  isProviderConfigured,
  normalizeAppRegion,
  normalizePreferredPushProvider,
  normalizePlatform,
  normalizeProvider,
  resolveTokenType,
  routeDevicePush,
};
