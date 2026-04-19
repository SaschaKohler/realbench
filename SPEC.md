# RealBench — Architecture & Tech Stack Spec

> **Purpose of this document:** Arbeitsgrundlage für Agent Coding (Windsurf/Cursor).  
> Dieses Dokument beschreibt Architektur, Stack-Entscheidungen, Konventionen und Projektstruktur  
> so dass ein Coding Agent ohne weitere Rückfragen loslegen kann.

---

## 1. Produktübersicht

RealBench ist ein Performance-Profiling-as-a-Service für C++-, Rust- und Go-Projekte.

Kernfunktionen:
- Automatisches Sampling-Profiling via CI/CD-Integration (GitHub Actions, GitLab CI)
- Flamegraph-Generierung und -Visualisierung im Web-Dashboard
- Historische Diff-Ansicht: Performance-Regressions zwischen Commits erkennen
- LLM-basierte Optimierungsvorschläge (Claude API) aus Profiling-Daten

---

## 2. System-Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT LAYER                                                   │
│  React Dashboard  │  GitHub Actions CLI  │  REST-API Consumer   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────────────┐
│  API GATEWAY                                                    │
│  Hono (Node.js 20) — REST + optional gRPC                       │
│  Auth Middleware (Clerk JWT)  │  Rate Limiting  │  Validation   │
└──────┬──────────────┬─────────────────┬──────────────┬──────────┘
       │              │                 │              │
  ┌────▼────┐   ┌─────▼──────┐   ┌─────▼─────┐  ┌────▼────────┐
  │  Auth   │   │  Profile   │   │  Billing  │  │  LLM Layer  │
  │ Service │   │   Queue    │   │  Service  │  │ (Claude API)│
  │ (Clerk) │   │(BullMQ +   │   │  (Stripe) │  │             │
  │         │   │  Redis)    │   │           │  │             │
  └─────────┘   └─────┬──────┘   └───────────┘  └────┬────────┘
                      │ Job dequeue                   │
              ┌───────▼───────────────────────────────▼────────┐
              │  PROFILING WORKER (Node.js)                    │
              │  Ruft C++ Core via FFI / Native Addon auf      │
              └───────────────────┬────────────────────────────┘
                                  │
              ┌───────────────────▼────────────────────────────┐
              │  C++ CORE  (lib/profiler — dein Moat)          │
              │  Sampling Profiler  │  Flamegraph Engine        │
              │  Diff Engine        │  Export: .so + WASM       │
              └───────┬────────────────────────┬───────────────┘
                      │                        │
              ┌───────▼──────┐        ┌────────▼──────┐
              │ PostgreSQL   │        │  S3 / R2      │
              │ Metadata,    │        │  flamegraph   │
              │ Users, Runs  │        │  .svg files   │
              └──────────────┘        └───────────────┘
```

### Request Flow (Profiling Job)

```
1. git push  →  GitHub Actions  →  POST /api/v1/profile  (binary + metadata)
2. API Gateway  →  validiert JWT, rate limit  →  Job in BullMQ Queue
3. Worker dequeued  →  ruft C++ Engine auf (.so via node-ffi-napi)
4. C++ Engine  →  Sampling → Stackframes → flamegraph.svg
5. flamegraph.svg  →  upload S3/R2
6. Metadaten (run_id, commit, hotspots JSON)  →  PostgreSQL
7. Hotspots JSON  →  Claude API  →  suggestions JSON  →  PostgreSQL
8. WebSocket / Polling  →  Dashboard zeigt Ergebnis
```

---

## 3. Tech Stack

### Backend

| Komponente | Technologie | Begründung |
|---|---|---|
| Runtime | Node.js 20 LTS | Gute FFI-Unterstützung für C++ Addon |
| Framework | [Hono](https://hono.dev) | Schnell, type-safe, edge-ready |
| Job Queue | BullMQ + Redis | Async Profiling-Jobs, Retry-Logik |
| Auth | [Clerk](https://clerk.com) | JWT, OAuth, SSO out of the box |
| ORM | [Drizzle ORM](https://orm.drizzle.team) | Type-safe, leichtgewichtig |
| Validation | Zod | Schema-Validierung für alle API-Inputs |
| Testing | Vitest | Schnell, TypeScript-nativ |

### C++ Core

| Komponente | Technologie |
|---|---|
| Sprache | C++17 |
| Profiler | `perf_event_open()` (Linux), libunwind für Stackframes |
| Output | Flamegraph SVG, JSON (hotspots, diff) |
| Integration | `node-ffi-napi` oder N-API Native Addon |
| Build | CMake + Conan |
| Tests | Google Test |

### Frontend

| Komponente | Technologie |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS |
| Charts | Recharts (Diff-Graphen), D3 (Flamegraph-Rendering) |
| State | Zustand |
| API Client | TanStack Query (React Query) |
| Auth | Clerk React SDK |

### Infra & Services

| Komponente | Technologie |
|---|---|
| Hosting | Fly.io (API + Worker als separate Apps) |
| Datenbank | PostgreSQL 15 (Fly Postgres oder Neon) |
| Queue Store | Redis (Fly Redis oder Upstash) |
| File Storage | Cloudflare R2 (kein Egress-Pricing) |
| Billing | Stripe (Subscriptions + Usage-based) |
| LLM | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| CI Integration | GitHub Actions, GitLab CI |
| Monitoring | Sentry (Errors), Axiom (Logs) |

---

## 4. Projektstruktur (Monorepo)

```
realbench/
├── apps/
│   ├── api/                    # Hono Backend
│   │   ├── src/
│   │   │   ├── routes/         # /profile, /projects, /billing, /webhooks
│   │   │   ├── workers/        # BullMQ Worker (ruft C++ auf)
│   │   │   ├── services/       # llm.ts, storage.ts, stripe.ts
│   │   │   ├── db/             # Drizzle schema + migrations
│   │   │   └── middleware/     # auth.ts, rateLimit.ts, validate.ts
│   │   └── package.json
│   │
│   ├── web/                    # React Dashboard
│   │   ├── src/
│   │   │   ├── pages/          # Dashboard, Project, Run, Settings
│   │   │   ├── components/     # Flamegraph, DiffChart, SuggestionCard
│   │   │   └── lib/            # api.ts (TanStack Query hooks)
│   │   └── package.json
│   │
│   └── cli/                    # C++ CLI Tool (erster MVP)
│       ├── src/
│       └── CMakeLists.txt
│
├── lib/
│   └── profiler/               # C++ Core Library
│       ├── include/
│       │   └── profiler.h      # Public API
│       ├── src/
│       │   ├── sampler.cpp     # perf_event_open Sampling
│       │   ├── flamegraph.cpp  # SVG + JSON Export
│       │   └── diff.cpp        # Baseline-Vergleich
│       ├── bindings/
│       │   └── node_addon.cpp  # N-API Binding für Node.js Worker
│       ├── tests/
│       └── CMakeLists.txt
│
├── packages/
│   └── shared/                 # Gemeinsame TypeScript Types
│       └── src/types.ts        # ProfilingRun, Hotspot, Suggestion, ...
│
├── docker/
│   ├── Dockerfile.api
│   └── Dockerfile.worker
│
├── .github/
│   └── workflows/
│       └── ci.yml
│
└── package.json                # pnpm workspaces
```

---

## 5. Datenbank-Schema (PostgreSQL / Drizzle)

```typescript
// packages/shared/src/schema.ts

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull(),
  plan: text('plan').notNull().default('free'), // 'free' | 'pro' | 'team'
  createdAt: timestamp('created_at').defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  name: text('name').notNull(),
  language: text('language').notNull(), // 'cpp' | 'rust' | 'go'
  createdAt: timestamp('created_at').defaultNow(),
});

export const profilingRuns = pgTable('profiling_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id),
  commitSha: text('commit_sha').notNull(),
  branch: text('branch').notNull(),
  buildType: text('build_type').notNull(), // 'release' | 'debug'
  status: text('status').notNull().default('pending'),
  // 'pending' | 'processing' | 'done' | 'failed'
  flamegraphUrl: text('flamegraph_url'),   // S3/R2 URL
  hotspots: jsonb('hotspots'),             // Hotspot[]
  suggestions: jsonb('suggestions'),       // Suggestion[]
  regressionDetected: boolean('regression_detected'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

---

## 6. API Endpoints

```
POST   /api/v1/profile                  Upload binary + metadata → enqueue job
GET    /api/v1/projects                 Liste aller Projekte des Users
POST   /api/v1/projects                 Neues Projekt anlegen
GET    /api/v1/projects/:id/runs        Alle Runs eines Projekts
GET    /api/v1/runs/:id                 Run-Details (hotspots, suggestions, flamegraph URL)
GET    /api/v1/runs/:id/diff/:baseId    Diff zwischen zwei Runs
POST   /api/v1/webhooks/stripe          Stripe Webhook
GET    /api/v1/billing/portal           Stripe Customer Portal URL
```

---

## 7. C++ Core — Public API

```cpp
// lib/profiler/include/profiler.h

namespace realbench {

struct Hotspot {
  std::string symbol;
  std::string file;       // optional
  int         line;       // -1 if unknown
  double      self_pct;
  double      total_pct;
  uint64_t    call_count;
};

struct DiffEntry {
  std::string symbol;
  double      baseline_pct;
  double      current_pct;
  double      delta_pct;
  std::string status;    // "regression" | "improvement" | "stable"
};

struct ProfileResult {
  std::vector<Hotspot>   hotspots;
  std::string            flamegraph_svg;
  std::string            flamegraph_json;
  uint64_t               duration_ms;
};

// Hauptfunktionen
ProfileResult profile(pid_t target_pid, uint32_t duration_ms, uint32_t sample_hz = 99);
ProfileResult profile_binary(const std::string& binary_path, const std::vector<std::string>& args);
std::vector<DiffEntry> diff(const ProfileResult& baseline, const ProfileResult& current);

} // namespace realbench
```

---

## 8. LLM Integration

### System Prompt (unveränderlich, einmalig gesetzt)

```
You are a performance engineering assistant specializing in C++, Rust, and Go profiling.
You receive structured flamegraph data and return actionable optimization suggestions in JSON.

Rules:
- Always respond with valid JSON only, no markdown, no prose
- Rank suggestions by estimated impact (high/medium/low)
- Be concrete: name the exact function, file, and line if available
- Suggest a fix, not just a diagnosis
- Max 5 suggestions per analysis
- If the diff shows a regression, flag it explicitly
```

### User Prompt Template

```typescript
// apps/api/src/services/llm.ts

function buildPrompt(run: ProfilingRun, baseline?: ProfilingRun): string {
  return `
Analyze this profiling run and return optimization suggestions.

## Context
- Project: ${run.projectName}
- Language: ${run.language}
- Commit: ${run.commitSha}
- Branch: ${run.branch}
- Build type: ${run.buildType}

## Top hotspots (sorted by % CPU)
${JSON.stringify(run.hotspots, null, 2)}

${baseline ? `## Flamegraph diff vs. baseline (${baseline.commitSha})
${JSON.stringify(diff(baseline, run), null, 2)}` : ''}

${run.constraints ? `## Constraints\n${run.constraints}` : ''}

Respond with this exact JSON schema:
{
  "regression_detected": boolean,
  "regression_summary": string | null,
  "suggestions": [{
    "rank": number,
    "impact": "high" | "medium" | "low",
    "symbol": string,
    "file": string | null,
    "line": number | null,
    "problem": string,
    "fix": string,
    "estimated_speedup": string | null
  }]
}
`.trim();
}
```

### API Call

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // ANTHROPIC_API_KEY aus env

async function analyzeProfiling(run: ProfilingRun, baseline?: ProfilingRun) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrompt(run, baseline) }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return JSON.parse(text) as LLMAnalysis;
}
```

---

## 9. Umgebungsvariablen

```bash
# apps/api/.env

# Auth
CLERK_SECRET_KEY=sk_...
CLERK_PUBLISHABLE_KEY=pk_...

# Database
DATABASE_URL=postgresql://user:pass@host:5432/realbench

# Redis
REDIS_URL=redis://...

# Storage
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=realbench-flamegraphs

# Billing
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# LLM
ANTHROPIC_API_KEY=sk-ant-...

# App
PORT=3000
NODE_ENV=production
```

---

## 10. Coding-Konventionen

- **Sprache:** TypeScript strict mode überall im Backend und Frontend
- **Formatierung:** Prettier + ESLint (Airbnb-Basis)
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`)
- **Branching:** `main` (production), `dev` (staging), Feature-Branches `feature/xyz`
- **Tests:** Jede Route bekommt einen Integrationstest (Vitest + Supertest)
- **Error Handling:** Alle async Funktionen wrappen Fehler in ein `Result<T, E>` Pattern
- **Secrets:** Niemals in Code committen — ausschließlich über Umgebungsvariablen
- **C++ Style:** Google C++ Style Guide, `clang-format` enforced

---

## 11. MVP-Scope (Phase 1)

Was in Phase 1 gebaut wird — alles andere ist Out of Scope:

- [x] C++ CLI-Tool: `realbench profile ./my_binary` → gibt `flamegraph.html` aus
- [x] Node.js API: `POST /profile` nimmt Binary entgegen, gibt Job-ID zurück
- [x] BullMQ Worker: ruft C++ Addon auf, speichert Ergebnis
- [x] PostgreSQL: Runs + Users speichern
- [x] R2: Flamegraph SVGs hochladen
- [x] React Dashboard: Run-Liste + Flamegraph-Viewer (statisch, Link auf R2-SVG)
- [x] Claude Integration: Suggestions aus Hotspots generieren
- [ ] GitHub Actions: `realbench-action` als YAML-Step

**Out of Scope für Phase 1:**
- Stripe Billing (Free-Plan reicht für Beta)
- Team-Management / Seats
- GitLab CI Integration
- WASM-Export des C++ Core

---

## 12. Language-spezifisches Profiling-Handling

Der C++ Core erkennt das Binary-Format automatisch via ELF-Section-Analyse
(`detect_binary_runtime()` in `sampler.cpp`). Je nach erkannter Runtime
werden **unterschiedliche perf-Flags und Symbol-Strategien** verwendet:

### C++ / Native (default)

```
perf record -F <hz> -g --call-graph dwarf,65528 -m 16M -o <out> -- <binary>
```
- DWARF-Callgraph mit 65 528-Byte Stack-Sample → vollständige Inlining-Tiefe
- Symbol-Resolution: ELF-Symboltabelle via libelf + DWARF debug_info
- Demangling: `__cxa_demangle`

### Go

```
perf record -F <hz> -g --call-graph fp -m 16M -o <out> -- <binary>
```
- Go nutzt Frame-Pointer statt DWARF-Unwinding (seit Go 1.12 standardmäßig aktiv)
- `--call-graph dwarf` hat unter Go hohen Overhead und erzeugt keine sinnvollen
  Stacks — daher **fp** (Frame-Pointer) bevorzugen
- Symbol-Resolution: `.gopclntab`-Section wird direkt ausgewertet → exakte
  Go-Funktionsnamen statt manglined C-Symbole
- Goroutine-ID wird aus dem perf-Script-Output extrahiert (TID-Mapping)

### Rust

```
perf record -F <hz> -g --call-graph dwarf,65528 -m 16M -o <out> -- <binary>
```
- Identisch zu C++, da Rust native ELF-Binaries mit DWARF erzeugt
- Symbol-Demangling: Rust-spezifischer Demangler (rustc-demangle-Algorithmus)
  statt C++-Demangler — erkennbar am `_R` oder `_ZN`-Prefix
- Build-Empfehlung im API-Response: `RUSTFLAGS="-C debuginfo=2"` für vollständige
  Symbolinformation

### Implementierungsdetail (`sampler.cpp`)

```cpp
// profile_binary_perf() liest rt und wählt call-graph-Strategie:
if (rt == BinaryRuntime::GO) {
    cmd.push_back("fp");          // Frame-Pointer für Go
} else {
    cmd.push_back("dwarf,65528"); // DWARF für C++/Rust
}
cmd.push_back("-m");
cmd.push_back("16M");             // Mmap-Ringpuffer für alle Runtimes

// Symbol-Demangling in build_result() je nach rt:
if (rt == BinaryRuntime::RUST)   demangle_rust(name);
else if (rt == BinaryRuntime::NATIVE) demangle_cpp(name);
// Go: keine Demangling-Schicht notwendig
```

### Schema-Erweiterung (`profilingRuns`)

```typescript
detectedLanguage: text('detected_language'), // 'cpp' | 'go' | 'rust' | 'unknown'
callgraphMode:   text('callgraph_mode'),     // 'dwarf' | 'fp'
```

---

## 13. Large Binary / Large Project Support

Um auch umfangreiche Projekte (>500 MB Binary, große Debug-Symboltabellen)
profilen zu können, müssen an mehreren Stellen Grenzen angehoben werden:

### Upload-Limit (API)

| Layer | Aktuell | Ziel |
|---|---|---|
| Hono `bodyLimit` | Standard (~1 MB) | **500 MB** |
| R2 Upload | Streaming via `@aws-sdk/lib-storage` multipart | unverändert |
| Worker tmpdir | kein Limit | Binary + perf.data + script.out ≤ 3× Binärgröße |

```typescript
// apps/api/src/index.ts — globales bodyLimit für Profile-Route
import { bodyLimit } from 'hono/body-limit';
app.use('/api/v1/profile', bodyLimit({ maxSize: 500 * 1024 * 1024 }));
```

### perf record — Ringpuffer

- Standardmäßig 256 KiB Mmap-Ringpuffer → bei langen Läufen gehen Samples verloren
- Fix: `-m 16M` Flag in `profile_binary_perf()` (siehe Abschnitt 12)

### Timeout-Anpassung (`profiler.ts`)

```typescript
// Aktuell: (durationSeconds * 60 + 120) * 1000
// Neu (großzügiger für große Binaries):
const timeoutMs = (durationSeconds * 120 + 300) * 1000;
```

### Fly.io Worker VM

```toml
# fly.worker.toml
[vm]
  memory = '4gb'
  cpus = 2
[mounts]
  source = 'realbench_tmp'
  destination = '/tmp'
  size_gb = 20
```

### Streaming-Parser (Phase 2)

`perf script`-Output kann mehrere GB erreichen. Statt vollständig auf Disk
zu spulen und dann zu parsen: **Streaming-Parser** der direkt aus dem Pipe-FD
liest und Frames on-the-fly akkumuliert. Dies vermeidet das 3×-Disk-Overhead.

---

## 14. Interaktiver Flamegraph

### Entscheidung: Eigene React-Komponente auf Basis von D3

**Warum nicht `d3-flame-graph` Library:**
- Keine nativen TypeScript-Typings
- Stark eingeschränkte Interaktivität (kein Diff-Overlay, kein Filter)
- Bundle-Bloat (~150 KB zusätzlich)

**Gewählter Ansatz:** Eigene `<FlameGraph>`-Komponente auf Basis von
`d3-hierarchy` + `d3-scale` + `d3-zoom`.

### Datenformat

```typescript
// packages/shared/src/types.ts
export interface FlameNode {
  name: string;
  value: number;        // self samples
  totalValue: number;   // total samples
  selfPct: number;
  totalPct: number;
  file?: string;
  line?: number;
  language?: string;    // 'cpp' | 'go' | 'rust'
  children: FlameNode[];
}
```

### Komponenten-API

```tsx
// apps/web/src/components/FlameGraph.tsx
<FlameGraph
  data={flameNode}          // FlameNode root
  width={containerWidth}
  height={600}
  onNodeClick={(node) => setSelectedNode(node)}  // Drill-down/Zoom
  onSearch={(query) => highlightMatching(query)}  // Regex-Suche
  colorScheme="hot"         // 'hot' | 'cold' | 'diff'
  diffBaseline={baseNode}   // optional: diff-coloring
/>
```

### Features

| Feature | Beschreibung |
|---|---|
| **Zoom/Pan** | Click-to-zoom auf Frame, Breadcrumb-Navigation zurück |
| **Hover-Tooltip** | Symbol, Datei:Zeile, Self%/Total%, Samples |
| **Regex-Suche** | Frames highlighten die den Suchbegriff matchen |
| **Diff-Coloring** | Grün/Rot-Overlay wenn `diffBaseline` gesetzt |
| **Frame-Auswahl** | Klick auf Frame → scrollt Hotspot-Tabelle zu Zeile |
| **Export** | Download als SVG oder PNG (via `canvas.toBlob`) |

### Neue API-Route

```
GET /api/v1/runs/:id/flamegraph.json   → FlameNode (hierarchisch, D3-Format)
```

Das SVG in R2 bleibt als Fallback erhalten (CLI-Output, E-Mail-Reports).

---

## 15. Nächste Implementierungsschritte (Priorität)

### Priorität 1 — Sofort umsetzbar

1. **`sampler.cpp`:** `profile_binary_perf()` → runtime-abhängige
   `--call-graph`-Strategie (fp für Go, dwarf für C++/Rust) + `-m 16M`
2. **`sampler.cpp`:** Rust-Demangling in `build_result()` ergänzen
3. **`apps/api/src/index.ts`:** `bodyLimit(500 MB)` für `/api/v1/profile`
4. **`apps/api/src/services/profiler.ts`:** Timeout-Formel anpassen

### Priorität 2 — Frontend / Phase 2

5. **`apps/web/src/components/FlameGraph.tsx`:** Interaktive D3-Komponente
6. **`apps/api/src/routes/runs.ts`:** `/runs/:id/flamegraph.json`-Route
7. **`apps/web/src/pages/RunDetail.tsx`:** Embedded Flamegraph statt externem Link
8. **`lib/profiler/src/flamegraph.cpp`:** JSON-Output auf D3-Hierarchie-Format umstellen

### Priorität 3 — Infrastructure & Scale

9. **`fly.worker.toml`:** 4 GB RAM + 20 GB tmpdir Mount
10. **Streaming-Parser** für `perf script`-Output (kein Disk-Spooling)
11. **GitHub Actions `realbench-action`** als wiederverwendbarer YAML-Step
12. **Diff-Visualisierung im UI** (DiffChart mit Recharts)

---

*Spec-Version: 1.1 — April 2026*
