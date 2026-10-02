# R10 — Working hours and schedule durability

Status: **IMPLEMENTED, PENDING MERGE.** This document records what the branch
`feat/r10-working-hours-schedule-durability` changes and the evidence gathered
for it.

Baseline and merge base: `origin/develop` @
`af66865d3a20a9137a1e2e5e9ab6b1b846618b21` (R09 and the R05 baseline repair
merged; all six post-merge workflows green at first attempt, including the R05
acceptance and its bounded stability batch).

## Goal

Close the remaining authority, durability, timezone and concurrency gaps in
Provider V2 working hours:

    schedule screen -> API validation -> version -> one transaction -> rows
        -> read model -> navigation -> reload -> fresh login

R10 is a prove-and-repair sprint. It does not redesign the editor.

## Read-only findings

The model was already sound, and R10 proves it rather than changing it:

- validation is on the server, order-independent, and runs before any row is
  touched;
- the whole week is replaced in one transaction together with the version bump;
- concurrency is protected three ways: a row lock on the provider profile, the
  version compared after the lock, and a compare-and-swap on the bump;
- the zone lives on every interval row; a zone change restamps every row and
  moves no minute;
- an empty week is no rows; nothing invents default hours;
- the editor's handling of a late refetch, an older answer, an edit during a
  pending save and a stale write was already correct.

Two facts that shape the evidence:

- **The approved editor is a bulk editor.** One window is applied to the
  selected days. It has no control for a second window on a day, so split and
  touching windows cannot be typed there. They are written through the real API
  with the provider's own session and read by the browser.
- **No appointment or DST conversion exists.** Nothing outside onboarding and
  admin review reads the weekly hours. See `APPOINTMENT_DST_POLICY.md`.

## Demonstrated failures, and the fixes

Each was reproduced by a failing test before any production change.

| #   | Defect on `develop`                                                                                                                                                                                                                                                                                      | Reproduction                 | Fix                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **After a change of market the provider could not save working hours.** The stored hours kept the zone of the market they had left. The working-hours screen sends back the zone the server reports; the server refused it (`TIMEZONE_NOT_IN_MARKET`) because it was no longer in the provider's market. | integration: 3 failing tests | A change of market carries the stored hours with it in the same write: a single-zone market restamps every row (no minute moves); a market with several zones reports no zone and asks. The read model reports only a zone the market contains. |
| 2   | **Hours in a zone the market does not contain still counted as working hours.** After defect 1's state arose, the application could be judged complete with hours nobody could place.                                                                                                                    | follows from 1               | Such hours do not count toward completeness until the zone is confirmed; the existing "set your weekly working hours" requirement is raised.                                                                                                    |
| 3   | **The editor asked to replace hours with a range it then refused.** With hours already on a selected day, an invalid range (an end before the start, a shift past midnight) reached the "replace your hours?" question and was refused only after the provider agreed.                                   | real-browser journey         | The range is validated first; a refused window asks nothing.                                                                                                                                                                                    |
| 4   | **Another provider's draft in the same mounted screen inherited the previous provider's unapplied selection.**                                                                                                                                                                                           | ordering unit test           | The screen is keyed by the draft's identity and restarts from that draft.                                                                                                                                                                       |

## Unchanged rules

Day 0 is Sunday. The start is inclusive and the end exclusive. `1440` is
midnight as an end. Touching windows are valid and are not merged. Overlap and
exact duplicates are refused. A single window may not pass midnight; overnight
work is two windows on two days. The whole week is replaced atomically. An
empty week means no availability. Several windows a day are allowed. The limit
is 60 windows. No minute is rounded, clamped or reinterpreted.

## Timezone authority

Precedence, unchanged except for the market-change case:

1. a zone sent by the client must be a real IANA zone and one of the market's
   zones, or the write is refused;
2. otherwise a stored zone the market contains is kept;
3. otherwise a single-zone market supplies its zone;
4. otherwise the server asks (a market with several zones, or no market).

The browser's own time zone is never read. New in R10: on a change of market
the stored zone is re-decided by the same precedence in the same transaction,
and a stored zone the market excludes is reported as none.

## Schema, migration, contract

None. No migration. No contract change. The overlap rule stays in the service,
as before; the database enforces the per-row bounds and exact-duplicate
uniqueness. A write that bypasses the service could still store overlapping
rows or rows in two zones; the next service write repairs the zones.

## Files changed

- `apps/api/.../market/timezone-precedence.policy.ts` — `reportableTimezone`.
- `apps/api/.../provider-onboarding-wizard.service.ts` — realign the schedule's
  zone on a change of market; report and count hours only in a zone the market
  contains.
- `apps/web/.../components/AvailabilityTaskScreen.tsx` — refuse before asking;
  key the screen by draft identity.
- Tests: the R10 integration suite, the R10 browser spec, the ordering tests,
  unit tests for the policy and the screen; one existing unit fixture corrected
  (hours in Stockholm for a provider in Syria).
- `.github/workflows/ci.yml` — one step and its artifact upload in the existing
  real-API job.
- `docs/production-readiness/r10/*`, `docs/production-readiness/r01/BASELINE.json`.

## Evidence

Local run on Windows 11, Node 24.21.0, pnpm 10.32.1, throwaway PostgreSQL 16,
Redis 7 and Mailpit containers; API and web built from this branch with
`VITE_PROVIDER_ONBOARDING_V2=true`. Heavy phases were run one after another; no
run was interrupted.

| Check                                                                                       | Result                                                                                             |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `r10-working-hours-durability.integration.spec.ts` on `develop` code                        | 3 failed, 43 passed (the reproduction)                                                             |
| The same suite with the fixes                                                               | 47 passed, six consecutive runs                                                                    |
| Concurrency inside that suite                                                               | 12 two-writer rounds, 4 five-writer rounds, 6 zone-versus-week rounds; one whole winner every time |
| Full gated API suite, 6 shards, fresh database                                              | 5052 passed, 33 skipped, 2 failed (Findings 1 and 2)                                               |
| API `lint` / `typecheck` / `build`; `prisma validate`; `prisma migrate status`              | PASS                                                                                               |
| Web unit suite (`test:ci`)                                                                  | 182 files, 2281 passed                                                                             |
| Web `lint` (34 pre-existing warnings) / `typecheck` / `typecheck:e2e` / build with the flag | PASS                                                                                               |
| `r10-working-hours-schedule-durability.real-api.spec.ts`                                    | 17 passed, four consecutive runs, no retries                                                       |
| R05 + R06 + R07 + R08 + R09 + R10 real-API browser suites together                          | 54 passed                                                                                          |
| Existing V2 real-API browser suites (`v2-real-api`, `v2-persistence`, `repairs`)            | 34 passed                                                                                          |
| Governance scripts                                                                          | PASS                                                                                               |

The first two runs of the R10 browser spec failed while the spec itself was
being written: one on a test helper that did not answer the screen's own
"replace your hours?" question, and one that exposed defect 3.

## Findings outside the R10 change

1. `restricted-erasure.spec.ts` fails one `ENOTDIR` case on Windows only
   (re-confirmed on untouched code in R09). It passes on Linux CI.
2. `dispute-workspace.integration.spec.ts` ("dead-letters exhausted scanner
   leases…") failed once in the full run. Reproduced on untouched `develop`:
   1 failure in 3 solo runs there, 2 in 3 on this branch. No dispute code is
   touched by R10. It has its own hosted CI job.
3. `timezone-resolution.ts` holds a second, hard-coded table of single-zone
   countries used for the zone label on the read model, beside the operator's
   market registry. They agree for the seeded markets. Not changed.
4. The working-hours screen's refusal sentence is a status message below the
   controls and is not tied to the time inputs with `aria-describedby`.
5. The web autosave still reads the conflict version from the wrong place
   (recorded in R08). No visible effect.

## Residual risks

- After moving to a market with several zones, the provider must confirm a zone
  on the work-area screen before their hours count again. The requirement shown
  is the general "set your weekly working hours" one.
- A direct database write can still store overlapping windows or rows in two
  zones; the service is the only enforcement of both.
- The editor cannot enter a split day. That is the approved design.
- Appointment and DST behaviour is undefined because nothing uses it yet.

## Rollback

Revert the PR. No migration and no deploy ordering. Rows restamped while R10 was
live hold a zone of the provider's market and remain valid under the old code.
