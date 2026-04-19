# RealBench Build Guide

## Prerequisites

### System Requirements

**Linux (Required for Profiler):**
- Ubuntu 20.04+ / Debian 11+ / Fedora 35+
- Kernel 2.6.31+ (for perf_event_open)

**macOS (Development Only):**
- macOS 11+ (profiler won't work, but API/Web will)

### Dependencies

**System Packages (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  cmake \
  libunwind-dev \
  libelf-dev \
  nodejs \
  npm \
  postgresql-client \
  redis-tools
```

**System Packages (Fedora/RHEL):**
```bash
sudo dnf install -y \
  gcc-c++ \
  cmake \
  libunwind-devel \
  elfutils-libelf-devel \
  nodejs \
  npm \
  postgresql \
  redis
```

**Node.js:**
- Version 18.0.0 or higher
- pnpm package manager

```bash
# Install pnpm
npm install -g pnpm
```

## Build Steps

### 1. Install JavaScript Dependencies

```bash
# From project root
pnpm install

# Build shared package
pnpm --filter @realbench/shared build
```

### 2. Build C++ Profiler (Linux Only)

```bash
cd lib/profiler

# Install Node.js dependencies for native addon
npm install

# Build the native addon
npm run build

# Verify build
ls build/Release/profiler.node
```

**Expected output:** `profiler.node` should exist

**Troubleshooting:**
- If build fails with "libunwind not found": `sudo apt-get install libunwind-dev`
- If build fails with "node-gyp not found": `npm install -g node-gyp`
- On permission errors: Check that you can run `perf record` (may need to adjust `/proc/sys/kernel/perf_event_paranoid`)

### 3. Run C++ Tests (Optional)

```bash
cd lib/profiler
mkdir -p build && cd build
cmake ..
make -j$(nproc)
ctest --output-on-failure
```

### 4. Setup Services

**PostgreSQL:**
```bash
# Docker (recommended)
docker run -d \
  --name realbench-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=realbench \
  -p 5432:5432 \
  postgres:15

# Or use existing PostgreSQL
createdb realbench
```

**Redis:**
```bash
# Docker (recommended)
docker run -d \
  --name realbench-redis \
  -p 6379:6379 \
  redis:7

# Or use existing Redis (just ensure it's running on 6379)
```

### 5. Configure Environment Variables

```bash
# Copy example env file
cp apps/api/.env.example apps/api/.env

# Edit with your values
nano apps/api/.env
```

**Required variables:**
```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/realbench

# Redis
REDIS_URL=redis://localhost:6379

# Clerk (get from https://clerk.com)
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...

# Cloudflare R2 (get from Cloudflare dashboard)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=realbench-flamegraphs

# Anthropic (get from https://console.anthropic.com)
ANTHROPIC_API_KEY=sk-ant-...
```

### 6. Database Migrations

```bash
cd apps/api
pnpm db:push
```

### 7. Start Development Servers

**Terminal 1 - API:**
```bash
cd apps/api
pnpm dev
```

**Terminal 2 - Web:**
```bash
cd apps/web
pnpm dev
```

**Terminal 3 - Worker (optional):**
```bash
cd apps/api
pnpm worker
```

## Verification

### 1. Check API Health

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok"}`

### 2. Check Web Interface

Open browser: `http://localhost:5173`

Expected: Clerk login page

### 3. Test Profiler (Linux only)

```bash
node -e "
const { ProfilerClient } = require('./lib/profiler');
const profiler = new ProfilerClient({ durationSeconds: 5 });
profiler.profilePid(process.pid).then(r => {
  console.log('Samples:', r.totalSamples);
  console.log('Hotspots:', r.hotspots.length);
});
"
```

Expected output with sample counts and hotspots.

## Common Issues

### C++ Profiler Build Fails

**Error:** `perf_event_open: Permission denied`
```bash
# Temporary fix (until reboot)
sudo sysctl kernel.perf_event_paranoid=-1

# Permanent fix
echo 'kernel.perf_event_paranoid=-1' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

**Error:** `Cannot find module 'node-addon-api'`
```bash
cd lib/profiler
rm -rf node_modules
npm install
```

### API Won't Start

**Error:** `ECONNREFUSED` to PostgreSQL
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# If not, start it
docker start realbench-postgres
```

**Error:** `Clerk authentication failed`
- Verify your `CLERK_SECRET_KEY` is correct
- Check that you're using the correct environment (test vs production)

### Web App Won't Start

**Error:** Module not found errors
```bash
# Rebuild shared package
pnpm --filter @realbench/shared build

# Clear cache
rm -rf apps/web/node_modules/.vite
pnpm --filter web dev
```

## Production Build

### API

```bash
cd apps/api
pnpm build
pnpm start
```

### Web

```bash
cd apps/web
pnpm build
pnpm preview
```

### Docker (Optional)

```bash
# Build API image
docker build -f docker/Dockerfile.api -t realbench-api .

# Build Worker image  
docker build -f docker/Dockerfile.worker -t realbench-worker .

# Run with docker-compose
docker-compose up -d
```

## Performance Tuning

### Profiler

- **Sampling Frequency:** Default 99 Hz is optimal for most cases
- **Duration:** 30 seconds captures enough data without excessive overhead
- **Kernel Stacks:** Disable (`includeKernel: false`) unless debugging kernel issues

### Database

```sql
-- Recommended indexes (already in schema)
CREATE INDEX idx_profiling_runs_project ON profiling_runs(project_id);
CREATE INDEX idx_profiling_runs_commit ON profiling_runs(commit_sha);
```

### Redis

```bash
# Increase maxmemory if processing many large profiles
redis-cli CONFIG SET maxmemory 2gb
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

## Next Steps

- Read [SPEC.md](./SPEC.md) for architecture details
- Check [STATUS.md](./STATUS.md) for implementation status
- See [NEXT_STEPS.md](./NEXT_STEPS.md) for roadmap

## Support

For issues:
1. Check this build guide
2. Review [SETUP.md](./SETUP.md) troubleshooting
3. Check GitHub Issues (once repo is public)
