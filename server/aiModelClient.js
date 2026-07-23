// server/aiModelClient.js
// QRTalkie AI Chat Bot — AI Model HTTP Client (ESM)
// Supports OpenAI API compatible endpoints (/v1/chat/completions)

const AI_BOT_ENABLED = String(process.env.AI_BOT_ENABLED || "true").toLowerCase() !== "false";
const AI_MODEL_BASE_URL = String(process.env.AI_MODEL_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const AI_MODEL_API_KEY = String(process.env.AI_MODEL_API_KEY || "");
const AI_MODEL_NAME = String(process.env.AI_MODEL_NAME || "gpt-4o-mini");
const AI_MODEL_TIMEOUT_MS = Math.max(5000, parseInt(String(process.env.AI_MODEL_TIMEOUT_MS || "30000"), 10) || 30000);
const AI_MODEL_MAX_TOKENS = Math.max(100, parseInt(String(process.env.AI_MODEL_MAX_TOKENS || "2000"), 10) || 2000);
const AI_MODEL_TEMPERATURE = Math.min(2, Math.max(0, parseFloat(String(process.env.AI_MODEL_TEMPERATURE || "0.7")) || 0.7));

export function isGloballyEnabled() {
    return AI_BOT_ENABLED;
}

/**
 * Call the AI model chat API.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<{ok: boolean, content?: string, tokenCount?: number, error?: string, message?: string}>}
 */
export async function chat(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return { ok: false, error: "AI_INVALID_INPUT", message: "消息列表不能为空" };
    }

    const body = JSON.stringify({
        model: AI_MODEL_NAME,
        messages: messages,
        max_tokens: AI_MODEL_MAX_TOKENS,
        temperature: AI_MODEL_TEMPERATURE,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_MODEL_TIMEOUT_MS);

    try {
        const response = await fetch(`${AI_MODEL_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${AI_MODEL_API_KEY}`,
            },
            body: body,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            const keyHint = AI_MODEL_API_KEY.length >= 4
                ? "..." + AI_MODEL_API_KEY.slice(-4)
                : "(not set)";
            console.error(
                `[aiModelClient] AI model returned HTTP ${response.status}: ` +
                `${errorBody.slice(0, 200)} (key=${keyHint})`
            );
            return { ok: false, error: "AI_MODEL_ERROR", message: `AI 模型返回错误 (HTTP ${response.status})` };
        }

        const data = await response.json();

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error("[aiModelClient] Unexpected AI response format:", JSON.stringify(data).slice(0, 300));
            return { ok: false, error: "AI_MODEL_ERROR", message: "AI 模型返回格式异常" };
        }

        const content = String(data.choices[0].message.content || "").trim();
        const tokenCount = data.usage?.total_tokens || 0;

        return { ok: true, content, tokenCount };
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === "AbortError") {
            console.error(`[aiModelClient] AI model request timed out after ${AI_MODEL_TIMEOUT_MS}ms`);
            return { ok: false, error: "AI_TIMEOUT", message: "AI 模型响应超时，请稍后重试" };
        }

        console.error(`[aiModelClient] AI model request failed: ${error.message}`);
        return { ok: false, error: "AI_NETWORK_ERROR", message: "AI 模型服务不可用，请稍后重试" };
    }
}
