import express from 'express';
import { pool } from '../db.js'; // 确保这里的路径指向你实际的 db 实例

const router = express.Router();

// GET /api/contact-books - 获取租户通讯录列表
router.get('/', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    
    // 假设你有鉴权中间件解析了 user，这里获取 tenantId
    // 如果是通过 query 传入也可以使用 req.query.tenantId
    const tenantId = req.user?.tenantId || req.query.tenantId;

    let query = `
      SELECT 
        cb.id,
        cb.name,
        cb.description,
        cb.created_at AS createdAt,
        a.display_name AS createdBy,
        (SELECT COUNT(*) FROM tenant_contact_book_entries WHERE contact_book_id = cb.id) AS entryCount
      FROM tenant_contact_books cb
      LEFT JOIN admin_users a ON cb.created_by_admin_id = a.id
    `;
    const params = [];

    if (tenantId) {
      query += ` WHERE cb.tenant_id = ?`;
      params.push(tenantId);
    }
    
    query += ` ORDER BY cb.created_at DESC;`;

    const rows = await connection.query(query, params);

    const formattedRows = rows.map(row => ({
      ...row,
      id: row.id ? row.id.toString() : null,
      entryCount: Number(row.entryCount) || 0
    }));

    res.json({ contactBooks: formattedRows });
  } catch (error) {
    console.error('Failed to fetch contact books:', error);
    res.status(500).json({ message: '获取通讯录列表失败' });
  } finally {
    if (connection) connection.release();
  }
});

export default router;