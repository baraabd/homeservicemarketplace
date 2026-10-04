# R17-A — Messaging durability and cross-instance authority

Status: **R17_A_IN_PROGRESS** until exact-head hosted acceptance is recorded
in the PR. Base: `develop@460b9eefd8e0eafc5f4aad65a2c03c3ef102ca30`.

Reused, not rebuilt: R12's conversations, side binding, scoped send
idempotency, polling, and the R12 browser and integration suites.

## Defects repaired

### A-1 — an open chat stops marking replies read once the thread is long

- **Source:** `apps/web/src/app/components/chat/ChatScreen.tsx` (mark-read effect).
- **Symptom:** while a seeker has a conversation open, replies appear on
  screen, but once the newest page holds 50 messages they are never marked
  read, so the messages-tab badge counts replies the seeker has already seen.
- **Root cause:** the effect's dependency was `items.length`. The chat reads
  the newest page (50). A new reply replaces the oldest row on that page, so
  the length stays 50 and the effect does not run again.
- **Failing before:** `ChatScreen.test.tsx` "R17: a reply in a full thread is
  marked read up to the newest message shown", on the untouched baseline:
  `AssertionError: expected [ {} ] to have a length of 2 but got 1`.
- **Correction:** the effect is keyed on the id of the newest server message
  on screen, and sends that id.
- **After:** the same test passes; chat and home suites 104/104.

### A-2 — the read position is the clock, not what was shown

- **Source:** `ConversationsService.markRead`.
- **Symptom:** a message committed after the reader's last read of the
  thread, but before the read request, was counted read without being shown.
  The position came from whichever replica's clock served the request.
- **Root cause:** `lastReadAt = new Date()` on the server, with no reference
  to the messages the client had.
- **Failing before:** five new cases in
  `apps/api/test/integration/r12-booking-communication.integration.spec.ts`
  (`R17 read position`), run on the baseline server source: all five failed —
  e.g. unread `Expected: 1, Received: 0`; a foreign message id
  `Expected: 404, Received: 200`; position = clock, not message time.
- **Correction (additive contract):** `POST /v1/{me,provider}/conversations/:id/read`
  accepts an optional `{ upToMessageId }` (`MarkConversationReadRequest`).
  The message must be a live message of that conversation (else 404, nothing
  moves). `lastReadAt` becomes that message's stored `createdAt` through a
  conditional update that never moves it backwards (two tabs, late requests,
  replica clocks). Without a body the call behaves as before (now), also
  monotonic. The seeker web client always sends the id.
- **After:** all 40 cases of the suite pass on real PostgreSQL (35 existing +
  5 new): an unseen message stays unread; a late read from another tab does
  not move the position back; eight concurrent reads settle on the newest;
  foreign or guessed ids and malformed bodies move nothing and disclose
  nothing; the provider side follows the same rule.
- **Remaining uncertainty:** two different messages stored in the same
  millisecond as the shown one would be counted read together with it
  (`createdAt` precision); ordering ties are broken by id in listings.

## Cross-instance acceptance (new evidence)

`apps/web/e2e/r17-messaging-cross-instance.real-api.spec.ts` with
`apps/web/e2e/api-replicas.ts`. Two separate API processes (ports 4011, 4012)
on one PostgreSQL and one Redis; two copies of the built web app with their
API address baked in (web A → replica A only, web B → replica B only).
Replica identity is proven from the origins of the requests each browser
made; no diagnostic endpoint was added.

| Step                                        | Proof                                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seeker writes through web A                 | UI send; request body; 201; committed row; every seeker API call went to replica A                                                                                         |
| Provider reads and replies through web B    | UI open + send on B; 201; every provider API call went to replica B                                                                                                        |
| Reply reaches the seeker's open chat on A   | by the chat's own reads (polling), no reopen; read position in PostgreSQL reaches the reply                                                                                |
| Same session continues on the other replica | seeker opens the same conversation on web B; full history                                                                                                                  |
| Replica A stopped                           | health endpoint unreachable; seeker keeps writing through B                                                                                                                |
| Replica A restarted                         | new process id; reload on A and on B show each message exactly once                                                                                                        |
| Committed history                           | rows ordered, three ids, correct senders; both replicas return identical id lists                                                                                          |
| Unread on either replica                    | a message sent via B while the seeker is away: `unreadCount` 1 from A and from B                                                                                           |
| Retried send across replicas                | same key on A then B → one row, `replayed: true`; changed body → 409; two intentional identical messages with distinct keys → two rows                                     |
| Paging during writes                        | pages of 3 through B while A writes between pages: every pre-existing message seen once in stored order; catch-up page returns everything                                  |
| Ended session                               | logout through A; the old cookies on B → 401 for read and send; browser on web B redirected to login, no history shown; strangers get 404 on both replicas with no content |

Not claimed: Socket.IO delivery. The gateway is off by default and the web
app never subscribes to conversation rooms (gap A-6); realtime cutover needs
separate approval. The existing gateway tests stay labelled unit-level.

CI: `phase5-real-api` job — "Build and serve one web app per R17 API
replica", "Accept R17-A messaging across two API instances", artifact
`r17-a-messaging-evidence` (`if-no-files-found: error`).

## Files

| File                                                                                                                | Why                                                      |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/contracts/src/seeker/chat/request/mark-conversation-read.request.ts` (+ barrel, response comment)         | additive request contract                                |
| `apps/api/src/modules/conversations/dto/mark-conversation-read.dto.ts`                                              | validated optional id (1–64, `[A-Za-z0-9_-]`)            |
| `conversations.controller.ts`, `provider-conversations.controller.ts`                                               | bind the body                                            |
| `conversations.service.ts`                                                                                          | read position from the shown message                     |
| `conversation-participant.repository.ts`                                                                            | monotonic `advanceLastReadAt` (replaces `setLastReadAt`) |
| `message.repository.ts`                                                                                             | `findInConversation`                                     |
| `apps/web/src/app/components/chat/ChatScreen.tsx`, `hooks/seeker/useChat.ts`, `lib/seeker/chat-api.ts`              | key on the newest shown message; send its id             |
| tests: `ChatScreen.test.tsx`, `chat-api.test.ts`, `conversations.service.spec.ts`, R12 integration spec (R17 block) | failing-before / passing-after                           |
| `apps/web/e2e/api-replicas.ts`, `r17-messaging-cross-instance.real-api.spec.ts`, `real-api.ts` (`apiAt`)            | cross-instance harness                                   |
| `.github/workflows/ci.yml`                                                                                          | two steps and one upload in `phase5-real-api`            |

No schema change, no migration, no feature flag, no new permission.

## Rollback

Revert the PR. The contract change is additive and optional: an older web
client (bodyless call) keeps working against the new API, and the new web
client's body would be rejected (400) by an older API only if the API were
rolled back alone — roll back web and API together. No data is migrated;
`lastReadAt` values written by the new code are ordinary timestamps.
