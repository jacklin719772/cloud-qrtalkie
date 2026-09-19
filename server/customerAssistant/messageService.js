/**
 * Customer Assistant（ECard 访客聊天）——消息服务。
 *
 * 规格来源（冻结口径）：docs/customer-assistant/10_ECARD_VISITOR_CHAT_SOLUTION.md §6.2
 *
 * 发消息事务（评审意见 ⑥⑬，必须原样实现）：
 *   BEGIN
 *     ① SELECT last_seq FROM ca_conversations WHERE id = ? FOR UPDATE   -- 事务内第一条语句
 *     ② SELECT ... FROM ca_messages WHERE conversation_id=? AND sender_type=? AND client_msg_id=?
 *        FOR UPDATE                                                    -- ★锁定读，不能是普通 SELECT
 *        命中 → 直接返回既有消息（duplicate），不分配 seq、不加未读、不推送、不发 WS
 *     ③ INSERT ca_messages（seq = last_seq + 1）
 *     ④ UPDATE ca_conversations（last_seq / last_message 系列 / 未读；访客消息自动回 active）
 *   COMMIT
 *   推送与 WS 事件必须在 COMMIT 之后（由调用方负责，本文件不触发任何副作用）
 *
 * 为什么②必须锁定读：REPEATABLE READ 下普通 SELECT 读的是事务快照，看不到并发请求刚提交的行，
 * 会导致两个同 clientMsgId 的请求都走到 INSERT 而撞唯一键。锁前若做快路径查询，只能是优化。
 * 兜底：捕获 ER_DUP_ENTRY(1062) 后回读并原样返回。
 *
 * 约定：并发安全的前提是"同一会话的所有写路径都先取会话行锁"（本文件与其他服务的锁顺序统一）。
 */

const PREVIEW_MAX_LEN = 120;

function toPreview(content) {
  if (content === null || content === undefined) return null;
  return String(content).replace(/\s+/g, " ").trim().slice(0, PREVIEW_MAX_LEN) || null;
}

function mapMessageRow(row) {
  return {
    id: Number(row.id),
    seq: Number(row.seq),
    senderType: row.sender_type,
    senderSipUserId: row.sender_sip_user_id === null ? null : Number(row.sender_sip_user_id),
    contentType: row.content_type,
    content: row.content,
    clientMsgId: row.client_msg_id,
    status: row.status,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/**
 * 在同一事务内幂等落库一条消息。
 * 返回 { duplicate, message }；duplicate=true 时调用方**不得**推送/发 WS/重复计未读。
 */
export async function appendMessage(connection, {
  conversationId,
  senderType,
  senderSipUserId = null,
  content = null,
  contentType = "text",
  clientMsgId = null,
}) {
  // ① 会话行锁：事务内第一条语句（锁顺序：先会话行、后子表）
  const lockedRows = await connection.query(
    `SELECT last_seq FROM ca_conversations WHERE id = ? FOR UPDATE`,
    [conversationId],
  );
  if (!lockedRows[0]) {
    const error = new Error("conversation not found");
    error.code = "CA_CONVERSATION_NOT_FOUND";
    throw error;
  }

  // ② 锁后二次幂等确认（★锁定读：必须是 FOR UPDATE / FOR SHARE）
  //    注：不同会话的 gap 锁互不重叠；同一会话已被①串行化，故此处不会引入死锁
  if (clientMsgId) {
    const existing = await connection.query(
      `SELECT id, seq, sender_type, sender_sip_user_id, content_type, content, client_msg_id,
              status, delivered_at, read_at, created_at
         FROM ca_messages
        WHERE conversation_id = ? AND sender_type = ? AND client_msg_id = ?
        FOR UPDATE`,
      [conversationId, senderType, clientMsgId],
    );
    if (existing[0]) {
      return { duplicate: true, message: mapMessageRow(existing[0]) };
    }
  }

  const nextSeq = Number(lockedRows[0].last_seq) + 1;

  // ③ 落消息（唯一键 (conversation_id, seq) 兜底；1062 见下方 catch）
  let insertResult;
  try {
    insertResult = await connection.query(
      `INSERT INTO ca_messages
         (conversation_id, seq, sender_type, sender_sip_user_id, content_type, content, client_msg_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sent')`,
      [conversationId, nextSeq, senderType, senderSipUserId, contentType, content, clientMsgId],
    );
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
      // 兜底：极少数路径（未来重构漏拿会话锁）撞唯一键时，回读并原样返回既有消息
      const again = await connection.query(
        `SELECT id, seq, sender_type, sender_sip_user_id, content_type, content, client_msg_id,
                status, delivered_at, read_at, created_at
           FROM ca_messages
          WHERE conversation_id = ? AND sender_type = ? AND client_msg_id = ?
          LIMIT 1`,
        [conversationId, senderType, clientMsgId],
      );
      if (again[0]) return { duplicate: true, message: mapMessageRow(again[0]) };
    }
    throw error;
  }

  // ④ 同事务更新会话聚合状态（评审意见 ②：访客消息自动把归档会话唤回 active 并清 archived_at）
  await connection.query(
    `UPDATE ca_conversations
        SET last_seq = ?,
            last_message_id = ?,
            last_message_at = NOW(),
            last_message_preview = ?,
            unread_for_agent   = unread_for_agent   + IF(? = 'visitor', 1, 0),
            unread_for_visitor = unread_for_visitor + IF(? = 'agent',   1, 0),
            status      = IF(? = 'visitor', 'active', status),
            archived_at = IF(? = 'visitor', NULL,     archived_at)
      WHERE id = ?`,
    [nextSeq, insertResult.insertId, toPreview(content), senderType, senderType, senderType, senderType, conversationId],
  );

  const rows = await connection.query(
    `SELECT id, seq, sender_type, sender_sip_user_id, content_type, content, client_msg_id,
            status, delivered_at, read_at, created_at
       FROM ca_messages WHERE id = ? LIMIT 1`,
    [insertResult.insertId],
  );

  return { duplicate: false, message: mapMessageRow(rows[0]) };
}

/**
 * 历史 / 追平（P3、A8）。
 *   before=<seq>  → 更早的一页（历史分页，结果按 seq 升序返回）
 *   after=<seq>   → 断线重连后的增量追平
 */
export async function listMessages(connection, conversationId, { before = null, after = null, limit = 50 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const params = [conversationId];
  let where = "conversation_id = ?";
  let order = "seq ASC";

  if (before) {
    where += " AND seq < ?";
    params.push(Number(before));
    order = "seq DESC"; // 取"更早的 size 条"，再在内存里反转为升序
  } else if (after) {
    where += " AND seq > ?";
    params.push(Number(after));
  }
  params.push(size);

  const rows = await connection.query(
    `SELECT id, seq, sender_type, sender_sip_user_id, content_type, content, client_msg_id,
            status, delivered_at, read_at, created_at
       FROM ca_messages
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ?`,
    params,
  );

  const messages = rows.map(mapMessageRow);
  return before ? messages.reverse() : messages;
}

/**
 * 送达回执：把对端已发出的消息标记为 delivered（幂等，只改 sent→delivered）。
 * side 表示"谁收到的"（agent 收到 → 标记 visitor 发出的消息）。
 */
export async function markDelivered(connection, conversationId, side, uptoSeq) {
  const seq = Math.max(Number(uptoSeq) || 0, 0);
  if (seq <= 0) return { updated: false };
  const peerSenderType = side === "agent" ? "visitor" : "agent";

  await connection.query(
    `UPDATE ca_messages
        SET status = IF(status = 'sent', 'delivered', status), delivered_at = IFNULL(delivered_at, NOW())
      WHERE conversation_id = ? AND sender_type = ? AND seq <= ? AND delivered_at IS NULL`,
    [conversationId, peerSenderType, seq],
  );
  return { updated: true };
}
