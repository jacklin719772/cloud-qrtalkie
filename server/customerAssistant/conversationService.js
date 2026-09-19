/**
 * Customer Assistant（ECard 访客聊天）——会话服务。
 *
 * 规格来源（冻结口径）：
 *   docs/customer-assistant/10_ECARD_VISITOR_CHAT_SOLUTION.md
 *     §5.4/§5.5 同一访客身份长期复用一个会话（UNIQUE(ecard_id, visitor_id)）；状态只有 active ⇄ archived；
 *                归档 = 收件箱整理动作，**同时清零该会话未读**；归档对访客不可见；不设计 closed
 *     §6.2      seq/未读等聚合更新发生在消息事务内（本文件只负责会话生命周期与已读游标）
 *     §6.3      owner 转交规则（MVP 不支持转交，本文件不提供该方法）
 *
 * 约定：所有函数接收"已取到的连接"，由调用方管理事务边界。
 */

import { newPublicId } from "./ids.js";

/**
 * 取（或创建）该 ecard 下该访客的唯一会话。
 *
 * 并发安全：依赖 UNIQUE(ecard_id, visitor_id)；撞唯一键时回读既有行（幂等，不新建第二条）。
 * 返回 { conversationId, publicId, created, sipUserId, status }
 */
export async function ensureConversation(connection, { ecardId, visitorId, sipUserId }) {
  const existing = await connection.query(
    `SELECT id, public_id, sip_user_id, status FROM ca_conversations
      WHERE ecard_id = ? AND visitor_id = ? LIMIT 1`,
    [ecardId, visitorId],
  );
  if (existing[0]) {
    return {
      conversationId: Number(existing[0].id),
      publicId: existing[0].public_id,
      created: false,
      sipUserId: existing[0].sip_user_id === null ? null : Number(existing[0].sip_user_id),
      status: existing[0].status,
    };
  }

  const publicId = newPublicId("conv");
  try {
    const result = await connection.query(
      `INSERT INTO ca_conversations (public_id, ecard_id, visitor_id, sip_user_id, status)
       VALUES (?, ?, ?, ?, 'active')`,
      [publicId, ecardId, visitorId, sipUserId ?? null],
    );
    return {
      conversationId: Number(result.insertId),
      publicId,
      created: true,
      sipUserId: sipUserId ?? null,
      status: "active",
    };
  } catch (error) {
    // 并发下另一个请求先建成功 → 回读既有会话（幂等）
    if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
      const again = await connection.query(
        `SELECT id, public_id, sip_user_id, status FROM ca_conversations
          WHERE ecard_id = ? AND visitor_id = ? LIMIT 1`,
        [ecardId, visitorId],
      );
      if (again[0]) {
        return {
          conversationId: Number(again[0].id),
          publicId: again[0].public_id,
          created: false,
          sipUserId: again[0].sip_user_id === null ? null : Number(again[0].sip_user_id),
          status: again[0].status,
        };
      }
    }
    throw error;
  }
}

/** 按公开 id 取会话（不含消息），供 REST/WS 归属校验前的加载使用 */
export async function findConversationByPublicId(connection, publicId) {
  const rows = await connection.query(
    `SELECT id, public_id, ecard_id, visitor_id, sip_user_id, status,
            last_seq, last_message_at, unread_for_agent, unread_for_visitor,
            agent_last_read_seq, visitor_last_read_seq
       FROM ca_conversations WHERE public_id = ? LIMIT 1`,
    [publicId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    conversationId: Number(row.id),
    publicId: row.public_id,
    ecardId: Number(row.ecard_id),
    visitorId: Number(row.visitor_id),
    sipUserId: row.sip_user_id === null ? null : Number(row.sip_user_id),
    status: row.status,
    lastSeq: Number(row.last_seq),
    lastMessageAt: row.last_message_at,
    unreadForAgent: Number(row.unread_for_agent),
    unreadForVisitor: Number(row.unread_for_visitor),
    agentLastReadSeq: Number(row.agent_last_read_seq),
    visitorLastReadSeq: Number(row.visitor_last_read_seq),
  };
}

/**
 * 客服侧会话列表（A1）。
 * status: "active" | "archived" | "all"（默认 active）
 */
export async function listConversationsForAgent(connection, sipUserId, { status = "active", unreadOnly = false, limit = 50 } = {}) {
  const params = [sipUserId];
  let where = "c.sip_user_id = ?";
  if (status !== "all") {
    where += " AND c.status = ?";
    params.push(status);
  }
  if (unreadOnly) where += " AND c.unread_for_agent > 0";
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));

  const rows = await connection.query(
    `SELECT c.id, c.public_id, c.status, c.last_seq, c.last_message_at, c.last_message_preview,
            c.unread_for_agent, c.visitor_id,
            v.public_id AS visitor_public_id, v.display_name AS visitor_display_name,
            v.blocked AS visitor_blocked
       FROM ca_conversations c
       JOIN ca_visitors v ON v.id = c.visitor_id
      WHERE ${where}
      ORDER BY c.last_message_at IS NULL, c.last_message_at DESC, c.id DESC
      LIMIT ?`,
    params,
  );

  return rows.map((row) => ({
    conversationId: row.public_id,
    status: row.status,
    visitorId: row.visitor_public_id,
    visitorDisplayName: row.visitor_display_name,
    visitorBlocked: Boolean(row.visitor_blocked),
    lastSeq: Number(row.last_seq),
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    unreadForAgent: Number(row.unread_for_agent),
  }));
}

/**
 * 归档（评审意见 ②）：收件箱整理动作 —— 同时清零该会话未读并把已读游标推到最新。
 * 归档**不是**终止状态，也不通知访客；访客再发消息由消息事务自动回 active。
 */
export async function archiveConversation(connection, conversationId) {
  await connection.query(
    `UPDATE ca_conversations
        SET status = 'archived', archived_at = NOW(),
            unread_for_agent = 0, agent_last_read_seq = last_seq
      WHERE id = ? AND status = 'active'`,
    [conversationId],
  );
  return true;
}

/** 取消归档（不改动未读/游标） */
export async function unarchiveConversation(connection, conversationId) {
  await connection.query(
    `UPDATE ca_conversations SET status = 'active', archived_at = NULL WHERE id = ? AND status = 'archived'`,
    [conversationId],
  );
  return true;
}

/**
 * 标记已读（评审意见 ⑥ 约束③）：游标单调不回退；未读按消息表重算（权威）；对端消息落 read_at。
 * side: "agent" | "visitor"（side 表示"谁读的"，被标记的则是对方的未读与消息状态）
 * 三条语句均在同一事务内执行（调用方提供连接）。
 */
export async function markRead(connection, conversationId, side, uptoSeq) {
  const seq = Math.max(Number(uptoSeq) || 0, 0);
  if (seq <= 0) return { updated: false };

  const isAgent = side === "agent";
  const cursorColumn = isAgent ? "agent_last_read_seq" : "visitor_last_read_seq";
  const unreadColumn = isAgent ? "unread_for_agent" : "unread_for_visitor";
  const peerSenderType = isAgent ? "visitor" : "agent";

  // ① 已读游标前移（GREATEST 保证单调，不回退）
  await connection.query(
    `UPDATE ca_conversations SET ${cursorColumn} = GREATEST(${cursorColumn}, ?) WHERE id = ?`,
    [seq, conversationId],
  );

  // ② 未读重算（以消息表为准，覆盖增量计数的任何偏差）
  await connection.query(
    `UPDATE ca_conversations c
        SET c.${unreadColumn} = (
              SELECT COUNT(*) FROM ca_messages m
               WHERE m.conversation_id = c.id
                 AND m.sender_type = ?
                 AND m.seq > c.${cursorColumn})
      WHERE c.id = ?`,
    [peerSenderType, conversationId],
  );

  // ③ 对端消息落 read_at / status（回执展示用）
  await connection.query(
    `UPDATE ca_messages
        SET status = 'read', read_at = NOW()
      WHERE conversation_id = ? AND sender_type = ? AND seq <= ? AND read_at IS NULL`,
    [conversationId, peerSenderType, seq],
  );

  return { updated: true };
}

/** App 角标用：客服未读总数（A7）。与 SIP 未读分列，客户端自行相加。 */
export async function countUnreadForAgent(connection, sipUserId) {
  const rows = await connection.query(
    `SELECT COALESCE(SUM(unread_for_agent), 0) AS total
       FROM ca_conversations WHERE sip_user_id = ?`,
    [sipUserId],
  );
  return Number(rows[0]?.total || 0);
}
