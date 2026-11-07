#!/usr/bin/env bash
set -uo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DIST="$ROOT/distribution/linux-x86_64"
LAUNCHER="$DIST/app-launcher"
PORT=${YADILAB_PORT:-18236}
URL="http://127.0.0.1:$PORT/"
# The signed-off distribution (checksummed below) carries the release identity.
# Never maintain another hardcoded version/checkpoint in the launcher.
MARKER_FILE="$DIST/web/build-marker.json"
read_marker() {
  local key="$1" value
  value=$(sed -n -E "s/^[[:space:]]*\"${key}\":[[:space:]]*\"([^\"]+)\"[,]?$/\1/p" "$MARKER_FILE")
  [[ $(printf '%s\n' "$value" | wc -l) -eq 1 ]] || return 1
  printf '%s' "$value"
}
RUNTIME_DIR=${XDG_RUNTIME_DIR:-/tmp}
[[ -d "$RUNTIME_DIR" && -w "$RUNTIME_DIR" ]] || RUNTIME_DIR=/tmp
PIDFILE="$RUNTIME_DIR/yadilab-$PORT.pid"
LAUNCHER_PID=""

fail() {
  printf '\nYadiLab kunde inte startas: %s\n' "$1" >&2
  printf 'Terminalen lämnas öppen så att felet kan läsas.\n' >&2
  if [[ -t 0 && ${YADILAB_TEST_ONCE:-0} != 1 ]]; then read -r -p 'Tryck Enter för att stänga… ' _; fi
  exit 1
}

cleanup_failed_start() {
  if [[ -n "$LAUNCHER_PID" ]]; then
    kill "$LAUNCHER_PID" 2>/dev/null || true
    wait "$LAUNCHER_PID" 2>/dev/null || true
  fi
  rm -f -- "$PIDFILE"
}

verify_marker() {
  local response
  response=$(curl -fsS --max-time 2 "${URL}build-marker.json" 2>/dev/null) || return 1
  grep -Fq '"formatId": "yadilab.browser-build-marker"' <<<"$response" &&
    grep -Fq "\"version\": \"$APP_VERSION\"" <<<"$response" &&
    grep -Fq "\"marker\": \"$MARKER\"" <<<"$response" &&
    grep -Fq "\"checkpoint\": \"$CHECKPOINT\"" <<<"$response" &&
    grep -Fq "\"sourceCommit\": \"$SOURCE_COMMIT\"" <<<"$response"
}

[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || fail "ogiltig port: $PORT"
[[ -x "$LAUNCHER" ]] || fail "körbar launcher saknas: $LAUNCHER"
[[ -r "$MARKER_FILE" ]] || fail "final build marker saknas i distributionen"
(cd "$DIST" && sha256sum -c SHA256SUMS.txt >/dev/null 2>&1) || fail "distributionens checksummor stämmer inte"
APP_VERSION=$(read_marker version) || fail "ogiltigt versionsfält i build-marker"
CHECKPOINT=$(read_marker checkpoint) || fail "ogiltigt checkpointfält i build-marker"
SOURCE_COMMIT=$(read_marker sourceCommit) || fail "käll-commit saknas i build-marker"
MARKER=$(read_marker marker) || fail "marker-fält saknas"
[[ "$APP_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || fail "ogiltigt appversionsformat"
[[ "$CHECKPOINT" =~ ^[A-Z]+-[0-9]{3,}$ ]] || fail "ogiltigt checkpoint-format"
[[ "$SOURCE_COMMIT" =~ ^[a-f0-9]{40}$ ]] || fail "ogiltig Git-commitidentitet"
[[ "$MARKER" == "yadilab-v${APP_VERSION}" ]] || fail "inkonsekvent build-marker"

if [[ -r "$PIDFILE" ]]; then
  old_pid=$(<"$PIDFILE")
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    old_exe=$(readlink -f "/proc/$old_pid/exe" 2>/dev/null || true)
    expected_exe=$(readlink -f "$LAUNCHER" 2>/dev/null || true)
    if [[ -n "$old_exe" && "$old_exe" == "$expected_exe" ]]; then
      kill "$old_pid" 2>/dev/null || fail "kunde inte stoppa tidigare YadiLab-process $old_pid"
      for _ in $(seq 1 30); do kill -0 "$old_pid" 2>/dev/null || break; sleep .1; done
    else
      fail "PID-filen pekar på en annan process ($old_pid); den stoppades inte"
    fi
  fi
  rm -f -- "$PIDFILE"
fi

# The Linux 'comm' name is freely mutable. It is never process identity.
# Compare both canonical executable path and device/inode with the checked
# distribution. These shell checks narrow but cannot eliminate PID reuse races.
verified_stale_launcher_pid() {
  local pid="$1" expected_path="$2" expected_inode="$3"
  local live_uid live_name live_path live_inode
  [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/status" ]] || return 1
  live_uid=$(awk '/^Uid:/ {print $2; exit}' "/proc/$pid/status" 2>/dev/null) || return 1
  live_name=$(cat "/proc/$pid/comm" 2>/dev/null) || return 1
  live_path=$(readlink -f -- "/proc/$pid/exe" 2>/dev/null) || return 1
  live_inode=$(stat -Lc '%d:%i' -- "/proc/$pid/exe" 2>/dev/null) || return 1
  [[ "$live_uid" == "$(id -u)" && "$live_name" == "app-launcher" &&
     -n "$live_path" && "$live_path" == "$expected_path" &&
     -n "$live_inode" && "$live_inode" == "$expected_inode" ]]
}

stale_port_owned_by_pid() {
  local pid="$1" listeners
  listeners=$(ss -H -ltnp "sport = :$PORT" 2>/dev/null) || return 1
  [[ "$listeners" == *"pid=$pid,"* ]]
}

stop_stale_port_owner() {
  local lines pids pid uid comm trusted_path trusted_inode
  lines=$(ss -H -ltnp "sport = :$PORT" 2>/dev/null || true)
  [[ -n "$lines" ]] || return 0

  mapfile -t pids < <(grep -oE 'pid=[0-9]+' <<<"$lines" | cut -d= -f2 | sort -u)
  ((${#pids[@]} > 0)) || fail "port $PORT används redan men ägar-PID kunde inte fastställas ($lines)"
  trusted_path=$(readlink -f -- "$LAUNCHER" 2>/dev/null) || fail "launcherns processidentitet kunde inte verifieras"
  trusted_inode=$(stat -Lc '%d:%i' -- "$LAUNCHER" 2>/dev/null) || fail "launcherns inode kunde inte verifieras"
  [[ -n "$trusted_path" && -n "$trusted_inode" ]] || fail "launcherns processidentitet kunde inte verifieras"

  for pid in "${pids[@]}"; do
    [[ -r "/proc/$pid/status" ]] || continue
    uid=$(awk '/^Uid:/ {print $2; exit}' "/proc/$pid/status" 2>/dev/null || true)
    comm=$(cat "/proc/$pid/comm" 2>/dev/null || true)
    if [[ "$uid" == "$(id -u)" && "$comm" == "app-launcher" ]] &&
       verified_stale_launcher_pid "$pid" "$trusted_path" "$trusted_inode" &&
       stale_port_owned_by_pid "$pid"; then
      # Reconfirm immediately before SIGTERM: not just the mutable process name.
      verified_stale_launcher_pid "$pid" "$trusted_path" "$trusted_inode" &&
        stale_port_owned_by_pid "$pid" ||
        fail "processidentitet ändrades före SIGTERM (pid=$pid); stopp nekas"
      printf 'Stoppar gammal YadiLab app-launcher PID %s på port %s.\n' "$pid" "$PORT"
      kill -TERM "$pid" 2>/dev/null || fail "kunde inte stoppa verifierad YadiLab-process $pid"
      for _ in $(seq 1 40); do
        kill -0 "$pid" 2>/dev/null || break
        sleep .1
      done
      if kill -0 "$pid" 2>/dev/null && stale_port_owned_by_pid "$pid"; then
        # A recycled PID, changed executable or disconnected port must not be killed.
        verified_stale_launcher_pid "$pid" "$trusted_path" "$trusted_inode" &&
          stale_port_owned_by_pid "$pid" ||
          fail "processidentitet ändrades före SIGKILL (pid=$pid); stopp nekas"
        printf 'Verifierad YadiLab-process %s svarade inte på SIGTERM; skickar SIGKILL.\n' "$pid"
        kill -KILL "$pid" 2>/dev/null || fail "kunde inte stoppa verifierad YadiLab-process $pid"
      fi
    else
      fail "port $PORT ägs av annan process och stoppas inte automatiskt (pid=$pid, processidentitet ej verifierad)"
    fi
  done

  for _ in $(seq 1 40); do
    ss -H -ltn "sport = :$PORT" 2>/dev/null | grep -q . || return 0
    sleep .1
  done
  lines=$(ss -H -ltnp "sport = :$PORT" 2>/dev/null | head -1 || true)
  fail "port $PORT är fortfarande upptagen efter stoppförsök (${lines:-ägare okänd})"
}

if ss -H -ltn "sport = :$PORT" 2>/dev/null | grep -q .; then
  if verify_marker; then
    printf 'En äldre/kvarvarande YadiLab-server svarar redan på port %s; startar om den så denna uppackning äger processen.\n' "$PORT"
  else
    printf 'Port %s används av en process med fel/ingen final marker; kontrollerar om det är en gammal YadiLab app-launcher.\n' "$PORT"
  fi
  stop_stale_port_owner
fi

"$LAUNCHER" --port "$PORT" >"$RUNTIME_DIR/yadilab-$PORT.log" 2>&1 &
LAUNCHER_PID=$!
printf '%s\n' "$LAUNCHER_PID" >"$PIDFILE"

ready=0
for _ in $(seq 1 100); do
  if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then cleanup_failed_start; fail "launchern avslutades före HTTP-verifieringen"; fi
  if verify_marker; then ready=1; break; fi
  sleep .1
done
[[ "$ready" == 1 ]] || { cleanup_failed_start; fail "HTTP-svaret verifierades inte som $MARKER"; }

printf 'Verifierad YadiLab %s på %s\n' "$MARKER" "$URL"
if [[ ${YADILAB_TEST_ONCE:-0} == 1 ]]; then cleanup_failed_start; exit 0; fi

browser=${YADILAB_BROWSER:-}
if [[ -z "$browser" ]]; then
  for candidate in google-chrome chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then browser=$(command -v "$candidate"); break; fi
  done
fi
[[ -n "$browser" && -x "$browser" ]] || { cleanup_failed_start; fail "Google Chrome/Chromium hittades inte"; }
"$browser" --new-window "${URL}?build=${APP_VERSION}&checkpoint=${CHECKPOINT}" >/dev/null 2>&1 &
printf 'Browser öppnad. Låt terminalen vara öppen medan YadiLab används.\n'
wait "$LAUNCHER_PID"
status=$?
rm -f -- "$PIDFILE"
[[ "$status" == 0 ]] || fail "launchern avslutades med kod $status"
