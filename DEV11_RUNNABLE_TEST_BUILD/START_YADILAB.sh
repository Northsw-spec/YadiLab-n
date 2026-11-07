#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WEB_ROOT="$ROOT_DIR/ui-dist"
PORT=${YADILAB_PORT:-18375}
URL="http://127.0.0.1:${PORT}/"
MARKER="yadilab-v1.8.0-dev.11"
LOG_FILE="${TMPDIR:-/tmp}/yadilab-dev11-${PORT}.log"
SERVER_PID=""

fail() {
  printf 'YadiLab Dev11 kunde inte startas: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || fail "ogiltig port: $PORT"
[[ -d "$WEB_ROOT" ]] || fail "runnable UI saknas: $WEB_ROOT"
[[ -r "$WEB_ROOT/build-marker.json" ]] || fail "build-marker.json saknas"
grep -Fq '"version": "1.8.0-dev.11"' "$WEB_ROOT/build-marker.json" || fail "fel YadiLab-version i build marker"
grep -Fq '"marker": "yadilab-v1.8.0-dev.11"' "$WEB_ROOT/build-marker.json" || fail "fel Dev11-marker"

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WEB_ROOT" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

ready=0
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    fail "lokal HTTP-server avslutades före verifiering; se $LOG_FILE"
  fi
  if curl --silent --fail --max-time 2 "$URL/build-marker.json" | grep -Fq '"marker": "yadilab-v1.8.0-dev.11"'; then
    ready=1
    break
  fi
  sleep .1
done
[[ "$ready" == 1 ]] || fail "loopback-servern svarade inte med Dev11-marker"

printf 'YadiLab v1.8.0-dev.11 runnable test build verifierad på %s\n' "$URL"
printf 'Serverlogg: %s\n' "$LOG_FILE"
if [[ ${YADILAB_TEST_ONCE:-0} == 1 ]]; then
  exit 0
fi

browser=${YADILAB_BROWSER:-}
if [[ -z "$browser" ]]; then
  for candidate in google-chrome chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      browser=$(command -v "$candidate")
      break
    fi
  done
fi
[[ -n "$browser" && -x "$browser" ]] || fail "Google Chrome/Chromium hittades inte; kör med YADILAB_TEST_ONCE=1 för serverkontroll"
"$browser" --new-window "${URL}?dev11=runnable-build" >/dev/null 2>&1 &
printf 'Chromium öppnad. Lämna terminalen öppen medan Dev11 testas; Ctrl-C stoppar servern.\n'
wait "$SERVER_PID"
