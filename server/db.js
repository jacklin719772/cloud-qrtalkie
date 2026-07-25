import "dotenv/config";
import * as mariadb from "mariadb";

export const pool = mariadb.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true",
  connectionLimit: 100,
  acquireTimeout: 5000,
  idleTimeout: 30000,
  minimumIdle: 2,
});
