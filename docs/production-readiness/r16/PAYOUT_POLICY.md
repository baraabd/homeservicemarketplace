# R16 — Payout policy decision register

Status: **R16_POLICY_BLOCKED and R16_FUNDING_AUTHORITY_BLOCKED.**
Baseline: `develop@cc41787fc68053a858365475e997bd7f4af95faf` (2026-10-05).

This register records, for every decision a withdrawal lifecycle depends on,
whether an approved answer exists in the repository. It selects nothing. A
decision is:

- **CONFIRMED** — an approved source is recorded;
- **PROPOSED** — a candidate is written down, awaiting owner approval;
- **BLOCKED** — the required information or approval is absent.

No provider, currency, fee, limit, schedule or compliance model has been chosen
by this document or by the engineering work that produced it.

## Governing sources found

| Source                                                                                    | What it settles                                                                                                                                                                                       | What it does not settle                                                                                     |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `docs/adr/0014-money-subscriptions-ledger.md`                                             | Integer minor units + ISO-4217; double-entry append-only ledger; idempotency keys; webhook-authoritative Stripe and admin-reviewed manual rails **for provider subscriptions paid to HSM**.           | Anything about HSM holding customer money or transferring money to providers.                               |
| `docs/money/README.md`                                                                    | **"Payouts remain prohibited until a separate marketplace-funds ADR establishes whether HSM ever holds/transfers customer funds; provider subscription revenue must not be conflated with payouts."** | —                                                                                                           |
| `docs/money/LIVE_MONEY_GATE.md`                                                           | Live money is forbidden unless, among others, no High/Critical security finding is open and reconciliation/operator runbooks are approved. Defaults must fail closed.                                 | Payout-specific rules.                                                                                      |
| `docs/money/CURRENCY_POLICY.md`                                                           | One currency per transaction; no FX without a dedicated ADR; large minor units serialized as decimal strings.                                                                                         | Which currencies are supported.                                                                             |
| `docs/money/FAILURE_RECOVERY.md`, `IDEMPOTENCY.md`, `CONCURRENCY.md`, `RECONCILIATION.md` | Timeout = unknown outcome; database-enforced idempotency; no read-then-write on limited resources; reconciliation raises exceptions rather than rewriting history.                                    | Payout-specific states, rails, finality.                                                                    |
| `docs/production-readiness/r15/ACCOUNTING_POLICY.md`                                      | Ledger representation, caller-owned transactions, reversal without chaining, **no financial backfill**, no HTTP route, `ledger:post`/`ledger:read` granted to no role.                                | Fee, commission, tax, **payout schedule, escrow rule, supported-currency list or FX** — "none is approved". |
| `docs/production-readiness/FUNCTIONAL_COMPLETION_ROADMAP.md` § R16                        | R16 depends on "R15 plus an explicitly selected payout/provider/compliance model"; until then the disabled CTA must not become fake success.                                                          | The model itself.                                                                                           |

A search of `docs/adr/` (0001–0014) and `docs/**` for a marketplace-funds,
customer-funds, escrow or payout ADR found **none**.

## Decision register

| #   | Decision                                                                            | Status                                 | Source / evidence                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Whether HSM holds or transfers customer funds at all (marketplace-funds model)      | **BLOCKED**                            | Explicitly deferred to a future ADR by `docs/money/README.md`. Without it, there is nothing for a provider to withdraw.                                                                                                                         |
| P2  | Operating entity and supported recipient markets                                    | **BLOCKED**                            | No source. `ProviderProfile.serviceAreaCountryCode` is DISPLAY_ONLY (R15 matrix); the market registry governs onboarding, not funds.                                                                                                            |
| P3  | External payout rail, or an approved operator-controlled payout model               | **BLOCKED**                            | ADR 0014 names Stripe, Sham Cash, Syriatel Cash and cash offices **as collection rails for subscriptions**. Collection capability is not outbound-transfer capability; no outbound rail is selected.                                            |
| P4  | Evidence that the selected service supports outbound payouts to the target market   | **BLOCKED**                            | Depends on P2/P3. No vendor documentation has been researched because no vendor is selected; researching one would amount to choosing it.                                                                                                       |
| P5  | Origin of funds available for payout (funding provenance)                           | **BLOCKED**                            | `BLOCKED_FUNDING_AUTHORITY`: no checkout, capture, payment-intent or settlement persistence exists (R15 matrix: "Wallet / payout / withdrawal / invoice / refund / escrow / payment-intent tables — NO_PERSISTENCE"). See § Funding provenance. |
| P6  | When funds become eligible and when they remain restricted (holds, dispute windows) | **BLOCKED**                            | Depends on P1/P5 and the dispute policy; R15 records no escrow rule.                                                                                                                                                                            |
| P7  | Account purposes and normal-balance interpretation                                  | **BLOCKED**                            | R15 deliberately attaches no normal-balance meaning to any account (`ACCOUNTING_POLICY.md` § Representation). See § Proposed accounting shape.                                                                                                  |
| P8  | Supported currencies and unit precision                                             | **BLOCKED**                            | R15: "Which codes are supported is not decided". Bid/booking unit ambiguity is unresolved (R15 matrix risk 1).                                                                                                                                  |
| P9  | Minimum / maximum amount and aggregate (daily/monthly) limits                       | **BLOCKED**                            | No source.                                                                                                                                                                                                                                      |
| P10 | Fees, commission and rounding                                                       | **BLOCKED**                            | R15: no fee or commission is approved. `PROVIDER_PLATFORM_FEE_BPS` (env) feeds booking-derived reports only; `platform_fee_bps` setting is inert.                                                                                               |
| P11 | Destination ownership and verification                                              | **BLOCKED**                            | No destination model exists; depends on P3 (token/reference vs. stored details).                                                                                                                                                                |
| P12 | Recipient eligibility and compliance requirements (identity, sanctions, tax)        | **BLOCKED**                            | No owner-approved compliance requirements. Provider identity verification (ADR 0009/0010/0013) grants **work access**, and must not be read as payout KYC without an explicit decision.                                                         |
| P13 | Approval and separation-of-duties rules                                             | **BLOCKED**                            | No source. ADR 0014's manual rails use "authorized admin review" for incoming payments only.                                                                                                                                                    |
| P14 | Cancellation, definitive failure, ambiguous outcome and return behavior             | **PROPOSED** (engineering safety only) | `FAILURE_RECOVERY.md` already makes a timeout an unknown outcome. The rail-specific definitions of "definitive failure" and "returned" remain **BLOCKED** on P3. See `WITHDRAWAL_STATE_MACHINE.md`.                                             |
| P15 | Settlement finality and reconciliation authority                                    | **BLOCKED**                            | Depends on P3. `RECONCILIATION.md` sets the comparison principle, not the payout authority.                                                                                                                                                     |
| P16 | Data retention and permitted access for payout records and destinations             | **BLOCKED**                            | `DATA_RETENTION.md`: exact periods are "deployment/legal configuration, not hard-coded guesses".                                                                                                                                                |
| P17 | Sandbox acceptance and production activation requirements                           | **PROPOSED**                           | Reuse `LIVE_MONEY_GATE.md` and ADR 0014's dark → sandbox → live sequence. Note: the gate is **not** currently satisfied (see § Live-money gate status).                                                                                         |

**Result: 0 CONFIRMED, 2 PROPOSED, 15 BLOCKED.**

## Funding provenance

The roadmap requires the withdrawable balance to trace back to authenticated,
reconciled funding events. On the baseline:

- Customers never pay HSM through the platform. There is no checkout, capture,
  payment-intent table, webhook inbox for payments, or settlement record.
- `Booking.priceAmount` is a price agreement copied from the accepted bid, not a
  captured payment (R15 matrix).
- `ProviderEarningsService.availableBalance` is computed from bookings, mixes
  currencies and is labelled with the dominant currency (R15 matrix risk 3). It
  is a `BOOKING_DERIVED_ESTIMATE`, not money held.
- The R15 ledger is the only authoritative money store, has **no writer on any
  live path** and contains no rows outside its own tests (no backfill).

Therefore no balance exists that could legitimately be withdrawn:
**`BLOCKED_FUNDING_AUTHORITY`.** Building a checkout/capture subsystem to create
one is outside R16 and is not authorized.

## Proposed accounting shape (for owner review; not implemented)

Recorded only so that the owner can approve or reject it together with P1/P7.
It changes no R15 behavior.

- One `USER`-owned **provider payable** account per provider and currency
  (liability of HSM to the provider; credit-normal). Its credit balance is the
  only candidate for a withdrawable amount.
- One `USER`-owned **payout reserve** account per provider and currency, or a
  reservation row (see `WITHDRAWAL_STATE_MACHINE.md`), holding amounts requested
  but not yet settled — so that reserved funds are never counted twice.
- One `PLATFORM` **payout clearing** account per rail and currency, debited
  on settlement against the rail's settlement evidence.
- Funding would arrive as a `PLATFORM` cash/clearing debit and a provider
  payable credit, posted **only** from an authenticated, reconciled funding event
  defined by the marketplace-funds ADR (P1/P5).

R15's generic `sum(DEBIT) − sum(CREDIT)` must not be exposed directly as a
spendable amount; the eligible amount needs the approved account purposes (P7)
and restriction rules (P6).

## Live-money gate status on the baseline

Independent of the policy blockers, `LIVE_MONEY_GATE.md` is not satisfied on
`cc41787`:

- Five open CodeQL alerts at High or Critical security severity, all created
  2026-08-22 and already recorded in `docs/production-readiness/r11/IMPLEMENTATION.md`:
  #3 critical `js/type-confusion-through-parameter-tampering`; #1, #2, #4, #5 high.
- `develop` has no branch protection or ruleset (`GET /branches/develop/protection` → 404).

These do not block non-live analysis. They block any live activation.

## Questions for the owner

1. **Marketplace-funds model (P1/P5):** will HSM collect customer payment for
   bookings and hold it for providers? If not, a "withdrawal" feature has nothing
   to pay out and R16 should be re-scoped or closed as not applicable.
2. **Payout rail (P3/P4):** which outbound mechanism and operating entity, for
   which recipient countries? A collection product is not evidence of payouts.
3. **Currencies and limits (P8–P10):** supported payout currencies, minimum and
   maximum amounts, aggregate limits, fees and rounding.
4. **Eligibility and compliance (P6, P11–P13, P16):** hold/dispute windows,
   destination verification, recipient KYC/sanctions/tax requirements,
   approval/separation of duties and retention — with named sign-off.

Until these are answered, the wallet withdrawal CTA stays disabled, no
withdrawal route, worker or provider adapter exists, and R16 is not complete.
