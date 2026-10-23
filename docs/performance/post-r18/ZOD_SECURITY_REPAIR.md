# PR #188 — Zod security repair and comparable performance controls

## Coordinator scope

Mode A. The owner's request to repair PR #188 authorizes this session to own
the following additional files, serialized after the database-cleanup repair:

- `package.json`
- `apps/api/package.json`
- `pnpm-lock.yaml`
- `.github/workflows/r27-performance.yml`
- `.github/scripts/r27-dependency-controls.mjs`
- `.github/scripts/r27-dependency-controls.test.mjs`
- `.github/scripts/r27-workflow.test.mjs`
- `docs/performance/post-r18/r27-dependency-controls.json`
- `docs/performance/post-r18/DEPENDENCY_UPGRADE_HOLD.md`
- this record

No G1/G2/G3 acceptance record, financial policy, performance budget, comparison
semantics, audit exception or application feature is changed by this lease.

## Reproduced blocker

On `4a471c20f3681e5fa7f37bc0701d01b56336e558`, run `40022815381`, job
`120657368136`, both the full and production dependency audits fail on
`GHSA-mrhx-c7xc-m3w5`: Zod 3.25.76 in the API and 4.3.6 through the lint plugin
are affected. Artifact `12532431584` has ZIP SHA-256
`6f85f538945229158ec482d9b8df381260255dc12822dd0f8aadc061324ffad3`.
The pinned local full audit reproduces the two HIGH findings. The earlier
dependency hold is therefore superseded; an older clean audit is not current
security evidence.

The reviewed [advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
requires Zod 4.6.6 or later. Pin 4.6.6 for the API and replace affected
transitive versions with the same patched version, then regenerate the lockfile
with the repository's pinned pnpm.

## Performance experiment design

Prepare a new immutable baseline by applying only the three dependency files
to the previous baseline `96e92825f9b65cf124317f43b55ce42fc97f5b49`.
Prepare a distinct immutable repair control as a dependency-only child of
`4a471c20f3681e5fa7f37bc0701d01b56336e558`. Both controls must have identical
dependency blobs and lock digest to the candidate. Verify their parents,
complete changed-path sets, trees and candidate ancestry in CI. The original
baselines and all earlier measurements remain historical.

Only the known old-dependency PR base may select the explicit repair control;
ordinary future PRs continue using their actual base when dependency identity
matches. An unknown dependency mismatch must fail. All three real measurement
jobs, the original complete comparison and every original budget remain
mandatory. Fresh runtime, browser, security and performance evidence is still
required before acceptance.

## Immutable controls

| Control  | Commit                                     | Tree                                       | Exact parent                               |
| -------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| Baseline | `462418888be76ec642664ea77971da9239ffb02a` | `8acca7fa2fd483416930d0cf4fdfb0f2a2ff0696` | `96e92825f9b65cf124317f43b55ce42fc97f5b49` |
| Repair   | `7bf00ac524ee63613f5443c55a1f0267559b1990` | `eb1824fc6185dcdddef4010af131218a4f103753` | `4a471c20f3681e5fa7f37bc0701d01b56336e558` |

Each changes exactly `package.json`, `apps/api/package.json` and
`pnpm-lock.yaml`. Published trees match normal-hook local commits
`7fa48f093da1757757f680d6093380e3fa5d4573` and
`89ef11d3f3a68ad6ea16212ef2c18dd9f625ff1c`, respectively.
Both lockfiles have SHA-256
`0616afc56373d7dc72913189c34711e86b7c0730372728f06b5fa33109338676`.
Branches retain these objects; CI selects the full immutable SHAs, not the
branch tips. Controls are experimental references, not accepted release bases.

The validator checks real Git parents, complete changed-path inventories,
source trees, all three dependency-file digests, exact harness identity and
ancestry. It rejects unknown dependency changes and using the candidate as its
own control. It records the actual selection in each measurement artifact.
The existing repair checkout/ancestry/lock equality checks are retained after
selection, as are all comparison and budget checks.

## Local validation and remaining evidence

All commands used Node 24.21.0 and pnpm 10.32.1. The lockfile was regenerated
by pnpm; its decoded diff changes only Zod resolutions, their importer/peer
references and the Zod override. No application TypeScript change was needed.

- Frozen install passed in separate candidate and baseline worktrees.
- API typecheck and production build passed in both worktrees.
- Full and production dependency audits passed with zero findings at every
  severity; no exclusions were added.
- Candidate API tests passed: 295 suites, 5,279 cases. The existing 98
  DB/Redis/browser-gated suites (1,856 cases) were skipped in this hermetic run;
  their actual execution remains required in CI.
- The first local full API invocation omitted the CI placeholder database/JWT
  environment and had three configuration-load suite failures. Re-running
  with the exact documented CI placeholders passed; no validation was relaxed.
- API lint passed. Web lint passed with its 34 existing warnings and no errors.
- Seventeen control regressions use actual disposable Git histories; an
  additional workflow regression requires control validation before checkout.

The prior cleanup source passed real R30 service assertions (16/16), its
browser wrapper (1/1) and both browser scenarios without skips or retries in
job `120657367963`. This confirms the cleanup correction on that source only.
All security, runtime, browser, integration and three-control performance jobs
must run again on the final security-repaired head before technical acceptance.

## Rollback and release boundaries

Reverting the Zod correction restores the known HIGH advisory. Reverting only
the control registration leaves incompatible dependency digests. If a runtime
regression is discovered, keep the PR blocked while repairing it; do not waive
the audit or performance checks. Existing peer/deprecation warnings remain.

G3, R29's missing sandbox implementation, refund-policy/consequence approval,
live-money restrictions and the R34 start barrier remain separate. No merge,
deployment, account grant or live payment is performed by this repair.
