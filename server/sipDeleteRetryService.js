// 補償任務：重試刪除未完成的帳號（sync_status = 'pending_delete'）
// 場景：刪除流程中「遠端刪除失敗」或「遠端已刪除但本地刪除失敗」被標記的行。
// 每次運行：遠端刪除（404 視為已刪除）→ 本地事務刪除本地兩表；失敗記錄錯誤並按 5 分鐘退避。
import { pool } from "./db.js";
import {
  getAccount as flexisipGetAccount,
  deleteAccount as flexisipDeleteAccount,
} from "./flexisipAccountManagerClient.js";
import { hardDeleteLocalSipUser } from "./sipUserLocalDelete.js";

const MAX_PER_RUN = 50;
const RETRY_BACKOFF_MINUTES = 5;

function isRemoteAdminAccount(remoteAcc) {
  return Boolean(remoteAcc) && (
    remoteAcc.admin === true || remoteAcc.admin === 1 || String(remoteAcc.admin) === '1'
    || String(remoteAcc.role || '').toLowerCase() === 'admin'
  );
}

async function markRetryFailure(accountId, message) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query(
      `UPDATE sip_users SET sync_error = ?, sync_attempts = sync_attempts + 1, last_synced_at = NOW() WHERE id = ?`,
      [String(message || '').substring(0, 500), accountId],
    );
  } catch (error) {
    console.error("[SipDeleteRetry] Failed to record error:", error.message);
  } finally {
    if (connection) connection.release();
  }
}

export async function retryPendingSipAccountDeletes() {
  let connection;
  let rows;
  try {
    connection = await pool.getConnection();
    // 只自動補償「近期」失敗（24 小時內按 5 分鐘退避重試）；
    // 歷史遺留的陳舊 pending_delete 行（如 2026-09-22 事故存量）不自動刪除，
    // 僅在頁面顯示「刪除待重試」徽章，由管理員逐條手動處理。
    rows = await connection.query(
      `SELECT id, username, flexisip_account_id
       FROM sip_users
       WHERE sync_status = 'pending_delete'
         AND last_synced_at IS NOT NULL
         AND last_synced_at >= NOW() - INTERVAL 24 HOUR
         AND last_synced_at < NOW() - INTERVAL ? MINUTE
       ORDER BY id ASC
       LIMIT ?`,
      [RETRY_BACKOFF_MINUTES, MAX_PER_RUN],
    );
  } catch (error) {
    console.error("[SipDeleteRetry] Failed to load pending rows:", error.message);
    return;
  } finally {
    if (connection) connection.release();
  }
  if (!rows || rows.length === 0) return;

  let successCount = 0;
  for (const row of rows) {
    const accountId = Number(row.id);

    // 1) 遠端刪除（不存在 / 404 均視為已刪除）
    if (row.flexisip_account_id) {
      try {
        const remoteAcc = await flexisipGetAccount(row.flexisip_account_id);
        if (isRemoteAdminAccount(remoteAcc)) {
          await markRetryFailure(accountId, "Flexisip 服務端管理員帳號不允許刪除。");
          continue;
        }
      } catch (getError) {
        if (getError?.status !== 404) {
          await markRetryFailure(accountId, `無法確認遠端帳號：${getError?.message || getError}`);
          continue;
        }
      }
      try {
        await flexisipDeleteAccount(row.flexisip_account_id);
      } catch (deleteError) {
        if (deleteError?.status !== 404) {
          await markRetryFailure(accountId, `遠端刪除失敗：${deleteError?.message || deleteError}`);
          continue;
        }
      }
    }

    // 2) 本地刪除（同一事務，含 RESTRICT 外鍵依賴清理）
    try {
      await hardDeleteLocalSipUser(accountId);
      successCount++;
      console.log(`[SipDeleteRetry] account ${accountId} (${row.username}) fully deleted`);
    } catch (localError) {
      await markRetryFailure(accountId, `本地刪除失敗：${localError?.message || localError}`);
    }
  }

  console.log(`[SipDeleteRetry] run complete: ${successCount}/${rows.length} deleted`);
}
