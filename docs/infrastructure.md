# Backend Infrastructure — Local Setup

This document covers the backend infrastructure foundation (config, Postgres, Mongo, Redis, logging, health, metrics). Business domain modules are not yet implemented.

## Prerequisites

- Node.js 20.x
- pnpm 10.x (`corepack enable`)
- Docker Desktop with Compose v2

## 1. Install dependencies

```bash
pnpm install
```

## 2. Configure environment

```bash
cp .env.example .env
# edit .env — adjust DB URIs, ports, and CORS origins for your machine
```

The API validates the environment on boot with a strict zod schema (`apps/api/src/config/env.schema.ts`). Missing or malformed variables cause an immediate, descriptive startup failure — the process never starts in a half-configured state.

## 3. Start infrastructure services

```bash
pnpm docker:up      # starts postgres, mongo, redis
pnpm docker:logs    # follow logs
pnpm docker:down    # stop
```

## 4. Apply database schema

```bash
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database generate
```

## 5. Run the API

```bash
pnpm --filter @homeservicemarketplace/api dev
```

The API binds to `http://localhost:4000`.

## Endpoints provided by the infrastructure baseline

| Endpoint            | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `GET /health/live`  | Liveness probe — returns 200 whenever the process is running. |
| `GET /health/ready` | Readiness probe — 200 only if Postgres, Mongo, Redis are up.  |
| `GET /metrics`      | Prometheus-format scrape endpoint.                            |

## Running tests

```bash
pnpm --filter @homeservicemarketplace/api test
```

Current tests cover (unit + integration + e2e):

- `config/` — env schema validation, typed `AppConfigService`
- `shared/retry/` — bounded retry with jitter
- `infrastructure/prisma/` — connection retry, timeout, ping, transaction runner
- `infrastructure/mongo/` — connection retry, event handling, ping
- `infrastructure/redis/` — connect retry, ioredis options, quit after failed init
- `infrastructure/health/` — liveness/readiness behavior + route-level e2e
- `infrastructure/telemetry/` — metrics registry + route-level e2e
- `infrastructure/http/` — exception filter normalization + route-level e2e, request-id middleware e2e
- `infrastructure/persistence/iam/` — user/role/permission repositories
- `test/unit/seed*` — seed idempotency and production-safety guard
- `test/integration/` — gated by `RUN_DB_INTEGRATION=1`: real Postgres migration + seed checks

## Project layout (backend foundation)

```
apps/api/src/
  config/                # zod-validated env, typed AppConfigService
  shared/
    errors/              # AppError + error codes
    retry/               # bounded retry with jittered backoff
  infrastructure/
    prisma/              # Postgres connection, ping, readiness, transaction runner
    mongo/               # Mongoose connection, ping, readiness, draft schemas
    redis/               # ioredis client, ping, readiness
    logger/              # pino config with redaction + request-id correlation
    http/                # RequestIdMiddleware, AllExceptionsFilter
    telemetry/           # prom-client registry + /metrics controller
    health/              # /health/live, /health/ready
    persistence/iam/     # user / role / permission repositories (IAM only)
  # Domain modules land under src/modules/<domain>/ in later phases.
```

## Startup safety notes

- **Strict env validation**: app refuses to start with missing/invalid config. This is intentional — never run production with undefined secrets.
- **Bounded retries**: each infra client (Postgres, Mongo, Redis) uses exponential backoff with jitter, capped by `STARTUP_RETRY_*` env vars. The app throws and exits if a dependency never becomes reachable — the container orchestrator should restart it.
- **Connect timeouts**: all infra clients have explicit connect/server-selection timeouts (`DATABASE_CONNECT_TIMEOUT_MS`, `MONGODB_*_TIMEOUT_MS`, `REDIS_CONNECT_TIMEOUT_MS`) to avoid indefinite hangs.
- **Graceful shutdown**: `app.enableShutdownHooks()` propagates SIGINT/SIGTERM to each infra service's `onModuleDestroy`, which closes Prisma, Mongoose, and Redis cleanly.
- **Liveness vs readiness**: `/health/live` never depends on external systems — it indicates the process is alive. `/health/ready` fails (503) whenever any dependency is unreachable, so the load balancer removes the pod until it recovers.
- **No secret leakage**: the global exception filter hides stack traces, driver error messages, and internal details in production. Structured logs redact `authorization`, cookies, password/token/OTP fields before emitting.

## Security notes

- CORS is strict: only `FRONTEND_URL` and `CORS_ORIGINS` are allowed in production. Wildcard is never enabled in prod.
- Helmet is applied globally.
- Throttler rate-limits all routes (100 req / 60s) as a baseline; per-route limits will be tightened in later auth/payment modules.
- The seed script (`@homeservicemarketplace/database` → `seed()`) is idempotent and refuses to run under `NODE_ENV=production` unless `ALLOW_PROD_SEED=true` is explicitly set. Both CLI and programmatic callers are gated.
- No business modules, auth flows, or domain data shapes are introduced by this baseline — scope is intentionally narrow.
