# Stats API Contract

> **Satsu API — Dashboard Statistics**

## Conventions

| Item | Value |
|------|-------|
| Base URL | `http://host:8400/api` |
| Content-Type | `application/json` |
| Timestamps | ISO 8601 with milliseconds (`2026-02-23T14:30:00.000Z`) |
| Error format | `{"error": {"code": "ERROR_CODE", "message": "Human-readable message", "details": {}}}` |
| Status codes | 200 success, 500 internal error |
| Auth (optional) | `X-API-Key` header on device endpoints when enabled |

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Dashboard statistics |

---

## GET `/api/stats`

Returns aggregate statistics for the dashboard, including totals, device status, recent batches, status distribution, and storage backend states.

### Request

```http
GET /api/stats HTTP/1.1
```

### Response — 200 OK

```json
{
  "total_batches": 147,
  "total_pages": 1203,
  "total_size_bytes": 2576980377,
  "devices_online": 2,
  "devices_total": 3,
  "recent_batches": [
    {
      "id": "a1b2c3d4",
      "status": "completed",
      "page_count": 3,
      "created_at": "2026-02-23T14:30:00.000Z"
    },
    {
      "id": "e5f6g7h8",
      "status": "processing",
      "page_count": 5,
      "created_at": "2026-02-23T14:25:00.000Z"
    },
    {
      "id": "i9j0k1l2",
      "status": "exported",
      "page_count": 1,
      "created_at": "2026-02-23T14:00:00.000Z"
    },
    {
      "id": "m3n4o5p6",
      "status": "error",
      "page_count": 2,
      "created_at": "2026-02-23T13:45:00.000Z"
    },
    {
      "id": "q7r8s9t0",
      "status": "completed",
      "page_count": 8,
      "created_at": "2026-02-23T12:00:00.000Z"
    }
  ],
  "status_counts": {
    "pending": 0,
    "processing": 1,
    "completed": 140,
    "error": 4,
    "export_failed": 2
  },
  "storage_backends": [
    {
      "name": "Local",
      "type": "local",
      "enabled": true,
      "last_export": "2026-02-23T14:30:00.000Z"
    },
    {
      "name": "Paperless-ngx",
      "type": "paperless",
      "enabled": true,
      "last_export": "2026-02-23T14:15:00.000Z"
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `total_batches` | integer | Total number of scan batches |
| `total_pages` | integer | Total number of pages across all batches |
| `total_size_bytes` | integer | Total storage used in bytes (originals + processed) |
| `devices_online` | integer | Number of devices currently online (last_seen within threshold) |
| `devices_total` | integer | Total number of registered devices |
| `recent_batches` | array | Up to 5 most recent batches (summary objects) |
| `status_counts` | object | Count of batches grouped by status |
| `storage_backends` | array | Configured storage backends with status |

### Recent Batch Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Batch identifier |
| `status` | string | Current batch status |
| `page_count` | integer | Number of pages in the batch |
| `created_at` | string | ISO 8601 creation timestamp |

### Status Counts Object

| Field | Type | Description |
|-------|------|-------------|
| `pending` | integer | Batches awaiting processing |
| `processing` | integer | Batches currently being processed |
| `completed` | integer | Successfully processed batches |
| `error` | integer | Batches that failed processing |
| `export_failed` | integer | Batches where export to one or more backends failed |

### Storage Backend Object

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Backend display name |
| `type` | string | Backend type: `"local"`, `"paperless"` |
| `enabled` | boolean | Whether the backend is enabled for exports |
| `last_export` | string or null | ISO 8601 timestamp of last successful export, or `null` if never exported |
