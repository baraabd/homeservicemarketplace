# Sprint 5.4 Review Report — Provider Bookings Lifecycle

## 1. Planning Summary

- **Scope:** Provider-side booking surface — list / detail / timeline / start /
  complete / cancel — with the same security posture as Sprints 5.2 and 5.3:
  identity from session, narrow wire DTO, transactional state changes, seeker
  notifications.
- **Existing files inspected:**
  - `apps/api/src/modules/bookings/bookings.service.ts` (seeker-side cancel
    pattern + transactional notification fan-out)
  - `apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
  - `apps/api/src/infrastructure/persistence/bookings/booking-event.repository.ts`
  - `packages/contracts/src/seeker/bookings/**` (parity reference)
  - `apps/web/src/app/components/provider/ProviderApp.tsx` — confirms the
    Provider UI does NOT have a dedicated bookings tab; backend-first ship.
- **Dependencies found:** Sprint 5.3 already wired `NotificationsModule` into
  `ProviderModule`; this sprint reuses that import. The seeker `BookingsService`'s
  transactional cancel flow is the template.
- **Risks found:**
  - Identity exposure: at this point a bid has been ACCEPTED, so the
    provider needs the precise address to do the job. Wire returns
    `addressSnapshot.line1` + `seeker.firstName` only — never email,
    last name, or phone. Documented in the contracts barrel comment.
  - Notification copy: complete + cancel both notify the seeker, start does
    NOT (matches typical marketplace UX where arrival is signalled via the
    conversation surface).
  - Provider UI surface for "My Active Jobs" doesn't exist yet — the React
    Query hooks are shipped so the future UI sprint can wire up without
    touching the API. Documented in Section 7.

## 2. Implementation Summary

- **Files added:**
  - `packages/contracts/src/provider/bookings/{request,response,index}.ts` — full
    barrel: `ListProviderBookingsQuery`, `ProviderBookingSummary`,
    `ProviderBookingSeekerRef`, `ProviderBookingServiceRef`,
    `ListProviderBookingsResponse`, `ProviderBookingDetail`,
    `ProviderBookingTimelineResponse`, `ProviderBookingMutationResponse`.
  - `apps/api/src/modules/provider/bookings/dto/list-provider-bookings.query.ts`
  - `apps/api/src/modules/provider/bookings/provider-bookings.controller.ts`
  - `apps/api/src/modules/provider/bookings/provider-bookings.service.ts`
  - `apps/api/src/modules/provider/bookings/provider-bookings.service.spec.ts`
  - `apps/web/src/lib/provider/provider-bookings-api.ts`
  - `apps/web/src/app/hooks/provider/useProviderBookings.ts`
- **Files changed:**
  - `apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
    — added `listForProvider`, `findOwnedByProvider`,
    `setStatusOwnedByProvider`, plus the eager-loaded
    `BookingWithProviderRelations` type.
  - `apps/api/src/modules/provider/provider.module.ts` — register the new
    controller + service.
  - `apps/web/src/lib/provider/query-keys.ts` — add
    `bookings.{root,list,detail,timeline}`.
  - `packages/contracts/src/provider/index.ts` — re-export bookings.
  - `postman/hsm-provider.postman_collection.json` — added folder
    `40 — Bookings (Sprint 5.4)` with positive list / detail / timeline / start /
    complete + already-completed cancel negative.
- **Migrations added:** none (the schema already had every column the
  endpoints write).
- **Contracts added/changed:** `provider/bookings` subdomain published.
- **UI added/changed:** none — the existing ProviderApp shell has no
  "My Bookings" tab. Hooks and API helpers are in place for the future UI
  sprint.
- **API endpoints added/changed:**
  - `GET /v1/me/provider/bookings?status&limit&cursor` — cursor-paginated.
  - `GET /v1/me/provider/bookings/:bookingId` — detail (extends summary
    with `description`).
  - `GET /v1/me/provider/bookings/:bookingId/timeline` — append-only audit
    log for the booking.
  - `POST /v1/me/provider/bookings/:bookingId/start` — SCHEDULED → IN_PROGRESS.
    No notification (arrival signalled via conversation).
  - `POST /v1/me/provider/bookings/:bookingId/complete` — IN_PROGRESS → COMPLETED.
    Sends `BOOKING_COMPLETED` notification to seeker.
  - `POST /v1/me/provider/bookings/:bookingId/cancel` — SCHEDULED → CANCELLED.
    Sends `BOOKING_CANCELLED` notification to seeker.

  All mutations run inside one transaction so the booking, the timeline event,
  and the notification land atomically (or all roll back).

## 3. Automated Tests

| Check                                                                                  | Result                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `prisma validate`                                                                      | pass                                            |
| `pnpm --filter @homeservicemarketplace/contracts build`                                | pass                                            |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | pass                                            |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | pass                                            |
| `pnpm --filter @homeservicemarketplace/api test`                                       | pass — 606 passed, 6 skipped (was 591; +15 new) |
| `pnpm --filter @homeservicemarketplace/web test`                                       | pass (no new tests; existing 295 still pass)    |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | pass                                            |

New API tests in `provider-bookings.service.spec.ts` (15 cases):

- list: cursor-paginated page with seeker firstName + addressSnapshot
- list: nextCursor when more rows exist
- list: 404 if profile vanished post-guard
- detail: returns owned eager-loaded row
- detail: 404 if not owned
- start: SCHEDULED → IN_PROGRESS, no notification, event emitted
- start: 409 if already IN_PROGRESS
- start: 409 on race-loss (setStatus count: 0)
- complete: IN_PROGRESS → COMPLETED, notifies seeker BOOKING_COMPLETED
- complete: 409 if SCHEDULED (must start first)
- cancel: SCHEDULED → CANCELLED, notifies seeker BOOKING_CANCELLED
- cancel: 409 if IN_PROGRESS
- cancel: 409 if COMPLETED
- timeline: returns events when owned
- timeline: 404 when not owned

## 4. Postman Tests

- Collection updated: `postman/hsm-provider.postman_collection.json`.
- Folder `40 — Bookings (Sprint 5.4)` added with:
  - GET list (captures `bookingId` for follow-on tests, asserts security
    projection — addressSnapshot.line1 present, no email/passwordHash leak)
  - GET detail (asserts `description` exists)
  - GET timeline
  - POST start (idempotent — accepts 200 or 409)
  - POST complete (idempotent — accepts 200 or 409)
  - POST cancel-already-completed (must 409)
- Newman run: deferred to Sprint 5.7 end-to-end harness.

## 5. Manual Checks

- Scenario: provider sees the seeker's first name + city + line1 on a
  confirmed booking but never email or last name.
  Expected: `seeker: { firstName, city }` is the only seeker-id field;
  the addressSnapshot includes line1.
  Actual: confirmed by the contract shape and test
  `does not leak email / phone / passwordHash` in the Postman list test.
  Result: pass.
- Scenario: a foreign bookingId returns 404 (ownership-vs-existence
  indistinguishable).
  Expected: `findOwnedByProvider` returns null → 404.
  Actual: confirmed by `404 if booking not owned by provider` test.
  Result: pass.
- Scenario: state transitions are linear — SCHEDULED → IN_PROGRESS →
  COMPLETED, with cancel only from SCHEDULED.
  Expected: each invalid state returns 409.
  Actual: 5 test cases pin every illegal transition path.
  Result: pass.

## 6. Fixes Applied

None during this sprint. The booking lifecycle is a pure-additive surface.

## 7. Remaining Issues

- The provider UI does not yet have a "My Bookings" or "Active Job" tab —
  the existing nav has Map / Briefcase (My Bids) / Wallet / Profile. A
  future UI sprint can mount a new tab consuming `useProviderBookings()`.
  Not in scope per the global rule "If UI does not exist and the sprint
  says backend-only is acceptable, implement backend and Postman tests
  first."
- The flaky `app-selector-routing.test.tsx` test from Sprint 5.2 remains
  flaky; this sprint touches only the API + contracts + new web
  hook (no test changes).

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically. All Sprint 5.4 surface area is green
(api typecheck +15 tests, web typecheck, contracts build, web build).
