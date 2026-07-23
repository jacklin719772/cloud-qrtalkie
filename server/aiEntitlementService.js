// server/aiEntitlementService.js
// QRTalkie AI Chat Bot — Account-level entitlement checks & usage tracking (ESM)

import { isGloballyEnabled } from "./aiModelClient.js";

export class AiError extends Error {
    constructor(error, statusCode, message) {
        super(message);
        this.error = error;
        this.statusCode = statusCode;
        this.message = message;
    }
    toJSON() {
        return { ok: false, error: this.error, message: this.message };
    }
}

/**
 * Ensure the SIP user is allowed to use AI. Throws AiError on failure.
 */
export async function ensureAiAllowed(sipUserId, connection) {
    if (!isGloballyEnabled()) {
        throw new AiError("AI_BOT_DISABLED", 503, "AI 助手暂不可用");
    }

    const rows = await connection.query(
        `SELECT * FROM ai_bot_account_entitlements WHERE sip_user_id = ? LIMIT 1`,
        [sipUserId]
    );
    const ent = rows[0];

    if (!ent) {
        throw new AiError("AI_NOT_ENABLED_FOR_ACCOUNT", 403, "您的账号暂未开通 AI 助手服务");
    }
    if (!ent.enabled) {
        throw new AiError("AI_NOT_ENABLED_FOR_ACCOUNT", 403, "您的账号暂未开通 AI 助手服务");
    }
    if (ent.expires_at && new Date(ent.expires_at) < new Date()) {
        throw new AiError("AI_ACCOUNT_ENTITLEMENT_EXPIRED", 403, "您的 AI 助手服务已过期");
    }

    // Lazy daily reset
    const today = new Date().toISOString().slice(0, 10);
    const entDate = ent.last_usage_reset_date
        ? new Date(ent.last_usage_reset_date).toISOString().slice(0, 10)
        : null;
    if (entDate !== today) {
        await connection.query(
            `UPDATE ai_bot_account_entitlements SET used_today = 0, last_usage_reset_date = ? WHERE sip_user_id = ?`,
            [today, sipUserId]
        );
        ent.used_today = 0;
    }

    // Lazy monthly reset
    const thisMonth = today.slice(0, 7);
    if (ent.last_monthly_reset !== thisMonth) {
        await connection.query(
            `UPDATE ai_bot_account_entitlements SET used_this_month = 0, last_monthly_reset = ? WHERE sip_user_id = ?`,
            [thisMonth, sipUserId]
        );
        ent.used_this_month = 0;
    }

    if (ent.used_today >= ent.daily_limit) {
        throw new AiError("AI_DAILY_LIMIT_EXCEEDED", 429, `今日 AI 使用次数已达上限 (${ent.daily_limit} 次)`);
    }
    if (ent.monthly_limit != null && ent.used_this_month >= ent.monthly_limit) {
        throw new AiError("AI_MONTHLY_LIMIT_EXCEEDED", 429, `本月 AI 使用次数已达上限 (${ent.monthly_limit} 次)`);
    }
}

/**
 * Increment usage counters after a successful AI call.
 */
export async function incrementUsage(sipUserId, connection) {
    await connection.query(
        `UPDATE ai_bot_account_entitlements
         SET used_today = used_today + 1, used_this_month = used_this_month + 1
         WHERE sip_user_id = ?`,
        [sipUserId]
    );
}
