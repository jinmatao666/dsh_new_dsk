#!/usr/bin/env bash
set -Eeuo pipefail

version="${1:-}"
output_directory="${2:-}"

if [[ -z "$version" || ! "$version" =~ ^[0-9A-Za-z._-]+$ ]]; then
  echo "Usage: build-offline-images.sh <version> [output-directory]" >&2
  exit 2
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_directory/../.." && pwd)"
if [[ -z "$output_directory" ]]; then
  output_directory="$repo_root/private-deployment-output"
fi
mkdir -p "$output_directory"
output_directory="$(cd "$output_directory" && pwd)"

for command in docker tar sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command is missing: $command" >&2
    exit 1
  }
done
docker info >/dev/null

image="dsh-one-api:$version"
image_archive="$output_directory/dsh-server-images-$version.tar"
deployment_archive="$output_directory/dsh-deployment-files-$version.tar.gz"
alpine_mirror="${ALPINE_MIRROR:-mirrors.tuna.tsinghua.edu.cn/alpine}"
docker_mirror="${DOCKER_MIRROR:-docker.m.daocloud.io}"
go_proxy="${GO_PROXY:-https://goproxy.cn,direct}"
npm_registry="${NPM_REGISTRY:-https://registry.npmmirror.com}"
dsh_admin_public_url="${DSH_ADMIN_PUBLIC_URL:-/dsh-admin}"
dsh_api_public_url="${DSH_API_PUBLIC_URL:-/dsh-api}"

for artifact in \
  "$image_archive" \
  "$image_archive.sha256" \
  "$deployment_archive" \
  "$deployment_archive.sha256"; do
  if [[ -e "$artifact" ]]; then
    echo "Refusing to overwrite existing artifact: $artifact" >&2
    exit 1
  fi
done

docker build \
  --platform linux/amd64 \
  --build-arg "PARVIS_VERSION=$version" \
  --build-arg "ALPINE_MIRROR=$alpine_mirror" \
  --build-arg "DOCKER_MIRROR=$docker_mirror" \
  --build-arg "GO_PROXY=$go_proxy" \
  --build-arg "NPM_REGISTRY=$npm_registry" \
  --build-arg "DSH_ADMIN_PUBLIC_URL=$dsh_admin_public_url" \
  --build-arg "DSH_API_PUBLIC_URL=$dsh_api_public_url" \
  --file "$repo_root/services/one-api/Dockerfile" \
  --tag "$image" \
  "$repo_root/services/one-api"

docker image save --output "$image_archive" "$image"
(
  cd "$output_directory"
  sha256sum "$(basename "$image_archive")" >"$(basename "$image_archive").sha256"
)

staging_directory="$(mktemp -d)"
cleanup() {
  if [[ -n "${staging_directory:-}" && -d "$staging_directory" ]]; then
    rm -rf -- "$staging_directory"
  fi
}
trap cleanup EXIT

cp "$repo_root/deploy/private/.env.example" "$staging_directory/"
cp "$repo_root/deploy/private/nginx-dsh.locations.conf" "$staging_directory/"
cp "$repo_root/services/docker-compose.yml" "$staging_directory/docker-compose.yml"
cp "$repo_root/scripts/private-deployment/load-offline-images.sh" "$staging_directory/"
cp "$repo_root/scripts/private-deployment/start-offline.sh" "$staging_directory/"

tar -C "$staging_directory" -czf "$deployment_archive" .
(
  cd "$output_directory"
  sha256sum "$(basename "$deployment_archive")" >"$(basename "$deployment_archive").sha256"
)

echo "Image archive: $image_archive"
echo "Deployment archive: $deployment_archive"
echo "Transfer both archives and their .sha256 files to the offline server."
