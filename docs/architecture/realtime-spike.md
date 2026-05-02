# Realtime Architecture Spike (Sprint 5.5.5)

Status: design — no code change. The Sprint 7.0 implementation will reference this
document and adapt the chosen path.

## Goals

- A first-class, **always-on** realtime feed for: notifications, chat messages,
  booking status changes (and the provider available-jobs feed if cheap to do).
- **Backward compatible** with the polling REST surfaces shipped in Sprints 5.x —
  realtime is an additive layer, not a replacement.
- Single deployable shape so we don't have to introduce a new infrastructure
  component (Vercel-compatible web; Node 20 + NestJS API; Postgres + Mongo +
  Redis already in `infra/docker/docker-compose.yml`).

## Non-goals

- Voice / video.
- Offline-first sync (Mongo's already in the stack but used for non-relational
  audit data only).
- Cross-region active-active.
- Push notifications (FCM / APNs) — that's a separate channel; this spike only
  concerns the in-app live channel.

## Options considered

### Option A — Server-Sent Events (SSE)

**Shape.** A long-lived `GET /v1/me/events` opens a `text/event-stream` connection.
NestJS supports SSE natively via `@Sse('events')` returning an
`Observable<MessageEvent>`. Authentication uses the same JWT cookie/header
pipeline as the rest of the API; on disconnect the browser auto-reconnects with
exponential backoff.

**Fan-out.** A Redis pub/sub channel per user (`user:{userId}:events`) is the
backplane — every API instance subscribes; service-layer mutations (notifications,
chat, booking transitions) publish a one-line event payload to the user's channel
inside the same transaction (post-commit hook). The SSE handler subscribes to
the calling user's channel and forwards each message to the open response stream.

**Pros.**

- Pure HTTP — no extra ports, no extra reverse-proxy config, friendly to corporate
  proxies and Vercel's edge runtime.
- One-way (server → client) is exactly what the use cases need.
- Re-uses every middleware: auth guards, rate limiters, request-id, logging.
- Minimal new code: NestJS @Sse, an event publisher service, a tiny EventSource
  wrapper on the web.
- Polling endpoints stay live unchanged; SSE is purely additive.

**Cons.**

- One connection per user per tab — modest server-side cost.
  Mitigation: connections are cheap on Node (epoll); 1k concurrent users / instance
  is easy.
- HTTP/1.1 has 6 connection-per-host limit; HTTP/2 (any modern reverse proxy)
  multiplexes — so we'll only target HTTP/2.
- No bi-directional channel — chat send-message stays REST. That's fine: write
  paths benefit from CSRF / rate limiting which the existing REST stack already
  applies.

### Option B — WebSocket (NestJS Gateway)

**Shape.** `@WebSocketGateway()` over `socket.io` or `ws`. Same JWT auth, same
Redis pub/sub backplane, but bi-directional.

**Pros.**

- Lower per-message latency on writes (no second HTTP round-trip for sends).
- One connection multiplexes everything.

**Cons.**

- Bi-directional means we have to re-implement CSRF / rate-limit / validation
  on the WS side OR risk regressing security posture. That's a non-trivial
  surface to maintain in lockstep with the REST surface.
- Some corporate proxies block WS upgrades.
- More fiddly to deploy on Vercel (the API doesn't currently live on Vercel —
  the web does — but if we ever co-host the API as a serverless function, WS
  becomes hostile).
- Reconnect logic + sticky sessions in front of multiple instances is more
  complex.

### Option C — Pusher / Ably / managed (PaaS)

**Pros.** Zero ops; mature retry / reconnection client libs; works through
proxies.

**Cons.** External dependency, third-party trust, extra cost line, data
exfiltration consideration (chat messages), latency hop.
**Verdict:** ruled out for this sprint — adds a vendor without solving anything
A and B can't.

## Recommendation

**SSE (Option A)** is the right choice for the first realtime layer.

Reasons:

1. Cheapest to ship safely. Re-uses the existing auth / CSRF / validation /
   rate-limit middleware end-to-end.
2. One-way is sufficient — every "send" path on the marketplace already exists
   as a REST mutation with the right guards. No write-path duplication.
3. Connection lifecycle is pure HTTP. No proxy / WS upgrade risk.
4. Matches the polling REST surface 1:1 — switch the React Query cache from
   poll-mode to push-mode by adding a `useEventStream()` hook that calls
   `queryClient.setQueryData` per event; the polling fallback stays in place
   for the first ~10s of cache warmth and as a graceful degradation when the
   stream errors.

## Proposed shape

### Backend (Sprint 7.0 plan)

- New `RealtimeModule`:
  - `RealtimeEventsController` — `@Sse('me/events')` endpoint, JWT-guarded.
  - `RealtimeEventsService` — Redis pub/sub subscriber; produces `MessageEvent`.
  - `RealtimeEventsPublisher` — injected by `NotificationsService`,
    `ConversationsService`, `BookingsService`, `BidsService` to publish events
    inside the transaction commit (post-commit deferred so a rolled-back
    transaction never publishes).
- Event envelope (versioned):
  ```json
  {
    "v": 1,
    "type": "notification.created" | "message.created" | "booking.status_changed" | "bid.status_changed",
    "userId": "<recipient>",
    "occurredAt": "<ISO>",
    "payload": { ... }
  }
  ```
  Payload mirrors the existing REST response shape so the frontend cache patcher
  can drop the row in directly.
- Backplane: Redis pub/sub. Already a dependency. One channel per user
  (`hsm:rt:user:<userId>`).
- Reconnect / Last-Event-ID: support `Last-Event-ID` header so a reconnect
  fetches missed events from the recent events table (a new short-TTL Postgres
  table `realtime_outbox` keyed by userId + monotonic sequence; rotated daily).

### Frontend (Sprint 7.0 plan)

- `useEventStream()` — singleton `EventSource` mounted at `<App>` once
  authenticated. Routes events to the right React Query cache via a switch
  on `event.type`:
  - `notification.created` → invalidate `notifications.list` + `unreadCount`.
  - `message.created` → optimistic insert into `chat.messages.list` for the
    affected conversationId.
  - `booking.status_changed` → invalidate `bookings.detail` + `bookings.list`.
  - `bid.status_changed` → invalidate `bids.list` for the provider; invalidate
    the seeker's `bids.list` for that requestId.
- The polling intervals shipped in 5.2–5.5 stay as a 30-second-or-slower
  fallback, so a torn stream doesn't stall the UI.

### Security posture

- SSE response is per-user; the user's id is taken from the same JWT path
  the REST surface uses. No path or query parameter accepts a userId.
- The Redis backplane is a private channel (`auth-required`); production
  Redis must require a password.
- Event payloads are the SAME wire shapes the REST endpoints emit — so the
  same projection rules (no seekerUserId leak, no line1 in feed events, no
  passwordHash anywhere) apply for free.
- No raw Prisma errors are placed on the bus; the publisher only emits
  events for already-committed state changes.

### Migration / rollout

- Phase 1 (this spike): document only.
- Phase 2 (Sprint 7.0): ship the backend RealtimeModule, the Redis backplane,
  and the frontend `useEventStream()`. Polling stays on as a fallback.
- Phase 3 (post-7.0): tune polling intervals down to the 60s heartbeat range,
  evaluate dropping polling entirely in environments where the SSE channel
  has been stable for a quarter.

## Risks

- Redis as a single point of failure for realtime. Mitigation: SSE clients
  reconnect with `Last-Event-ID`, and the polling fallback covers any window
  where Redis is unavailable.
- Long-lived connections hold one Node socket per active user. Mitigation:
  connection cap per instance + horizontal autoscaling on the API tier;
  benchmark target 1k concurrent / instance.
- Frontend `EventSource` does not support custom headers in older browsers;
  cookie-auth (already the default for the API) covers that.

## Test strategy (for Sprint 7.0)

- Unit: `RealtimeEventsPublisher` emits exactly once per committed mutation,
  zero times on rollback, with the right channel + payload shape.
- Integration: spin up a NestJS test app + an in-memory Redis adapter,
  subscribe to the SSE endpoint with `EventSource`, assert that a
  notification creation surfaces within 500 ms.
- Postman cannot drive SSE end-to-end, so the runtime harness in Sprint 5.7
  stays REST-only; Sprint 7.0 adds a dedicated Newman-or-Playwright check
  for the live channel.

## Decision

Adopt SSE + Redis pub/sub as the foundation for Sprint 7.0. WebSocket and
managed services are not needed at the current scale and add operational
complexity without a matching benefit.
