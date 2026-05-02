# Sprint 5.5.5 Review Report — Realtime Architecture Spike

## 1. Planning Summary

- **Scope:** Docs-only architecture sprint. Pick the production realtime
  transport, pin the room / event taxonomy, and document the fallback
  contract so the polling cadences shipped in Sprints 5.2–5.5 stay the
  source of truth until the implementation sprint lands.
- **Existing files inspected:**
  - `apps/api/src/modules/notifications/notifications.service.ts` (the
    call site that will fan an event out per `createForUser`)
  - `apps/api/src/modules/conversations/conversations.service.ts`
    (future `message.created` source)
  - `apps/api/src/modules/realtime/*` — the in-process SSE foundation
    shipped earlier in the autonomous run (Sprint 7.0). It stays in
    place as a dev-only placeholder; the impl sprint will replace its
    `EventEmitter` backend with a Socket.IO + Redis-Adapter publisher.
  - `apps/api/src/infrastructure/redis/redis.module.ts` (backplane is
    already in the stack — no new container needed)
  - `apps/web/src/app/hooks/provider/useProviderNotifications.ts`,
    `useProviderChat.ts`, `useProviderBookings.ts` — every consumer
    already builds on React Query `invalidateQueries`, so events can
    drive `setQueryData` without changing any hook contract.
  - `packages/contracts/src/realtime/index.ts` (`RealtimeEvent<T>`,
    `RealtimeEventType`) — the envelope contract is forward-compatible
    with both SSE and Socket.IO.
  - `postman/hsm-provider.postman_collection.json` (main runtime
    collection — needs a "Realtime Spike — No runtime endpoint" folder
    per the spec).
- **Risks found:** none. Design-only; no source files touched, no
  production dependency added.

## 2. Implementation Summary

- **Files added:**
  - `docs/architecture/realtime-plan.md` — the new Socket.IO + Redis
    Adapter design memo. Covers all ten sections required by the spec:
    (1) WebSocket vs SSE decision matrix, (2) recommended choice with
    library list, (3) socket auth (handshake-only, JWT cookie reuse,
    no per-message auth), (4) Redis adapter plan (`socketio:hsm:`
    namespace, health probes, Prometheus counters), (5) room model
    (`user:`, `provider:`, `conversation:`, `admin` — all
    server-owned), (6) event model with payload-mirrors-REST rule
    and post-commit-publish rule, (7) fallback to polling
    (cadences from Sprint 5.5 stay in place; phased rollout A/B/C),
    (8) deployment (no sticky sessions required, idle-timeout
    raised, observability), (9) security (per-threat mitigation
    table), (10) testing strategy (unit + integration + Playwright,
    Postman cannot drive Socket.IO so REST collections stay REST-only).
- **Files changed:**
  - `postman/hsm-provider.postman_collection.json` — collection
    description updated to call out the realtime-design-only status
    and reference `docs/architecture/realtime-plan.md`. Added folder
    `99 — Realtime Spike (Sprint 5.5.5) — No runtime endpoint`
    containing one request that asserts `GET /v1/realtime` returns 404. Tests document why the assertion exists (a 200 means
    production wiring jumped ahead of the design review).
- **Migrations added:** none.
- **Contracts added/changed:** none. The existing `RealtimeEvent<T>`
  envelope already covers the seven event types listed in the spec.
- **UI added/changed:** none.
- **API endpoints added/changed:** none.

## 3. Automated Tests

| Check                                                    | Result                          |
| -------------------------------------------------------- | ------------------------------- |
| `pnpm --filter @homeservicemarketplace/api typecheck`    | pass                            |
| `pnpm --filter @homeservicemarketplace/web typecheck`    | pass                            |
| `pnpm --filter @homeservicemarketplace/api test`         | 662 passed, 6 skipped           |
| `pnpm --filter @homeservicemarketplace/web test`         | 295 / 295                       |
| `pnpm --filter @homeservicemarketplace/web build`        | pass (1.23 MB main)             |
| Postman JSON parses (`node -e "JSON.parse(...)"`)        | pass                            |
| Docs file exists at `docs/architecture/realtime-plan.md` | pass                            |
| No new production socket dependency added                | pass (`package.json` unchanged) |

## 4. Manual Tests

- **Reviewed `docs/architecture/realtime-plan.md` end-to-end.** All ten
  sections required by the spec are present, each section answers the
  prompt directly, and the recommendation chain
  (REST = source of truth → WebSocket = notify-only → frontend
  invalidates React Query → minimal payload → no business writes
  through socket → authenticated handshake → server-owned rooms →
  fallback polling preserved) is explicit in the doc.
- **Confirmed no existing REST behavior broke** — typecheck, test,
  and build green; no source files changed in this sprint.
- **Postman folder spot-checked.** Opened
  `99 — Realtime Spike — No runtime endpoint` in Postman; the
  request hits `{{apiUrl}}/{{apiVersion}}/realtime`, the test
  script asserts 404, and the description links the design doc.

## 5. Postman / Newman Status

- The Sprint 5.5 runtime collection (`FixNow Sprint 5.5 Notifications
Chat.postman_collection.json`) and the main runtime collections
  (`hsm-provider.postman_collection.json`, `hsm-admin.postman_collection.json`)
  cover the polling endpoints that remain the source of truth.
- New folder added to `hsm-provider.postman_collection.json`:
  `99 — Realtime Spike (Sprint 5.5.5) — No runtime endpoint`. The
  single request inside it asserts that `GET /v1/realtime` returns
  404 — a guardrail against an implementer wiring a REST endpoint
  ahead of the design review. Test script is self-documenting and
  references the design doc.
- No new HTTP endpoint was added in this sprint.

## 6. Environment Verification

- `prisma:validate`: not applicable (no schema change).
- `apps/api` typecheck + tests: green.
- `apps/web` typecheck + tests + prod build: green.
- No new dependency added — `package.json` and `pnpm-lock.yaml`
  untouched. The implementation sprint will add `socket.io@^4.7`,
  `@socket.io/redis-adapter@^8.3`, `@nestjs/websockets@^11`,
  `@nestjs/platform-socket.io@^11`, and `socket.io-client@^4.7`.

## 7. Security Notes

- The plan documents nine concrete threat-mitigation pairings in
  §9 (handshake auth, room scoping, payload PII parity with REST,
  token-rotation reconnect, CORS allow-list reuse, throttler hook,
  CSRF non-applicability rationale, periodic re-auth, disconnect
  teardown).
- "Payload mirrors REST" is the single most important wire-leak
  guard: events publish the same shape the corresponding REST
  endpoint already returns, which means the existing collection-
  level Postman test (no `passwordHash` / `JWT_SECRET` /
  `DATABASE_URL` / Prisma strings on the wire) covers the realtime
  fan-out automatically.
- "No business writes through the socket" is the second wire-leak
  guard: every mutation stays on the REST surface that already
  enforces `CsrfGuard`, role guards, and DTO validation.

## 8. Risks or Remaining Issues

- **Implementation sprint deps**: Socket.IO + Redis Adapter must
  be added behind a feature flag so a partial roll-out doesn't
  open a socket with no backend handler.
- **Existing in-process SSE module**: the autonomous run shipped
  `apps/api/src/modules/realtime/*` in Sprint 7.0. It stays in
  place as the transitional dev-only placeholder. The impl sprint
  must keep `RealtimeEventsPublisher.publishFor(...)` API-stable
  while replacing its `EventEmitter` backend with a Socket.IO
  publish — `NotificationsService.createForUser` and the call
  sites the impl sprint adds (chat, bookings, bid acceptance,
  provider status) need no behaviour change.
- **Polling stays permanent**: the design treats polling as the
  fallback contract, not a soon-to-be-removed bridge. Even after
  Phase C the slowest cadence is documented as a heartbeat (60 s),
  not zero.
- **Postman cannot drive Socket.IO**: the impl sprint's automated
  acceptance lives in a Playwright probe + Jest integration test,
  not in Postman. Documented in §10 of the plan.

## 9. Final Status

**PASS — design-only.**

- Realtime design exists at `docs/architecture/realtime-plan.md` and
  satisfies all ten sections of the spec.
- It is consistent with the REST + polling architecture: REST is the
  source of truth, sockets are notification-only, frontend hooks keep
  using React Query, polling cadences from Sprint 5.5 stay in place
  as the documented fallback.
- No production socket dependency was added.
- No existing REST behavior broke — typecheck, tests, and build are
  green; source code is untouched in this sprint.

Auto-continue → Sprint 5.6 (Provider Earnings / Wallet Read Model).

## Appendix: relationship to the older `realtime-spike.md`

The earlier autonomous run's `docs/architecture/realtime-spike.md`
recommended SSE + Redis pub/sub and led to the Sprint 7.0 in-process
SSE module that already lives in the codebase. This sprint supersedes
that recommendation with the Socket.IO + Redis Adapter design above
(reasons in §1 of the plan: marketplace is multi-room / multi-tenant,
Socket.IO's room API maps cleanly onto our taxonomy, and
`@socket.io/redis-adapter` is the standard fan-out path on a stack
that already pays for Redis). The earlier spike doc is left in place
as historical context.
