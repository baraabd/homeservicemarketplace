# R08 — Provider V2 all-field authority completion

Status: **IMPLEMENTED, PENDING MERGE.** This document records what the branch
`feat/r08-provider-v2-all-field-authority` changes and the evidence gathered for
it.

Baseline: `origin/develop` @ `e57118e0b5bc291368b248596fbdd631214c5ada` (R07
merged, post-merge workflows green).

R08 is a prove-and-repair sprint over the Provider Onboarding V2 application. It
proves every field the provider can set, on the bundle the build flag produces,
and repairs only what that proof demonstrated to be broken.

## What was missing on `develop`

1. Browser proof covered one field per task, and the persistence spec switched
   V2 on with the browser override `hsm.ff.providerOnboardingV2`. Nothing proved
   the build-flagged bundle on its own, and most fields had never been followed
   from the UI to PostgreSQL and back through a fresh login.
2. No browser test covered a stale second tab, a lost response, or a lost
   session.

## Defect found and repaired

**A task waiting on platform approval lost its form while it was still the
provider's to edit.**

Choosing a specialty and a year of experience leaves only the platform's
approval outstanding, so the server reports `SERVICES_EXPERIENCE` as `WAITING`
as soon as the year is acknowledged. `OnboardingTaskScreen` drew a task body
only for an actionable or `COMPLETE` task, so the experience form disappeared
under the provider at that moment:

- the transport choices on the same screen could not be reached at all;
- after a reload, none of the saved specialties, years or transport were shown.

The all-field journey reproduced it on its first run. The repair is one rule in
`OnboardingTaskScreen`: a `WAITING` task also draws its body while the draft is
`editable`. The waiting explanation is still shown above the form. A submitted
application (`WAITING` with `editable: false`) keeps its explanation-only
screen. No server status, policy or contract changed.

Two unit tests in `OnboardingTaskScreen.test.tsx` pin both halves.

## What was already sound

Proved, not changed:

- every step write is version-checked, and a stale write is refused with `409`
  without being stored;
- the autosave coordinator never reports "Saved" for an offline, failed,
  refused or conflicting write, and writes an offline edit exactly once on
  reconnect;
- a write whose response is lost is not applied twice;
- selecting a specialty grants nothing until an administrator approves it;
- the profile photo and portfolio photos are owner-bound ledger assets;
- submission locks the application and grants no work access.

## Scope and boundaries

- Mode A (integration and bug fix). The one UI change is the smallest that
  makes the real behaviour reachable; no layout, copy or style changed.
- No schema migration. No contract change. No API change.
- No feature-flag default changed. V2 remains default-off in a build that does
  not set `VITE_PROVIDER_ONBOARDING_V2`; the legacy wizard and its rollback
  path are untouched.
- R09 (geo matching) and R10 (working-hours policy) are not started.

## Feature flag

| Item               | Value                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------- |
| Name               | `VITE_PROVIDER_ONBOARDING_V2` (build time); browser override `hsm.ff.providerOnboardingV2`    |
| Default            | Off                                                                                           |
| Precedence         | Browser override, then build value, then off (`apps/web/src/lib/feature-flags.ts`)            |
| Tested here        | Build value `true`, override asserted absent. The flag-off path is covered by existing suites |
| Changed by this PR | Nothing                                                                                       |

## Tests

New: `apps/web/e2e/r08-provider-v2-all-field-authority.real-api.spec.ts`, 14
tests, wired into the "Phase 5 real-route and persistence evidence" job.

- Eight serial tests carry one provider through all six tasks. Each field is
  written in the UI, acknowledged by the real API, checked after leaving the
  task and returning, after a hard reload, and in PostgreSQL. Then a clean
  browser signs in through the real login and OTP and reads every field back,
  and the application is submitted.
- Six tests cover a stale second tab, offline, a lost response, session loss,
  account isolation, and Arabic/English input at and past the limits.

The lost-response test forwards the request to the real API, lets it commit, and
discards only the reply. The spec records no trace or video, because it places
real session cookies in the browser and those would be uploaded with the
evidence.

The full field-by-field result is in `FIELD_AUTHORITY_MATRIX.md`.

## Evidence

Local run on Windows 11, Node 24.21.0, pnpm 10.32.1, throwaway PostgreSQL 16,
Redis 7 and Mailpit containers; API and web built from this branch.

| Check                                                                            | Result                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------ |
| `r08-provider-v2-all-field-authority.real-api.spec.ts`                           | 14 passed, three consecutive runs          |
| Existing V2 real-API browser suites (`v2-real-api`, `v2-persistence`, `repairs`) | 34 passed                                  |
| R05, R06 and R07 real-API browser suites, run together with R08                  | 19 passed (including the 14 above)         |
| Web unit suite (`test:ci`)                                                       | 180 files, 2253 passed                     |
| Web `lint` / `typecheck` / `typecheck:e2e` / build with the flag                 | PASS (34 pre-existing lint warnings)       |
| Governance scripts (`production-governance`, `release-baseline`, inventory)      | PASS                                       |
| API suites                                                                       | Not run: no API, schema or contract change |

The first run of the R08 spec failed at the transport step, which is how the
defect above was found; the unit tests and the repair followed, and the spec
has passed on every run since.

## Findings outside the R08 change

1. **The step write still accepts a free-text avatar URL.** `PATCH …/steps/IDENTITY`
   accepts `profileImageUrl` as text (restricted-media references are refused).
   V2 never sends it, but the legacy wizard does, so closing it would break the
   legacy rollback path. It should be closed when the legacy wizard is retired.
2. **The web client reads the conflict version from the wrong place.** The API
   returns `error.details.expectedVersion`; the autosave coordinator reads
   `details.expectedVersion` and so always records `-1`. Nothing displays that
   number, so there is no visible effect; the conflict itself is handled
   correctly.
3. **A finished or waiting task is not reachable from the hub row.** It is
   reachable by its link and from the review screen. Unchanged.
4. **Portfolio writes carry no draft version.** Ownership is enforced; two tabs
   editing the portfolio are last-write-wins per item. Unchanged.
5. A map click at the default zoom places the private starting point far from
   the chosen city. The value is stored exactly as chosen; whether it must lie
   inside the chosen market is a matching rule and belongs to R09.

## Rollout and rollback

- Web only. Reverting the PR restores the previous behaviour exactly.
- No migration, no deploy ordering, no flag change.
