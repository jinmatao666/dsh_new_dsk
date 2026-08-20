#!/usr/bin/env bash
set -Eeuo pipefail

archive="${1:-}"
[[ -n "$archive" ]] || {
  echo "Usage: load-offline-images.sh <dsh-server-images-version.tar>" >&2
  exit 2
}
[[ -f "$archive" ]] || {
  echo "Image archive does not exist: $archive" >&2
  exit 1
}
[[ -f "${archive}.sha256" ]] || {
  echo "Checksum file does not exist: ${archive}.sha256" >&2
  exit 1
}

for command in docker sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command is missing: $command" >&2
    exit 1
  }
done

(
  cd "$(dirname "$archive")"
  sha256sum --check "$(basename "${archive}.sha256")"
)
docker image load --input "$archive"
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^dsh-one-api:'
