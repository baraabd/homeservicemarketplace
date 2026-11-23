# R30 — implementation risks and closure owners

## Current scope and source authority

R30 now contains sandbox manual-payment instructions, protected receipt upload
and review, an atomic confirmation participant, and a manual-refund transport.
This is implementation source, not a declaration of hosted or live acceptance.
The exact candidate, executed checks, failures and acceptance state belong in
`SOURCE_MANIFEST.json` and `ACCEPTANCE.md`.

The earlier G2 publication blocker is resolved. The owner merged
[PR #183](https://github.com/baraabd/homeservicemarketplace/pull/183) at
`2026-10-23T04:11:34Z`. The independently verified identities are:

| Identity                                      | Value                                                      |
| --------------------------------------------- | ---------------------------------------------------------- |
| Accepted G2 runtime source                    | `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`                 |
| Accepted G2 runtime tree                      | `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`                 |
| Owner-merged publication / R30 checkout start | `986b4707776711e80564f0642133ede90ba16f3c`                 |
| Publication tree, identical to final PR head  | `7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`                 |
| Assigned implementation session               | `hsm-r30-590834e66da5` on `feat/r30-manual-payment-review` |

The publication is a metadata-only descendant of the accepted runtime source.
See [the canonical publication verification](../post-r18/gates/g2/PUBLICATION_VERIFICATION.md)
and [the exact writer mapping](RUNTIME_OWNERSHIP.json). Neither the publication
nor its successful checks establishes acceptance of the subsequent R30 source.
Historical prerequisite-only observations remain history rather than current
blocking conditions.

## Remaining risks and dependencies

| ID                     | Current state                                              | Consequence and closure owner                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R30-R31                | INTEGRATION_PENDING                                        | The default R31 activation participant remains unavailable. R30 calls the existing R24 transaction and cannot supply entitlement policy itself. The test activation component is explicitly a transaction contract double. R31/coordinator must integrate and verify the real participant before claiming complete subscription activation.                                                                                                                                                                                                               |
| R30-R32                | INTEGRATION_PENDING                                        | R30 supplies operator dispatch and independent result evidence through the frozen refund transport interface. Production refund eligibility and consequences belong to R32. The default refund policy is unavailable, and the frozen refund-confirmation participant still requires its owning integration. A test policy component or a local compensating posting is not production R32 acceptance.                                                                                                                                                     |
| R30-LIVE               | POLICY_BLOCKED / EXTERNAL_BLOCKED                          | The implementation unconditionally rejects LIVE bindings; inserting an enabled LIVE instruction does not enable a rail. No real merchant setup, authorized settlement check, hosted journey or live release approval is supplied. Finance/security/release owners must close the separate live-money gate; this sprint grants none of those authorities.                                                                                                                                                                                                  |
| R30-METHOD             | POLICY_BLOCKED outside explicit sandbox fixtures           | Merchant/account/office identity, market, currency scale, instructions, threshold and validity must be supplied as explicit approved versioned data. No migration or seed enables a real method. Synthetic XTS instructions and `SANDBOX_OPERATOR_SIMULATION` evidence prove only the tested sandbox workflow. Finance/commercial owners supply any actual policy.                                                                                                                                                                                        |
| R30-REVIEW             | POLICY_BLOCKED for actual grants                           | Runtime decisions require fresh permissions, an active admin role, no self-review, an inspected current receipt, and an independent permitted settlement recorder. Permission definitions do not grant them to users. Actual reviewer grants and operating separation/threshold policy require the finance/security owner.                                                                                                                                                                                                                                |
| R30-RECOVERY           | IMPLEMENTED WITH LIMITS                                    | The review cursor stores `attemptCount`, `nextAttemptAt`, `lastErrorCode` and `reconciliationRequired`. Permanent authorization/validation/conflict errors halt automatic processing; the configured automatic failure budget is eight. The explicit retry path belongs only to the original reviewer and rechecks the current revision, permissions, instruction and settlement. Reassignment, expired obligations and irreconcilable evidence require a separately approved recovery design; they cannot be repaired by changing an immutable decision. |
| R30-EXPIRY             | POLICY_BLOCKED for late recovery                           | Current acceptance and retry fail closed after the obligation or instruction expires. An on-time deposit reviewed late and an actually late deposit are not automatically treated alike or granted a grace period. Finance must approve any additional handling; do not extend the original obligation or rewrite occurrence times.                                                                                                                                                                                                                       |
| R30-RETENTION          | POLICY_BLOCKED / IMPLEMENTATION GAP                        | Each reservation requires explicit financial retention data. Identity scan/cleanup/retention paths exclude the financial purpose, and database guards prevent identity/portfolio links. There is no financial-purpose erasure worker in this implementation. `retainUntil` is metadata, not proof of deletion, legal retention, hold handling or backup erasure. Finance/privacy/storage owners must approve and implement that lifecycle.                                                                                                                |
| R30-HOSTED-STORAGE     | EXTERNAL_BLOCKED                                           | Task-local restricted storage and a real scanner do not prove hosted bucket isolation, finance-specific IAM, KMS ownership, version/replica deletion, backup inventory or production recovery. No deployment of those controls is claimed. Storage/security owners must verify the actual environment.                                                                                                                                                                                                                                                    |
| R30-RECEIPT-REUSE      | IMPLEMENTED; policy limits remain                          | Immutable asset-to-obligation associations, approved same-provider byte-reuse rejection and unique scoped deposit claims are distinct controls. A hash is a duplicate-risk signal, never receipt of funds. Broader matching of identical bytes across actors or different genuine deposits needs explicit policy; no matching rule may invent a payment.                                                                                                                                                                                                  |
| R30-REFUND-UNCERTAINTY | INTENTIONALLY UNRESOLVED without authoritative evidence    | Dispatch records an operator action and leaves the result UNKNOWN. A different permitted operator must record exact bound terminal evidence. Timeout, missing observation, disabled configuration or ledger reversal does not prove that money was sent or returned. Preserve the original provider key and external-operation identity; R32/finance own reconciliation.                                                                                                                                                                                  |
| R30-CANDIDATE-EVIDENCE | INTEGRATION_PENDING until recorded for the final candidate | Application checks, real PostgreSQL/storage/ClamAV cases, browser journeys, negative/concurrency/rollback cases and required final-head CI/CodeQL must be tied to the actual candidate. Earlier G2 results and service health do not satisfy these checks. The coordinator records the executed results without treating unrun checks as passes.                                                                                                                                                                                                          |

## Evidence and operational limits

The task has isolated PostgreSQL, Redis, private storage, a real ClamAV engine
with official signature databases, and matching pinned Chromium distributions.
Infrastructure verification exercised real scanner responses and browser engine
launch. The browser distributions were copied from matching local binaries,
with version and file hashes checked; they were not independently authenticated
as a new download in this session. These facts establish available test
infrastructure, not the outcome of application acceptance or a hosted rehearsal.

The fixture database role is a non-superuser with CREATEDB solely so the
repository test helper can create disposable databases inside the task-owned
cluster. This is not a proposed production application grant. Credentials and
private runtime files must stay outside repository artifacts.

Automatic processing is tied to the existing `OUTBOX_WORKER_ENABLED` setting;
there is no dedicated R30 worker switch. Turning off that shared setting has
effects beyond manual payments, and the explicit decision/retry routes can
still invoke processing. Operational containment must account for both callers.
See [the recovery runbook](ROLLBACK.md).

Subscription revenue is not provider-withdrawable earnings. This work does not
create customer escrow, payouts, FX, fees, taxes, supported markets, plan prices
or production identity-verification policy. R16/R18 holds and
[`LIVE_MONEY_GATE.md`](../../money/LIVE_MONEY_GATE.md) remain in force. A purchase
does not grant identity verification, legal/age eligibility or work access.
