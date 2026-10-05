# R17-B — Notification policy

What the notification lifecycle is allowed to mean, with the source of each
rule. **CONFIRMED** rules come from existing code, ADRs or earlier sprint
decisions; **APPLIED** rules are R17-B engineering choices inside confirmed
policy; **DECISION NEEDED** items are not settled and were not invented.

## Lifecycle

| Rule                                                                                                                                                                                                                                                                                                                                                                                         | Status        | Source                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| A notification is written in the same transaction as the business change that causes it; if that change rolls back, the notification does not exist.                                                                                                                                                                                                                                         | CONFIRMED     | `NotificationsService.createForUser` contract (Sprint 3); outbox ADR 0004                       |
| Nothing about a notification leaves the process before its transaction commits. The live announcement is an outbox event written with the row and published after commit.                                                                                                                                                                                                                    | APPLIED (B-1) | ADR 0004 "the event and the state change commit together"; `OutboxHandler.afterCommit` contract |
| The live push is an accelerator. The inbox (list, count) is the record; a lost push is recovered by the client's next read. Delivery is at most one announcement per committed notification per dispatch; no exactly-once network delivery is claimed.                                                                                                                                       | CONFIRMED     | `outbox.handler.ts` afterCommit contract                                                        |
| Recipient = the user the producer names; the actor's id travels on the announcement (anti-echo), not on the row.                                                                                                                                                                                                                                                                             | CONFIRMED     | Sprint 7.6                                                                                      |
| Producers: bid placed → seeker; bid accepted → provider (BID_ACCEPTED, BOOKING_CREATED); booking cancelled by seeker → provider; provider start/complete/cancel → seeker; admin provider decisions → provider; request available → matching providers (outbox fan-out); dispute intake/workspace → counterpart; provider review and verification case → provider. No new producer was added. | CONFIRMED     | producer code at `460b9ee`/`e1f7f51`                                                            |

## Experiences (presentation partitions, not permissions)

| Rule                                                                                                                                                                                                                             | Status        | Source                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------- |
| Every read and mutation is limited to the caller's own rows (`userId` from the session). `experience` only selects which of those rows a surface shows; `experience=admin` grants nothing.                                       | CONFIRMED     | repository owner filters; R17-B tests                                             |
| seeker = deep links under `/home/`; provider = `/provider/`; admin = `/admin/`.                                                                                                                                                  | CONFIRMED     | Sprint 5.5                                                                        |
| Dispute notices belong to both participant experiences: `resourceType = DISPUTE`, or a `/disputes/…` deep link (the intake notice has no type). `/disputes/*` is one shared, authenticated route whose API authorizes each read. | APPLIED (B-4) | existing DISPUTE exception (Sprint 5.5) + `routes.ts` shared route                |
| The seeker app always asks for the seeker experience (list, count, read-all).                                                                                                                                                    | APPLIED (B-3) | Sprint 5.5 intent: "keeps cross-experience notifications out of the wrong drawer" |

## Read state

| Rule                                                                                                                                                                                                                                                                                                                                                                               | Status             | Source                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------- |
| Mark one: idempotent; the first read time is kept.                                                                                                                                                                                                                                                                                                                                 | CONFIRMED          | `markReadOwned` conditional update                                          |
| **Read-all marks the unread notifications the reader was shown, named by id (1–100), within the experience.** Ids that are foreign, deleted, already read or of another experience are ignored. Nothing outside the list is touched — in particular a notification that arrived, or whose transaction committed, after the list was read. `updatedCount` = rows this call flipped. | APPLIED (B-2)      | race fix; a timestamp or id boundary cannot exclude a row that commits late |
| The pre-R17-B bodyless read-all ("everything unread now") is refused with 400. An old cached client therefore gets an error on "Mark all read" instead of silently marking unseen notifications. Web and API ship together.                                                                                                                                                        | APPLIED (B-2)      | brief §9: no unbounded escape hatch                                         |
| Delete is a soft delete of the caller's own row; a deleted row is never announced afterwards.                                                                                                                                                                                                                                                                                      | CONFIRMED + tested | repository; `NotificationCreatedHandler`                                    |

## Counts and states

| Rule                                                                                                                                                           | Status            | Source                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- |
| A badge shows the server's unread count for its experience — never a page length or a local guess. "99+" is presentation only.                                 | APPLIED (B-5/B-9) | R12 matrix precedent ("sum of the server's count")             |
| A failed load is shown as a failure with retry, never as an empty inbox; a failed refresh keeps the last list with a notice; an unknown count shows no number. | APPLIED (B-5)     | CLAUDE.md "do not catch an exception and return [] as success" |

## Content

| Rule                                                                                                                                                                                                                                                            | Status    | Source                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A notification body never carries a reviewer's free-text reason or other judgement about a person. It names what happened and where to look; the reason lives behind the access-controlled screen (rejection: provider onboarding hub) and in the audit record. | CONFIRMED | `verification-case-workflow.service.ts` (Sprint 9B): "a rejection reason is a judgement about a person and belongs behind the access-controlled case" |
| User text is rendered as text (React escaping); no HTML is interpreted.                                                                                                                                                                                         | CONFIRMED | renderers                                                                                                                                             |

## Channels and preferences

| Rule                                                                                                                                                                                      | Status        | Source                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| In-app notifications only. Email is used for authentication only; there is no push or SMS channel.                                                                                        | CONFIRMED     | `mail.module.ts`, no push/SMS code                                                                 |
| The only stored preference is the dispute workspace opt-out (`DisputeNotificationPreference`), honoured by the workspace producer.                                                        | CONFIRMED     | dispute workspace (Sprint 12)                                                                      |
| Settings shows no switch that saves nothing: the former push/email/SMS/bid-alert switches (local memory only, push and SMS defaulting "on") were replaced by a statement of what is true. | APPLIED (B-8) | UX policy §3 "do not promise interactions that do not exist"; R12 precedent (Call "not available") |

## Decisions needed (consolidated request to the owner)

1. **Read-all and unloaded pages.** Before R17-B, "Mark all read" also marked
   unread notifications on pages never loaded (beyond the newest 50). R17-B
   marks what was shown; older unread rows remain unread and stay in the
   server count. Should "Mark all read" also clear older unread pages? If yes,
   the safe design is an explicit "Mark older notifications read" action that
   pages through the server's unread list and names those ids too.
2. **Channel preferences (B-8).** Which channels exist (push, email, SMS), for
   which events, and what consent model (opt-in/opt-out, defaults, revocation,
   marketing separation) before any channel switch returns.
3. **Suspension reason (B-7).** A rejection reason is shown on the provider's
   onboarding screen; a suspension reason is shown nowhere but the audit
   record. Should the provider see it, and where?
4. **Notification language.** Server-written titles and bodies are English
   only, except the dispute workspace's bilingual copy; an Arabic user sees
   Arabic chrome around English notification text. A localization design is
   needed (e.g. message keys with parameters rendered by the client).
5. **Admin notifications (B-9).** No producer writes admin-experience
   notifications, so the admin bell is truthfully empty. Which events, if
   any, should notify administrators?
6. **Dispute-intake preference.** The intake notice does not consult the
   dispute opt-out; the workspace notices do. Should it?

None of these is decided by R17-B.
