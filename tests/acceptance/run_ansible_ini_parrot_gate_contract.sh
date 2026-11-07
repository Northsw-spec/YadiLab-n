#!/usr/bin/env bash
# Ubuntu-only contract: a Parrot-only target acceptance MUST BLOCK, never PASS.
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
. /etc/os-release
case "${ID,,}:${PRETTY_NAME,,}" in
  parrot:*|parrotsec:*|debian:*parrot*) echo "BLOCKED: wrong host for Ubuntu-only negative gate"; exit 77 ;;
esac
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
set +e
ID=parrot PRETTY_NAME="Parrot Security" \
  YADILAB_ACCEPTANCE_DIST=/nonexistent/official-distribution \
  YADILAB_ANSIBLE_INI_EVIDENCE_DIR="$temp/evidence" \
  bash scripts/run_ansible_ini_parrot_acceptance.sh >"$temp/output" 2>&1
code=$?
set -e
[[ "$code" -eq 77 ]] || { cat "$temp/output"; echo "FAIL negative gate exit=$code"; exit 1; }
grep -Fq 'overall=BLOCKED' "$temp/evidence/acceptance-status.txt"
grep -Fq 'TARGET_IS_NOT_PARROT' "$temp/evidence/acceptance-status.txt"
! grep -Fq 'overall=PASS' "$temp/evidence/acceptance-status.txt"
! grep -Fq 'stage_p2=STARTED' "$temp/evidence/acceptance-status.txt"
! grep -Fq 'stage_p3=STARTED' "$temp/evidence/acceptance-status.txt"
echo "PASS negative contract: Ubuntu returns 77/BLOCKED despite spoofed OS environment"
