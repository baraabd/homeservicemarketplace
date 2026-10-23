# R32 — Verification and acceptance boundaries

## Verdict

The R32 implementation and local source checks are verified. Real PostgreSQL,
Redis and authenticated HTTP tests pass using explicitly synthetic payment and
policy components. This is SOURCE_VERIFIED component integration evidence.
It is not SANDBOX_ACCEPTED, HOSTED_ACCEPTED or RELEASE_ACCEPTED. The PR remains
Draft pending assembled Wave 3 adapters, approved commercial/entitlement policy
and integrated gate evidence. R16/R18/live-money restrictions remain unchanged.

This record captures local verification before final PR checks. Final remote
results must be read on the exact PR head; the PR body records that full SHA
and links to current Actions. No result from G2 is treated as an R32 test.

## Source provenance

| Identity                            | Exact value                                                               |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Frozen G2 source / initial checkout | `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`                                |
| Frozen source tree                  | `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`                                |
| Owner-merged publication / PR base  | `986b4707776711e80564f0642133ede90ba16f3c`                                |
| Publication tree                    | `7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`                                |
| Published implementation source     | `a8957930b9eb297f0f5dfc69f01f0077714344df`                                |
| Normal-hook local source commit     | `4d08d2083a502eb5e7a3c1b5e6bfe5be386cf5ed`                                |
| Identical implementation tree       | `e29ea9d31cf78b95e4c54a29e28f08980660ac64`                                |
| Branch                              | `feat/r32-refund-recovery`                                                |
| Source contract / schema            | `hsm.money.v1`; existing 72 migrations; no version/schema/lockfile change |

The coordinator's R32-G2-02 fast-forward preserved all 39 checkpointed working
files byte-for-byte. Its 13 intervening changes are accepted records only.
The final SHA cannot be embedded in its own commit. The PR's machine-validated
`Final SHA` identifies the submitted commit, and the Production governance
`production-governance-source` artifact contains `head-sha.txt`, `tree-sha.txt`,
`pr-base-sha.txt`, the complete tracked tree and deterministic source archive.
Review that artifact and the exact-head checks together. A subsequent source
change requires new relevant checks; updating a PR description is not evidence.

## Environment fingerprint (no credentials)

| Component                        | Observed configuration                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node / pnpm                      | 24.21.0 / 10.32.1, task-local PATH; hooks enabled                                                                                                                            |
| Prisma                           | 6.12.0; generated against the unchanged schema                                                                                                                               |
| PostgreSQL                       | 16.14, separate cluster, loopback port 5532, task-only CREATEDB role                                                                                                         |
| Redis                            | 7.4.7, separate authenticated instance, loopback port 6432                                                                                                                   |
| Real API fixtures                | Unique disposable databases, random users/keys, temporary private/public/staging roots, real auth/CSRF/guards                                                                |
| Worker configuration in fixtures | OUTBOX_WORKER_ENABLED=false; real R22 runOnce and domain recovery invoked explicitly                                                                                         |
| Ports replaced in tests          | Configuration, collection, activation, refund transport and consequence are labeled components; refund policy delegates to the real evaluator with explicit synthetic source |
| Money                            | Synthetic XTS; no real rail/account/price/refund policy or live funds                                                                                                        |
| UI / screenshots                 | No UI changed; R32-specific visual/AR/EN/RTL/mobile/keyboard screenshots are not applicable                                                                                  |

Secrets remain in an external mode-600 environment file. No `.env`, session,
cookie, access token, restricted evidence, database dump or provider payload is
committed. No shared service, volume or Redis flush is used.

## Executed local verification

Commands run from the repository root with the pinned task-local PATH. Scoped
real-service commands source the private runtime environment without printing
it. Counts below are separate executions and must not be added as unique tests.

| Command/check                                                                       | Result                                                                                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                    | Exit 0; preinstall/runtime/Husky/contracts hooks ran; lockfile unchanged                                                    |
| Database `generate`, `migrate:deploy`; API `build:deps`                             | Exit 0; all 72 migrations applied to the isolated database                                                                  |
| API `lint`                                                                          | Exit 0; entire `src/**/*.ts` scope                                                                                          |
| API `exec tsc --noEmit --incremental false`                                         | Exit 0                                                                                                                      |
| Seven targeted core/policy/orchestrator/consumer/composition Jest suites            | 160 passed, 0 failed/skipped                                                                                                |
| Recovery service/controller Jest suites                                             | 66 passed, 0 failed/skipped                                                                                                 |
| `node --test scripts/production/refund-recovery/inspect.test.cjs`                   | 52 passed, 0 failed/skipped; includes real loopback HTTP and redirect refusal                                               |
| Full hermetic API Jest suite, normal parallel workers, reusable-verify CI stubs     | 273 suites / 5,038 tests passed; 0 failed; 94 gated suites / 1,805 tests skipped as configured by the existing unit profile |
| Real R24 + R32 combined regression below                                            | 2 suites / 81 tests passed; 0 failed/skipped (R24 56, R32 25)                                                               |
| R32 prior standalone and repeated runs                                              | 25/25 in each; no failure/skip in the repeated final source                                                                 |
| `node --test .github/scripts/*.test.mjs`                                            | 480 passed, 0 failed/skipped                                                                                                |
| G2 ready/check, sprint registry, production governance, release baseline validators | Exit 0; peer lanes remain held; no gate weakened                                                                            |
| `pnpm security:audit`                                                               | Exit 0; zero info/low/moderate/high/critical findings                                                                       |
| `pnpm security:audit:test`                                                          | 39 passed, 0 failed/skipped                                                                                                 |
| `node --test scripts/security/secret-scan-tree.test.cjs`                            | 7 passed, 0 failed/skipped                                                                                                  |

Additional completed checks: package-level API `typecheck` and `build`, including
their normal dependency builds, both exited 0. Production dependency audit
exited 0 for 553 dependencies; all five severity counts are zero. The full audit
covers 1,319 dependencies, also with zero findings. Changed source/test/CLI lint,
37-file formatting and diff-whitespace checks passed. The normal Husky and
lint-staged commit hooks completed successfully, including ESLint and Prettier.
The exact committed implementation tree then passed the pinned Gitleaks scan
documented below.

All applicable remote workflows, full service-enabled API regression,
browser/container scans and official CodeQL remain mandatory on the submitted
SHA; local profile skips are not represented as passes.

```bash
pnpm --filter @homeservicemarketplace/api exec jest --runInBand \
  --runTestsByPath \
  test/integration/r24-money-api.integration.spec.ts \
  test/integration/r32-refund-recovery.integration.spec.ts \
  --json --outputFile=/tmp/hsm-r32-r24-regression-final-results.json
```

The scoped command uses real PostgreSQL/Redis. Its in-test concurrent
reservations/workers remain concurrent. Full hermetic and remote full-service
runs keep the repository's normal worker configuration.

## Behavioral coverage and evidence

| Requirement                                                                           | Evidence                                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong owner/currency/unpaid or invalid obligation, policy source and actor separation | 64 eligibility units, existing R24 real HTTP negative suite, R32 real policy/source/permission/window/full-only cases                                       |
| Over-refund and concurrent partial reservations                                       | Real payment row locks, simultaneous requests, reserved totals and pending/unknown capacity assertions                                                      |
| Crash before/after dispatch; response loss; unchanged outbound key                    | Actual R22 processed event with lost afterCommit, scanner restart discovery, expired claim, successful response-loss component and query-only retry         |
| New reviewer authority survives lost callbacks                                        | Revoke reviewer A; accept reviewer B QUERY/DISPATCH; suppress both callbacks; scanner uses durable B command and original provider key                      |
| Duplicate/out-of-order results                                                        | Concurrent workers, late PENDING after authoritative success, conflicting terminal result rejection and one compensation                                    |
| Audit/outbox/consequence rollback                                                     | Inject failures at request, reservation, outbox, consequence and final audit; assert no partial local success and retained proof                            |
| Original posting reversal                                                             | Real LedgerService.reverse before submit and after retained success proof; no extra compensation, held reservation and one audited reconciliation exception |
| Expiry policy                                                                         | Expired dispatch claim is queried; reservation remains held; no TTL release/cancel behavior                                                                 |
| Operator controls                                                                     | Real authenticated HTTP scope, CSRF, explicit approval, revision, dry-run/idempotency; protected-file CLI, redirect and response-loss tests                 |
| Network outside locks                                                                 | Adapter callback independently acquires confirmation/refund locks with NOWAIT in another transaction                                                        |

Local result artifact hashes (SHA-256; filenames identify the captured session
artifacts, not public URLs):

| Artifact                                    | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `hsm-r32-r24-regression-final-results.json` | `c0f54d402fa39f1eced0495bf3ad754df91c146fba00fb8e4ccf5f8bd3ccb16e` |
| `hsm-r32-api-unit-final-results.json`       | `e0d448662e1ea6d66e6dfd5a24f286c2d02ff0a9790c101d730ac86269d4c4fb` |
| `hsm-r32-units-results.json`                | `3280d2a2340e3feb0da22271e1b641566a32da0cc81251eae8634ae07b22ea8a` |

The corresponding logs are `hsm-r32-r24-regression-final.log`,
`hsm-r32-api-unit-final.log` and `hsm-r32-units.log`; the full unit skip inventory
is `hsm-r32-api-unit-final-skips.json`. CI discovers the R32 integration spec
through its existing Jest roots and records it in `g1-api-report.json` inside
the `g1-worker-process-evidence` artifact. No CI selection/filter was weakened.

## Publication and committed-tree secret scan

Authenticated Git Data publication reproduced the complete implementation tree
`e29ea9d31cf78b95e4c54a29e28f08980660ac64` exactly. The published source commit
`a8957930b9eb297f0f5dfc69f01f0077714344df` has the already owner-merged G2
publication as its only parent. The normal-hook local source commit above has
the same tree and parent; GitHub publication supplies distinct commit metadata.
The subsequent evidence-only commit records these immutable identities. It
does not change runtime source, tests, contracts, dependencies or schema.

Gitleaks 8.24.3 scanned the exact normal-hook implementation commit: 2,689
tracked files / 23,953,233 bytes, exit 0, no leaks. The binary SHA-256 is
`e18325d568268b6efb6cd0cc721f8bea5667f4cd1c8d03618ab61987f41269ad`.

```bash
node scripts/security/secret-scan-tree.cjs \
  --gitleaks /tmp/hsm-pr183-gitleaks/gitleaks \
  --commit 4d08d2083a502eb5e7a3c1b5e6bfe5be386cf5ed \
  --work-dir /tmp/hsm-r32-source-scanned-tree \
  --report /tmp/hsm-r32-source-tree.sarif
```

The captured report/log are `hsm-r32-source-tree.sarif` and
`hsm-r32-secret-source.log`. The complete final PR tree must also pass the
unchanged remote secret scan and official CodeQL. The exact final commit,
complete tree, workflow runs and artifact IDs are bound in the PR body and its
Production governance artifact; this source record does not predict their
results. The PR remains Draft for the stated integration and policy blockers.

## Failures found and corrected

The first real R32 run had 17 passes and three failures: injected audit/outbox
errors leaked private exception messages. The command boundary now preserves
typed business errors and redacts unexpected failures. A previous R24 rollback
assertion expected that private message; it now requires the safe typed error
and explicitly asserts the sentinel is absent, retaining all financial
rollback assertions. Final combined real regression is 81/81.

Independent review found stale reviewer selection after callback loss,
proof-unaware inspection and execution after an original posting reversal.
All three were corrected and covered by real PostgreSQL tests. An old unit
permission-call assertion was updated from two to four because each request
and delivery independently reauthorizes; authorization checks were strengthened.

The first full hermetic run omitted CI's required environment stubs, causing
three module-load failures. With the exact existing CI stub values, normal
parallel execution passed all 5,038 active tests. Restricted sandbox subprocess
attempts also produced EPERM for governance/secret-scan harnesses; the same
unchanged tests passed in the authorized environment. No assertion, worker
count, security budget, global timeout or required check was relaxed.

Existing warnings: ts-jest's isolatedModules deprecation; frozen-install
blocked optional build scripts for @parcel/watcher and unrs-resolver. No runtime,
package manager or lockfile was upgraded to hide them.

## First PR performance failure and bounded correction

On initial PR head `19cf2f660d24dbe502810d0a95b53be1c8f1f576`, R27 run
`39942195745` / aggregate job `120382164330` passed 51 original budget checks
and failed provider-bids page-size invariance. Candidate artifact `12496404956`
recorded 11 statements for five items and 13 for twenty. The eleven endpoint
statements were identical; the two extras were `SELECT EmailDelivery x1` and
`WITH EmailDelivery x1`. The candidate's ordinary base/amplified dataset counts
were 11/11, as were repair-baseline artifact `12496529955`'s page-size counts.

Verified candidate ZIP SHA-256:
`583bc84ab0f8987f7728c63b1cd344b536d1d5ca817f9519f4ce2963ded7508b`.
Verified repair-baseline ZIP SHA-256:
`f23fab999dbad95c8428c7062b649c1f92460ebad48cfcc62578ddd5254bde7e`.

The database-wide capture included the R21 mail dispatcher's five-second retry
and queue-gauge queries. The R27 environment promised workers-off measurement
but omitted `MAIL_DISPATCHER_ENABLED`, whose application default is true.
The R32 refund scanner was already disabled; no MoneyDispatch query appeared.
Lease R32-CI-01 therefore adds only the existing mail-worker switch to the fixed
measurement environment plus a regression covering both profiles, inherited
environment and forbidden overrides. All three measurement sources use the
same harness. Production defaults, immediate post-commit SMTP/OTP delivery,
query capture/filtering and every original budget remain unchanged.

The new focused assertion first failed with actual `undefined` versus expected
`false`, then passed after the one-line environment correction. The full R27
library and acceptance scope passed 119 tests with no failures/skips. The final
combined command `node --test scripts/perf/post-r18/lib/*.test.mjs
.github/scripts/*.test.mjs` passed 588 tests with zero failures/skips; six
canonical validators, exact 39-file ownership, changed-file ESLint/Prettier and
diff checks also passed. Corrected-head remote evidence is recorded in the PR.
This correction adds two expressly leased paths,
bringing the actual PR scope to 39 files; refund application source is unchanged
from the published implementation source above. Initial-head green checks do
not certify the later corrective head.

## Acceptance still required

The coordinator must assemble approved R29/R30 adapters and the R31 confirmed
entitlement consequence against these frozen ports, supply retained approved
refund policy versions, and run integrated sandbox refund/recovery/accounting
tests at G3/R34. R33 owns the Admin UI. Hosted evidence and explicit owner
merge/deployment/live approvals remain separate. See RISKS.md and ROLLBACK.md.

## PR #187 integration repair — 2026-10-23

The owner requested repairs to the open PRs after merging R30 #184. Merge
`df19f39ae82e2e19c5e0debb59abd5c3899efe75` retained the R32 policy import and
export but replaced its providers with the now-unimported legacy fallback. This
broke both lint and real application boot. Restore the actual R32 evaluator and
its unavailable-by-default policy source alongside the R30 manual participants.
The existing composition tests assert both bindings and the absent policy.

R30 shared leases expired on its merged PR #184 (`aaa22a9a04025fc312cbcc2121687aca2e467cac`).
Preserve their full contents as completed leases and restore the retained R32
source assignment in the wave manifest and status narrative. No ownership
validator, acceptance gate, budget or runtime policy was relaxed.

Executed with Node 24.21.0 and pnpm 10.32.1: offline frozen install, Prisma
generation, API lint/typecheck/build, the two affected composition/command suites
(72 passed, zero failed/skipped), and all 480 governance tests (zero failed/skipped).
Local real-service reruns are blocked: this execution host exposes only UID 0
and cannot assign the unprivileged PostgreSQL runtime user. The corrected
branch is published for the mandatory GitHub real-service/browser checks;
those results must be read on its new head, not inferred from these local checks.
Prior policy, assembled-wave and release holds remain unchanged.

### Real R30 transport / R32 consequence boundary

Corrected-head job 120434873439 ran 16 real service cases: 15 passed and the
manual refund dispatch returned 503 instead of 202. R32 correctly requires a
configured confirmed-refund participant before first dispatch; the older R30
fixture supplied only activation and reservation-policy components. Add an
explicitly synthetic confirmed-refund participant that validates the retained
request/policy/amount and posted compensation in the same transaction, then
writes an inert marker. Production composition and its unavailable default
remain unchanged.

The same real service case now queries the authoritative manual proof through
R32, checks SUCCEEDED, linked compensation and one consequence marker, and
replays the query to prove no duplicate ledger or consequence effect. All 16
mandatory cases remain. Two exact R30 test files transfer to the serialized R32
repair lease with prior ownership retained. Local governance passes; the real
service result is pending the new GitHub head due to the local runtime limit.

## Post-R31 conflict repair and ordered integration — 2026-10-23

Mode A — integration and bug fix. The owner merged R31 #186 as
`c3c080cf28f142ed46495ec7e5d549937da90096`, then explicitly requested correction
of conflicts between #187 and #185. The submitted R32 merge
`2f3925fbe350ed514cbd404bacb37249c5f23aac` contained duplicate activation and
refund-policy providers, including undefined fallback classes. It also repeated
Wave 3 JSON keys and status rows, and retained expired R31 shared leases.

Keep exactly one R31 activation participant and one R32 refund eligibility
evaluator. The strengthened composition assertion rejects a second refund
policy binding; the existing R31 assertion rejects a second activation binding.
Retain all R30 transports and fail-closed policy/consequence defaults. Reconcile
the retained R30/R31/R32 assignments, remove duplicate records and preserve
the complete R31 leases as completed with their actual owner-merge identity.
The existing R32 serialized integration and coordinator scopes cover these edits.

Executed with Node 24.21.0 and pnpm 10.32.1: frozen offline installation,
database client generation, API lint, typecheck and build passed;
`pnpm --filter @homeservicemarketplace/api exec jest src/modules/money
src/app.module.spec.ts --runInBand` passed 33 suites / 520 tests, with zero
failures or skipped cases. `node --test .github/scripts/*.test.mjs` passed all
480 tests with zero failures/skips. Sprint-registry and G2 consistency checks
passed, and both coordination JSON documents have unique keys. Real database
and browser execution remains assigned to mandatory final-head GitHub CI;
this host has neither PostgreSQL nor an unprivileged UID mapping.

The requested integration order is #187, then #185. R33 will contain the exact
corrected R32 head as a merge parent, so a normal merge of #187 cannot reintroduce
the same content conflicts in #185. No merge to develop, force push, schema
change, policy approval, G3 acceptance or deployment is part of this repair.

### Follow-up: R31 real-authentication fixture setup

The first post-R31 repair CI run on `03e99da086cca4f4d7652062c331aee2f000775d`
passed 6,915 real-profile API tests but one inherited R31 authorization case
exceeded its unchanged five-second test limit. That case performed a complete
password/OTP login inside the assertion; the shared real-authentication fixture
honors the login rate limit and can wait for Retry-After. The R24 and R32 suites
already prepare these authenticated sessions in beforeAll.

Prepare the R31 unprivileged session alongside its owner and other-provider
sessions in the existing setup hook. Keep genuine HTTP login, OTP, cookies,
rate limiting, all 401/403/404 and policy assertions, and every existing timeout
unchanged. This is fixture setup separation, not a production-authentication
change or an automatic retry of a failing assertion. The user-requested
cross-PR integration repair covers this inherited R31 test. Fresh final-head
CI must verify it in both the R32 and combined R33 source.

The R31 harness also opts into the existing per-fixture rate-limit namespace
already used by R30. R24, R31 and R32 run concurrently against Redis database
12; without a namespace their independent loopback login attempts share an IP
bucket. The existing adapter prefixes only the bucket name and delegates to
the real RateLimitStore and Redis script with every limit/window unchanged.
This removes cross-suite interference without mocking authentication, changing
worker parallelism, flushing another suite's keys or widening a timeout.

### Review follow-up: preserve the first refund submission

The latest-head review identified that recovery advertised QUERY for a
NOT_DISPATCHED refund. A manual adapter query before submission can observe no
operation, persist UNKNOWN and strand the first submission behind the
query-only uncertainty fence. Two new recovery unit cases reproduce the bug
on `f8c8cb59c6615bc68121f891cc30e1ef7e4447b7` (dry-run and approved replay both
incorrectly accepted QUERY).

Recovery now advertises only DISPATCH for an untouched row. The command
boundary rejects direct QUERY before writing a command or outbox event, and
the delivery boundary also rejects an older query authorization before
claiming an untouched row. Rejection preserves the reservation, revision and
provider idempotency key. A later explicit DISPATCH remains available.
Existing PENDING/UNKNOWN rows remain query-only; no uncertain financial state
is reset and no reservation is automatically released.

The regressions cover rejected dry-run/live recovery, direct HTTP query,
internal query-only delivery, unchanged durable state and successful first
submission. The real R30 manual-adapter scenario verifies that a rejected
pre-submit query creates no manual operation, then continues through the
existing independent confirmation and exactly-once finalization assertions.
The later-reviewer QUERY recovery scenario now starts with a genuine timed-out
submission, preserving its callback-loss and fresh-authority coverage.

Local money/AppModule regression: 33 suites / 522 tests passed, zero failures
or skips, after both new unit cases failed on the preceding implementation.
API lint/typecheck/build and changed integration-fixture lint passed
before publication. Fresh R30 real-service and full PostgreSQL/Redis checks
must validate the changed integration cases on the new published head before
resolving the review thread. No timeout, authorization check, financial
assertion, provider identity or policy restriction is weakened.
