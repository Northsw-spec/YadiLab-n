#!/usr/bin/env bash
# Seal an already prepared Phase-44 snapshot directory into one canonical transport ZIP.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -ne 2 || ! -d "${1:-}" || -z "${2:-}" ]]; then
  echo 'Usage: bash scripts/seal_offline_dependency_snapshot.sh SNAPSHOT_DIR OUTPUT.zip' >&2
  exit 2
fi
snapshot="$(realpath "$1")"
out="$(realpath -m "$2")"
[[ "$out" == *.zip ]] || { echo 'BLOCKED: output must end in .zip' >&2; exit 77; }
cd "$root"
node scripts/verify_offline_dependency_snapshot.mjs "$snapshot"
python3 scripts/pack_offline_dependency_snapshot.py "$snapshot" "$out"
(cd "$(dirname "$out")" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")
printf 'PASS sealed transport: %s\nPASS SHA256 sidecar: %s\n' "$out" "$out.sha256"
