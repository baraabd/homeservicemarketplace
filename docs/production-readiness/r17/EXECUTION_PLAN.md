# R17 — Execution plan

Sprint: R17 — current-product communication, notification and admin
completeness (`FUNCTIONAL_COMPLETION_ROADMAP.md` § R17).

## Scheduling decision and R16 boundary

The owner deferred R16's financial implementation while its payout-policy
and funding-authority prerequisites remain unresolved, and authorized
independent, non-financial R17 work. This changes execution order only.

| State                               | Meaning                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `R16_POLICY_BLOCKED`                | `r16/PAYOUT_POLICY.md`: 0 confirmed, 2 proposed, 15 blocked decisions. Unchanged by R17.                              |
| `R16_FUNDING_AUTHORITY_BLOCKED`     | No customer payment, capture or settlement is persisted; no balance traces to funding. Unchanged by R17.              |
| `R17_NON_FINANCIAL_WORK_AUTHORIZED` | R17 may proceed on messaging, notifications, disputes (decision intent only), admin operations and provider surfaces. |

Source of the R16 record: PR #140 (`f5337cf`), merged into develop as
`460b9ee` on 2026-10-05. It is an analysis delivery; R16 is **not**
implemented and its release blocker remains open. R17 does not turn any R16
proposal (for example the "proposed accounting shape") into an approved rule.

Kept disabled throughout R17: the wallet withdrawal CTA (guarded by the
no-write test in `WalletScreen.test.tsx`), and any payout, withdrawal,
reservation, refund, capture or financial event consumer. No R17 unit adds
one, including under "notification" or "dispute" labels.

## Baseline (Gate A)

`develop@460b9eefd8e0eafc5f4aad65a2c03c3ef102ca30`, push runs, attempt 1:

| Workflow                            | Run id      | Result                    |
| ----------------------------------- | ----------- | ------------------------- |
| CI                                  | 37240959063 | success, 17/17 jobs       |
| CodeQL                              | 37240958860 | success                   |
| Production governance               | 37240958867 | success                   |
| Web development startup             | 37240958909 | success (Windows, Ubuntu) |
| Authentication lifecycle acceptance | 37240958924 | success                   |
| Staging release boundary            | 37240958900 | success                   |

Executed counts: web unit 188 files / 2339 tests; API unit 3890 passed,
1370 skipped (DB-gated, run in the integration job); integration 5227 passed,
33 skipped; Playwright 821 passed, 298 skipped (conditional). Tracked-tree
secret scan of `460b9ee`: 2083 files, no leaks; the history-mode push scan
covered 0 commits (known scope gap, not adequate on its own).

Security (not cleared by a green workflow): 8 open CodeQL alerts on develop —
#3 critical, #1 #2 #4 #5 high, #13 #16 #20 medium. R17 touches the paths of
#1 and #5 (admin settings, R17-D) and #4 (provider profile, R17-E); see
`GAP_REGISTER.md`. `develop` has no branch protection.

## Units

| Unit  | Branch                                  | Scope                                                         | Order | State                                                        |
| ----- | --------------------------------------- | ------------------------------------------------------------- | ----- | ------------------------------------------------------------ |
| R17-A | `feat/r17-a-messaging-authority`        | Messaging read position, cross-instance acceptance            | 1     | `R17_A_MERGED` (#142, `e1f7f51`; post-merge push runs green) |
| R17-B | `feat/r17-b-notification-authority`     | Notification lifecycle, scoping, commit-safe live push        | 2     | `R17_B_MERGED` (#143, `7642513`)                             |
| R17-C | `feat/r17-c-dispute-authority`          | Legacy admin dispute race and copy; journey acceptance        | 3     | `R17_C_IN_REVIEW` (base `a8dc1a2`, after PLATFORM-TX-1 #144) |
| R17-D | `feat/r17-d-admin-operations`           | Admin settings authority, users safeguards, analytics honesty | 4     | analysis only                                                |
| R17-E | `feat/r17-e-provider-surface-authority` | Feed/detail/bid agreement, booking actions, stale capability  | 5     | analysis only                                                |

One unit = one branch = one PR = one report. A dependent unit starts after
its predecessor is merged and the post-merge develop SHA is accepted. While a
merge is pending, only read-only analysis and test design continue.

## Shared-file reservations (serialized)

| Shared authority                                      | First R17 user | Notes                                                            |
| ----------------------------------------------------- | -------------- | ---------------------------------------------------------------- |
| `packages/contracts` (chat request barrel)            | R17-A          | additive `MarkConversationReadRequest`                           |
| `.github/workflows/ci.yml` (`phase5-real-api` job)    | R17-A          | two steps + one upload; no existing step changed                 |
| `apps/web/e2e/real-api.ts`                            | R17-A          | additive `apiAt` (base-addressed variant of `api`)               |
| `packages/contracts` (notifications request barrel)   | R17-B          | additive `MarkAllNotificationsReadRequest`                       |
| `apps/api/src/app.module.ts` (outbox handler list)    | R17-B          | registers `NotificationCreatedHandler`                           |
| `apps/api/src/infrastructure/outbox/outbox.tokens.ts` | R17-B          | new event type `notification.created`                            |
| `.github/workflows/ci.yml` (`phase5-real-api` job)    | R17-B          | stop the job API, one acceptance step, one upload, after R17-A's |
| `apps/web/src/app/styles/toast-theme.css`             | R17-B          | `right: auto` (RTL toast clipping)                               |
| `schema.prisma`, migrations                           | none planned   | any later unit must coordinate and prove upgrade/replay          |
| `AppModule`, authorization, audit allowlists          | none planned   | R17-C/D may need audit identifiers; serialize when they do       |
| `.github/workflows/ci.yml` (`dispute-workspace` job)  | R17-C          | one acceptance step + one upload after C-7's; timeout 20 → 30    |

R17-C changed no schema, migration, contract, `AppModule`, permission or audit
allowlist. Its shared edit is the CI step above.

## R17-B coordination

Open Draft #141 (provider evidence lifecycle) edits two notification
producers (`provider-review.service.ts`,
`verification-case-workflow.service.ts`) but none of their notification
writes; R17-B leaves both files untouched. Both PRs add steps to
`.github/workflows/ci.yml` in different jobs; whichever merges second
re-runs its acceptance on the integrated tree.

## Not in R17

Payouts, withdrawals, capture, escrow, refund execution, checkout, payment
provider activation, background GPS, calling, a new admin application, a V2
visual redesign, realtime production cutover, and R18.
