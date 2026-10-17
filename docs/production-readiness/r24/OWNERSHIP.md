# R24 execution ownership

Recorded at 2026-10-17T15:55:11Z, before runtime edits, by the current delegated coordinator for baraabd under the continuing owner authorization and the explicit R24 implementation request. This record approves the exact implementation assignment; it does not assert implementation, test completion, sprint acceptance, merge permission or live-money activation.

## Start identity and integration boundary

| Identity                              | Value                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Branch                                | `feat/r24-money-api-integration`                                                                                   |
| Assigned worktree                     | `/workspace/scratch/3c602a5e36ee/homeservicemarketplace-r24`                                                       |
| Frozen G1 runtime source              | `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`                                                                         |
| Frozen G1 runtime tree                | `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`                                                                         |
| Owner-merged G1 acceptance record     | `0568739096ceeaf0cfc79034626886e258fe4328` ([PR #171](https://github.com/baraabd/homeservicemarketplace/pull/171)) |
| Execution start / publication overlay | `07c8e584c684111bfc80995c7efb0144cfb6161b` ([PR #172](https://github.com/baraabd/homeservicemarketplace/pull/172)) |
| Observed owner-merged develop         | `21089a5065169b78bea5e711a4839e1a467531dc`                                                                         |
| Canonical start status                | `READY_TO_START`                                                                                                   |
| Execution status                      | `IN_PROGRESS`                                                                                                      |
| Acceptance                            | Not asserted                                                                                                       |

The accepted gate identity is defined by [the G1 source manifest](../post-r18/gates/g1/SOURCE_MANIFEST.json) and [publication verification](../post-r18/gates/g1/PUBLICATION_VERIFICATION.json). The start commit adds published coordination evidence to the frozen runtime source. It does not refreeze G1. R19, R22 and R23 remain the hard dependencies.

The coordinator recorded ownership in normal-hook commit `60df8018ea9c76b1cda1c322fb279c7b9d7fde93`, then completed a normal merge of already owner-merged develop into this R24 branch at `65b2a0e59604931a4b8b87acb971c71afaaf9a74` (tree `bf13f28e3c7c21aa6b9f5d418ad2e0ea92a0fb09`). The merge preserved both parents and completed without conflicts. The incoming source contains owner-merged [R26 #174](https://github.com/baraabd/homeservicemarketplace/pull/174) and [R27 #173](https://github.com/baraabd/homeservicemarketplace/pull/173). Preserve the original frozen/start identities and incoming peer records while resolving the R24 ownership additions. No unmerged R25 source is authorized; [R25 #175](https://github.com/baraabd/homeservicemarketplace/pull/175) was observed open at `47aaec8afdf095cc1d6b2c7368bfdb10eba9906c`. This is an integration into the assigned feature branch only; develop was not modified by R24.

## Exact lane ownership

The canonical exact lists are synchronized in [wave-02.plan.json](../post-r18/waves/wave-02.plan.json) and [SPRINT_REGISTRY.json](../post-r18/SPRINT_REGISTRY.json). All 16 previously approved R24 files remain assigned. Six additions make 22 exact lane files:

- `apps/api/src/modules/money/application/money-query.service.ts`
- `apps/api/src/modules/money/application/money-query.service.spec.ts`
- `apps/api/test/support/r24-money-http.fixture.ts`
- `docs/production-readiness/r24/OWNERSHIP.md`
- `docs/production-readiness/r24/fixtures/api-v1.json`
- `docs/production-readiness/r24/SOURCE_MANIFEST.json`

There are no prefix grants. The coordinator's 15 shared paths under three exact leases is specified in [CR-001-integration.md](shared-change-requests/CR-001-integration.md) and mirrored exactly in both canonical records. It is the only Wave 2 R24 schema lease and expires at the earliest of R24 PR closure, the G2 decision, or coordinator revocation.

## Single-writer assignments

| Writer                                                    | Exact responsibility                                                                                                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R24 coordinating writer (`root`)                          | Money controller and controller tests; MoneyModule and module tests; all 15 shared lease paths; API fixture JSON and final source manifest.                                                               |
| `security_review`                                         | Money command service and its adjacent spec; the four exact activation, collection, finance-read and refund port files.                                                                                   |
| `ci_diagnosis`                                            | `apps/api/test/support/r24-money-http.fixture.ts` and `apps/api/test/integration/r24-money-api.integration.spec.ts`.                                                                                      |
| `gate_audit`, current serialized delegation               | Only this ownership record, CR-001, the R24 object in wave-02.plan.json, and the R24 object in SPRINT_REGISTRY.json; stop after validation so the coordinator can commit ownership.                       |
| `gate_audit`, after the coordinator's merge-ready handoff | `apps/api/src/modules/money/application/money-query.service.ts` and its adjacent `.spec.ts`; fresh authorization, ownership-scoped reads, bounded scope-bound pagination and ledger-derived review views. |
| `gate_audit`, later handoff                               | IMPLEMENTATION.md, ACCEPTANCE.md, RISKS.md and ROLLBACK.md, only after a separate handoff and with actual evidence.                                                                                       |

The two central records remain coordinator-owned. The present four-file delegation records ownership; it does not transfer ongoing central-registry ownership. Other lanes retain their baseline assignments. A later writer must receive a handoff before editing a currently assigned file.

## Permitted integration and preserved invariants

R24 composes accepted R19 money authorities and the existing LedgerModule. The shared patch may add five orchestration tables in one new migration; published API contracts; bounded money audit identifiers; and exactly these catalog definitions:

- `money:purchase:self`
- `money:read:self`
- `money:refund:request:self`
- `money:review:read`
- `money:receipt:review`
- `money:refund:review`

Registration grants no RolePermission, UserRole or account authority. The seed's current admin mapping derives grants from its ordinary permission catalog, so the new definitions must be registered through a separate ungranted catalog without entering that automatic mapping. Verify both migration and repeat-seed behavior.

Replace only the obsolete R19 assertion that there are zero money capability definitions with the exact six-key catalog and zero automatic grants invariant. Preserve the existing ledger no-live-grant, no money backfill, immutable-history and no booking-revenue assertions. Topology checks must prove AppModule imports MoneyModule exactly once and MoneyModule imports the existing LedgerModule exactly once, preserve SupportModule, and retain negative removal checks. No test is skipped or weakened.

The migration reference index must identify the five actual new model tokens and the new Permission migration reference while preserving previous entries and its historical baseline identity. No money backfill, live collection/refund/activation rail, payout, policy decision, environment change, dependency/lockfile change or workflow change is included. Live money and actual permission grants remain separately authorized decisions.

## Evidence and runtime isolation

Use a separate disposable R24 database and fixture identities. R24 HTTP fixtures must not populate the database used for R19's global immutable-history assertions. Any Redis, storage, process, queue or browser resource used must be independently scoped according to the frozen wave manifest; no shared data reset or process termination is authorized.

Use repository-pinned Node 24.21.0 and pnpm 10.32.1, independent worktree outputs, existing scripts and exact final-source evidence. Required runtime, negative, concurrency, rollback, CI and CodeQL evidence belongs in the final R24 deliverables. Only actual results may be recorded. The ownership validation proves record consistency, not runtime acceptance.

## Bounded freshness extension recorded before shared edits

At 2026-10-17T16:36:36Z the continuing delegated coordinator added only `apps/api/src/modules/iam/authorization/guards/permissions.guard.ts` and its adjacent `.spec.ts` to a second exact lease. A real HTTP/PostgreSQL run passed 51 of 55 cases and exposed stale money-permission cache behavior alongside stale token role claims. The existing guard will classify `money:` as sensitive and use its existing fresh-user permission resolver; owned command/read services will require the current provider/admin base role. Root is the only shared writer. The expiry and no-grant/no-live/no-bypass boundaries remain unchanged. This extension records authorization before those two shared files are modified.

## Seed regression extension recorded before test edit

At 2026-10-17T16:48:10Z the continuing coordinator granted only `apps/api/test/unit/seed-with-tx.spec.ts` in a third exact lease. The full enabled API run exposed its obsolete assumption that only `outbox:replay` was registered without automatic grants. The correction must explicitly prove that the six money capabilities exist and remain ungranted alongside outbox replay, while preserving ordinary admin grants and exactly two self capabilities for customer/provider. This is an assertion strengthened for the approved catalog change; seed behavior is unchanged. Root remains the single writer. Total shared scope is 15 exact paths, recorded before this edit.
