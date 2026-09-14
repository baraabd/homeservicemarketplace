# Phase 5 — resume note

Rewritten after each coherent milestone. A restart should read this, then the
checklist, and pick up the first unfinished item without repeating finished
work.

## Where things stand

**Branch** `feat/provider-onboarding-v2-phase5-exact-visual-parity`
**Base** `develop` @ `ba8613b` (unchanged)
**Last pushed** `ec9b956` — Phase 5B defect fixes (G-11, G-14, testid guard, DB reads)

### The reported manual-test failure — DIAGNOSED, see PHASE5B_MANUAL_TEST_DIAGNOSIS.md

The user could not complete specialties/experience/location; the hub sat at 4 of
6 with Services and Review reading مطلوب, plus a repeating markets 404 and an
auth 401.

**Primary cause, proven: their API was a fifteen-day-old container.**
`docker-api-1` runs image `hsm-api:dev` built **2026-08-30**; the markets route
entered Git on **2026-09-11**, and the container's compiled bundle contains zero
occurrences of `specialtyLeafIds`, `primarySpecialtyId`, `markets`,
`resolvedTimezone` or `serviceAreaExpansion`. `docker compose up -d` reuses that
image unless `--build` is passed. Their frontend was current; their API was not.

Their database shows the answers were NOT lost: `professionSince`,
`transportMode`, city, country and radius are all stored, and there are **5
PENDING specialty applications with 0 approved memberships**. Current code
classifies that as `AWAITING_REVIEW` (the platform's item, never blocking
submission); the stale build predates that split and raises `REQUIRED`, which is
the 4-of-6 deadlock exactly.

**The 401 on `/auth/me` is expected** — the anonymous boot probe — and is not the
cause of anything reported.

**Three product defects found alongside it and fixed:** stale selection
snapshots in ServicesTaskScreen (a real bug on current code), the hub's
sr-only-only explanation, and unbounded retrying of a permanent markets failure.

**Nothing of the developer's was touched** — no container restarted, no volume
removed, no row mutated. All inspection was read-only.

### Disposable infrastructure this task owns

Nothing here belongs to the developer. Their own Postgres, Redis, Mailpit, API
and vite are untouched; every port below is deliberately non-default.

| Service     | Container / process       | Port          |
| ----------- | ------------------------- | ------------- |
| Postgres    | `hsm-p5-pg`               | 55432         |
| Redis       | `hsm-p5-redis`            | 56379         |
| Mailpit     | `hsm-p5-mail`             | 51025 / 58025 |
| API         | `scratchpad/start-api.sh` | 4011          |
| SPA (V2 ON) | `vite preview`            | 4174          |

`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/homeservicemarketplace`

### Known local-environment limitation — NOT a product defect

`test/integration/outbox.integration.spec.ts` is intermittently red **on this
host only**. Five consecutive runs of that file alone: 2 green, 3 red, with
**four different** tests failing across them — "spreads a backlog across
concurrent workers", "claims no more than the requested batch size", "reclaims an
event orphaned by a worker that died mid-flight", "four workers drain a backlog".

A different test each time is the signature of a clock, not a logic bug, and the
suite's own comment says it was calibrated against a container running **~67 ms
behind** the host. Measured now:

```
skew_ms=254  287  340     (before restarting the container)
skew_ms=939  902          (after — the drift is in the Docker Desktop VM,
                           not the container, so a restart does not fix it)
```

Every assertion in that file compares a host-computed deadline against a
database-computed `now()`, so ~900 ms of skew moves claim and reclaim windows
past their thresholds.

The suite cannot reach any of this sprint's changes: it imports only
`outbox.repository`, `outbox.worker` and `support/db-isolation`, and contains
zero references to `validateEnv`, `AppModule`, authentication or throttling.
**CI is the authority for this suite** — Linux, service containers sharing the
runner clock — and it passed on `ec9b956`. Do NOT widen its tolerances to make
this host green; that would trade a real ordering guarantee for a clock problem.

### CI on `f35d0c8`, read from the public checks API

| Check                                         | Result  |
| --------------------------------------------- | ------- |
| CodeQL / Analyze JavaScript-TypeScript        | success |
| Verify (Web, API, DB, Contracts, lockfile)    | success |
| Docker cold build, Compose smoke, scans       | success |
| Auth cookie contract                          | success |
| **Browser E2E (Playwright / Chromium)**       | FAILURE |
| **Integration & E2E (real Postgres / Redis)** | FAILURE |
| **CI gate** (aggregate)                       | FAILURE |

Job logs need admin rights; check-run annotations are readable unauthenticated
and are what the rows above come from.

## A verification defect found on resume, and it matters more than any single test

The previous session reported the browser suite green from three per-project
runs. It was not. Two independent faults:

1. Every run was piped (`| tail`), so the reported exit status belonged to
   `tail`, not to Playwright. `scripts/ci/run-gate.sh` exists in this repo
   precisely to stop that and was not used.
2. The desktop project reports **260** tests from `--list`; that run accounted
   for only 232 (205 passed + 27 skipped). Twenty-eight never ran and nothing in
   the summary said so.

**Rule for the rest of this work:** every gate goes through
`scripts/ci/run-gate.sh`, and a browser run is only believed when its
passed+skipped+failed equals the `--list` total for that project.

## Checklist

- [x] P0-1 ACTION_REQUIRED browser failure — obsolete assertion replaced by five
      stricter ones; two mutations confirm sensitivity.
- [x] P0-2 Integration lock starvation — three causes, all fixed: hold-and-wait
      across 16 suites (atomic set acquisition), an EXCLUSIVE lock
      `provider-journey` never used (downgraded to SHARED), and
      `provider-lifecycle-backfill` owning a database instead of locking a
      shared table. Worst wait 74.3s -> 32.5s; no EXCLUSIVE providerLifecycle
      acquirers remain. A lock-aware sequencer was tried and REVERTED — it made
      things far worse (117.2s of 120s).
- [x] P0-3 Gate discipline — every gate now runs through
      `scripts/ci/run-gate.sh`.
- [x] P1 Visual gate fails closed (recomputed ratio decides, not the stored
      one) + 4 negative tests; WCAG widened to 2.0+2.1+2.2 AA; Phase 5 job is a
      CI merge blocker with artifacts uploaded always; `typecheck:e2e` wired
      into CI after it turned out nothing typechecked `e2e/`.
- [x] P2 G-01 — market selection. Server side already existed (C2); the web
      never called it. Substate only, so state 6 is pixel-identical.
- [x] P2 G-11 — the verification axis now READS the verification case instead of
      projecting it from `profile.verified`. ACTION_REQUIRED, REJECTED and
      EXPIRED are their own answers; a failed read says "Unavailable" rather
      than guessing "Not started" and inviting redone work. 22 unit tests, plus
      a per-row assertion in the visual gate — the page-wide phrase search it
      replaced passed while the row read "Unavailable", because the specialty
      row says "In review" too.
- [x] P2 G-12 — the status centre timestamps in the PROVIDER's stored zone, from
      the draft, so it cannot disagree with the submission confirmation. The
      diff ratio could not see this: moving the fixture to
      America/Los_Angeles left state 14 green, so `12:43` / `١٢:٤٣` is now
      asserted as required copy and the mutation fails in both languages.
- [x] P2 G-13 — the timezone confirmation is the `CONFIRM_TIMEZONE` branch of
      the same market prompt that closed G-01.
- [x] P2 G-14 (NEW, found by the real-API run) — a COMPLETE task drew no body
      and no explanation, so finishing task 1 and pressing reload showed a
      header, a progress bar and a "Save and continue" over an empty screen.
      Confirmed against the live server: a name and a phone move
      BASICS_IDENTITY to COMPLETE.
- [x] P2 G-15 (NEW) — the counters were pinned at 0/6 by path arithmetic, not by
      missing evidence. See below.
- [~] P2 G-04 — the DESTRUCTIVE half is closed: `discardedByApply` names every
  day an Apply would overwrite and why (`SECOND_WINDOW` /
  `DIFFERENT_HOURS`), and the screen asks before discarding it. What remains
  is expressiveness — a provider working 09:00–17:00 on four days and
  09:00–13:00 on Thursday still cannot say so, because the approved screen
  has one From/To pair. That is a design question, not a defect: adding a
  second pair changes the approved screen.
- [x] P2 G-18 (NEW) — the portfolio promised "Crop and reorder before saving."
      in its own approved hint and provided neither, while
      `POST /portfolio/reorder` had existed the whole time. Reorder now works
      from the keyboard on the tiles themselves, so state 9 gains no pixels
      (0.00124 EN / 0.00108 AR, unchanged) and gains a keyboard path. Six
      component tests plus a real-API journey that uploads three photos through
      the real presign/PUT/register path, reorders in the browser, and checks the
      `position` column in Postgres after a reload and a fresh sign-in. CROP
      remains open and needs a design decision.
- [x] P2 G-19 (NEW) — the third rate limiter. Fixing OTP moved the 429 to the
      coarse 100/minute backstop. The suite stopped re-reading the draft before
      every write (the version is threaded now, which also removes a
      read-then-write race), and `GLOBAL_THROTTLE_LIMIT` joined its two siblings
      with the same production boot ceiling.
- [ ] P2 gaps that need a product-owner decision rather than more engineering,
      because closing any of them changes an approved screen or a contract:
      G-02 radius adjustability (the expansion ladder implies the radius is
      earned rather than chosen, in which case the approved screen is already
      right), G-03 device location, G-04 non-uniform hours (above), G-05 VAN and
      TRUCK, G-06 primary-specialty change control, G-07 surfacing the bio
      minimum at the input, G-08 equipment, and G-09/G-10 — client-composed
      summaries and the single-language rejection reason, which need a contract
      change rather than a screen change.
      In every one of these the existing stored value is PRESERVED, so no
      provider loses data; what they cannot do is change it on that screen.
- [x] P3 Six real-API journeys — **6/6 route, 6/6 persistence**, computed by the
      ledger from artifacts on disk.

  The earlier note here said the counters read 0 because no spec wrote the
  markers — "an absence of files, not of tests". That was half right, and the
  wrong half was the expensive one. Once the markers WERE written the counters
  still read 0/6, because `creditFor` took a single root and the report passed
  the PROVISIONAL one, so route and persistence were looked for under
  `PROVISIONAL_UI/route` — which the stubbed visual gate never writes and the
  real-API job never writes to. The counters moved when one argument was added,
  with no new evidence produced (G-15).

  Getting the journeys themselves green took eight repairs, and none of them was
  a test that had been failing honestly. They were locators the Phase 5A
  migration renamed or removed: `radius-slider`, `title-input`,
  `preset-sun-thu`, `years-of-experience`, `bulk-start` as a `<select>`,
  `review-submit` on the summary instead of the consent screen, and "N of 6
  complete" against the approved "N of 6 tasks complete". The worst never failed
  at all: `years-of-experience` never existed and its spec guarded every use in
  `if (await years.count())`, so it passed for a sprint while touching nothing.
  `e2e/testid-inventory.ts` is the static guard for that whole class now — every
  `getByTestId` in a spec must name something a component can emit, and
  reintroducing all four stale ids turns it red.

- [x] P4 migration matrix and gap ledger updated with the final counters and
      with G-14 and G-15. PR body drafted at `scratchpad/pr-76-body.md`; it
      cannot be posted from here without write access to the repository.

## CI, by revision

| SHA       | Result                                              |
| --------- | --------------------------------------------------- |
| `f35d0c8` | Browser E2E, Integration & E2E, CI gate FAILED      |
| `09503b0` | all 14 green                                        |
| `1adbbd0` | all green incl. the new Phase 5 visual job on Linux |
| `9de2d3d` | pushed, awaiting checks                             |

The Phase 5 gate passing on Ubuntu answers the cross-platform question: both
sides are captured in the same job under the same pinned conditions, so the
0.005 budget holds off Windows.

## Local throwaway infrastructure

Containers `hsm-p5-pg` (5432→**55432**) and `hsm-p5-redis` (6379→**56379**).
Deliberately non-default ports: the developer's own Postgres on 5432 and their
API process must not be touched. `dotenv -e ../../.env` does not override an
existing environment variable, so exporting `DATABASE_URL` is enough to keep
prisma off their database — verified by the migration count landing in the
container, not theirs.

```
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/homeservicemarketplace
REDIS_HOST=localhost REDIS_PORT=56379
RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1
JWT_ACCESS_SECRET=ci_only_dummy_secret_at_least_32_chars_long
```
