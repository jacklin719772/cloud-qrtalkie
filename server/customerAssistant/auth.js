/**
 * Customer Assistant（ECard 访客聊天）——客服侧鉴权适配。
 *
 * 命名约定见 docs/customer-assistant/10_ECARD_VISITOR_CHAT_SOLUTION.md §12.1：
 *   · 平台中间件 requireSipUser（server/index.js:853-887）挂载 request.admin.id；
 *     该命名是历史遗留，语义就是 sip_users.id（index.js:874）；
 *   · 本文件是**全项目唯一允许出现 request.admin 的地方**；
 *   · CA 代码只使用 request.caAgent.sipUserId（REST）与 ticket.sipUserId（WS）。
 *
 * 类型口径：mariadb 驱动默认把 BIGINT 返回为 bigint 原始值（实测 typeof = "bigint"，
 * NULL 为 object），因此这里统一规范化为 Number，与 index.js:11500 的既有做法一致。
 * 服务层比较身份时请用 isSameSipUserId()，不要直接用 ===（避免 bigint/Number 混比）。
 */

const ACCESS_DENIED = { message: "Access denied." };

/**
 * 生成 CA 客服侧中间件链：[requireSipUser, attachCaAgent]
 * 用法：router.get("/api/customer-assistant/...", ...requireCaAgent, handler)
 */
export function createRequireCaAgent(requireSipUser) {
  if (typeof requireSipUser !== "function") {
    throw new Error("[customerAssistant] createRequireCaAgent 需要平台既有的 requireSipUser 中间件");
  }

  // 唯一映射点：request.admin.id（= sip_users.id）→ request.caAgent.sipUserId
  const attachCaAgent = (request, response, next) => {
    const sipUserId = Number(request.admin?.id);
    // 管理员 token（user_type="admin"）可能没有 sip_user_id：Number(null) = 0 → 拒绝，
    // 避免后续以"无主"身份通过归属校验
    if (!Number.isSafeInteger(sipUserId) || sipUserId <= 0) {
      return response.status(403).json(ACCESS_DENIED);
    }
    request.caAgent = { sipUserId };
    return next();
  };

  return [requireSipUser, attachCaAgent];
}

/** 取当前请求的客服身份；未经 requireCaAgent 时返回 null */
export function getCaAgentSipUserId(request) {
  const sipUserId = request?.caAgent?.sipUserId;
  return Number.isSafeInteger(sipUserId) && sipUserId > 0 ? sipUserId : null;
}

/**
 * 身份比较统一入口：兼容数据库返回的 bigint / Number / 数字字符串。
 * 归属校验一律写成：isSameSipUserId(row.sip_user_id, caAgent.sipUserId)
 */
export function isSameSipUserId(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isSafeInteger(a) && Number.isSafeInteger(b) && a > 0 && a === b;
}
