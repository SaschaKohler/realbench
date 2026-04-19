# RealBench Setup Guide

## Initial Setup

### 1. Install Dependencies

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Install all project dependencies
pnpm install
```

### 2. Configure Environment Variables

#### API (.env)

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` with your credentials:

```bash
PORT=3000
NODE_ENV=development

# Clerk Auth
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/realbench

# Redis
REDIS_URL=redis://localhost:6379

# R2 Storage
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=realbench-flamegraphs

# Stripe (optional for Phase 1)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...
```

#### Web (.env)

```bash
cp apps/web/.env.example apps/web/.env
```

Edit `apps/web/.env`:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_API_URL=http://localhost:3000
```

### 3. Setup PostgreSQL

```bash
# Using Docker
docker run -d \
  --name realbench-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=realbench \
  -p 5432:5432 \
  postgres:15

# Or install PostgreSQL locally
# macOS: brew install postgresql@15
# Linux: sudo apt install postgresql-15
```

### 4. Setup Redis

```bash
# Using Docker
docker run -d \
  --name realbench-redis \
  -p 6379:6379 \
  redis:7

# Or install Redis locally
# macOS: brew install redis
# Linux: sudo apt install redis-server
```

### 5. Setup Database Schema

```bash
# Generate Drizzle migrations
pnpm db:generate

# Push schema to database
pnpm db:push

# Or run migrations
pnpm db:migrate
```

### 6. Setup Clerk

1. Go to [clerk.com](https://clerk.com) and create an account
2. Create a new application
3. Copy the publishable and secret keys to your `.env` files
4. Configure allowed redirect URLs in Clerk dashboard:
   - `http://localhost:5173` (development)

### 7. Setup Cloudflare R2

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to R2 Object Storage
3. Create a new bucket named `realbench-flamegraphs`
4. Create R2 API tokens
5. Add credentials to `apps/api/.env`

### 8. Setup Anthropic Claude API

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Add to `apps/api/.env`

## Running the Application

### Development Mode

```bash
# Start all apps in parallel
pnpm dev

# Or start individual apps
pnpm --filter api dev
pnpm --filter web dev
```

The API will be available at `http://localhost:3000`  
The web dashboard will be available at `http://localhost:5173`

### Production Build

```bash
# Build all apps
pnpm build

# Start API in production
cd apps/api
pnpm start
```

## Development Tools

### Database Studio

```bash
# Open Drizzle Studio for database management
pnpm --filter api db:studio
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm --filter api test --watch
```

### Linting & Formatting

```bash
# Run linter
pnpm lint

# Format code
pnpm format
```

## Troubleshooting

### Port Already in Use

If port 3000 or 5173 is already in use:

```bash
# Change PORT in apps/api/.env
PORT=3001

# Or kill the process using the port
lsof -ti:3000 | xargs kill
```

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker ps | grep realbench-postgres

# Check database logs
docker logs realbench-postgres

# Verify connection string
psql postgresql://postgres:postgres@localhost:5432/realbench
```

### Redis Connection Issues

```bash
# Check if Redis is running
docker ps | grep realbench-redis

# Test Redis connection
redis-cli ping
```

## Next Steps

1. Complete C++ profiler core implementation
2. Add comprehensive test coverage
3. Implement GitHub Actions integration
4. Add Stripe billing (post-MVP)
5. Add GitLab CI support (post-MVP)

## Documentation

- [Architecture Spec](./SPEC.md)
- [API Documentation](./docs/api.md) (TBD)
- [Contributing Guide](./CONTRIBUTING.md) (TBD)
