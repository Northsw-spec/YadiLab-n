#!/usr/bin/env bash
# GRAPHML-P2C Parrot-only REAL Chromium acceptance against an attested YadiLab distribution.
# Never installs or changes OS packages. BLOCKED=77 for missing local prerequisites.
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DIST=${YADILAB_ACCEPTANCE_DIST:-"$ROOT/distribution/linux-x86_64"}
PORT=${YADILAB_GRAPHML_PORT:-18977}
EVIDENCE=${YADILAB_GRAPHML_EVIDENCE_DIR:-"$ROOT/graphml-parrot-acceptance-evidence"}
PYTHON=${YADILAB_GRAPHML_PYTHON:-python3}
SERVER_PID=""
TMPDIR_LOG=$(mktemp -d)
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMPDIR_LOG"
}
trap cleanup EXIT INT TERM
blocked() { printf 'BLOCKED GRAPHML-P2C Parrot: %s\n' "$*" >&2; exit 77; }
failed() { printf 'FAIL GRAPHML-P2C Parrot: %s\n' "$*" >&2; exit 1; }

[ -r /etc/os-release ] || blocked "OS_ID_UNAVAILABLE"
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}:${PRETTY_NAME:-}" in
  parrot:*|parrotsec:*|debian:*Parrot*) ;;
  *) blocked "TARGET_IS_NOT_PARROT id=${ID:-unknown}" ;;
esac
[ "$(uname -m)" = "x86_64" ] || blocked "ARCH_NOT_X86_64"
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] && [ "$PORT" -le 65535 ] || blocked "INVALID_PORT"
for program in curl sha256sum "$PYTHON"; do command -v "$program" >/dev/null 2>&1 || blocked "MISSING_TOOL=$program"; done
[ -x "$DIST/app-launcher" ] || blocked "VERIFIED_DISTRIBUTION_NOT_FOUND"
[ -f "$DIST/SHA256SUMS.txt" ] || blocked "DISTRIBUTION_CHECKSUM_FILE_MISSING"
(cd "$DIST" && sha256sum -c SHA256SUMS.txt >/dev/null) || failed "DISTRIBUTION_CHECKSUM_MISMATCH"
[ -f "$ROOT/tests/acceptance/run_graphml_p2c_real_browser.py" ] || blocked "GRAPHML_REAL_BROWSER_TEST_MISSING"

"$PYTHON" -c 'from playwright.sync_api import sync_playwright' >/dev/null 2>&1 || blocked "PYTHON_PLAYWRIGHT_MISSING; install in a separate user-controlled venv"
# Do not misclassify missing Chromium runtime as application FAIL.
if ! "$PYTHON" - <<'PYCHECK' >/dev/null 2>&1
from playwright.sync_api import sync_playwright
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
    browser.close()
PYCHECK
then
  blocked "PLAYWRIGHT_CHROMIUM_UNAVAILABLE; prepare browser independently"
fi

# The attested binary only binds to loopback; never expose a listening server.
"$DIST/app-launcher" --port "$PORT" >"$TMPDIR_LOG/launcher.log" 2>&1 &
SERVER_PID=$!
ready=0
for _ in $(seq 1 100); do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then failed "YADILAB_LAUNCHER_EXITED_EARLY"; fi
  if curl --fail --silent "http://127.0.0.1:$PORT/browser-build-manifest.json" >"$TMPDIR_LOG/manifest.json"; then
    if "$PYTHON" -c 'import json,sys; assert json.load(open(sys.argv[1])).get("status")=="ready"' "$TMPDIR_LOG/manifest.json" >/dev/null 2>&1; then
      ready=1; break
    fi
  fi
  sleep 0.1
done
[ "$ready" = 1 ] || failed "NO_READY_ATTESTED_BROWSER_RELEASE"
mkdir -p "$EVIDENCE"
"$PYTHON" "$ROOT/tests/acceptance/run_graphml_p2c_real_browser.py" \
  --url "http://127.0.0.1:$PORT/" --evidence-dir "$EVIDENCE" || failed "REAL_BROWSER_GRAPHML_ACCEPTANCE_FAILED"
printf 'PASS GRAPHML-P2C Parrot real Chromium acceptance; report=%s\n' "$EVIDENCE/graphml-p2c-real-browser-acceptance.json"
