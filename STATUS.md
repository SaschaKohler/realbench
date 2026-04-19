# RealBench - Implementierungsstatus

**Stand:** 19. April 2026, 17:30 Uhr

## ✅ Phase 1 MVP - Fertiggestellt

### Backend (Hono API)

**Funktioniert:**
- ✅ Hono API läuft auf Port 3000
- ✅ CORS korrekt konfiguriert für localhost:5173
- ✅ PostgreSQL-Verbindung (Docker: `postgres:postgres@localhost:5432/realbench`)
- ✅ Redis-Verbindung (Docker: `localhost:6379`)
- ✅ Clerk Authentication (JWT Token Verification)
- ✅ Automatische User-Erstellung beim ersten Login
- ✅ Drizzle ORM Schema (Users, Projects, ProfilingRuns)
- ✅ Database Migrations generiert und gepusht

**API Endpoints:**
- `POST /api/v1/profile` - Binary Upload & Job Enqueue
- `GET /api/v1/projects` - Liste aller Projekte des Users
- `POST /api/v1/projects` - Neues Projekt erstellen
- `GET /api/v1/projects/:id/runs` - Runs eines Projekts
- `GET /api/v1/runs/:id` - Run-Details
- `GET /api/v1/runs/:id/diff/:baseId` - Run-Vergleich

**Services:**
- ✅ R2 Storage Service (Cloudflare R2 via AWS SDK)
- ✅ LLM Service (Anthropic Claude API)
- ✅ User Service (Auto-create from Clerk)
- ✅ BullMQ Queue & Worker Setup

### Frontend (React + Vite)

**Funktioniert:**
- ✅ Vite Dev Server auf Port 5173
- ✅ Clerk Authentication UI
- ✅ TailwindCSS Styling
- ✅ React Router (Dashboard, ProjectDetail, RunDetail)
- ✅ TanStack Query für API-Calls
- ✅ Projekt-Erstellung funktioniert

**Pages:**
- `/` - Dashboard (Projekt-Liste)
- `/projects/:id` - Projekt-Details mit Run-Liste
- `/runs/:id` - Run-Details mit Flamegraph & Suggestions

### Infrastructure

**Docker Services:**
- ✅ PostgreSQL 15 (Port 5432)
- ✅ Redis 7 (Port 6379)

**CI/CD:**
- ✅ GitHub Actions Workflow (`.github/workflows/ci.yml`)
- Testing mit PostgreSQL & Redis Services
- Linting & Formatting

### Externe Services

**Konfiguriert:**
- ✅ Clerk Auth (Keys in .env)
- ✅ Cloudflare R2 (Bucket: realbench-flamegraphs)
- ✅ Anthropic Claude API

## 🔧 Behobene Probleme

1. **CORS Preflight:** `allowHeaders` und `allowMethods` explizit gesetzt
2. **Auth Middleware:** `verifyToken` von `@clerk/backend` korrekt importiert
3. **Auto User Creation:** `getOrCreateUser()` Service erstellt User automatisch
4. **Database Connection:** `dotenv.config()` in `db/index.ts` laden
5. **Hono Server:** `@hono/node-server` Package installiert und korrekt verwendet

## ✅ C++ Profiler Core - Implementiert

**Funktionen:**
- ✅ perf_event_open Integration mit Ring Buffer Reading
- ✅ Stack Trace Collection (callchain sampling)
- ✅ Symbol Resolution via libelf (ELF symbol tables)
- ✅ Hierarchische Flamegraph SVG Generierung
- ✅ JSON Export für LLM-Analyse
- ✅ Profile Diff/Comparison Algorithmus
- ✅ Node.js N-API Bindings
- ✅ Integration Tests (Google Test)
- ✅ Sample Binary für Testing

**Profiling Worker:**
- ✅ Verwendet echten C++ Profiler (mit Fallback auf Mock-Daten)
- ✅ Automatische Integration über `profileBinary()` Service
- ✅ Echte Flamegraph-SVGs werden generiert und zu R2 hochgeladen

## ⚠️ Bekannte Einschränkungen

### C++ Profiler

**Fehlende Features (Out of MVP Scope):**
- Stripe Billing
- Team Management
- GitLab CI Support
- WASM Export des C++ Core
- Diff-Visualisierung (API-Route existiert, aber UI fehlt)

## 📁 Projektstruktur

```
railbench/
├── apps/
│   ├── api/           # Hono API (Port 3000)
│   │   ├── src/
│   │   │   ├── db/           # Drizzle DB Config
│   │   │   ├── middleware/   # Auth, Validation
│   │   │   ├── routes/       # API Routes
│   │   │   ├── services/     # Storage, LLM, User, Profiler
│   │   │   ├── workers/      # BullMQ Worker
│   │   │   └── index.ts      # Main Server
│   │   └── drizzle/          # Generated Migrations
│   └── web/           # React Frontend (Port 5173)
│       └── src/
│           ├── lib/          # API Client
│           ├── pages/        # Dashboard, ProjectDetail, RunDetail
│           └── main.tsx
├── packages/
│   └── shared/        # Gemeinsame Types & Schema
│       └── src/
│           ├── schema.ts     # Drizzle Tables
│           ├── types.ts      # Zod Schemas
│           └── index.ts
└── lib/
    └── profiler/      # ✅ C++ Profiler Core (IMPLEMENTIERT)
        ├── include/
        │   └── profiler.h          # Public C++ API
        ├── src/
        │   ├── sampler.cpp         # perf_event_open + Ring Buffer
        │   ├── flamegraph.cpp      # SVG/JSON Generation
        │   ├── diff.cpp            # Profile Comparison
        │   └── symbol_resolver.cpp # ELF Symbol Resolution
        ├── bindings/
        │   ├── node_addon.cpp      # N-API Bindings
        │   └── CMakeLists.txt
        ├── tests/
        │   ├── test_profiler.cpp   # Google Tests
        │   ├── sample_binary.cpp   # Test Binary
        │   └── CMakeLists.txt
        ├── binding.gyp             # Node-gyp Build
        ├── package.json            # NPM Package
        ├── index.js                # JavaScript Wrapper
        └── CMakeLists.txt          # CMake Build
```

## ⚠️ Bekannte Lücken & offene Punkte

### C++ Profiler

| Problem | Auswirkung | Lösung (SPEC §12-13) |
|---|---|---|
| `--call-graph dwarf` für Go-Binaries | Falsche/leere Stacks bei Go | `--call-graph fp` wenn `BinaryRuntime::GO` |
| Kein Rust-spezifisches Demangling | Manglined Symbole in Flamegraph | `demangle_rust()` in `build_result()` |
| `-m` (Mmap-Ringpuffer) nicht gesetzt | Sample-Verlust bei langen Läufen | `-m 16M` in `profile_binary_perf()` |
| Binary-Upload-Limit ~1 MB (Hono default) | Grosse Binaries werden abgelehnt | `bodyLimit(500 MB)` in `index.ts` |
| Timeout zu knapp für grosse Binaries | `profileBinary` läuft in Timeout | Timeout-Formel anpassen (SPEC §13) |

### Frontend

| Problem | Auswirkung |
|---|---|
| Flamegraph nur als externer R2-Link | Kein interaktives Drill-down/Zoom |
| Kein JSON-Flamegraph-Endpoint | D3-Komponente hat keine Datenquelle |
| Diff-Seite hat keine UI | API-Route `/runs/:id/diff/:baseId` ungenutzt |

## 🚀 Nächste Schritte

### Priorität 1 — C++ Core Fixes (Sofort)

**`lib/profiler/src/sampler.cpp` — `profile_binary_perf()`:**
1. `--call-graph` runtime-abhängig: `fp` für Go, `dwarf,65528` für C++/Rust
2. `-m 16M` Mmap-Ringpuffer für alle Runtimes ergänzen
3. Rust-Demangling in `build_result()` ergänzen

```bash
# Nach Änderungen neu bauen:
cd lib/profiler && npm run build
cd build && ctest
```

**`apps/api/src/index.ts`:**
4. `bodyLimit(500 * 1024 * 1024)` für `/api/v1/profile`

**`apps/api/src/services/profiler.ts`:**
5. Timeout-Formel: `(durationSeconds * 120 + 300) * 1000`

### Priorität 2 — Interaktiver Flamegraph (Phase 2)

6. `lib/profiler/src/flamegraph.cpp`: JSON-Output auf D3-Hierarchie-Format (`FlameNode`)
7. `apps/api/src/routes/runs.ts`: `GET /runs/:id/flamegraph.json`
8. `apps/web/src/components/FlameGraph.tsx`: D3-Komponente (Zoom, Tooltip, Suche, Diff)
9. `apps/web/src/pages/RunDetail.tsx`: Embedded Flamegraph ersetzen externes SVG-Link

### Priorität 3 — Infrastructure & Scale

10. `fly.worker.toml`: 4 GB RAM + 20 GB tmpdir Volume Mount
11. Streaming-Parser für `perf script`-Output (Phase 2, kein Disk-Spooling)
12. GitHub Actions `realbench-action` als YAML-Step
13. Diff-Visualisierung im UI (DiffChart mit Recharts)

**System Requirements (Worker):**
```bash
# Kernel Version prüfen (>= 2.6.31)
uname -r

# perf_event_paranoid setzen
sudo sysctl kernel.perf_event_paranoid=-1

# Dependencies
sudo apt-get install libunwind-dev libelf-dev linux-perf
```

## 🔑 Wichtige Befehle

```bash
# Development
pnpm install                    # Dependencies installieren
pnpm --filter @realbench/shared build  # Shared Package bauen
pnpm --filter api dev          # API starten
pnpm --filter web dev          # Frontend starten

# Database
pnpm db:generate               # Drizzle Migrations generieren
pnpm db:push                   # Schema in DB pushen
pnpm db:migrate               # Migrations ausführen

# Docker Services
docker ps                      # Laufende Container
docker logs realbench-postgres # PostgreSQL Logs
docker logs realbench-redis    # Redis Logs
```

## 📊 Metrics

- **LOC Backend:** ~1,200 Zeilen TypeScript
- **LOC Frontend:** ~400 Zeilen TypeScript/TSX
- **Dependencies:** 449 Packages
- **Build Zeit:** ~350ms (Vite), ~2s (API)
- **API Response Zeit:** <20ms (ohne DB-Calls)

## 🐛 Debug-Logs

Aktiviert in:
- `src/middleware/auth.ts` - Auth Success/Failure
- `src/db/index.ts` - Database Connection String
- Worker wird Mock-Daten loggen

## ✨ Credits

- Framework: Hono, React 18, Vite 5
- ORM: Drizzle ORM
- Auth: Clerk
- Queue: BullMQ
- Storage: Cloudflare R2
- LLM: Anthropic Claude
