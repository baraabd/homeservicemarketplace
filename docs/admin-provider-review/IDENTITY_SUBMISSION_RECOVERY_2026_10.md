# Provider identity submission recovery

## Scope and starting state

Integration and Bug-Fix Mode. Baseline: `develop` at
`426d58fdaa8c0913fae8c88fed57f98658a75a33`. The affected journey starts in the
Admin identity task and continues through the provider's existing verification
screen. The Admin dossier layout is not redesigned.

The supplied Admin empty state is accurate when the provider has no verification
case: no identity request has been submitted. The “secure review” badge describes
the protected reader; it is not an access-denied error. A profile photo is not an
identity document. The repair enables the provider to supply the missing evidence
without weakening the final approval requirements.

## Findings and changes

| Boundary                 | Defect                                                                                                                                                                                                                              | Repair                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider capability      | The screen treated the overall `ONBOARDING_INCOMPLETE` work blocker as a prohibition on verification, even when the server granted `MANAGE_VERIFICATION`. Returning an application could therefore hide the correction task itself. | Honor the specific server capability while retaining account/standing restrictions and work-access separation.                                                            |
| Correction submission    | `ACTION_REQUIRED` retained the replacement screen but offered no resubmission action after clean evidence was available.                                                                                                            | Keep the correction reason and replacement controls; offer submission only when the server includes `submit` and the displayed required documents are ready.              |
| Scan progress            | A document still being scanned counted as a missing upload and the open screen did not observe worker completion.                                                                                                                   | Display the scan state and poll the current case while current evidence is `PENDING`; stop on an error, denial, or completed scan.                                        |
| Upload targeting         | The fallback upload action invented an individual-ID target and the visually hidden native picker could be reached before a document target was selected.                                                                           | Derive the kind/category from the server requirements or document being replaced, and open the hidden picker from named visible actions.                                  |
| First-case submission    | The case workflow loaded only approved specialty memberships. A genuine pending specialty application became a false `serviceCategories: REQUIRED` blocker, returning HTTP 422 after a successful identity upload.                  | Include the count of `PENDING`, non-superseded category applications in the existing onboarding candidate. The shared readiness policy remains unchanged.                 |
| Failure recovery         | Start/submit failures had no useful feedback; missing application information or consent offered no route back.                                                                                                                     | Localized safe messages, with an application link for the server's known onboarding/consent blockers. Unknown errors use a generic message without exposing server prose. |
| Application continuation | Submitting identity could leave a returned application waiting for a separate resubmission without explaining that step.                                                                                                            | Explain the next step when the server still reports incomplete onboarding and grants `COMPLETE_ONBOARDING`; link to the existing application flow.                        |
| Default-off entry        | The legacy status surface lacked a direct identity entry.                                                                                                                                                                           | Add “Identity documents” / “وثائق الهوية” only when the server grants `MANAGE_VERIFICATION`.                                                                              |

## State and security ownership

The normal correction journey is:

1. Admin requests identity evidence through the existing provider-visible
   correction action. The application becomes `RETURNED`.
2. The provider opens the linked verification task, starts a case if necessary,
   and uploads the actual document through prepare/content/finalize.
3. The scanner processes the uploaded bytes. Pending or unusable evidence cannot
   be submitted through the readiness action.
4. The provider submits the initial case or the corrected existing case. Identity
   is now awaiting review; this does not approve or resubmit the application.
5. The provider returns to the application and sends its corrected version for
   review. Admin reviews the current identity, specialties, and application before
   the existing final decision can grant work access.

Pending specialties satisfy the fact that the provider has selected a specialty;
they still require the platform's moderation decision. Missing, rejected-only,
superseded-only, or approved application records without actual membership do not
become approved specialties. Other onboarding and consent requirements continue
to block identity submission when applicable.

The restricted evidence endpoint, fresh authorization, ownership, scan/retention
checks, audit-before-disclosure, and `Cache-Control: no-store` are unchanged.
No schema, dependency, feature-flag default, permission, approval policy, or work
grant is modified by this repair.

## Routes and rollout configuration

- Identity is served at `/provider/verification` in both onboarding versions.
- V2 uses the existing returned-feedback link and returns to `/provider/onboarding`.
- V1 uses the new capability-controlled status action and returns to `/provider/profile`.
- `VITE_PROVIDER_ONBOARDING_V2` remains default off. The existing nonempty browser
  override `hsm.ff.providerOnboardingV2` takes precedence over the build value.
  The override changes presentation, not server authorization.

Build compatible API and Web artifacts together. No new migration or data repair
is required. The user's local Windows environment, its flag override, database,
and evidence volume were not available to this authoring environment; test
accounts and files are synthetic. Deploying this change does not create identity
documents or make an approval decision for an existing account.

## Verification record

The final results and remaining remote gates are recorded in the pull request.
Local validation uses the pinned Node 24.21.0 and pnpm 10.32.1 toolchain.

- Full Web unit suite: 226 files, 2729 tests passed, no skips.
- Workflow/readiness unit suites: 79 tests passed. The new regressions cover
  initial submission, resubmission, missing specialties, and independent missing
  profile requirements; three of them reproduced the defect before the fix.
- Real PostgreSQL/HTTP workflow and protected-reader integration: 87 tests passed
  across two suites. These exercise the actual filtered relation count, including
  pending, rejected, superseded, and missing specialty records, plus permissions,
  ownership, audit persistence, and prohibited scan/retention states.
- Existing bilingual verification browser suite: 83 passed; 10 pre-existing
  desktop/tablet skips for phone-only cases. No skips or tolerances were added.
- The existing Admin real-API correction entrypoint passed all three scoped
  cases: Arabic first identity at 390px, English identity replacement at 1440px,
  and the existing Arabic portfolio correction. It is extended through actual
  provider upload, worker completion, case submission, protected Admin reads,
  application continuation, and the default-off entry. It uses real cookies,
  CSRF, PostgreSQL, Redis, SMTP capture, and the built SPA; there are no request
  stubs or injected approvals in the browser correction helper.

Screenshots were inspected for Arabic readiness and submitted/return states,
English correction/resubmission, and both language versions of the legacy entry.
The final visual adjustment makes replacement secondary when resubmission is
available, leaving one dominant submit action; the 144 verification feature tests
and production build were rerun after that adjustment.

Commands (with the isolated test services and documented environment configured):

```sh
pnpm --filter @homeservicemarketplace/web test:ci
pnpm --filter @homeservicemarketplace/api exec jest --testPathPatterns='verification-case-workflow.service|submission-readiness'
RUN_DB_INTEGRATION=1 pnpm --filter @homeservicemarketplace/api exec jest --testPathPatterns='evidence-read-boundary.integration|verification-case-workflow.integration'
pnpm --filter @homeservicemarketplace/web lint
pnpm --filter @homeservicemarketplace/web typecheck:e2e
pnpm --filter @homeservicemarketplace/api build
pnpm --filter @homeservicemarketplace/web build
pnpm --filter @homeservicemarketplace/web exec playwright test e2e/provider-verification.spec.ts
pnpm --filter @homeservicemarketplace/web exec playwright test e2e/admin-review-workflow.real-api.spec.ts --project=chromium-desktop --workers=1 --grep='protected media correction'
```

Local browser commands additionally select the temporary Chrome configuration
described below. Web lint completed with zero errors and 34 existing warnings.
The production Web build retains its existing large-chunk warning. Scoped lint
and formatting cover the changed API, Web and browser-test files.

The local Playwright CDN download returned an invalid archive. A temporary local
configuration used installed Google Chrome 156.0.8078.47, with trace/screenshots
enabled and video disabled because the bundled ffmpeg was unavailable. Repository
Playwright configuration and CI browser pin are unchanged. The environment's
existing proxy CA was trusted by Chrome; TLS verification was not disabled for
acceptance. Official pinned-browser CI remains a separate gate.

The disposable runtime uses the test scanner adapter with its real scheduled
worker. This proves the evidence workflow and scan-state handling, not malware
detection by ClamAV. The separate scanner jobs remain required for that claim.
