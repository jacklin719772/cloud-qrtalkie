/**
 * Flexisip Account Manager Client 测试脚本
 *
 * 用法：
 *   在服务器上执行：
 *   cd /opt/saas
 *   export $(cat env.flexisip.test | xargs)
 *   node scripts/test-flexisip-account-client.js
 *
 * 也可以直接设置环境变量后运行。
 */

import { config as dotenvConfig } from "dotenv";

// 尝试加载 env.flexisip.test 环境变量
dotenvConfig({ path: "./env.flexisip.test" });

import {
  FlexisipAccountManagerError,
  createAccount,
  listAccounts,
  getAccount,
  searchAccountBySip,
  searchAccountByEmail,
  updateAccount,
  activateAccount,
  deactivateAccount,
  deleteAccount,
} from "../server/flexisipAccountManagerClient.js";

function log(emoji, msg, data) {
  console.log(`${emoji} ${msg}`);
  if (data !== undefined) console.log("  ", typeof data === "object" ? JSON.stringify(data, null, 2) : data);
}

function checkEnv() {
  const vars = {
    FLEXISIP_ACCOUNT_MANAGER_BASE_URL: process.env.FLEXISIP_ACCOUNT_MANAGER_BASE_URL,
    FLEXISIP_ACCOUNT_MANAGER_API_KEY: process.env.FLEXISIP_ACCOUNT_MANAGER_API_KEY ? "***已设置***" : undefined,
    FLEXISIP_ACCOUNT_MANAGER_TIMEOUT_MS: process.env.FLEXISIP_ACCOUNT_MANAGER_TIMEOUT_MS,
  };
  log("📋", "当前环境变量:", vars);

  if (!process.env.FLEXISIP_ACCOUNT_MANAGER_BASE_URL) {
    console.error("❌ 缺少 FLEXISIP_ACCOUNT_MANAGER_BASE_URL");
    process.exit(1);
  }
  if (!process.env.FLEXISIP_ACCOUNT_MANAGER_API_KEY) {
    console.error("❌ 缺少 FLEXISIP_ACCOUNT_MANAGER_API_KEY");
    process.exit(1);
  }
}

async function run() {
  console.log("=".repeat(60));
  console.log("  Flexisip Account Manager Client - 接入测试");
  console.log("=".repeat(60));
  console.log("");

  checkEnv();

  // ============================
  // 1. listAccounts - 列出已有帐号
  // ============================
  log("📡", "测试 1: listAccounts() - 获取帐号列表...");
  try {
    const list = await listAccounts();
    const count = Array.isArray(list) ? list.length : (list?.accounts ? list.accounts.length : "unknown");
    log("✅", `listAccounts 成功，当前帐号数: ${count}`);
    if (Array.isArray(list) && list.length > 0) {
      log("📋", "前 3 个帐号:", list.slice(0, 3).map(a => ({ id: a.id, username: a.username || a.sip, email: a.email })));
    }
  } catch (err) {
    log("❌", `listAccounts 失败: ${err.message} (status: ${err.status || "N/A"})`);
  }
  console.log("");

  // ============================
  // 2. searchAccountBySip - 搜索 SIP
  // ============================
  log("📡", "测试 2: searchAccountBySip('test@qrtalkie.org') - 搜索 SIP...");
  try {
    const result = await searchAccountBySip("test@qrtalkie.org");
    log("✅", "searchAccountBySip 完成", result);
  } catch (err) {
    log("⚠️", `searchAccountBySip 返回: ${err.message} (status: ${err.status || "N/A"})`);
    log("ℹ️", "如果返回 404，说明该 SIP 不存在，属于正常情况");
  }
  console.log("");

  // ============================
  // 3. searchAccountByEmail - 搜索 Email
  // ============================
  log("📡", "测试 3: searchAccountByEmail('test@qrtalkie.org') - 搜索 Email...");
  try {
    const result = await searchAccountByEmail("test@qrtalkie.org");
    log("✅", "searchAccountByEmail 完成", result);
  } catch (err) {
    log("⚠️", `searchAccountByEmail 返回: ${err.message} (status: ${err.status || "N/A"})`);
  }
  console.log("");

  // ============================
  // 4. createAccount - 创建测试帐号
  // ============================
  const testUsername = `test_codex_${Date.now().toString(36)}`;
  const testPayload = {
    sip: `${testUsername}@qrtalkie.org`,
    password: "Test123456!",
    email: `${testUsername}@qrtalkie.org`,
    display_name: `Codex Test ${testUsername}`,
  };

  let createdId = null;
  log("📡", `测试 4: createAccount() - 创建测试帐号 "${testPayload.sip}"...`);
  log("ℹ️", "帐号信息:", { sip: testPayload.sip, email: testPayload.email, display_name: testPayload.display_name });
  try {
    const created = await createAccount(testPayload);
    createdId = created?.id || created?.account?.id;
    log("✅", `createAccount 成功! ID: ${createdId}`, created);
  } catch (err) {
    log("❌", `createAccount 失败: ${err.message} (status: ${err.status || "N/A"})`);
    if (err.responseBody) log("📋", "响应体:", err.responseBody);
  }
  console.log("");

  // ============================
  // 5. getAccount - 获取刚创建的帐号
  // ============================
  if (createdId) {
    log("📡", `测试 5: getAccount(${createdId}) - 获取刚创建的帐号...`);
    try {
      const account = await getAccount(createdId);
      log("✅", "getAccount 成功", account);
    } catch (err) {
      log("❌", `getAccount 失败: ${err.message} (status: ${err.status || "N/A"})`);
    }
  } else {
    log("⏭️", "测试 5: getAccount - 跳过（无测试帐号）");
  }
  console.log("");

  // ============================
  // 6. deleteAccount - 删除测试帐号
  // ============================
  if (createdId) {
    log("📡", `测试 6: deleteAccount(${createdId}) - 删除测试帐号...`);
    try {
      await deleteAccount(createdId);
      log("✅", `deleteAccount 成功，测试帐号 ${createdId} 已删除`);
    } catch (err) {
      log("❌", `deleteAccount 失败: ${err.message} (status: ${err.status || "N/A"})`);
      log("⚠️", `请手动删除测试帐号: ${testPayload.sip}`);
    }
  } else {
    log("⏭️", "测试 6: deleteAccount - 跳过（无测试帐号）");
  }
  console.log("");

  // ============================
  // 总结
  // ============================
  console.log("=".repeat(60));
  console.log("  测试完成");
  console.log("=".repeat(60));
  console.log("");
  console.log("✅ 通过的接口代表与 Flexisip Account Manager 的连接和认证正常");
  console.log("⚠️ 警告的接口可能需要检查 API 路径或权限");
  console.log("❌ 失败的接口需要排查错误原因");
}

run().catch((err) => {
  console.error("💥 测试脚本异常:", err?.message || err);
  process.exit(1);
});
