# Workload profiles for R37 (design; not executed)

R27 designs these profiles; R37 runs them against a hosted target. No
capacity figure follows from R27's local measurements. Launch load
(concurrent users and requests per second) is an **owner decision** that
does not exist yet (R18 `OWNER_DECISIONS.md`, "Hosting, registry and
budgets"). Every rate below is a parameter of the owner's launch load `L`,
not a number R27 invents.

Common to all profiles:

- **Target:** the hosted staging candidate with production policy
  (`NODE_ENV=production`, secure cookies, default throttles, ClamAV,
  workers on), never a developer database.
- **Dataset:**
  - Users are seeded through the real API, and request → bid → booking
    graphs are amplified with `lib/amplify.mjs`, or produced by the R37
    generator using the same rules.
  - The row counts are recorded.
  - Throttles stay on, and load comes from many source identities.
    Production throttles are never raised for a test.
- **Recorded per profile:**
  - p50, p95 and p99 for each endpoint class, from at least 100 samples per
    class;
  - error rate by status;
  - CPU and memory per API replica;
  - DB pool use, slow-statement captures (`auto_explain`) and
    `pg_stat_statements` top-N;
  - Redis connections;
  - outbox lag;
  - dataset provenance and the runner/region.
- **Pass/fail:** the `hostedOnly` budgets in
  `scripts/perf/post-r18/budgets.proposed.json`, once the owner approves them.

| Profile                     | Shape                                                                                                                                                                                                                                       | What it proves                                                                                                                  | Abort conditions                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **N — normal**              | `L` steady for 30 min. Mix by session: 55% seeker (home, requests, bookings, messages), 30% provider (feed, bids, bookings), 5% admin (queues, users), 10% anonymous (catalogue, auth pages). Reads to writes about 9:1. Think time 3–10 s. | read/write p95 within budget at launch load; no statement growth over time                                                      | error rate > 1% for 2 min; p95 > 3× budget           |
| **B — burst**               | `L` → `3L` in 60 s, held for 5 min, back to `L`. Burst made of new-request posting and the matching provider feed polling.                                                                                                                  | throttles answer 429 with `Retry-After`, never 5xx; recovery to N's p95 in < 2 min                                              | 5xx > 0.5%; any 500 with an internal error body      |
| **R — long-lived realtime** | `0.5L` sockets (`REALTIME_SOCKET_IO=true`, ≥ 2 replicas, Redis adapter) held 2 h, with message and notification fan-out at N's rate                                                                                                         | memory flat per replica (< 10% growth/h), delivery latency p95, reconnect storm after one replica restart                       | RSS growth > 25%; undelivered messages               |
| **U — expensive uploads**   | 5% of sessions upload portfolio photos and identity evidence (presign → PUT → register) at the 10 MB limit, with ClamAV scanning on                                                                                                         | upload p95, scan queue depth, no starvation of JSON reads (N's read p95 holds)                                                  | read p95 > 2× budget during uploads                  |
| **F — failure recovery**    | under N: kill one API replica; restart Redis; fail over or pause the DB for 30 s; make SMTP unavailable                                                                                                                                     | health/ready flips and recovers; outbox drains without duplicates; sessions survive; no raw infrastructure errors reach clients | data loss; duplicate notifications or ledger effects |

The endpoint classes come from the R27 query profile, which gives the
statements per request in parentheses:

- **Seeker:** `/v1/auth/me` (5), `/v1/me/requests` (5), request detail (5),
  bids on a request (7), `/v1/me/bookings` (7), notifications (3),
  conversations (3).
- **Provider:** available requests (10), `/v1/provider/bids` (11),
  `/v1/provider/bookings` (7), portfolio (9).
- **Admin:** users (52 at 15 rows, N+1; see CR-R27-08), providers (8),
  category applications (3), disputes (3), financial bookings (3), audit
  logs (3).
- **Writes:** register + OTP, post request, submit bid, accept bid, booking
  start/complete, message send, portfolio upload.

Before R37 runs, these must be settled: the launch load `L` and regions
(owner), the hosted target and its data-retention rules (owner, R18
blockers), and whether CR-R27-04/05/06/08 are integrated. R37 must also
measure the baseline it compares against, since R27's local numbers are not
that baseline.
