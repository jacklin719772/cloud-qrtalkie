import "dotenv/config";
import * as mariadb from "mariadb";

export const pool = mariadb.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true",
  // 100 会在「建号流程 + 控制台轮询 + 客户端请求风暴」叠加时打满（2026-10-12 实测
  // pool timeout ×38：所有 API 500「身份驗證失敗」，App 显示成 "AI service …"）；
  // MySQL max_connections=500 有余量，池上限提到 200、获取超时放宽到 15s 吸收尖峰
  connectionLimit: 200,
  acquireTimeout: 15000,
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
