# Satsu - Self-hosted Document Scanner

[![GitHub](https://img.shields.io/github/v/tag/sharkhunterr/satsu?label=version&color=blue)](https://github.com/sharkhunterr/satsu/releases)
[![Docker Pulls](https://img.shields.io/docker/pulls/sharkhunterr/satsu?color=2496ED)](https://hub.docker.com/r/sharkhunterr/satsu)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/sharkhunterr/satsu/blob/main/LICENSE)

**Self-hosted document scanning system** — Turn an ESP32-CAM module or any phone/tablet into a dedicated scanner with an 8-step OpenCV processing pipeline and 5 storage backends.

---

## Quick Start

```yaml
services:
  satsu:
    image: sharkhunterr/satsu:latest
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

**Access**: http://localhost:8400

---

## Features

**Multi-Source Capture**
- **ESP32-CAM** — Physical button, auto-upload
- **Scanning Station** — Phone/tablet as kiosk scanner
- **Web Upload** — Drag & drop from browser

**8-Step Processing Pipeline**
- Auto-crop & perspective correction
- Deskew, denoise, sharpen
- CLAHE contrast, white balance
- Color / Grayscale / B&W modes

**5 Storage Backends**
- **Paperless-ngx** — Direct API upload
- **WebDAV** — Nextcloud, etc.
- **Google Drive** — Service account
- **SMB/CIFS** — Network shares
- **Local** — Filesystem copy

**Modern Web UI**
- Mobile-first responsive design
- Dark theme, real-time WebSocket updates
- Processing profiles, scan history
- Interactive crop editor

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SATSU_DATA_DIR` | `/data` | Persistent data directory |
| `SATSU_PORT` | `8400` | Server port |
| `SATSU_LOG_LEVEL` | `INFO` | Log level |
| `TZ` | `UTC` | Container timezone |

### Volumes

| Path | Content |
|------|---------|
| `/data/satsu.db` | SQLite database |
| `/data/config.json` | Settings and credentials |
| `/data/scans/` | Raw uploads and processed outputs |
| `/data/exports/` | Generated PDFs |

---

## Available Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest stable release |
| `v1.x.x` | Specific version |

```bash
docker pull sharkhunterr/satsu:latest
```

---

## Update

```bash
docker compose pull
docker compose up -d
docker image prune -f
```

---

## Tech Stack

| Layer | Technologies |
|-------|--------------|
| Backend | Python 3.11, FastAPI, OpenCV, Pillow |
| Frontend | React 18, Vite, CSS Custom Properties |
| Data | SQLite WAL, WebSocket |

**Platforms**: `linux/amd64`, `linux/arm64`

---

## Links

- [Documentation](https://github.com/sharkhunterr/satsu#readme)
- [Report Issues](https://github.com/sharkhunterr/satsu/issues)
- [Star on GitHub](https://github.com/sharkhunterr/satsu)

---

## License

MIT License - [LICENSE](https://github.com/sharkhunterr/satsu/blob/main/LICENSE)

---

<div align="center">

**Built with [Claude Code](https://claude.ai/code) for the self-hosting community**

</div>
