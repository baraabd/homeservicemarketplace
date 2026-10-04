# R13 — Durable Help & Support

Status: **IMPLEMENTED, BASELINE RECOVERY PENDING**

Baseline used for implementation: `develop@a2b31c3090000d2ef8a5e96dd21e80023ee160a7`.

R13 is developed in parallel with the focused post-R12 dependency-security baseline recovery. Final merge readiness requires integrating the repaired green develop and re-running exact-head acceptance.

## What changes

- Replaces seeded/local bot messages and delayed fake replies with durable authenticated support tickets.
- Keeps FAQ answers as static help content.
- Adds PostgreSQL `SupportTicket` and `SupportMessage` authority.
- Adds retry-safe creation/message sends using scoped idempotency keys.
- Enforces user ownership server-side.
- Gates the support operator surface on the admin role plus fresh `support:read` (read) and `support:respond` (reply/close/reopen) permissions, granted to `admin` by migration `20261004120000_r13_support_tickets` and the seed.
- Adds admin reply and conditional close/reopen actions.
- Removes fabricated online presence, typing, read receipts, under-five-minute SLA, and local support rating.

## Privacy and audit

Only support identifiers enter audit metadata. Subjects and message bodies do not. The normal user API never returns another requester's identity. The admin projection exposes requester name/email because the authorized support operator needs to identify the requester.

## Deferred

Attachments, dedicated support roles, assignment queues, SLA timers, external notifications, bots, and support-quality ratings are outside R13.

## Corrections made during acceptance (2026-10-04)

- The migration folder was renamed from `20261003170000_r13_support_tickets` to
  `20261004120000_r13_support_tickets`: the old name sorted before R12's
  `20261004090000_r12_message_send_idempotency`, which is already on develop.
  It has never been applied to a shared database, so the rename rewrites no
  deployed history.
- Admin writes were gated by the read permission `user:read:any`; they now
  require `support:respond`, and reads `support:read`.
- A retried send whose original was stored before an admin closed the ticket
  returned 409; it now replays the stored message.
- `lastMessageAt` on the detail projection reported the first message; it now
  reports the newest for both list and detail shapes.
- Cursor pagination was ordered by the mutable `updatedAt`, so a ticket could
  skip or repeat between pages; ordering is now `createdAt DESC, id DESC` with
  matching indexes.
- Route-level throttles on ticket creation and message sends.
- The diagnostic `r13-validation.yml` workflow was removed; the integration
  spec runs in CI's real Postgres/Redis job and a new real-browser spec,
  `apps/web/e2e/r13-support.real-api.spec.ts`, runs in the Phase 5 real-API
  job.

## Tests

- `apps/api/test/integration/r13-support.integration.spec.ts` (real
  PostgreSQL, HTTP through Nest): durability and reload, create replay and
  conflict, concurrent create, ownership, send replay/conflict, concurrent
  send, fresh-permission revocation, read-only role cannot write, replay after
  close, deterministic paging under activity, close/reopen with audit,
  malformed and oversized input. JWT, CSRF, role and permission _guards_ are
  stubbed here; the service-level fresh permission check is real.
- `apps/web/e2e/r13-support.real-api.spec.ts` (real browser, API and
  PostgreSQL, all guards real): create in the UI, no fabricated reply after
  waiting, stranger/seeker refusals, admin reply through the real admin
  screen, seeker reply after full navigation, close makes the thread
  read-only, audit rows contain identifiers only; a dropped create answer is
  retried without a duplicate; Arabic RTL at 320 and 430 px without
  horizontal overflow, operated by keyboard.

## Known limitations

- Strings use the page's inline `ar ? … : …` pattern rather than the central
  `translations.ts` catalogue (consistent with the page it replaces).
- The admin support screen has no status filter or pagination control yet;
  the API supports both.
- The seeker sees a support reply on the open thread by a 5-second refresh;
  there is no realtime push.

## Acceptance state

Exact-head hosted evidence is recorded in the PR. R13 cannot be merge-ready
until the dependency-security baseline repair (PR #134) is merged into develop
and this branch is integrated onto that accepted source.
