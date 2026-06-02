import express from 'express';
import { pool } from '../db.js';

const router = express.Router();

// GET /admin/tenants - 獲取首頁租戶列表與統計資料
router.get('/tenants', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();

    // 聯表查詢：取得租戶基本資訊、訂購數量 (user_limit) 與累計支付 (totalPaid)
    const query = `
      SELECT 
        t.id,
        t.tenant_number AS tenantNumber,
        t.name AS companyName,
        t.created_at AS createdAt,
        t.user_limit AS userLimit,
        t.status,
        COALESCE(p.totalPaid, 0) AS totalPaid
      FROM tenants t
      LEFT JOIN (
        SELECT tenant_id, SUM(payment_amount) AS totalPaid
        FROM billing_payments
        WHERE payment_status = 'paid'
        GROUP BY tenant_id
      ) p ON t.id = p.tenant_id
      ORDER BY t.created_at DESC;
    `;

    const rows = await connection.query(query);

    // 格式化資料型態，確保 JSON 回應與前端相容
    const formattedRows = rows.map(row => ({
      ...row,
      id: row.id ? row.id.toString() : null, // 避免 BigInt 轉換 JSON 時發生報錯
      totalPaid: Number(row.totalPaid) || 0
    }));

    res.json(formattedRows);
  } catch (error) {
    console.error('Failed to fetch tenants:', error);
    res.status(500).json({ error: '獲取租戶列表失敗' });
  } finally {
    if (connection) connection.release();
  }
});

export default router;