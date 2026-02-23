# Tasks: ESPScanCam — Self-Hosted Document Scanning System

**Input**: Design documents from `/specs/001-full-system-prd/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are included where specified in the feature specification (backend pytest, frontend Playwright).

**Organization**: Tasks are grouped by user story (US1-US10 from spec.md) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- All file paths are relative to the repository root

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Create project structure, initialize all three layers (backend, frontend, firmware)

- [X] T001 Create root project structure: `backend/`, `frontend/`, `esp32cam/`, `Dockerfile`, `docker-compose.yml`, `.gitignore`
- [X] T002 [P] Initialize backend Python project with `backend/requirements.txt` (fastapi, uvicorn, opencv-python-headless, Pillow, aiohttp, aiofiles, aiosqlite, pydantic>=2.0, python-multipart)
- [X] T003 [P] Initialize frontend React 18 project with Vite in `frontend/` (`npm create vite@latest . -- --template react`, install react-router-dom)
- [X] T004 [P] Create ESP32-CAM firmware skeleton: `esp32cam/espscancam.ino`, `esp32cam/config.example.h`, `esp32cam/led.h`, `esp32cam/buttons.h`
- [X] T005 [P] Create `Dockerfile` with multi-stage build (Node.js 20-alpine for frontend, Python 3.11-slim for runtime) per research.md R10
- [X] T006 [P] Create `docker-compose.yml` with single service, port 8400, volume `/data`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

### Backend Core

- [X] T007 Implement configuration management in `backend/config.py` — load `/data/config.json` with env var overrides (`ESPSCANCAM_*`), defaults on corruption (FR-063, FR-066)
- [X] T008 Implement SQLite WAL database layer in `backend/database.py` — connection pool with `aiosqlite`, pragmas (WAL, busy_timeout=5000, foreign_keys=ON), schema init with all 5 tables per data-model.md DDL
- [X] T009 Implement structured logging system in `backend/logger.py` — write to SQLite `logs` table, levels (DEBUG/INFO/WARNING/ERROR/CRITICAL), categories (system/capture/processing/storage/api/websocket/device/config), broadcast to WebSocket
- [X] T010 Define all Pydantic v2 request/response models in `backend/models.py` — DeviceRegister, BatchCreate, PageResponse, BatchResponse, BatchList, LogEntry, ProfileCreate, SettingsResponse, StatsResponse, ErrorResponse
- [X] T011 Implement WebSocket ConnectionManager in `backend/main.py` — connect, disconnect, broadcast pattern per research.md R3, single `/ws` endpoint
- [X] T012 Create FastAPI app skeleton in `backend/main.py` — app init, lifespan (db init, default profiles seed), CORS, static file mount, route includes, WebSocket endpoint, health check at `/api/stats`

### Frontend Core

- [X] T013 [P] Setup Vite config in `frontend/vite.config.js` — proxy `/api` and `/ws` to backend port 8400 in dev mode, base path `/`
- [X] T014 [P] Create CSS custom properties for theming in `frontend/src/styles/variables.css` — light/dark themes, color palette, spacing scale, typography
- [X] T015 [P] Create responsive layout CSS in `frontend/src/styles/layout.css` — 3 breakpoints (<768px, 768-1023px, >=1024px), bottom tab bar mobile, collapsible sidebar tablet, fixed sidebar desktop
- [X] T016 [P] Create component-specific CSS in `frontend/src/styles/components.css` — StatCard, buttons, forms, toast, dialogs, cards, spinner
- [X] T017 Implement WebSocket hook in `frontend/src/hooks/useWebSocket.js` — connect to `/ws`, auto-reconnect with exponential backoff (max 5s), event dispatching, connection state indicator
- [X] T018 Create App root component in `frontend/src/App.jsx` — React Router with routes for all 8 pages, WebSocket context provider, theme provider (light/dark/auto), responsive layout wrapper (Sidebar + BottomTabBar)
- [X] T019 [P] Create layout components: `frontend/src/components/layout/Sidebar.jsx`, `frontend/src/components/layout/BottomTabBar.jsx`, `frontend/src/components/layout/TopBar.jsx`
- [X] T020 [P] Create shared components: `frontend/src/components/shared/StatCard.jsx`, `Toast.jsx`, `ConfirmDialog.jsx`, `EmptyState.jsx`, `Spinner.jsx`

**Checkpoint**: Foundation ready — backend serves API skeleton, frontend renders layout shell with WebSocket connection, navigation works across all breakpoints

---

## Phase 3: User Story 1 — Smartphone Camera Scan (Priority: P1) MVP

**Goal**: A Family member opens the web app on mobile, captures 3 pages via camera, submits, and sees the batch in history with status "completed"

**Independent Test**: Open web app on mobile viewport (375px), grant camera permission, capture 3 pages, tap Send. Verify batch appears in history as completed with 3 viewable pages.

### Backend — US1

- [X] T021 [US1] Implement batch creation endpoint `POST /api/scan/web-upload` in `backend/main.py` — accept multipart/form-data with files[] and profile, create batch + pages rows, save originals to `/data/scans/{batch_id}/original/`, return batch object per contracts/scans.md
- [X] T022 [US1] Implement basic processing pipeline in `backend/scanner.py` — sequential 8-step pipeline (auto-crop, deskew, denoise, CLAHE, sharpen, white_balance, bw_mode, output) with try/except per step (FR-021), skip on failure with WARNING log, read profile options, save processed to `/data/scans/{batch_id}/processed/`
- [X] T023 [US1] Implement PDF generation in `backend/scanner.py` — Pillow-based multi-page PDF output from processed images, JPEG/PNG single-page output option per profile
- [X] T024 [US1] Wire processing trigger after upload in `backend/main.py` — background task on upload complete: update batch status → processing, process each page, broadcast WebSocket events (processing_started, processing_page, page_processed, processing_complete/processing_error), update batch status → completed/error
- [X] T025 [US1] Implement batch listing endpoint `GET /api/scans` in `backend/main.py` — cursor-based pagination per research.md R8, filters (status, device_mac, date_from/to, page_min/max, search), sort (created_at, status, page_count, file_size), inline stats (total scans/pages/bytes)
- [X] T026 [US1] Implement batch detail endpoint `GET /api/scans/{id}` in `backend/main.py` — return batch with pages array including original/processed paths and processing_details
- [X] T027 [US1] Implement image serving endpoints in `backend/main.py` — `GET /api/image/original/{batch_id}/{page}`, `GET /api/image/processed/{batch_id}/{page}`, `GET /api/export/{batch_id}` (PDF/ZIP download)
- [X] T028 [US1] Implement stats endpoint `GET /api/stats` in `backend/main.py` — total_batches, total_pages, total_size_bytes, devices_online/total, recent_batches (5), status_counts, storage_backends per contracts/stats.md

### Frontend — US1

- [X] T029 [US1] Implement camera hook in `frontend/src/hooks/useCamera.js` — `getUserMedia()` wrapper, front/back camera switch, flash/torch toggle, resolution constraints, permission error handling, cleanup on unmount
- [X] T030 [US1] Implement Scanner page (camera mode) in `frontend/src/pages/Scanner.jsx` — full-screen mobile view, live camera preview, capture button (44px min), page counter, camera switch, flash toggle, alignment grid overlay (toggleable), capture animation (white flash), page pile (horizontal scroll with thumbnails + delete), Send/Clear buttons, profile selector dropdown
- [X] T031 [US1] Implement Scanner page (upload mode) in `frontend/src/pages/Scanner.jsx` — drag-and-drop zone, file picker with multi-select, `<input capture="environment">` for mobile photo, thumbnail grid, drag-to-reorder (long press on mobile), individual delete (x button), format validation (JPEG/PNG/WebP/HEIC), size validation (20MB default), error per file without blocking others
- [X] T032 [US1] Implement upload logic in Scanner page — batch creation via `POST /api/scan/web-upload`, progress indicator during upload, WebSocket listener for processing progress (step name + percentage per page), redirect to batch detail on completion
- [X] T033 [US1] Implement Dashboard page in `frontend/src/pages/Dashboard.jsx` — 4 stat cards (scans, devices, pages, storage), recent activity list (WebSocket-updated), devices online list, responsive grid (2x2 mobile, 4-column desktop)
- [X] T034 [US1] Implement History page in `frontend/src/pages/History.jsx` — search bar, inline stats, scan item cards (batch_id, status badge, device, page count, size, date), cursor-based infinite scroll (`GET /api/scans` with cursor), filter button (modal on mobile)
- [X] T035 [US1] Implement Detail page in `frontend/src/pages/Detail.jsx` — batch metadata header, page navigator (tabs or horizontal scroll), before/after comparison (side-by-side desktop, toggle/swipe mobile), pinch zoom (mobile), scroll zoom (desktop), action buttons (Reprocess, Export, Delete with confirmation)

**Checkpoint**: Full scan-to-view flow works: capture via web camera or upload → processing → PDF → history listing → batch detail with before/after comparison. MVP is functional.

---

## Phase 4: User Story 2 — ESP32-CAM Hardware Scan (Priority: P1)

**Goal**: An ESP32-CAM device boots, auto-registers, captures 5 pages via button, sends them, and the batch appears in real-time on the dashboard within 30 seconds

**Independent Test**: Power on ESP32-CAM with valid config, verify registration in Devices page. Press SCAN 5x, press SEND. Verify batch in dashboard with 5 pages and "completed" status.

### Backend — US2

- [X] T036 [US2] Implement device registration endpoint `POST /api/device/register` in `backend/main.py` — upsert device by MAC, update last_seen/ip/firmware, return pending config if any, broadcast `device_online` WebSocket event
- [X] T037 [US2] Implement device capture endpoint `POST /api/device/capture` in `backend/main.py` — accept raw JPEG body with `X-Device-MAC` header, create or append to active batch for device, save original, return batch_id + page_index, broadcast `page_captured` event
- [X] T038 [US2] Implement batch creation for ESP32-CAM `POST /api/scan/batch` in `backend/main.py` — create empty batch with source_type=esp32cam, return batch object
- [X] T039 [US2] Implement page upload for ESP32-CAM `POST /api/scan/upload/{batch_id}/{page_index}` in `backend/main.py` — accept raw JPEG body, save to `/data/scans/{batch_id}/original/{page_index}.jpg`, update page status, broadcast `page_uploaded` event
- [X] T040 [US2] Implement process trigger `POST /api/scan/process/{batch_id}` in `backend/main.py` — accept optional profile override, start background processing task, return 202 accepted
- [X] T041 [US2] Implement device listing `GET /api/devices` in `backend/main.py` — return all devices with computed `is_online` (last_seen < 180s), sort by last_seen
- [X] T042 [US2] Implement device update `PUT /api/devices/{mac}` in `backend/main.py` — update name, config fields
- [X] T043 [US2] Implement device config push `POST /api/devices/{mac}/config` in `backend/main.py` — store pending config, device picks up on next heartbeat register call
- [X] T044 [US2] Implement device deletion `DELETE /api/devices/{mac}` in `backend/main.py` — remove device row, broadcast `device_offline` event
- [X] T045 [US2] Implement offline detection in `backend/main.py` — periodic task (every 60s) checks `last_seen` > 180s, marks offline, broadcasts `device_offline` event
- [X] T046 [US2] Implement optional API key validation middleware in `backend/main.py` — check `X-API-Key` header on `/api/device/*` and `/api/scan/upload/*` routes when enabled in config (FR-072b), return 403 if invalid

### Firmware — US2

- [X] T047 [P] [US2] Implement WiFi connection and server registration in `esp32cam/espscancam.ino` — boot, connect WiFi from config.h, POST /api/device/register with MAC/IP/firmware/resolution, heartbeat every 60s, LED fast blink (connecting), slow blink (registering), solid ON (idle)
- [X] T048 [P] [US2] Implement LED patterns in `esp32cam/led.h` — fast blink (connecting), slow blink (registering), solid ON (idle), quick flash xN (captured page N), rapid pulse (uploading), double blink (processing), 3 slow blinks (success), SOS (error), all non-blocking via millis()
- [X] T049 [P] [US2] Implement button handling in `esp32cam/buttons.h` — 3 GPIO buttons with 300ms debounce: SCAN (capture frame to PSRAM), SEND (upload batch + trigger process), RESET (clear captured frames)
- [X] T050 [US2] Implement capture and upload flow in `esp32cam/espscancam.ino` — SCAN: flash LED + `esp_camera_fb_get()` + store in PSRAM buffer array (up to max_pages), SEND: create batch → upload each page sequentially as raw JPEG → POST process trigger → LED feedback, RESET: clear buffer + reset count
- [X] T051 [US2] Implement error handling and retry in `esp32cam/espscancam.ino` — upload retry 3x with 1s delay (FR-071), SOS LED on persistent failure, WiFi reconnect on disconnect, config update reception on heartbeat response

### Frontend — US2

- [X] T052 [US2] Implement Devices page in `frontend/src/pages/Devices.jsx` — device cards (online/offline indicator, MAC, IP, firmware, resolution, scan count, last seen), rename button, configure button (resolution, quality, flash), delete button with confirmation
- [X] T053 [US2] Add real-time device updates to Dashboard — WebSocket listener for device_online/device_offline events, update devices online count and device list live

**Checkpoint**: ESP32-CAM can scan and upload pages, backend processes them, dashboard shows real-time updates. Hardware + software integration complete.

---

## Phase 5: User Story 3 — File Upload Batch (Priority: P2)

**Goal**: Upload 10 receipt photos from phone gallery, reorder them, submit as single batch

**Independent Test**: Upload 10 JPEG files via drag-and-drop, reorder 2, verify batch has 10 pages in correct order. Verify one oversized file shows error without blocking others.

### Implementation — US3

- [X] T054 [US3] Enhance upload zone in `frontend/src/pages/Scanner.jsx` — drag-and-drop with visual feedback (border highlight on hover), multi-file picker, `<input capture="environment">` for mobile native photo, thumbnail grid preview, file validation (format + size), error badge per invalid file, reorder via drag (HTML Drag API + touch events for mobile)
- [X] T055 [US3] Implement client-side image compression in `frontend/src/pages/Scanner.jsx` — optional canvas-based JPEG compression before upload (quality configurable 60-95% from settings), HEIC-to-JPEG conversion client-side if needed
- [X] T056 [US3] Implement upload retry logic in `frontend/src/pages/Scanner.jsx` — retry 2x per failed file upload, show error per file after retries exhausted, allow other files to continue

**Checkpoint**: File upload mode fully works alongside camera mode. Reordering, validation, compression, and retry all functional.

---

## Phase 6: User Story 4 — Processing Pipeline with Profiles (Priority: P2)

**Goal**: Create a "Receipt" processing profile with high contrast + B&W, scan a faded receipt, verify optimal result. Reprocess old scan with different profile.

**Independent Test**: Create profile, scan receipt, verify B&W output. Reprocess same batch with default profile, verify different result. Verify originals unchanged.

### Backend — US4

- [X] T057 [US4] Implement auto-crop step in `backend/scanner.py` — Canny edge detection → findContours → largest 4-point contour → getPerspectiveTransform + warpPerspective, fallback to HoughLinesP if no suitable contour
- [X] T058 [US4] Implement deskew step in `backend/scanner.py` — minAreaRect on largest contour → rotation angle → getRotationMatrix2D + warpAffine
- [X] T059 [US4] Implement denoise step in `backend/scanner.py` — fastNlMeansDenoisingColored or bilateralFilter based on parameter
- [X] T060 [US4] Implement CLAHE contrast step in `backend/scanner.py` — convert to LAB, apply createCLAHE to L channel with configurable clip_limit and grid_size
- [X] T061 [US4] Implement sharpen step in `backend/scanner.py` — unsharp mask via GaussianBlur + weighted addition with configurable amount
- [X] T062 [US4] Implement white balance step in `backend/scanner.py` — gray-world algorithm (scale channels to match mean)
- [X] T063 [US4] Implement B&W conversion step in `backend/scanner.py` — adaptiveThreshold or Otsu threshold, configurable method/block_size/constant
- [X] T064 [US4] Implement processing profiles CRUD endpoints in `backend/main.py` — `GET/POST /api/settings/profiles`, `PUT/DELETE /api/settings/profiles/{id}` per contracts/settings.md, seed 5 default profiles on first boot
- [X] T065 [US4] Implement reprocess endpoint `POST /api/scans/{id}/reprocess` in `backend/main.py` — accept optional profile, re-run pipeline on original images, update processed_path, broadcast progress events

### Frontend — US4

- [X] T066 [US4] Implement profile management in Settings page (Processing tab) `frontend/src/pages/Settings.jsx` — list profiles, create/edit/delete/duplicate, toggle each pipeline step, sliders for parameters, set default profile
- [X] T067 [US4] Add profile selector to Scanner page and batch detail — dropdown to choose profile before sending, reprocess button in detail with profile selector

**Checkpoint**: All 8 pipeline steps implemented with configurable parameters. Profiles can be created, edited, and used for processing/reprocessing.

---

## Phase 7: User Story 5 — Multi-Backend Export (Priority: P2)

**Goal**: Configure Paperless-NGX + local storage, scan a document, verify PDF exported to both. Test Paperless down → local succeeds + export_failed status + retry.

**Independent Test**: Configure 2 backends, scan, verify both exports. Disable one backend, scan, verify partial export + retry.

### Backend — US5

- [X] T068 [US5] Implement storage backend abstract base class in `backend/storage.py` — `StorageBackend` ABC with `upload()` and `test_connection()` async methods per research.md R7
- [X] T069 [P] [US5] Implement LocalStorage backend in `backend/storage.py` — `shutil.copy2()` to configured path, configurable filename template
- [X] T070 [P] [US5] Implement PaperlessStorage backend in `backend/storage.py` — `aiohttp.post()` to `/api/documents/post_document/`, token auth, configurable tags/correspondent
- [X] T071 [P] [US5] Implement WebDAVStorage backend in `backend/storage.py` — `aiohttp.put()` with Basic/Digest auth, configurable base path
- [X] T072 [P] [US5] Implement GoogleDriveStorage backend in `backend/storage.py` — Google API client with service account JSON, configurable folder ID
- [X] T073 [P] [US5] Implement SMBStorage backend in `backend/storage.py` — `smbprotocol` library for CIFS shares, configurable share/path/credentials
- [X] T074 [US5] Implement export orchestration in `backend/main.py` — `POST /api/scans/{id}/export`, `POST /api/settings/test-storage`, export to all configured backends via `asyncio.gather()`, independent success/failure per backend, update batch.export_info JSON, broadcast exporting/export_complete/export_error events
- [X] T075 [US5] Implement auto-export after processing in `backend/main.py` — if auto_export enabled in config, trigger export to all backends after processing completes
- [X] T076 [US5] Implement filename template rendering in `backend/storage.py` — replace `{date}`, `{time}`, `{device}`, `{batch_id}`, `{page_count}`, `{profile}` variables in configurable template

### Frontend — US5

- [X] T077 [US5] Implement Storage tab in Settings page `frontend/src/pages/Settings.jsx` — add/edit/remove backends, type selector (local/paperless/webdav/gdrive/smb), credentials form per type, test connection button with success/failure feedback, filename template config
- [X] T078 [US5] Add export controls to batch detail page — export button, retry export on failed backends, show export_info status per backend

**Checkpoint**: All 5 storage backends implemented with connection testing. Auto-export and manual export/retry work from the UI.

---

## Phase 8: User Story 6 — Real-Time Dashboard (Priority: P2)

**Goal**: Keep dashboard open, trigger scan from any source, see updates instantly without refresh

**Independent Test**: Open dashboard in 2 tabs, trigger scan from ESP32-CAM (or web upload). Verify both tabs update simultaneously. Disconnect WebSocket, verify reconnection banner + auto-reconnect.

### Implementation — US6

- [X] T079 [US6] Enhance Dashboard real-time updates in `frontend/src/pages/Dashboard.jsx` — subscribe to all WebSocket events (batch_created, processing_started/page/complete/error, export_complete/error, device_online/offline), update stat cards live, prepend recent activity items, animate new entries
- [X] T080 [US6] Implement WebSocket reconnection indicator in `frontend/src/components/shared/ReconnectBanner.jsx` — show banner when disconnected, auto-dismiss on reconnect, display countdown
- [X] T081 [US6] Implement state sync on WebSocket reconnect in `frontend/src/hooks/useWebSocket.js` — on reconnect, fetch `GET /api/stats` + `GET /api/devices` + `GET /api/scans?limit=5` to rebuild UI state

**Checkpoint**: Dashboard is fully real-time. Multiple browser tabs stay in sync. Reconnection is seamless.

---

## Phase 9: User Story 7 — Log Investigation (Priority: P3)

**Goal**: A scan failed. Open Logs page, filter by processing + ERROR, find the error with step details.

**Independent Test**: Trigger a processing error (corrupt image), filter logs by level=ERROR + category=processing. Verify error appears within 500ms with batch_id, page_index, step name, error details.

### Backend — US7

- [X] T082 [US7] Implement log query endpoint `GET /api/logs` in `backend/main.py` — cursor-based pagination, filters (level[], category[], device_mac, source, search, date_from/to), per contracts/logs.md
- [X] T083 [US7] Implement log purge endpoint `DELETE /api/logs` in `backend/main.py` — purge by date/level/category
- [X] T084 [US7] Implement log export endpoint `GET /api/logs/export` in `backend/main.py` — export as .log (plain text) or .json file, filtered

### Frontend — US7

- [X] T085 [US7] Implement Logs page in `frontend/src/pages/Logs.jsx` — terminal-style display, color coding by level (DEBUG=gray, INFO=white, WARNING=yellow, ERROR=red), timestamp + level + category + message per line, expandable details JSON
- [X] T086 [US7] Implement log streaming hook in `frontend/src/hooks/useLogs.js` — subscribe to WebSocket `log` events, buffer for display, pause auto-scroll on scroll up, resume on scroll to bottom
- [X] T087 [US7] Implement log filters in `frontend/src/pages/Logs.jsx` — level multi-select, category select, device select, full-text search, date range, clear filters, toggle real-time/historical mode
- [X] T088 [US7] Add log export button to Logs page — trigger `GET /api/logs/export?format=log|json` with current filters

**Checkpoint**: Log system is complete: real-time streaming, filtering, searching, historical browsing, export. Errors from processing are fully traceable.

---

## Phase 10: User Story 8 — Scan History Management (Priority: P3)

**Goal**: Filter 300+ scans by device + date, sort, select 15, export CSV. Bulk-delete 10 old scans.

**Independent Test**: Create 50 test batches, apply combined filters (status + device + date), sort, select multiple, bulk delete. Verify operations complete and counts update.

### Backend — US8

- [X] T089 [US8] Implement bulk actions endpoint `POST /api/scans/bulk` in `backend/main.py` — accept action (delete/reprocess/export) + ids array, execute in transaction, return per-item results, broadcast events
- [X] T090 [US8] Implement batch deletion `DELETE /api/scans/{id}` in `backend/main.py` — delete batch row (CASCADE to pages), delete files from disk, broadcast `batch_deleted` event, create log entry
- [X] T091 [US8] Implement history export in `backend/main.py` — `GET /api/scans?format=csv|json` returns full filtered view as downloadable file

### Frontend — US8

- [X] T092 [US8] Implement advanced filters in History page `frontend/src/pages/History.jsx` — filter modal/panel: status multi-select, device dropdown, date range picker, page count min/max, text search; applied filters as chips, clear all button
- [X] T093 [US8] Implement sort controls in History page — sort by date/status/pages/size, ascending/descending toggle per column
- [X] T094 [US8] Implement bulk selection in History page — checkbox per scan item, "Select all (visible)" toggle, selected count indicator, bulk action bar (Delete, Reprocess, Export), confirmation dialog showing count
- [X] T095 [US8] Implement history export in History page — export filtered view as CSV or JSON download

**Checkpoint**: History is a full-featured archive viewer with search, filters, sort, bulk actions, and export.

---

## Phase 11: User Story 9 — Exhaustive Settings (Priority: P3)

**Goal**: Configure every aspect from the Settings page: theme, processing defaults, storage backends, log retention, backup/restore config. All changes apply immediately.

**Independent Test**: Change theme to dark, modify CLAHE parameters, add WebDAV backend + test connection, change log retention to 7 days, backup config, restore on fresh instance. Verify all changes persist.

### Backend — US9

- [X] T096 [US9] Implement full settings CRUD in `backend/main.py` — `GET /api/settings`, `PUT /api/settings`, `PATCH /api/settings/{section}`, broadcast `config_changed` WebSocket event on any change
- [X] T097 [US9] Implement config backup/restore in `backend/main.py` — `POST /api/settings/backup` (download JSON), `POST /api/settings/restore` (upload + apply + validate), broadcast config_changed
- [X] T098 [US9] Implement log retention cleanup in `backend/main.py` — periodic task (daily) deletes logs older than configured retention days, log the purge event

### Frontend — US9

- [X] T099 [US9] Implement settings hook in `frontend/src/hooks/useSettings.js` — fetch settings, update section, auto-reload on `config_changed` WebSocket event
- [X] T100 [US9] Implement Settings page with 7 tabs in `frontend/src/pages/Settings.jsx`:
  - General: server name, language, timezone, theme (light/dark/auto), auto-process toggle, auto-export toggle, default profile, API key toggle + value
  - Capture: camera resolution, timer, capture sound, burst mode, grid overlay
  - Processing: profile list (from US4), default profile selector
  - Storage: backends list (from US5), filename template, retention
  - Notifications: enable/disable categories
  - Logs: retention days, minimum level, auto-cleanup toggle
  - System: backup/restore config, reset to defaults, port display, version info
- [X] T101 [US9] Implement theme switching in `frontend/src/App.jsx` — apply light/dark/auto CSS class based on settings, `prefers-color-scheme` media query for auto mode, instant switch on change (no reload)

**Checkpoint**: Every setting is configurable from the UI. Theme switch, log retention, backup/restore all work. Config persists across restarts.

---

## Phase 12: User Story 10 — Device Management (Priority: P3)

**Goal**: Name ESP32-CAM devices, change resolution remotely, see online/offline status

**Independent Test**: Register 2 devices, name one "Kitchen". Change resolution to SVGA, verify device receives new config on heartbeat. Power off device, verify offline after 180s.

### Implementation — US10

- [X] T102 [US10] Enhance Devices page `frontend/src/pages/Devices.jsx` — device config modal: resolution dropdown (UXGA/SVGA/VGA/CIF), JPEG quality slider (1-100), flash toggle, flash duration slider, auto-send toggle; save via `POST /api/devices/{mac}/config`
- [X] T103 [US10] Add device stats to Devices page — total scans per device, last scan date, uptime percentage chart (optional), link to filtered history for that device
- [X] T104 [US10] Implement real-time device status in Devices page — WebSocket listener for device_online/offline, animate status changes, show "last seen X ago" with auto-update

**Checkpoint**: Full device lifecycle management from the web UI. Remote configuration propagates on heartbeat.

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that span multiple user stories, responsive refinement, PWA, testing

### About Page

- [X] T105 [P] Implement About page in `frontend/src/pages/About.jsx` — version number, project links, system info (uptime, database size, scan count), constitution principles summary

### PWA

- [X] T106 [P] Create PWA manifest in `frontend/public/manifest.json` — name "ESPScanCam", icons (192px, 512px), theme_color, display: standalone
- [X] T107 [P] Implement service worker in `frontend/src/sw.js` — cache-first for static assets (JS, CSS, HTML, icons), network-first for API calls, register in index.html
- [X] T108 [P] Create PWA icons in `frontend/public/icons/` — 192x192 and 512x512 PNG icons

### Responsive & UX Polish

- [X] T109 Responsive pass on all 8 pages — verify layout at 375px, 390px, 768px, 1024px, 1440px viewports; fix any overflow, touch target issues, bottom tab bar alignment
- [X] T110 [P] Implement swipe/toggle comparison on batch detail mobile — touch gesture for before/after swipe, toggle button fallback
- [X] T111 [P] Add keyboard shortcuts for desktop — Ctrl+N (new scan), arrow keys (page navigation in detail), Escape (close modals)
- [X] T112 Add error toast integration across all pages — catch API errors, WebSocket errors, upload failures, show contextual toast with retry action where applicable

### Backend Tests

- [X] T113 [P] Write pipeline unit tests in `backend/tests/test_scanner.py` — test each of 8 steps with known input/output images, test skip-on-failure behavior, test profile application
- [X] T114 [P] Write storage backend tests in `backend/tests/test_storage.py` — mock aiohttp for Paperless/WebDAV, test upload/test_connection for each backend, test multi-backend export
- [X] T115 [P] Write API endpoint tests in `backend/tests/test_api.py` — FastAPI TestClient for all endpoints (device, scan, settings, logs, stats), test success/error/validation cases, test cursor pagination
- [X] T116 [P] Write database operation tests in `backend/tests/test_database.py` — test schema creation, CRUD for all tables, test WAL concurrent access, test cascade delete
- [X] T117 [P] Write config handling tests in `backend/tests/test_config.py` — test defaults, env var overrides, corruption recovery, backup/restore

### Docker & Deployment

- [X] T118 Finalize Dockerfile — verify multi-stage build works (frontend build → backend runtime), apt dependencies (libgl1-mesa-glx, libglib2.0-0), non-root user (1000:1000), healthcheck, EXPOSE 8400
- [X] T119 [P] Create Unraid Community Applications template XML
- [X] T120 Test full Docker deployment — build image, run container, verify all features work end-to-end, check image size < 500MB

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — MVP, start here
- **US2 (Phase 4)**: Depends on Foundational — can parallel with US1 (different layers)
- **US3 (Phase 5)**: Depends on US1 (extends Scanner page upload mode)
- **US4 (Phase 6)**: Depends on US1 (extends basic pipeline in scanner.py)
- **US5 (Phase 7)**: Depends on US1 (needs batch completion to export)
- **US6 (Phase 8)**: Depends on US1 (enhances existing dashboard)
- **US7 (Phase 9)**: Depends on Foundational (logger.py exists), can parallel with any US
- **US8 (Phase 10)**: Depends on US1 (extends history page)
- **US9 (Phase 11)**: Depends on US4+US5 (profiles + storage tabs need implementations)
- **US10 (Phase 12)**: Depends on US2 (needs device endpoints)
- **Polish (Phase 13)**: Depends on all desired stories being complete

### User Story Dependency Graph

```
Phase 1 → Phase 2 (BLOCKS ALL)
                ├── US1 (Phase 3) ──┬── US3 (Phase 5)
                │                   ├── US4 (Phase 6) ──┐
                │                   ├── US5 (Phase 7) ──┼── US9 (Phase 11)
                │                   ├── US6 (Phase 8)   │
                │                   └── US8 (Phase 10)  │
                ├── US2 (Phase 4) ──────── US10 (Phase 12)
                └── US7 (Phase 9) ── (independent)

                All → Polish (Phase 13)
```

### Within Each User Story

- Models/database before services
- Services/endpoints before frontend pages
- Core implementation before integration/polish
- Story complete before dependent stories

### Parallel Opportunities

- **Phase 1**: T002-T006 all parallel (different directories)
- **Phase 2**: T013-T016, T019-T020 parallel (different files); T007-T012 sequential (backend core)
- **US1**: T029-T031 parallel (different frontend files); backend tasks sequential (dependency chain)
- **US2**: T047-T049 parallel (different firmware headers); T069-T073 parallel (different storage backends)
- **US5**: T069-T073 all parallel (independent backend implementations)
- **US7**: T082-T084 parallel (different endpoints)
- **Phase 13**: T105-T108, T113-T117 parallel (independent files)

---

## Parallel Example: User Story 1

```bash
# Backend tasks (sequential - dependency chain):
T021 → T022 → T023 → T024 → T025 → T026 → T027 → T028

# Frontend tasks (after backend endpoints ready):
# Launch these in parallel:
Task: T029 "Camera hook in frontend/src/hooks/useCamera.js"
Task: T033 "Dashboard page in frontend/src/pages/Dashboard.jsx"
Task: T034 "History page in frontend/src/pages/History.jsx"

# Then sequential:
T030 (Scanner camera, needs T029) → T031 (Scanner upload) → T032 (Upload logic)
T035 (Detail page, needs T026 batch detail endpoint)
```

## Parallel Example: User Story 5

```bash
# All 5 storage backends can be built simultaneously:
Task: T069 "LocalStorage in backend/storage.py"
Task: T070 "PaperlessStorage in backend/storage.py"
Task: T071 "WebDAVStorage in backend/storage.py"
Task: T072 "GoogleDriveStorage in backend/storage.py"
Task: T073 "SMBStorage in backend/storage.py"

# Then wire them together:
T074 → T075 → T076
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 (Smartphone Camera Scan)
4. **STOP and VALIDATE**: Test full scan-to-view flow on mobile
5. Deploy Docker container — MVP is functional

### Incremental Delivery (Recommended Order)

1. Setup + Foundational → Foundation ready
2. US1 (Camera Scan) → MVP: capture + process + view
3. US2 (ESP32-CAM) → Hardware integration
4. US4 (Pipeline Profiles) → Advanced processing
5. US5 (Storage Backends) → Export to Paperless/WebDAV/etc.
6. US3 (File Upload) → Enhanced upload mode
7. US7 (Logs) → Observability
8. US6 (Real-Time Dashboard) → Live updates polish
9. US8 (History Management) → Advanced history features
10. US9 (Settings) → Full configuration UI
11. US10 (Device Management) → Remote device config
12. Polish → PWA, tests, responsive pass, Docker finalization

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: US1 (frontend) + US3 + US6 + US8
   - Developer B: US1 (backend) + US4 + US7
   - Developer C: US2 (firmware + device endpoints) + US10
   - Developer D: US5 (storage backends) + US9
3. Stories integrate independently via clean API contracts

---

## Summary

| Metric | Count |
|--------|-------|
| Total tasks | 120 |
| Setup tasks | 6 |
| Foundational tasks | 14 |
| US1 tasks (MVP) | 15 |
| US2 tasks | 18 |
| US3 tasks | 3 |
| US4 tasks | 11 |
| US5 tasks | 11 |
| US6 tasks | 3 |
| US7 tasks | 7 |
| US8 tasks | 7 |
| US9 tasks | 6 |
| US10 tasks | 3 |
| Polish tasks | 16 |
| Parallel opportunities | 40+ tasks marked [P] |

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable after its dependencies
- Backend and firmware tests are in Phase 13 (not TDD — per spec testing strategy)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
