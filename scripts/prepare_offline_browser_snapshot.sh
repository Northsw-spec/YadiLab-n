#!/usr/bin/env bash
# One-command trusted-online-host producer for a sealed dependency snapshot transport.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo 'Usage: bash scripts/prepare_offline_browser_snapshot.sh /path/to/YadiLab_dependencies.zip' >&2
  exit 2
fi
out="$(realpath -m "$1")"
key="${YADILAB_SNAPSHOT_SIGNING_KEY:-}"
[[ -n "$key" ]] || { echo 'BLOCKED: set YADILAB_SNAPSHOT_SIGNING_KEY to an external trusted Ed25519 private key.' >&2; exit 77; }
[[ -f "$key" ]] || { echo 'BLOCKED: snapshot signing private key file not found.' >&2; exit 77; }
key="$(realpath "$key")"
if [[ "$key" == "$root" || "$key" == "$root/"* ]]; then
  echo 'BLOCKED: snapshot signing private key must live outside the application source checkout.' >&2
  exit 77
fi
key_mode="$(stat -c '%a' "$key")"
[[ "$key_mode" == 400 || "$key_mode" == 600 ]] || { echo "BLOCKED: snapshot signing private key permissions must be 0400 or 0600, got $key_mode" >&2; exit 77; }
if [[ "$out" == "$root" || "$out" == "$root/"* ]]; then
  echo 'BLOCKED: write the sealed dependency transport outside the source checkout.' >&2
  exit 77
fi
[[ "$out" == *.zip ]] || { echo 'BLOCKED: output must end in .zip' >&2; exit 77; }
if [[ -e "$out" || -e "$out.sha256" ]]; then
  echo 'BLOCKED: output ZIP/sidecar already exists.' >&2
  exit 77
fi
tmp="$(mktemp -d -t yadilab-dependency-snapshot.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
cd "$root"
bash scripts/prepare_offline_browser_cache.sh "$tmp/snapshot"
node scripts/sign_offline_dependency_snapshot.mjs "$tmp/snapshot" "$key"
bash scripts/seal_offline_dependency_snapshot.sh "$tmp/snapshot" "$out"
printf 'Ready for transfer. On offline Parrot/Linux use:\n  bash scripts/install_offline_browser_dependencies.sh %q\n' "$out"
