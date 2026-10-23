# R31 ownership and start authorization

## Session and authority

The owner requested execution of the supplied R31 prompt on 2026-10-23. The
standing owner delegation for G2 coordination permits verified publication
reconciliation, exact writer assignment, scoped fixes and a review PR. It does
not permit merging, deployment, external spend, production permission grants or
live money activation. Root is the accountable engineering coordinator.

Session: `r31-20261023-d799cbee`. Assigned branch:
`feat/r31-subscription-entitlements`. Isolated worktree:
`/workspace/scratch/d799cbee324b/r31`.

Actual branch-start and G2 frozen source:
`72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`; tree:
`43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`.

GitHub confirms owner-merged G2 PR #183 at
`986b4707776711e80564f0642133ede90ba16f3c` on
2026-10-23T04:11:34Z. Its reviewed head is
`d2c0a9ab8862ffff886346a21377839f996152ca`; both have tree
`7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`. The accepted source is an ancestor;
the complete descendant difference contains thirteen evidence/registry files
and no product code. The coordinator may apply those exact already-merged
record blobs to this frozen-source worktree before reconciling publication.
This imports no unmerged peer implementation and changes no frozen contract.

Mode C applies to the bounded subscription feature. Mode A applies to the
G2 record reconciliation and required shared composition.

## Single writers, recorded before edits

Root owns this file, the sprint evidence files, shared-change requests, and all
subsequently recorded shared integration leases. No other writer may edit them.
Product writers remain read-only until the coordinator confirms that the
unchanged G2 readiness validator accepts this exact session assignment.

Activation: root independently ran `node .github/scripts/g2-record.mjs --ready
R31` after the publication reconciliation and observed exit 0, accepted G2 and
`READY_TO_START` Wave 3. The two named product writers may now edit only their
finite assigned files. Root retains all shared composition and commit duties.

The initial product scope is the R31 `exactFiles` list in the owner-published
`docs/production-readiness/post-r18/waves/wave-03.plan.json`:

- `r31_backend`: its sixteen API files under
  `apps/api/src/modules/money/subscriptions/` and
  `apps/api/src/modules/money/entitlements/`, plus
  `apps/api/test/integration/r31-subscription-entitlements.integration.spec.ts`.
- `r31_frontend`: its seven files under
  `apps/web/src/app/features/subscriptions/`, plus
  `apps/web/e2e/r31-subscriptions/my-plan.real-api.spec.ts`.

These are finite file lists, not blanket directory leases. Exact extensions
must be recorded here and in the wave/registry before their first write.

## Coordinator publication reconciliation lease

Root grants `pr_ci_audit` one exclusive serialized lease for the following
exact coordinator files, after root applies the thirteen already-merged blobs:

- `docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g2/PUBLICATION_VERIFICATION.json`
- `docs/production-readiness/post-r18/gates/g2/OWNERSHIP.md`
- `docs/production-readiness/post-r18/gates/g2/BLOCKERS.md`
- `docs/production-readiness/post-r18/gates/g2/IMPLEMENTATION.md`
- `docs/production-readiness/post-r18/waves/wave-03.plan.json`
- `docs/production-readiness/post-r18/waves/WAVE_03.md`
- `docs/production-readiness/post-r18/waves/OWNERSHIP_R29_R38.md`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`

Scope: document the independently observed owner merge and unchanged source;
assign only this R31 session and the finite approved files; keep peer lanes
held without assigning them. Preserve accepted-source hashes, evidence,
budgets, validators, policy holds and all runtime defaults. Do not fabricate
new tests or peer acceptance. The lease ends on handoff to root; no remote
write or commit is delegated.

## Runtime isolation

Dependencies, generated Prisma client, builds and caches belong to this
worktree. Any disposable runtime uses the `r31_20261023_d799cbee` identity,
API port 4331, web port 4431, PostgreSQL port 5531 and Redis port 6431.
Actual provisioning and effective configuration must be checked before use.
No existing user database, shared Redis flush, production storage or copied
user environment is authorized. Browser contexts and host-only cookies are
separate. No production currency, price or commercial policy is inferred.

## Lease expiry

All leases end on R31 PR closure or explicit coordinator revocation. Shared
schema/contracts/routes/composition remain coordinator-owned and require a
concrete recorded request before any edit. R31 completion is distinct from
G3 integrated collection evidence and from hosted/release acceptance.

## Shared integration lease — root only

The publication-record writer returned its lease. Before product integration,
root records this exact serialized lease in both canonical wave and registry.
No other writer may edit these files.

- `packages/contracts/src/money/subscription-contracts.ts`
- `packages/contracts/src/money/index.ts`
- `apps/api/src/modules/money/money.module.ts`
- `apps/api/src/modules/money/money.module.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/app.module.spec.ts`
- `apps/api/src/infrastructure/outbox/outbox.tokens.ts`
- `apps/web/src/app/routes.ts`
- `apps/web/src/app/components/provider/screens/ProviderProfileScreen.tsx`
- `apps/web/playwright.config.ts`
- `.github/workflows/ci.yml`

Purpose and verification are in CR-001. No database schema change, automatic
permission grant, production policy, dependency update or live rail is granted.

## Dedicated browser verification sublease

After G2 document handoff, root grants `pr_ci_audit` these three additional
exact R31 test-only files, mirrored in the wave and registry before edits:

- `apps/api/test/support/r31-browser.fixture.ts`
- `scripts/production/subscriptions/verify-my-plan.cjs`
- `apps/web/playwright.r31.config.ts`

Use real AppModule, the existing disposable database helper, PostgreSQL,
Redis and real browser requests. Configuration/collection doubles are labeled
as contract fixtures, never rail collection evidence. No production debug
route, auth bypass, shared database reset or fixed secret may be added. The
script must enforce nonproduction loopback targets, checked exits, independent
storage and bounded process cleanup. Do not edit frontend-owned browser spec.
Root retains CI registration. Lease ends at test-harness handoff.

## Approved internal lifecycle receipt namespace

R31 may use the already-frozen immutable `MoneyCommand` persistence for named
policy operations in the caller transaction: actor system
`money.subscription-lifecycle`, `r31_` hashed keys, canonical request digest,
operation and affected period identity. Replays cannot reapply old cancellation
or refund effects to a renewed period. Defaults remain policy-blocked and no
new public write endpoint is granted. Before edits, root exclusively leases:

- `apps/api/src/modules/money/application/money-command.service.ts`
- `apps/api/src/modules/money/application/money-command.service.spec.ts`

The only R24 change reserves `r31_` from user keys and adds its negative case.
Existing prefixes, financial behavior and tests remain. No migration or new
persistence authority is introduced.

## Approved composition-test fixture repair

Root holds the exclusive serialized lease for
`.github/scripts/merge-integrity.test.mjs` before the first edit. Adding the
SubscriptionsModule causes the formatter to wrap the MoneyModule imports;
the existing negative fixtures depend on an obsolete single-line string.
Change only fixture construction to target the declared imports/exports
arrays across whitespace, assert each mutation actually changes the source,
and retain all existing missing/duplicate/export rejection assertions. The
production composition fence, required gates and test coverage remain intact.
The same exact lease is recorded in the wave and sprint registry.

## Verified local runtime allocation

PostgreSQL 16.15 runs as an unprivileged task-owned process on loopback 5531;
Redis 7.0.15 runs in an owned managed process session on loopback 6431.
The disposable database administrator is `r31_db_admin`; base database
`r31_20261023_d799cbee` and generated fixture databases are task-owned. Real
query/PONG checks passed. API 4331 and web 4431 are reserved and checked for
existing listeners before each harness run. The browser uses fresh isolated
contexts at `http://127.0.0.1:4431`; no other lane uses this runtime.
Credentials, mailboxes and temporary bundles stay outside Git. No shared
Redis flush, production database, hosted resource or global runtime change
is authorized. The plan's nested runtime record now reflects actual values.

## Publication transport and committed ancestry

The isolated branch started at the frozen source72, as recorded above. The
GitHub connector is the authenticated publishing capability; the shell has no
GitHub write credential. Before publication, root stages only the approved
files and executes the repository's actual `.husky/pre-commit` gate against
that index, without disabling hooks or changing their commands. The reviewed
candidate tree is secret-scanned and compared to the GitHub-created tree.

The connector creates the feature commit on the already verified, owner-merged
G2 publication `986b4707776711e80564f0642133ede90ba16f3c`, whose only changes
since the frozen source are the thirteen approved record files already
reconciled in this worktree. This retains source72 as an ancestor, introduces
no peer implementation and keeps the PR current with the accepted develop
publication. Root adopts that identical tree by a checked fast-forward on
this same assigned branch; no reset, rebase, force push or protected-branch
merge is authorized. The actual final SHA/tree will be verified from the
remote commit, local checkout and final-head CI.
