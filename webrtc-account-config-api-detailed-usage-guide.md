# WebRTC 帳號配置查詢 API 詳細使用說明

## 1. API 概覽

此 API 用於只讀查詢 WebRTC / PJSIP 帳號的完整安全配置摘要。

支援：

```bash
GET /api/pbx/webrtc-accounts/:extension/config
```

用途：

- 判斷帳號是否存在
- 讀取 FreePBX 查詢結果
- 讀取 Asterisk runtime 狀態
- 讀取 endpoint custom post overlay
- 提供前端安全摘要，方便顯示配置頁面

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

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521/config \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

不存在帳號：

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9599/config \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

非法格式：

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/abc/config \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

---

## 3. 請求參數

### extension

- 必須為純數字
- 例如：`9521`

---

## 4. 成功回應格式

```json
{
  "success": true,
  "message": "WebRTC 帳號配置已取得",
  "data": {
    "extension": "9521",
    "exists": true,
    "source": {
      "freepbx": true,
      "asteriskRuntime": true,
      "endpointCustomPostOverlay": true
    },
    "freepbx": {
      "extension": "9521",
      "name": "訪客9521-測試",
      "tech": "pjsip",
      "email": "9521@example.com"
    },
    "runtime": {
      "endpointExists": true,
      "authExists": true,
      "aorExists": true,
      "transport": "0.0.0.0-wss",
      "allow": "(ulaw|h264)",
      "context": "from-internal",
      "callerid": "\"訪客9521-測試\" <9521>",
      "media_address": "35.221.190.216",
      "direct_media": false,
      "webrtc": true,
      "use_avpf": true,
      "ice_support": true,
      "rtcp_mux": true,
      "bundle": true,
      "media_encryption": "dtls",
      "media_encryption_optimistic": true,
      "media_use_received_transport": true,
      "dtls_auto_generate_cert": "Yes",
      "dtls_setup": "actpass",
      "dtls_verify": "Yes",
      "send_pai": true,
      "allow_unauthenticated_options": true,
      "rtp_timeout": 0,
      "rtp_timeout_hold": 0,
      "asymmetric_rtp_codec": true
    },
    "overlay": {
      "file": "/etc/asterisk/pjsip.endpoint_custom_post.conf",
      "exists": true,
      "fields": {
        "allow_unauthenticated_options": "yes",
        "rtp_timeout": "0",
        "rtp_timeout_hold": "0",
        "asymmetric_rtp_codec": "yes"
      }
    },
    "warnings": []
  }
}
```

---

## 5. 不存在帳號時的回應

```json
{
  "success": false,
  "message": "WebRTC 帳號不存在",
  "error": {
    "code": "WEBRTC_ACCOUNT_NOT_FOUND",
    "message": "WebRTC 帳號不存在"
  }
}
```

HTTP 狀態：`404`

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

### 查詢失敗

```json
{
  "success": false,
  "message": "WebRTC 帳號配置查詢失敗",
  "error": {
    "code": "WEBRTC_ACCOUNT_CONFIG_QUERY_FAILED",
    "message": "WebRTC 帳號配置查詢失敗"
  }
}
```

### Asterisk runtime 問題

```json
{
  "success": false,
  "message": "WebRTC 帳號配置查詢失敗",
  "error": {
    "code": "ASTERISK_RUNTIME_QUERY_FAILED",
    "message": "WebRTC 帳號配置查詢失敗"
  }
}
```

---

## 7. 回傳欄位說明

### source

- `freepbx`
  - 表示已從 FreePBX 查詢到帳號
- `asteriskRuntime`
  - 表示已從 Asterisk runtime 取得資料
- `endpointCustomPostOverlay`
  - 表示在 `/etc/asterisk/pjsip.endpoint_custom_post.conf` 找到 SaaS overlay

### freepbx

- `extension`
- `name`
- `tech`
- `email`

### runtime

白名單欄位：

- `endpointExists`
- `authExists`
- `aorExists`
- `transport`
- `allow`
- `context`
- `callerid`
- `media_address`
- `direct_media`
- `webrtc`
- `use_avpf`
- `ice_support`
- `rtcp_mux`
- `bundle`
- `media_encryption`
- `media_encryption_optimistic`
- `media_use_received_transport`
- `dtls_auto_generate_cert`
- `dtls_setup`
- `dtls_verify`
- `send_pai`
- `allow_unauthenticated_options`
- `rtp_timeout`
- `rtp_timeout_hold`
- `asymmetric_rtp_codec`

### overlay

- `file`
- `exists`
- `fields`

---

## 8. 狀態與判定

此 API 不使用「是否在線」來判斷帳號是否存在。

只要 Asterisk 輸出中可匹配到以下任一項，就視為存在：

- `Endpoint: <EXT>/<EXT>`
- `InAuth: <EXT>-auth/<EXT>`
- `Aor: <EXT>`

如果 endpoint 只是 `Unavailable`，仍視為：

- `exists: true`
- `status` 應由前端依 runtime / contact 狀態解讀為離線

---

## 9. 前端展示建議

建議前端顯示：

- 帳號是否存在
- FreePBX 名稱
- Asterisk runtime 狀態
- overlay 是否存在
- overlay 欄位

可將 `runtime` 與 `overlay` 分成兩個區塊：

1. FreePBX / 基礎資訊
2. Asterisk runtime / overlay

---

## 10. 實作摘要

### 修改檔案

- `server/index.js`
- `server/asteriskCommandService.js`
- `server/webrtcAccountWorkflow.js`

### 主要函式

- `getPjsipEndpointConfig(extension)`
- `readEndpointCustomPostOverlay(extension)`
- `parseEndpointCustomPostOverlay(content, extension)`

---

## 11. 安全邊界

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

## 12. 驗證方式

```bash
node --check server/index.js
node --check server/asteriskCommandService.js
node --check server/freepbxApiClient.js
```

單筆查詢：

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521/config \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

不存在：

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9599/config \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

非法格式：

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/abc/config \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

