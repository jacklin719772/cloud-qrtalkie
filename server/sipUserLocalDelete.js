// 本地硬刪除 sip_user 及其 RESTRICT 外鍵依賴（單一事務）
// 背景：sip_users 被 3 張 RESTRICT 外鍵表引用（billing_order_sip_accounts /
// tenant_sip_account_entitlements / billing_order_renewal_retained_accounts），
// 不先清理會觸發 1451（Cannot delete or update a parent row）。
// 其餘引用表為 CASCADE / SET NULL，由資料庫自動處理。
import { pool } from "./db.js";

export async function hardDeleteLocalSipUser(accountId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(`DELETE FROM billing_order_renewal_retained_accounts WHERE sip_user_id = ?`, [accountId]);
    await connection.query(`DELETE FROM billing_order_sip_accounts WHERE sip_user_id = ?`, [accountId]);
    await connection.query(`DELETE FROM tenant_sip_account_entitlements WHERE sip_user_id = ?`, [accountId]);
    await connection.query(`DELETE FROM sip_external_accounts WHERE sip_user_id = ?`, [accountId]);
    await connection.query(`DELETE FROM sip_users WHERE id = ?`, [accountId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
