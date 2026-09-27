# R01 — baseline and merge governance

## Source identity and historical reconciliation

Mode: integration and bug fix. Inspected develop:
`cc2cd399052ceac053990a9175daa524ea350d6e`, tree
`d898431c5cfce53b4014a7a749280c4960a4d52f`. PR #114 is now merged;
there were no open pull requests at initial inspection. The previous source
inventory remains explicitly historical at `66e336c`; the latest pre-114 audit
was `929afb5`. The new [register](BASELINE.json) maps every R01-R10 blocker to
an accountable owner, existing source/test references, next action and required
acceptance. Test paths do not assert that the acceptance journey ran.

Baseline workflow evidence, all for `cc2cd399`:

| Workflow | Run | Observed outcome |
| --- | --- | --- |
| CI | [36273195659](https://github.com/baraabd/homeservicemarketplace/actions/runs/36273195659) | completed / success |
| CodeQL | [36273195463](https://github.com/baraabd/homeservicemarketplace/actions/runs/36273195463) | completed / success |
| Production governance | [36273195419](https://github.com/baraabd/homeservicemarketplace/actions/runs/36273195419) | completed / success |
| Web development startup | [36273195406](https://github.com/baraabd/homeservicemarketplace/actions/runs/36273195406) | completed / success |

The source artifact was downloaded through the authorized GitHub connection.
Its ZIP digest, source-tar digest, HEAD and reconstructed Git tree matched the
baseline. Direct Git clone in the execution container failed DNS resolution;
no partial clone or unverified cached source was substituted.

## Implemented controls

`pr-acceptance.mjs` provides a dependency-free, read-only GitHub collector and
fail-closed evaluator. It exhausts workflow/job/artifact pagination, validates
repository/PR/head/base identity, current-base ancestry, open/non-draft state,
mergeability, capture freshness, latest run/attempt, mandatory named jobs and
nonexpired head-bound artifacts. A newer queued/failed run cannot be hidden by
an older success. Source, PR-body and run changes during collection are rejected.
It never merges, writes a status, modifies settings, executes a PR-body command,
or follows a redirect carrying its token.

The existing governance workflow now runs all governance tests, validates the
source-backed registry, and checks populated PR metadata against the actual head.
Editing the PR body re-runs this metadata check. A blank/old Final SHA fails;
the final hash belongs in the PR body after committing, not in its own commit.

Full technical acceptance is intentionally separate from the running governance
job: making that job wait for its own successful conclusion would be circular.
After all workflows finish, an authorized operator can collect current evidence:

```sh
node .github/scripts/pr-acceptance.mjs collect PR_NUMBER FULL_HEAD_SHA /secure/path/pr-acceptance.json
```

Supply a read-only `GITHUB_TOKEN` through the environment/secret manager, never
as a command argument or committed file. The report file is created with mode
0600 where supported. The result is a point-in-time check, not a signed
attestation or an enforced GitHub merge lock. Re-read the head and effective
protection immediately before any separately authorized merge. Technical PASS
never closes missing real database, storage, email, browser or staging evidence.

## Ownership and shared-file reservations

`@baraabd` is the accountable Integration, Migration, Contract and Operations
owner; no fictitious team, reviewer or GitHub user has been assigned. Logical
sprint reservations are in `BASELINE.json`. Shared paths must follow their
recorded serial order, with exact paths and handoff recorded in the PR before
the next author edits. R01's governance-workflow edit precedes R02's Node pin;
R02 must retain the R01 check steps when those branches are reconciled.

One sprint = one branch = one PR. Do not push directly to develop, force-push,
merge automatically, rewrite applied migrations, refresh dependencies incidentally,
or infer protection from CODEOWNERS. A register validates coordination records;
it does not create GitHub file locks. All commits, PR titles/bodies and comments
for this execution are in English.

## Actual protection remains BLOCKED

The branch API returned `protected: false`; repository rulesets including
parents returned `[]`. The administration protection read returned HTTP 403,
`Resource not accessible by integration`. Repository metadata reported the
account's admin permission, which is not the integration's administration scope.
No protection change was attempted through a weaker or unrelated credential.

The owner must apply the approved exact-branch policy through an appropriately
authorized administration session and then capture its effective settings.
Retain strict current-base checks, CI/CodeQL/governance, resolved conversations,
administrator enforcement, no force/delete and no bypass. Preserve any stricter
existing policy. No self-approval or invented independent reviewer is permitted.
The existing classic-policy verifier remains read-only. Equivalent rulesets need
explicit effective-rule evidence, not a presence-only claim.

## Evidence, limits and closure

Executed local commands (Linux, available Node 22.16.0, not the R02 target):

```sh
node --test .github/scripts/*.test.mjs
node .github/scripts/production-governance.mjs
node .github/scripts/release-baseline.mjs
```

The PR body records the final commit, actual test totals and final-head workflow
outcomes. No application UI, database, stored media, runtime flag or migration
was changed in R01. Existing artifact/source PASS does not count as tests of the
new code. Hosted acceptance, Windows application tests and administration
read-back were not executed locally.

R01 status: repository implementation under review; protection acceptance
**BLOCKED**. R02-R10 remain dependency/acceptance-blocked in the register, not
completed merely because code or tests already exist. No merge or deployment
was performed. Rollback is a normal revert of this PR; it needs no data deletion
and must not weaken actual branch protection once that has been applied.
