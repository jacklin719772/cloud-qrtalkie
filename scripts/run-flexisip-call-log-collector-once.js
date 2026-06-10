import "dotenv/config";
import { collectFlexisipCallEventsOnce } from "../server/flexisipCallCollector.js";
import { hasSensitiveLeak } from "../server/flexisipCallLogParser.js";

async function main() {
  const dryRun = String(process.env.FLEXISIP_CALL_COLLECTOR_DRY_RUN || "true").toLowerCase() !== "false";

  try {
    const result = await collectFlexisipCallEventsOnce({ dryRun });
    console.log(JSON.stringify(result, null, 2));

    if (hasSensitiveLeak(result)) {
      console.error("敏感字段泄漏检测失败。");
      process.exit(1);
    }

    if (result.sensitiveLeakDetected) {
      console.error("敏感字段泄漏检测失败。");
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      message: "Flexisip 呼叫日志采集失败",
      code: error?.code || "FLEXISIP_CALL_COLLECTOR_FAILED",
    }));
    process.exit(1);
  }
}

main();
