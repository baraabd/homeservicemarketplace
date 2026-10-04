# R15 — Money authority matrix

Inventory of every money-related element on `develop@a2b31c3` before R15, and
what R15 changes. Classes: AUTHORITATIVE_SOURCE, BOOKING_DERIVED_READ_MODEL,
DISPLAY_ONLY, PLACEHOLDER, NO_PERSISTENCE, EXTERNAL_PROVIDER_REQUIRED,
UNSAFE_TO_ACTIVATE.

**Before R15 nothing in the repository was an AUTHORITATIVE_SOURCE of money.**
R15 adds the first authoritative persistence (the ledger) but connects nothing to
it.

## Persistence

| Element                                                                          | Where                                            | Class                           | Notes                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| `Bid.amount` (Int)                                                               | `schema.prisma` Bid                              | BOOKING_DERIVED_READ_MODEL      | Provider offer. DTO allows 1..100,000,000; the unit is ambiguous (see risks).       |
| `Bid.currency` (String, default `USD`)                                           | Bid                                              | PLACEHOLDER                     | Never sent by the client; no ISO check.                                             |
| `Booking.priceAmount` (Int)                                                      | Booking                                          | BOOKING_DERIVED_READ_MODEL      | Copied from the accepted bid. A price agreement, not a captured payment.            |
| `Booking.currency` (default `USD`)                                               | Booking                                          | PLACEHOLDER                     | Copied from the bid.                                                                |
| `ProviderProfile.subscriptionTier`                                               | ProviderProfile                                  | UNSAFE_TO_ACTIVATE              | Inert; never grants a capability; nothing paid behind it.                           |
| `ProviderProfile.serviceAreaCountryCode`                                         | ProviderProfile                                  | DISPLAY_ONLY                    | Documented future market/currency key.                                              |
| `DisputeStatus.RESOLVED_REFUND / RESOLVED_PARTIAL`                               | enum                                             | DISPLAY_ONLY                    | Legacy labels, explicitly not evidence of a refund.                                 |
| `Dispute.resolution`, dispute proposals/decisions                                | Dispute\*                                        | NO_PERSISTENCE                  | No amount column anywhere.                                                          |
| `PlatformSetting` `platform_fee_bps`, `default_currency`                         | PlatformSetting                                  | UNSAFE_TO_ACTIVATE              | Stored but never read by fee code (fee comes from env `PROVIDER_PLATFORM_FEE_BPS`). |
| Wallet / payout / withdrawal / invoice / refund / escrow / payment-intent tables | —                                                | NO_PERSISTENCE                  | None exist.                                                                         |
| **`LedgerAccount`, `LedgerTransaction`, `LedgerEntry`** (R15)                    | migration `20261004150000_r15_ledger_foundation` | **AUTHORITATIVE_SOURCE (dark)** | Double-entry, append-only, DB-enforced. No writer on any live path.                 |

## Contracts (`packages/contracts/src/money`)

| Element                                                                                     | Class                             | Notes                                                         |
| ------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| `Money { amountMinor: bigint; currency }`, `LedgerSide`, `LedgerEntryContract`              | AUTHORITATIVE_SOURCE (shape only) | R15's sides and minor units match these types.                |
| `PAYMENT_METHODS`, `PAYMENT_INTENT_STATUSES`, `SUBSCRIPTION_STATUSES`, quote/plan contracts | EXTERNAL_PROVIDER_REQUIRED        | Types only; no persistence or route. R15 does not touch them. |

## API

| Element                                               | Class                                           | Notes                                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `modules/money` domain/policy/application (pre-R15)   | AUTHORITATIVE_SOURCE (pure functions)           | `normalizeCurrency`, `assertBalancedLedger` are reused by R15. Was not mounted; R15 mounts only `LedgerModule`.                                        |
| `/v1/me/provider/earnings` (`ProviderWalletService`)  | BOOKING_DERIVED_READ_MODEL                      | Sums bookings; not money held.                                                                                                                         |
| `/v1/provider/earnings/*` (`ProviderEarningsService`) | BOOKING_DERIVED_READ_MODEL / UNSAFE_TO_ACTIVATE | `availableBalance` is a computed figure labelled like a balance; sums `priceAmount` across currencies and labels the total with the dominant currency. |
| `/v1/admin/financials/*`, `/v1/admin/analytics/*`     | BOOKING_DERIVED_READ_MODEL                      | Same booking sums; fee from env; refunds untracked.                                                                                                    |
| **`LedgerService` / `LedgerRepository`** (R15)        | AUTHORITATIVE_SOURCE (dark)                     | No controller. Callable only from server code.                                                                                                         |

## Web

| Element                                                 | Class                             | Notes                                                                                                                                            |
| ------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WalletScreen`                                          | BOOKING_DERIVED_READ_MODEL        | Divides by 100 for every currency. Withdrawal CTA disabled ("coming soon"): PLACEHOLDER, no fake success. **Not switched to the ledger in R15.** |
| `FinancialsSection`, `DashboardOverview`                | BOOKING_DERIVED_READ_MODEL        | Default USD, divide by 100.                                                                                                                      |
| Bid/booking price displays (`$${bid.amount}`, "USD/hr") | DISPLAY_ONLY / UNSAFE_TO_ACTIVATE | Treat the same integers as whole units while wallet/admin screens treat them as cents.                                                           |
| `EcosystemContext.WALLET_TRANSACTIONS`                  | PLACEHOLDER                       | Mock array, no live consumer.                                                                                                                    |

## Risks recorded, not fixed in R15

R15 is a persistence foundation. These pre-existing defects belong to the
money/earnings product work that will decide units, currencies and cut-over:

1. Bid/booking amount unit ambiguity (whole units in the bid UI, minor units in
   wallet/admin).
2. Earnings sums mix currencies.
3. `availableBalance` is presented as if it were money held.
4. `platform_fee_bps` / `default_currency` settings are inert.

No booking, bid or earnings figure is imported into the ledger (see
`ACCOUNTING_POLICY.md` § Historical data).
