# Sprint 5.5.5 Review Report — Realtime Architecture Spike

## 1. Planning Summary

- **Scope:** Design-only sprint. Pick the realtime channel for Sprint 7.0,
  document the trade-offs, and pin the migration path so the polling-first
  REST surfaces shipped in 5.2–5.5 stay backward compatible.
- **Existing files inspected:**
  - `apps/api/src/modules/notifications/notifications.service.ts` (call sites
    that will publish realtime events)
  - `apps/api/src/modules/conversations/conversations.service.ts`
  - `apps/api/src/infrastructure/redis/redis.module.ts` (backplane is already
    a dependency)
  - `infra/docker/docker-compose.yml` (Postgres / Mongo / Redis / Mailpit
    available locally; no new container required)
- **Risks found:** none — design-only.

## 2. Implementation Summary

- **Files added:**
  - `docs/architecture/realtime-spike.md` — full design memo: options
    (SSE / WebSocket / Pusher), recommendation (SSE + Redis pub/sub),
    proposed module shape (`RealtimeModule`, `RealtimeEventsPublisher`),
    event envelope schema, frontend `useEventStream()` plan,
    security / migration / test strategy, decision.
- **Files changed:** none.
- **Migrations added:** none (the `realtime_outbox` table sketched in the
  design doc is left for Sprint 7.0 to implement).
- **Contracts added/changed:** none.
- **UI added/changed:** none.
- **API endpoints added/changed:** none.

## 3. Automated Tests

| Check                                                                                  | Result         |
| -------------------------------------------------------------------------------------- | -------------- |
| `prisma validate`                                                                      | not applicable |
| `pnpm --filter @homeservicemarketplace/contracts build`                                | not applicable |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | not applicable |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | not applicable |
| `pnpm --filter @homeservicemarketplace/api test`                                       | not applicable |
| `pnpm --filter @homeservicemarketplace/web test`                                       | not applicable |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | not applicable |

No code changes — the existing 609 / 295 test counts from Sprint 5.5 stand.

## 4. Postman Tests

- Collection updated: none. Postman cannot drive SSE end-to-end; the
  Sprint 7.0 implementation will add a Newman + EventSource (Playwright)
  check.

## 5. Manual Checks

- Scenario: chosen path matches the existing infrastructure inventory.
  Expected: no new container needed; Redis is already in
  `infra/docker/docker-compose.yml`; the IAM / CSRF / rate-limit
  middleware can be reused on the SSE controller.
  Actual: confirmed in the design doc (`Recommendation` section).
  Result: pass.
- Scenario: backward-compatibility with the polling REST surfaces.
  Expected: realtime is additive — every poller still works.
  Actual: design doc commits to "phase 2 ships SSE; polling stays as
  fallback at the 5.2–5.5 cadences"; only "phase 3" considers
  reducing polling intervals, and no client cache is forced into
  push-only mode.
  Result: pass.

## 6. Fixes Applied

None. Design-only sprint.

## 7. Remaining Issues

None. Sprint 7.0 picks up `docs/architecture/realtime-spike.md` and
implements the proposed `RealtimeModule`.

## 8. Sprint Decision

**PASS** — Continue automatically.
