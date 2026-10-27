#!/usr/bin/env bash
set -euo pipefail

# Deploy this directory independently. Only this service is created.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
service_dir=$(pwd -P)
container=wanwei-coming-soon
for command in docker python3 curl; do
    command -v "$command" >/dev/null || { echo "Missing command: $command"; exit 1; }
done
test -s index.html
test -s service.nginx.conf
if docker container inspect "$container" >/dev/null 2>&1; then
    echo "Container $container already exists; stopped without replacing it."
    exit 1
fi

# Refuse stale security hashes or an occupied port before creating anything.
python3 - <<'PY'
from pathlib import Path
import base64
import hashlib
import re
import socket
html = Path('index.html').read_text(encoding='utf-8')
conf = Path('service.nginx.conf').read_text(encoding='utf-8')
for tag in ('script', 'style'):
    source = re.search(r'<' + tag + r'>([\s\S]*?)</' + tag + r'>', html)[1]
    digest = base64.b64encode(hashlib.sha256(source.encode()).digest()).decode()
    if f"{tag}-src 'sha256-{digest}'" not in conf:
        raise SystemExit(f'Stale {tag} CSP hash; stopped.')
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 3317))
print('Validated: page hashes and available local port 3317.')
PY

# Reuse the exact local image ID. Do not pull or change the gateway container.
image=$(docker inspect --format '{{.Image}}' dsh-experts-gateway)
chmod 644 index.html service.nginx.conf
docker run --rm --pull=never --network none --read-only \
    --tmpfs /tmp:rw,nosuid,nodev,size=16m \
    -v "$service_dir/service.nginx.conf:/etc/nginx/nginx.conf:ro" \
    -v "$service_dir/index.html:/usr/share/nginx/wanwei-coming-soon/index.html:ro" \
    --entrypoint nginx "$image" -t

docker run -d --pull=never --name "$container" \
    --label com.wanwei.service=coming-soon \
    --network host --restart unless-stopped --read-only \
    --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,size=16m \
    -v "$service_dir/service.nginx.conf:/etc/nginx/nginx.conf:ro" \
    -v "$service_dir/index.html:/usr/share/nginx/wanwei-coming-soon/index.html:ro" \
    --entrypoint nginx "$image" -g 'daemon off;'

if ! curl --fail --silent --show-error --max-time 5 \
    --retry 10 --retry-connrefused --retry-delay 1 \
    http://127.0.0.1:3317/ -o /dev/null; then
    echo "Service check failed. Inspect: docker logs --tail 50 $container"
    exit 1
fi
echo "Started: $container, listening on 127.0.0.1:3317 only."
echo "URL: http://ac.zjugis.com:3300/experts/coming-soon/"
echo "Keep this directory in place: $service_dir"
