# K01 — develop protection: prepared, not applied

## Live state (read 2026-11-03)

- `GET /repos/baraabd/homeservicemarketplace/branches/develop/protection` →
  HTTP 404 `Branch not protected`.
- `GET /repos/baraabd/homeservicemarketplace/rulesets` → `[]`.
- The authenticated account has `admin: true`, so enforcement can be applied
  through `gh`. It has **not** been applied. Doing so changes merge rules for
  every concurrent lane (open Draft PRs #204–#207, #210). While develop's own
  `CI gate` was red, it would also have blocked all merges until K01 lands.
  Enforcement therefore waits for an explicit owner decision.

**Status: ENFORCEMENT PENDING.** Nothing in this sprint claims protection is
active.

## Settings

The settings follow [`MERGE_POLICY.md`](../../MERGE_POLICY.md) and are checked
by its read-only verifier. Request body:
[`evidence/develop-protection.request.json`](evidence/develop-protection.request.json).

- Pull request required. 0 approvals while the repository has one owner
  (self-approval is impossible; MERGE_POLICY). Stale approvals are dismissed;
  no bypass allowances.
- Strict status checks: the branch must be up to date, so checks run on the
  merge candidate, not an earlier SHA.
- Rules apply to administrators; conversation resolution is required; force
  pushes and branch deletion are blocked.
- Required checks, each bound to its reporting app:

| Check                                         | App                              | Source                                   |
| --------------------------------------------- | -------------------------------- | ---------------------------------------- |
| `CI gate`                                     | GitHub Actions (15368)           | ci.yml — needs every CI job              |
| `Analyze JavaScript/TypeScript`               | GitHub Actions (15368)           | codeql.yml                               |
| `CodeQL`                                      | GitHub Advanced Security (57789) | code-scanning result (pr-acceptance.mjs) |
| `Production governance`                       | GitHub Actions (15368)           | production-governance.yml                |
| `Dev browser startup (ubuntu-latest)`         | GitHub Actions (15368)           | web-startup.yml                          |
| `Dev browser startup (windows-latest)`        | GitHub Actions (15368)           | web-startup.yml                          |
| `Staging release controls (ubuntu-latest)`    | GitHub Actions (15368)           | staging-boundary.yml                     |
| `Staging release controls (windows-latest)`   | GitHub Actions (15368)           | staging-boundary.yml                     |
| `Staging image boundaries`                    | GitHub Actions (15368)           | staging-boundary.yml                     |
| `Staging boundary gate`                       | GitHub Actions (15368)           | staging-boundary.yml                     |
| `R04 real browser, SMTP and Postgres`         | GitHub Actions (15368)           | auth-lifecycle.yml                       |
| `R26 cookies, authorization and enforced CSP` | GitHub Actions (15368)           | r26-security.yml                         |
| `Real Seeker Provider Admin startup`          | GitHub Actions (15368)           | startup-performance.yml                  |

## Checks that would strand PRs

`node scripts/ci/environment-inventory.cjs` (run by Production governance)
rejects a required job unless its workflow runs on **every** pull request to
develop and on pushes to develop, with no `paths`, `paths-ignore` or
`branches-ignore` filter. Its test also checks that the required set covers
MERGE_POLICY's `REQUIRED_CHECKS` and `pr-acceptance.mjs` `POLICY`.

Deliberately **not** required:

- Path-filtered jobs that would sit at "Expected" forever on unrelated PRs:
  `Recovery and native Sharp (*)` (dev-workspace-recovery.yml) and
  `R23 Linux firing and recovery delivery` (observability.yml).
- PR-only measurement lane with no push trigger: R27 (r27-performance.yml).
- Individual ci.yml jobs. `CI gate` already fails if any one of them fails.
- `CodeQL` (app 57789) is the code-scanning result rather than a workflow job.
  It reported `success` on PRs #201, #202, #203 and #210. It is published for
  pull-request heads, which are what required checks evaluate, but not for
  pushes to develop: the develop push `92770ea6` has no `CodeQL` result check.
  It is required for PR merges only.

Validation performed:

- The request's read-back shape passes
  `node .github/scripts/production-governance.mjs protection`, and an empty
  input fails.
- Every required name was observed as a completed check run on develop
  `92770ea6` and on this PR's head (see [JOB_LEDGER.md](JOB_LEDGER.md)).

## Apply (owner decision), then read back

```bash
gh api -X PUT repos/baraabd/homeservicemarketplace/branches/develop/protection \
  --input docs/production-readiness/ksa-launch/K01/evidence/develop-protection.request.json
gh api repos/baraabd/homeservicemarketplace/branches/develop/protection > "$TEMP/develop-protection.json"
node .github/scripts/production-governance.mjs protection "$TEMP/develop-protection.json"
```

Record the redacted read-back under `docs/production-readiness/governance/`
(MERGE_POLICY). Rollback:
`gh api -X DELETE repos/baraabd/homeservicemarketplace/branches/develop/protection`.
Applying protection grants no authority and changes no code.
