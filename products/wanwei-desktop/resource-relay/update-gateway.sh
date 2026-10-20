#!/usr/bin/env bash
# Usage: bash update-gateway.sh check|apply /absolute/host/nginx.conf public-hostname
# Rollback: bash update-gateway.sh rollback /root/dsh-gateway-tunnel.XXXXXXXX
set -Eeuo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
GATEWAY=dsh-experts-gateway
ACTION=${1:-check}
die() { echo "ERROR: $*" >&2; exit 1; }
test "$(id -u)" = 0 || die 'Run as root.'
for cmd in docker python3 curl flock sha256sum realpath cmp; do command -v "$cmd" >/dev/null || die "Missing $cmd"; done
exec 9>/var/lock/dsh-gateway-tunnel.lock
flock -n 9 || die 'Another gateway update is running.'
STATE=''
CHANGING=0
rollback_exit() {
  local code=$?
  trap - EXIT INT TERM
  if test "$CHANGING" = 1; then
    cp -- "$STATE/original.conf" "$CONFIG"
    docker exec "$GATEWAY" nginx -t && docker exec "$GATEWAY" nginx -s reload \
      || echo 'ERROR: gateway rollback needs manual attention.' >&2
    echo "Gateway configuration restored. Private backup: $STATE" >&2
  fi
  exit "$code"
}
verify_binding() {
  test -f "$CONFIG" && test ! -L "$CONFIG" || die 'Specify the real host-side main nginx.conf, not a symlink.'
  local expected actual
  expected=$(sha256sum "$CONFIG"); expected=${expected%% *}
  actual=$(docker exec "$GATEWAY" sha256sum /etc/nginx/nginx.conf); actual=${actual%% *}
  test "$expected" = "$actual" || die 'Host file differs from the mounted container main configuration.'
  docker inspect --format '{{json .Mounts}}' "$GATEWAY" | python3 -I -c '
import json, os, sys
target = sys.argv[1]
for m in json.load(sys.stdin):
    if m["Type"] != "bind": continue
    destination = m["Destination"].rstrip("/")
    if destination == "/etc/nginx/nginx.conf": candidate = m["Source"]
    elif "/etc/nginx/nginx.conf".startswith(destination + "/"):
        candidate = os.path.join(m["Source"], "/etc/nginx/nginx.conf"[len(destination)+1:])
    else: continue
    if os.path.realpath(candidate) == target: break
else: raise SystemExit("No matching host bind mount; refusing to modify another file")
' "$CONFIG"
}
health() {
  local path
  for path in /api/status /experts/meeting-minutes/readyz /experts/document-processing/readyz /experts/file-conversion/readyz /experts/geology/readyz /experts/third-survey/readyz /experts/planning-review/readyz; do
    curl -fsS --max-time 10 -H "Host: $HOSTNAME_ARG" "http://127.0.0.1:3300$path" >/dev/null
  done
}
if test "$ACTION" = rollback; then
  STATE=${2:-}
  test "$(realpath -e -- "$STATE")" = "$STATE" && [[ "$STATE" =~ ^/root/dsh-gateway-tunnel\.[A-Za-z0-9]+$ ]] || die 'Invalid backup directory.'
  test -s "$STATE/original.conf" && test -s "$STATE/config-path" || die 'Missing rollback files.'
  CONFIG=$(<"$STATE/config-path")
  verify_binding
  cmp -s -- "$STATE/candidate.conf" "$CONFIG" || die 'Gateway changed since this backup; refusing to overwrite later edits.'
  cp -- "$STATE/original.conf" "$CONFIG"
  docker exec "$GATEWAY" nginx -t
  docker exec "$GATEWAY" nginx -s reload
  echo 'Gateway rollback reloaded.'
  exit 0
fi
test "$ACTION" = check || test "$ACTION" = apply || die 'Use check, apply or rollback.'
CONFIG=$(realpath -e -- "${2:?Specify host nginx.conf}")
HOSTNAME_ARG=${3:?Specify the public server_name}
[[ "$HOSTNAME_ARG" =~ ^[A-Za-z0-9.-]+$ ]] || die 'Invalid hostname.'
verify_binding
docker exec "$GATEWAY" nginx -t
health
STATE=$(mktemp -d /root/dsh-gateway-tunnel.XXXXXXXX)
cp -p -- "$CONFIG" "$STATE/original.conf"
printf '%s\n' "$CONFIG" > "$STATE/config-path"
python3 -I "$HERE/patch-gateway.py" "$CONFIG" "$STATE/candidate.conf" --hostname "$HOSTNAME_ARG"
if test "$ACTION" = check; then
  echo "Candidate generated without changing live configuration: $STATE/candidate.conf"
  exit 0
fi
trap rollback_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
CHANGING=1
# Overwrite the same inode so a file bind mount observes the update.
cp -- "$STATE/candidate.conf" "$CONFIG"
docker exec "$GATEWAY" nginx -t
docker exec "$GATEWAY" nginx -s reload
health
CHANGING=0
trap - EXIT INT TERM
echo "Gateway updated without container restart. Backup: $STATE"
echo "Rollback: bash $0 rollback $STATE"
