// server/aiSearchConfig.js
// 联网搜索代理配置加载（aiWebSearchService 与能力接口共用）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export function loadSearchConfig() {
    const filePath = path.join(rootDir, "config", "ai-search.json");
    try {
        if (!fs.existsSync(filePath)) return { active: "none", timeoutMs: 8000, providers: {} };
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return {
            active: String(raw.active || "none"),
            timeoutMs: Number(raw.timeoutMs) > 0 ? Number(raw.timeoutMs) : 8000,
            providers: raw.providers && typeof raw.providers === "object" ? raw.providers : {},
        };
    } catch (error) {
        console.error("[aiSearchConfig] config load failed:", error?.message || error);
        return { active: "none", timeoutMs: 8000, providers: {} };
    }
}

export function loadToolsConfig() {
    const filePath = path.join(rootDir, "config", "ai-tools.json");
    try {
        if (!fs.existsSync(filePath)) return { enabled: [] };
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return {
            enabled: Array.isArray(raw.enabled) ? raw.enabled.map(String) : [],
            tools: raw.tools && typeof raw.tools === "object" ? raw.tools : {},
        };
    } catch (error) {
        console.error("[aiSearchConfig] tools config load failed:", error?.message || error);
        return { enabled: [] };
    }
}
