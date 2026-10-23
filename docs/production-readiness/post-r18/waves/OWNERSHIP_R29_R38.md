# R29–R38 exact ownership and session handoff

## Active R30 handoff — 2026-10-23

Only R30 is assigned to root session `hsm-r30-590834e66da5` after independently
verified owner publication of G2 through PR #183. The frozen runtime source is
`72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`; the metadata-only publication
checkout begins at `986b4707776711e80564f0642133ede90ba16f3c`. Exact lane files
and serialized shared leases are mirrored in `wave-03.plan.json` and
`SPRINT_REGISTRY.json`; individual writers are assigned by root in
`docs/production-readiness/r30/OWNERSHIP.md` before source edits. Root alone
owns schema/migrations and global runtime composition. Runtime allocation is
recorded separately before any real-service execution.

Other R29/R31–R38 records remain unchanged and conditional. R30 source readiness
is not implementation acceptance, live-method approval, hosting authorization,
resource spend, an account grant, permission to merge or permission to deploy.
The earlier package-inspection details below remain historical provenance.

## Authority, source and effect

The owner-delegated G2 successor coordinator records this bounded package on
2026-10-22 under the exact governance lease in
[`g2/OWNERSHIP.md`](../gates/g2/OWNERSHIP.md). The complete original prompt pack
was recovered with SHA-256
`bf82bef2f6417450b5c411f1f396f39ef966c4dbfb00747edd1e6c6c60798920` and 262,508
bytes. Authoritative extracts and provenance are in
[`g2/PROMPT_PROVENANCE.md`](../gates/g2/PROMPT_PROVENANCE.md).

The real tree inspected for ownership is
`96e92825f9b65cf124317f43b55ce42fc97f5b49`, tree
`68f4e926eabeb37bb70382c62b75272cf67bd02c`. This is an inspection identity, not
an executable frozen source for Wave 3 or Wave 4. No future implementation file
is created by declaring it in a plan.

Exact files are enumerated in `wave-03.plan.json` and `wave-04.plan.json` and
mirrored in `SPRINT_REGISTRY.json`. The existing 21-file R32 package is retained.
All ten full prompts now supply the remaining titles and assignments; reserved
shorthand never substitutes for source authority.

For R29–R33, ownership becomes executable only after accepted exact-source G2
evidence, separate owner-reviewed verified merged G2 publication, and an actual
coordinator session assignment. For R34–R38 the equivalent condition is G3.
Every unassigned lane remains `PLANNED` and its plan lane remains `BLOCKED`
until these conditions are met. R30 has met the publication/session conditions
under the active handoff above. A future session must inspect the actual frozen tree before
its first edit and record an exact extension if implementation needs other
files. Unused planned files need not be created.

## Authority reuse and minimal module rationale

| Lane | Inspected existing authority                                                                                                                                 | Bounded extension and integration boundary                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R29  | `money/ports/collection.port.ts`, `refund.port.ts`, `application/money-command.service.ts`, `MoneyExternalEvent` and `MoneyDispatch` persistence             | Stripe transport and signed envelope normalization use current durable attempt/inbox/dispatch authority. No second inbox, settlement decision or payment history. SDK/version, raw-byte parser and module wiring require coordinator patches. |
| R30  | Existing receipt acceptance port, immutable `MediaAsset` storage/scan state, R24 commands and durable notifications                                          | Manual transport and receipt-review participant plus its own UI subtree. No public receipt store or identity-case reuse. Receipt scans and independent operator confirmation remain required.                                                 |
| R31  | `SubscriptionPlanVersion`, `ProviderSubscription`, `SubscriptionPeriod`, `MoneyEntitlementUsage`, existing quote service and `SubscriptionActivationService` | Plan-version authoring, lifecycle/usage and the transaction-bound participant complete existing authorities. The participant must not recreate period/ledger confirmation; My Plan reads durable server state.                                |
| R32  | Existing refund policy, adapter and confirmation participant ports; reservation/dispatch/result commands and immutable ledger                                | Refund policy/recovery services compose frozen ports. The retained exact list does not authorize changes to R29/R30/R31 or a second refund table/ledger.                                                                                      |
| R33  | `MoneyFinanceReadPort`, `MoneyQueryService`, current Admin `FinancialsSection.tsx` and Provider `WalletScreen.tsx`                                           | Reporting/export and UI compose current read contracts. Existing monolithic entrypoints stay with the coordinator. R34 exceptions are a frozen read contract until reconciliation is implemented.                                             |
| R34  | Accepted Wave 3 rails, financial state and R33 exception contract, re-inspected after G3                                                                     | Reconciliation and operator exception handling extend actual prior-wave authority. Missing statements are not zero difference; posted history is immutable.                                                                                   |
| R35  | Existing normal login/API/browser fixtures and accepted Wave 3 journeys                                                                                      | Dedicated acceptance harnesses only. Product repairs return to their owning coordinator. No mocked browser routes as persistence evidence.                                                                                                    |
| R36  | Existing staging topology, R20 storage inventory and R18 backup/rollback runbooks                                                                            | Dedicated recovery scripts and checked templates. No alternate launcher, live destination selection or automatic financial reversal.                                                                                                          |
| R37  | R23/R25/R26/R27/R28 accepted interfaces and approved target inputs                                                                                           | Hosted security/load/failure harnesses only. Declared target/operator/window/budgets precede execution. No peer runtime edits.                                                                                                                |
| R38  | Existing release inputs, R16/R18/live-money decisions, accepted source/evidence contracts                                                                    | Collector/validator and rollout preparation; serialized final evidence join after peers. No future PASS, owner approval or deployment is fabricated.                                                                                          |

Paths in the first column are read targets, not leases. Global money composition,
public workspace contract exports, schema/migrations, root manifests/locks,
AppModule/main/environment, routes/Root, existing screens, CI, Docker/Compose,
edge entrypoints and central registries stay coordinator-owned. A precise
shared-change request names path, minimal patch, reason, tests and any
migration/dependency consequences before integration or a new serialized lease.

## Dedicated tests and conditional infrastructure files

The exact JSON lists explicitly approve the dedicated R29/R30/R31/R32/R33/R34
API integration files, R30/R31/R33/R34 browser subtrees and R35 certification
tests shown there, in addition to tests beside owned source. This does not
authorize shared Jest/Playwright discovery, global configuration or unlisted
peer-fixture edits; those are coordinator integration requests.

The active R30 handoff additionally contains one 44-path root integration
lease copied from `r30/RUNTIME_OWNERSHIP.json`; root is the only Wave 3 schema
writer. The nine exact infrastructure files below remain future conditional
leases.
Each JSON lease names the complete source prompt, G3 acceptance and verified
publication prerequisite, conditional session assignment, scope, expiry and
handoff. The leases cover file authoring only and expire at the earliest of lane
PR closure, R38/G4 decision or coordinator revocation.

| Lane | Exact conditional lease files                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R36  | `infra/production/recovery/README.md`; `infra/production/recovery/recovery-inputs.schema.json`; `infra/production/recovery/recovery-set.template.json`                             |
| R37  | `infra/production/hosted-acceptance/README.md`; `infra/production/hosted-acceptance/target-authorization.schema.json`; `infra/production/hosted-acceptance/workload.template.json` |
| R38  | `infra/production/release-certification/README.md`; `infra/production/release-certification/candidate.schema.json`; `infra/production/release-certification/rollout.template.json` |

No account, grant, payment processor, approved market/currency, external spend,
hosting target, scan/load window, secret, production flag, migration execution,
merge or deployment is granted by a file lease. R36/R37/R38 separately record
real operator/resource authority where required by their prompts.

## Isolation and single-writer handoff

R30's `isolatedRuntime` now records its task-owned real services and ephemeral
HTTP/browser fixture; see `r30/OWNERSHIP.md`. Other lanes remain unallocated
templates, including unique
lane/session database and user, queue names, storage prefixes, Compose project,
ports and hostnames. Assign them only after the gate releases the lane; inspect
effective container names and explicit volume names before running. Neither a
Compose project name nor a localhost port alone proves isolation. Use separate
Seeker/Provider/Admin browser contexts and lane hosts with host-only cookies.

Each worktree has independent dependencies, generated Prisma output, build
artifacts, caches and evidence. Do not change another worktree's branch/runtime,
reset its database, flush shared Redis, copy unreviewed environment files,
expose private media or kill unrelated processes. The coordinator may serialize
heavy real-service checks while source authors work in parallel.

Before handoff, publish exact base/head/tree, changed paths, contracts/schema,
command exit codes/counts, inspected sanitized artifacts and explicit blockers.
Return an exclusive lease before reassignment. Source imports from unmerged
same-wave peers are prohibited. R38's R34–R37 relationship is a final evidence
join only; five sessions cannot independently certify a changing combined
release candidate.
