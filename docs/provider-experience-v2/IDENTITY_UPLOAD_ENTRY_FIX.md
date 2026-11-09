# Identity upload entry from requested corrections

## Scope and finding

Mode A — Integration and Bug-Fix. This change addresses the reported Provider
Onboarding V2 Basics screen, where an administrator requested an identity document
but the provider saw profile-photo controls and a generic task-review button.

Baseline: `31c60dc0bc51cee6285cf84d2eebfc7825f08d7d` on `develop`.

The private uploader already exists at `/provider/verification`. The existing
`feedbackTaskPath` resolver already sends `identityDocument`,
`verificationDocuments`, and `categoryLicense` corrections there. The defect is
the action label: it says “Review this task: Basic details”, although the action
opens verification. The Basics editor itself owns the public profile photo,
display name, and phone. A profile photo is not an identity document.

The supplied screenshot is the before-state reference. It contains user data and
is intentionally not copied into the repository. New browser evidence uses only
synthetic accounts and documents.

## Resulting interface

| Correction                                 | English action                | Arabic action               | Destination                        |
| ------------------------------------------ | ----------------------------- | --------------------------- | ---------------------------------- |
| Identity document                          | Upload identity documents     | رفع وثائق الهوية            | `/provider/verification`           |
| Verification documents or category license | Upload verification documents | رفع وثائق التوثيق           | `/provider/verification`           |
| Ordinary task field                        | Existing task review action   | Existing task review action | Existing field-specific task route |

Document corrections also explain that verification files are private and
separate from the profile photo customers see. The same
feedback component serves the task screen and hub. Existing button components,
typography tokens, layout, and the separate generic Basics verification link are
preserved.

The identity file picker now advertises JPEG, PNG, and PDF, matching the API's
existing allowlist. WebP remains unchanged for public profile photos; it is
removed only from the identity picker, where the API does not accept it.

## Integration and security boundaries

The existing `onOpen` callback still passes through the task screen's autosave
exit controller. Pending profile edits finish before navigation. The destination
continues to derive its actions from the server's verification case and
`MANAGE_VERIFICATION` capability. A link never grants upload or work permission.

On the destination, a new case offers Start verification, then Add a document.
A returned case offers Replace the document. Existing upload preparation,
authenticated content upload, finalization, scan-state polling, and submission
remain unchanged. A returned onboarding application still needs its own review
and resubmission after the identity document is sent.

There are no API, database, migration, scanner, permission, or feature-flag
changes. No second uploader is added to the profile-photo editor. This does not
assert which bundle or scanner configuration the user's live deployment runs.

## Regression evidence

The new assertions were run against the baseline production components before
restoring the fix: **14 failed and 84 passed**. Failures identified the absent
explicit document actions/hints and the picker advertising unsupported WebP.
With the fix, **all 98 tests in the three affected component suites pass**.

```bash
pnpm --filter @homeservicemarketplace/web exec vitest run \
  src/app/features/provider-onboarding-v2/components/ReviewFeedback.test.tsx \
  src/app/features/provider-onboarding-v2/components/OnboardingTaskScreen.test.tsx \
  src/app/features/provider-verification/components/ProviderVerificationScreen.test.tsx
pnpm --filter @homeservicemarketplace/web typecheck:e2e
pnpm --filter @homeservicemarketplace/web lint
pnpm --filter @homeservicemarketplace/web build
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/api build
```

Local results: component tests, E2E TypeScript, web TypeScript/production build,
Prisma generation, API build, and formatting pass. Web lint reports zero errors
and 34 existing warnings outside the changed implementation. The pinned runtime
is Node 24.21.0 and pnpm 10.32.1.

The existing real-API media correction cases now start from the actual Basics
task for identity corrections. They assert the named action beside the avatar
controls, capture the rendered screen, check horizontal overflow, and continue
through the existing complete upload, submission, protected Admin inspection,
and onboarding resubmission helper. Arabic first upload at 390px and English
replacement at 1440px are covered. The portfolio correction and legacy flag-off
assertions remain intact.

```bash
pnpm --filter @homeservicemarketplace/web exec playwright test \
  e2e/admin-review-workflow.real-api.spec.ts \
  --project=chromium-desktop --workers=1
```

Local browser execution is blocked before any scenario runs: the pinned browser
download returned a truncated archive, and the installed Chromium cannot create
its required Unix socket in this execution environment. The isolated API, SPA,
PostgreSQL, Redis, and Mailpit started successfully; that is not an end-to-end
pass. A temporary local browser configuration was tried outside the repository;
the committed Playwright configuration and all CI gates remain unchanged.

The PR's final-SHA CI result and `admin-review-real-api-evidence` artifact are the
source of browser acceptance. Review the captured Basics and verification screens
before marking visual verification complete. The disposable test scanner checks
the integration lifecycle; it is not evidence of production malware detection.

## Bundle acceptance

The first remote candidate passed all 21 main-CI jobs and all 15 real Admin
browser scenarios, but R27 found a 61-byte shell Brotli excess over the unchanged
185 KiB ceiling. Shell raw size was unchanged; changed lazy-chunk references
affected the compressed shell. The final copy is concise and lives in
`verification-correction-copy.ts`, consumed only by the correction component,
instead of expanding the dictionary shared with status and page-title routes.
Route declarations and all budget definitions remain unchanged.

The production bundle measurement now reports **189,408 shell Brotli bytes**
against **189,440 bytes** allowed; all **10 bundle checks pass** locally. The
margin is small (32 bytes), so subsequent frontend changes must retain the
existing measurement gate. This is a transfer-size result, not a page-speed
claim. The final-SHA remote results and screenshots remain authoritative in the
PR.

```bash
VITE_API_URL=http://127.0.0.1:4327 node scripts/perf/post-r18/bundle-report.mjs \
  --label identity-entry --out-json /tmp/identity-entry-bundle.json
node scripts/perf/post-r18/check-budgets.mjs --bundle /tmp/identity-entry-bundle.json
```

## Rollout and rollback

Build and release the corrected web bundle through the normal process. Keep the
deployment's existing onboarding flag choice; no activation or schema migration
is required by this fix. A rollback restores the prior frontend commit and
rebuilds the bundle. The previous generic button remains a usable route to
`/provider/verification` until the updated frontend is released.

Merge/deployment and verification of the user's live bundle are separate from
this scoped implementation. Final CI and rollout status belong in the PR and
delivery report.
