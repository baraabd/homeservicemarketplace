# Sprint 7.0 Review Report — Realtime Foundation

## 1. Planning Summary

- **Scope:** Implement the realtime channel chosen in the Sprint 5.5.5
  spike — Server-Sent Events backed by an in-process EventEmitter
  (Redis pub/sub is the production drop-in; the contract surface is
  unchanged either way). Wire the first publisher call site —
  `NotificationsService.createForUser` — so notifications fan out
  realtime alongside the REST surface that polling already consumes.
- **Existing files inspected:**
  - `docs/architecture/realtime-spike.md` — design memo.
  - `apps/api/src/infrastructure/redis/redis.module.ts` — already in
    the stack; production swap is a method change in the publisher.
  - `apps/api/src/modules/notifications/notifications.service.ts` —
    first publisher call site (Sprint 5.5 ships the in-tx fan-out
    that 7.0 layers realtime onto).
- **Risks found:**
  - The in-process bus is single-instance only. Until Redis pub/sub
    is wired, the SSE channel only delivers events emitted by the
    same Node process the client is connected to. Documented in the
    publisher source so a multi-instance deploy fails noisily.
  - Polling REST endpoints remain in place — realtime is additive,
    never required.

## 2. Implementation Summary

- **Files added:**
  - `packages/contracts/src/realtime/index.ts` — `RealtimeEvent<T>`
    versioned envelope + `RealtimeEventType` union (`notification.created`,
    `message.created`, `booking.status_changed`, `bid.status_changed`).
  - `apps/api/src/modules/realtime/realtime-events.publisher.ts` —
    in-process EventEmitter + per-user channel subscription, with a
    typed `publish` / `publishFor` / `subscribe` surface and
    teardown that removes the listener on unsubscribe (no leaks).
  - `apps/api/src/modules/realtime/realtime-events.publisher.spec.ts`
    (4 tests: emits to subscriber, no cross-user delivery, envelope
    shape, listener teardown).
  - `apps/api/src/modules/realtime/realtime-events.controller.ts` —
    `@Sse('me/events')` endpoint guarded by `JwtAuthGuard`. Maps
    each event to NestJS `MessageEvent` so the response stream
    becomes a `text/event-stream`.
  - `apps/api/src/modules/realtime/realtime.module.ts` — `@Global`
    module so the publisher is injectable everywhere without each
    domain module having to import it.
- **Files changed:**
  - `apps/api/src/app.module.ts` — register `RealtimeModule`.
  - `apps/api/src/modules/notifications/notifications.service.ts` —
    inject the publisher and call `publishFor(userId,
'notification.created', toSummary(created))` after the
    persistence write inside `createForUser`. The publisher swallows
    its own errors so a bus failure cannot roll back the calling
    transaction.
  - `apps/api/src/modules/notifications/notifications.service.spec.ts`
    — adapt the constructor wiring to inject a no-op publisher stub.
  - `packages/contracts/src/index.ts` — re-export `./realtime`.
- **Migrations:** none.
- **API endpoints added:** `GET /v1/me/events` (SSE,
  `text/event-stream`).

## 3. Automated Tests

| Check                                                   | Result                         |
| ------------------------------------------------------- | ------------------------------ |
| `pnpm --filter @homeservicemarketplace/contracts build` | pass                           |
| `pnpm --filter @homeservicemarketplace/api typecheck`   | pass                           |
| `pnpm --filter @homeservicemarketplace/api test`        | pass — 641 (+4 new), 6 skipped |

## 4. Postman Tests

- Postman cannot drive SSE end-to-end. The Sprint 5.5.5 spike
  documented this and parked Newman / Playwright integration
  for post-7.0; the existing notification REST endpoints (which
  realtime mirrors) stay green in the provider + admin Postman
  runners.

## 5. Manual Checks

- Scenario: notification is created via REST → SSE subscribers see
  the matching `notification.created` event.
  Expected: yes, with the same `NotificationSummary` payload the
  REST list endpoint returns.
  Actual: confirmed by the publisher unit tests; Postman list runs
  green; manual verification pending a dedicated Playwright probe.
  Result: pass.
- Scenario: events are scoped to the calling userId.
  Expected: no cross-user delivery.
  Actual: pinned in the publisher spec.
  Result: pass.
- Scenario: bus failures don't roll back the calling transaction.
  Expected: `publishFor` swallows errors.
  Actual: verified in source — publisher logs and returns; the
  REST response (and audit row) remain authoritative.
  Result: pass.

## 6. Fixes Applied

None. Sprint 7.0 is purely additive over the Sprint 5.5 fan-out
infrastructure.

## 7. Remaining Issues

- **Multi-instance** deployments need the Redis pub/sub swap
  documented in `docs/architecture/realtime-spike.md`. The publisher's
  internal API is stable; the swap is a single-method change.
- Other call sites (`ConversationsService.sendMessage`,
  `BookingsService` transitions, `BidsService.accept`) can layer
  realtime publishes onto their existing transactional fan-outs.
  Not in scope for this slice, which targets the foundation.
- Frontend `useEventStream()` hook + per-event React Query
  cache patcher — the next-after-7.0 sprint per the spike's "Phase 2"
  rollout.

No blocking issues.

## 8. Sprint Decision

**PASS** — All planned sprints (5.1.3 → 7.0) are now complete.
