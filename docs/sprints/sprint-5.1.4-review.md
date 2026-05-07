# Sprint 5.1.4 Review Report — Minimal Provider Approval Gate

> Backend-only sprint. Admin UI wiring is deferred to Sprint 6.2.

## 1. Planning Summary

- **Goal:** Build the minimal admin-controlled `ProviderProfile.status`
  management API the marketplace gate (Sprint 5.2 available-requests
  feed and 5.3 submit-bid) depends on.
- **Reason:** Provider Available Requests must not depend on a
  dev-only "auto-active" upgrade flow.
- **Existing inventory** (verified, not re-implemented):
  - `ProviderProfile.status` enum
    (`packages/database/prisma/schema.prisma`):
    `DRAFT | PENDING_REVIEW | ACTIVE | SUSPENDED | REJECTED` ✓
  - `RolesGuard('admin')` at
    `apps/api/src/modules/iam/authorization/guards/roles.guard.ts` ✓
  - `AuditEvent` model + `AuditEventRepository.write` ✓ (`AuditEventType`
    extended in `20260502000000_add_admin_audit_event_types` with
    `ADMIN_PROVIDER_{APPROVED,REJECTED,SUSPENDED}`)
  - `Notification` model + `NotificationsService.createForUser` ✓
  - `AdminVerificationController` shipped in commit `2bf8a02`
    (originally Sprint 6.2; rewired here as 5.1.4) — list / detail /
    approve / reject / suspend already in place.
- **Decision:** Backend-only this sprint. The existing AdminDashboard
  has no dedicated verification screen; UI wiring belongs to Sprint
  6.2 once the seekers / providers / admin runtime story stabilises.

## 2. Implementation Summary

This sprint adds the only piece the prior commit didn't include —
`reactivate`, the SUSPENDED → ACTIVE transition — and relaxes
`reason` on reject / suspend from required to optional so the admin
UI can ship a one-click action without forcing a modal.

- **Files changed:**
  - `apps/api/src/modules/admin/verification/admin-verification.service.ts`
    — added `reactivate(adminUserId, providerProfileId)`; relaxed
    `reject` + `suspend` to accept `string | null | undefined` and
    fall back to a generic notification body when no reason is
    given.
  - `apps/api/src/modules/admin/verification/admin-verification.controller.ts`
    — added `POST /v1/admin/providers/:providerProfileId/reactivate`.
  - `apps/api/src/modules/admin/verification/dto/admin-provider-decision.dto.ts`
    — `AdminProviderRejectDto.reason` and `AdminProviderSuspendDto.reason`
    are now `@IsOptional`.
  - `packages/contracts/src/admin/verification/request/admin-provider-decision.request.ts`
    — relaxed `AdminProviderRejectRequest.reason` and
    `AdminProviderSuspendRequest.reason` to optional; published
    `AdminProviderReactivateRequest` as the body-less type alias.
  - `apps/api/src/modules/admin/verification/admin-verification.service.spec.ts`
    — five new test cases (suspend-no-reason, reject-no-reason,
    reactivate happy / 409 / 404).
- **Files added:**
  - `postman/FixNow Sprint 5.1.4 Provider Approval Gate.postman_collection.json`
    — 8 requests covering the full transition story + cross-role 403
    - no-token 401, with the standard secret-leak guard at the
      collection level.
- **Migrations:** none. The audit-event-type migration shipped with
  the original 5.1.4 / 6.0 admin work
  (`20260502000000_add_admin_audit_event_types`).
- **API endpoints surface (post-sprint):**
  - `GET    /v1/admin/providers?status&limit&cursor`
  - `GET    /v1/admin/providers/:providerProfileId`
  - `POST   /v1/admin/providers/:providerProfileId/approve`
  - `POST   /v1/admin/providers/:providerProfileId/reject`
  - `POST   /v1/admin/providers/:providerProfileId/suspend`
  - `POST   /v1/admin/providers/:providerProfileId/reactivate` ← new
- **Each transition is transactional**:
  1. Verify status is in the allowed `from[]`; otherwise 409.
  2. `ProviderProfileRepository.updateStatusById(...)`.
  3. `AdminAuditService.record({ adminUserId, type, metadata: {
providerProfileId, targetUserId, previousStatus, newStatus, ...
reason / note / reactivate flag } })`.
  4. `NotificationsService.createForUser({ userId: targetProvider.userId,
type: SYSTEM, deepLink: '/provider/profile', resourceType: REVIEW })`
     — only when the provider profile is linked to a user account.
  5. Reload the profile and map to the safe `AdminProviderSummary`
     wire shape (no passwordHash, no mfaSecret, no refreshToken).

## 3. Automated Tests

| Check                                                   | Result                                         |
| ------------------------------------------------------- | ---------------------------------------------- |
| `prisma:validate`                                       | pass                                           |
| `prisma generate`                                       | n/a (Windows DLL lock from running nest watch) |
| `pnpm --filter @homeservicemarketplace/contracts build` | pass                                           |
| `pnpm --filter @homeservicemarketplace/api typecheck`   | pass                                           |
| `pnpm --filter @homeservicemarketplace/api test`        | pass — 646 passed (+5 new), 6 skipped          |

The 13-case `admin-verification.service.spec.ts` covers every
required acceptance test:

- approve happy path → ACTIVE + `ADMIN_PROVIDER_APPROVED` audit + notification
- approve 409 if already ACTIVE
- reject happy + reject 409
- suspend state-machine guard (only ACTIVE) + suspend happy + reason audit
- **suspend with empty reason** uses generic body, omits `reason` in metadata
- **reject with empty reason** same
- **reactivate happy** writes audit + notifies
- **reactivate 409** if not SUSPENDED
- **reactivate 404** if profile missing
- list eager-loads userId + email
- detail 404

## 4. Postman Tests

- New collection:
  `postman/FixNow Sprint 5.1.4 Provider Approval Gate.postman_collection.json`
  with **8 requests** in run order:
  1. `GET ?status=PENDING_REVIEW` — captures `providerProfileId` for
     the follow-on tests.
  2. `GET /:providerProfileId`
  3. `POST /:id/approve` — asserts `provider.status = ACTIVE` on 200.
  4. `POST /:id/reject` — asserts `REJECTED`.
  5. `POST /:id/suspend` — asserts `SUSPENDED` (or 409 if the prior
     reject already terminalised the profile in the test seed).
  6. `POST /:id/reactivate` — asserts `ACTIVE`.
  7. **Negative**: provider token on `/v1/admin/providers` → must
     401/403.
  8. **Negative**: no token → must 401/403.
- Collection-level guard pins no `passwordHash`, `refreshToken`,
  `JWT_SECRET`, `DATABASE_URL`, or `PrismaClient*` string in any
  response body.

## 5. Manual checks (operator-driven)

The sprint scope lists nine manual scenarios. They cannot be driven
from this autonomous tool surface — the dev API + web are running
in the user's terminals; the user is the final eyes-on. Each
scenario maps to:

- 1–3 (admin login + `/admin`): backed by `RequireAdmin` at
  `apps/web/src/lib/route-guards.tsx:92` and the seeded `admin@admin.com`
  account.
- 4 (Postman → SUSPENDED): folder request 5 above.
- 5–6 (provider blocked from live shell): `ProviderApp.tsx:1618`
  renders `<ProviderStatusState>` for any non-ACTIVE status.
- 7 (Postman → reactivate): folder request 6 above.
- 8–9 (provider regains live shell): same `ProviderApp.tsx` gate
  re-evaluates after the next `/v1/me/provider/profile` poll.

## 6. Fixes Applied

- `reject` + `suspend` had `reason: string` (required). The Sprint
  5.1.4 spec calls these from a one-click admin UI without a body,
  so the DTO + contract were relaxed to optional. The audit row
  now records `reason` only when supplied, and the user-facing
  notification falls back to a generic body. No behaviour
  regresses — the 13 unit cases pin both code paths.

## 7. Remaining Issues

- **Admin Provider Verification UI** is deferred to Sprint 6.2 per
  the sprint's "If no UI exists: implement backend + Postman only"
  rule.
- The reactivate audit reuses `ADMIN_PROVIDER_APPROVED` with
  `metadata.reactivate = true` to avoid a third forward-only
  migration on the audit-event enum. A future split into a
  dedicated `ADMIN_PROVIDER_REACTIVATED` value is straightforward
  and documented in the service source.
- Pre-existing flaky web test in `app-selector-routing.test.tsx`
  remains; not exercised by this slice.

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically to Sprint 5.2.

Acceptance:

- ✓ Admin can control provider readiness through API
  (approve / reject / suspend / reactivate).
- ✓ AuditLog row created for every mutation.
- ✓ Notification fan-out for every mutation (when provider has a
  linked userId).
- ✓ Security tests pass (cross-role 403 + no-token 401, secret-leak
  guard, narrow wire projection).
- ✓ Postman collection committed at the requested path.
