/**
 * Customer Assistant —— 对外公开 id 生成。
 *
 * 规格（10_ECARD_VISITOR_CHAT_SOLUTION.md §4）：
 *   对外一律使用随机不可枚举的公开 id：`vis_` / `conv_` 前缀 + 128bit 随机（32 hex）；
 *   内部主键仍是自增 BIGINT。webchat 版另有 `wc_` 前缀（本次 P1 不使用）。
 */

import { randomBytes } from "node:crypto";

const PUBLIC_ID_PREFIXES = new Set(["vis", "conv", "wc"]);

export function newPublicId(prefix) {
  if (!PUBLIC_ID_PREFIXES.has(prefix)) {
    throw new Error(`[customerAssistant] 未知的公开 id 前缀: ${prefix}`);
  }
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}
