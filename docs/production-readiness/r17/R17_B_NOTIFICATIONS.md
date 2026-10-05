# R17-B — Notification lifecycle and delivery consistency

Status: **R17_B_IN_PROGRESS** until exact-head hosted acceptance is recorded in
the PR. Base: `develop@e1f7f5148c72743542ac6fab23b02646ef20573e` (R17-A merged
as #142), tree `6f4ec93c936daa0ac494e36273835e352a57e761`. Toolchain: Node
24.21.0, pnpm 10.32.1, Prisma 5.22.0.

Policy: `R17_B_NOTIFICATION_POLICY.md`. Paths and evidence:
`R17_B_NOTIFICATION_AUTHORITY_MATRIX.md`.

## B-1…B-10

| ID   | Finding (register)                                                | Result                                                                                                                              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1  | `createForUser` published while the caller's transaction was open | **REPRODUCED_DEFECT → FIXED**                                                                                                       | integration: inside an open transaction the in-process bus already held `notification.created` (actor bob), so a rollback left a phantom announcement. Fixed: row + outbox event in one transaction; `NotificationCreatedHandler` publishes after commit. Real Socket.IO client across replicas: an action rolled back after its row was written is never announced; the committed one arrives once, with its actor. |
| B-2  | read-all unbounded                                                | **REPRODUCED_DEFECT → FIXED**                                                                                                       | integration: read-all of 3 shown rows flipped 4 (the one that arrived after the list); a row whose transaction committed after the list was also flipped; bodyless call → 200 marking everything. Fixed: explicit ids (1–100) bound to owner, live, unread, experience; bodyless → 400. Browser: a notification produced through replica B while the drawer was open stayed unread after "Mark all read".            |
| B-3  | seeker client sent no experience                                  | **REPRODUCED_DEFECT → FIXED**                                                                                                       | web: read-all sent `{ params: {}, body: {} }`. Fixed: seeker list, count and read-all send `experience=seeker`. Browser: a provider-and-customer account sees none of its provider notifications in the seeker app (0 unread) and both in the provider app (2 unread).                                                                                                                                               |
| B-4  | scope holes for dispute notices                                   | **REPRODUCED_DEFECT → FIXED (projection)**; admin-dispute deep link **OUT_OF_SCOPE_WITH_OWNER (R17-C)**                             | integration: the intake notice (`resourceType` null, `/disputes/…`) was in no participant scope — and would have vanished from the seeker drawer once B-3 scoped it. Fixed in the scope projection (dispute notices in both participant experiences). The legacy admin-dispute producer writing `/home/bookings/…` for a provider opener belongs to R17-C's legacy-dispute work.                                     |
| B-5  | failed fetch shown as empty inbox / zero badge                    | **REPRODUCED_DEFECT → FIXED** (seeker drawer, profile page, seeker badge, provider bell label); provider drawer **ALREADY_CORRECT** | web: on the baseline the failed load showed no error and the bell drew "1" from the loaded page; the provider drawer already showed its error (its test passed on the baseline). Browser: aborted list read → "Couldn’t load notifications." + Try again → list.                                                                                                                                                     |
| B-6  | no Notification-level dedupe identity                             | **EVIDENCE_ADDED; ALREADY_CORRECT**                                                                                                 | rows are created only inside a business or handler transaction; announcements are deduplicated by `dedupeKey` and the `OutboxHandlerRun` marker. Integration: re-delivered event announced once; reclaimed lease announced once. No body/time dedupe. Remaining client-retry risk sits with each producer's own transition guard (e.g. booking start is conditional).                                                |
| B-7  | reviewer reasons in notification bodies                           | **REPRODUCED_DEFECT → FIXED**; suspension-reason visibility **POLICY_BLOCKED**                                                      | unit: reject/suspend bodies contained "Internal note: … ticket 4411". Fixed to the existing generic copy; the reason stays in the audit record and (rejection) on the provider's onboarding screen.                                                                                                                                                                                                                  |
| B-8  | settings toggles local-only                                       | **REPRODUCED_DEFECT (false controls) → FIXED by removal**; channel preferences **POLICY_BLOCKED**                                   | four switches changed only screen memory (push/SMS default "on"); replaced by a true statement. No channel or consent was enabled or inferred.                                                                                                                                                                                                                                                                       |
| B-9  | admin badge = page length; no admin producer                      | badge **REPRODUCED_DEFECT → FIXED** (server count, `99+` display cap); admin producers **POLICY_BLOCKED**                           | unit (count 130 → "99+" from `/unread-count?experience=admin`); browser: admin bell count equals the database, empty inbox shown honestly.                                                                                                                                                                                                                                                                           |
| B-10 | session/cache isolation                                           | **EVIDENCE_ADDED; ALREADY_CORRECT**                                                                                                 | `clearAuthSession` cancels queries and removes every non-auth query on login completion, logout, expiry, credential reset and cross-tab sign-out. Browser: sign out through Settings, sign in as another user in the same tab → none of the first user's notifications or count.                                                                                                                                     |

## Root causes and remediations

1. **B-1** — `createForUser` called `realtime.publishFor` synchronously after
   the INSERT, inside the caller's transaction. Remediation: the same
   transaction now enqueues `notification.created` (dedupe key per
   notification); `NotificationCreatedHandler` re-reads the live row and
   publishes in `afterCommit`. Without a caller transaction the service opens
   one, so row and event never commit apart. The service no longer injects the
   publisher. Cost: live delivery waits for an outbox poll (default 2 s).
2. **B-2** — `markAllReadOwned` updated every unread row matching the scope at
   request time. Remediation: required `ids`, conditions in one `updateMany`.
3. **B-3** — the seeker client omitted `experience`. Remediation: always send it.
4. **B-4** — the scope projection recognized dispute notices only by
   `resourceType DISPUTE`. Remediation: also `/disputes/` links.
5. **B-5/B-9** — components rendered `items.length === 0` as empty regardless of
   query state, and badges fell back to loaded rows. Remediation: explicit
   loading/error/stale states, server counts only.
6. **B-7** — reject/suspend interpolated `reason` into the body.
7. **B-8** — switches backed by `useState` only.
8. **Arabic drawer and toast (found by the browser evidence)** — the seeker
   drawer's own labels were English-only, and in RTL the arrival toast was cut
   off: Sonner sets `right` on narrow screens, and with `left`, `right` and
   `width` set CSS honours `right` under RTL, so our centring translate pushed
   the list half its width off-screen (left edge −180 px at 360 px). Labels
   localized; `right: auto` in `.hsm-toaster-shell`.

## Platform finding (not fixed here): PLATFORM-TX-1

With Prisma 5.22.0, an interactive `$transaction` whose **COMMIT** fails is
logged (`prisma:error transaction failed to commit`) and the promise still
**resolves**. Reproduced three times with a deferred constraint trigger: the
callback result was returned, zero rows committed. Through HTTP:
`POST /v1/provider/bookings/:id/start` answered 200 while the booking stayed
`SCHEDULED` and no notification existed. The schema has no deferred
constraints, so production exposure is commit-time serialization failures
(SERIALIZABLE transactions), a connection lost during COMMIT, or storage
errors — rare but silent. It affects every `TransactionRunner` caller, not
only notifications. Recorded as a separate prerequisite repair for the owner
(GAP_REGISTER PLATFORM-TX-1); R17-B's transport test therefore injects its
failure at a statement after the notification row, which Prisma does surface.

## Tests

| Suite                                                                                                                                                                                     | Level                                                                                | Count |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----- |
| `apps/api/test/integration/r17-notifications.integration.spec.ts`                                                                                                                         | I (real PostgreSQL, real outbox worker, real publisher bus; JWT/CSRF guards stubbed) | 14    |
| `notifications.service.spec.ts` (updated contract)                                                                                                                                        | U                                                                                    | 19    |
| `admin-verification.service.spec.ts` (+2 R17-B)                                                                                                                                           | U                                                                                    | 30    |
| `HomeScreen.notifications.test.tsx` (+3), `ProviderNotifications.test.tsx` (new, 4), `SettingsPage.test.tsx` (new, 1), `notifications-api.test.ts`, `AuditLogsSection.test.tsx` (updated) | U                                                                                    | —     |
| `apps/web/e2e/r17-notifications.real-api.spec.ts`                                                                                                                                         | B, X, T                                                                              | 5     |

Failing-before runs on the untouched baseline: integration 11/14 failed (the
3 passing cover behaviour that was already correct); web 3/3 and 4/5 failed
for the stated reasons; admin-verification 2/2 failed; Arabic toast at 360 px:
left edge −180.

## Files

API: `notifications.service.ts`, `notification-created.handler.ts` (new),
`notifications.module.ts`, `notifications.controller.ts`,
`dto/mark-all-notifications-read.dto.ts` (new), `notification.repository.ts`,
`outbox.tokens.ts` (+`NOTIFICATION_CREATED`), `app.module.ts` (handler
registration), `admin-verification.service.ts`.
Contracts: `seeker/notifications/request/mark-all-notifications-read.request.ts`
(new) + barrel, response comment.
Web: seeker `notifications-api.ts`, `useNotifications.ts`, `HomeScreen.tsx`,
`NotificationDrawer.tsx`, `ProfileTab.tsx`, `SettingsPage.tsx`; provider
`provider-notifications-api.ts`, `useProviderNotifications.ts`,
`ProviderNotifications.tsx`; admin `admin-audit-logs-api.ts`,
`useAdminAuditLogs.ts`, `AdminNotificationsBell.tsx`; `toast-theme.css`.
CI: `phase5-real-api` — stop the job API, R17-B step, artifact
`r17-b-notifications-evidence`.

No schema change, no migration, no feature flag, no permission.

## Known limitations

- Read-all no longer clears unread rows beyond the loaded page (decision 1).
- Server notification text is English (decision 4).
- Verification-case notifications are still not pushed live (unchanged; they
  arrive by polling).
- Live announcements are best effort after commit; a crash between the
  worker's commit and its push loses the push only.
- PLATFORM-TX-1 is open.

## Rollback

Revert the PR, web and API together: an older API refuses the new `ids` body
(400, unknown field), and the new API refuses an older client's bodyless
read-all (400).
Outbox rows of type `notification.created` left by the new version would have
no handler after a rollback and would dead-letter: before rolling back, let the
queue drain, or delete pending `notification.created` events (they only
announce rows that are already in the inbox).
