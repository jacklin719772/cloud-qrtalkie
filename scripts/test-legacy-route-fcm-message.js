import "../server/loadEnv.js";
import { buildLegacyDispatchResult } from "../server/legacyFlexisipRouteService.js";
import { getGatewayConfig } from "../server/pushGatewayService.js";

const payload = {
  event: "message",
  type: "fcm",
  token: "legacy-fcm-message-token-test",
  app_id: "228742953354",
  from_uri: "sip:alice@sip.qrtalkie.org",
  to_uri: "sip:950001@sip.qrtalkie.org",
  call_id: "",
  msgid: "legacy-fcm-message-001",
  uid: "uuid-test",
  sound: "",
  body: "hello",
};

console.log(JSON.stringify(buildLegacyDispatchResult(payload, getGatewayConfig()), null, 2));
