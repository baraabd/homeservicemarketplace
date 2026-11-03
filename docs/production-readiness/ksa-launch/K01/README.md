# K01 — Reproducible green release baseline

**Status: IMPLEMENTED, PR DRAFT, NOT MERGED.** Mode A (integration and
bug-fix). K01 is a launch work-breakdown item. It does not replace R19–R38,
G3 or G4, does not rebase any Wave 4 lane, and is not R34–R38 execution.

| Status axis        | State                                                                        |
| ------------------ | ---------------------------------------------------------------------------- |
| Implementation     | Complete for the scoped defects (below)                                      |
| Tests executed     | Local and hosted; counts in this file and [JOB_LEDGER.md](JOB_LEDGER.md)     |
| Acceptance         | Pending owner review. The deepmerge fork and R27 protocol change need review |
| Branch protection  | **Prepared, not applied** ([BRANCH_PROTECTION.md](BRANCH_PROTECTION.md))     |
| Merge / deployment | Not authorized; not performed                                                |

## Source identity

| Item                             | Value                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| Approved base (origin/develop)   | `92770ea65ee1154f94f4251d5febfa39822f9b9a`, tree `854a9146c05bf21ef62af060358f581ec4c19306` |
| Branch / PR                      | `release/ksa-k01-ci-baseline` / #210 (draft)                                                |
| Source candidate                 | Recorded in [JOB_LEDGER.md](JOB_LEDGER.md); the final head SHA is in the PR body            |
| Migration head                   | `20261024120000_g3_financial_integration` (74 migrations; unchanged)                        |
| Toolchain                        | Node 24.21.0, pnpm 10.32.1 (pins unchanged)                                                 |
| Schema / contracts / API / flags | No change                                                                                   |

The worktree was created from `origin/develop` and had no stashes of its own.
Repository stashes from other branches were left untouched. The user's
`fix/api-workspace-recovery` checkout was not modified.

## Issue-to-test matrix

| #   | Defect (reproduced)                                                                                       | Root cause                                                                                                                       | Change                                                                                                            | Test that exposes it / proves the fix                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Audit red: full low 1 / mod 7 / high 1; prod mod 1 / high 1; hosted `security-scan`, `R18`, `CI gate` red | Advisories in follow-redirects, qs, vite, minimatch, glob, deepmerge                                                             | Upstream updates, reviewed major overrides, @nestjs/cli 12, owned deepmerge fork ([details](DEPENDENCY_AUDIT.md)) | `pnpm security:audit` and `:prod` → zero; deepmerge regression 3/6 fail on upstream, 6/6 on the fork; fork-resolution graph test |
| 2   | BookingActions pending test: 2728/2729 in the full web run                                                | Assertion raced a 20 ms mock delay against `findByText` polling                                                                  | Response held by an explicitly released promise; error transition added                                           | Original with `delayResponse: 0` fails with the reported error; new file 14/14 in 5 consecutive runs; full suite 2730/2730       |
| 3   | Windows dev startup stalled on _Loading the page_ (run 41093704442)                                       | Locally: the dev server counted as ready while the optimizer held every `.vite/deps` request. The hosted cause is **not proven** | Readiness waits for a served pre-bundled module within a separate budget; failure diagnostics                     | Local Windows 0/3 → 6/6; hosted Windows and Linux 6/6 ([details](WINDOWS_STARTUP.md))                                            |
| 4   | No executable inventory of real services and gated suites                                                 | Undocumented                                                                                                                     | `scripts/ci/environment-inventory.{json,cjs}` run by Production governance                                        | 7 drift tests (new job, service, gate, path-filtered required check, policy superset)                                            |
| 5   | R27 would reject any dependency change, and its controls could not install the fork                       | Protocol counted only four files                                                                                                 | The fork's four installed files are dependency paths; new immutable controls registered                           | `r27-dependency-controls.test.mjs` 20/20, including an unregistered fork edit; real control installs                             |
| 6   | R35 says the Stripe SDK, ingress and purchase surface are unintegrated                                    | Written at parent `73a4a64a`, before G3                                                                                          | Dated, append-only correction; history kept                                                                       | Source inspection: `app.module.ts`, `money/` adapters, `StripePlanPurchase`                                                      |
| 7   | develop unprotected; no rulesets                                                                          | Never configured                                                                                                                 | Exact request prepared and verified; **not applied**                                                              | MERGE_POLICY verifier passes on the read-back shape; inventory proves no required check is path-filtered                         |

## Environment inventory

[`scripts/ci/environment-inventory.json`](../../../../scripts/ci/environment-inventory.json)
names 40 jobs across 17 workflows. For each job it records the owner, where it
runs (GitHub-hosted `ubuntu-latest`/`windows-latest`), the real services
(PostgreSQL 16, Redis 7, Mailpit), step-started containers (ClamAV) and compose
stacks (realtime replicas, observability, R27), the `RUN_*` gates it enables,
and whether it is a required final-SHA check. All 11 `RUN_*` gates read by
tests are enabled by at least one hosted job:

| Gate                          | Suites                   | Enabled by                                                       |
| ----------------------------- | ------------------------ | ---------------------------------------------------------------- |
| `RUN_DB_INTEGRATION`          | 95 API integration files | integration-e2e, r31, evidence-retention, dispute, r30, R04, R26 |
| `RUN_REDIS_INTEGRATION`       | real Redis suites        | integration-e2e                                                  |
| `RUN_R22_WORKER_PROCESS`      | outbox process           | integration-e2e                                                  |
| `RUN_R20_STORAGE_INTEGRATION` | S3 storage               | evidence-retention                                               |
| `RUN_RETENTION_INTEGRATION`   | retention + S3 versions  | evidence-retention                                               |
| `RUN_DISPUTE_BROWSER/WORKER`  | dispute journey + ClamAV | dispute-workspace                                                |
| `RUN_PROVIDER_BROWSER`        | R17-E provider surfaces  | dispute-workspace                                                |
| `RUN_ADMIN_BROWSER`           | R17-D admin operations   | dispute-workspace                                                |
| `RUN_R30_INTEGRATION/BROWSER` | manual payments + ClamAV | r30-manual-payments                                              |

No suite is silently excluded. Parallelism and DB-integration flags are
unchanged: the hosted Verify API skip count (101 suites / 1,880 tests, run
instead by the gated jobs) is identical to develop. Findings recorded, not
changed: `ci.yml` uses `axllent/mailpit:latest` where the other workflows pin
`v1.31.1`; ClamAV uses the floating `clamav/clamav:stable`; five `sprint12-*`
workflows are historical and branch-scoped.

## Commands run (local Windows, worktree `HSM-k01`)

| Command                                                        | Exit  | Result                                                                          |
| -------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` (base, then after the change) | 0     | clean install; lockfile updated only by the dependency commit                   |
| `pnpm --filter @homeservicemarketplace/database generate`      | 0     | Prisma Client 6.12.0                                                            |
| `pnpm --filter …/contracts build`, `…/api build`               | 0     | `nest build` = `tsc` output                                                     |
| `pnpm security:audit` / `:prod`                                | 0 / 0 | all severities 0                                                                |
| `pnpm security:audit:test`                                     | 0     | 55/55                                                                           |
| `pnpm --filter …/api lint`; `…/web lint`                       | 0 / 0 | 0 problems; 0 errors, 34 warnings (same 34 as develop)                          |
| `pnpm --filter …/{api,web,contracts,database} typecheck`       | 0     | all pass                                                                        |
| `pnpm --filter …/web test`                                     | 0     | 226 files, 2730/2730                                                            |
| `vitest run BookingActions.test.tsx` ×5                        | 0     | 14/14 each                                                                      |
| `pnpm --filter …/web test:startup --global-timeout 2400000`    | 0     | 6/6. The CLI override covers only this slow host; config unchanged              |
| `node --test .github/scripts/*.test.mjs`                       | 0     | 501/501 (one earlier unrelated transient failure did not recur in three reruns) |
| `node scripts/ci/environment-inventory.cjs` + its tests        | 0     | match; 7/7                                                                      |

Hosted counts for the Verify jobs and real-service jobs are in
[JOB_LEDGER.md](JOB_LEDGER.md). The real PostgreSQL/Redis/Mailpit/ClamAV/S3
suites ran in hosted CI, their documented acceptance location. They were not
rerun on this shared Windows host, which also runs other lanes' worktrees.

## Remaining external inputs

- **Owner decision:** apply develop protection
  ([BRANCH_PROTECTION.md](BRANCH_PROTECTION.md)), and authorize merge.
- **Owner/R27 review:** the deepmerge fork and the R27 dependency-path
  extension (shared tooling outside K01's own paths).
- **Owner/R35:** acknowledge the appended R35 correction (append-only; the
  R35 assignment ended when #197 merged).
- Not K01 inputs and unchanged: G3 acceptance, Stripe sandbox credentials,
  refund-policy approval, and Wave 4 assignments.

## Rollback / forward repair

Revert the K01 commits on develop. Reverting the dependency commit alone
reintroduces the advisories and restores the old R27 record mismatch. The R27
control commits and their record must be reverted together. There is no
schema, data, contract or flag impact. Forward repair for a future advisory:
rerun `pnpm security:audit`, then register fresh R27 controls
(`release/ksa-k01-r27-*-control` shows the procedure).

## Next-sprint baseline

Once merged, develop at the K01 merge commit is the green technical baseline,
provided the hosted ledger is all green on that exact commit. It is not an
approved Wave 4 or G3 execution base. A successor base still needs the
existing governance approval.
