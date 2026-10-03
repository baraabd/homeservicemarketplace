# R12 — Booking communication and job actions

Status: **ACCEPTANCE BLOCKED.** The implementation and local evidence are
complete. Readiness is blocked by owner decisions and an external dependency
gate; see section 6.

## 1. Identities

| Item                        | Value                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration base            | `develop` @ `21b98b7262c2dc6b7bf815cd8155c9a3d678cb3f`, the R11 merge (#130). Its tree is identical to the accepted R11 head `32e0f4d`.                   |
| R12 branch                  | `feat/r12-booking-communication-job-actions`                                                                                                              |
| Historical preparation head | `f9805b38807a9e40d54d7b50553acfe36b2f74a7`, kept as the local ref `backup/r12-pre-integration-f9805b3`                                                    |
| Integration                 | Ordinary merge commit `1333ce6`. It brings in only the R11 merge commit, with no content change. No R11 change was replayed and nothing was force-pushed. |
| Final head                  | Recorded in the pull request. A commit cannot contain its own hash.                                                                                       |
| Prerequisite                | R05 recovery, PR #131 (`fix/r05-first-hydration-edits`, `083bf5c`), Draft                                                                                 |

## 2. Historical preparation (before R11 merged; superseded where noted)

R12 was first prepared on top of the unmerged R11 head. That work:

- connected Message to the booking conversation;
- made Call and Progress honest;
- removed fabricated chat state;
- bound each conversation route family to its own side.

Its evidence was local only and was recorded against the working tree before
`f9805b3`. It does not certify the current head. Two statements from that
period are superseded:

- "Seeker replies appear on reopen or reload; message send is not idempotent
  (deferred to R17)". Both gaps are now closed in R12; see section 3.
- "R05: the stored name was sent / the typed name was sent". The session log
  held both readings. Correlating the evidence settled it; see section 5.

## 3. What R12 changes (current)

### API

- **Side binding.** `/v1/me/conversations` acts for the SEEKER side only and
  `/v1/provider/conversations` for the PROVIDER side only. This applies to
  open, list, read, send and mark-read. Before this, a provider refused on the
  provider routes (`ManageBookings`) could open and post through `/v1/me`.
  Four real-database tests reproduced that before the repair.
- **Message send recovery.**
  - The send request takes an optional `SendMessageRequest.idempotencyKey`:
    16–128 characters from `[A-Za-z0-9_-]`, following the R07 request-key
    convention.
  - The participant check runs first, so a key grants nothing.
  - A stored message from the same sender under the same key is returned with
    `replayed: true`.
  - The same key with a different body is refused: 409
    `IDEMPOTENCY_KEY_REUSED`.
  - Concurrent sends with one key race on the unique index; the loser reads
    the winner's row.
  - Any other database error is rethrown, not turned into success.
- **Migration `20261004090000_r12_message_send_idempotency`** (additive).
  - Adds a nullable `Message.idempotencyKey`.
  - Adds a unique index on `(conversationId, senderUserId, idempotencyKey)`.
  - NULLs are distinct in a unique index, so existing rows and keyless clients
    are unaffected.
- **Realtime room.**
  - Joining `conversation:{id}` now needs exactly what the REST read needs: a
    provider-side participant must hold `ManageBookings`.
  - Both participants still share the room.
  - On the existing provider-status event, sockets leave the rooms they joined
    as the provider. Rooms joined as a customer are kept.
  - The gateway stays off by default.

### Web

- **Message:**
  - Message on the seeker's booking and on the provider's accepted booking
    opens the conversation the server resolves.
  - Opening is guarded per booking, per press and per session.
- **Call and Progress:**
  - Call says it is not available and points to Message.
  - Progress shows the recorded timeline. Its current step is the last one
    reached.
- **Message send:**
  - Each logical send carries one key.
  - Sending a failed message again unchanged reuses its key, for both seeker
    and provider.
  - Pending bubbles are no longer dropped because some server row has the same
    text, so identical messages stay distinct.
  - The acknowledged row is placed in the cache by its id.
- **Open chat:** the seeker's chat reads the conversation again every 4 s
  while visible. This reuses the provider thread's existing cadence. It stops
  when the chat closes or is hidden, or after a read error.
- **Fabricated state removed:**
  - the "Online" presence label;
  - the constant unread badge;
  - buttons that did nothing;
  - the "coming soon" footer;
  - the "sent" check on a message the server had not yet acknowledged.

## 4. Evidence on the current source (local)

**Source under test.** The branch head `1333ce6` plus the uncommitted R12
recovery changes, captured as git tree
`2db255903d77c77afe27e6ea904c7a70aa2c29a7`. The commit that follows contains
that tree plus these documents and the model-migration index entry. Hosted
runs for the final head are recorded in the PR.

**Environment.** Throwaway PostgreSQL and Redis containers. The user's
development containers and other worktrees were not touched.

**How results were taken.** Each result is the test runner's own exit code
with its full log saved. Logs were filtered for display only after saving.

| Gate                                                          | Command                                                                                                                                                                                               | Result                                                                                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R12 integration (real PostgreSQL)                             | `RUN_DB_INTEGRATION=1 jest test/integration/r12-booking-communication.integration.spec.ts`                                                                                                            | 35/35 (exit 0)                                                                                                                                                  |
| Mutation check: realtime capability                           | The same suite with `-t realtime`, with the gate's capability check removed                                                                                                                           | 2 failed, as expected (exit 1); file restored                                                                                                                   |
| Full gated API suite on a fresh, migrated and seeded database | `jest --shard=N/6 --maxWorkers=3`, N=1..6                                                                                                                                                             | 5153 passed, 37 skipped, 1 failed: `restricted-erasure.spec.ts` ENOTDIR (Windows-only, pre-existing)                                                            |
| Conversation and realtime unit + e2e                          | `jest src/modules/realtime src/modules/conversations test/e2e/*conversations*`                                                                                                                        | 113/113 (exit 0)                                                                                                                                                |
| Web unit                                                      | `pnpm --filter @homeservicemarketplace/web test:ci`                                                                                                                                                   | 188 files, 2336 tests (exit 0)                                                                                                                                  |
| R12 browser                                                   | `playwright test e2e/r12-booking-communication.real-api.spec.ts --workers=1 --retries=0`                                                                                                              | 5/5 on two consecutive runs (exit 0 each)                                                                                                                       |
| R11, R07 and R05 browser                                      | Same options                                                                                                                                                                                          | 5/5, 1/1, 2/2 (exit 0 each)                                                                                                                                     |
| Migration                                                     | `r12-migration-acceptance.sh`: replay from empty, and upgrade from the 64 pre-R12 migrations with existing messages                                                                                   | No drift. Existing messages unchanged with NULL keys; identical messages both kept. A reused key is refused for the same sender and allowed for another sender. |
| Static and governance                                         | Web lint (0 errors); web typecheck and e2e typecheck; API lint and typecheck; `prisma validate`; `production-governance.mjs`; `release-baseline.mjs`; `verify-inventory.mjs`; script tests (79/10/15) | All exit 0                                                                                                                                                      |
| Dependency audit                                              | `pnpm security:audit` and `security:audit:prod`                                                                                                                                                       | Full tree: **1 high** (exit 1). Production: 0 (exit 0). See section 6.                                                                                          |

**Visual review:**

- the seeker's open chat showing the provider's reply, which arrived without
  reopening (390 px);
- the seeker's chat before the reply;
- the existing Arabic action and chat screenshots at 360, 390 and 430 px.

No trace or video was recorded.

## 5. R05: the hypothesis resolved

**The one failing run** (account `r05-1790990712929-431787@itest.local`):

- The failed assertion was the PATCH payload check; the diff lists only the
  five intended fields.
- The API log shows a single `PATCH /v1/me/profile` (200) and no later request
  from that test.
- The screenshot shows the registration name in Full Name beside the typed
  phone, city and bio, with "Saved successfully".
- The save-timeline attachment was not retained (UNAVAILABLE).

**The defect, demonstrated.** The editor treated the first profile answer as
an account switch. A name typed while the profile was still loading was
overwritten. Tests I and J fail on untouched `21b98b7`.

**The repair** is PR #131, kept separate from R12. R12's branch does not
contain it. R12's own R05 run here passed 2/2, but the race remains possible
on R12 until #131 merges.

## 6. Blockers

1. **External dependency advisory, on develop and on every PR.**
   - GHSA-vfj7-8cjw-p6xm: `braces` ≤3.0.3, high. There is no patched version
     (`first_patched_version: null`; advisory updated 2026-10-02 22:36Z).
   - It is reached only through test tooling (`micromatch@4.0.8` under jest
     29 and `@types/jest`). The production audit is clean.
   - Develop's post-merge CI for `21b98b7` (run 37102002731) failed only at
     "Full dependency audit (ZERO findings at every severity)". The other five
     workflows passed.
   - The audit policy allows no exceptions. Nothing was weakened, excluded or
     waived. **Owner decision required.**
2. **Product policy, owner decision required.** The calling model is
   UNRESOLVED. R12's original acceptance asks for "honest approved Call
   behaviour". The current state is honest ("not available, use Message") but
   not approved.
3. **Prerequisite.** R05 recovery PR #131 is unmerged.
4. **Hosted acceptance for the final head.** Pending, and expected to fail at
   the audit step while blocker 1 stands.

**Optional future features (not blocking R12):**

- messaging rules by booking status;
- chat before a booking exists;
- richer progress events;
- per-message read receipts;
- live sockets in production.

## 7. Known limitations

- **Polling, not live delivery.** The open-chat refresh is a 4 s poll. The
  cadence is an engineering default (PROPOSED).
- **Realtime eviction is event-driven.** It relies on the existing
  provider-status event. A loss of booking access that emits no event is
  enforced only at the next subscribe or reconnect, not on sockets already
  joined. An example is a work-access grant lapsing while
  `WORK_ACCESS_ENFORCED` is on. The gateway is off in every deployed
  configuration.
- **Message send keys are optional.** A client that omits them keeps the old
  behaviour.

## 8. Rollback

- **Web:** revert the web commits. The API stays compatible.
- **API:** reverting the side binding re-opens the route-family bypass.
  Reverting the realtime check re-opens the room bypass.
- **Migration:** additive. The nullable column and its index can stay in
  place unused. Forward fixes use new migrations.
