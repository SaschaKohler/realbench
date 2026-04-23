# RealBench — Global Agent Instructions

RealBench is a **Performance Profiling as a Service** platform for C++, Rust, and Go projects.

## Monorepo Structure

```
realbench/
├── apps/api/        # Hono REST API + pg-boss profiling worker (TypeScript, Node.js 20)
├── apps/web/        # React 18 dashboard (Vite, TailwindCSS, TanStack Query)
├── packages/shared/ # Shared TypeScript types and Drizzle ORM schema
└── lib/profiler/    # C++ sampling profiler (perf_event_open + Node.js N-API bindings)
```

## Package Manager

- Always use **pnpm** (v8+). Never use npm or yarn.
- Workspace commands: `pnpm --filter @realbench/<pkg> <script>` or `pnpm --filter api <script>`.

## Language & TypeScript

- TypeScript strict mode is enabled in all packages.
- Use ES module syntax (`import`/`export`), never `require()`.
- All new files must have explicit type annotations — avoid `any`.
- `"type": "module"` is set in all `package.json` files; imports inside TS files must use `.js` extensions (e.g. `import foo from './foo.js'`).

## Code Style

- Formatter: **Prettier** (`pnpm format`). Run before committing.
- Linter: **ESLint** per-package. Run `pnpm lint` in the affected app.
- No commented-out code in committed files.

## Database

- ORM: **Drizzle ORM** with PostgreSQL 15.
- Schema lives in `packages/shared/src/schema.ts` and is re-exported from `apps/api/src/db/schema.ts`.
- Schema changes require a new migration: `pnpm db:generate` then `pnpm db:migrate`.
- Never use raw SQL for queries; use Drizzle query builder or `drizzle.execute` only as last resort.

## Authentication

- Auth provider: **Clerk**. Every protected API route must verify the Clerk session token via the auth middleware.
- Frontend: use `@clerk/clerk-react` hooks (`useAuth`, `useUser`).

## Storage

- Binary uploads and flamegraph SVGs are stored in **Cloudflare R2** via `apps/api/src/services/storage.ts`.

## LLM Integration

- LLM analysis uses **Anthropic Claude** via `@anthropic-ai/sdk`. Logic lives in `apps/api/src/services/llm.ts`.

## Deployment

- Platform: **Fly.io** (Frankfurt region). Config: `fly.api.toml`, `fly.web.toml`, `fly.worker.toml`.
- Deploy script: `./scripts/fly-deploy.sh`.
- Secrets are managed via `fly secrets set` — never hard-code credentials.
- CI/CD: GitHub Actions (`.github/workflows/`).

## Testing

- API tests: **Vitest** (`pnpm test` in `apps/api`).
- C++ tests: Google Test via CMake/CTest in `lib/profiler`.
- Write tests for all new services and routes.

## Environment Variables

- Copy `.env.example` → `.env` in each app before running locally.
- Never commit `.env` files. They are `.gitignore`d.
