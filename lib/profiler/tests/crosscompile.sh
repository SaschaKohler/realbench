#!/bin/bash

# Cross-compilation script for Linux ELF binaries
# Uses Docker to build Linux x86_64 binaries from macOS

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Cross-compiling C++ test programs for Linux ELF..."

# Build Docker image
echo "Building cross-compilation Docker image..."
docker build -t realbench-test-crosscompile -f Dockerfile.crosscompile .

# Create output directory
mkdir -p linux-binaries

# Extract binaries from Docker image
echo "Extracting Linux ELF binaries..."
docker create --name temp-container realbench-test-crosscompile
docker cp temp-container:/tests/. linux-binaries/
docker rm temp-container

# Verify binaries
echo "Verifying Linux ELF binaries..."
echo "Binary information:"
for binary in linux-binaries/*; do
    if [ -f "$binary" ]; then
        echo "  $(basename "$binary"): $(file "$binary")"
        echo "    Size: $(du -h "$binary" | cut -f1)"
    fi
done

echo ""
echo "✅ Cross-compilation completed!"
echo ""
echo "Available Linux ELF binaries:"
echo "  ./linux-binaries/cpu_intensive"
echo "  ./linux-binaries/memory_allocation"
echo "  ./linux-binaries/multithreading"
echo "  ./linux-binaries/algorithmic_complexity"
echo ""
echo "Usage with RealBench profiler:"
echo "  realbench profile ./linux-binaries/cpu_intensive"
echo "  realbench profile ./linux-binaries/memory_allocation"
echo "  realbench profile ./linux-binaries/multithreading"
echo "  realbench profile ./linux-binaries/algorithmic_complexity"
echo ""
echo "Test locally with Linux (if available):"
echo "  # Copy to Linux machine and run:"
echo "  scp linux-binaries/* user@linux-machine:/tmp/"
echo "  ssh user@linux-machine '/tmp/cpu_intensive'"
