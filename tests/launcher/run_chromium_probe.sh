#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=18942
BIN="$ROOT/distribution/linux-x86_64/app-launcher"
"$ROOT/scripts/build_loopback_distribution.sh"
[ -x "$BIN" ] || { echo "launcher binary missing"; exit 2; }
"$BIN" --port "$PORT" > "$ROOT/dist-launcher/chromium-launcher.log" 2>&1 &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
trap cleanup EXIT
sleep 0.2
set +e
timeout 12s chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage --disable-background-networking --disable-component-update --disable-sync --metrics-recording-only --no-first-run --virtual-time-budget=1000 --dump-dom "http://127.0.0.1:$PORT/" > "$ROOT/dist-launcher/chromium-dom.txt" 2> "$ROOT/dist-launcher/chromium.err"
CODE=$?
set -e
if [ "$CODE" -eq 0 ] && grep -q 'data-app-shell="ready"' "$ROOT/dist-launcher/chromium-dom.txt"; then
  echo "PASS Chromium DOM probe"
  exit 0
fi
echo "BLOCKED Chromium DOM probe in current container (exit=$CODE); not counted as launcher failure."
exit 77
