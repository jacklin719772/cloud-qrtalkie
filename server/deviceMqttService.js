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
      return;
    }
    if (message && message.Replytype !== undefined) {
      // 开锁响应：任意消息也视为设备在线；路由到待决开锁请求
      const locks = await findLocksByTopic(topic);
      for (const lock of locks) {
        statusCache.set(lock, { online: true, updatedAt: new Date() });
      }
      const ok = String(message.status || "").toUpperCase() === "OK";
      resolvePendingUnlock(topic, ok, String(message.status || ""));
      console.log(`[deviceMqtt] Unlock response: topic=${topic} status=${message.status}`);
      return;
    }
  } catch {
    // 非 JSON 或非状态消息，忽略
  }
}

let lockByTopicCache = null;
let lockByTopicCacheTime = 0;

async function loadLockTopicCache() {
  const now = Date.now();
  if (lockByTopicCache && now - lockByTopicCacheTime <= 60000) return;
  const newCache = new Map();
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT device_uuid, subscribe_topic FROM gate_devices WHERE subscribe_topic IS NOT NULL AND subscribe_topic <> ''`
    );
    for (const row of rows) {
      if (!newCache.has(row.subscribe_topic)) newCache.set(row.subscribe_topic, []);
      newCache.get(row.subscribe_topic).push(row.device_uuid);
    }
    lockByTopicCache = newCache;
    lockByTopicCacheTime = now;
  } catch (error) {
    console.error("[deviceMqtt] Topic lookup error:", error?.message || error);
  } finally {
    if (connection) connection.release();
  }
}

async function findLockByTopic(topic) {
  await loadLockTopicCache();
  const locks = lockByTopicCache.get(topic);
  return locks && locks.length ? locks[0] : null;
}

async function findLocksByTopic(topic) {
  await loadLockTopicCache();
  return lockByTopicCache.get(topic) || [];
}

// ---- 开锁指令（方案 B 中转） ----

// lockId -> { resolve, topic, timer }
const pendingUnlocks = new Map();
const UNLOCK_TIMEOUT_MS = 10000;

function resolvePendingUnlock(topic, ok, status) {
  for (const [lockId, pending] of pendingUnlocks) {
    if (pending.topic !== topic) continue;
    clearTimeout(pending.timer);
    pendingUnlocks.delete(lockId);
    pending.resolve({ ok, status });
    return; // 一次只解决最早的待决请求
  }
}

// 返回 { ok: bool, reason: 'ok'|'timeout'|'not_found'|'mqtt_disconnected', status?: string }
async function unlockDevice(lockId) {
  let connection;
  try {
    connection = await pool.getConnection();
    const rows = await connection.query(
      `SELECT device_uuid, relay_id, publish_topic, subscribe_topic
       FROM gate_devices
       WHERE device_uuid = ? AND assignment_status = 'assigned' LIMIT 1`,
      [lockId]
    );
    const device = rows[0];
    if (!device) return { ok: false, reason: "not_found" };
    if (!device.relay_id || !device.publish_topic) return { ok: false, reason: "not_configured" };
    if (!client?.connected) return { ok: false, reason: "mqtt_disconnected" };

    console.log(`[deviceMqtt] Unlock publish: topic=${device.relay_id} payload=${device.publish_topic}`);
    client.publish(device.relay_id, device.publish_topic, { qos: 0 });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingUnlocks.delete(lockId);
        console.log(`[deviceMqtt] Unlock timeout: lockId=${lockId}`);
        resolve({ ok: false, reason: "timeout" });
      }, UNLOCK_TIMEOUT_MS);
      pendingUnlocks.set(lockId, { resolve, topic: device.subscribe_topic, timer });
    });
  } catch (error) {
    console.error("[deviceMqtt] Unlock error:", error?.message || error);
    return { ok: false, reason: "error" };
  } finally {
    if (connection) connection.release();
  }
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

export default { start, getStatus, isLockKnown, unlockDevice };
