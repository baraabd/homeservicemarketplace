# ADR-12A — participant intake and the sensitive-journey boundary

Status: **PROPOSED**, implementation behind internal/pilot controls.
Date: 2026-09-17. Approval owners: Product, Security and Privacy (not yet assigned).

## Decisions for the first increment

Reuse the modular monolith, Prisma transaction runner, existing Dispute/Event
storage and transactional Outbox. Do not create a second approval backend, a
public evidence path or a new frontend state store. Controllers validate and
forward; policy, persistence, projections and event delivery have separate owners.

An intake record is identifiable by a deterministic actor-scoped opaque key.
The partial unique active-booking constraint is the final cross-path arbiter.
Read-then-write eligibility alone is insufficient under multiple API replicas.
A policy hash plus pinned non-sensitive facts makes silent policy edits visible.

Participant DTOs are independent from Admin DTOs. Operational state and source
references are projected explicitly. Original narrative is kept separate from
mutable administrative narrative. The participant event reader never selects
arbitrary Admin message or before/after JSON. No automated case verdict exists.

Sensitive drafts will ultimately be server-side/versioned with expiry. Until
that privacy lifecycle is implemented, the UI keeps input only in component
memory and accurately labels it unsaved. Browser persistent storage is rejected.

## UX architecture

Use a shared `features/case-ui` layer for case cards, notices, status surfaces,
dates and a native leave-confirmation modal. Domain choices and eligibility come
from contracts/API, not UI transition tables. Reuse the established accessible
token palette through semantic aliases, and the existing language provider.
The new route is outside the legacy decorative phone frame and does not remount
its form on language change. Wide screens add supporting booking/next-action
context rather than stretching input fields to full viewport width.

Design states for this increment: empty/list, loading, denied/failed read,
booking selection, ineligible/already-open/legacy case, three intake steps,
unsent/offline/retry, pending confirmation, existing-case convergence and safe
tracking. A proposal is not accepted by being drawn. No optimistic outcome,
refund, evidence upload or appeal success is shown.

## Threat model and unresolved risks

- IDOR: every route proves current booking membership, including cursor reads.
- Authority injection: reject client actor/role/status/priority/decision fields.
- Retry/race: actor-bound receipt and unique active booking; real DB tests.
- Narrative disclosure: original message only to author/authorized Admin; no
  raw Admin events, internal resolution or storage paths in participant DTOs.
- Browser caching: no-store even before guards; short-lived in-memory query data.
- Sensitive logging: no new logger receives request bodies, narrative or raw
  idempotency keys; comprehensive existing transport log-redaction acceptance
  still required before launch.
- Legacy authority: current Admin edits/decisions do not yet share a complete
  versioned dispute command service. Centralization and conflict-of-interest
  separation remain release blockers, not implicitly solved by intake.
- Participant reassignment/history: current membership is checked; immutable
  participant snapshots and exceptional reassignment policy remain for 12D.
- Deletion: existing Booking->Dispute cascade is not a legal retention policy.
  The full dispute/KYC retention ADR must reconcile parent deletion and audit
  retention before public use; this increment does not enable automatic erasure.

## Required related ADRs before release

KYC policy/case lifecycle; evidence retention/erasure (including object versions,
legal holds and minimal receipts); full dispute state machine; resolution authority
and execution; independent appeal review; notification privacy/preferences.
No hard-coded retention period or legal compliance assurance is adopted here.

## Design reference basis

The task's 2026 UX brief and the repository's shared UX/UI policy are the product
brief. WCAG 2.2 AA and WAI patterns are acceptance targets, not a certification:

- https://www.w3.org/WAI/WCAG22/Understanding/
- https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22
- https://www.postgresql.org/docs/16/explicit-locking.html
- https://docs.bullmq.io/guide/job-schedulers (evaluation input for 12B, not an
  added dependency or a worker already deployed by this increment)
