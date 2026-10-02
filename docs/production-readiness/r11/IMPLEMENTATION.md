# R11 — Reviews, ratings and reputation authority

Status: **IMPLEMENTED, PENDING MERGE.** This document describes what the branch
`feat/r11-reviews-ratings-reputation-authority` changes and the evidence gathered
for it. Hosted exact-head results are recorded in the pull request, not here.

Baseline and merge base: `origin/develop` @
`0d9485b5ac9b52f82265705320367e6a811f19a1` (R10 merged).

Policy: [REVIEW_POLICY.md](REVIEW_POLICY.md). Authority and proof per fact:
[REVIEW_AUTHORITY_MATRIX.md](REVIEW_AUTHORITY_MATRIX.md).

## What was wrong

- **Submit Review on the job screen sent nothing.** It set a flag in component
  state. The comment box was uncontrolled and never read. A reload asked for
  the review again. No review model existed in the schema.
- **Provider reputation had no production writer.** `ratingAvg`,
  `reviewCount` and `completedJobs` on `ProviderProfile` came only from the
  seed or from column defaults, yet bids, booking detail, the public profile
  preview, the admin directory and the service-area expansion check all read
  them.
- **Fabricated figures were shown as facts.** A provider with no reviews
  rendered as "0.0" with five empty stars. The seeker's own profile showed a
  hard-coded "4.9 · 12 jobs posted".
- **The rating sheet was not accessible.** It had no dialog role, no labels,
  no keyboard operation and no focus management.

## What R11 adds

### Database (additive migration `20261003090000_r11_booking_reviews`)

- A `BookingReview` table: one row per booking, enforced by a unique
  `bookingId`. A composite foreign key `(bookingId, seekerUserId, providerId)`
  points to `Booking(id, seekerUserId, providerId)`, so a review can only name
  the booking's real participants. It is `ON DELETE RESTRICT`.
- CHECK constraints:
  - `booking_review_rating_in_range`: 1–5.
  - `booking_review_comment_bounded`: NULL, or 1–2000 characters.
  - `booking_review_hidden_is_explained`: a hidden review carries a time, an
    actor and a reason.
- Enum `BookingReviewState` with values `PUBLISHED` and `HIDDEN`.
- Three audit event types.
- Backfill: every provider's rating and review count are set to zero, and
  `completedJobs` is recounted from `COMPLETED` bookings. The seed no longer
  writes reputation figures. The seed grants `reviews:read` and
  `reviews:moderate`, which administrators receive along with every other
  permission.

### API

- `ReviewsModule` serves the endpoints listed in the authority matrix.
- **Submission**, in one transaction:
  1. lock the caller's own booking;
  2. replay or refuse an existing review;
  3. require `COMPLETED`;
  4. refuse a self-review;
  5. insert the review;
  6. lock the provider row;
  7. recompute the rating from source rows;
  8. audit.
     A lost unique-key race is resolved by reading the winner, and that handling
     is limited to the `bookingId` unique violation.
- **Completion** recounts `completedJobs` in the same transaction as the
  status change.
- **Moderation** hides or restores with a conditional update and a recompute.
  It requires a fresh permission check and a recorded reason.

### Web

- **`JobDetailView`** shows what the server says about the booking's review:
  - a prompt while the booking can be reviewed;
  - the saved review once it has been, with a note if it was hidden;
  - a read failure with a retry.
    "Reviewed" is never a local flag.
- **The rating sheet** (`BookingReview.tsx`):
  - is a modal dialog: it takes focus, keeps focus inside, closes on Escape
    and returns focus to the prompt;
  - offers the five stars as a radio group, with arrow keys that follow the
    reading direction;
  - has a labelled 16 px comment field limited to 1000 characters, and 44 px
    or larger targets;
  - shows pending and error states and keeps the draft when sending fails;
  - announces success through a live region.
- **Ordering safety** (`useBookingReview.ts`,
  `useBookingReviewController.ts`):
  - state is keyed by booking;
  - an outcome is applied only to the booking it was sent for, and only for
    the same signed-in user;
  - an in-flight read is cancelled before the acknowledgement is cached;
  - after a lost reply the client asks the server rather than guessing.
- **`ProviderRating`** shows "No reviews yet" instead of a zero rating. It is
  used on the booking card and on bid cards; the bid comparison table shows
  "—". The fabricated "4.9 · 12 jobs posted" was removed from `ProfileTab`.
- **Shell repair, found by the R11 keyboard test:**
  - **What broke:** the application shell (`Root.tsx`) and the home content
    area (`HomeScreen.tsx`) were `overflow: hidden` containers holding panels
    parked off screen (the closed request wizard, the bids panel). Keyboard
    focus could therefore scroll them, sliding the whole app up by 150 px
    with no way back. At 360×640 this pushed the review sheet's heading off
    screen.
  - **The fix:** both containers are now `overflow: clip`, which clips the
    same way but can never be scrolled.
  - **Proof:** the real-browser test asserts that no ancestor of the sheet is
    scrolled.

### Not changed

There is no public or provider-facing review list, no reviewer identity
display, no notification and no administrator screen; see the policy's
"NOT IN R11". Ranking code is unchanged. It now reads real numbers.

## Evidence (local; tested on the branch's working tree before commit)

Throwaway PostgreSQL 16 and Redis in containers on ports 15437 and 16387. The
user's development containers were not used.

| Gate                                               | Command                                                                                                                                                                  | Result                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R11 integration (real PostgreSQL)                  | `RUN_DB_INTEGRATION=1 jest test/integration/r11-reviews-reputation.integration.spec.ts`                                                                                  | 62/62, three consecutive runs                                                                                                                                                                                |
| Full API suite, fresh migrated and seeded database | `RUN_DB_INTEGRATION=1 jest --shard=N/6 --maxWorkers=3`, N=1..6                                                                                                           | 5111 passed, 37 skipped, 1 failed: `restricted-erasure.spec.ts` "does not flatten a directory or ENOTDIR storage error", the known Windows-only failure (reproduced on untouched develop in earlier sprints) |
| Provider bookings unit                             | `jest src/modules/provider/bookings`                                                                                                                                     | 21/21                                                                                                                                                                                                        |
| Web unit                                           | `pnpm --filter @homeservicemarketplace/web test:ci`                                                                                                                      | 184 files, 2307 tests passed                                                                                                                                                                                 |
| R11 web unit, ordering                             | `vitest run BookingReview.test.tsx`                                                                                                                                      | 23/23; the stale-read test fails when the cancel guard is removed (checked)                                                                                                                                  |
| R11 real browser                                   | `playwright test e2e/r11-reviews-reputation.real-api.spec.ts --workers=1 --retries=0`                                                                                    | 5/5 on two consecutive full runs after the shell fix                                                                                                                                                         |
| R05 real browser                                   | `r05-seeker-durability.real-api.spec.ts`                                                                                                                                 | 2/2                                                                                                                                                                                                          |
| R07 real browser                                   | `r07-request-provider-lifecycle.real-api.spec.ts`                                                                                                                        | 1/1                                                                                                                                                                                                          |
| R08 real browser                                   | `r08-provider-v2-all-field-authority.real-api.spec.ts`                                                                                                                   | 14/14                                                                                                                                                                                                        |
| R09 real browser                                   | `r09-work-area-geo-authority.real-api.spec.ts`                                                                                                                           | 18/18                                                                                                                                                                                                        |
| R10 real browser                                   | `r10-working-hours-schedule-durability.real-api.spec.ts`                                                                                                                 | 17/17                                                                                                                                                                                                        |
| Provider V2 real browser                           | `provider-onboarding-v2-real-api` + `provider-onboarding-v2-persistence`                                                                                                 | 26/26                                                                                                                                                                                                        |
| Provider repairs real browser                      | `provider-onboarding-repairs.real-api.spec.ts`                                                                                                                           | 8/8                                                                                                                                                                                                          |
| Migration: replay from empty                       | `prisma migrate deploy` then `migrate diff --exit-code`                                                                                                                  | all applied, no drift                                                                                                                                                                                        |
| Migration: upgrade                                 | 63 pre-R11 migrations, data copied from the acceptance database (29 bookings created through the API, 99 providers) with seeded figures restored, then the R11 migration | no drift; bookings byte-identical; no provider keeps a rating or review count; `completedJobs` equals the count of COMPLETED bookings for every provider                                                     |
| Static                                             | API lint and typecheck, web lint (0 errors; warnings are existing ones) and typecheck, e2e typecheck, `prisma validate`                                                  | pass                                                                                                                                                                                                         |
| Governance                                         | `production-governance.mjs`, `release-baseline.mjs`, `verify-inventory.mjs`, the three `.github/scripts/*.test.mjs`                                                      | pass (79, 10 and 15 tests)                                                                                                                                                                                   |

Not R11: `phase3-v2-journey.real-api.spec.ts` fails one test (it looks for a
"Submit application" button that the hub no longer shows). It fails the same
way on the R10 source (`546e3f2`), and no CI job runs it.

Visual review: the Arabic sheet at 360, 390 and 430 px and the saved review at
360 px (Arabic) and 390 px (English) were inspected. The screenshots are
attached to the R11 browser report. They hold synthetic data only. No trace or
video is recorded.

## Shared files modified

- `packages/database/prisma/schema.prisma`, a new migration, and
  `packages/database/src/seed.ts`.
- `packages/contracts`: `seeker/index.ts`, `admin/index.ts`, and the new
  `reviews` folders.
- `apps/api/src/app.module.ts`: registers `ReviewsModule`.
- `apps/api/src/modules/iam/audit/audit.service.ts`: two allow-listed
  metadata keys.
- Bookings: `booking.repository.ts` and `provider-bookings.service.ts`, for
  the completed-jobs recount.
- `.github/workflows/ci.yml`: the R11 step and artifact in the existing
  Phase 5 real-route job.
- `apps/web/src/app/Root.tsx` and `HomeScreen.tsx`: the overflow repair.
- `docs/production-readiness/baseline/MODEL_MIGRATION_INDEX.json`: the new
  model.

## Security alerts open on develop at R11 time

Read from the code-scanning API on 2026-10-03, for `refs/heads/develop` at
`0d9485b`. None of them is in review or reputation code, and R11 neither
dismisses nor waives any of them. They remain release blockers to be
dispositioned by their owners. That an alert predates R11 does not make it
acceptable.

| #   | Severity | Rule                                          | Location                                                                | Opened     |
| --- | -------- | --------------------------------------------- | ----------------------------------------------------------------------- | ---------- |
| 3   | critical | js/type-confusion-through-parameter-tampering | `apps/api/src/infrastructure/storage/local-disk-storage.adapter.ts:285` | 2026-08-22 |
| 1   | high     | js/polynomial-redos                           | `apps/api/src/modules/admin/settings/admin-settings.service.ts:333`     | 2026-08-22 |
| 2   | high     | js/xss-through-dom                            | `apps/web/src/app/components/wizard/JobWizardModal.tsx:916`             | 2026-08-22 |
| 4   | high     | js/user-controlled-bypass                     | `apps/api/src/modules/provider/provider.service.ts:227`                 | 2026-08-22 |
| 5   | high     | js/remote-property-injection                  | `apps/api/src/modules/admin/settings/admin-settings.service.ts:95`      | 2026-08-22 |
| 13  | medium   | js/http-to-file-access                        | `apps/web/e2e/assets/vendor-prototype-assets.mjs:91`                    | 2026-09-09 |
| 16  | medium   | js/http-to-file-access                        | `.github/scripts/pr-acceptance.mjs:194`                                 | 2026-09-27 |
| 20  | medium   | js/http-to-file-access                        | `apps/api/src/infrastructure/storage/local-disk-storage.adapter.ts:134` | 2026-10-01 |

The repository's merge policy gates on the CodeQL job, not on the alert count.
Whether the open alerts block a release is an owner decision; R11 does not
make it.

## Known limitations

- Rating 1–5, the 1000-character comment limit, NFC normalisation, the 10–500
  character moderation reason and the permission names are engineering
  defaults (PROPOSED in the policy), not product decisions.
- Service-area expansion now reads real reputation, so providers who
  qualified only through seeded figures no longer qualify until they earn
  reviews. This is confirmed policy, flagged for awareness.
- Constant marketing figures on the seeker home screen and the demonstration
  fixtures in `EcosystemContext.tsx` remain. They are not reputation; see the
  policy.

## Rollback

Revert the merge commit. The migration is additive: the table, enum and
audit-type values can stay in place unused. The backfilled reputation columns
cannot be restored to the seeded figures. Those figures were never real data,
and restoring them would bring the fabricated reputation back. The forward fix
for any defect is a new migration, never an edit to an applied one.
