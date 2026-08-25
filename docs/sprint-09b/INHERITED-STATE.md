# Sprint 9B — inherited state and 9A claim-to-code reconciliation

Recorded **before any edit**. Every 9A report claim below was checked against the
actual tree; the implementation is treated as authoritative and discrepancies are
recorded rather than "fixed" by rewriting the report.

## Inherited git state

|                      |                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inherited branch     | `feat/sprint-09-provider-verification-access`                                                                                                                                            |
| Inherited HEAD       | `f0d27723c9f55a871d266c7024502568047ee28f`                                                                                                                                               |
| Worktree at handover | **Clean.** No uncommitted 9A work existed                                                                                                                                                |
| Stashes              | 4 present, all from unrelated branches (`debug/location-flow-trace`, `debug/location-matching-runtime`, `fix/routing-test-stability`, `feat/provider-interactive-map`). **Not touched.** |
| `origin/develop`     | `207dc1b547877b07854015045369c5e0a53feb36`                                                                                                                                               |
| Merge base           | `207dc1b…` — identical to `origin/develop`                                                                                                                                               |
| Divergence           | 6 ahead, **0 behind**. No upstream drift, so no merge was required                                                                                                                       |
| New branch           | `feat/sprint-09b-provider-verification-experience`, created from `f0d2772`                                                                                                               |

No reset, no force checkout, no rebase. Both branch refs currently point at
`f0d2772`; 9A remains independently recoverable.

### Dirty-worktree handling

None required. All six 9A commits were already purpose-separated:

| SHA       | Commit                                                                   |
| --------- | ------------------------------------------------------------------------ |
| `17c1101` | `test(sprint-09):` failing regressions for the evidence and access gaps  |
| `27be184` | `docs(sprint-09):` ADRs 0009–0013 and the restricted-media threat model  |
| `d258dc7` | `feat(db):` verification, restricted media and work-access schema        |
| `014fb67` | `feat(api):` arm verification and work-access ranks behind rollout flags |
| `6dacd15` | `fix(admin):` one transition table, owned by the server                  |
| `f0d2772` | `docs(sprint-09):` 9A report                                             |

## Discrepancies found

| #     | Claim / instruction                                  | Reality                                                                                                                                               | Handling                                                                                                                                                                                                                   |
| ----- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D9B-1 | Inspect `AGENTS.md`                                  | **Does not exist.** `CLAUDE.md` (395 lines) is the only repository instruction file; no `CONTRIBUTING`, `.cursorrules` or copilot instructions either | Recorded. `CLAUDE.md` governs. Not invented                                                                                                                                                                                |
| D9B-2 | `ProviderApp.tsx`                                    | Actually `apps/web/src/app/components/provider/ProviderApp.tsx`                                                                                       | Path corrected; **not** moved by 9A                                                                                                                                                                                        |
| D9B-3 | `ProviderOnboardingWizard.tsx`, `WizardFields.tsx`   | Actually under `.../components/provider/onboarding/`                                                                                                  | Path corrected; not moved by 9A                                                                                                                                                                                            |
| D9B-4 | `providerQueryKeys`                                  | No file of that name. Exported from `apps/web/src/lib/provider/query-keys.ts`                                                                         | Path recorded; this is the factory 9B reuses                                                                                                                                                                               |
| D9B-5 | Two `Button` files                                   | `components/ds/Button.tsx` (227 L, the design-system one with provider/admin tones) **and** `components/ui/button.tsx`                                | 9B uses `ds/Button.tsx`. Pre-existing duplication, noted as design-system debt; not resolved here                                                                                                                          |
| D9B-6 | 9A report says grant columns are `startsAt`/`endsAt` | Columns are `grantedAt`/`expiresAt`                                                                                                                   | **Not a defect** — 9A documented this deliberately: ADR 0005 defines the access predicate on those names and the authorization index leads with them. 9B reuses the existing columns and does **not** add a duplicate axis |

## 9A claims verified against code

| Claim                          | Evidence                                                                                                                                                                                                           | Verdict           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| 7 new models                   | `MediaAsset`, `VerificationCase`, `VerificationDocument`, `VerificationDecision`, `VerificationRequirementPolicy`, `VerificationAccessLog`, `ProviderPortfolioItem` — each exactly 1 definition in `schema.prisma` | ✅                |
| 8 new enums                    | `MediaVisibility`, `MediaScanState`, `VerificationCaseState`, `VerificationDocumentKind`, `VerificationDecisionOutcome`, `VerificationReasonCode`, `ProviderWorkAccessSource`, `PortfolioModerationState`          | ✅                |
| 2 forward-only migrations      | `20260824084629_sprint09_verification_restricted_media_work_access`, `20260824084700_sprint09_backfill_legacy_work_access_grants`                                                                                  | ✅                |
| Flags exist, default off       | `WORK_ACCESS_ENFORCED: trueish.default(false)` (env.schema.ts:108), `VERIFICATION_ENFORCED: trueish.default(false)` (:112)                                                                                         | ✅                |
| Ranks 6/7 armed and flag-gated | `provider-capability.service.ts:281` (`VERIFICATION_ENFORCED`), `:308` (`WORK_ACCESS_ENFORCED`)                                                                                                                    | ✅                |
| Retention + evidence config    | `VERIFICATION_GRANT_DAYS` 365, `EVIDENCE_RETAIN_{VERIFIED 90, REJECTED 30, ABANDONED 30, QUARANTINE 180}_DAYS`, `EVIDENCE_READ_TOKEN_TTL_SECONDS` 120, `EVIDENCE_MAX_BYTES` 15 MB                                  | ✅                |
| One transition table           | `ADMIN_PROVIDER_TRANSITIONS` in contracts, consumed at service lines 83/106/134/161; frozen incl. arrays                                                                                                           | ✅                |
| Client owns no rule            | Only `canApprove = status ===` match is inside a doc comment (line 498), which is why the regression test strips comments before scanning                                                                          | ✅                |
| API baseline                   | **1666 passed, 0 failed**, 89 skipped, 10 suites skipped (DB/Redis-gated)                                                                                                                                          | ✅ matches report |
| Web baseline                   | **661 passed, 1 failed** (662), 62/63 files                                                                                                                                                                        | ✅ matches report |

## The inherited red test — 9B's first acceptance test

Recorded verbatim. It must never be deleted, skipped, weakened, reverted to the
placeholder, or excluded from CI.

- **File:** `apps/web/src/app/components/admin/VerificationSection.transitions.regression.test.tsx`
- **Suite:** `Sprint 9 regression — the admin UI must not own the transition table`
- **Test:** `renders real evidence rather than a documents placeholder`
- **Assertion:** `expect(source).not.toMatch(/DocumentsPlaceholder/)` (source = component with comments stripped)
- **Failure:**
  ```
  AssertionError: expected 'import { useEffect, useState } from \…' not to match /DocumentsPlaceholder/
  - Expected: /DocumentsPlaceholder/
  ```
- **Cause in code:** `VerificationSection.tsx:290` mounts `<DocumentsPlaceholder labels={L} />`; the component is defined at `:408`. Its copy reads _"No documents uploaded yet. Document storage ships in a follow-up sprint."_

Making it green requires the real restricted-evidence review experience, which is
the substance of 9B — not a change to the assertion.

## No-duplication register

9B must reuse, never re-create under a new name:

| Concern                 | Authoritative 9A artifact                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Case lifecycle          | `VerificationCaseState` (DRAFT, SUBMITTED, IN_REVIEW, ACTION_REQUIRED, VERIFIED, REJECTED, EXPIRED)         |
| Evidence kinds          | `VerificationDocumentKind` (4 kinds)                                                                        |
| Decision outcomes       | `VerificationDecisionOutcome` (incl. REVERIFY_REQUIRED, REVOKED)                                            |
| Reason codes            | `VerificationReasonCode` (15 codes)                                                                         |
| Grant justification     | `ProviderWorkAccessSource` (VERIFIED_DOCUMENTS, LEGACY_BACKFILL, MANUAL_OVERRIDE, RENEWAL)                  |
| Grant window            | `ProviderWorkAccessGrant.grantedAt` / `.expiresAt` / `.revokedAt` — **not** new `startsAt`/`endsAt` columns |
| Media visibility / scan | `MediaVisibility`, `MediaScanState`                                                                         |
| Enforcement switches    | `WORK_ACCESS_ENFORCED`, `VERIFICATION_ENFORCED` — **no new flag names**                                     |
| Admin transitions       | `ADMIN_PROVIDER_TRANSITIONS` + `availableAdminProviderActions`                                              |
| Migrations              | Extend forward; the two 9A migrations are applied and must not be edited                                    |

## Baseline to protect

Any 9B change must leave these at or above baseline, with no new skips:

- API: 1666 passed / 0 failed / 89 skipped
- Web: 661 passed / 1 failed (the acceptance test above) → target 662+ passed / 0 failed
