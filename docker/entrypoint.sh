#!/bin/sh
# Satsu Docker entrypoint
# Runs as root to fix permissions, then drops to PUID:PGID via gosu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
PORT="${SATSU_PORT:-8400}"
DATA_DIR="${SATSU_DATA_DIR:-/data}"

# ---- Create data directories and fix ownership (runs as root) ----
echo "Satsu: Setting up data directories (PUID=${PUID}, PGID=${PGID})..."
for dir in scans processed exports certs; do
  mkdir -p "${DATA_DIR}/${dir}"
done
chown -R "${PUID}:${PGID}" "${DATA_DIR}"

# ---- HTTPS: generate self-signed certificate if needed (as root) ----
if [ "${SATSU_HTTPS}" = "true" ]; then
  SSL_CERT="${SATSU_SSL_CERT:-${DATA_DIR}/certs/cert.pem}"
  SSL_KEY="${SATSU_SSL_KEY:-${DATA_DIR}/certs/key.pem}"

  if [ ! -f "$SSL_CERT" ] || [ ! -f "$SSL_KEY" ]; then
    echo "Satsu: No SSL certificates found, generating self-signed certificate..."
    mkdir -p "$(dirname "$SSL_CERT")" "$(dirname "$SSL_KEY")"
    if openssl req -x509 -newkey rsa:2048 -nodes \
      -keyout "$SSL_KEY" \
      -out "$SSL_CERT" \
      -days 365 \
      -subj "/CN=satsu/O=Satsu Self-Signed"; then
      echo "Satsu: Self-signed certificate generated (valid 365 days)"
      chown "${PUID}:${PGID}" "$SSL_CERT" "$SSL_KEY"
    else
      echo "Satsu: ERROR - Failed to generate certificate, falling back to HTTP"
      SATSU_HTTPS=false
    fi
  fi
fi

# ---- Build uvicorn command ----
CMD="uvicorn main:app --host 0.0.0.0 --port ${PORT}"

if [ "${SATSU_HTTPS}" = "true" ]; then
  echo "Satsu: HTTPS enabled on port ${PORT}"
  CMD="${CMD} --ssl-certfile=${SSL_CERT} --ssl-keyfile=${SSL_KEY}"
else
  echo "Satsu: HTTP on port ${PORT}"
fi

# ---- Drop privileges and exec ----
exec gosu "${PUID}:${PGID}" $CMD
