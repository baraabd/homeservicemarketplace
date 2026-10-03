# R12 — Booking communication and job actions

Status: **PREPARED — AWAITING R11 MERGE AND FINAL INTEGRATION ACCEPTANCE.**

## Execution mode and identities

R12 was prepared on a branch that depends on R11 (mode B of the 2026-10-03
handoff). R11 was accepted on its exact head but is not merged.

| Item                      | Value                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent                    | R11, PR #130, head `32e0f4d3d2509dfe2be0671bf7cc05e0862370cb`. All six workflows were green on that head on the first attempt, with no open code-scanning alerts on the PR ref. |
| Accepted develop baseline | `0d9485b5ac9b52f82265705320367e6a811f19a1` (R10 merged)                                                                                                                         |
| R12 branch                | `feat/r12-booking-communication-job-actions`, branched from the R11 head                                                                                                        |
| R12 PR                    | none                                                                                                                                                                            |

There is no R12 PR on purpose. Production governance runs only for PRs that
target `develop` or `main`, and a develop PR opened now would bundle R11 and
R12. The focused R12 PR is opened after R11 merges, once R12's own commits sit
on the accepted develop.

All evidence below is **local preparatory evidence for R12's source**. None of
R11's green CI is R12 evidence. R12 has no hosted acceptance yet.

## What was wrong

- **The booking screen's Message button did nothing.** It was disabled with
  "Coming soon", and its handler was a no-op. The backend conversation
  authority already existed, but no screen ever created a conversation, so
  chat lists only filled when the API was called directly.
- **Call and Track were placeholders promising "coming soon".** No calling
  backend, phone disclosure policy or live location source exists.
- **The two chat route families did not keep to their side (security).**
  `/v1/me/conversations` resolved either side of a booking. A provider refused
  on the provider routes (where `ManageBookings` is required; a suspended
  provider loses it) could still open and post in the booking's chat through
  `/v1/me`. Four integration tests reproduced this before the repair.
- **Fabricated communication state.**
  - "Online" with a green dot, though no presence information exists.
  - A constant `3` unread badge.
  - Video, menu and emoji buttons that did nothing.
  - A message waiting to send showed the same check as a sent one. The R12
    offline browser test found this.
- **The progress timeline misstated a booking's state.** The first step not
  yet reached was labelled "Current status", so a scheduled booking read "In
  Progress". "Pro assigned" depended on a timeline row rather than on the
  booking's existence. The R12 screenshots showed this.
- **The chat input was not accessible.** It had no label, used 14 px text, and
  the send button had no accessible name.

## What R12 changes

### API (no schema, migration or contract change)

- `ConversationsService` takes the side a route acts for. The seeker
  controller passes SEEKER and the provider controller passes PROVIDER.
  - **Listing** matches the caller's participant row of that side.
  - **Opening** looks up only that side's ownership of the booking.
  - **Reading, sending and marking read** require that side's participant
    row. Anything else is 404, exactly as before for strangers.
- The realtime room gate is unchanged. It still admits either side.

### Web

- **`useOpenBookingConversation`** (shared) opens a booking's conversation
  through the server's get-or-create:
  - one request per booking at a time;
  - the answer is used only for the booking still on screen, from the latest
    press, for the same signed-in person, while mounted;
  - "opening" and "failed" states are scoped to the booking.
- **Seeker `JobDetailView`**:
  - Message opens the server's conversation in the existing ChatScreen.
  - Call is disabled, with a described reason.
  - "Track" became **Progress**. It focuses the recorded timeline, and a
    scheduled booking reads "Scheduled".
- **Provider My Bids**: an accepted booking has **Message customer**, which
  opens the same conversation at `/provider/messages/:id`.
- **ChatScreen**:
  - no presence claim;
  - a single honest Call control;
  - pending messages read "Sending…";
  - a labelled 16 px input with a named Send button;
  - `dir="auto"` on message text;
  - the no-op buttons removed.
- **HomeScreen**: the messages badge is the server's unread total. The
  seeker's chat opens from the booking.

## Evidence (local, R12 working tree before commit)

All runs used throwaway PostgreSQL and Redis containers. The user's
development containers were not touched.

| Gate                                                                                                                          | Result                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R12 integration (real PostgreSQL), `RUN_DB_INTEGRATION=1 jest test/integration/r12-booking-communication.integration.spec.ts` | 20/20. Before the repair: 16/20, with the 4 side-binding tests failing                                                                                                                                        |
| Full gated API suite, fresh migrated and seeded database, 6 shards, `--maxWorkers=3`                                          | 5131 passed, 37 skipped, 1 failed: `restricted-erasure.spec.ts` ENOTDIR, the known Windows-only failure                                                                                                       |
| Conversation unit and e2e specs                                                                                               | 106/106 (forwarding assertions extended to the side)                                                                                                                                                          |
| Web unit, `test:ci`, final source                                                                                             | 186 files, 2328 tests passed                                                                                                                                                                                  |
| Ordering guards                                                                                                               | Removing the booking guard or the session guard fails its test (checked)                                                                                                                                      |
| R12 real browser, `--workers=1 --retries=0`                                                                                   | 4/4 on the final source (one full run), after 4/4 on an earlier full run before the last progress fix                                                                                                         |
| R11 real browser                                                                                                              | 5/5                                                                                                                                                                                                           |
| R07 real browser                                                                                                              | 1/1                                                                                                                                                                                                           |
| R05 real browser                                                                                                              | see below                                                                                                                                                                                                     |
| Static                                                                                                                        | API lint and typecheck, web typecheck and e2e typecheck, `production-governance.mjs`, `release-baseline.mjs`, `verify-inventory.mjs` all pass. Web lint: 0 errors, and the 34 existing warnings are unchanged |

### R05: an intermittent failure found, not caused by an R12 change

- **Observed:** one of four runs of `r05-seeker-durability` on the R12 build
  failed. The browser saved the stored "R05 Seeker" instead of the typed full
  name, while the typed phone, city and bio were kept. The first-failure
  screenshot and error context are preserved locally. Six runs on the R11
  build all passed.
- **Probable cause, from the code and the screenshot:** `EditProfilePage`
  resets its "edited fields" record whenever the profile it hydrates from
  belongs to a different account. That test also fires on the very first
  hydration, when the record is still empty. A name typed before the first
  `GET /v1/me/profile` answer arrives is therefore overwritten.
- **Ownership:** R12 does not modify `EditProfilePage` or the profile hooks.
  Whether the R12 build changes the timing enough to expose the race more
  often has not been established.
- **Recommendation:** a small separate R05 repair. Treat the first hydration
  as "seed", not "account switch", and add a failing ordering test first.
- **Status:** R12 does not fix it, because doing so would mix scopes.

### Not run locally for R12

- R08, R09 and R10, and the Provider V2 browser suites. R12 does not touch
  their screens. CI runs them.
- Docker production boot, Compose smoke and the scanners: hosted only.

## Shared files modified

- `apps/api/src/modules/conversations/*` and
  `apps/api/src/infrastructure/persistence/conversations/*`: the side binding.
- `apps/api/test/e2e/conversations.e2e.spec.ts` and
  `provider-conversations.e2e.spec.ts`: forwarding assertions.
- `apps/web/src/app/components/home/JobDetailView.tsx` (shared with R11's
  review UI, which is unchanged and re-proven), `HomeScreen.tsx`,
  `chat/ChatScreen.tsx` and `provider/screens/MyBidsScreen.tsx`.
- `.github/workflows/ci.yml`: one R12 step and its artifact, in the existing
  Phase 5 real-route job.

## Known limitations

- **Message persistence (R17):**
  - message send is not idempotent;
  - the seeker chat neither polls nor subscribes, so a reply appears on
    reopen or reload;
  - there are no per-message delivery or read receipts.
- **Product decisions left open** (see `COMMUNICATION_POLICY.md`):
  - messaging rules by booking status;
  - pre-booking messaging;
  - the calling model;
  - richer progress events;
  - whether the realtime gate should check provider capability.
- **The intermittent R05 editor failure** described above.

## Rollback

Revert R12's commits. No schema, migration or contract change is involved.

Reverting the side binding re-opens the route-family bypass. If only the web
needs rolling back, revert the web commit alone and keep the API repair.
