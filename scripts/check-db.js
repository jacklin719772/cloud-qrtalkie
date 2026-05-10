import "dotenv/config";
import * as mariadb from "mariadb";

const pool = mariadb.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true",
  connectionLimit: 1,
});

let connection;

try {
  connection = await pool.getConnection();
  const rows = await connection.query("SELECT VERSION() AS version");
  console.log(`MariaDB connected: ${rows[0].version}`);
} finally {
  if (connection) connection.release();
  await pool.end();
}
