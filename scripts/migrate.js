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
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await connection.query(sql);
    console.log(`Applied migration: ${file}`);
  }
} finally {
  if (connection) connection.release();
  await pool.end();
}
