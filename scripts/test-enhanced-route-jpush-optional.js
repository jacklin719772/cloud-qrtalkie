import "../server/loadEnv.js";
import { buildRoutePlan } from "../server/pushRouteService.js";

const config = {
  apns: {
    enabled: true,
    teamId: "TESTTEAMID",
    keyId: "TESTKEYID",
    keyPath: "/tmp/test-apns.p8",
    bundleId: "com.qrtalkie.app",
    voipBundleId: "com.qrtalkie.app.voip",
  },
  fcm: {
    enabled: true,
    serviceAccountPath: "/tmp/test-fcm.json",
  },
  jpush: {
    enabled: true,
    appKey: "test-app-key",
    masterSecret: "test-master-secret",
    apiUrl: "https://api.jpush.cn/v3/push",
  },
};

const payload = {
  fromUri: "sip:alice@sip.qrtalkie.org",
  toUri: "sip:950001@sip.qrtalkie.org",
  callId: "",
  msgid: "enhanced-jpush-optional-001",
  uid: "uuid-test",
  sound: "",
};

const devices = [
  {
    id: 1,
    device_id: "device-china-jpush-001",
    device_key: "device:device-china-jpush-001",
    tenant_id: 1,
    sip_user_id: 1,
    sip_username: "950001",
    sip_domain: "sip.qrtalkie.org",
    sip_instance: "urn:uuid:test-jpush",
    platform: "android",
    provider: "jpush",
    app_region: "china",
    package_name: "com.qrtalkie.push.cn",
    manufacturer: "Xiaomi",
    has_gms: 0,
    preferred_push_provider: "jpush",
    token: "",
    fcm_token: "",
    jpush_registration_id: "jpush-registration-token-test",
    apns_token: "",
    voip_token: "",
    app_version: "1.0.0",
    device_model: "MIX",
    os_version: "Android 14",
    last_seen_ip: "1.2.3.4",
    last_seen_country: "CN",
    enabled: 1,
    updated_at: new Date().toISOString(),
  },
];

console.log(JSON.stringify(buildRoutePlan({ event: "message", payload, devices, config }), null, 2));
