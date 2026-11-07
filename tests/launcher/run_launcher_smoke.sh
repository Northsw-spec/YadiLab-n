#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=18941
DIST="$ROOT/distribution/linux-x86_64"
BIN="$DIST/app-launcher"
"$ROOT/scripts/build_loopback_distribution.sh"
env -i PATH=/nonexistent HOME=/tmp "$BIN" --port "$PORT" > "$ROOT/launcher-smoke.log" 2>&1 &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$PORT/" > "$ROOT/launcher-smoke-index.out"; then break; fi
  sleep 0.1
done
if grep -q 'data-app-shell="ready"' "$ROOT/launcher-smoke-index.out"; then
  : # Explicit fallback shell distribution.
elif grep -q 'data-app-runtime="booting"' "$ROOT/launcher-smoke-index.out" &&
     curl -fsS "http://127.0.0.1:$PORT/browser-build-manifest.json" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then
  : # Dependency-resolved bundle; static HTML must not claim runtime readiness.
else
  echo 'FAIL distribution is neither an explicit shell nor a ready full browser bundle'
  exit 1
fi
curl -fsSI "http://127.0.0.1:$PORT/manifest.webmanifest" | grep -qi '^Content-Type: application/manifest+json'
curl -fsSI "http://127.0.0.1:$PORT/" | grep -Eq "^Content-Security-Policy: .*img-src 'self' blob:;.*object-src 'none'"
STATUS=$(curl --path-as-is -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/%2e%2e/app-config/branding.json")
[ "$STATUS" = "400" ]
LOCAL_ADDR=$(ss -H -ltnp "sport = :$PORT" 2>/dev/null | awk '{print $4}' || true)
if [[ -n "$LOCAL_ADDR" ]]; then
  echo "$LOCAL_ADDR" | grep -q '^127.0.0.1:'
  if echo "$LOCAL_ADDR" | grep -q '^0.0.0.0:'; then echo 'FAIL external bind'; exit 1; fi
else
  # Some sandboxed kernels deny the netlink query used by ss. /proc/net/tcp
  # still exposes the authoritative listening address without network access.
  PORT_HEX=$(printf '%04X' "$PORT")
  PROC_ADDR=$(awk -v suffix=":$PORT_HEX" '$2 ~ (suffix "$") && $4 == "0A" { print $2 }' /proc/net/tcp)
  echo "$PROC_ADDR" | grep -q "^0100007F:$PORT_HEX$"
  if echo "$PROC_ADDR" | grep -q "^00000000:$PORT_HEX$"; then echo 'FAIL external bind'; exit 1; fi
fi
curl -fsS "http://127.0.0.1:$PORT/app-shell.js" | grep -q 'serviceWorker'
curl -fsS "http://127.0.0.1:$PORT/sw.js" | grep -q 'PWA_HASH_MISMATCH'
curl -fsS "http://127.0.0.1:$PORT/acceptance.html" | grep -q 'acceptance-probe.js'
curl -fsS "http://127.0.0.1:$PORT/acceptance-probe.js" | grep -q 'indexedDB'
curl -fsS "http://127.0.0.1:$PORT/assets/builtin/network.firewall.svg" | grep -q '<svg'
test -s "$DIST/THIRD_PARTY_NOTICES.md"
test -s "$DIST/third-party-inventory.json"
grep -q 'Inventory status:' "$DIST/THIRD_PARTY_NOTICES.md"
grep -Eq '"status"[[:space:]]*:[[:space:]]*"(declared-direct-baseline|bundle-resolved)"' "$DIST/third-party-inventory.json"
file "$BIN" | grep -q 'ELF 64-bit.*x86-64'
if ldd "$BIN" 2>&1 | grep -q '=>'; then echo 'FAIL launcher unexpectedly dynamically linked'; exit 1; fi
(cd "$DIST" && sha256sum -c SHA256SUMS.txt >/dev/null)
echo 'PASS launcher smoke: loopback-only distribution + trusted built-in assets + path/security + static ELF.'
