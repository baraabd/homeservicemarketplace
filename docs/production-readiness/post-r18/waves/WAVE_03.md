# Wave 3: R29–R33

The complete original lane prompts are recovered. All five packages are
**PLANNED**, and the executable wave remains **BLOCKED**. Its only start gate is
G2. The active `gates/g2/SOURCE_MANIFEST.json` decides technical acceptance;
accepted source evidence and separately verified owner-reviewed publication are
both required before a coordinator can release a lane.

`wave-03.plan.json` is the exact conditional file plan. It is not a ready
manifest, does not prove implementation, and does not authorize a fresh worktree
to start from the historical G1 source or an unreviewed develop head.

## Recovered assignments

Authoritative text and original source identities are retained in the linked
prompts and [`PROMPT_PROVENANCE.md`](../gates/g2/PROMPT_PROVENANCE.md).

| Lane | Sprint and complete prompt                                                                                      | Assigned branch                      | Earlier-wave dependencies | Conditional exact files |
| ---- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------- | ----------------------- |
| 1    | [R29 — Stripe sandbox subscription collections, signed webhooks and refund adapter](../gates/g2/prompts/R29.md) | `feat/r29-stripe-sandbox-webhooks`   | R24, R20, R22, R23        | 24                      |
| 2    | [R30 — Manual subscription payment rails and protected receipt review](../gates/g2/prompts/R30.md)              | `feat/r30-manual-payment-review`     | R24, R20, R21, R22, R23   | 33                      |
| 3    | [R31 — Subscription plans, My Plan and atomic entitlements](../gates/g2/prompts/R31.md)                         | `feat/r31-subscription-entitlements` | R24, R21, R22, R23        | 31                      |
| 4    | [R32 — Refund eligibility, reservations and ambiguous-outcome recovery](../gates/g2/prompts/R32.md)             | `feat/r32-refund-recovery`           | R24, R22, R23             | 21                      |
| 5    | [R33 — Financial read models and Admin/Provider operations UI](../gates/g2/prompts/R33.md)                      | `feat/r33-financial-operations-ui`   | R24, R20, R23             | 29                      |

The exact lists include dedicated real-service test paths and each lane's
implementation, acceptance, risk, rollback, ownership and shared-change-request
records. They are a bounded initial file design, not a requirement to create
empty files. The assigned writer inspects the actual frozen tree and records
any necessary exact extension before writing outside the list.

## Existing authorities and integration boundary

The inspection base is `96e92825f9b65cf124317f43b55ce42fc97f5b49`, tree
`68f4e926eabeb37bb70382c62b75272cf67bd02c`. This identifies package inspection
only; it does not assign the eventual Wave 3 execution base.

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
