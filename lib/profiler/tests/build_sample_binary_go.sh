#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SCRIPT_DIR/sample_binary_go"

docker run --rm \
    --platform linux/amd64 \
    -v "$SCRIPT_DIR:/src" \
    -e GOOS=linux \
    -e GOARCH=amd64 \
    -e CGO_ENABLED=0 \
    golang:latest \
    go build -gcflags="all=-N -l" -o /src/sample_binary_go /src/sample_binary.go

echo "Built: $OUT"
file "$OUT"
