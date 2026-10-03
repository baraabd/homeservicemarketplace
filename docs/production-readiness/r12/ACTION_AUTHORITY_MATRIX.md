# R12 — Action authority matrix

Every Message, Call and Progress entry point, and every transport that reaches
a booking conversation. For each one: who acts, what the server decides, what
the screen shows, and the proof.

- "Integration" means `apps/api/test/integration/r12-booking-communication.integration.spec.ts`
  (real PostgreSQL, 35 tests).
- "Browser" means `apps/web/e2e/r12-booking-communication.real-api.spec.ts`
  (real Chromium, API and PostgreSQL, two browsers, 5 tests).
- "Unit" means `BookingActions.test.tsx`, `MyBidsScreen.message.test.tsx`,
  `ChatScreen.test.tsx`, `ProviderChatScreen.retry.test.tsx`,
  `send-attempt.test.ts`, `realtime.gateway.spec.ts` and
  `conversation-participant.gate.spec.ts`.

## Entry points

### Seeker `JobDetailView` › Message

| Aspect              | Detail                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------- |
| Context             | booking, any status                                                                     |
| Actor → other party | seeker → the booking's provider                                                         |
| Before R12          | PLACEHOLDER (disabled, "Coming soon")                                                   |
| Server operation    | `POST /v1/me/conversations {bookingId}`, get-or-create                                  |
| Authorization       | JWT and CSRF; the caller must be the booking's seeker on the SEEKER side, otherwise 404 |
| Canonical id        | the `conversation.id` the server returns                                                |
| Projection          | provider display name, initials and avatar                                              |
| After R12           | opens the existing ChatScreen on the server's conversation                              |
| Proof               | Unit, Browser                                                                           |

### Seeker `JobDetailView` › Call

| Aspect           | Detail                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Context          | booking                                                                                    |
| Before R12       | PLACEHOLDER                                                                                |
| Server operation | none                                                                                       |
| Projection       | no phone number exists in any contract                                                     |
| After R12        | disabled, described as "Calls aren't available in the app. Use Message to reach your pro." |
| Policy           | the calling model is UNRESOLVED (owner decision)                                           |
| Proof            | Unit, Browser                                                                              |

### Seeker `JobDetailView` › Progress (formerly Track)

| Aspect           | Detail                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| Context          | booking                                                                 |
| Actor            | seeker                                                                  |
| Before R12       | PLACEHOLDER                                                             |
| Server operation | `GET /v1/me/bookings/:id` and `/timeline`                               |
| Authorization    | JWT; the caller must own the booking                                    |
| Canonical id     | booking id                                                              |
| Projection       | status and events only                                                  |
| After R12        | focuses the recorded timeline; the current step is the last one reached |
| Proof            | Unit, Browser                                                           |

### Seeker ChatScreen header › Call

| Aspect           | Detail                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Context          | conversation                                                                                     |
| Before R12       | PLACEHOLDER (phone and video, "Coming soon")                                                     |
| Server operation | none                                                                                             |
| After R12        | one disabled control named "Calls aren't available in the app"; video and the no-op menu removed |
| Proof            | Unit, Browser                                                                                    |

### Seeker ChatScreen › send and read

| Aspect           | Detail                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Context          | conversation                                                                                                                                                                                                       |
| Actor            | seeker                                                                                                                                                                                                             |
| Before R12       | AUTHORITATIVE, but a waiting message showed the "sent" check, a retry after a lost reply stored a second copy, and a reply only appeared on reopen                                                                 |
| Server operation | `POST /v1/me/conversations/:id/messages {body, idempotencyKey}`; `GET …/messages`                                                                                                                                  |
| Authorization    | must be the SEEKER participant, otherwise 404; CSRF on send                                                                                                                                                        |
| Canonical id     | message id; one `idempotencyKey` per logical send                                                                                                                                                                  |
| After R12        | an unacknowledged message says "Sending…"; resending a failed message reuses its key and is stored once; the open chat reads again every 4 s while visible; the input is labelled, 16 px, with a named send button |
| Proof            | Integration, Unit, Browser                                                                                                                                                                                         |

### Provider My Bids › accepted booking › Message customer

| Aspect              | Detail                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Context             | booking                                                                                                                      |
| Actor → other party | provider → the booking's seeker                                                                                              |
| Before R12          | ABSENT                                                                                                                       |
| Server operation    | `POST /v1/provider/conversations {bookingId}`                                                                                |
| Authorization       | JWT, provider role, `ManageBookings` and CSRF; the caller must be the booking's provider on the PROVIDER side, otherwise 404 |
| Canonical id        | the `conversation.id` the server returns                                                                                     |
| Projection          | seeker first name and last initial                                                                                           |
| After R12           | navigates to `/provider/messages/:id`                                                                                        |
| Proof               | Unit, Browser                                                                                                                |

### Provider `/provider/messages/:threadId`

| Aspect           | Detail                                                             |
| ---------------- | ------------------------------------------------------------------ |
| Context          | conversation                                                       |
| Actor            | provider                                                           |
| Before R12       | AUTHORITATIVE; polls every 4 s                                     |
| Server operation | `/v1/provider/conversations/*`                                     |
| Authorization    | as above, plus the PROVIDER participant                            |
| After R12        | a failed send keeps its draft; sending it unchanged reuses the key |
| Proof            | Unit, Browser                                                      |

### Seeker messages tab badge

| Aspect           | Detail                                                 |
| ---------------- | ------------------------------------------------------ |
| Before R12       | FABRICATED (constant 3)                                |
| Server operation | `GET /v1/me/conversations`                             |
| After R12        | sum of the server's `unreadCount`                      |
| Proof            | not separately tested (derived from the list response) |

### Realtime `subscribe:conversation`

| Aspect           | Detail                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context          | conversation; the gateway is off unless `REALTIME_SOCKET_IO` is set (off by default and in every deployed configuration; on only in CI's production-image boot)                                                                                                                                                                                 |
| Actor            | either side                                                                                                                                                                                                                                                                                                                                     |
| Before R12       | session revalidation + participant on either side; provider booking access not checked; joined rooms kept after losing provider access                                                                                                                                                                                                          |
| Server operation | gateway (no writes)                                                                                                                                                                                                                                                                                                                             |
| Authorization    | session revalidation; SEEKER-side participant: allowed; PROVIDER-side participant: also `ManageBookings`                                                                                                                                                                                                                                        |
| After R12        | a provider without booking access cannot join; on the provider-status event, provider-side conversation rooms are left and customer-side rooms kept                                                                                                                                                                                             |
| Proof            | Unit (gateway, gate); Integration (real gate + real capability service + real gateway handler: both participants share the room; strangers refused; join before access loss allowed and after it refused, for standing and for status; seeker unaffected; dual-role customer kept). Removing the capability check fails two real-database tests |

## Server authority, before and after R12

| Fact                                               | Authority                                                                   | Before                       | After                                                                                      | Proof                                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Which conversation a booking has                   | Unique live `bookingId`                                                     | One per booking              | Unchanged                                                                                  | Integration: 10 concurrent opens; 4 + 4 from both sides                                                                                                                  |
| Who is in it                                       | The booking's seeker and provider user, written in the creating transaction | Unchanged                    | Unchanged                                                                                  | Integration                                                                                                                                                              |
| Which side a request acts for                      | The route family                                                            | Either side, on either route | Seeker routes → SEEKER only; provider routes → PROVIDER only                               | Integration (4 tests failed before the repair); Browser (suspended provider refused on both route families)                                                              |
| One logical message                                | `(conversationId, senderUserId, idempotencyKey)` unique                     | Every send stored            | Same key + same body → stored row returned; same key + other body → 409; keyless unchanged | Integration (repeat, 8 concurrent, mismatch, per-sender scope, stranger, malformed keys, injected failure not turned into success); Browser (reply dropped after commit) |
| Sender of a message                                | Session plus the participant row of the route's side                        | Unchanged                    | Unchanged                                                                                  | Integration (forged sender fields → 400)                                                                                                                                 |
| Failure while creating a conversation or a message | Transaction                                                                 | Rolled back, 500             | Unchanged                                                                                  | Integration (injected trigger failures: 500, no rows, no leaked text)                                                                                                    |
| Contact data                                       | Projection allow-list                                                       | No phone or email            | Unchanged                                                                                  | Integration (wire scan for phone, email and surname)                                                                                                                     |

## Client ordering and recovery

| Case                                                           | Behaviour                                                                                                                  | Proof                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Message pressed repeatedly while a request is in flight        | One request                                                                                                                | Unit                                                       |
| Two clicks on Message in the same task                         | One request, one conversation                                                                                              | Browser (two `click()` calls dispatched before re-render)  |
| Booking A's answer arrives while booking B is shown            | Nothing opens; B is not "opening"                                                                                          | Unit (fails with the booking guard removed)                |
| B pressed after A, and B answers first                         | Only B opens                                                                                                               | Unit                                                       |
| The answer arrives after the screen closed                     | Nothing opens                                                                                                              | Unit                                                       |
| The answer arrives after another person signed in              | Nothing opens, and the button settles                                                                                      | Unit (fails with the session guard removed)                |
| A failure for A                                                | Not shown on B                                                                                                             | Unit                                                       |
| The reply is lost after the server created the conversation    | An error is shown; pressing again opens the same conversation                                                              | Browser                                                    |
| The reply to a message send is lost after the server stored it | The text returns to the box; sending it unchanged reuses the key; the server answers `replayed: true`; one row, one bubble | Browser (real request forwarded, reply dropped once), Unit |
| Two messages with the same text                                | Two keys, two rows, two bubbles                                                                                            | Integration, Unit, Browser                                 |
| A reply while the seeker's chat is open                        | Appears without reopening; reading stops when the chat closes or after an error                                            | Browser, Unit                                              |
| Offline                                                        | The message is held as "Sending…" and sent once when back online                                                           | Browser                                                    |
