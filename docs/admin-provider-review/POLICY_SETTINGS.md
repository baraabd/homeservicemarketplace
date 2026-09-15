# Verification policy settings

The approved review plan places global verification rules in Settings. The screen is `/admin/settings/verification-policies`; `VerificationPolicyPanel` is the route component. It is not mounted in the daily review queue or an individual provider dossier.

## Product behavior

- A compact policy history shows the scope, required documents, effective date, retirement date and server-owned lifecycle (`ACTIVE`, `SCHEDULED`, `RETIRED`). Published versions cannot be edited or deleted.
- “New version” opens a scoped draft. Country choices come from the configured market registry; category choices come from the database catalog. Configured markets that are not yet enabled are labelled and may be prepared before launch. Retired categories retain their historical labels but cannot be selected for a new version.
- A category policy is additive to the base policy and may require only `CATEGORY_LICENSE`. Selecting a specialty explicitly switches the document checklist to the trade licence. Returning to the base scope restores the identity-document checklist. The server independently enforces this rule and rechecks category availability at publication.
- Publication takes effect immediately. The form does not expose scheduling; previously scheduled versions remain visible with their correct state.
- Publication and retirement both require an impact confirmation. Stopping a policy can leave a new case without an applicable policy; the confirmation explains this. Previously pinned cases and published history are preserved.
- Failed mutations keep the confirmation and draft. Structured error reasons are translated into Arabic and English; raw database/server messages are not displayed.
- The screen shares Admin review tokens, cards, badges, fields and Radix focus-contained dialogs. It supports Arabic/RTL, English/LTR, dark/light themes, responsive cards and 44px controls.

## API contract

| Endpoint                                               | Contract                             | Behavior                                                         |
| ------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------- |
| `GET /v1/admin/verification/policies`                  | `ListVerificationPoliciesResponse`   | All immutable versions with server-owned lifecycle               |
| `GET /v1/admin/verification/policies/options`          | `VerificationPolicyOptionsResponse`  | Configured countries and named catalog scopes with selectability |
| `POST /v1/admin/verification/policies`                 | `PublishVerificationPolicyRequest`   | Validate scope, publish and audit in one transaction             |
| `POST /v1/admin/verification/policies/:version/retire` | `VerificationPolicyMutationResponse` | Conditional retirement and audit in one transaction              |

No update or delete endpoint is introduced. Old development/test policies are not deleted or filtered out by this feature.

## Authorization and provisioning

Every endpoint requires the authenticated `admin` role **and** the dedicated `verification:policy:manage` permission. Case-review permission (`verification:decide`) alone does not grant policy access. PermissionsGuard reads current DB grants for the verification namespace. The service also checks current active admin membership and permission, including a fresh check inside each mutation transaction; stale JWT role claims and cached grants cannot retain access after revocation.

Migration `20260915120000_verification_policy_management_permission` additively creates the permission and attaches it to the existing admin role. The canonical seed includes the same permission. This preserves the repository’s existing administrator provisioning model; it does **not** claim that a separate limited staff cohort has already been configured. Operators can revoke this permission independently and attach it to a narrower role held alongside `admin` using the existing role-management mechanisms. No person-specific grants are created.

Apply the additive migration before activating the new API. Do not use demo seeding to provision a production environment. Removal of the permission denies the settings screen and API on subsequent requests; no policy rows or historical decisions need to be changed. Keep the authorization guard during a UI rollback.

## Verification boundaries

`VerificationPolicyPanel.test.tsx` covers confirmed publication/retirement, catalog-scoped payloads, licence validation/focus, draft retention, translated failures, permission denial, failed list/options loads and Arabic labels.

`admin-verification-policy.service.spec.ts` and `permissions.guard.spec.ts` cover independent permission checks, revoked grants/membership, transaction-time authorization, scope validation and audit orchestration.

`admin-verification-policy.integration.spec.ts` exercises real HTTP, PostgreSQL, policy/catalog/settings services, audit transactions, RolesGuard, PermissionsGuard and CSRF. Only JWT authentication is replaced by a supplied principal; the role claim stays unchanged while real database grants/memberships are removed. The suite temporarily removes the seeded admin-role policy grant under the exclusive `seed` advisory lock and restores its original state in teardown. Do not run this suite concurrently with a manual/browser acceptance session using the same database outside that lock.

Browser acceptance and inspected route screenshots are recorded in the parent delivery evidence. Unit/HTTP integration results alone do not establish visual acceptance or the version running on the user’s device.
