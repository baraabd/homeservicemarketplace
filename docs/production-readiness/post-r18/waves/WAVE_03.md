# Wave 3: R29–R33

G2 technical acceptance and the owner-merged PR #183 publication are verified.
The frozen runtime source is `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`, tree
`43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`. The separate publication commit is
`986b4707776711e80564f0642133ede90ba16f3c`; its metadata-only ancestry and
postmerge checks are recorded in `gates/g2/PUBLICATION_VERIFICATION.json`.

**R30 alone is READY_TO_START** under root session `hsm-r30-590834e66da5` on
`feat/r30-manual-payment-review`. The renewed owner request supplies its source
implementation authority. R29, R31, R32 and R33 remain PLANNED with unassigned
sessions; their records and conditional ownership are preserved.

`wave-03.plan.json` is the exact source-start contract. A readiness status does
not accept R30 implementation or activate a payment method. The existing
metadata-only publication is the checkout start; the frozen runtime identity
above remains authoritative. No historical G1 or moving-branch base is used.

## Recovered assignments

Authoritative text and original source identities are retained in the linked
prompts and [`PROMPT_PROVENANCE.md`](../gates/g2/PROMPT_PROVENANCE.md).

| Lane | Sprint and complete prompt                                                                                      | Assigned branch                      | Earlier-wave dependencies | Conditional exact files |
| ---- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------- | ----------------------- |
| 1    | [R29 — Stripe sandbox subscription collections, signed webhooks and refund adapter](../gates/g2/prompts/R29.md) | `feat/r29-stripe-sandbox-webhooks`   | R24, R20, R22, R23        | 24                      |
| 2    | [R30 — Manual subscription payment rails and protected receipt review](../gates/g2/prompts/R30.md)              | `feat/r30-manual-payment-review`     | R24, R20, R21, R22, R23   | 58                      |
| 3    | [R31 — Subscription plans, My Plan and atomic entitlements](../gates/g2/prompts/R31.md)                         | `feat/r31-subscription-entitlements` | R24, R21, R22, R23        | 31                      |
| 4    | [R32 — Refund eligibility, reservations and ambiguous-outcome recovery](../gates/g2/prompts/R32.md)             | `feat/r32-refund-recovery`           | R24, R22, R23             | 21                      |
| 5    | [R33 — Financial read models and Admin/Provider operations UI](../gates/g2/prompts/R33.md)                      | `feat/r33-financial-operations-ui`   | R24, R20, R23             | 29                      |

R30 currently reserves 58 exact lane/evidence paths plus one 42-path
serialized root integration lease, including the single schema/migration
writer. Its complete per-writer mapping is `r30/RUNTIME_OWNERSHIP.json`.
Unused reserved paths need not be created.

The exact lists include dedicated real-service test paths and each lane's
implementation, acceptance, risk, rollback, ownership and shared-change-request
records. They are a bounded initial file design, not a requirement to create
empty files. The assigned writer inspects the actual frozen tree and records
any necessary exact extension before writing outside the list.

## Existing authorities and integration boundary

The historical package inspection base is
`96e92825f9b65cf124317f43b55ce42fc97f5b49`, tree
`68f4e926eabeb37bb70382c62b75272cf67bd02c`. R30 was re-inspected against the
accepted G2 runtime source and its verified publication before this handoff.
The machine manifests retain the accepted full runtime source above.

R24 already owns durable payment attempts, verified external-event inbox,
confirmation, reservation/dispatch/result orchestration and the caller's
transaction boundary. R19's immutable ledger and subscription period persistence
remain authoritative. R29 and R30 implement the existing collection/refund
ports. R31 supplies the transaction-bound activation participant and extends
existing plan, period and usage models; it does not recreate quotes, collections
or a second activation engine. R32 retains its original 21-file conditional
package and targets the frozen refund policy/adapter/confirmation-participant
ports. R33 composes the existing finance read port and query service, keeping
booking prices separate from actual confirmed collections.

The coordinator alone composes shared module providers, real routes, raw-body
parsers, environment flags, SDK pins, published contracts, schemas/migrations,
existing Admin/Provider entrypoints and CI. Each lane publishes its minimal
exact patch under its own `shared-change-requests/` path. A lane cannot import
an unmerged peer to make its tests compile. The complete R29/R30/R31/R32/R33
interaction is a G3 integrated-candidate responsibility.

## Start and evidence conditions

The coordinator verifies a full frozen source/tree, all mandatory G2 evidence,
dependency acceptance, recorded exact ownership, and a separate verified merged
G2 acceptance publication before changing a lane to `READY_TO_START`. Technical
G2 acceptance in an unmerged review record leaves the wave blocked. A successful
record validator checks consistency; it does not authenticate remote artifacts
or grant owner approval.

Each released lane starts its assigned clean worktree with independent
dependencies, generated Prisma output, build/cache directories and the planned
database/user, Redis, storage, queue, container/volume and port identities. The
runtime entries are unallocated templates. Session tags and effective
configuration checks are mandatory. Separate browser contexts and host-only
cookies on separate hosts are required; changing only a localhost port does not
isolate cookies. See [`OWNERSHIP_R29_R38.md`](OWNERSHIP_R29_R38.md).

Each lane retains the full prompt's negative, concurrency, real-service and
browser requirements. Contract doubles are labeled component evidence. Actual
Stripe sandbox confirmation, protected manual review, atomic activation,
ambiguous refund recovery and actual finance UI/controller wiring must meet the
separate [G3 requirements](../gates/g3/REQUIREMENTS.md) on one integrated source.
Missing sandbox credentials or policy remains an explicit owned blocker.

R16 payout and R18 release/verification decisions remain unresolved where
recorded. Subscription revenue is not provider withdrawable earnings; plan
purchase grants neither identity verification nor work access. No production
flag, live rail, merchant account, hosted resource, merge or deployment is
authorized by this package.
