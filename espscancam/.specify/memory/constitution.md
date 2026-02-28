<!--
  Sync Impact Report
  ==================
  Version change: N/A → 1.0.0 (initial creation)

  Added principles:
    - I. Self-Hosted First
    - II. Mobile-First Responsive
    - III. Multi-Source Capture
    - IV. Everything Is Configurable
    - V. Real-Time by Default
    - VI. Observable & Auditable
    - VII. Non-Destructive Processing
    - VIII. Modular Storage

  Added sections:
    - Technical Stack & Architecture
    - API & Data Contracts
    - Development Workflow
    - ESP32-CAM Firmware Standards
    - Frontend Standards
    - Security & Deployment
    - Governance

  Removed sections: N/A (initial creation)

  Templates requiring updates:
    - .specify/templates/plan-template.md — ✅ No changes required (Constitution Check
      section is generic and will resolve against this constitution at runtime)
    - .specify/templates/spec-template.md — ✅ No changes required (user story format
      is compatible with constitution principles)
    - .specify/templates/tasks-template.md — ✅ No changes required (phase structure
      is compatible with constitution workflow)

  Follow-up TODOs: None
-->

# Satsu Constitution

## Core Principles

### I. Self-Hosted First

Satsu is a 100% self-hosted document scanning system. Zero cloud dependency
is mandatory. Every feature MUST function in a fully air-gapped local network
environment with no internet access.

- **Data Sovereignty**: All user data (images, metadata, logs, configuration)
  MUST reside exclusively within the user's Docker volume (`/data`). No telemetry,
  no analytics, no external calls.
- **Single Container**: The entire application (backend + frontend static assets)
  MUST run in a single Docker container. No sidecar services, no external databases,
  no message queues.
- **Optional Cloud Integrations**: Cloud storage backends (Google Drive, WebDAV)
  are OPTIONAL export targets, never dependencies. The system MUST function fully
  without them configured.
- **Offline Firmware**: ESP32-CAM devices MUST operate on the local network only.
  They communicate exclusively with the Satsu backend via HTTP POST over WiFi.
  No firmware update from cloud, no external API calls.
- **Docker-First Deployment**: The primary (and only supported) deployment method is
  Docker. The container MUST be compatible with Unraid, Proxmox LXC, and standard
  Docker Compose environments. Port is configurable (default: `8400`).

### II. Mobile-First Responsive (NON-NEGOTIABLE)

The web interface is designed for smartphones first. Desktop and tablet layouts are
progressive enhancements. Every page, every component, every interaction MUST be
fully functional on a 375px viewport.

- **Three Breakpoints** (strictly enforced):

  | Breakpoint | Width | Layout | Navigation |
  |------------|-------|--------|------------|
  | Mobile | `< 768px` | Single column, full-width | Bottom tab bar (fixed) |
  | Tablet | `768px – 1023px` | Adaptive columns | Collapsible sidebar |
  | Desktop | `>= 1024px` | Multi-column | Fixed sidebar |

- **Mobile-Specific Requirements**:
  - Scanner camera view MUST be full-screen on mobile (no chrome, no bars).
  - Before/after comparison MUST use toggle or swipe gestures (not side-by-side).
  - Zoom MUST use pinch gestures with smooth inertia.
  - All tap targets MUST be minimum 44×44px (Apple HIG).
  - Bottom tab bar MUST remain visible and accessible on all pages.
- **Desktop Enhancements** (never mobile regressions):
  - Side-by-side before/after comparison.
  - Scroll-based zoom with mousewheel.
  - Multi-column layouts for dashboard and history.
  - Keyboard shortcuts for power users.
- **Testing Gate**: Every PR that modifies frontend code MUST be verified at all
  three breakpoints. A component that renders incorrectly at 375px is a blocking bug.

### III. Multi-Source Capture

The system accepts images from N simultaneous sources: ESP32-CAM hardware modules,
web browser cameras (MediaDevices API), and file uploads. Sources MUST never
interfere with each other.

- **Source Isolation**: Each capture session creates a unique `batch_id`. A batch is
  bound to exactly one source device/session. Concurrent captures from different
  sources produce independent batches.
- **ESP32-CAM Sources**: Unlimited hardware modules. Each device self-registers via
  `POST /api/device/register` with its MAC address as unique identifier.
  Auto-discovery and configuration are managed via the backend.
- **Web Camera Sources**: Browser-based capture via `getUserMedia()`. MUST support:
  - Front/back camera switching.
  - Flash/torch toggle (where hardware supports it).
  - Live preview with overlay guides.
  - Full-screen capture mode on mobile.
  - HTTPS is REQUIRED for camera access (except `localhost` for development).
- **File Upload Sources**: Drag-and-drop zone, multi-file select, manual page
  reordering within a batch. Accepted formats: JPEG, PNG, TIFF, BMP, WebP.
- **Source Traceability**: Every batch records its source type (`esp32cam`,
  `web_camera`, `file_upload`) and source identifier (MAC address, session ID,
  or `upload`). This metadata is immutable after batch creation.

### IV. Everything Is Configurable

Every system behavior MUST be configurable via the Settings UI. No parameter may be
hardcoded. If a developer adds a feature, they MUST add the corresponding
configuration parameters.

- **Configuration Storage**: JSON file at `/data/config.json`. Environment variables
  override JSON values (prefix: `SATSU_`). Configuration changes via API
  persist to the JSON file immediately.
- **Settings Organization** (7 tabs):

  | Tab | Scope |
  |-----|-------|
  | General | App name, language, theme (dark/light/auto), timezone |
  | Capture | Default resolution, JPEG quality, max pages per batch, auto-process toggle |
  | Processing | Pipeline defaults, profile selection, per-step toggles and parameters |
  | Storage | Backend configurations (local, Paperless-NGX, WebDAV, Google Drive, SMB), naming templates, retention |
  | Notifications | Future: webhook, email (extensible) |
  | Logs | Retention period, default level filter, max entries, export format |
  | System | Port, data directory, database maintenance, backup/restore config, about |

- **Processing Profiles**: Named configurations of the full processing pipeline.
  Users can create, edit, duplicate, delete, and set a default profile. Profiles are
  stored in the `profiles` SQLite table.
- **No Hidden Defaults**: Every default value MUST be visible in the Settings UI and
  modifiable by the user. If a default changes in an update, the user's existing
  config takes precedence.

### V. Real-Time by Default

Every action produces immediate feedback. WebSocket is the primary channel for all
state updates. The frontend MUST never require a manual page refresh to see a
state change.

- **Single WebSocket Endpoint**: `ws://host:port/ws`. All real-time events flow
  through this connection. The frontend maintains a persistent connection with
  automatic reconnection (exponential backoff, max 5 seconds between retries).
- **Event Categories**:

  | Category | Events |
  |----------|--------|
  | Devices | `device_online`, `device_offline` |
  | Capture | `page_captured`, `batch_created`, `page_uploaded` |
  | Processing | `processing_started`, `processing_page`, `page_processed`, `processing_complete`, `processing_error` |
  | Export | `exporting`, `export_complete`, `export_error` |
  | System | `batch_deleted`, `config_changed`, `log` |

- **Event Format** (JSON):
  ```json
  {
    "event": "processing_page",
    "data": {
      "batch_id": "abc123",
      "page_index": 2,
      "step": "deskew",
      "progress": 0.6
    },
    "timestamp": 1708700000000
  }
  ```
- **Frontend Contract**: Every WebSocket event MUST trigger an immediate UI update
  (list refresh, progress bar advance, toast notification, status badge change).
  No polling allowed as a substitute for WebSocket events.
- **Graceful Degradation**: If the WebSocket connection drops, the frontend MUST
  display a reconnection indicator and automatically re-establish the connection.
  Upon reconnection, a state sync request MUST bring the UI up to date.

### VI. Observable & Auditable

Every significant system event is logged. No error may be silenced. The system MUST
provide complete observability through structured logging and rich scan history.

- **Structured Logging**: All log entries follow a strict JSON schema:
  ```json
  {
    "id": 12345,
    "timestamp": 1708700000000,
    "level": "INFO",
    "category": "processing",
    "source": "scanner.py",
    "device_mac": "AA:BB:CC:DD:EE:FF",
    "message": "Page 2 deskew completed",
    "details": {"angle": -1.3, "duration_ms": 45}
  }
  ```
- **Log Levels**: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. Default display
  level is configurable per user session.
- **Log Categories**: `system`, `capture`, `processing`, `storage`, `api`,
  `websocket`, `device`, `config`.
- **Real-Time Log Viewer**: Terminal-style scrolling view with:
  - Level filter (multi-select checkboxes).
  - Category filter.
  - Device filter.
  - Full-text search.
  - Auto-scroll with pause on user scroll-up.
- **Log Persistence**: SQLite `logs` table with indexes on `timestamp`, `level`,
  `category`, `device_mac`. Configurable retention (default: 30 days). Export to
  `.log` (plain text) or `.json` formats.
- **Scan History**: Every batch is permanently recorded with full metadata. History
  view MUST support:
  - Full-text search across batch metadata.
  - Combinable filters: status, device, date range, page count.
  - Multi-criteria sorting (date, status, size, page count).
  - Cursor-based pagination (NOT offset-based) for consistent performance.
  - Inline statistics (total scans, success rate, avg processing time).
  - Bulk actions (delete, reprocess, export).
  - Export to CSV or JSON.
- **Error Visibility**: Every caught exception MUST produce a log entry at `ERROR`
  or `CRITICAL` level. Unhandled exceptions MUST be caught by a global handler
  that logs and sends a WebSocket `processing_error` event.

### VII. Non-Destructive Processing

Original captured images are ALWAYS preserved. The processing pipeline adds
processed versions alongside originals, never replaces them. Deletion is an
explicit user action requiring confirmation.

- **Dual Storage**: Every page has two paths: `original_path` (immutable after
  capture) and `processed_path` (generated by the pipeline, replaceable on
  reprocess).
- **Processing Pipeline**: A sequential chain of toggleable steps, each with
  sub-parameters:

  | Step | Description | Key Parameters |
  |------|-------------|----------------|
  | Auto-crop | Canny edge detection + contour finding, Hough line fallback | `enabled`, `canny_low`, `canny_high`, `min_area_ratio` |
  | Perspective correction | 4-point transform from detected document corners | `enabled`, `corner_refinement` |
  | Deskew | Rotation correction via `minAreaRect` | `enabled`, `max_angle` |
  | Denoise | Noise reduction | `enabled`, `strength`, `method` (`fastNlMeans`/`bilateral`) |
  | Contrast (CLAHE) | Adaptive histogram equalization | `enabled`, `clip_limit`, `grid_size` |
  | Sharpening | Unsharp mask or kernel-based | `enabled`, `amount`, `radius` |
  | White balance | Gray-world or manual temperature | `enabled`, `method`, `temperature` |
  | Black & white | Adaptive threshold conversion | `enabled`, `method` (`adaptive`/`otsu`), `block_size` |
  | PDF generation | Merge processed pages into PDF | `enabled`, `dpi`, `compression` |

- **Before/After Comparison**: The UI MUST always offer a comparison view between
  original and processed versions. Desktop: side-by-side slider. Mobile: toggle
  tap or swipe.
- **Reprocessing**: Any batch can be reprocessed with different settings or a
  different profile. Reprocessing overwrites `processed_path` but NEVER touches
  `original_path`.
- **Explicit Deletion**: Deleting a batch removes both original and processed files.
  This action MUST require a confirmation dialog. Bulk deletion MUST show the count
  of affected items and require explicit confirmation.

### VIII. Modular Storage

The export system is fully decoupled from the processing pipeline. Adding a new
storage backend MUST follow a defined interface. Export can target multiple backends
simultaneously.

- **Storage Backend Interface**: Every backend MUST implement:
  ```python
  class StorageBackend:
      async def upload(self, file_path: str, remote_name: str,
                       metadata: dict) -> dict:
          """Upload a file. Returns {"success": bool, "url": str|None, "error": str|None}"""

      async def test_connection(self) -> dict:
          """Test connectivity. Returns {"success": bool, "message": str}"""
  ```
- **Built-in Backends**:

  | Backend | Transport | Configuration |
  |---------|-----------|--------------|
  | Local | Filesystem copy | `path` |
  | Paperless-NGX | REST API (`POST /api/documents/post_document/`) | `url`, `token`, `correspondent`, `document_type`, `tags` |
  | WebDAV | HTTP PUT (Nextcloud, ownCloud) | `url`, `username`, `password`, `remote_path` |
  | Google Drive | Service account JSON key | `credentials_json`, `folder_id` |
  | SMB/CIFS | `smbprotocol` library | `server`, `share`, `username`, `password`, `remote_path` |

- **Naming Templates**: Configurable filename patterns using variables:
  `{date}`, `{time}`, `{device}`, `{batch_id}`, `{page_count}`, `{profile}`.
  Default: `Satsu_{date}_{time}_{device}`.
- **Multi-Target Export**: A single batch can be exported to multiple backends in
  one operation. Each backend reports its own success/failure independently.
- **Connection Testing**: Every backend configuration MUST be testable from the
  Settings UI before use. Test results are displayed inline with clear
  success/failure messaging.
- **Retention Policies**: Per-backend configurable retention. Local storage can
  auto-delete exported originals after a configurable period (disabled by default,
  respecting Principle VII).

## Technical Stack & Architecture

### Architecture Overview

Satsu follows a strict 3-layer architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                       CAPTURE LAYER                             │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  ESP32-CAM   │  │  ESP32-CAM   │  │   Web Browser        │  │
│  │  Module #1   │  │  Module #N   │  │   (MediaDevices API)  │  │
│  │  Arduino C++ │  │  Arduino C++ │  │   + File Upload      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │ HTTP POST        │ HTTP POST           │ HTTP POST    │
└─────────┼──────────────────┼─────────────────────┼──────────────┘
          │                  │                     │
          ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                       BACKEND LAYER                             │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  FastAPI Application (Python 3.11+, uvicorn)            │    │
│  │                                                         │    │
│  │  ┌──────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐  │    │
│  │  │ REST API │ │ WebSocket │ │ Scanner   │ │ Storage │  │    │
│  │  │ Routes   │ │ Manager   │ │ Pipeline  │ │ Backends│  │    │
│  │  │ (main.py)│ │ (main.py) │ │(scanner.py│ │(storage │  │    │
│  │  │          │ │           │ │  OpenCV)  │ │  .py)   │  │    │
│  │  └────┬─────┘ └─────┬─────┘ └─────┬─────┘ └────┬────┘  │    │
│  │       │              │             │            │       │    │
│  │       ▼              ▼             ▼            ▼       │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │  SQLite (WAL mode) — database.py                 │   │    │
│  │  │  /data/satsu.db                             │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │  Filesystem — /data/scans/{batch_id}/            │   │    │
│  │  │  originals/ + processed/                         │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  Static Files: /frontend/build/ → served at /                   │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND LAYER                             │
│                                                                 │
│  React 18 SPA — Mobile-First Responsive                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Pages: Dashboard | Scanner | History | Detail | Logs     │ │
│  │         Devices | Settings | About                        │ │
│  │  Hooks: useWebSocket | useCamera | useSettings | useLogs  │ │
│  │  Real-time: WebSocket (native, auto-reconnect)            │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Choices & Rationale

| Technology | Choice | Rationale |
|------------|--------|-----------|
| Backend language | Python 3.11+ | Rich OpenCV bindings, async support, FastAPI ecosystem |
| Web framework | FastAPI | Native async, WebSocket support, auto-generated OpenAPI docs, Pydantic validation |
| ASGI server | uvicorn | High-performance async server, WebSocket support |
| Image processing | OpenCV (headless) | Industry standard, `headless` variant avoids X11/GUI deps (smaller Docker image) |
| Image utilities | Pillow | PDF generation, format conversion, metadata handling |
| Database | SQLite (WAL mode) | Zero-config, single-file, WAL enables concurrent reads during WebSocket writes |
| Async HTTP | aiohttp | Non-blocking calls to external APIs (Paperless-NGX, WebDAV) |
| Async files | aiofiles | Non-blocking file I/O for large image operations |
| Validation | Pydantic v2 | FastAPI-native, strict type validation, JSON schema generation |
| Frontend | React 18 | Component model, hooks, wide ecosystem, served as static build |
| Real-time | WebSocket (native) | No Socket.IO overhead, direct browser API, low latency |
| Camera access | MediaDevices API | Native browser API, no plugins, HTTPS-enforced security |
| CSS approach | CSS native or Tailwind | No heavy framework, utility-first for responsive design |
| Firmware | Arduino C++ | ESP32-CAM official framework, stable WiFi + camera libraries |
| Containerization | Docker multi-stage | Stage 1: Node.js builds frontend. Stage 2: Python runtime. Multi-arch: amd64 + arm64 |

### Repository Structure

```
satsu/
├── esp32cam/
│   ├── satsu.ino              # Main firmware sketch
│   └── config.example.h            # WiFi + server URL template
├── backend/
│   ├── main.py                     # FastAPI app, routes, WebSocket manager
│   ├── scanner.py                  # OpenCV processing pipeline
│   ├── storage.py                  # Storage backend implementations
│   ├── database.py                 # SQLite connection, migrations, queries
│   ├── logger.py                   # Structured logging system
│   ├── models.py                   # Pydantic request/response models
│   └── requirements.txt            # Python dependencies (pinned versions)
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # Root component, router, WebSocket provider
│   │   ├── pages/                  # Dashboard, Scanner, History, Detail,
│   │   │                           #   Logs, Devices, Settings, About
│   │   ├── components/             # StatCard, ScanItem, LogEntry, DeviceCard,
│   │   │                           #   CameraPreview, UploadZone, CompareView, ...
│   │   ├── hooks/                  # useWebSocket, useCamera, useSettings, useLogs
│   │   └── styles/                 # CSS files (mobile-first, breakpoint-based)
│   ├── index.html                  # SPA entry point
│   └── package.json                # Node dependencies
├── Dockerfile                      # Multi-stage: build frontend + Python runtime
├── docker-compose.yml              # Single service, port + volume mapping
├── CONSTITUTION.md                 # This file (symlink or copy from .specify/)
├── README.md                       # User-facing documentation
└── LICENSE                         # Project license
```

### Deployment Architecture

```bash
# Docker Compose (standard deployment)
services:
  satsu:
    image: satsu:latest
    container_name: satsu
    ports:
      - "8400:8400"
    volumes:
      - /path/to/data:/data
    environment:
      - SATSU_PORT=8400          # Optional override
    restart: unless-stopped
```

- **Volume `/data`**: Contains `satsu.db`, `config.json`, `scans/` directory.
  This is the ONLY persistent state. Backup = copy `/data`.
- **Port**: Configurable via `SATSU_PORT` env var or `config.json`. Default `8400`.
- **Multi-arch**: Docker image MUST be built for both `linux/amd64` and `linux/arm64`
  (Raspberry Pi, Apple Silicon Proxmox VMs).

## API & Data Contracts

### REST API Conventions

- **Base path**: `/api/`
- **Content type**: `application/json` for all request/response bodies except image
  uploads (`multipart/form-data`) and image serving (`image/jpeg`, `application/pdf`).
- **Naming**: Lowercase, hyphen-separated for multi-word resources
  (`/api/web-upload`, not `/api/webUpload`).
- **HTTP Methods**: `GET` (read), `POST` (create/action), `PUT` (full replace),
  `PATCH` (partial update), `DELETE` (remove).
- **Status Codes**:

  | Code | Usage |
  |------|-------|
  | `200` | Successful read or update |
  | `201` | Successful creation |
  | `204` | Successful deletion (no body) |
  | `400` | Validation error (malformed request) |
  | `404` | Resource not found |
  | `409` | Conflict (duplicate device, batch in wrong state) |
  | `422` | Unprocessable entity (Pydantic validation failure) |
  | `500` | Internal server error |

- **Error Format**:
  ```json
  {
    "error": "BATCH_NOT_FOUND",
    "message": "Batch abc123 does not exist",
    "details": {}
  }
  ```
- **Pagination** (cursor-based):
  ```
  GET /api/scans?cursor=eyJpZCI6MTIzfQ&limit=20&sort=created_at&order=desc
  ```
  Response includes `next_cursor` (null if last page) and `total_count`.
- **Filtering**: Query parameters with dot notation for nested filters:
  ```
  GET /api/scans?status=completed&device_mac=AA:BB:CC:DD:EE:FF&date_from=2025-01-01&date_to=2025-12-31&pages_min=2
  GET /api/logs?level=ERROR&category=processing&search=timeout
  ```

### API Endpoints

#### Devices

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/device/register` | Register/update ESP32-CAM device (body: `{mac, name, ip, firmware, resolution}`) |
| `POST` | `/api/device/capture` | Notify server that device initiated capture (body: `{mac, pages}`) |
| `GET` | `/api/devices` | List all registered devices with online status |
| `PUT` | `/api/devices/{mac}` | Update device settings (name, resolution, max_pages) |
| `DELETE` | `/api/devices/{mac}` | Unregister a device |
| `POST` | `/api/devices/{mac}/config` | Push configuration to device (queued for next heartbeat) |

#### Scans

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/scan/batch` | Create new batch (body: `{device_mac, source_type}`) |
| `POST` | `/api/scan/upload/{batch_id}/{page_index}` | Upload a page image (`multipart/form-data`) |
| `POST` | `/api/scan/process/{batch_id}` | Trigger processing pipeline on batch |
| `POST` | `/api/scan/web-upload` | Combined: create batch + upload pages from web (multi-file) |
| `GET` | `/api/scans` | List batches (paginated, filterable, sortable) |
| `GET` | `/api/scans/{id}` | Get batch detail with all pages |
| `DELETE` | `/api/scans/{id}` | Delete batch and all associated files |
| `POST` | `/api/scans/{id}/reprocess` | Reprocess batch with optional new profile |
| `POST` | `/api/scans/{id}/export` | Export batch to configured storage backends |
| `POST` | `/api/scans/bulk` | Bulk action (body: `{action, ids}` — delete, reprocess, export) |

#### Images

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/image/original/{batch_id}/{page}` | Serve original image |
| `GET` | `/api/image/processed/{batch_id}/{page}` | Serve processed image |
| `GET` | `/api/export/{batch_id}` | Download processed PDF or ZIP |

#### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings` | Get full configuration |
| `PUT` | `/api/settings` | Replace full configuration |
| `PATCH` | `/api/settings/{section}` | Update one settings section |
| `POST` | `/api/settings/test-storage` | Test storage backend connection |
| `GET` | `/api/settings/profiles` | List processing profiles |
| `POST` | `/api/settings/profiles` | Create new profile |
| `DELETE` | `/api/settings/profiles/{id}` | Delete a profile |

#### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/logs` | Query logs (paginated, filterable) |
| `DELETE` | `/api/logs` | Purge logs (with optional `before` date parameter) |
| `GET` | `/api/logs/export` | Export logs as `.log` or `.json` file |

#### Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/stats` | Dashboard statistics (total scans, success rate, storage used, devices online, recent activity) |

### Data Model

#### `devices` Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `mac` | `TEXT` | `PRIMARY KEY` | MAC address (format: `AA:BB:CC:DD:EE:FF`) |
| `name` | `TEXT` | `NOT NULL DEFAULT ''` | User-assigned friendly name |
| `ip` | `TEXT` | `NOT NULL` | Last known IP address |
| `firmware` | `TEXT` | `DEFAULT ''` | Firmware version string |
| `max_pages` | `INTEGER` | `DEFAULT 10` | Max pages per batch for this device |
| `resolution` | `TEXT` | `DEFAULT 'UXGA'` | Camera resolution setting |
| `config` | `TEXT` | `DEFAULT '{}'` | JSON: device-specific config overrides |
| `total_scans` | `INTEGER` | `DEFAULT 0` | Lifetime scan counter |
| `last_seen` | `TEXT` | `NOT NULL` | ISO 8601 timestamp of last heartbeat |
| `created_at` | `TEXT` | `NOT NULL` | ISO 8601 timestamp of registration |

#### `batches` Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` | UUID or short unique ID |
| `device_mac` | `TEXT` | `REFERENCES devices(mac)` | Source device (nullable for web/upload) |
| `source_type` | `TEXT` | `NOT NULL` | `esp32cam`, `web_camera`, `file_upload` |
| `page_count` | `INTEGER` | `DEFAULT 0` | Number of pages in batch |
| `status` | `TEXT` | `NOT NULL DEFAULT 'pending'` | `pending`, `uploading`, `processing`, `completed`, `error`, `exported` |
| `error` | `TEXT` | `DEFAULT NULL` | Error message if status is `error` |
| `profile` | `TEXT` | `DEFAULT 'default'` | Processing profile used |
| `export_info` | `TEXT` | `DEFAULT '{}'` | JSON: export results per backend |
| `file_size` | `INTEGER` | `DEFAULT 0` | Total file size in bytes (all pages) |
| `processing_duration_ms` | `INTEGER` | `DEFAULT 0` | Total processing time |
| `created_at` | `TEXT` | `NOT NULL` | ISO 8601 |
| `updated_at` | `TEXT` | `NOT NULL` | ISO 8601 |

#### `pages` Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `batch_id` | `TEXT` | `PRIMARY KEY (composite)`, `REFERENCES batches(id)` | Parent batch |
| `page_index` | `INTEGER` | `PRIMARY KEY (composite)` | 0-based page order |
| `status` | `TEXT` | `NOT NULL DEFAULT 'pending'` | `pending`, `uploaded`, `processing`, `processed`, `error` |
| `original_path` | `TEXT` | `NOT NULL` | Relative path to original image |
| `processed_path` | `TEXT` | `DEFAULT NULL` | Relative path to processed image |
| `processing_details` | `TEXT` | `DEFAULT '{}'` | JSON: per-step timing and results |
| `file_size_original` | `INTEGER` | `DEFAULT 0` | Original file size in bytes |
| `file_size_processed` | `INTEGER` | `DEFAULT 0` | Processed file size in bytes |
| `created_at` | `TEXT` | `NOT NULL` | ISO 8601 |

#### `logs` Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `INTEGER` | `PRIMARY KEY AUTOINCREMENT` | Unique log ID |
| `timestamp` | `INTEGER` | `NOT NULL` | Unix timestamp in milliseconds |
| `level` | `TEXT` | `NOT NULL` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` |
| `category` | `TEXT` | `NOT NULL` | `system`, `capture`, `processing`, `storage`, `api`, `websocket`, `device`, `config` |
| `source` | `TEXT` | `NOT NULL` | Source file or module name |
| `device_mac` | `TEXT` | `DEFAULT NULL` | Associated device (nullable) |
| `message` | `TEXT` | `NOT NULL` | Human-readable log message |
| `details` | `TEXT` | `DEFAULT '{}'` | JSON: structured additional data |

**Indexes**: `idx_logs_timestamp`, `idx_logs_level`, `idx_logs_category`,
`idx_logs_device_mac`

#### `profiles` Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `TEXT` | `PRIMARY KEY` | UUID or slug |
| `name` | `TEXT` | `NOT NULL UNIQUE` | Display name |
| `options` | `TEXT` | `NOT NULL` | JSON: full pipeline configuration |
| `is_default` | `INTEGER` | `DEFAULT 0` | 1 if this is the default profile |
| `created_at` | `TEXT` | `NOT NULL` | ISO 8601 |

### WebSocket Protocol

- **Connection**: `ws://host:port/ws`
- **Server → Client**: JSON messages with `event` and `data` fields (see
  Principle V for format).
- **Client → Server**: Currently read-only. Future: subscription filters.
- **Heartbeat**: Server sends `{"event": "ping"}` every 30 seconds. Client
  responds with `{"event": "pong"}`. No response in 60 seconds = connection
  considered dead.

## Development Workflow

### Branch Strategy

- **`main`**: Stable, releasable. Protected. All merges via PR.
- **`feature/<name>`**: New features. Branch from `main`.
- **`fix/<name>`**: Bug fixes. Branch from `main`.
- **`firmware/<name>`**: ESP32-CAM firmware changes. Branch from `main`.

### Contribution Process

1. Create branch from `main` following naming convention.
2. Implement changes following constitution principles.
3. Write/update tests as required (see Testing Requirements below).
4. Verify responsive behavior at all three breakpoints (if frontend changes).
5. Open PR with description referencing relevant constitution principles.
6. PR review MUST verify constitution compliance.
7. Merge to `main` via squash merge.

### Testing Requirements

#### Backend Tests (Python — pytest)

- **Unit tests**: Each module (`scanner.py`, `storage.py`, `database.py`,
  `logger.py`) MUST have corresponding test files.
- **Pipeline tests**: Each processing step MUST be tested independently with
  known input images and expected output properties (dimensions, color space,
  file size bounds).
- **Storage tests**: Each backend MUST have tests using mocks for external
  services (Paperless-NGX API mock, WebDAV mock, etc.).
- **API tests**: Each endpoint MUST have tests covering success, validation
  error, and not-found cases. Use FastAPI `TestClient`.

#### Frontend Tests (responsive verification)

Every component and page MUST be verified at these viewports:

| Viewport | Device Reference | Priority |
|----------|-----------------|----------|
| 375×667 | iPhone SE | CRITICAL |
| 768×1024 | iPad | HIGH |
| 1024×768 | Tablet landscape | HIGH |
| 1440×900 | Desktop | STANDARD |

#### ESP32-CAM Integration Tests

- Registration sequence: power on → WiFi connect → register → receive config.
- Capture sequence: button press → batch create → capture pages → upload → process.
- Error recovery: WiFi disconnect → reconnect → resume operation.
- LED feedback: verify correct patterns during each state.

### Performance Benchmarks

All benchmarks assume a minimum of 4 CPU cores and 8 GB RAM:

| Metric | Target | Method |
|--------|--------|--------|
| Page processing time | < 5 seconds | Measured end-to-end: receive image → all pipeline steps → save |
| UXGA image upload (WiFi) | < 3 seconds | ESP32-CAM to backend over local WiFi |
| Dashboard load | < 2 seconds | Cold load, no cache, measured via Lighthouse |
| WebSocket reconnection | < 5 seconds | From disconnect detection to re-established connection |
| History query (1000+ scans) | < 500 ms | Cursor-based paginated query with filters |
| Log search (100k entries) | < 1 second | Full-text search across message field |
| Real-time log display | < 500 ms | From log creation to WebSocket delivery to UI render |

## ESP32-CAM Firmware Standards

### Minimal Configuration

A device MUST be operational with only two configuration values:

```cpp
// config.h
#define WIFI_SSID "YourNetwork"
#define WIFI_PASSWORD "YourPassword"
#define SERVER_URL "http://192.168.1.100:8400"
```

All other parameters (resolution, quality, max pages, device name) are fetched
from the server after registration or use sensible defaults.

### Boot Sequence

1. Initialize serial (115200 baud) for debug output.
2. Initialize camera with configured resolution.
3. Connect to WiFi (retry with exponential backoff, LED: fast blink).
4. Register with server: `POST /api/device/register`
   ```json
   {
     "mac": "AA:BB:CC:DD:EE:FF",
     "name": "ESP32-CAM-01",
     "ip": "192.168.1.50",
     "firmware": "1.0.0",
     "resolution": "UXGA"
   }
   ```
5. Receive and apply server-side configuration.
6. Enter idle state (LED: solid ON).

### Button Handling

- **Physical button**: GPIO pin configurable in `config.h` (default: GPIO 12).
- **Debounce**: 50ms minimum. Use hardware or software debounce.
- **Short press** (< 500ms): Start single-page capture.
- **Long press** (>= 2 seconds): Start multi-page batch mode (capture until
  short press or timeout).
- **Double press** (two presses within 300ms): Cancel current batch.

### LED Protocol

The onboard LED (or external LED on configurable GPIO) communicates device state:

| Pattern | Meaning |
|---------|---------|
| Fast blink (100ms on/100ms off) | Connecting to WiFi |
| Slow blink (500ms on/500ms off) | Registering with server |
| Solid ON | Idle, ready to capture |
| Quick flash (50ms) × N | Captured page N |
| Rapid pulse (200ms cycle) | Uploading to server |
| Double blink (2× 100ms, 500ms pause) | Processing in progress |
| 3 slow blinks then OFF | Batch complete, success |
| SOS pattern (···−−−···) | Error state |
| OFF | Deep sleep / powered down |

### Capture Sequence

```
[Button Press] → Create batch (POST /api/scan/batch)
                   → Receive batch_id
             → Capture frame (esp_camera_fb_get)
             → Upload JPEG (POST /api/scan/upload/{batch_id}/{page_index})
                   → Content-Type: image/jpeg
                   → Raw JPEG body (no multipart for ESP32 simplicity)
             → [Repeat for multi-page]
             → Trigger processing (POST /api/scan/process/{batch_id})
             → Return to idle
```

### Communication Protocol

- **Transport**: HTTP/1.1 over WiFi (no TLS on ESP32 by default for performance).
- **Image format**: Raw JPEG body for uploads (minimizes ESP32 memory usage).
  `Content-Type: image/jpeg`. Server identifies device via `X-Device-MAC` header.
- **Heartbeat**: Device sends `POST /api/device/register` every 60 seconds as a
  keepalive (server updates `last_seen`). Device considered offline after 3 missed
  heartbeats (180 seconds).
- **Error handling**: On upload failure, retry 3 times with 1-second delay. On
  persistent failure, blink SOS pattern and log to serial.
- **Memory management**: Single frame buffer. Capture → upload → free → next frame.
  Never hold more than one frame in memory.

## Frontend Standards

### Responsive Layout Rules

#### Mobile (< 768px)

- **Navigation**: Fixed bottom tab bar with 5 tabs (Dashboard, Scanner, History,
  Logs, Settings). Overflow tabs accessible via "More" menu.
- **Layout**: Single column, full-width cards. No horizontal scrolling.
- **Scanner**: Full-screen camera view. Capture button centered at bottom.
  No visible chrome except essential controls (flash, switch camera, close).
- **History**: Vertical list, one card per row. Swipe actions (delete, export).
- **Settings**: Full-width sections, accordion-style collapse.
- **Comparison**: Toggle button to switch original/processed. Optional swipe gesture.

#### Tablet (768px – 1023px)

- **Navigation**: Collapsible sidebar (hamburger toggle). Default: collapsed
  (icon-only rail).
- **Layout**: 2-column grid where appropriate (dashboard cards, history list +
  preview).
- **Scanner**: Large preview with controls alongside (not full-screen by default,
  but full-screen available via button).
- **Comparison**: Side-by-side with draggable divider.

#### Desktop (>= 1024px)

- **Navigation**: Fixed sidebar, always visible, full labels + icons.
- **Layout**: Multi-column (3+ columns for dashboard stats, 2-column for
  history list + detail panel).
- **Scanner**: Embedded preview with full controls panel alongside.
- **Comparison**: Side-by-side with draggable divider and zoom controls.

### UX Rules

- **Touch Targets**: All interactive elements MUST be minimum 44×44px on mobile.
- **Loading States**: Every async operation MUST show a loading indicator
  (skeleton screens for initial loads, spinners for actions).
- **Toast Notifications**: Success/error/info toasts for user actions. Auto-dismiss
  after 5 seconds (configurable). Stack position: bottom-center on mobile,
  top-right on desktop.
- **Confirmation Dialogs**: Required for all destructive actions (delete, purge
  logs, bulk operations). MUST state what will be deleted and the count.
- **Empty States**: Every list view MUST have a meaningful empty state with
  guidance (e.g., "No scans yet. Use the Scanner tab to capture your first
  document.").
- **Error States**: API errors MUST be displayed to the user with actionable
  messages. Never show raw stack traces.

### CSS & Styling

- **Approach**: CSS native with custom properties (variables) for theming, OR
  Tailwind CSS utilities. No heavy CSS frameworks (no Bootstrap, no Material UI
  CSS).
- **Theming**: Three modes via CSS custom properties:
  - `light`: White backgrounds, dark text.
  - `dark`: Dark backgrounds, light text.
  - `auto`: Follow system `prefers-color-scheme`.
- **Typography**: System font stack. No custom font downloads.
  ```css
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
  ```
- **Animations**: Subtle and purposeful only. Respect `prefers-reduced-motion`.
  No animations longer than 300ms.

## Security & Deployment

### Authentication

Satsu does NOT implement its own authentication. Access control MUST be
delegated to a reverse proxy (Nginx, Traefik, Caddy, Authentik, Authelia).

- **Rationale**: Homelab users have diverse auth requirements. Built-in auth
  would be either too simple (basic auth) or too complex (OAuth). Reverse proxy
  delegation is the *arr ecosystem standard.
- **Implications**:
  - The application trusts all incoming requests.
  - The application MUST NOT expose sensitive data in URLs (no tokens in query
    strings).
  - API keys for storage backends are stored in `/data/config.json` (protected
    by filesystem permissions, NOT by application-level auth).

### Input Validation

- **All API inputs** MUST be validated via Pydantic models. No raw `request.json()`
  without schema validation.
- **File uploads**: Validate MIME type (image/jpeg, image/png, etc.), enforce
  maximum file size (configurable, default 20MB), reject non-image payloads.
- **MAC addresses**: Validate format `XX:XX:XX:XX:XX:XX` (uppercase hex).
- **Path traversal**: All file paths MUST be resolved relative to `/data/` and
  validated to prevent directory traversal attacks.
- **SQL injection**: Use parameterized queries exclusively. No string concatenation
  in SQL statements.
- **WebSocket**: Validate all incoming JSON messages against expected schemas.
  Reject malformed messages silently (log at DEBUG level).

### Docker Build

```dockerfile
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.11-slim AS runtime
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend-build /app/frontend/build ./static
EXPOSE 8400
VOLUME /data
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8400"]
```

- **Multi-arch**: Build with `docker buildx` for `linux/amd64` and `linux/arm64`.
- **Image size target**: < 500MB (OpenCV headless is ~80MB, Python slim ~120MB).
- **No root**: Run as non-root user inside container.
- **Health check**: `HEALTHCHECK CMD curl -f http://localhost:8400/api/stats || exit 1`

### Reverse Proxy Compatibility

- **WebSocket passthrough**: The application uses WebSocket on `/ws`. Reverse proxy
  configurations MUST include WebSocket upgrade headers:
  ```nginx
  # Nginx example
  location /ws {
      proxy_pass http://satsu:8400;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
  }
  ```
- **Base path**: The application MUST support being served under a sub-path
  (e.g., `/satsu/`) via the `SATSU_BASE_PATH` environment variable.
- **HTTPS termination**: TLS is terminated at the reverse proxy. Internal
  communication is HTTP. The application MUST set appropriate headers for HTTPS
  awareness (`X-Forwarded-Proto`).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SATSU_PORT` | `8400` | Server listen port |
| `SATSU_DATA_DIR` | `/data` | Persistent data directory |
| `SATSU_LOG_LEVEL` | `INFO` | Minimum log level |
| `SATSU_BASE_PATH` | `/` | URL base path for reverse proxy sub-path |
| `SATSU_WORKERS` | `1` | Uvicorn worker count (1 recommended for SQLite) |

Additional storage backend credentials can be set via environment variables
with the prefix `SATSU_STORAGE_` (e.g., `SATSU_STORAGE_PAPERLESS_URL`).
Environment variables ALWAYS override `config.json` values.

## Governance

### Constitutional Supremacy

This constitution is the supreme governing document of the Satsu project.
All code, documentation, configurations, and development practices MUST conform
to the principles and standards defined herein.

### Compliance Verification

- Every pull request MUST be reviewed for constitutional compliance before merge.
- The reviewer MUST verify that:
  1. No hardcoded parameters exist (Principle IV).
  2. Frontend changes are responsive at all three breakpoints (Principle II).
  3. New features produce appropriate log entries (Principle VI).
  4. WebSocket events are emitted for state changes (Principle V).
  5. Original images are preserved if processing is involved (Principle VII).
  6. No external cloud dependencies are introduced as requirements (Principle I).
  7. New storage backends implement the standard interface (Principle VIII).
  8. Capture sources are properly isolated (Principle III).

### Amendment Process

1. **Proposal**: Open an issue titled `CONSTITUTION: <proposed change>` with
   full rationale, impact assessment, and migration plan.
2. **Review**: All active contributors review the proposal. Minimum 7-day
   review period.
3. **Approval**: Requires explicit approval from the project maintainer.
4. **Implementation**: Update `constitution.md`, bump version (semantic
   versioning), update `Last Amended` date.
5. **Migration**: If the amendment changes existing standards, a migration plan
   MUST be included and executed within the same PR.

### Versioning Policy

- **MAJOR** (X.0.0): Removal or fundamental redefinition of a core principle.
  Backward-incompatible governance changes.
- **MINOR** (x.Y.0): Addition of a new principle, section, or material expansion
  of existing guidance.
- **PATCH** (x.y.Z): Clarifications, typo fixes, non-semantic refinements that
  do not change the intent or scope of any rule.

### Runtime Guidance

A separate `GUIDANCE.md` file (to be created) will contain day-to-day development
guidelines, coding style preferences, commit message conventions, and operational
procedures. `GUIDANCE.md` MUST NOT contradict the constitution. In case of conflict,
the constitution prevails.

### Personas & Design Decisions

When making design decisions, all three personas MUST be considered:

1. **"Homelabber"**: Technical user who installs Docker, configures multiple
   storage backends, monitors logs, owns 1-3 ESP32-CAM devices. Expects full
   control and transparency.
2. **"Famille"**: Non-technical user who scans documents from a smartphone browser.
   Never accesses settings. Expects a simple, intuitive experience that "just works."
3. **"Bureau"**: Office user with a fixed ESP32-CAM station. Presses a button,
   verifies results later. Expects reliability and automatic processing/export.

A feature that serves only one persona at the expense of another MUST be justified
in the PR description.

**Version**: 1.0.0 | **Ratified**: 2025-02-23 | **Last Amended**: 2025-02-23
