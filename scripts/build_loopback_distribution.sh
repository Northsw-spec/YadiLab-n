#!/usr/bin/env bash
# Promote only a complete, byte-verified browser bundle. A failed build must
# leave the last known-good loopback distribution untouched.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/distribution/linux-x86_64"
MODE=shell
if [[ -e "$ROOT/ui/dist" || -L "$ROOT/ui/dist" ]]; then
  node "$ROOT/scripts/verify_browser_release.mjs" "$ROOT/ui/dist"
  node "$ROOT/scripts/verify_release_identity.mjs" "$ROOT/ui/dist"
  MODE=browser
fi
[[ "$MODE" == browser ]] || { echo "FAIL: attested browser bundle required for Linux release" >&2; exit 77; }
node "$ROOT/scripts/generate_pwa_manifest.mjs"
node "$ROOT/scripts/generate_web_shell.mjs"
mkdir -p "$ROOT/distribution"
STAGE=$(mktemp -d "$ROOT/distribution/.linux-x86_64-stage-XXXXXX")
BACKUP="$ROOT/distribution/.linux-x86_64-previous-$$"
cleanup() {
  if [[ -n "${STAGE:-}" && -d "$STAGE" ]]; then rm -rf "$STAGE"; fi
  # On a failed final rename, restore the previous distribution.
  if [[ -d "$BACKUP" && ! -e "$OUT" ]]; then mv "$BACKUP" "$OUT"; fi
}
trap cleanup EXIT INT TERM
mkdir -p "$STAGE/web"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags='-s -w -buildid=' -o "$STAGE/app-launcher" "$ROOT/launcher"
if [[ "$MODE" == browser ]]; then
  # The preflight is executed *before* the previous release is touched.
  cp -a "$ROOT/ui/dist/." "$STAGE/web/"
  cp "$ROOT/ui/dist/THIRD_PARTY_NOTICES.md" "$STAGE/THIRD_PARTY_NOTICES.md"
  cp "$ROOT/ui/dist/third-party-inventory.json" "$STAGE/third-party-inventory.json"
  # Independently re-verify copied bytes; do not trust a pre-copy check alone.
  node "$ROOT/scripts/verify_browser_release.mjs" "$STAGE/web"
  node "$ROOT/scripts/verify_release_identity.mjs" "$STAGE/web"
else
  node "$ROOT/scripts/generate_third_party_notices.mjs" >/dev/null
  cp -a "$ROOT/ui/public/." "$STAGE/web/"
  cp "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/THIRD_PARTY_NOTICES.md"
  cp "$ROOT/dependencies/third-party-inventory.json" "$STAGE/third-party-inventory.json"
fi
if [[ "$MODE" == shell ]]; then
  mkdir -p "$STAGE/web/assets/builtin"
  cp -a "$ROOT/asset-library/builtin/." "$STAGE/web/assets/builtin/"
fi
# In browser mode, do NOT overwrite independently hashed ui/dist assets with
# files from the current source tree. That would invalidate the bundle manifest
# and service-worker precache after the integrity preflight.
(
  cd "$STAGE"
  {
    sha256sum app-launcher THIRD_PARTY_NOTICES.md third-party-inventory.json
    find web -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum
  } > SHA256SUMS.txt
  sha256sum -c SHA256SUMS.txt >/dev/null
)
# The new release is complete. Keep the old tree in a private backup until the
# final promotion succeeds; never publish a partially copied distribution.
if [[ -e "$OUT" ]]; then
  [[ ! -e "$BACKUP" ]] || { echo "FAIL stale distribution backup" >&2; exit 1; }
  mv "$OUT" "$BACKUP"
fi
mv "$STAGE" "$OUT"
STAGE=""
if [[ -d "$BACKUP" ]]; then rm -rf "$BACKUP"; fi
printf 'PASS loopback distribution promotion: %s\n' "$MODE"
