# Sprint 6.2 Review Report — Full Admin Provider Verification

## 1. Planning Summary

- **Scope:** Admin verification surface for provider profiles —
  list (defaults to PENDING_REVIEW queue), detail, approve, reject,
  suspend. Reuses the `ProviderProfileStatus` state machine shipped
  in 5.1.2 and the `AdminAuditService` shipped in 6.0.
- **Existing files inspected:** `ProviderProfileRepository.updateStatusById`
  (already shipped), AuditEventType (extended in 6.1's migration with
  `ADMIN_PROVIDER_*` values), NotificationsService.

## 2. Implementation Summary

- **Files added:**
  - `packages/contracts/src/admin/verification/{request,response,index}.ts`
    — `ListAdminProvidersQuery`, `AdminProviderApproveRequest`,
    `AdminProviderRejectRequest`, `AdminProviderSuspendRequest`,
    `AdminProviderSummary`, list / mutation responses.
  - `apps/api/src/modules/admin/verification/dto/{list-admin-providers,admin-provider-decision}.{ts,query.ts}`
  - `apps/api/src/modules/admin/verification/admin-verification.controller.ts`
  - `apps/api/src/modules/admin/verification/admin-verification.service.ts`
  - `apps/api/src/modules/admin/verification/admin-verification.service.spec.ts`
- **Files changed:**
  - `apps/api/src/infrastructure/persistence/bids/provider-profile.repository.ts`
    — `listForAdmin`, `findByIdForAdmin` (eager-loads linked user
    id+email so the admin row connects profile to account).
  - `apps/api/src/modules/admin/admin.module.ts` — register the
    verification controller + service.
  - `packages/contracts/src/admin/index.ts` — re-export verification.
  - `postman/hsm-admin.postman_collection.json` — folder
    `30 — Verification (Sprint 6.2)` with list / detail / approve /
    reject (empty-reason 400 negative) / suspend.
- **API endpoints added:**
  - `GET  /v1/admin/providers?status&limit&cursor` — default status
    is `PENDING_REVIEW`.
  - `GET  /v1/admin/providers/:providerProfileId`
  - `POST /v1/admin/providers/:id/approve { note? }` — DRAFT |
    PENDING_REVIEW → ACTIVE; writes `ADMIN_PROVIDER_APPROVED` audit;
    notifies provider userId when present.
  - `POST /v1/admin/providers/:id/reject { reason }` — any non-REJECTED
    → REJECTED; writes `ADMIN_PROVIDER_REJECTED` audit; notifies.
  - `POST /v1/admin/providers/:id/suspend { reason }` — ACTIVE →
    SUSPENDED only; writes `ADMIN_PROVIDER_SUSPENDED` audit; notifies.

  All transitions run inside one transaction; each writes audit +
  user-facing notification atomically.

## 3. Automated Tests

| Check                                                   | Result                         |
| ------------------------------------------------------- | ------------------------------ |
| `prisma validate`                                       | pass                           |
| `pnpm --filter @homeservicemarketplace/contracts build` | pass                           |
| `pnpm --filter @homeservicemarketplace/api typecheck`   | pass                           |
| `pnpm --filter @homeservicemarketplace/api test`        | pass — 632 (+8 new), 6 skipped |

Eight new unit tests in `admin-verification.service.spec.ts`
(approve happy + 409 conflict + reject + reject 409 + suspend
state-guard + suspend happy + list eager-loads user / detail 404).

## 4. Postman Tests

- New folder `30 — Verification (Sprint 6.2)` (5 requests): list,
  detail, approve, reject (empty-reason 400 negative), suspend.

## 7. Remaining Issues

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically.
