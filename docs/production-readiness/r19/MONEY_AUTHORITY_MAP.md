# R19 — Money authority map

These are different things. None of them is evidence of another.

| Concept                          | What it is                                                  | Authority (where it lives)                                                            | State at R19                                                               |
| -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Agreed booking price             | what a seeker and provider agreed for a job                 | `Bid.amount`, `Booking.priceAmount` (unit ambiguous: R18 D-2)                         | price agreement only; never posted to the ledger, never a payment          |
| Estimated earnings               | a sum of completed bookings shown to a provider or admin    | booking-derived read models (wallet, financials)                                      | not money held, not withdrawable; not switched to the ledger               |
| Provider-subscription collection | a provider paying HSM for a plan version                    | `MoneyPaymentIntent` → `MoneyPaymentConfirmation` (R19)                               | **dark**: schema and atomic unit exist; no rail, route or live caller      |
| Captured subscription revenue    | the ledger posting a confirmation produces                  | `LedgerTransaction` (R15), exactly one per confirmation                               | dark; account purposes undecided (R16 P7)                                  |
| Subscription refund              | returning part or all of one confirmed subscription payment | `MoneyRefund` reservation + linked compensating posting, or R15's exact full reversal | dark; refund policy undecided (R19-P2)                                     |
| Settlement                       | a rail paying out collected funds to HSM's own account      | none                                                                                  | not modeled; reconciliation evidence only (`docs/money/RECONCILIATION.md`) |
| Marketplace payout / withdrawal  | money paid to a provider                                    | none                                                                                  | **policy-blocked** (R16 P1–P15); not in scope                              |
| Customer funds / escrow          | holding a seeker's money for a booking                      | none                                                                                  | **policy-blocked** (R16 P1); not in scope                                  |

Rules that follow:

- Subscription revenue is HSM's own income from providers. It is never a
  provider's withdrawable earning.
- A booking completing never posts revenue. Nothing in the code connects
  bookings to the ledger, and the R19 suite asserts this.
- Approving a plan purchase grants no identity verification and no work
  access. Those remain separate server-owned authorities (ADR 0013).
