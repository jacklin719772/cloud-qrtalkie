/**
 * Customer Assistant 验收脚本（收编自 P1 实施期临时脚本）
 *
 * ⚠️ 会写入并清理测试数据（跑完核对 0 残留），需要连接到 CA 所在的数据库与本地 SaaS（127.0.0.1:3001）。
 * 夹具（环境变量，默认取 ecard 20 / 账号 30010001 —— 仅适用于本项目测试环境）：
 *   CA_TEST_SLUG / CA_TEST_ECARD_ID / CA_TEST_SIP_USER_ID
 * 运行：cd <repo> && sudo node scripts/ca-service-it.mjs
 */
import { pool } from "../server/db.js";
import * as sessions from "../server/customerAssistant/sessionService.js";
import * as convs from "../server/customerAssistant/conversationService.js";
import * as msgs from "../server/customerAssistant/messageService.js";
import { newPublicId } from "../server/customerAssistant/ids.js";

const results = [];
const check = (name, cond, extra) => {
  results.push(cond);
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${extra !== undefined ? "  → " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conn = await pool.getConnection();   // A 连接
const conn2 = await pool.getConnection();  // B 连接（并发用）
let visitorId = null;
let convId = null;

try {
  const ecardRows = await conn.query(
    "SELECT id, sip_user_id FROM tenant_ecards WHERE status = 'active' AND sip_user_id IS NOT NULL LIMIT 1",
  );
  const ecard = ecardRows[0];
  if (!ecard) throw new Error("没有可用的 active ecard 记录，无法自测");
  const ecardId = Number(ecard.id);
  const ownerId = Number(ecard.sip_user_id);
  console.log(`# 使用 ecard=${ecardId} owner=${ownerId} 作为测试夹具\n`);

  // ---------- ① 访客 + 取票 ----------
  const visInsert = await conn.query(
    "INSERT INTO ca_visitors (ecard_id, public_id, display_name) VALUES (?, ?, ?)",
    [ecardId, newPublicId("vis"), "CA-IT-TEST"],
  );
  visitorId = Number(visInsert.insertId);

  const access = await sessions.issueAccessToken(conn, visitorId, { ip: "127.0.0.1", userAgent: "ca-it" });
  const resume = await sessions.issueResumeToken(conn, visitorId);
  check("取票：accessToken 为 43 字符 base64url", access.token.length === 43 && /^[A-Za-z0-9_-]+$/.test(access.token));
  check("取票：resumeToken 为 43 字符 base64url", resume.token.length === 43);
  const stored = await conn.query("SELECT token_hash, family_id FROM ca_resume_tokens WHERE id = ?", [resume.id]);
  check("落库只存 sha256（明文不入库）", stored[0].token_hash === sessions.hashToken(resume.token) && stored[0].token_hash !== resume.token);

  const acc1 = await sessions.resolveAccessToken(conn, access.token);
  check("accessToken 校验通过并滑动续期", acc1.ok === true && acc1.session.visitorId === visitorId);
  const acc2 = await sessions.resolveAccessToken(conn, "tampered");
  check("篡改的 accessToken 被拒", acc2.ok === false && acc2.reason === "not_found");

  // ---------- ② 轮换 + 重放检测 ----------
  const rot = await sessions.redeemResumeToken(conn, resume.token);
  check("resumeToken 轮换成功且换出新票", rot.ok === true && rot.resumeToken !== resume.token);
  const replay = await sessions.redeemResumeToken(conn, resume.token);
  check("旧 resumeToken 重放 → 判定 replayed", replay.ok === false && replay.reason === "replayed");
  const famLeft = await conn.query(
    "SELECT COUNT(*) AS n FROM ca_resume_tokens WHERE visitor_id = ? AND revoked_at IS NULL",
    [visitorId],
  );
  check("重放后整条 family 链已撤销", Number(famLeft[0].n) === 0);
  const accLeft = await conn.query(
    "SELECT COUNT(*) AS n FROM ca_sessions WHERE visitor_id = ? AND revoked_at IS NULL",
    [visitorId],
  );
  check("重放后该访客全部 accessToken 已撤销", Number(accLeft[0].n) === 0);
  const acc3 = await sessions.resolveAccessToken(conn, access.token);
  check("被撤销的 accessToken 立即失效", acc3.ok === false && acc3.reason === "revoked");

  // ---------- ③ 会话唯一 ----------
  const convA = await convs.ensureConversation(conn, { ecardId, visitorId, sipUserId: ownerId });
  const convB = await convs.ensureConversation(conn, { ecardId, visitorId, sipUserId: ownerId });
  convId = convA.conversationId;
  check("同一访客身份复用同一会话（不新建）", convA.created === true && convB.created === false && convA.conversationId === convB.conversationId);

  // ---------- ④ seq 事务 ----------
  const m1 = await msgs.appendMessage(conn, { conversationId: convId, senderType: "visitor", content: "你好，想咨询\n一下产品", clientMsgId: "c-1" });
  const m2 = await msgs.appendMessage(conn, { conversationId: convId, senderType: "agent", senderSipUserId: ownerId, content: "您好，请讲", clientMsgId: "a-1" });
  check("seq 从 1 起、会话内递增", m1.message.seq === 1 && m2.message.seq === 2, `seq=${m1.message.seq},${m2.message.seq}`);
  const convState = await conn.query(
    "SELECT last_seq, last_message_preview, unread_for_agent, unread_for_visitor, status FROM ca_conversations WHERE id = ?",
    [convId],
  );
  check("聚合更新：last_seq=2 且预览已折叠换行", Number(convState[0].last_seq) === 2 && convState[0].last_message_preview === "您好，请讲");
  check("未读：客服 1 / 访客 1", Number(convState[0].unread_for_agent) === 1 && Number(convState[0].unread_for_visitor) === 1);

  // ---------- ⑤ 顺序幂等（并验证未发生 INSERT 尝试）----------
  const autoIncBefore = await conn.query(
    "SELECT AUTO_INCREMENT AS ai FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_messages'",
  );
  const dup = await msgs.appendMessage(conn, { conversationId: convId, senderType: "visitor", content: "你好，想咨询\n一下产品", clientMsgId: "c-1" });
  check("重复 clientMsgId 原样返回既有消息", dup.duplicate === true && dup.message.id === m1.message.id && dup.message.seq === 1);
  const autoIncAfter = await conn.query(
    "SELECT AUTO_INCREMENT AS ai FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_messages'",
  );
  check(
    "幂等命中走的是『锁后锁定读』分支（未尝试 INSERT）",
    Number(autoIncAfter[0].ai) === Number(autoIncBefore[0].ai),
    `AUTO_INCREMENT ${autoIncBefore[0].ai} → ${autoIncAfter[0].ai}`,
  );
  const cntC1 = await conn.query("SELECT COUNT(*) AS n FROM ca_messages WHERE conversation_id = ? AND client_msg_id = 'c-1'", [convId]);
  check("库中同 clientMsgId 仅 1 条", Number(cntC1[0].n) === 1);

  // ---------- ⑥ 归档 → 清零；访客消息 → 自动回 active ----------
  await convs.archiveConversation(conn, convId);
  const archived = await conn.query(
    "SELECT status, archived_at, unread_for_agent, agent_last_read_seq, last_seq FROM ca_conversations WHERE id = ?",
    [convId],
  );
  check(
    "归档：状态 archived + 未读清零 + 游标推到最新",
    archived[0].status === "archived" &&
      archived[0].archived_at !== null &&
      Number(archived[0].unread_for_agent) === 0 &&
      Number(archived[0].agent_last_read_seq) === Number(archived[0].last_seq),
  );

  const m3 = await msgs.appendMessage(conn, { conversationId: convId, senderType: "visitor", content: "还在吗？", clientMsgId: "c-2" });
  const woke = await conn.query(
    "SELECT status, archived_at, unread_for_agent, last_seq FROM ca_conversations WHERE id = ?",
    [convId],
  );
  check(
    "访客新消息把归档会话唤回 active 且清 archived_at、未读 +1",
    woke[0].status === "active" &&
      woke[0].archived_at === null &&
      Number(woke[0].unread_for_agent) === 1 &&
      Number(woke[0].last_seq) === m3.message.seq,
  );

  // ---------- ⑦ 已读 ----------
  await convs.markRead(conn, convId, "agent", m3.message.seq);
  const readState = await conn.query(
    "SELECT unread_for_agent, agent_last_read_seq FROM ca_conversations WHERE id = ?",
    [convId],
  );
  const readRows = await conn.query(
    "SELECT COUNT(*) AS n FROM ca_messages WHERE conversation_id = ? AND sender_type = 'visitor' AND read_at IS NOT NULL",
    [convId],
  );
  check(
    "客服已读：未读归零 + 游标到位",
    Number(readState[0].unread_for_agent) === 0 && Number(readState[0].agent_last_read_seq) === m3.message.seq,
  );
  check("对端（访客）消息落 read_at", Number(readRows[0].n) === 2, `marked=${readRows[0].n}`);

  // ---------- ⑧ 分页 / 追平 ----------
  const all = await msgs.listMessages(conn, convId, { limit: 10 });
  const older = await msgs.listMessages(conn, convId, { before: 3, limit: 10 });
  const newer = await msgs.listMessages(conn, convId, { after: 2, limit: 10 });
  check("历史返回 3 条且 seq 升序", all.length === 3 && all[0].seq === 1 && all[2].seq === 3);
  check("before 分页取更早 2 条", older.length === 2 && older[0].seq === 1 && older[1].seq === 2);
  check("after 追平取 1 条", newer.length === 1 && newer[0].seq === 3);

  // ---------- ⑨ 并发幂等（两条独立连接，验证行锁串行化）----------
  // 正确的时序：A 先取锁（不 await） → B 随后阻塞 → A 提交解锁 → 双方各自完成
  await conn.beginTransaction();
  const pA = msgs.appendMessage(conn, {
    conversationId: convId, senderType: "visitor", content: "并发消息", clientMsgId: "c-race",
  });
  await sleep(400); // 让 A 先拿到会话行锁
  await conn2.beginTransaction();
  const pB = msgs.appendMessage(conn2, {
    conversationId: convId, senderType: "visitor", content: "并发消息", clientMsgId: "c-race",
  });
  await sleep(400); // 此刻 B 阻塞在会话行锁上
  await conn.commit(); // A 提交 → 解除 B 的阻塞
  const raceA = await pA;
  const raceB = await pB;
  await conn2.commit();
  check("并发同 clientMsgId：先到者正常落库", raceA.duplicate === false && raceA.message.seq === 4, `seq=${raceA.message.seq}`);
  check(
    "并发同 clientMsgId：后到者拿到同一条（未被 1062 打断）",
    raceB.duplicate === true && raceB.message.id === raceA.message.id && raceB.message.seq === raceA.message.seq,
  );
  const raceRows = await conn.query("SELECT COUNT(*) AS n FROM ca_messages WHERE conversation_id = ? AND client_msg_id = 'c-race'", [convId]);
  check("并发下同 clientMsgId 仅落 1 条", Number(raceRows[0].n) === 1);
} catch (error) {
  console.log(`ERROR | ${error?.code || ""} ${error?.message || error}`);
  results.push(false);
} finally {
  // ---------- 清理：删除测试访客（级联清掉会话/消息/票据）----------
  try {
    await conn.rollback().catch(() => {});
    await conn2.rollback().catch(() => {});
    if (visitorId) {
      await conn.query("DELETE FROM ca_visitors WHERE id = ?", [visitorId]);
      const leftovers = await conn.query(
        `SELECT
           (SELECT COUNT(*) FROM ca_visitors WHERE public_id LIKE 'vis_%' AND display_name = 'CA-IT-TEST') AS visitors,
           (SELECT COUNT(*) FROM ca_conversations WHERE visitor_id = ?) AS conversations,
           (SELECT COUNT(*) FROM ca_messages m JOIN ca_conversations c ON c.id = m.conversation_id WHERE c.visitor_id = ?) AS messages,
           (SELECT COUNT(*) FROM ca_sessions WHERE visitor_id = ?) AS sessions,
           (SELECT COUNT(*) FROM ca_resume_tokens WHERE visitor_id = ?) AS resumes`,
        [visitorId, visitorId, visitorId, visitorId],
      );
      const l = leftovers[0];
      const clean = [l.visitors, l.conversations, l.messages, l.sessions, l.resumes].every((n) => Number(n) === 0);
      console.log(`\n# 清理核对：visitors=${l.visitors} conversations=${l.conversations} messages=${l.messages} sessions=${l.sessions} resumes=${l.resumes}`);
      check("测试数据已清理干净（0 残留）", clean);
    }
  } catch (cleanupError) {
    console.log(`CLEANUP ERROR | ${cleanupError?.message || cleanupError}`);
    results.push(false);
  }
  conn.release();
  conn2.release();
  const failed = results.filter((r) => !r).length;
  console.log(`\n===== 结果：${results.length - failed}/${results.length} 通过 =====`);
  process.exit(failed === 0 ? 0 : 1);
}
