# R30 — manual-payment prerequisite delivery

**R30 application runtime is NOT IMPLEMENTED.** This change repairs the G2
query-performance prerequisite under a separate recorded lease, records the
supplied package, conditionally registers its exact future ownership, and
prepares its shared integration requests. G2 acceptance and its verified
publication remain a required start barrier. A green preparation PR does not
establish a payment, receipt scan, review, activation or refund journey.

## Scope and source identity

| Field                            | Actual value                                                |
| -------------------------------- | ----------------------------------------------------------- |
| Sprint                           | R30, Wave 3, lane 2; P40 and P41-manual-adapter             |
| Requested feature mode           | Mode C; this prerequisite work uses Mode A                  |
| Branch                           | `feat/r30-manual-payment-review`                            |
| Fresh branch base                | `96e92825f9b65cf124317f43b55ce42fc97f5b49`                  |
| Base tree                        | `68f4e926eabeb37bb70382c62b75272cf67bd02c`                  |
| Approved R30 execution base/tree | Absent; the branch base is not an accepted G2 freeze        |
| Final published commit/tree      | Recorded in the PR body after normal hooks and publication  |
| Original user package            | `PROMPT.md`; original-byte digest in `SOURCE_MANIFEST.json` |
| Runtime schema/contracts/flags   | No R30 change applied; CR-002 through CR-005 are requests   |

The October 18 local preparation is historical context. Current evidence is
recreated and checked on this October 22 source. Old test counts are not
relabeled as tests of this checkout. No unmerged peer source is imported.

## Implemented prerequisite change

The canonical registry still described R30 as `RESERVED_PENDING_PACKAGE`, even
though the complete owner package was supplied. The current validator supports
conditional Wave 3 registration without an executable base. Under the owner's
standing G2 coordination delegation and a recorded exact lease, this change
registers R30 as `PLANNED` with a blocked G2 barrier and null frozen source. The
Wave 3 lane remains `BLOCKED`, with no startable lane or runtime shared lease.
Other lanes and the accepted G1 history are preserved.

The finite future list includes lane source, adjacent tests, dedicated runtime
tests and these evidence documents. It is a conditional handoff. After G2 is
accepted and owner-published, the coordinator must revalidate the paths against
that exact tree, assign isolated services and serialize shared integrations.

`G2_REVIEW.md` records the remaining source/evidence/performance decision and
the distinction between owner-merged repair PRs and an accepted freeze. This
task cannot grant its own gate acceptance or silently approve larger budgets.

## G2 performance prerequisite implementation

The existing measured candidate exceeded four unchanged proposed statement
ceilings. The leased repair reduces relationship reads while preserving the
request guards, ownership checks and serializer values:

| Surface                           | Implemented read change                                                                                                                                                                                  | Unchanged benchmark target |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------: |
| Seeker requests                   | Keep the authorized Prisma page/category selector; combine latest visible booking and active bid counts in one parameterized projection over only its returned IDs.                                      |                          5 |
| Provider available requests       | Add a fresh narrow profile/category-ID projection for this list. The shared full profile/detail reader remains available to its existing consumers.                                                      |                         10 |
| Provider bookings                 | Add a dedicated joined summary reader, selecting the provider's bounded page before joining serializer fields. Preserve the full wallet reader, fresh profile lookup and independent cursor-owner check. |                          7 |
| Administrative financial bookings | Join only the completed/nondeleted page's request/category/provider/user/seeker fields, preserving exact amount/fee calculations and the existing index.                                                 |                          3 |

All SQL values use `Prisma.sql`/`Prisma.join` parameters. The public response
contracts, authorization/capability guards, no-store behavior, schema,
migrations, dependency versions, R27 harness and proposed budgets are unchanged.
Scalar timestamps remain `Date` values; narrow read-model types describe the
actual selected fields without casting partial data to full relation entities.

Provider ordering remains scheduled time descending with nulls last, creation
time descending and ID descending. Admin ordering remains mutable update time
and ID descending. Both preserve the existing ID-anchor/skip semantics. The
new real PostgreSQL regression compares the replacement projections with the
prior Prisma selectors, including excluded/deleted/missing anchors and ties.
Default benchmark targets do not describe every parameter variant: provider
cursor ownership and explicit feed-category validation retain extra reads.

The shared booking reader also serves wallet projections, so the repair adds
`listForProviderSummary` rather than changing the wallet relation contract.
Existing unit assertions remain, with adapted doubles and additional narrow
projection/access cases. Actual checks and measurements are recorded in
`ACCEPTANCE.md`; a target in this table is not a measured pass.

The owner's merged dependency security upgrades make the current candidate
incomparable with the original G1 lockfile. A separate one-file CI lease adds
an immutable PR-base `repair-baseline` with the same candidate harness, while
retaining both original jobs. SHA/ancestry/checkout/lockfile guards prevent an
accidental self-comparison or mismatched dependency baseline. The unchanged
comparator must establish a complete observed matrix for this repair pair;
the original G1 pair's limitation remains recorded in `G2_REVIEW.md`.

Conditional registration exposed an existing governance-test assumption that
R32 was the only supplied Wave 3 package. The in-memory accepted-wave fixture
now freezes all supplied packages consistently while releasing only its existing
R32 example. It explicitly keeps R30 held and rejects an inconsistent R30 base.
The production validator and real accepted/publication records are unchanged.

## Source findings and integration design

| Finding                                            | Existing authority and required integration                                                                                                                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Obligations and attempts already exist             | Reuse `MoneyPaymentIntent`, `MoneyPaymentAttempt`, `MoneyIntentBinding` and `MoneyCommand`. The server owns price, currency, expiry, identity and configuration version.                                                                              |
| Receipt review has no financial persistence        | `MediaAssetPurpose` has no financial receipt purpose. CR-002 requests intent-bound reservations, immutable versions, inspected revision, review history and independent settlement claims.                                                            |
| Restricted transport is reusable                   | Reuse `RESTRICTED_OBJECT_STORAGE`, byte detection, counted sizes, SHA-256 and the real ClamAV adapter. Verification-case routes are not a finance workflow.                                                                                           |
| Identity workers have broader purpose scope        | The scan and preparation-cleanup candidates cover restricted assets without excluding finance. CR-003 requires purpose guards before storage actions and in final conditional mutations.                                                              |
| Finance access needs explicit scope                | Restricted namespace checks and source IAM templates cover verification. Add approved narrow finance access and retention without expanding identity erasure. Source templates are not deployed-IAM evidence.                                         |
| Receipt acceptance is two-stage                    | `acceptReceipt` commits a RECEIVED event and PROCESSING intent. `processExternalEvent` later performs authoritative payment, ledger, period and activation work. CR-004 requires final review/revision/deposit validation in that second transaction. |
| Durable event processing lacks a production caller | The inspected source defines `processExternalEvent` but does not compose its production invocation. A bounded recoverable manual inbox worker is required; calling it directly in tests is not delivery evidence.                                     |
| Refund confirmation has a distinct owner           | Preserve `MoneyRefundAdapterPort.submit/query` and the merged R32 `MONEY_REFUND_CONFIRMATION_PARTICIPANT`. Its unavailable registration is not evidence of runtime invocation.                                                                        |
| Manual-payment UI is absent                        | R30 owns its feature subtree; CR-005 requests coordinated routes and published DTOs. R33 retains the surrounding financial dashboard.                                                                                                                 |
| Currency display is not a universal division       | `money/wire.ts` forbids assuming two decimals. Approved market/currency/scale and instruction policy must exist before method availability.                                                                                                           |

## Required product behavior after the gate

Only selected, authorized Sham Cash, Syriatel Cash and cash-office methods may
become available. Missing approved merchant details, market/currency, review
authority or retention means `METHOD_DISABLED`. No unofficial vendor API,
consumer-wallet automation, destination, fee, price or approval threshold is
invented by this package.

The provider sees an existing server-owned obligation and immutable instruction
version. Reservation fixes the financial purpose and intent before bytes arrive.
Upload/finalization validates actual bytes, detected type, size and hash; review
requires an eligible real scan result. Replacement is a new asset/revision with
history. A provider-visible correction message remains separate from internal
reviewer notes and survives reload and sign-out/sign-in.

Review requires a fresh authorized finance actor, no self-review, approved
actor separation, the inspected current revision and an independently permitted
settlement reference. A receipt image, QR, hash or risk score is not proof of
funds. Canonical settlement identity must be scoped by rail/mode/merchant and
uniquely claimed only in authoritative confirmation.

The final review decision, settlement claim, existing R24 payment/ledger/period,
R31 activation participation, audit and notice intent must commit together.
Failure leaves the earlier durable received event available for recovery while
rolling back final economic consequences. Do not nest an independently
committing money command inside an R22 outbox transaction and call it atomic.

Manual refunds supply operator-reviewed transport observations to R32 policy.
Query uncertain attempts using the retained provider key before another
external action. A ledger reversal is not a transfer; timeout or inconclusive
absence remains `UNKNOWN` until independent reconciliation.

## Acceptance boundary

`ACCEPTANCE.md` separates executed preparation checks from unrun R30 tests.
`VERIFICATION_PLAN.md` maps the prompt's negative, concurrency, real-service,
browser, AR/EN, RTL/mobile and keyboard requirements. R16/R18, live-money,
identity, legal/age and work-access holds remain. No PR is merged, no push is
made to `develop`, and no deployment or live method activation is performed.
