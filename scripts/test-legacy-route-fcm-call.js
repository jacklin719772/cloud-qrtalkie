import "../server/loadEnv.js";
import { buildLegacyDispatchResult } from "../server/legacyFlexisipRouteService.js";
import { getGatewayConfig } from "../server/pushGatewayService.js";

const payload = {
  event: "call",
  type: "firebase",
  token: "legacy-fcm-token-test",
  app_id: "228742953354",
  from_uri: "sip:alice@sip.qrtalkie.org",
  to_uri: "sip:950001@sip.qrtalkie.org",
  call_id: "legacy-fcm-call-001",
  msgid: "",
  uid: "uuid-test",
  sound: "",
  body: "",
};

console.log(JSON.stringify(buildLegacyDispatchResult(payload, getGatewayConfig()), null, 2));
