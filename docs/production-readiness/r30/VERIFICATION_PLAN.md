# R30 — verification plan and evidence boundaries

This plan applies to the implemented candidate after verified G2 publication.
Results belong in `ACCEPTANCE.md`; a test listed here is not an executed pass.
The final draft PR identifies the published commit/tree and remote checks.

## Required boundaries

| Boundary             | Required evidence                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Source/ownership     | Exact branch/base/tree, finite writer map, unchanged peer records, no unmerged peer imports.                                  |
| Toolchain            | Node 24.21.0, pnpm 10.32.1, Prisma 6.12.0; frozen lockfile, guarded generation and builds.                                    |
| Database             | Fresh isolated migrations, immutable triggers/checks and actual transaction rollback.                                         |
| Configuration        | Missing/disabled/expired/threshold/scale handling, pinned version, unconditional LIVE rejection.                              |
| Upload/scan          | Actual owner-bound bytes, size/type/hash, immutable retries/replacement, real clean scan and EICAR quarantine.                |
| Private read         | Uniform foreign/missing response, fresh revoked authority, digest/state rechecks, private cache headers and attributed audit. |
| Isolation            | Public denial before storage; identity scan/cleanup/retention exclusion; database attachment guards.                          |
| Review               | Actual current inspection, optimistic version, no self-review, independent permitted settlement recorder.                     |
| Concurrency          | Duplicate deposit, parallel approval, approved-byte reuse and two-obligation fingerprint races.                               |
| Atomicity            | One R24 confirmation/claim/ledger effect; activation failure rollback and durable duplicate-free recovery.                    |
| Recovery             | Permanent authority failure halts; original reviewer retry; bounded failures; stale-scan fairness.                            |
| Refund               | Stable key/full binding, UNKNOWN after dispatch and independent exact terminal observation.                                   |
| Rate limit           | Real Redis Lua and 30/hour upload limit returning 429/Retry-After; namespace isolation without flush.                         |
| Browser              | Real OTP/HTTP, PNG then PDF replacement, independent settlement/review, keyboard decision, history and outsider denial.       |
| Layout/accessibility | EN/AR RTL at 320/390/430/768/1024/1440, focus/keyboard, scoped Axe and 200% content enlargement.                              |
| Regression           | Lint, TypeScript, builds, full hermetic suites, affected boundaries, governance and migration index.                          |
| Publication          | Dependency audit, final tree secret scan, normal hooks, exact uploaded tree, final-head workflows and official CodeQL.        |

Layout and scoped accessibility assertions are not a certification. Default API
suites intentionally gate actual service tests; always report those skips
separately. A skipped service boundary never counts as a pass.

## Reproduction

Use the declared exact Node/pnpm versions and normal hooks from repository root.
Load only the task-private service environment; never print/commit credentials
or reuse another session's database or browser profile.

```bash
pnpm install --frozen-lockfile
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/database build
pnpm --filter @homeservicemarketplace/contracts build
pnpm --filter @homeservicemarketplace/api lint
pnpm --filter @homeservicemarketplace/api typecheck
pnpm --filter @homeservicemarketplace/api build
pnpm --filter @homeservicemarketplace/web lint
pnpm --filter @homeservicemarketplace/web exec tsc --noEmit
pnpm --filter @homeservicemarketplace/web build
node --test .github/scripts/*.test.mjs
node .github/scripts/g2-record.mjs --check
node .github/scripts/g2-record.mjs --ready R30
pnpm security:audit
pnpm security:audit:prod
```

The required real service command must execute all sixteen cases with no
failures, skips or todo tests:

```bash
RUN_DB_INTEGRATION=1 RUN_R30_INTEGRATION=1 pnpm --filter @homeservicemarketplace/api exec jest --runInBand --runTestsByPath test/integration/r30-manual-payments.integration.spec.ts --json --outputFile=r30-manual-service-ci.json
```

The browser harness owns fixture startup, private session handoff, dedicated
Vite, independent Chromium contexts and cleanup:

```bash
RUN_DB_INTEGRATION=1 RUN_R30_INTEGRATION=1 RUN_R30_BROWSER=1 pnpm --filter @homeservicemarketplace/api exec jest --runInBand --runTestsByPath test/e2e/r30-browser-runtime.e2e.spec.ts --json --outputFile=r30-manual-browser-ci.json
```

Require exactly one passed Jest harness test and exactly two expected
Playwright cases, with zero unexpected/skipped/flaky cases and no retries.
The required CI job enforces these counts and sixteen service cases. General
browser suites exclude this separately required fixture directory.

## Provenance and remaining limits

The local fixture uses PostgreSQL 16.15, Redis 7.4.7, ClamAV 1.5.3 with official
signatures, private restricted disk storage and pinned Playwright 1.62.1
Chromium revision 1234. Its database login is a non-superuser; CREATEDB exists
only for disposable databases in this task's isolated cluster. The resolved
allocation and fingerprint are recorded in `OWNERSHIP.md` and the manifest.

Browser distributions were copied from matching local binaries after a failed
CDN download; all 591 files and engine version were checked. This is not fresh
download authentication. CI installs its own pinned browser. Never publish
storage state, cookies, receipt bytes, environment files, traces or video.

R31 activation and R32 eligibility are explicitly labelled fixture contract
components. They prove the frozen transaction seam and rollback, not production
entitlement/refund policy. Local bytes/storage/scanner results do not establish
hosted finance IAM/KMS, legal holds, erasure, backup/replica deletion, actual
merchant settlement or live approval. Closure owners remain in `RISKS.md`.
