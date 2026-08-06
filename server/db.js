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

// Flexisip LIME 密钥数据库连接
export const limePool = mariadb.createPool({
  host: process.env.FLEXISIP_DB_HOST || "127.0.0.1",
  port: Number(process.env.FLEXISIP_DB_PORT || 3306),
  database: process.env.FLEXISIP_DB_DATABASE || "flexisip",
  user: process.env.FLEXISIP_DB_USERNAME || "flexisip",
  password: process.env.FLEXISIP_DB_PASSWORD || "",
  connectionLimit: 5,
  acquireTimeout: 3000,
  idleTimeout: 30000,
});
