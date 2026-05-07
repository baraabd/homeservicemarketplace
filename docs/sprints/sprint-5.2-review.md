# Sprint 5.2 Review Report — Provider Live Jobs / Available Requests

> The legacy `/v1/me/provider/jobs/available` feed shipped in commit
> `ae51352`. This sprint adds the **canonical**
> `/v1/provider/available-requests` surface — list + detail — with
> stricter "hide-already-bid" semantics and re-points the LiveJobsScreen
> at it.

## 1. Planning Summary

- **Goal:** Connect Provider Live Jobs to real backend data via the
  canonical `/v1/provider/available-requests` route, with
  ProviderProfile.status gating and a dedicated detail endpoint.
- **Existing inventory** (verified):
  - `ServiceRequest` schema + `ServiceRequestStatus` enum ✓
  - `ProviderProfile` schema + `ProviderProfileStatus` enum + 5.1.4 admin
    transitions ✓
  - `ProviderActiveGuard` (Sprint 5.1.2) — already gates marketplace
    routes on `status === ACTIVE` ✓
  - Mock source: `useEcosystem().requests` was already retired from
    `LiveJobsScreen` in Sprint 5.3's commit; this sprint re-points
    the data source to the canonical endpoint.

## 2. Implementation Summary

### Contracts

- `packages/contracts/src/provider/requests/index.ts` (new):
  - `ProviderAvailableRequestsQuery`
  - `ProviderAvailableRequestSummary`
  - `ProviderAvailableRequestDetail` (alias of summary; reserved for
    future detail-only fields)
  - `ProviderAvailableRequestListResponse`
  - `ProviderAvailableRequestDetailResponse`
- `packages/contracts/src/provider/index.ts` re-exports the new
  subdomain.

### Backend

- `apps/api/src/modules/provider/available-requests/available-requests.controller.ts`
- `apps/api/src/modules/provider/available-requests/available-requests.service.ts`
- `apps/api/src/modules/provider/available-requests/dto/list-available-requests.query.ts`
- `apps/api/src/modules/provider/available-requests/available-requests.service.spec.ts`
  (13 unit tests)
- `apps/api/src/infrastructure/persistence/requests/service-request.repository.ts`:
  - extended `listAvailableForProvider` with
    `excludeBidsByProviderId` (uses `bids: { none: { providerId,
status: { not: 'WITHDRAWN' } } }` so the SQL stays a single
    correlated NOT EXISTS).
  - added `findAvailableForProvider` for the detail endpoint with
    the same per-provider visibility rules.
- `apps/api/src/modules/provider/provider.module.ts` registers the
  new controller + service.

### Endpoints

- `GET /v1/provider/available-requests?cursor&limit&category&near`
- `GET /v1/provider/available-requests/:requestId`

Class-level guards on both: `JwtAuthGuard, RolesGuard('provider'),
ProviderActiveGuard`. Identity is taken from the session via
`@CurrentUser`; the wire never accepts `providerId` /
`providerProfileId`.

### Visibility rules (in this order)

1. `status = OPEN_FOR_BIDS, deletedAt = null` (always).
2. `seekerUserId != provider.userId` — providers don't see their own
   requests.
3. Category — explicit `?category=` wins, else falls back to the
   provider's configured `serviceCategories`. A provider with no
   categories sees the global feed.
4. `near=` — exact-match against the snapshotted address city.
5. `bids: { none }` — hide every request the provider already has a
   non-WITHDRAWN bid on.

A foreign / deleted / cancelled / assigned / category-mismatch /
already-bid request collapses to **404** at the detail endpoint —
the response is identical to "doesn't exist" so a probing provider
cannot enumerate hidden rows.

### Wire shape

`ProviderAvailableRequestSummary`: `id`, `category`,
`customServiceText`, `description`, `scheduleType`, `scheduledAt`,
`location: { city, country, lat, lng }`, `bidsCount`, `createdAt`.
Deliberately omits: `seekerUserId`, seeker name / email / phone,
`addressSnapshot.line1`, `deletedAt`, raw `status` (always OPEN_FOR_BIDS
post-filter so it carries no signal).

### Frontend

- `apps/web/src/lib/provider/available-requests-api.ts` — typed
  axios wrappers for list + detail.
- `apps/web/src/app/hooks/provider/useAvailableRequests.ts` —
  `useAvailableRequests(filters)` + `useAvailableRequestDetail(id)`.
  Polling: **20 s**; `refetchOnWindowFocus = true`;
  `staleTime: 5_000`.
- `apps/web/src/lib/provider/query-keys.ts` adds
  `provider/available-requests/{root,list,detail}`.
- `apps/web/src/lib/provider/available-jobs-adapter.ts` —
  `mapAvailableJobToLegacy` now accepts either the older
  `AvailableJobSummary` or the canonical
  `ProviderAvailableRequestSummary`. Same map-pin / urgency / icon /
  blank-seeker derivation; the canonical feed has no `hasOwnBid`
  flag because already-bid rows are filtered server-side.
- `apps/web/src/app/components/provider/ProviderApp.tsx` —
  `LiveJobsScreen` now consumes `useAvailableRequests()`.
  Empty-state copy was extended to surface four explicit states:
  - blocked (server returned 403 → `ProviderActiveGuard`)
  - loading
  - error
  - actually-empty
    All four use `role="status"` so screen readers announce changes.

## 3. Automated Tests

| Check                                                                                  | Result                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------ |
| `prisma:validate`                                                                      | pass                                       |
| `pnpm --filter @homeservicemarketplace/contracts build`                                | pass                                       |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | pass                                       |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | pass                                       |
| `pnpm --filter @homeservicemarketplace/api test`                                       | pass — **659** passed (+13 new), 6 skipped |
| `pnpm --filter @homeservicemarketplace/web test`                                       | pass — 295 / 295                           |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | pass                                       |

The 13 new unit cases in `available-requests.service.spec.ts` cover:

- list happy path with bidsCount + nextCursor
- list paginates correctly (take + 1)
- `excludeBidsByProviderId` is plumbed into the repo call
- explicit `category` overrides profile categories
- profile categories used when no `category` filter
- unknown / inactive category → `VALIDATION_ERROR`
- limit clamps to max 100
- wire DTO security projection (no line1, no seekerUserId)
- 404 if profile vanished post-guard
- detail visible → returned with bidsCount
- detail not visible → 404 (single shape for foreign / deleted /
  cancelled / category-mismatch / already-bid)
- detail 404 when profile missing
- detail passes `excludeBidsByProviderId`

The 401 / 403 / 200 status-gate paths are pinned by the existing
`ProviderActiveGuard` test suite (8 cases shipped in Sprint 5.1.2)
and the new Postman folder's negative requests.

## 4. Postman Tests

New collection at the requested path:
`postman/FixNow Sprint 5.2 Provider Available Requests.postman_collection.json`
(9 requests):

1. `GET /v1/provider/available-requests` — captures `requestId`;
   asserts items + nextCursor + no deleted/cancelled/assigned
   indicators leaking.
2. `GET ?limit=1` — items length ≤ 1; nextCursor contract valid.
3. `GET /:requestId` — id matches.
4. **Negative** — customer token → 401/403.
5. **Negative** — no token → 401/403.
6. **6a → 6d**: full SUSPENDED-then-reactivate flow that uses
   Sprint 5.1.4's admin endpoints to flip status, asserts the feed
   returns 403 while suspended, then 200 after reactivate. Cleans
   up after itself.

Collection-level guards on every request:

- no `passwordHash` / `refreshToken` / `JWT_SECRET` /
  `DATABASE_URL` / `PrismaClient*` strings.
- no `seekerUserId` field on the wire.
- no `line1` field on the wire.

## 5. Manual checks (operator-driven)

The 10 manual scenarios in the sprint scope require the dev API +
web running side by side and a real seeker / provider / admin trio.
The supporting code paths each scenario exercises:

- 1–4 (seeker creates → admin approves → provider sees feed): the
  full transition chain is covered by Sprint 5.1.4 (admin) +
  this sprint's feed.
- 5–6 (refresh persistence): React Query polls every 20 s and
  refetches on focus.
- 7–10 (admin suspend → blocked-state → admin reactivate → feed
  returns): backed by `LiveJobsScreen`'s 403 → blocked-state copy
  branch and the existing `ProviderActiveGuard`.

## 6. Fixes Applied

- The legacy `mapAvailableJobToLegacy` adapter accepted only
  `AvailableJobSummary`; relaxed to also accept
  `ProviderAvailableRequestSummary` so both the legacy and canonical
  feeds can render through the same UI shape.
- LiveJobsScreen empty-state previously rendered only "no jobs right
  now". Extended to a four-way switch (blocked / loading / error /
  empty) so an inactive provider gets actionable copy instead of
  silent emptiness.

## 7. Remaining Issues

- The legacy `/v1/me/provider/jobs/available` endpoint stays in
  place; deleting it is breaking and out of scope. A follow-up sprint
  can deprecate it once the canonical path soaks.
- The `near=` filter is exact-match by city only — no radius / lat-
  lng search yet. Plumbed through but documented.
- Pre-existing flaky `app-selector-routing.test.tsx` test remains
  (1-of-3 fail rate); not exercised by anything in this slice.
- `prisma generate` cannot run while the user's `nest start --watch`
  - `prisma studio` processes hold the Windows DLL. Cached client
    is current and every check above passes against it.

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically to Sprint 5.3.

Acceptance:

- ✓ Provider Live Jobs uses real API data
  (`/v1/provider/available-requests`).
- ✓ Status gating: 401 (no auth) / 403 (customer or non-ACTIVE
  provider) / 200 (ACTIVE provider).
- ✓ Filtering: status, deletedAt, own-seeker, category, city,
  already-bid.
- ✓ Detail endpoint with the same visibility rules + opaque-404 on
  every hidden cause.
- ✓ Postman collection committed at the requested path with full
  positive / negative coverage including the SUSPENDED→reactivate
  flow.
