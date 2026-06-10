# WebRTC Call Logs API Guide

## Endpoint

```http
GET /api/pbx/webrtc-accounts/:extension/call-logs
```

## Purpose

Query WebRTC call event logs from FreePBX/Asterisk CEL data.

The API is read-only:

- Does not restart Asterisk.
- Does not reload FreePBX/Asterisk.
- Does not write Asterisk conf.
- Does not modify FreePBX database.
- Does not modify existing APIs.

## Auth

- Requires existing `requireAdmin` middleware.
- Only platform admins can query.

## Query Parameters

```text
dateFrom=YYYY-MM-DD
dateTo=YYYY-MM-DD
source=
destination=
eventType=
application=
linkedId=
limit=50
offset=0
order=desc|asc
```

## Example

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://127.0.0.1:3001/api/pbx/webrtc-accounts/9520/call-logs?dateFrom=2026-06-01&dateTo=2026-06-10&limit=20"
```

## Success Response Shape

```json
{
  "success": true,
  "message": "WebRTC 呼叫日誌已取得",
  "data": {
    "extension": "9520",
    "source": "freepbx_cel",
    "total": 1,
    "limit": 20,
    "offset": 0,
    "count": 1,
    "calls": [
      {
        "linkedId": "example-linked-id",
        "eventTime": "2026-06-10T10:00:00.000Z",
        "endTime": "2026-06-10T10:01:00.000Z",
        "durationSeconds": 60,
        "cidName": "",
        "cidNumber": "9520",
        "extension": "1000",
        "channelName": "PJSIP/9520-00000001",
        "eventCount": 3,
        "events": []
      }
    ]
  }
}
```

## Implementation

Code:

```text
server/celCallLogService.js
server/index.js
```

Route:

```text
GET /api/pbx/webrtc-accounts/:extension/call-logs
```

Data source:

```text
asteriskcdrdb.cel
```

The service groups CEL rows by `linkedid` and returns each grouped call with its event list.

## Verification

```bash
node --check server/index.js
node --check server/celCallLogService.js
```
