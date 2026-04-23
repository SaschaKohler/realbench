# API — Agent Instructions

This is the **Hono REST API + pg-boss profiling worker** for RealBench.
Language: TypeScript (Node.js 20, ES modules, strict mode).

## Structure

```
src/
├── index.ts          # Hono app entrypoint, CORS, route mounting
├── types.ts          # Shared Hono context variable types
├── db/
│   ├── index.ts      # Drizzle client (postgres.js)
│   └── schema.ts     # Re-export from @realbench/shared
├── middleware/       # Clerk auth middleware
├── routes/
│   ├── profile.ts    # POST /api/v1/profile — binary upload + job enqueue
│   ├── projects.ts   # CRUD /api/v1/projects
│   └── runs.ts       # GET /api/v1/runs/:id, diff endpoint
├── services/
│   ├── binary-analyzer.ts   # ELF/binary inspection
│   ├── llm.ts               # Anthropic Claude analysis
│   ├── profiler.ts          # Calls lib/profiler N-API bindings
│   ├── source-extractor.ts  # Source context extraction
│   ├── storage.ts           # Cloudflare R2 (upload/download/presign)
│   └── user.ts              # Clerk user sync helper
└── workers/
    ├── queue.ts              # pg-boss setup and job registration
    └── profiling-worker.ts   # Profiling job handler
```

## Framework & Libraries

- **Hono** v4 — routing, middleware, context typing via `Variables`.
- **Drizzle ORM** — always use query builder; raw SQL only as absolute last resort.
- **pg-boss** v10 — PostgreSQL-native job queue; no Redis.
- **Clerk** (`@clerk/backend`) — verify session token in every protected route via `src/middleware/`.
- **Zod** — validate all incoming request bodies.

## Route Conventions

- All routes are typed via Hono's `Hono<{ Variables: Variables }>`.
- Auth middleware must be applied before any handler that touches user data.
- Return consistent JSON: `{ data: ... }` on success, `{ error: string }` on failure.
- HTTP status codes: 200/201 success, 400 bad request, 401 unauthenticated, 403 forbidden, 404 not found, 500 server error.

## Services

- `storage.ts` is the **only** place that interacts with R2. Use it for all binary and SVG upload/download.
- `llm.ts` is the **only** place that calls Anthropic. Always stream where possible to avoid timeout issues.
- `profiler.ts` calls into `lib/profiler` N-API bindings; run only inside the pg-boss worker, never in the request path.

## Workers

- The profiling worker is process-isolated and started via a separate Fly.io machine (`fly.worker.toml`).
- Jobs are enqueued from `routes/profile.ts` and processed in `workers/profiling-worker.ts`.
- On job failure, update the run's `status` to `'failed'` and persist the `error` message.

## Testing

- Framework: **Vitest** (`pnpm test` in this directory).
- Test files: co-located `*.test.ts` or in a `__tests__/` folder.
- Mock external services (R2, Anthropic, Clerk) with Vitest mocks — no real HTTP calls in unit tests.
- Use `supertest` or Hono's test utilities to test route handlers.

## Environment Variables

All required vars are documented in `.env.example`. Key vars:
- `DATABASE_URL` — PostgreSQL connection string
- `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `ANTHROPIC_API_KEY`
- `PORT` (default: 3000)

## Scripts

```bash
pnpm dev          # tsx watch (hot reload)
pnpm build        # tsc compile to dist/
pnpm start        # node dist/index.js
pnpm test         # vitest
pnpm db:generate  # drizzle-kit generate migration
pnpm db:migrate   # apply migrations
```
