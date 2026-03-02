#!/bin/sh
# Satsu Docker entrypoint
# Supports configurable port and optional HTTPS

PORT="${SATSU_PORT:-8400}"

# Build uvicorn command
CMD="uvicorn main:app --host 0.0.0.0 --port ${PORT}"

# HTTPS support
if [ "${SATSU_HTTPS}" = "true" ]; then
  SSL_CERT="${SATSU_SSL_CERT:-/certs/cert.pem}"
  SSL_KEY="${SATSU_SSL_KEY:-/certs/key.pem}"

  if [ -f "$SSL_CERT" ] && [ -f "$SSL_KEY" ]; then
    echo "Satsu: HTTPS enabled on port ${PORT}"
    CMD="${CMD} --ssl-certfile=${SSL_CERT} --ssl-keyfile=${SSL_KEY}"
  else
    echo "Satsu: WARNING - HTTPS requested but certificates not found:"
    echo "  cert: ${SSL_CERT} ($([ -f "$SSL_CERT" ] && echo 'OK' || echo 'MISSING'))"
    echo "  key:  ${SSL_KEY} ($([ -f "$SSL_KEY" ] && echo 'OK' || echo 'MISSING'))"
    echo "Satsu: Falling back to HTTP on port ${PORT}"
  fi
else
  echo "Satsu: HTTP on port ${PORT}"
fi

exec $CMD
