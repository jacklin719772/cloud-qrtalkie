# WebRTC Presence API Guide

## Purpose

This API returns the latest known WebRTC account presence state and recent online/offline status-change events.

It is independent from the existing realtime status API:

- Existing realtime status API: current snapshot from Asterisk CLI.
- New presence API: stored state/history collected by SaaS polling.

## Data Source

The Node API background poller periodically:

1. Reads WebRTC account extensions from SaaS `web_users`.
2. Queries current Asterisk PJSIP endpoint status.
3. Writes only to SaaS-owned tables:
   - `webrtc_account_presence_state`
   - `webrtc_account_presence_events`

It does not modify FreePBX DB, Asterisk conf, or existing API behavior.

## Endpoint

```http
GET /api/pbx/webrtc-accounts/:extension/presence
```

Example:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:3001/api/pbx/webrtc-accounts/9520/presence"
```

## Auth

- Requires existing `requireAdmin` middleware.
- Only platform admins are allowed.

## Success Response

```json
{
  "success": true,
  "message": "WebRTC 在線狀態已取得",
  "data": {
    "extension": "9520",
    "initialized": true,
    "status": "online",
    "statusText": "在線",
    "previousStatus": "offline",
    "onlineAt": "2026-06-10T10:00:00.000Z",
    "offlineAt": "2026-06-10T09:55:00.000Z",
    "lastSeenAt": "2026-06-10T10:01:00.000Z",
    "lastChangedAt": "2026-06-10T10:00:00.000Z",
    "lastCheckedAt": "2026-06-10T10:01:00.000Z",
    "source": "asterisk_poll",
    "recentEvents": [
      {
        "previousStatus": "offline",
        "status": "online",
        "statusText": "在線",
        "changedAt": "2026-06-10T10:00:00.000Z",
        "source": "asterisk_poll"
      }
    ]
  }
}
```

## Fields

- `status`: `online`, `offline`, `not_found`, or `unknown`.
- `onlineAt`: last time the account changed into `online`.
- `offlineAt`: last time the account changed away from `online`.
- `lastSeenAt`: latest poll time while the account was online.
- `lastChangedAt`: latest detected status transition time.
- `lastCheckedAt`: latest poll time.
- `recentEvents`: latest 20 status-change events.
- `initialized`: false means the poller has not recorded this extension yet.

## Error Responses

Invalid extension:

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

Missing migration/table:

```json
{
  "success": false,
  "message": "WebRTC 在線狀態查詢失敗",
  "error": {
    "code": "WEBRTC_PRESENCE_TABLE_MISSING",
    "message": "WebRTC 在線狀態查詢失敗"
  }
}
```

## Poller Configuration

Optional environment variables:

```text
WEBRTC_PRESENCE_POLL_ENABLED=false       # disable poller
WEBRTC_PRESENCE_POLL_INTERVAL_MS=30000   # default 30s
WEBRTC_PRESENCE_INITIAL_DELAY_MS=10000   # default 10s
WEBRTC_PRESENCE_BATCH_LIMIT=500          # max extensions per poll
WEBRTC_PRESENCE_EXTENSIONS=9520,9521     # optional fixed list
```

## Migration

New migration:

```text
migrations/060_webrtc_presence_history.sql
```

Creates:

```text
webrtc_account_presence_state
webrtc_account_presence_events
```

## Verification Commands

Syntax:

```bash
node --check server/index.js
node --check server/webrtcPresenceService.js
```

Manual one-shot poll:

```bash
node --input-type=module -e "import { pool } from './server/db.js'; import { pollWebrtcPresence } from './server/webrtcPresenceService.js'; try { const result = await pollWebrtcPresence({ domain: process.env.WEBRTC_DOMAIN || process.env.webrtc_domain || 'pbx.qrtalkie.org', batchLimit: 20 }); console.log(JSON.stringify(result)); } finally { await pool.end(); }"
```

Table count check:

```bash
node --input-type=module -e "import 'dotenv/config'; import * as mariadb from 'mariadb'; const pool = mariadb.createPool({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: process.env.DB_SSL === 'true', connectionLimit: 1 }); let connection; try { connection = await pool.getConnection(); const state = await connection.query('SELECT COUNT(*) AS cnt FROM webrtc_account_presence_state'); const events = await connection.query('SELECT COUNT(*) AS cnt FROM webrtc_account_presence_events'); console.log(JSON.stringify({ stateRows: Number(state[0].cnt), eventRows: Number(events[0].cnt) })); } finally { if (connection) connection.release(); await pool.end(); }"
```

## Operational Notes

- Restart only the Node API process to load the new route and poller.
- Do not restart Asterisk.
- No FreePBX reload is required.
- No Asterisk conf is written.
- No FreePBX database tables are modified.
