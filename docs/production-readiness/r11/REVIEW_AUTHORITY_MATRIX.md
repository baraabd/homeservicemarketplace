# R11 — Review authority matrix

Who decides each fact, where it is enforced, and which test proves it.
"Integration" is
`apps/api/test/integration/r11-reviews-reputation.integration.spec.ts` (real
PostgreSQL). "Browser" is
`apps/web/e2e/r11-reviews-reputation.real-api.spec.ts` (real Chromium, API and
PostgreSQL). "Unit" is `apps/web/src/app/components/home/BookingReview.test.tsx`.

## Endpoints

| Endpoint                                   | Guards                                                 | Purpose                                                                               |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `GET /v1/me/bookings/:bookingId/review`    | JWT                                                    | The caller's own booking: whether it can be reviewed, and the review if there is one. |
| `POST /v1/me/bookings/:bookingId/review`   | JWT, CSRF                                              | Submit. 201 created, 200 replay of identical content.                                 |
| `GET /v1/admin/reviews`                    | JWT, role `admin`, permission `reviews:read`           | List for moderation.                                                                  |
| `POST /v1/admin/reviews/:reviewId/hide`    | JWT, CSRF, role `admin`, permission `reviews:moderate` | Hide, with a reason.                                                                  |
| `POST /v1/admin/reviews/:reviewId/restore` | same                                                   | Restore, with a reason.                                                               |

The administrator's permission is read fresh from the database on every
moderation call, not only from the token.

## Facts and their authority

| Fact                       | Authority                                 | Client may send         | Enforcement                                                                                                                                                                                                                                              | Proof                                                                                                            |
| -------------------------- | ----------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Who is reviewing           | Session                                   | Nothing                 | `seekerUserId` comes from the token; unknown body fields are refused (400).                                                                                                                                                                              | Integration (forged fields), Browser.                                                                            |
| Who is reviewed            | `Booking.providerId`                      | Nothing                 | Read from the locked booking row; composite foreign key `(bookingId, seekerUserId, providerId)` to `Booking`.                                                                                                                                            | Integration (database constraints).                                                                              |
| Which booking              | URL                                       | Booking id              | Ownership is in the `WHERE`; other users' bookings are 404.                                                                                                                                                                                              | Integration, Browser (stranger, provider).                                                                       |
| Booking is completed       | `Booking.status`, read under `FOR UPDATE` | Nothing                 | 409 `BOOKING_NOT_COMPLETED` otherwise.                                                                                                                                                                                                                   | Integration (each status; completion-versus-review race), Browser (scheduled, in progress).                      |
| One review per booking     | PostgreSQL unique index                   | —                       | Unique `bookingId`; the duplicate error is handled narrowly and the winner re-read.                                                                                                                                                                      | Integration (8 identical and 2 different concurrent submissions).                                                |
| Rating range               | API and database                          | Rating                  | Validation, plus CHECK `booking_review_rating_in_range`.                                                                                                                                                                                                 | Integration.                                                                                                     |
| Comment bounds             | API and database                          | Comment                 | Validation, plus CHECK `booking_review_comment_bounded`.                                                                                                                                                                                                 | Integration.                                                                                                     |
| Created time               | Database                                  | Nothing                 | Column default.                                                                                                                                                                                                                                          | Integration (forged fields).                                                                                     |
| Review state               | Administrator action                      | Nothing from the author | Conditional update on the previous state; CHECK `booking_review_hidden_is_explained`.                                                                                                                                                                    | Integration (concurrent moderators), Browser.                                                                    |
| `ratingAvg`, `reviewCount` | Recomputed from `PUBLISHED` reviews       | Nothing                 | One SQL statement under the provider row lock, in the transaction that changed a review.                                                                                                                                                                 | Integration (mean, 12 concurrent reviews, rollback), Browser (exact mean over three bookings; hide and restore). |
| `completedJobs`            | Recounted from `COMPLETED` bookings       | Nothing                 | In the completion transaction, under the provider row lock.                                                                                                                                                                                              | Integration (6 concurrent completions), Browser.                                                                 |
| Audit trail                | Server                                    | Nothing                 | Written in the same transaction; metadata limited to an allow-list (`reviewId`, `bookingId`, provider profile id; for moderation also the moderator's reason, which is the only lasting record of it once a review is restored). Never the comment text. | Integration, Browser.                                                                                            |

## Lock order

Everywhere reputation changes: the booking row first, then the provider
profile row. Submission, completion and moderation all take the provider row
before recomputing, so two of them for one provider run one after the other.

## Transaction boundaries

| Operation        | In one transaction                                                         |
| ---------------- | -------------------------------------------------------------------------- |
| Submit           | lock booking, check, insert review, lock provider, recompute rating, audit |
| Complete booking | status change, booking event, lock provider, recount completed jobs        |
| Hide / restore   | lock provider, conditional state change, recompute rating, audit           |

A failure at any step leaves none of it. Proven with a temporary PostgreSQL
trigger that fails the provider update: the review is not kept.

## What each reader sees

| Reader                                                                 | Sees                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The author, on their booking                                           | Their rating, comment, state (`PUBLISHED` or `HIDDEN`), time. Never the moderator, never the reason.                                                                      |
| Anyone who sees a provider card (bids, booking detail, public preview) | `ratingAvg`, `reviewCount`, `completedJobs` only. No review text, no reviewer.                                                                                            |
| The provider                                                           | The same three numbers. No list of reviews in R11.                                                                                                                        |
| An administrator with `reviews:read`                                   | Review id, booking id, provider id and display name, the author's user id, rating, comment, state, hidden time and reason. No seeker name or contact details, no address. |

## Client behaviour that depends on ordering

| Case                                                     | Behaviour                                                                                                       | Proof                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| A read asked before the acknowledgement answers after it | The in-flight read is cancelled before the acknowledgement is written to the cache; the prompt does not return. | Unit (fails without the guard). |
| A refetch answers while the sheet is open                | The draft is kept.                                                                                              | Unit.                           |
| Booking A's answer arrives while booking B is on screen  | Written to A's cache key only; B stays unreviewed with an empty draft.                                          | Unit.                           |
| The screen is mounted again for another booking          | Empty draft.                                                                                                    | Unit.                           |
| Another user signs in before the answer                  | The answer is discarded.                                                                                        | Unit.                           |
| Submit pressed several times                             | One request.                                                                                                    | Unit.                           |
| The request fails                                        | Rating and comment are kept; nothing is shown as saved.                                                         | Unit, Browser (offline).        |
| The answer is lost after the server saved                | The client asks the server and shows the saved review; one row exists.                                          | Browser.                        |
| The session ended                                        | Nothing is saved, nothing is shown as saved.                                                                    | Unit, Browser.                  |
