# CR-001 — Serialized R24 money application integration

**Status:** APPROVED_FOR_IMPLEMENTATION; application and acceptance are not yet asserted.  
**Recorded:** 2026-10-17T15:55:11Z.  
**Authority:** Current delegated coordinator for baraabd, acting under the continuing owner authorization and explicit R24 implementation request.  
**Single shared writer:** R24 coordinating writer (`root`).  
**Expiry:** Earliest of R24 PR closure, the G2 decision, or coordinator revocation.  
**Ownership record:** [OWNERSHIP.md](../OWNERSHIP.md).

## Why shared changes are required

The R24 application boundary must consume the accepted R19 domain/schema and existing LedgerModule, expose published versioned contracts, persist authoritative orchestration state, and apply the repository's RBAC and audit rules. The frozen allowlist does not itself grant access to schema, global composition or central regression fences. This change request grants only the exact shared paths below, before runtime edits, with identical leases in the wave plan and sprint registry.

## Exact shared lease and minimal patch

| Exact path                                                                                     | Authorized bounded change                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`                                                       | Five additive money orchestration tables with required relations, constraints, indexes and bounded state types; preserve existing money and ledger authorities.                                                                                     |
| `packages/database/prisma/migrations/20261017163000_r24_money_api_orchestration/migration.sql` | One forward migration for those five tables and exactly six ungranted permission definitions; no historical migration rewrite, money backfill or role/account grants.                                                                               |
| `packages/database/src/seed.ts`                                                                | Register the same six definitions idempotently through a separately ungranted catalog; preserve current role mappings and avoid the existing admin auto-grant derivation.                                                                           |
| `packages/contracts/src/money/api-contracts.ts`                                                | Publish versioned R24 request/response schemas, errors and capability keys without redefining accepted money-domain authority.                                                                                                                      |
| `packages/contracts/src/money/index.ts`                                                        | Export the new API contracts through the existing money package surface. The root contracts barrel already exports money and requires no edit.                                                                                                      |
| `apps/api/src/app.module.ts`                                                                   | Mount MoneyModule exactly once; obtain the existing LedgerModule through that composition boundary without a second accounting implementation. Preserve SupportModule and other application imports.                                                |
| `apps/api/src/modules/iam/audit/audit.service.ts`                                              | Add only bounded money audit identifiers needed by R24, preserving sensitive-value filtering.                                                                                                                                                       |
| `apps/api/src/modules/iam/audit/audit.service.spec.ts`                                         | Verify allowed money identifiers and rejected sensitive details while retaining existing audit assertions.                                                                                                                                          |
| `apps/api/test/integration/r19-subscription-money.integration.spec.ts`                         | Replace the obsolete zero-money-definition assertion with exact six-key registration and zero automatic grants. Preserve ledger grants, no-backfill, immutable-history and no booking-revenue checks.                                               |
| `apps/api/src/app.module.spec.ts`                                                              | Assert AppModule → MoneyModule → existing LedgerModule exactly once; preserve SupportModule and existing unrelated composition expectations.                                                                                                        |
| `.github/scripts/merge-integrity.test.mjs`                                                     | Strengthen the direct-LedgerModule fence to the complete composition boundary, retain negative removal checks and support/ledger invariants, and add the five new model/migration references plus Permission reference. No workflow or gate bypass. |
| `docs/production-readiness/baseline/MODEL_MIGRATION_INDEX.json`                                | Add the actual five new quoted model tokens and new migration references, including Permission. Preserve existing references, reference-index semantics and historical baseline SHA.                                                                |

The two central ownership-record files remain coordinator-owned and are not runtime lease paths. No other file is implicitly granted by this request.

## Permission catalog and dark defaults

Exactly these six definitions may be registered:

```text
money:purchase:self
money:read:self
money:refund:request:self
money:review:read
money:receipt:review
money:refund:review
```

No RolePermission, UserRole, user, provider or production account grant is authorized. Existing seed code derives admin grants from its ordinary PERMISSIONS list; placing these definitions into that list would violate this request. Keep the newly registered definitions separate from automatic role grants and prove the invariant after migration and repeat seeding.

The pre-R24 R19 test assumed no money permission definitions existed. R24 now requires explicit capability definitions, while the no-grant invariant remains mandatory and becomes directly asserted. The existing R19 migration's no-INSERT/no-UPDATE/no-DROP checks remain unchanged because this request adds a new migration. R24 fixtures use a separate disposable database so they cannot contaminate R19 global history checks.

## Required verification and migration consequences

Before publishing implementation evidence, run the discovered repository scripts for affected formatting, lint, typecheck, contracts/API build and tests. Validate/generate Prisma, apply the migration to disposable PostgreSQL, check schema drift and constraint behavior, and exercise the actual HTTP authorization, CSRF, ownership, idempotency, concurrency, failed-write rollback, audit/outbox atomicity and safe response contracts.

Verify the updated topology fence rejects missing or duplicate mounts and preserves SupportModule. Verify the exact permission catalog and absence of automatic grants, including repeated seed execution; preserve the complete R19 suite. The model index is a quoted-token reference inventory, so forward migration replay and drift checks remain required.

The ownership-only checkpoint runs the sprint registry verifier, which includes the wave gate, and checks the scoped diff. Runtime tests are not claimed by that checkpoint. Final-source CI and CodeQL evidence must bind to the actual PR head.

## Integration, handoff and excluded changes

Frozen G1 remains `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`; the worktree starts at published coordination commit `07c8e584c684111bfc80995c7efb0144cfb6161b`. After the ownership commit, a normal merge of already owner-merged develop `21089a5065169b78bea5e711a4839e1a467531dc` into this R24 branch is planned. Preserve peer records and original source identities; no unmerged R25 import or G1 refreeze.

The root writer applies shared changes serially and records actual schema/contract versions, source identity, commands, failures and rollback evidence. Implementation may proceed only on the assigned branch with these exact reservations. Release the lease before reassignment.

No environment, dependency, lockfile, workflow, deployment, money-policy, payout, live rail, verification or permission-grant change is included. No rebase, force-push, merge to develop or deployment is authorized by this request. Existing R16/R18 policy holds and the live-money gate remain effective.
