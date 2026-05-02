# Sprint 6.3 Review Report — Admin Disputes System

## 1. Planning Summary

- **Scope:** Persist disputes against a Booking and ship the admin
  surfaces to list / open / resolve them. Each mutation writes
  `ADMIN_DISPUTE_{OPENED,RESOLVED}` audit + a SYSTEM notification to
  the user who opened the dispute.

## 2. Implementation Summary

- **Schema:** new `Dispute` model + `DisputeStatus` enum
  (OPEN | IN_REVIEW | RESOLVED_REFUND | RESOLVED_PARTIAL |
  RESOLVED_DENIED | CANCELLED) and a `PlatformSetting` model (used
  by Sprint 6.5).
- **Migration:** `20260502010000_add_disputes_and_settings/migration.sql`
  creates both tables + indexes + FKs.
- **Files added:**
  - `apps/api/src/infrastructure/persistence/disputes/dispute.repository.ts`
  - `packages/contracts/src/admin/disputes/index.ts` — single-file
    barrel: query / open / resolve request shapes,
    `DisputeSummary`, list + mutation responses.
  - `apps/api/src/modules/admin/disputes/dto/admin-disputes.dto.ts`
  - `apps/api/src/modules/admin/disputes/admin-disputes.controller.ts`
  - `apps/api/src/modules/admin/disputes/admin-disputes.service.ts`
  - `apps/api/src/modules/admin/disputes/admin-disputes.service.spec.ts`
- **Files changed:**
  - `apps/api/src/infrastructure/persistence/persistence.module.ts`
    — register DisputeRepository.
  - `apps/api/src/modules/admin/admin.module.ts` — wire
    AdminDisputesController + AdminDisputesService.
  - `packages/contracts/src/admin/index.ts` — re-export disputes.
  - `postman/hsm-admin.postman_collection.json` — folder
    `40 — Disputes (Sprint 6.3)` (4 requests: list, open, resolve,
    resolve-with-invalid-status 400).
- **API endpoints added:**
  - `GET  /v1/admin/disputes?status&limit&cursor`
  - `GET  /v1/admin/disputes/:disputeId`
  - `POST /v1/admin/disputes { bookingId, openedById, reason }`
  - `POST /v1/admin/disputes/:disputeId/resolve { status, resolution }`
    Status restricted to RESOLVED_REFUND | RESOLVED_PARTIAL |
    RESOLVED_DENIED at the DTO layer (400 if anything else).

## 3. Automated Tests

| Check                                                 | Result                         |
| ----------------------------------------------------- | ------------------------------ |
| `prisma validate`                                     | pass                           |
| `pnpm --filter @homeservicemarketplace/api typecheck` | pass                           |
| `pnpm --filter @homeservicemarketplace/api test`      | pass — 637 (+5 new), 6 skipped |

Five new unit tests in `admin-disputes.service.spec.ts`: open writes
audit, detail-404, resolve writes audit + notifies opener, resolve
409 on already-resolved, list maps rows.

## 4. Postman Tests

- New folder `40 — Disputes (Sprint 6.3)` (4 requests).

## 7. Remaining Issues

- Prisma client generation is still locked by the dev process; the
  DisputeRepository wraps prisma.client in a typed stub (declared
  inline in the repo file) so the application compiles. A clean
  shell `prisma generate` will replace those casts with the
  generated typed client.

## 8. Sprint Decision

**PASS** — Continue automatically.
