# R32 — Exact ownership and verified G2 publication

## Execution authority and identities

Mode A: backend integration and correctness. The owner requested the attached
R32 implementation on 2026-10-23 and previously delegated G2 coordination and
preparation of review PRs, without merge or deployment. The delegated coordinator
for this execution is `/root`; session `r32-20261023-1db81624b1de` is the sole R32
writer. Subtasks below are exclusive file assignments within this one session.

- Worktree: `/workspace/scratch/1db81624b1de/hsm-r32`.
- Branch: `feat/r32-refund-recovery`.
- Actual frozen base: `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`.
- Base tree: `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`.
- G2 PR: <https://github.com/baraabd/homeservicemarketplace/pull/183>.
- Reviewed publication head: `d2c0a9ab8862ffff886346a21377839f996152ca`.
- Owner merge: `986b4707776711e80564f0642133ede90ba16f3c`, by `baraabd`,
  at `2026-10-23T04:11:34Z`; publication tree
  `7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`.

The coordinator independently read the PR, comparison and complete postmerge
check inventory through GitHub. The accepted source is the merge base of the
publication (ahead 2, behind 0); its 13 intervening changes are records only.
All 30 postmerge checks are completed/success, including CI run `39899003702`,
governance `39899003864` and CodeQL workflow `39899003733`. Owner merge is the
observed approval action; no separate human APPROVED review is claimed.

The coordinator approves the following exact ownership before runtime edits.
Canonical publication/assignment records are reconciled first, using the already
owner-merged record bytes and observed facts. No peer runtime branch is imported,
no new merge is performed, and the frozen runtime base remains unchanged.

### Publication history fast-forward (R32-G2-02)

At 2026-10-23 05:04 UTC, the coordinator reverified that `develop` still points
to owner-merged `986b4707776711e80564f0642133ede90ba16f3c`. The unchanged R27
repair-baseline check requires the PR base to be an ancestor of the submitted
head. The coordinator therefore authorizes advancing only this session's
unpublished, uncommitted branch from the frozen source to that already accepted
publication before the first R32 commit. This is a fast-forward of existing
history, with no merge commit, rebase, force push or change to `develop`.

The 13 intervening paths are exactly the record-only R32-G2-01 allowlist below.
Application/runtime, packages, lockfile, schema, contracts, scripts, infra and
CI blobs are identical; the complete Git trees differ because of those records.
Checkpoint every changed tracked/untracked file, preserve all working bytes,
advance the branch/index baseline only, and verify identical checkpoint hashes
before resuming edits. The publication comparison baseline is `986b470...`;
all canonical frozen-source identities remain `72b4aaeb...` in full above.

## Lane files

The following 21 paths are the pre-existing conditional R32 allowlist, now
assigned exclusively to this session after verified G2 publication:

```text
apps/api/src/modules/money/refunds/refund-eligibility.policy.ts
apps/api/src/modules/money/refunds/refund-eligibility.policy.spec.ts
apps/api/src/modules/money/refunds/refund-orchestrator.service.ts
apps/api/src/modules/money/refunds/refund-orchestrator.service.spec.ts
apps/api/src/modules/money/refunds/refund.controller.ts
apps/api/src/modules/money/refunds/refund.controller.spec.ts
apps/api/src/modules/money/refunds/refunds.module.ts
apps/api/src/modules/money/refunds/refunds.module.spec.ts
apps/api/src/modules/money/recovery/refund-recovery.service.ts
apps/api/src/modules/money/recovery/refund-recovery.service.spec.ts
apps/api/src/modules/money/recovery/refund-outbox.consumer.ts
apps/api/src/modules/money/recovery/refund-outbox.consumer.spec.ts
apps/api/test/integration/r32-refund-recovery.integration.spec.ts
scripts/production/refund-recovery/inspect.cjs
scripts/production/refund-recovery/inspect.test.cjs
docs/production-readiness/r32/IMPLEMENTATION.md
docs/production-readiness/r32/ACCEPTANCE.md
docs/production-readiness/r32/RISKS.md
docs/production-readiness/r32/ROLLBACK.md
docs/production-readiness/r32/OWNERSHIP.md
docs/production-readiness/r32/shared-change-requests/CR-001-integration.md
```

Unused proposed files need not be created. The policy implementation and its
unit tests are assigned to `/root/refund_review`; all other runtime source is
owned by `/root` until an explicit handoff below. No schema, migration, lockfile,
public contract or sibling lane file is in this allowlist.

### Exclusive subtask handoff after readiness

After `g2-record.mjs --ready R32` passed, the coordinator assigned
`apps/api/test/integration/r32-refund-recovery.integration.spec.ts` exclusively
to `/root/runtime_setup`. After returning R32-G2-01, `/root/pr_audit` owns only
these six lane files for operator recovery and inspection:

```text
apps/api/src/modules/money/recovery/refund-recovery.service.ts
apps/api/src/modules/money/recovery/refund-recovery.service.spec.ts
apps/api/src/modules/money/refunds/refund.controller.ts
apps/api/src/modules/money/refunds/refund.controller.spec.ts
scripts/production/refund-recovery/inspect.cjs
scripts/production/refund-recovery/inspect.test.cjs
```

No subtask may commit, publish or edit the other's files. Each returns its
lease after scoped checks; `/root` performs integration and publication.

All subtask source leases were returned before publication: policy 64 unit
tests; recovery/controller 66 tests and CLI 52 tests; real R32 PostgreSQL/Redis
suite 25 tests. `/root` is now the sole writer for final integration/evidence.

## Serialized shared integration lease R32-CORE-01

The coordinator grants `/root` a bounded exclusive lease over these exact files:

```text
apps/api/src/modules/money/application/money-command.service.ts
apps/api/src/modules/money/application/money-command.service.spec.ts
apps/api/src/modules/money/money.module.ts
apps/api/src/modules/money/money.module.spec.ts
apps/api/src/app.module.ts
apps/api/src/app.module.spec.ts
apps/api/test/support/r24-money-http.fixture.ts
apps/api/test/integration/r24-money-api.integration.spec.ts
```

Purpose: atomically persist the existing reservation, dispatch identity and R22
outbox event; enforce query-first uncertain recovery; invoke the already frozen
confirmed-refund participant inside the compensation transaction; register the
owned module/consumer once; preserve existing regression assertions while
supplying the now-required confirmation participant as a labeled test double.
The reviewed correction also rechecks the original posting under the R15
reversal-compatible lock, records a deduped existing reconciliation exception
when confirmed success cannot be compensated, recovers later durable reviewer
authority, and redacts unexpected audit/storage errors. Regression assertions
now require safe typed errors and preserve every financial rollback assertion.
The concrete patch contract is in `shared-change-requests/CR-001-integration.md`.
No other lane edits these shared files during this lease. It expires on R32 PR
closure, G3 integration or coordinator revocation, whichever occurs first.

## Serialized publication lease R32-G2-01

The coordinator assigns `/root/pr_audit` the following exact record-only files.
Copy the coherent accepted records from the already owner-merged publication,
then reconcile verified publication and R32 session fields; do not change
accepted-source identities or historical check results:

```text
docs/production-readiness/post-r18/ACTIVE_STATUS.md
docs/production-readiness/post-r18/SPRINT_REGISTRY.json
docs/production-readiness/post-r18/gates/g2/ACCEPTANCE.md
docs/production-readiness/post-r18/gates/g2/ACCEPTANCE_EVIDENCE.json
docs/production-readiness/post-r18/gates/g2/BLOCKERS.md
docs/production-readiness/post-r18/gates/g2/IMPLEMENTATION.md
docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json
docs/production-readiness/post-r18/gates/g2/evidence/r25-summary.json
docs/production-readiness/post-r18/gates/g2/evidence/r26-summary.json
docs/production-readiness/post-r18/gates/g2/evidence/r27-summary.json
docs/production-readiness/post-r18/gates/g2/evidence/source-provenance.json
docs/production-readiness/post-r18/waves/wave-02.closeout.json
docs/production-readiness/post-r18/waves/wave-03.plan.json
```

Other Wave 3 lane assignments remain untouched; this session cannot claim their
implementation or acceptance. R34–R38 remain behind G3. This lease expires when
the author returns it to the coordinator after canonical validators pass.

## Isolated verification resources

Task-local Node 24.21.0 and pnpm 10.32.1 are used through a process-local PATH;
no machine-wide runtime change. Independent node_modules, generated Prisma,
build outputs and `/tmp/hsm-r32-pnpm-store`. A new PostgreSQL 16.14 cluster at
`/tmp/hsm-r32-postgres`, port 5532, and a separate Redis instance on port 6432
are authorized for disposable test databases only. The task DB role may create
only databases in that dedicated cluster. Random credentials remain outside Git
in private scratch files. Fixtures create unique databases and storage roots;
no user database, shared volume, Redis flush or unrelated process is touched.

No UI changes are assigned. Approved commercial refund policy, real R29/R30
adapters and the approved paid-entitlement consequence remain separate
dependencies. Test doubles cannot establish returned funds or sandbox rail
acceptance. R16/R18 and live-money restrictions remain in force.
