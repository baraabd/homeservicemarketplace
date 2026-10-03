# R12 — Communication policy

Rules for the Message, Call and Progress (formerly "Track") actions on booking
screens. Each rule is marked with its status:

- **CONFIRMED** — stated by approved repository evidence (an ADR, a sprint
  review, a contract comment, a database constraint or a guard's documented
  intent), which is named.
- **EXISTING** — what the code does today. No document approves or forbids
  it. R12 keeps it and does not settle it.
- **PROPOSED** — an engineering default added in R12. It is not product
  policy.
- **UNRESOLVED** — a product decision nobody has made. R12 neither implements
  nor forecloses it.

The product owner was unavailable during R12. No rule below was decided in a
conversation for this sprint.

## Message

| Rule                                                                                                                                                         | Status                                 | Source                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A conversation belongs to one booking. Its two participants are that booking's seeker and its provider.                                                      | CONFIRMED                              | `docs/sprints/sprint-5.5-review.md`: "`POST /conversations { bookingId }` creates the Conversation + both participants on first access". The partial unique index `Conversation_bookingId_live_unique` allows one live conversation per booking.                                          |
| The conversation is created the first time either participant opens it.                                                                                      | CONFIRMED                              | Same sprint review.                                                                                                                                                                                                                                                                       |
| Opening it again returns the same conversation. Two people opening it at once get the same conversation.                                                     | CONFIRMED (behaviour); proven in R12   | `ConversationsService.getOrCreateForBooking`, the unique index, and the R12 integration tests.                                                                                                                                                                                            |
| The acting user comes from the session. The client sends only `bookingId`.                                                                                   | EXISTING                               | `CreateConversationDto`; unknown fields are refused.                                                                                                                                                                                                                                      |
| `/v1/me/conversations` acts for the SEEKER side only, and `/v1/provider/conversations` for the PROVIDER side only.                                           | CONFIRMED (intent); implemented in R12 | The provider controller's documented rule: a DRAFT, PENDING_REVIEW, SUSPENDED or REJECTED provider "must NOT be able to open or post in booking chats". Before R12, the seeker routes served either side, so a provider refused on the provider routes could still post through `/v1/me`. |
| A non-participant gets 404, the same as for a missing conversation, on open, list, read, send and mark-read.                                                 | EXISTING; proven in R12                | `conversations.service.ts`.                                                                                                                                                                                                                                                               |
| There is no Message action before a booking exists (open request, bids only).                                                                                | EXISTING                               | The DTO has no request scope. Which bidders, if any, may write before acceptance is UNRESOLVED.                                                                                                                                                                                           |
| A conversation can be created and written for SCHEDULED, IN_PROGRESS, COMPLETED and CANCELLED bookings alike.                                                | EXISTING                               | No status rule exists anywhere. Whether a cancelled or completed booking's thread should become read-only, and when, is UNRESOLVED. R12 records the current behaviour in tests and does not change it.                                                                                    |
| Suspended, locked, deleted or revoked accounts are refused on every conversation route.                                                                      | EXISTING                               | `JwtAuthGuard` session validation. There is no person-to-person block feature, and none was invented.                                                                                                                                                                                     |
| The other party is shown by display name, initials and avatar. A seeker appears as first name plus last initial. No phone number, email or address is shown. | CONFIRMED                              | Provider booking contract: "Direct contact flows through the Conversation surface". The privacy projection in `conversations.service.ts`. Proven in R12 by a wire-level check.                                                                                                            |
| A message is shown as sent only once the server has acknowledged it. Until then the bubble says "Sending…".                                                  | PROPOSED                               | Honest delivery state. There are no per-message delivered or read receipts, so none is shown.                                                                                                                                                                                             |
| Sending a message is not idempotent. A retry after a lost reply can store the message twice.                                                                 | EXISTING (gap)                         | `SendMessageDto` is `{ body }`. The roadmap assigns messaging persistence to R17. R12 never retries a send automatically. A send held while offline goes out once, when the connection returns (React Query's paused mutation).                                                           |
| The seeker's chat does not poll and does not subscribe to the realtime room. A reply appears when the chat is reopened or reloaded.                          | EXISTING (gap)                         | R17 (messaging persistence and cross-instance behaviour). The provider's thread polls every 4 s.                                                                                                                                                                                          |

## Call

| Rule                                                                                                                                                                   | Status     | Source                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No contract gives a booking participant the other party's phone number.                                                                                                | CONFIRMED  | Provider booking contract ("Direct contact flows through the Conversation surface"); public profile contract ("The marketplace introduces people through the platform"); `docs/sprint-09b9/REDACTED_MARKETPLACE_PREVIEW.md`. |
| The calling model is not decided: an external phone handoff with consent, an in-app calling backend, or no calling.                                                    | UNRESOLVED | No ADR, policy, consent field or telephony provider exists.                                                                                                                                                                  |
| R12 reveals no number and offers no call. Both the job screen and the chat header show that calling is not available and point to Message. Neither says "coming soon". | PROPOSED   | The honest state while the decision is open. Removing the control would decide "no calling", so R12 does not remove it.                                                                                                      |

## Progress (formerly "Track")

| Rule                                                                                                                                                                                                                | Status                        | Source                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| The action shows the booking's recorded progress: its status and timeline events from `GET /v1/me/bookings/:id` and `/timeline`. It is labelled "Progress" ("التقدّم"), not "Track", because it tracks no location. | PROPOSED                      | Only the booking status and timeline are authoritative.                                                                                            |
| No live location, moving marker, ETA, "on the way" or "arrived" state is shown.                                                                                                                                     | CONFIRMED                     | Roadmap R12: "Do not display live-provider location unless a real consented location source and retention policy are implemented". Neither exists. |
| A provider's work-area point or workshop location is not a tracking source.                                                                                                                                         | CONFIRMED                     | R09 geo authority; roadmap.                                                                                                                        |
| The current step is the last step reached. A booking that has not started reads "Scheduled", with "Pro assigned" as its current step.                                                                               | PROPOSED (correctness repair) | Before R12 the first step not yet reached was labelled "Current status", so every scheduled booking claimed to be "In Progress".                   |

## Fabricated communication state removed in R12

- The seeker chat header's "Online" status with a green dot. No presence
  information exists.
- The seeker messages tab badge, which was the constant `3`. It now shows the
  sum of `unreadCount` across the seeker's conversations, as the server
  computes it.
- The chat header's video button and menu button, and the emoji button,
  none of which did anything.
- The footer "Messaging, calls, and tracking are coming soon".

## Decisions the owner needs to make

1. Whether a cancelled or completed booking's conversation stays writable, and for how long.
2. Whether Message should exist before booking, and if so which bidders may write.
3. The calling model. If numbers are ever shared, the consent and revocation rules.
4. Whether booking progress should gain real lifecycle events such as "on the way". That needs a provider action. For a location, it also needs a consented source and a retention policy.
5. Whether the realtime room gate should also require the provider capability. Today a session-valid participant can join it whatever their standing. R12 did not change the realtime gate; see `IMPLEMENTATION.md`.
