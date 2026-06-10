# WebRTC 帳號密碼更新 API 使用說明

## 1. API 功能

此 API 用於更新單一 WebRTC / PJSIP 帳號的登入密碼。

特點：
- 只更新密碼
- 不修改顯示名稱
- 不修改 transport、codec、media_address、dtls、webrtc、bundle、overlay
- 成功後會自動執行 FreePBX Apply Config
- 不重啟 Asterisk
- 不直接寫 FreePBX DB / SaaS DB

---

## 2. 路由

```http
PATCH /api/pbx/webrtc-accounts/:extension/password
```

### 範例

```bash
curl -X PATCH http://localhost:3001/api/pbx/webrtc-accounts/9521/password \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"password":"<NEW_PASSWORD>"}'
```

---

## 3. 請求參數

### Path Parameters
- `extension`：必須為純數字

### Body
```json
{
  "password": "new-password"
}
```

也支援：
```json
{
  "newPassword": "new-password"
}
```

### 驗證規則
- `extension` 必須是純數字
- `password` 不可為空
- 密碼長度不得超過 128 字元

---

## 4. 成功回應

```json
{
  "success": true,
  "message": "WebRTC 帳號密碼已更新",
  "data": {
    "extension": "9521",
    "updated": true,
    "needReload": false,
    "applyConfigSuccess": true,
    "applyConfig": {
      "success": true,
      "transactionId": "..."
    }
  }
}
```

### 成功回應說明
- `updated`：是否已更新 FreePBX 記錄
- `needReload`：成功後應為 `false`
- `applyConfigSuccess`：是否已成功套用 FreePBX 配置
- `applyConfig.transactionId`：套用配置交易 ID（如有）

---

## 5. 失敗回應

### 5.1 格式錯誤
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

### 5.2 密碼錯誤
```json
{
  "success": false,
  "message": "WebRTC 帳號密碼不正確",
  "error": {
    "code": "INVALID_WEBRTC_PASSWORD",
    "message": "WebRTC 帳號密碼不可為空白"
  }
}
```

### 5.3 帳號不存在
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

### 5.4 Apply Config 失敗
```json
{
  "success": false,
  "message": "WebRTC 帳號密碼更新失敗",
  "error": {
    "code": "FWCONSOLE_RELOAD_FAILED",
    "message": "FreePBX 套用配置失敗"
  }
}
```

### 5.5 其他更新失敗
```json
{
  "success": false,
  "message": "WebRTC 帳號密碼更新失敗",
  "error": {
    "code": "FREEPBX_PASSWORD_UPDATE_FAILED",
    "message": "WebRTC 帳號密碼更新失敗"
  }
}
```

---

## 6. 內部流程

這個 API 的處理順序為：

1. 驗證 extension 格式
2. 驗證 password
3. 查詢 FreePBX 帳號是否存在
4. 讀取更新前的 Asterisk runtime 設定
5. 使用 FreePBX Web 表單方式提交密碼更新
6. 重新查詢 FreePBX 確認更新成功
7. 自動執行 FreePBX Apply Config
8. 重新讀取 Asterisk runtime
9. 比對 WebRTC 關鍵字段是否被改壞
10. 回傳結果

---

## 7. 安全邊界

此 API 不會：
- 重啟 Asterisk
- 寫入 `pjsip_custom_post.conf`
- 寫入 `pjsip.endpoint.conf`
- 寫入 FreePBX DB
- 寫入 SaaS DB
- 輸出密碼、secret、token、cookie、CSRF、API key

---

## 8. 前端整合建議

前端可以直接把此 API 當作「更新密碼」動作：

- 成功時：顯示「密碼已更新」
- 若 `needReload=false`：視為已完成
- 若 `applyConfigSuccess=false`：提示使用者配置套用失敗

注意：
- 這不是顯示名稱更新 API
- 不要拿此 API 做顯示名稱更新

---

## 9. 測試命令

### 單筆測試
```bash
curl -X PATCH http://localhost:3001/api/pbx/webrtc-accounts/9521/password \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"password":"<NEW_PASSWORD>"}'
```

### 格式錯誤測試
```bash
curl -X PATCH http://localhost:3001/api/pbx/webrtc-accounts/abc/password \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"password":"<NEW_PASSWORD>"}'
```

---

## 10. 文件備註

本 API 與顯示名稱更新 API 分離，避免更新密碼時誤動 WebRTC 高級參數。

