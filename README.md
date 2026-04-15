# Home Services Marketplace

Production-grade home-services marketplace platform (TaskRabbit / Thumbtack class).

This repository is a `pnpm` + Turborepo monorepo containing:

- `apps/api` — NestJS backend (infrastructure baseline only at this stage)
- `apps/web` — React frontend (separate, not covered here)
- `packages/database` — Prisma schema & migrations (PostgreSQL)
- `packages/contracts`, `packages/ui` — shared scaffolds for later phases
- `infra/docker` — Docker Compose for local data-plane services

The current backend state is **infrastructure baseline only**. Authentication, bookings, services and other domain modules are intentionally not wired in; they will be reintroduced under `apps/api/src/modules/<domain>/` in subsequent phases.

---

## Local backend infrastructure setup

### Prerequisites

- Node.js **20.x**
- pnpm **10.x** (`corepack enable && corepack prepare pnpm@10 --activate`)
- Docker Desktop with Compose v2

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` if you need non-default ports. The infrastructure baseline does **not** require any auth/JWT secrets — those are commented out in `.env.example` and will be required only when the auth module is reintroduced.

The API validates the entire environment on boot via a strict Zod schema (`apps/api/src/config/env.schema.ts`). Missing or malformed variables cause an immediate, descriptive startup failure — the process never starts in a half-configured state.

### 3. Start data services (Postgres, Mongo, Redis)

```bash
pnpm docker:up           # postgres + mongo + redis (with healthchecks)
pnpm docker:logs         # follow logs
pnpm docker:down         # stop
```

### 4. Apply database schema (Postgres)

```bash
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/database migrate:deploy
```

### 5. Run the API in dev mode

```bash
pnpm --filter @homeservicemarketplace/api dev
```

The API binds to `http://localhost:4000`.

### Health & metrics endpoints

| Endpoint            | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `GET /health/live`  | Liveness probe — `200` whenever the process is running.               |
| `GET /health/ready` | Readiness probe — `200` only if Postgres, Mongo and Redis are all up. |
| `GET /metrics`      | Prometheus exposition format from the application registry.           |

Quick check:

```bash
curl -s http://localhost:4000/health/live
curl -s http://localhost:4000/health/ready
curl -s http://localhost:4000/metrics | head -n 20
```

### Running tests

```bash
pnpm --filter @homeservicemarketplace/api test
```

Current unit tests cover env validation and health-service behavior. Business-domain tests will be added per module in later phases.

---

## Project layout (backend foundation)

```
apps/api/src/
  config/                # zod-validated env, typed AppConfigService
  shared/
    errors/              # AppError + error codes
    retry/               # bounded retry with jittered backoff
  infrastructure/
    prisma/              # Postgres connection, ping, readiness
    mongo/               # Mongoose connection, ping, readiness
    redis/               # ioredis client, ping, readiness
    logger/              # pino with redaction + request-id correlation
    http/                # RequestIdMiddleware, AllExceptionsFilter
    telemetry/           # prom-client registry + /metrics controller
    health/              # /health/live, /health/ready
  types/                 # express Request augmentation (req.id)
  # Legacy (kept on disk, NOT wired into the infra baseline AppModule):
  auth/  bookings/  services/  modules/iam/
  database/              # deprecated re-export shim → infrastructure/prisma
```

See [`docs/infrastructure.md`](docs/infrastructure.md) for deeper notes on safety, security, and architectural decisions.
