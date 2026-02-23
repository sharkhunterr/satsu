# ESPScanCam Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-02-23

## Active Technologies

- **Language**: Python 3.11+ (backend), JavaScript/JSX (React 18 frontend), Arduino C++ (ESP32-CAM firmware)
- **Framework**: FastAPI, uvicorn, OpenCV (headless), Pillow, aiohttp, aiofiles, pydantic v2 (backend); React 18, Vite (frontend); esp_camera, WiFi, HTTPClient, ArduinoJson (firmware)
- **Database**: SQLite WAL mode (`/data/espscancam.db`), filesystem (`/data/scans/`), JSON config (`/data/config.json`)
- **Testing**: pytest + FastAPI TestClient (backend), Playwright multi-viewport (frontend), PlatformIO (firmware)
- **Container**: Docker multi-stage (Node.js build + Python runtime), multi-arch amd64/arm64
- **Real-time**: WebSocket (native browser API, FastAPI WebSocket endpoint)

## Project Structure

```text
espscancam/
├── esp32cam/
│   ├── espscancam.ino           # Main firmware sketch
│   ├── config.example.h         # WiFi + server URL template
│   ├── led.h                    # LED pattern functions
│   └── buttons.h                # Button debounce + handlers
├── backend/
│   ├── main.py                  # FastAPI app, routes, WebSocket, static serving
│   ├── scanner.py               # OpenCV processing pipeline (8 steps)
│   ├── storage.py               # Storage backend implementations (5 backends)
│   ├── database.py              # SQLite WAL connection, migrations, queries
│   ├── logger.py                # Structured logging system
│   ├── models.py                # Pydantic request/response models
│   ├── config.py                # Configuration management (JSON + env vars)
│   ├── requirements.txt         # Python dependencies (pinned)
│   └── tests/
│       ├── test_scanner.py
│       ├── test_storage.py
│       ├── test_api.py
│       ├── test_database.py
│       └── test_config.py
├── frontend/
│   ├── public/
│   │   ├── manifest.json
│   │   └── icons/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── sw.js
│   │   ├── pages/               # Dashboard, Scanner, History, Detail, Logs, Devices, Settings, About
│   │   ├── components/          # layout/, scanner/, history/, detail/, logs/, devices/, settings/, shared/
│   │   ├── hooks/               # useWebSocket, useCamera, useSettings, useLogs
│   │   └── styles/              # variables.css, layout.css, components.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── Dockerfile                   # Multi-stage (Node build + Python runtime)
├── docker-compose.yml
└── specs/                       # Design artifacts (speckit)
```

## Commands

```bash
# Backend development
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
ESPSCANCAM_DATA_DIR=/tmp/espscancam-data uvicorn main:app --reload --host 0.0.0.0 --port 8400

# Frontend development
cd frontend
npm install
npm run dev

# Backend tests
cd backend && pytest tests/ -v

# Frontend tests (Playwright)
cd frontend && npx playwright test

# Docker build
docker build -t espscancam .
docker run -d -p 8400:8400 -v espscancam-data:/data espscancam

# ESP32-CAM firmware (PlatformIO)
cd esp32cam && cp config.example.h config.h && pio run --target upload
```

## Code Style

### Python (Backend)
- Async functions for all I/O (aiosqlite, aiohttp, aiofiles)
- Pydantic v2 models for all request/response validation
- Type hints on all function signatures
- SQLite queries use parameterized statements only (no f-strings)

### JavaScript/JSX (Frontend)
- React 18 functional components with hooks
- CSS custom properties for theming (no CSS framework)
- WebSocket context provider for shared state
- Mobile-first responsive (breakpoints: <768px, 768-1023px, >=1024px)

### Arduino C++ (Firmware)
- Single .ino entry point with helper .h headers
- Non-blocking patterns (millis() based, no delay())
- PSRAM for frame buffer storage
- 300ms software debounce on GPIO

## Constitution

8 Core Principles: Self-Hosted First, Mobile-First Responsive, Multi-Source Capture, Everything Is Configurable, Real-Time by Default, Observable & Auditable, Non-Destructive Processing, Modular Storage.

See `.specify/memory/constitution.md` for full details.

## Recent Changes

- **001-full-system-prd**: Full system PRD — 3-layer architecture (ESP32-CAM + FastAPI + React 18), 5 SQLite tables, 16 WebSocket events, 8-step processing pipeline, 5 storage backends.

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
