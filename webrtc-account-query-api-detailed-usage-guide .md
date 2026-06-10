# WebRTC Account Query API Detailed Usage Guide

## 1. API Purpose

This API is a read-only lookup endpoint for WebRTC / PJSIP account existence checks.
It allows the frontend to determine whether a numeric WebRTC extension already exists in FreePBX before attempting creation.

The API does **not** create, update, reload, or delete anything.

## 2. Available Routes

Primary route:

```http
GET /api/pbx/webrtc-accounts/:extension
```

Compatibility route:

```http
GET /api/pbx/webrtc-accounts/check?extension=9521
```

Recommended route style follows the existing `:id`-style API pattern used by the project.

## 3. Authorization

The query endpoint requires the same admin authorization mechanism used by the other PBX APIs.

Example:

```http
Authorization: Bearer <SAAS_ADMIN_TOKEN>
```

No password, cookie, or CSRF token is returned in responses.

## 4. Validation Rules

The `extension` must be numeric only.

Valid examples:
- `9521`
- `9599`

Invalid examples:
- `abc`
- `95-21`
- `95 21`

If the format is invalid, the API returns:

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

## 5. Query Logic

The API reuses the existing FreePBX client query function:

- `server/freepbxApiClient.js -> fetchExtension(extension)`

That function already performs the internal FreePBX GraphQL lookup and includes fallback logic across available extension records.

The query path is read-only.
It does not:
- create extension records
- update passwords
- execute reloads
- write any Asterisk `.conf` files
- write any database rows

## 6. Response Structure

### 6.1 When the account exists

```json
{
  "success": true,
  "message": "WebRTC 帳號已存在",
  "data": {
    "extension": "9521",
    "exists": true,
    "source": "freepbx",
    "summary": {
      "extension": "9521",
      "name": "訪客9521",
      "tech": "pjsip"
    }
  }
}
```

### 6.2 When the account does not exist

```json
{
  "success": true,
  "message": "WebRTC 帳號不存在，可以建立",
  "data": {
    "extension": "9599",
    "exists": false,
    "source": "freepbx",
    "summary": null
  }
}
```

### 6.3 When the format is invalid

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

## 7. Field Semantics

### `success`
- `true` when the request was processed successfully.
- `false` when validation or FreePBX lookup failed.

### `message`
- Human-readable frontend message.
- Always in Traditional Chinese.

### `data.extension`
- The numeric extension that was checked.

### `data.exists`
- `true` if FreePBX contains the extension.
- `false` otherwise.

### `data.source`
- Currently `freepbx`.
- Indicates where the existence check was performed.

### `data.summary`
- Safe summary of the matched account when it exists.
- Contains only non-sensitive fields:
  - `extension`
  - `name`
  - `tech`
- `null` when the account does not exist.

## 8. Error Codes

### `INVALID_WEBRTC_EXTENSION`
Use when the extension is not purely numeric.

### `FREEPBX_EXTENSION_QUERY_FAILED`
Use when the FreePBX lookup fails for backend reasons.

### `WEBRTC_ACCOUNT_QUERY_FAILED`
Use when the caller is not authorized as a platform admin.

## 9. Frontend Integration Pattern

A frontend can call this endpoint before showing the create form or before submitting the create flow.

Typical usage:
1. User enters extension.
2. Frontend calls the query API.
3. If `exists=true`, show “already exists” and stop.
4. If `exists=false`, allow the create flow to continue.
5. If invalid, show the validation error directly.

Suggested frontend display rules:
- `exists=true` -> show a positive existence badge or warning that the number is already taken.
- `exists=false` -> enable the create button.
- invalid format -> block submission.

## 10. Example curl Commands

### Existing extension

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521 \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### Non-existing extension

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9599 \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### Invalid extension

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/abc \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### Compatibility query route

```bash
curl -sS "http://localhost:3001/api/pbx/webrtc-accounts/check?extension=9521" \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

## 11. Relationship To The Create API

This query endpoint is read-only and is intended to be used together with:

```http
POST /api/pbx/webrtc-accounts
```

Recommended frontend flow:
1. Query `GET /api/pbx/webrtc-accounts/:extension` first.
2. If not present, call `POST /api/pbx/webrtc-accounts`.
3. Use the `steps` array from the create API for progress tracking.

## 12. Safety Boundary

This endpoint:
- does not restart Asterisk
- does not run `fwconsole reload`
- does not write `/etc/asterisk/pjsip_custom_post.conf`
- does not write `pjsip.endpoint.conf`
- does not write the FreePBX database
- does not write the SaaS database
- does not return passwords, tokens, cookies, CSRF tokens, or API keys

## 13. Implementation Notes

The endpoint is implemented in `server/index.js` and uses the existing FreePBX client method `fetchExtension()` from `server/freepbxApiClient.js`.

It is intentionally minimal so that it can be safely used by the frontend as a preflight existence check.

## 14. Regression Test Commands

### Syntax checks

```bash
node --check server/index.js
node --check server/webrtcAccountWorkflow.js
node --check server/freepbxApiClient.js
```

### Real server smoke test

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9521 \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

### Missing account smoke test

```bash
curl -sS http://localhost:3001/api/pbx/webrtc-accounts/9599 \
  -H "Authorization: Bearer <SAAS_ADMIN_TOKEN>" | jq .
```

## 15. Summary

Use this endpoint when the frontend needs to know whether a numeric WebRTC extension is already present in FreePBX.
It is read-only, safe, and returns a clear existence flag plus a safe summary when the account exists.
