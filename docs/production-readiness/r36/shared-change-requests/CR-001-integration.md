# CR-001 — G3 prerequisites and migration-free rollback instructions

Status: **REQUESTED; NOT APPLIED**. Requester: R36 preflight session
`r36-d86d02f90f5c`. Shared files remain coordinator-owned. No interface,
migration, dependency or launcher behavior changes in this PR.

## Exact minimal shared documentation patch

Path: `docs/production-readiness/r18/ROLLBACK_RUNBOOK.md`.
Reason: its instruction to rerun the old launcher contradicts the requirement
not to run the old migrator. In the inspected source,
`infra/production/staging.cjs` executes the `migrations` phase unconditionally
inside `applyRelease`, before API/web replacement.

```diff
@@
-1. Re-run the launcher with the previous release JSON (the recorded
-   rollback digests for API, migrator and web).
-2. Do not run the previous migrator: migrations are forward-only and each
-   release so far has been additive, so the previous application runs on the
-   newer schema.
+1. Stop: the current staging launcher always runs api-migrate. Do not use
+   an old release JSON with --apply as an application-only rollback.
+2. After separate authorization, use a reviewed migration-free rollback
+   path for the prior accepted API/web digests. Prove compatibility against
+   the actual forward schema before cutover; retain migration history and
+   the migrator digest as lineage without running the previous migrator.
```

Tests/verification: inspect the actual launcher call graph and existing
`infra/production/staging.test.cjs`; verify the corrected document does not
advertise an unimplemented flag or claim a rehearsal. A future executable
rollback change must test zero migrator invocation, no volume/database reset,
no automatic retry after partial failure, unchanged digest validation and
forward-schema compatibility against real images. Keep R36 scripts separate
from `infra/production/staging.cjs`. Any later launcher integration needs a
new exact serialized patch and lease. Schema/dependency consequences: none
for this documentation patch.

## Gate handoff

The separate G3 writer owns
`docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json`,
`docs/production-readiness/post-r18/waves/wave-04.plan.json` and shared status
registries. R36 does not modify them. Required actions before runtime work:

1. Integrate and demonstrate real R29 Stripe sandbox collection/webhook/refund
   behavior and the effective R32 policy/confirmation participants. Preserve
   registered R30/R31/R33 authority and live-money-off defaults.
2. Run all seven unchanged G3 evidence categories on one combined source,
   including the R27 comparable-performance acceptance and official CodeQL.
   Bind full source/tree, run/artifact IDs and hashes; retain actual failures.
3. Obtain owner review/merge of the acceptance publication and verify it.
   Only then fill the Wave 4 frozen base and exact session assignment.
4. Approve R36's target identities, recovery set, retention/hold/deletion and
   key references, schedule, RPO/RTO, incident owner and independent cutover
   authorization. Proposed numbers do not constitute approval.

PR #188's original Zod upgrade broke equal-lock comparison. Another active
session has deferred that upgrade at
`482a368b6417215354a325b66d372bb25d4f68e1`; R36 neither overwrites that work nor
removes the comparison assertion. Fresh CI remains required. A future Zod 4
upgrade needs its separately reviewed dependency-comparable experiment.

## R36-owned work after release of the gate

Use the exact files already enumerated by the Wave 4 plan. Extend recovery
verification around R20 inventory rather than creating another storage
authority. Test required historical versions and loss of decrypt capability;
latest-live-object equality alone is insufficient. Add explicit physical
isolation and outbound-denial evidence before restoring a representative
dataset, then measure RPO from known writes and RTO through useful service.
