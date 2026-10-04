# Post-R12 develop forensic report

Date: 2026-10-04. Scope: the state of `develop` after PRs #131, #132 and #133
were merged within 67 seconds of each other on 2026-10-03, and the repair that
restores the zero-finding dependency gate.

Evidence labels: **OBSERVED** (seen once, not independently reproduced),
**PROVEN** (reproduced or derived from the git graph / registry), **SUSPECTED**,
**NOT REPRODUCED**, **FIXED** (on the repair branch, pending merge),
**BLOCKED**.

## 1. Identity

| Item                           | Value                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `develop` head                 | `a2b31c3090000d2ef8a5e96dd21e80023ee160a7`                                                                             |
| `develop` tree                 | `499759b80131b4a5dff81e25d6cc74623572025e`                                                                             |
| Node / pnpm                    | 24.21.0 / 10.32.1 (matches `package.json` `engines` / `packageManager`)                                                |
| Repair branch                  | `fix/develop-post-r12-security-baseline` (merge base `a2b31c3`)                                                        |
| Branch protection on `develop` | **PROVEN absent**: `GET /branches/develop/protection` returns `404 Branch not protected`; `GET /rulesets` returns `[]` |

The absence of protection is why a PR titled "do not merge" could be merged.
Enabling protection is a repository-owner setting and is not changed here.

## 2. First-parent history around the merges

```
a2b31c3  #133  parents d1f6e7b + f036589  (merge commit)
d1f6e7b  #132  parents ef3c396 + 9663a89  (merge commit)
ef3c396  #131  parents 21b98b7 + 083bf5c  (merge commit)
21b98b7  #130  R11
```

All three PRs were opened against base `21b98b7`. GitHub merged them in order
#131 (13:49:14Z), #132 (13:50:04Z), #133 (13:50:21Z).

## 3. What each merge introduced (PROVEN from first-parent diffs)

| PR   | Head      | First-parent delta                                                                                                                    | Classification                                                                                                                         |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| #131 | `083bf5c` | `EditProfilePage.tsx` (+36/−2), `EditProfilePage.test.tsx` (+152)                                                                     | VALID_PRODUCTION_CHANGE (R05 first-hydration fix)                                                                                      |
| #132 | `9663a89` | 42 files, +3970/−251, including `Message.idempotencyKey` schema + one additive migration, contracts for send-message, R12 web and e2e | VALID_PRODUCTION_CHANGE (R12). `git diff 9663a89 d1f6e7b` equals exactly the #131 delta, so the merge introduced no unreviewed content |
| #133 | `f036589` | `.github/workflows/security-jest30-candidate.yml` (+274) only                                                                         | DIAGNOSTIC_ONLY                                                                                                                        |

#133's branch was built on `083bf5c` (the #131 head), so its branch diff
against `21b98b7` also shows the #131 profile files. Those are
DUPLICATED_FROM_PARENT: after #131 was merged first, they contributed nothing
to the #133 merge, which is why its first-parent delta is a single file.

### The #133 workflow

- Triggers only on `push` to `work/security-jest30-lock-recovery` when the
  workflow file itself changes, so it never runs on `develop` or on PRs.
- Its `publish-source-objects` job holds `contents: write` and publishes git
  blobs/trees through the API.
- It changes no application source, dependency, lockfile, or gate on `develop`.

Conclusion: the #133 merge was **harmless to runtime but must not stay**: it is
diagnostic tooling with a write-scoped job. A `git revert -m 1 a2b31c3` would
remove exactly this file and nothing else (PROVEN by the first-parent delta),
but the repair removes it by an ordinary deletion inside the focused repair PR,
so no revert commit is needed. #133 did **not** apply the Jest 30 upgrade it
was validating.

## 4. Current develop workflow inventory (head `a2b31c3`, push, attempt 1)

| Workflow                            | Run ID      | Result      |
| ----------------------------------- | ----------- | ----------- |
| CI                                  | 37127548328 | **failure** |
| CodeQL                              | 37127548096 | success     |
| Production governance               | 37127548118 | success     |
| Web development startup             | 37127548104 | success     |
| Authentication lifecycle acceptance | 37127548202 | success     |
| Staging release boundary            | 37127548172 | success     |

CI jobs: every job succeeded except two.

| Job                                                                                                                                                                                                | Result  | Notes                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dependency, secret, and container scans                                                                                                                                                            | failure | Step 7 _Full dependency audit (ZERO findings at every severity)_ failed. Steps 10 _Secret scan_, 11 _Build the image to scan_, 12 _SBOM_, 14 _Container image scan_ were **SKIPPED, not passed** |
| CI gate                                                                                                                                                                                            | failure | Downstream aggregate; not an independent root cause                                                                                                                                              |
| Verify ×5, Integration & E2E (real Postgres/Redis), Browser E2E, Auth cookie contract, Admin review evidence, Phase 5 gates, Evidence retention, Dispute journey, Docker cold build, Compose smoke | success | "Upload … on failure" steps skipped by design                                                                                                                                                    |

**Independent root causes on develop: exactly one** — the full dependency
audit. Secret scanning and container scanning have therefore not executed on
`develop` since the advisory appeared (R11 post-merge run 37102002731 failed the
same way).

## 5. The advisory (PROVEN, reproduced locally on `a2b31c3`)

`pnpm audit --json` on the exact develop lockfile:

```
{ info: 0, low: 0, moderate: 0, high: 1, critical: 0 }   totalDependencies 1252
GHSA-vfj7-8cjw-p6xm  braces  high  vulnerable <=3.0.3  patched: none (<0.0.0)
  braces vulnerable to stack-exhaustion denial of service through deeply nested patterns
  installed 3.0.3 via apps__api > @types/jest > expect > jest-message-util > micromatch > braces
```

Production audit (`--prod`): all zero. Reach: development/test toolchain only.

`micromatch@4.0.8` (→ `braces@3.0.3`) is depended on only by Jest 29 packages in
the lockfile: `@jest/core@29.7.0`, `@jest/transform@29.7.0`, `jest-config@29.7.0`,
`jest-haste-map@29.7.0`, `jest-message-util@29.7.0`. Only `apps/api` uses Jest.

There is no patched `braces` release, so a version override cannot fix it.
Remediation alternatives considered:

1. Audit allowlist / `auditConfig` / ignore — **forbidden** by policy and
   rejected by `scripts/security/dependency-audit.cjs`.
2. Override `braces`/`micromatch` to an unvetted fork — rejected.
3. **Upgrade Jest to 30**, whose toolchain no longer depends on
   micromatch/braces — chosen.

## 6. Remediation on the repair branch

Commits on `fix/develop-post-r12-security-baseline`:

- `b93c115…05e3af6`: a bootstrap workflow that ran the upgrade in Actions and
  committed the resulting manifest/lockfile (`805a412`, author
  `github-actions[bot]`). The bootstrap workflow itself is diagnostic tooling
  with `contents: write` and is **removed** by this PR.
- `805a412`: `apps/api/package.json` → `jest ^30.5.2`, `@types/jest ^30.0.0`,
  `ts-jest 29.4.9` (exact); regenerated `pnpm-lock.yaml`.
- This PR's own commits: migrate the one legacy CLI flag, delete the two
  diagnostic workflows, add this report.

### Legacy Jest CLI flags

Searched every workflow, script and package manifest for Jest invocations.
Exactly one use of a flag removed in Jest 30:
`.github/workflows/ci.yml` (evidence-retention job)
`--testPathPattern=evidence-retention.integration` →
`--testPathPatterns=evidence-retention.integration`.

PROVEN equivalence: Jest 29 with the old flag and Jest 30 with the new flag
select the same two files (`evidence-retention.integration.spec.ts`,
`manifest-evidence-retention.integration.spec.ts`). Jest 30 with the old flag
exits non-zero without listing any test, so the migration is required, not
cosmetic. The other invocations (`--runInBand`,
`--runTestsByPath`, `--listTests`, `--json`, `--outputFile`, `--maxWorkers`,
`--forceExit`) are unchanged in Jest 30.

### ts-jest `isolatedModules`

`apps/api/jest.config.cjs` passes `isolatedModules: true` as a ts-jest option.
ts-jest 29.4 warns that this option is deprecated in favour of the tsconfig
setting. It is a warning only; behaviour is unchanged. Not changed here
(no unrelated refactoring); recorded as non-blocking future compatibility work.

### Test-environment

CI's verify and integration jobs already set a synthetic
`JWT_ACCESS_SECRET` at job level. The earlier "JWT_ACCESS_SECRET" failures were
in the diagnostic workflow, which lacked that env. No change to `validateEnv()`
or any production default was needed or made.

## 7. Local verification of the repair tree (Windows host)

| Check                                                                 | Result                                                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                      | PASS                                                                                                                                                                |
| `pnpm security:audit:test` / `security:audit` / `security:audit:prod` | 39/39 policy tests pass; full and prod audit both `{info 0, low 0, moderate 0, high 0, critical 0}`, totalDependencies 1290; braces/micromatch absent from lockfile |
| Jest discovery, develop (Jest 29.7.0) vs repair (Jest 30.5.2)         | 277 vs 277 files, **identical** set                                                                                                                                 |
| contracts build / typecheck                                           | PASS / PASS                                                                                                                                                         |
| database generate / prisma validate / typecheck / build               | PASS ×4                                                                                                                                                             |
| database `verify:migrations`                                          | NOT RUN locally (needs PostgreSQL; executed in CI)                                                                                                                  |
| API lint / typecheck / build                                          | PASS ×3                                                                                                                                                             |
| API Jest (no DB/Redis)                                                | 277 suites: 214 passed, 62 skipped (DB/Redis-gated), **1 failed**; tests 3868 passed, 1322 skipped, 1 failed, 0 load errors                                         |
| web lint / typecheck / typecheck:e2e                                  | PASS ×3                                                                                                                                                             |
| web unit (Vitest)                                                     | 188 files, 2341 tests passed                                                                                                                                        |
| web production build (`VITE_API_URL` set as in CI)                    | PASS                                                                                                                                                                |

The single API failure is
`restricted-erasure.spec.ts › does not flatten a directory or ENOTDIR storage
error into absence`. It fails identically on unmodified `develop` with Jest
29.7.0 on this host, and passes on Linux CI: Windows reports a path through a
regular file differently from POSIX `ENOTDIR`. **NOT caused by the repair;
pre-existing, Windows-only.** It is not hidden or skipped.

Real-service suites (PostgreSQL, Redis, MinIO, ClamAV, browser), secret scan,
image build, SBOM, container scan and CodeQL are proven by the PR's CI runs on
its final head; see the PR body.

## 8. Other observations (not introduced by #131–#133)

- OBSERVED: five `sprint12-*.yml` workflows from 2026-09-20 remain on
  `develop`. Each triggers only on pushes to
  `chore/sprint12-readable-transfer-20260920`; three hold `contents: write`.
  They are the same class of diagnostic tooling as #133 but predate this
  incident; removal is recommended as a separate owner-approved cleanup and is
  left out of this focused repair.
- OBSERVED: remote `work/security-jest30-lock-recovery` (head `f036589`) is
  fully merged into `develop` and can be deleted by the owner.

## 9. Status

| Item                                                           | Status                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| Accidental-merge content identified (#133 diagnostic workflow) | PROVEN; FIXED on repair branch                                |
| GHSA-vfj7-8cjw-p6xm via Jest 29                                | PROVEN; FIXED on repair branch                                |
| Secret/container scans not executing on develop                | PROVEN; expected to execute once the audit passes (see PR CI) |
| Missing branch protection on `develop`                         | PROVEN; BLOCKED on owner setting                              |
| Windows-only erasure spec failure                              | PROVEN pre-existing; not in scope                             |
