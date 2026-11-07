#!/usr/bin/env bash
# Verify the sealed transport sidecar, safely extract it, then verify the Phase-44 snapshot/source binding.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -ne 2 || -z "${1:-}" || -z "${2:-}" ]]; then
  echo 'Usage: bash scripts/import_offline_dependency_snapshot.sh TRANSPORT.zip EMPTY_OUTPUT_DIR' >&2
  exit 2
fi
archive="$(realpath "$1")"
out="$(realpath -m "$2")"
[[ -f "$archive" && "$archive" == *.zip ]] || { echo 'BLOCKED: dependency snapshot transport ZIP not found.' >&2; exit 77; }
sidecar="$archive.sha256"
[[ -f "$sidecar" ]] || { echo 'BLOCKED: dependency snapshot transport SHA-256 sidecar missing.' >&2; exit 77; }
line_count="$(wc -l < "$sidecar" | tr -d ' ')"
[[ "$line_count" == 1 ]] || { echo 'BLOCKED: transport SHA-256 sidecar must contain exactly one line.' >&2; exit 77; }
IFS=' ' read -r expected marker filename extra < "$sidecar" || true
# sha256sum format is: 64hex, two spaces, basename. `read` collapses spaces,
# so validate the original line shape separately and never execute a sidecar path.
base="$(basename "$archive")"
line="$(cat "$sidecar")"
[[ "$line" =~ ^([0-9a-f]{64})\ \ (.+)$ ]] || { echo 'BLOCKED: transport SHA-256 sidecar format invalid.' >&2; exit 77; }
expected="${BASH_REMATCH[1]}"
filename="${BASH_REMATCH[2]}"
[[ "$filename" == "$base" ]] || { echo 'BLOCKED: transport SHA-256 sidecar filename mismatch.' >&2; exit 77; }
actual="$(sha256sum "$archive" | awk '{print $1}')"
[[ "$actual" == "$expected" ]] || { echo 'BLOCKED: transport ZIP SHA-256 mismatch.' >&2; exit 77; }
python3 "$root/scripts/extract_offline_dependency_snapshot.py" "$archive" "$out"
node "$root/scripts/verify_offline_dependency_snapshot.mjs" "$out"
printf 'PASS dependency snapshot transport import: %s\n' "$base"
