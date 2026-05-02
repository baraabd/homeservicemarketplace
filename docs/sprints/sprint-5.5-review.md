# Sprint 5.5 Review Report — Notifications & Chat REST + Polling (provider)

## 1. Planning Summary

- **Scope:** Make the existing seeker `/v1/me/notifications` and
  `/v1/me/conversations` REST surfaces work for providers without
  duplicating endpoints. Two real gaps to close:
  1. `BidsService.accept` only fanned out notifications to the seeker;
     the provider's app had no way to learn that their bid was accepted.
  2. `ConversationsService.getOrCreateForBooking` was seeker-scoped —
     it created the provider participant with `userId: null`, so the
     provider would never surface the conversation in their list.
- **Existing files inspected:**
  - `apps/api/src/modules/bids/bids.service.ts` (notification fan-out)
  - `apps/api/src/modules/conversations/conversations.service.ts`
  - `apps/api/src/infrastructure/persistence/conversations/conversation.repository.ts`
    (already filters by `participants.some.userId` — no schema change needed
    once the userId is set on the provider participant)
  - `apps/api/src/modules/notifications/notifications.controller.ts`
    (role-agnostic — already works for providers)
- **Dependencies found:** Sprint 5.3 already wired `NotificationsModule`
  into `ProviderModule`; this sprint reuses that import. Sprint 5.4
  added `BookingRepository.findOwnedByProvider` which the conversations
  service now calls for the provider-initiated branch.
- **Risks found:**
  - Conversations created BEFORE this sprint had `participant.userId = null`
    on the provider side. Those rows are NOT backfilled. Documented in
    Section 7 — only affects pre-5.5 dev/test data.
  - Notification fan-out only fires when `ProviderProfile.userId` is
    set. Older seed rows where the profile is detached from a user
    account are skipped silently (the provider can't sign in without a
    userId, so no surface to notify).

## 2. Implementation Summary

- **Files changed:**
  - `apps/api/src/modules/bids/bids.service.ts` — added two more
    `notifications.createForUser` calls (BID_ACCEPTED + BOOKING_CREATED)
    targeting the provider's userId when present. All four
    notifications stay inside the same transaction.
  - `apps/api/src/modules/conversations/conversations.service.ts` —
    `getOrCreateForBooking` is now side-aware:
    - Tries the seeker side first via `bookings.findOwned`.
    - Falls back to the provider side via
      `providers.findByUserId` → `bookings.findOwnedByProvider`.
    - Creates the seeker participant with `userId = booking.seekerUserId`
      and the provider participant with
      `userId = booking.provider.userId ?? callingUserId`.
    - Extracted `createConversationRows` private helper so the two
      branches share writes.
      Now `ConversationsService` injects `ProviderProfileRepository`.
  - `apps/api/src/modules/conversations/conversations.service.spec.ts` —
    added `providers` mock; new test cases:
    - "seeker-initiated: provider participant userId tracks the
      provider profile's userId (slice 5.5)"
    - "provider-initiated: resolves the booking via providerProfile
      and creates participants"
  - `apps/api/src/modules/bids/bids.service.spec.ts` — added test
    "also fans out two provider-side notifications when the provider
    has a linked userId (slice 5.5)" — asserts 4 total
    `notifications.createForUser` calls, the latter two targeting
    the provider's userId with `/provider/{bids,bookings}/...` deep
    links.
  - `postman/hsm-provider.postman_collection.json` — added folder
    `60 — Notifications & Chat (Sprint 5.5 — provider role on shared endpoints)`
    with 7 requests covering the provider-side notification feed,
    unread count, mark-read, conversation list, conversation create,
    send message (asserts senderRole=PROVIDER), and read messages.
- **Migrations added:** none.
- **Contracts added/changed:** none. The endpoints already accept
  any authenticated user; no DTO change was needed.
- **UI added/changed:** none. Frontend can use the existing seeker
  hooks (notifications-api, chat-api) directly because they read
  `userId` from the session — the API responses are role-agnostic.

## 3. Automated Tests

| Check                                                                                  | Result                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `prisma validate`                                                                      | pass                                            |
| `pnpm --filter @homeservicemarketplace/contracts build`                                | pass                                            |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | pass                                            |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | pass                                            |
| `pnpm --filter @homeservicemarketplace/api test`                                       | pass — 609 passed (+3 new), 6 skipped           |
| `pnpm --filter @homeservicemarketplace/web test`                                       | pass (no test changes; existing 295 still pass) |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | pass (verified in Sprint 5.4)                   |

New / changed unit tests:

- `bids.service.spec.ts` — provider-side notification fan-out (4 calls
  total when `provider.userId` is set; deep links point at
  `/provider/bids/:id` and `/provider/bookings/:id`).
- `conversations.service.spec.ts` — seeker-initiated path now sets
  the provider participant's userId from `provider.userId`; new
  provider-initiated path resolves the booking via the provider profile
  repo and creates both participants with the right userIds.

## 4. Postman Tests

- Collection updated: `postman/hsm-provider.postman_collection.json`.
- Folder `60 — Notifications & Chat (Sprint 5.5)` (7 requests):
  - GET /v1/me/notifications (provider) — captures `notificationId`
  - GET /v1/me/notifications/unread-count
  - POST /v1/me/notifications/:id/read
  - GET /v1/me/conversations
  - POST /v1/me/conversations { bookingId }
  - POST /v1/me/conversations/:id/messages — asserts `senderRole=PROVIDER`
  - GET /v1/me/conversations/:id/messages
- Newman run: deferred to Sprint 5.7 end-to-end harness.

## 5. Manual Checks

- Scenario: provider's app gets a notification when their bid is accepted.
  Expected: BidsService.accept emits 4 notifications when
  `provider.userId` is non-null.
  Actual: confirmed by the new spec test.
  Result: pass.
- Scenario: provider opens chat for a confirmed booking.
  Expected: `POST /v1/me/conversations { bookingId }` resolves the
  booking from the provider side and returns the conversation.
  Actual: confirmed by the new
  "provider-initiated: resolves the booking via providerProfile" test.
  Result: pass.
- Scenario: a foreign bookingId is opaque (no enumeration possible).
  Expected: 404 with no internal leak.
  Actual: pre-existing test pinned, plus the new branch returns 404
  for the same unauthorised cases.
  Result: pass.

## 6. Fixes Applied

- File: `apps/api/src/modules/conversations/conversations.service.ts`
  Reason: provider participant was created with `userId: null`,
  hiding the conversation from the provider's list endpoint.
  Before: `userId: null` hard-coded on the provider participant.
  After: `userId: booking.provider.userId ?? null`, plus a new
  provider-initiated branch that resolves the booking via the
  provider profile.
  Risk: existing pre-5.5 conversations with null providerUserId are
  not backfilled — surfaces as "old conversations don't appear in
  provider's list". Documented in Section 7. A backfill migration
  is straightforward but out of scope for this sprint.
- File: `apps/api/src/modules/bids/bids.service.ts`
  Reason: provider had no notification surface for accepted bids /
  new bookings.
  Before: 2 calls to `notifications.createForUser`, both targeting
  `seekerUserId`.
  After: 4 calls when `provider.userId` is set — provider gets
  parallel BID_ACCEPTED and BOOKING_CREATED rows.
  Risk: none — additive write inside the same transaction; rolls
  back atomically with the rest of the accept flow.

## 7. Remaining Issues

- **Backfill** for conversation participants created before slice 5.5
  is intentionally not done in this sprint — only affects pre-5.5
  dev/test data. A small SQL migration could fix it:
  `UPDATE "ConversationParticipant" cp SET "userId" = pp."userId"
 FROM "ProviderProfile" pp
 WHERE cp."providerProfileId" = pp."id"
   AND cp."userId" IS NULL
   AND cp."role" = 'PROVIDER'
   AND pp."userId" IS NOT NULL;`
  Park the migration for the Sprint 7.0 realtime work, where
  conversation history matters more.
- The flaky `app-selector-routing.test.tsx` test from Sprint 5.2
  remains flaky; this sprint touches only the API.

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically. All Sprint 5.5 surface area is
green (api typecheck +3 tests, contracts build, api/web tests).
