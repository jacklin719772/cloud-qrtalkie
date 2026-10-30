# FCM 推送转发网关（fcm.qrtalkie.org）部署与配置文档

日期：2026-10-30  
适用：SaaS 推送网关、生产机（org，35.221.190.216）、目标机（cn，218.95.39.186）

---

## 1. 背景与目标

大陆服务器无法稳定直连 Google FCM，导致大陆服务器上"使用 FCM 通道的设备"收不到推送。
解决方案：部署一个独立的 **FCM 转发服务**（`fcm.qrtalkie.org`），大陆网关遇到 FCM 设备时，把推送内容委托给该服务，由它代发 FCM。

设计原则：

- 与 SaaS **松耦合**：独立进程、独立域名/端口、独立 systemd 单元、独立重启；
- 生产机 SaaS 原有推送逻辑**零改动**（默认 `local` 模式，行为与以前完全一致）；
- 只影响 FCM 通道；JPush / 华为 / 小米 / OPPO / vivo / 荣耀 / APNs 路径不变；
- 客户端无改动、数据库无改动。

---

## 2. 总体架构

```
App（FCM 通道设备）
   ↑  FCM
Google FCM
   ↑  HTTPS（OAuth 服务账号）
fcm.qrtalkie.org  ←── 转发服务（生产机 127.0.0.1:3100，Apache 443 反代）
   ↑  HTTPS + x-relay-token
目标机 SaaS 推送网关（/api/push/flexisip）
   ↑  外部推送（external-push-uri）
目标机 Flexisip
```

- 目标机网关判定设备为 FCM 且 `PUSH_FCM_DELIVERY=delegate` 时，改为调用转发服务；
- 转发服务用自己的 Firebase 服务账号换 OAuth token，把消息发往 Google FCM；
- 生产机（org）保持 `local` 模式，FCM 由本机直发。

---

## 3. 代码与版本

仓库：`git@github.com:jacklin719772/cloud-qrtalkie.git`（master）

| 提交 | 内容 |
|---|---|
| `9a86652` | 新增 `fcm-relay/server.js` 与 `deployment/fcm-relay.service` |
| `b05c0bd` | 转发服务改名为 `server.cjs`（仓库为 ESM 项目，`.js` 会被当 ES 模块加载失败） |
| `06e99c6` | SaaS 网关支持 FCM 委托转发（`PUSH_FCM_DELIVERY` 等变量） |

相关文件：

| 文件 | 作用 |
|---|---|
| `fcm-relay/server.cjs` | 转发服务（零依赖，仅用 Node 内置模块） |
| `deployment/fcm-relay.service` | systemd 单元 |
| `server/pushGatewayService.js` | 网关 FCM 发送逻辑（新增 delegate 分支） |
| `.env.example` | 新增变量说明 |

---

## 4. 转发服务（生产机）

### 4.1 部署位置

- 运行文件：`/opt/saas/fcm-relay/server.cjs`（来自 git 仓库）
- 旧版本备份：`/opt/fcm-relay/server.js.bak-20261030`
- 环境文件：`/opt/fcm-relay/.env`（权限 600，**不在仓库中**）
- systemd：`/etc/systemd/system/fcm-relay.service`（来源 `deployment/fcm-relay.service`）

### 4.2 systemd 配置

```ini
[Unit]
Description=FCM Relay Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/saas/fcm-relay
EnvironmentFile=/opt/fcm-relay/.env
ExecStart=/usr/bin/node /opt/saas/fcm-relay/server.cjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

- 开机自启：`enabled`
- 崩溃自动重启：`Restart=always`，间隔 3 秒
- 状态检查：`systemctl is-active fcm-relay`
- 日志：`journalctl -u fcm-relay -n 100 --no-pager`

### 4.2.1 首次启动与日常启停

首次部署（单元文件与环境文件就位后）：

```bash
sudo cp /opt/saas/deployment/fcm-relay.service /etc/systemd/system/fcm-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now fcm-relay     # 设置开机自启并立即启动
sudo systemctl is-active fcm-relay       # 期望输出 active
curl -s http://127.0.0.1:3100/healthz    # 期望 {"ok":true,"service":"fcm-relay"}
```

日常启停：

```bash
sudo systemctl start fcm-relay
sudo systemctl stop fcm-relay
sudo systemctl restart fcm-relay
sudo systemctl status fcm-relay
systemctl is-enabled fcm-relay            # 确认开机自启
```

### 4.3 环境变量（`/opt/fcm-relay/.env`）

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口，默认 `3100`（只绑定 `127.0.0.1`） |
| `RELAY_TOKEN` | 调用方共享密钥（`openssl rand -hex 32` 生成），**勿入库** |
| `FCM_SERVICE_ACCOUNT_PATH` | Firebase 服务账号 JSON 路径；当前 `/etc/flexisip/firebase/qrtalkie-firebase-adminsdk-fbsvc-5500bf7351.json`（与 App 同一 Firebase 项目） |
| `FCM_TIMEOUT_MS` | 调用 Google FCM 的超时，默认 `10000` |

### 4.4 Apache / 域名 / 证书

- 域名：`fcm.qrtalkie.org` → `35.221.190.216`
- 80 vhost：301 跳转 HTTPS；`/.well-known/` 放行用于证书续期
- 443 vhost：`ProxyPass / http://127.0.0.1:3100/`，Let's Encrypt 证书（certbot 自动续期）
- 配置文件：`/etc/apache2/sites-available/fcm.qrtalkie.org.conf` 与 `fcm.qrtalkie.org-le-ssl.conf`

### 4.5 接口

**GET `/healthz`**（无需鉴权）

```json
{"ok":true,"service":"fcm-relay"}
```

**POST `/api/push/fcm`**

请求头：

| 头 | 说明 |
|---|---|
| `x-relay-token` | 共享密钥，必须与 `RELAY_TOKEN` 一致 |
| `content-type` | `application/json` |

请求体：

```json
{
  "v": 1,
  "request_id": "调用方生成的关联 ID（可选）",
  "token": "<FCM 设备 token>",
  "event": "call | message | ca_message",
  "call_id": "",
  "msgid": "",
  "from_uri": "",
  "to_uri": "",
  "uid": "",
  "sound": "",
  "sip_username": "",
  "sip_domain": "",
  "package_name": "",
  "ca": {
    "conversation_id": "",
    "visitor_id": "",
    "visitor_name": "",
    "unread": ""
  }
}
```

- `token` 与 `event` 必填；`ca` 仅在 `event=ca_message` 时使用。
- 服务端按上述字段自行构造 FCM v1 `message`（data-only，`android.priority=HIGH`）。

响应：

```json
{
  "ok": true,
  "status": "success",
  "http_status": 200,
  "fcm_error": "",
  "response_body": "..."
}
```

- 鉴权失败：HTTP 401 `{"ok":false,"error":"UNAUTHORIZED"}`
- 参数错误：HTTP 400 `INVALID_JSON` / `TOKEN_OR_EVENT_MISSING`
- 请求体过大（>64KB）：HTTP 413 `BODY_TOO_LARGE`
- FCM 拒绝：HTTP 502，附 `http_status` 与 `fcm_error`（如 `INVALID_ARGUMENT` / `UNREGISTERED`）
- 内部错误（OAuth 失败、超时）：HTTP 502，`error` 字段说明

### 4.6 行为细节

- OAuth access token 按 `expires_in - 60s` 缓存在内存中，避免每次推送重新换取；
- 调用 Google FCM 超时时间由 `FCM_TIMEOUT_MS` 控制；
- 每次推送记录一行 JSON 日志：
  `{"src":"fcm-relay","request_id":"…","event":"…","token_hint":"前6…后6","ok":true,"http_status":200,"fcm_error":"","duration_ms":78}`

---

## 5. SaaS 网关改造

文件：`server/pushGatewayService.js`

### 5.1 新增环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PUSH_FCM_DELIVERY` | `local` | `local`＝本机直发 FCM；`delegate`＝转交给转发服务 |
| `PUSH_FCM_DELEGATE_URL` | 空 | 转发服务地址，如 `https://fcm.qrtalkie.org/api/push/fcm` |
| `PUSH_FCM_DELEGATE_TOKEN` | 空 | 转发服务要求的 `x-relay-token` |
| `PUSH_FCM_DELEGATE_TIMEOUT_MS` | `5000` | 转发请求超时（毫秒） |

### 5.2 行为变化（仅 delegate 模式）

- `canLiveSendProvider("fcm")` 与 `FcmProvider.isConfigured()`：delegate 模式下视为可用，不再要求本机 FCM 服务账号；
- `sendFcmLiveNotification()`：先构造 FCM 消息，再按模式选择本机发送或转发；
- 转发请求携带：`token`、`event`、`call_id`、`msgid`、`from_uri`、`to_uri`、`uid`、`sound`、`sip_username`、`sip_domain`、`package_name`、`ca`（如适用）；
- 结果写入 `push_events.provider_response`：`delivery_mode=delegate`、`delegate_host`、`http_status`、`fcm_error`；
- 失败错误码：`DELEGATE_TIMEOUT`（超时）、`DELEGATE_REQUEST_FAILED`（网络/其他）。

### 5.3 兼容性

- 未配置 `PUSH_FCM_DELIVERY` 时行为与改造前完全一致；
- 生产机（org）未配置该变量，继续本机直发 FCM。

---

## 6. 目标机（cn）配置

文件：`/opt/saas/.env`（权限 600）

```ini
PUSH_FCM_DELIVERY=delegate
PUSH_FCM_DELEGATE_URL=https://fcm.qrtalkie.org/api/push/fcm
PUSH_FCM_DELEGATE_TOKEN=<与生产机 /opt/fcm-relay/.env 的 RELAY_TOKEN 一致>
PUSH_FCM_DELEGATE_TIMEOUT_MS=5000
```

生效方式：

```bash
systemctl stop saas
systemctl start saas
systemctl is-active saas
```

当前状态：delegate 模式已启用并生效（2026-10-30）。

---

## 7. 部署与更新流程（版本管理规则）

**前端禁止本地构建**，所有构建在服务器执行。

标准流程：

1. 本地改代码 → 提交并推送 GitHub；
2. 两台服务器：`git fetch origin && git checkout origin/master -- <变更路径>`；
3. 前端有改动：服务器上 `npm run build`（`sudo bash -lc "cd /opt/saas && npm run build"`）；
4. 后端有改动：`systemctl restart saas`（重启前先通知）。

### 7.1 首次部署转发服务（新机器）

前置：该机器能访问 Google FCM，并已从 GitHub 拉取仓库到 `/opt/saas`。

```bash
# 1) 拉取转发服务代码与单元文件
sudo git -C /opt/saas fetch origin
sudo git -C /opt/saas checkout origin/master -- fcm-relay deployment

# 2) 创建环境文件（权限 600，密钥勿入库）
sudo mkdir -p /opt/fcm-relay
sudo bash -c 'umask 077; cat > /opt/fcm-relay/.env <<EOF
PORT=3100
RELAY_TOKEN=$(openssl rand -hex 32)
FCM_SERVICE_ACCOUNT_PATH=/etc/flexisip/firebase/<服务账号>.json
FCM_TIMEOUT_MS=10000
EOF'
sudo chmod 600 /opt/fcm-relay/.env

# 3) 安装并启动 systemd 服务（开机自启）
sudo cp /opt/saas/deployment/fcm-relay.service /etc/systemd/system/fcm-relay.service
sudo systemctl daemon-reload
sudo systemctl enable --now fcm-relay
systemctl is-active fcm-relay
curl -s http://127.0.0.1:3100/healthz

# 4) 配置 Apache 域名与证书（示例）
#    /etc/apache2/sites-available/fcm.qrtalkie.org.conf 内 ProxyPass / http://127.0.0.1:3100/
sudo a2ensite fcm.qrtalkie.org && sudo systemctl reload apache2
sudo certbot --apache -d fcm.qrtalkie.org --redirect
```

首次部署后，把 `RELAY_TOKEN` 同步到需要委托的服务器（见第 6 节）。

### 7.2 更新转发服务

```bash
sudo git -C /opt/saas fetch origin
sudo git -C /opt/saas checkout origin/master -- fcm-relay deployment
sudo cp /opt/saas/deployment/fcm-relay.service /etc/systemd/system/fcm-relay.service
sudo systemctl daemon-reload
sudo systemctl restart fcm-relay
curl -s http://127.0.0.1:3100/healthz
```

注意：`fcm-relay/` 位于 SaaS 仓库内，仓库 `package.json` 声明 `"type": "module"`，因此转发服务必须使用 `.cjs` 扩展名。

---

## 8. 验证记录（2026-10-30）

| 测试 | 路径 | 结果 |
|---|---|---|
| 无效 token，event=call | cn 网关 → 转发服务 → FCM | 转发服务日志 `fcm_error=INVALID_ARGUMENT`（证明真实到达 Google FCM） |
| 真实 token（账号 50010013，从 Flexisip 注册信息提取），event=message | 同上 | `ok=true`，FCM HTTP 200 |
| 真实 token，event=call（带 call_id/from/to） | 同上 | `ok=true`，FCM HTTP 200 |
| 直发系统通知（生产机直接调 FCM，不经 App 逻辑） | 生产机 → FCM | FCM 200，**手机确认收到通知** |

结论：

- 目标机网关 → `fcm.qrtalkie.org` → Google FCM → 手机，全链路打通；
- 纯数据消息（前两项测试）不会自动显示通知，属 Android/FCM 的正常行为：数据消息只交给 App 处理，真实业务中由数据消息唤醒 App/SIP，再由 SIP 事件生成来电/消息通知。

---

## 9. 故障排查

1. `curl https://fcm.qrtalkie.org/healthz` 是否 200；
2. 无密钥请求应返回 401；
3. 转发服务日志：`journalctl -u fcm-relay -n 100 --no-pager`；
4. SaaS 网关日志：`/opt/saas/server.log`（搜索 `fcm-relay`、`delegate`、`flexisip-dispatch-debug`）；
5. 常见错误：
   - `UNAUTHORIZED`：两端 `RELAY_TOKEN` 不一致；
   - `FCM_OAUTH_FAILED`：服务账号 JSON 路径错误或无读取权限；
   - `INVALID_ARGUMENT`：token 不是合法 FCM token；
   - `UNREGISTERED`：token 已失效（App 重装/卸载）；
   - `DELEGATE_TIMEOUT`：转发服务不可达或超时；
6. 手机收不到：先发一条带 `notification` 的系统通知验证设备（如需可用生产机脚本直发）；确认设备可访问 Google、App 通知权限开启、token 未过期。

---

## 10. 风险与限制

- **单点依赖**：目标机 FCM 推送依赖生产机转发服务与跨境链路，生产机故障会导致目标机 FCM 全断；
- **数据跨境**：FCM token、SIP 账号、通知内容会经过生产机（现状客户端注册本就在 org，非新增暴露，但需知情）；
- **共享 Firebase 项目**：额度与凭据由生产机统一管理；
- **客户端注销未实现**：退出登录/切换账号时不会注销网关设备注册；
- **数据消息不弹通知**：依赖 App/SIP 处理逻辑，非网关问题。

**回滚**：

- 目标机把 `PUSH_FCM_DELIVERY` 改回 `local`（大陆无法直发 FCM，等同 FCM 不可用）；
- 应急：把目标机 Flexisip 的 `external-push-uri` 临时指回生产机（现状方案）。

---

## 11. 变更记录

| 日期 | 内容 |
|---|---|
| 2026-10-30 | 初版：转发服务部署、SaaS delegate 支持、目标机接入与验证 |
