# WebSocket Contract

> **Satsu — Real-Time Event Stream**

## Conventions

| Item | Value |
|------|-------|
| Base URL | `http://host:8400/api` (REST) |
| WebSocket URL | `ws://host:8400/ws` |
| Content-Type | `application/json` (all messages) |
| Timestamps | Unix milliseconds (integer) |
| Error format | `{"error": {"code": "ERROR_CODE", "message": "Human-readable message", "details": {}}}` |
| Status codes (REST) | 200 success, 201 created, 400 bad request, 403 forbidden (API key), 404 not found, 422 validation error, 500 internal error |
| Auth (optional) | `X-API-Key` header on device endpoints when enabled |

---

## Connection

### Endpoint

```
ws://host:8400/ws
```

### Message Format

All WebSocket messages are JSON objects with this structure:

```json
{
  "event": "event_name",
  "data": {},
  "timestamp": 1708700000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event type identifier |
| `data` | object | Event-specific payload |
| `timestamp` | integer | Unix timestamp in milliseconds when the event was emitted |

---

## Connection Lifecycle

### 1. Connect

The client opens a WebSocket connection to `ws://host:8400/ws`. No authentication handshake is required (the WebSocket is intended for the local web UI).

```javascript
const ws = new WebSocket("ws://host:8400/ws");

ws.onopen = () => {
  console.log("Connected to Satsu");
};
```

### 2. Heartbeat

The server sends periodic ping frames (every 30 seconds) to keep the connection alive. The client should respond with pong frames automatically (handled by most WebSocket implementations). If the server does not receive a pong within 10 seconds, it considers the client disconnected.

### 3. Reconnection Strategy

When the connection drops, the client should use an exponential backoff strategy:

| Attempt | Delay |
|---------|-------|
| 1 | 1 second |
| 2 | 2 seconds |
| 3 | 4 seconds |
| 4+ | 5 seconds (max) |

```javascript
let reconnectDelay = 1000;
const maxDelay = 5000;

function connect() {
  const ws = new WebSocket("ws://host:8400/ws");

  ws.onopen = () => {
    reconnectDelay = 1000; // Reset on successful connection
  };

  ws.onclose = () => {
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
      connect();
    }, reconnectDelay);
  };
}
```

### 4. State Sync on Reconnect

After reconnecting, the client should fetch the latest state via the REST API to ensure consistency:

1. `GET /api/stats` -- refresh dashboard counters
2. `GET /api/devices` -- refresh device online/offline status
3. `GET /api/scans?limit=25` -- refresh the scan list

This ensures the client does not miss any events that occurred while disconnected.

---

## Event Types

There are 16 event types organized by domain.

---

### Device Events

#### `device_online`

Emitted when a device comes online (first heartbeat or heartbeat after being offline).

```json
{
  "event": "device_online",
  "data": {
    "mac": "AA:BB:CC:DD:EE:FF",
    "name": "Office Scanner",
    "ip": "192.168.1.50"
  },
  "timestamp": 1708700000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.mac` | string | Device MAC address |
| `data.name` | string | Device display name |
| `data.ip` | string | Device current IP address |

---

#### `device_offline`

Emitted when a device is considered offline (no heartbeat within the online threshold).

```json
{
  "event": "device_offline",
  "data": {
    "mac": "AA:BB:CC:DD:EE:FF",
    "name": "Office Scanner",
    "ip": "192.168.1.50"
  },
  "timestamp": 1708700180000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.mac` | string | Device MAC address |
| `data.name` | string | Device display name |
| `data.ip` | string | Device last known IP address |

---

### Capture Events

#### `page_captured`

Emitted when a device sends a captured page image via the capture endpoint.

```json
{
  "event": "page_captured",
  "data": {
    "batch_id": "a1b2c3d4",
    "page_index": 0,
    "device_mac": "AA:BB:CC:DD:EE:FF"
  },
  "timestamp": 1708700005000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Batch the page was assigned to |
| `data.page_index` | integer | Zero-based page index |
| `data.device_mac` | string | Capturing device MAC |

---

### Batch Events

#### `batch_created`

Emitted when a new batch is created (either from device capture or web upload).

```json
{
  "event": "batch_created",
  "data": {
    "batch_id": "a1b2c3d4",
    "source_type": "esp32cam",
    "device_mac": "AA:BB:CC:DD:EE:FF"
  },
  "timestamp": 1708700000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | New batch identifier |
| `data.source_type` | string | `"esp32cam"` or `"web_upload"` |
| `data.device_mac` | string or null | Source device MAC (null for web uploads) |

---

#### `page_uploaded`

Emitted when a page is uploaded to a batch via the upload endpoint or web upload.

```json
{
  "event": "page_uploaded",
  "data": {
    "batch_id": "a1b2c3d4",
    "page_index": 1
  },
  "timestamp": 1708700010000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Batch identifier |
| `data.page_index` | integer | Zero-based page index |

---

#### `batch_deleted`

Emitted when a batch is deleted.

```json
{
  "event": "batch_deleted",
  "data": {
    "batch_id": "a1b2c3d4"
  },
  "timestamp": 1708700600000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Deleted batch identifier |

---

### Processing Events

#### `processing_started`

Emitted when the processing pipeline begins for a batch.

```json
{
  "event": "processing_started",
  "data": {
    "batch_id": "a1b2c3d4",
    "page_count": 3,
    "profile": "default"
  },
  "timestamp": 1708700100000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Batch being processed |
| `data.page_count` | integer | Total pages to process |
| `data.profile` | string | Processing profile being applied |

---

#### `processing_page`

Emitted for each processing step on each page, enabling fine-grained progress tracking.

```json
{
  "event": "processing_page",
  "data": {
    "batch_id": "a1b2c3d4",
    "page_index": 0,
    "step": "auto_crop",
    "step_index": 1,
    "total_steps": 8
  },
  "timestamp": 1708700101000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Batch being processed |
| `data.page_index` | integer | Current page index |
| `data.step` | string | Current processing step name |
| `data.step_index` | integer | 1-based index of current step |
| `data.total_steps` | integer | Total number of steps in the pipeline |

Processing steps in order: `auto_crop`, `deskew`, `denoise`, `clahe`, `sharpen`, `white_balance`, `bw_mode`, `output`.

---

#### `page_processed`

Emitted when a single page finishes all processing steps.

```json
{
  "event": "page_processed",
  "data": {
    "batch_id": "a1b2c3d4",
    "page_index": 0,
    "duration_ms": 4200
  },
  "timestamp": 1708700105000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Batch being processed |
| `data.page_index` | integer | Completed page index |
| `data.duration_ms` | integer | Total processing time for this page in milliseconds |

---

#### `processing_complete`

Emitted when all pages in a batch have been processed.

```json
{
  "event": "processing_complete",
  "data": {
    "batch_id": "a1b2c3d4",
    "total_duration_ms": 12600,
    "page_count": 3
  },
  "timestamp": 1708700112600
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Completed batch identifier |
| `data.total_duration_ms` | integer | Total processing time for all pages |
| `data.page_count` | integer | Number of pages processed |

---

#### `processing_error`

Emitted when a processing step fails for a page.

```json
{
  "event": "processing_error",
  "data": {
    "batch_id": "a1b2c3d4",
    "page_index": 2,
    "step": "auto_crop",
    "error": "No contour with 4 points found"
  },
  "timestamp": 1708700110000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Batch being processed |
| `data.page_index` | integer | Page that failed |
| `data.step` | string | Processing step that failed |
| `data.error` | string | Human-readable error message |

---

### Export Events

#### `exporting`

Emitted when export to storage backends begins.

```json
{
  "event": "exporting",
  "data": {
    "batch_id": "a1b2c3d4",
    "backends": ["local", "paperless"]
  },
  "timestamp": 1708700200000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Batch being exported |
| `data.backends` | string[] | Target backend names |

---

#### `export_complete`

Emitted when export finishes (all backends).

```json
{
  "event": "export_complete",
  "data": {
    "batch_id": "a1b2c3d4",
    "results": [
      {"backend": "local", "success": true},
      {"backend": "paperless", "success": true}
    ]
  },
  "timestamp": 1708700210000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Exported batch identifier |
| `data.results` | array | Per-backend result objects |
| `data.results[].backend` | string | Backend name |
| `data.results[].success` | boolean | Whether the export succeeded |

---

#### `export_error`

Emitted when export to a specific backend fails.

```json
{
  "event": "export_error",
  "data": {
    "batch_id": "a1b2c3d4",
    "backend": "paperless",
    "error": "Connection refused: http://paperless:8000"
  },
  "timestamp": 1708700215000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.batch_id` | string | Batch being exported |
| `data.backend` | string | Failed backend name |
| `data.error` | string | Human-readable error message |

---

### System Events

#### `config_changed`

Emitted when a setting is changed via the settings API.

```json
{
  "event": "config_changed",
  "data": {
    "section": "processing",
    "key": "max_concurrent"
  },
  "timestamp": 1708700300000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.section` | string | Settings section that changed |
| `data.key` | string | Specific key that changed (or `null` if the entire section was replaced) |

---

#### `log`

Emitted for each new log entry, allowing real-time log streaming in the UI.

```json
{
  "event": "log",
  "data": {
    "id": 12345,
    "level": "ERROR",
    "category": "processing",
    "message": "Auto-crop failed: no document edges detected"
  },
  "timestamp": 1708700000123
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | integer | Log entry ID |
| `data.level` | string | Log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `data.category` | string | Log category |
| `data.message` | string | Log message text |

---

## Event Summary Table

| Event | Domain | Description |
|-------|--------|-------------|
| `device_online` | Device | Device came online |
| `device_offline` | Device | Device went offline |
| `page_captured` | Capture | Device captured a page |
| `batch_created` | Batch | New batch created |
| `page_uploaded` | Batch | Page uploaded to batch |
| `batch_deleted` | Batch | Batch was deleted |
| `processing_started` | Processing | Processing pipeline started |
| `processing_page` | Processing | Processing step progress on a page |
| `page_processed` | Processing | Single page finished processing |
| `processing_complete` | Processing | All pages in batch processed |
| `processing_error` | Processing | Processing step failed |
| `exporting` | Export | Export to backends started |
| `export_complete` | Export | Export to all backends finished |
| `export_error` | Export | Export to a backend failed |
| `config_changed` | System | Settings were modified |
| `log` | System | New log entry created |
