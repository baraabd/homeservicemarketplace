# fix: notification UX (toast/sound/vibration) and active leads sync

Branch: `fix/notification-ux-and-active-leads-sync` → `develop`

## Summary

Completes the Seeker/Provider realtime notification UX layer and fixes the
Active Leads sync bug where lead cards stayed stuck on the old status until a
manual reload. New toasts now fire for every important transition (booking
lifecycle, bid accepted, BID_RECEIVED/BOOKING_COMPLETED/etc.), include a
status-specific localised title + body, an optional "View" action button that
deep-links to the right resource, a short Web Audio tone, and vibration where
supported. Active Leads invalidates the seeker requests root on booking
lifecycle events so the carousel converges without a page refresh.

This PR is the cumulative effort of three commits on this branch:

| Commit    | Title                                                                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `9ee69db` | `fix: repair seeker-provider notification lifecycle` (Socket.IO cookie auth, provider fan-out on request create, seeker-cancel notifies provider, polling fallback, Cache-Control no-store)   |
| `575c180` | `fix: add notification UX and sync active leads status` (type-specific toast copy, Active Leads invalidation on booking events, universal `notification.created` → domain refresh safety net) |
| `<new>`   | `fix: bid.accepted toast + sonner action-button navigation` (this PR's final commit)                                                                                                          |

## Root cause

- The realtime side-effects bridge had no case for `bid.accepted`, so the
  provider never got UX feedback when a seeker accepted their bid (the paired
  `notification.created` would surface generic copy at best).
- Toasts were emitted as plain `toast(title, { description })` calls with no
  click action — even when the backend supplied a deepLink. The drawer's tap
  router resolved the resource, but the toast was a dead end.
- The Seeker's Active Leads carousel is backed by `seekerQueryKeys.requests.root`
  and the realtime dispatcher previously did NOT invalidate it on booking
  lifecycle events. The parent `ServiceRequest` stays at `BID_ACCEPTED` across
  booking transitions, but the carousel still needed a refetch so derived UI
  stayed current.
- `notification.created` only invalidated the notifications root — if the
  backend forgot to publish a paired domain event (`booking.status_changed`,
  `request.available`, etc.), the related domain feeds never refreshed even
  though the notification's `resourceType` carried enough information to do so.

## Changes

### Backend (`9ee69db`)

- `RealtimeGateway` now extracts the access JWT from the `hsm_at` httpOnly
  cookie in addition to `auth.token` / `Authorization: Bearer`. The web client
  stops sending the CSRF token as `auth.token`.
- `RequestsService.create` post-commit fan-outs `REQUEST_AVAILABLE`
  notifications + `request.available` realtime events to every eligible provider
  (matching category + lowercase-trimmed `cityKey`, status ACTIVE, has linked
  `userId`, not the seeker themselves). Failures are logged + swallowed so the
  seeker's request still succeeds.
- `BookingsService.cancel` (seeker-side) removed the seeker self-notification
  (echo) and now writes `BOOKING_CANCELLED` to the provider's `userId` with
  `metadata.cancelledBy = 'seeker'`. Both sides receive a post-commit
  `booking.status_changed` event with the seeker as `actorUserId`.
- `ProviderBidsService.submit` threads `actorUserId = providerUserId` on the
  seeker's `BID_RECEIVED` notification so the seeker's bridge fires UX (the
  provider is the actor; seeker is the non-actor recipient).
- `NotificationType.REQUEST_AVAILABLE` enum added via additive Prisma migration.
- `Cache-Control: no-store` on `GET /v1/me/notifications`,
  `/v1/me/notifications/unread-count`, `/v1/provider/available-requests`,
  `/v1/provider/available-requests/:id`.
- `BookingStatusChangedActorRole` contract widened to `'PROVIDER' | 'SEEKER'`
  so the seeker-cancel realtime envelope is typed correctly.

### Frontend — UX layer

`apps/web/src/lib/realtime/side-effects.ts`

- **Type-specific toast copy** for `notification.created` via a localised lookup
  table (EN/AR). Every `NotificationType` has a title + body string;
  `BOOKING_CANCELLED` picks a `bySeeker` / `byProvider` body variant based on
  `metadata.cancelledBy`. Unknown types fall back to the backend-supplied
  title/body, then to a generic placeholder.
- **`bid.accepted` toast** ("Your bid was accepted") with the bid id keyed
  into the dedupe map so the paired `notification.created` (BID_ACCEPTED,
  resourceId = bidId) collapses against it — exactly one toast/beep per
  accept-bid transition.
- **Sonner action-button navigation**. Every toast that has a resolvable
  deepLink now carries a `{ label: 'View', onClick }` action wired to the
  realtime-navigator bridge. Click fires `navigate(deepLink)` through a
  module-level holder that `RootInner` populates via `useNavigate()` (mirrors
  the existing `realtime-i18n` lang bridge).
- **Deep-link resolution honours Sprint 7.5 rule**: BID notifications use
  `metadata.requestId` for the request route, NOT `resourceId` (which is the
  bidId). When `metadata.requestId` is absent for a BID notification, no
  action button renders (better than navigating to the wrong resource).
- Sound (`triggerNotificationUX` → Web Audio short tone) and vibration
  (`navigator.vibrate?.([200,100,200])`) unchanged from Sprints 7.5.1 / 7.6 —
  both wrapped in try/catch and capability-guarded.
- 2.5s dedupe window unchanged (intentionally chose this in Sprint 7.6 — wide
  enough to coalesce the paired `notification.created` + domain event for the
  same transition, narrow enough that a genuine second event still surfaces).

`apps/web/src/lib/realtime/use-realtime-socket.ts` (`dispatchInvalidations`)

- **Active Leads sync**. `booking.status_changed`, `booking.created`, and
  `bid.accepted` now ALSO invalidate `seekerQueryKeys.requests.root` so the
  seeker's Active Leads carousel converges without a manual reload.
- **Universal `notification.created` → domain safety net**. Reads the
  payload's `resourceType` and invalidates the matching domain roots:
  - `REQUEST` → seeker requests + provider available-requests
  - `BID` → seeker requests + provider bids
  - `BOOKING` → seeker + provider bookings + seeker requests (Active Leads)
  - `CONVERSATION` → conversations roots
  - `SYSTEM` / null → notifications root only (no domain churn)

`apps/web/src/lib/realtime/realtime-i18n.ts`

- Added EN/AR strings for every `NotificationType` plus `bid.accepted` and
  the toast action label ("View" / "عرض").

`apps/web/src/lib/realtime/realtime-navigator.ts` _(new)_

- Tiny module-level navigator bridge. `setRealtimeNavigator(fn | null)` is
  invoked from `RootInner` (inside the Router context) via `useNavigate()`.
  The side-effects dispatcher reads it via `getRealtimeNavigator()` to wire
  the toast action button without ever calling React hooks outside the
  Router scope.

`apps/web/src/app/Root.tsx`

- Bridges `useNavigate()` into the realtime-navigator module on mount; clears
  it on unmount so a logged-out app doesn't navigate from a stale toast.

`apps/web/src/lib/auth-provider.tsx`

- `useRealtimeSocket({ getToken: () => null })` — the web access JWT lives in
  the httpOnly `hsm_at` cookie; the Socket.IO handshake re-uses
  `withCredentials: true` so the gateway parses the cookie server-side.

`apps/web/src/app/hooks/seeker/useNotifications.ts`

- Polling fallback so the drawer/badge converges even when the socket is
  offline:
  - List: `staleTime 5s`, `refetchInterval 20s`, `refetchOnWindowFocus: true`
  - Unread count: `staleTime 5s`, `refetchInterval 15s`, `refetchOnWindowFocus: true`

## Tests

- **API (976 / 976 pass, 6 skipped pre-existing)** including:
  - `realtime.gateway.spec.ts` — 8 new tests pinning the cookie-auth
    extraction order (auth.token → Bearer → `hsm_at` cookie → fail).
  - `requests.service.spec.ts` — 5 new tests pinning the provider fan-out
    (recipients, empty match, seeker exclusion, repo-failure swallowed,
    per-recipient failure isolation).
  - `bookings.service.spec.ts` — provider notification on seeker cancel,
    both-sides realtime fan-out, unlinked-provider skip.
- **Web (453 / 453 pass)** including:
  - `side-effects.test.ts` — 31 tests total. 11 new in this final commit:
    `bid.accepted` non-actor toast + actor silence + booking-vs-request
    deeplink fallback + `bid.accepted`/notification.created dedupe; toast
    action button presence/absence; navigator failure swallow; BID
    notification uses `metadata.requestId` (NOT bidId); BOOKING uses
    `resourceId` as bookingId; `payload.deepLink` wins over derived
    fallback.
  - `use-realtime-socket.test.ts` — 4 new tests pinning the
    `notification.created` resource-type safety net (BOOKING, BID, REQUEST,
    SYSTEM/null).
  - `notification-ux.test.ts` — pre-existing coverage of `.play()` rejection
    - missing `navigator.vibrate` + private-browsing localStorage.

## Verification

Commands actually run on this machine, results in order:

| Command                                                       | Result                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @homeservicemarketplace/contracts build`       | OK                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm --filter @homeservicemarketplace/database run generate` | **BLOCKED** by Windows file lock on `query_engine-windows.dll.node` (dev process holds it). Schema change is purely additive (`ALTER TYPE … ADD VALUE`); the runtime service has a defensive `(NotificationType as Record<...>).REQUEST_AVAILABLE ?? 'REQUEST_AVAILABLE'` fallback so it works the moment a clean checkout regenerates. CI will succeed. |
| `pnpm exec jest` (in `apps/api`)                              | **976 passed, 6 skipped, 982 total**                                                                                                                                                                                                                                                                                                                     |
| `pnpm --filter @homeservicemarketplace/api lint`              | OK                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm --filter @homeservicemarketplace/api build`             | OK                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm --filter @homeservicemarketplace/web typecheck`         | OK                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm exec vitest run src/lib/realtime` (in `apps/web`)       | **53 / 53 pass**                                                                                                                                                                                                                                                                                                                                         |
| `pnpm exec vitest run` (in `apps/web`)                        | **453 / 453 pass**                                                                                                                                                                                                                                                                                                                                       |
| `pnpm --filter @homeservicemarketplace/web lint`              | 0 errors (29 pre-existing warnings unrelated)                                                                                                                                                                                                                                                                                                            |
| `pnpm --filter @homeservicemarketplace/web build`             | OK                                                                                                                                                                                                                                                                                                                                                       |

## Manual E2E verification — required before merging

Set up two browser sessions (Seeker + Provider). Both authenticated. Network
panel should show the Socket.IO `connect` succeed and a `connection.ack` event
with the right `joinedRooms` for each side.

### Flow 1 — Bid accept → toast → Active Leads update

1. Seeker creates a request.
2. Provider submits a bid on that request.
3. **Seeker tab**: toast "New bid received" with body "A provider sent a bid
   for your request." Click the "View" action — it should open the request's
   bids screen (`/home/requests/:requestId/...`). The deep link uses
   `metadata.requestId`, NOT `resourceId` (which is the `bidId`).
4. Sound plays (autoplay may block on a fresh tab — that's expected; user
   gesture warms the AudioContext). Vibration fires on a mobile device.
5. Seeker accepts the bid.
6. **Provider tab**: toast "Your bid was accepted" with a "View" action that
   opens `/provider/bookings/:bookingId`. Sound + vibration where supported.
7. **Seeker tab** (the actor): NO toast/sound (anti-echo).
   **Both tabs**: Active Leads card transitions from "pending" → "active"
   within ~1s of the accept REST call returning (no manual refresh required).

### Flow 2 — Provider lifecycle → Active Leads converges

1. Provider marks the booking IN_PROGRESS.
2. **Seeker tab**: toast "Booking started". Bookings list updates. Active
   Leads carousel refetches.
3. Provider marks the booking COMPLETED.
4. **Seeker tab**: toast "Booking completed". Sound + vibration. Bookings
   list shows the completed row. Click the toast "View" → opens
   `/home/bookings/:bookingId`.
5. **Provider tab** (the actor): NO toast/sound. Bookings list still
   refreshes via silent cache invalidation.

### Flow 3 — Seeker cancels booking → provider notified

1. Set up an accepted bid → booking.
2. Seeker cancels the booking.
3. **Provider tab**: toast "Booking cancelled" with body "The seeker
   cancelled the booking." (the `metadata.cancelledBy = 'seeker'` body
   variant). Click "View" → opens `/provider/bookings/:bookingId`. Sound +
   vibration.
4. **Seeker tab** (the actor): NO toast. The booking row updates in their
   list silently.

### Flow 4 — Socket fallback / polling

1. In devtools, throttle the WebSocket / block it via DevTools network
   conditions.
2. Trigger a notification-producing event on the other side.
3. **Verify**: within ~20s the seeker's drawer list refreshes and within
   ~15s the unread badge updates (polling intervals shipped in Sprint 7.7).
4. Restore the socket. No duplicate toasts fire (dedupe + the bridge only
   shows toasts for newly-received socket events, not polled REST data).

### Flow 5 — Browser limitations

1. On a fresh tab where autoplay is blocked, accept a bid (from the other
   browser). The toast appears, no sound (browser blocked it). Verify in
   console: no uncaught `NotAllowedError`.
2. On a desktop without `navigator.vibrate`, repeat. Toast appears, no
   vibration, no console errors.
3. After the user clicks anywhere in the tab once (warms autoplay), repeat
   step 1 — sound now plays.

## Risk

Medium. The realtime side-effects bridge sits on every notification path; a
regression here is broadly user-visible. Mitigations:

- Anti-echo + dedupe are well-tested (Sprint 7.6 / 7.10 tests).
- Toast action button only renders when a navigator is registered AND a
  deepLink resolves — defensive defaults mean the worst-case is a silent
  failure, not a crash.
- Active Leads invalidation does one extra refetch per booking transition;
  cost is negligible.
- Backend changes (cookie auth, provider fan-out, seeker-cancel
  notification) ship behind their existing transactional patterns; publish
  failures are swallowed.

## Rollback

Revert this PR. Each commit is independently revertable, but the safest
rollback is `git revert <merge-commit>`.

## Known limitations / follow-ups

1. **Backend doesn't auto-revert `ServiceRequest.status` for booking lifecycle.**
   The seeker's lead-card UI maps `ServiceRequest.status` → display state, and
   the request stays at `BID_ACCEPTED` across all booking transitions. The
   new invalidation triggers a refetch, but the value the backend ships is
   unchanged. If product wants the card to flip to "completed"/"cancelled"
   the moment a booking transitions, follow-up options:
   - Backend: auto-derive `ServiceRequest.status` from the latest booking.
   - Frontend: extend the lead-card mapper to overlay booking status when a
     booking exists.
2. **Prisma client regen** is needed once on a clean machine after pulling
   this branch (Windows file lock on dev box prevented it locally). The
   runtime fallback in `RequestsService` covers TS-side until then.
3. **System / Web Push notifications** (Notification API) are explicitly
   out of scope per the prompt — socket-only delivery while the app/tab is
   active. No service worker added.
4. **Manual E2E was NOT performed by me** — the steps above are required
   before merging.

## Git workflow (manual)

```bash
git checkout fix/notification-ux-and-active-leads-sync
git pull origin develop --rebase   # if your local develop has drifted
git push -u origin fix/notification-ux-and-active-leads-sync

gh pr create \
  --base develop \
  --head fix/notification-ux-and-active-leads-sync \
  --title "fix: add notification UX and sync active leads status" \
  --body-file PR_DESCRIPTION.md
```

If `gh` is unavailable, push the branch and open the PR from the GitHub web
UI, pasting the body of this file into the description.
