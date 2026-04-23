# Profiler — Agent Instructions

This is the **C++ sampling profiler** with Node.js N-API bindings for RealBench.
It uses `perf_event_open` (Linux only) to collect CPU samples and generate flamegraphs.

## Structure

```
lib/profiler/
├── src/              # C++ sources
│   ├── sampler.*     # perf_event_open sampling loop
│   ├── flamegraph.*  # SVG flamegraph generation
│   ├── diff.*        # Profile diff / regression detection
│   └── symbol_resolver.* # ELF symbol resolution (libelf + libunwind)
├── include/          # Public C++ headers
├── bindings/         # Node.js N-API addon (C++ ↔ JS bridge)
├── index.js          # JavaScript entry point / addon loader
├── profiler_worker.js # Worker thread wrapper
├── binding.gyp       # node-gyp build config
├── CMakeLists.txt    # CMake build for Google Test suite
├── tests/            # Google Test unit tests + sample binaries
└── package.json      # @realbench/profiler-native
```

## C++ Conventions

- Standard: **C++17**.
- Naming: `snake_case` for variables/functions, `PascalCase` for classes/structs.
- Memory: prefer RAII and smart pointers (`std::unique_ptr`, `std::shared_ptr`) over raw `new`/`delete`.
- Error handling: use return codes or exceptions consistently within each module; propagate errors to the N-API layer as JS exceptions via `Napi::Error::New(env, msg).ThrowAsJavaScriptException()`.
- No platform-specific `#ifdef` blocks outside of `src/sampler.cpp` — keep Linux-specific code isolated there.

## N-API Bindings

- All JS-visible functions live in `bindings/`.
- Use **node-addon-api** (`napi.h`) — do not use raw N-API C API.
- Async operations (profiling runs) must use `Napi::AsyncWorker` or `Napi::ThreadSafeFunction` to avoid blocking the Node.js event loop.
- Binding function signatures must be documented in `index.js` JSDoc.

## Build

```bash
# In lib/profiler/
npm install          # also triggers node-gyp rebuild
npm run build        # explicit node-gyp rebuild

# Required system packages (Debian/Ubuntu):
sudo apt-get install libelf-dev libunwind-dev
sudo sysctl kernel.perf_event_paranoid=-1
```

- Build output: `build/Release/profiler.node` (loaded by `index.js`).
- **Linux only** — `perf_event_open` is not available on macOS or Windows.
- The Fly.io worker machine (Linux/amd64) is the intended runtime target.

## Testing

- Framework: **Google Test** via CMake/CTest.
- Test files: `tests/` directory.
- Run: `cd build && cmake .. && make && ctest --output-on-failure`
- Tests must not require `sudo` or `perf_event_paranoid=-1`; use mock data or `/dev/null` where syscalls are unavailable.
- When adding new C++ modules, add a corresponding `*_test.cpp` in `tests/`.

## Integration with API

- `apps/api/src/services/profiler.ts` imports `@realbench/profiler-native` and calls into `index.js`.
- The profiler is only invoked from the **pg-boss worker** (`apps/api/src/workers/profiling-worker.ts`), never from the HTTP request path.
- Pass profiling results back to the API as plain JS objects (no C++ types across the boundary).
