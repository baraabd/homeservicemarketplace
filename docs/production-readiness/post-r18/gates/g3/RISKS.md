# G3 residual risks and owners

| Blocker                            | Consequence                                                                                 | Owner and closing evidence                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R29 absent                         | Stripe collection, authentic webhook recovery and Stripe refunds cannot run                 | R29 writer delivers the existing sprint through frozen R24 ports; coordinator integrates only reviewed/owner-merged source                                   |
| Refund policy unavailable          | Real application cannot authorize a refund using an approved historical policy              | Product/finance owner supplies explicit sandbox scope, version, window, partial/full rules, reason codes and separation controls; R32 integrates that source |
| Refund consequence unavailable     | A confirmed refund cannot atomically apply approved subscription/entitlement consequences   | R31/R32 implement the approved entitlement policy in the caller transaction, with rollback, replay and concurrent-refund evidence                            |
| No real combined-rail proof        | Individual green component tests may conceal unavailable bindings or fixture overrides      | Coordinator exercises both real registered rail families, actual operator actions and post-commit outbox on one source                                       |
| Incomplete candidate CI inventory  | PR-head success or running merged-source checks can be mistaken for exact-source acceptance | Complete CI/R18/R27/security and official CodeQL on the actual candidate; verify artifacts and skipped-case dispositions                                     |
| G3 publication not accepted/merged | R34 has no permitted frozen base or active writer                                           | Coordinator acceptance followed by explicit owner review/merge and independent publication verification                                                      |

No authorized Stripe sandbox account, external statements or commercial refund
policy was supplied to this task. Do not put credentials, private receipts, raw
environment files or session traces in Git. Use an authorized secret channel
and isolated resources when the missing implementation is ready for testing.

The observed candidate has 98 service-profile skipped API tests; their existence
is recorded rather than counted as passes. Dedicated R30/R31 jobs close some
different evidence categories, not all G3 requirements. Screenshots were not
visually inspected in this task, so no visual/RTL/accessibility acceptance is
claimed from their count.

The open Dependabot PR #188 proposes a Zod major-version update and is not an
R29–R33 delivery. It is outside this bounded gate inspection and is not imported.
Future dependency changes require their own compatibility verification.

R16 provider payout/funding holds, R18 unresolved decisions, approved-market and
currency policy, production verification policy and the live-money gate remain
unchanged. Subscription revenue never becomes provider withdrawable earnings.
