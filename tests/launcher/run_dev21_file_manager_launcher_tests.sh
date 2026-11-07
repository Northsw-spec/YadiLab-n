#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
START="$ROOT/start-yadilab.sh"
DESKTOP="$ROOT/Start-YadiLab.desktop"
GOOD_PORT=18961
STALE_PORT=18962
STALE_PID=""

cleanup() {
  if [[ -n "$STALE_PID" ]]; then kill "$STALE_PID" 2>/dev/null || true; wait "$STALE_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT

grep -Fq 'yadilab-v1.1.0-dev.21' "$START"
grep -Fq 'build-marker.json' "$START"
grep -Fq '%k' "$DESKTOP"
grep -Fq 'dirname -- "$desktop"' "$DESKTOP"

# The authoritative checkout path itself contains spaces and an ampersand. A
# successful test-mode launch therefore exercises quoting end to end.
[[ "$ROOT" == *" "* ]]
YADILAB_PORT="$GOOD_PORT" YADILAB_TEST_ONCE=1 "$START"

# A listening process with a plausible but stale marker must never satisfy the
# dev21 start gate, and the launcher must not kill an unowned process.
python3 -c 'import http.server,sys
class H(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  body=b"{\"formatId\":\"yadilab.browser-build-marker\",\"version\":\"1.1.0-dev.20\",\"marker\":\"yadilab-v1.1.0-dev.20\"}"
  self.send_response(200); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
 def log_message(self,*args): pass
http.server.ThreadingHTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()' "$STALE_PORT" &
STALE_PID=$!
for _ in $(seq 1 30); do ss -H -ltn "sport = :$STALE_PORT" | grep -q . && break; sleep .1; done
set +e
YADILAB_PORT="$STALE_PORT" YADILAB_TEST_ONCE=1 "$START" >"$ROOT/launcher-dev21-stale.log" 2>&1
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]]
kill -0 "$STALE_PID"
grep -Fq 'svarar inte med exakt dev21-marker' "$ROOT/launcher-dev21-stale.log"
rm -f "$ROOT/launcher-dev21-stale.log"

echo 'PASS dev21 file-manager launcher: spaces + exact HTTP marker + stale-origin rejection.'
