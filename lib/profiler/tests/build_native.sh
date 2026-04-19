#!/bin/bash

# Native build script for Linux systems
# Builds C++ test programs with debug symbols for profiling

set -e

echo "Building native Linux binaries..."

# Compiler flags for profiling
CXX_FLAGS="-g -O2 -std=c++17 -Wall -Wextra"
LINK_FLAGS="-pthread"

# Create build directory
mkdir -p build/tests

# Compile CPU intensive test
echo "Compiling cpu_intensive.cpp..."
g++ $CXX_FLAGS cpu_intensive.cpp -o build/tests/cpu_intensive $LINK_FLAGS

# Compile memory allocation test
echo "Compiling memory_allocation.cpp..."
g++ $CXX_FLAGS memory_allocation.cpp -o build/tests/memory_allocation $LINK_FLAGS

# Compile multithreading test
echo "Compiling multithreading.cpp..."
g++ $CXX_FLAGS multithreading.cpp -o build/tests/multithreading $LINK_FLAGS

# Compile algorithmic complexity test
echo "Compiling algorithmic_complexity.cpp..."
g++ $CXX_FLAGS algorithmic_complexity.cpp -o build/tests/algorithmic_complexity $LINK_FLAGS

# Verify ELF binaries
echo "Verifying ELF binaries..."
for binary in build/tests/*; do
    echo "  $(basename "$binary"): $(file "$binary")"
done

echo "Native build completed!"
