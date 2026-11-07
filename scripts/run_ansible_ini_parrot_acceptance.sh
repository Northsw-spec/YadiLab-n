#!/usr/bin/env bash
# Local Parrot-only INI P2+P3 acceptance. 0=measured PASS, 77=BLOCKED, 1=FAIL.
set -Eeuo pipefail
umask 077
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
DIST="${YADILAB_ACCEPTANCE_DIST:-$ROOT/distribution/linux-x86_64}"
EVIDENCE="${YADILAB_ANSIBLE_INI_EVIDENCE_DIR:-$ROOT/acceptance-evidence/ansible-ini-parrot}"
PORT="${YADILAB_ANSIBLE_INI_PARROT_PORT:-18985}"
PYTHON="${YADILAB_ANSIBLE_INI_PYTHON:-python3}"
APP_PID=""
mkdir -p -- "$EVIDENCE" || { echo "BLOCKED evidence directory unavailable" >&2; exit 77; }
REPORT="$EVIDENCE/acceptance-status.txt"
: > "$REPORT"
emit(){ printf '%s\n' "$*" | tee -a "$REPORT"; }
blocked(){ emit "overall=BLOCKED"; emit "reason=$*"; exit 77; }
failed(){ emit "overall=FAIL"; emit "reason=$*"; exit 1; }
cleanup(){ if [[ -n "$APP_PID" ]]; then kill "$APP_PID" 2>/dev/null || true; wait "$APP_PID" 2>/dev/null || true; fi; }
trap cleanup EXIT
emit "gate=ANSIBLE-INI-PARROT-ACCEPTANCE-001"
emit "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
[[ $(id -u) != 0 ]] || blocked "RUN_AS_NONROOT_USER"
[[ -r /etc/os-release ]] || blocked "OS_RELEASE_MISSING"
# Obtain the actual local OS identity, not user-injected ID/PRETTY_NAME.
. /etc/os-release
OS_ID="${ID:-}"
OS_NAME="${PRETTY_NAME:-}"
case "${OS_ID,,}:${OS_NAME,,}" in
  parrot:*|parrotsec:*|debian:*parrot*) emit "target_os=Parrot" ;;
  *) blocked "TARGET_IS_NOT_PARROT id=${OS_ID:-unknown}" ;;
esac
[[ $(uname -m) == x86_64 ]] || blocked "TARGET_ARCH_NOT_X86_64"
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || blocked "INVALID_PORT"
(( 10#$PORT >= 1024 && 10#$PORT <= 65535 )) || blocked "INVALID_PORT"
for cmd in git curl sha256sum ss "$PYTHON"; do
  command -v "$cmd" >/dev/null 2>&1 || blocked "MISSING_PREREQUISITE=$cmd"
done
[[ -x "$DIST/app-launcher" ]] || blocked "OFFICIAL_APP_LAUNCHER_NOT_FOUND"
[[ -s "$DIST/SHA256SUMS.txt" && -s "$DIST/web/build-marker.json" ]] ||
  blocked "RELEASE_INTEGRITY_METADATA_MISSING"
[[ -s "$DIST/web/browser-build-manifest.json" ]] || blocked "BROWSER_MANIFEST_MISSING"
for test in run_ansible_ini_p2_real_browser.py run_ansible_ini_p3_real_browser.py; do
  [[ -r "$ROOT/tests/acceptance/$test" ]] || blocked "MISSING_TEST=$test"
done
[[ -r "$ROOT/tests/fixtures/import/ansible-ini/oracles.json" ]] || blocked "MISSING_FROZEN_ORACLES"
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || blocked "GIT_CHECKOUT_REQUIRED"
HEAD=$(git -C "$ROOT" rev-parse --verify HEAD 2>/dev/null) || blocked "GIT_HEAD_UNAVAILABLE"
[[ "$HEAD" =~ ^[0-9a-f]{40}$ ]] || blocked "GIT_HEAD_INVALID"
if ! git -C "$ROOT" diff --quiet HEAD -- \
  scripts/run_ansible_ini_parrot_acceptance.sh \
  tests/acceptance/run_ansible_ini_p2_real_browser.py \
  tests/acceptance/run_ansible_ini_p3_real_browser.py \
  tests/acceptance/target_platform_identity.py \
  tests/fixtures/import/ansible-ini; then
  blocked "TEST_SOURCE_OR_FIXTURES_MODIFIED"
fi
emit "test_source_commit=$HEAD"
(cd "$DIST" && sha256sum --status -c SHA256SUMS.txt) ||
  failed "PACKAGED_DISTRIBUTION_CHECKSUM_MISMATCH"
emit "distribution_checksums=PASS"
"$PYTHON" - "$DIST/web/build-marker.json" "$DIST/web/browser-build-manifest.json" "$HEAD" <<'PY' ||
  blocked "RELEASE_IDENTITY_MISMATCH"
import json,sys
from pathlib import Path
marker=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
manifest=json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
assert marker.get("formatId")=="yadilab.browser-build-marker"
assert marker.get("sourceCommit")==sys.argv[3]
assert manifest.get("status")=="ready"
PY
emit "package_commit_matches_test_source=PASS"
# Missing Playwright/Chromium is a BLOCKED prerequisite; never auto-install or run sudo/apt.
"$PYTHON" - <<'PY' >"$EVIDENCE/playwright-preflight.log" 2>&1 ||
  blocked "PLAYWRIGHT_OR_CHROMIUM_UNAVAILABLE"
from playwright.sync_api import sync_playwright
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True,args=["--disable-dev-shm-usage","--disable-background-networking"])
    browser.close()
PY
emit "playwright_chromium=PASS"
[[ -z $(ss -H -ltn "sport = :$PORT" 2>/dev/null) ]] || blocked "LOCAL_PORT_BUSY"
"$DIST/app-launcher" --port "$PORT" >"$EVIDENCE/launcher.log" 2>&1 &
APP_PID=$!
READY=0
for _ in $(seq 1 100); do
  kill -0 "$APP_PID" 2>/dev/null || failed "PACKAGED_LAUNCHER_EXITED_EARLY"
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/build-marker.json" \
      >"$EVIDENCE/served-build-marker.json" 2>/dev/null; then
    if "$PYTHON" - "$EVIDENCE/served-build-marker.json" "$HEAD" <<'PY' >/dev/null 2>&1
import json,sys
assert json.load(open(sys.argv[1],encoding="utf-8")).get("sourceCommit")==sys.argv[2]
PY
    then READY=1; break; fi
  fi
  sleep .1
done
[[ "$READY" == 1 ]] || failed "PACKAGED_HTTP_MARKER_NOT_READY_OR_WRONG_SHA"
LISTEN=$(ss -H -ltn "sport = :$PORT")
grep -Eq '127\.0\.0\.1:' <<<"$LISTEN" || failed "LOOPBACK_LISTENER_ABSENT"
! grep -Eq '0\.0\.0\.0:|\[::\]:' <<<"$LISTEN" || failed "NON_LOOPBACK_LISTENER_DETECTED"
emit "packaged_launcher_loopback=PASS"
for stage in p2 p3; do
  folder="$EVIDENCE/$stage"
  mkdir -p "$folder"
  emit "stage_$stage=STARTED"
  if "$PYTHON" "$ROOT/tests/acceptance/run_ansible_ini_${stage}_real_browser.py" \
      --url "http://127.0.0.1:$PORT/" --evidence-dir "$folder" \
      >"$folder/output.log" 2>&1; then
    "$PYTHON" - "$folder" "$stage" <<'PY' || failed "STAGE_EVIDENCE_INVALID"
import json,sys
from pathlib import Path
folder=Path(sys.argv[1]); stage=sys.argv[2]
name="ansible-ini-p2-chromium.json" if stage=="p2" else "ansible-ini-p3-chromium.json"
result=json.loads((folder/name).read_text(encoding="utf-8"))
assert result["status"]=="PASS" and len(result["cases"])>0
assert result.get("actualParrotHost") is True, "Real browser report was not recorded on Parrot"
assert all(case["status"]=="PASS" for case in result["cases"])
if stage=="p3":
    assert all(case["builderUnchanged"] is True for case in result["cases"])
PY
    emit "stage_$stage=PASS"
  else
    failed "STAGE_$stage_REAL_CHROMIUM_FAILED; see $folder/output.log"
  fi
done
emit "overall=PASS"
emit "scope=ACTUAL_PARROT_PACKAGED_APP_CHROMIUM_P2_P3_ONLY"
