#!/usr/bin/env bash
# Developer-only: run this on a TRUSTED internet-connected Linux x86-64 machine
# using the exact same source checkout as the disconnected build machine.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo 'Usage: bash scripts/prepare_offline_browser_cache.sh /path/to/empty-output-directory' >&2
  exit 2
fi
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'BLOCKED: this cache handoff targets Linux x86-64 development machines.' >&2
  exit 77
fi
out="$(realpath -m "$1")"
if [[ "$out" == "$root" || "$out" == "$root/"* ]]; then
  echo 'BLOCKED: choose an output directory outside the source checkout.' >&2
  exit 77
fi
if [[ -e "$out" && -n "$(ls -A "$out")" ]]; then
  echo 'BLOCKED: output directory must be empty to avoid mixing dependency snapshots.' >&2
  exit 77
fi
mkdir -p "$out/npm-cache"
cd "$root"
# The project lock must be npm-generated (never hand-write root-only lock data).
if [[ ! -f package-lock.json ]]; then
  npm install --package-lock-only --ignore-scripts --no-audit --no-fund
fi
node scripts/verify_package_lock.mjs
npm ci --cache "$out/npm-cache" --no-audit --no-fund
node scripts/check_browser_build_readiness.mjs
node scripts/check_browser_toolchain_execution.mjs
npm cache verify --cache "$out/npm-cache" >/dev/null
# Prove the populated cache is sufficient without network access before sealing it.
# This intentionally destroys the first install and replays npm ci in strict offline mode.
rm -rf node_modules
npm ci --offline --cache "$out/npm-cache" --no-audit --no-fund
node scripts/check_browser_build_readiness.mjs
node scripts/check_browser_toolchain_execution.mjs
cp package-lock.json "$out/package-lock.json"
sha256sum "$out/package-lock.json" | awk '{print $1"  package-lock.json"}' > "$out/SHA256SUMS.txt"
NODE_VERSION="$(node --version)" NPM_VERSION="$(npm --version)" python3 - <<'PY' > "$out/development-platform.json"
import json, os, platform
print(json.dumps({
    "node": os.environ["NODE_VERSION"],
    "npm": os.environ["NPM_VERSION"],
    "platform": "linux",
    "arch": "x86_64",
    "kernel": platform.release(),
}, separators=(",", ":")))
PY
YADILAB_PREPARED_NPM_VERSION="$(npm --version)" node scripts/create_offline_dependency_snapshot_manifest.mjs "$out"
node scripts/verify_offline_dependency_snapshot.mjs --pre-signing "$out"
printf 'Ready. Transfer this directory (lock + npm-cache + snapshot manifest) to the offline Linux x86-64 builder.\n'
