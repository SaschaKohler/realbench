# RealBench

Performance Profiling as a Service for C++, Rust, and Go projects.

## Features

- 🔥 Automatic sampling profiling via CI/CD integration
- 📊 Flamegraph generation and visualization
- 📈 Historical diff view for performance regression detection
- 🤖 LLM-based optimization suggestions powered by Claude

## Project Structure

```
realbench/
├── apps/
│   ├── api/          # Hono backend with BullMQ workers
│   └── web/          # React dashboard (TBD)
├── packages/
│   └── shared/       # Shared TypeScript types and Drizzle schema
└── lib/
    └── profiler/     # C++ core library (TBD)
```

## Tech Stack

- **Backend**: Node.js 20, Hono, Drizzle ORM, BullMQ, Redis
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS
- **Database**: PostgreSQL 15
- **Storage**: Cloudflare R2
- **Auth**: Clerk
- **LLM**: Anthropic Claude (claude-sonnet-4-20250514)

## Setup

### Prerequisites

- Node.js 20+
- pnpm 8+
- PostgreSQL 15+
- Redis

### Installation

```bash
# Install dependencies
pnpm install

# Setup environment variables
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your credentials

# Generate Drizzle schema
pnpm db:generate

# Push schema to database
pnpm db:push
```

### Development

```bash
# Start all apps in development mode
pnpm dev

# Or start individual apps
pnpm --filter api dev
pnpm --filter web dev
```

### API Endpoints

- `POST /api/v1/profile` - Upload binary and enqueue profiling job
- `GET /api/v1/projects` - List all projects
- `POST /api/v1/projects` - Create new project
- `GET /api/v1/projects/:id/runs` - List runs for a project
- `GET /api/v1/runs/:id` - Get run details
- `GET /api/v1/runs/:id/diff/:baseId` - Compare two runs

## Phase 1 MVP Status

- [x] Project structure and monorepo setup
- [x] Drizzle schema and database configuration
- [x] Hono API with authentication
- [x] BullMQ worker for profiling jobs
- [x] R2 storage integration
- [x] Claude LLM integration
- [ ] React dashboard
- [ ] GitHub Actions integration
- [ ] C++ profiler core

## License

MIT
