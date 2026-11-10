# Provider lifecycle recovery after identity approval

## Scope and delivery status

Mode A — Integration and Bug-Fix. This follow-up addresses the provider and
Admin recovery paths around an independently approved identity and a joining
application that still needs action. It continues the existing
`fix/provider-verification-onboarding-recovery-20261109` branch.

**Local validation is recorded below.** Exact final-commit CI, real-browser
outcomes, artifact provenance and inspected screenshots are recorded in the
[PR acceptance evidence](https://github.com/baraabd/homeservicemarketplace/pull/223).
A pending or missing check is not a pass. This document deliberately does not
embed its own future commit hash.
This report does not certify every possible account combination or the user's
Windows installation.

The initial identity-entry fix and its historical acceptance record remain in
[IDENTITY_RECOVERY_FIX.md](IDENTITY_RECOVERY_FIX.md). The report below records
the additional lifecycle gap; it does not replace that earlier evidence.

## The reported state and its correct next step

The reported account has a verified identity, while its latest joining
application was **returned for changes**. The legacy profile status is
`REJECTED`, but the independently recorded application state is `RETURNED`.
Identity approval does not change that application decision or resubmit it.

The provider must review and submit the joining application again. The Admin
can then decide the new submission after the backend's prerequisites are met.
If identity approval already created a live work grant, this flow preserves
that grant and the identity decision; it does not require a second identity
approval or a redundant grant. Work remains denied until the current
capability evaluation allows it.

This follows the existing [onboarding submission service](../../apps/api/src/modules/provider/onboarding/provider-onboarding-wizard.service.ts),
[Admin review policy](../../apps/api/src/modules/admin/provider-review/provider-review.policy.ts)
and [capability service](../../apps/api/src/modules/provider/capability/provider-capability.service.ts).
The repair makes those distinct steps visible and reachable.

## State ownership and axes

| Axis                       | Server-owned fact                                                                                     | What it does not imply                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Account and standing       | Account eligibility, suspension, termination and provider restrictions                                | An old identity decision or grant cannot override a current restriction.                  |
| Joining application        | `NOT_STARTED`, `DRAFT`, submitted states, `RETURNED`, `ACCEPTED`, plus immutable submission decisions | Identity approval does not submit or accept this application.                             |
| Identity case              | Requirements, evidence, scan outcomes and case/reviewer decisions                                     | A clean scan is not identity approval; identity approval alone is not permission to work. |
| Work grant                 | Its recorded source, time interval and revocation state                                               | A live grant can coexist with an incomplete or returned application.                      |
| Effective capabilities     | The current server response, including `SUBMIT_BID` and workflow capabilities                         | The browser must not reconstruct authorization from a badge or one status column.         |
| Paid/editorial recognition | Existing VIP/featured presentation                                                                    | These do not grant onboarding approval, verified identity or work access.                 |

Authority: [lifecycle axes ADR](../adr/0005-provider-lifecycle-axes.md),
[capability ADR](../adr/0006-provider-capability-service.md),
[evidence-to-work-access ADR](../adr/0013-evidence-to-work-access-capability-transition.md)
and the current capability implementation linked above. Existing enforcement
configuration remains authoritative; this change does not turn it on or off.

## State, actor and recovery matrix

The next action below is conditional on the server's current permissions and
available actions. Descriptive UI states do not authorize mutations.

| Observed state                                                                    | Next actor and action                                                                                                                      | Constraint or repair                                                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| No provider profile                                                               | Provider follows `COMPLETE_PROFILE` to activation, then creates the profile through the normal session-refresh flow.                       | Earlier recovery fix retained; do not request the guarded private case before permission exists.                                             |
| DRAFT/incomplete profile                                                          | Provider completes application fields. Evidence management remains available when `MANAGE_VERIFICATION` is granted.                        | Keep work denial separate from permission to supply evidence; submission still checks actual fields and terms.                               |
| Returned application; identity still in review                                    | Provider can return to the application while the reviewer handles identity.                                                                | Keep the application return path visible without manufacturing an identity approval.                                                         |
| **Returned application; identity VERIFIED; live grant**                           | **Provider chooses “Review and send application”; Admin reviews the new submission.**                                                      | Fixed provider dead end and misleading Admin “Rejected” presentation. Preserve existing identity/grant records.                              |
| Pending application; identity VERIFIED                                            | Provider follows application status; Admin decides the existing undecided submission when eligible.                                        | Fixed waiting-state navigation. Identity approval alone does not require a new application submission.                                       |
| ACCEPTED; identity VERIFIED; current work requirements met                        | Provider opens the workspace.                                                                                                              | Display effective server `SUBMIT_BID`, not grant presence alone.                                                                             |
| ACCEPTED; identity VERIFIED; current capabilities deny work because no live grant | Provider contacts support; an authorized operator investigates the work-access lifecycle and uses available server-authorized actions.     | Intended work gate when enforced. Uploading an extra document or changing the application cannot fabricate a grant.                          |
| Work grant revoked/expired; identity case still VERIFIED; work denied             | Provider sees verified identity with unavailable work and a support route.                                                                 | Preserve identity history; grant expiry is not identity-case expiry. Effective capabilities remain authoritative under existing enforcement. |
| Identity case EXPIRED / re-verification required                                  | Provider follows the offered new-case/re-verification flow.                                                                                | Keep this actionable case state distinct from a verified case whose grant lapsed; current-case truth must override stale profile metadata.   |
| Identity REJECTED                                                                 | Provider follows the server-permitted new-case route and supplies appropriate evidence.                                                    | Identity rejection is separate from a returned joining application.                                                                          |
| Identity ACTION_REQUIRED, even with CLEAN files                                   | Provider sees the reviewer reason and permitted replacement/resubmission controls.                                                         | Existing correction-context behavior is preserved even after a clean scan. CLEAN does not resolve a legibility or identity correction.       |
| Evidence PENDING scan                                                             | Scan worker processes it; provider waits for the current result.                                                                           | Upload/submit controls must not imply the scan has completed.                                                                                |
| Evidence QUARANTINED, SCAN_FAILED or REJECTED                                     | Provider replaces the unusable evidence for the required kind/category, when authorized.                                                   | Keep unsafe/unusable files out of review readiness and preserve private-file access controls.                                                |
| Policy requires no identity evidence                                              | Provider continues the application or workspace according to current capabilities; if work is denied for a missing grant, contact support. | Fixed the missing support destination for this no-document state. Application and work requirements still apply.                             |
| Account locked, inactive or deleted                                               | Authorized account/support handling; no provider mutation is invented.                                                                     | Intended highest-priority denial. A verified identity or live grant does not bypass it.                                                      |
| Provider suspended/terminated or otherwise restricted                             | Follow the precise server-permitted support/appeal/recovery action.                                                                        | Restrictions retain their existing authority; support navigation does not grant appeal or work permission.                                   |
| Provider withdraws a pending application                                          | Provider resumes and resubmits the DRAFT application.                                                                                      | Explain that next step even when the old undecided submission remains in history and produces `REVIEW_NOT_PENDING`.                          |
| Submitted content changed or snapshot unavailable                                 | Resolve the backend blocker and obtain a fresh provider submission where required; review that version.                                    | Preserve snapshot/revision checks. Do not approve a stale version or rewrite history to make it current.                                     |
| Submission already decided                                                        | Show the recorded decision; returned applications need a new submission, accepted applications retain their approval history.              | Explain the actual next actor rather than claiming the Admin lacks all permissions.                                                          |
| Reviewer lacks decision permission, evidence-view permission, or is the subject   | Explain the specific boundary; another authorized actor handles the restricted operation.                                                  | Distinguish permission scopes and self-review. Render only server-provided actions.                                                          |
| Refresh fails, session changes or data is cached                                  | Retry/refresh through existing error handling; preserve unsent review text and withhold stale actions.                                     | Earlier freshness and conflict protections remain in place; failed reads must not invent an onboarding state.                                |

Implementation owners: [verification view derivation](../../apps/web/src/app/features/provider-verification/verification-view-state.ts),
[provider screen](../../apps/web/src/app/features/provider-verification/components/ProviderVerificationScreen.tsx),
[case transition policy](../../apps/api/src/modules/provider/verification/policy/case-transitions.ts),
[submission readiness](../../apps/api/src/modules/provider/verification/case/submission-readiness.ts),
[Admin presentation helper](../../apps/web/src/app/features/admin-provider-review/application-presentation.ts)
and the Admin review policy above.

## Changes and safety boundaries

| Surface / path                                                                                                                                                                                                                                             | Scoped change                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ProviderVerificationScreen.tsx](../../apps/web/src/app/features/provider-verification/components/ProviderVerificationScreen.tsx)                                                                                                                          | Separates application continuation, pending status, workspace/support navigation and evidence mutations. Refreshes the case on focus and every 30 seconds while SUBMITTED, IN_REVIEW or VERIFIED; pending evidence retains its shorter poll. |
| [verification-view-state.ts](../../apps/web/src/app/features/provider-verification/verification-view-state.ts)                                                                                                                                             | Uses the current case for identity truth, effective capability for work truth, and preserves existing correction context for actionable evidence.                                                                                            |
| [provider-verification-copy.ts](../../apps/web/src/app/features/provider-verification/copy/provider-verification-copy.ts)                                                                                                                                  | Adds Arabic/English application continuation and waiting messages; removes the inaccurate assumption that every verified-but-blocked provider previously lost work access.                                                                   |
| [application-presentation.ts](../../apps/web/src/app/features/admin-provider-review/application-presentation.ts)                                                                                                                                           | Presents the application axis independently and explains absent actions, withdrawal, prior decisions and permission boundaries.                                                                                                              |
| [AdminProviderReviewWorkspace.tsx](../../apps/web/src/app/features/admin-provider-review/components/AdminProviderReviewWorkspace.tsx), [ReviewDecisionPanel.tsx](../../apps/web/src/app/features/admin-provider-review/components/ReviewDecisionPanel.tsx) | Shows returned application truth and the next actor. A live grant remains visibly separate from effective work access.                                                                                                                       |
| [ProviderDirectoryRow.tsx](../../apps/web/src/app/features/admin-directory/components/ProviderDirectoryRow.tsx) and the Admin copy modules                                                                                                                 | Uses the same application presentation in the directory and explains live-but-blocked grants.                                                                                                                                                |
| [provider-lifecycle-recovery.cases.ts](../../apps/web/e2e/provider-lifecycle-recovery.cases.ts), [real-API entrypoint](../../apps/web/e2e/admin-review-workflow.real-api.spec.ts), [CI artifact list](../../.github/workflows/ci.yml)                      | Adds real lifecycle regressions and retains their screenshots in the existing evidence job.                                                                                                                                                  |
| [Local Windows procedure](IDENTITY_RECOVERY_FIX.md#local-windows-test-procedure)                                                                                                                                                                           | Adds the missing database checkpoint, explicit stop-before-repair order, port-owner inspection, consistent API origin and persistent mail-key guidance.                                                                                      |

No backend policy, schema, migration, grant creation rule, authentication
boundary or evidence scanner behavior changes. No automatic application
resubmission, account activation or work grant is introduced. The existing
V2 flag default and legacy destinations are preserved; the local runbook
documents how the intended surface is selected.

Identity review, application review, service moderation and account standing
remain independently audited. Existing submission IDs, expected revisions,
idempotency keys, private evidence authorization and read-only handling during
failed refreshes remain authoritative. Tests must keep negative cases; a
successful happy path is not permission to bypass any of these gates.

## Acceptance harness and loading boundary

The first published candidate passed all 17 existing browser cases, but the
three new cases reached the unchanged 10/IP/minute login limit during setup.
They did not reach the lifecycle assertions. The independent lifecycle group
now waits 65 seconds before any new fixture or session, allowing the existing
window to expire naturally. Its successful path needs three Admin UI logins,
two Provider UI logins and at most one initial memoized Admin API login. No
rate bucket is cleared, no limit is raised, and no failure is retried into a
passing lifecycle result.

The next candidate exposed a separate Playwright hook budget: `beforeAll`
uses the project's 60-second timeout independently of the tests' inherited
240-second budget. The 65-second wait therefore timed out before any new
lifecycle body ran. That setup hook now explicitly allows 90 seconds; only
the three lifecycle tests explicitly retain a 240-second budget. Global
timeouts and the original 17 cases are unchanged. The history assertions use
the public nested `submission.id` contract while retaining the exact old/new
submission IDs, and pending navigation waits for the settled submitted hub
instead of accepting a loading screen. These are acceptance-harness repairs;
final execution and screenshot outcomes still belong to the PR evidence.

R27's actual API origin uses port 4327. The first candidate exceeded its shell
Brotli limit by 102 bytes there, despite passing the earlier port-4010 local
measurement. The final correction defers only the optional Admin denial display
through the existing lazy-page and standalone recovery boundary in
[route-guards.tsx](../../apps/web/src/lib/route-guards.tsx). All authentication
and role-check branches are unchanged; denied users still cannot import the
protected Admin page. This removes 2,604 raw shell bytes, rather than changing
the budget. New tests cover deferred loading and English/Arabic safe recovery
when that optional display fails to load.

## Existing evidence-safety controls, unchanged

Identity evidence stays in restricted storage. The authenticated
`GET /v1/verification/documents/:id/content` route streams authorized content;
it does not expose a public or signed bearer URL. Reads require CLEAN evidence
and either ownership or `verification:evidence:view`, subject to retention and
deletion checks. A durable access audit is required before content disclosure;
an audit-write outage denies the read. See the
[read controller](../../apps/api/src/modules/provider/verification/media/evidence-read.controller.ts)
and [read service](../../apps/api/src/modules/provider/verification/media/evidence-read.service.ts).

[File validation](../../apps/api/src/modules/provider/verification/media/evidence-validation.ts)
allows PDF, JPEG and PNG and checks nonempty/configured size, detected byte
signature, declared MIME type, any supplied filename extension and end markers.
These structural checks are separate from malware scanning. The workflow keeps
`PENDING`, `CLEAN`, `QUARANTINED`, `SCAN_FAILED` and `REJECTED` distinct; a failed
or incomplete scan does not become CLEAN. The production
[ClamAV adapter](../../apps/api/src/modules/provider/verification/media/clamav-scanner.adapter.ts)
requires a positive clean result. Browser CI uses the existing deterministic
test scanner, so it proves the upload/review workflow, not malware detection
quality or the user's local scanner configuration.

The Admin [PDF preview](../../apps/web/src/app/features/admin-provider-review/evidence/identity-pdf.ts)
renders document bytes to a bounded canvas with page/pixel limits and disabled
scripting, forms and remote-resource fetching. A successful scan or preview
still does not prove that the identity belongs to the applicant; that remains
the authorized reviewer's decision.

## Real-browser acceptance added

Execution results belong to the final-commit PR evidence linked above; the
following describes the assertions, not a substitute for running them.

The three new cases use real authenticated API setup and browser actions for
correction, file selection/upload, identity approval, application resubmission
and final approval. They do not inject browser sessions, mock network routes,
write lifecycle state with SQL or manufacture grants.

1. **Arabic recovery:** return an application for identity only; upload and
   approve identity; prove the live grant still does not allow bids; follow the
   visible provider continuation; submit a new application without irrelevant
   profile edits; Admin approves; bid access becomes allowed. Preserve the
   same identity decision, case and grant across resubmission/final approval.
2. **English recovery:** exercise the same lifecycle independently, including
   reload, pending-state navigation, keyboard activation and persisted audit
   history.
3. **Existing undecided application:** approve identity independently, then
   approve the same pending application without unnecessary resubmission.
   Assert that identity approval alone does not change application content or
   create a `SUBMITTED_CONTENT_CHANGED` blocker.

The screenshot plan covers provider continuation and returned Admin review at
**320, 390, 430, 768, 1024 and 1440 CSS px**, in **Arabic/RTL and English/LTR**.
The cases collect pending/active states, keyboard focus, touch-target size,
overflow checks, accessibility output and the supported Admin dark theme.
Screenshots still require human/model visual inspection after the final-SHA
run; their generation alone is not visual acceptance. Browser zoom evidence
at 200% remains to be recorded separately where applicable; viewport width
changes are not proof of browser zoom.

The execution environment reproduces Chromium Unix-socket `Operation not
permitted`; local browser acceptance is unavailable. The existing GitHub
real-API lane must provide the final runtime evidence. Its synthetic scanner
proves workflow behavior, not the user's local ClamAV detection quality.

## Verification record at this checkpoint

| Evidence                                                   | Observed result                                    | Scope / remaining work                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider regression run before the new production fix      | **20 failed / 132 passed**                         | Reproduction evidence; not a passing acceptance run.                                                                                                                    |
| Relevant web suites                                        | **71 files / 1,239 passed / 0 failed / 0 skipped** | Includes provider verification, Admin review/directory and onboarding.                                                                                                  |
| Provider-verification subset of that web run               | **192 passed**                                     | Includes the latest expiry/current-case regressions; not additional to the 1,239 total.                                                                                 |
| Admin review/directory subset of that web run              | **208 passed**                                     | Includes withdrawal, permission split and consistent application presentation; not additional to the 1,239 total.                                                       |
| Final routing, guard and provider-verification check       | **9 files / 223 passed / 0 failed / 0 skipped**    | Includes the 192 provider tests again; overlapping counts are not additive. Covers denial-chunk failure, route guards, Admin routes and onboarding layout preservation. |
| Existing backend guard suites                              | **5 suites / 297 passed / 0 failed / 0 skipped**   | Capability service/matrix, Admin review policy/service and onboarding wizard; backend code unchanged.                                                                   |
| Web lint                                                   | **0 errors / 34 existing warnings**                | Observed on the current local source.                                                                                                                                   |
| E2E TypeScript check                                       | **Passed**                                         | Confirms type compatibility; it does not execute the browser cases.                                                                                                     |
| Production build                                           | **Passed**                                         | TypeScript and Vite with `VITE_API_URL=http://127.0.0.1:4010` and V2 enabled; existing large-chunk warning retained.                                                    |
| R27 bundle budget                                          | **10 passed / 0 failed**                           | Actual port-4327 build: shell Brotli 188,920 bytes under the unchanged 189,440-byte limit; raw shell 673,021 bytes. Final-head remote gate still required.              |
| Three new real-API browser cases and screenshot inspection | **See final-commit PR evidence**                   | Require executed results and visual inspection; source and collection alone are not acceptance.                                                                         |
| Required remote checks and exact-SHA acceptance            | **See final-commit PR evidence**                   | Earlier commit results do not validate a later head.                                                                                                                    |

Backend command actually run:

```sh
pnpm --filter @homeservicemarketplace/api test --runInBand --runTestsByPath \
  src/modules/provider/capability/provider-capability.service.spec.ts \
  src/modules/provider/capability/provider-capability.matrix.spec.ts \
  src/modules/admin/provider-review/provider-review.policy.spec.ts \
  src/modules/admin/provider-review/provider-review.service.spec.ts \
  src/modules/provider/onboarding/provider-onboarding-wizard.service.spec.ts
```

The backend run retained the existing `ts-jest` `isolatedModules` deprecation
warning and expected restricted-avatar negative-test log. No tests were
skipped to make the run pass. The PR acceptance evidence records the actual final
SHA, CI links, final counts and which screenshots were inspected. It must be
updated after any further source commit.

## Rollout and rollback

Use the delivered source with the intended local API, schema and Vite process;
do not infer source parity from an already-open browser tab. Follow the linked
Windows procedure for startup and the current-case manual steps below it.
No merge or deployment is implied by this report.

Rollback is a scoped frontend/evidence-documentation revert and rebuild.
Preserve application submissions, identity decisions, grants, audit history
and uploaded evidence. Do not undo data decisions merely to roll back the UI.
