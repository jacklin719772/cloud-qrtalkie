// server/aiInjectionService.js
// AI 助手 v2（只增不改）：检索/搜索注入
// 搜索已接通（C3 通用搜索代理）；知识库检索待 C 阶段嵌入服务就位后接通。

const SEARCH_SERVICE_URL = process.env.AI_SEARCH_SERVICE_URL || "http://127.0.0.1:3006";
const SEARCH_TIMEOUT_MS = 5000;

// 知识库检索注入：返回拼好的上下文文本；未就绪/无关/失败 → null
export async function buildKbInjection(kbId, query, connection) {
    // TODO 阶段 C：调嵌入服务 + 检索 ai_kb_chunks（余弦 top-K，阈值 0.5）
    return null;
}

// 联网搜索注入：调搜索代理服务 → 拼上下文；失败/超时/空结果 → null（自动降级）
export async function buildWebSearchInjection(query, connection) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(`${SEARCH_SERVICE_URL}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, count: 5 }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) return null;

        const data = await response.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        if (results.length === 0) return null;

        const refs = results.map((r) =>
            `- ${String(r.title || "")}\n  ${String(r.snippet || "")}\n  ${String(r.url || "")}`
        );
        return `[網路搜索結果]\n${refs.join("\n")}`;
    } catch (error) {
        console.warn("[aiInjectionService] web search injection failed, degraded:", error?.message || error);
        return null;
    }
}
