# R11 — Review policy

Each rule below is marked:

- **CONFIRMED** — decided by the product owner for R11, on 2026-10-03, in
  answer to a direct question. The question and the chosen option are quoted.
- **DERIVED** — follows from existing code or from the R11 brief; the source is
  named.
- **PROPOSED** — an engineering default chosen to make the feature complete.
  Nobody approved it as product policy. It is implemented, it is small, and it
  is listed so that it can be changed deliberately.
- **NOT IN R11** — deliberately absent.

## Who may review, and what

| Rule                                                                                                                              | Status    | Source                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A review is written by the seeker of a booking, about the provider of that booking.                                               | DERIVED   | R11 brief; `Booking.seekerUserId`, `Booking.providerId`.                                                                                                     |
| Providers do not review seekers. No seeker score is stored, computed or shown.                                                    | DERIVED   | R11 brief ("no reciprocal ratings; do not fabricate seeker reputation"). The provider feed's `seeker.rating` stays `null` (`available-requests.service.ts`). |
| A booking can be reviewed when its status is `COMPLETED`. There is no time limit. An open or closed dispute does not change this. | CONFIRMED | "Any COMPLETED booking, no time limit".                                                                                                                      |
| `SCHEDULED`, `IN_PROGRESS` and `CANCELLED` bookings cannot be reviewed.                                                           | CONFIRMED | Same answer.                                                                                                                                                 |
| A user cannot review a booking in which they are also the provider.                                                               | DERIVED   | R11 brief (participant eligibility). Refused with 403 `SELF_REVIEW`.                                                                                         |
| Another user's booking is not found (404), exactly as a missing booking is not found.                                             | DERIVED   | Existing ownership convention; no existence oracle.                                                                                                          |

## One review per booking

| Rule                                                                                                                      | Status    | Source                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| A booking has at most one review. PostgreSQL enforces it (`BookingReview.bookingId` unique).                              | DERIVED   | R11 brief.                                                               |
| Sending the same rating and comment again returns the saved review (HTTP 200, `replayed: true`) and writes nothing.       | CONFIRMED | "Final: no edit, no delete" — "same content retry returns saved review". |
| Sending different content for a reviewed booking is refused (409 `REVIEW_ALREADY_SUBMITTED`).                             | CONFIRMED | Same answer.                                                             |
| A review cannot be edited or deleted by its author.                                                                       | CONFIRMED | Same answer.                                                             |
| A review cannot be deleted by anyone. A booking with a review cannot be deleted from the database (`ON DELETE RESTRICT`). | DERIVED   | Follows from "no delete" and the audit requirement.                      |

## Content

| Rule                                                                                        | Status   | Source                                                                                                |
| ------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| Rating is a whole number from 1 to 5.                                                       | PROPOSED | Matches the existing five-star UI. Enforced by the API and by a database CHECK.                       |
| The comment is optional.                                                                    | DERIVED  | Existing UI ("Add a comment (optional)").                                                             |
| The comment is at most 1000 characters at the API; the database CHECK allows 2000.          | PROPOSED | Engineering default. The wider database bound leaves room to raise the API limit without a migration. |
| The comment is trimmed and normalised to Unicode NFC. An empty comment is stored as `NULL`. | PROPOSED | Makes "same content" a stable comparison for safe retries.                                            |
| A comment is plain text. It is never rendered as HTML, and URLs in it are never fetched.    | DERIVED  | R11 brief.                                                                                            |

## Moderation

| Rule                                                                                                                                   | Status                                                                                         | Source                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A review counts toward reputation as soon as it is saved. There is no approval queue.                                                  | CONFIRMED                                                                                      | "Counts at once; admin can hide/restore".                                              |
| An administrator holding `reviews:moderate` can hide a review, and restore it. A reason of 10–500 characters is required.              | CONFIRMED (hide/restore, recorded reason); PROPOSED (the length bounds, the permission names). | Same answer.                                                                           |
| A hidden review does not count. Restoring it makes it count again.                                                                     | CONFIRMED                                                                                      | Same answer.                                                                           |
| Hiding and restoring are audited (`ADMIN_REVIEW_HIDDEN`, `ADMIN_REVIEW_RESTORED`). Submission is audited (`BOOKING_REVIEW_SUBMITTED`). | CONFIRMED / DERIVED                                                                            | Same answer; existing audit policy.                                                    |
| A provider cannot hide a review of themselves.                                                                                         | CONFIRMED                                                                                      | Same answer.                                                                           |
| Moderation is an API. R11 adds no administrator screen.                                                                                | CONFIRMED                                                                                      | Same answer.                                                                           |
| The author sees that their review was hidden. They do not see the moderator's reason or identity.                                      | PROPOSED                                                                                       | The reason is an internal note (R11 brief: internal moderation notes are not exposed). |
| A hidden review still occupies the booking: the booking cannot be reviewed again.                                                      | DERIVED                                                                                        | "No edit, no delete". Otherwise hiding would become an edit path.                      |

## Reputation

| Rule                                                                                                                                                              | Status    | Source                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------- |
| `ratingAvg` and `reviewCount` are computed only from `PUBLISHED` reviews.                                                                                         | CONFIRMED | "Real data everywhere, including expansion". |
| `completedJobs` is the number of the provider's `COMPLETED`, non-deleted bookings.                                                                                | CONFIRMED | Same answer.                                 |
| The numbers are recomputed from the source rows inside the transaction that changes them. They are never incremented.                                             | DERIVED   | R11 brief ("derived without drift").         |
| The mean is the exact mean of whole-star ratings. Rounding is for display only.                                                                                   | PROPOSED  | Avoids an average of rounded averages.       |
| Seeded demonstration figures are not reputation. The migration resets every provider's rating and review count to zero and recounts completed jobs from bookings. | CONFIRMED | Same answer.                                 |
| A provider with no counted review shows "No reviews yet", not "0.0".                                                                                              | CONFIRMED | Same answer ("honest 'no reviews yet'").     |
| Service-area expansion reads the same real numbers.                                                                                                               | CONFIRMED | Same answer. See the consequence below.      |

### Consequence that needs an owner's eye

Service-area expansion is a privilege gated on reputation. Before R11 the
numbers it read were seed data or defaults; no production code wrote them.
After the R11 migration every provider starts at zero reviews, so a provider
who qualified for expansion only because of seeded figures no longer does
until real reviews accumulate. This is the confirmed policy, stated here so
that nobody meets it by surprise.

## NOT IN R11

- A public or provider-facing list of reviews, and any display of who wrote a
  review. Only the author reads a review back, on their own booking.
- A notification to the provider when a review arrives.
- Provider replies, reporting a review, and appeals.
- An administrator screen for moderation.
- Ranking or search changes. Existing sorting reads the same columns as before;
  what is in them is now real.
- Reciprocal provider-to-seeker ratings.

## Known fabricated figures left in place

These are not reputation and were not touched, but they are numbers shown to
users that no data backs. They are recorded so that they are not mistaken for
R11 output.

- `HomeScreen.tsx`: the marketing tiles "4.9★ Avg Rating", "500+", "~1h" are
  constants.
- `EcosystemContext.tsx`: demonstration fixtures with `seekerRating` and
  `providerRating`.

Removed in R11: the hard-coded "4.9 · 12 jobs posted" under the seeker's own
name in `ProfileTab.tsx`, which was a fabricated seeker reputation.
