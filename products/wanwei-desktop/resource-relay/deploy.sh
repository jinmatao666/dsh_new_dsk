#!/usr/bin/env bash
set -euo pipefail
# Usage: bash deploy.sh <server-LAN-IPv4> [immutable-image-reference]
# Edit squid.conf's clients ACL first. Existing containers are never removed automatically.
bind_ip="${1:-}"
image="${2:-ubuntu/squid:latest}"
if [[ ! "$bind_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || [[ "$bind_ip" == 0.0.0.0 ]]; then
  echo 'Specify the server LAN IPv4 address; wildcard binding is not allowed.' >&2; exit 2
fi
IFS=. read -r a b c d <<< "$bind_ip"
for octet in "$a" "$b" "$c" "$d"; do
  if (( 10#$octet > 255 )); then echo 'Invalid IPv4 address.' >&2; exit 2; fi
done
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if docker container inspect wanwei-resource-relay >/dev/null 2>&1; then
  echo 'wanwei-resource-relay already exists. Inspect it before replacing it.' >&2; exit 2
fi
docker run --rm --mount "type=bind,source=$script_dir/squid.conf,target=/etc/squid/squid.conf,readonly" "$image" -k parse
docker run -d --name wanwei-resource-relay --restart unless-stopped \
  --publish "$bind_ip:3128:3128" \
  --mount "type=bind,source=$script_dir/squid.conf,target=/etc/squid/squid.conf,readonly" "$image"
echo "Proxy started: http://$bind_ip:3128. Restrict host firewall to the client subnet."
echo 'Logs: docker logs --tail 50 -f wanwei-resource-relay'
