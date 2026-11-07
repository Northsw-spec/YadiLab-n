#!/usr/bin/env bash
set -u -o pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST=${YADILAB_ACCEPTANCE_DIST:-"$ROOT/distribution/linux-x86_64"}
REPORT=${YADILAB_ACCEPTANCE_REPORT:-"$ROOT/parrot-acceptance-report.txt"}
PORT=${YADILAB_ACCEPTANCE_PORT:-18971}
TMP_ROOT=""
LAUNCHER_PID=""
OVERALL="PASS"

mkdir -p "$(dirname "$REPORT")"
: > "$REPORT"

emit() { printf '%s\n' "$*" | tee -a "$REPORT"; }
record_pass() { emit "PASS $1"; }
record_fail() { emit "FAIL $1"; OVERALL="FAIL"; }
record_blocked() { emit "BLOCKED $1"; [ "$OVERALL" = "FAIL" ] || OVERALL="BLOCKED"; }

cleanup() {
  if [ -n "$LAUNCHER_PID" ]; then
    kill "$LAUNCHER_PID" 2>/dev/null || true
    wait "$LAUNCHER_PID" 2>/dev/null || true
  fi
  if [ -n "$TMP_ROOT" ] && [ -d "$TMP_ROOT" ]; then rm -rf "$TMP_ROOT"; fi
}
trap cleanup EXIT INT TERM

emit "YadiLab Parrot acceptance harness"
emit "contract_version=1"
emit "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
emit "uname=$(uname -srmo 2>/dev/null || true)"

OS_ID=""
OS_NAME=""
OS_VERSION=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID=${ID:-}
  OS_NAME=${PRETTY_NAME:-${NAME:-}}
  OS_VERSION=${VERSION_ID:-}
fi
emit "os_id=$OS_ID"
emit "os_name=$OS_NAME"
emit "os_version=$OS_VERSION"
emit "arch=$(uname -m 2>/dev/null || true)"

# Fail closed: a non-Parrot host can validate the harness but can never produce target acceptance PASS.
case "${OS_ID,,}:${OS_NAME,,}" in
  parrot:*|parrotsec:*|debian:*parrot\ security*) record_pass "target_os=Parrot" ;;
  *)
    record_blocked "target_os_not_parrot id=${OS_ID:-unknown}"
    emit "overall=BLOCKED"
    exit 77
    ;;
esac

if [ "$(uname -m)" = "x86_64" ]; then record_pass "arch=x86_64"; else record_fail "arch_expected=x86_64 actual=$(uname -m)"; fi

for cmd in curl ss sha256sum file timeout; do
  if command -v "$cmd" >/dev/null 2>&1; then record_pass "tool=$cmd"; else record_fail "missing_tool=$cmd"; fi
done

if [ ! -x "$DIST/app-launcher" ]; then
  record_fail "launcher_missing_or_not_executable path=$DIST/app-launcher"
  emit "overall=$OVERALL"
  exit 1
fi

if (cd "$DIST" && sha256sum -c SHA256SUMS.txt >/dev/null 2>&1); then
  record_pass "distribution_checksums"
else
  record_fail "distribution_checksums"
fi

FILE_DESC=$(file "$DIST/app-launcher" 2>/dev/null || true)
emit "launcher_file=$FILE_DESC"
echo "$FILE_DESC" | grep -q 'ELF 64-bit.*x86-64' && record_pass "launcher_elf_x86_64" || record_fail "launcher_elf_x86_64"

TMP_ROOT=$(mktemp -d)
mkdir -p "$TMP_ROOT/home"
env -i PATH=/nonexistent HOME="$TMP_ROOT/home" "$DIST/app-launcher" --port "$PORT" >"$TMP_ROOT/launcher.log" 2>&1 &
LAUNCHER_PID=$!

READY=0
for _ in $(seq 1 80); do
  if curl -fsS "http://127.0.0.1:$PORT/" >"$TMP_ROOT/index.html" 2>/dev/null; then READY=1; break; fi
  sleep 0.1
done
if [ "$READY" -eq 1 ]; then record_pass "launcher_serves_without_runtime_toolchain"; else record_fail "launcher_start_or_http"; fi

LOCAL_ADDR=$(ss -H -ltnp "sport = :$PORT" 2>/dev/null | awk '{print $4}' | head -1)
emit "listener=$LOCAL_ADDR"
if echo "$LOCAL_ADDR" | grep -q '^127\.0\.0\.1:' && ! echo "$LOCAL_ADDR" | grep -Eq '^(0\.0\.0\.0|\[::\]):'; then
  record_pass "loopback_only_bind"
else
  record_fail "loopback_only_bind"
fi

if grep -q 'data-app-shell="ready"' "$TMP_ROOT/index.html"; then record_pass "delivery_shell_marker"; else emit "INFO delivery_shell_marker_absent_full_bundle_expected"; fi
BROWSER_BUILD=$(curl -fsS "http://127.0.0.1:$PORT/browser-build-manifest.json" 2>/dev/null || true)
emit "browser_build_manifest=$BROWSER_BUILD"
if echo "$BROWSER_BUILD" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"'; then record_pass "browser_bundle_manifest_ready"; else record_fail "browser_bundle_manifest_not_ready"; fi
if grep -q 'data-app-runtime="booting"' "$TMP_ROOT/index.html" && ! grep -q 'data-app-runtime="ready"' "$TMP_ROOT/index.html"; then
  record_pass "static_html_does_not_claim_runtime_ready"
else
  record_fail "static_html_false_ready_or_missing_boot_marker"
fi
CT=$(curl -fsSI "http://127.0.0.1:$PORT/manifest.webmanifest" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type" {print tolower($2)}')
echo "$CT" | grep -q '^application/manifest+json' && record_pass "webmanifest_mime" || record_fail "webmanifest_mime actual=$CT"
TRAVERSAL=$(curl --path-as-is -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/%2e%2e/app-config/branding.json" 2>/dev/null || true)
[ "$TRAVERSAL" = "400" ] && record_pass "encoded_traversal_rejected" || record_fail "encoded_traversal_rejected http=$TRAVERSAL"

CSP=$(curl -fsSI "http://127.0.0.1:$PORT/" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="content-security-policy" {print $2}')
[ -n "$CSP" ] && record_pass "security_header_csp" || record_fail "security_header_csp"

CHROMIUM=""
for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
  if command -v "$candidate" >/dev/null 2>&1; then CHROMIUM=$(command -v "$candidate"); break; fi
done
if [ -z "$CHROMIUM" ]; then
  record_fail "chromium_based_browser_missing"
else
  emit "chromium=$($CHROMIUM --version 2>/dev/null | head -1 || true)"
  CHROMIUM_UI_VALIDATED=0
  if python3 -c 'import selenium' >/dev/null 2>&1 && [ -x "${YADILAB_CHROMEDRIVER:-/bin/chromedriver}" ]; then
    mkdir -p "$TMP_ROOT/browser-workflow"
    set +e
    python3 "$ROOT/tests/acceptance/run_dev23_ui_browser_acceptance.py" \
      --url "http://127.0.0.1:$PORT/" \
      --chrome "$CHROMIUM" \
      --chromedriver "${YADILAB_CHROMEDRIVER:-/bin/chromedriver}" \
      --evidence-dir "$TMP_ROOT/browser-workflow" \
      >"$TMP_ROOT/browser-workflow.log" 2>&1
    CHROMIUM_GATE_CODE=$?
    set -e
    if [ "$CHROMIUM_GATE_CODE" -eq 0 ]; then
      record_pass "chromium_secure_context_indexeddb_cache_serviceworker"
      record_pass "chromium_real_react_builder_mount"
      record_pass "chromium_dev23_viewport_scroll_journey_workflow"
      CHROMIUM_UI_VALIDATED=1
    else
      record_fail "chromium_dev23_ui_workflow exit=$CHROMIUM_GATE_CODE"
    fi
    sed 's/^/chromium_selenium_gate=/' "$TMP_ROOT/browser-workflow.log" | head -40 >> "$REPORT" || true
  else
  mkdir -p "$TMP_ROOT/chromium-playwright-gates"

  # Raw Chromium --dump-dom is not a reliable completion primitive for modern
  # service-worker/IndexedDB pages: Chrome may keep background work alive after
  # the DOM is ready. Use acceptance-only Playwright to wait for the exact DOM
  # conditions instead. This preserves the explicit secure-context/storage/SW
  # gate and the real mounted-Builder gate without weakening either requirement.
  set +e
  python3 - "$CHROMIUM" "http://127.0.0.1:$PORT/" >"$TMP_ROOT/chromium-playwright-gates.log" 2>&1 <<'PYGATE'
import os, sys
try:
    from playwright.sync_api import sync_playwright
except ImportError as exc:
    print(f"BLOCKED_PLAYWRIGHT_IMPORT {exc}")
    raise SystemExit(77)

chromium=sys.argv[1]
base=sys.argv[2]
args=['--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-sync','--metrics-recording-only','--no-first-run']
if hasattr(os,'geteuid') and os.geteuid()==0:
    args.append('--no-sandbox')

secure_ok=False
mount_ok=False
with sync_playwright() as p:
    try:
        browser=p.chromium.launch(executable_path=chromium, headless=True, args=args)
    except Exception as exc:
        print(f"BLOCKED_CHROMIUM_LAUNCH {exc}")
        raise SystemExit(77)
    try:
        context=browser.new_context()
        page=context.new_page()

        try:
            page.goto(base+'acceptance.html', wait_until='domcontentloaded', timeout=20000)
            page.wait_for_function(
                "document.documentElement.dataset.acceptance === 'pass' || document.documentElement.dataset.acceptance === 'fail'",
                timeout=25000,
            )
            status=page.evaluate("document.documentElement.dataset.acceptance")
            detail=page.locator('#acceptance-output').inner_text() if page.locator('#acceptance-output').count() else ''
            if status == 'pass':
                secure_ok=True
                print('PASS_SECURE '+detail)
            else:
                print('FAIL_SECURE '+detail)
        except Exception as exc:
            print(f"FAIL_SECURE {exc}")

        try:
            page.goto(base, wait_until='domcontentloaded', timeout=20000)
            page.wait_for_function("document.documentElement.dataset.appRuntime === 'ready'", timeout=30000)
            required=[
                '.app-frame[data-app-runtime="ready"]',
                'nav[aria-label="Application actions"]',
                '.workspace-grid',
            ]
            missing=[sel for sel in required if page.locator(sel).count()!=1]
            packaged=page.locator('label.file-button', has_text='Open packaged lab')
            packaged_count=packaged.count()
            packaged_input_count=packaged.locator('input[type="file"][accept*="application/zip"]').count() if packaged_count == 1 else 0
            if missing or packaged_count != 1 or packaged_input_count != 1:
                print(f"FAIL_MOUNT missing={missing} packaged_label={packaged_count} packaged_file_input={packaged_input_count}")
            else:
                mount_ok=True
                print('PASS_MOUNT real React Builder controls mounted')
        except Exception as exc:
            print(f"FAIL_MOUNT {exc}")
    finally:
        browser.close()

raise SystemExit(0 if secure_ok and mount_ok else 1)
PYGATE
  CHROMIUM_GATE_CODE=$?
  set -e

  if grep -q '^PASS_SECURE ' "$TMP_ROOT/chromium-playwright-gates.log"; then
    record_pass "chromium_secure_context_indexeddb_cache_serviceworker"
  elif [ "$CHROMIUM_GATE_CODE" -eq 77 ]; then
    record_blocked "chromium_secure_context_probe_dependency_or_policy"
  else
    record_fail "chromium_secure_context_indexeddb_cache_serviceworker"
  fi

  if grep -q '^PASS_MOUNT ' "$TMP_ROOT/chromium-playwright-gates.log"; then
    record_pass "chromium_real_react_builder_mount"
  elif [ "$CHROMIUM_GATE_CODE" -eq 77 ]; then
    record_blocked "chromium_real_react_builder_mount_dependency_or_policy"
  else
    record_fail "chromium_real_react_builder_mount"
  fi
  sed 's/^/chromium_playwright_gate=/' "$TMP_ROOT/chromium-playwright-gates.log" | head -30 >> "$REPORT" || true
  fi
fi

# Phase 43: a mounted Builder DOM alone is not a successful application.
# Real browser workflow checks actual compile/layout, certified student download,
# Runtime remediation/completion, persistence, package import and hash rejection.
# Python Playwright is an ACCEPTANCE-ONLY test prerequisite, not a production
# dependency or a requirement for running the packaged application.
if [ "${CHROMIUM_UI_VALIDATED:-0}" -eq 1 ]; then
  emit "INFO legacy_playwright_workflow_replaced_by_dev23_selenium_acceptance"
elif [ -n "$CHROMIUM" ]; then
  if command -v python3 >/dev/null 2>&1; then
    mkdir -p "$TMP_ROOT/browser-workflow"
    set +e
    python3 "$ROOT/tests/acceptance/run_live_browser_workflow.py" \
      --url "http://127.0.0.1:$PORT/" \
      --chromium "$CHROMIUM" \
      --evidence-dir "$TMP_ROOT/browser-workflow" \
      --offline-launcher "$DIST/app-launcher" \
      >"$TMP_ROOT/browser-workflow.log" 2>&1
    WORKFLOW_CODE=$?
    set -e
    case "$WORKFLOW_CODE" in
      0) record_pass "chromium_interactive_builder_runtime_workflow" ;;
      77) record_blocked "chromium_interactive_workflow_dependency_or_policy" ;;
      *) record_fail "chromium_interactive_builder_runtime_workflow exit=$WORKFLOW_CODE" ;;
    esac
    sed 's/^/browser_workflow=/' "$TMP_ROOT/browser-workflow.log" | head -25 >> "$REPORT" || true
  else
    record_blocked "chromium_interactive_workflow_python3_missing"
  fi
fi

FIREFOX=""
for candidate in firefox firefox-esr; do
  if command -v "$candidate" >/dev/null 2>&1; then FIREFOX=$(command -v "$candidate"); break; fi
done
if [ -z "$FIREFOX" ]; then
  record_fail "firefox_missing"
else
  emit "firefox=$($FIREFOX --version 2>/dev/null | head -1 || true)"
  mkdir -p "$TMP_ROOT/firefox-profile"
  set +e
  HOME="$TMP_ROOT/home" timeout 25s "$FIREFOX" --headless --profile "$TMP_ROOT/firefox-profile" --screenshot "$TMP_ROOT/firefox.png" "http://127.0.0.1:$PORT/" >"$TMP_ROOT/firefox.out" 2>"$TMP_ROOT/firefox.err"
  FIREFOX_CODE=$?
  set -e
  if [ "$FIREFOX_CODE" -eq 0 ] && [ -s "$TMP_ROOT/firefox.png" ] && file "$TMP_ROOT/firefox.png" | grep -q 'PNG image data'; then
    record_pass "firefox_loopback_render"
  else
    record_fail "firefox_probe exit=$FIREFOX_CODE"
    sed 's/^/firefox_stderr=/' "$TMP_ROOT/firefox.err" | head -20 >> "$REPORT" || true
  fi
fi

emit "overall=$OVERALL"
[ "$OVERALL" = "PASS" ] && exit 0
[ "$OVERALL" = "BLOCKED" ] && exit 77
exit 1
