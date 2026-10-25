// server/aiModelClient.js
// QRTalkie AI Chat Bot — AI Model HTTP Client (ESM)
// Supports OpenAI API compatible endpoints (/v1/chat/completions)

const AI_BOT_ENABLED = String(process.env.AI_BOT_ENABLED || "true").toLowerCase() !== "false";

function normalizeBaseUrl(value) {
    return String(value || "")
        .replace(/\/+$/, "")
        .replace(/\/chat\/completions$/i, "")
        .replace(/\/+$/, "");
}

function parseExtraBody(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

const AI_MODEL_BASE_URL = normalizeBaseUrl(process.env.AI_MODEL_BASE_URL || "https://api.openai.com/v1");
const AI_MODEL_API_KEY = String(process.env.AI_MODEL_API_KEY || "");
const AI_MODEL_NAME = String(process.env.AI_MODEL_NAME || "gpt-4o-mini");
const AI_MODEL_TIMEOUT_MS = Math.max(5000, parseInt(String(process.env.AI_MODEL_TIMEOUT_MS || "30000"), 10) || 30000);
const AI_MODEL_MAX_TOKENS = Math.max(100, parseInt(String(process.env.AI_MODEL_MAX_TOKENS || "2000"), 10) || 2000);
const AI_MODEL_TEMPERATURE = Math.min(2, Math.max(0, parseFloat(String(process.env.AI_MODEL_TEMPERATURE || "0.7")) || 0.7));
const AI_MODEL_EXTRA_BODY = parseExtraBody(process.env.AI_MODEL_EXTRA_BODY || "");

// 在线演示 AI 客服：可单独配置模型，未配置的项回退到主模型
const AI_DEMO_ENABLED = String(process.env.AI_DEMO_ENABLED || "true").toLowerCase() !== "false";
const AI_DEMO_MODEL_BASE_URL = normalizeBaseUrl(process.env.AI_DEMO_MODEL_BASE_URL || "");
const AI_DEMO_MODEL_API_KEY = String(process.env.AI_DEMO_MODEL_API_KEY || "");
const AI_DEMO_MODEL_NAME = String(process.env.AI_DEMO_MODEL_NAME || "");
const AI_DEMO_MODEL_TIMEOUT_MS = Math.max(
    5000,
    parseInt(String(process.env.AI_DEMO_MODEL_TIMEOUT_MS || process.env.AI_MODEL_TIMEOUT_MS || "30000"), 10) || 30000
);
const AI_DEMO_MODEL_MAX_TOKENS = Math.max(
    100,
    parseInt(String(process.env.AI_DEMO_MODEL_MAX_TOKENS || "500"), 10) || 500
);
const AI_DEMO_MODEL_TEMPERATURE = Math.min(
    2,
    Math.max(0, parseFloat(String(process.env.AI_DEMO_MODEL_TEMPERATURE || process.env.AI_MODEL_TEMPERATURE || "0.7")) || 0.7)
);
const AI_DEMO_MODEL_EXTRA_BODY = parseExtraBody(process.env.AI_DEMO_MODEL_EXTRA_BODY || "");
const AI_DEMO_HAS_OVERRIDE = Boolean(AI_DEMO_MODEL_BASE_URL || AI_DEMO_MODEL_NAME);

export function isGloballyEnabled() {
    return AI_BOT_ENABLED;
}

export function currentModelName() {
    return AI_MODEL_NAME;
}

export function isDemoEnabled() {
    return AI_BOT_ENABLED && AI_DEMO_ENABLED;
}

export function demoModelName() {
    return AI_DEMO_MODEL_NAME || AI_MODEL_NAME;
}

function resolveConfig(overrides = {}) {
    return {
        baseUrl: overrides.baseUrl !== undefined ? overrides.baseUrl : AI_MODEL_BASE_URL,
        apiKey: overrides.apiKey !== undefined ? overrides.apiKey : AI_MODEL_API_KEY,
        modelName: overrides.modelName !== undefined ? overrides.modelName : AI_MODEL_NAME,
        timeoutMs: overrides.timeoutMs || AI_MODEL_TIMEOUT_MS,
        maxTokens: overrides.maxTokens || AI_MODEL_MAX_TOKENS,
        temperature: overrides.temperature !== undefined ? overrides.temperature : AI_MODEL_TEMPERATURE,
        extraBody: overrides.extraBody !== undefined ? overrides.extraBody : AI_MODEL_EXTRA_BODY,
    };
}

export function createChatClient(overrides = {}) {
    const config = resolveConfig(overrides);

    /**
     * Call the AI model chat API.
     * @param {Array<{role: string, content: string}>} messages
     * @param {object} options - 可选：{ tools?: Array, toolResults?: Array<{toolCall, resultText}> }
     *   tools: OpenAI function schema（启用 function calling）
     *   toolResults: 前端工具执行结果（组装 assistant tool_calls + tool 角色消息）
     * @returns {Promise<{ok: boolean, content?: string, toolCalls?: Array, tokenCount?: number, error?: string, message?: string}>}
     */
    return async function chat(messages, options = {}) {
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
            model: config.modelName,
            messages: requestMessages,
            max_tokens: options.maxTokens || config.maxTokens,
            temperature: options.temperature !== undefined ? options.temperature : config.temperature,
        };
        const tools = Array.isArray(options.tools) ? options.tools : [];
        if (tools.length > 0) {
            body.tools = tools;
            body.tool_choice = "auto";
        }
        if (config.extraBody) Object.assign(body, config.extraBody);
        const bodyString = JSON.stringify(body);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

        try {
            const headers = { "Content-Type": "application/json" };
            if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: "POST",
                headers,
                body: bodyString,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorBody = await response.text().catch(() => "");
                const keyHint = config.apiKey.length >= 4
                    ? "..." + config.apiKey.slice(-4)
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

            return { ok: true, content, reasoningContent, toolCalls, tokenCount, model: config.modelName };
        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === "AbortError") {
                console.error(`[aiModelClient] AI model request timed out after ${config.timeoutMs}ms`);
                return { ok: false, error: "AI_TIMEOUT", message: "AI 模型響應超時，請稍後重試" };
            }

            console.error(`[aiModelClient] AI model request failed: ${error.message}`);
            return { ok: false, error: "AI_NETWORK_ERROR", message: "AI 模型服務不可用，請稍後重試" };
        }
    };
}

export const chat = createChatClient();

export const chatDemo = createChatClient({
    baseUrl: AI_DEMO_MODEL_BASE_URL || undefined,
    apiKey: AI_DEMO_HAS_OVERRIDE ? AI_DEMO_MODEL_API_KEY : undefined,
    modelName: AI_DEMO_MODEL_NAME || undefined,
    timeoutMs: AI_DEMO_MODEL_TIMEOUT_MS,
    maxTokens: AI_DEMO_MODEL_MAX_TOKENS,
    temperature: AI_DEMO_MODEL_TEMPERATURE,
    extraBody: AI_DEMO_MODEL_EXTRA_BODY || undefined,
});
