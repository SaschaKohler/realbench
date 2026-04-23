# Shared Package — Agent Instructions

This package (`@realbench/shared`) contains **shared TypeScript types and the Drizzle ORM schema** used by both `apps/api` and `apps/web`.

## Contents

```
src/
├── index.ts    # Public re-exports
├── schema.ts   # Drizzle ORM table definitions (users, projects, profiling_runs)
└── types.ts    # Shared TypeScript types (API request/response shapes, enums)
```

## Rules

- This package has **no runtime dependencies** other than `drizzle-orm` and `postgres`. Keep it lean.
- **Never import** from `apps/api` or `apps/web` — this package is the dependency, not the dependent.
- All exports must flow through `src/index.ts`.
- Use ES module syntax (`import`/`export`); the package is `"type": "module"`.

## Schema Changes

1. Edit `src/schema.ts`.
2. Run `pnpm db:generate` (in repo root or `apps/api`) to create a new Drizzle migration SQL file.
3. Run `pnpm db:migrate` to apply.
4. Update the corresponding TypeScript types in `src/types.ts` if the shape changes.
5. Never manually edit files in `apps/api/drizzle/` — they are generated.

## Type Conventions

- Prefer `type` aliases over `interface` for object shapes.
- Derive DB types directly from Drizzle: `typeof table.$inferSelect` / `$inferInsert`.
- API request/response types live in `types.ts` and mirror the Zod schemas in `apps/api`.
- Use `z.infer<typeof schema>` in the API for runtime validation; use the shared type for static typing.
