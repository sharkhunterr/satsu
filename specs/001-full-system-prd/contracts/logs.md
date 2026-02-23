# Logs API Contract

> **ESPScanCam API — Log Management**

## Conventions

| Item | Value |
|------|-------|
| Base URL | `http://host:8400/api` |
| Content-Type | `application/json` |
| Timestamps | ISO 8601 with milliseconds (`2026-02-23T14:30:00.000Z`) |
| Pagination | Cursor-based (base64-encoded JSON cursor) |
| Error format | `{"error": {"code": "ERROR_CODE", "message": "Human-readable message", "details": {}}}` |
| Status codes | 200 success, 400 bad request, 403 forbidden (API key), 422 validation error, 500 internal error |
| Auth (optional) | `X-API-Key` header on device endpoints when enabled |

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/logs` | Query logs with filtering and pagination |
| DELETE | `/api/logs` | Purge logs matching criteria |
| GET | `/api/logs/export` | Export filtered logs as file download |

---

## Log Entry Object

```json
{
  "id": 12345,
  "timestamp": 1708700000123,
  "level": "ERROR",
  "category": "processing",
  "source": "batch:a1b2c3d4",
  "device_mac": null,
  "message": "Auto-crop failed: no document edges detected",
  "details": {
    "batch_id": "a1b2c3d4",
    "page_index": 2,
    "step": "auto_crop",
    "duration_ms": 342,
    "error": "No contour with 4 points found"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Unique auto-incrementing log entry ID |
| `timestamp` | integer | Unix timestamp in milliseconds |
| `level` | string | Log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `category` | string | Log category: `device`, `capture`, `processing`, `export`, `system`, `api` |
| `source` | string | Source identifier (e.g. `batch:a1b2c3d4`, `device:AA:BB:CC:DD:EE:FF`, `system`) |
| `device_mac` | string or null | Associated device MAC, if applicable |
| `message` | string | Human-readable log message |
| `details` | object or null | Structured context data (varies by event type) |

### Log Levels

| Level | Description |
|-------|-------------|
| `DEBUG` | Detailed diagnostic information |
| `INFO` | Normal operational events (device registered, batch created, processing completed) |
| `WARN` | Warnings that may indicate issues (slow processing, low disk space) |
| `ERROR` | Errors that need attention (processing failed, export failed, device communication error) |

### Log Categories

| Category | Description |
|----------|-------------|
| `device` | Device registration, heartbeat, online/offline transitions |
| `capture` | Image capture events from devices |
| `processing` | Image processing pipeline steps and results |
| `export` | Export operations to storage backends |
| `system` | Server startup, shutdown, configuration changes |
| `api` | API request errors and notable events |

---

## GET `/api/logs`

Query logs with filtering, sorting, and cursor-based pagination. Results are returned in reverse chronological order by default (newest first).

### Request

```http
GET /api/logs?limit=50&level[]=ERROR&level[]=WARN&category[]=processing&search=auto-crop HTTP/1.1
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | — | Base64-encoded pagination cursor from previous response |
| `limit` | integer | 50 | Results per page (max 100) |
| `level[]` | string[] | — | Filter by level(s): `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `category[]` | string[] | — | Filter by category/categories: `device`, `capture`, `processing`, `export`, `system`, `api` |
| `device_mac` | string | — | Filter by associated device MAC |
| `source` | string | — | Filter by source identifier (exact match) |
| `search` | string | — | Free-text search across message and details |
| `date_from` | string | — | ISO 8601 date, inclusive lower bound |
| `date_to` | string | — | ISO 8601 date, inclusive upper bound |

### Response — 200 OK

```json
{
  "items": [
    {
      "id": 12345,
      "timestamp": 1708700000123,
      "level": "ERROR",
      "category": "processing",
      "source": "batch:a1b2c3d4",
      "device_mac": null,
      "message": "Auto-crop failed: no document edges detected",
      "details": {
        "batch_id": "a1b2c3d4",
        "page_index": 2,
        "step": "auto_crop",
        "duration_ms": 342,
        "error": "No contour with 4 points found"
      }
    },
    {
      "id": 12340,
      "timestamp": 1708699500000,
      "level": "WARN",
      "category": "processing",
      "source": "batch:a1b2c3d4",
      "device_mac": null,
      "message": "Deskew angle exceeds threshold, skipping correction",
      "details": {
        "batch_id": "a1b2c3d4",
        "page_index": 1,
        "step": "deskew",
        "detected_angle": 22.5,
        "max_angle": 15
      }
    }
  ],
  "cursor": "eyJpZCI6MTIzNDAsImRpciI6Im5leHQifQ==",
  "total": 234
}
```

The `cursor` field is `null` when there are no more results.

---

## DELETE `/api/logs`

Purge logs matching the specified criteria. At least one filter parameter must be provided to prevent accidental deletion of all logs.

### Request

```http
DELETE /api/logs?before=2026-02-01T00:00:00.000Z&level=DEBUG HTTP/1.1
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `before` | string | no | Delete logs before this ISO 8601 date |
| `level` | string | no | Delete logs at or below this level (e.g. `DEBUG` deletes only DEBUG, `INFO` deletes DEBUG and INFO) |
| `category` | string | no | Delete logs in this category only |

At least one of `before`, `level`, or `category` must be provided.

### Response — 200 OK

```json
{
  "message": "Logs purged",
  "deleted_count": 1542
}
```

### Errors

| Code | Condition |
|------|-----------|
| 400 | No filter parameters provided |
| 422 | Invalid date format or unknown level/category |

---

## GET `/api/logs/export`

Export logs matching the filter criteria as a downloadable file. Supports the same filter parameters as `GET /api/logs` plus a `format` parameter.

### Request

```http
GET /api/logs/export?level[]=ERROR&format=json HTTP/1.1
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | — | Base64-encoded pagination cursor |
| `limit` | integer | — | Max entries to export (omit for all matching) |
| `level[]` | string[] | — | Filter by level(s) |
| `category[]` | string[] | — | Filter by category/categories |
| `device_mac` | string | — | Filter by device MAC |
| `source` | string | — | Filter by source identifier |
| `search` | string | — | Free-text search |
| `date_from` | string | — | ISO 8601 lower bound |
| `date_to` | string | — | ISO 8601 upper bound |
| `format` | string | `"log"` | Export format: `"log"` (plain text) or `"json"` (JSON array) |

### Response — 200 OK (format=log)

```http
HTTP/1.1 200 OK
Content-Type: text/plain
Content-Disposition: attachment; filename="espscancam-logs-2026-02-23.log"
```

```
2026-02-23T14:30:00.123Z [ERROR] [processing] batch:a1b2c3d4 - Auto-crop failed: no document edges detected
2026-02-23T14:25:00.000Z [WARN] [processing] batch:a1b2c3d4 - Deskew angle exceeds threshold, skipping correction
2026-02-23T14:20:00.000Z [INFO] [capture] device:AA:BB:CC:DD:EE:FF - Page captured (batch: a1b2c3d4, page: 0)
```

### Response — 200 OK (format=json)

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Disposition: attachment; filename="espscancam-logs-2026-02-23.json"
```

```json
[
  {
    "id": 12345,
    "timestamp": 1708700000123,
    "level": "ERROR",
    "category": "processing",
    "source": "batch:a1b2c3d4",
    "device_mac": null,
    "message": "Auto-crop failed: no document edges detected",
    "details": {
      "batch_id": "a1b2c3d4",
      "page_index": 2,
      "step": "auto_crop",
      "duration_ms": 342,
      "error": "No contour with 4 points found"
    }
  }
]
```

### Errors

| Code | Condition |
|------|-----------|
| 422 | Invalid filter values or unknown format |
