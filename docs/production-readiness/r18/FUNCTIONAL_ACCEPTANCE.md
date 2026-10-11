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

The original local browser run was memory-blocked. The repair workspace has
no Docker runtime, so the full journey is verified in hosted CI. Local
checks use the pinned Node 24.21.0 and pnpm 10.32.1 toolchain. Current-head
check results and the source-bound seven-case summary are recorded on
[PR #153](https://github.com/baraabd/homeservicemarketplace/pull/153).

## Hosted failures and focused repairs

- Run `38086513475` (`6696e0c`) passed 2 cases, failed 1 and skipped 4:
  withdrawn offers were still returned beside their replacement. The
  seeker-facing repository now lists active `PENDING`/`ACCEPTED` offers.
- Run `38088576770` (`a33de28`) passed 3, failed 1 and skipped 3: the chat
  overlay closed on reload. The journey now reopens the persisted
  conversation through `/home/messages` and waits for the real messages GET.
- Run `38090023789` (`daf005c`) passed 5, failed 1 and skipped 1: the booking
  details overlay likewise closed on reload, so the rating locator was not
  mounted. The repair reopens the completed booking after reload and fresh
  login, and checks the real booking/review responses and persisted rating.
- The final notification check now expects the two successful bids to create
  two `BID_RECEIVED` notices, while each booking transition remains exactly
  once. Same-browser account switching waits for successful empty
  server-owned lists before asserting that the previous user's UI is absent.
- Run `38126279520` (`d8d4007`) passed 5, failed 1 and skipped 1. The repaired
  persisted-review and fresh-login assertions passed; the final provider
  notification map omitted a legitimate `REQUEST_AVAILABLE` notice. Provider
  approval now precedes publication of the category selected from the real
  UI catalog response. The test waits for durable availability delivery
  before bidding, because the worker rechecks live eligibility and excludes
  providers who already bid. Availability is checked exactly once for this
  request and never for the outsider, separately from strict bid/booking
  maps; announcements for other requests cannot contaminate this assertion.

These historical runs remain failures. They do not certify the repaired
head; the seven-case counter, R18 aggregate and every required CI job must
pass on that head. No retry, skip, interception or acceptance-count reduction
was added.

## Not covered by R18 and why

| Item                                                           | Reason                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Messages across two API instances in the R18 flow              | covered by R17-A on the same SHA; not repeated                                                                                 |
| Disputes in the R18 flow                                       | covered by R17-C (CI pilot cohort); production intake is POLICY_BLOCKED (D-3)                                                  |
| Provider onboarding → admin approval → work access in one flow | covered by R08–R10 and the admin review job; the R18 flow applies the approval outcome in the database, as R07, R11 and R12 do |
| Redis, worker, API restart; storage timeout; scanner outage    | partially covered (R17-B replica restart, evidence-retention job); the full matrix needs a hosted target                       |
| Arabic/RTL at 320–1440 px                                      | covered per surface by the Phase 5 visual gate and R12/R17-B Arabic runs; the R18 flow runs in English at 390 px               |

## Status

`R18_FUNCTIONAL_ACCEPTED` is **not** claimed. PR #152 is merged as `ab7e473`
and integrated. D-2, D-3, D-8, D-13 and D-19 remain owner decisions. The R18
journey is a separate current-head CI gate; a green result does not approve
these policies or establish hosted production readiness.
