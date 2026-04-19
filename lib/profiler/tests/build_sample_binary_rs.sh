#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$SCRIPT_DIR/sample_binary_rs"

docker run --rm \
    --platform linux/amd64 \
    -v "$SCRIPT_DIR:/src" \
    -w /src \
    rust:latest \
    sh -c "rustup target add x86_64-unknown-linux-musl 2>/dev/null; \
           rustc -g -C opt-level=0 -C panic=abort \
               --edition 2021 \
               --target x86_64-unknown-linux-musl \
               -o /src/sample_binary_rs \
               /src/sample_binary.rs"

echo "Built: $OUT"
file "$OUT"
