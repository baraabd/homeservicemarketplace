# R25 — Realtime multi-instance activation and reconnect recovery

## Scope and source

Mode A — integration, authorization and reliability. This implements the owner-supplied R25 prompt; no visual redesign, live-money action, merge, deployment or production flag activation is authorized here.

- Assigned branch: `feat/r25-realtime-multi-instance`.
- Execution/frozen Wave 2 base: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- Frozen full tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- The current coordinator records were independently read at `07c8e584c684111bfc80995c7efb0144cfb6161b`: owner-merged #171/#172 establish G1 ACCEPTED and R25 READY_TO_START. This lane was created from the frozen source; the later record-only overlay is not silently called its runtime base.
- Implementation and isolated acceptance are complete on the candidate identified in `ACCEPTANCE.md`; the PR metadata and publication acceptance run bind the actual published head/tree separately. A commit does not embed its own final SHA in its source tree.
- Hard dependencies: accepted R22 and R23. No unmerged R24–R28 source is consumed.
- Runtime pins: Node 24.21.0, pnpm 10.32.1, Prisma 6.12.0. No manifest, lockfile or schema change.

The read-first material comprises `CLAUDE.md`, the current UX/UI policy, the realtime architecture documents, R15 accounting/invariants/authority, R16 payout policy, R17 messaging/notification authority, R18 blockers, the live-money gate, R22 handler contract, R23 diagnostics, and the current frozen-wave records. Historical realtime notes asserting that Redis removes long-polling affinity requirements are superseded for this implementation by the installed adapter's official documentation.

## Coordinator-approved exact ownership

Authority: [wave-02.plan.json at the merged publication](https://github.com/baraabd/homeservicemarketplace/blob/07c8e584c684111bfc80995c7efb0144cfb6161b/docs/production-readiness/post-r18/waves/wave-02.plan.json). There are 39 exact owned paths and two leased infrastructure files, no prefix expansion. The infrastructure lease allows prepared files only, expires at G2 or earlier revocation, and confers no deployment permission.

The lane assigns one writer to the API paths, one to the web paths, and its coordinating author to its evidence/scripts/infrastructure. Shared source, CI, configuration and central registries stay outside the lane. Only a concrete request under `shared-change-requests/CR-001-integration.md` may propose their changes.

```text
apps/api/src/modules/realtime/conversation-participant.gate.spec.ts
apps/api/src/modules/realtime/conversation-participant.gate.ts
apps/api/src/modules/realtime/realtime-events.controller.ts
apps/api/src/modules/realtime/realtime-events.publisher.spec.ts
apps/api/src/modules/realtime/realtime-events.publisher.ts
apps/api/src/modules/realtime/realtime-identity.resolver.ts
apps/api/src/modules/realtime/realtime-socket.adapter.spec.ts
apps/api/src/modules/realtime/realtime-socket.adapter.ts
apps/api/src/modules/realtime/realtime.gateway.spec.ts
apps/api/src/modules/realtime/realtime.gateway.ts
apps/api/src/modules/realtime/realtime.module.ts
apps/api/test/integration/r25-realtime-recovery.integration.spec.ts
apps/web/e2e/r25-realtime-recovery.real-api.spec.ts
apps/web/src/lib/realtime/booking-lifecycle.test.ts
apps/web/src/lib/realtime/booking-lifecycle.ts
apps/web/src/lib/realtime/notification-arrival-watcher.test.tsx
apps/web/src/lib/realtime/notification-arrival-watcher.ts
apps/web/src/lib/realtime/notification-baseline.test.ts
apps/web/src/lib/realtime/notification-baseline.ts
apps/web/src/lib/realtime/notification-target-handler.ts
apps/web/src/lib/realtime/notification-target.test.ts
apps/web/src/lib/realtime/notification-target.ts
apps/web/src/lib/realtime/notification-ux.test.ts
apps/web/src/lib/realtime/notification-ux.ts
apps/web/src/lib/realtime/realtime-experience.ts
apps/web/src/lib/realtime/realtime-i18n.ts
apps/web/src/lib/realtime/realtime-navigator.ts
apps/web/src/lib/realtime/side-effects.test.ts
apps/web/src/lib/realtime/side-effects.ts
apps/web/src/lib/realtime/socket-client.ts
apps/web/src/lib/realtime/use-realtime-socket.test.ts
apps/web/src/lib/realtime/use-realtime-socket.ts
docs/production-readiness/r25/ACCEPTANCE.md
docs/production-readiness/r25/IMPLEMENTATION.md
docs/production-readiness/r25/RISKS.md
docs/production-readiness/r25/ROLLBACK.md
docs/production-readiness/r25/shared-change-requests/CR-001-integration.md
scripts/production/realtime/verify-replicas.cjs
scripts/production/realtime/verify-replicas.test.cjs
infra/production/realtime/README.md
infra/production/realtime/compose.test.yml
```

## Implemented behavior and reproduced gaps

1. The old socket subscription revalidation reads the session's current JTI instead of checking the original socket credential. Token rotation can therefore be missed.
2. Cross-instance revocation depends on transient adapter delivery. Authorization must remain current even when that announcement is missed.
3. Classic Redis Pub/Sub cannot replay a reconnect gap; REST history, unread state and current permissions must be re-fetched.
4. The web socket client has unbounded retry/ack behavior and no complete reconnect cache recovery.
5. Notification arrival watermarks and short-lived toast suppression can lose same-timestamp arrivals or announce the same durable notification twice.
6. Connection, room, payload and delivery queues require explicit bounds, including negative/concurrency evidence.
7. The existing browser CI does not route a new R25 real-service spec into a dedicated real stack. This requires coordinator integration, not a silently skipped test.

Durable PostgreSQL notifications/messages and server-owned permissions remain the source of truth; realtime events are delivery and cache-invalidation hints. No schema or durable business authority is duplicated.

### Current recipient authority

The gateway keeps the original socket credential's JTI and expiry, checks it against the existing session service at admission and before delivery, and rechecks connected clients in bounded batches. Current role/permission and provider capability checks determine each recipient's access. Conversation joins and private delivery use the same participant/capability repositories as REST. This remains effective when a transient cross-replica eviction announcement is absent. Expired/revoked credentials are disconnected; forbidden provider/admin/conversation rooms are removed.

The Redis adapter forwards an internal server event to each replica. Each replica authorizes its own recipients before a volatile Socket.IO write. A raw cross-node room broadcast would bypass asynchronous recipient authorization and is therefore not used for private delivery. Exact browser origins are required for cookie-authenticated transports; native clients can present their explicit JWT without a browser cookie.

### Explicit resource limits

| Resource                                    | Bound                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Socket.IO packet                            | 64 KiB                                                                                                   |
| Simultaneous Socket.IO connections          | 6 per user across replicas, 1,000 per instance including pending handshakes                              |
| Redis connection lease                      | Atomic Redis-time reservation, 45-second TTL; local validity is shorter and renewed after session checks |
| Conversation rooms                          | 32 per socket; one join in flight, 60 subscription attempts per minute                                   |
| Authorized delivery queue                   | 512 items / 16 MiB across the instance, 16 pending per socket, bounded concurrent drains                 |
| Redis publication work                      | 128 pending publications / 8 MiB, bounded command deadlines                                              |
| SSE authorization work                      | 16 pending per subscriber, 512 items / 16 MiB aggregate; connection admission bounded                    |
| SSE response                                | No Nest concatMap delivery queue; direct response write, immediate destruction on pressure or expiry     |
| Browser replay/revision window              | 200 entries; bounded event shape and immutable identity checks                                           |
| Browser reconnect                           | One jittered exponential scheduler, maximum 60-second delay                                              |
| Browser authorization / join acknowledgment | 5-second deadlines                                                                                       |
| Cross-tab presentation                      | Five-minute ledger of at most 200 opaque fingerprints/timestamps; at most 32 pending claim operations    |

Redis loss closes affected sockets and rejects new transport admission. There is no automatic single-instance downgrade. Volatile transport writes intentionally discard undeliverable transient work; durable recovery comes from REST.

### Browser recovery and notification presentation

The web transport remains off unless `VITE_REALTIME_SOCKET_IO=true` is explicitly baked into its build. Socket readiness begins at a validated `connection.ack` for the current user, after server authorization and personal-room setup. Transport connection alone cannot trigger private subscriptions. Active conversation joins serialize their acknowledgments; the client recycles after 16 retained rooms because the frozen protocol has no leave operation.

Recovery first confirms current identity, then refetches existing authorized private query families and invalidates inactive caches. Reconnect gaps, invalid/unproven events, resume and opaque sibling-tab mutation hints all feed a bounded/coalesced recovery scheduler. Outdated async responses cannot remove or repopulate the next account's caches. Periodic REST recovery continues while realtime is disabled or disconnected.

Immutable event IDs and bounded revision checks suppress repeated creation frames without dropping later mutable status transitions. Equal-time and bounded late notification arrivals use their immutable IDs; initial history and already-read notifications remain quiet. Web Locks coordinate one transient presentation across tabs using only opaque fingerprints and timestamps. Hidden tabs do not consume presentation claims. When coordination is unavailable or denied, durable history and unread badges remain available without duplicated transient feedback.

The controlled legacy SSE route preserves its endpoint and event framing, validates the original token and current authority, and closes the actual HTTP response at expiry or backpressure. Completing an upstream Observable alone would permit Nest's downstream queue to drain private data later; the direct response removes that queue.

## Transport and rollout authority

Official references reviewed for Socket.IO 4.x / Redis adapter 8.3.0:

- https://socket.io/docs/v4/redis-adapter/
- https://socket.io/docs/v4/using-multiple-nodes/
- https://socket.io/docs/v4/connection-state-recovery/

The classic adapter does not provide durable connection-state recovery. HTTP long-polling across replicas requires session affinity; WebSocket-only transport uses one connection and does not require that affinity. Proxy idle timeout must exceed the configured heartbeat interval plus timeout. Polling fallback must still obey REST authentication, authorization and fail-closed rate limiting.

A total Redis outage can also remove the mandatory REST rate-limit dependency. That scenario is accepted only as safe degradation followed by authoritative recovery after restoration; socket-only failure is tested separately for uninterrupted REST polling. No test may weaken production rate limiting to disguise this distinction.
