#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${1:-$script_directory/.env}"

[[ -f "$env_file" ]] || {
  echo "Configuration file does not exist: $env_file" >&2
  echo "Copy .env.example to .env and fill in the real values first." >&2
  exit 1
}
command -v docker >/dev/null 2>&1 || {
  echo "Docker is required on the offline server." >&2
  exit 1
}
docker info >/dev/null

env_value() {
  local key="$1"
  awk -v key="$key" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
    END { sub(/\r$/, "", value); print value }
  ' "$env_file"
}

env_default() {
  local value
  value="$(env_value "$1")"
  printf '%s' "${value:-$2}"
}

env_required() {
  local value
  value="$(env_value "$1")"
  if [[ -z "$value" || "$value" == *CHANGE_ME* ]]; then
    echo "Missing configuration or placeholder remains: $1" >&2
    exit 1
  fi
  printf '%s' "$value"
}

version="$(env_required DSH_VERSION)"
image="dsh-one-api:$version"
container="dsh-one-api"
network="dsh-internal"

docker image inspect "$image" >/dev/null 2>&1 || {
  echo "Image is missing: $image. Run load-offline-images.sh first." >&2
  exit 1
}
if docker container inspect "$container" >/dev/null 2>&1; then
  echo "Container already exists and was not replaced: $container" >&2
  echo "Have an operator stop and remove the old DSH container after confirming the upgrade." >&2
  exit 1
fi

tiktoken_cache="$(env_required DSH_TIKTOKEN_CACHE_HOST_DIR)"
[[ -d "$tiktoken_cache" ]] || {
  echo "Tiktoken cache directory does not exist: $tiktoken_cache" >&2
  exit 1
}

docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null
docker volume inspect dsh-oneapi-data >/dev/null 2>&1 || docker volume create dsh-oneapi-data >/dev/null
docker volume inspect dsh-oneapi-logs >/dev/null 2>&1 || docker volume create dsh-oneapi-logs >/dev/null

one_api_port="$(env_default DSH_ONEAPI_PORT 3300)"
one_api_bind="$(env_default DSH_ONEAPI_BIND 127.0.0.1)"
cors_allow_origins="$(env_default DSH_CORS_ALLOW_ORIGINS 'http://tauri.localhost,tauri://localhost')"

# Keep this mount writable: a connected deployment may need to download a
# tokenizer encoding on its first start. Offline deployments can still use
# a pre-populated cache from the same directory.
docker run -d \
  --name "$container" \
  --restart unless-stopped \
  --network "$network" \
  -p "${one_api_bind}:${one_api_port}:3000" \
  -v dsh-oneapi-data:/data \
  -v dsh-oneapi-logs:/data/logs \
  -v "$tiktoken_cache:/opt/tiktoken-cache" \
  -e TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache \
  -e TZ=Asia/Shanghai \
  -e GIN_MODE=release \
  -e PORT=3000 \
  -e ORG_PORTAL_PORT=3001 \
  -e "SQL_DSN=$(env_required DSH_SQL_DSN)" \
  -e "ACCOUNT_SQL_DSN=$(env_required DSH_ACCOUNT_SQL_DSN)" \
  -e "SESSION_SECRET=$(env_required DSH_SESSION_SECRET)" \
  -e "SERVER_ADDRESS=$(env_required DSH_PUBLIC_BASE_URL)" \
  -e PARVIS_DEPLOYMENT_MODE=private \
  -e PARVIS_CAPABILITIES= \
  -e "PARVIS_CHANNEL_KEY_ENCRYPTION_KEY=$(env_required DSH_CHANNEL_KEY_ENCRYPTION_KEY)" \
  -e PARVIS_PROVINCE_SSO_ENABLED=false \
  -e PARVIS_RELEASE_DETECTION_ENABLED=false \
  -e "CORS_ALLOW_ORIGINS=$cors_allow_origins" \
  --health-cmd "wget --quiet --spider http://127.0.0.1:3000/api/status || exit 1" \
  --health-interval 10s \
  --health-timeout 5s \
  --health-retries 20 \
  --health-start-period 30s \
  "$image" >/dev/null

echo "DSH service container started."
docker ps --filter name="$container" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
