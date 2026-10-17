# R25 test topology and staged transport configuration

Status: prepared configuration; no hosted deployment or production activation.
The G1 exact infrastructure lease covers this README and `compose.test.yml`.

## Disposable acceptance topology

Two real API processes share one **dedicated** PostgreSQL database and one
**separate Redis instance**. Each API has its own loopback port and browser
bundle; Seeker, Provider and Admin use separate browser contexts. Local
restricted/public storage roots also differ. Redis database numbers alone do
not isolate Pub/Sub, whose adapter channel namespace spans Redis databases.

`compose.test.yml` prepares PostgreSQL 16, Redis 7 and Mailpit. It deliberately
has no fixed container names, named volumes, external networks or public binds.
Data uses disposable tmpfs mounts. Generate unique `R25_SESSION`,
`R25_DATABASE_PASSWORD` and `R25_REDIS_PASSWORD` for each stack, inspect the
effective project/container/port/volume names without printing credentials,
and refuse an occupied port. The default reserved ports are 54325, 56325,
51025 and 58025. API A/B use 4325/4425; web A/B use 5325/5425. Other lanes'
ports are not reused.

Native PostgreSQL/Redis/Mailpit processes can provide the same isolated test
topology where Docker is unavailable. Record executable versions and process
ownership; never substitute mocks for real-service acceptance. Stop only
processes/containers created by the run. Never reset a working database, flush
a shared Redis instance, or copy the user's environment file.

## Runner

Use repository-pinned Node 24.21.0 and pnpm 10.32.1 and run the frozen install,
Prisma generation, affected local checks and normal commit hooks first.
`scripts/production/realtime/verify-replicas.cjs --check` validates the provided
R25 database/session/ports and prints only nonsecret configuration. `--run`
requires a clean committed candidate, prepares reference fixtures in that
explicit R25 database, runs the owned real-service test, builds one API and
two web bundles, then runs the real-route browser suite. The suite owns both
API child processes; the runner owns the preview children. No schema migration
is authored by R25; the runner applies the existing migration history to the
disposable database.

Required operator inputs are `R25_SESSION`, `DATABASE_URL`, `REDIS_PASSWORD`
and optional isolated port overrides. The database name must exactly equal
`hsm_r25_${R25_SESSION}` on loopback. Default/shared database and Redis ports
are refused. Signing/encryption material is generated once per run and shared
only by the two child APIs. Private reports, synthetic fixture logs, browser
session traces and any credentials are excluded from public evidence. Inspect
screenshots before crediting them. `summary.json` has only fixed-schema counts,
source identities, configuration fingerprint, command exit codes and bounds.
CI still needs the coordinator integration in `CR-001-integration.md`.

## Explicit frontend/backend/proxy agreement

| Component        | Test setting                                                      | Hosted activation prerequisite                                           |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| API              | `REALTIME_SOCKET_IO=true`; `REALTIME_ALLOW_SINGLE_INSTANCE=false` | Same approved flag and healthy private Redis on every replica            |
| Web              | `VITE_REALTIME_SOCKET_IO=true`                                    | Owner-approved canary/cohort build; default stays off                    |
| Transport        | `VITE_REALTIME_TRANSPORTS=websocket`                              | Proxy accepts WebSocket upgrade and preserves the authenticated Origin   |
| Optional polling | `VITE_REALTIME_TRANSPORTS=polling,websocket`                      | Verified session affinity for every Engine.IO request, including upgrade |
| Origins          | Explicit web A/B origins in `FRONTEND_URL`/`CORS_ORIGINS`         | Exact approved HTTPS origins, cookie/SameSite and CSRF contract          |
| Heartbeat        | Bounded adapter interval/timeout                                  | Proxy idle timeout greater than their sum, tested at the real edge       |
| Recovery         | Authoritative REST refetch after a gap/reconnect                  | Authenticated history and permission checks remain available             |

The installed classic `@socket.io/redis-adapter` 8.3.0 forwards Pub/Sub; it
does **not** persist a cursor log or provide durable Socket.IO connection-state
recovery. HTTP long-polling requires affinity even with Redis. WebSocket-only
transport has one TCP connection and does not require sticky routing for that
connection. Historical repo notes claiming the opposite for polling are not
used as rollout authority.

References: [Redis adapter](https://socket.io/docs/v4/redis-adapter/),
[multiple nodes](https://socket.io/docs/v4/using-multiple-nodes/),
[connection-state recovery](https://socket.io/docs/v4/connection-state-recovery/).

## Rollout and rollback proposal

1. Integrate the exact shared test/CI requests and accept one combined G2
   candidate. Keep production web/API flags off until owner rollout approval.
2. Verify private Redis, shared secrets, HTTPS/cookies, explicit origins,
   session affinity if polling is enabled, payload limits and edge idle
   timeouts on a hosted test cohort approved by the owner. This lane assigns
   no percentage, production account, permission or rollout date.
3. Compare notification/message history, unread state, reconnect success,
   duplicate-visible count, auth refusals, adapter health, queue bounds and
   reconnect attempts against polling. Any private-room leak, stale-session
   delivery, unbounded retry/queue or missing durable recovery blocks rollout.
4. Expand only under the owner's approved cohort/soak/rollback criteria.

Rollback disables the frontend flag in a reviewed rebuild and disables the
backend flag consistently across the fleet, preserving REST polling and the
durable store. Do not use single-instance fallback, remove authorization, or
change Redis throttling to conceal an adapter failure. A **total Redis** outage
may correctly yield REST 429 because that security dependency fails closed;
prove resync after recovery. A **socket-only** interruption separately proves
continued REST polling while Redis-dependent guards remain healthy.
