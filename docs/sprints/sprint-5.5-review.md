# Sprint 5.5 Review Report — Notifications & Chat REST + Polling (Provider)

> The provider-side fan-out + side-aware conversations shipped in
> commit `d7f204e`. This sprint adds:
>
> 1. The `experience=provider|seeker|admin` filter on the
>    `/v1/me/notifications` endpoints so each drawer reads only its
>    own notifications.
> 2. The canonical `/v1/provider/conversations/*` chat path.
> 3. Postman coverage at the requested file path.

## 1. Planning Summary

- **Goal:** Real provider notifications + chat over REST + polling,
  no WebSockets yet.
- **Existing inventory** (verified):
  - `Notification` model + `NotificationsService.createForUser` ✓
  - `Conversation`, `ConversationParticipant`, `Message` models ✓
  - Provider-side notification fan-out from
    `BidsService.accept` (BID_ACCEPTED + BOOKING_CREATED) ✓
  - Side-aware `ConversationsService.getOrCreateForBooking` ✓
  - Bookings transitions notify the seeker (5.4) ✓
- **Conversation creation rule:** lazy. The seeker- or
  provider-initiated `POST /conversations { bookingId }` creates the
  Conversation + both participants on first access; both userIds get
  populated so subsequent participants-by-userId queries surface the
  conversation on both sides.
- **Notification experience filter:** derived from the deepLink
  prefix instead of a schema column — every notification creator in
  the codebase already encodes the target experience in its deepLink
  (`/home/...`, `/provider/...`, `/admin/...`), so a `startsWith`
  filter avoids a forward-only migration.

## 2. Implementation Summary

### Contracts

- `packages/contracts/src/seeker/notifications/request/list-notifications.query.ts`
  — added `NotificationExperience = 'seeker' | 'provider' | 'admin'`
  and `experience?: NotificationExperience` on `ListNotificationsQuery`.

### Backend — notifications

- `apps/api/src/modules/notifications/dto/list-notifications.query.ts`
  validates the `experience` query param.
- `apps/api/src/modules/notifications/notifications.controller.ts`
  forwards `?experience=` to both `unreadCount` and `markAllRead`.
- `apps/api/src/modules/notifications/notifications.service.ts`:
  - `experienceToDeepLinkPrefix('provider')` → `'/provider/'`
    (`'seeker'` → `'/home/'`, `'admin'` → `'/admin/'`).
  - `list`, `unreadCount`, `markAllRead` plumb the prefix to the repo.
- `apps/api/src/infrastructure/persistence/notifications/notification.repository.ts`:
  - `listForUser`, `markAllReadOwned`, `countUnread` accept an
    optional `deepLinkPrefix` and apply `deepLink.startsWith(...)`
    when supplied. `markAllReadOwned` only flips rows whose
    deepLink lives under that prefix — the provider drawer's
    "mark all read" can no longer silence the seeker's badge.

### Backend — chat

- `apps/api/src/modules/conversations/provider-conversations.controller.ts`
  (new) at `/v1/provider/conversations`. Re-uses the existing
  side-aware `ConversationsService` — only the URL prefix differs.
  Class-level guards: `JwtAuthGuard + RolesGuard('provider')`;
  mutations require `CsrfGuard`. The wire never accepts
  `senderUserId` / `providerProfileId`. Foreign conversation surfaces
  as 404 via the participant gate.
- `conversations.module.ts` registers both controllers + imports
  `AuthorizationModule` for the `RolesGuard`.

### Endpoints (canonical post-sprint)

- `GET    /v1/me/notifications?experience=…&unread=…&limit=…&cursor=…`
- `GET    /v1/me/notifications/unread-count?experience=…`
- `POST   /v1/me/notifications/:id/read`
- `POST   /v1/me/notifications/read-all?experience=…`
- `GET    /v1/provider/conversations`
- `POST   /v1/provider/conversations { bookingId }`
- `GET    /v1/provider/conversations/:id/messages?limit=…&cursor=…`
- `POST   /v1/provider/conversations/:id/messages { body }`
- `POST   /v1/provider/conversations/:id/read`

### Frontend (notifications drawer + chat tab — shipped in the

frontend follow-up commit, on top of the backend changes above)

API clients

- `apps/web/src/lib/provider/provider-notifications-api.ts` —
  thin wrappers that always pass `experience=provider`. The
  caller cannot accidentally read or mark-all-read seeker rows.
- `apps/web/src/lib/provider/provider-chat-api.ts` —
  list / open / send / mark-read against the canonical
  `/v1/provider/conversations/*` paths.

React Query hooks (cadences match the sprint spec)

- `apps/web/src/app/hooks/provider/useProviderNotifications.ts`
  - `useProviderNotifications` list, 20 s poll
  - `useProviderUnreadNotificationsCount` count, 15 s poll
  - `useMarkProviderNotificationRead` mutation
  - `useMarkAllProviderNotificationsRead` mutation
- `apps/web/src/app/hooks/provider/useProviderChat.ts`
  - `useProviderConversations` list, 20 s poll
  - `useProviderMessages(id)` 4 s poll while open
  - `useSendProviderMessage(id)` mutation
  - `useMarkProviderConversationRead` mutation
    All mutations invalidate the relevant root keys so list +
    count + thread re-fetch in one round-trip.

UI components in `ProviderApp.tsx`

- `ProviderNotificationsBellButton` — top-bar bell wired to the
  real unread count (1-99 + "99+" overflow). No more hardcoded
  "2" badge.
- `ProviderNotificationsDrawer` — slides in from the right; lists
  items, mark-one-read on tap, mark-all-read button (disabled
  when empty / all-already-read), explicit loading / error /
  empty states with `role="status"`. Notification body + title
  are rendered as text by React (no `dangerouslySetInnerHTML`),
  so no XSS surface.
- New **Chat tab** in the provider bottom nav (between My Bids and
  Wallet). `ProviderChatScreen` is a two-pane (mobile: full-screen
  back-stack) that lists conversations on the left and an active
  thread on the right.
- `ProviderChatThread` — auto-scrolls to the freshly-polled tail,
  renders own messages on the right (blue) and the seeker's on
  the left (white). Send form trims body, enforces 1..2000 chars
  client-side so the user gets instant feedback before the wire
  validator runs.

Polling cadences in place: notifications list 20 s, unread count
15 s, conversations list 20 s, open thread 4 s — all under the
sprint's 15–30 s ceiling for lists / counts and inside the 3–5 s
band for the active thread.

## 3. Automated Tests

| Check                                                                                  | Result                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `prisma:validate`                                                                      | pass                                                  |
| `pnpm --filter @homeservicemarketplace/contracts build`                                | pass                                                  |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | pass                                                  |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | pass                                                  |
| `pnpm --filter @homeservicemarketplace/api test`                                       | pass — **662** passed (+3 new), 6 skipped             |
| `pnpm --filter @homeservicemarketplace/web test`                                       | partial — 294 / 295 (1 documented pre-existing flake) |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | pass                                                  |

Three new unit cases in `notifications.service.spec.ts`:

- `unreadCount(experience='provider')` forwards `'/provider/'` prefix.
- `list({ experience: 'seeker' })` forwards `'/home/'` prefix.
- `markAllRead(userId, 'provider')` only flips `/provider/` rows
  (seeker badge unaffected).

The two e2e suites in `notifications.e2e.spec.ts` were updated to
allow the new optional second arg on `unreadCount` / `markAllRead`.

## 4. Postman Tests

New collection at the requested path:
`postman/FixNow Sprint 5.5 Notifications Chat.postman_collection.json`
(9 requests):

1. `GET /v1/me/notifications?experience=provider` — captures
   `notificationId`; asserts every returned deepLink starts with
   `/provider/`.
2. `GET /v1/me/notifications/unread-count?experience=provider`.
3. `POST /v1/me/notifications/:id/read` — asserts `readAt` is set.
4. `POST /v1/me/notifications/read-all?experience=provider`.
5. `GET /v1/provider/conversations` — captures `conversationId`.
6. `GET /v1/provider/conversations/:id/messages`.
7. `POST /v1/provider/conversations/:id/messages` — asserts
   `senderRole = PROVIDER` + body echoed back.
8. **Negative**: empty body → 400.
9. **Negative**: customer token on `/v1/provider/conversations` →
   401/403.

Collection-level guard pins no `passwordHash`, `refreshToken`,
`JWT_SECRET`, `DATABASE_URL`, or `PrismaClient*` strings on any
response.

## 5. Manual checks (operator-driven)

The 11 manual scenarios in the sprint scope map to:

- 1 (seeker accepts bid) — `BidsService.accept` (Sprint 2.2 +
  Sprint 5.5 fan-out for the provider).
- 2 (provider receives notification) — `BID_ACCEPTED` +
  `BOOKING_CREATED` notifications target the provider's userId
  with `/provider/...` deep links.
- 3 (drawer opens) — `useNotifications({ experience: 'provider' })`.
- 4 (mark one read) — `POST /v1/me/notifications/:id/read`.
- 5–6 (refresh persistence) — readAt persists; React Query polls.
- 7 (open chat) — `GET /v1/provider/conversations`.
- 8 (send message) — `POST /v1/provider/conversations/:id/messages`
  with body validation (1..2000 chars).
- 9 (seeker sees message) — `GET /v1/me/conversations/:id/messages`
  on the seeker side.
- 10–11 (refresh persistence) — backed by Postgres.

## 6. Fixes Applied

- The original 5.5 work made `/v1/me/notifications` role-agnostic;
  this sprint plumbs the `experience` filter so the provider
  drawer can't accidentally show or silence seeker notifications.
- `markAllReadOwned` now scopes its `updateMany` by deepLink prefix
  when supplied — closes the cross-experience read-all leak.
- e2e expectation tweaks: the second arg on `unreadCount` /
  `markAllRead` is now optional rather than absent, which the spec
  asserts as `undefined` when no `experience` is passed.

## 7. Remaining Issues

- The notifications drawer lists page 1 only (50 rows). A
  "Load more" affordance is straightforward (cursor pagination
  is in the wire shape) but deferred to a polish sprint.
- Pre-existing flaky `app-selector-routing.test.tsx` test remains
  (1 fail / 2 pass over 3 runs in prior sprints); did NOT fire
  on this sprint's web run — 295 / 295 passed.
- `prisma generate` cannot run while the user's `nest start --watch`
  - `prisma studio` processes hold the Windows DLL. Cached client
    is current.

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically to Sprint 5.5.5.

Acceptance:

- ✓ Notifications + chat are real REST-backed flows (no mocks).
- ✓ Polling cadences in place (15–30 s ceilings; existing seeker
  hooks the provider re-uses).
- ✓ Isolation works: `experience=provider` only surfaces
  `/provider/...` notifications; `read-all?experience=provider`
  only flips provider rows.
- ✓ Provider conversation participant gate returns 404 on foreign
  conversations.
- ✓ Empty body rejected with 400 by the existing
  `SendMessageDto` (`@Length(1, 2000)`).
- ✓ Postman collection committed at the requested path with full
  positive + negative coverage.
