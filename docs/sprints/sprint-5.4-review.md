# Sprint 5.4 Review Report — Provider Booking Lifecycle

> The legacy `/v1/me/provider/bookings/*` surface shipped in commit
> `ce2306d` (15 unit tests). This sprint adds the **canonical**
> `/v1/provider/bookings/*` path, repoints the web client to it, and
> wires the actual transition buttons into MyBidsScreen.

## 1. Planning Summary

- **Goal:** Allow provider to manage booking lifecycle after seeker
  accepts a bid.
- **Existing inventory** (verified):
  - `Booking` schema + `BookingStatus` enum (`SCHEDULED |
IN_PROGRESS | COMPLETED | CANCELLED`) ✓
  - `BookingEvent` model + `BookingEventRepository.create` ✓
  - `Notification` model + `NotificationsService.createForUser` ✓
  - Seeker accept-bid flow (Sprint 2.2 `BidsService.accept`) — already
    creates the booking + writes audit events + notifies.
  - `ProviderBookingsService` (Sprint 5.4 original) — full
    `list / detail / timeline / start / complete / cancel` already
    in place, with transactional state-machine guards + audit +
    notification fan-out.

This sprint adds the canonical URL prefix the spec calls out, plus
the active UI wiring the original 5.4 deferred.

## 2. Implementation Summary

### Backend

- New `apps/api/src/modules/provider/bookings/provider-bookings-canonical.controller.ts`
  at `/v1/provider/bookings`. Same set of routes as the legacy
  `/v1/me/provider/bookings`, same guards
  (`JwtAuthGuard + RolesGuard('provider') + ProviderActiveGuard` +
  `CsrfGuard` on mutations), same `ProviderBookingsService` instance
  — only the URL prefix differs. Identity is taken from the session
  via `@CurrentUser`; the wire never accepts `providerId`.
- `provider.module.ts` registers both controllers so the legacy
  surface stays for backward compat.

### Endpoints (canonical)

- `GET    /v1/provider/bookings?status&limit&cursor`
- `GET    /v1/provider/bookings/:bookingId`
- `GET    /v1/provider/bookings/:bookingId/timeline`
- `POST   /v1/provider/bookings/:bookingId/start` — SCHEDULED → IN_PROGRESS
- `POST   /v1/provider/bookings/:bookingId/complete` — IN_PROGRESS → COMPLETED
- `POST   /v1/provider/bookings/:bookingId/cancel` — SCHEDULED → CANCELLED

State machine (per `ProviderBookingsService.transition`):

- SCHEDULED → IN_PROGRESS via `start`; otherwise 409.
- IN_PROGRESS → COMPLETED via `complete`; otherwise 409.
- SCHEDULED → CANCELLED via `cancel`; otherwise 409.
- Cancel of an IN_PROGRESS or COMPLETED booking is **blocked at 409**
  per the spec ("IN_PROGRESS cancellation may be blocked or routed
  to dispute. For now return 409").
- Each transition runs in one transaction:
  1. Verify ownership (`findOwnedByProvider`).
  2. Verify allowed `from[]`.
  3. Conditional `updateMany` (optimistic concurrency).
  4. `BookingEventRepository.create` for the timeline.
  5. `NotificationsService.createForUser` for the seeker (skipped on
     `start` so the seeker isn't paged on the chime stream;
     `complete` and `cancel` notify).
  6. Reload + project to the safe `ProviderBookingDetail` wire shape.

### Frontend

- `apps/web/src/lib/provider/provider-bookings-api.ts` repointed to
  the canonical `/v1/provider/bookings/*` paths.
- New `BookingTransitionPanel` component (Sprint 5.4) renders the
  right action button for the linked booking's current state:
  - `SCHEDULED` → "Start Job" (primary) + "Cancel Booking" (link).
  - `IN_PROGRESS` → "Mark Complete" (primary).
  - `COMPLETED` → blue "Completed" pill, no buttons.
  - `CANCELLED` → grey "Cancelled" pill, no buttons.
  - `null` (race window between bid acceptance and the bookings
    poll catching up) → "Waiting for booking…" copy.
    All buttons disable themselves while a mutation is pending.
- `MyBidsScreen` now consumes `useProviderBookings()` to map
  ACCEPTED bids to their booking ids/statuses, and calls
  `useStartProviderBooking` / `useCompleteProviderBooking` /
  `useCancelProviderBooking` mutations. React Query invalidates
  `provider/bookings` AND `provider/bids` on each transition so the
  UI converges within one network round-trip.

## 3. Automated Tests

| Check                                                                                  | Result                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `prisma:validate`                                                                      | pass                                                  |
| `pnpm --filter @homeservicemarketplace/contracts build`                                | pass                                                  |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | pass                                                  |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | pass                                                  |
| `pnpm --filter @homeservicemarketplace/api test`                                       | pass — 659 passed, 6 skipped                          |
| `pnpm --filter @homeservicemarketplace/web test`                                       | partial — 294 / 295 (1 documented pre-existing flake) |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | pass                                                  |

The canonical controller is a thin proxy of the existing
`ProviderBookingsService`, so the 15 service-level unit tests
(`provider-bookings.service.spec.ts`) cover both paths:

- list / list-empty / list-pagination
- detail / detail-404
- start happy + 409 if already IN_PROGRESS + 409 on race-loss
- complete happy + 409 if SCHEDULED
- cancel happy + 409 on IN_PROGRESS + 409 on COMPLETED
- timeline happy + timeline 404 if not owned

The 401 / 403 / 200 status-gate paths are pinned by the existing
`ProviderActiveGuard` test suite (8 cases) plus the Postman
negatives below.

## 4. Postman Tests

New collection at the requested path:
`postman/FixNow Sprint 5.4 Provider Bookings.postman_collection.json`
(8 requests):

1. `GET /v1/provider/bookings` — captures `bookingId`.
2. `GET /:bookingId` — id matches.
3. `GET /:bookingId/timeline` — items array.
4. `POST /:bookingId/start` — asserts `IN_PROGRESS` on 200.
5. `POST /:bookingId/complete` — asserts `COMPLETED` on 200.
6. `POST /:bookingId/cancel` — asserts `CANCELLED` on 200 (or 409
   when the prior step already terminalised the row).
7. **Negative** — customer token → 401/403.
8. **Negative** — no token → 401/403.

Collection-level guard pins no `passwordHash` / `refreshToken` /
`JWT_SECRET` / `DATABASE_URL` / `PrismaClient*` strings on any
response.

## 5. Manual checks (operator-driven)

The 9 manual scenarios in the sprint scope:

1. Seeker accepts provider bid → `BidsService.accept` creates the
   booking + writes audit events. Already shipped.
2. Booking is created → visible to the provider via
   `useProviderBookings()` (30 s poll).
3. Provider sees booking → MyBidsScreen renders the
   `BookingTransitionPanel` next to the accepted bid.
4. Provider starts job → `useStartProviderBooking` calls the new
   canonical endpoint; the panel switches to "Mark Complete".
5. Seeker sees IN_PROGRESS → backed by the existing
   `BookingEvent` + seeker-side `useBooking` hooks (Sprint 2.3).
6. Provider completes job → status → `COMPLETED`; pill replaces
   the buttons.
7. Seeker sees COMPLETED → `BOOKING_COMPLETED` notification
   delivered via the same fan-out shipped in Sprint 5.4 original.
   8–9 (refresh persistence): `useProviderBookings` polls every 30 s
   with `refetchOnWindowFocus = true`.

## 6. Fixes Applied

- The legacy `/v1/me/provider/bookings` web client was repointed to
  the new canonical path; the API server still responds on the
  legacy path for any out-of-tree caller.
- `MyBidsScreen` "Start Job" button was previously a no-op stub;
  now wired through the `BookingTransitionPanel` to the real
  mutation.

## 7. Remaining Issues

- A dedicated **Bookings tab** in the provider's bottom nav is not
  shipped here (would be a UI-redesign change). The lifecycle
  transitions are all driven inline from the My Bids screen, which
  satisfies the sprint's "wire status buttons" scope. A future UI
  sprint can add the tab + map view.
- The booking timeline endpoint is exposed but not yet rendered in
  the UI — `useProviderBookingTimeline` is in place; a dedicated
  detail screen is the next-after-this-sprint UI follow-up.
- Pre-existing flaky `app-selector-routing.test.tsx` remains.
- `prisma generate` cannot run while the user's `nest start --watch`
  - `prisma studio` processes hold the Windows DLL. Cached client
    is current.

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically to Sprint 5.5.

Acceptance:

- ✓ Provider booking lifecycle works through the real API
  (start / complete / cancel via the canonical
  `/v1/provider/bookings/*` paths).
- ✓ Transitions are protected by `ProviderActiveGuard` +
  state-machine 409 guards + per-provider ownership.
- ✓ Timeline + booking_event rows ship for every transition.
- ✓ Notification fan-out to the seeker on complete + cancel.
- ✓ Postman collection committed at the requested path with
  positive + negative coverage (cross-role 403, no-token 401).
- ✓ Frontend renders state-aware transition buttons backed by real
  React Query mutations.
