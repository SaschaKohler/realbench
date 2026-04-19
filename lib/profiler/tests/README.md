# C++ Test Programs for Profiler Testing

This directory contains comprehensive C++ test programs designed to thoroughly test the RealBench profiler with various performance characteristics and scenarios.

## Test Programs

### 1. `cpu_intensive.cpp`
**Purpose**: Tests CPU-bound computational workloads
**Scenarios**:
- Matrix multiplication (O(n³))
- Prime number calculations
- Recursive Fibonacci
- Monte Carlo π estimation
- Floating-point intensive operations

**Expected Hotspots**:
- `MatrixMultiplier::multiply_matrices()`
- `PrimeCalculator::count_primes_up_to()`
- `fibonacci_recursive()`
- `compute_monte_carlo_pi()`

### 2. `memory_allocation.cpp`
**Purpose**: Tests memory allocation patterns and cache performance
**Scenarios**:
- Large chunk allocations
- Dynamic matrix operations
- Various allocation patterns (small, growing, random)
- Memory pressure tests (500MB allocation)
- Cache performance (sequential vs random access)

**Expected Hotspots**:
- `allocate_large_chunks()`
- `allocate_matrices()`
- `sequential_access()` vs `random_access()`
- Memory pressure loops

### 3. `multithreading.cpp`
**Purpose**: Tests multithreading and synchronization scenarios
**Scenarios**:
- CPU parallelism across multiple threads
- Memory-bound parallel operations
- Mutex contention tests
- Producer-consumer patterns
- Thread pool simulation
- Synchronization barriers

**Expected Hotspots**:
- `cpu_bound_worker()`
- `contested_mutex_worker()`
- Producer/consumer loops
- Thread synchronization points

### 4. `algorithmic_complexity.cpp`
**Purpose**: Tests different algorithmic complexity patterns
**Scenarios**:
- Sorting algorithms (O(n²) bubble sort, O(n log n) quicksort/merge sort)
- Search algorithms (O(n) linear, O(log n) binary)
- Data structure operations (trees, hash maps, graphs)
- Recursive algorithms (exponential Fibonacci, factorial permutations)
- Dynamic programming (O(n²) LCS, O(n³) matrix chain)

**Expected Hotspots**:
- `bubble_sort()` (quadratic complexity)
- `linear_search()` vs `binary_search()`
- `matrix_multiplication()` (cubic)
- `fibonacci_recursive()` (exponential)

## Building and Running

### Automated Cross-Compilation (Recommended)
The RealBench profiler runs on Linux, so test programs must be cross-compiled to Linux ELF binaries.

```bash
cd lib/profiler/tests
./compile_and_test.sh
```

This script automatically:
- Detects your platform (Linux/macOS)
- Cross-compiles to Linux ELF on macOS using Docker
- Builds native binaries on Linux
- Outputs ready-to-use Linux ELF binaries for profiling

### Platform-Specific Builds

#### On macOS (Cross-compilation)
```bash
# Cross-compile to Linux ELF using Docker
./crosscompile.sh
```

#### On Linux (Native Build)
```bash
# Build native Linux binaries
./build_native.sh
```

#### Manual Cross-Compilation
```bash
# Build Docker cross-compiler image
docker build -t realbench-test-crosscompile -f Dockerfile.crosscompile .

# Extract Linux ELF binaries
docker create --name temp-container realbench-test-crosscompile
docker cp temp-container:/tests/. linux-binaries/
docker rm temp-container
```

### Running Tests

#### Linux ELF Binaries (For RealBench Profiler)
```bash
# Profile with RealBench (recommended)
realbench profile ./linux-binaries/cpu_intensive
realbench profile ./linux-binaries/memory_allocation
realbench profile ./linux-binaries/multithreading
realbench profile ./linux-binaries/algorithmic_complexity
```

#### Native Binaries (Local Testing Only)
```bash
# Run locally (Linux only)
./build/tests/cpu_intensive
./build/tests/memory_allocation
./build/tests/multithreading
./build/tests/algorithmic_complexity
```

### Binary Verification
```bash
# Verify Linux ELF binaries
file linux-binaries/*
# Should show: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), dynamically linked
```

## Profiler Features Tested

### 1. Runtime Detection
- **C++ programs**: Should use `--call-graph dwarf,65528`
- **Symbol demangling**: C++ symbols should be properly demangled

### 2. Performance Characteristics
- **CPU-bound**: High CPU usage, clear hotspots
- **Memory-bound**: Memory allocation patterns, cache effects
- **I/O simulation**: Sleep patterns mixed with computation
- **Multithreaded**: Thread-specific profiling data

### 3. Algorithmic Complexity
- **O(1)**: Simple operations
- **O(log n)**: Binary search, tree operations
- **O(n)**: Linear search, simple loops
- **O(n log n)**: Efficient sorting, divide and conquer
- **O(n²)**: Bubble sort, nested loops
- **O(n³)**: Matrix multiplication
- **O(2ⁿ)**: Recursive Fibonacci
- **O(n!)**: Permutations

### 4. Memory Patterns
- **Sequential access**: Cache-friendly patterns
- **Random access**: Cache-unfriendly patterns
- **Strided access**: Cache line effects
- **Large allocations**: Memory pressure testing

### 5. Threading Scenarios
- **CPU parallelism**: Multiple CPU-bound threads
- **Contention**: Mutex hotspots
- **Synchronization**: Barrier and condition variables
- **Producer-consumer**: Queue operations

## Expected Profiler Output

Each test should generate:
1. **Flamegraph**: Visual representation of call stacks
2. **Hotspots**: Ranked list of CPU-intensive functions
3. **Call graph**: Function call relationships
4. **Performance metrics**: Timing and sample counts

## Testing Checklist

- [ ] All programs compile with debug symbols (`-g`)
- [ ] Profiler correctly identifies C++ runtime
- [ ] C++ symbols are properly demangled
- [ ] Flamegraphs show expected call patterns
- [ ] Hotspot rankings match computational complexity
- [ ] Multithreaded programs show thread-specific data
- [ ] Memory-intensive programs show allocation patterns
- [ ] Algorithmic complexity differences are visible

## Performance Baselines

Use these programs to establish performance baselines:
- **CPU performance**: Matrix multiplication timing
- **Memory performance**: Cache miss patterns
- **Threading overhead**: Synchronization costs
- **Algorithm efficiency**: Sorting comparison

## Integration Testing

These programs are ideal for:
1. **Profiler validation**: Ensure accuracy of measurements
2. **Performance regression testing**: Detect optimization regressions
3. **Feature testing**: Validate new profiler features
4. **Benchmarking**: Establish performance baselines
5. **Demo purposes**: Show profiler capabilities
