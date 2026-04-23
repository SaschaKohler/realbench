# RealBench GitHub Action

Automatically profile your C++, Rust, or Go binary on every push or pull request and get results posted as a PR comment.

## Quick Setup

### 1. Create a RealBench Project

1. Sign in at [app.realbench.dev](https://app.realbench.dev)
2. Create a new project and copy the **Project ID** (UUID)
3. Go to **Settings → API Keys** and generate a new key (starts with `rbk_`)

### 2. Add GitHub Secrets

In your repository go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|---|---|
| `REALBENCH_API_KEY` | Your `rbk_…` API key |
| `REALBENCH_PROJECT_ID` | Your project UUID |

### 3. Add the Workflow

Copy `realbench-action.yml` into your repository at `.github/workflows/realbench.yml` and **adapt the build step** to match your project.

#### C++ (CMake)

```yaml
- name: Build
  run: |
    cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
    cmake --build build --parallel
```

Set `BINARY_PATH` to your compiled binary, e.g. `build/my_app`.

#### Rust

```yaml
- name: Build
  run: cargo build --release
```

Set `BINARY_PATH` to `target/release/my_app`.

#### Go

```yaml
- name: Build
  run: go build -o my_app ./cmd/my_app
```

Set `BINARY_PATH` to `my_app`.

---

## What Happens

```
Push / PR opened
      │
      ▼
GitHub Action builds your binary
      │
      ▼
Uploads binary to RealBench API
      │
      ├─ (PR) → Posts "⏳ profiling in progress…" comment
      │
      ▼
RealBench worker profiles the binary
      │
      ▼
LLM analyses hotspots
      │
      └─ (PR) → Updates comment with results + suggestions
```

## PR Comment Example

> ## 🔬 RealBench Profiling Results
>
> | | |
> |---|---|
> | **Commit** | `a1b2c3d` (`feature/fast-path`) |
> | **Build** | `release` |
> | **Duration** | 32.4s |
>
> ### 🔥 Top Hotspots
> | Function | Self% | Total% | Calls |
> |---|---|---|---|
> | `Parser::parse_token` | 38.2% | 41.5% | 1,204,389 |
> | `allocate_node` | 12.1% | 12.1% | 984,201 |
>
> ### 💡 Optimisation Suggestions
> **1. 🔴 High** — `Parser::parse_token`
> > Hot path allocates on every call. Use object pool.
> > 💡 Pre-allocate a `NodePool` and reuse nodes. _(~30-40% speedup)_

## Build Flags for Best Results

Debug symbols are required for meaningful hotspot names. Without them you'll only see raw addresses.

| Language | Recommended flags |
|---|---|
| C++ | `-g -O2` or `CMAKE_BUILD_TYPE=RelWithDebInfo` |
| Rust | `cargo build --release` (includes DWARF by default) |
| Go | `go build` (always includes symbols) |

## Configuration

### Profiling Options

Pass a JSON blob as `profilingOptions` form field in the curl command:

```bash
-F 'profilingOptions={"durationSeconds": 60, "frequencyHz": 199}'
```

| Option | Default | Description |
|---|---|---|
| `durationSeconds` | `30` | How long to run the binary |
| `frequencyHz` | `99` | Sampling frequency |
| `includeKernel` | `false` | Include kernel frames |
| `mode` | `"sampling"` | `"sampling"` or `"stat"` |

### Non-blocking Mode

Remove the **"Wait for profiling result"** step if you don't want CI to block on the profiling run. The PR comment will still be posted asynchronously when profiling finishes.
