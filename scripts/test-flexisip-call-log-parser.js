import "dotenv/config";
import { readFileSync, statSync } from "node:fs";
import {
  hasSensitiveLeak,
  parseFlexisipCallLog,
  summarizeEvents,
  toSafeSample,
} from "../server/flexisipCallLogParser.js";

const DEFAULT_TAIL_LINES = 5000;

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readTailLines(path, maxLines) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const start = Math.max(0, lines.length - maxLines);
  return {
    text: lines.slice(start).join("\n"),
    totalLines: lines.length,
    readLines: lines.length - start,
  };
}

function main() {
  const logPath = String(process.env.FLEXISIP_CALL_LOG_PATH || "").trim();
  if (!logPath) {
    console.error("缺少 FLEXISIP_CALL_LOG_PATH，未读取日志。");
    process.exit(1);
  }

  let fileSize = 0;
  try {
    const stat = statSync(logPath);
    if (!stat.isFile()) {
      console.error("FLEXISIP_CALL_LOG_PATH 不是文件。");
      process.exit(1);
    }
    fileSize = stat.size;
  } catch (error) {
    console.error(`无法读取 FLEXISIP_CALL_LOG_PATH：${error?.code || "READ_FAILED"}`);
    process.exit(1);
  }

  const tailLines = clampInteger(
    process.env.FLEXISIP_CALL_LOG_TAIL_LINES,
    DEFAULT_TAIL_LINES,
    100,
    200000,
  );
  const input = readTailLines(logPath, tailLines);
  const parsed = parseFlexisipCallLog(input.text);
  const stats = summarizeEvents(parsed.events);
  const samples = parsed.events.slice(0, 3).map(toSafeSample);
  const output = {
    logPath,
    fileSize,
    requestedTailLines: tailLines,
    readLines: input.readLines,
    parsedEvents: stats.events,
    inviteEvents: stats.invite,
    callIdCount: stats.callIds,
    eventTypeCounts: {
      invite: stats.invite,
      ack: stats.ack,
      bye: stats.bye,
      cancel: stats.cancel,
      ringing: stats.ringing,
      progress: stats.progress,
      answered: stats.answered,
      busy: stats.busy,
      unavailable: stats.unavailable,
      declined: stats.declined,
      timeout: stats.timeout,
      failed: stats.failed,
    },
    safeSamples: samples,
    sensitiveLeakDetected: false,
    parserWarnings: parsed.warnings,
  };

  output.sensitiveLeakDetected = hasSensitiveLeak(output);
  console.log(JSON.stringify(output, null, 2));

  if (output.sensitiveLeakDetected) {
    process.exit(1);
  }
}

main();

