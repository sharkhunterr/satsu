# Scans API Contract

> **ESPScanCam API — Scan Batch Management**

## Conventions

| Item | Value |
|------|-------|
| Base URL | `http://host:8400/api` |
| Content-Type | `application/json` (except image uploads: `image/jpeg`) |
| Timestamps | ISO 8601 with milliseconds (`2026-02-23T14:30:00.000Z`) |
| Pagination | Cursor-based (base64-encoded JSON cursor) |
| Error format | `{"error": {"code": "ERROR_CODE", "message": "Human-readable message", "details": {}}}` |
| Status codes | 200 success, 201 created, 202 accepted, 400 bad request, 403 forbidden (API key), 404 not found, 422 validation error, 500 internal error |
| Auth (optional) | `X-API-Key` header on device endpoints when enabled |

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/scan/batch` | Create empty batch |
| POST | `/api/scan/upload/{batch_id}/{page_index}` | Upload page image |
| POST | `/api/scan/process/{batch_id}` | Trigger processing |
| POST | `/api/scan/web-upload` | Combined create batch + upload pages |
| GET | `/api/scans` | List batches |
| GET | `/api/scans/{id}` | Get batch detail |
| DELETE | `/api/scans/{id}` | Delete batch and files |
| POST | `/api/scans/{id}/reprocess` | Reprocess batch |
| POST | `/api/scans/{id}/export` | Export to backends |
| POST | `/api/scans/bulk` | Bulk action on multiple batches |

---

## Batch Object

The batch object is the core data model for scans:

```json
{
  "id": "a1b2c3d4",
  "status": "completed",
  "source_type": "esp32cam",
  "device_mac": "AA:BB:CC:DD:EE:FF",
  "device_name": "Office Scanner",
  "profile": "default",
  "page_count": 3,
  "file_size": 2457600,
  "created_at": "2026-02-23T14:30:00.000Z",
  "updated_at": "2026-02-23T14:31:00.000Z",
  "processed_at": "2026-02-23T14:31:00.000Z",
  "exported_at": "2026-02-23T14:32:00.000Z",
  "pages": []
}
```

### Batch Statuses

| Status | Description |
|--------|-------------|
| `pending` | Batch created, awaiting pages or processing trigger |
| `processing` | Image processing pipeline is running |
| `completed` | Processing finished successfully |
| `error` | Processing failed (see logs for details) |
| `exporting` | Export to backends in progress |
| `export_failed` | Export to one or more backends failed |
| `exported` | Successfully exported to all configured backends |

### Page Object

```json
{
  "index": 0,
  "original_url": "/storage/batches/a1b2c3d4/originals/page_000.jpg",
  "processed_url": "/storage/batches/a1b2c3d4/processed/page_000.jpg",
  "thumbnail_url": "/storage/batches/a1b2c3d4/thumbnails/page_000.jpg",
  "original_size": 819200,
  "processed_size": 614400,
  "width": 1600,
  "height": 1200,
  "uploaded_at": "2026-02-23T14:30:05.000Z",
  "processed_at": "2026-02-23T14:31:00.000Z"
}
```

---

## POST `/api/scan/batch`

Create a new empty batch. Pages are uploaded separately via the upload endpoint.

### Request

```http
POST /api/scan/batch HTTP/1.1
Content-Type: application/json
```

```json
{
  "source_type": "esp32cam",
  "device_mac": "AA:BB:CC:DD:EE:FF",
  "profile": "default"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source_type` | string | yes | `"esp32cam"` or `"web_upload"` |
| `device_mac` | string | no | MAC of the source device (required when `source_type` is `"esp32cam"`) |
| `profile` | string | no | Processing profile name. Defaults to `"default"` |

### Response — 201 Created

```json
{
  "id": "a1b2c3d4",
  "status": "pending",
  "source_type": "esp32cam",
  "device_mac": "AA:BB:CC:DD:EE:FF",
  "device_name": "Office Scanner",
  "profile": "default",
  "page_count": 0,
  "file_size": 0,
  "created_at": "2026-02-23T14:30:00.000Z",
  "updated_at": "2026-02-23T14:30:00.000Z",
  "processed_at": null,
  "exported_at": null,
  "pages": []
}
```

### Errors

| Code | Condition |
|------|-----------|
| 400 | Missing `source_type` |
| 404 | Device MAC not found (when provided) |
| 422 | Unknown profile name |

---

## POST `/api/scan/upload/{batch_id}/{page_index}`

Upload a single page image to an existing batch. The page index is zero-based and must be sequential (no gaps allowed).

### Request

```http
POST /api/scan/upload/a1b2c3d4/0 HTTP/1.1
Content-Type: image/jpeg

<raw JPEG bytes>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `batch_id` | path | Batch identifier |
| `page_index` | path | Zero-based page index |

### Response — 200 OK

```json
{
  "batch_id": "a1b2c3d4",
  "page": {
    "index": 0,
    "original_url": "/storage/batches/a1b2c3d4/originals/page_000.jpg",
    "processed_url": null,
    "thumbnail_url": "/storage/batches/a1b2c3d4/thumbnails/page_000.jpg",
    "original_size": 819200,
    "processed_size": null,
    "width": 1600,
    "height": 1200,
    "uploaded_at": "2026-02-23T14:30:05.000Z",
    "processed_at": null
  }
}
```

### Errors

| Code | Condition |
|------|-----------|
| 400 | Empty body or missing Content-Type |
| 404 | Batch not found |
| 422 | Invalid JPEG, page index out of sequence, or batch not in `pending` status |
| 500 | Failed to write image to disk |

---

## POST `/api/scan/process/{batch_id}`

Trigger the image processing pipeline for a batch. Processing is asynchronous -- the endpoint returns immediately with 202, and progress is reported via WebSocket events.

### Request

```http
POST /api/scan/process/a1b2c3d4 HTTP/1.1
Content-Type: application/json
```

```json
{
  "profile": "document-standard"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profile` | string | no | Override the batch's assigned profile. If omitted, uses the batch's existing profile. |

### Response — 202 Accepted

```json
{
  "batch_id": "a1b2c3d4",
  "status": "processing",
  "profile": "document-standard",
  "page_count": 3,
  "message": "Processing started"
}
```

### Errors

| Code | Condition |
|------|-----------|
| 404 | Batch not found |
| 422 | Batch has no pages, unknown profile, or batch is already processing |

---

## POST `/api/scan/web-upload`

Combined endpoint to create a batch and upload all pages in a single multipart request. Designed for the web UI upload flow.

### Request

```http
POST /api/scan/web-upload HTTP/1.1
Content-Type: multipart/form-data; boundary=----FormBoundary

------FormBoundary
Content-Disposition: form-data; name="profile"

document-standard
------FormBoundary
Content-Disposition: form-data; name="files[]"; filename="scan_001.jpg"
Content-Type: image/jpeg

<raw JPEG bytes>
------FormBoundary
Content-Disposition: form-data; name="files[]"; filename="scan_002.jpg"
Content-Type: image/jpeg

<raw JPEG bytes>
------FormBoundary--
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profile` | form field | no | Processing profile name. Defaults to `"default"` |
| `files[]` | file(s) | yes | One or more JPEG image files |

### Response — 201 Created

```json
{
  "id": "e5f6g7h8",
  "status": "pending",
  "source_type": "web_upload",
  "device_mac": null,
  "device_name": null,
  "profile": "document-standard",
  "page_count": 2,
  "file_size": 1638400,
  "created_at": "2026-02-23T15:00:00.000Z",
  "updated_at": "2026-02-23T15:00:01.000Z",
  "processed_at": null,
  "exported_at": null,
  "pages": [
    {
      "index": 0,
      "original_url": "/storage/batches/e5f6g7h8/originals/page_000.jpg",
      "processed_url": null,
      "thumbnail_url": "/storage/batches/e5f6g7h8/thumbnails/page_000.jpg",
      "original_size": 819200,
      "processed_size": null,
      "width": 1600,
      "height": 1200,
      "uploaded_at": "2026-02-23T15:00:00.000Z",
      "processed_at": null
    },
    {
      "index": 1,
      "original_url": "/storage/batches/e5f6g7h8/originals/page_001.jpg",
      "processed_url": null,
      "thumbnail_url": "/storage/batches/e5f6g7h8/thumbnails/page_001.jpg",
      "original_size": 819200,
      "processed_size": null,
      "width": 1600,
      "height": 1200,
      "uploaded_at": "2026-02-23T15:00:01.000Z",
      "processed_at": null
    }
  ]
}
```

### Errors

| Code | Condition |
|------|-----------|
| 400 | No files provided |
| 422 | Invalid JPEG file(s) or unknown profile |
| 500 | Failed to write images to disk |

---

## GET `/api/scans`

List batches with filtering, sorting, and cursor-based pagination.

### Request

```http
GET /api/scans?limit=25&status[]=completed&status[]=error&sort=created_at&order=desc HTTP/1.1
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `cursor` | string | — | Base64-encoded pagination cursor from previous response |
| `limit` | integer | 25 | Results per page: `25`, `50`, or `100` |
| `status[]` | string[] | — | Filter by status(es): `pending`, `processing`, `completed`, `error`, `exporting`, `export_failed`, `exported` |
| `device_mac` | string | — | Filter by source device MAC |
| `date_from` | string | — | ISO 8601 date, inclusive lower bound |
| `date_to` | string | — | ISO 8601 date, inclusive upper bound |
| `page_min` | integer | — | Minimum page count |
| `page_max` | integer | — | Maximum page count |
| `sort` | string | `created_at` | Sort field: `created_at`, `status`, `page_count`, `file_size` |
| `order` | string | `desc` | Sort order: `asc` or `desc` |
| `search` | string | — | Free-text search across batch ID, device name |

### Response — 200 OK

```json
{
  "items": [
    {
      "id": "a1b2c3d4",
      "status": "completed",
      "source_type": "esp32cam",
      "device_mac": "AA:BB:CC:DD:EE:FF",
      "device_name": "Office Scanner",
      "profile": "default",
      "page_count": 3,
      "file_size": 2457600,
      "created_at": "2026-02-23T14:30:00.000Z",
      "updated_at": "2026-02-23T14:31:00.000Z",
      "processed_at": "2026-02-23T14:31:00.000Z",
      "exported_at": "2026-02-23T14:32:00.000Z"
    }
  ],
  "cursor": "eyJpZCI6ImExYjJjM2Q0Iiwic29ydCI6ImNyZWF0ZWRfYXQifQ==",
  "total": 147,
  "stats": {
    "scans": 147,
    "pages": 1203,
    "bytes": 2576980377
  }
}
```

The `cursor` field is `null` when there are no more results. The `stats` object reflects the totals for the current filter (not the current page).

---

## GET `/api/scans/{id}`

Get full batch detail including the pages array.

### Request

```http
GET /api/scans/a1b2c3d4 HTTP/1.1
```

### Response — 200 OK

```json
{
  "id": "a1b2c3d4",
  "status": "completed",
  "source_type": "esp32cam",
  "device_mac": "AA:BB:CC:DD:EE:FF",
  "device_name": "Office Scanner",
  "profile": "default",
  "page_count": 3,
  "file_size": 2457600,
  "created_at": "2026-02-23T14:30:00.000Z",
  "updated_at": "2026-02-23T14:31:00.000Z",
  "processed_at": "2026-02-23T14:31:00.000Z",
  "exported_at": "2026-02-23T14:32:00.000Z",
  "pages": [
    {
      "index": 0,
      "original_url": "/storage/batches/a1b2c3d4/originals/page_000.jpg",
      "processed_url": "/storage/batches/a1b2c3d4/processed/page_000.jpg",
      "thumbnail_url": "/storage/batches/a1b2c3d4/thumbnails/page_000.jpg",
      "original_size": 819200,
      "processed_size": 614400,
      "width": 1600,
      "height": 1200,
      "uploaded_at": "2026-02-23T14:30:05.000Z",
      "processed_at": "2026-02-23T14:31:00.000Z"
    },
    {
      "index": 1,
      "original_url": "/storage/batches/a1b2c3d4/originals/page_001.jpg",
      "processed_url": "/storage/batches/a1b2c3d4/processed/page_001.jpg",
      "thumbnail_url": "/storage/batches/a1b2c3d4/thumbnails/page_001.jpg",
      "original_size": 819200,
      "processed_size": 614400,
      "width": 1600,
      "height": 1200,
      "uploaded_at": "2026-02-23T14:30:10.000Z",
      "processed_at": "2026-02-23T14:31:00.000Z"
    },
    {
      "index": 2,
      "original_url": "/storage/batches/a1b2c3d4/originals/page_002.jpg",
      "processed_url": "/storage/batches/a1b2c3d4/processed/page_002.jpg",
      "thumbnail_url": "/storage/batches/a1b2c3d4/thumbnails/page_002.jpg",
      "original_size": 819200,
      "processed_size": 614400,
      "width": 1600,
      "height": 1200,
      "uploaded_at": "2026-02-23T14:30:15.000Z",
      "processed_at": "2026-02-23T14:31:00.000Z"
    }
  ]
}
```

### Errors

| Code | Condition |
|------|-----------|
| 404 | Batch not found |

---

## DELETE `/api/scans/{id}`

Delete a batch and all associated files (originals, processed, thumbnails, exports).

### Request

```http
DELETE /api/scans/a1b2c3d4 HTTP/1.1
```

### Response — 200 OK

```json
{
  "message": "Batch deleted",
  "id": "a1b2c3d4",
  "pages_removed": 3,
  "bytes_freed": 6144000
}
```

### Errors

| Code | Condition |
|------|-----------|
| 404 | Batch not found |

---

## POST `/api/scans/{id}/reprocess`

Reprocess an existing batch, optionally with a different processing profile. The batch must be in `completed`, `error`, or `export_failed` status.

### Request

```http
POST /api/scans/a1b2c3d4/reprocess HTTP/1.1
Content-Type: application/json
```

```json
{
  "profile": "receipt"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profile` | string | no | Override profile. If omitted, reuses the batch's current profile. |

### Response — 202 Accepted

```json
{
  "batch_id": "a1b2c3d4",
  "status": "processing",
  "profile": "receipt",
  "page_count": 3,
  "message": "Reprocessing started"
}
```

### Errors

| Code | Condition |
|------|-----------|
| 404 | Batch not found |
| 422 | Batch is in `pending` or `processing` status, or unknown profile |

---

## POST `/api/scans/{id}/export`

Export a completed batch to one or more configured storage backends. If no backends are specified, exports to all enabled backends.

### Request

```http
POST /api/scans/a1b2c3d4/export HTTP/1.1
Content-Type: application/json
```

```json
{
  "backends": ["paperless", "local"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `backends` | string[] | no | Target backend names. Defaults to all configured and enabled backends. |

### Response — 202 Accepted

```json
{
  "batch_id": "a1b2c3d4",
  "status": "exporting",
  "backends": ["paperless", "local"],
  "message": "Export started"
}
```

### Errors

| Code | Condition |
|------|-----------|
| 404 | Batch not found |
| 422 | Batch not in `completed` or `export_failed` status, or unknown backend name |

---

## POST `/api/scans/bulk`

Perform a bulk action on multiple batches at once.

### Request

```http
POST /api/scans/bulk HTTP/1.1
Content-Type: application/json
```

```json
{
  "action": "delete",
  "ids": ["a1b2c3d4", "e5f6g7h8", "i9j0k1l2"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | yes | One of: `"delete"`, `"reprocess"`, `"export"` |
| `ids` | string[] | yes | Array of batch IDs to act on |

### Response — 200 OK

Response for `"delete"` action:

```json
{
  "action": "delete",
  "results": [
    {"id": "a1b2c3d4", "success": true},
    {"id": "e5f6g7h8", "success": true},
    {"id": "i9j0k1l2", "success": false, "error": "Batch not found"}
  ],
  "succeeded": 2,
  "failed": 1
}
```

Response for `"reprocess"` action:

```json
{
  "action": "reprocess",
  "results": [
    {"id": "a1b2c3d4", "success": true, "status": "processing"},
    {"id": "e5f6g7h8", "success": false, "error": "Batch is currently processing"}
  ],
  "succeeded": 1,
  "failed": 1
}
```

Response for `"export"` action:

```json
{
  "action": "export",
  "results": [
    {"id": "a1b2c3d4", "success": true, "status": "exporting"},
    {"id": "e5f6g7h8", "success": true, "status": "exporting"}
  ],
  "succeeded": 2,
  "failed": 0
}
```

### Errors

| Code | Condition |
|------|-----------|
| 400 | Missing `action` or `ids`, or empty `ids` array |
| 422 | Unknown action |
