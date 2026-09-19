/**
 * Customer Assistant 真机推送脚本（**会真实推送到测试账号的设备**，谨慎运行）
 *
 * ⚠️ 会写入并清理测试数据（跑完核对 0 残留），需要连接到 CA 所在的数据库与本地 SaaS（127.0.0.1:3001）。
 * 夹具（环境变量，默认取 ecard 20 / 账号 30010001 —— 仅适用于本项目测试环境）：
 *   CA_TEST_SLUG / CA_TEST_ECARD_ID / CA_TEST_SIP_USER_ID
 * 运行：cd <repo> && sudo node scripts/ca-live-push.mjs
 */
import { pool } from "../server/db.js";

const BASE = "http://127.0.0.1:3001";
const SLUG = process.env.CA_TEST_SLUG || "ec-28-ffx9i5";
const ECARD_ID = Number(process.env.CA_TEST_ECARD_ID || 20);

const results = [];
const check = (name, cond, extra) => {
  results.push(Boolean(cond));
  console.log(`${cond ? "PASS" : "FAIL"} | ${name}${extra !== undefined ? "  → " + extra : ""}`);
};

async function req(method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const conn = await pool.getConnection();
let visitorPublicId = null;

try {
  await conn.query(
    `INSERT INTO ca_ecard_settings (ecard_id, enabled, notify_enabled, display_name, welcome_message)
     VALUES (?, 1, 1, ?, ?)`,
    [ECARD_ID, "30010001 客服", "您好，這裡是線上客服。"],
  );

  const v1 = await req("POST", `/api/ecard/public/${SLUG}/chat-session`, { body: {} });
  visitorPublicId = v1.json?.visitorId;
  const token = v1.json?.accessToken;
  check("V1 取票成功", v1.status === 200 && !!token);

  const content = "【Android 推送測試】訪客詢問產品價格，請尽快回覆。";
  const v3 = await req("POST", `/api/ecard/public/${SLUG}/chat/messages`, { token, body: { clientMsgId: "live-1", content } });
  check("V3 访客发消息（触发真实推送）", v3.status === 201, `messageId=${v3.json?.message?.id}`);
  const messageId = v3.json?.message?.id;

  console.log("\n# 等待推送发送（最多 10s）…");
  // 固定等待：三个目标的发送是顺序进行的，早退会漏读后写入的行
  await sleep(5000);
  const rows = await conn.query(
    `SELECT provider, status, error_code, provider_response, payload_summary FROM push_events WHERE msgid = ? ORDER BY id`,
    [`ca:${messageId}`],
  );

  console.log(`# push_events 记录 ${rows.length} 条：`);
  for (const row of rows) {
    const resp = JSON.parse(row.provider_response || "{}");
    const summary = JSON.parse(row.payload_summary || "{}");
    console.log(`   · provider=${row.provider} status=${row.status} source=${summary.source} service=${summary.service || "-"} error_code=${row.error_code || "-"}`);
    console.log(`     response=${JSON.stringify(resp).slice(0, 260)}`);
  }
  check("推送已发出（各目标都有明确返回）", rows.length >= 1 && rows.every((r) => r.status !== "received"), `rows=${rows.length}`);
  const okCount = rows.filter((r) => r.status === "processed").length;
  const failCount = rows.filter((r) => r.status === "failed").length;
  console.log(`\n# 汇总：成功 ${okCount} 个目标 / 失败 ${failCount} 个目标（失败通常是历史重装留下的陈旧 token）`);
  console.log("# 请检查 Android 与 iPhone 是否都出现通知：标题「30010001 客服」、内容含「Android 推送測試」");
} catch (error) {
  console.log(`ERROR | ${error?.message || error}`);
  results.push(false);
} finally {
  try {
    if (visitorPublicId) await conn.query("DELETE FROM ca_visitors WHERE ecard_id = ? AND public_id = ?", [ECARD_ID, visitorPublicId]);
    await conn.query("DELETE FROM ca_ecard_settings WHERE ecard_id = ?", [ECARD_ID]);
    await conn.query("DELETE FROM push_events WHERE event = 'ca_message'");
    const left = await conn.query(
      `SELECT (SELECT COUNT(*) FROM ca_visitors) visitors, (SELECT COUNT(*) FROM ca_conversations) conversations,
              (SELECT COUNT(*) FROM ca_messages) messages, (SELECT COUNT(*) FROM ca_ecard_settings) settings`,
    );
    const l = left[0];
    console.log(`\n# 清理核对：visitors=${l.visitors} conversations=${l.conversations} messages=${l.messages} settings=${l.settings}`);
    check("测试数据已清理干净（0 残留）", Object.values(l).every((n) => Number(n) === 0));
  } catch (cleanupError) {
    console.log(`CLEANUP ERROR | ${cleanupError?.message || cleanupError}`);
    results.push(false);
  }
  conn.release();
  const failed = results.filter((r) => !r).length;
  console.log(`\n===== 结果：${results.length - failed}/${results.length} 通过 =====`);
}
process.exit(0);
