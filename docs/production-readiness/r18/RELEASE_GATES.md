# R18 — Release gates

Recorded on 2026-10-11 against `develop@ffe9a398c777a892ba1227989a84c2a60fe8a041`
(PR #154 merged). This file replaces the single "GO" precondition that the
deployment runbook used to put in front of every rollout.

## Why this file exists

`DEPLOYMENT_RUNBOOK.md` required `GO_NO_GO.md` to say GO for a SHA before
any rollout, staging included. GO in turn requires hosted staging acceptance,
an executed backup restore, a rollback rehearsal and a live alert test, and
each of those needs a staging deployment first. Nothing could ever start.
The launcher itself never checked GO (`infra/production/staging.cjs` gates on
the operator confirmation `projectName@sourceSha` and the two approved
origins only), so the circle was in the documents, not the code.

The fix is four separate gates. Each one authorizes exactly one further step
and nothing beyond it.

## Gates

| Gate                           | Authorizes                                                                                                         | Requires                                                                                                                                                                                                                                                                                                                                                                                                    | Does not authorize                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **A. Candidate eligible**      | building the RC images once, pushing them to the approved registry, and launching them on the named staging target | owner-approved `RELEASE_SCOPE.md`; a merged source SHA on `develop`; every required check green on that SHA (`BRANCH_PROTECTION_EVIDENCE.md`); no open CRITICAL code-scanning alert and an owner disposition for each open HIGH; migration and configuration plan (`DATABASE_RELEASE_EVIDENCE.md`, `PRODUCTION_INITIALIZATION.md`); explicit owner authorization naming the registry and the staging target | public production traffic, DNS changes, live money, any payment |
| **B. Hosted staging accepted** | treating that exact digest set as the production candidate                                                         | the gate-A digests running on staging (confirmed by `/health/live` `sourceSha` and `/build-info.json`); `HOSTED_STAGING_ACCEPTANCE.md` executed and passed: real browser journeys, security checks, worker/scanner/outbox delivery, measured performance against owner-agreed thresholds, backup restore with measured RTO/RPO, rollback rehearsal, an alert fired, delivered and recovered                 | production deployment                                           |
| **C. Ready for production**    | asking the owner for production approval                                                                           | gate B; every P1 in `GO_NO_GO.md` closed or explicitly accepted by the owner; `RELEASE_MANIFEST.json` complete with the gate-B digests; a production rollout package (target, digests, configuration, migration plan, backup and rollback identifiers, smoke checks, monitoring thresholds, stop conditions)                                                                                                | executing the rollout                                           |
| **D. Production live**         | —                                                                                                                  | gate C; the owner's explicit `PRODUCTION_RELEASE_APPROVED=true` for that package; the rollout executed as written; readiness and post-deployment smoke passed; monitoring active                                                                                                                                                                                                                            | live money (separate R16 policy)                                |

Rules that apply to every gate:

- Build once. Every later gate uses the gate-A digests. A rebuilt image is a
  new candidate and starts again at gate A.
- A gate is passed by executed evidence on the named SHA and digests, never
  by a prepared workflow, a runbook or an earlier green SHA.
- The workers and scanner run inside the API image (`STAGING.md`), so their
  delivery can only be checked after the first launch of that image. Gate A
  does not require it; gate B does.
- Live payment capture, refunds, escrow, payouts and withdrawals stay
  disabled at every gate (`r16/PAYOUT_POLICY.md`).

## Where each gate stands on 2026-10-11

| Gate | State       | Missing                                                                                                                                                                                                                  |
| ---- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A    | **not met** | owner approval of the release scope; owner dispositions for CodeQL #2 (high) and the three medium alerts; the release-blocking decisions in `OWNER_DECISIONS.md`; a named registry and staging target with authorization |
| B    | not started | needs gate A and a hosted target (`HOSTED_ENVIRONMENT_BLOCKED`: the GitHub `staging` environment has no secrets, variables or protection rules)                                                                          |
| C    | not started | needs gate B                                                                                                                                                                                                             |
| D    | not started | needs gate C and `PRODUCTION_RELEASE_APPROVED`                                                                                                                                                                           |
