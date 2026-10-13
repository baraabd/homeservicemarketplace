# CR-05 — worker-health metrics for R23, and shipping the operator CLIs in the image

- **Owner:** coordinator, or a lease to R23 for the telemetry part:
  `apps/api/src/infrastructure/telemetry/metrics.service.ts` is outside the
  R22 allowlist, and so is `apps/api/Dockerfile`.
- **Requested by:** R22.
- **Blocks:** nothing in R22. Lease loss is already observable through
  `outbox_events_processed_total{outcome="lease-lost"}`.

## A. Metrics (`metrics.service.ts`)

1. Update the `outboxEventsProcessedTotal` comment to list the closed outcome
   set: `processed / skipped-duplicate / retried / dead / lease-lost`.
2. Add these low-cardinality series, with no labels except where shown:

| Name                                            | Type    | Emitted where (R22 follow-up in `outbox.worker.ts`)  |
| ----------------------------------------------- | ------- | ---------------------------------------------------- |
| `outbox_worker_tick_failures_total`             | counter | `tick()` catch: the loop failed, e.g. DB unreachable |
| `outbox_heartbeat_failures_total`               | counter | heartbeat `.catch`                                   |
| `outbox_shutdown_released_total`                | counter | `onModuleDestroy`, by released count                 |
| `outbox_dead_letter_replayed_total{event_type}` | counter | `OutboxReplayService` after commit                   |
| `outbox_worker_last_tick_unixtime`              | gauge   | end of every `runOnce` (staleness alarm per replica) |

Until these exist, the worker emits the equivalent structured log events
(`outbox.tick.failed`, `outbox.heartbeat_failed`, `outbox.shutdown.released`).

Test-double impact: specs that build `OutboxWorker` with hand-rolled metrics
objects (`outbox.integration.spec.ts`, `r07-marketplace-races`,
`r09-geo-matching`, `r17-notifications`, R22 harness) need the new members
added when the worker starts calling them. Make that one serialized change at
the gate.

## B. Image (`apps/api/Dockerfile`)

Ship the operator CLIs next to the existing deploy helpers:

```dockerfile
COPY --chown=app:app scripts/production/workers/outbox-replay.cjs scripts/production/workers/outbox-health.cjs ./deploy/
```

Both resolve the built API from `/app/dist` via `process.cwd()/dist` or
`--api-dist /app/dist`. Neither needs network egress or extra secrets beyond
the container's `DATABASE_URL`.
