# Data Model: ESPScanCam

**Phase 1 output** | **Date**: 2026-02-23 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This document defines the complete data model for ESPScanCam: all entities, fields,
relationships, validation rules, state machines, indexes, file storage conventions,
and migration strategy.

---

## Table of Contents

1. [Entity-Relationship Diagram](#1-entity-relationship-diagram)
2. [Entity Details](#2-entity-details)
   - [2.1 devices](#21-devices)
   - [2.2 batches](#22-batches)
   - [2.3 pages](#23-pages)
   - [2.4 profiles](#24-profiles)
   - [2.5 logs](#25-logs)
3. [Relationships](#3-relationships)
4. [State Transitions](#4-state-transitions)
5. [Indexes](#5-indexes)
6. [JSON Column Schemas](#6-json-column-schemas)
7. [File Storage Paths](#7-file-storage-paths)
8. [Migration Strategy](#8-migration-strategy)

---

## 1. Entity-Relationship Diagram

```
┌─────────────────────┐          ┌──────────────────────────────────────┐
│      devices        │          │              batches                 │
├─────────────────────┤          ├──────────────────────────────────────┤
│ PK  mac       TEXT  │─────┐    │ PK  id             TEXT             │
│     name      TEXT  │     │    │     device_mac      TEXT             │
│     ip        TEXT  │     └───>│     source_type     TEXT             │
│     firmware  TEXT  │     1:N  │     page_count      INTEGER         │
│     max_pages INT   │          │     status          TEXT             │
│     resolution TEXT │          │     error           TEXT             │
│     config    TEXT  │          │     profile         TEXT             │
│     total_scans INT │          │     export_info     TEXT (JSON)      │
│     last_seen TEXT  │          │     file_size       INTEGER         │
│     created_at TEXT │          │     processing_duration_ms INTEGER  │
└─────────────────────┘          │     created_at      TEXT             │
                                 │     updated_at      TEXT             │
                                 └───────────────┬────────────────────┘
                                                 │
                                                 │ 1:N (CASCADE)
                                                 │
                                 ┌───────────────┴────────────────────┐
                                 │              pages                  │
                                 ├────────────────────────────────────┤
                                 │ PK  batch_id          TEXT (FK)    │
                                 │ PK  page_index        INTEGER     │
                                 │     status            TEXT         │
                                 │     original_path     TEXT         │
                                 │     processed_path    TEXT         │
                                 │     processing_details TEXT (JSON) │
                                 │     file_size_original  INTEGER   │
                                 │     file_size_processed INTEGER   │
                                 │     created_at        TEXT         │
                                 └────────────────────────────────────┘

┌─────────────────────────────┐  ┌────────────────────────────────────┐
│         profiles            │  │              logs                   │
├─────────────────────────────┤  ├────────────────────────────────────┤
│ PK  id         TEXT         │  │ PK  id           INTEGER (AUTO)   │
│     name       TEXT (UNIQUE)│  │     timestamp    INTEGER          │
│     options    TEXT (JSON)   │  │     level        TEXT              │
│     is_default INTEGER      │  │     category     TEXT              │
│     created_at TEXT          │  │     source       TEXT              │
└─────────────────────────────┘  │     device_mac   TEXT              │
                                 │     message      TEXT              │
  Referenced by batches.profile  │     details      TEXT (JSON)       │
  (logical, not enforced FK)     └────────────────────────────────────┘

                                   logs.device_mac references
                                   devices.mac (logical, not enforced FK)
```

**Legend**: PK = primary key, FK = foreign key, 1:N = one-to-many, JSON = stored
as JSON text. Dashed references (device_mac in batches and logs) are logical
associations, not enforced foreign key constraints — this allows batches from
`web_camera` and `file_upload` sources that have no device row.

---

## 2. Entity Details

### 2.1 devices

An ESP32-CAM hardware module identified by its MAC address. Tracks configuration,
connectivity, and lifetime scan statistics. Online/offline status is derived from
the `last_seen` timestamp (offline after 180 seconds of silence).

#### DDL

```sql
CREATE TABLE IF NOT EXISTS devices (
    mac         TEXT    PRIMARY KEY,
    name        TEXT,
    ip          TEXT    NOT NULL,
    firmware    TEXT,
    max_pages   INTEGER DEFAULT 10,
    resolution  TEXT    DEFAULT 'UXGA',
    config      TEXT    DEFAULT '{}',
    total_scans INTEGER DEFAULT 0,
    last_seen   TEXT    NOT NULL,
    created_at  TEXT    NOT NULL
);
```

#### Field Validation Rules

| Column | Format / Constraint | Validation Rule |
|--------|-------------------|-----------------|
| `mac` | `XX:XX:XX:XX:XX:XX` | Regex: `^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$`. Uppercase on storage. |
| `name` | Free text, max 64 chars | Optional. Trimmed. NULL if not set. Display falls back to MAC. |
| `ip` | IPv4 dotted notation | Regex: `^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$`. NOT NULL. |
| `firmware` | Semver string | Optional. Example: `"1.0.0"`, `"1.2.3-beta"`. NULL if unknown. |
| `max_pages` | Positive integer | Range: 1-100. Default: 10. Sent to device on heartbeat response. |
| `resolution` | Enum string | Allowed: `QQVGA`, `QVGA`, `CIF`, `VGA`, `SVGA`, `XGA`, `SXGA`, `UXGA`. Default: `UXGA`. |
| `config` | JSON object string | Must be valid JSON object. Default: `'{}'`. See [Section 6.1](#61-devicesconfig). |
| `total_scans` | Non-negative integer | Incremented by 1 when a batch from this device reaches `completed` status. Never decremented. |
| `last_seen` | ISO 8601 datetime | Format: `YYYY-MM-DDTHH:MM:SS.fffZ`. NOT NULL. Updated on every heartbeat / registration. |
| `created_at` | ISO 8601 datetime | Format: `YYYY-MM-DDTHH:MM:SS.fffZ`. NOT NULL. Set once at first registration. Immutable. |

#### Derived State

The `devices` table has no `status` column. Online/offline is computed at query time:

```
online  = (now - last_seen) < 180 seconds
offline = (now - last_seen) >= 180 seconds
```

---

### 2.2 batches

A collection of scanned pages from a single capture session. A batch belongs to one
source: an ESP32-CAM device, the web browser camera, or a file upload. Tracks
processing lifecycle, export results, and aggregate metrics.

#### DDL

```sql
CREATE TABLE IF NOT EXISTS batches (
    id                      TEXT    PRIMARY KEY,
    device_mac              TEXT,
    source_type             TEXT    NOT NULL,
    page_count              INTEGER DEFAULT 0,
    status                  TEXT    NOT NULL DEFAULT 'pending',
    error                   TEXT,
    profile                 TEXT    DEFAULT 'default',
    export_info             TEXT    DEFAULT '{}',
    file_size               INTEGER DEFAULT 0,
    processing_duration_ms  INTEGER DEFAULT 0,
    created_at              TEXT    NOT NULL,
    updated_at              TEXT    NOT NULL
);
```

#### Field Validation Rules

| Column | Format / Constraint | Validation Rule |
|--------|-------------------|-----------------|
| `id` | 8-character hex string | Generated server-side. Regex: `^[a-f0-9]{8}$`. First 8 chars of UUID4. Collision-checked on insert. |
| `device_mac` | MAC address or virtual identifier | For `esp32cam`: valid MAC (`XX:XX:XX:XX:XX:XX`). For `web_camera`: literal `"web-camera"`. For `file_upload`: literal `"file-upload"`. NULL not allowed in practice but not DB-enforced. |
| `source_type` | Enum string | Allowed: `esp32cam`, `web_camera`, `file_upload`. NOT NULL. |
| `page_count` | Non-negative integer | Incremented as pages are uploaded. Decremented on page deletion. Range: 0-999. |
| `status` | Enum string | Allowed: `pending`, `uploading`, `processing`, `completed`, `error`, `export_failed`. NOT NULL. Default: `pending`. See [Section 4.1](#41-batch-status). |
| `error` | Free text | NULL when status is not `error` or `export_failed`. Set when a processing or export error occurs. Max 1000 chars. |
| `profile` | Profile ID or slug | References `profiles.id` (logical, not FK). Default: `'default'`. |
| `export_info` | JSON object string | Must be valid JSON object. Default: `'{}'`. See [Section 6.2](#62-batchesexport_info). |
| `file_size` | Non-negative integer (bytes) | Sum of all page file sizes (original + processed). Updated after processing. |
| `processing_duration_ms` | Non-negative integer (milliseconds) | Total wall-clock time for all pipeline steps across all pages. 0 if not yet processed. |
| `created_at` | ISO 8601 datetime | Format: `YYYY-MM-DDTHH:MM:SS.fffZ`. NOT NULL. Set once at batch creation. Immutable. |
| `updated_at` | ISO 8601 datetime | Format: `YYYY-MM-DDTHH:MM:SS.fffZ`. NOT NULL. Updated on every status change, page upload, or metadata modification. |

---

### 2.3 pages

A single image within a batch. Has an immutable original and a regeneratable
processed version. Tracks per-step processing results.

#### DDL

```sql
CREATE TABLE IF NOT EXISTS pages (
    batch_id            TEXT    NOT NULL,
    page_index          INTEGER NOT NULL,
    status              TEXT    NOT NULL DEFAULT 'pending',
    original_path       TEXT    NOT NULL,
    processed_path      TEXT,
    processing_details  TEXT    DEFAULT '{}',
    file_size_original  INTEGER DEFAULT 0,
    file_size_processed INTEGER DEFAULT 0,
    created_at          TEXT    NOT NULL,
    PRIMARY KEY (batch_id, page_index),
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
);
```

#### Field Validation Rules

| Column | Format / Constraint | Validation Rule |
|--------|-------------------|-----------------|
| `batch_id` | 8-character hex string | Must reference an existing `batches.id`. Part of composite PK. |
| `page_index` | Non-negative integer | 0-based. Range: 0-998 (max 999 pages per batch). Part of composite PK. Sequential within a batch. |
| `status` | Enum string | Allowed: `pending`, `uploaded`, `processing`, `processed`, `error`. NOT NULL. Default: `pending`. See [Section 4.2](#42-page-status). |
| `original_path` | Relative file path | NOT NULL. Relative to `/data`. Path traversal prevention: must not contain `..`. Format: `scans/{batch_id}/original/{page_index}.jpg`. |
| `processed_path` | Relative file path | NULL until processing completes. Relative to `/data`. Format: `scans/{batch_id}/processed/{page_index}.{ext}`. |
| `processing_details` | JSON object string | Must be valid JSON object. Default: `'{}'`. See [Section 6.3](#63-pagesprocessing_details). |
| `file_size_original` | Non-negative integer (bytes) | Set on upload. Expected range: 50KB-20MB. |
| `file_size_processed` | Non-negative integer (bytes) | Set after processing. 0 if not yet processed. |
| `created_at` | ISO 8601 datetime | Format: `YYYY-MM-DDTHH:MM:SS.fffZ`. NOT NULL. Set on page creation (upload). Immutable. |

#### Cascade Behavior

When a batch is deleted (`DELETE FROM batches WHERE id = ?`), all associated pages
are automatically deleted via `ON DELETE CASCADE`. The application layer is
responsible for deleting the corresponding files on disk before or after the
database deletion.

---

### 2.4 profiles

A named set of processing pipeline parameters. Exactly one profile is marked as
the default at any time. The system ships with 5 built-in profiles.

#### DDL

```sql
CREATE TABLE IF NOT EXISTS profiles (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL UNIQUE,
    options     TEXT    NOT NULL,
    is_default  INTEGER DEFAULT 0,
    created_at  TEXT    NOT NULL
);
```

#### Field Validation Rules

| Column | Format / Constraint | Validation Rule |
|--------|-------------------|-----------------|
| `id` | Slug or UUID | For built-in profiles: slug (e.g., `document-standard`, `receipt`). For user-created: UUID4 hex (32 chars). Regex: `^[a-z0-9-]{1,64}$`. |
| `name` | Free text, max 64 chars | NOT NULL. UNIQUE. Trimmed. No empty strings. Display name shown in UI dropdowns. |
| `options` | JSON object string | NOT NULL. Must be valid JSON conforming to the pipeline config schema. See [Section 6.4](#64-profilesoptions). |
| `is_default` | Boolean integer | 0 or 1. Exactly one profile must have `is_default = 1` at all times. Setting a new default must unset the previous one (single transaction). |
| `created_at` | ISO 8601 datetime | Format: `YYYY-MM-DDTHH:MM:SS.fffZ`. NOT NULL. Set once at creation. Immutable. |

#### Built-In Profiles (Seeded on First Run)

| ID | Name | Description |
|----|------|-------------|
| `document-standard` | Document Standard | All steps enabled with balanced defaults. Default profile. |
| `document-bw` | Document B&W | All steps enabled, B&W conversion on, high CLAHE. |
| `photo-color` | Photo / Color | No B&W, mild CLAHE, no sharpening. Preserves colors. |
| `receipt` | Receipt | High contrast (CLAHE clip_limit=4), B&W, aggressive denoise. |
| `quick` | Quick | Only auto-crop and deskew. Fastest processing. |

---

### 2.5 logs

A structured record of a system event. Used for observability, debugging, and
auditing. Written by all backend modules. Queryable from the Logs UI page with
real-time streaming via WebSocket.

#### DDL

```sql
CREATE TABLE IF NOT EXISTS logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    level       TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    source      TEXT    NOT NULL,
    device_mac  TEXT,
    message     TEXT    NOT NULL,
    details     TEXT    DEFAULT '{}'
);
```

#### Field Validation Rules

| Column | Format / Constraint | Validation Rule |
|--------|-------------------|-----------------|
| `id` | Auto-incrementing integer | Assigned by SQLite. Monotonically increasing. Never reused after deletion. |
| `timestamp` | Unix timestamp in milliseconds | NOT NULL. Integer. Example: `1708700000000`. Generated server-side via `int(time.time() * 1000)`. |
| `level` | Enum string | Allowed: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. NOT NULL. |
| `category` | Enum string | Allowed: `system`, `capture`, `processing`, `storage`, `api`, `websocket`, `device`, `config`. NOT NULL. |
| `source` | Module identifier | NOT NULL. Dot-separated module path. Examples: `main`, `scanner.pipeline`, `storage.paperless`, `database.migrate`. Max 128 chars. |
| `device_mac` | MAC address | NULL for non-device events. When set, must match `XX:XX:XX:XX:XX:XX` format. Logical reference to `devices.mac`. |
| `message` | Human-readable text | NOT NULL. Max 500 chars. Single-line preferred. Should be meaningful without `details`. |
| `details` | JSON object string | Must be valid JSON object. Default: `'{}'`. See [Section 6.5](#65-logsdetails). |

#### Retention Policy

Logs are retained for a configurable period (default: 30 days). A background task
runs daily to delete logs older than the retention threshold:

```sql
DELETE FROM logs WHERE timestamp < :cutoff_ms;
```

The cutoff is computed as: `int((now - timedelta(days=retention_days)).timestamp() * 1000)`.

---

## 3. Relationships

### Foreign Keys

| Relationship | From | To | Type | Constraint | On Delete |
|-------------|------|-----|------|-----------|-----------|
| Batch pages | `pages.batch_id` | `batches.id` | Many-to-one | Enforced FK | CASCADE |

### Logical References (Not Enforced)

| Relationship | From | To | Type | Rationale |
|-------------|------|-----|------|-----------|
| Batch source device | `batches.device_mac` | `devices.mac` | Many-to-one | Allows non-device values (`web-camera`, `file-upload`) |
| Batch processing profile | `batches.profile` | `profiles.id` | Many-to-one | Profile may be deleted; batch keeps the historical profile name |
| Log source device | `logs.device_mac` | `devices.mac` | Many-to-one | Allows logging for devices before/after registration |

### Cardinality Summary

| Parent | Child | Cardinality | Description |
|--------|-------|-------------|-------------|
| `devices` | `batches` | 1:N | One device produces many batches over its lifetime |
| `batches` | `pages` | 1:N | One batch contains 1-999 pages |
| `profiles` | `batches` | 1:N | One profile is used by many batches |
| `devices` | `logs` | 1:N | One device is referenced by many log entries |

### Referential Integrity Notes

- **pages -> batches**: The only enforced foreign key. Cascade delete ensures no
  orphaned pages exist in the database. When a batch is deleted, all its pages are
  removed atomically.

- **batches -> devices**: Not enforced because `device_mac` holds virtual
  identifiers (`web-camera`, `file-upload`) for non-hardware sources. Application
  code ensures that `esp32cam` batches reference a valid device MAC.

- **batches -> profiles**: Not enforced because a profile may be deleted after
  batches have been processed with it. The `profile` column preserves the profile
  ID for historical reference.

- **logs -> devices**: Not enforced because logs may reference devices that have
  been unregistered. Log entries are retained independently of device lifecycle.

---

## 4. State Transitions

### 4.1 Batch Status

The `batches.status` column tracks the lifecycle of a scan batch through six
possible states.

```
                    ┌──────────┐
                    │ pending  │
                    └────┬─────┘
                         │ First page upload begins
                         v
                    ┌──────────┐
                    │uploading │
                    └────┬─────┘
                         │ All pages uploaded + process triggered
                         v
                    ┌──────────┐
               ┌────│processing│────┐
               │    └────┬─────┘    │
               │         │          │
               │ Error   │ Success  │ Error
               │         v          │
               │    ┌──────────┐    │
               │    │completed │    │
               │    └────┬─────┘    │
               │         │          │
               │    Export│triggered │
               │         v          │
               │  ┌─────────────┐   │
               │  │  exporting  │   │
               │  │  (in-app    │   │
               │  │   only)     │   │
               │  └──┬──────┬───┘   │
               │     │      │       │
               │  All OK  Partial   │
               │     │    failure   │
               │     v      v       │
               │  ┌────┐ ┌──────────┴──┐
               └─>│error│ │export_failed│
                  └────┘ └─────────────┘
```

#### Transition Table

| From | To | Trigger | Side Effects |
|------|----|---------|-------------|
| `pending` | `uploading` | First page image received (`POST /api/scan/upload/{batch_id}/{page_index}`) | `updated_at` set. WebSocket: `page_uploaded`. |
| `uploading` | `processing` | Processing triggered (`POST /api/scan/process/{batch_id}`) | `updated_at` set. WebSocket: `processing_started`. |
| `processing` | `completed` | All pages processed successfully | `processing_duration_ms` set. `updated_at` set. `devices.total_scans` incremented (if source is ESP32-CAM). WebSocket: `processing_complete`. Auto-export triggered if configured. |
| `processing` | `error` | Unrecoverable processing failure | `error` field set with message. `updated_at` set. WebSocket: `processing_error`. Log: ERROR. |
| `completed` | `completed` | Successful export to all configured backends | `export_info` updated with per-backend results. `updated_at` set. WebSocket: `export_complete`. |
| `completed` | `export_failed` | One or more export backends fail | `export_info` updated with per-backend results. `error` field set. `updated_at` set. WebSocket: `export_error`. Log: ERROR. |
| `export_failed` | `completed` | Successful retry of all failed backends | `export_info` updated. `error` cleared. `updated_at` set. WebSocket: `export_complete`. |
| `export_failed` | `export_failed` | Retry fails again | `export_info` updated. `error` updated. `updated_at` set. |
| `completed` | `processing` | Reprocess triggered (`POST /api/scans/{id}/reprocess`) | All page statuses reset to `pending`. `processed_path` cleared. `updated_at` set. WebSocket: `processing_started`. |
| `error` | `processing` | Reprocess triggered | Same as above. `error` cleared. |

#### Invalid Transitions

The following transitions are not allowed and must be rejected by the application:

- `pending` -> `processing` (must upload first)
- `pending` -> `completed` (must process first)
- `uploading` -> `completed` (must process first)
- Any state -> `pending` (initial state only)
- Any state -> `uploading` (can only be reached from `pending`)

---

### 4.2 Page Status

The `pages.status` column tracks the lifecycle of a single page image through five
possible states.

```
    ┌────────┐
    │pending │
    └───┬────┘
        │ Image file written to disk
        v
    ┌────────┐
    │uploaded│
    └───┬────┘
        │ Pipeline starts processing this page
        v
    ┌──────────┐
    │processing│
    └──┬────┬──┘
       │    │
    OK │    │ Failure
       v    v
┌─────────┐ ┌─────┐
│processed│ │error│
└─────────┘ └─────┘
```

#### Transition Table

| From | To | Trigger | Side Effects |
|------|----|---------|-------------|
| `pending` | `uploaded` | Image file successfully written to disk | `file_size_original` set. `original_path` set. WebSocket: `page_uploaded`. |
| `uploaded` | `processing` | Pipeline begins processing this page | WebSocket: `processing_page`. |
| `processing` | `processed` | Pipeline completes all enabled steps | `processed_path` set. `file_size_processed` set. `processing_details` populated. WebSocket: `page_processed`. |
| `processing` | `error` | Unrecoverable error during processing | `processing_details` populated with error info. WebSocket: `processing_error`. Log: ERROR. |
| `processed` | `processing` | Reprocess triggered on parent batch | `processed_path` cleared. `file_size_processed` reset to 0. `processing_details` reset to `'{}'`. |
| `error` | `processing` | Reprocess triggered on parent batch | Same as above. |

---

### 4.3 Device Online/Offline (Derived)

Device connectivity status is not stored in the database. It is computed at query
time from `last_seen`:

```
                     ┌────────┐
          Boot/      │ online │ <── heartbeat received
          Register   └───┬────┘     (POST /api/device/register)
                         │
                         │ 180 seconds without heartbeat
                         v
                     ┌────────┐
                     │offline │
                     └───┬────┘
                         │
                         │ Heartbeat received
                         v
                     ┌────────┐
                     │ online │
                     └────────┘
```

#### Heartbeat Protocol

1. Device sends `POST /api/device/register` every 60 seconds.
2. Server updates `devices.last_seen` and `devices.ip`.
3. Server response includes current device config (resolution, flash, etc.).
4. A background task runs every 30 seconds, checking for devices where
   `(now - last_seen) >= 180s`. For each newly offline device, a
   `device_offline` WebSocket event is emitted and an INFO log is created.

---

## 5. Indexes

### 5.1 Index Definitions

```sql
-- logs: query by timestamp for chronological display and retention cleanup
CREATE INDEX IF NOT EXISTS idx_logs_timestamp
    ON logs (timestamp);

-- logs: filter by level (ERROR, CRITICAL) for troubleshooting
CREATE INDEX IF NOT EXISTS idx_logs_level
    ON logs (level);

-- logs: filter by category for targeted investigation
CREATE INDEX IF NOT EXISTS idx_logs_category
    ON logs (category);

-- logs: filter by device for device-specific log views
CREATE INDEX IF NOT EXISTS idx_logs_device_mac
    ON logs (device_mac);

-- batches: list batches by creation date (history page default sort)
CREATE INDEX IF NOT EXISTS idx_batches_created_at
    ON batches (created_at);

-- batches: filter by status (pending, processing, error)
CREATE INDEX IF NOT EXISTS idx_batches_status
    ON batches (status);

-- batches: filter by device (history page device filter)
CREATE INDEX IF NOT EXISTS idx_batches_device_mac
    ON batches (device_mac);

-- pages: look up pages by batch (batch detail page)
-- Note: covered by composite PK (batch_id, page_index) so no extra index needed.

-- devices: look up by last_seen for online/offline detection
CREATE INDEX IF NOT EXISTS idx_devices_last_seen
    ON devices (last_seen);
```

### 5.2 Index Rationale

| Index | Used By | Query Pattern | Performance Target |
|-------|---------|---------------|-------------------|
| `idx_logs_timestamp` | Log viewer, retention cleanup | `WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?` | < 1s on 100k+ rows (SC-007) |
| `idx_logs_level` | Log filter by severity | `WHERE level IN ('ERROR', 'CRITICAL')` | < 1s on 100k+ rows |
| `idx_logs_category` | Log filter by category | `WHERE category = 'processing'` | < 1s on 100k+ rows |
| `idx_logs_device_mac` | Device-specific log view | `WHERE device_mac = ?` | < 1s on 100k+ rows |
| `idx_batches_created_at` | History page default sort | `ORDER BY created_at DESC LIMIT ?` | < 500ms on 1000+ batches (SC-005) |
| `idx_batches_status` | History page status filter | `WHERE status = 'error'` | < 500ms on 1000+ batches |
| `idx_batches_device_mac` | History page device filter | `WHERE device_mac = ?` | < 500ms on 1000+ batches |
| `idx_devices_last_seen` | Background online/offline check | `WHERE last_seen < ?` | < 100ms on 10 devices |

### 5.3 Composite Index Considerations

For the history page which commonly combines filters, a composite index may be
added if query performance degrades:

```sql
-- Future optimization: composite index for combined filters
-- CREATE INDEX IF NOT EXISTS idx_batches_status_created
--     ON batches (status, created_at);
```

This is deferred to avoid premature optimization. The single-column indexes
combined with SQLite's query planner should suffice for the expected scale
(1000-10000 batches).

---

## 6. JSON Column Schemas

All JSON columns store data as TEXT in SQLite. The application layer validates
JSON structure on read/write using Pydantic models.

### 6.1 devices.config

Device-specific configuration pushed to the ESP32-CAM on its next heartbeat.

```json
{
  "flash_enabled": true,
  "flash_intensity": 128,
  "quality": 10,
  "framesize": "UXGA",
  "auto_send": false,
  "capture_delay_ms": 500
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `flash_enabled` | boolean | `true` | Whether to fire the flash LED on capture |
| `flash_intensity` | integer (0-255) | `128` | Flash LED brightness (PWM duty cycle) |
| `quality` | integer (0-63) | `10` | JPEG compression quality (lower = better quality, larger file) |
| `framesize` | string (enum) | `"UXGA"` | Camera frame size. Matches `resolution` column. |
| `auto_send` | boolean | `false` | If true, auto-upload after each capture (no SEND button needed) |
| `capture_delay_ms` | integer (0-5000) | `500` | Minimum delay between captures in milliseconds |

### 6.2 batches.export_info

Per-backend export results. Each key is a backend identifier.

```json
{
  "local": {
    "success": true,
    "path": "/exports/2026-02-23_a1b2c3d4_3pages.pdf",
    "exported_at": "2026-02-23T14:35:00.000Z"
  },
  "paperless": {
    "success": false,
    "error": "Connection refused: http://paperless:8000",
    "attempted_at": "2026-02-23T14:35:01.500Z"
  },
  "webdav": {
    "success": true,
    "url": "https://nextcloud.example.com/remote.php/dav/files/user/Scans/2026-02-23_a1b2c3d4.pdf",
    "exported_at": "2026-02-23T14:35:02.000Z"
  }
}
```

| Field (per backend) | Type | Description |
|---------------------|------|-------------|
| `success` | boolean | Whether the export succeeded |
| `path` / `url` | string | Destination path (local) or URL (remote). Present on success. |
| `error` | string | Error message. Present on failure. |
| `exported_at` / `attempted_at` | string (ISO 8601) | Timestamp of the export attempt |
| `document_id` | integer | Paperless-NGX document ID. Present on successful Paperless export. |

### 6.3 pages.processing_details

Per-step processing timing and results for a single page.

```json
{
  "pipeline_version": "1.0",
  "total_duration_ms": 3200,
  "steps": {
    "auto_crop": {
      "enabled": true,
      "executed": true,
      "duration_ms": 450,
      "result": "success",
      "details": {
        "contour_found": true,
        "contour_area_ratio": 0.82,
        "corners": [[10,15],[590,12],[592,840],[8,838]]
      }
    },
    "deskew": {
      "enabled": true,
      "executed": true,
      "duration_ms": 180,
      "result": "success",
      "details": {
        "angle_degrees": -1.3
      }
    },
    "denoise": {
      "enabled": true,
      "executed": true,
      "duration_ms": 800,
      "result": "success",
      "details": {
        "method": "fastNlMeansDenoising",
        "h": 10
      }
    },
    "clahe": {
      "enabled": true,
      "executed": true,
      "duration_ms": 120,
      "result": "success",
      "details": {
        "clip_limit": 2.0,
        "grid_size": [8, 8]
      }
    },
    "sharpen": {
      "enabled": true,
      "executed": true,
      "duration_ms": 90,
      "result": "success",
      "details": {
        "kernel_size": 3,
        "sigma": 1.0,
        "amount": 1.5
      }
    },
    "white_balance": {
      "enabled": true,
      "executed": true,
      "duration_ms": 60,
      "result": "success",
      "details": {
        "method": "gray_world",
        "correction_factors": [1.02, 1.00, 0.98]
      }
    },
    "bw_conversion": {
      "enabled": false,
      "executed": false,
      "duration_ms": 0,
      "result": "skipped"
    },
    "output": {
      "enabled": true,
      "executed": true,
      "duration_ms": 500,
      "result": "success",
      "details": {
        "format": "jpeg",
        "quality": 85,
        "dimensions": [1200, 1600]
      }
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `pipeline_version` | string | Version of the pipeline that produced this result |
| `total_duration_ms` | integer | Total processing time for this page |
| `steps` | object | Map of step name to step result |
| `steps.*.enabled` | boolean | Whether the step was enabled in the profile |
| `steps.*.executed` | boolean | Whether the step actually ran (false if skipped due to error in dependency) |
| `steps.*.duration_ms` | integer | Execution time for this step |
| `steps.*.result` | string | `success`, `skipped`, `error` |
| `steps.*.details` | object | Step-specific output data (varies per step) |
| `steps.*.error` | string | Error message if `result` is `error` |

### 6.4 profiles.options

Full pipeline configuration. Defines which steps are enabled and their parameters.

```json
{
  "output_format": "pdf",
  "output_quality": 85,
  "steps": {
    "auto_crop": {
      "enabled": true,
      "min_area_ratio": 0.1,
      "epsilon_factor": 0.02,
      "fallback_to_hough": true
    },
    "deskew": {
      "enabled": true,
      "max_angle": 15
    },
    "denoise": {
      "enabled": true,
      "method": "fastNlMeansDenoising",
      "h": 10,
      "template_window_size": 7,
      "search_window_size": 21
    },
    "clahe": {
      "enabled": true,
      "clip_limit": 2.0,
      "grid_size": [8, 8]
    },
    "sharpen": {
      "enabled": true,
      "kernel_size": 3,
      "sigma": 1.0,
      "amount": 1.5,
      "threshold": 0
    },
    "white_balance": {
      "enabled": true,
      "method": "gray_world"
    },
    "bw_conversion": {
      "enabled": false,
      "method": "adaptive",
      "block_size": 11,
      "c_constant": 2
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `output_format` | string | `"pdf"` | Output format: `pdf`, `jpeg`, `png` |
| `output_quality` | integer (1-100) | `85` | JPEG/PDF compression quality |
| `steps.auto_crop.enabled` | boolean | `true` | Enable document edge detection and cropping |
| `steps.auto_crop.min_area_ratio` | float (0-1) | `0.1` | Minimum contour area as ratio of image area |
| `steps.auto_crop.epsilon_factor` | float | `0.02` | Contour approximation epsilon factor |
| `steps.auto_crop.fallback_to_hough` | boolean | `true` | Use Hough lines if no contour found |
| `steps.deskew.enabled` | boolean | `true` | Enable rotation correction |
| `steps.deskew.max_angle` | float (0-45) | `15` | Maximum rotation angle in degrees |
| `steps.denoise.enabled` | boolean | `true` | Enable noise reduction |
| `steps.denoise.method` | string | `"fastNlMeansDenoising"` | `fastNlMeansDenoising` or `bilateral` |
| `steps.denoise.h` | integer (1-30) | `10` | Filter strength (higher = more denoising, more blur) |
| `steps.denoise.template_window_size` | integer (odd, 3-21) | `7` | Template patch size |
| `steps.denoise.search_window_size` | integer (odd, 7-41) | `21` | Search area size |
| `steps.clahe.enabled` | boolean | `true` | Enable adaptive contrast enhancement |
| `steps.clahe.clip_limit` | float (0.1-10) | `2.0` | Contrast limiting threshold |
| `steps.clahe.grid_size` | [int, int] | `[8, 8]` | Tile grid size for local histogram |
| `steps.sharpen.enabled` | boolean | `true` | Enable unsharp mask sharpening |
| `steps.sharpen.kernel_size` | integer (odd, 1-31) | `3` | Gaussian blur kernel size |
| `steps.sharpen.sigma` | float (0.1-10) | `1.0` | Gaussian blur sigma |
| `steps.sharpen.amount` | float (0.1-5) | `1.5` | Sharpening strength |
| `steps.sharpen.threshold` | integer (0-255) | `0` | Minimum brightness difference to sharpen |
| `steps.white_balance.enabled` | boolean | `true` | Enable white balance correction |
| `steps.white_balance.method` | string | `"gray_world"` | Algorithm: `gray_world` |
| `steps.bw_conversion.enabled` | boolean | `false` | Enable black-and-white conversion |
| `steps.bw_conversion.method` | string | `"adaptive"` | `adaptive` (adaptiveThreshold) or `otsu` (Otsu threshold) |
| `steps.bw_conversion.block_size` | integer (odd, 3-99) | `11` | Adaptive threshold block size |
| `steps.bw_conversion.c_constant` | integer (0-20) | `2` | Constant subtracted from mean in adaptive threshold |

### 6.5 logs.details

Structured context data for a log entry. Schema varies by category. Common patterns:

#### Processing Log

```json
{
  "batch_id": "a1b2c3d4",
  "page_index": 2,
  "step": "auto_crop",
  "duration_ms": 450,
  "result": "success"
}
```

#### Storage/Export Log

```json
{
  "batch_id": "a1b2c3d4",
  "backend": "paperless",
  "error": "Connection refused",
  "url": "http://paperless:8000/api/documents/post_document/",
  "timeout_ms": 5000
}
```

#### Device Log

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "ip": "192.168.1.50",
  "firmware": "1.0.0",
  "event": "registered"
}
```

#### API Log

```json
{
  "method": "POST",
  "path": "/api/scan/upload/a1b2c3d4/0",
  "status_code": 200,
  "duration_ms": 45,
  "client_ip": "192.168.1.50"
}
```

#### System Log

```json
{
  "event": "startup",
  "version": "0.1.0",
  "database": "/data/espscancam.db",
  "port": 8400
}
```

The `details` field is intentionally schema-flexible. The only hard requirement
is that it must be a valid JSON object. Consumers should handle missing keys
gracefully.

---

## 7. File Storage Paths

All file paths stored in the database (`original_path`, `processed_path`) are
**relative to the `/data` volume mount**. The application prepends the data
directory (default `/data`, configurable via `ESPSCANCAM_DATA_DIR`).

### 7.1 Directory Structure

```
/data/
├── espscancam.db                          # SQLite database (WAL mode)
├── espscancam.db-wal                      # WAL file (auto-managed)
├── espscancam.db-shm                      # Shared memory file (auto-managed)
├── config.json                            # Application configuration
├── scans/
│   └── {batch_id}/
│       ├── original/
│       │   ├── 0.jpg                      # Page 0 original
│       │   ├── 1.jpg                      # Page 1 original
│       │   └── ...
│       └── processed/
│           ├── 0.jpg                      # Page 0 processed (or .png)
│           ├── 1.jpg                      # Page 1 processed (or .png)
│           └── ...
└── exports/
    ├── {batch_id}.pdf                     # Exported PDF
    └── {batch_id}.zip                     # Exported ZIP (multi-file)
```

### 7.2 Path Conventions

| Path Pattern | Stored In | Example |
|-------------|-----------|---------|
| `scans/{batch_id}/original/{page_index}.jpg` | `pages.original_path` | `scans/a1b2c3d4/original/0.jpg` |
| `scans/{batch_id}/processed/{page_index}.{ext}` | `pages.processed_path` | `scans/a1b2c3d4/processed/0.jpg` |
| `exports/{batch_id}.pdf` | Not stored (generated on demand or cached) | `exports/a1b2c3d4.pdf` |
| `exports/{batch_id}.zip` | Not stored (generated on demand) | `exports/a1b2c3d4.zip` |

### 7.3 File Format Rules

- **Original files**: Always JPEG (`.jpg`). ESP32-CAM captures as JPEG natively.
  Web camera and file upload inputs are converted to JPEG before storage (HEIC,
  PNG, WebP are accepted at upload and converted server-side).

- **Processed files**: Format determined by `profiles.options.output_format`:
  - `jpeg` -> `.jpg` (default)
  - `png` -> `.png` (lossless, larger files)

- **Export files**: Format determined by export configuration:
  - Single or multi-page -> `.pdf` (default)
  - Multi-file archive -> `.zip` (contains individual processed images)

### 7.4 Security: Path Traversal Prevention

All file path operations must validate:

1. `batch_id` matches `^[a-f0-9]{8}$` (no slashes, no dots).
2. `page_index` is a non-negative integer (no slashes, no dots).
3. Final resolved path starts with the data directory prefix.
4. No `..` segments are present in any path component.

```python
def safe_path(data_dir: str, *parts: str) -> str:
    path = os.path.join(data_dir, *parts)
    resolved = os.path.realpath(path)
    if not resolved.startswith(os.path.realpath(data_dir)):
        raise ValueError("Path traversal detected")
    return resolved
```

---

## 8. Migration Strategy

### 8.1 SQLite Pragmas

The following pragmas are set on every database connection open:

```sql
-- Enable Write-Ahead Logging for concurrent reads during writes
PRAGMA journal_mode = WAL;

-- Wait up to 5 seconds when the database is locked (write contention)
PRAGMA busy_timeout = 5000;

-- Enable foreign key constraint enforcement (off by default in SQLite)
PRAGMA foreign_keys = ON;

-- Synchronous mode: NORMAL is safe with WAL and provides better performance
PRAGMA synchronous = NORMAL;

-- Store temp tables in memory for performance
PRAGMA temp_store = MEMORY;

-- Set a reasonable cache size (negative = KB, positive = pages)
PRAGMA cache_size = -64000;
```

### 8.2 Database Initialization

On first startup (database file does not exist), the application:

1. Creates the database file at `{ESPSCANCAM_DATA_DIR}/espscancam.db`.
2. Sets all pragmas (Section 8.1).
3. Executes all `CREATE TABLE IF NOT EXISTS` statements (Section 2).
4. Executes all `CREATE INDEX IF NOT EXISTS` statements (Section 5).
5. Seeds the 5 built-in profiles (Section 2.4).
6. Creates a system log entry: `"Database initialized"`.

### 8.3 Schema Versioning

A `schema_version` is stored in SQLite's built-in `user_version` pragma:

```sql
-- Read current version
PRAGMA user_version;

-- Set version after migration
PRAGMA user_version = 1;
```

| Version | Description | Migration |
|---------|-------------|-----------|
| 0 | Fresh install (no tables) | Run full initialization |
| 1 | Initial schema (v0.1 MVP) | Baseline: all tables, indexes, seed data |

Future migrations are applied sequentially. Each migration checks the current
`user_version`, applies changes, and increments the version:

```python
async def migrate(db):
    version = await db.execute_fetchone("PRAGMA user_version")
    if version[0] < 1:
        await apply_v1(db)  # Create all tables, indexes, seed profiles
        await db.execute("PRAGMA user_version = 1")
    # if version[0] < 2:
    #     await apply_v2(db)  # Future migration
    #     await db.execute("PRAGMA user_version = 2")
```

### 8.4 Backup and Restore

- **Backup**: Use SQLite's online backup API (`sqlite3.backup()`) or copy the
  database file while in WAL mode (WAL checkpoint first for consistency).
- **Restore**: Stop the application, replace the database file, restart.
- **Config backup/restore**: Handled separately via `/api/settings` (export/import
  `config.json`). Database and file storage are not included in config backup.

### 8.5 Connection Management

- Use `aiosqlite` for async access from FastAPI's async endpoints.
- Single writer pattern: write operations are serialized via an application-level
  lock or SQLite's built-in locking with `busy_timeout`.
- Multiple concurrent readers: read operations proceed without blocking.
- Connection pool: maintained by `aiosqlite` with appropriate lifecycle
  (open on startup, close on shutdown).

---

*This data model document is the Phase 1 output of the speckit workflow. It is
the authoritative reference for all database-related implementation decisions
in ESPScanCam.*
