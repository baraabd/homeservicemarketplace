# Sprint 5 — Provider Integration Plan (Slice 5.0 Audit)

This document is the output of Sprint 5 Slice 5.0 (Preflight & Scope Lock). It is an
**audit and plan**, not implementation. No backend, schema, or product code has
changed in this slice. Sprint 5 implementation slices (5.1–5.7) read from this doc.

Audit date: 2026-04-30
Working tree commit at audit time: `a6b3552` on `fix/monorepo-build-order`.

## TL;DR

- The schema is **already Provider-aware**: `ProviderProfile`, `Bid`, `Booking`,
  `Conversation`, `ConversationParticipant` (with `providerProfileId` slot),
  `BookingEvent`, and `Notification` all carry the foreign keys + indices needed for
  Provider read paths. No migration is required for slices 5.1–5.4.
- The Seeker side has stopped using `EcosystemContext` for marketplace data; only the
  admin-controlled `showHourlyRate` flag is still read from it. The Provider app is
  the **only** remaining consumer of `requests`, `submitBid`, `acceptBid`,
  `completeJob`, `WALLET_TRANSACTIONS`, `EARNINGS_CHART_DATA`.
- The Provider app is therefore an **isolated rewire**, not a co-mingled refactor —
  changes there cannot regress the Seeker.
- Real users only get the `customer` role at registration today. Slice 5.1 must
  introduce a deliberate Provider onboarding/upgrade path before any Provider
  read/write endpoint will return a meaningful row.
- One `setTimeout` fake-success path exists in `BiddingModal.handleSubmit` and a
  second in `WalletScreen.handleWithdraw`. Both must die in their respective slices.

## 0. Assumptions

1. The Seeker integration shipped through Sprints 1–4 is the reference contract for
   how a domain is wired (DTO + class-validator + ValidationPipe forbidNonWhitelisted +
   service layer + repository + AppError mapping + e2e + unit tests + frontend hook +
   axios wrapper + React Query).
2. Sprint 5 ships only Provider **integration**, not Provider **product features**.
   Verification documents, payouts, live tracking, payment processing, and review
   moderation are deferred to Sprint 6+.
3. The Provider UI is the reference design and must not visually drift. Visual
   identity (gradients, fonts, spacing, shadows) is locked.
4. The orphan file `apps/api/ff` from older audits is already gone (verified — no
   such path exists). No cleanup needed in this slice.
5. Slice 4.2 (avatar upload) and Slice 4.3 (request attachments) are still not
   implemented — they're independent of Sprint 5 and not on this critical path.

## 1. Current Branch / Git State

```
branch:   fix/monorepo-build-order
status:   clean
recent:
  a6b3552 chore(testing): add seeker runtime regression harness
  f235bf2 fix(seeker): stabilize job wizard location and scheduling
  466c5f0 fix(seeker): persist profile updates
  b68e809 fix(seeker): stabilize sprint 1 to sprint 3 runtime flows
  2321d48 feat(seeker): integrate chat conversations and messages
  8a45def feat(seeker): integrate job detail with request and booking data
  1f1c32d feat(seeker): integrate bookings foundation
  f05340f feat(seeker): accept bids transactionally
  0ba210a feat(seeker): integrate bids read API
  3bf67e0 feat(seeker): integrate service requests and my requests
```

All Sprint 1–4 commits are present. No unrelated uncommitted files. `apps/api/ff`
does not exist. Static gates run during this audit:

- `pnpm --filter @homeservicemarketplace/contracts build` — green
- `pnpm --filter @homeservicemarketplace/database prisma:validate` — green
- `pnpm --filter @homeservicemarketplace/api typecheck` — green
- `pnpm --filter @homeservicemarketplace/web typecheck` — green

## 2. Provider Frontend Inventory

The entire Provider surface lives in **one** file: `apps/web/src/app/components/provider/ProviderApp.tsx` (1341 lines), routed via `apps/web/src/app/pages/ProviderPage.tsx` (a 6-line wrapper). No subdirectory of provider components exists yet.

| Provider screen          | Lines (approx) | Data source today                                                                                                                                            |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BiddingModal` (in-file) | 49–265         | Local state + `setTimeout`                                                                                                                                   |
| `JobPin`                 | 268–341        | Reads `req.mapX/mapY/budget/status/distance/seekerName` from EcosystemContext rows                                                                           |
| `LiveJobsScreen`         | 344–612        | `useEcosystem().requests`, `useEcosystem().submitBid`                                                                                                        |
| `MyBidsScreen`           | 615–809        | Filters `useEcosystem().requests[].bids` by hardcoded `providerName === 'Omar K.'`                                                                           |
| `WalletScreen`           | 812–1028       | Static `WALLET_TRANSACTIONS`, `EARNINGS_CHART_DATA`; `setTimeout` withdraw                                                                                   |
| `ProviderProfileScreen`  | 1031–1210      | Hardcoded "Omar Al-Khalid", "OK", "Pro Professional", "Member since Jan 2023", "156 / 4.8★ / ~8min", local-state availability toggle, hardcoded SKILLS array |
| `ProviderApp` shell      | 1221–1341      | Hardcoded "Omar Al-Khalid", "OK" in the top bar; static unread count "2" on the bell                                                                         |

Routing is mounted under `EcosystemProvider` (`Root.tsx:156`). Removing or replacing
`EcosystemContext` would break the Seeker's `showHourlyRate` flag (used in
`HomeScreen.tsx:256`, `JobDetailView.tsx:431`, `BidsScreen.tsx:147`,
`AllLeadsView.tsx:97`). **Conclusion:** keep `EcosystemContext` for `showHourlyRate`
through Sprint 5; replace its `requests` / `submitBid` / `acceptBid` / `completeJob` /
`WALLET_TRANSACTIONS` / `EARNINGS_CHART_DATA` exports with empty stubs at the very
end of Sprint 5 once nothing reads them, or delete those exports entirely once
`ProviderApp` consumes real APIs.

## 3. Provider Mock / Hardcoded State Audit

### 3a. Hardcoded Provider identity (must die in Slice 5.1)

| Where                       | Value                                                                | Replace with                                                                                         |
| --------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ProviderApp.tsx:1069,1265` | `"OK"` initials                                                      | `useProviderIdentity().initials` (server-derived, same pattern as Seeker `useAuthIdentity`)          |
| `ProviderApp.tsx:1074,1265` | `'Omar Al-Khalid' / 'عمر الخالد'`                                    | `useProviderIdentity().displayName`                                                                  |
| `ProviderApp.tsx:1082`      | `'Member since Jan 2023'`                                            | `profile.createdAt` formatted                                                                        |
| `ProviderApp.tsx:1090`      | `'156' / '4.8★' / '~8min'` (jobs / rating / response time)           | `profile.completedJobs / profile.ratingAvg / profile.avgResponseMinutes`                             |
| `ProviderApp.tsx:1051–1056` | `SKILLS` array (Plumbing/Electrical/AC Repair/Carpentry hardcoded)   | Server-driven `provider.serviceCategories[]`                                                         |
| `ProviderApp.tsx:375–378`   | `'Omar K.'` / `'عمر خ.'` / `4.8` / `156` injected into `submitBid()` | Removed — server reads `providerId` from session                                                     |
| `ProviderApp.tsx:621`       | `b.providerName === 'Omar K.'` filter                                | Server-side `GET /v1/me/provider/bids`                                                               |
| `ProviderApp.tsx:1277`      | `2` unread bell badge                                                | `GET /v1/me/notifications/unread-count`                                                              |
| `ProviderApp.tsx:409`       | `'Riyadh, SA'` map status pill                                       | `provider.serviceArea.label`                                                                         |
| `ProviderApp.tsx:46`        | unsplash MAP_IMG URL                                                 | Acceptable visual placeholder for now (out of scope: real map). Document but do not fix in Sprint 5. |

### 3b. setTimeout fake success (must die)

| Where                                                     | Effect                                                                  | Slice                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ProviderApp.tsx:85–93` (`BiddingModal.handleSubmit`)     | 1.2 s spinner → 1.6 s "Sent" → close. No network call.                  | 5.3                                                                                  |
| `ProviderApp.tsx:834–838` (`WalletScreen.handleWithdraw`) | 1.5 s spinner → "Sent $200 to bank ✓". No network call. Hardcoded $200. | 5.5 — **OR deferred** if payouts are out of scope (recommended deferral to Sprint 6) |

### 3c. Static earnings/wallet (Slice 5.5)

`EcosystemContext.tsx:337–402` exports `WALLET_TRANSACTIONS` (6 rows) and
`EARNINGS_CHART_DATA` (7 rows). `WalletScreen` also has hardcoded `$1,240.00`,
`$45.00`, `$310.00`, `$1,240` balance/pending/this-week/this-month figures
(`ProviderApp.tsx:858, 866, 874, 882`).

### 3d. Local-state production source

| State                        | Current source                                              | Needs to be                                                                |
| ---------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Provider availability toggle | `useState(true)` in `ProviderProfileScreen`                 | Server: `PATCH /v1/me/provider/availability`                               |
| Bid filter on My Bids        | `useEcosystem().requests[].bids` filtered by hardcoded name | Server: `GET /v1/me/provider/bids?status=...`                              |
| Live Jobs feed               | `SEED_REQUESTS` via context                                 | Server: `GET /v1/provider/available-requests`                              |
| Pin coordinates              | `mapX/mapY` percentages baked into `SEED_REQUESTS`          | Server: address `lat`/`lng` from `manualAddress` (already captured in 4.1) |

### 3e. Search results for the slice's required patterns

```
ProviderApp                — 2 files (Root.tsx route, ProviderApp.tsx itself)
useEcosystem               — 16 files (Provider + 4 seeker views still importing for showHourlyRate)
SEED_REQUESTS              — 1 file (EcosystemContext.tsx, only definition + use)
submitBid / acceptBid /
completeJob                — EcosystemContext.tsx + ProviderApp.tsx only
WALLET_TRANSACTIONS        — 2 files (definition + WalletScreen)
EARNINGS_CHART_DATA        — 2 files
providerName               — 8 hits, all in ProviderApp.tsx, EcosystemContext.tsx, BidsScreen.tsx
'Omar K.' / 'عمر خ.'       — 2 files (ProviderApp.tsx, EcosystemContext.tsx)
'Riyadh, SA'               — 1 hit (ProviderApp.tsx:409)
mapX / mapY                — only in EcosystemContext.tsx and consumed in ProviderApp.tsx
providerRating /
providerJobs               — only in EcosystemContext.tsx + ProviderApp.tsx
setTimeout                 — 12 hits in apps/web (most are legitimate UX timing); the
                             only Provider production-path ones are the two listed in
                             §3b above.
```

## 4. Existing Backend / DB Capability

### 4a. Schema (already Provider-ready)

| Model                                      | Field                                                                                       | Already supports Provider? | Notes                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`                                     | `providerProfile` 1:1                                                                       | ✓                          | Nullable. A user becomes a provider when this row exists.                                                                                                                                                     |
| `ProviderProfile`                          | `userId` nullable                                                                           | ✓                          | Allows seed bids without a real account; production rows will have a userId.                                                                                                                                  |
| `ProviderProfile`                          | `displayName, initials, avatarUrl, ratingAvg, reviewCount, completedJobs, verified, topPro` | ✓                          | All denormalised fields the UI needs.                                                                                                                                                                         |
| `ProviderProfile`                          | service-area / availability / categories                                                    | ✗                          | **Missing.** Slice 5.1 needs to add `serviceCategories` (m:n with `ServiceCategory`), `serviceAreaCity`, `serviceAreaCountry`, `serviceAreaLat/Lng`, `serviceAreaRadiusKm`, `availability` (enum or boolean). |
| `Bid`                                      | `providerId` FK                                                                             | ✓                          | Already indexed `(providerId, status)`.                                                                                                                                                                       |
| `Bid.status` enum                          | `PENDING / ACCEPTED / REJECTED / WITHDRAWN`                                                 | ✓                          | Withdrawn supported at the DB level; nothing has emitted it yet.                                                                                                                                              |
| `Booking`                                  | `providerId` FK + `(providerId, status)` index                                              | ✓                          | "List provider bookings" is a single-index query.                                                                                                                                                             |
| `BookingEvent.type` enum                   | `BOOKING_CREATED / CANCELLED / STATUS_CHANGED / RESCHEDULED`                                | ✓                          | `STATUS_CHANGED` covers IN_PROGRESS → COMPLETED transitions.                                                                                                                                                  |
| `Conversation` + `ConversationParticipant` | `providerProfileId` slot                                                                    | ✓                          | The chat module's existing tests already exercise the dual-slot pattern.                                                                                                                                      |
| `Notification`                             | per-user feed                                                                               | ✓                          | Already fanned out from the bid-accept transaction (`apps/api/src/modules/bids/bids.service.ts:201,214`). Provider-side fan-out (BID_RECEIVED to provider on bid-create) needs to be added in Slice 5.3.      |

### 4b. IAM (gap)

- Registration assigns the `customer` role only (`authentication.service.ts:116–118`).
  No path exists today to make a user a provider.
- The `provider` role is seeded in `packages/database/src/seed.ts:118` but never
  attached to anyone in production code.
- `RolesGuard` exists in IAM and is unused on Seeker endpoints. Sprint 5 will need
  it on Provider endpoints to gate access by role.

### 4c. Service surface (gap)

Today's controllers all live under `me/...` and are scoped to the authenticated
**seeker**. There is **no** Provider controller. New Provider controllers live under
`me/provider/...` (per-user provider state) and `provider/...` (cross-cutting reads
like the available-requests feed).

| Today                                                             | Slice 5 adds                                                                                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/me/profile` (seeker)                                     | `GET, PATCH /v1/me/provider/profile`                                                                                                                   |
| `GET /v1/me/requests/:id/bids` (seeker — read bids on my request) | `GET /v1/me/provider/bids` (provider — list my own bids), `POST /v1/provider/requests/:id/bids` (create bid), `POST /v1/me/provider/bids/:id/withdraw` |
| `POST /v1/me/requests/:requestId/bids/:bidId/accept` (seeker)     | unchanged — already provider-aware on the data side; Slice 5.3 just wires Notification fan-out to the provider                                         |
| `GET /v1/me/bookings` (seeker)                                    | `GET /v1/me/provider/bookings`, `POST /v1/me/provider/bookings/:id/start`, `POST /v1/me/provider/bookings/:id/complete`                                |
| — (no available-requests feed)                                    | `GET /v1/provider/available-requests` (geo-scoped, filterable by category)                                                                             |
| `GET /v1/me/notifications` (seeker)                               | unchanged — provider uses the same per-user feed; Slice 5.3 just adds new fan-out writes                                                               |
| `GET /v1/me/conversations` (seeker)                               | unchanged — provider uses the same surface once `providerProfileId` participants are written; Slice 5.3 / 5.4 will create those participant rows       |

### 4d. BidsService gap (Slice 5.3)

`BidsService` today exposes only `listForRequest`, `detail`, `accept`. There is **no**
`create` and no `withdraw`. The schema comment at `bids.service.ts:84–93` already
acknowledges this (the at-most-one-active-bid invariant is described as "implemented
in slice 2.2" but in fact only the accept side ships). Slice 5.3 implements both,
inside a transaction, with the at-most-one-active-bid-per-(request, provider) check
the comment promises.

### 4e. BookingsService gap (Slice 5.4)

`BookingsService` exposes `listForSeeker`, `getDetail`, `getTimeline`, `cancel`. There
is no `start` or `complete` action and no provider-side list. Slice 5.4 adds:

- `listForProvider(providerId, query)` (uses the existing `(providerId, status)` index)
- `start(providerId, bookingId)` — IN_PROGRESS transition with `BOOKING_STATUS_CHANGED` event
- `complete(providerId, bookingId)` — COMPLETED transition + provider stats refresh + notification

## 5. Existing Contracts Capability

### 5a. Reusable as-is

- `BidStatus`, `PricingType`, `BidBadge` enums (`packages/contracts/src/seeker/bids/enums/`)
- `BookingStatus`, `BookingEventType` enums
- `ConversationParticipantRole` enum (already includes `PROVIDER`)
- `NotificationType` enum (already includes `BID_RECEIVED`, `BOOKING_CREATED`,
  `BOOKING_CANCELLED`, `BOOKING_COMPLETED`, `MESSAGE_RECEIVED`, `REVIEW_REQUESTED`)
- `NotificationResourceType` enum (already includes `BID`, `BOOKING`, `CONVERSATION`)

### 5b. New per slice

| Slice | New contract files (under `packages/contracts/src/`)                                                                                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1   | `provider/profile/response/provider-profile-summary.ts`, `request/upgrade-to-provider.request.ts`, `request/update-provider-profile.request.ts`, `response/upgrade-to-provider.response.ts`, `response/get-provider-profile.response.ts`, `response/update-provider-profile.response.ts` |
| 5.2   | `provider/feed/response/available-request-summary.ts`, `available-request-list.response.ts`, `request/list-available-requests.query.ts`                                                                                                                                                  |
| 5.3   | `provider/bids/request/create-bid.request.ts`, `request/list-provider-bids.query.ts`, `response/create-bid.response.ts`, `response/provider-bid-list.response.ts`, `response/withdraw-bid.response.ts`                                                                                   |
| 5.4   | `provider/bookings/response/provider-booking-list.response.ts`, `response/start-booking.response.ts`, `response/complete-booking.response.ts`, `request/list-provider-bookings.query.ts`                                                                                                 |
| 5.5   | `provider/wallet/response/earnings-summary.ts`, `transactions-list.response.ts`, `request/list-transactions.query.ts` (read-only — no payout endpoint in Sprint 5)                                                                                                                       |
| 5.6   | None (chat / notifications already typed; provider just consumes the same shapes)                                                                                                                                                                                                        |

### 5c. Naming convention

The seeker contracts live under `packages/contracts/src/seeker/`. Provider contracts
should mirror that: `packages/contracts/src/provider/<domain>/...`. Both export from
`packages/contracts/src/index.ts`.

## 6. Provider Integration Gap Analysis

| #   | Feature / Screen                                               | Frontend source today                                                           | Backend support?                                                               | DB model?                                                                                          | Contract?               | Mock/hardcode risk               | Required endpoint                                                                                                                                                                                                                      | Required hook/API                                                         | Slice | Priority  |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----- | --------- |
| 1   | Provider auth/role access                                      | `customer` role assigned at register; no provider role assignment path          | partial                                                                        | ✓ (`Role`, `UserRole`)                                                                             | ✗                       | High                             | `POST /v1/me/provider/upgrade` + `RolesGuard('provider')` on Provider routes                                                                                                                                                           | `useProviderUpgrade`, `useProviderIdentity`                               | 5.1   | **P0**    |
| 2   | Provider profile (display, skills, service area, availability) | Hardcoded "Omar Al-Khalid", `SKILLS` literal, local availability state          | ✗                                                                              | partial (`ProviderProfile` exists but missing serviceCategories m:n + service-area + availability) | ✗                       | Critical — every screen reads it | `GET, PATCH /v1/me/provider/profile`, `PATCH /v1/me/provider/availability`                                                                                                                                                             | `useProviderProfile`, `useUpdateProviderProfile`, `useUpdateAvailability` | 5.1   | **P0**    |
| 3   | Service categories / skills                                    | Hardcoded array                                                                 | partial (`ServiceCategory` exists; provider linkage missing)                   | partial                                                                                            | ✓ for `ServiceCategory` | High                             | Reuse `GET /v1/services` for catalog; profile endpoint accepts `categoryIds[]`                                                                                                                                                         | `useServices` (already exists)                                            | 5.1   | **P0**    |
| 4   | Service area / location                                        | Hardcoded `'Riyadh, SA'`; `mapX/mapY` baked into seeds                          | ✗                                                                              | ✗ (need new fields on ProviderProfile)                                                             | ✗                       | Medium                           | Carried in `PATCH /v1/me/provider/profile` body                                                                                                                                                                                        | Same as #2                                                                | 5.1   | P1        |
| 5   | Live Jobs feed (available requests)                            | `useEcosystem().requests` (5 seed rows)                                         | ✗                                                                              | ✓ (`ServiceRequest` + `manualAddress.lat/lng` from 4.1)                                            | ✗                       | Critical                         | `GET /v1/provider/available-requests?categoryId=&maxKm=&limit=&cursor=`                                                                                                                                                                | `useAvailableRequests`                                                    | 5.2   | **P0**    |
| 6   | Map pins / distance                                            | Static `mapX/mapY` percentages                                                  | ✗ (real geo math missing)                                                      | partial (lat/lng on requests after 4.1)                                                            | ✗                       | Medium                           | Same as #5; service computes haversine distance against provider's service area                                                                                                                                                        | Same                                                                      | 5.2   | P1        |
| 7   | Job detail (provider POV)                                      | Reads from local request row                                                    | partial (`GET /v1/me/requests/:id` is seeker-only)                             | ✓                                                                                                  | ✗                       | High                             | `GET /v1/provider/requests/:id` (no PII; subset of seeker detail)                                                                                                                                                                      | `useProviderRequestDetail`                                                | 5.2   | P1        |
| 8   | Submit bid                                                     | `setTimeout` fake; injects hardcoded provider identity                          | ✗                                                                              | ✓                                                                                                  | ✗                       | Critical                         | `POST /v1/provider/requests/:id/bids`                                                                                                                                                                                                  | `useCreateBid`                                                            | 5.3   | **P0**    |
| 9   | My Bids list                                                   | Filtered by hardcoded `providerName === 'Omar K.'`                              | ✗                                                                              | ✓ (`(providerId, status)` index already exists)                                                    | ✗                       | Critical                         | `GET /v1/me/provider/bids?status=&limit=&cursor=`                                                                                                                                                                                      | `useProviderBids`                                                         | 5.3   | **P0**    |
| 10  | Bid withdraw / edit                                            | Not present in UI                                                               | ✗                                                                              | ✓ (`BidStatus.WITHDRAWN` already in enum)                                                          | ✗                       | Low — no UI yet                  | `POST /v1/me/provider/bids/:id/withdraw`                                                                                                                                                                                               | `useWithdrawBid`                                                          | 5.3   | P1        |
| 11  | Accepted bookings list                                         | Same hardcoded filter as #9 picks up status=accepted bids                       | ✗                                                                              | ✓                                                                                                  | ✗                       | Critical                         | `GET /v1/me/provider/bookings?status=&limit=&cursor=`                                                                                                                                                                                  | `useProviderBookings`                                                     | 5.4   | **P0**    |
| 12  | Booking lifecycle (start/complete/cancel)                      | Static "Start Job" button at `ProviderApp.tsx:794` does nothing                 | ✗                                                                              | ✓ (`BookingStatus` + `BookingEvent` already cover the transitions)                                 | ✗                       | High                             | `POST /v1/me/provider/bookings/:id/start`, `.../complete`; reuse seeker `cancel` for provider role too                                                                                                                                 | `useStartJob`, `useCompleteJob`, `useProviderBookingDetail`               | 5.4   | **P0**    |
| 13  | Earnings + wallet (read)                                       | Static `WALLET_TRANSACTIONS`, `EARNINGS_CHART_DATA`, hardcoded `$1,240.00` etc. | ✗                                                                              | partial (Booking.priceAmount snapshotted at accept; no Transaction/Ledger model)                   | ✗                       | High                             | `GET /v1/me/provider/earnings/summary`, `GET /v1/me/provider/earnings/transactions` (derived from completed Bookings; **no real money movement** in Sprint 5)                                                                          | `useEarningsSummary`, `useEarningsTransactions`                           | 5.5   | P1        |
| 13b | Withdraw earnings                                              | `setTimeout` fake                                                               | —                                                                              | ✗                                                                                                  | ✗                       | High — fake-money risk           | **Deferred to Sprint 6** (real payouts out of scope per slice spec)                                                                                                                                                                    | —                                                                         | —     | **defer** |
| 14  | Notifications (provider)                                       | Static `2` bell badge                                                           | partial (`Notification` table works; need Provider-side fan-out on bid-create) | ✓                                                                                                  | ✓                       | Medium                           | Reuse `GET /v1/me/notifications`; Slice 5.3 adds `BID_RECEIVED` fan-out to seeker on bid create, and `BID_ACCEPTED` to provider on accept (provider notification doesn't exist yet — only seeker is notified at `bids.service.ts:214`) | `useNotifications` (already exists)                                       | 5.6   | **P0**    |
| 15  | Chat / messages (provider)                                     | No chat surface in `ProviderApp.tsx`                                            | ✓ for chat data layer; chat surface needs to be added to provider UI           | ✓                                                                                                  | ✓                       | Low — reuse seeker chat surface  | Reuse `GET, POST /v1/me/conversations/...`; ensure `providerProfileId` participant is created at booking-creation                                                                                                                      | Reuse `useConversations`, `useMessages`                                   | 5.6   | **P0**    |
| 16  | Provider availability toggle                                   | `useState` only                                                                 | ✗                                                                              | partial (need `availability` enum or boolean on ProviderProfile)                                   | ✗                       | Medium                           | `PATCH /v1/me/provider/availability`                                                                                                                                                                                                   | `useUpdateAvailability`                                                   | 5.1   | P1        |
| 17  | Settings / Sign out / Edit Profile menu                        | Static buttons; sign-out not wired                                              | ✓ for sign-out (`POST /v1/auth/logout` exists)                                 | n/a                                                                                                | n/a                     | Low                              | None new; just wire existing logout                                                                                                                                                                                                    | Reuse `useAuth`                                                           | 5.1   | P1        |
| 18  | Verification badge / status                                    | Hardcoded "Pro Professional" + amber Award icon                                 | ✗                                                                              | partial (`verified` boolean exists; no documents pipeline)                                         | ✗                       | Low — UI flag only               | Profile endpoint returns `verified` (already a denormalised column)                                                                                                                                                                    | Reuse `useProviderProfile`                                                | 5.1   | P2        |

**Priority legend.** P0 = blocking (must ship in Sprint 5 for the Provider app to be
usable end-to-end). P1 = important but not blocking the demo flow. P2 = polish. Defer
= explicitly out of Sprint 5 scope.

## 7. Backend / Domain Q&A (asked in the slice spec)

| #   | Question                                                        | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Does ProviderProfile already exist in Prisma?                   | **Yes**, since Sprint 2 (`schema.prisma:472`).                                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | Is ProviderProfile linked to User?                              | **Yes**, optional 1:1. `User.providerProfile : ProviderProfile?` (`schema.prisma:91, 484`).                                                                                                                                                                                                                                                                                                                                              |
| 3   | Are real users assigned a provider role?                        | **No** — only `customer` is assigned at registration (`authentication.service.ts:116–118`). The `provider` role is seeded but never attached.                                                                                                                                                                                                                                                                                            |
| 4   | How does the app distinguish Seeker vs Provider?                | At route level via `apps/web/src/app/pages/app-selector-routing.test.tsx` (the "Continue as…" select). At backend level there is no role-gated route yet. Sprint 5 must add `RolesGuard` on Provider endpoints.                                                                                                                                                                                                                          |
| 5   | Can a user be both seeker and provider?                         | The schema permits it (a User can hold multiple `UserRole` rows and may have both `addresses[]` and `providerProfile`). The current product UI presents them as separate apps but the IAM layer is multi-role-tolerant. Slice 5.1 will treat upgrade as additive — keep `customer`, add `provider`.                                                                                                                                      |
| 6   | Are Bids linked to ProviderProfile or User?                     | To `ProviderProfile` (`Bid.providerId → ProviderProfile.id`). The `User → ProviderProfile.userId` link is optional — Sprint 5 fills it in.                                                                                                                                                                                                                                                                                               |
| 7   | Does Provider have endpoints today?                             | **No.** The single `provider-bid-summary.ts` contract is consumed only by the Seeker's BidsScreen as a read-only nested object.                                                                                                                                                                                                                                                                                                          |
| 8   | Can the current BidsService support provider-created bids?      | **No** — it has only `listForRequest`, `detail`, `accept`. `create` and `withdraw` must be added in Slice 5.3.                                                                                                                                                                                                                                                                                                                           |
| 9   | Can current Booking model support provider listing?             | **Yes** — `(providerId, status)` index exists (`schema.prisma:608`). Service method missing; add `listForProvider` in Slice 5.4.                                                                                                                                                                                                                                                                                                         |
| 10  | Can current Conversations model support provider participants?  | **Yes** — `ConversationParticipant.providerProfileId` slot exists (`schema.prisma:801`) with the `PROVIDER` role enum value. Slice 5.3 / 5.4 must write that participant row at booking-creation time (today only `userId`-keyed seeker rows are written).                                                                                                                                                                               |
| 11  | Can current Notifications model support provider notifications? | **Yes** — same per-user feed. The gap is the **fan-out write** for `BID_ACCEPTED → provider` and `BID_RECEIVED → seeker` on bid create. Today only the seeker is notified at accept time. Slice 5.3 wires both directions.                                                                                                                                                                                                               |
| 12  | What is missing to make Provider app real?                      | (a) Provider role upgrade flow + `RolesGuard` enforcement. (b) `ProviderProfile` extra fields (`serviceCategories[]`, `serviceArea*`, `availability`). (c) Five new controller surfaces (profile, feed, bids/create+withdraw+listMine, bookings start/complete/listMine, earnings read-model). (d) Frontend rewire of `ProviderApp.tsx` to consume those endpoints + retire all `useEcosystem()` reads except possibly `showHourlyRate`. |

## 8. Sprint 5 Slice Plan

Each slice follows the seeker pattern: contracts + DTO + service + repository (where
needed) + e2e + unit + frontend hook + axios wrapper + React Query key + test +
`docs/testing/manual-seeker-runtime.md` + `postman-sprint1-sprint4.md` + Postman
collection updates. Migrations only where called out.

### Slice 5.1 — Provider Profile + Verification Foundation

**Goal.** Real provider identity surfaces everywhere "Omar Al-Khalid / OK / 156 / 4.8★"
appears in `ProviderApp.tsx`. A user can deliberately upgrade to provider and edit
their profile (display name, avatar reuses Slice 4.2 storage when ready, service
categories, service area, availability).

- **Backend models:** `User`, `UserRole`, `Role`, `ProviderProfile`, `ServiceCategory`. **Migration:** add fields to `ProviderProfile` (`bio`, `headline`, `serviceAreaCity`, `serviceAreaCountry`, `serviceAreaLat`, `serviceAreaLng`, `serviceAreaRadiusKm`, `availability` enum `AVAILABLE | UNAVAILABLE | BUSY`, `phoneNumber`); add `ProviderServiceCategory` join table.
- **Contracts:** `provider/profile/{request,response,enums}/...` (see §5b).
- **Endpoints:**
  - `POST /v1/me/provider/upgrade` — assigns the `provider` role (idempotent), creates a `ProviderProfile` keyed to the user. Auth + CSRF.
  - `GET /v1/me/provider/profile` — auth + `RolesGuard('provider')`.
  - `PATCH /v1/me/provider/profile` — auth + CSRF + `RolesGuard('provider')`.
  - `PATCH /v1/me/provider/availability` — auth + CSRF + `RolesGuard('provider')`.
- **Frontend files/hooks:** new `apps/web/src/lib/provider/profile-api.ts`, `apps/web/src/app/hooks/provider/useProviderProfile.ts`, `apps/web/src/app/hooks/provider/useProviderUpgrade.ts`. Refactor `ProviderApp.tsx`: extract `ProviderProfileScreen` into its own file (mechanical move, no visual change), wire to hooks. Remove the hardcoded `SKILLS` constant.
- **Tests:**
  - Backend unit: ProfileService upgrade idempotency, RolesGuard rejects non-provider on PATCH, ValidationPipe rejects `userId` injection, AppError on disappearing user.
  - Backend e2e: full upgrade → GET → PATCH cycle with CSRF; PATCH no-CSRF → 401; PATCH non-provider → 403.
  - Frontend: ProviderProfileScreen seeds from API, shows safe error on 400, IDOR fields rejected, no "Omar" string remains.
- **Postman/API verification.** Add a `Provider — Profile` folder to the seeker collection (mobile-mode). Cover upgrade idempotency + IDOR on `userId`.
- **Website verification.** App selector → Provider → upgrade → profile screen renders the registered identity (not "Omar"). Edit a category, refresh, persists.
- **Risks.** Migration touches `ProviderProfile`, which has seeded rows in dev — backfill with `availability: 'AVAILABLE'` and empty serviceArea. The migration must be additive-only.
- **Out of scope.** Verification-document upload, KYC, ID checks, professional licence storage. The `verified` boolean stays admin-controlled.
- **Suggested commit message.** `feat(provider): foundational profile + role upgrade`

### Slice 5.2 — Provider Available Requests / Live Jobs Feed

**Goal.** Replace the 5-row `SEED_REQUESTS` with a real geo-scoped feed scoped to the
provider's service categories + service area. The map placeholder image stays;
pin coordinates come from the real `manualAddress.lat/lng` captured by the wizard
in Slice 4.1.

- **Backend models:** `ServiceRequest`, `ProviderProfile`, `ProviderServiceCategory` (from 5.1). No new migration.
- **Contracts:** `provider/feed/...` (see §5b).
- **Endpoints:**
  - `GET /v1/provider/available-requests?categoryId=&maxKm=&limit=&cursor=` — auth + `RolesGuard('provider')`. Filters: status = PENDING, no booking, request category ∈ provider categories, distance ≤ provider's `serviceAreaRadiusKm`. Server computes haversine and returns `distanceKm` per row.
  - `GET /v1/provider/requests/:requestId` — auth + RolesGuard. Returns the same `ServiceRequestSummary` shape the seeker sees but with seeker PII redacted (no email, no phone, addresses limited to city/country + lat/lng).
- **Frontend files/hooks:** `lib/provider/requests-api.ts`, `hooks/provider/useAvailableRequests.ts`. Refactor `LiveJobsScreen` to consume them. Compute pin pixel positions from `(lat, lng)` against the provider's service-area centre — preserve the existing CSS-percentage layout by mapping geo→percent. **No visual changes.**
- **Tests:** distance calculation snapshot, category filtering, IDOR (GET another category-only request → 404), no PII in response, cursor pagination, empty-list path.
- **Out of scope.** Real map tiles, live polling, push-driven feed updates. The feed refetches on focus + on demand.
- **Risks.** Pin layout heuristic — if percent layout is unsuitable for arbitrary geo distributions, fall back to "stack pins along a horizontal band" rather than redesign.
- **Suggested commit message.** `feat(provider): integrate available requests feed`

### Slice 5.3 — Provider Submit Bid + My Bids Integration

**Goal.** Kill `BiddingModal.handleSubmit`'s setTimeout fake. Real `POST` from the
modal; `MyBidsScreen` reads `GET /v1/me/provider/bids`; sibling Notifications light
up correctly on both sides.

- **Backend models:** `Bid`, `ServiceRequest`, `Notification`, `ServiceRequestEvent`. No migration.
- **Contracts:** `provider/bids/...` (see §5b).
- **Endpoints:**
  - `POST /v1/provider/requests/:requestId/bids` — auth + CSRF + RolesGuard. Body: `amount`, `currency`, `pricingType`, `note?`, `responseTimeMinutes?`. Service enforces at-most-one-active-bid (the invariant the seeker `accept` path documents). Inside one transaction: create Bid, write `BID_RECEIVED` notification to seeker, write `BID_PLACED` request event.
  - `GET /v1/me/provider/bids?status=&limit=&cursor=` — auth + RolesGuard. Reuses `Bid (providerId, status)` index.
  - `POST /v1/me/provider/bids/:bidId/withdraw` — auth + CSRF + RolesGuard. Sets `BidStatus.WITHDRAWN`. Inside one transaction: set status, optionally fan out `SYSTEM` notification to the seeker.
- **Frontend files/hooks:** `lib/provider/bids-api.ts`, `hooks/provider/useCreateBid.ts`, `useProviderBids.ts`, `useWithdrawBid.ts`. `BiddingModal` becomes async with proper loading + error states (friendly localised copy), and the success state gates on the 200 response, not a timer. `MyBidsScreen` consumes the new hook and drops the `'Omar K.'` filter.
- **Tests:** create rejects when bid already exists for (request, provider); reject when request is not PENDING (already booked); reject when caller has no provider role; e2e covers happy path + IDOR (create against another category, withdraw foreign bid). Frontend test asserts no setTimeout fake — success only after 200, error → friendly copy, no raw payload.
- **Out of scope.** Bid editing (only withdraw + re-create supported), bid badge auto-assignment (server can compute later).
- **Risks.** Concurrency: two providers race to bid on the same request — both should succeed. The invariant is per-provider.
- **Suggested commit message.** `feat(provider): submit and withdraw bids transactionally`

### Slice 5.4 — Provider Bookings + Job Lifecycle

**Goal.** "Start Job" button is real. Provider sees their accepted bookings, can
transition them through `IN_PROGRESS → COMPLETED`. Booking timeline reflects
provider actions.

- **Backend models:** `Booking`, `BookingEvent`, `Notification`, `ProviderProfile`. No migration.
- **Contracts:** `provider/bookings/...` (see §5b).
- **Endpoints:**
  - `GET /v1/me/provider/bookings?status=&limit=&cursor=` — auth + RolesGuard.
  - `GET /v1/me/provider/bookings/:id` — auth + RolesGuard.
  - `GET /v1/me/provider/bookings/:id/timeline` — auth + RolesGuard.
  - `POST /v1/me/provider/bookings/:id/start` — auth + CSRF + RolesGuard. Transitions SCHEDULED → IN_PROGRESS, writes `BOOKING_STATUS_CHANGED` event, fans out `BOOKING_STATUS_CHANGED` notification to seeker.
  - `POST /v1/me/provider/bookings/:id/complete` — auth + CSRF + RolesGuard. Transitions IN_PROGRESS → COMPLETED. Bumps `ProviderProfile.completedJobs`. Notifies seeker. Writes `REVIEW_REQUESTED` notification to seeker as a future-slice hook.
  - The seeker's existing cancel can stay; if the provider needs to cancel, route through the same service method but with a different actor — defer until needed.
- **Frontend files/hooks:** `lib/provider/bookings-api.ts`, `hooks/provider/useProviderBookings.ts`, `useStartJob.ts`, `useCompleteJob.ts`. Wire the existing "Start Job" + a new "Complete Job" button into the My Bids `accepted` row. **No visual changes** beyond appearing/disappearing the buttons based on status.
- **Tests:** transition matrix (only SCHEDULED → IN_PROGRESS, only IN_PROGRESS → COMPLETED, anything else → 409); IDOR; foreign-provider cannot transition; completedJobs bump observed.
- **Out of scope.** Live tracking, ETA, geofence, photo evidence at completion.
- **Risks.** If the seeker cancels mid-IN_PROGRESS, the existing seeker cancel path becomes a 409 from the provider's complete attempt — that's correct behaviour but the UI must show a friendly message.
- **Suggested commit message.** `feat(provider): integrate booking lifecycle`

### Slice 5.5 — Provider Earnings / Wallet Read Model

**Goal.** Replace `WALLET_TRANSACTIONS` and `EARNINGS_CHART_DATA` with a real
read-model derived from completed Bookings. **No payout endpoint, no real money
movement.**

- **Backend models:** `Booking` (filter status=COMPLETED), `ProviderProfile`. No new tables; no Transaction/Ledger model in Sprint 5.
- **Contracts:** `provider/wallet/...` (see §5b).
- **Endpoints:**
  - `GET /v1/me/provider/earnings/summary` — auth + RolesGuard. Returns `availableBalance` (sum of completed bookings since last withdrawal — but since there are no withdrawals yet, this equals all-time completed for now), `pendingBalance` (sum of IN_PROGRESS bookings), `thisWeek`, `thisMonth`. All in the user-preferred currency (USD by default; multi-currency handled by passing through Booking.currency).
  - `GET /v1/me/provider/earnings/transactions?limit=&cursor=` — auth + RolesGuard. Returns one row per completed booking (acts as the transaction history) with `bookingId`, `requestService`, `seekerInitials` (no name leak), `amount`, `currency`, `completedAt`.
  - `GET /v1/me/provider/earnings/chart?period=week|month` — returns `{day,earn}[]`.
- **Frontend files/hooks:** `lib/provider/earnings-api.ts`, `hooks/provider/useEarningsSummary.ts`, `useEarningsTransactions.ts`, `useEarningsChart.ts`. `WalletScreen` consumes them. The withdraw button is **disabled** with a tooltip "Coming soon — payouts ship in Sprint 6"; the existing setTimeout/withdrawn paths are removed.
- **Tests:** sums are deterministic against fixture bookings; period boundary correctness (week starts Mon? Sun? — match server timezone of the user); empty-state handled; foreign-provider bookings excluded.
- **Out of scope.** Payouts, bank-account onboarding, transaction state machine, currency conversion, ledger auditing.
- **Risks.** Aggregation cost — completed bookings can grow unbounded. Add a `(providerId, status, updatedAt DESC)` consideration; but the existing `(providerId, status)` index plus `LIMIT` is fine for Sprint 5 read volumes.
- **Suggested commit message.** `feat(provider): integrate earnings read model`

### Slice 5.6 — Provider Notifications + Chat Integration

**Goal.** Bell badge counts down a real number. Provider sees notifications fanned
out from Slices 5.3 / 5.4. Provider can chat with seeker on bookings (chat surface
is added to ProviderApp following the existing Seeker chat design).

- **Backend models:** `Notification`, `Conversation`, `ConversationParticipant`, `Message`. No migration.
- **Contracts:** None new — reuse existing `seeker/notifications` and `seeker/chat`. Re-export under `provider/...` aliases for clarity.
- **Endpoints:**
  - Reuse `GET /v1/me/notifications` etc. — already per-user.
  - Reuse `GET, POST /v1/me/conversations[/:id/messages|/read]`. Sprint 5 only has to ensure that **at booking-creation time** (in Slice 5.3's accept transaction) a `Conversation` is opened with both `userId=seeker` and `providerProfileId=accepted bid's provider` participants. Today the accept transaction does not create a conversation; it must.
- **Frontend files/hooks:** No new hooks (reuse `useNotifications`, `useConversations`, `useMessages`). Add a chat surface to ProviderApp following the existing visual pattern from `BidsScreen`'s chat affordance — **same components, no redesign**. Wire the bell badge.
- **Tests:** end-to-end accept-bid → both participants see the conversation; provider receives `BOOKING_CREATED` notification (this is the gap from the BidsService audit — today only the seeker gets one); `MESSAGE_RECEIVED` fan-out works in both directions.
- **Out of scope.** Push notifications (browser push), websocket realtime, attachments (still on Slice 4.3 backlog).
- **Risks.** Backfill: existing bookings created before this slice have no conversation. A best-effort backfill script (one-time, dev-only) covers this; production runs from-scratch.
- **Suggested commit message.** `feat(provider): integrate notifications and chat`

### Slice 5.7 — Sprint 5 Final Verification

**Goal.** Run the full Provider runtime, verify every flow with no setTimeout, no
hardcoded identity, no `useEcosystem` reads in `ProviderApp.tsx` outside
`showHourlyRate`. Update docs.

- **Files changed:** `docs/testing/manual-provider-runtime.md` (new), `docs/testing/postman-sprint1-sprint4.md` (renamed to `-sprint5.md` and extended OR a separate `provider-postman.md`), `docs/postman/hsm-provider.postman_collection.json` (new), `scripts/runtime/verify-provider-flow.cjs` (new). The Provider doc mirrors the Seeker doc 4.4 structure.
- **No product code in this slice** unless an audit-discovered defect blocks a flow.
- **Suggested commit message.** `chore(testing): add provider runtime regression harness`

## 9. Priority Order (recommended ship sequence)

1. **5.1** Provider Profile + Role Upgrade — must ship first; nothing works without identity.
2. **5.2** Available Requests Feed — gates the demo flow.
3. **5.3** Submit Bid + My Bids — the marquee Provider feature; ends the most visible mock path.
4. **5.4** Bookings Lifecycle — closes the work loop.
5. **5.6** Notifications + Chat — small wire-up but unlocks bidirectional comms.
6. **5.5** Earnings Read Model — read-only dashboard; can ship in any order after 5.4 but before 5.7.
7. **5.7** Final Verification — last.

## 10. Risks / Blocking Questions

1. **Currency / pricing semantics.** The schema stores `Bid.amount` as `Int` and `currency` as a string. Are amounts stored as **whole units** (USD dollars) or **minor units** (USD cents)? The seeker BidsScreen displays `${amount}/hr` directly, suggesting whole units. I'll proceed with whole units in Sprint 5 unless instructed otherwise; flagging because a switch later is a migration.
2. **Service-area model.** The audit assumes city + country + lat/lng + radius_km is sufficient. If the product wants polygons or multi-area support, Slice 5.1's migration must change. **Confirm** before starting 5.1.
3. **`provider` role gating mechanics.** The IAM has `RolesGuard` available. Does Sprint 5 want a hard 403 on non-provider, or a soft "Upgrade to provider" UX hook? Recommended: hard 403 from the API, frontend route guard re-redirects to upgrade flow.
4. **Conversation backfill.** Existing dev bookings created in Sprint 2 have no conversation. Slice 5.6 ships a one-shot backfill script under `scripts/`. Confirm this is acceptable rather than blocking on a clean DB reset.
5. **Earnings without payouts.** Without a Transaction/Ledger model, "available balance" is a derivation, not an authoritative ledger. When Sprint 6 introduces payouts, this read model needs to be reconciled against the new ledger. Document this clearly in Slice 5.5's commit message.
6. **Withdraw button UX.** The current `WalletScreen` shows a prominent **Withdraw Earnings** button. In Sprint 5, the read-only earnings model means this button must be either disabled with a tooltip OR removed. Removing changes the design. **Recommend disabling** with localised "Coming soon" copy.
7. **Pin coordinates.** Today's `mapX/mapY` are 0–100 percentages. Real geo distributions will not map nicely onto a fixed image. Slice 5.2 needs a degradation strategy (clip to bounds, stack into a band, or show a list-only view) before designing the real solution.
8. **Multi-role users.** A user with both `customer` and `provider` roles needs two app shells. The current "Continue as…" selector handles this fine, but no "switch app" affordance exists from inside either shell. Out of scope for Sprint 5 — log this for Sprint 6 polish.

## 11. Out-of-Scope Reaffirmation

- No Provider product features beyond the marketplace loop.
- No payments, payouts, or money movement.
- No verification-document pipeline or KYC.
- No live tracking, geofencing, ETA push.
- No admin/moderation feature changes (Sprint 5 leaves Admin alone).
- No UI redesign anywhere.
- No Slice 5.1 implementation in this slice (5.0).

## 12. Files Changed in this Slice

Only this document. No product code, no schema, no contracts, no tests altered.

```
docs/sprints/sprint-5-provider-plan.md   (new)
```

## 13. Final Status

**planned** — audit complete, Sprint 5 plan ready, no implementation started.
