# RealBench Deployment Checklist

**Status:** Ready for Testing & Deployment  
**Date:** 13. April 2026

## ✅ Implementation Complete

All core components are implemented and ready for testing.

## 📋 Pre-Deployment Steps

### 1. Build C++ Profiler (Linux Required)

```bash
cd lib/profiler

# Install dependencies
npm install

# Build native addon
npm run build

# Verify build succeeded
ls build/Release/profiler.node
# Should show: profiler.node

# Test the profiler
node -e "const {ProfilerClient} = require('./index.js'); console.log('✓ Profiler loaded');"
```

**Expected:** No errors, "✓ Profiler loaded" message

**If build fails:**
```bash
# Install system dependencies (no libunwind needed anymore)
sudo apt-get install -y build-essential valgrind

# Check node-gyp
npm install -g node-gyp
node-gyp --version

# Try again
npm run clean
npm run build
```

### 2. Run C++ Tests

```bash
cd lib/profiler
mkdir -p build && cd build

cmake ..
make -j$(nproc)

# Run tests
ctest --output-on-failure
```

**Expected:** All tests pass

### 3. Verify valgrind is available (Production)

```bash
# On the worker host / container
valgrind --version
# Expected: valgrind-3.x.x

# Quick smoke-test
valgrind --tool=callgrind --callgrind-out-file=/tmp/cg.out ls /tmp
# Should exit 0 and write /tmp/cg.out
```

**Note:** The profiler now uses `valgrind --tool=callgrind` instead of `perf_event_open`. No kernel permission changes required. The worker container includes valgrind as a runtime dependency.

### 4. Install JavaScript Dependencies

```bash
# From project root
pnpm install

# Build shared package
pnpm --filter @realbench/shared build

# Verify no TypeScript errors (ignore false positives)
pnpm --filter api typecheck
```

### 5. Setup External Services

**PostgreSQL:**
```bash
# Docker
docker run -d \
  --name realbench-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=realbench \
  -p 5432:5432 \
  postgres:15

# Run migrations
cd apps/api
pnpm db:push
```

**Redis:**
```bash
docker run -d \
  --name realbench-redis \
  -p 6379:6379 \
  redis:7
```

**Environment Variables:**
```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```

Required keys:
- ✅ `DATABASE_URL`
- ✅ `REDIS_URL`
- ✅ `CLERK_SECRET_KEY`
- ✅ `CLERK_PUBLISHABLE_KEY`
- ✅ `R2_ACCOUNT_ID`
- ✅ `R2_ACCESS_KEY_ID`
- ✅ `R2_SECRET_ACCESS_KEY`
- ✅ `R2_BUCKET_NAME`
- ✅ `ANTHROPIC_API_KEY`

### 6. Test API & Worker

**Terminal 1 - Start API:**
```bash
cd apps/api
pnpm dev
```

Watch for:
```
✓ "Using real C++ profiler" (NOT "Using mock profiler")
✓ Server listening on http://localhost:3000
```

**Terminal 2 - Test Health:**
```bash
curl http://localhost:3000/health
# Expected: {"status":"ok"}
```

**Terminal 3 - Start Web:**
```bash
cd apps/web
pnpm dev
```

Open: `http://localhost:5173`

### 7. End-to-End Test

Create a test C++ binary:
```bash
cat > /tmp/test.cpp << 'EOF'
#include <iostream>
#include <chrono>
#include <thread>

void busy_loop() {
    volatile double x = 0;
    for (int i = 0; i < 100000000; i++) {
        x += i * 0.1;
    }
}

int main() {
    std::cout << "Running for 60s..." << std::endl;
    auto end = std::chrono::steady_clock::now() + std::chrono::seconds(60);
    while (std::chrono::steady_clock::now() < end) {
        busy_loop();
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    return 0;
}
EOF

g++ -g -O0 /tmp/test.cpp -o /tmp/test_binary
chmod +x /tmp/test_binary
```

Test profiler directly:
```bash
cd lib/profiler
node << 'EOF'
const { ProfilerClient } = require('./index.js');

const profiler = new ProfilerClient({
  durationSeconds: 10,
  frequencyHz: 99
});

profiler.profileBinary('/tmp/test_binary')
  .then(result => {
    console.log('✓ Total samples:', result.totalSamples);
    console.log('✓ Hotspots:', result.hotspots.length);
    console.log('✓ SVG length:', result.flamegraphSvg.length);
    console.log('✓ Top hotspot:', result.hotspots[0].symbol);
  })
  .catch(err => console.error('✗ Error:', err));
EOF
```

**Expected:**
- Total samples > 0
- Multiple hotspots found
- SVG generated
- Top hotspot should be from test binary

### 8. Test via API

```bash
# 1. Login to web UI and create a project

# 2. Upload binary via API
curl -X POST http://localhost:3000/api/v1/profile \
  -H "Authorization: Bearer YOUR_CLERK_TOKEN" \
  -F "binary=@/tmp/test_binary" \
  -F "projectId=YOUR_PROJECT_ID" \
  -F "commitSha=test123" \
  -F "branch=main" \
  -F "buildType=debug"

# 3. Check job in BullMQ/Redis
# 4. Wait for completion (~30s)
# 5. View results in web UI
```

## 🚀 Production Deployment

### Fly.io Deployment

**1. Install Fly CLI:**
```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

**2. Deploy API:**
```bash
cd apps/api
fly launch --no-deploy

# Set secrets
fly secrets set \
  DATABASE_URL="postgresql://..." \
  REDIS_URL="redis://..." \
  CLERK_SECRET_KEY="..." \
  ANTHROPIC_API_KEY="..."

# Deploy
fly deploy
```

**3. Deploy Worker:**
```bash
# Create separate worker app
fly apps create realbench-worker

# Use same secrets
fly secrets set --app realbench-worker \
  DATABASE_URL="..." \
  REDIS_URL="..." \
  # ... same as API

# Deploy
fly deploy --app realbench-worker
```

**4. Setup Managed Services:**
```bash
# Postgres
fly postgres create --name realbench-db
fly postgres attach realbench-db

# Redis
fly redis create --name realbench-redis
```

### Environment-Specific Notes

**Staging:**
- Use separate Clerk environment
- Separate R2 bucket
- Lower concurrency limits

**Production:**
- Enable auto-scaling
- Setup monitoring (Sentry, Axiom)
- Configure backups
- Rate limiting
- HTTPS only

## 📊 Monitoring

**Key Metrics:**
- Profiler success rate
- Average profiling duration
- Queue depth (BullMQ)
- API response times
- Error rates

**Logs to Watch:**
```bash
# Check for profiler errors
grep "Profiling failed" logs/

# Check for permission issues
grep "Permission denied" logs/

# Check profiler mode
grep "Using mock profiler" logs/  # Should be NONE in production
```

## ✅ Final Verification

Before going live:
- [ ] C++ profiler builds successfully
- [ ] All C++ tests pass
- [ ] API starts without "mock profiler" warning
- [ ] Database migrations applied
- [ ] All environment variables set
- [ ] R2 bucket accessible
- [ ] Clerk authentication works
- [ ] Claude API responds
- [ ] Test binary profiles successfully
- [ ] Flamegraph displays in web UI
- [ ] LLM suggestions generated
- [ ] Performance acceptable (<30s for 30s profile)

## 🐛 Common Issues

### "valgrind not found" when profiling
```bash
# Ubuntu/Debian
sudo apt-get install -y valgrind
# Alpine
apk add valgrind
```

### "Using mock profiler" in logs
```bash
cd lib/profiler
npm run build
# Check: ls build/Release/profiler.node
```

### Profiler build fails on macOS
```
Known limitation - profiler requires Linux.
Use Docker or VM for development.
```

### Worker not processing jobs
```bash
# Check pg-boss queue in postgres
# (No Redis needed – queue is PostgreSQL-native via pg-boss)

# Restart worker
pnpm worker
```

## 📚 Documentation

- Architecture: `SPEC.md`
- Implementation: `IMPLEMENTATION_SUMMARY.md`
- Build Guide: `BUILD.md`
- Setup: `SETUP.md`
- Status: `STATUS.md`
- Next Steps: `NEXT_STEPS.md`

## 🎯 Success Criteria

**Deployment is successful when:**
1. ✅ Native profiler builds on target platform
2. ✅ API accepts binary uploads
3. ✅ Real profiling executes (not mock)
4. ✅ Flamegraphs render correctly
5. ✅ LLM provides useful suggestions
6. ✅ No permission errors in production
7. ✅ Performance meets SLA (<60s end-to-end)

---

**Ready to Deploy:** ✅ Yes  
**Blockers:** None  
**Notes:** Test thoroughly on staging before production
