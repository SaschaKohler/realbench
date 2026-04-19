#!/bin/bash

# Build script for C++ test programs
# Cross-compiles to Linux ELF for RealBench profiler testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Building C++ test programs for RealBench profiler..."

# Detect platform
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Detected Linux - building native binaries..."
    ./build_native.sh
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected macOS - cross-compiling to Linux ELF..."
    ./crosscompile.sh
else
    echo "Unsupported platform: $OSTYPE"
    echo "Use ./build_native.sh on Linux or ./crosscompile.sh on macOS"
    exit 1
fi

echo ""
echo "✅ Build completed!"
echo ""
echo "Available test binaries:"
if [ -d "linux-binaries" ]; then
    echo "  Linux ELF binaries (for RealBench profiler):"
    echo "    ./linux-binaries/cpu_intensive              - CPU-bound computations"
    echo "    ./linux-binaries/memory_allocation          - Memory allocation patterns"
    echo "    ./linux-binaries/multithreading             - Threading and synchronization"
    echo "    ./linux-binaries/algorithmic_complexity     - Various algorithmic complexities"
    echo ""
    echo "Usage with RealBench profiler:"
    echo "  realbench profile ./linux-binaries/cpu_intensive"
    echo "  realbench profile ./linux-binaries/memory_allocation"
    echo "  realbench profile ./linux-binaries/multithreading"
    echo "  realbench profile ./linux-binaries/algorithmic_complexity"
fi

if [ -d "build/tests" ]; then
    echo "  Native binaries (local testing only):"
    echo "    ./build/tests/cpu_intensive"
    echo "    ./build/tests/memory_allocation"
    echo "    ./build/tests/multithreading"
    echo "    ./build/tests/algorithmic_complexity"
fi
