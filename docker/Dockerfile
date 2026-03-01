# Multi-stage Dockerfile for Satsu (Backend + Frontend)
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.11-slim

LABEL maintainer="Satsu"
LABEL description="Self-hosted document scanning system"

ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="Satsu" \
      org.opencontainers.image.description="Self-hosted document scanning system" \
      org.opencontainers.image.source="https://github.com/sharkhunterr/satsu"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./static

# Create data directories with correct ownership
RUN mkdir -p /data/scans /data/processed /data/exports && \
    chown -R 1000:1000 /data

# Environment defaults
ENV SATSU_PORT=8400 \
    SATSU_LOG_LEVEL=INFO \
    SATSU_DATA_DIR=/data \
    TZ=UTC

EXPOSE 8400
VOLUME /data

USER 1000:1000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8400/api/stats || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8400"]
