import "dotenv/config";
import { hasSensitiveLeak } from "../server/flexisipCallLogParser.js";
import { rebuildFlexisipCallStatisticsOnce } from "../server/flexisipCallStatisticsService.js";

async function main() {
  const dryRun = String(process.env.FLEXISIP_CALL_STATS_DRY_RUN || "true").toLowerCase() !== "false";

  try {
    const result = await rebuildFlexisipCallStatisticsOnce({ dryRun });
    const output = {
      dryRun: result.dryRun,
      eventCount: result.eventCount,
      callCount: result.callCount,
      deviceCount: result.deviceCount,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      callLogInserted: result.callLogInserted,
      callLogUpdated: result.callLogUpdated,
      callLogSkipped: result.callLogSkipped,
      deviceInserted: result.deviceInserted,
      deviceUpdated: result.deviceUpdated,
      deviceSkipped: result.deviceSkipped,
      sensitiveLeakDetected: hasSensitiveLeak({
        dryRun: result.dryRun,
        eventCount: result.eventCount,
        callCount: result.callCount,
        deviceCount: result.deviceCount,
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        callLogInserted: result.callLogInserted,
        callLogUpdated: result.callLogUpdated,
        callLogSkipped: result.callLogSkipped,
        deviceInserted: result.deviceInserted,
        deviceUpdated: result.deviceUpdated,
        deviceSkipped: result.deviceSkipped,
        samples: result.samples,
      }),
      samples: result.samples,
    };

    console.log(JSON.stringify(output, null, 2));

    if (output.sensitiveLeakDetected) {
      console.error("敏感字段泄漏检测失败。");
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      message: "Flexisip 呼叫统计重建失败",
      code: error?.code || "FLEXISIP_CALL_STATS_REBUILD_FAILED",
    }));
    process.exit(1);
  }
}

main();

