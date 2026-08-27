// server/aiTools.js
// AI 助手 v2：工具注册表与执行器
// 定义（OpenAI function schema）与执行解耦；可用性由能力探测（配置+服务就绪）决定。

import { getAiCapabilities } from "./aiCapabilitiesService.js";

const SEARCH_SERVICE_URL = process.env.AI_SEARCH_SERVICE_URL || "http://127.0.0.1:3006";
const TOOL_TIMEOUT_MS = 5000;

// 全部工具定义（是否启用由 getEnabledToolDefinitions 按能力过滤）
export const TOOL_DEFINITIONS = [
    {
        type: "function",
        function: {
            name: "web_search",
            description: "聯網搜索最新資訊，適用於需要時效性、事實核查或最新動態的問題",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "搜索關鍵字" },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "rag_search",
            description: "在用戶知識庫中檢索相關內容",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "檢索問題" },
                    knowledgeBaseId: { type: "integer", description: "知識庫 ID（可選）" },
                },
                required: ["query"],
            },
        },
    },
];

// 启用中的工具定义（能力过滤后）
export async function getEnabledToolDefinitions() {
    const caps = await getAiCapabilities();
    const enabledSet = new Set(caps.tools.filter((t) => t.enabled).map((t) => t.name));
    return TOOL_DEFINITIONS.filter((t) => enabledSet.has(t.function.name));
}

// 工具执行：返回 { results: [...] }；失败返回 { error }
export async function executeTool(name, args) {
    if (name === "web_search") {
        const query = String(args?.query || "").trim().slice(0, 2000);
        if (!query) return { error: "缺少搜索關鍵字" };
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
            const response = await fetch(`${SEARCH_SERVICE_URL}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, count: 5 }),
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!response.ok) return { error: "搜索服務不可用" };
            const data = await response.json();
            return { results: Array.isArray(data?.results) ? data.results : [] };
        } catch (error) {
            console.warn("[aiTools] web_search failed:", error?.message || error);
            return { error: "搜索執行失敗" };
        }
    }
    if (name === "rag_search") {
        return { error: "知識庫檢索尚未開通" };
    }
    return { error: "未知工具" };
}
