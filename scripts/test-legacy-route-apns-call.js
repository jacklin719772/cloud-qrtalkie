import "../server/loadEnv.js";
import { buildLegacyDispatchResult } from "../server/legacyFlexisipRouteService.js";
import { getGatewayConfig } from "../server/pushGatewayService.js";

const payload = {
  event: "call",
  type: "apns",
  token: "legacy-apns-token-test",
  app_id: "ABCD1234.com.qrtalkie.app.voip",
  from_uri: "sip:alice@sip.qrtalkie.org",
  to_uri: "sip:950001@sip.qrtalkie.org",
  call_id: "legacy-apns-call-001",
  msgid: "",
  uid: "uuid-test",
  sound: "notes_of_the_optimistic.caf",
  body: "",
};

console.log(JSON.stringify(buildLegacyDispatchResult(payload, getGatewayConfig()), null, 2));
