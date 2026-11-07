#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$ROOT_DIR/ui-dist"
PORT="${YADILAB_PORT:-18370}"
URL="http://127.0.0.1:${PORT}/?dev10=runnable-build"

if [[ ! -f "$WEB_ROOT/build-marker.json" ]]; then
  echo "ERROR: bundled browser build is missing: $WEB_ROOT" >&2
  exit 1
fi
if ! grep -q '1.8.0-dev.10' "$WEB_ROOT/build-marker.json"; then
  echo "ERROR: bundled build is not YadiLab v1.8.0-dev.10" >&2
  exit 1
fi

echo "YadiLab v1.8.0-dev.10 runnable test build"
echo "Serving: $URL"
echo "Press Ctrl-C to stop. Set YADILAB_PORT to use another loopback port."

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WEB_ROOT" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 30); do
  if curl --silent --fail --max-time 1 "http://127.0.0.1:${PORT}/build-marker.json" | grep -q '1.8.0-dev.10'; then
    break
  fi
  sleep 0.1
done

if command -v chromium >/dev/null 2>&1; then
  chromium "$URL" >/dev/null 2>&1 &
elif command -v google-chrome >/dev/null 2>&1; then
  google-chrome "$URL" >/dev/null 2>&1 &
fi

wait "$SERVER_PID"
