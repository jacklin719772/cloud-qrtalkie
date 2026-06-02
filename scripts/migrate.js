import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import * as mariadb from "mariadb";

const migrationsDir = path.resolve("migrations");

const pool = mariadb.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true",
  connectionLimit: 1,
  multipleStatements: true,
});

let connection;

try {
  connection = await pool.getConnection();

  // 1. 创建用于记录已执行迁移的表（如果不存在的话）
  await connection.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. 获取已经成功执行过的迁移文件列表
  const appliedRows = await connection.query("SELECT name FROM _migrations");
  const appliedMigrations = new Set(appliedRows.map((row) => row.name));

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedMigrations.has(file)) {
      console.log(`Skipped (already applied): ${file}`);
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    
    if (sql.trim().length === 0) {
      console.log(`Skipped (empty file): ${file}`);
    } else {
      await connection.query(sql);
      await connection.query("INSERT INTO _migrations (name) VALUES (?)", [file]);
      console.log(`Applied migration: ${file}`);
    }
  }
  console.log("All migrations are up to date.");
} finally {
  if (connection) connection.release();
  await pool.end();
}
