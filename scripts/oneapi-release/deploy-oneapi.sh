#!/usr/bin/env bash
# Only replace OneAPI. Never stop/reconfigure the gateway or six expert sites.
set -Eeuo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
SCRIPT_PATH="$HERE/$(basename -- "$0")"
ACTION=${1:-help}
shift || true
PACKAGE=''
DB_ARGS=()
while test "$#" -gt 0; do
  case "$1" in
    --package) test "$#" -ge 2 || { echo 'Missing --package value' >&2; exit 1; }; PACKAGE=$2; shift 2;;
    --skip-db-backup) test "${#DB_ARGS[@]}" = 0 || { echo 'Choose exactly one backup option' >&2; exit 1; }; DB_ARGS=(--skip-db-backup); shift;;
    --db-backup) test "$#" -ge 2 && test "${#DB_ARGS[@]}" = 0 || { echo 'Choose exactly one backup option with a value' >&2; exit 1; }; DB_ARGS=(--db-backup "$2"); shift 2;;
    *) echo "Unknown argument: $1" >&2; exit 1;;
  esac
done
if test "$ACTION" = help || test "$ACTION" = --help; then
  echo 'Usage: bash deploy-oneapi.sh verify|check|build|status [--package ./dsh-server-source-VERSION.tar.gz]'
  echo '       bash deploy-oneapi.sh update|deploy [--package ./dsh-server-source-VERSION.tar.gz] --db-backup /absolute/backup.sql'
  echo '       Use --skip-db-backup instead only after accepting database migration risk.'
  exit 0
fi
if test -n "$PACKAGE"; then
  PACKAGE=$(realpath -- "$PACKAGE")
  HERE=$(dirname -- "$PACKAGE")
fi
command -v python3 >/dev/null || { echo 'Missing command: python3' >&2; exit 1; }
# Parse data as data, never source/eval a release manifest.
mapfile -t RELEASE < <(python3 -I - "$HERE/release.json" "$SCRIPT_PATH" <<'META'
import hashlib, json, pathlib, re, sys
p = pathlib.Path(sys.argv[1])
try:
    assert not (p.parent / 'INCOMPLETE.txt').exists(), 'Incomplete release directory'
    m = json.loads(p.read_text(encoding='utf-8'))
    assert m['schemaVersion'] == 1 and m['kind'] == 'oneapi-source', 'Unsupported package format'
    v = m['version']
    assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?', v) and len(v) <= 80, 'Invalid version'
    assert re.fullmatch(r'[0-9a-f]{40}', m['commit']), 'Invalid Git commit'
    a = m['archive']
    assert a['file'] == 'dsh-server-source-' + v + '.tar.gz', 'Unexpected archive filename'
    assert re.fullmatch(r'[0-9a-f]{64}', a['sha256']), 'Invalid source checksum'
    assert m['deployer']['sha256'] == hashlib.sha256(pathlib.Path(sys.argv[2]).read_bytes()).hexdigest(), 'Deployment script checksum mismatch'
    archive = p.parent / a['file']
    assert archive.stat().st_size == a['bytes'], 'Source archive size mismatch'
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == a['sha256'], 'Source archive checksum mismatch'
    print(v)
    print(m['commit'])
    print(a['sha256'])
    print(a['file'])
except Exception as e:
    print('Release validation failed: ' + str(e), file=sys.stderr)
    sys.exit(1)
META
)
test "${#RELEASE[@]}" = 4 || { echo 'Invalid release metadata; no deployment performed.' >&2; exit 1; }
for field in "${!RELEASE[@]}"; do RELEASE[$field]=${RELEASE[$field]%$'\r'}; done
VERSION=${RELEASE[0]}
COMMIT=${RELEASE[1]}
SOURCE_SHA=${RELEASE[2]}
ARCHIVE="$HERE/${RELEASE[3]}"
test -z "$PACKAGE" || test "$PACKAGE" = "$ARCHIVE" || { echo 'Package does not match release.json' >&2; exit 1; }
IMAGE="zjugis-one-api:$VERSION"
CONTAINER=dsh-one-api
GATEWAY=dsh-experts-gateway
STATE=''
BACKUP=''
NEW_ID=''
RESOURCE_BIND=''
UPDATE_BIND=''
# Public verification key only. The checksummed release script owns this deployment setting.
UPDATE_PUBLIC_KEY='dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDE1RDdEQURENzA4OTRFRTcKUldUblRvbHczZHJYRlg3S00xdk1maXZiVWtnb3cyd1ZQa1loZDV6Q3VWZzZSK2J2aks5S09mN2wK'
CHANGING=0
die() { echo "ERROR: $*" >&2; exit 1; }
prepare_layout() {
  local path
  for path in /root/dsh /root/dsh/builds /root/dsh/updates /root/dsh/backups /root/dsh/backups/database /root/dsh/backups/migrations /root/dsh/data /root/dsh/releases; do
    test ! -L "$path" || die "Storage directory must not be a symlink: $path"
    mkdir -p -- "$path"
    test -d "$path" && test "$(realpath -e -- "$path")" = "$path" || die "Invalid storage directory: $path"
  done
}
validate_archive() {
  python3 -I - "$ARCHIVE" <<'SAFE'
import pathlib, sys, tarfile
seen = set()
required = {'Dockerfile', 'go.mod', 'go.sum', 'web/air/package-lock.json', 'web/org-admin/package-lock.json'}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for m in archive:
        p = pathlib.PurePosixPath(m.name)
        assert not p.is_absolute() and '..' not in p.parts and '\\' not in m.name, 'Unsafe archive path'
        assert p.parts[:2] == ('services', 'one-api') or (p.parts == ('services',) and m.isdir()), 'Unexpected archive root'
        assert m.isfile() or m.isdir(), 'Links/devices are not permitted'
        assert p.as_posix() not in seen, 'Duplicate archive member'
        seen.add(p.as_posix())
assert all('services/one-api/' + p in seen for p in required), 'Required source files missing'
SAFE
}
validate_archive
if test "$ACTION" = verify; then echo "Verified: $VERSION commit=$COMMIT source=$SOURCE_SHA"; exit 0; fi
for cmd in docker curl python3 sha256sum tar flock realpath; do command -v "$cmd" >/dev/null || die "Missing command: $cmd"; done
test -S /var/run/docker.sock || die 'Requires local Docker socket /var/run/docker.sock.'
# All CLI operations must address the same local daemon as the Python Docker API.
unset DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
export DOCKER_HOST=unix:///var/run/docker.sock
test "$(id -u)" = 0 || die 'Run as root (or sudo bash).'
exec 9>/var/lock/dsh-one-api-update.lock
flock -n 9 || die 'Another OneAPI build/update is in progress.'
prepare_layout

inspect_and_validate() {
  docker inspect "$CONTAINER" > "$1"
  python3 -I - "$1" "${2:-strict}" "$UPDATE_PUBLIC_KEY" <<'PY'
import base64, json, sys, posixpath
with open(sys.argv[1], encoding='utf-8') as f:
    c = json.load(f)[0]
h = c['HostConfig']
assert c['State']['Running'], 'Existing OneAPI must be running'
assert h['PortBindings'] == {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '13300'}]}, 'Expected ONLY 127.0.0.1:13300 -> 3000; refusing to change port topology'
assert set(c['NetworkSettings']['Networks']) == {'dsh-internal'}, 'Unexpected Docker networks'
assert h['NetworkMode'] == 'dsh-internal', 'Unexpected network mode'
assert not h.get('AutoRemove'), 'AutoRemove is unsupported'
assert not h.get('VolumesFrom'), 'VolumesFrom is unsupported'
assert not c['Config'].get('Volumes'), 'Anonymous volumes require manual review'
assert all(m['Type'] == 'bind' or (m['Type'] == 'volume' and m.get('Name')) for m in c.get('Mounts', [])), 'Unsupported mounts'
resource_root = '/data/desktop-resources'
for entry in c['Config'].get('Env', []):
    if entry.startswith('DESKTOP_RESOURCE_DIR=') and entry.split('=', 1)[1]:
        resource_root = entry.split('=', 1)[1]
assert resource_root.startswith('/'), 'DESKTOP_RESOURCE_DIR must be absolute'
resource_root = posixpath.normpath(resource_root)
persisted = any(
    m.get('RW', True) and m['Type'] in ('bind', 'volume')
    and (resource_root == posixpath.normpath(m.get('Destination', ''))
         or resource_root.startswith(posixpath.normpath(m.get('Destination', '')).rstrip('/') + '/'))
    for m in c.get('Mounts', []) if m.get('Destination') and m['Destination'] != '/'
)
if not persisted:
    assert sys.argv[2] == 'allow-init' and not c.get('Mounts') and resource_root == '/data/desktop-resources', 'Offline resources need a writable persistent mount; existing/custom storage requires manual review; no container was stopped'
    assert not h.get('Binds') and not h.get('Mounts'), 'Unexpected existing mount configuration'
    print('Validated: legacy container has no mounts; deploy will add a dedicated resource directory only.')
else:
    print('Validated: offline resource storage is persisted by an existing writable mount.')

key = sys.argv[3]
key_lines = base64.b64decode(key, validate=True).decode('utf-8').splitlines()
assert len(key_lines) == 2 and key_lines[0].startswith('untrusted comment: '), 'Invalid packaged public key'
raw_key = base64.b64decode(key_lines[1], validate=True)
assert len(raw_key) == 42 and raw_key[:2] == b'Ed', 'Invalid packaged public key'
env = dict(e.split('=', 1) for e in c['Config'].get('Env', []))
existing_key = env.get('DESKTOP_UPDATE_PUBLIC_KEY', '')
assert existing_key in ('', key), 'Existing desktop public key differs; explicit key rotation required; old container was not stopped'
assert sys.argv[2] == 'allow-init' or existing_key == key, 'Desktop update public key was not applied'
update_root = env.get('DESKTOP_UPDATE_DIR') or '/data/wanwei/desktop-updates'
assert update_root.startswith('/') and posixpath.normpath(update_root) == update_root, 'Invalid DESKTOP_UPDATE_DIR'
# The deepest mount determines writability; a read-only child overrides a writable parent.
covering = [m for m in c.get('Mounts', []) if m.get('Destination') not in (None, '', '/')
            and (update_root == m['Destination'] or update_root.startswith(m['Destination'].rstrip('/') + '/'))]
mount = max(covering, key=lambda m: len(m['Destination']), default=None)
if mount:
    assert mount.get('RW', True), 'Desktop update storage mount is read-only'
else:
    assert sys.argv[2] == 'allow-init' and update_root == '/data/wanwei/desktop-updates', 'Desktop updates need writable persistent storage; custom storage requires manual migration'
    assert not any(m.get('Destination', '').startswith(update_root + '/') for m in c.get('Mounts', [])), 'Nested desktop update mounts require manual review'
    print('Validated: deploy will add dedicated persistent desktop update storage.')
print('Validated: desktop update public key matches the release (or will be initialized).')

assert any(e.startswith('SQL_DSN=') and e.split('=', 1)[1] for e in c['Config'].get('Env', [])), 'External SQL_DSN required; embedded SQLite update is unsupported'
for e in c['Config']['Env']:
    assert '\n' not in e and '\r' not in e, 'Multiline environment requires manual review'
n = c['NetworkSettings']['Networks']['dsh-internal']
assert not any((n.get('IPAMConfig') or {}).values()), 'Static network addresses require manual review'
print('Validated: preserve existing config, network and localhost:13300 mapping.')
PY
  test "$(docker inspect -f '{{.State.Running}}' "$GATEWAY")" = true || die 'Gateway is not running.'
  test "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$GATEWAY")" = host || die 'Unexpected gateway network mode.'
  curl -fsS --max-time 10 http://127.0.0.1:13300/api/status >/dev/null
  health
}
health() {
  curl -fsS --max-time 10 -H 'Host: ac.zjugis.com' http://127.0.0.1:3300/api/status >/dev/null
  local expert
  for expert in meeting-minutes document-processing file-conversion geology third-survey planning-review; do
    curl -fsS --max-time 10 -H 'Host: ac.zjugis.com' "http://127.0.0.1:3300/experts/$expert/readyz" >/dev/null
  done
}
image_matches() {
  test "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE")" = "$COMMIT" &&
  test "$(docker image inspect -f '{{index .Config.Labels "io.wanwei.oneapi.source-sha256"}}' "$IMAGE")" = "$SOURCE_SHA"
}
build() {
  if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    image_matches || die 'Version tag already exists with different/unverified source. Use a new version.'
    echo "Image already built and verified: $IMAGE"
    return
  fi
  test -s "$ARCHIVE" && test -s "$HERE/SHA256SUMS" || die 'Missing source archive or checksum.'
  (cd "$HERE" && sha256sum -c SHA256SUMS)
  local context
  context=$(mktemp -d /root/dsh/builds/one-api-build.XXXXXXXX)
  tar -xzf "$ARCHIVE" -C "$context"
  docker build --pull --build-arg "PARVIS_VERSION=$VERSION" \
    --label "org.opencontainers.image.revision=$COMMIT" \
    --label "org.opencontainers.image.version=$VERSION" \
    --label "io.wanwei.oneapi.source-sha256=$SOURCE_SHA" \
    -t "$IMAGE" "$context/services/one-api"
  echo "Image built: $IMAGE. Build source retained at $context"
}
rollback_on_exit() {
  local code=$?
  trap - EXIT INT TERM
  if test "$CHANGING" = 1; then
    echo 'Update failed/interrupted; restoring old OneAPI container (NOT database).' >&2
    local current=''
    current=$(docker inspect -f '{{.Id}}' "$CONTAINER" 2>/dev/null) || true
    if test -n "$current" && test "$current" != "$OLD_ID"; then
      if test -n "$NEW_ID" && test "$current" = "$NEW_ID"; then
        # Capture startup evidence before stopping; keep it private because logs
        # may contain database addresses or other sensitive application output.
        docker logs --timestamps --tail 300 "$current" > "$STATE/failed-startup.log" 2>&1 || true
        docker inspect --format '{{json .State}}' "$current" > "$STATE/failed-state.json" 2>/dev/null || true
        local failed_name="dsh-one-api-failed-$VERSION-$(basename "$STATE")"
        docker stop --time 10 "$current" >/dev/null || { echo 'Cannot stop new container; manual recovery required.' >&2; exit 1; }
        docker rename "$current" "$failed_name" || { echo 'Cannot retain failed container; manual recovery required.' >&2; exit 1; }
        printf '%s\n' "$failed_name" > "$STATE/failed-container-name"
        echo "Failed container retained (stopped): $failed_name" >&2
        echo "Startup diagnostics (private): $STATE/failed-startup.log and $STATE/failed-state.json" >&2
      else
        echo 'Unknown container owns dsh-one-api; refusing removal. Manual recovery required.' >&2
        exit 1
      fi
    fi
    if docker inspect "$BACKUP" >/dev/null 2>&1; then docker rename "$BACKUP" "$CONTAINER"; fi
    docker start "$CONTAINER" >/dev/null || { echo 'Old container restart failed.' >&2; exit 1; }
    echo "Old container restored. State: $STATE. Check database migration compatibility." >&2
  fi
  exit "$code"
}
validate_db_backup() {
  if test "$#" = 2 && test "${2:-}" = --skip-db-backup; then
    echo 'WARNING: database backup explicitly skipped. Container rollback cannot undo database migrations.' >&2
    DB_BACKUP_RECORD='SKIPPED: operator explicitly accepted database migration risk'
  elif test "$#" = 3 && test "${2:-}" = --db-backup && test -n "${3:-}"; then
    test "${3:0:1}" = / && test -f "$3" && test -s "$3" || die 'A nonempty existing database backup file is required.'
    DB_BACKUP_RECORD=$3
  else
    die "Usage: bash $0 deploy --db-backup /absolute/backup.sql OR deploy --skip-db-backup"
  fi
}
deploy() {
  validate_db_backup "$@"
  docker image inspect "$IMAGE" >/dev/null || die 'Build the image first.'
  image_matches || die 'Image provenance mismatch; refusing deployment.'
  STATE=$(mktemp -d /root/dsh/updates/one-api-update.XXXXXXXX)
  inspect_and_validate "$STATE/old-container.json" allow-init
  if test "$(docker inspect -f '{{len .Mounts}}' "$CONTAINER")" = 0; then
    # Never hide pre-existing files in the writable container layer.
    docker exec "$CONTAINER" sh -c 'test ! -e /data/desktop-resources && test ! -L /data/desktop-resources' \
      || die 'Existing resource directory or exec failure; manual migration required. Old container was not stopped.'
    test ! -L /root/dsh && test ! -L /root/dsh/data || die 'Storage parents must not be symlinks.'
    mkdir -p /root/dsh/data
    RESOURCE_BIND=$(mktemp -d /root/dsh/data/one-api-resources.XXXXXXXX)
    chmod 700 "$RESOURCE_BIND"
    printf '%s\n' "$RESOURCE_BIND" > "$STATE/resource-bind-path"
    echo "Adding persistent resource storage: $RESOURCE_BIND -> /data/desktop-resources"
  fi
  local update_persisted
  update_persisted=$(python3 -I - "$STATE/old-container.json" <<'UPDATES'
import json, sys
c = json.load(open(sys.argv[1], encoding='utf-8'))[0]
env = dict(e.split('=', 1) for e in c['Config'].get('Env', []))
root = env.get('DESKTOP_UPDATE_DIR') or '/data/wanwei/desktop-updates'
print(int(any(m.get('Destination') not in (None, '', '/') and
              (root == m['Destination'] or root.startswith(m['Destination'].rstrip('/') + '/'))
              for m in c.get('Mounts', []))))
UPDATES
  )
  update_persisted=${update_persisted%$'\r'}
  if test "$update_persisted" = 0; then
    docker exec "$CONTAINER" sh -c 'test ! -e /data/wanwei/desktop-updates && test ! -L /data/wanwei/desktop-updates' \
      || die 'Existing desktop update directory or exec failure; migrate storage manually. Old container was not stopped.'
    test ! -L /root/dsh && test ! -L /root/dsh/data || die 'Storage parents must not be symlinks.'
    mkdir -p /root/dsh/data
    UPDATE_BIND=$(mktemp -d /root/dsh/data/one-api-updates.XXXXXXXX)
    chmod 700 "$UPDATE_BIND"
    printf '%s\n' "$UPDATE_BIND" > "$STATE/update-bind-path"
    echo "Adding persistent desktop update storage: $UPDATE_BIND -> /data/wanwei/desktop-updates"
  fi
  printf '%s\n' "$DB_BACKUP_RECORD" > "$STATE/db-backup-path"
  OLD_ID=$(docker inspect -f '{{.Id}}' "$CONTAINER")
  local image_id
  image_id=$(docker image inspect -f '{{.Id}}' "$IMAGE")
  BACKUP="dsh-one-api-before-$VERSION-$(date +%Y%m%d%H%M%S)"
  test -z "$(docker ps -aq --filter "name=^/$BACKUP$")" || die 'Backup name already exists.'
  printf '%s\n' "$BACKUP" > "$STATE/backup-container-name"
  printf '%s\n' "$image_id" > "$STATE/new-image-id"
  trap rollback_on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  CHANGING=1
  echo 'Stopping old OneAPI; gateway and expert containers remain unchanged.'
  docker stop "$CONTAINER" >/dev/null
  docker rename "$CONTAINER" "$BACKUP"
  # Docker API copies Config/HostConfig instead of silently dropping env, mounts,
  # resource limits, restart policy, command, labels, logging or security options.
  NEW_ID=$(python3 -I - "$STATE/old-container.json" "$image_id" "$OLD_ID" "$RESOURCE_BIND" "$UPDATE_BIND" "$UPDATE_PUBLIC_KEY" <<'PY'
import copy, http.client, json, socket, sys
class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(60)
        self.sock.connect('/var/run/docker.sock')
def request(method, path, body=None):
    conn = DockerConnection('localhost', timeout=60)
    conn.request(method, path, body=json.dumps(body) if body is not None else None,
                 headers={'Content-Type': 'application/json'})
    r = conn.getresponse()
    data = json.loads(r.read())
    if r.status >= 300:
        raise RuntimeError('Docker create failed; see Docker daemon logs (config not printed to protect secrets)')
    return data
with open(sys.argv[1], encoding='utf-8') as f:
    c = json.load(f)[0]
body = copy.deepcopy(c['Config'])
body['Image'] = sys.argv[2]
if body.get('Hostname') in (sys.argv[3], sys.argv[3][:12]):
    body['Hostname'] = ''
body['HostConfig'] = copy.deepcopy(c['HostConfig'])
resource_bind = sys.argv[4]
update_bind, public_key = sys.argv[5:7]
env = dict(e.split('=', 1) for e in body.get('Env', []))
assert env.get('DESKTOP_UPDATE_PUBLIC_KEY', '') in ('', public_key), 'Refusing implicit key rotation'
body['Env'] = [e for e in body.get('Env', []) if not e.startswith('DESKTOP_UPDATE_PUBLIC_KEY=')]
body['Env'].append('DESKTOP_UPDATE_PUBLIC_KEY=' + public_key)
if resource_bind:
    assert not c.get('Mounts') and not body['HostConfig'].get('Binds') and not body['HostConfig'].get('Mounts'), 'Refusing to replace existing mounts'
    assert resource_bind.startswith('/root/dsh/data/one-api-resources.') and '/' not in resource_bind[len('/root/dsh/data/one-api-resources.'):], 'Unexpected resource storage path'
    body['HostConfig']['Mounts'] = [{'Type': 'bind', 'Source': resource_bind,
                                    'Target': '/data/desktop-resources', 'ReadOnly': False}]
if update_bind:
    prefix = '/root/dsh/data/one-api-updates.'
    assert update_bind.startswith(prefix) and update_bind[len(prefix):] and '/' not in update_bind[len(prefix):], 'Unexpected update storage path'
    root = env.get('DESKTOP_UPDATE_DIR') or '/data/wanwei/desktop-updates'
    assert root == '/data/wanwei/desktop-updates', 'Custom update storage requires manual migration'
    assert not any(m.get('Destination') and (root == m['Destination'] or root.startswith(m['Destination'].rstrip('/') + '/') or m['Destination'].startswith(root + '/')) for m in c.get('Mounts', [])), 'Refusing overlapping update storage mounts'
    if not body['HostConfig'].get('Mounts'):
        body['HostConfig']['Mounts'] = []
    body['HostConfig']['Mounts'].append({'Type': 'bind', 'Source': update_bind,
                                       'Target': root, 'ReadOnly': False})
oldnet = c['NetworkSettings']['Networks']['dsh-internal']
aliases = [a for a in oldnet.get('Aliases') or [] if a not in (sys.argv[3], sys.argv[3][:12])]
body['NetworkingConfig'] = {'EndpointsConfig': {'dsh-internal': {'Aliases': aliases}}}
api = request('GET', '/version')['ApiVersion']
result = request('POST', '/v'+api+'/containers/create?name=dsh-one-api', body)
print(result['Id'])
PY
  )
  printf '%s\n' "$NEW_ID" > "$STATE/new-container-id"
  echo 'Starting new OneAPI and waiting for localhost:13300/api/status.'
  docker start "$NEW_ID" >/dev/null
  local ready=0 attempt container_state started_at=$SECONDS
  for attempt in {1..60}; do
    if curl -fsS --max-time 3 http://127.0.0.1:13300/api/status 2>/dev/null | \
      python3 -I -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("success") is True and d.get("data",{}).get("version")==sys.argv[1] else 1)' "$VERSION" 2>/dev/null; then ready=1; break; fi
    container_state=$(docker inspect -f '{{.State.Status}}' "$NEW_ID" 2>/dev/null) || container_state=unknown
    if (( attempt == 1 || attempt % 5 == 0 )); then
      echo "Waiting for OneAPI: attempt $attempt/60, elapsed $((SECONDS - started_at))s, container=$container_state"
    fi
    case "$container_state" in
      exited|dead) die 'New OneAPI exited before becoming healthy; startup logs will be retained.';;
    esac
    sleep 2
  done
  test "$ready" = 1 || die 'New OneAPI did not become healthy.'
  inspect_and_validate "$STATE/new-container.json"
  CHANGING=0
  trap - EXIT INT TERM
  echo "Updated: $IMAGE. Gateway and expert configs were NOT changed."
  echo "Old container retained (stopped): $BACKUP"
  echo "Private state (contains credentials; do NOT share): $STATE"
  if test -n "$RESOURCE_BIND"; then echo "Offline resources are persisted at: $RESOURCE_BIND"; fi
  if test -n "$UPDATE_BIND"; then echo "Desktop update packages are persisted at: $UPDATE_BIND"; fi
  echo 'Desktop update public key and writable persistent mount verified; clients download through their connected backend.'
  echo 'Next: verify admin login, usage statistics, ticket verification and all six expert submissions.'
}
case "$ACTION" in
  check)
    CHECK=$(mktemp /root/dsh/updates/one-api-check.XXXXXXXX)
    trap 'rm -f -- "$CHECK"' EXIT
    inspect_and_validate "$CHECK" allow-init
    echo 'Gateway topology and six readyz checks passed; no deployment performed.';;
  build) build;;
  deploy) deploy deploy "${DB_ARGS[@]}";;
  update) validate_db_backup deploy "${DB_ARGS[@]}"; build; deploy deploy "${DB_ARGS[@]}";;
  status) health; echo 'Gateway and six experts are reachable.';;
  *) die "Usage: bash $0 verify|check|build|update|deploy|status [--package archive] [--db-backup /absolute/backup.sql|--skip-db-backup]";;
esac
