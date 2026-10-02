# R07 — Request creation, matching delivery and lifecycle recovery

Status: **IMPLEMENTED, PENDING MERGE.** This document records what the branch
`feat/r07-request-provider-lifecycle` changes and the evidence gathered for it.

Baseline: `origin/develop` @ `60f57077b4c4e33ab8737ca7dd3bfaf89dc65de6` (R06
merged, all six post-merge workflows green).

R07 is a prove-and-repair sprint over seeker request -> matching delivery -> bid
-> booking. It does not rewrite working subsystems.

## What was already sound

| Area                                                                  | Evidence                                      |
| --------------------------------------------------------------------- | --------------------------------------------- |
| Request, timeline event and outbox event commit together              | `RequestsService.create`, existing unit tests |
| Bid acceptance uses conditional status flips; one booking per request | real-Postgres race test                       |
| One active bid per provider per request                               | partial unique index from Sprint 2            |
| Self-bidding refused                                                  | real-Postgres test                            |
| Outbox worker: per-handler idempotency marker, retry, dead letter     | `outbox.integration.spec.ts`                  |
| Cancellation racing acceptance has one winner                         | real-Postgres race test                       |

## Gaps repaired

| #   | Gap on `develop`                                                                                                                                         | Repair                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A request could be scheduled in the past                                                                                                                 | `assertNotInThePast` on create, and on update when the time is being changed. Refused with `400 SCHEDULE_IN_PAST`                                                                            |
| 2   | A double-submitted or retried creation produced two requests                                                                                             | Optional `idempotencyKey` on the create body, unique per seeker in the database. A replay returns the first request; a concurrent duplicate loses on the unique index and returns the winner |
| 3   | A provider outside a request's category or service area got a 404 from the detail endpoint but could still bid on it by id, and received its description | `ProviderBidsService.submit` decides visibility with the same repository predicate as the feed and the detail                                                                                |
| 4   | A bid could land on a request while it was being cancelled or accepted                                                                                   | Bid submission and bid acceptance both take a `FOR UPDATE` lifecycle lock on the request row first                                                                                           |
| 5   | A request closed before the outbox worker ran was still announced to matching providers                                                                  | The fan-out handlers check that the request is still open before announcing                                                                                                                  |
| 6   | After a bid was accepted the provider lost the seeker's photos                                                                                           | `ProviderBookingDetail.requestMediaUrls`                                                                                                                                                     |

### Two repairs made during verification of this branch

- **Acceptance did not take the lifecycle lock.** Only bid submission did.
  Acceptance rejects sibling bids before it flips the request row, so a bid
  inserted in between was committed as `PENDING` on a booked request. The race
  test in `r07-marketplace-races.integration.spec.ts` reproduced it; acceptance
  now locks first.
- **The past-schedule rule lived in the shared type check.** `update` re-runs
  that check against the merged row, so every edit, even to the description, of
  a request whose time had already passed was refused. The rule now runs only
  where the seeker is setting the time. It remains strict: a time at or before
  the server's "now" is refused, with no tolerance.

## Policies made explicit

- **Repeated submission.** Only a client-supplied key makes a retry safe. Without
  a key, two calls are two requests. A key is scoped to the seeker. The web
  wizard sends one key per submission and resends it on retry.
- **Closed requests and bidding.** A request that is closed to bids is answered
  with 404, exactly like one the provider may not see.
- **Cancel and bids.** Cancelling does not withdraw pending bids, and reopening
  makes them live again. Unchanged.
- **Announcement and cancellation.** A request closed before delivery is not
  announced. A request closed after delivery was announced truthfully.
- **Reopen.** A reopened request is visible in the feed again but is not
  re-announced. Unchanged.

## Schema

Migration `20261002120000_r07_request_creation_idempotency`, additive:

- `ServiceRequest.idempotencyKey TEXT NULL`;
- unique index `(seekerUserId, idempotencyKey)`. `NULL` keys are distinct, so no
  existing row can conflict.

Rollback / forward-fix: dropping the index and the column returns pre-R07
behaviour exactly.

## Security

- Bid submission enforces category, service-area and ownership visibility,
  closing an access-control inconsistency and a disclosure of the request
  description to providers who could not open it.
- The submission key is looked up scoped to the session's user.
- No new endpoint. Authentication, CSRF and role guards are unchanged.

## Concurrency and idempotency

Proved against real Postgres:

- sequential and concurrent submissions with one key create one request;
- a bid racing an acceptance (10 rounds) never leaves a pending bid on a booked
  request;
- two acceptances of two bids produce one booking;
- a cancellation racing an acceptance has exactly one winner (6 rounds);
- a bid racing a cancellation, and a reopen racing a bid, end in one consistent
  state with no server error (6 rounds each);
- delivery after a crash, after a mid-delivery failure, and with three
  concurrent workers happens exactly once per recipient;
- a request cancelled before delivery is not announced, and its events settle.

## Evidence

Local run on Windows 11, Node 24.21.0, pnpm 10.32.1, throwaway PostgreSQL 16 and
Redis 7 containers.

| Check                                                                 | Result                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| `r07-request-provider-lifecycle.integration.spec.ts`                  | 6 passed                                             |
| `r07-marketplace-races.integration.spec.ts`                           | 23 passed                                            |
| Both suites together                                                  | 29 passed, four consecutive runs                     |
| Full gated API suite, 6 shards, fresh database                        | 4890 passed, 33 skipped, 1 failed (Findings, item 2) |
| Affected API unit suites (requests, bids, provider)                   | 2051 passed                                          |
| API typecheck / lint                                                  | PASS / PASS                                          |
| Web typecheck / lint / `typecheck:e2e`                                | PASS                                                 |
| `r07-request-provider-lifecycle.real-api.spec.ts` (two browser roles) | 1 passed, three runs                                 |

The browser spec: the seeker posts through the real wizard; an ineligible
provider's own feed fetch omits the request and no card renders; the eligible
provider opens it and places a bid through the real UI; the seeker accepts; the
provider workspace shows the accepted bid and the scheduled booking, and still
shows them after a hard reload; the database row agrees.

Scope limits of the browser spec: the providers are activated for the fixture
rather than through the admin review pipeline, which other suites certify, and
the seeker's acceptance is sent through the real HTTP command rather than the
bid screen.

## Findings outside the R07 change

1. `dispute-workspace.integration.spec.ts` failed 2 cases in one full local run
   and in 1 of 3 solo reruns. No dispute code differs from `develop`.
   Intermittent and pre-existing on this Windows host.
2. `restricted-erasure.spec.ts` fails one `ENOTDIR` case on Windows only.
3. The R05 real-browser spec failed once in three local runs alongside this
   branch and passed on rerun; the evidence was overwritten before it could be
   inspected.
4. The provider web app does not yet render the booking detail endpoint, so the
   request photos now returned there are not shown on a provider screen.
5. Geo matching is exercised here by city key only. Radius and coordinate
   matching belong to R09.

## Rollout

- Deploy order: database migration, then API, then web. An older web bundle
  sends no key and keeps working, without retry safety.
- No feature flag.
