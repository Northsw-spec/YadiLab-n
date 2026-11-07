#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SRC_START="$ROOT/start-yadilab.sh"
SRC_DESKTOP="$ROOT/Start-YadiLab.desktop"
SRC_DIST="$ROOT/distribution/linux-x86_64"
[[ -x "$SRC_DIST/app-launcher" ]] || { echo "FAIL dev23 launcher test: distribution missing" >&2; exit 1; }

grep -Fq 'yadilab-v1.8.0-dev.4' "$SRC_START"
grep -Fq 'build-marker.json' "$SRC_START"
grep -Fq '%k' "$SRC_DESKTOP"
grep -Fq 'dirname -- "$desktop"' "$SRC_DESKTOP"
grep -Fq 'stop_stale_port_owner' "$SRC_START"

TMP=$(mktemp -d)
STALE_OTHER_PID=""
STALE_YADILAB_PID=""
cleanup() {
  [[ -z "$STALE_OTHER_PID" ]] || kill "$STALE_OTHER_PID" 2>/dev/null || true
  [[ -z "$STALE_YADILAB_PID" ]] || kill "$STALE_YADILAB_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

TESTROOT="$TMP/Documents & Files/Dan proj/YadiLab dev23"
mkdir -p "$TESTROOT/distribution"
cp "$SRC_START" "$TESTROOT/start-yadilab.sh"
cp "$SRC_DESKTOP" "$TESTROOT/Start-YadiLab.desktop"
cp -a "$SRC_DIST" "$TESTROOT/distribution/linux-x86_64"
chmod +x "$TESTROOT/start-yadilab.sh"

GOOD_PORT=18971
OTHER_PORT=18972
STALE_YADILAB_PORT=18973

# Spaces and ampersand in the actual runtime path are exercised end-to-end.
YADILAB_PORT="$GOOD_PORT" YADILAB_TEST_ONCE=1 "$TESTROOT/start-yadilab.sh"

# An unrelated listener must never be killed just to free YadiLab's port.
python3 -c 'import http.server,sys
class H(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  body=b"not-yadilab"; self.send_response(200); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
 def log_message(self,*args): pass
http.server.ThreadingHTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()' "$OTHER_PORT" &
STALE_OTHER_PID=$!
for _ in $(seq 1 30); do ss -H -ltn "sport = :$OTHER_PORT" | grep -q . && break; sleep .1; done
set +e
YADILAB_PORT="$OTHER_PORT" YADILAB_TEST_ONCE=1 "$TESTROOT/start-yadilab.sh" >"$TMP/unowned.log" 2>&1
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]]
kill -0 "$STALE_OTHER_PID"
grep -Fq 'ägs av annan process och stoppas inte automatiskt' "$TMP/unowned.log"
kill "$STALE_OTHER_PID" 2>/dev/null || true
wait "$STALE_OTHER_PID" 2>/dev/null || true
STALE_OTHER_PID=""

# A stale app-launcher from another unpacked YadiLab copy is safe to replace.
"$TESTROOT/distribution/linux-x86_64/app-launcher" --port "$STALE_YADILAB_PORT" >"$TMP/stale-yadilab.log" 2>&1 &
STALE_YADILAB_PID=$!
for _ in $(seq 1 50); do curl -fsS "http://127.0.0.1:$STALE_YADILAB_PORT/build-marker.json" >/dev/null 2>&1 && break; sleep .1; done
kill -0 "$STALE_YADILAB_PID"
YADILAB_PORT="$STALE_YADILAB_PORT" YADILAB_TEST_ONCE=1 "$TESTROOT/start-yadilab.sh" >"$TMP/replaced.log" 2>&1
if kill -0 "$STALE_YADILAB_PID" 2>/dev/null; then
  echo "FAIL dev23 launcher test: stale app-launcher survived replacement" >&2
  exit 1
fi
STALE_YADILAB_PID=""
grep -Fq 'Stoppar gammal YadiLab app-launcher PID' "$TMP/replaced.log"

echo 'PASS dev23 file-manager launcher: spaces + exact HTTP marker + safe stale YadiLab replacement + unrelated-process protection.'
