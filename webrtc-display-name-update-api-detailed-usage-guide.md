# WebRTC Display Name Update API Detailed Usage Guide

## 1. API Purpose

This API updates only the display name of an existing WebRTC / PJSIP account.

It is intentionally limited so that the frontend can rename an account without touching:
- PJSIP password
- transport
- codec
- media address
- DTLS settings
- WebRTC runtime overlay
- any Asterisk `.conf` files
- any database tables directly

The API does **not** restart Asterisk.
The API does **not** run `fwconsole reload` by itself in this flow.

## 2. Route

Primary route:

```http
PATCH /api/pbx/webrtc-accounts/:extension/display-name
```

Example:

```http
PATCH /api/pbx/webrtc-accounts/9521/display-name
```

## 3. Authorization

The endpoint requires the same admin authorization mechanism used by the PBX APIs.

Example header:

```http
Authorization: Bearer <SAAS_ADMIN_TOKEN>
```

No token, password, cookie, or CSRF data is returned by the API.

## 4. Request Body

```json
{
  "displayName": "訪客9521-測試"
}
```

## 5. Validation Rules

### extension
- Must be numeric only.
- Example valid value: `9521`
- Invalid example: `abc`

### displayName
- Required.
- Trimmed before validation.
- Must not be empty after trimming.
- Must be between 1 and 80 characters.

If validation fails, the API returns a Traditional Chinese error message.

## 6. Success Response

```json
{
  "success": true,
  "message": "WebRTC 帳號顯示名稱已更新",
  "data": {
    "extension": "9521",
    "displayName": "訪客9521-測試",
    "updated": true,
    "needReload": true
  }
}
```

### Field meanings
- `success`: request completed successfully.
- `message`: frontend-visible Traditional Chinese text.
- `data.extension`: target extension.
- `data.displayName`: updated display name.
- `data.updated`: whether the refreshed FreePBX lookup confirms the new value.
- `data.needReload`: indicates whether a reload may be needed later in the workflow. The API itself does not run reload.

## 7. Error Responses

### 7.1 Invalid extension

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

### 7.2 Invalid display name

```json
{
  "success": false,
  "message": "WebRTC 帳號顯示名稱不正確",
  "error": {
    "code": "INVALID_WEBRTC_DISPLAY_NAME",
    "message": "WebRTC 帳號顯示名稱不可為空白"
  }
}
```

### 7.3 Account not found

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

### 7.4 FreePBX update failed

```json
{
  "success": false,
  "message": "WebRTC 帳號顯示名稱更新失敗",
  "error": {
    "code": "FREEPBX_DISPLAY_NAME_UPDATE_FAILED",
    "message": "WebRTC 帳號顯示名稱更新失敗"
  }
}
```

### 7.5 General update failure

```json
{
  "success": false,
  "message": "WebRTC 帳號顯示名稱更新失敗",
  "error": {
    "code": "WEBRTC_DISPLAY_NAME_UPDATE_FAILED",
    "message": "WebRTC 帳號顯示名稱更新失敗"
  }
}
```

## 8. Error Codes

- `INVALID_WEBRTC_EXTENSION`
- `INVALID_WEBRTC_DISPLAY_NAME`
- `WEBRTC_ACCOUNT_NOT_FOUND`
- `FREEPBX_DISPLAY_NAME_UPDATE_FAILED`
- `WEBRTC_DISPLAY_NAME_UPDATE_FAILED`

## 9. Query / Update Flow

The route performs these steps:
1. Validate the extension format.
2. Validate the display name.
3. Query FreePBX using the existing extension lookup logic.
4. If not found, return 404.
5. If found, send a FreePBX GraphQL update request that only targets display-name related fields.
6. Re-query FreePBX to verify the updated name.
7. Return a safe summary.

## 10. What It Does Not Change

This API does **not** modify:
- PJSIP password
- transport
- codec
- media_address
- DTLS options
- WebRTC runtime overlay
- `/etc/asterisk/pjsip.endpoint.conf`
- `/etc/asterisk/pjsip.auth.conf`
- `/etc/asterisk/pjsip.aor.conf`
- `/etc/asterisk/pjsip_custom_post.conf`
- `/etc/asterisk/pjsip.endpoint_custom_post.conf`
- FreePBX database directly
- SaaS database directly

It also does **not** perform reload or restart.

## 11. Example curl

```bash
curl -X PATCH http://localhost:3001/api/pbx/webrtc-accounts/9521/display-name \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"訪客9521-測試"}' | jq .
```

## 12. Example Frontend Usage

A frontend can use this endpoint when the user edits only the account label.

Recommended UI flow:
1. User opens the display name edit dialog.
2. Frontend validates the new value locally.
3. Frontend calls the PATCH endpoint.
4. If `success=true`, update the UI immediately.
5. If the UI later needs Asterisk-side consistency, trigger that in a separate controlled workflow.

## 13. Re-checking Existence After Update

The API reuses the existing `fetchExtension()` query logic before and after the update.
This ensures the display name update is only considered successful after a safe read-back check.

## 14. Related Code Files

- `server/index.js`
  - Adds the PATCH route.
  - Performs input validation and response shaping.

- `server/freepbxApiClient.js`
  - Exposes `updateExtensionDisplayName()`.
  - Reuses the existing FreePBX GraphQL update path.

- `server/freepbxWebrtcExtensionPayload.js`
  - Unchanged by this specific API; still used by the create flow.

## 15. Testing

### Syntax check

```bash
node --check server/index.js
node --check server/freepbxApiClient.js
```

### Existing account

```bash
curl -sS -X PATCH http://localhost:3001/api/pbx/webrtc-accounts/9521/display-name \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"訪客9521-測試"}' | jq .
```

### Re-query the account

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521 \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### Invalid extension

```bash
curl -sS -X PATCH http://localhost:3001/api/pbx/webrtc-accounts/abc/display-name \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"訪客9521-測試"}' | jq .
```

## 16. Safety Boundary

This API:
- does not restart Asterisk
- does not reload Asterisk by itself
- does not write Asterisk config files
- does not write FreePBX DB directly
- does not write SaaS DB directly
- does not output secrets
- keeps all frontend-visible messages in Traditional Chinese

## 17. Summary

Use this endpoint when you need to rename an existing WebRTC account and nothing else.
It is read-only with respect to Asterisk files and only updates the display name through FreePBX GraphQL.
