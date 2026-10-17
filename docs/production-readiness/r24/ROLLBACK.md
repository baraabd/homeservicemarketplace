# R24 — Rollback and recovery

**State:** Procedure for review; no rollback, production migration, deployment, merge or live-money operation has been executed by this document.  
**Publication evidence:** Draft required; final containing commit/tree, PR URL and actual CI/CodeQL run IDs are maintained in the PR body after publication.  
**Principle:** Preserve immutable money evidence and accepted peer changes. A source reversion does not reverse an external payment or posted ledger transaction.

## Source identities and rollback boundary

R24 started at `07c8e584c684111bfc80995c7efb0144cfb6161b` after frozen G1 runtime `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`. Ownership was committed at `60df8018ea9c76b1cda1c322fb279c7b9d7fde93`; owner-merged develop `21089a5065169b78bea5e711a4839e1a467531dc` was normally integrated into the assigned branch at `65b2a0e59604931a4b8b87acb971c71afaaf9a74` (tree `bf13f28e3c7c21aa6b9f5d418ad2e0ea92a0fb09`). These identities must not be substituted for the containing R24 commit/tree. Source-byte and local artifact hashes are recorded in SOURCE_MANIFEST.json; the final containing identities are recorded in the PR body after publication without a self-referential commit.

No operational application revert or production rollback is claimed. Any future corrective/revert commit, tested tree, PR and executed rollback evidence must be recorded when that authorized action occurs. [ACCEPTANCE.md](ACCEPTANCE.md) records the current local transaction-failure tests and actual suite outcomes. Preserve the owner-merged R26/R27 runtime and coordination records. There is no authorization to reset develop to the earlier G1/start commit, import unmerged R25, rebase or force-push.

## Contain a defect before further money work

1. Identify the affected source, operation, command key, intent/confirmation/refund/dispatch and last known state using restricted operational evidence. Do not print raw credentials, receipts, request envelopes or transport payloads in public artifacts.
2. Keep default live rails and automatic grants disabled. If a later integration has installed adapters or granted authority, its authorized operator must contain new affected work through the approved configuration/access process. This document grants no production access change.
3. Preserve received events, provider keys, operation IDs, verified observations, reservations and posted ledger/outbox history. Do not infer failure from a timeout or acceptance from a command receipt.
4. Record which calls may already have crossed the external boundary and which local transaction committed. Choose the recovery below before any retry or source reversion.

## Recovery by persisted state

| Observed state                                                                   | Safe recovery                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No authoritative command/evidence exists and no external dispatch occurred       | Correct the implementation/configuration and retry through normal authorization with a valid command key                                                                             |
| Collection dispatch is `PENDING` or `UNKNOWN`                                    | Resume the same attempt and provider key; preserve known external operation ID. Use configured verification to establish the outcome                                                 |
| External event is `RECEIVED` and activation is unavailable or failed             | Install/correct the approved participant, then retry the stored event. Ledger, existing R19 period, participant, audit and outbox must commit together                               |
| A distinct event names an already completed economic confirmation                | Reuse the scoped confirmation identity and prove matching processed R24 participation; consume the delivery without another financial or activation effect                           |
| R19 replay lacks matching processed R24 participation proof                      | Leave the event unresolved and escalate reconciliation. Do not create a synthetic success or blindly skip activation                                                                 |
| Refund is reserved and transport is `UNKNOWN`                                    | Keep its reservation counted against the paid amount; query/resume the same durable external identity                                                                                |
| Verified terminal refund evidence is stored, but local compensation/audit failed | Retry local `recordRefundResult` through the authorized orchestration path using that immutable observation. Recovery requires no new external call or current adapter configuration |
| Refund success and compensation are committed                                    | Preserve both. Any further adjustment requires its own approved compensating entry and policy; never edit the original posting                                                       |
| Terminal external observations contradict each other or binding/amount differs   | Preserve the original evidence and conflict state for reconciliation; do not overwrite the terminal result or choose an outcome manually                                             |

Fresh permission and ownership/binding checks still apply to user-triggered replay and recovery. Claim expiry permits coordinated retry; it does not permit changing the obligation or provider key. A late pending/unknown response cannot replace a stored terminal refund observation.

## Application reversion

Before publication, a defect can be corrected on the same assigned R24 branch under its exact ownership: 22 lane files, 15 shared paths under three leases, and two central records, 39 paths total. Once a PR is published, use normal corrective commits and keep it Draft while required evidence is missing. Do not discard another writer's work or alter accepted peer source.

If an authorized source rollback is necessary, the coordinator should prepare a reviewable revert of the R24-specific runtime changes against the current accepted source. Restore coherent module composition: the application must continue to obtain the existing LedgerModule exactly once and retain SupportModule. Update and run the corresponding topology/negative checks with the proposed source; do not simply remove the money import and disable the regression fence.

A code rollback may leave the additive migration in place. Verify compatibility of the proposed older runtime with the retained schema and the pending evidence/recovery queues before deployment. Do not assume compatibility solely because the schema additions are additive. If real participants have operated, a forward fix that preserves their recovery path may be safer than removing the application boundary.

## Database and permission handling

The migration `20261017163000_r24_money_api_orchestration` adds `MoneyCommand`, `MoneyIntentBinding`, `MoneyExternalEvent`, `MoneyRefundRequest` and `MoneyDispatch`, state guards, relations and six permission definitions. After application to any non-disposable environment, keep the migration history intact. Do not edit an already applied migration, manually mark it rolled back, drop those tables/enums, remove immutable events or rewrite ledger rows.

No destructive down migration is supplied. An authorized future schema correction needs a new forward migration, an exact ownership lease and explicit preservation of pending commands, unknown dispatches, refund reservations and verified terminal evidence. Existing successful postings are reversed only through approved compensating financial operations.

The six capability definitions are ungranted by migration and ordinary seed. Retaining unused definitions does not enable money. Any later live role/account grants must be handled through their separate authorized access process; rolling back source or re-running seed is not an access revocation protocol.

For R24 tests only, fixture teardown may drop the exact isolated database it created and remove its own temporary storage after closing its own app. This does not authorize a shared database reset, Redis flush, volume deletion, broad process termination or removal of another lane's artifacts. Preserve failure logs and non-secret source/runtime identity before disposing test resources.

## Verification required after a correction or authorized revert

Run the applicable discovered repository checks on the actual candidate: formatting/lint/typecheck/build, module composition and negative fences, canonical ownership validators, migration/schema checks, fresh authorization/CSRF/IDOR, idempotency, unknown recovery, activation and compensation rollback, seed no-grant invariants, and existing R19/booking/wallet regressions. Verify pending evidence remains retryable and no additional external operation or compensation was created.

Attach exact commands, exit codes, source/tree, counts, failure/skip accounting and retained artifacts to the PR evidence. Required CI and CodeQL must correspond to the corrected PR head. Local component success is not rail sandbox, hosted or release acceptance. Only the coordinator may accept the combined wave; merge/deployment/live activation require separate owner authorization.
