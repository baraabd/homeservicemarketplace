# R17-E — Provider surface policy sources

Sprint R17, unit E. Base `develop@2710d259f5d798a4d7c47eed656743362f6975c6`.

This file records where each provider-surface rule comes from. It does not
create policy. Classes, as in R17-C and R17-D:

- **CONFIRMED**: an approved or accepted source states the rule.
- **APPLIED_ENGINEERING_RULE**: an authorization, integrity or honesty rule
  that follows from existing authority and needs no product choice.
- **DECISION_NEEDED**: a product, operations or money owner must decide. No
  default is guessed; the smallest fail-closed behaviour is in force.

## Rules

| #   | Topic                                       | Rule in force after R17-E                                                                                                                                                                 | Class                                              | Source                                                                                                  |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P1  | Which requests a provider may see           | Open, not deleted, not their own, in their service area, and in one of **their** categories. Feed, detail and bid submission use the same rule (`feedCategoryScope` + `serviceAreaWhere`) | CONFIRMED                                          | Sprint 7.x "strict category + city filter"; R07 "same predicate as detail"; Sprint 6 geo ADR 0003       |
| P2  | Browse filters                              | A `category`/`categoryId` query only narrows the provider's categories (intersection); a category they do not hold yields an empty page. Unknown or inactive ids stay 400                 | APPLIED_ENGINEERING_RULE                           | P1: a query parameter is not authorization                                                              |
| P3  | Zero categories                             | No work on any surface (was: every open request through the legacy feed)                                                                                                                  | CONFIRMED                                          | Sprint 7.x: "A provider with NO categories configured sees an empty feed (was: global feed)"            |
| P4  | New-request notifications                   | Sent only to providers whose feed can show the request; an uncategorised (custom-text) request notifies nobody                                                                            | APPLIED_ENGINEERING_RULE                           | P1; R09 "a provider is notified only about jobs their feed will show"                                   |
| P5  | Who may serve a custom-text request         | Nobody can see one (no provider category matches `null`). Unchanged behaviour on the canonical feed; the legacy zero-category leak was the only way to reach one                          | **DECISION_NEEDED** (1)                            | none                                                                                                    |
| P6  | Accepting a bid                             | Allowed only while the bidding provider **currently** holds `SUBMIT_BID`, decided inside the accept transaction with the provider's account and profile rows locked `FOR SHARE`           | APPLIED_ENGINEERING_RULE                           | capability rank 4: "Existing obligations only, no new work"; ADR 0006: one decision point               |
| P7  | A bid whose provider lost that capability   | Stays `PENDING`; acceptance answers 409 `PROVIDER_UNAVAILABLE`; nothing else changes. If the capability returns, the bid is acceptable again                                              | **DECISION_NEEDED** (2)                            | no rule says such a bid is rejected, expired, hidden or kept                                            |
| P8  | Withdrawing a bid while restricted          | Refused (withdraw needs `SUBMIT_BID`; unchanged)                                                                                                                                          | **DECISION_NEEDED** (2)                            | Sprint 9B.8 route matrix                                                                                |
| P9  | A provider profile with no account          | Cannot hold a capability, so its bids cannot become bookings                                                                                                                              | APPLIED_ENGINEERING_RULE                           | capability rank 0/1; such profiles exist only as seed data                                              |
| P10 | Existing bookings when restricted           | Readable and manageable (start, complete, cancel, message)                                                                                                                                | CONFIRMED                                          | capability rank 4: "Bookings already accepted are obligations to a seeker"; Sprint 9B.8 §1              |
| P11 | Existing bookings when work access lapses   | Not readable or manageable (`MANAGE_BOOKINGS` withheld at ranks 6 and 7; unchanged)                                                                                                       | CONFIRMED / **DECISION_NEEDED** (3)                | Sprint 9B.8 §5: "expired / revoked grant → working operations denied"; the seeker's booking is stranded |
| P12 | Booking history when suspended/terminated   | None beyond the own profile (unchanged)                                                                                                                                                   | CONFIRMED / **DECISION_NEEDED** (3)                | capability ranks 2–3: read + appeal only                                                                |
| P13 | Provider booking transitions                | Capability decided fresh per request by the guard; state decided by the conditional write (409 on a stale state); one booking event per transition                                        | CONFIRMED                                          | Sprint 5.4; R07; PLATFORM-TX-1                                                                          |
| P14 | Cancelling a booking                        | Requires a confirmation in the UI; the server rule is unchanged (SCHEDULED only)                                                                                                          | APPLIED_ENGINEERING_RULE                           | irreversible action                                                                                     |
| P15 | Capability changes during a session         | The workspace re-asks the capability endpoint every 30 s, on focus, on any provider 403 and on realtime status/notification events; the server stays the only decision point              | APPLIED_ENGINEERING_RULE                           | ADR 0006; capabilities are not carried in the token                                                     |
| P16 | Bid `badge`, provider `topPro`              | Not projected to seekers (`null` / `false`): no product code writes either; only the dev seed does                                                                                        | APPLIED_ENGINEERING_RULE / **DECISION_NEEDED** (4) | no recognition policy exists                                                                            |
| P17 | Price display                               | The stored amount, the record's currency code and its pricing type, unformatted as money; no currency symbol                                                                              | APPLIED_ENGINEERING_RULE                           | R15 money matrix (DISPLAY_ONLY); R16 P8                                                                 |
| P18 | Money unit and currency of a bid            | Unresolved: the bid form submits whole numbers and `HOURLY`; the currency is the `USD` column default; wallet/admin divide by 100                                                         | **DECISION_NEEDED** (5)                            | R16 P8; R17-D decision 5                                                                                |
| P19 | Wallet withdrawal                           | Disabled; no route exists; guarded by the no-write test                                                                                                                                   | CONFIRMED                                          | R16 (`R16_POLICY_BLOCKED`)                                                                              |
| P20 | A provider's link to a deactivated category | Still applies on every surface; an explicit filter naming it is 400                                                                                                                       | **DECISION_NEEDED** (6)                            | none; the three surfaces agree either way                                                               |

## Consolidated owner decision request

None of these blocks the R17-E merge. Each keeps a provider-side release gap
open until decided.

1. **Custom-text requests (P5).** Should an uncategorised request reach any
   provider (all in the area, a curated set, or none until categorised)?
2. **Pending bids after a capability loss (P7, P8).** Should such bids be
   rejected or withdrawn automatically, hidden from the seeker, or kept as
   they are (non-acceptable until authority returns)? May a restricted
   provider withdraw their own pending bids?
3. **Booking obligations after lapsed access or suspension (P11, P12).**
   Should a provider whose verification or grant lapsed keep managing
   bookings already accepted, as a restricted provider does? Should a
   suspended provider read their booking history?
4. **Recognition (P16).** Is there a "Top Pro" or bid-badge programme? If so,
   who decides it and on what evidence? The seed data writes both today.
5. **Money unit and currency (P18).** The same question as R16 P8 and R17-D
   decision 5, for the bid form and every booking amount.
6. **Deactivated categories (P20).** Should deactivating a category remove it
   from providers' matching immediately, or only from new applications?
