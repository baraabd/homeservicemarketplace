# R18 — Performance acceptance

Status: **NOT RUN.**

- No launch capacity target exists in the repository or in an owner decision;
  none is invented here (UNKNOWN_DECISION).
- A load test on a disposable CI runner or this low-memory host would measure
  the runner, not the product; a hosted target is required
  (HOSTED_ENVIRONMENT_BLOCKED).

## What the code already bounds

| Concern                | Evidence                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unbounded pagination   | provider bids use cursor pages capped at 100 (`provider-bids.service.ts:157`), bookings likewise (#148); foreign cursors are refused (E-18) |
| N+1 on My Bids         | the booking is read with the bid in one query (`listForProvider` includes `booking`), replacing a second list request (E-18)                |
| Outbox after a restart | R17-B announces committed notifications once across a replica restart; backlog under load is not measured                                   |
| Existing tooling       | `scripts/perf/geo-query-plan.mjs` (feed geo query plan)                                                                                     |

## To run with a hosted target

Bounded scenarios for login, catalog, request list, provider feed, request
creation, bid submission and listing, booking reads, messaging,
notifications, admin queues, media metadata and worker throughput. Measure
p50/p95/p99, throughput, error rate, database pool use, Redis connections,
CPU, memory, query counts, slow queries and outbox lag. Inspect `EXPLAIN
ANALYZE` plans for the feed, bids, bookings and notifications queries on
production-sized synthetic data. Record the tested capacity as measured.
