# R37 — Hosted acceptance preflight; implementation blocked

## State and source identity

**Executable implementation: NOT_STARTED.** Current handoff states are
**INTEGRATION_PENDING / POLICY_BLOCKED / EXTERNAL_BLOCKED**. This documentation
does not assert functional SOURCE_VERIFIED, SANDBOX_ACCEPTED, HOSTED_ACCEPTED or
RELEASE_ACCEPTED.

- Observed documentation parent: `c9de08d07b12871db8801fb9662b14de83a2c391`.
- Observed source tree: `67136183b8a81de9773c2c6a3831441c320729c0`.
- Approved G3 frozen source/tree: absent.
- Final documentation commit/tree and remote run IDs: recorded in the PR after
  publication, avoiding a self-referential hash in this tree.
- Changed paths and writer boundary: [OWNERSHIP.md](OWNERSHIP.md).
- Executed checks and fingerprints: [preflight.json](evidence/preflight.json).

Mode A. The current G3 source manifest is BLOCKED, its publication is
NOT_PREPARED and its frozen identities are null. Wave 4 has no startable lane
or active R37 session assignment. The existing readiness command actually
returns exit 1: `FAIL R37 is not authorized to start`.

G3 integration PR #198 is merged at the inspection parent. Its Stripe runtime,
purchase surface, approved-refund composition and reconciliation foundation
must not be described as still absent. The merged implementation and earlier
CI results do not supply the independent financial acceptance and separate
verified publication required by G3. Its seven canonical evidence entries
remain NOT_RUN as acceptance records; this does not mean that no individual
component or CI test has ever run. G3's external runner scenarios remain unrun
in the inspected acceptance record.

## Read-first source and preserved authority

Inspected `CLAUDE.md`, `.claude/rules/ux-ui-design-policy.md`, all R15 evidence,
R16 payout policy, R18 blockers, the live-money gate, the current G3/Wave 4
records, and R23/R25/R26/R27/R28 evidence and actual implementation anchors.
Applicable ADRs include deployment topology, transactional outbox, restricted
media, verification policy, redacted preview, retention, work-access transitions
and the money/subscription ledger. Historical implementation inventories and
historical security alert counts are not current runtime proof.

Current inspected interfaces are `hsm.money.v1`, `hsm.finance-operations.v1`,
`hsm.reconciliation.v2` and realtime envelope `v: 1`. Contracts/database packages
are version `0.1.0`; Prisma/client are `6.12.0`. The latest financial foundation
migration inspected is `20261024120000_g3_financial_integration`. Their exact
source fingerprints are retained without changing any interface or migration.

Subscription revenue remains separate from provider earnings. R16/R18 holds,
live-rail defaults, immutable history, original operation identities, atomic
ledger/subscription transitions and post-commit outbox remain authoritative.
A plan purchase cannot grant identity verification or work access. A scanner
outage must never convert unscanned evidence into readable or approved evidence.

## Current capabilities and missing hosted evidence

Every R37 runtime observation below is **NOT RUN**. Existing anchors describe
reuse opportunities, not R37 test results.

| Requirement                                             | Existing source anchor                                                                                                                                                   | Observation and required hosted proof                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target authorization and source/image binding           | `infra/production/platform/topology.json`, `scripts/production/platform/validate-plan.cjs`                                                                               | CONFIGURATION_ONLY; account, host, release, test-target approval and effective service evidence are absent. Approve the exact target and three immutable image digests before traffic.                                                   |
| TLS, cookie, CSRF, CORS, CSP, media and role boundaries | `scripts/production/security-app/verify-boundaries.cjs`, `apps/web/e2e/r26-security.real-api.spec.ts`, `apps/api/test/integration/r26-authorization.integration.spec.ts` | Existing runner is explicitly isolated CI, with loopback origins and `hostedAcceptance: false`. Preserve it; a released R37 adapter must inspect actual hosted responses and current money/receipt routes.                               |
| Effective edge and least privilege                      | `infra/production/edge/edge-policy.json`, R28 platform inputs                                                                                                            | No applied TLS/edge, database grants, Redis ACLs, service identity or management-port boundary evidence exists in this plan. Declarations are not deployed configuration.                                                                |
| Load and recovery measurements                          | `scripts/perf/post-r18/profile-workloads.mjs`, `budgets.proposed.json`, `lib/stats.mjs` in the same directory                                                            | Existing warm closed-loop stages use 200 requests at concurrency 2/16/4. They provide no approved hosted request-rate ceiling or safety abort mechanism; pool, queue and worker observations remain required.                            |
| Two replicas, reconnects and slow readers               | `scripts/production/realtime/verify-replicas.cjs`, `apps/api/test/integration/r25-realtime-recovery.integration.spec.ts`                                                 | Existing isolated coverage includes 24 connections/120 events, session revocation, foreign-room denial and Redis-partition recovery. This is not a hosted budget. R28 currently declares one API replica.                                |
| Bounded dependency failures                             | R25 recovery tests, `infra/production/observability/RUNBOOK.md`, G3 lifecycle tests                                                                                      | Authorize one API replica, Redis, mail, scanner and provider-sandbox fault separately. Observe liveness independently from readiness/deep diagnostics, retries, backpressure and duplicate durable effects before/during/after recovery. |
| Real incident receipt and recovery                      | `scripts/production/observability/run-synthetic-alert.cjs`, `infra/production/observability/alertmanager/alertmanager.test.yml`, `docs/production-readiness/r23/SLO.md`  | Existing receivers are test destinations; responders/SLOs remain proposed. A named real responder, approved test destination, receipt and recovery evidence are missing.                                                                 |
| Current findings and final artifacts                    | `scripts/security/dependency-audit.cjs`, `scripts/security/secret-scan-tree.cjs`, `.github/workflows/codeql.yml`, `.github/workflows/ci.yml`                             | Current dependency audit is recorded separately. All-open repository alerts and deployed-image inventory remain independent requirements; CI's existing image scan excludes unfixed advisories.                                          |

The R27 proposal lists read/write p95 of 500/1000 ms, API error rate 0.5%,
readiness 15000 ms and cold/warm browser readiness 5500/3000 ms with 10%
regression. These are **not approved R37 thresholds**. The old note saying
none of the proposed budget file is enforced is stale: the current R27 workflow
enforces its original bundle/query ceilings. Preserve those ceilings while
seeking explicit hosted capacity and stop limits.

Current default, R26 and R27 Playwright configurations use Chromium. Resizing
Chromium is not Firefox/WebKit evidence. Confirm the supported browser matrix;
the later hosted run must cover the required real routes, private previews,
AR/EN, RTL/LTR, mobile and keyboard behavior using separate contexts and origins.
No screenshot was generated or inspected in this preflight.

## Concrete authorization record required before execution

The operator must supply a separately approved record with:

- Exact account, region, host/resource IDs, HTTPS origins, allowed ports and
  endpoints, isolated synthetic users/receipts and DB/Redis/storage/queue scope.
- Full source/tree and API/web/migrator image digests, deployed configuration
  fingerprint without secrets, and evidence that the deployed target matches.
- Named operator and approver, approval reference, start/end time with timezone,
  allowed requests/second, connections, total requests/bytes and test duration.
- Each permitted fault target, maximum duration, recovery action, CPU/memory,
  error/latency, pool, lag and queue stop thresholds, and an immediate stop owner.
- Actual on-call test destination, named responder, approved synthetic incident,
  runbook references, and permitted alert count/volume.

Missing, expired, mismatched, wildcard or third-party targets must fail closed.
Redirects and external provider destinations need explicit scope; authorization
for the application is not authorization to load-test its payment provider.
Slow clients, duplicate authentic sandbox webhooks and reconnect bursts need
their own bounded allowance. No limits or operator identity are invented here.

After G3 publication and exact assignment, implement only the manifest's ten
script/test files and approved three infrastructure files. Negative tests must
cover absent/expired authority, origin/account/source mismatch, unsafe redirects,
budget exhaustion, cancellation, recovery and evidence tampering. Hosted results
must retain declared sample sizes, rate/concurrency, before/after observations,
abort reasons and source-bound artifacts. Synthetic transport doubles and local
emulators cannot produce HOSTED_ACCEPTED. Re-run affected probes on the final
integrated release SHA; report runtime defects to their actual owning lane.
