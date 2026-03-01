# Satsu Docker Deployment

**Self-hosted document scanning system - Complete deployment guide**

This guide covers Docker deployment of Satsu. For Docker Hub overview, see [DOCKERHUB.md](DOCKERHUB.md).

---

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Download docker-compose.yml
curl -o docker-compose.yml https://raw.githubusercontent.com/sharkhunterr/satsu/main/docker/docker-compose.yml

# Start Satsu
docker compose up -d

# View logs
docker compose logs -f satsu
```

**Access**: http://localhost:8400

### Option 2: Docker Run

```bash
docker run -d \
  --name satsu \
  -p 8400:8400 \
  -v satsu-data:/data \
  -e TZ=Europe/Paris \
  --restart unless-stopped \
  sharkhunterr/satsu:latest
```

---

## What's in the Image

The unified Satsu image includes:

| Component | Description | Port |
|-----------|-------------|------|
| **Web UI** | React frontend (served by FastAPI) | 8400 |
| **API** | FastAPI backend + OpenCV pipeline | 8400 |
| **Database** | SQLite WAL mode | - |

**Platforms**: `linux/amd64`, `linux/arm64`

---

## Configuration

### Docker Compose Example

```yaml
services:
  satsu:
    image: sharkhunterr/satsu:latest
    container_name: satsu
    hostname: satsu
    ports:
      - "8400:8400"
    volumes:
      - satsu-data:/data
    environment:
      - SATSU_LOG_LEVEL=INFO
      - TZ=Europe/Paris
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8400/api/stats"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

volumes:
  satsu-data:
    driver: local
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SATSU_DATA_DIR` | `/data` | Persistent data directory |
| `SATSU_PORT` | `8400` | Server port |
| `SATSU_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `TZ` | `UTC` | Container timezone |

---

## Backup & Restore

### Via Web UI

1. **Settings > Backup** tab
2. Click **Export** to download JSON
3. Import on another instance

### Via Volume

```bash
# Backup
docker run --rm \
  -v satsu-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/satsu-$(date +%Y%m%d).tar.gz -C /data .

# Restore
docker run --rm \
  -v satsu-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/satsu-YYYYMMDD.tar.gz"
```

---

## Updates

```bash
# Pull latest image
docker compose pull

# Recreate container
docker compose up -d

# Clean old images
docker image prune -f
```

### Version Pinning

```yaml
services:
  satsu:
    image: sharkhunterr/satsu:v1.0.0  # Pin to specific version
```

---

## Troubleshooting

### Container Won't Start

Check logs: `docker compose logs satsu`

Common issues:
- Port conflict: Change ports in compose file
- Permission: `chmod -R 755 ./data`
- Database locked: Stop all instances

### Services Can't Connect

**Mac/Windows**: Use `host.docker.internal` instead of `localhost`

**Linux**: Use your machine's IP (not `localhost`)

Test: `docker compose exec satsu curl -I http://localhost:8400/api/stats`

---

## Resources

- **Docker Hub**: https://hub.docker.com/r/sharkhunterr/satsu
- **GitHub**: https://github.com/sharkhunterr/satsu

---

**Built with [Claude Code](https://claude.ai/code) for the self-hosting community**
