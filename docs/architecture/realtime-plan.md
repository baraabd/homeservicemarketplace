# Realtime Plan (Sprint 5.5.5)

Status: design document. No production realtime layer is shipped in
this sprint — the existing in-process SSE foundation
(`apps/api/src/modules/realtime/*`, originally introduced as a
transitional surface) stays in place as the dev-mode placeholder.
The plan below is the production target a follow-up sprint will
implement.

## Current state, summarised

- **Backend framework:** NestJS 11 (Node 20). Dependencies relevant to
  realtime that already ship:
  - `ioredis@^5.4.1` and a `RedisModule` — Redis is in the stack.
  - `rxjs@^7.8.2` — used by the existing SSE controller.
  - `mongoose@^8.11.0` — Mongo lives in the stack but is reserved for
    audit / non-relational state.
- **Socket.IO?** Not yet installed. We will add it only in the
  implementation sprint.
- **Redis usage today:** session caching + permission cache TTL
  (`PERMISSION_CACHE_TTL_SECONDS`). It is **not** yet wired as a
  pub/sub backplane.
- **Event / notification architecture today:** notifications + chat
  - booking lifecycle all run **REST + polling** (Sprint 5.5
    cadences: 15 s unread count, 20 s lists, 4 s open thread). Every
    state-changing service inside its transaction calls
    `NotificationsService.createForUser(...)`. Sprint 7.0's transitional
    SSE publisher fan-out hook also fires there
    (`RealtimeEventsPublisher.publishFor`). The publisher is in-process
    only — single instance, no Redis backplane yet.
- **Frontend React Query:** every list / detail surface uses cursor-
  paginated React Query hooks with `refetchInterval` + `refetchOnWindowFocus`
  - `invalidateQueries` after mutations. The hook tree already invalidates
    the right roots on every transition, so swapping polling-driven
    `refetchInterval` for an event-driven `setQueryData` is a pure addition.

## 1. WebSocket vs SSE — decision

| Dimension                     | SSE (current dev placeholder)                      | Socket.IO (target)                                           |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Transport                     | HTTP/1.1 chunked / HTTP/2 stream                   | WebSocket with HTTP long-poll fallback built in              |
| Bi-directional                | No — server to client only                         | Yes — client can emit too                                    |
| Reconnect / replay            | Browser reconnects with `Last-Event-ID`            | Library handles backoff + ack semantics                      |
| Multi-tenant rooms / channels | Manual; one event-stream per user                  | First-class `socket.join(room)` + `io.to(room).emit(...)`    |
| Multi-instance fan-out        | Needs a custom Redis layer                         | `@socket.io/redis-adapter` — drop-in, well-trodden           |
| Browser support               | Modern browsers (no IE)                            | Universal (incl. IE via long-poll)                           |
| Mobile / PWA reliability      | Some carriers terminate long HTTP idle connections | Same; but Socket.IO heartbeats + reconnect handle it cleanly |
| Library churn / maturity      | Native Web API + a controller                      | `socket.io@^4` is stable; widely operationally understood    |

**Decision: Socket.IO with the Redis Adapter** for the production
realtime layer. Reasons:

1. The marketplace surfaces (chat, notifications, booking events,
   bid acceptance) are inherently multi-room / multi-tenant.
   Socket.IO's room API maps onto our `user:`, `provider:`,
   `conversation:`, `admin:` taxonomy without us reinventing it.
2. We will deploy multiple API instances behind a load balancer.
   `@socket.io/redis-adapter` is the standard fan-out path; we
   already pay for Redis in the stack.
3. Socket.IO's reconnect + heartbeat semantics save us from
   re-implementing the Last-Event-ID + dropped-message workflow
   we'd otherwise need on top of SSE.
4. Even though we don't intend to write business state over the
   socket (rule below), reserving Socket.IO's bi-directional
   surface for room-management + typing-indicator-style ephemeral
   signals is cheap insurance.

The existing in-process SSE module is left in place as a dev-only
placeholder so the notification publisher hook
(`NotificationsService.createForUser` → `RealtimeEventsPublisher.publishFor`)
stays meaningful in a single-instance dev shell. The implementation
sprint replaces the publisher's `EventEmitter` backend with a
Socket.IO server bound to a Redis Adapter and removes the SSE
controller.

## 2. Recommended choice

**Socket.IO 4.x + `@socket.io/redis-adapter` 8.x**

Library set the implementation sprint will add:

```
"socket.io": "^4.7"
"@socket.io/redis-adapter": "^8.3"
"@nestjs/platform-socket.io": "^11.0"
"@nestjs/websockets":         "^11.0"
"socket.io-client":           "^4.7"   // web only
```

**Not added in this sprint** — the spec is docs-only and explicitly
calls out "no production socket dependency added unless justified".

## 3. Socket auth design

- **Handshake-only auth.** The browser includes the same JWT cookie
  it uses for REST (`Authorization: Bearer <access>` for mobile
  mode; HTTP-only cookies for web) on the WebSocket upgrade
  handshake. The server's gateway runs the same `JwtAuthGuard`-
  equivalent during the `connection` event and stores the resolved
  `AuthenticatedUser` on `socket.data.user`.
- **No per-message auth.** Once the connection is established the
  socket is trusted for the duration; identity does not flow through
  message bodies and the wire never accepts `userId` /
  `providerProfileId` from the client.
- **CSRF.** Not applicable — sockets are not cookie-driven mutation
  paths. Mutations stay on the REST surface that already enforces
  `CsrfGuard`.
- **Reconnect on token rotation.** Access token rotation does not
  break a live socket — but a refresh failure forces the client to
  disconnect and re-handshake.
- **Idle disconnect.** Server-side idle timeout (Socket.IO default
  is fine: 60 s ping interval, 5 s ping timeout). Production
  load balancer is configured to honour the WebSocket upgrade and
  not idle-kill the connection at < 75 s.

## 4. Redis adapter plan

- One Redis cluster (the existing instance is fine for the alpha; we
  size it up when concurrent connections cross 5k).
- `@socket.io/redis-adapter` configured with the existing `ioredis`
  client + a dedicated namespace prefix: `socketio:hsm:`.
- Pub channels follow Socket.IO's standard pattern; we do **not**
  hand-craft channel names. The adapter routes `io.to('room').emit`
  through `PUBLISH socketio:hsm:#/...#room...` to all instances.
- **Backplane health.** Two probes:
  - A `/health/realtime` admin-only readiness route checks the
    adapter's `serverCount()`.
  - Prometheus counters: `socketio_connections`, `socketio_room_members`,
    `socketio_messages_total{type}`. Already-present `prom-client`
    is reused.

## 5. Room model

| Room                            | Member set                                            | Used for                                                       |
| ------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| `user:{userId}`                 | The authenticated session — exactly one user per room | Personal notifications fan-out, profile changes                |
| `provider:{providerProfileId}`  | Sockets whose authed user owns this provider profile  | Provider-targeted events (new available request, bid accepted) |
| `conversation:{conversationId}` | Both seeker and provider participants                 | `message.created` events for the active thread                 |
| `admin`                         | Sockets whose user has the `admin` role               | Admin-side broadcasts (new dispute, KPI tick)                  |

Room **membership is server-owned**. The client never emits a
`join` directly; on connection the server inspects `socket.data.user`
and joins the user's `user:`, optionally `provider:`, optionally
`admin` rooms. A `conversation:` room is joined by an explicit
`subscribeToConversation { conversationId }` event that the server
authorises against the participant gate (same gate REST uses) before
calling `socket.join`.

## 6. Event model

Versioned envelope (matches what `RealtimeEvent` in
`packages/contracts/src/realtime/index.ts` already publishes). All
events emit a JSON payload that **mirrors the REST response shape**
for the underlying resource so the client's React Query cache
patcher can drop the row in via `setQueryData` without re-parsing.

| Event                     | Room target                                     | Payload (mirrors REST)            | Trigger                                                           |
| ------------------------- | ----------------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `notification.created`    | `user:{userId}`                                 | `NotificationSummary`             | `NotificationsService.createForUser` (already wired)              |
| `message.created`         | `conversation:{conv}`                           | `MessageSummary`                  | `ConversationsService.sendMessage`                                |
| `request.available`       | `provider:{providerId}`                         | `ProviderAvailableRequestSummary` | `RequestsService.create` (when status = OPEN_FOR_BIDS)            |
| `bid.created`             | `user:{seekerUserId}`                           | `BidSummary`                      | `ProviderBidsService.submit`                                      |
| `bid.accepted`            | `provider:{providerId}`                         | `MyBidSummary`                    | `BidsService.accept` (provider's own bid won)                     |
| `booking.status_changed`  | `user:{seekerUserId}` + `provider:{providerId}` | `ProviderBookingSummary`          | `ProviderBookingsService.{start,complete,cancel}` + seeker cancel |
| `provider.status_changed` | `user:{providerUserId}` + `admin`               | `ProviderProfileSummary`          | `AdminVerificationService.{approve,reject,suspend,reactivate}`    |

Same versioned envelope `RealtimeEvent<T>` already in contracts:

```ts
{ v: 1, type: '<event.type>', userId: '<recipient>', occurredAt: '<ISO>', payload: <T> }
```

Rules the implementation must enforce:

- **Publish post-commit.** Events are queued during the transaction
  and emitted after the commit; a rolled-back transaction must
  never leak onto the bus.
- **No business writes through the socket.** All mutations stay on
  REST. The socket is for state-change _announcements_ only.
- **Minimal payload.** No PII beyond what the matching REST endpoint
  already returns. No `passwordHash` / `refreshToken` /
  `JWT_SECRET` / `DATABASE_URL` — same wire-leak guards as the
  REST collection-level Postman test.

## 7. Fallback to polling

- Polling endpoints from Sprint 5.5 (notifications 15–20 s, chat
  20 s list / 4 s active thread, bookings 30 s, available-requests
  20 s) **stay in place permanently as the fallback**. The realtime
  layer is additive.
- React Query strategy:
  - On socket connect: `setQueryData(...)` per event maps the wire
    payload into the cached row.
  - On socket disconnect: `refetchInterval` resumes at the spec
    cadences automatically.
  - On every mutation: `invalidateQueries` still fires, so the
    UI converges even when the bus is offline.
- Phased rollout (per the sprint plan section 8):
  - **Phase A** (this sprint): docs only. Existing in-process SSE
    keeps the publisher hook meaningful in dev.
  - **Phase B** (impl sprint, two weeks): Socket.IO gateway behind
    a feature flag (`REALTIME_SOCKET_IO=on`). When `off`, the
    server publishes to nothing and the client never opens a
    socket; polling still works.
  - **Phase C** (post-soak): polling intervals can be tuned down
    (60 s heartbeat) once the realtime channel has been stable
    for one quarter.

## 8. Deployment considerations

- **Sticky sessions are NOT required** with the Redis Adapter — the
  adapter routes broadcasts across instances. Document this for
  the load-balancer config so an operator doesn't add stickiness
  thinking it's necessary.
- **HTTP/2 / TLS** required end-to-end so the WebSocket upgrade
  isn't blocked. The existing Vercel-compatible web build talks
  to the API behind a TLS-terminating proxy in production already.
- **Idle timeouts** (load balancer + reverse proxy) raised above
  Socket.IO's 60 s ping interval — typically 90–120 s.
- **Connection cap per instance:** target 5k concurrent. Node's
  per-instance ceiling on a 4-vCPU container is comfortably above
  this; horizontal autoscale on the API tier picks up at 70%
  saturation.
- **Local dev:** the in-process `RealtimeEventsPublisher` (current
  implementation) keeps working without Docker; the impl sprint
  swaps it for the Socket.IO publisher behind the feature flag.
- **Observability:** Prometheus metrics listed in §4 +
  per-event counters + a structured log line per
  `connection`, `disconnection`, `room.join`, `room.leave`.

## 9. Security considerations

| Threat                                | Mitigation                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Unauthenticated socket                | JWT validation in the `connection` handler; reject before the socket joins any room.                                                   |
| Cross-user / cross-provider listening | `socket.join` is server-owned; `subscribeToConversation` runs the participant gate.                                                    |
| PII / secret leak in payload          | Wire shape mirrors the REST response. Existing Postman collection-level guard verifies the REST shape; events publish that same shape. |
| Token replay after rotation           | Disconnect on refresh failure; client re-handshakes with the new token.                                                                |
| Open-redirect / cross-origin abuse    | Socket.IO `cors` configured with the same allow-list as REST (`FRONTEND_URL` + `CORS_ORIGINS`).                                        |
| Flood / abuse                         | Per-socket rate limit via `@nestjs/throttler` extended to gateway events; soft-disconnect on abuse.                                    |
| CSRF                                  | N/A — sockets are not cookie-driven mutation paths; all writes stay on REST behind `CsrfGuard`.                                        |
| Stale auth on long sessions           | Periodic re-auth: server emits `auth.expiring` 60 s before access expires; client refreshes + emits `auth.refresh`.                    |
| Memory leak on disconnect             | Server-side teardown removes room memberships in the `disconnect` handler; the in-process placeholder already does this.               |

## 10. Testing strategy

- **Unit tests** (impl sprint):
  - Gateway handshake admits a JWT-authed socket.
  - Gateway handshake rejects a missing / expired token.
  - `subscribeToConversation` respects the participant gate
    (foreign conversation → no join, server-side log line).
  - Publisher emits exactly once per committed mutation, zero on
    rollback. (The current SSE publisher already has 4 cases pinning
    this behaviour; they translate directly.)
- **Integration tests** (impl sprint): spin up a NestJS test app +
  an in-memory Redis adapter, connect a `socket.io-client`, assert
  that a notification creation surfaces within 500 ms.
- **Postman / Newman:** Postman cannot drive Socket.IO end-to-end.
  The runtime collections from Sprints 5.7 + 6.7 stay REST-only.
  This sprint adds an explanatory folder
  ("Realtime Spike — No runtime endpoint") to the provider
  Postman collection so an operator running the harness sees
  the design link.
- **Playwright probe** (impl sprint): a one-shot probe opens a
  socket, asserts a `notification.created` event arrives within 1 s
  after a REST notification create from a sibling test.
- **Existing test surfaces stay green** — this sprint changes no
  source files except docs + the Postman notes. `prisma:validate`,
  contracts build, api typecheck, web typecheck, api tests, web
  tests, web prod build all pass.

## Appendix: relationship to the Sprint 7.0 in-process SSE

The autonomous earlier-run shipped an in-process SSE layer at
`apps/api/src/modules/realtime/`. That layer is functionally
correct for single-instance dev and emits the same `RealtimeEvent<T>`
envelope this plan describes. The implementation sprint will:

1. Add the Socket.IO + Redis-Adapter dependencies (§2).
2. Replace `RealtimeEventsPublisher`'s `EventEmitter` backend with
   a Socket.IO server + Redis-Adapter publish.
3. Replace the SSE controller with the Socket.IO gateway.
4. Keep the publisher's `publish` / `publishFor` API stable so
   `NotificationsService.createForUser` (and the other call sites
   the impl sprint adds for `message.created`,
   `booking.status_changed`, `bid.accepted`) need no change.

The contract surface in `packages/contracts/src/realtime/index.ts`
(`RealtimeEvent<T>`, `RealtimeEventType`) is forward-compatible with
both transports, so the web `useEventStream` hook can swap from
`EventSource` to `socket.io-client` with no contract change.
