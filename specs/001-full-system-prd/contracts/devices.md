# Device API Contract

> **Satsu API — Device Management**

## Conventions

| Item | Value |
|------|-------|
| Base URL | `http://host:8400/api` |
| Content-Type | `application/json` (except image uploads: `image/jpeg`) |
| Timestamps | ISO 8601 with milliseconds (`2026-02-23T14:30:00.000Z`) |
| Pagination | Cursor-based (base64-encoded JSON cursor) |
| Error format | `{"error": {"code": "ERROR_CODE", "message": "Human-readable message", "details": {}}}` |
| Status codes | 200 success, 201 created, 400 bad request, 403 forbidden (API key), 404 not found, 422 validation error, 500 internal error |
| Auth (optional) | `X-API-Key` header on device endpoints when enabled |

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/device/register` | Register or update device (heartbeat) |
| POST | `/api/device/capture` | Notify capture event |
| GET | `/api/devices` | List all devices |
| PUT | `/api/devices/{mac}` | Update device (name, config) |
| DELETE | `/api/devices/{mac}` | Delete device |
| POST | `/api/devices/{mac}/config` | Push config to device |

---

## POST `/api/device/register`

Register a new device or update an existing device's heartbeat. The device calls this endpoint periodically (default every 60s) to announce its presence and receive any pending configuration changes.

### Request

```http
POST /api/device/register HTTP/1.1
Content-Type: application/json
X-API-Key: optional-key-if-enabled
```

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "ip": "192.168.1.50",
  "firmware": "1.0.0",
  "resolution": "UXGA",
  "max_pages": 10
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mac` | string | yes | Device MAC address (unique identifier) |
| `ip` | string | yes | Current IP address on the network |
| `firmware` | string | yes | Firmware version string |
| `resolution` | string | yes | Current camera resolution (e.g. `UXGA`, `SVGA`, `XGA`) |
| `max_pages` | integer | yes | Maximum pages the device can buffer before upload |

### Response — 200 OK

```json
{
  "device": {
    "mac": "AA:BB:CC:DD:EE:FF",
    "name": "Office Scanner",
    "ip": "192.168.1.50",
    "firmware": "1.0.0",
    "resolution": "UXGA",
    "max_pages": 10,
    "is_online": true,
    "last_seen": "2026-02-23T14:30:00.000Z",
    "created_at": "2026-02-20T10:00:00.000Z"
  },
  "pending_config": {
    "resolution": "SVGA",
    "quality": 85,
    "flash": true
  }
}
```

The `pending_config` field is `null` when there are no pending changes. Once the device acknowledges the config (by sending a subsequent heartbeat with the new values), the pending config is cleared.

### Errors

| Code | Condition |
|------|-----------|
| 400 | Missing required fields |
| 403 | Invalid or missing API key (when auth enabled) |
| 422 | Invalid MAC format or unknown resolution |

---

## POST `/api/device/capture`

Notify the server of a new capture event. The device sends the raw JPEG image directly in the request body. The server automatically assigns the image to the current open batch for the device, or creates a new batch if none exists.

### Request

```http
POST /api/device/capture HTTP/1.1
Content-Type: image/jpeg
X-Device-MAC: AA:BB:CC:DD:EE:FF
X-API-Key: optional-key-if-enabled

<raw JPEG bytes>
```

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | yes | Must be `image/jpeg` |
| `X-Device-MAC` | yes | MAC address of the capturing device |
| `X-API-Key` | no | API key when authentication is enabled |

### Response — 201 Created

```json
{
  "batch_id": "a1b2c3d4",
  "page_index": 0
}
```

| Field | Type | Description |
|-------|------|-------------|
| `batch_id` | string | ID of the batch this page was assigned to |
| `page_index` | integer | Zero-based index of this page within the batch |

### Errors

| Code | Condition |
|------|-----------|
| 400 | Missing `X-Device-MAC` header or empty body |
| 403 | Invalid or missing API key (when auth enabled) |
| 404 | Unknown device MAC (device must register first) |
| 422 | Invalid JPEG data |
| 500 | Failed to write image to disk |

---

## GET `/api/devices`

List all registered devices. Each device includes a computed `is_online` field based on whether the device was last seen within the online threshold (180 seconds).

### Request

```http
GET /api/devices HTTP/1.1
```

### Response — 200 OK

```json
[
  {
    "mac": "AA:BB:CC:DD:EE:FF",
    "name": "Office Scanner",
    "ip": "192.168.1.50",
    "firmware": "1.0.0",
    "resolution": "UXGA",
    "max_pages": 10,
    "is_online": true,
    "last_seen": "2026-02-23T14:30:00.000Z",
    "created_at": "2026-02-20T10:00:00.000Z",
    "pending_config": null
  },
  {
    "mac": "11:22:33:44:55:66",
    "name": "Garage Scanner",
    "ip": "192.168.1.51",
    "firmware": "0.9.2",
    "resolution": "SVGA",
    "max_pages": 5,
    "is_online": false,
    "last_seen": "2026-02-23T12:00:00.000Z",
    "created_at": "2026-02-18T08:00:00.000Z",
    "pending_config": {
      "resolution": "XGA"
    }
  }
]
```

The `is_online` field is computed server-side: `true` if `now - last_seen < 180 seconds`, `false` otherwise.

---

## PUT `/api/devices/{mac}`

Update device metadata such as the display name or other editable fields. This does not push configuration to the device itself (use the `/config` endpoint for that).

### Request

```http
PUT /api/devices/AA:BB:CC:DD:EE:FF HTTP/1.1
Content-Type: application/json
```

```json
{
  "name": "Renamed Office Scanner"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | no | Human-friendly display name |

### Response — 200 OK

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "name": "Renamed Office Scanner",
  "ip": "192.168.1.50",
  "firmware": "1.0.0",
  "resolution": "UXGA",
  "max_pages": 10,
  "is_online": true,
  "last_seen": "2026-02-23T14:30:00.000Z",
  "created_at": "2026-02-20T10:00:00.000Z",
  "pending_config": null
}
```

### Errors

| Code | Condition |
|------|-----------|
| 404 | Device with specified MAC not found |
| 422 | Invalid field values |

---

## DELETE `/api/devices/{mac}`

Delete a device and disassociate it from any batches. Existing batches from this device are preserved but the device reference is cleared.

### Request

```http
DELETE /api/devices/AA:BB:CC:DD:EE:FF HTTP/1.1
```

### Response — 200 OK

```json
{
  "message": "Device deleted",
  "mac": "AA:BB:CC:DD:EE:FF"
}
```

### Errors

| Code | Condition |
|------|-----------|
| 404 | Device with specified MAC not found |

---

## POST `/api/devices/{mac}/config`

Push a configuration update to a device. The device will pick up the new configuration on its next heartbeat (register call). The config is stored as `pending_config` until the device confirms the change.

### Request

```http
POST /api/devices/AA:BB:CC:DD:EE:FF/config HTTP/1.1
Content-Type: application/json
```

```json
{
  "resolution": "SVGA",
  "quality": 85,
  "flash": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resolution` | string | no | Camera resolution: `QQVGA`, `QVGA`, `CIF`, `VGA`, `SVGA`, `XGA`, `SXGA`, `UXGA` |
| `quality` | integer | no | JPEG quality 10-100 |
| `flash` | boolean | no | Enable/disable flash LED |

### Response — 200 OK

```json
{
  "message": "Config queued for device",
  "mac": "AA:BB:CC:DD:EE:FF",
  "pending_config": {
    "resolution": "SVGA",
    "quality": 85,
    "flash": true
  }
}
```

### Errors

| Code | Condition |
|------|-----------|
| 404 | Device with specified MAC not found |
| 422 | Invalid resolution value or quality out of range |
