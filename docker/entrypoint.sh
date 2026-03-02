#!/bin/sh
# Satsu Docker entrypoint
# Supports configurable port and optional HTTPS with auto-generated certificates

PORT="${SATSU_PORT:-8400}"

# Build uvicorn command
CMD="uvicorn main:app --host 0.0.0.0 --port ${PORT}"

# HTTPS support
if [ "${SATSU_HTTPS}" = "true" ]; then
  SSL_CERT="${SATSU_SSL_CERT:-/data/certs/cert.pem}"
  SSL_KEY="${SATSU_SSL_KEY:-/data/certs/key.pem}"

  # Auto-generate self-signed certificate if none provided
  if [ ! -f "$SSL_CERT" ] || [ ! -f "$SSL_KEY" ]; then
    echo "Satsu: No SSL certificates found, generating self-signed certificate..."
    mkdir -p "$(dirname "$SSL_CERT")" "$(dirname "$SSL_KEY")"
    if openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "$SSL_KEY" \
      -out "$SSL_CERT" \
      -days 365 \
      -subj "/CN=satsu/O=Satsu Self-Signed"; then
      echo "Satsu: Self-signed certificate generated (valid 365 days)"
    else
      echo "Satsu: ERROR - Failed to generate certificate, falling back to HTTP"
      exec $CMD
    fi
  fi

  echo "Satsu: HTTPS enabled on port ${PORT}"
  CMD="${CMD} --ssl-certfile=${SSL_CERT} --ssl-keyfile=${SSL_KEY}"
else
  echo "Satsu: HTTP on port ${PORT}"
fi

exec $CMD
