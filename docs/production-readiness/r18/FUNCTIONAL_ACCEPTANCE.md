# R18 — Functional acceptance

## Baseline (Gate 0 and Gate 1)

| Fact               | Value                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR #149 final head | `f2ff33658e4319d2089af8e86003b8e71350f4dd`                                                                                                                            |
| PR #149 merge      | `fabeb0765689131025208f8dca2e7a4fae924118`, merged by the owner 2026-10-10T18:35:46Z, merge commit with parents `a2acf38` (develop after #151) and `f2ff336`          |
| Ancestry           | `git merge-base --is-ancestor fabeb07 origin/develop` → true                                                                                                          |
| R18_BASE_SHA       | `fabeb0765689131025208f8dca2e7a4fae924118`                                                                                                                            |
| Contains           | R17-A `#142`, R17-B `#143`, PLATFORM-TX-1 `#144`, R17-C `#145`, R17-D `#146`, R17-E `#147`, R17-E closure `#148`, E-18 `#149`, `#150` (`31d73a0`), `#151` (`a2acf38`) |

Post-merge push runs on `fabeb07`, all `completed` / `success`, attempt 1:

| Workflow                            | Run         |
| ----------------------------------- | ----------- |
| CI (17 jobs)                        | 38076416877 |
| CodeQL                              | 38076416622 |
| Production governance               | 38076416574 |
| Web development startup             | 38076416540 |
| Authentication lifecycle acceptance | 38076416558 |
| Staging release boundary            | 38076416599 |

26 check runs on the commit; all success.

## Executed on `fabeb07` (hosted CI, disposable services)

| Suite                                                 | Executed                                                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration (real PostgreSQL / Redis)                 | 295 suites passed, 9 skipped; 5584 tests passed, 38 skipped (the skipped suites are the browser- and scanner-gated ones that run in the DW and evidence-retention jobs) |
| Browser E2E (Playwright / Chromium)                   | 836 passed, 328 skipped (mobile/desktop project splits; pre-existing), plus 6 passed                                                                                    |
| Phase 5 onboarding real-route                         | 26 + 8                                                                                                                                                                  |
| R05 profile and addresses                             | 12                                                                                                                                                                      |
| R06 request media                                     | 2                                                                                                                                                                       |
| R07 request–provider lifecycle                        | 1                                                                                                                                                                       |
| R08 / R09 / R10 provider onboarding, work area, hours | 14 / 18 / 17                                                                                                                                                            |
| R11 reviews                                           | 5                                                                                                                                                                       |
| R12 booking communication                             | 5                                                                                                                                                                       |
| R13 support                                           | 3                                                                                                                                                                       |
| R14 budget authority                                  | 3                                                                                                                                                                       |
| R17-A messaging across two API instances              | 4                                                                                                                                                                       |
| R17-B notifications across replicas and a socket      | 5                                                                                                                                                                       |
| PLATFORM-TX-1                                         | 1                                                                                                                                                                       |
| R17-C disputes (fail-closed)                          | 23                                                                                                                                                                      |
| R17-D admin operations (fail-closed)                  | 14                                                                                                                                                                      |
| R17-E provider surfaces (fail-closed)                 | 44                                                                                                                                                                      |
| E-18 My Bids (fail-closed)                            | 7                                                                                                                                                                       |

No Playwright step reported a skip, flake or failure.

## R18 additions (this PR)

- `apps/web/e2e/r18-functional-completion.real-api.spec.ts`: the primary
  journey as one serial flow of 7 tests in independent seeker, provider and
  outsider browser contexts. Steps: UI request; outsider outside the area
  sees nothing (feed omits, detail 404); HTTP bid, duplicate 409, withdrawal,
  second withdrawal 409; replacement bid in the UI; UI accept; retried accept
  409; exactly one booking (DB); BID_ACCEPTED and BOOKING_CREATED once each;
  messaging both ways with DB rows; provider start and complete in the UI with
  3 booking events; one review (double click), reputation count 1 and average
  5; fresh contexts and logins keep everything; sign-out; another seeker sees
  none of it; foreign request, booking, bids, accept and conversation refused
  without a leak; anonymous 401.
- CI: the step runs in the Phase 5 real-route job against that job's API,
  PostgreSQL and Redis. `scripts/ci/assert-playwright-run.cjs` fails it unless
  exactly 7 passed with no skip, flake or failure, and writes a counts-only
  summary bound to the head SHA. The new `R18 functional completion
acceptance` job needs every CI job and re-checks that summary; `CI gate`
  needs it.

Local execution: NOT RUN (host with about 0.7 GB free memory; earlier
attempts to run the API, a preview server and Chromium together were stopped
by the harness). The hosted run on this PR is the evidence; the result is
recorded in the PR once it has run.

## Not covered by R18 and why

| Item                                                           | Reason                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Messages across two API instances in the R18 flow              | covered by R17-A on the same SHA; not repeated                                                                                 |
| Disputes in the R18 flow                                       | covered by R17-C (CI pilot cohort); production intake is POLICY_BLOCKED (D-3)                                                  |
| Provider onboarding → admin approval → work access in one flow | covered by R08–R10 and the admin review job; the R18 flow applies the approval outcome in the database, as R07, R11 and R12 do |
| Redis, worker, API restart; storage timeout; scanner outage    | partially covered (R17-B replica restart, evidence-retention job); the full matrix needs a hosted target                       |
| Arabic/RTL at 320–1440 px                                      | covered per surface by the Phase 5 visual gate and R12/R17-B Arabic runs; the R18 flow runs in English at 390 px               |

## Status

`R18_FUNCTIONAL_ACCEPTED` is **not** claimed. Open: #152 (P1 truth fix),
D-2, D-3, D-8, D-13, D-19 (owner decisions), and the R18 journey's first hosted run.
