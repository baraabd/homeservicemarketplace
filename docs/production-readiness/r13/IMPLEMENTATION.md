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
- Uses the existing admin role plus fresh `user:read:any` permission for the support operator surface.
- Adds admin reply and conditional close/reopen actions.
- Removes fabricated online presence, typing, read receipts, under-five-minute SLA, and local support rating.

## Privacy and audit

Only support identifiers enter audit metadata. Subjects and message bodies do not. The normal user API never returns another requester's identity. The admin projection exposes requester name/email because the authorized support operator needs to identify the requester.

## Deferred

Attachments, dedicated support roles, assignment queues, SLA timers, external notifications, bots, and support-quality ratings are outside R13.

## Acceptance state

Local/hosted exact-head evidence is pending. R13 cannot be merge-ready until the dependency-security baseline repair is merged into develop and this branch is integrated onto that accepted source.
