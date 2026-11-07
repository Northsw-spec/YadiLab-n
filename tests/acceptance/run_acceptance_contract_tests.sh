#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

bash -n scripts/run_parrot_acceptance.sh
bash -n scripts/build_loopback_distribution.sh
[ -f ui/public/acceptance.html ]
[ -f ui/public/acceptance-probe.js ]
grep -q 'indexedDB' ui/public/acceptance-probe.js
grep -q 'serviceWorker' ui/public/acceptance-probe.js
grep -q 'isSecureContext' ui/public/acceptance-probe.js
grep -q 'target_os_not_parrot' scripts/run_parrot_acceptance.sh
grep -q 'exit 77' scripts/run_parrot_acceptance.sh
grep -q '127\.0\.0\.1' scripts/run_parrot_acceptance.sh
grep -q 'browser_bundle_manifest_not_ready' scripts/run_parrot_acceptance.sh
grep -q 'chromium_real_react_builder_mount' scripts/run_parrot_acceptance.sh
grep -q 'chromium_interactive_builder_runtime_workflow' scripts/run_parrot_acceptance.sh
grep -q 'run_live_browser_workflow.py' scripts/run_parrot_acceptance.sh
python3 tests/acceptance/run_browser_workflow_contract_tests.py
[ -f tests/acceptance/run_dev23_ui_browser_acceptance.py ]
grep -Fq 'data-yadilab-build-version="1.8.0-dev.4"' tests/acceptance/run_dev23_ui_browser_acceptance.py
if grep -Fq 'data-yadilab-build-version="1.1.0-dev.22"' tests/acceptance/run_dev23_ui_browser_acceptance.py; then
  echo 'FAIL dev23 browser acceptance still targets dev22 visible build marker' >&2
  exit 1
fi
grep -q 'static_html_does_not_claim_runtime_ready' scripts/run_parrot_acceptance.sh
grep -q 'verify_browser_release.mjs' scripts/build_loopback_distribution.sh
grep -Fq 'LC_ALL=C sort -z' scripts/build_loopback_distribution.sh

set +e
YADILAB_ACCEPTANCE_REPORT="$ROOT/acceptance-contract-report.txt" bash scripts/run_parrot_acceptance.sh >/dev/null 2>&1
CODE=$?
set -e
OS_ID=$(awk -F= '$1=="ID" {gsub(/"/,"",$2); print tolower($2)}' /etc/os-release 2>/dev/null || true)
OS_NAME=$(awk -F= '$1=="NAME" {sub(/^[^=]*=/,""); gsub(/"/,""); print tolower($0)}' /etc/os-release 2>/dev/null || true)
if [ "$OS_ID" != "parrot" ] && [ "$OS_ID" != "parrotsec" ] && ! { [ "$OS_ID" = "debian" ] && [[ "$OS_NAME" == *"parrot security"* ]]; }; then
  [ "$CODE" -eq 77 ]
  grep -q '^overall=BLOCKED$' acceptance-contract-report.txt
else
  # On real Parrot this contract test allows the live harness to decide PASS/FAIL.
  [ "$CODE" -eq 0 ] || [ "$CODE" -eq 1 ] || [ "$CODE" -eq 77 ]
fi
rm -f acceptance-contract-report.txt

echo 'PASS acceptance contract: fail-closed Parrot target gate + browser probe assets.'

# Post-release v1.0.1 regression: rendered zone headers must never overlap resource cards.
grep -Fq "zone header overlaps rendered resource node(s)" tests/acceptance/run_live_browser_workflow.py || { echo "FAIL missing zone-header overlap browser gate" >&2; exit 1; }
echo "PASS acceptance zone-header overlap browser contract"
