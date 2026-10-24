# R36 — Recovery preflight, implementation blocked

Status: **INTEGRATION_PENDING / EXTERNAL_BLOCKED**. No R36 recovery program
has been implemented or executed. This PR records the current-source findings
and a concrete coordinator change request; it does not close P50-recovery.

## Source and scope

- Delivery mode A; scope is inspection and preflight documentation only.
- Branch: `test/r36-backup-restore-recovery`.
- Observed base/source: `5ff2b7e6a46b4e42114184fac89928372f4c8d4c`.
- Observed source tree: `54e00d4e9eaa7bd81146f01b69dfa9b396eab45c`.
- Approved G3 execution base: **absent**, not the observation above.
- Final documentation commit/tree: recorded in the PR's final-head metadata;
  do not put a self-referential final SHA into this commit.
- Changed paths and the narrow documentation lease: [OWNERSHIP.md](OWNERSHIP.md).
- Machine-readable source/configuration fingerprints and checked commands:
  [evidence/preflight.json](evidence/preflight.json).

The detailed owner prompt is R36; its closing sentence also names R34. This
preflight follows the detailed R36 scope, and checks both start barriers. Both
refuse execution, so no ambiguous product implementation is started.

## Findings from the current tree

1. G2 is recorded ACCEPTED and published. G3 is BLOCKED, with null candidate
   and frozen identities. The existing `--ready R36` and `--ready R34`
   validators both exit 1. A green dependency PR cannot change that result.
2. R30, R31, R32 and R33 were merged through #184, #186, #187 and #185.
   Each actual merge commit is an ancestor of the observed source. This proves
   source inclusion, not combined Wave 3 acceptance. No R29 Stripe adapter,
   webhook controller, sprint evidence directory or merged R29 delivery was
   found. `MoneyModule` registers manual collection/refund adapters and the
   real subscription activation participant, but still registers
   `UnavailableRefundPolicySource` and
   `UnavailableMoneyRefundConfirmationParticipant`.
3. R28's topology is `CONFIGURATION_ONLY`. Its strict target probe reports
   nine blocker categories. Provider/account/host, release digests, protected
   key/secret references, restore database/storage/network and approval are
   unassigned. The proposed 300-second RPO, 14,400-second RTO and seven-day
   database retention are **not approved targets or measured results**.
4. Reuse R20's `storage-inventory.cjs` and
   `apps/api/src/infrastructure/storage/storage-inventory.ts`. The current
   `verifyRestore` checks latest live objects only; it reports unexpected
   objects but does not include them in `ok`. It cannot certify restoration
   of every required historical version, delete marker or lost KMS key.
   R36 must add the stronger recovery-set check in its owned verifier, with
   explicit source-to-restored-version mapping, not silently broaden R20's
   existing report semantics or duplicate its inventory implementation.
5. R18's rollback runbook says to rerun the previous release launcher and then
   says not to run the previous migrator. Current `staging.cjs --apply` always
   runs `api-migrate` before replacing API/web. This is a concrete unsafe
   instruction conflict; the proposed documentation patch is in
   [CR-001-integration.md](shared-change-requests/CR-001-integration.md).

## Recovery set to bind after the gate

One authorized consistency boundary must bind PostgreSQL snapshot/WAL lineage,
the exact migration set, object versions/deletion state, non-secret key-version
references, immutable API/migrator/web digests and accepted application source,
and a non-secret configuration fingerprint. R20 contracts remain
`hsm.storage-inventory/v1` and `hsm.storage-restore-report/v1`; platform inputs
remain `hsm.platform-inputs/v1`. Prisma is pinned to 6.12.0. This PR changes
no contract or schema version and adds no migration.

The database inventory must include the current `LedgerAccount`,
`LedgerTransaction`, `LedgerEntry`, `MoneyPaymentIntent`, `MoneyPaymentAttempt`,
`MoneyPaymentConfirmation`, `SubscriptionPlanVersion`, `SubscriptionPeriod`,
`MoneyCouponRedemption`, `MoneyEntitlementUsage`, `MoneyCommand`,
`MoneyIntentBinding`, `MoneyExternalEvent`, `MoneyRefundRequest`, `MoneyRefund`,
`MoneyDispatch`, manual receipt/review/settlement/refund records, `OutboxEvent`,
`OutboxHandlerRun`, `EmailDelivery`, suppression/feedback, authorization,
audit, verification and `MediaAsset` state. Preserve unique keys and linked
history; subscription revenue never becomes provider withdrawable earnings.

Outbound isolation must be established before any restored application boot:
deny real SMTP/payment/refund destinations, isolate webhook ingress and queues,
and use independently provisioned DB/users/Redis/storage/network. Disabling
`OUTBOX_WORKER_ENABLED` stops the inspected manual/refund schedulers, but
does not prove all direct routes or synchronous mail cannot send. The drill
needs network denial, disposable credentials and observed sink counters too.

## Required next execution

The coordinator must finish the real R29 and refund participants, run all seven
G3 categories on one combined source, obtain the owner's publication merge,
verify it, then assign the exact R36 files and full frozen source. The data and
infrastructure owners must supply the approved restore target, retention/hold
rules, key references and recovery objectives. Only then implement the already
listed R36 modules and execute the real isolated restore and image rollback.
No hosted resource was contacted, provisioned, restored or disrupted here.
