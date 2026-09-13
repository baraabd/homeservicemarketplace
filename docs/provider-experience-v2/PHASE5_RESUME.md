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

- [x] P0-1 `provider-onboarding-v2.spec.ts:424` ACTION_REQUIRED — obsolete
      assertion replaced by five stricter ones (reason readable, deep link
      reaches the task, data intact on arrival, no invented submit, broken deep
      link detected, fallback heading). Two mutations confirm sensitivity.
- [ ] P0-2 Integration & E2E — `providerLifecycle` advisory-lock starvation.
      Two suites (`provider-journey`, `provider-lifecycle-backfill`) take it
      EXCLUSIVE for their whole run; ~24 take it SHARED for theirs. The
      try-lock never queues, so the exclusive acquirers poll for 120s and time
      out. `test/support/db-isolation.ts` documents why blocking locks are NOT
      the answer (measured: 32 suites / 851 tests failed, cross-resource cycle).
- [ ] P0-3 Re-run the browser suite under the gate runner with count
      reconciliation.
- [ ] P1 Visual pipeline: fail-closed image verification, negative tests,
      18x2 exactly, derived counters, immutable run dirs + manifest, audit
      reference normalisation, Phase 5 job into required CI, axe wcag21aa +
      wcag22aa, responsive zoom/reflow + reduced-motion.
- [ ] P2 The thirteen integration gaps in `PHASE5A_INTEGRATION_GAPS.md`.
- [ ] P3 Six real-API journeys with database reads.
- [ ] P4 Docs, PR body, CI green on the final SHA.

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
