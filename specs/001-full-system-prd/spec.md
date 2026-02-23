# Feature Specification: ESPScanCam — Self-Hosted Document Scanning System

**Feature Branch**: `001-full-system-prd`
**Created**: 2026-02-23
**Status**: Draft
**Input**: Complete system PRD for ESPScanCam

## Executive Summary

ESPScanCam is a 100% self-hosted document scanning solution designed for the
homelab ecosystem (*arr family). It combines unlimited ESP32-CAM hardware
scanners with browser-based camera capture and file upload, an intelligent
OpenCV image processing pipeline, and automated multi-backend export — all
served from a single Docker container with a mobile-first responsive web
interface.

The system addresses the gap between proprietary cloud-dependent scanning apps
(CamScanner, Adobe Scan) and the self-hosting community's need for data
sovereignty. Three distinct personas drive the design: the technical Homelabber
who configures and monitors, the non-technical Family member who scans from
their smartphone, and the Office user who presses a physical button and checks
results later.

## Problem Statement

Homelab users who want to digitize documents face a choice between:

1. **Proprietary cloud apps** (CamScanner, Adobe Scan) — excellent UX but all
   data is sent to third-party servers, violating data sovereignty principles.
2. **Traditional flatbed scanners** — local but expensive, bulky, and not
   network-accessible.
3. **Paperless-NGX** — excellent for document management but has no built-in
   capture solution (no camera, no hardware scanner integration).

No existing solution combines: hardware scanner modules + web camera capture +
intelligent image processing + multi-backend export + mobile-first UI — all
self-hosted in a single Docker container.

## User Personas

### Persona 1: "Homelabber"

- **Profile**: Technical user, manages their own server (Unraid, Proxmox),
  familiar with the *arr ecosystem (Sonarr, Radarr), values data sovereignty.
- **Goals**: Install ESPScanCam via Docker, configure storage backends
  (Paperless-NGX, Nextcloud), tune processing parameters, monitor logs. Owns
  1-3 ESP32-CAM devices placed around the house.
- **Pain points**: Cloud-dependent apps violate privacy. Existing self-hosted
  solutions lack integrated capture hardware.
- **Technical comfort**: High. Comfortable with Docker, reverse proxies,
  configuration files.
- **Frequency**: Configures once, scans occasionally, monitors regularly.

### Persona 2: "Famille" (Family)

- **Profile**: Non-technical household member (spouse, children, parents).
- **Goals**: Scan a document from their smartphone as quickly as possible.
  Open browser, point camera, capture, send. Done.
- **Pain points**: Cannot install apps. Will not configure settings. Must be
  intuitive and fast.
- **Technical comfort**: Low. Uses smartphone daily but avoids anything that
  requires configuration.
- **Frequency**: Occasional (receipts, school documents, letters).

### Persona 3: "Bureau" (Office)

- **Profile**: User in a small office or association with a fixed ESP32-CAM
  station above a desk.
- **Goals**: Press a physical button to scan a document. Check the result later
  on the web interface.
- **Pain points**: Needs a fast, reliable, no-fuss scanning station.
- **Technical comfort**: Medium. Can use a web interface but does not configure
  the system.
- **Frequency**: Daily, multiple documents.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Smartphone Camera Scan (Priority: P1)

As a Family member, I open ESPScanCam in my mobile browser, tap "Scanner", my
camera opens full-screen. I point at a document, tap the capture button, add
2 more pages, tap "Send". The document is processed and appears in the history.

**Why this priority**: This is the primary use case for the majority of users.
A non-technical person must be able to scan and send a document in under 45
seconds from opening the app.

**Independent Test**: Open the web app on a smartphone, capture 3 pages via
camera, submit. Verify the batch appears in history with status "completed"
and all 3 pages are viewable (original + processed).

**Acceptance Scenarios**:

1. **Given** the user opens the Scanner page on an iPhone, **When** they tap
   the capture button, **Then** a photo is taken and a thumbnail appears in the
   page pile at the bottom.
2. **Given** the user has captured 3 pages, **When** they tap "Send", **Then**
   the pages are uploaded, processing starts, and a progress indicator shows
   each step in real-time.
3. **Given** processing completes, **When** the user navigates to History,
   **Then** the batch appears at the top with status "completed", correct page
   count, and viewable thumbnails.

---

### User Story 2 — ESP32-CAM Hardware Scan (Priority: P1)

As a Homelabber with an ESP32-CAM named "Scanner Bureau", I press the SCAN
button to capture 5 pages, then press SEND. The batch appears in real-time on
my dashboard. My wife at the entrance scanner does the same simultaneously
without interference.

**Why this priority**: Hardware scanning is a core differentiator. Multiple
concurrent devices must work seamlessly.

**Independent Test**: Power on an ESP32-CAM, verify it auto-registers. Press
SCAN 5 times, press SEND. Verify the batch appears in the dashboard with 5
pages and "completed" status within 30 seconds.

**Acceptance Scenarios**:

1. **Given** an ESP32-CAM boots with valid WiFi and server URL, **When** it
   connects, **Then** it sends a registration request and appears in the
   Devices page with online status and a green indicator.
2. **Given** I press SCAN 5 times on the device, **When** I press SEND,
   **Then** 5 images are uploaded sequentially, processing triggers
   automatically, and the dashboard shows the new batch in real-time via
   WebSocket.
3. **Given** two ESP32-CAM devices scan simultaneously, **When** both send
   their batches, **Then** two separate batches appear in history with correct
   device attribution and no page mixing.

---

### User Story 3 — File Upload Batch (Priority: P2)

As a user with 10 receipt photos on my phone, I open ESPScanCam, select all
photos from my gallery, reorder them, and submit. They are processed as a
single batch.

**Why this priority**: File upload is the fallback capture method and serves
users who already have photos taken.

**Independent Test**: Upload 10 JPEG files via the drag-and-drop zone, reorder
2 of them, submit. Verify the batch has 10 pages in the correct order.

**Acceptance Scenarios**:

1. **Given** I drag 10 JPEG files onto the upload zone, **When** they are
   dropped, **Then** 10 thumbnails appear in a responsive grid with page
   numbers.
2. **Given** I drag page 8 before page 2, **When** I release, **Then** pages
   are renumbered accordingly and the new order is reflected in thumbnails.
3. **Given** one file is 25MB (over the 20MB default limit), **When** it is
   added, **Then** that file shows an error badge while the other 9 files
   remain valid and submittable.

---

### User Story 4 — Processing Pipeline with Profiles (Priority: P2)

As a Homelabber, I create a "Receipt" processing profile with high contrast
and B&W mode. When scanning receipts, I select this profile and get optimal
results. I can also reprocess old scans with a different profile.

**Why this priority**: Configurable processing is a key differentiator vs.
simple photo-to-PDF tools.

**Independent Test**: Create a profile with B&W enabled and high CLAHE. Scan a
faded receipt. Verify the processed image is B&W with enhanced contrast. Then
reprocess with the default profile and verify the result is different.

**Acceptance Scenarios**:

1. **Given** I create a profile named "Receipt" with B&W and CLAHE clip_limit=4,
   **When** I scan a faded receipt using this profile, **Then** the processed
   image is monochrome with visibly enhanced contrast.
2. **Given** a completed batch exists, **When** I click "Reprocess" and select
   a different profile, **Then** the processed images are regenerated while
   originals remain untouched.
3. **Given** processing is running, **When** I view the batch detail, **Then**
   a progress bar shows the current step name (e.g., "Deskew") and percentage
   for each page.
4. **Given** the auto-crop step fails on a page (no document edges detected),
   **When** processing continues, **Then** the step is skipped, the log
   records a WARNING, and the remaining pipeline steps execute normally.

---

### User Story 5 — Multi-Backend Export (Priority: P2)

As a Homelabber, I configure Paperless-NGX as my primary backend and a local
folder as backup. Every completed scan is automatically exported to both.
If Paperless is down, the scan is saved locally and I can retry the export.

**Why this priority**: Export is what makes scans useful beyond ESPScanCam. It
connects to the user's existing document management ecosystem.

**Independent Test**: Configure two backends (local + Paperless-NGX mock).
Scan a document. Verify the PDF appears in both destinations. Then disable
Paperless, scan again, verify local export succeeds and Paperless shows
"export_failed" with a retry button.

**Acceptance Scenarios**:

1. **Given** Paperless-NGX and local storage are configured, **When** a scan
   completes, **Then** the PDF is exported to both backends and export_info
   shows success for each.
2. **Given** Paperless-NGX is unreachable, **When** export runs, **Then** the
   local export succeeds, Paperless export fails, batch status shows
   "export_failed", and an ERROR log is created.
3. **Given** a batch has "export_failed" status, **When** I click "Retry Export"
   from the batch detail page, **Then** only the failed backend is retried.

---

### User Story 6 — Real-Time Dashboard (Priority: P2)

As a Homelabber, I keep the dashboard open on my desktop. When any device scans,
when processing runs, or when an export completes, I see updates instantly
without refreshing the page.

**Why this priority**: Real-time feedback is essential for a multi-device
system where events happen asynchronously.

**Independent Test**: Open the dashboard in two browser tabs. Trigger a scan
from an ESP32-CAM. Verify both tabs update simultaneously with the new batch
and processing progress.

**Acceptance Scenarios**:

1. **Given** the dashboard is open, **When** an ESP32-CAM registers, **Then**
   the device count updates and a toast notification appears within 500ms.
2. **Given** a batch is processing, **When** each page completes, **Then** the
   dashboard's recent activity section updates to show step-by-step progress.
3. **Given** the WebSocket connection drops, **When** the browser detects the
   disconnect, **Then** a reconnection banner appears and the connection is
   re-established within 5 seconds.

---

### User Story 7 — Log Investigation (Priority: P3)

As a Homelabber, a scan failed. I open the Logs page, filter by category
"processing" and level "ERROR", and immediately find the error message with
details about which pipeline step failed and why.

**Why this priority**: Observability is critical for troubleshooting in a
self-hosted system without vendor support.

**Independent Test**: Trigger a processing error (corrupt image). Open logs,
apply filters. Verify the error appears with batch_id, page_index, step name,
and error details.

**Acceptance Scenarios**:

1. **Given** the Logs page is open with real-time mode, **When** a log entry
   is created on the backend, **Then** it appears in the terminal-style view
   within 500ms with correct color coding by level.
2. **Given** 50,000 log entries exist, **When** I filter by level=ERROR and
   category=processing, **Then** results appear in under 1 second.
3. **Given** I am viewing real-time logs, **When** I scroll up to read older
   entries, **Then** auto-scroll pauses. When I scroll back to the bottom,
   auto-scroll resumes.

---

### User Story 8 — Scan History Management (Priority: P3)

As a Homelabber, I have 300+ scans this month. I filter by device "Scanner
Bureau", sort by date, select 15 completed scans, and export the list as CSV.
I also bulk-delete 10 old test scans.

**Why this priority**: Rich history management becomes essential as scan volume
grows.

**Independent Test**: Create 50 test batches with different statuses and
devices. Apply combined filters, sort, select multiple items, perform bulk
actions.

**Acceptance Scenarios**:

1. **Given** I filter by status=completed AND device="Scanner Bureau", **When**
   I also set a date range, **Then** all three filters combine (AND logic) and
   results update instantly.
2. **Given** I select 15 batches via checkboxes, **When** I click "Export CSV",
   **Then** a CSV file downloads with all batch metadata for the selected items.
3. **Given** I select 10 batches and click "Delete", **When** I confirm the
   action, **Then** all 10 batches and their files are deleted, the count
   updates, and 10 log entries are created.

---

### User Story 9 — Exhaustive Settings (Priority: P3)

As a Homelabber, I configure every aspect of ESPScanCam from the Settings page:
theme, default processing profile, storage backends with connection tests,
log retention, and system backup. Every change is applied immediately.

**Why this priority**: Full configurability differentiates ESPScanCam from
simpler tools and satisfies power users.

**Independent Test**: Change theme to dark, modify CLAHE parameters, add a
WebDAV backend, test its connection, change log retention to 7 days. Verify
each change takes effect without server restart.

**Acceptance Scenarios**:

1. **Given** I change the theme from "auto" to "dark", **When** I click Save,
   **Then** the UI switches to dark theme immediately without page reload.
2. **Given** I add a WebDAV backend with valid credentials, **When** I click
   "Test Connection", **Then** a success/failure result appears within 5
   seconds.
3. **Given** I click "Backup Configuration", **When** the backup completes,
   **Then** a JSON file downloads containing all current settings. When I
   restore it on a fresh instance, all settings are applied identically.
4. **Given** the config.json file is corrupted, **When** the server starts,
   **Then** it starts with default values and logs a WARNING entry.

---

### User Story 10 — Device Management (Priority: P3)

As a Homelabber, I manage my ESP32-CAM devices from the web interface. I name
them, configure their resolution and flash settings remotely, and see which
ones are online or offline.

**Why this priority**: Remote device management eliminates the need to
physically access each ESP32-CAM for configuration changes.

**Independent Test**: Register two devices. Name one "Kitchen". Change its
resolution to SVGA. Verify the device receives the new config on next
heartbeat. Power off one device and verify it shows as offline after 3 missed
heartbeats.

**Acceptance Scenarios**:

1. **Given** a device named "AA:BB:CC:DD:EE:FF" is registered, **When** I set
   its name to "Kitchen Scanner", **Then** the name appears everywhere: devices
   list, batch history, logs.
2. **Given** I change a device's resolution to SVGA, **When** the device sends
   its next heartbeat, **Then** it receives the updated config and applies it.
3. **Given** a device has not sent a heartbeat for 180 seconds, **When** the
   server checks, **Then** the device is marked offline and a
   `device_offline` WebSocket event is emitted.

---

### Edge Cases

- **WiFi drop during ESP32-CAM upload**: Device retries 3 times with 1s delay.
  If server unreachable, LED shows SOS pattern. Images remain in PSRAM.
- **Camera permission denied on mobile**: Show clear message with "Try Again"
  button and fallback "Upload photos instead" option.
- **No webcam on desktop**: Auto-switch to file upload mode with explanatory
  message.
- **Oversized file upload**: Show error on individual file, allow other files
  to proceed normally.
- **Processing step crash**: Skip the step, log WARNING, continue pipeline.
  Original image always preserved.
- **Storage backend unreachable during export**: Mark batch as "export_failed",
  log ERROR. Allow manual retry from batch detail.
- **Corrupted config.json**: Server starts with defaults, logs WARNING.
- **SQLite database locked**: WAL mode prevents this in normal operation.
  Backend uses async connections with retry logic for edge cases.
- **WebSocket disconnect**: Frontend shows reconnection banner, exponential
  backoff (max 5s), state sync on reconnect.
- **Concurrent batches from multiple sources**: Each batch has unique ID and
  source attribution. No page mixing possible.
- **Browser back button in scanner full-screen**: Exit full-screen gracefully,
  preserve captured pages in memory.
- **HEIC file from iPhone**: Convert client-side to JPEG before upload (or
  accept and convert server-side).
- **100+ pages in a single batch**: Paginate the batch detail view. Processing
  runs sequentially with progress tracking.

---

## Requirements *(mandatory)*

### Functional Requirements

#### F1 — Multi-Source Capture

- **FR-001**: System MUST accept image captures from ESP32-CAM hardware devices
  via HTTP POST with raw JPEG body and `X-Device-MAC` header.
- **FR-002**: System MUST accept image captures from web browser camera via
  `navigator.mediaDevices.getUserMedia()` with full-screen mobile UI.
- **FR-003**: System MUST accept file uploads via drag-and-drop zone and file
  picker with multi-select support.
- **FR-004**: System MUST support unlimited concurrent ESP32-CAM devices, each
  identified by unique MAC address.
- **FR-005**: ESP32-CAM devices MUST auto-register on boot via
  `POST /api/device/register`.
- **FR-006**: Web camera UI on mobile MUST provide: live preview, capture button
  (min 44x44px), page counter, camera switch (front/back), flash/torch toggle,
  alignment grid overlay (toggleable).
- **FR-007**: After capture, UI MUST show capture animation (white flash) and
  slide thumbnail into horizontal page pile at bottom.
- **FR-008**: File upload MUST accept JPEG, PNG, WebP, HEIC formats
  (configurable).
- **FR-009**: File upload MUST support page reordering via drag-and-drop (long
  press + drag on mobile).
- **FR-010**: Each capture session MUST create a unique batch with source
  traceability (source_type + device identifier).
- **FR-011**: System MUST support client-side compression before upload
  (configurable quality 60-95%).
- **FR-012**: Maximum file size per upload MUST be configurable (default 20MB).

#### F2 — Processing Pipeline

- **FR-013**: System MUST provide an 8-step processing pipeline: auto-crop,
  perspective correction, deskew, denoise, CLAHE contrast, sharpening, white
  balance, B&W conversion.
- **FR-014**: Each pipeline step MUST be independently toggleable (on/off).
- **FR-015**: Each pipeline step MUST expose its own configurable parameters.
- **FR-016**: System MUST support named processing profiles with create, edit,
  duplicate, delete, and set-as-default operations.
- **FR-017**: System MUST provide 5 built-in profiles: "Document Standard",
  "Document B&W", "Photo / Color", "Receipt", "Quick".
- **FR-018**: System MUST generate output as PDF, JPEG, or PNG (configurable
  per profile).
- **FR-019**: Processing MUST run entirely on the backend (no client-side
  heavy processing).
- **FR-020**: Processing progress MUST be streamed in real-time via WebSocket
  (step name + percentage per page).
- **FR-021**: If a pipeline step fails, it MUST be skipped with a WARNING log.
  Processing MUST continue with remaining steps.
- **FR-022**: Original images MUST never be modified or deleted by processing.

#### F3 — Multi-Backend Export

- **FR-023**: System MUST support 5 storage backends: local filesystem,
  Paperless-NGX (API), WebDAV (Nextcloud/ownCloud), Google Drive (service
  account), SMB/CIFS.
- **FR-024**: Multiple backends MUST be configurable simultaneously.
- **FR-025**: Export MUST target all configured backends in a single operation,
  with independent success/failure per backend.
- **FR-026**: Each backend MUST provide a "Test Connection" function accessible
  from the Settings UI.
- **FR-027**: Filename templates MUST be configurable using variables: {date},
  {time}, {device}, {batch_id}, {page_count}, {profile}.
- **FR-028**: Auto-export after processing MUST be configurable (on/off).
- **FR-029**: Manual export and retry MUST be available from batch detail page.
- **FR-030**: Failed exports MUST set batch status to "export_failed" with per-
  backend error details in export_info JSON.

#### F4 — Web Interface (Mobile-First Responsive)

- **FR-031**: System MUST serve a React 18 SPA with 8 pages: Dashboard,
  Scanner, History, Detail, Logs, Devices, Settings, About.
- **FR-032**: Mobile layout (< 768px) MUST use a fixed bottom tab bar for
  navigation.
- **FR-033**: Tablet layout (768px-1023px) MUST use a collapsible sidebar.
- **FR-034**: Desktop layout (>= 1024px) MUST use a fixed sidebar.
- **FR-035**: Scanner page on mobile MUST be full-screen with no browser chrome
  visible.
- **FR-036**: Before/after comparison MUST be side-by-side on desktop and
  toggle/swipe on mobile.
- **FR-037**: Zoom MUST use pinch gestures on mobile and scroll wheel on
  desktop.
- **FR-038**: All interactive elements MUST be minimum 44x44px on mobile
  (Apple HIG).
- **FR-039**: System MUST support three theme modes: light, dark, auto
  (system preference).
- **FR-040**: Every async operation MUST show a loading indicator (skeleton
  screens for initial loads, spinners for actions).
- **FR-041**: All destructive actions MUST require a confirmation dialog
  showing the count of affected items.
- **FR-042**: Every list view MUST have a meaningful empty state with guidance.
- **FR-043**: Toast notifications MUST be shown for user actions (success,
  error, info) with 5-second auto-dismiss.
- **FR-043b**: System MUST be installable as a basic PWA (manifest.json, app
  icons, splash screen, service worker for app shell caching). No offline data
  sync required — network connectivity is needed for all capture/upload
  operations.

#### F5 — Logging System

- **FR-044**: System MUST log all significant events to an SQLite `logs` table
  with structured JSON schema: id, timestamp (ms), level, category, source,
  device_mac, message, details (JSON).
- **FR-045**: Log levels MUST be: DEBUG, INFO, WARNING, ERROR, CRITICAL.
- **FR-046**: Log categories MUST be: system, capture, processing, storage,
  api, websocket, device, config.
- **FR-047**: Logs page MUST provide a real-time terminal-style view via
  WebSocket with color coding by level.
- **FR-048**: Real-time log view MUST support filters: level (multi-select),
  category, device, full-text search.
- **FR-049**: Auto-scroll MUST pause when user scrolls up and resume when user
  scrolls to bottom.
- **FR-050**: Log history MUST be navigable by date, paginated, with
  configurable retention (default 30 days).
- **FR-051**: Logs MUST be exportable as .log (plain text) or .json files.
- **FR-052**: No error MUST be silenced — every caught exception MUST produce
  a log entry at ERROR or CRITICAL level.

#### F6 — Scan History

- **FR-053**: History page MUST support full-text search across batch metadata
  (ID, device name, error messages).
- **FR-054**: Filters MUST be combinable with AND logic: status (multi-select),
  device (select), date range (picker), page count (min/max).
- **FR-055**: Multi-criteria sorting MUST be available: date, status, page
  count, file size (ascending/descending toggle).
- **FR-056**: Pagination MUST be cursor-based (not offset-based) for consistent
  performance.
- **FR-057**: Inline statistics MUST be displayed: total scans, total pages,
  total storage used.
- **FR-058**: Bulk actions MUST be available via checkbox selection: delete,
  reprocess, export.
- **FR-059**: History MUST be exportable as CSV or JSON (filtered view).

#### F7 — Settings

- **FR-060**: Settings MUST be organized in 7 tabs: General, Capture,
  Processing, Storage, Notifications, Logs, System.
- **FR-061**: Every configurable parameter MUST be editable from the Settings UI.
- **FR-062**: Settings changes MUST be applied immediately without server
  restart (except port changes).
- **FR-063**: Settings MUST be stored in `/data/config.json` with environment
  variable overrides (prefix: `ESPSCANCAM_`).
- **FR-064**: A "Reset to Defaults" function MUST restore all settings to their
  factory values.
- **FR-065**: System MUST provide configuration backup (download JSON) and
  restore (upload JSON) functionality.
- **FR-066**: If config.json is corrupted or missing, server MUST start with
  defaults and log a WARNING.

#### F8 — ESP32-CAM Firmware

- **FR-067**: A device MUST be operational with only WiFi credentials and
  server URL configured.
- **FR-068**: Device MUST support 3 physical buttons: SCAN (capture page),
  SEND (upload + trigger processing), RESET (clear batch).
- **FR-069**: LED MUST indicate device state: fast blink (connecting), slow
  blink (registering), solid ON (idle), quick flash xN (captured page N),
  rapid pulse (uploading), double blink (processing), 3 slow blinks (success),
  SOS (error).
- **FR-070**: Device MUST send heartbeat (re-register) every 60 seconds.
  Server considers device offline after 180 seconds of silence.
- **FR-071**: Device MUST retry uploads 3 times with 1-second delay on failure.
- **FR-072**: Device MUST be remotely configurable (resolution, quality, flash)
  via the ESPScanCam web interface.
- **FR-072b**: System MUST support an optional shared API key (Settings >
  System). When enabled, all ESP32-CAM requests without a valid `X-API-Key`
  header MUST be rejected with HTTP 403. Disabled by default.

#### F9 — Real-Time Communication

- **FR-073**: System MUST provide a single WebSocket endpoint at `/ws` for all
  real-time events.
- **FR-074**: WebSocket events MUST cover: device_online, device_offline,
  page_captured, batch_created, page_uploaded, processing_started,
  processing_page, page_processed, processing_complete, processing_error,
  exporting, export_complete, export_error, batch_deleted, config_changed, log.
- **FR-075**: Frontend MUST maintain a persistent WebSocket connection with
  automatic reconnection (exponential backoff, max 5 seconds).
- **FR-076**: Upon WebSocket reconnection, a state sync MUST bring the UI up
  to date.
- **FR-077**: A reconnection indicator MUST be displayed when the connection
  is lost.

### Key Entities

- **Device**: An ESP32-CAM hardware module identified by MAC address. Has a
  name, IP, firmware version, configuration, and online/offline status.
- **Batch**: A collection of scanned pages from a single capture session.
  Belongs to one source (device, web camera, or file upload). Has a processing
  status, profile, and export information.
- **Page**: A single image within a batch. Has an original version (immutable)
  and a processed version (regeneratable). Tracks processing details per step.
- **Profile**: A named set of processing pipeline parameters. One profile is
  marked as default.
- **Log Entry**: A structured record of a system event with timestamp, level,
  category, source, and JSON details.

---

## UI/UX Specifications

### Page 1: Dashboard

#### Mobile (< 768px)

```
┌──────────────────────────┐
│  ESPScanCam    [bell]    │
├──────────────────────────┤
│ ┌──────────┐┌──────────┐ │
│ │ 147      ││ 3        │ │
│ │ Scans    ││ Devices  │ │
│ └──────────┘└──────────┘ │
│ ┌──────────┐┌──────────┐ │
│ │ 1203     ││ 2.4 GB   │ │
│ │ Pages    ││ Storage  │ │
│ └──────────┘└──────────┘ │
├──────────────────────────┤
│ Recent Activity          │
│ ┌──────────────────────┐ │
│ │ * Batch a1b2c3d4     │ │
│ │   3 pages - 2s ago   │ │
│ │   Completed          │ │
│ ├──────────────────────┤ │
│ │ * Batch e5f6g7h8     │ │
│ │   1 page - 5m ago    │ │
│ │   Processing...      │ │
│ └──────────────────────┘ │
├──────────────────────────┤
│ Devices Online           │
│ ┌──────────────────────┐ │
│ │ [ON]  Scanner Bureau │ │
│ │ [ON]  Scanner Cuisine│ │
│ │ [OFF] Scanner Entree │ │
│ └──────────────────────┘ │
├──────────────────────────┤
│[Home][Scan][Hist][Log][+]│
└──────────────────────────┘
```

#### Desktop (>= 1024px)

```
┌────────┬─────────────────────────────────────────────┐
│        │                                             │
│  LOGO  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐ │
│        │  │  147   │ │   3    │ │  1203  │ │ 2.4  │ │
│ ────── │  │ Scans  │ │Devices │ │ Pages  │ │  GB  │ │
│ Home   │  └────────┘ └────────┘ └────────┘ └──────┘ │
│ Scan   │                                             │
│ Hist   │  ┌─────────────────┐ ┌────────────────────┐ │
│ Logs   │  │ Recent Activity │ │  Devices Online    │ │
│ Devices│  │                 │ │                    │ │
│ Config │  │ a1b2c3d4 OK 2s │ │ [ON] Scanner Bureau│ │
│ About  │  │ e5f6g7h8 .. 5m │ │ [ON] Scanner Cuisi.│ │
│        │  │ i9j0k1l2 OK 1h │ │ [OFF]Scanner Entree│ │
│        │  └─────────────────┘ └────────────────────┘ │
└────────┴─────────────────────────────────────────────┘
```

### Page 2: Scanner (Web Camera)

#### Mobile (< 768px) — Full Screen

```
┌──────────────────────────┐
│                 [2] [cam]│  <- Page count + switch cam
│                          │
│                          │
│     [ Live Camera        │
│       Preview            │
│       Full Screen ]      │
│                          │
│                          │
│              [flash]     │  <- Flash/torch toggle
│                          │
│  ┌─┐ ┌─┐                │
│  │1│ │2│                 │  <- Page pile (horiz scroll)
│  └─┘ └─┘                │
│                          │
│ [Clear]  ( O )  [Send]  │  <- Capture button centered
└──────────────────────────┘
```

#### Desktop (>= 1024px)

```
┌────────┬──────────────────────┬──────────────┐
│        │                      │  Controls    │
│  NAV   │   ┌──────────────┐   │              │
│        │   │              │   │ Resolution v │
│        │   │  Camera      │   │ Timer: 0s  v │
│        │   │  Preview     │   │ Flash: ON  v │
│        │   │  (16:9)      │   │ Grid:  ON  v │
│        │   │              │   │              │
│        │   └──────────────┘   │ Profile:   v │
│        │                      │ Document Std │
│        │   Page Pile:         │              │
│        │   [1][2][3][+]       │ [Clear]      │
│        │                      │ [  Send  ]   │
└────────┴──────────────────────┴──────────────┘
```

### Page 3: Scanner (File Upload)

#### Mobile (< 768px)

```
┌──────────────────────────┐
│  Upload          [X]     │
├──────────────────────────┤
│ ┌──────────────────────┐ │
│ │                      │ │
│ │   Drag files here    │ │
│ │   or tap to browse   │ │
│ │                      │ │
│ │  [Select Files]      │ │
│ │  [Take Photo]        │ │
│ └──────────────────────┘ │
│                          │
│ ┌────┐ ┌────┐ ┌────┐    │
│ │ 1 x│ │ 2 x│ │ 3 x│   │  <- Thumbnails grid
│ │    │ │    │ │    │    │
│ └────┘ └────┘ └────┘    │
│ ┌────┐ ┌────┐           │
│ │ 4 x│ │ 5!x│ <- error  │
│ └────┘ └────┘           │
│                          │
│ Profile: [Document Std v]│
│ [  Send 4 pages  ]      │
├──────────────────────────┤
│[Home][Scan][Hist][Log][+]│
└──────────────────────────┘
```

### Page 4: Batch Detail

#### Mobile (< 768px)

```
┌──────────────────────────┐
│  <- Batch a1b2c3d4       │
├──────────────────────────┤
│ Status: Completed        │
│ Device: Scanner Bureau   │
│ Pages: 3 - 1.2 MB       │
│ Profile: Document Std    │
│ Duration: 4.2s           │
│ Created: 2025-02-23 14:30│
├──────────────────────────┤
│ Pages                    │
│ ┌──────────────────────┐ │
│ │  Page 1              │ │
│ │ [Original][Processed]│ │  <- Toggle buttons
│ │  ┌──────────────────┐│ │
│ │  │                  ││ │
│ │  │  Image preview   ││ │
│ │  │  (pinch to zoom) ││ │
│ │  │                  ││ │
│ │  └──────────────────┘│ │
│ └──────────────────────┘ │
│ [Page 1] [Page 2] [Pg 3]│
├──────────────────────────┤
│ [Reprocess][Export][Del] │
├──────────────────────────┤
│[Home][Scan][Hist][Log][+]│
└──────────────────────────┘
```

#### Desktop (>= 1024px)

```
┌────────┬──────────────────────────────────────┐
│        │  Batch a1b2c3d4  [Reprocess][Export] │
│  NAV   │                                      │
│        │  Status: OK    Device: Scanner Bureau │
│        │  Pages: 3     Duration: 4.2s          │
│        │                                       │
│        │  ┌─────────────┬─────────────┐        │
│        │  │  Original   │  Processed  │        │
│        │  │             │             │        │
│        │  │  [Image]    │  [Image]    │        │
│        │  │             │             │        │
│        │  └─────────────┴─────────────┘        │
│        │  <- Page 1/3 ->   [Zoom: 100%]        │
└────────┴───────────────────────────────────────┘
```

### Page 5: History

#### Mobile (< 768px)

```
┌──────────────────────────┐
│  History        [Filter] │
├──────────────────────────┤
│ Search...                │
│ 147 scans - 1203 pages   │
├──────────────────────────┤
│ [ ] ┌──────────────────┐ │
│     │ a1b2c3d4   OK    │ │
│     │ Scanner Bureau    │ │
│     │ 3 pages - 1.2 MB │ │
│     │ Feb 23, 14:30     │ │
│     └──────────────────┘ │
│ [ ] ┌──────────────────┐ │
│     │ e5f6g7h8   ERR   │ │
│     │ Web Camera        │ │
│     │ 1 page - 0.3 MB  │ │
│     │ Feb 23, 14:25     │ │
│     └──────────────────┘ │
│        ...more...        │
│     [Load more v]        │
├──────────────────────────┤
│ [Selected: 0] [Actions v]│
├──────────────────────────┤
│[Home][Scan][Hist][Log][+]│
└──────────────────────────┘
```

### Page 6: Logs

#### Mobile (< 768px)

```
┌──────────────────────────┐
│  Logs   [Live] [Export]  │
├──────────────────────────┤
│ Level: [ALL v]           │
│ Category: [ALL v]        │
│ Search...                │
├──────────────────────────┤
│ 14:30:01.123 INFO  proc  │
│  Page 1 deskew done      │
│                          │
│ 14:30:01.045 INFO  proc  │
│  Page 1 auto-crop done   │
│                          │
│ 14:30:00.892 INFO  capt  │
│  Batch a1b2 created      │
│                          │
│ 14:29:58.100 ERROR stor  │
│  Paperless unreachable   │
│  timeout after 5000ms    │
│                          │
│        ...auto-scroll... │
├──────────────────────────┤
│[Home][Scan][Hist][Log][+]│
└──────────────────────────┘
```

### Page 7: Devices

#### Mobile (< 768px)

```
┌──────────────────────────┐
│  Devices                 │
├──────────────────────────┤
│ ┌──────────────────────┐ │
│ │ [ON]  Scanner Bureau │ │
│ │ AA:BB:CC:DD:EE:FF    │ │
│ │ IP: 192.168.1.50     │ │
│ │ FW: 1.0.0 - UXGA    │ │
│ │ 45 scans - 2m ago    │ │
│ │ [Configure] [Rename] │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ [OFF] Scanner Entree │ │
│ │ 11:22:33:44:55:66    │ │
│ │ Last seen: 15m ago   │ │
│ │ [Configure] [Rename] │ │
│ └──────────────────────┘ │
├──────────────────────────┤
│[Home][Scan][Hist][Log][+]│
└──────────────────────────┘
```

### Page 8: Settings

#### Mobile (< 768px)

```
┌──────────────────────────┐
│  Settings                │
├──────────────────────────┤
│ [General][Capture][Proc] │
│ [Storage][Notif][Logs]   │
│ [System]                 │
├──────────────────────────┤
│ v General                │
│                          │
│ App Name: [ESPScanCam  ] │
│ Theme:    [Auto       v] │
│ Language: [English    v] │
│                          │
│ [Save]  [Reset Defaults] │
├──────────────────────────┤
│[Home][Scan][Hist][Log][+]│
└──────────────────────────┘
```

---

## Responsive Design Requirements

### Breakpoints

| Breakpoint | Width | Navigation | Layout | Key Behaviors |
|------------|-------|------------|--------|---------------|
| Mobile | < 768px | Fixed bottom tab bar | Single column, full-width | Pinch zoom, swipe compare, full-screen scanner |
| Tablet | 768px-1023px | Collapsible sidebar | 2-3 column grids | Sidebar toggle, split views |
| Desktop | >= 1024px | Fixed sidebar | Multi-column | Side-by-side compare, keyboard shortcuts |

### Mandatory Viewports for Testing

| Viewport | Device | Priority |
|----------|--------|----------|
| 375x667 | iPhone SE | CRITICAL |
| 390x844 | iPhone 15 | CRITICAL |
| 768x1024 | iPad | HIGH |
| 1024x768 | iPad Landscape | HIGH |
| 1440x900 | Desktop | STANDARD |
| 1920x1080 | Full HD Desktop | STANDARD |

### Mobile-Specific Rules

- All tap targets: minimum 44x44px
- No horizontal scrolling (except intentional carousels)
- No double-tap zoom conflicts with interactive elements
- `viewport` meta tag with `user-scalable=no` on scanner page only
- Bottom tab bar always visible (not hidden by virtual keyboard)
- Touch interactions: 60fps animations, no jank

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A non-technical user (Famille persona) can scan and submit a
  3-page document from their smartphone in under 45 seconds from opening the
  app.
- **SC-002**: An ESP32-CAM device scanning 5 pages creates a completed batch
  in the dashboard within 30 seconds of pressing SEND.
- **SC-003**: Processing a single UXGA page completes in under 5 seconds on a
  system with 4 CPU cores and 8GB RAM.
- **SC-004**: The dashboard loads in under 2 seconds on first visit (no cache).
- **SC-005**: History page displays and paginates 1000+ scans with filter
  response under 500ms.
- **SC-006**: A log entry created on the backend appears in the real-time
  frontend view within 500ms.
- **SC-007**: Full-text search across 100,000 log entries returns results in
  under 1 second.
- **SC-008**: WebSocket reconnects automatically within 5 seconds of a
  disconnect.
- **SC-009**: Export to Paperless-NGX completes in under 10 seconds for a
  5-page PDF.
- **SC-010**: Storage backend connection test responds in under 5 seconds.
- **SC-011**: Every page of the web interface is fully functional at 375px
  viewport width.
- **SC-012**: All three personas can complete their primary task without
  external assistance or documentation.
- **SC-013**: Zero silent errors — every system error is visible in at least
  one of: toast notification, log entry, or batch status update.
- **SC-014**: Docker image size is under 500MB.
- **SC-015**: System operates fully in air-gapped mode (no internet required)
  when cloud storage backends are not configured.

---

## Technical Architecture

### 3-Layer Architecture

```
CAPTURE LAYER                   BACKEND LAYER                    FRONTEND LAYER
+--------------+                +--------------------+           +-------------+
| ESP32-CAM xN |--HTTP POST-->  | FastAPI (Python)   |--static-->| React 18    |
| Web Camera   |--HTTP POST-->  | OpenCV Pipeline    |  files    | SPA         |
| File Upload  |--HTTP POST-->  | SQLite WAL         |<---WS---> | WebSocket   |
+--------------+                | Storage Backends   |           +-------------+
                                +--------------------+
                                        |
                                   /data volume
                                  (DB, config, images)
```

### Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Backend | Python 3.11+, FastAPI, uvicorn | Async support, OpenCV bindings, auto OpenAPI docs |
| Processing | OpenCV headless, Pillow | Industry standard, headless = small Docker image |
| Database | SQLite WAL mode | Zero-config, WAL enables concurrent reads during writes |
| Frontend | React 18 | Component model, hooks, served as static build |
| Real-time | WebSocket (native browser API) | No Socket.IO overhead, low latency |
| Camera | MediaDevices API | Native browser, no plugins, HTTPS-enforced |
| Firmware | Arduino C++ (ESP32-CAM) | Official framework, stable WiFi + camera libs |
| Container | Docker multi-stage, multi-arch | Stage 1: build frontend, Stage 2: Python runtime |

### Deployment

- Single Docker container, port 8400 (configurable)
- Volume `/data`: database, config.json, scans/, processed/
- Multi-arch: linux/amd64 + linux/arm64
- Compatible: Unraid, Proxmox, Docker Compose, Portainer

---

## Data Model

### Table `devices`

| Column | Type | Description |
|--------|------|-------------|
| mac | TEXT PK | MAC address (unique identifier) |
| name | TEXT | User-assigned friendly name |
| ip | TEXT NOT NULL | Last known IP address |
| firmware | TEXT | Firmware version string |
| max_pages | INTEGER DEFAULT 10 | Max pages per batch |
| resolution | TEXT DEFAULT 'UXGA' | Camera resolution |
| config | TEXT DEFAULT '{}' | JSON: device-specific config |
| total_scans | INTEGER DEFAULT 0 | Lifetime scan counter |
| last_seen | TEXT NOT NULL | ISO 8601 last heartbeat |
| created_at | TEXT NOT NULL | ISO 8601 first registration |

### Table `batches`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | Short UUID (8 chars) |
| device_mac | TEXT | Source device or "web-camera"/"file-upload" |
| source_type | TEXT NOT NULL | "esp32cam", "web_camera", "file_upload" |
| page_count | INTEGER DEFAULT 0 | Number of pages |
| status | TEXT NOT NULL DEFAULT 'pending' | pending/uploading/processing/completed/error/export_failed |
| error | TEXT | Error message if status is error |
| profile | TEXT DEFAULT 'default' | Processing profile name |
| export_info | TEXT DEFAULT '{}' | JSON: per-backend export results |
| file_size | INTEGER DEFAULT 0 | Total file size (bytes) |
| processing_duration_ms | INTEGER DEFAULT 0 | Total processing time |
| created_at | TEXT NOT NULL | ISO 8601 |
| updated_at | TEXT NOT NULL | ISO 8601 |

### Table `pages`

| Column | Type | Description |
|--------|------|-------------|
| batch_id | TEXT | FK to batches.id ON DELETE CASCADE |
| page_index | INTEGER | 0-based page order |
| status | TEXT NOT NULL DEFAULT 'pending' | pending/uploaded/processing/processed/error |
| original_path | TEXT NOT NULL | Relative path to original image |
| processed_path | TEXT | Relative path to processed image |
| processing_details | TEXT DEFAULT '{}' | JSON: per-step timing and results |
| file_size_original | INTEGER DEFAULT 0 | Original size (bytes) |
| file_size_processed | INTEGER DEFAULT 0 | Processed size (bytes) |
| created_at | TEXT NOT NULL | ISO 8601 |
| PRIMARY KEY | (batch_id, page_index) | Composite key |

### Table `logs`

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTOINCREMENT | Unique log ID |
| timestamp | INTEGER NOT NULL | Unix timestamp milliseconds |
| level | TEXT NOT NULL | DEBUG/INFO/WARNING/ERROR/CRITICAL |
| category | TEXT NOT NULL | system/capture/processing/storage/api/websocket/device/config |
| source | TEXT NOT NULL | Source module or context |
| device_mac | TEXT | Associated device (nullable) |
| message | TEXT NOT NULL | Human-readable message |
| details | TEXT DEFAULT '{}' | JSON: structured data |

Indexes: timestamp, level, category, device_mac

### Table `profiles`

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID or slug |
| name | TEXT NOT NULL UNIQUE | Display name |
| options | TEXT NOT NULL | JSON: full pipeline config |
| is_default | INTEGER DEFAULT 0 | 1 if default profile |
| created_at | TEXT NOT NULL | ISO 8601 |

---

## API Specification

### Devices

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/device/register | Register/update device |
| POST | /api/device/capture | Notify capture initiated |
| GET | /api/devices | List all devices |
| PUT | /api/devices/{mac} | Update device settings |
| DELETE | /api/devices/{mac} | Unregister device |
| POST | /api/devices/{mac}/config | Push config to device |

### Scans

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/scan/batch | Create new batch |
| POST | /api/scan/upload/{batch_id}/{page_index} | Upload page image |
| POST | /api/scan/process/{batch_id} | Trigger processing |
| POST | /api/scan/web-upload | Combined create + upload (web) |
| GET | /api/scans | List batches (paginated, filterable) |
| GET | /api/scans/{id} | Get batch detail |
| DELETE | /api/scans/{id} | Delete batch + files |
| POST | /api/scans/{id}/reprocess | Reprocess with optional profile |
| POST | /api/scans/{id}/export | Export to storage backends |
| POST | /api/scans/bulk | Bulk action (delete/reprocess/export) |

### Images

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/image/original/{batch_id}/{page} | Serve original |
| GET | /api/image/processed/{batch_id}/{page} | Serve processed |
| GET | /api/export/{batch_id} | Download PDF/ZIP |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/settings | Full configuration |
| PUT | /api/settings | Replace full config |
| PATCH | /api/settings/{section} | Update one section |
| POST | /api/settings/test-storage | Test backend connection |
| GET | /api/settings/profiles | List profiles |
| POST | /api/settings/profiles | Create profile |
| DELETE | /api/settings/profiles/{id} | Delete profile |

### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/logs | Query logs (paginated, filtered) |
| DELETE | /api/logs | Purge logs |
| GET | /api/logs/export | Export as .log or .json |

### Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/stats | Dashboard statistics |

### WebSocket

| Endpoint | Events |
|----------|--------|
| ws://host:port/ws | device_online, device_offline, page_captured, batch_created, page_uploaded, processing_started, processing_page, page_processed, processing_complete, processing_error, exporting, export_complete, export_error, batch_deleted, config_changed, log |

---

## Deployment & Infrastructure

- **Container**: Single Docker image, multi-stage build (Node.js frontend
  build + Python runtime).
- **Architectures**: linux/amd64, linux/arm64.
- **Port**: 8400 (configurable via `ESPSCANCAM_PORT`).
- **Volume**: `/data` — contains database, config, scans, processed images.
- **Image size target**: < 500MB.
- **Health check**: `GET /api/stats` returns 200.
- **Reverse proxy**: Compatible with Nginx, Caddy, Traefik. WebSocket
  passthrough required for `/ws` endpoint.
- **HTTPS**: Required for browser camera access (except localhost). TLS
  terminated at reverse proxy.
- **Unraid**: Community Applications template provided.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| ESPSCANCAM_PORT | 8400 | Listen port |
| ESPSCANCAM_DATA_DIR | /data | Data directory |
| ESPSCANCAM_LOG_LEVEL | INFO | Minimum log level |
| ESPSCANCAM_BASE_PATH | / | URL base path (reverse proxy) |
| TZ | UTC | Timezone |

---

## Security Considerations

- **No built-in authentication**: Access control delegated to reverse proxy
  (Authentik, Authelia, Caddy basic auth). This follows the *arr ecosystem
  convention.
- **Input validation**: All API inputs validated via Pydantic models. File
  uploads checked for MIME type and size. MAC addresses validated. Path
  traversal prevented.
- **No remote code execution**: No user-provided code is ever executed.
- **Credential storage**: Storage backend credentials stored in
  `/data/config.json` (filesystem-level protection via Docker volume
  permissions).
- **SQL injection prevention**: Parameterized queries only.
- **Rate limiting**: Optional on upload endpoints (configurable).
- **Device API key**: Optional shared key for ESP32-CAM endpoints. When enabled,
  validates `X-API-Key` header on `/api/device/*` and `/api/scan/upload/*`
  routes. Key stored in config.json, configurable via Settings > System.

---

## Testing Strategy

### Backend (Python — pytest)

- Unit tests: processing pipeline (each step with known input/output), storage
  backends (mocked), database operations, configuration handling.
- API tests: every endpoint with success, validation error, and not-found
  cases using FastAPI TestClient.

### Frontend (Responsive — Playwright)

- Multi-viewport tests at: 375px, 768px, 1024px, 1440px.
- Key user journeys: camera scan flow, file upload flow, history browsing,
  settings modification.

### ESP32-CAM (Integration)

- Registration sequence with mock server.
- Full capture-upload-process cycle.
- Error recovery (WiFi disconnect, server down).
- LED state verification.

### End-to-End

- Complete flow: web camera capture -> processing -> export to mock
  Paperless-NGX -> verify in history.

---

## Milestones & Roadmap

| Version | Name | Scope |
|---------|------|-------|
| v0.1 | MVP | Backend API + basic pipeline + Frontend (dashboard, upload, basic history) + Docker |
| v0.2 | ESP32-CAM | Firmware + device registration + upload + LED feedback |
| v0.3 | Web Scanner | Browser camera capture (mobile full-screen + desktop) |
| v0.4 | Storage | Paperless-NGX + WebDAV + Google Drive + SMB backends |
| v0.5 | Settings & Logs | Complete settings UI + processing profiles + log system |
| v0.6 | Polish | Full responsive pass, bulk actions, history export, notifications, basic PWA (manifest, icons, service worker) |
| v1.0 | Release | Tests, documentation, Unraid template, multi-arch Docker images |

---

## Open Questions (All Resolved)

1. **OCR Integration**: **RESOLVED** — Out of scope. No Tesseract integration.
   Paperless-NGX already provides OCR on ingested documents. ESPScanCam focuses
   exclusively on capture, image processing, and export. This keeps the Docker
   image under 500MB.

2. **PWA Support**: **RESOLVED** — Yes, basic PWA. Includes manifest.json, app
   icons, splash screen, and a service worker for app shell caching (static
   assets only). No offline data sync. Users can install ESPScanCam on their
   phone home screen for a native-like experience. Planned for v0.6 milestone.

3. **Multi-User Support**: **RESOLVED** — Shared model. No user isolation, no
   built-in authentication. All scans are visible to all users. Consistent with
   the *arr ecosystem single-instance convention. Auth delegated to reverse proxy.

4. **API Key for ESP32-CAM**: **RESOLVED** — Optional shared API key. A single
   key is configurable in Settings > System. When enabled, ESP32-CAM devices
   MUST send it as `X-API-Key` header on all requests. Disabled by default
   (zero-config start). When enabled, requests without valid key receive 403.

5. **Barcode/QR Detection**: **RESOLVED** — Out of scope. Not planned for any
   milestone. Document classification and routing are handled by Paperless-NGX
   matching rules after export. ESPScanCam stays focused on capture and image
   processing.

---

## Clarifications

### Session 2026-02-23

- Q: Should scans be isolated per user (private batches) or shared? → A: Shared — no user isolation, all scans visible to everyone (household model). No built-in auth, consistent with *arr ecosystem convention.
- Q: Should the API require a key for ESP32-CAM device registration and uploads? → A: Optional shared API key, configured in Settings > System, sent as `X-API-Key` header. Disabled by default for zero-config start. When enabled, devices without the key are rejected with 403.
- Q: Should Tesseract OCR be integrated for searchable PDFs? → A: No. OCR is explicitly out of scope. Paperless-NGX already handles OCR on ingested documents. ESPScanCam focuses on capture, image processing, and export. This keeps the Docker image lean.
- Q: Should the frontend be a Progressive Web App? → A: Yes, basic PWA. Installable on home screen with app icon and splash screen. App shell caching via service worker (static assets only). No offline data sync — requires network to scan/upload. Included in v0.6 (Polish) milestone.
- Q: Should the system detect barcodes/QR codes for automatic routing or tagging? → A: Out of scope. Not planned for any milestone. Users can rely on Paperless-NGX matching rules for automatic document classification after export.

---

## Assumptions

- The homelab server has at least 4 CPU cores and 8GB RAM for processing.
- The local network provides WiFi coverage for all ESP32-CAM locations.
- Users accessing the web camera scanner have HTTPS configured (via reverse
  proxy) or use localhost for development.
- The Docker volume `/data` has sufficient storage for the expected scan volume
  (approximately 500KB-2MB per processed page).
- Users who need authentication will configure it at the reverse proxy level.
- ESP32-CAM devices use the AI-Thinker module or compatible variants with
  OV2640 camera and 4MB PSRAM.
