// server/aiWebSearchService.js
// AI 助手 v2：通用联网搜索代理服务（独立进程，端口默认 3006）
// 设计：服务商完全由 config/ai-search.json 驱动（模板渲染 + 三种鉴权 + resultsPath 映射），
// 新增任意搜索 API 只需加配置 + .env 配 Key，零代码改动。
// 失败/超时/未配置 → 返回空结果（调用方降级为普通对话），绝不抛出。

import "./loadEnv.js";
import express from "express";

import { loadSearchConfig } from "./aiSearchConfig.js";

const PORT = Number(process.env.AI_SEARCH_PORT || 3006);
const HOST = process.env.AI_SEARCH_HOST || "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESULTS = 10;

// ── 模板渲染（{{query}} / {{count}}，深度遍历对象与字符串）─────────
function renderTemplate(value, context) {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(context[key] ?? ""));
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, context));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderTemplate(v, context);
    return out;
  }
  return value;
}

// ── 鉴权应用（bearerHeader / bodyField / queryParam）─────────────
function applyAuth(provider, requestOptions, body, urlObj) {
  const auth = provider.auth;
  if (!auth) return;
  const key = String(process.env[auth.envKey] || "").trim();
  if (!key) return; // 无 Key → 不带鉴权，请求自然失败并降级
  if (auth.type === "bearerHeader") {
    const prefix = auth.prefix !== undefined ? String(auth.prefix) : "Bearer ";
    requestOptions.headers = {
      ...(requestOptions.headers || {}),
      [auth.header || "Authorization"]: `${prefix}${key}`,
    };
  } else if (auth.type === "bodyField") {
    body[auth.field] = key;
  } else if (auth.type === "queryParam") {
    urlObj.searchParams.set(auth.param, key);
  }
}

// ── 结果映射（resultsPath 点路径 + 字段名映射）───────────────────
function mapResults(provider, data) {
  const resultsPath = String(provider.responseMap?.resultsPath || "results");
  let list = data;
  for (const part of resultsPath.split(".")) {
    if (list === null || list === undefined) break;
    if (Array.isArray(list)) {
      // 数组上取下一段：拍平（多数服务商结果数组在路径末端，此分支为兜底）
      list = list.flatMap((item) => (item && typeof item === "object" ? [item[part]] : []));
    } else {
      list = list[part];
    }
  }
  if (!Array.isArray(list)) return [];

  const map = provider.responseMap || {};
  const titleField = String(map.title || "title");
  const urlField = String(map.url || "url");
  const snippetField = String(map.snippet || "snippet");

  return list
    .filter((item) => item && typeof item === "object")
    .slice(0, MAX_RESULTS)
    .map((item) => ({
      title: String(item[titleField] || ""),
      url: String(item[urlField] || ""),
      snippet: String(item[snippetField] || "").slice(0, 200),
    }))
    .filter((r) => r.title || r.url);
}

// ── 单次搜索 ───────────────────────────────────────────────────
async function doSearch(providerId, query, count) {
  const config = loadSearchConfig();
  const provider = config.providers[providerId];
  if (!provider) return [];

  const urlStr = renderTemplate(String(provider.url || ""), { query, count });
  if (!urlStr.startsWith("http")) return [];

  const method = String(provider.method || "POST").toUpperCase();
  const urlObj = new URL(urlStr);
  const context = { query, count: String(count) };

  let body = {};
  if (provider.body && typeof provider.body === "object") {
    body = renderTemplate(provider.body, context);
  }
  if (provider.query && typeof provider.query === "object") {
    const q = renderTemplate(provider.query, context);
    for (const [k, v] of Object.entries(q)) urlObj.searchParams.set(k, String(v));
  }

  const requestOptions = {
    method,
    headers: {
      ...(provider.headers && typeof provider.headers === "object" ? provider.headers : {}),
      "User-Agent": "QRTalkie-Cloud-AiSearch/1.0",
    },
  };
  if (method !== "GET" && method !== "HEAD") {
    requestOptions.body = JSON.stringify(body);
  }
  applyAuth(provider, requestOptions, body, urlObj);
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    requestOptions.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(urlObj.toString(), {
      ...requestOptions,
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[aiWebSearchService] ${providerId} HTTP ${response.status}`);
      return [];
    }
    const data = await response.json();
    return mapResults(provider, data);
  } catch (error) {
    console.warn(`[aiWebSearchService] ${providerId} failed:`, error?.message || error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ── HTTP 服务 ──────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  const config = loadSearchConfig();
  response.json({ ok: true, active: config.active });
});

app.post("/search", async (request, response) => {
  const query = String(request.body?.query || "").trim().slice(0, 2000);
  const count = Math.min(Math.max(Number(request.body?.count) || 5, 1), 10);
  if (!query) return response.status(400).json({ results: [] });

  const config = loadSearchConfig();
  const providerId = config.active;
  if (providerId === "none" || !providerId) {
    return response.json({ results: [] }); // 未配置 → 空结果降级
  }
  const results = await doSearch(providerId, query, count);
  return response.json({ results });
});

app.listen(PORT, HOST, () => {
  console.log(`[aiWebSearchService] listening on http://${HOST}:${PORT}`);
});
