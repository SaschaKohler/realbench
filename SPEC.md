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
- [ ] Node.js API: `POST /profile` nimmt Binary entgegen, gibt Job-ID zurück
- [ ] BullMQ Worker: ruft C++ Addon auf, speichert Ergebnis
- [ ] PostgreSQL: Runs + Users speichern
- [ ] R2: Flamegraph SVGs hochladen
- [ ] React Dashboard: Run-Liste + Flamegraph-Viewer
- [ ] Claude Integration: Suggestions aus Hotspots generieren
- [ ] GitHub Actions: `realbench-action` als YAML-Step

**Out of Scope für Phase 1:**
- Stripe Billing (Free-Plan reicht für Beta)
- Team-Management / Seats
- GitLab CI Integration
- WASM-Export des C++ Core

---

*Spec-Version: 1.0 — April 2026*
