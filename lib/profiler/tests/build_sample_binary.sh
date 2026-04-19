#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SCRIPT_DIR/sample_binary_debug"

docker run --rm \
    --platform linux/amd64 \
    -v "$SCRIPT_DIR:/src" \
    gcc:latest \
    g++ -std=c++20 -g -O0 -static -o /src/sample_binary_debug /src/sample_binary.cpp

echo "Built: $OUT"
file "$OUT"
