import "dotenv/config";
import { pool as dbPool } from "./db.js";

function getRetentionDays() {
  const val = Number(process.env.FLEXISIP_CALL_LOG_RETENTION_DAYS);
  return Number.isFinite(val) && val > 0 ? val : 30;
}

export async function cleanupFlexisipCallLogs() {
  const retentionDays = getRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 19).replace("T", " ");

  const pool = dbPool;
  let connection;
  try {
    connection = await pool.getConnection();

    // 1. 删除旧事件
    const eventResult = await connection.query(
      "DELETE FROM flexisip_call_events WHERE event_time < ?",
      [cutoffStr],
    );
    const eventsDeleted = eventResult?.affectedRows || 0;

    // 2. 删除旧设备记录（通过 call_key_hash 关联旧通话）
    const deviceResult = await connection.query(
      `DELETE fd FROM flexisip_call_devices fd
       INNER JOIN flexisip_call_logs fl ON fd.call_key_hash = fl.call_key_hash
       WHERE fl.initiated_at < ?`,
      [cutoffStr],
    );
    const devicesDeleted = deviceResult?.affectedRows || 0;

    // 3. 删除旧通话记录
    const logResult = await connection.query(
      "DELETE FROM flexisip_call_logs WHERE initiated_at < ?",
      [cutoffStr],
    );
    const logsDeleted = logResult?.affectedRows || 0;

    console.log(
      `Flexisip call log cleanup: deleted ${logsDeleted} logs, ${devicesDeleted} devices, ${eventsDeleted} events (retention: ${retentionDays} days)`,
    );

    return { logsDeleted, devicesDeleted, eventsDeleted, retentionDays };
  } catch (error) {
    console.error("Flexisip call log cleanup failed:", error.message);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}
