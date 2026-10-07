// 本地硬刪除 web 帳號及其 RESTRICT 外鍵依賴（單一事務）
// 背景：web_users 被 tenant_web_account_entitlements、billing_order_web_accounts
// 以 RESTRICT 引用，不先清理會觸發 1451（Cannot delete or update a parent row）。
import { pool } from "./db.js";

export async function hardDeleteLocalWebUsers(webUserIds) {
  const ids = (webUserIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return 0;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const placeholders = ids.map(() => "?").join(",");
    await connection.query(`DELETE FROM tenant_web_account_entitlements WHERE web_user_id IN (${placeholders})`, ids);
    await connection.query(`DELETE FROM billing_order_web_accounts WHERE web_user_id IN (${placeholders})`, ids);
    const result = await connection.query(`DELETE FROM web_users WHERE id IN (${placeholders})`, ids);
    await connection.commit();
    return Number(result?.affectedRows ?? ids.length);
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}
