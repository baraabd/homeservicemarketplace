# Home Services Marketplace

Home-services marketplace platform under active production-readiness review.

This repository is a `pnpm` + Turborepo monorepo containing:

- `apps/api` — NestJS API and application modules
- `apps/web` — React frontend for Seeker, Provider and Admin
- `packages/database` — Prisma schema & migrations (PostgreSQL)
- `packages/contracts`, `packages/ui` — shared contracts and UI workspace
- `infra/docker` — Docker Compose for local data-plane services

The application contains implemented domain modules; existence is not release certification. See the current [production-readiness records](docs/production-readiness/) for source-specific gates and blockers. The selected infrastructure layout below is historical context, not a complete feature inventory.

---

## Local backend infrastructure setup

### Prerequisites

- Node.js **24.21.0 LTS** — the exact release in `.nvmrc`, engines, Volta,
  CI and all application/devcontainer Node images. Run `pnpm runtime:check`
  to detect drift. See [R02 startup and acceptance](docs/production-readiness/r02/ACCEPTANCE.md)
  before changing runtime versions or clearing generated caches.
- pnpm **10.32.1** — pinned by `packageManager` in the root `package.json`.
  `corepack enable` is enough; corepack reads that field and activates the
  exact version, so you cannot install against a different resolver than the
  lockfile was built with.
- Docker Desktop with Compose v2

> This repo is a **pnpm workspace**. There is no `package-lock.json` and one
> must never be committed (`.gitignore` blocks it): a stray npm lockfile
> silently gives whoever runs `npm install` a different dependency tree from
> the one CI and the Docker images build.

### Zero-to-running, in one block

```bash
corepack enable                      # activates pnpm 10.32.1 from packageManager
pnpm install --frozen-lockfile       # exact lockfile, no resolution drift
cp .env.example .env
pnpm docker:up:app                   # migrations run, then the API starts
curl -fsS http://localhost:4000/health/ready
```

`pnpm docker:up:app` applies pending migrations through a separate one-shot
job before starting the API. Preserve existing environment files and volumes.
For native API development use the data-plane-only `pnpm docker:up`; do not
start a second API on the Docker API's occupied port.

**Do not use `pnpm smoke:compose` to troubleshoot a persistent local stack.**
That CI test intentionally removes test volumes. Its entrypoint now rejects
normal local and self-hosted execution before installing its cleanup trap.
Do not fake CI environment variables to bypass this safeguard.

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` if you need non-default ports. Configure the required auth/JWT values using the current `.env.example` and environment schema. Keep actual secrets outside Git; isolated development values must never be reused for staging or production.

The API validates the entire environment on boot via a strict Zod schema (`apps/api/src/config/env.schema.ts`). Missing or malformed variables cause an immediate, descriptive startup failure — the process never starts in a half-configured state.

### 3. Start data services (Postgres, Redis, Mailpit)

```bash
pnpm docker:up           # postgres + redis + mailpit (infra only)
pnpm docker:up:app       # same, plus the migration job and the API container
pnpm docker:up:mongo     # add the opt-in Mongo container (see the ADR below)
pnpm docker:logs         # follow logs
pnpm docker:down         # stop everything
```

The `api` service in `infra/docker/docker-compose.yml` is gated behind the
`app` profile, so `pnpm docker:up` intentionally starts only the data plane.
For day-to-day development run the API natively (steps 4–5) — that's the
fast-feedback path. Use `pnpm docker:up:app` only when you need a fully
containerised stack (e.g. to mirror a deployment-like image).

**Migrations are a separate job, not something the API does at startup.** The
`app` profile runs `api-migrate` — a one-shot container that applies pending
Prisma migrations and exits — and the API is gated on it completing
successfully. That is what makes `--scale api=N` safe: N replicas cannot race
each other to migrate the same database, because migrating is not their job.
The job is idempotent (`prisma migrate deploy` applies only what is pending
and exits 0 when nothing is), so it re-runs harmlessly on every `up`. The API
runtime image ships no Prisma CLI, so the separation is enforced by the image
rather than by convention.

**MongoDB is optional and off by default** — see
[docs/adr/0002-mongodb.md](docs/adr/0002-mongodb.md). No code reads it, so it
no longer boots with the stack, is not required to start the API, and is not
reported by `/health/ready`. `pnpm docker:up:mongo` and `MONGODB_ENABLED=true`
turn it back on together.

### 4. Apply database schema (Postgres)

```bash
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/database migrate:deploy
```

### 5. Run the API in dev mode

```bash
pnpm --filter @homeservicemarketplace/api dev
```

### 6. Run the web app in dev mode (separate terminal)

```bash
pnpm --filter @homeservicemarketplace/web dev
```

The web app binds to `http://localhost:5173` and talks to the API at
`http://localhost:4000` via `VITE_API_URL` (see `apps/web/.env`). If the
browser shows `net::ERR_CONNECTION_REFUSED` for `/v1/auth/...` or
`/v1/me/addresses`, the API process is not running — start it with the
command above (or `pnpm docker:up:app`).

The API binds to `http://localhost:4000`.

### Health & metrics endpoints

| Endpoint            | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `GET /health/live`  | Liveness probe — `200` whenever the process is running.               |
| `GET /health/ready` | Readiness probe — checks the configured dependency set; Mongo is opt-in. |
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

Use the current package scripts and CI workflows for unit, integration and browser suites. Real-service tests require their declared database, storage, mail and scanner setup; unit success alone is not production acceptance.

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
  modules/               # application domains; inspect current AppModule wiring
  database/              # deprecated re-export shim → infrastructure/prisma
```

See [`docs/infrastructure.md`](docs/infrastructure.md) for deeper notes on safety, security, and architectural decisions.

---
