# Phase 5 — resume note

Rewritten after each coherent milestone. A restart should read this, then the
checklist, and pick up the first unfinished item without repeating finished
work.

## Where things stand

**Branch** `feat/provider-onboarding-v2-phase5-exact-visual-parity`
**Base** `develop` @ `ba8613b` (unchanged)
**Last pushed** `f35d0c8`

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
- [ ] P2 remaining gaps: G-04 scheduling (destructive — highest priority),
      G-05 transport, G-06 primary specialty, G-07 bio limit, G-09/G-10 prose,
      G-11 verification axis, G-12 timestamp zone, G-13 covered by G-01.
- [ ] P3 Six real-API journeys with database reads.
- [ ] P4 PR body, migration matrix, verification doc.

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
