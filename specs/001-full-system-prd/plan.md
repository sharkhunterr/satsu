# Implementation Plan: ESPScanCam — Self-Hosted Document Scanning System

**Branch**: `001-full-system-prd` | **Date**: 2026-02-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-full-system-prd/spec.md`

## Summary

ESPScanCam is a 3-layer self-hosted document scanning system: ESP32-CAM
hardware + web browser capture → Python/FastAPI backend with OpenCV processing
pipeline → React 18 mobile-first SPA. Deployed as a single Docker container
with SQLite WAL storage. Exports to local, Paperless-NGX, WebDAV, Google
Drive, and SMB backends. All communication is real-time via WebSocket.

## Technical Context

**Language/Version**: Python 3.11+ (backend), JavaScript/JSX (React 18 frontend), Arduino C++ (ESP32-CAM firmware)
**Primary Dependencies**: FastAPI, uvicorn, OpenCV (headless), Pillow, aiohttp, aiofiles, pydantic v2 (backend); React 18, Vite (frontend); esp_camera, WiFi, HTTPClient, ArduinoJson (firmware)
**Storage**: SQLite WAL mode (`/data/espscancam.db`), filesystem (`/data/scans/`), JSON config (`/data/config.json`)
**Testing**: pytest + FastAPI TestClient (backend), Playwright multi-viewport (frontend), PlatformIO + mock server (firmware)
**Target Platform**: Linux Docker container (amd64 + arm64), ESP32-CAM (Xtensa LX6)
**Project Type**: Web application + IoT firmware (3-layer architecture)
**Performance Goals**: < 5s/page processing, < 2s dashboard load, < 500ms WebSocket delivery, < 500ms history query on 1000+ items
**Constraints**: Single Docker container, < 500MB image, no cloud dependencies, SQLite only (no external DB), mobile-first 375px+
**Scale/Scope**: 1-10 concurrent ESP32-CAM devices, 1000+ scan batches, 100k+ log entries, 3 personas, 8 frontend pages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Verification |
|-----------|--------|-------------|
| I. Self-Hosted First | PASS | Single Docker container, SQLite, no cloud deps, air-gapped capable |
| II. Mobile-First Responsive | PASS | 3 breakpoints defined, bottom tab bar mobile, full-screen scanner, 44px targets |
| III. Multi-Source Capture | PASS | ESP32-CAM + web camera + file upload, batch isolation by unique ID |
| IV. Everything Is Configurable | PASS | 7 settings tabs, JSON config, env var overrides, processing profiles |
| V. Real-Time by Default | PASS | Single WebSocket /ws endpoint, 16 event types, auto-reconnect |
| VI. Observable & Auditable | PASS | Structured logging (SQLite), real-time log viewer, history with search/filters |
| VII. Non-Destructive Processing | PASS | Dual paths (original + processed), reprocessing, explicit deletion only |
| VIII. Modular Storage | PASS | 5 backends with standard interface, multi-target export, connection testing |

All 8 constitutional principles satisfied. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-full-system-prd/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (API contracts)
│   ├── devices.md
│   ├── scans.md
│   ├── settings.md
│   ├── logs.md
│   ├── stats.md
│   └── websocket.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
esp32cam/
├── espscancam.ino           # Main firmware sketch
├── config.example.h         # WiFi + server URL template
├── led.h                    # LED pattern functions
└── buttons.h                # Button debounce + handlers

backend/
├── main.py                  # FastAPI app, routes, WebSocket manager, static serving
├── scanner.py               # OpenCV processing pipeline (8 steps)
├── storage.py               # Storage backend implementations (5 backends)
├── database.py              # SQLite WAL connection, migrations, queries
├── logger.py                # Structured logging system
├── models.py                # Pydantic request/response models
├── config.py                # Configuration management (JSON + env vars)
├── requirements.txt         # Python dependencies (pinned)
└── tests/
    ├── test_scanner.py      # Pipeline unit tests
    ├── test_storage.py      # Storage backend tests (mocked)
    ├── test_api.py          # API endpoint tests (TestClient)
    ├── test_database.py     # Database operation tests
    └── test_config.py       # Config handling tests

frontend/
├── public/
│   ├── manifest.json        # PWA manifest
│   └── icons/               # App icons (multiple sizes)
├── src/
│   ├── App.jsx              # Root component, router, WebSocket provider
│   ├── sw.js                # Service worker (app shell cache)
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── Scanner.jsx      # Camera + upload modes
│   │   ├── History.jsx
│   │   ├── Detail.jsx       # Batch detail + comparison
│   │   ├── Logs.jsx
│   │   ├── Devices.jsx
│   │   ├── Settings.jsx
│   │   └── About.jsx
│   ├── components/
│   │   ├── layout/          # Sidebar, BottomTabBar, TopBar
│   │   ├── scanner/         # CameraPreview, UploadZone, PagePile
│   │   ├── history/         # ScanItem, FilterBar, BulkActions
│   │   ├── detail/          # CompareView, PageNavigator
│   │   ├── logs/            # LogTerminal, LogFilters
│   │   ├── devices/         # DeviceCard, DeviceConfig
│   │   ├── settings/        # SettingsTabs, StorageConfig, ProfileEditor
│   │   └── shared/          # StatCard, Toast, ConfirmDialog, EmptyState, Spinner
│   ├── hooks/
│   │   ├── useWebSocket.js  # WebSocket connection + auto-reconnect
│   │   ├── useCamera.js     # MediaDevices API wrapper
│   │   ├── useSettings.js   # Settings fetch + update
│   │   └── useLogs.js       # Log streaming + filtering
│   └── styles/
│       ├── variables.css    # CSS custom properties (theming)
│       ├── layout.css       # Responsive layout (3 breakpoints)
│       └── components.css   # Component-specific styles
├── index.html
├── vite.config.js
└── package.json

Dockerfile                   # Multi-stage (Node build + Python runtime)
docker-compose.yml           # Single service, port + volume
```

**Structure Decision**: Web application (Option 2) with additional `esp32cam/`
firmware directory. Three distinct build targets: frontend (Vite → static),
backend (Python), firmware (Arduino/PlatformIO). Docker multi-stage combines
frontend build output into backend static serving.

## Constitution Check — Post-Design Re-Evaluation

*Re-check after Phase 1 design. All artifacts reviewed: data-model.md, contracts/, quickstart.md.*

| Principle | Status | Post-Design Verification |
|-----------|--------|--------------------------|
| I. Self-Hosted First | PASS | SQLite WAL with local file storage, Docker single-container, no external DB. Air-gapped capable confirmed. |
| II. Mobile-First Responsive | PASS | Wireframes cover all 8 pages at 375px+. Bottom tab bar, full-screen scanner, 44px touch targets in spec. |
| III. Multi-Source Capture | PASS | Data model has `source_type` field (esp32cam/web_camera/file_upload). Device registration API + web-upload + file upload contracts defined. Batch isolation by UUID. |
| IV. Everything Is Configurable | PASS | Settings contract defines 7 sections. Profiles contract with full pipeline options. Config stored in JSON + env var overrides. |
| V. Real-Time by Default | PASS | WebSocket contract defines 16 event types. ConnectionManager pattern in research.md. Auto-reconnect with exponential backoff. |
| VI. Observable & Auditable | PASS | Logs table with 5 indexes. Log API with cursor pagination + filters. Real-time log streaming via WebSocket. Export as .log/.json. |
| VII. Non-Destructive Processing | PASS | Data model separates `original_path` and `processed_path`. Processing details tracked per-step. Reprocess endpoint preserves originals. |
| VIII. Modular Storage | PASS | StorageBackend ABC in research.md. 5 implementations. Export API supports multi-target + retry. Connection testing endpoint. |

All 8 principles remain satisfied after detailed design. No new violations introduced.

## Generated Artifacts

| Phase | Artifact | Path | Content |
|-------|----------|------|---------|
| 0 | Research | research.md | 10 technical decisions (R1-R10) |
| 1 | Data Model | data-model.md | 5 entities, DDL, state machines, JSON schemas, indexes |
| 1 | Devices Contract | contracts/devices.md | 6 endpoints with request/response examples |
| 1 | Scans Contract | contracts/scans.md | 10 endpoints, pagination, bulk actions |
| 1 | Settings Contract | contracts/settings.md | 10 endpoints, full config schema, profile options |
| 1 | Logs Contract | contracts/logs.md | 3 endpoints, log entry schema, export formats |
| 1 | Stats Contract | contracts/stats.md | 1 endpoint, dashboard statistics response |
| 1 | WebSocket Contract | contracts/websocket.md | 16 events, lifecycle, reconnection strategy |
| 1 | Quickstart | quickstart.md | Developer setup guide, commands, architecture |
| — | Agent Context | CLAUDE.md (repo root) | Technology stack, commands, code style |

## Complexity Tracking

No constitution violations. No complexity justifications needed.
