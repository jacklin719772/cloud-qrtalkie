import "dotenv/config";
import { collectFlexisipCallEventsOnce } from "../server/flexisipCallCollector.js";
import { rebuildFlexisipCallStatisticsOnce } from "../server/flexisipCallStatisticsService.js";

async function main() {
  const startedAt = Date.now();
  try {
    const collected = await collectFlexisipCallEventsOnce({ dryRun: false });
    const rebuilt = await rebuildFlexisipCallStatisticsOnce({ dryRun: false });
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      collected: {
        parserEvents: collected.parserEvents,
        inserted: collected.inserted,
        skipped: collected.updatedSkipped,
        failed: collected.failed,
        readLines: collected.readLines,
        tailBytes: collected.tailBytes,
        truncated: collected.truncated,
      },
      rebuilt: {
        callCount: rebuilt.callCount,
        callLogInserted: rebuilt.callLogInserted,
        callLogUpdated: rebuilt.callLogUpdated,
        callLogSkipped: rebuilt.callLogSkipped,
        deviceInserted: rebuilt.deviceInserted,
        deviceUpdated: rebuilt.deviceUpdated,
        deviceSkipped: rebuilt.deviceSkipped,
        failed: rebuilt.failed,
      },
    }));
    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      at: new Date().toISOString(),
      message: "Flexisip call log pipeline failed",
      code: error?.code || "FLEXISIP_CALL_LOG_PIPELINE_FAILED",
      error: error?.message || String(error),
    }));
    process.exit(1);
  }
}

main();
