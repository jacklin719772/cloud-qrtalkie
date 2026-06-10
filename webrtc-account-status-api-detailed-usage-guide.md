# WebRTC 帳號狀態查詢 API 詳細使用說明

## 1. API 概覽

此 API 用於只讀查詢 WebRTC / PJSIP 帳號在 PBX / Asterisk 中的當前狀態。

支援兩種形式：

- 單筆查詢：`GET /api/pbx/webrtc-accounts/:extension/status`
- 批次查詢：`GET /api/pbx/webrtc-accounts/status?extensions=9521,9522`

用途：

- 讓前端判斷帳號是否存在
- 顯示在線 / 離線 / 不存在 / 狀態未知
- 顯示部分安全摘要欄位

此 API 為只讀，不會：

- 建立帳號
- 修改帳號
- 刪除帳號
- 執行 reload
- 重啟 Asterisk
- 寫入任何 Asterisk conf
- 寫入 FreePBX DB / SaaS DB

---

## 2. 請求方式

### 單筆查詢

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521/status \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### 批次查詢

```bash
curl -sS "http://localhost:3001/api/pbx/webrtc-accounts/status?extensions=9521,9001,9599" \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### 非法格式

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/abc/status \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

---

## 3. 請求參數

### extension

- 必須為純數字
- 例如：`9521`

### extensions

- 批次查詢使用逗號分隔
- 最多 100 個
- 例如：`9521,9522,9523`

---

## 4. 成功回應格式

### 單筆 / 批次共用格式

```json
{
  "success": true,
  "message": "WebRTC 帳號狀態已取得",
  "data": {
    "count": 2,
    "items": [
      {
        "extension": "9521",
        "exists": true,
        "status": "offline",
        "statusText": "離線",
        "tech": "PJSIP",
        "resource": "9521",
        "channelCount": 0,
        "transport": "0.0.0.0-wss",
        "contactStatus": "Unavailable",
        "aor": "9521",
        "auth": "9521-auth",
        "lastSeen": null,
        "rttMs": null,
        "source": "asterisk"
      }
    ]
  }
}
```

---

## 5. 狀態映射規則

- `Avail` / `Reachable` -> `online` / `在線`
- `Unavailable` -> `offline` / `離線`
- 帳號不存在 -> `not_found` / `帳號不存在`
- 查詢失敗 -> `unknown` / `狀態未知`

---

## 6. 錯誤回應

### 格式錯誤

```json
{
  "success": false,
  "message": "WebRTC 帳號格式不正確",
  "error": {
    "code": "INVALID_WEBRTC_EXTENSION",
    "message": "WebRTC 帳號必須為純數字"
  }
}
```

### 批次數量過多

```json
{
  "success": false,
  "message": "查詢帳號數量過多",
  "error": {
    "code": "TOO_MANY_EXTENSIONS",
    "message": "查詢帳號數量不得超過 100 筆"
  }
}
```

### 查詢失敗

```json
{
  "success": false,
  "message": "WebRTC 帳號狀態查詢失敗",
  "error": {
    "code": "WEBRTC_ACCOUNT_STATUS_QUERY_FAILED",
    "message": "WebRTC 帳號狀態查詢失敗"
  }
}
```

---

## 7. 前端展示建議

前端可依 `status` 顯示：

- `online` -> 綠色
- `offline` -> 灰色 / 紅色
- `not_found` -> 灰色
- `unknown` -> 黃色 / 警示

可使用：

- `statusText`
- `exists`
- `transport`
- `contactStatus`
- `channelCount`

---

## 8. 實作摘要

### 修改檔案

- `server/index.js`
- `server/asteriskCommandService.js`

### 主要函式

- `getPjsipEndpointStatus(extension)`
- `getPjsipEndpointStatusBatch(extensions)`

### 來源

狀態解析來自只讀命令：

```bash
asterisk -x "pjsip show endpoint <EXT>"
```

---

## 9. 安全邊界

此 API 不會輸出：

- 密碼
- secret
- token
- cookie
- CSRF
- API key

也不會：

- reload
- restart
- 修改 conf
- 修改資料庫

---

## 10. 驗證方式

```bash
node --check server/index.js
node --check server/asteriskCommandService.js
```

單筆查詢：

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521/status \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

批次查詢：

```bash
curl -sS "http://localhost:3001/api/pbx/webrtc-accounts/status?extensions=9521,9001,9599" \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

