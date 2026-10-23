# Dependency upgrade hold for PR #188

## Decision and scope

Defer the Zod 3-to-4 upgrade in PR #188. Restore `apps/api/package.json`
and `pnpm-lock.yaml` byte-for-byte from develop
`5ff2b7e6a46b4e42114184fac89928372f4c8d4c`.
This is a dependency-upgrade deferral, not a successful Zod 4 migration.

The owner requested repair of the open PR before G3 and R34. The current R27
experiment requires equal dependency digests for its immutable baseline and
candidate. Its repair-baseline job also requires the PR base lockfile to match
the candidate harness. PR #188 changes that experimental input. Updating PR
metadata alone cannot satisfy the measured-performance gate.

## Observed failures

- Head: `88c4fb7186d6d64ed07b518d5fcc54de41fbce2d`.
- Governance run `40016123505`, job `120628504615`: all fourteen required PR
  metadata fields were absent. The corrected body passes the existing metadata
  validator; the subsequent commit requires a new Final SHA in that body.
- R27 run `40016123413`, job `120628504400`: the immutable repair-baseline
  checkout is the correct develop SHA, but
  `cmp --silent pnpm-lock.yaml ../harness/pnpm-lock.yaml` exits 1. Missing
  artifacts are a consequence of
  stopping before measurement.
- The unchanged comparison and acceptance programs also reject unequal
  `lockfileSha256` values. Removing only the early comparison would not
  establish a comparable experiment.

## Corrective change

Restore the two existing dependency blobs together, without regenerating or
hand-editing the lockfile. Retain the existing Zod 3.25.76 API resolution and
all reviewed dependency overrides. Do not alter R27 source checks, budgets,
assertions, measurement jobs, CodeQL, security audit policy or Dependabot
configuration. This file is the only net change relative to the PR base.

All final-head CI remains required. Earlier-head successful checks cannot
validate the corrective commit. Local validation covers the unchanged metadata
validator and R27 workflow/acceptance regressions only; local application,
database, browser and security checks are not claimed.

## Follow-up and rollback

The coordinator should prepare a separately reviewed dependency experiment
before resubmitting Zod 4: immutable dependency-matched controls, authenticated
source/tree and lock digests, migration compatibility checks, full real-service
and browser measurements, unchanged budgets, and fresh security results.
Historical measurements must not be relabelled as evidence for new dependencies.
Dependabot remains enabled; this document does not suppress advisories or
future version proposals.

To resume the upgrade, submit a new reviewed PR restoring the intended package
and lockfile changes together with its comparable experiment and evidence.
Reverting this correction alone would reintroduce the recorded R27 failure.
G3 and R34 remain independently blocked until their actual dependencies and
integration evidence are accepted.
