# K03 — Commands actually run (2026-11-03, Windows 11 host, Git Bash)

Toolchain: Node `24.21.0`, pnpm `10.32.1`, Docker engine `29.1.3`.

Code under test: `5fd98555d40c01e4704b0099727e9c20dcf14b8a`, tree
`70c8f37e8fccee49dd7d862b24464be1da742cbb`. This is the last code commit; the
evidence/docs commit follows it.

## Setup

| Command                                                                                               | Exit / result |
| ----------------------------------------------------------------------------------------------------- | ------------- |
| `pnpm install --frozen-lockfile`                                                                      | 0             |
| `pnpm --filter @homeservicemarketplace/database exec prisma generate`; contracts and database `build` | 0             |

## Static and unit (at `5fd98555`)

| Command                                                                   |  Exit | Counts                                                                                                                |
| ------------------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------- |
| `node --test infra/production/check-runtime.test.cjs`                     |     0 | 11 pass / 0 fail / 0 skip                                                                                             |
| `node --test infra/production/staging.test.cjs`                           |     0 | 104 / 0 / 0                                                                                                           |
| `node --test scripts/production/platform/validate-plan.test.cjs`          |     0 | 353 / 0 / 0                                                                                                           |
| `node --test scripts/production/security-app/web-build-identity.test.cjs` |     0 | 10 / 0 / 0                                                                                                            |
| `node --test scripts/production/security-app/verify-boundaries.test.cjs`  |     0 | 32 / 0 / 0                                                                                                            |
| All five suites together                                                  |     0 | **510 / 0 / 0**                                                                                                       |
| `node --test .github/scripts/*.test.mjs`                                  |     0 | 500 / 0 / 0                                                                                                           |
| `node .github/scripts/production-governance.mjs`                          |     0 | `PASS repository governance files`                                                                                    |
| `node scripts/production/platform/validate-plan.cjs --check`              |     0 | prepared plan with blockers                                                                                           |
| `… validate-plan.cjs --check --require-target`                            | **2** | expected: target unselected (`HOSTED_ENVIRONMENT_BLOCKED`)                                                            |
| `apps/api: npx jest src/config/`                                          |     0 | 3 suites, **148 / 0 / 0**                                                                                             |
| `pnpm --filter @homeservicemarketplace/api typecheck`                     |     0 | —                                                                                                                     |
| `eslint` on every changed JS/TS file (API, web script, infra, scripts)    |     0 | —                                                                                                                     |
| `prettier --check` on changed files                                       |     0 | Commit hooks reformatted `check-runtime.cjs` and `image-preflight-smoke.cjs`, which were already non-Prettier at base |

### Red-first evidence

- `runtime-policy.spec.ts`: 1 failing before the first fix (dispatcher off accepted).
  After it was reworked to release scope, 7 failing before `releaseReadinessProblems`.
- `web-build-identity.test.cjs`: the Dockerfile propagation test failed on the base
  Dockerfile.
- `staging.test.cjs`: 3 edge-header tests failed, and the nginx header pin failed
  before the guard.
- `check-runtime.test.cjs`: 4 release-mode tests failed before the implementation.

## Docker and runtime (local, details in `IMAGE_IDENTITY.md` and `MIGRATION_REHEARSAL.md`)

| Command                                                                           | Exit / result                                                                           |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Base `92770ea6` web build with `VITE_STRIPE_SANDBOX_ENABLED=true` (clean archive) | 0. CSP without Stripe (**defect reproduced**)                                           |
| `web-images.sh` at `e4458df3`: builds for `false` and `true`                      | 0 / 0                                                                                   |
| Negative builds: missing flag / fingerprint mismatch / `TRUE` / empty SHA         | 1 / 1 / 1 / 1, each with its specific code                                              |
| `web-image-smoke.cjs` for `false` and `true`                                      | 0 / 0                                                                                   |
| Chromium CSP check (Playwright 390×844), three images                             | blocked / blocked / loaded                                                              |
| `docker build … --target migrator` at `e4458df3`                                  | 0                                                                                       |
| `rehearse-migration.cjs` (first run)                                              | 1. Bug in the rehearsal's own privilege query (`pg_tables` view predicate order); fixed |
| `rehearse-migration.cjs` (second run)                                             | 0, `COMPLETED`                                                                          |
| API runner build plus `image-preflight-smoke.cjs`                                 | **not completed** (superseded, then stopped by the low-memory reaper)                   |
| Full chain rerun at `5fd98555`                                                    | **not completed** (low-memory reaper during the first web build)                        |

## Not run

- Full API Jest suite. This host is memory-constrained; DB-gated specs need
  Postgres/Redis. K03 changes only `runtime-policy.ts`, and its consumers' tests ran.
- Web unit/e2e suites. No web `src/` changed; the real production web build ran
  inside both images.
- actionlint is not installed locally. The workflow parsed with `yaml@2.9.0`.
- All hosted checks (`BLOCKED_INPUTS.md`).
