# Sprint 12 — KYC privacy closure and participant dispute journeys

Status: **IN PROGRESS; NOT release-ready.** This branch delivers the initial
12A intake/tracking implementation, not the whole 47-point sprint. Product,
Security and Privacy approval has not been obtained. All ADRs in this directory
are proposed decisions, not approved policies or a statement of legal compliance.

Baseline inspected: `31d5ac1cba9130fe79bd4d04ed4468da42b87964` (`develop`, PR #82).
Mode B for the new participant case journey, Mode A for domain/privacy boundaries.
Existing Admin approvals and the unmerged alternative PR #83 are not redesigned.

## 1. Discovery and gaps

| Requirement  | Actual baseline                                                                                                                                                                                                                                          | This increment / remaining work                                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HSM-KYC-001  | Versioned verification cases, restricted upload/read, scanner adapter, verification/work-access decisions and expiry exist.                                                                                                                              | Inventory only; full lifecycle revalidation remains.                                                                                                                                           |
| HSM-KYC-002  | `EvidenceCleanupService.sweepExpiredPreparations()` removes expired, never-finalized restricted uploads. `EvidenceScanJob` and `VerificationExpiryJob` are registered; cleanup has no corresponding registered job in the inspected verification module. | **Privacy blocker remains.** Finalized evidence retention/erasure, independently deployed worker, deletion verification, derivatives, retries, dead-letter and metrics are not delivered here. |
| HSM-DISP-001 | Admin CRUD and terminal resolution labels; no participant-safe intake surface.                                                                                                                                                                           | New authenticated participant booking selector, eligibility, structured intake, durable reference, safe listing and public-event tracking. Evidence and information requests remain.           |
| HSM-DISP-002 | Existing Admin list/detail/events can read the newly opened cases.                                                                                                                                                                                       | Dedicated sourced analysis, assignment, independent authorities, SLA and compound resolution execution remain.                                                                                 |
| HSM-DISP-003 | No complete independent appeal journey.                                                                                                                                                                                                                  | Architecture and next increments defined; no appeal endpoint or enabled UI action is claimed.                                                                                                  |

Inspected owners include:

- `apps/api/src/modules/provider/verification/provider-verification.module.ts`
- `apps/api/src/modules/provider/verification/media/evidence-cleanup.service.ts`
- `apps/api/src/infrastructure/outbox/outbox.repository.ts`
- `apps/api/src/infrastructure/outbox/outbox.handler.ts`
- `apps/api/src/modules/admin/disputes/admin-disputes.service.ts`
- `apps/api/src/infrastructure/persistence/disputes/dispute.repository.ts`
- `packages/contracts/src/admin/disputes/index.ts`
- `packages/database/prisma/schema.prisma`
- `apps/web/src/app/components/admin/DisputesSection.tsx`

The old dispute `description` is mutable Admin narrative. Reusing it as the
participant's original statement would expose later internal edits under a false
author attribution. Intake therefore leaves that field empty and stores the
original statement in the private `OPENED` event's message. Authorized Admins
can inspect it through the existing event reader. Participant endpoints project
it only to its author; other Admin event messages/before/after are never selected
by the participant timeline. No public-media or KYC-evidence endpoint is reused
for dispute attachments.

## 2. What 12A implements

The real `/disputes` route is authentication-gated, outside the legacy 430px phone
frame. The provider does not need current work access to seek support for an old
booking. The server proves current booking participation for each operation;
knowing an ID, holding an Admin role, or passing a role in a request grants no
participant access by itself.

Journey: case list -> owned booking selection -> server eligibility -> issue ->
private statement and requested outcome -> review -> confirmed submission ->
reference and timeline. The same components serve customer and provider; the
server supplies the perspective. EN/AR switching does not remount the form.

No private narrative is written to localStorage/sessionStorage. The first slice
has **no autosave**: its copy explicitly says unsent text lives on this page only.
In-app navigation invokes a native modal discard decision; reload/close uses the
browser beforeunload affordance. A network error leaves the text and intent key
in memory for retry. No optimistic success, stored draft, or eventual save is
claimed. A browser crash or reload loses unsent text; server-side drafts with
versioning belong to the next increment.

A requested remedy is only the participant's preference. No cancellation,
reschedule, re-performance, refund, partial refund, account restriction or money
movement is executed by intake. The shared DTO explicitly reports evidence,
response and appeal capabilities as unavailable. The UI explains those limits
rather than drawing working-looking controls.

The existing Admin enum `RESOLVED_REFUND` is projected as `DECISION_RECORDED`,
never as proof that a refund was actually executed. Private resolution text is
not automatically released to participants. The new authorized decision composer
and participant-facing decision document are still required before public rollout.

## 3. API contract and persistence

All routes use the standard authenticated client and application error envelope:

| Method | Route                                | Meaning                                                                                  |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| GET    | `/v1/me/disputes`                    | Cursor-paginated participant cases, no legacy/internal dossiers.                         |
| GET    | `/v1/me/disputes/bookings`           | Minimal owned booking choices for either participant.                                    |
| GET    | `/v1/me/disputes/context/:bookingId` | Authoritative eligibility, policy revision, choices, existing case and opening deadline. |
| GET    | `/v1/me/disputes/:id`                | Participant-safe state, original author-only statement and public event projection.      |
| POST   | `/v1/me/disputes`                    | Structured intake; requires CSRF and a UUID-v4 idempotency key.                          |

Contracts live at `packages/contracts/src/disputes/intake.ts`, with explicit
runtime barrel exports for frontend bundling. DTO validation forbids authority
fields such as `openedById`, role, priority, status and resolution. GET/POST
responses receive `private, no-store`; middleware sets it before guards too.
OpenAPI examples and exhaustive HTTP contract/security tests remain a separate
exit requirement; TypeScript contracts alone do not fulfill that gate.

Creation locks the owned Booking row, rechecks participation, replays a matching
intent, checks active cases and rechecks current policy before writing. An opaque
server-derived `di_...` ID scopes the retry key to the actor. The durable event
receipt binds the normalized payload hash and policy revision. Reusing an intent
with changed content returns a conflict. Two different tabs opening the same
booking converge on its existing active intake. A legacy case is not projected
into this new DTO; the response directs the participant to support.

A partial unique index provides the global active-case constraint, including
legacy Admin creates. It is intentionally SQL-only, like existing partial indexes
in this repository. The migration **refuses existing duplicate active cases**;
it does not delete, merge or reclassify them. Operator preflight and an authorized
resolution are required on an occupied database. No production database was read.

Creation, private original statement, policy/reason audit receipt, a neutral
counterparty notification and Outbox enqueue share the same transaction. The
registered `DisputeIntakeEventsHandler` reuses the existing worker's durable
claim/retry/dead-letter machinery. The real-time publish is only an accelerator;
the in-app notification already exists durably before it runs.

Pilot notifications are **informational**: their safe case deep link is stored,
but the legacy drawer's BOOKING overlay is not falsely reused. Typed actionable
case targets across every notification consumer, localization/preferences, email
and push delivery remain for 12C. Outbox payloads and notification bodies contain
no statement, identity document, storage key or payment detail.

## 4. Rollout and operational limits

No intake policy is seeded. Missing/malformed/disabled policy denies new intake.
`disputes.self_service.intake` must contain an explicitly approved pilot policy:
version, enabled boolean, exact pilotUserIds, allowedBookingStates and positive
terminalWindowHours (bounded at validation). There is no wildcard cohort.
The caller receives an opaque content-bound policy revision; changing settings
under the same version label invalidates an old submission confirmation. The
creation audit retains the applicable non-cohort policy facts and deadline.

The terminal clock comes from the booking's completed/cancelled event, not mutable
`updatedAt`. Missing or future terminal timestamps block intake. No statutory
reporting window is asserted: the product/privacy owners must approve this value.

`VITE_DISPUTE_INTAKE_V1=true` is a build-time **navigation** flag only. Unset/false
hides the new entry on customer bookings and provider jobs. It neither grants
access nor enables the server pilot. Direct authenticated routes remain available
for test/internal review and for reading existing intake cases. The backend
policy remains authoritative regardless of the build flag. The default user
journey is therefore NOT globally replaced by this commit.

Do not enable a live cohort until the remaining privacy and operational gates
are closed, or an explicitly scoped internal test pilot is approved. No policy,
production flag, environment secret or deployment was changed. Roll back by
withdrawing the pilot policy and navigation flag; preserve existing case reads,
receipts and the additive duplicate-prevention constraint. Do not erase cases
or remove a constraint as a feature rollback.

## 5. Validation and truthful evidence

New source tests cover policy defaults/cohort, exact deadline boundaries, intent
hashes, DTO rejection of authority fields, safe projections and no-store scope.
The database-gated suite uses real PostgreSQL/Prisma/repositories/transactions
and tests participation, same/different-intent races, private Admin text exclusion,
provider intake, rollback on Outbox failure, policy withdrawal, terminal events
and the global unique constraint. Its setup creates synthetic fixtures directly;
it is NOT an authentication/CSRF/browser-cookie end-to-end test.

The browser suite drives the actual `/disputes` route with deterministic HTTP
fixtures, EN/AR, six widths and both themes. It captures PNGs and checks overflow,
automated accessibility, retry intent reuse, language preservation, native modal
navigation, denied re-reads and reload. These screenshots are **presentation test
evidence**, not proof that an actual backend accepted the pictured case.

Current-session local checks use an isolated source fixture, not a complete
checkout. Full application checks must be reported from the exact final-SHA CI;
no dependency-aware local typecheck, full browser, scanner or erasure success is
claimed from syntax validation. Inspect PNGs after generation. Do not reuse PR82
or PR83 screenshots or green results as evidence for this sprint.

## 6. Remaining increments and exit gates

1. **12B — privacy worker:** approve retention/erasure ADR and policy ownership;
   versioned due dates, durable scheduler/claims separate from API-only timers,
   object/version/derivative deletion verification, legal-hold exceptions,
   retry/backoff/dead-letter/metrics and real storage scan-to-erasure CI proof.
2. **12C — participant collaboration:** server-side versioned private drafts,
   restricted dispute evidence with scanner/redaction/access audit, information
   requests/deadlines, provider responses, safe sharing decisions and typed
   notification routing/preferences. No direct release of legacy Admin notes.
3. **12D — central dispute domain and Admin workspace:** explicit participant
   snapshot/roles, state machine/optimistic locking shared by every mutation path,
   granular read/request/propose/decide/execute/exception permissions, conflict
   check, assignment/SLA, sourced facts, policy panel, immutable decision document,
   composite ResolutionOption conditions/consents and execution receipts.
4. **12E — independent appeals:** policy window, different reviewer, separate
   immutable original/new decisions, escalation, reopening/closure audit.
5. **12F — release acceptance:** screen reader and keyboard review, 200% zoom,
   reduced motion and full state matrix; full real-auth browser/API journey,
   concurrency and denial coverage, scanner/retention telemetry and alerts,
   Product/Security/Privacy approvals, shadow/internal/pilot rollout and rollback.

All HSM-KYC and HSM-DISP tickets remain open until their complete acceptance
criteria pass. Intake creation alone does not deliver request-based (non-booking)
disputes, full evidence lifecycle, full Admin review, flexible remedy execution,
independent appeals, retention enforcement or production readiness.

## 12B continuation — finalized evidence retention (not sprint closure)

See [ADR-12B](ADR-12B-evidence-retention.md) (PROPOSED) and the
[operator runbook](retention/RUNBOOK.md). The independent worker, pinned durable
jobs, scoped storage proof, irreversible access fence, metadata minimization,
retry/dead-letter, metrics and real-services CI gate are a bounded privacy
implementation. No production deletion or activation is authorized by this PR.
The new required CI job and final-head results must be checked before acceptance.
All broader dispute/appeal and external privacy approval gates remain open.
