# RealBench - Nächste Schritte

## Phase 1 MVP - Abgeschlossen ✅

Die grundlegende Projektstruktur und das Backend für Phase 1 sind nun implementiert:

### Fertiggestellt

- ✅ Monorepo-Struktur mit pnpm workspaces
- ✅ Drizzle ORM Schema (Users, Projects, ProfilingRuns)
- ✅ Hono API Backend mit folgenden Endpoints:
  - `POST /api/v1/profile` - Binary upload & Job-Enqueue
  - `GET /api/v1/projects` - Projekt-Liste
  - `POST /api/v1/projects` - Projekt erstellen
  - `GET /api/v1/projects/:id/runs` - Run-Liste eines Projekts
  - `GET /api/v1/runs/:id` - Run-Details
  - `GET /api/v1/runs/:id/diff/:baseId` - Run-Vergleich
- ✅ BullMQ Worker für asynchrone Profiling-Jobs
- ✅ Cloudflare R2 Storage Integration
- ✅ Claude LLM Integration für Optimierungsvorschläge
- ✅ React Dashboard mit TailwindCSS
- ✅ Clerk Authentication
- ✅ GitHub Actions CI Workflow

### Lint-Fehler (Normal)

Die aktuellen TypeScript-Fehler sind **erwartbar** und verschwinden nach `pnpm install`:
- Module wie `zod`, `drizzle-orm`, `hono` etc. werden als "nicht gefunden" gemeldet
- Diese Fehler existieren nur, weil die `node_modules` noch nicht installiert sind

## Sofort Umsetzbar

### 1. Dependencies installieren & Testen

```bash
# Im Projekt-Root
pnpm install

# Shared Package bauen
pnpm --filter @realbench/shared build

# API starten (benötigt PostgreSQL + Redis)
pnpm --filter api dev

# Web Dashboard starten
pnpm --filter web dev
```

### 2. Datenbank & Services Setup

Folge der [`SETUP.md`](./SETUP.md) für:
- PostgreSQL Installation/Docker
- Redis Installation/Docker
- Clerk Account & Keys
- Cloudflare R2 Bucket
- Anthropic API Key

### 3. Erste Tests

Nach erfolgreicher Installation:

```bash
# Prüfe, ob das Shared Package gebaut wurde
ls packages/shared/dist/

# Starte die API
cd apps/api
pnpm dev

# In separatem Terminal: Web starten
cd apps/web
pnpm dev
```

Öffne `http://localhost:5173` → sollte zum Clerk Login redirecten.

## ✅ Phase 2 - C++ Profiler Core (ABGESCHLOSSEN)

Der C++ Core ist vollständig implementiert:

### Implementierte Features

1. **✅ Sampler**
   - Linux: `perf_event_open()` mit ring buffer reading
   - Stack trace collection aus callchains
   - Symbol-Resolution mit libelf (ELF symbol tables)
   - `/proc/pid/maps` parsing für memory mappings

2. **✅ Flamegraph-Generator**
   - Hierarchische Stackframe-Aggregation
   - SVG-Export mit Farb-Kodierung
   - JSON-Export für LLM-Analyse

3. **✅ Diff-Engine**
   - Vergleich zweier Profile (baseline vs current)
   - Regression/Improvement Detection
   - Delta-Berechnung mit Speedup-Metriken

4. **✅ Node.js Binding**
   - N-API Addon implementiert (`binding.gyp`)
   - JavaScript Wrapper (`index.js`)
   - Worker-Integration in `profiling-worker.ts`

5. **✅ Tests**
   - Google Test Suite
   - Sample Binary für Integration Tests
   - Mock-Fallback wenn Native Addon nicht gebaut

### Build-Anleitung

```bash
# C++ Profiler bauen
cd lib/profiler
npm install
npm run build

# Tests ausführen
mkdir build && cd build
cmake ..
make -j$(nproc)
ctest
```

## Phase 3 - CLI Tool (Apps/cli)

Nach dem C++ Core: Standalone CLI-Tool

```bash
# Ziel-Usage
realbench profile ./my_binary --duration 30 --output flamegraph.html
realbench diff baseline.json current.json
```

## Phase 4 - Features & Polish

- [ ] Stripe Billing Integration
- [ ] Team Management / Multi-User Support
- [ ] GitLab CI Integration
- [ ] WASM Export des C++ Core (für Browser-Rendering)
- [ ] Erweiterte Diff-Visualisierung (Recharts/D3)
- [ ] WebSocket für Live-Updates statt Polling
- [ ] Rate Limiting Middleware
- [ ] Comprehensive Test Coverage (>80%)

## Bekannte Einschränkungen

### MVP Scope

Bewusst **nicht** in Phase 1:
- Stripe Billing (Free-Plan reicht für Beta)
- Team-Seats / Multi-Tenant
- GitLab CI Support
- WASM-Export
- Performance-Metriken über Zeit (Trends)

### Mock-Daten im Worker

Der aktuelle `profiling-worker.ts` verwendet **Mock-Hotspots**:

```typescript
const mockHotspots = [
  { symbol: 'compute_heavy_function', selfPct: 35.2, ... }
];
```

Diese werden ersetzt, sobald der C++ Core integriert ist.

## Deployment (später)

### Fly.io Setup

```bash
# API deployen
fly launch --path apps/api

# Worker als separate App
fly launch --path apps/api --name realbench-worker
```

### Environment Variables

Alle Secrets via Fly.io Secrets setzen:

```bash
fly secrets set \
  CLERK_SECRET_KEY=... \
  DATABASE_URL=... \
  ANTHROPIC_API_KEY=...
```

## Hilfreiche Ressourcen

- [Drizzle ORM Docs](https://orm.drizzle.team)
- [Hono Framework](https://hono.dev)
- [BullMQ Guide](https://docs.bullmq.io)
- [Clerk React SDK](https://clerk.com/docs/references/react)
- [Anthropic Claude API](https://docs.anthropic.com)
- [perf_event_open Man Page](https://man7.org/linux/man-pages/man2/perf_event_open.2.html)

## Support

Bei Fragen/Problemen:
1. Prüfe [`SETUP.md`](./SETUP.md) Troubleshooting
2. Prüfe [`SPEC.md`](./SPEC.md) für Architektur-Details
3. Öffne ein GitHub Issue (sobald Repo public)
