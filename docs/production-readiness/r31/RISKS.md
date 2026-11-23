# R31 risks and unresolved authority

R31 source verification is separate from integrated collection acceptance,
hosted acceptance and release authorization. Green technical checks do not
resolve the decisions below.

| Boundary                                    | Current behavior                                                                                                                    | Owner / required evidence                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| R29 sandbox and R30 manual collections      | Isolated tests use explicitly named previous-wave collection/configuration components with the real R24/R19/R31 transaction         | Wave 3 coordinator must run both actual rails on one G3 candidate; component confirmations are not rail evidence       |
| Production commerce                         | Collection/configuration, receipt and refund defaults remain unavailable                                                            | Business/finance owner must approve markets, currencies/exponents, prices, policy and adapter configuration            |
| Cancellation, grace, renewal and suspension | No public mutation or inferred grace/consent; explicit named internal policies only                                                 | Product/finance owner supplies policy and coordinator composes the approved operations                                 |
| Refund consequences                         | An already refunded obligation does not affirm paid capability; effect operations require confirmed compensation and a named policy | R32 and policy owner define partial/full refund consequences and integrate the existing port                           |
| Usage reset                                 | Existing usage remains cumulative per subscription                                                                                  | Product owner defines reset/carry rules; a period-scoped model would require a separate schema lease and migration     |
| Multiple purchases                          | Existing multiple-subscription model is preserved; users can select a subscription                                                  | Product owner defines replacement, upgrade, downgrade and pooling semantics; R31 does not impose a new uniqueness rule |
| Permission grants                           | The route is mounted, but private reads require the provider role and fresh `money:read:self` permission                            | Authorized IAM rollout must grant capabilities separately; no seed or production role is changed                       |
| Reminder delivery                           | Stable outbox identities and durable bilingual inbox notifications; production schedule remains unconfigured                        | Policy owner approves timing; R21 integration needs an approved subscription email template before SMTP claims         |
| Hosted service behavior                     | Local disposable services and CI do not demonstrate hosted networking, secrets, backups or monitoring                               | Hosting/release owners provide the later hosted evidence under existing R28/G3/G4 boundaries                           |

## Preserved financial and eligibility constraints

Subscription revenue is not provider withdrawable earnings. No customer escrow,
payout, FX, tax, fee model or manually rewritten ledger is introduced. R16 payout
and R18/live-money unresolved decisions remain held. Buying a plan changes
neither verification nor legal/age checks, provider standing or work access.
Downstream domain actions must compose the paid-usage service with their own
authorization and eligibility checks in the same transaction where required.

Published plan snapshots, payment confirmations, ledger postings, coupon
redemptions and usage history remain immutable. A new plan version does not
rewrite an existing purchase. Unknown commercial configuration fails closed.
There are no production price or permission seeds in this change.

## Operational limits and failure handling

- A subscription row lock serializes usage and lifecycle changes for that
  subscription. This is an intentional correctness boundary; actual hosted
  contention and capacity remain a later measured requirement.
- History returns the latest fifty periods and explicitly reports truncation.
  The subscription and catalog lists retain bounded pagination. No unbounded
  database history is sent to the browser.
- Notification/outbox retries use stable period identities. Unrecognized or
  mismatched payloads fail closed. An event delivered before its due time is a
  transient failure; no global retry budget is relaxed.
- The default reminder, cancellation and refund-effect policies are blocked.
  Configuration changes must retain compatible event handling and named policy
  identity; queued events are not authority to invent policy.
- Refused ownership/permission reads do not expose another provider's plan.
  The browser hides private cached content after an authorization failure.
  Offline content is explicitly stale and cannot grant server capability.
- Exact money is transported as the established wire representation. Display
  formatting remains unavailable where currency policy/exponent is unresolved;
  the frontend never assumes all currencies have two minor digits.

## Verification limits

See [`ACCEPTANCE.md`](ACCEPTANCE.md) for actual pass/failure/skip counts and
environment details. Existing nonfatal warnings are reported there. A past G2
green build is only a baseline, not evidence for the R31 commit. Final CI,
official CodeQL security results and sanitized browser artifacts must identify
the actual PR head.

The PR remains Draft while required integrated evidence is unavailable. R31
does not assert SANDBOX_ACCEPTED for both collection rails, HOSTED_ACCEPTED,
RELEASE_ACCEPTED, zero defects or guaranteed conflict-free integration.
