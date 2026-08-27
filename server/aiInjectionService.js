// server/aiInjectionService.js
// AI 助手 v2（只增不改）：检索/搜索注入框架
// 阶段 C 的解析/嵌入/搜索服务就位前，两个函数均返回 null（降级为普通对话）。

// 知识库检索注入：返回拼好的上下文文本；未就绪/无关/失败 → null
export async function buildKbInjection(kbId, query, connection) {
    // TODO 阶段 C：调嵌入服务 + 检索 ai_kb_chunks（余弦 top-K，阈值 0.5）
    return null;
}

// 联网搜索注入：返回拼好的上下文文本；未配置/失败 → null
export async function buildWebSearchInjection(query, connection) {
    // TODO 阶段 C：调搜索代理服务（SaaS 统一 Key）
    return null;
}
