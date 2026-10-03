# R12 — Action authority matrix

Every Message, Call and Progress entry point. For each one: who acts, what the
server decides, what the screen shows, and the proof.

- "Integration" means `apps/api/test/integration/r12-booking-communication.integration.spec.ts`
  (real PostgreSQL, 20 tests).
- "Browser" means `apps/web/e2e/r12-booking-communication.real-api.spec.ts`
  (real Chromium, API and PostgreSQL, two browsers).
- "Unit" means `BookingActions.test.tsx`, `MyBidsScreen.message.test.tsx` and
  `ChatScreen.test.tsx`.

## Entry points

### Seeker `JobDetailView` › Message

| Aspect              | Detail                                                               |
| ------------------- | -------------------------------------------------------------------- |
| Context             | booking, any status                                                  |
| Actor → other party | seeker → the booking's provider                                      |
| Before R12          | PLACEHOLDER (disabled, "Coming soon")                                |
| Server operation    | `POST /v1/me/conversations {bookingId}`, get-or-create               |
| Authorization       | JWT and CSRF; the caller must be the booking's seeker, otherwise 404 |
| Canonical id        | the `conversation.id` the server returns                             |
| Projection          | provider display name, initials and avatar                           |
| After R12           | opens the existing ChatScreen on the server's conversation           |
| Proof               | Unit, Browser                                                        |

### Seeker `JobDetailView` › Call

| Aspect              | Detail                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Context             | booking                                                                                    |
| Actor → other party | —                                                                                          |
| Before R12          | PLACEHOLDER                                                                                |
| Server operation    | none                                                                                       |
| Authorization       | —                                                                                          |
| Canonical id        | —                                                                                          |
| Projection          | no phone number exists in any contract                                                     |
| After R12           | disabled, described as "Calls aren't available in the app. Use Message to reach your pro." |
| Proof               | Unit, Browser                                                                              |

### Seeker `JobDetailView` › Progress (formerly Track)

| Aspect              | Detail                                                                   |
| ------------------- | ------------------------------------------------------------------------ |
| Context             | booking                                                                  |
| Actor → other party | seeker                                                                   |
| Before R12          | PLACEHOLDER                                                              |
| Server operation    | `GET /v1/me/bookings/:id` and `/timeline`                                |
| Authorization       | JWT; the caller must own the booking                                     |
| Canonical id        | booking id                                                               |
| Projection          | status and events only                                                   |
| After R12           | focuses the recorded timeline; the current step is the last step reached |
| Proof               | Unit, Browser                                                            |

### Seeker ChatScreen header › Call

| Aspect           | Detail                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| Context          | conversation                                                                                     |
| Before R12       | PLACEHOLDER (phone and video, "Coming soon")                                                     |
| Server operation | none                                                                                             |
| After R12        | one disabled control named "Calls aren't available in the app"; video and the no-op menu removed |
| Proof            | Unit, Browser                                                                                    |

### Seeker ChatScreen › send

| Aspect           | Detail                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Context          | conversation                                                                                      |
| Actor            | seeker                                                                                            |
| Before R12       | AUTHORITATIVE, but a waiting message showed the "sent" check                                      |
| Server operation | `POST /v1/me/conversations/:id/messages`                                                          |
| Authorization    | must be the SEEKER participant, otherwise 404; CSRF                                               |
| Canonical id     | message id                                                                                        |
| After R12        | an unacknowledged message says "Sending…"; the input is labelled, 16 px, with a named send button |
| Proof            | Unit, Browser                                                                                     |

### Provider My Bids › accepted booking › Message customer

| Aspect              | Detail                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Context             | booking                                                                                                 |
| Actor → other party | provider → the booking's seeker                                                                         |
| Before R12          | ABSENT                                                                                                  |
| Server operation    | `POST /v1/provider/conversations {bookingId}`                                                           |
| Authorization       | JWT, provider role, `ManageBookings` and CSRF; the caller must be the booking's provider, otherwise 404 |
| Canonical id        | the `conversation.id` the server returns                                                                |
| Projection          | seeker first name and last initial                                                                      |
| After R12           | navigates to `/provider/messages/:id`                                                                   |
| Proof               | Unit, Browser                                                                                           |

### Provider `/provider/messages/:threadId`

| Aspect           | Detail                                  |
| ---------------- | --------------------------------------- |
| Context          | conversation                            |
| Actor            | provider                                |
| Before R12       | AUTHORITATIVE; polls every 4 s          |
| Server operation | `/v1/provider/conversations/*`          |
| Authorization    | as above, plus the PROVIDER participant |
| Canonical id     | thread id in the URL                    |
| After R12        | unchanged                               |
| Proof            | Browser                                 |

### Seeker messages tab badge

| Aspect           | Detail                                                 |
| ---------------- | ------------------------------------------------------ |
| Before R12       | FABRICATED (constant 3)                                |
| Server operation | `GET /v1/me/conversations`                             |
| Canonical id     | —                                                      |
| After R12        | sum of the server's `unreadCount`                      |
| Proof            | not separately tested (derived from the list response) |

### Realtime `subscribe:conversation`

| Aspect           | Detail                                             |
| ---------------- | -------------------------------------------------- |
| Context          | conversation                                       |
| Actor            | either side                                        |
| Before R12       | server AUTHORITATIVE; the web never subscribes     |
| Server operation | gateway                                            |
| Authorization    | session revalidation and participant (either side) |
| After R12        | unchanged; see the open decision                   |
| Proof            | none in R12                                        |

## Server authority, before and after R12

| Fact                                  | Authority                                                                   | Before                       | After                                                        | Proof                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Which conversation a booking has      | Unique live `bookingId`                                                     | One per booking              | Unchanged                                                    | Integration: 10 concurrent opens; 4 + 4 concurrent from both sides                                          |
| Who is in it                          | The booking's seeker and provider user, written in the creating transaction | Unchanged                    | Unchanged                                                    | Integration                                                                                                 |
| Which side a request acts for         | The route family                                                            | Either side, on either route | Seeker routes → SEEKER only; provider routes → PROVIDER only | Integration (4 tests failed before the repair); Browser (suspended provider refused on both route families) |
| Sender of a message                   | Session plus the participant row of the route's side                        | Unchanged                    | Unchanged                                                    | Integration (forged sender fields → 400)                                                                    |
| Failure while creating a conversation | Transaction                                                                 | Rolled back, 500             | Unchanged                                                    | Integration (injected trigger failure: 500, no rows, no leaked text)                                        |
| Contact data                          | Projection allow-list                                                       | No phone or email            | Unchanged                                                    | Integration (wire scan for phone, email and surname)                                                        |

## Client ordering (Message)

| Case                                                        | Behaviour                                                     | Proof                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| Pressed repeatedly while a request is in flight             | One request                                                   | Unit                                        |
| Booking A's answer arrives while booking B is shown         | Nothing opens; B is not "opening"                             | Unit (fails with the booking guard removed) |
| B pressed after A, and B answers first                      | Only B opens                                                  | Unit                                        |
| The answer arrives after the screen closed                  | Nothing opens                                                 | Unit                                        |
| The answer arrives after another person signed in           | Nothing opens, and the button settles                         | Unit (fails with the session guard removed) |
| A failure for A                                             | Not shown on B                                                | Unit                                        |
| The reply is lost after the server created the conversation | An error is shown; pressing again opens the same conversation | Browser                                     |
