# CR-001 — R38 start gate, evidence integration and rollback handoff

Status: **REQUESTED; NOT APPLIED**. Requester: `r38-d9b4f68ed4fc`.
All paths below remain coordinator-owned. This request does not grant a
source lease, change gate decisions or authorize deployment.

## 1. Publish genuine G3 acceptance and assign R38

Exact shared paths:

- `docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/waves/wave-04.plan.json`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`

The minimal semantic change is to record **verified facts after execution**:
all seven unchanged categories on one source/tree; complete final CI and
official CodeQL evidence; real registered participants; run/artifact identities
and hashes; accepted prerequisite/merged lane identities; an owner-reviewed
acceptance publication whose actual merge is independently verified. Then
assign the full frozen source and one named R38 writer, keeping the existing
exact ownership list and restrictions consistent across all three records.

Do not substitute PR #198's implementation merge for that publication. Do not
change BLOCKED to ACCEPTED, assign an arbitrary develop SHA or fabricate PASS
rows to make the following existing commands succeed:

```text
node .github/scripts/g3-record.mjs --check
node .github/scripts/g3-record.mjs --ready R38
```

Use the existing [G3 sandbox runbook](../../post-r18/gates/g3/SANDBOX_RUNBOOK.md).
The required operator input includes authorized test-account credentials via
the protected environment, authentic matching-version webhook forwarding,
bounded plan/account/currency inputs and a genuinely approved immutable refund
policy with an explicit whole-subscription consequence. Never paste secret
values into Git, this PR or chat. The runner's 14 checkpoints do not replace
the remaining Payment Element/browser, manual, crash/recovery or combined
evidence categories.

## 2. Integrate the future R38 tests into the existing CI authority

Exact proposed shared path: `.github/workflows/staging-boundary.yml`.
Apply only **after** G3 release, file ownership assignment, implementation and
successful applicable local checks. Append the four R38 test files to the
existing Ubuntu/Windows controls invocation:

```diff
- node --test infra/production/check-runtime.test.cjs infra/production/staging.test.cjs scripts/production/platform/validate-plan.test.cjs | tee controls.tap
+ node --test infra/production/check-runtime.test.cjs infra/production/staging.test.cjs scripts/production/platform/validate-plan.test.cjs scripts/production/release-certification/collect-evidence.test.cjs scripts/production/release-certification/validate-candidate.test.cjs scripts/production/release-certification/verify-final-join.test.cjs scripts/production/release-certification/prepare-rollout.test.cjs | tee controls.tap
```

Reason: keep the current required check names, cross-platform coverage and
source-bound `controls.tap` artifacts. Preserve `set -euo pipefail`, existing
tests and budgets. The four new suites must reject all prompt-required
negative cases and atomic-output races. No package, dependency, schema,
contract or migration change is requested by this integration.

The owned collector should reuse `.github/scripts/pr-acceptance.mjs` rather
than copy its CI policy. Artifact bytes/provenance, release scope and R34–R37
evidence add requirements beyond that PR validator. Any later shared policy
extension needs a separate exact request; no extension is applied here.

## 3. Resolve the existing R36 rollback request

Reference the existing request at
`docs/production-readiness/r36/shared-change-requests/CR-001-integration.md`.
Its exact documentation target is
`docs/production-readiness/r18/ROLLBACK_RUNBOOK.md`; do not create a competing
launcher or duplicate ownership. A later executable change to
`infra/production/staging.cjs` requires a separate serialized lease and tests
proving zero migrator invocation on application rollback, unchanged digest and
authorization checks, no destructive cleanup and real forward-schema
compatibility. The R38 release decision stays blocked until that proof exists.

## 4. Join Wave 4 before final certification

After R34–R37 finish, freeze the integrated candidate and rerun all applicable
CI, app/payment journeys, reconciliation, target security/load/recovery and
alert evidence. Supply approved browser coverage, hosting inputs, rollback
artifacts, current security findings, operator decisions and explicit release
scope. Any changed source/configuration invalidates mismatched evidence.

The final collector must distinguish source capability, sandbox and hosted
acceptance, R16 marketplace-funds policy, live-money authorization and actual
deployment. No unresolved in-scope blocker is compatible with CONDITIONAL-GO.
Public deployment and live activation still require separate target-specific
owner authorization; this task permits neither.
