# GitHub Releases - Satsu

> Release notes for GitHub releases

---

# v0.1.7

## Satsu v0.1.7 - Initial Release

The first public release of Satsu, a self-hosted document scanning system that turns an ESP32-CAM module or any phone/tablet into a dedicated scanner.

### What's New

**Multi-Source Capture**
- **ESP32-CAM** — Physical button, auto-upload via WiFi
- **Scanning Station** — Phone/tablet as kiosk scanner with remote control
- **Web Upload** — Drag & drop from browser

**8-Step Processing Pipeline**
- Auto-crop & perspective correction
- Deskew (rotation fix)
- Denoise & sharpen
- CLAHE contrast enhancement
- White balance normalization
- Color / Grayscale / B&W modes

**5 Storage Backends**
- **Paperless-ngx** — Direct API upload
- **WebDAV** — Nextcloud, etc.
- **Google Drive** — Service account
- **SMB/CIFS** — Network shares
- **Local** — Filesystem copy

**Scanning Station (Kiosk Mode)**
- Open `/station` on a phone — it becomes a dedicated scanner
- Remote control from the Devices page: capture, torch, switch camera, send
- Crop zone calibration — set once, apply to all subsequent scans
- Batch accumulation — capture multiple pages, send as multi-page PDF

**Modern Web UI**
- Mobile-first responsive (375px+)
- Dark theme with real-time WebSocket updates
- Processing profiles — save and reuse parameter presets
- Scan history with search, pagination, bulk actions
- Interactive crop editor with drag-and-drop corners

**ESP32-CAM Firmware**
- One-click web flashing from the browser (no toolchain needed)
- Non-blocking architecture (millis-based)
- LED feedback patterns for status indication

### Docker Quick Start

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

volumes:
  satsu-data:
```

### Links

- [Docker Hub](https://hub.docker.com/r/sharkhunterr/satsu)
- [Documentation](https://github.com/sharkhunterr/satsu#readme)
- [Report Issues](https://github.com/sharkhunterr/satsu/issues)

---

# Instructions

1. Go to https://github.com/sharkhunterr/satsu/releases/new
2. **Tag**: Use the version tag
3. **Target**: `main`
4. **Title**: Copy the title from the version section
5. **Description**: Copy everything from `## Satsu` to the end of the section
6. **Publish release**

> The script `npm run release:full` automatically takes the FIRST version section (the one at the top)
