import "dotenv/config";
import mqtt from "mqtt";
import mariadb from "mariadb";

// 设备状态缓存与 MQTT 订阅服务
// 方案 A：SaaS 常驻 MQTT 客户端，订阅所有门禁设备的 subscriptionSubject，
// 缓存设备上报的 retained/心跳状态，供 device-status 接口即时查询。
// 设备协议约定：设备向 subscriptionSubject 发布 retained
// {"type":"status","online":true|false}（LWT 发布离线消息）。

const MQTT_HOST = process.env.MQTT_HOST || "127.0.0.1";
const MQTT_PORT = Number(process.env.MQTT_PORT || 1883);

const TOPIC_REFRESH_INTERVAL_MS = 60 * 1000; // 每 60 秒同步一次订阅集合

const pool = mariadb.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true",
  connectionLimit: 2,
});

// lockId(device_uuid) -> { online: boolean, updatedAt: Date }
const statusCache = new Map();

let client = null;
let subscribedTopics = new Set();
let refreshTimer = null;

function start() {
  console.log(`[deviceMqtt] Connecting to MQTT broker ${MQTT_HOST}:${MQTT_PORT}`);
  client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
    clientId: `qrtalkie-saas-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on("connect", async () => {
    console.log("[deviceMqtt] Connected");
    await refreshSubscriptions();
  });

  client.on("message", (topic, payload) => {
    handleDeviceMessage(topic, payload.toString("utf-8"));
  });

  client.on("error", (err) => {
    console.error("[deviceMqtt] Error:", err?.message || err);
  });

  client.on("reconnect", () => {
    console.log("[deviceMqtt] Reconnecting...");
  });

  // 定时同步订阅集合（设备增删后自动跟随）
  refreshTimer = setInterval(() => {
    if (client?.connected) refreshSubscriptions().catch((e) => console.error("[deviceMqtt] Refresh failed:", e?.message));
  }, TOPIC_REFRESH_INTERVAL_MS);
}

async function refreshSubscriptions() {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT device_uuid, subscribe_topic
       FROM gate_devices
       WHERE subscribe_topic IS NOT NULL AND subscribe_topic <> ''`
    );
    const topicToLock = new Map();
    for (const row of rows) {
      topicToLock.set(row.subscribe_topic, row.device_uuid);
    }
    // 新增主题订阅
    for (const topic of topicToLock.keys()) {
      if (!subscribedTopics.has(topic)) {
        client.subscribe(topic, { qos: 0 });
        subscribedTopics.add(topic);
        console.log(`[deviceMqtt] Subscribed: ${topic}`);
      }
    }
    // 移除不再需要的主题
    for (const topic of subscribedTopics) {
      if (!topicToLock.has(topic)) {
        client.unsubscribe(topic);
        console.log(`[deviceMqtt] Unsubscribed: ${topic}`);
      }
    }
    subscribedTopics = new Set(topicToLock.keys());
  } catch (error) {
    console.error("[deviceMqtt] Subscription refresh error:", error?.message || error);
  } finally {
    if (connection) connection.release();
  }
}

async function handleDeviceMessage(topic, text) {
  try {
    const message = JSON.parse(text);
    if (message && message.type === "status") {
      const lock = await findLockByTopic(topic);
      if (!lock) return;
      const online = message.online === true;
      statusCache.set(lock, { online, updatedAt: new Date() });
      console.log(`[deviceMqtt] Status: lock=${lock} online=${online}`);
    }
  } catch {
    // 非 JSON 或非状态消息，忽略
  }
}

let lockByTopicCache = null;
let lockByTopicCacheTime = 0;

async function findLockByTopic(topic) {
  const now = Date.now();
  if (!lockByTopicCache || now - lockByTopicCacheTime > 60000) {
    lockByTopicCache = new Map();
    let connection;
    try {
      connection = await pool.getConnection();
      const rows = await connection.query(
        `SELECT device_uuid, subscribe_topic FROM gate_devices WHERE subscribe_topic IS NOT NULL AND subscribe_topic <> ''`
      );
      for (const row of rows) lockByTopicCache.set(row.subscribe_topic, row.device_uuid);
    } catch (error) {
      console.error("[deviceMqtt] Topic lookup error:", error?.message || error);
    } finally {
      if (connection) connection.release();
    }
    lockByTopicCacheTime = now;
  }
  return lockByTopicCache.get(topic) || null;
}

// lockId(device_uuid) -> { online: true|false|null, updatedAt: ISO string|null }
function getStatus(lockId) {
  const entry = statusCache.get(lockId);
  if (!entry) return { lockId, online: null, updatedAt: null };
  return { lockId, online: entry.online, updatedAt: entry.updatedAt.toISOString() };
}

function isLockKnown(lockId) {
  return statusCache.has(lockId);
}

export default { start, getStatus, isLockKnown };
