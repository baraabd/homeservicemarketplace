#!/usr/bin/env bash
set -euo pipefail

MINIO_VERSION='RELEASE.2025-10-15T17-29-55Z'
GO_VERSION='go1.24.8'
MODULE='github.com/minio/minio'
DEST_DIR="${1:?destination directory is required}"
LOG_FILE="${RUNNER_TEMP:-/tmp}/minio-fixture-install.log"
mkdir -p "$DEST_DIR"

if [[ "$(go env GOVERSION)" != "$GO_VERSION" ]]; then
  echo "Expected $GO_VERSION, got $(go env GOVERSION)" >&2
  exit 1
fi

export GOTOOLCHAIN=local
export GOSUMDB=sum.golang.org

is_transient_network_failure() {
  grep -Eiq 'stream error|INTERNAL_ERROR|TLS handshake timeout|connection reset by peer|unexpected EOF|i/o timeout|proxy\.golang\.org.*(502|503|timeout)|sum\.golang\.org.*(stream error|INTERNAL_ERROR|502|503|timeout)' "$LOG_FILE"
}

for attempt in 1 2 3; do
  : > "$LOG_FILE"

  set +e
  expected_module_version="$(
    go list -m -f '{{.Version}}' "${MODULE}@${MINIO_VERSION}"       2> >(tee -a "$LOG_FILE" >&2)
  )"
  status=$?
  if [[ $status -eq 0 ]]; then
    GOBIN="$DEST_DIR" go install "${MODULE}@${MINIO_VERSION}"       > >(tee -a "$LOG_FILE") 2> >(tee -a "$LOG_FILE" >&2)
    status=$?
  fi
  set -e

  if [[ $status -eq 0 ]]; then
    embedded_module_version="$(
      go version -m "$DEST_DIR/minio" |
        awk '$1 == "mod" && $2 == "github.com/minio/minio" { print $3 }'
    )"
    if [[ -z "$expected_module_version" || "$embedded_module_version" != "$expected_module_version" ]]; then
      echo "Built MinIO binary module metadata does not match the checksum-verified source resolution." >&2
      exit 1
    fi
    echo "Installed checksum-verified MinIO source $MINIO_VERSION as module $expected_module_version with $GO_VERSION"
    exit 0
  fi

  if ! is_transient_network_failure; then
    echo "MinIO build failed for a non-network reason; refusing to retry." >&2
    exit "$status"
  fi

  if [[ $attempt -eq 3 ]]; then
    echo "MinIO build still failed after three checksum-verified network attempts." >&2
    exit "$status"
  fi

  sleep $((attempt * 5))
done
