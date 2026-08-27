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

export function currentModelName() {
    return AI_MODEL_NAME;
}

/**
 * Call the AI model chat API.
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} options - 可选：{ tools?: Array, toolResults?: Array<{toolCall, resultText}> }
 *   tools: OpenAI function schema（启用 function calling）
 *   toolResults: 前端工具执行结果（组装 assistant tool_calls + tool 角色消息）
 * @returns {Promise<{ok: boolean, content?: string, toolCalls?: Array, tokenCount?: number, error?: string, message?: string}>}
 */
export async function chat(messages, options = {}) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return { ok: false, error: "AI_INVALID_INPUT", message: "訊息列表不能為空" };
    }

    // 工具结果回填：按 OpenAI 循环格式组装消息（additive：无则跳过）
    const requestMessages = [...messages];
    const toolResults = Array.isArray(options.toolResults) ? options.toolResults : [];
    toolResults.forEach((tr, i) => {
        const tc = tr?.toolCall;
        if (!tc) return;
        const callId = String(tc.id || `call_${i}`);
        requestMessages.push({
            role: "assistant",
            content: null,
            tool_calls: [{
                id: callId,
                type: "function",
                function: { name: String(tc.name || ""), arguments: String(tc.arguments || "{}") },
            }],
        });
        requestMessages.push({
            role: "tool",
            tool_call_id: callId,
            content: String(tr.resultText || ""),
        });
    });

    const body = {
        model: AI_MODEL_NAME,
        messages: requestMessages,
        max_tokens: options.maxTokens || AI_MODEL_MAX_TOKENS,
        temperature: options.temperature !== undefined ? options.temperature : AI_MODEL_TEMPERATURE,
    };
    const tools = Array.isArray(options.tools) ? options.tools : [];
    if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = "auto";
    }
    const bodyString = JSON.stringify(body);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_MODEL_TIMEOUT_MS);

    try {
        const response = await fetch(`${AI_MODEL_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${AI_MODEL_API_KEY}`,
            },
            body: bodyString,
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
            return { ok: false, error: "AI_MODEL_ERROR", message: `AI 模型返回錯誤 (HTTP ${response.status})` };
        }

        const data = await response.json();

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error("[aiModelClient] Unexpected AI response format:", JSON.stringify(data).slice(0, 300));
            return { ok: false, error: "AI_MODEL_ERROR", message: "AI 模型返回格式異常" };
        }

        const message = data.choices[0].message;
        const content = String(message.content || "").trim();
        const reasoningContent = String(message.reasoning_content || "").trim();
        const toolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0
            ? message.tool_calls.map((tc) => ({
                id: String(tc.id || ""),
                name: String(tc.function?.name || ""),
                arguments: String(tc.function?.arguments || "{}"),
            }))
            : [];
        const tokenCount = data.usage?.total_tokens || 0;

        return { ok: true, content, reasoningContent, toolCalls, tokenCount, model: AI_MODEL_NAME };
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === "AbortError") {
            console.error(`[aiModelClient] AI model request timed out after ${AI_MODEL_TIMEOUT_MS}ms`);
            return { ok: false, error: "AI_TIMEOUT", message: "AI 模型響應超時，請稍後重試" };
        }

        console.error(`[aiModelClient] AI model request failed: ${error.message}`);
        return { ok: false, error: "AI_NETWORK_ERROR", message: "AI 模型服務不可用，請稍後重試" };
    }
}
