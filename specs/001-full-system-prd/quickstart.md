# Satsu -- Developer Quickstart

This guide helps new contributors get the project running locally for development and testing.

Satsu is a self-hosted document scanning system composed of three layers:

1. **ESP32-CAM firmware** (Arduino C++) -- hardware scanner that captures and uploads images.
2. **Backend** (Python 3.11+, FastAPI, OpenCV headless, SQLite WAL) -- REST API, image processing pipeline, and storage.
3. **Frontend** (React 18, Vite) -- single-page application served by FastAPI in production.

In production the entire stack ships as a single Docker container on port **8400** with a `/data` volume for persistence.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.11+ | Backend runtime |
| Node.js | 20+ | Frontend toolchain |
| Docker | latest | Production builds |
| PlatformIO | latest | ESP32-CAM firmware (optional) |
| Git | latest | Source control |

---

## Repository Structure

```
satsu/
├── esp32cam/          # Arduino firmware (PlatformIO project)
├── backend/           # FastAPI + OpenCV processing pipeline
├── frontend/          # React 18 SPA (Vite)
├── Dockerfile         # Multi-stage production build
├── docker-compose.yml
└── specs/             # Design artifacts and PRDs
```

---

## Development Setup -- Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create the data directory tree
mkdir -p /tmp/satsu-data/{scans,processed,exports}

# Run with development settings
SATSU_DATA_DIR=/tmp/satsu-data \
SATSU_LOG_LEVEL=DEBUG \
uvicorn main:app --reload --host 0.0.0.0 --port 8400
```

The server is now available at `http://localhost:8400`. The `--reload` flag watches for file changes and restarts automatically.

---

## Development Setup -- Frontend

```bash
cd frontend
npm install
npm run dev   # Vite dev server at :5173, API requests proxied to :8400
```

During development Vite proxies API calls to the backend so both servers can run side by side.

---

## Development Setup -- ESP32-CAM (Optional)

Only needed if you are working on the firmware or testing with real hardware.

```bash
cd esp32cam
cp config.example.h config.h
# Edit config.h with your WiFi credentials and backend server URL
pio run --target upload
```

---

## Docker -- Production

### Build and run directly

```bash
# Build the image
docker build -t satsu .

# Run the container
docker run -d \
  --name satsu \
  -p 8400:8400 \
  -v satsu-data:/data \
  -e TZ=Europe/Paris \
  satsu
```

### Using docker-compose

```yaml
services:
  satsu:
    build: .
    ports:
      - "8400:8400"
    volumes:
      - satsu-data:/data
    environment:
      - TZ=Europe/Paris
    restart: unless-stopped

volumes:
  satsu-data:
```

```bash
docker compose up -d
```

---

## Running Tests

```bash
# Backend unit and integration tests
cd backend
pytest tests/ -v

# Frontend end-to-end tests (Playwright)
cd frontend
npx playwright test

# ESP32-CAM firmware tests (PlatformIO)
cd esp32cam
pio test
```

---

## Key URLs (Development)

| URL | Description |
|-----|-------------|
| `http://localhost:5173` | Frontend (Vite dev server) |
| `http://localhost:8400` | Frontend (production / Docker) |
| `http://localhost:8400/api/stats` | API health / stats endpoint |
| `ws://localhost:8400/ws` | WebSocket (real-time scan events) |
| `http://localhost:8400/docs` | Interactive API docs (FastAPI auto-generated) |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SATSU_PORT` | `8400` | HTTP listen port |
| `SATSU_DATA_DIR` | `/data` | Root data directory for DB, scans, and exports |
| `SATSU_LOG_LEVEL` | `INFO` | Minimum log level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `SATSU_BASE_PATH` | `/` | URL base path (useful behind a reverse proxy) |
| `TZ` | `UTC` | Container timezone |

---

## Database

SQLite in WAL mode, stored at `{SATSU_DATA_DIR}/satsu.db`.

The schema auto-migrates on every startup. Key pragmas applied at connection time:

- `journal_mode=WAL` -- concurrent reads during writes.
- `busy_timeout=5000` -- wait up to 5 s on lock contention.
- `foreign_keys=ON` -- enforce referential integrity.

No external database server is required.

---

## Architecture Overview

```
ESP32-CAM / Browser / File Upload
    --> HTTP POST /api/scan/*
        --> Backend (FastAPI)
            --> OpenCV Pipeline (deskew, crop, enhance)
            --> SQLite (metadata)
            --> Filesystem (images)
            --> Storage Backends (export)
        --> WebSocket /ws
            --> Frontend (React 18 SPA)
```

All communication between the ESP32-CAM hardware and the backend happens over HTTP. The frontend receives real-time updates through a WebSocket connection so new scans appear instantly without polling.
