// server/aiCapabilitiesService.js
// AI 助手 v2：服务端能力探测（供前端决定工具/RAG 等功能的可用性）
// 依据：搜索配置（config/ai-search.json）、工具配置（config/ai-tools.json）、
//       RAG 服务就绪状态（AI_EMBED_SERVICE_URL 环境变量 + 健康探测，30s 缓存）

import { loadSearchConfig, loadToolsConfig } from "./aiSearchConfig.js";

let ragCache = { checkedAt: 0, ready: false };

// RAG 就绪探测：未配置嵌入服务地址 → 不支持；已配置 → 探测 /health（1s 超时，30s 缓存）
async function checkRagReady() {
    const embedUrl = String(process.env.AI_EMBED_SERVICE_URL || "").trim();
    if (!embedUrl) {
        ragCache = { checkedAt: 0, ready: false };
        return false;
    }
    const now = Date.now();
    if (now - ragCache.checkedAt < 30000) return ragCache.ready;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1000);
        const response = await fetch(`${embedUrl}/health`, { signal: controller.signal });
        clearTimeout(timer);
        const ok = response.ok;
        ragCache = { checkedAt: now, ready: ok };
        return ok;
    } catch {
        ragCache = { checkedAt: now, ready: false };
        return false;
    }
}

// 组装能力清单
export async function getAiCapabilities() {
    const searchConfig = loadSearchConfig();
    const toolsConfig = loadToolsConfig();
    const ragReady = await checkRagReady();

    const webSearchEnabled = searchConfig.active !== "none" &&
        searchConfig.providers[searchConfig.active] !== undefined;

    const tools = [
        {
            name: "web_search",
            supported: true,
            enabled: webSearchEnabled && toolsConfig.enabled.includes("web_search"),
        },
        {
            name: "rag_search",
            supported: ragReady,
            enabled: ragReady && toolsConfig.enabled.includes("rag_search"),
        },
    ];

    return {
        webSearch: { supported: true, enabled: webSearchEnabled },
        knowledgeBase: { supported: true, enabled: true }, // CRUD 已实现；检索依赖 rag
        rag: { supported: ragReady, enabled: ragReady },
        tools,
    };
}
