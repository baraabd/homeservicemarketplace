# R34 CR-001 — Gate, persistence and Admin exception integration

Status: **REQUEST ONLY / NOT APPLIED**. No shared-file lease is granted.

## G3 correction and prerequisite handoff

Do not change the gate decision or fill a frozen SHA from an observation.
The exact coordinator-owned path
`docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json` still says
all R29 paths are absent. Minimal proposed record correction: replace the
`G3-R29-IMPLEMENTATION-MISSING` blocker id/reason with a runtime-integration
blocker noting merged PR #193 (`794e9ce82978f94c97ad598e7d1f3708020c6fc1`),
while retaining BLOCKED, null candidate/frozen identities, every mandatory
evidence category and the refund/external-evidence holds. Update the matching
G3 review documents in the coordinator's serialized change, not this lane.

Reuse R29's existing requests, rather than a second router/SDK authority:

- `docs/production-readiness/r29/shared-change-requests/CR-001-sdk-api-pin.md`:
  `apps/api/package.json` and `pnpm-lock.yaml`; official SDK and purchase
  contract/surface decision. Recheck current advisories; its historical audit
  prose is not a current security finding.
- `CR-002-raw-body-wiring.md` in the same directory:
  `apps/api/src/infrastructure/http/request-body.ts`, its `.spec.ts`,
  `apps/api/src/app.module.ts` and its `.spec.ts`; exact bounded raw-body
  route and one ingress mount, unchanged authorization/CSRF boundaries.
- `CR-003-inbox-binding.md`: `apps/api/src/modules/money/money.module.ts`,
  its `.spec.ts`, proposed `adapters/money-rail-router.ts` and its
  `.spec.ts` under that module, and `.github/workflows/ci.yml`; exact
  rail selection, real workers and unchanged fail-closed defaults.

Product/policy approval and the actual refund consequence participant remain
required. Configuration must use the approved secret provider, expiring
sandbox authority and supported account binding. No credentials are requested
in Git. Do not grant real permissions, configure a provider account or select
commercial policy from this request.

Required gate verification: actual runtime registration and purchase surface;
both-rail collection/refund/activation/outbox transactions; independent Stripe
sandbox and authorized manual evidence; unchanged ownership/idempotency/privacy
negatives; all seven G3 categories on the same full source/tree and source-bound
artifacts; final CI/official CodeQL; separate owner-reviewed publication merge.
Only then edit the coordinator's registry/wave plan to assign the exact lane.

## Bounded R34 persistence proposal

Exact existing owner path: `packages/database/prisma/schema.prisma`.
Preserve `MoneyReconciliationException`, its identity and immutable original
evidence. The current schema cannot by itself represent the requested durable
worker state. Before R34 code, the schema owner must approve either an existing
suitable authority with proven invariants or additive companion persistence.
The proposed minimum companion responsibilities are:

| Responsibility   | Required fields/invariants                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run/window       | rail, mode, account binding, currency, fixed window bounds, source identity/digest, state, bounded cursor, revision, lease owner/expiry, last-success time; unique scoped window and compare-and-set ownership |
| Observation      | existing exception reference, source window, category/severity, observed/last-checked time, external reference and payload digest; immutable evidence with overlap/page dedupe                                 |
| Resolution event | existing exception reference, actor/reviewer, approved action/reason, expected revision, unchanged dry-run payload digest, idempotency key and approved correction reference; append-only history              |

Names, indexes, retention and cross-table constraints need schema-owner review.
Do not silently extend the existing seven enum values or store JSON in
resolutionCode. This request has **no applied migration**. An approved companion
design requires one new forward migration, Prisma generation/drift checks and
real PostgreSQL concurrency/rollback tests. The coordinator must allocate its
exact migration path before writing it; none is invented in this lane.

## Contract, status and real Admin workflow

Exact shared paths needing a later explicit lease:

- `packages/contracts/src/money/financial-operations.ts`: additive versioned
  window/severity/last-checked provenance and approved resolution workflow.
  Current ACKNOWLEDGE/REQUEST_RECHECK must not be silently treated as resolve.
- `packages/contracts/src/money/index.ts`: only an approved additional export,
  if the chosen contract location requires one.
- `apps/api/src/modules/money/reporting/financial-reporting.module.ts`:
  replace only the unavailable status binding with the exported real run
  reader after integration, without a module cycle or duplicated money authority.
- `apps/api/src/modules/money/reporting/financial-report.service.ts`:
  expose authorized real capabilities/observations; unavailable and NOT_RUN
  remain distinct from a completed zero-difference result.
- `apps/web/src/app/features/financial-operations/FinancialOperationsView.tsx`
  and `FinancialOperationsView.test.tsx`: render approved server actions
  and exact target/amount confirmation; show pending/unknown truthfully.
- `apps/web/src/app/features/financial-operations/financial-operations.api.ts`
  and `financial-operations.api.test.ts`: approved action request, fresh
  authorization, cancellation and targeted revalidation.
- `apps/api/src/app.module.ts` and `apps/api/src/app.module.spec.ts`:
  exactly one reconciliation module/handler mount after its exports exist.
- `.github/workflows/ci.yml`: isolated services and actual R34 real-API
  browser/service tests; preserve all existing required jobs/budgets.

This is the minimal change intent, not an approved interface patch. Obtain
approval and exact writer handoff before source edits. Both unchanged core
exception contracts and proposed extension must remain compatible or receive
an explicit version change. No dependency addition is requested by R34 itself.

Required checks: restart/concurrent-worker fencing; duplicate/overlapping pages;
source failure; mismatch severity; unauthorized/stale/maker-checker actions;
dry-run/hash equality; double submit; immutable history; independent statement
proof; real Admin inspection/resolution; audit and ledger invariants; AR/EN/RTL/
mobile/keyboard; frozen install, affected units/types/build and final CI/CodeQL.

## Unmeasured acceptance

Matched, unmatched and unresolved-severity counts are null/NOT_MEASURED.
No source comparison, credentials, sandbox transfer, live action or balancing
entry was executed by this request.
