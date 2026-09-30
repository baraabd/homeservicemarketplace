#!/usr/bin/env bash
set -euo pipefail

MINIO_VERSION='RELEASE.2025-10-15T17-29-55Z'
GO_VERSION='go1.24.8'
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
  GOBIN="$DEST_DIR" go install "github.com/minio/minio@${MINIO_VERSION}" > >(tee -a "$LOG_FILE") 2> >(tee -a "$LOG_FILE" >&2)
  status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    version_output="$("$DEST_DIR/minio" --version 2>&1)"
    if ! grep -Fq "$MINIO_VERSION" <<<"$version_output"; then
      echo "Built MinIO binary does not report the pinned release $MINIO_VERSION" >&2
      exit 1
    fi
    echo "Installed checksum-verified MinIO source release $MINIO_VERSION with $GO_VERSION"
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
