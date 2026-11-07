#!/usr/bin/env bash
# Developer-only: deterministic offline npm ci from a transferred local cache.
# Phase 53: build in an isolated source-identical stage and transactionally
# promote only generated/excluded artifacts after the complete build verifies.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo 'Usage: bash scripts/install_offline_browser_dependencies.sh SNAPSHOT_DIR_OR_TRANSPORT.zip' >&2
  exit 2
fi
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'BLOCKED: this offline snapshot is for Linux x86-64.' >&2
  exit 77
fi
# Recover only generated paths from a previously interrupted final promotion.
# Source-controlled files are never transaction targets.
node "$root/scripts/recover_offline_browser_build_transaction.mjs" "$root"
input="$(realpath "$1")"
tmp=''
stage_parent=''
cleanup() {
  [[ -n "$tmp" ]] && rm -rf "$tmp"
  [[ -n "$stage_parent" ]] && rm -rf "$stage_parent"
}
trap cleanup EXIT
if [[ -f "$input" ]]; then
  [[ "$input" == *.zip ]] || { echo 'BLOCKED: snapshot transport file must end in .zip' >&2; exit 77; }
  tmp="$(mktemp -d -t yadilab-offline-import.XXXXXX)"
  bash "$root/scripts/import_offline_dependency_snapshot.sh" "$input" "$tmp/snapshot"
  cache="$tmp/snapshot"
elif [[ -d "$input" ]]; then
  cache="$input"
else
  echo 'BLOCKED: snapshot input does not exist.' >&2
  exit 77
fi
for required in npm-cache package-lock.json SHA256SUMS.txt snapshot-manifest.json snapshot-provenance.json snapshot-provenance.sig; do
  [[ -e "$cache/$required" ]] || { echo "BLOCKED: snapshot missing $required" >&2; exit 77; }
done
cd "$root"
# Verify the sealed snapshot and consumer identity before npm consumes cache bytes.
node scripts/verify_offline_dependency_snapshot.mjs "$cache"
YADILAB_CONSUMER_NPM_VERSION="$(npm --version)" node scripts/check_offline_snapshot_consumer_environment.mjs "$cache"
(cd "$cache" && sha256sum -c SHA256SUMS.txt)
npm cache verify --cache "$cache/npm-cache" >/dev/null
if [[ -f "$root/package-lock.json" ]]; then
  cmp --silent "$root/package-lock.json" "$cache/package-lock.json" || {
    echo 'BLOCKED: transferred package-lock differs from current source lock.' >&2
    exit 77
  }
fi

# Build outside the live checkout. The stage is a source-identity-preserving copy
# and lives beside the checkout so final directory renames remain same-filesystem.
stage_parent="$(mktemp -d "$(dirname "$root")/.yadilab-offline-stage.XXXXXX")"
stage="$stage_parent/source"
node "$root/scripts/stage_source_checkout.mjs" "$root" "$stage"
mkdir -p "$stage/distribution"
cp "$cache/package-lock.json" "$stage/package-lock.json"
cd "$stage"
node scripts/verify_package_lock.mjs
npm ci --offline --cache "$cache/npm-cache" --no-audit --no-fund
node scripts/check_browser_build_readiness.mjs
node scripts/check_browser_toolchain_execution.mjs
node scripts/build_browser_app.mjs
node scripts/verify_browser_release.mjs
bash scripts/build_loopback_distribution.sh
(cd distribution/linux-x86_64 && sha256sum -c SHA256SUMS.txt)

# No live generated state is touched until every staged gate above passes.
node "$root/scripts/promote_offline_browser_build.mjs" "$root" "$stage"
cd "$root"
node scripts/verify_package_lock.mjs
node scripts/check_browser_build_readiness.mjs
node scripts/check_browser_toolchain_execution.mjs
node scripts/verify_browser_release.mjs
(cd distribution/linux-x86_64 && sha256sum -c SHA256SUMS.txt)
printf 'Local dependency-resolved browser build complete and transactionally promoted; run target acceptance on Parrot next.\n'
