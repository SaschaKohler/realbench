# RealBench - Systemarchitektur

**Dokumentation für:** API Layer, Frontend, Database, Infrastructure, LLM Integration, Deployment  
**Ergänzt:** Lehrbuch Teil 1-3 (C++ Profiler Core)  
**Stand:** 23. April 2026

---

## 1. Systemübersicht

### 1.1 Komponenten-Architektur

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                         │
│  │   Browser   │  │   GitHub    │  │    CLI      │                         │
│  │  Dashboard  │  │   Actions   │  │  (geplant)  │                         │
│  └──────┬──────┘  └──────┬──────┘  └─────────────┘                         │
└─────────┼────────────────┼────────────────────────────────────────────────┘
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API LAYER (Hono)                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                     apps/api (Port 3000)                               │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │  │
│  │  │   Auth     │  │  Upload    │  │   Queue    │  │   LLM      │     │  │
│  │  │ Middleware │  │  Handler   │  │   Worker   │  │  Service   │     │  │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────┬──────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
│   PostgreSQL    │ │    Redis    │ │  Cloudflare R2  │
│  (User/Project/ │ │  (pg-boss   │ │ (Binary/SVG    │
│   Run-Daten)    │ │   Queue)    │ │   Storage)      │
└─────────────────┘ └─────────────┘ └─────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROFILER LAYER                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                    lib/profiler (C++ N-API)                         │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │  │
│  │  │  perf      │  │  Symbol    │  │ Flamegraph │  │    Diff    │    │  │
│  │  │  Sampler   │  │  Resolver  │  │  Generator │  │   Engine   │    │  │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘    │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Datenfluss: Profiling-Job

```
1. User uploadet Binary
   → POST /api/v1/profile
   → Auth Middleware (Clerk JWT verify)
   → Binary → R2 Storage
   → Job → pg-boss Queue

2. Worker verarbeitet Job
   → pg-boss worker pollt Queue
   → Binary von R2 downloaden
   → C++ Profiler ausführen (Worker Thread)
   → Flamegraph SVG → R2 upload
   → LLM Analyse (Claude API)
   → Ergebnis → PostgreSQL

3. User sieht Ergebnis
   → GET /api/v1/runs/:id
   → React Dashboard zeigt Flamegraph + Suggestions
```

---

## 2. Database Layer

### 2.1 Schema-Übersicht (Drizzle ORM)

**Datei:** `packages/shared/src/schema.ts`

```typescript
// Drei Haupt-Tabellen
users              → Clerk-User-Mapping
projects           → Projekt-Metadaten
profiling_runs     → Profiling-Ergebnisse
```

### 2.2 Tabellen-Details

#### `users`
```typescript
{
  id: uuid (PK)           // Interne DB-ID
  clerk_id: text (unique) // Clerk Auth Provider ID
  email: text
  created_at: timestamp
}
```
**Zweck:** Mapping zwischen Clerk Auth und internen Daten. User wird automatisch beim ersten Login erstellt (`getOrCreateUser()` in `apps/api/src/services/user.ts`).

#### `projects`
```typescript
{
  id: uuid (PK)
  user_id: uuid (FK → users)  // Project-Ownership
  name: text
  description: text (optional)
  language: enum ('cpp', 'rust', 'go')
  created_at: timestamp
  updated_at: timestamp
}
```
**Zweck:** Organisation von Binaries/Runs pro Projekt. Ein User hat mehrere Projects, ein Project hat mehrere ProfilingRuns.

#### `profiling_runs`
```typescript
{
  id: uuid (PK)
  project_id: uuid (FK → projects)
  status: enum ('pending', 'processing', 'completed', 'failed')
  
  // Binary
  binary_path: text          // R2 Key
  binary_size: bigint
  binary_hash: text (sha256) // Integrity-Check
  
  // Profiling Config
  duration_seconds: integer
  frequency_hz: integer
  arguments: text[]          // CLI-Args für Binary
  
  // Ergebnisse
  flamegraph_url: text       // R2-URL zum SVG
  hotspots: jsonb             // Array von Hotspot-Objekten
  suggestions: jsonb          // LLM-Optimierungsvorschläge
  total_samples: bigint
  exit_code: integer         // Exit-Code des Binary
  
  // Diff
  baseline_run_id: uuid (FK, optional) // Für Vergleiche
  
  // Metadata
  commit_sha: text (optional)
  created_at: timestamp
  completed_at: timestamp (nullable)
  error_message: text (nullable)
}
```

### 2.3 Migrationen

**Befehle:**
```bash
pnpm db:generate    # Neue Migration generieren
pnpm db:push        # Schema in DB pushen (Dev)
pnpm db:migrate     # Migrations ausführen (Prod)
```

**Migrationen liegen in:** `apps/api/drizzle/`

---

## 3. API Layer (apps/api)

### 3.1 Projektstruktur

```
apps/api/
├── src/
│   ├── db/
│   │   ├── index.ts      # PostgreSQL-Pool + Drizzle-Client
│   │   └── schema.ts     # Re-export aus @realbench/shared
│   ├── middleware/
│   │   └── auth.ts       # Clerk JWT Verification
│   ├── routes/
│   │   ├── projects.ts   # CRUD für Projects
│   │   ├── runs.ts       # Run-Details + Diff
│   │   └── profile.ts    # Binary Upload + Job Enqueue
│   ├── services/
│   │   ├── llm.ts        # Claude API Integration
│   │   ├── profiler.ts   # C++ Profiler Wrapper
│   │   ├── storage.ts    # R2 (S3) Operations
│   │   └── user.ts       # getOrCreateUser
│   ├── workers/
│   │   └── profiling-worker.ts  # pg-boss Job Handler
│   └── index.ts          # Hono App Setup
├── drizzle/              # Migrationen
└── .env                  # Umgebungsvariablen
```

### 3.2 Hono App Setup

**Datei:** `apps/api/src/index.ts`

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { clerkMiddleware } from '@hono/clerk-auth'

const app = new Hono()

// CORS für localhost:5173 (Vite Dev)
app.use(cors({
  origin: ['http://localhost:5173'],
  credentials: true,
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE']
}))

// Clerk Auth auf allen /api/* Routes
app.use('/api/*', clerkMiddleware())

// Routes
app.route('/api/v1/profile', profileRouter)
app.route('/api/v1/projects', projectsRouter)
app.route('/api/v1/runs', runsRouter)

// Body-Limit für Binary-Upload (500 MB)
app.use('/api/v1/profile', bodyLimit(500 * 1024 * 1024))

serve({ fetch: app.fetch, port: 3000 })
```

### 3.3 Auth Middleware

**Datei:** `apps/api/src/middleware/auth.ts`

```typescript
import { verifyToken } from '@clerk/backend'

export const authMiddleware = async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  
  // Clerk JWT verifizieren
  const session = await verifyToken(token, {
    secretKey: process.env.CLERK_SECRET_KEY
  })
  
  // User aus DB holen oder erstellen
  const user = await getOrCreateUser(session.sub, session.email)
  
  // An Context hängen für Routes
  c.set('user', user)
  await next()
}
```

### 3.4 API Endpoints

| Endpoint | Methode | Beschreibung | Auth |
|----------|---------|--------------|------|
| `/api/v1/profile` | POST | Binary upload, Job enqueue | ✅ |
| `/api/v1/projects` | GET | Liste aller Projects | ✅ |
| `/api/v1/projects` | POST | Neues Project erstellen | ✅ |
| `/api/v1/projects/:id/runs` | GET | Runs eines Projects | ✅ |
| `/api/v1/runs/:id` | GET | Run-Details + Hotspots | ✅ |
| `/api/v1/runs/:id/diff/:baseId` | GET | Profile-Vergleich | ✅ |

### 3.5 Profile Route (Binary Upload)

**Datei:** `apps/api/src/routes/profile.ts`

```typescript
app.post('/', async (c) => {
  const user = c.get('user')
  const form = await c.req.formData()
  
  // Binary extrahieren
  const binary = form.get('binary') as File
  const projectId = form.get('projectId') as string
  const config = JSON.parse(form.get('config') as string)
  
  // Upload zu R2
  const key = `binaries/${user.id}/${projectId}/${uuid()}`
  await storage.upload(key, binary.stream(), binary.size)
  
  // Job in Queue einreihen
  const jobId = await queue.enqueue('profiling-job', {
    userId: user.id,
    projectId,
    binaryKey: key,
    binarySize: binary.size,
    config
  })
  
  return c.json({ jobId, status: 'pending' })
})
```

---

## 4. Queue System (pg-boss)

### 4.1 Warum pg-boss?

- **PostgreSQL-basiert:** Keine zusätzliche Infrastruktur (nutzt bestehende DB)
- **ACID:** Jobs sind transaktional mit DB-Updates
- **Retry-Logik:** Eingebaute Fehlerbehandlung
- **Scheduling:** Geplante Jobs möglich

### 4.2 Worker Implementation

**Datei:** `apps/api/src/workers/profiling-worker.ts`

```typescript
import PgBoss from 'pg-boss'

const boss = new PgBoss(process.env.DATABASE_URL)

// Job Handler registrieren
boss.work('profiling-job', async (job) => {
  const { binaryKey, config } = job.data
  
  // 1. Status: processing
  await updateRunStatus(job.id, 'processing')
  
  try {
    // 2. Binary von R2 downloaden
    const binaryPath = await storage.download(binaryKey, `/tmp/${job.id}`)
    
    // 3. C++ Profiler ausführen
    const result = await profileBinary(binaryPath, {
      frequencyHz: config.frequency_hz || 99,
      durationSeconds: config.duration_seconds || 30
    })
    
    // 4. Flamegraph zu R2 uploaden
    const flamegraphKey = `flamegraphs/${job.id}.svg`
    await storage.uploadString(flamegraphKey, result.flamegraphSvg)
    
    // 5. LLM Analyse
    const suggestions = await analyzeHotspots(result.hotspots)
    
    // 6. Ergebnis speichern
    await updateRun(job.id, {
      status: 'completed',
      flamegraphUrl: storage.getUrl(flamegraphKey),
      hotspots: result.hotspots,
      suggestions,
      totalSamples: result.totalSamples,
      exitCode: result.exitCode,
      completedAt: new Date()
    })
    
  } catch (error) {
    await updateRun(job.id, {
      status: 'failed',
      errorMessage: error.message
    })
    throw error // pg-boss retry
  }
})
```

### 4.3 Worker-Deployment

**Separater Fly.io Worker:**
```toml
# fly.worker.toml
[build]
  dockerfile = "../docker/Dockerfile.worker"

[env]
  DATABASE_URL = "..."
  R2_ENDPOINT = "..."

[[vm]]
  size = "performance-2x"  # 4 GB RAM für große Binaries
```

---

## 5. LLM Integration (Claude API)

### 5.1 Service-Architektur

**Datei:** `apps/api/src/services/llm.ts`

```typescript
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

export async function analyzeHotspots(
  hotspots: Hotspot[],
  language: 'cpp' | 'rust' | 'go'
): Promise<Suggestion[]> {
  
  const prompt = buildPrompt(hotspots, language)
  
  const response = await anthropic.messages.create({
    model: 'claude-3-sonnet-20240229',
    max_tokens: 2000,
    system: `Du bist ein Performance-Experte für ${language}. ` +
            'Analysiere Hotspots und schlage konkrete Optimierungen vor.',
    messages: [{ role: 'user', content: prompt }]
  })
  
  return parseSuggestions(response.content[0].text)
}

function buildPrompt(hotspots: Hotspot[], language: string): string {
  return `
Analysiere diese Performance-Hotspots für ein ${language}-Projekt:

${hotspots.slice(0, 10).map(h => `
- ${h.symbol}: ${h.self_pct.toFixed(1)}% der CPU-Zeit (${h.self_samples} samples)
`).join('')}

Für jeden Hotspot:
1. Erkläre warum er teuer ist
2. Schlage konkrete Optimierung vor
3. Schätze erwartete Beschleunigung

Antworte als JSON-Array mit {symbol, explanation, suggestion, estimatedSpeedup}.
`
}
```

### 5.2 Prompt-Engineering

| Strategie | Umsetzung |
|-----------|-----------|
| Kontext | Language-Specific System Prompt |
| Top-N Filter | Nur Top-10 Hotspots (verhindert Token-Overflow) |
| Structured Output | JSON-Schema in Prompt |
| Beispiele | Few-Shot bei komplexen Patterns |

---

## 6. Storage Layer (Cloudflare R2)

### 6.1 R2 vs S3

R2 ist S3-compatible aber:
- **Keine Egress-Gebühren** (kostenloser Download)
- **S3 API kompatibel** (AWS SDK verwendbar)
- **Global CDN** eingebaut

### 6.2 Service-Implementation

**Datei:** `apps/api/src/services/storage.ts`

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
})

const BUCKET = 'realbench-flamegraphs'

export const storage = {
  async upload(key: string, stream: ReadableStream, size: number) {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: stream,
      ContentLength: size
    }))
  },
  
  async uploadString(key: string, content: string) {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: content,
      ContentType: 'image/svg+xml'
    }))
  },
  
  async download(key: string, localPath: string): Promise<string> {
    const { Body } = await r2.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: key
    }))
    // Stream zu Datei schreiben
    await writeFile(localPath, Body)
    return localPath
  },
  
  getUrl(key: string): string {
    // Public URL via Cloudflare CDN
    return `${process.env.R2_PUBLIC_URL}/${key}`
  }
}
```

### 6.3 Storage-Layout

```
realbench-flamegraphs (Bucket)
├── binaries/
│   └── {userId}/
│       └── {projectId}/
│           └── {uuid}              # Uploadiertes Binary
├── flamegraphs/
│   └── {runId}.svg                 # Generiertes SVG
└── profiles/
    └── {runId}.json                # Rohe Profile-Daten (optional)
```

---

## 7. Frontend (apps/web)

### 7.1 Tech Stack

| Komponente | Technologie |
|------------|-------------|
| Framework | React 18 + TypeScript |
| Build Tool | Vite 5 |
| Styling | TailwindCSS |
| Data Fetching | TanStack Query (React Query) |
| Auth | @clerk/clerk-react |
| Routing | React Router 6 |
| State | Zustand (lightweight) |

### 7.2 Projektstruktur

```
apps/web/
├── src/
│   ├── lib/
│   │   ├── api.ts          # API Client (fetch wrapper)
│   │   └── queries.ts      # TanStack Query Hooks
│   ├── pages/
│   │   ├── Dashboard.tsx   # Projekt-Liste
│   │   ├── ProjectDetail.tsx  # Runs + Upload
│   │   └── RunDetail.tsx   # Flamegraph + Suggestions
│   ├── components/
│   │   ├── FlameGraph.tsx  # SVG-Anzeige (später D3)
│   │   ├── UploadForm.tsx  # Binary Upload
│   │   └── Suggestions.tsx # LLM-Vorschläge
│   ├── hooks/
│   │   └── useAuth.ts      # Clerk-Integration
│   └── main.tsx            # Entry Point
├── index.html
└── vite.config.ts
```

### 7.3 API Client

**Datei:** `apps/web/src/lib/api.ts`

```typescript
import { useAuth } from '@clerk/clerk-react'

const API_URL = import.meta.env.VITE_API_URL

export async function fetchApi(
  endpoint: string,
  options: RequestInit = {}
) {
  const { getToken } = useAuth()
  const token = await getToken()
  
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  })
  
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// Typed API-Funktionen
export const api = {
  getProjects: () => fetchApi('/api/v1/projects'),
  createProject: (data) => fetchApi('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  uploadBinary: (formData) => fetchApi('/api/v1/profile', {
    method: 'POST',
    body: formData  // multipart/form-data
  }),
  getRun: (id) => fetchApi(`/api/v1/runs/${id}`),
  getDiff: (id, baseId) => fetchApi(`/api/v1/runs/${id}/diff/${baseId}`)
}
```

### 7.4 TanStack Query Hooks

**Datei:** `apps/web/src/lib/queries.ts`

```typescript
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from './api'

export const useProjects = () =>
  useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects
  })

export const useRun = (id: string) =>
  useQuery({
    queryKey: ['runs', id],
    queryFn: () => api.getRun(id),
    refetchInterval: (query) => 
      query.state.data?.status === 'processing' ? 2000 : false
  })

export const useUpload = () =>
  useMutation({
    mutationFn: api.uploadBinary,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    }
  })
```

### 7.5 Run Detail Page

**Datei:** `apps/web/src/pages/RunDetail.tsx`

```typescript
export function RunDetail() {
  const { id } = useParams()
  const { data: run } = useRun(id)
  
  if (run.status === 'processing') {
    return <LoadingSpinner />
  }
  
  return (
    <div className="container mx-auto p-6">
      <h1>Run #{run.id}</h1>
      
      {/* Flamegraph (externer R2-Link) */}
      <iframe 
        src={run.flamegraphUrl}
        className="w-full h-96 border rounded"
      />
      
      {/* Hotspots Tabelle */}
      <HotspotsTable hotspots={run.hotspots} />
      
      {/* LLM Suggestions */}
      <SuggestionsList suggestions={run.suggestions} />
    </div>
  )
}
```

---

## 8. Deployment & Infrastructure

### 8.1 Fly.io Setup

Drei separate Apps:

| App | Config | Zweck |
|-----|--------|-------|
| `realbench-api` | `fly.api.toml` | Hono API (HTTP Requests) |
| `realbench-web` | `fly.web.toml` | Vite Static Hosting |
| `realbench-worker` | `fly.worker.toml` | pg-boss Worker (Profiling) |

**fly.api.toml:**
```toml
app = "realbench-api"
primary_region = "fra"

[build]
  dockerfile = "../docker/Dockerfile.api"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true

[[vm]]
  memory = "1gb"
  cpu_kind = "shared"
```

**fly.worker.toml:**
```toml
app = "realbench-worker"
primary_region = "fra"

[build]
  dockerfile = "../docker/Dockerfile.worker"

[env]
  NODE_ENV = "production"

[[vm]]
  memory = "4gb"          # Für große Binaries
  cpu_kind = "performance"
```

### 8.2 Docker Setup

**Dockerfile.worker** (wichtig: perf_event Paranoid):
```dockerfile
FROM node:20-slim

# System-Dependencies für Profiler
RUN apt-get update && apt-get install -y \
    linux-perf \
    libelf-dev \
    libunwind-dev \
    addr2line

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# Kernel-Parameter (nur für lokale Docker-Tests)
# In Prod: Fly.io VM muss kernel.perf_event_paranoid=-1 haben

CMD ["pnpm", "--filter", "api", "worker:start"]
```

### 8.3 Environment Variables

**API/Worker:**
```bash
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/realbench

# Redis (für BullMQ/pg-boss)
REDIS_URL=redis://localhost:6379

# Clerk Auth
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# R2 Storage
R2_ENDPOINT=https://....r2.cloudflarestorage.com
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_PUBLIC_URL=https://pub-....r2.dev

# LLM
ANTHROPIC_API_KEY=sk-ant-...
```

**Web:**
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=https://realbench-api.fly.dev
```

### 8.4 Deploy-Skript

**scripts/fly-deploy.sh:**
```bash
#!/bin/bash
set -e

# 1. Datenbank-Migrationen
fly --config fly.api.toml ssh console -C "pnpm db:migrate"

# 2. API deployen
fly --config fly.api.toml deploy

# 3. Worker deployen
fly --config fly.worker.toml deploy

# 4. Web deployen
fly --config fly.web.toml deploy

echo "✅ Deployment complete"
```

---

## 9. CI/CD (GitHub Actions)

**Datei:** `.github/workflows/ci.yml`

```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
      redis:
        image: redis:7
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      
      - run: pnpm install
      
      # Build Shared Package
      - run: pnpm --filter @realbench/shared build
      
      # Type Check
      - run: pnpm --filter api typecheck
      - run: pnpm --filter web typecheck
      
      # Lint
      - run: pnpm lint
      
      # Test (API)
      - run: pnpm --filter api test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/realbench
          REDIS_URL: redis://localhost:6379

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: ./scripts/fly-deploy.sh
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

---

## 10. Datenfluss: Kompletter Ablauf

### 10.1 User Story: Erstes Profiling

```
1. User registriert sich via Clerk
   → Clerk Webhook (optional) oder erstes Login
   → apps/api/src/services/user.ts: getOrCreateUser()
   → INSERT INTO users (clerk_id, email)

2. User erstellt Project im Dashboard
   → POST /api/v1/projects
   → INSERT INTO projects (user_id, name, language)

3. User uploadet Binary
   → POST /api/v1/profile
   → Auth Middleware prüft JWT
   → Binary-Stream zu R2: binaries/{userId}/{projectId}/{uuid}
   → INSERT INTO profiling_runs (project_id, status='pending', binary_path)
   → pg-boss: INSERT INTO job (name='profiling-job', data={...})
   → Response: { jobId, status: 'pending' }

4. Worker verarbeitet Job
   → pg-boss worker.poll()
   → UPDATE profiling_runs SET status='processing'
   → R2: Download binary zu /tmp/
   → lib/profiler: profileBinary() [C++ N-API]
     → perf record -F 99 -g --call-graph dwarf,65528
     → perf script → parse → addr2line → flamegraph.svg
   → R2: Upload flamegraphs/{runId}.svg
   → Claude API: analyzeHotspots()
   → UPDATE profiling_runs SET 
        status='completed',
        flamegraph_url='https://pub-...r2.dev/flamegraphs/{runId}.svg',
        hotspots=[...],
        suggestions=[...],
        completed_at=NOW()

5. User sieht Ergebnis
   → Frontend polling: GET /api/v1/runs/{id} (alle 2s)
   → Status 'completed' → Anzeige:
     - Flamegraph (iframe src=R2-URL)
     - Hotspots Tabelle (self_pct sortiert)
     - LLM Suggestions (symbol, explanation, fix)
```

### 10.2 Fehlerbehandlung

| Fehler | Erkennung | Aktion |
|--------|-----------|--------|
| Binary zu groß | `bodyLimit` exceeded | 413 Payload Too Large |
| profiling timeout | Worker-Timer (32min) | status='failed', retry=0 |
| perf nicht verfügbar | C++ throw (rc=127) | Mock-Fallback (optional) |
| LLM API Error | HTTP 5xx | Suggestions = [], Hinweis im UI |
| R2 Upload Fail | Exception | Job retry (pg-boss) |

---

## 11. Troubleshooting & Betrieb

### 11.1 Logs & Monitoring

```bash
# Fly.io Logs
fly --config fly.api.toml logs
fly --config fly.worker.toml logs

# PostgreSQL (Docker lokal)
docker logs realbench-postgres

# Redis
redis-cli monitor

# Worker Queue Status
fly --config fly.worker.toml ssh console -C "pnpm --filter api queue:status"
```

### 11.2 Häufige Probleme

#### Problem: `perf_event_open: Permission denied`
**Ursache:** `kernel.perf_event_paranoid > -1`
**Lösung:**
```bash
# Lokal
sudo sysctl kernel.perf_event_paranoid=-1

# Fly.io (Worker VM)
# Muss in fly.worker.toml als [env] gesetzt werden
# oder VM-Template anpassen
```

#### Problem: Flamegraph zeigt `[unknown]`
**Ursache:** Binary hat keine Debug-Symbole
**Lösung:** Mit `-g` kompilieren (C++/Rust/Go)

#### Problem: CORS Error im Frontend
**Ursache:** API CORS nicht korrekt konfiguriert
**Lösung:** Prüfe `apps/api/src/index.ts`:
```typescript
app.use(cors({
  origin: ['http://localhost:5173', 'https://realbench.fly.dev']
}))
```

### 11.3 Backup & Recovery

**PostgreSQL:**
```bash
# Backup
fly pg backup create

# Restore
fly pg restore <backup-id>
```

**R2 Objects:**
- R2 hat eingebaute Versionierung (optional aktivieren)
- Kein automatisches Backup → manuelles `rclone sync`

---

## 12. Glossar

| Begriff | Bedeutung |
|---------|-----------|
| **pg-boss** | PostgreSQL-basierte Job-Queue für Node.js |
| **R2** | Cloudflare S3-compatible Storage |
| **Clerk** | Authentifizierungs-Provider mit React-Komponenten |
| **Drizzle ORM** | TypeScript-first ORM mit Schema-Typisierung |
| **TanStack Query** | Data-Fetching Library mit Caching/Polling |
| **Hono** | Lightweight Web-Framework (Express-Alternative) |
| **Fly.io** | Hosting-Plattform für Container |
| **Vite** | Fast Build-Tool für Frontend |

---

**Dokument erstellt:** 23. April 2026  
**Ergänzt Lehrbuch:** `lib/profiler/LEHRBUCH_1-3.md` (C++ Core)
