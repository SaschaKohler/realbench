# Web — Agent Instructions

This is the **React 18 dashboard** for RealBench.
Language: TypeScript, ES modules, strict mode.
Build tool: **Vite 5**. Styling: **TailwindCSS 3**. State: **TanStack Query v5** + **Zustand**.

## Structure

```
src/
├── main.tsx          # App entry, ClerkProvider, QueryClientProvider, Router
├── App.tsx           # Top-level routes (react-router-dom v6)
├── index.css         # Tailwind base/components/utilities
├── vite-env.d.ts     # Vite env type declarations
├── lib/
│   └── api.ts        # Typed API client (fetch wrapper with auth headers)
└── pages/
    ├── Dashboard.tsx      # Project list, create project
    ├── ProjectDetail.tsx  # Runs list for a project, upload binary
    └── RunDetail.tsx      # Flamegraph viewer, hotspots, LLM suggestions, diff
```

## Component Conventions

- Use **functional components** with hooks only — no class components.
- File naming: `PageName.tsx` for pages, `ComponentName.tsx` for reusable components.
- Export components as **named exports**, not default exports (exception: page-level route components may use default).
- Keep components focused; extract sub-components when a single file exceeds ~150 lines.

## Styling

- Use **TailwindCSS utility classes** exclusively — no inline styles, no separate CSS files except `index.css`.
- Follow a mobile-first approach; use responsive prefixes (`sm:`, `md:`, `lg:`).
- Dark mode: use `dark:` variants if introduced; keep consistent with the existing color palette.

## Data Fetching

- All server state is managed with **TanStack Query** (`useQuery`, `useMutation`).
- Query keys follow the pattern `['resource', id?, filter?]` — e.g. `['projects']`, `['runs', projectId]`.
- The API base URL comes from `import.meta.env.VITE_API_URL`.
- All API calls go through `src/lib/api.ts` — do not call `fetch` directly in components.
- Always attach the Clerk JWT via `useAuth().getToken()` in the API client.

## Authentication

- Use `@clerk/clerk-react` hooks: `useAuth` for tokens, `useUser` for user info.
- Protect pages with `<SignedIn>` / `<SignedOut>` wrappers or redirect logic in the router.

## State Management

- **Server state** → TanStack Query.
- **Client/UI state** → React `useState`/`useReducer` locally, or **Zustand** for cross-component state.
- Do not use Context API for data that TanStack Query can handle.

## Environment Variables

All required vars are documented in `.env.example`. Key vars:
- `VITE_API_URL` — backend API base URL (e.g. `http://localhost:3000`)
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key

## Scripts

```bash
pnpm dev      # vite dev server (http://localhost:5173)
pnpm build    # tsc + vite build → dist/
pnpm preview  # preview production build
pnpm lint     # eslint
```
