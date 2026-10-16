#!/usr/bin/env bash
set -euo pipefail
# Test-only client, pinned upstream source verified through the public checksum DB.
DEST_DIR="${1:?destination directory is required}"
MC_MODULE='github.com/minio/mc@v0.0.0-20251106162529-77f82e18b540'
[[ "$(go env GOVERSION)" == 'go1.24.8' ]]
mkdir -p "$DEST_DIR"
GOTOOLCHAIN=local GOSUMDB=sum.golang.org GOBIN="$DEST_DIR" go install "$MC_MODULE"
go version -m "$DEST_DIR/mc" | grep -F 'v0.0.0-20251106162529-77f82e18b540'
