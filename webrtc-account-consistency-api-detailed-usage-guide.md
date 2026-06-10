# WebRTC 帳號一致性查詢 API 詳細使用說明

## 1. API 功能總覽

此 API 用來一次性比對同一個 WebRTC/PJSIP 帳號的三層狀態是否一致：

1. FreePBX 內是否存在該帳號
2. Asterisk/PJSIP runtime 是否存在該帳號
3. `pjsip.endpoint_custom_post.conf` 的 SaaS overlay 是否存在且與預期一致

它是只讀診斷接口，不會建立、更新、刪除帳號，也不會 reload 或重啟 Asterisk。

### 新增路由

- `GET /api/pbx/webrtc-accounts/:extension/consistency`

### 主要用途

- 前端不用自己分別呼叫：
  - `GET /api/pbx/webrtc-accounts/:extension`
  - `GET /api/pbx/webrtc-accounts/:extension/status`
  - `GET /api/pbx/webrtc-accounts/:extension/config`
- 直接一次取得一致性診斷結果

---

## 2. 相關代碼文件與作用

### `server/index.js`

- 註冊 `GET /api/pbx/webrtc-accounts/:extension/consistency`
- 組裝回應結構
- 將 FreePBX 查詢、Asterisk runtime、overlay 結果整合成一個一致性結果

### `server/asteriskCommandService.js`

- 提供 Asterisk 只讀查詢能力
- 解析：
  - `pjsip show endpoint <EXT>`
  - `pjsip show auth <EXT>-auth`
  - `pjsip show aor <EXT>`
- 提供 runtime/status/config 的安全摘要

### `server/webrtcAccountWorkflow.js`

- 保留 WebRTC 帳號建立流程與 overlay 工具函式
- 提供 overlay 讀取、建立報告所需的共用能力

### `server/freepbxApiClient.js`

- 提供 FreePBX 查詢能力
- 一致性 API 會沿用既有的 FreePBX extension 查詢結果

---

## 3. API 呼叫方式

### 單一帳號查詢

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521/consistency \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### 注意事項

- `extension` 必須是純數字
- 這是只讀查詢，不會改任何配置
- 不會 reload
- 不會重啟 Asterisk

---

## 4. 請求參數

### Path 參數

- `extension`
  - 類型：字串
  - 必須符合：`/^\d+$/`
  - 例：`9521`

### 無請求 body

- 這個接口不需要 request body

---

## 5. 成功回應結構

```json
{
  "success": true,
  "message": "WebRTC 帳號一致性已取得",
  "data": {
    "extension": "9521",
    "exists": true,
    "overallConsistent": true,
    "checks": {
      "existsConsistent": true,
      "runtimeConsistent": true,
      "overlayConsistent": true
    },
    "freepbx": {
      "exists": true,
      "extension": "9521",
      "name": "訪客9521",
      "tech": "pjsip",
      "email": "9521@example.com"
    },
    "status": {
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
    },
    "config": {
      "exists": true,
      "source": {
        "freepbx": true,
        "asteriskRuntime": true,
        "endpointCustomPostOverlay": true
      },
      "runtime": {
        "endpointExists": true,
        "authExists": true,
        "aorExists": true,
        "transport": "0.0.0.0-wss",
        "allow": "(ulaw|h264)",
        "context": "from-internal",
        "callerid": "\"訪客9521\" <9521>",
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
      }
    },
    "warnings": []
  }
}
```

---

## 6. 回應欄位說明

### `data.exists`

- 代表三層來源是否都一致認為帳號存在
- 若三層都不存在，這裡會是 `false`

### `data.overallConsistent`

- 代表：
  - FreePBX 存在性
  - Asterisk runtime 存在性
  - overlay 狀態
  - overlay 預期值
- 是否互相一致

### `data.checks.existsConsistent`

- FreePBX / status / config 的存在性是否一致

### `data.checks.runtimeConsistent`

- Asterisk runtime 是否自洽
- 例如：
  - endpoint / auth / aor 是否都存在
  - 若帳號不存在，runtime 是否也一致顯示不存在

### `data.checks.overlayConsistent`

- `pjsip.endpoint_custom_post.conf` 的 SaaS overlay 是否存在
- 若存在，內容是否與預期一致

### `data.freepbx`

- FreePBX 只讀摘要
- 不含密碼、secret、token

### `data.status`

- 來源：Asterisk runtime 狀態
- 常見值：
  - `online`
  - `offline`
  - `not_found`
  - `unknown`

### `data.config`

- 來源：Asterisk runtime + overlay 讀取結果
- 會回傳安全白名單欄位
- 不會回傳 Asterisk 原始完整輸出

### `data.overlay`

- 只會回傳 SaaS overlay 的安全摘要
- marker 不存在時：
  - `exists=false`
  - `fields={}`

### `data.warnings`

可能包含：

- `overlay_missing`
- `overlay_fields_mismatch`

---

## 7. 一致性判定規則

### 一致

若下列條件都成立，視為一致：

- FreePBX、status、config 都一致認為帳號存在
- 或三者都一致認為帳號不存在
- runtime 與 overlay 的 4 個補充欄位一致

### 不一致

以下情況視為不一致：

- 有接口說存在，另一個說不存在
- runtime endpoint/auth/aor 不一致
- overlay 存在但內容與預期不符
- runtime 與 overlay 的 4 個補充欄位不一致

---

## 8. 錯誤處理

### `400 INVALID_WEBRTC_EXTENSION`

- extension 不是純數字

### `500 WEBRTC_ACCOUNT_CONSISTENCY_QUERY_FAILED`

- FreePBX / Asterisk runtime / overlay 任一查詢發生非預期錯誤

### `500 ASTERISK_RUNTIME_QUERY_FAILED`

- Asterisk runtime 查詢本身失敗

---

## 9. 安全邊界

此 API 不會：

- 建立帳號
- 更新帳號
- 刪除帳號
- reload
- 重啟 Asterisk
- 寫任何 Asterisk conf
- 直接寫 FreePBX DB
- 直接寫 SaaS DB
- 輸出密碼、secret、token、cookie、CSRF、API key

---

## 10. 前端整合建議

前端可以這樣用：

1. 先呼叫 `/consistency`
2. 用 `data.overallConsistent` 判斷是否整體正常
3. 用 `data.checks` 顯示具體不一致點
4. 用 `data.status.status` 告知在線/離線/不存在
5. 用 `data.overlay.exists` 與 `data.overlay.fields` 診斷 SaaS overlay 是否保留

### 建議 UI 呈現

- `overallConsistent=true`
  - 顯示綠色一致
- `status=offline`
  - 顯示離線，但不等於不存在
- `overlay_missing`
  - 顯示 overlay 缺失警告

---

## 11. 與其他查詢接口的關係

### `GET /api/pbx/webrtc-accounts/:extension`

- 查 FreePBX 是否存在

### `GET /api/pbx/webrtc-accounts/:extension/status`

- 查 Asterisk/PJSIP 狀態

### `GET /api/pbx/webrtc-accounts/:extension/config`

- 查 FreePBX + runtime + overlay 的安全配置摘要

### `GET /api/pbx/webrtc-accounts/:extension/consistency`

- 一次聚合上述三層結果
- 適合前端做一致性判斷

---

## 12. 測試方式

### 語法檢查

```bash
node --check server/index.js
node --check server/asteriskCommandService.js
node --check server/freepbxApiClient.js
node --check server/webrtcAccountWorkflow.js
```

### 單筆查詢

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521/consistency \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### 不存在的帳號

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9599/consistency \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### 非法格式

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/abc/consistency \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

---

## 13. 你應該如何解讀結果

### 情況 A：帳號正常且已配置完成

- `exists=true`
- `overallConsistent=true`
- `status.status=offline` 或 `online`
- `config.overlay.exists=true`

### 情況 B：帳號已刪除

- `exists=false`
- `overallConsistent=true`
- `status.status=not_found`
- `config.exists=false`
- `overlay.exists=false`

### 情況 C：有殘留問題

- `exists=false`
- `overallConsistent=false`
- `warnings` 可能包含：
  - `overlay_missing`
  - `overlay_fields_mismatch`

---

## 14. 生成與驗證結論

這個接口的設計目的，是把三個現有查詢結果整合成一個可直接給前端使用的診斷結果。

- 不改帳號資料
- 不 reload
- 不重啟 Asterisk
- 只做只讀比對

