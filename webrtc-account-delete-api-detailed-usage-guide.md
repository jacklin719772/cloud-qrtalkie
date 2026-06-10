# WebRTC 帳號刪除 API 詳細使用說明

## 1. API 概覽

WebRTC 帳號刪除 API 用於刪除已建立的 WebRTC / PJSIP 帳號，並在必要時清理 SaaS 產生的 runtime overlay。

支援兩種形式：

- 單筆刪除：`DELETE /api/pbx/webrtc-accounts/:extension`
- 批次刪除：`DELETE /api/pbx/webrtc-accounts`

批次刪除請在 body 中傳入：

```json
{
  "extensions": ["9521", "9522"]
}
```

此 API 的目標是：

- 刪除 FreePBX extension
- 刪除 endpoint custom post overlay 中對應 marker block
- 執行 FreePBX Apply Config / reload
- 驗證刪除後狀態

此 API 不會：

- 重啟 Asterisk
- 寫入 Asterisk conf 以外的檔案
- 寫 FreePBX DB / SaaS DB
- 輸出敏感資訊

---

## 2. 使用方式

### 單筆刪除

```bash
curl -sS -X DELETE http://localhost:3001/api/pbx/webrtc-accounts/9521 \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### 批次刪除

```bash
curl -sS -X DELETE http://localhost:3001/api/pbx/webrtc-accounts \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"extensions":["9521","9522"]}' | jq .
```

---

## 3. 請求參數

### extension

- 必須為純數字
- 單筆刪除使用 path 參數

### extensions

- 批次刪除使用 body
- 必須是陣列
- 最多 100 個
- 每個 extension 必須為純數字

---

## 4. 刪除流程

建議流程如下：

1. 驗證 extension 格式
2. 查詢 FreePBX 中是否存在
3. 執行備份
4. 刪除 FreePBX extension
5. 移除 `/etc/asterisk/pjsip.endpoint_custom_post.conf` 中對應 marker block
6. 執行 FreePBX Apply Config / reload
7. 驗證刪除後狀態

如果帳號不存在：

- 不視為致命錯誤
- 回傳 `notFound` / `skipped`

---

## 5. 回應格式

### 成功

```json
{
  "success": true,
  "message": "WebRTC 帳號刪除完成",
  "data": {
    "requested": ["9521", "9522"],
    "deleted": ["9521"],
    "notFound": ["9522"],
    "failed": [],
    "backupDir": "/var/backups/...",
    "overlayUpdated": true,
    "reloadExecuted": true,
    "asteriskRestartExecuted": false,
    "steps": []
  }
}
```

### 單筆結果項目

```json
{
  "extension": "9521",
  "existsBefore": true,
  "deletedInFreepbx": true,
  "overlayRemoved": true,
  "verifiedDeleted": true,
  "status": "deleted",
  "message": "WebRTC 帳號已刪除"
}
```

---

## 6. 狀態與步驟

建議 `steps`：

- `validate_request`
- `backup_asterisk_configs`
- `check_extensions`
- `delete_freepbx_extensions`
- `remove_endpoint_custom_overlays`
- `apply_freepbx_config`
- `verify_deleted`
- `finalize`

### status 可用值

- `pending`
- `running`
- `success`
- `failed`
- `skipped`
- `rollback`

---

## 7. 錯誤碼

- `INVALID_WEBRTC_EXTENSION`
- `TOO_MANY_EXTENSIONS`
- `ASTERISK_CONFIG_BACKUP_FAILED`
- `FREEPBX_EXTENSION_DELETE_FAILED`
- `ENDPOINT_CUSTOM_POST_UPDATE_FAILED`
- `FWCONSOLE_RELOAD_FAILED`
- `WEBRTC_ACCOUNT_DELETE_FAILED`

---

## 8. overlay 刪除規則

只刪除以下 marker block：

```ini
; BEGIN SaaS WebRTC 4-field endpoint overlay <EXT>
...
; END SaaS WebRTC 4-field endpoint overlay <EXT>
```

如果 marker 不存在：

- `overlayRemoved = false`
- 不視為錯誤

---

## 9. 回滾機制

如果在刪除 overlay 後、reload 後或驗證失敗：

1. 先從備份恢復
   - `/etc/asterisk/pjsip.endpoint_custom_post.conf`
2. 再執行 FreePBX Apply Config / reload
3. 不允許重啟 Asterisk

---

## 10. 依賴的現有實作

### FreePBX client

- `server/freepbxApiClient.js`
- `deleteExtension(extension)`

### Asterisk / overlay helper

- `server/webrtcAccountWorkflow.js`
- 備份 / 恢復 / marker block / writeAtomicFile

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

- 重啟 Asterisk
- 直接寫 FreePBX DB
- 直接寫 SaaS DB
- 修改其他 Asterisk conf

---

## 12. 測試方式

### 語法檢查

```bash
node --check server/index.js
node --check server/freepbxApiClient.js
node --check server/asteriskCommandService.js
```

### 單筆刪除

```bash
curl -sS -X DELETE http://localhost:3001/api/pbx/webrtc-accounts/9521 \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### 批次刪除

```bash
curl -sS -X DELETE http://localhost:3001/api/pbx/webrtc-accounts \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"extensions":["9521","9522"]}' | jq .
```

### 刪除後驗證

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521 \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .

asterisk -x "pjsip show endpoint 9521"
grep -n "SaaS WebRTC 4-field endpoint overlay 9521" /etc/asterisk/pjsip.endpoint_custom_post.conf
```

---

## 13. 前端整合建議

前端可將回應中的：

- `deleted`
- `notFound`
- `failed`
- `overlayUpdated`
- `reloadExecuted`
- `asteriskRestartExecuted`

用於顯示刪除結果。

---

## 14. 目前流程說明

目前刪除 API 應與既有 WebRTC 建立 / 查詢 / 顯示名稱更新 API 保持獨立：

- 不影響建立流程
- 不影響查詢流程
- 不影響顯示名稱更新流程
- 不影響狀態查詢 / config 查詢

---

## 15. 需要注意

刪除操作屬於破壞性行為，正式環境務必：

- 先確認 requested extensions
- 先完成備份
- 驗證 overlay 清理與 reload 結果

