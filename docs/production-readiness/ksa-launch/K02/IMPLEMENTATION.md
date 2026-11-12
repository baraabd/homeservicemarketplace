# K02 — Saudi product rules, currency and public legal journeys

Branch `release/ksa-k02-saudi-contracts`, base
`origin/develop@92770ea65ee1154f94f4251d5febfa39822f9b9a` (tree
`854a9146c05bf21ef62af060358f581ec4c19306`, equal to the audit reference).
K01 has no published deliverable (its worktree is clean at the same SHA, no
PR), so no K01 artifact is consumed. K02 is a launch work package, **not** an
R34–R38 lane; it changes no Wave 4 owned file and does not alter G3 status.

## Delivery modes

- **Mode A (integration/bug fix):** amount unit and currency, aggregation,
  bid DTO, Riyadh scheduling, phone normalisation, market initialisation.
- **Mode C (bounded feature):** versioned policy acceptance, public legal
  routes, operator CLI.
- **Mode B (scoped UX):** signup consent, public legal pages, app selector,
  language control, password/appearance controls, TextField text size,
  provider bid price field, wallet headline. No other surface was redesigned.

## 1. Amount-unit contract `hsm.amount-unit.v1`

`packages/contracts/src/money/amount-unit.ts`

- `APPROVED_CURRENCY_SCALES = { SAR: 2 }`, `LAUNCH_CURRENCY = 'SAR'`.
- `decimalToMinor` / `minorToDecimal`: exact string arithmetic; Arabic-Indic
  and Persian digits and `٫` accepted; signs, exponents, grouping separators,
  leading zeros and excess fraction digits refused (never rounded).
- `parseApprovedBidAmount(amountDecimal, currency)`: the one server
  conversion; range 0.01–1,000,000.00 SAR (fits PostgreSQL INTEGER).
- Aggregation types `CurrencyBookedValue`, `ExcludedAmountGroup`,
  `BookingFeeStatus = 'NOT_APPROVED'`.

### Database (migration `20261103090000_k02_amount_unit`)

- `Bid.amountScale`, `Booking.amountScale` SMALLINT NULL. NULL =
  LEGACY_UNVERIFIED; existing rows are **not updated**.
- `currency` default `'USD'` dropped on both tables (a write that forgets the
  currency now fails with 23502 instead of silently writing USD).
- CHECK `*_amountScale_currency_check`: non-null scale only as SAR + 2.
- CHECK `*_verified_amount_positive_check`: verified amounts > 0.

### API

| Surface                                                                                         | Change                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `POST /v1/me/provider/bids`, `/v1/provider/bids`                                                | Body `amountDecimal` + `currency` (+ `pricingType`). Legacy integer `amount` → 400 (not whitelisted). Server converts once, assigns SAR/2.                              |
| Bid → booking                                                                                   | `amountScale` copied unchanged; a legacy bid yields a legacy booking.                                                                                                   |
| Bid/booking/transaction projections                                                             | `amountScale: number                                                                                                                                                    | null` on every amount-bearing response. |
| `GET /v1/provider/earnings/summary`, `/v1/me/provider/earnings`, `/v1/admin/financials/summary` | `byCurrency[]` (verified FIXED only), `excluded[]` (LEGACY_UNVERIFIED / HOURLY_RATE counts), `feeStatus: NOT_APPROVED`. Fee, net and available-balance figures removed. |
| `GET /v1/provider/earnings/chart?currency=`                                                     | One approved currency per chart (default SAR); other currency → 400.                                                                                                    |
| Admin provider earnings                                                                         | One row per (provider, currency).                                                                                                                                       |
| Admin analytics                                                                                 | Money sums verified FIXED only; `excludedAmounts[]`; booking counts unchanged.                                                                                          |
| Dispute workspace booked-amount fact                                                            | Exact decimal + currency, or the raw value labelled LEGACY_UNVERIFIED.                                                                                                  |

Single aggregation rule: `infrastructure/persistence/bookings/booked-value.ts`.

### Web

`apps/web/src/lib/money/format-amount.ts` is the only bid/booking money
formatter (all roles). It formats an exact decimal **string** through
`Intl.NumberFormat` (no float), in each record's own currency; a null/absent
scale prints the raw value with "unverified legacy amount". The provider
bid form now asks for the price type, takes a labelled decimal SAR field
(`inputMode=decimal`) and validates with the server's rule.

## 2. Versioned policy acceptance

- Registry: `packages/contracts/src/iam/legal/legal-documents.ts`
  (`ksa-terms-2026-11-03.draft-1`, `ksa-privacy-2026-11-03.draft-1`, both DRAFT).
- Table `UserLegalAcceptance` (migration `20261103091000_k02_user_legal_acceptance`):
  user, document kind, exact version, locale, source `SIGNUP`, server
  `acceptedAt`; unique (user, kind, version); append-only; no backfill.
- `GET /v1/legal/documents` (public): current versions + `acceptanceOpen`.
- `POST /v1/auth/register` requires `legalAcceptance { termsVersion,
privacyVersion, locale }`. Validation runs **before** the account lookup,
  so stale versions answer identically for new and existing emails
  (409 `LEGAL_VERSION_STALE`); duplicates never add rows.
- In production, both documents must be approved, each with a
  nonblank approval reference and a new, non-draft release identifier.
  Otherwise signup returns 409 `LEGAL_ACCEPTANCE_CLOSED`.
  Hosted staging uses `NODE_ENV=production` with `APP_ENV=staging`, as required
  by the deployment runtime policy, and can rehearse drafts only with
  `LEGAL_DRAFT_ACCEPTANCE_ALLOWED=true`. `APP_ENV=prod` and production runtimes
  without that explicit staging identity always refuse drafts. Development
  and tests default to allowing drafts. Incomplete approved releases are
  refused in every environment, including staging rehearsal.
- Provider onboarding consent (`acceptedConsentVersion`) is unchanged and
  remains a separate agreement. No marketing consent exists, none was added.

### Public pages (Mode B)

Routes `/legal/{terms,privacy,operator,contact,subscriptions}`, public, full
width, Arabic/English, DRAFT banner, version shown, cross-links. Linked from
the selector footer and Settings. Signup consent: native checkbox whose label
is the statement only; "Read the Terms/Privacy" links are separate elements.
A plain click opens an in-place dialog (form, password and returnTo stay in
memory; focus returns to the link); a modified click opens the real page in a
new tab. Name/email (never password, never consent) persist in
`sessionStorage` across reload.

## 3. Saudi market, schedule, phone

- `LAUNCH_MARKET = { SA, Asia/Riyadh, +966, SAR }` and
  `zonedWallTimeToUtc` / `utcToZonedWallTime` / `todayInZone`
  (`packages/contracts/src/market/launch-market.ts`). The request wizard
  converts Riyadh wall time, not browser time; booking/request times render
  in Asia/Riyadh. DST-gap wall times return null.
- Phone: `normalisePhoneNumber` maps Arabic-Indic digits, strips bidi marks,
  `00` → `+`; the onboarding wizard now stores the normalised value and only
  resets verification when the normalised number changes. Copy example is
  `+966…`. No SMS is promised.
- Operator CLI: `pnpm --filter @homeservicemarketplace/database market:init:ksa
[--dry-run] [--replace]` (production: `ALLOW_PROD_MARKET_INIT=true`). One
  serialisable transaction with an advisory lock writes the setting, a
  `PlatformSettingHistory` row and an `ADMIN_SETTING_UPDATED` audit event;
  identical value → UNCHANGED (no writes); different value → refused unless
  `--replace`. The dev seed is untouched.

## 4. Other UX/a11y corrections on touched surfaces

App selector (bilingual, one brand, language toggle, no viewport/developer
labels, legal footer, reduced-motion); LangToggle (localised name stating the
current language, 44 px, fixed RTL pill bug); TextField editable text 16 px and
reduced-motion label; password toggle named + `aria-pressed`, 44 px; Settings
dark-mode switch `role=switch`/`aria-checked`, back button named, legal rows
restored; password hint now matches the 12-character rule; wallet sections no
longer shrink and clip; wallet chart honours reduced motion; `<title>` FixNow.

## Ownership notes

`WalletScreen.tsx` and `FinancialsSection.tsx` were last changed by R33
(merged). K02 edits them for the amount contract only; R33's subscription
history link and wording are preserved.

### Bilingual owner review

The [Terms](review-2026-11-08/terms.md) and [Privacy Notice](review-2026-11-08/privacy.md) are the review copies presented to the owner on 8 November 2026. The owner agreed to continue on 9 November. The notes identify missing operator details and business and legal decisions. Neither review identifier is offered for signup. Record the final versions and the dated approval reference after those details are supplied and the final public wording has been presented.
