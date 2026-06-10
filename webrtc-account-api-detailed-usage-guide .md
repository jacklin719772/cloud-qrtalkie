# WebRTC Account API Detailed Usage Guide

## 1. API 功能总览

`POST /api/pbx/webrtc-accounts` 用于创建一组完整的 WebRTC / PJSIP 账号配置，流程固定且受控：

1. 验证 extension 必须为纯数字。
2. 检查 FreePBX 中是否已存在该 extension。
3. 备份 Asterisk PJSIP 配置。
4. 通过 FreePBX GraphQL `addExtension` 创建基础 PJSIP 分机。
5. 通过 GraphQL `updateExtension` 设置 PJSIP 注册密码。
6. 通过 FreePBX Web 表单提交 WebRTC 高级参数。
7. 执行 `sudo fwconsole reload`。
8. 验证 `pjsip.endpoint.conf` 已生成符合 WebRTC 预期的 section。
9. 仅向 `/etc/asterisk/pjsip.endpoint_custom_post.conf` 写入 4 字段 runtime overlay。
10. 再次执行 `sudo fwconsole reload`。
11. 使用 `asterisk -x "pjsip show endpoint <EXT>"` 验证 runtime。
12. 验证 9001 / 9002 baseline 未受影响。
13. 若 overlay 写入后失败，则从备份恢复 `/etc/asterisk/pjsip.endpoint_custom_post.conf` 并再次 reload。

该 API 的目标不是直接编辑 Asterisk 自动生成文件，而是让 FreePBX 先生成正确的 `pjsip.endpoint.conf`，再通过 endpoint custom post 补齐少量 runtime 字段。

## 2. 代码文件清单

### `server/index.js`
- 暴露 `POST /api/pbx/webrtc-accounts`。
- 负责把每一步的结果组织为统一 JSON 响应。
- 负责把所有 step 的状态、成功/失败、回滚状态写入返回体。
- 仍然不重启 Asterisk。

### `server/webrtcAccountWorkflow.js`
- 封装整个 WebRTC 创建流程的步骤定义、报告生成、基线验证与 overlay 处理。
- 负责 4 字段 runtime overlay 的构建与验证。
- 负责失败后的回滚步骤与报告。

### `server/webrtcTemplateLoader.js`
- 从 `server/config/webrtc-extension-template.json` 与环境变量加载模板配置。
- 统一管理 FreePBX / Asterisk / SaaS 的环境参数。
- 提供 WebRTC 运行时配置、Asterisk 路径配置、SaaS 管理员登录配置。

### `server/webrtcAccountWorkflow.js`
- 统一定义步骤顺序、失败回滚与报告内容。
- 负责生成 expected endpoint section 的比较逻辑。

### `server/freepbxWebSessionClient.js`
- 负责 FreePBX Web 登录、抓取表单、提交表单。
- 支持 GET 与 POST 分离超时：
  - `FREEPBX_WEB_PAGE_TIMEOUT_MS`
  - `FREEPBX_WEB_SUBMIT_TIMEOUT_MS`
- 对失败提供安全摘要，不输出 cookie / token / CSRF。

### `server/freepbxWebrtcExtensionPayload.js`
- 负责把模板 / env 转成 GraphQL `addExtension` 和 `updateExtension` payload。
- 负责把 WebRTC 字段映射为 FreePBX Web 表单字段。

### `server/saasAdminAuthClient.js`
- 使用 SaaS 管理员用户名 / 密码自动登录并获取 Bearer Token。
- 供测试脚本和 API 自动化调用使用。
- 不打印 token 或密码。

### `server/config/webrtc-extension-template.json`
- WebRTC 默认模板文件。
- 通过环境变量占位符定义参考分机、Web 表单字段、期望 endpoint 字段、endpoint custom post overlay。

### 测试脚本
- `scripts/test-webrtc-template-loader.js`
- `scripts/test-webrtc-account-api-with-admin-login.js`
- `scripts/test-freepbx-webrtc-generate-endpoint-config.js`
- `scripts/apply-webrtc-4fields-endpoint-custom-post.js`
- `scripts/test-freepbx-webrtc-custom-post-overlay.js`
- `scripts/generate-webrtc-overlay-preview.js`
- `scripts/backup-asterisk-pjsip-configs.js`

## 3. API 调用方式

### 请求

```http
POST /api/pbx/webrtc-accounts
Authorization: Bearer <SAAS_ADMIN_TOKEN>
Content-Type: application/json
```

### 请求体

```json
{
  "extension": "9521",
  "email": "9521@example.com"
}
```

### 成功返回结构

```json
{
  "success": true,
  "message": "WebRTC 帳號已建立完成",
  "data": {
    "extension": "9521",
    "displayName": "訪客9521",
    "createdInFreepbx": true,
    "pjsipPasswordConfigured": true,
    "webFormSubmitted": true,
    "firstReloadExecuted": true,
    "generatedEndpointVerified": true,
    "endpointCustomPostWritten": true,
    "secondReloadExecuted": true,
    "runtimeVerified": true,
    "baselineVerified": true,
    "rollbackExecuted": false,
    "rollbackSuccess": null,
    "asteriskRestartExecuted": false,
    "backupDir": "/var/backups/...",
    "reportPath": "/tmp/freepbx-webrtc-create-final-9521-report.md",
    "failedFields": [],
    "warningFields": [],
    "steps": []
  }
}
```

### 失败返回结构

```json
{
  "success": false,
  "message": "WebRTC 帳號建立失敗",
  "error": {
    "code": "RUNTIME_VERIFY_FAILED",
    "message": "WebRTC Runtime 參數驗證失敗"
  },
  "data": {
    "extension": "9521",
    "displayName": "訪客9521",
    "rollbackExecuted": true,
    "rollbackSuccess": true,
    "asteriskRestartExecuted": false,
    "failedFields": [],
    "warningFields": [],
    "steps": []
  }
}
```

### 前端可见 message 规则
- 所有 `message`、`error.message`、`step.label`、`step.message` 都使用繁体中文。
- 技术细节仅出现在安全摘要字段里，不输出敏感值。

## 4. `data.steps` 进度机制

`steps` 是固定顺序的状态机，用于前端展示创建流程进度。

### step key 一览
1. `validate_extension`
2. `check_existing_extension`
3. `backup_asterisk_configs`
4. `create_freepbx_extension`
5. `update_pjsip_password`
6. `submit_freepbx_webrtc_form`
7. `first_fwconsole_reload`
8. `verify_generated_endpoint`
9. `write_endpoint_custom_overlay`
10. `second_fwconsole_reload`
11. `verify_runtime_endpoint`
12. `verify_baseline_endpoints`
13. `rollback_endpoint_custom_post`
14. `finalize`

### status 含义
- `pending`：尚未执行
- `running`：正在执行
- `success`：执行成功
- `failed`：执行失败
- `skipped`：因前序失败或流程短路而跳过
- `rollback`：执行了回滚动作

### 前端展示建议
- 按 `steps` 顺序渲染时间线或进度条。
- `running` 可显示旋转或进行中状态。
- `success` 显示完成。
- `failed` 显示红色并展开 `details`。
- `skipped` 显示灰色。
- `rollback` 显示回滚完成。

### 常用 step 文案
- `validate_extension`：`驗證 WebRTC 帳號格式`
- `check_existing_extension`：`檢查 FreePBX 帳號是否已存在`
- `backup_asterisk_configs`：`備份 Asterisk PJSIP 配置`
- `create_freepbx_extension`：`建立 FreePBX 基礎分機`
- `update_pjsip_password`：`設定 PJSIP 註冊密碼`
- `submit_freepbx_webrtc_form`：`補全 FreePBX WebRTC 進階配置`
- `first_fwconsole_reload`：`套用 FreePBX 配置`
- `verify_generated_endpoint`：`驗證 FreePBX 生成的 Endpoint 配置`
- `write_endpoint_custom_overlay`：`補齊 WebRTC Runtime 參數`
- `second_fwconsole_reload`：`重新套用 Runtime 補充配置`
- `verify_runtime_endpoint`：`驗證 WebRTC Runtime 狀態`
- `verify_baseline_endpoints`：`確認既有標準帳號未受影響`
- `rollback_endpoint_custom_post`：`回滾 WebRTC Runtime 補充配置`
- `finalize`：`完成建立流程`

## 5. 错误码与处理方式

### 错误码列表
- `INVALID_WEBRTC_EXTENSION`
- `FREEPBX_EXTENSION_ALREADY_EXISTS`
- `ASTERISK_CONFIG_BACKUP_FAILED`
- `FREEPBX_EXTENSION_CREATE_FAILED`
- `FREEPBX_PASSWORD_UPDATE_FAILED`
- `FREEPBX_WEB_FORM_SUBMIT_FAILED`
- `FWCONSOLE_RELOAD_FAILED`
- `GENERATED_ENDPOINT_VERIFY_FAILED`
- `ENDPOINT_CUSTOM_POST_WRITE_FAILED`
- `RUNTIME_VERIFY_FAILED`
- `BASELINE_ENDPOINT_VERIFY_FAILED`
- `ROLLBACK_FAILED`
- `WEBRTC_ACCOUNT_CREATE_FAILED`

### 处理原则
- extension 非纯数字：直接失败，后续步骤全部跳过。
- 账号已存在：直接失败，后续步骤跳过。
- 备份失败：立即停止。
- GraphQL 创建失败：停止，不进入表单阶段。
- 密码更新失败：停止。
- Web 表单提交失败：停止，返回安全摘要。
- reload 失败：停止；若已写 overlay，则尝试回滚。
- generated endpoint 验证失败：不继续写 overlay。
- overlay 写入失败：停止；若已写入临时修改，尝试回滚。
- runtime 验证失败：若已写 overlay，必须回滚。
- baseline 验证失败：若已写 overlay，必须回滚。
- 回滚失败：返回 `ROLLBACK_FAILED`，同时保留原始失败信息和报告路径。

## 6. 环境变量说明

### FreePBX API
- `FREEPBX_BASE_URL`
- `FREEPBX_API_TOKEN_URL`
- `FREEPBX_API_GQL_URL`
- `FREEPBX_API_CLIENT_ID`
- `FREEPBX_API_CLIENT_SECRET`
- `FREEPBX_API_SCOPE`
- `FREEPBX_API_TIMEOUT_MS`

### FreePBX Web
- `FREEPBX_WEB_BASE_URL`
- `FREEPBX_WEB_USERNAME`
- `FREEPBX_WEB_PASSWORD`
- `FREEPBX_WEB_PAGE_TIMEOUT_MS`
- `FREEPBX_WEB_SUBMIT_TIMEOUT_MS`

### WebRTC 参数
- `FREEPBX_WEBRTC_DEFAULT_PASSWORD`
- `FREEPBX_WEBRTC_DISPLAY_NAME_PREFIX`
- `FREEPBX_WEBRTC_EMAIL_DOMAIN`
- `FREEPBX_WEBRTC_CONTEXT`
- `FREEPBX_WEBRTC_MAX_CONTACTS`
- `FREEPBX_WEBRTC_MEDIA_ADDRESS`
- `FREEPBX_WEBRTC_TRANSPORT`
- `FREEPBX_WEBRTC_ALLOW_CODECS`
- `FREEPBX_WEBRTC_FORM_ALLOW_CODECS`
- `FREEPBX_WEBRTC_DISALLOW_CODECS`
- `FREEPBX_WEBRTC_TEMPLATE_EXTENSION`
- `FREEPBX_WEBRTC_TEMPLATE_FALLBACK_EXTENSION`
- `FREEPBX_WEBRTC_TEMPLATE_MODE`
- `FREEPBX_WEBRTC_TEMPLATE_FILE`

### Asterisk 路径
- `ASTERISK_CONFIG_DIR`
- `ASTERISK_PJSIP_ENDPOINT_CONF`
- `ASTERISK_PJSIP_ENDPOINT_CUSTOM_POST_CONF`
- `ASTERISK_PJSIP_CUSTOM_POST_CONF`
- `ASTERISK_PJSIP_AUTH_CONF`
- `ASTERISK_PJSIP_AOR_CONF`
- `ASTERISK_BACKUP_ROOT`
- `ASTERISK_BIN`
- `FWCONSOLE_BIN`
- `ASTERISK_RELOAD_COMMAND`

### SaaS 管理员登录
- `SAAS_API_BASE_URL`
- `SAAS_ADMIN_USERNAME`
- `SAAS_ADMIN_PASSWORD`
- `SAAS_ADMIN_LOGIN_PATH`
- `SAAS_ADMIN_TOKEN_TIMEOUT_MS`
- `SAAS_ADMIN_IDENTIFIER_FIELD`

## 7. `env.freepbx.test` 安全摘要

以下为当前开发测试环境中的敏感项摘要，均已脱敏，不输出明文：

| 变量 | 安全摘要 |
|---|---|
| `FREEPBX_API_CLIENT_ID` | `[REDACTED length=64]` |
| `FREEPBX_API_CLIENT_SECRET` | `[REDACTED length=32]` |
| `FREEPBX_WEB_USERNAME` | `[REDACTED length=5]` |
| `FREEPBX_WEB_PASSWORD` | `[REDACTED length=15]` |
| `FREEPBX_WEBRTC_DEFAULT_PASSWORD` | `[REDACTED length=15]` |
| `SAAS_ADMIN_USERNAME` | `[REDACTED length=25]` |
| `SAAS_ADMIN_PASSWORD` | `[REDACTED length=15]` |

说明：
- `env.freepbx.test` 仅用于开发测试。
- `.env.example` 只保留占位符，不应提交真实密钥。

## 8. 启动方式

### 启动前需要做什么
在运行 API 进程前，先加载环境变量：

```bash
set -a
source env.freepbx.test
set +a
```

### 启动方式
#### 1) 直接启动
```bash
node server/index.js
```

#### 2) restart.sh
- 如果项目已有 `restart.sh`，应确保它先加载 `env.freepbx.test`。
- 不要在脚本里硬编码敏感值。

#### 3) systemd
- systemd unit 应从环境文件读取变量，或在 `EnvironmentFile=` 中引入 env 文件。
- 不建议把明文密码写进 unit 文件。

#### 4) PM2
- PM2 启动命令应在环境已加载的 shell 中运行，或使用 PM2 的 env 注入机制。
- 不建议把密钥硬编码进 PM2 配置。

## 9. WebRTC 模板文件

### 路径
`server/config/webrtc-extension-template.json`

### 作用
- 作为 WebRTC 账号创建流程的唯一模板来源。
- 通过环境变量占位符定义参考分机、显示名称前缀、Web 表单字段、期望 endpoint 字段、endpoint custom post overlay。
- 新环境只需要改 env 和模板，不需要改业务代码。

### 主要字段
- `sourceExtension`
- `fallbackSourceExtension`
- `identity.displayNamePrefix`
- `identity.emailDomain`
- `identity.context`
- `identity.tech`
- `identity.vmEnable`
- `identity.maxContacts`
- `identity.mediaAddress`
- `identity.transport`
- `freepbxWebForm.*`
- `endpointGeneratedExpected.*`
- `endpointCustomPostOverlay.*`

## 10. 测试脚本说明

### `scripts/test-webrtc-template-loader.js`
- 验证模板与 env 是否能正确解析。
- 输出安全摘要。
- 不输出敏感值。

### `scripts/test-webrtc-account-api-with-admin-login.js`
- 先自动获取 SaaS 管理员 token。
- 再调用 `POST /api/pbx/webrtc-accounts`。
- 适合本地 / CI 回归。

### 其他相关脚本
- `scripts/test-freepbx-webrtc-generate-endpoint-config.js`：验证 FreePBX 表单提交后是否能生成接近标准 WebRTC 的 `pjsip.endpoint.conf`。
- `scripts/apply-webrtc-4fields-endpoint-custom-post.js`：只处理 `/etc/asterisk/pjsip.endpoint_custom_post.conf` 的 4 字段 overlay。
- `scripts/generate-webrtc-overlay-preview.js`：生成 overlay 预览，不写真实配置。
- `scripts/backup-asterisk-pjsip-configs.js`：备份 `/etc/asterisk` 下的 PJSIP 相关文件并生成 manifest。

## 11. 测试流程

### 11.1 加载环境
```bash
set -a
source env.freepbx.test
set +a
```

### 11.2 语法检查
```bash
node --check server/index.js
node --check server/webrtcAccountWorkflow.js
node --check server/freepbxWebSessionClient.js
node --check server/freepbxWebrtcExtensionPayload.js
node --check server/webrtcTemplateLoader.js
node --check server/saasAdminAuthClient.js
node --check scripts/test-webrtc-template-loader.js
node --check scripts/test-webrtc-account-api-with-admin-login.js
```

### 11.3 测试模板加载
```bash
node scripts/test-webrtc-template-loader.js
```

### 11.4 自动获取 SaaS token 并调用 API
```bash
node scripts/test-webrtc-account-api-with-admin-login.js --extension 9521
```

如果 9521 已存在，使用下一个未占用的纯数字 extension。

### 11.5 手工 curl 调用
```bash
curl -X POST http://localhost:3001/api/pbx/webrtc-accounts \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"extension":"9521","email":"9521@example.com"}'
```

### 11.6 Asterisk runtime 验证
```bash
asterisk -x "pjsip show endpoint 9521"
asterisk -x "pjsip show endpoint 9001"
asterisk -x "pjsip show endpoint 9002"
```

### 11.7 overlay 验证
```bash
grep -n "SaaS WebRTC 4-field endpoint overlay 9521" /etc/asterisk/pjsip.endpoint_custom_post.conf
grep -n "9521" /etc/asterisk/pjsip_custom_post.conf
```

## 12. 失败回滚机制

### 什么时候回滚
- overlay 写入后 runtime 验证失败。
- baseline endpoint 异常。
- 第二次 reload 失败。
- endpoint custom post 文件被意外改写或缺失。

### 如何恢复
- 从备份目录恢复 `/etc/asterisk/pjsip.endpoint_custom_post.conf`。
- 再执行 `sudo fwconsole reload`。

### 为什么不重启 Asterisk
- 该流程只需要 FreePBX reload 与 Asterisk runtime 验证。
- 重启 Asterisk 会扩大影响面，不符合最小变更原则。

## 13. SaaS 前端如何集成

前端可以这样接入：
1. 通过已登录态或管理员 token 调用 `POST /api/pbx/webrtc-accounts`。
2. 读取 `data.steps` 并按 step key 展示进度。
3. 每个 step 的 `status` 显示为：
   - `pending`
   - `running`
   - `success`
   - `failed`
   - `skipped`
   - `rollback`
4. 若 `success=true`，显示整体成功。
5. 若 `success=false`，展示 `error.code`、`error.message` 和 step details 的安全摘要。

## 14. 迁移到新环境

迁移时只需要修改：
- `env.freepbx.test`（或生产环境等价 env 文件）
- `server/config/webrtc-extension-template.json`
- `.env.example` 仅保留占位符，不含真实值

不需要修改业务代码。

## 15. 安全边界

- 不重启 Asterisk。
- 不写 `/etc/asterisk/pjsip_custom_post.conf`。
- 只写 `/etc/asterisk/pjsip.endpoint_custom_post.conf` 的 4 字段 overlay。
- 不直接写 FreePBX 数据库。
- 不直接写 SaaS 数据库。
- 不输出任何密码、secret、token、cookie、CSRF、API key。

## 16. 最终验证结果

已记录的成功验证结果显示：
- `success: true`
- `runtimeVerified: true`
- `baselineVerified: true`
- `asteriskRestartExecuted: false`
- `rollbackExecuted: false`
- `failedFields: []`

对应的成功报告路径为：
- `/tmp/freepbx-webrtc-create-final-9521-report.md`

## 17. Git 提交前检查

提交前请确认：
- `env.freepbx.test` 不提交到 Git。
- `.env.example` 只包含占位符。
- 没有把真实密码、token、cookie、CSRF、API key 写进文档或日志。
- 没有把 `/etc/asterisk` 真实配置当作源码提交。

