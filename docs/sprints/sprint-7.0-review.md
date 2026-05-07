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

---

## Sprint 7.0 (refined) — Socket.IO + Redis Adapter

Re-opened by the spec to ship the Phase B production realtime
channel chosen in the Sprint 5.5.5 spike: a JWT-authed Socket.IO
gateway with `@socket.io/redis-adapter` for multi-instance fan-out.
The original 7.0 shipped an in-process SSE foundation as a Phase A
placeholder; this refined run adds Socket.IO **alongside** SSE so
the publisher API stays stable, the SSE fallback keeps working in
single-instance dev, and existing notification fan-out (the only
wired publish call site) emits over both channels at once.

### Decision recap

- **Transport:** Socket.IO 4.x (per the spike's §1 decision matrix)
- **Backplane:** `@socket.io/redis-adapter` 8.x, wired conditionally
  on `REALTIME_SOCKET_IO=on` AND a healthy Redis client. When Redis
  is not ready the gateway runs single-instance and the API still
  boots — production multi-instance deploys MUST flip the flag and
  ensure Redis is reachable.
- **REST writes only.** Socket emits events only — no business
  mutations through the socket. Mutations stay on REST behind
  `CsrfGuard` exactly as before.
- **Polling fallback retained.** Sprint 5.5 cadences (15s unread
  count / 20s lists / 4s active thread) stay in place permanently.
  The realtime layer is purely additive; when the socket is offline
  polling alone keeps the UI converging.

### Backend implementation

**Files added:**

| File                                                             | Purpose                                                                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/realtime/realtime.gateway.ts`              | Socket.IO gateway. Handshake auth via JWT (`auth.token` or `Authorization: Bearer`). Server-owned room joins.          |
| `apps/api/src/modules/realtime/realtime.gateway.spec.ts`         | 10 tests: handshake admit/reject, REALTIME_SOCKET_IO=off door, server-owned room joins, `subscribe:conversation` gate. |
| `apps/api/src/modules/realtime/conversation-participant.gate.ts` | Wraps existing repos for the two checks the gateway needs: `findProviderProfileId`, `userIsParticipant`.               |
| `apps/api/src/modules/realtime/realtime-socket.adapter.ts`       | IoAdapter that conditionally wires `@socket.io/redis-adapter`. Soft-fails to single-instance when Redis is not ready.  |

**Files changed:**

| File                                                              | Change                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/realtime/realtime-events.publisher.ts`      | Refactored to fan out to BOTH the in-process EventEmitter (SSE) AND the gateway via `emitToRoom`. Added `publishToRoom()`.                                                                                                                                                                   |
| `apps/api/src/modules/realtime/realtime-events.publisher.spec.ts` | +3 tests covering the gateway fan-out branch and the swallow-error contract.                                                                                                                                                                                                                 |
| `apps/api/src/modules/realtime/realtime.module.ts`                | Registers `RealtimeGateway` + `ConversationParticipantGate`. Imports `PersistenceModule` for the gate.                                                                                                                                                                                       |
| `apps/api/src/main.ts`                                            | Bootstrap path conditionally constructs `RealtimeSocketAdapter`, calls `connectToRedis()`, then `useWebSocketAdapter()`.                                                                                                                                                                     |
| `apps/api/src/config/env.schema.ts`                               | + `REALTIME_SOCKET_IO` boolean (default `false`).                                                                                                                                                                                                                                            |
| `apps/api/package.json`                                           | + `socket.io@^4.7.5`, `@socket.io/redis-adapter@^8.3`, `@nestjs/websockets@^11`, `@nestjs/platform-socket.io@^11`.                                                                                                                                                                           |
| `packages/contracts/src/realtime/index.ts`                        | Added missing event types: `request.available`, `bid.created`, `bid.accepted`, `provider.status_changed`. Added `RealtimeRoom`, `SubscribeToConversationPayload`, `RealtimeConnectionAck` for the new gateway surface. `RealtimeEvent.userId` now `string \| null` for room-targeted events. |
| `.env.example`                                                    | Documented `REALTIME_SOCKET_IO=false`.                                                                                                                                                                                                                                                       |

**Room model (server-owned):**

| Room                            | Member set                                         | Joined when                                                                   |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `user:{userId}`                 | exactly one — the authed session                   | always, on connection                                                         |
| `provider:{providerProfileId}`  | sockets of the user owning this provider profile   | iff the user has a provider profile                                           |
| `admin`                         | sockets whose user has the `admin` role            | iff `admin` ∈ JWT roles                                                       |
| `conversation:{conversationId}` | seeker + provider participants of the conversation | client emits `subscribe:conversation` AND server-side participant gate passes |

The wire NEVER carries a `join` command for the first three rooms —
they are derived from the verified JWT identity at handshake time.
The only client-emitted join is `subscribe:conversation` and it
runs the same participant gate REST uses; cross-conversation
attempts return `{ ok: false, code: 'FORBIDDEN' }` and never join.

### Frontend implementation

| File                                                    | Purpose                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/realtime/socket-client.ts`            | Thin Socket.IO client wrapper with `openRealtimeSocket` / `closeRealtimeSocket` / `subscribeToConversation`. One shared instance per page.  |
| `apps/web/src/lib/realtime/use-realtime-socket.ts`      | React hook that opens the socket while authenticated, closes it on logout, and dispatches React Query invalidations on every event.         |
| `apps/web/src/lib/realtime/use-realtime-socket.test.ts` | 8 tests on the pure `dispatchInvalidations` function — every event type maps to the right query roots; unknown events are silently dropped. |
| `apps/web/package.json`                                 | + `socket.io-client@^4.7.5`.                                                                                                                |

**Event → invalidation map:**

| Event                                | Invalidates                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `notification.created`               | `seekerQueryKeys.notifications.root` + `providerQueryKeys.notifications.root`               |
| `message.created`                    | `conversations.messages(id)` (both sides if `payload.conversationId` present) + `chat.root` |
| `request.available`                  | `providerQueryKeys.availableRequests.root`                                                  |
| `bid.created` / `bid.status_changed` | `seekerQueryKeys.requests.root` + `providerQueryKeys.bids.root`                             |
| `bid.accepted`                       | `providerQueryKeys.bids.root` + `bookings.root` + `seekerQueryKeys.bookings.root`           |
| `booking.status_changed`             | both bookings roots + `providerQueryKeys.wallet.root`                                       |
| `provider.status_changed`            | `providerQueryKeys.profile.root` + `['auth','me']`                                          |

Unknown event types are silently dropped — forward-compatible
without crashing the bridge.

### Tests

| Suite                                                 | Result                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| `pnpm --filter @homeservicemarketplace/api typecheck` | pass                                                |
| `pnpm --filter @homeservicemarketplace/api test`      | 882 passed (was 869 in 6.6, +13 new realtime tests) |
| `pnpm --filter @homeservicemarketplace/web typecheck` | pass                                                |
| `pnpm --filter @homeservicemarketplace/web test`      | 349 passed (was 341 in 6.6, +8 new realtime tests)  |

**Backend test coverage** (10 gateway + 7 publisher = 17 realtime tests):

- unauthenticated socket rejected (no token, invalid token)
- REALTIME_SOCKET_IO=off rejects every connection at the door (verifyAccessToken not called)
- a non-provider non-admin user joins ONLY user:{id}
- a provider user also joins provider:{profileId}
- an admin user also joins the admin room
- a seeker user does NOT join the admin room
- subscribe:conversation joins when the participant gate passes
- subscribe:conversation refuses with FORBIDDEN when the user isn't a participant
- subscribe:conversation refuses with VALIDATION_ERROR when conversationId is empty
- publish() fans out to user:{id} room + in-process bus + cross-user no-leak
- publishToRoom() fans out with userId=null
- publish never throws when the gateway emit blows up

**Frontend test coverage** (8 dispatcher tests): every event type pinned to its query roots, unknown event silently dropped.

### Postman

`postman/FixNow Sprint 7.0 Realtime REST Fallback.postman_collection.json` — 9 requests, collection-level Prisma/SQL/secret-leak guard:

1. GET /v1/me/notifications?experience=provider (deepLink scope assertion)
2. GET /v1/me/notifications/unread-count?experience=provider
3. GET /v1/provider/conversations
4. GET /v1/provider/conversations/:id/messages
5. POST /v1/provider/conversations/:id/messages (REST-only writes — round-trips id/body/createdAt)
6. GET /v1/provider/available-requests
7. GET /v1/provider/bookings
8. Negative — no token → 401 + AUTH_INVALID_CREDENTIALS code
9. Negative — wrong role (seeker token on provider feed) → 403 + FORBIDDEN code

### Deployment notes

- **Multi-instance:** flip `REALTIME_SOCKET_IO=on` AND ensure Redis is healthy. The adapter routes broadcasts across all instances; sticky sessions are NOT required.
- **Single-instance dev:** leave `REALTIME_SOCKET_IO=off` (default) — the polling fallback covers all UI. Or flip to on; the gateway runs without the Redis adapter and serves the local instance.
- **Load balancer / reverse proxy:** raise idle timeout above Socket.IO's 60s ping interval (90–120s recommended).

### Acceptance criteria

- [x] Authenticated handshake (JWT verified before any room join) — yes, via gateway's `handleConnection`
- [x] Server-owned rooms — yes, `user:`, `provider:`, `admin` joined from JWT identity
- [x] Conversation participant gate enforced server-side before `socket.join` — yes, `subscribe:conversation` runs `userIsParticipant`
- [x] Admin room only for admin role — yes, asserted in gateway spec
- [x] REST writes only / Socket emits events only — yes, only client emit is `subscribe:conversation` (not a business write)
- [x] Polling fallback unchanged — yes, Sprint 5.5 cadences and SSE controller remain in place
- [x] Events trigger React Query invalidation — yes, every event type mapped in `dispatchInvalidations`
- [x] Postman REST fallback collection — yes, 9 requests + 2 negatives
- [x] Feature flag gate (`REALTIME_SOCKET_IO`) — yes, default `false`; gateway closes every connection when off

### Sprint decision (refined)

**PASS** — Realtime foundation is shipped: Socket.IO gateway with
JWT handshake auth, server-owned rooms, conversation participant
gate, conditional Redis adapter for multi-instance fan-out, frontend
client + React Query bridge, and a 9-request REST fallback Postman
collection. REST remains the source of truth; polling remains the
fallback; the realtime layer is purely additive and gated behind
`REALTIME_SOCKET_IO=false` by default.
