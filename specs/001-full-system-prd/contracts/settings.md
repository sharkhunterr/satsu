# Settings API Contract

> **ESPScanCam API — Configuration & Profiles**

## Conventions

| Item | Value |
|------|-------|
| Base URL | `http://host:8400/api` |
| Content-Type | `application/json` |
| Timestamps | ISO 8601 with milliseconds (`2026-02-23T14:30:00.000Z`) |
| Pagination | Cursor-based (base64-encoded JSON cursor) |
| Error format | `{"error": {"code": "ERROR_CODE", "message": "Human-readable message", "details": {}}}` |
| Status codes | 200 success, 201 created, 400 bad request, 403 forbidden (API key), 404 not found, 422 validation error, 500 internal error |
| Auth (optional) | `X-API-Key` header on device endpoints when enabled |

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Full config object |
| PUT | `/api/settings` | Replace full config |
| PATCH | `/api/settings/{section}` | Update one section |
| POST | `/api/settings/test-storage` | Test backend connection |
| GET | `/api/settings/profiles` | List all profiles |
| POST | `/api/settings/profiles` | Create profile |
| PUT | `/api/settings/profiles/{id}` | Update profile |
| DELETE | `/api/settings/profiles/{id}` | Delete profile |
| POST | `/api/settings/backup` | Download config as JSON |
| POST | `/api/settings/restore` | Upload and apply config JSON |

---

## Full Settings Object

The settings object contains seven sections: `general`, `capture`, `processing`, `storage`, `notifications`, `logs`, and `system`.

```json
{
  "general": {
    "server_name": "ESPScanCam",
    "language": "en",
    "timezone": "UTC",
    "api_key_enabled": false,
    "api_key": "",
    "auto_process": true,
    "auto_export": false,
    "default_profile": "default",
    "batch_timeout_seconds": 300
  },
  "capture": {
    "default_resolution": "UXGA",
    "default_quality": 90,
    "default_flash": false,
    "heartbeat_interval_seconds": 60,
    "online_threshold_seconds": 180,
    "max_pages_per_batch": 50
  },
  "processing": {
    "max_concurrent": 2,
    "thumbnail_size": 300,
    "keep_originals": true,
    "default_profile_options": {
      "auto_crop": {"enabled": true, "sensitivity": 50},
      "deskew": {"enabled": true, "max_angle": 15},
      "denoise": {"enabled": true, "strength": 10},
      "clahe": {"enabled": true, "clip_limit": 2.0, "grid_size": 8},
      "sharpen": {"enabled": true, "amount": 1.5},
      "white_balance": {"enabled": true},
      "bw_mode": {"enabled": false, "method": "adaptive", "block_size": 11, "constant": 2},
      "output": {"format": "pdf", "quality": 85, "dpi": 300}
    }
  },
  "storage": {
    "base_path": "./storage",
    "backends": [
      {
        "name": "Local",
        "type": "local",
        "enabled": true,
        "path": "./exports"
      },
      {
        "name": "Paperless-ngx",
        "type": "paperless",
        "enabled": false,
        "url": "http://paperless:8000",
        "token": "",
        "verify_ssl": true
      }
    ]
  },
  "notifications": {
    "enabled": false,
    "on_scan_complete": true,
    "on_export_complete": true,
    "on_error": true,
    "channels": [
      {
        "type": "webhook",
        "enabled": false,
        "url": "",
        "headers": {}
      }
    ]
  },
  "logs": {
    "level": "INFO",
    "max_entries": 10000,
    "auto_purge_days": 30,
    "categories": ["device", "capture", "processing", "export", "system", "api"]
  },
  "system": {
    "version": "1.0.0",
    "data_dir": "./data",
    "port": 8400,
    "host": "0.0.0.0",
    "cors_origins": ["*"]
  }
}
```

---

## Settings Sections Detail

### `general`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `server_name` | string | `"ESPScanCam"` | Display name for the server instance |
| `language` | string | `"en"` | UI language code |
| `timezone` | string | `"UTC"` | Server timezone (IANA format) |
| `api_key_enabled` | boolean | `false` | Require API key for device endpoints |
| `api_key` | string | `""` | The API key value (when enabled) |
| `auto_process` | boolean | `true` | Automatically start processing when batch timeout expires or device goes offline |
| `auto_export` | boolean | `false` | Automatically export after processing completes |
| `default_profile` | string | `"default"` | Default processing profile for new batches |
| `batch_timeout_seconds` | integer | `300` | Seconds of inactivity before auto-closing a batch |

### `capture`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default_resolution` | string | `"UXGA"` | Default camera resolution for new devices |
| `default_quality` | integer | `90` | Default JPEG quality (10-100) |
| `default_flash` | boolean | `false` | Default flash state for new devices |
| `heartbeat_interval_seconds` | integer | `60` | Expected interval between device heartbeats |
| `online_threshold_seconds` | integer | `180` | Max seconds since last_seen before device is considered offline |
| `max_pages_per_batch` | integer | `50` | Hard limit on pages per batch |

### `processing`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_concurrent` | integer | `2` | Max batches to process simultaneously |
| `thumbnail_size` | integer | `300` | Thumbnail longest edge in pixels |
| `keep_originals` | boolean | `true` | Keep original images after processing |
| `default_profile_options` | object | *(see below)* | Default profile options applied when no profile is specified |

### `storage`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `base_path` | string | `"./storage"` | Base directory for batch storage |
| `backends` | array | *(see below)* | List of configured storage backends |

**Backend object (local):**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `type` | string | `"local"` |
| `enabled` | boolean | Whether exports go to this backend |
| `path` | string | Local directory path for exports |

**Backend object (paperless):**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `type` | string | `"paperless"` |
| `enabled` | boolean | Whether exports go to this backend |
| `url` | string | Paperless-ngx API base URL |
| `token` | string | API authentication token |
| `verify_ssl` | boolean | Verify SSL certificates |

### `notifications`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Master toggle for notifications |
| `on_scan_complete` | boolean | `true` | Notify on successful scan processing |
| `on_export_complete` | boolean | `true` | Notify on successful export |
| `on_error` | boolean | `true` | Notify on errors |
| `channels` | array | `[]` | List of notification channel configurations |

**Channel object (webhook):**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"webhook"` |
| `enabled` | boolean | Whether this channel is active |
| `url` | string | Webhook URL to POST to |
| `headers` | object | Additional HTTP headers to include |

### `logs`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | string | `"INFO"` | Minimum log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `max_entries` | integer | `10000` | Maximum log entries to retain |
| `auto_purge_days` | integer | `30` | Auto-delete logs older than N days |
| `categories` | string[] | *(all)* | Active log categories |

### `system`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `version` | string | — | Application version (read-only) |
| `data_dir` | string | `"./data"` | Data directory path |
| `port` | integer | `8400` | HTTP server port |
| `host` | string | `"0.0.0.0"` | HTTP server bind address |
| `cors_origins` | string[] | `["*"]` | Allowed CORS origins |

---

## GET `/api/settings`

Retrieve the full configuration object.

### Request

```http
GET /api/settings HTTP/1.1
```

### Response — 200 OK

Returns the full settings JSON object as documented above.

---

## PUT `/api/settings`

Replace the entire configuration. All sections must be provided. The server validates the complete object and rejects the request if any section is invalid.

### Request

```http
PUT /api/settings HTTP/1.1
Content-Type: application/json
```

Body: the full settings JSON object.

### Response — 200 OK

Returns the updated full settings object.

### Errors

| Code | Condition |
|------|-----------|
| 400 | Missing required sections |
| 422 | Validation errors (invalid values, unknown fields) |

---

## PATCH `/api/settings/{section}`

Update a single settings section. Only the fields provided are updated; omitted fields retain their current values.

### Request

```http
PATCH /api/settings/capture HTTP/1.1
Content-Type: application/json
```

```json
{
  "default_resolution": "SVGA",
  "default_quality": 80
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `section` | path | One of: `general`, `capture`, `processing`, `storage`, `notifications`, `logs`, `system` |

### Response — 200 OK

Returns the updated section:

```json
{
  "default_resolution": "SVGA",
  "default_quality": 80,
  "default_flash": false,
  "heartbeat_interval_seconds": 60,
  "online_threshold_seconds": 180,
  "max_pages_per_batch": 50
}
```

### Errors

| Code | Condition |
|------|-----------|
| 404 | Unknown section name |
| 422 | Validation errors |

---

## POST `/api/settings/test-storage`

Test connectivity to a storage backend before saving the configuration.

### Request

```http
POST /api/settings/test-storage HTTP/1.1
Content-Type: application/json
```

```json
{
  "type": "paperless",
  "url": "http://paperless.local:8000",
  "token": "abc123def456"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Backend type: `"local"` or `"paperless"` |
| `url` | string | conditional | Required for `paperless` type |
| `token` | string | conditional | Required for `paperless` type |
| `path` | string | conditional | Required for `local` type |

### Response — 200 OK (success)

```json
{
  "success": true,
  "message": "Connected to Paperless-ngx v2.4.1"
}
```

### Response — 200 OK (failure)

```json
{
  "success": false,
  "message": "Connection timeout after 10s"
}
```

### Errors

| Code | Condition |
|------|-----------|
| 400 | Missing required fields for the backend type |
| 422 | Unknown backend type |

---

## GET `/api/settings/profiles`

List all processing profiles.

### Request

```http
GET /api/settings/profiles HTTP/1.1
```

### Response — 200 OK

```json
[
  {
    "id": "default",
    "name": "Default",
    "is_default": true,
    "options": {
      "auto_crop": {"enabled": true, "sensitivity": 50},
      "deskew": {"enabled": true, "max_angle": 15},
      "denoise": {"enabled": true, "strength": 10},
      "clahe": {"enabled": true, "clip_limit": 2.0, "grid_size": 8},
      "sharpen": {"enabled": true, "amount": 1.5},
      "white_balance": {"enabled": true},
      "bw_mode": {"enabled": false, "method": "adaptive", "block_size": 11, "constant": 2},
      "output": {"format": "pdf", "quality": 85, "dpi": 300}
    },
    "created_at": "2026-02-20T10:00:00.000Z",
    "updated_at": "2026-02-20T10:00:00.000Z"
  },
  {
    "id": "receipt",
    "name": "Receipt",
    "is_default": false,
    "options": {
      "auto_crop": {"enabled": true, "sensitivity": 70},
      "deskew": {"enabled": true, "max_angle": 10},
      "denoise": {"enabled": true, "strength": 15},
      "clahe": {"enabled": true, "clip_limit": 3.0, "grid_size": 8},
      "sharpen": {"enabled": true, "amount": 2.0},
      "white_balance": {"enabled": true},
      "bw_mode": {"enabled": true, "method": "adaptive", "block_size": 11, "constant": 2},
      "output": {"format": "pdf", "quality": 90, "dpi": 300}
    },
    "created_at": "2026-02-21T12:00:00.000Z",
    "updated_at": "2026-02-21T12:00:00.000Z"
  }
]
```

---

## Profile Options Structure

Each profile contains an `options` object with the following processing steps:

```json
{
  "auto_crop": {"enabled": true, "sensitivity": 50},
  "deskew": {"enabled": true, "max_angle": 15},
  "denoise": {"enabled": true, "strength": 10},
  "clahe": {"enabled": true, "clip_limit": 2.0, "grid_size": 8},
  "sharpen": {"enabled": true, "amount": 1.5},
  "white_balance": {"enabled": true},
  "bw_mode": {"enabled": false, "method": "adaptive", "block_size": 11, "constant": 2},
  "output": {"format": "pdf", "quality": 85, "dpi": 300}
}
```

### `auto_crop`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable automatic document edge detection and cropping |
| `sensitivity` | integer | `50` | Crop sensitivity 0-100 (higher = more aggressive) |

### `deskew`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable automatic rotation correction |
| `max_angle` | integer | `15` | Maximum correction angle in degrees |

### `denoise`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable noise reduction |
| `strength` | integer | `10` | Denoising strength 0-50 |

### `clahe`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable Contrast Limited Adaptive Histogram Equalization |
| `clip_limit` | float | `2.0` | CLAHE clip limit |
| `grid_size` | integer | `8` | CLAHE tile grid size |

### `sharpen`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable sharpening |
| `amount` | float | `1.5` | Sharpening amount |

### `white_balance`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable automatic white balance correction |

### `bw_mode`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable black & white conversion |
| `method` | string | `"adaptive"` | Thresholding method: `"adaptive"`, `"otsu"`, `"fixed"` |
| `block_size` | integer | `11` | Adaptive threshold block size (must be odd) |
| `constant` | integer | `2` | Adaptive threshold constant |

### `output`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | string | `"pdf"` | Output format: `"pdf"`, `"jpg"`, `"png"` |
| `quality` | integer | `85` | Output JPEG quality (ignored for PNG) |
| `dpi` | integer | `300` | Output DPI |

---

## POST `/api/settings/profiles`

Create a new processing profile.

### Request

```http
POST /api/settings/profiles HTTP/1.1
Content-Type: application/json
```

```json
{
  "name": "Receipt",
  "options": {
    "auto_crop": {"enabled": true, "sensitivity": 70},
    "deskew": {"enabled": true, "max_angle": 10},
    "denoise": {"enabled": true, "strength": 15},
    "clahe": {"enabled": true, "clip_limit": 3.0, "grid_size": 8},
    "sharpen": {"enabled": true, "amount": 2.0},
    "white_balance": {"enabled": true},
    "bw_mode": {"enabled": true, "method": "adaptive", "block_size": 11, "constant": 2},
    "output": {"format": "pdf", "quality": 90, "dpi": 300}
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable profile name (must be unique) |
| `options` | object | yes | Processing options (see structure above) |

### Response — 201 Created

```json
{
  "id": "receipt",
  "name": "Receipt",
  "is_default": false,
  "options": {
    "auto_crop": {"enabled": true, "sensitivity": 70},
    "deskew": {"enabled": true, "max_angle": 10},
    "denoise": {"enabled": true, "strength": 15},
    "clahe": {"enabled": true, "clip_limit": 3.0, "grid_size": 8},
    "sharpen": {"enabled": true, "amount": 2.0},
    "white_balance": {"enabled": true},
    "bw_mode": {"enabled": true, "method": "adaptive", "block_size": 11, "constant": 2},
    "output": {"format": "pdf", "quality": 90, "dpi": 300}
  },
  "created_at": "2026-02-23T15:00:00.000Z",
  "updated_at": "2026-02-23T15:00:00.000Z"
}
```

### Errors

| Code | Condition |
|------|-----------|
| 400 | Missing `name` or `options` |
| 422 | Duplicate name, invalid option values |

---

## PUT `/api/settings/profiles/{id}`

Update an existing processing profile.

### Request

```http
PUT /api/settings/profiles/receipt HTTP/1.1
Content-Type: application/json
```

```json
{
  "name": "Receipt (Updated)",
  "options": {
    "auto_crop": {"enabled": true, "sensitivity": 80},
    "deskew": {"enabled": true, "max_angle": 10},
    "denoise": {"enabled": true, "strength": 20},
    "clahe": {"enabled": true, "clip_limit": 3.0, "grid_size": 8},
    "sharpen": {"enabled": true, "amount": 2.5},
    "white_balance": {"enabled": true},
    "bw_mode": {"enabled": true, "method": "adaptive", "block_size": 11, "constant": 2},
    "output": {"format": "pdf", "quality": 90, "dpi": 300}
  }
}
```

### Response — 200 OK

Returns the updated profile object (same structure as create response).

### Errors

| Code | Condition |
|------|-----------|
| 404 | Profile not found |
| 422 | Duplicate name, invalid option values |

---

## DELETE `/api/settings/profiles/{id}`

Delete a processing profile. The `default` profile cannot be deleted.

### Request

```http
DELETE /api/settings/profiles/receipt HTTP/1.1
```

### Response — 200 OK

```json
{
  "message": "Profile deleted",
  "id": "receipt"
}
```

### Errors

| Code | Condition |
|------|-----------|
| 403 | Attempted to delete the `default` profile |
| 404 | Profile not found |

---

## POST `/api/settings/backup`

Download the current configuration as a JSON file. The response is a file download.

### Request

```http
POST /api/settings/backup HTTP/1.1
```

### Response — 200 OK

```http
HTTP/1.1 200 OK
Content-Type: application/json
Content-Disposition: attachment; filename="espscancam-config-2026-02-23.json"
```

```json
{
  "version": "1.0.0",
  "exported_at": "2026-02-23T15:00:00.000Z",
  "settings": { "...full settings object..." },
  "profiles": [ "...array of all profiles..." ]
}
```

---

## POST `/api/settings/restore`

Upload a previously exported configuration JSON and apply it. This replaces all settings and profiles.

### Request

```http
POST /api/settings/restore HTTP/1.1
Content-Type: application/json
```

Body: the backup JSON object (same format as backup response).

### Response — 200 OK

```json
{
  "message": "Configuration restored",
  "settings_updated": true,
  "profiles_restored": 3
}
```

### Errors

| Code | Condition |
|------|-----------|
| 400 | Invalid JSON or missing required fields |
| 422 | Configuration validation failed (details in error response) |
