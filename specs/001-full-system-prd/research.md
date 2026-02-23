# Research: ESPScanCam

**Phase 0 output** — All technical decisions resolved.

## R1: OpenCV Headless for Document Processing

**Decision**: Use `opencv-python-headless` (no GUI dependencies).

**Rationale**: The headless variant excludes X11/Qt GUI libraries, reducing
Docker image size by ~200MB. All processing is server-side and non-interactive
— no GUI is ever needed. The processing pipeline (Canny, contours, warpPerspective,
minAreaRect, fastNlMeansDenoising, CLAHE, adaptiveThreshold) is fully available
in the headless build.

**Alternatives considered**:
- `opencv-python` (full): Adds unnecessary GUI deps, larger image.
- `opencv-contrib-python-headless`: Extra modules (SIFT, SURF) not needed.

## R2: SQLite WAL Mode for Concurrent Access

**Decision**: Use SQLite in WAL (Write-Ahead Logging) mode with a single
writer and multiple concurrent readers.

**Rationale**: ESPScanCam has a write pattern of one batch at a time (sequential
page processing) with multiple concurrent reads (WebSocket broadcasting, API
queries, dashboard stats). WAL mode allows reads to proceed without blocking
on writes. Single-file database with zero configuration aligns with the
self-hosted, single-container principle.

**Alternatives considered**:
- PostgreSQL: Overkill for homelab, requires separate container, violates
  single-container principle.
- Redis: In-memory only, no persistence without configuration, not needed.
- JSON file storage: No query capability, no indexing, poor for 1000+ records.

**Implementation notes**:
- Set `PRAGMA journal_mode=WAL` on connection open.
- Set `PRAGMA busy_timeout=5000` for write contention.
- Use `aiosqlite` for async access from FastAPI.
- Single connection pool with max 1 writer, unlimited readers.

## R3: FastAPI WebSocket Manager Pattern

**Decision**: Implement a `ConnectionManager` class that maintains a set of
active WebSocket connections and broadcasts events to all.

**Rationale**: FastAPI natively supports WebSocket endpoints. A centralized
manager class handles connection lifecycle (connect, disconnect, broadcast).
No need for Redis pub/sub or external message broker — all connections are
within the same process.

**Implementation pattern**:
```python
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, event: str, data: dict):
        message = {"event": event, "data": data,
                   "timestamp": int(time.time() * 1000)}
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                self.disconnect(connection)
```

**Alternatives considered**:
- Socket.IO (python-socketio): Adds unnecessary abstraction and client-side
  dependency. Native WebSocket is lighter and sufficient.
- Server-Sent Events (SSE): One-directional only, no future client→server
  messages possible.

## R4: React 18 Frontend Build with Vite

**Decision**: Use Vite as the build tool for the React 18 frontend.

**Rationale**: Vite provides fast HMR for development and optimized production
builds. The output is a static `dist/` directory that FastAPI serves directly.
React 18 with hooks provides the component model needed for 8 pages with shared
state (WebSocket context, settings, theme).

**Implementation notes**:
- Vite config with `base: '/'` (configurable for sub-path deployment).
- Output to `frontend/dist/` → copied to Docker image as `/app/static/`.
- FastAPI `StaticFiles` mount serves the SPA with fallback to `index.html`.
- No CSS framework — CSS custom properties for theming, media queries for
  responsive breakpoints.

**Alternatives considered**:
- Create React App: Deprecated, slower builds.
- Next.js: SSR not needed, adds complexity, requires Node.js runtime.
- Svelte/Vue: React has broader ecosystem and is specified in constitution.

## R5: ESP32-CAM Firmware Architecture

**Decision**: Single-file Arduino sketch with helper headers for LED patterns
and button handling. Use PSRAM for frame buffer storage.

**Rationale**: The ESP32-CAM AI-Thinker module has 4MB PSRAM for storing
captured frames. The firmware is simple: boot → WiFi → register → idle loop
(button polling + heartbeat). Arduino framework provides stable esp_camera,
WiFi, and HTTPClient libraries.

**Implementation notes**:
- Camera init with FRAMESIZE_UXGA (1600x1200) default, configurable.
- Single frame buffer (`fb = esp_camera_fb_get()`), upload, then release.
- Upload as raw JPEG body (Content-Type: image/jpeg) — no multipart to
  minimize ESP32 memory usage.
- `X-Device-MAC` header for device identification.
- Optional `X-API-Key` header when shared API key is enabled.
- Heartbeat: POST /api/device/register every 60 seconds.
- Button debounce: 300ms software debounce on GPIO pins.
- LED: Single GPIO output, patterns via non-blocking millis() timing.

**Alternatives considered**:
- ESP-IDF (native): More control but significantly more complex, Arduino
  framework sufficient for this use case.
- MicroPython: Poor camera library support on ESP32-CAM, limited PSRAM access.

## R6: Image Processing Pipeline Design

**Decision**: Sequential pipeline with 8 independent steps, each wrapped in
try/catch for fault tolerance. Pipeline reads original image, applies steps
in order, writes processed image.

**Rationale**: Each step is independently toggleable and parameterized via
the processing profile. Sequential execution is simpler than parallel (steps
may depend on previous output). Try/catch per step ensures a failing step
doesn't lose the entire scan.

**Pipeline steps (in order)**:
1. **Auto-crop**: `cv2.Canny()` → `cv2.findContours()` → largest 4-point
   contour → `cv2.getPerspectiveTransform()` + `cv2.warpPerspective()`.
   Fallback: `cv2.HoughLinesP()` if no suitable contour found.
2. **Deskew**: `cv2.minAreaRect()` on largest contour → rotation angle →
   `cv2.getRotationMatrix2D()` + `cv2.warpAffine()`.
3. **Denoise**: `cv2.fastNlMeansDenoisingColored()` or `cv2.bilateralFilter()`.
4. **Contrast (CLAHE)**: `cv2.createCLAHE()` → apply to L channel of LAB
   color space.
5. **Sharpening**: Unsharp mask via `cv2.GaussianBlur()` + weighted addition.
6. **White balance**: Gray-world algorithm (scale channels to match mean).
7. **B&W conversion**: `cv2.cvtColor()` to grayscale → `cv2.adaptiveThreshold()`
   or `cv2.threshold()` with Otsu.
8. **Output generation**: Pillow `Image.save()` for JPEG/PNG, Pillow PDF
   generation for multi-page PDF.

**Performance target**: < 5s for UXGA (1600x1200) with all steps enabled
on 4-core CPU.

## R7: Storage Backend Interface

**Decision**: Abstract base class with `upload()` and `test_connection()`
methods. Each backend is a concrete implementation.

**Rationale**: The constitution mandates a standard interface for storage
backends. Using async methods allows non-blocking export to multiple backends
simultaneously via `asyncio.gather()`.

**Interface**:
```python
class StorageBackend(ABC):
    @abstractmethod
    async def upload(self, file_path: str, remote_name: str,
                     metadata: dict) -> dict:
        """Returns {"success": bool, "url": str|None, "error": str|None}"""

    @abstractmethod
    async def test_connection(self) -> dict:
        """Returns {"success": bool, "message": str}"""
```

**Backend implementations**:
- `LocalStorage`: `shutil.copy2()` to configured path.
- `PaperlessStorage`: `aiohttp.post()` to `/api/documents/post_document/`.
- `WebDAVStorage`: `aiohttp.put()` with Basic/Digest auth.
- `GoogleDriveStorage`: Google API client with service account JSON.
- `SMBStorage`: `smbprotocol` library for CIFS shares.

## R8: Cursor-Based Pagination

**Decision**: Use cursor-based pagination for scan history and log queries.

**Rationale**: Cursor-based pagination provides consistent results even when
new items are added (unlike offset-based which shifts). The cursor is a
base64-encoded JSON containing the sort field value and ID of the last item.

**Implementation**:
```python
# Encode cursor
cursor = base64.b64encode(json.dumps(
    {"created_at": last_item.created_at, "id": last_item.id}
).encode()).decode()

# Decode and query
WHERE (created_at, id) < (:cursor_date, :cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT :limit
```

**Alternatives considered**:
- Offset pagination: Inconsistent with concurrent inserts, poor performance
  at high offsets.
- Keyset pagination (simple): Only works with unique sort columns.

## R9: PWA Implementation

**Decision**: Basic PWA with manifest.json, app icons, and service worker
for app shell caching only (no offline data sync).

**Rationale**: The Famille persona benefits from installing ESPScanCam on their
phone home screen (native app feel, no browser chrome). Service worker caches
static assets (JS, CSS, HTML) for faster subsequent loads but does NOT cache
API responses or enable offline scanning (network required).

**Implementation**:
- `manifest.json`: name, icons (192px, 512px), theme_color, display: standalone.
- Service worker: Cache-first for static assets, network-first for API calls.
- Register in `index.html` with `navigator.serviceWorker.register()`.
- Planned for v0.6 milestone.

## R10: Docker Multi-Stage Build

**Decision**: Two-stage Dockerfile — Node.js for frontend build, Python slim
for runtime.

**Rationale**: Keeps the final image small (target < 500MB) by not including
Node.js and build tools in the runtime image.

**Dockerfile structure**:
```dockerfile
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./static
EXPOSE 8400
VOLUME /data
USER 1000:1000
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8400/api/stats')"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8400"]
```

**Image size estimation**:
- Python 3.11 slim: ~120MB
- OpenCV headless + deps: ~80MB
- Pillow + aiohttp + other deps: ~30MB
- Frontend static build: ~5MB
- Application code: ~2MB
- **Total**: ~240MB (well under 500MB target)
