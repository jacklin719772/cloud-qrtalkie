import net from "node:net";

const DEFAULT_TIMEOUT_MS = 5000;

export class RedisReadOnlyError extends Error {
  constructor(message, { command = "", cause = null } = {}) {
    super(message);
    this.name = "RedisReadOnlyError";
    this.command = command;
    if (cause) this.cause = cause;
  }
}

function getConfig() {
  return {
    host: String(process.env.FLEXISIP_REGISTRAR_REDIS_HOST || "127.0.0.1"),
    port: Number(process.env.FLEXISIP_REGISTRAR_REDIS_PORT || 6379),
    db: Number(process.env.FLEXISIP_REGISTRAR_REDIS_DB || 0),
    username: String(process.env.FLEXISIP_REGISTRAR_REDIS_USERNAME || ""),
    password: String(process.env.FLEXISIP_REGISTRAR_REDIS_PASSWORD || ""),
    timeoutMs: Number(process.env.FLEXISIP_REGISTRAR_REDIS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  };
}

function encodeCommand(parts) {
  const chunks = [`*${parts.length}\r\n`];
  for (const part of parts) {
    const value = Buffer.from(String(part), "utf8");
    chunks.push(`$${value.length}\r\n`, value, "\r\n");
  }
  return Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))));
}

function findCrlf(buffer, offset) {
  return buffer.indexOf("\r\n", offset, "utf8");
}

function parseResp(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = findCrlf(buffer, offset + 1);
  if (lineEnd === -1) return null;
  const line = buffer.slice(offset + 1, lineEnd).toString("utf8");
  const next = lineEnd + 2;

  if (prefix === "+") return { value: line, offset: next };
  if (prefix === ":") return { value: Number.parseInt(line, 10), offset: next };
  if (prefix === "-") {
    const error = new RedisReadOnlyError("Redis returned an error.", { command: "RESP" });
    error.redisMessage = line;
    throw error;
  }
  if (prefix === "$") {
    const length = Number.parseInt(line, 10);
    if (length === -1) return { value: null, offset: next };
    const end = next + length;
    if (buffer.length < end + 2) return null;
    return {
      value: buffer.slice(next, end).toString("utf8"),
      offset: end + 2,
    };
  }
  if (prefix === "*") {
    const count = Number.parseInt(line, 10);
    if (count === -1) return { value: null, offset: next };
    const values = [];
    let currentOffset = next;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseResp(buffer, currentOffset);
      if (!parsed) return null;
      values.push(parsed.value);
      currentOffset = parsed.offset;
    }
    return { value: values, offset: currentOffset };
  }

  throw new RedisReadOnlyError("Unsupported Redis response.", { command: "RESP" });
}

function hgetallArrayToEntries(value) {
  const entries = [];
  const list = Array.isArray(value) ? value : [];
  for (let index = 0; index < list.length; index += 2) {
    entries.push({
      field: String(list[index] || ""),
      value: String(list[index + 1] || ""),
    });
  }
  return entries;
}

async function runPipeline(commands) {
  const config = getConfig();
  const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const setupCommands = [];
  if (config.password) {
    setupCommands.push(config.username ? ["AUTH", config.username, config.password] : ["AUTH", config.password]);
  }
  if (Number.isFinite(config.db) && config.db > 0) setupCommands.push(["SELECT", config.db]);
  const allCommands = [...setupCommands, ...commands];

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const replies = [];

    function fail(error) {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error instanceof RedisReadOnlyError ? error : new RedisReadOnlyError("Redis pipeline failed.", { cause: error }));
    }

    const timer = setTimeout(() => fail(new RedisReadOnlyError("Redis read-only pipeline timed out.", { command: "PIPELINE" })), timeoutMs);

    socket.on("connect", () => {
      socket.write(Buffer.concat(allCommands.map(encodeCommand)));
    });

    socket.on("data", (chunk) => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        let offset = 0;
        while (replies.length < allCommands.length) {
          const parsed = parseResp(buffer, offset);
          if (!parsed) break;
          replies.push(parsed.value);
          offset = parsed.offset;
        }
        if (offset > 0) buffer = buffer.slice(offset);
        if (replies.length === allCommands.length) {
          settled = true;
          clearTimeout(timer);
          socket.end();
          resolve(replies.slice(setupCommands.length));
        }
      } catch (error) {
        clearTimeout(timer);
        fail(error);
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });

    socket.on("end", () => {
      if (!settled) {
        clearTimeout(timer);
        fail(new RedisReadOnlyError("Redis connection closed before all replies were read.", { command: "PIPELINE" }));
      }
    });
  });
}

export async function readRegistrarKeys(keys) {
  const safeKeys = Array.from(new Set(keys.map((key) => String(key || "")).filter(Boolean)));
  const commands = [];
  for (const key of safeKeys) {
    commands.push(["TYPE", key], ["TTL", key], ["HGETALL", key]);
  }

  let replies;
  try {
    replies = await runPipeline(commands);
  } catch (error) {
    throw new RedisReadOnlyError("Redis read-only pipeline failed.", { command: "PIPELINE", cause: error });
  }

  const results = new Map();
  for (let index = 0; index < safeKeys.length; index += 1) {
    const replyOffset = index * 3;
    results.set(safeKeys[index], {
      key: safeKeys[index],
      type: String(replies[replyOffset] || ""),
      ttl: Number(replies[replyOffset + 1]),
      entries: hgetallArrayToEntries(replies[replyOffset + 2]),
    });
  }
  return results;
}
