# Provider identity verification: recovery and local acceptance

## Scope and baseline

Mode A — Integration and Bug-Fix. This change repairs the provider's route into
identity verification and its recovery when a provider profile or verification
permission is not yet available. It also corrects the invalid HTML nesting in
the identity-correction notice shown in the report.

Branch: `fix/provider-verification-onboarding-recovery-20261109`.

Base: `9569fec8051b5227d4e11da99d78de6ad9fcc504` on `develop`, which includes
merged PR #222. The PR body records the final tested SHA and remote evidence;
this file does not embed its own future commit hash.

The reported local page is `/provider/verification` on `localhost:5173`. It
shows “Finish your profile first” / “أكمل ملفك أولًا”, no document picker, and a
“Continue sign-up” / “متابعة التسجيل” action that does not navigate. The console
also shows refused requests to port 4000 and a `validateDOMNesting` warning.

The old correction label and the visible incomplete-state button differ from
the merged baseline's rendering. This establishes a source/runtime difference,
but does not establish the SHA running on the user's machine. Updating GitHub
does not update an already running local checkout or Vite process.

## Root causes and intended behavior

| Boundary                            | Defect or gap                                                                                                                                                                   | Correct behavior                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capabilities to private case read   | The case request ran before permission was resolved, although the endpoint requires `MANAGE_VERIFICATION`. An expected denial could replace recovery with a generic load error. | Read capabilities first; only request the guarded case when the server permits it. Do not use a cached case after permission is withheld.               |
| Incomplete application recovery     | The copy advertised a registration action, but the handler had no navigation branch and the button was gated by document-management permission.                                 | Keep authorized onboarding navigation separate from document mutations.                                                                                 |
| Account without a provider profile  | No-profile state was not projected as incomplete; the case request could fail before activation was reachable.                                                                  | Respect `NO_PROVIDER_PROFILE` and the server's `COMPLETE_PROFILE` next action; use the existing activation entry.                                       |
| Cached capabilities and case        | The application's five-minute cache can retain a pre-activation decision or an earlier case state on reentry.                                                                   | Reuse the canonical fresh-capability hook; refresh the case on entry and wait for this visit's responses before displaying cached documents or actions. |
| Existing DRAFT or RETURNED provider | Previous browser setup completed all provider-controlled fields before testing corrections.                                                                                     | Prove that a fresh, incomplete DRAFT with server-granted `MANAGE_VERIFICATION` can start and upload identity evidence.                                  |
| Connectivity                        | The screenshot contains `ERR_CONNECTION_REFUSED` for authentication requests on port 4000. These entries alone do not explain the displayed capability state.                   | Verify the intended API origin and live process; show failed capability requests as errors with retry, never as an invented onboarding state.           |
| Correction notice markup            | `ReviewFeedback` supplied a `div` inside the alert's paragraph.                                                                                                                 | Use phrasing content with the same flex styling and text, avoiding invalid paragraph nesting.                                                           |

The backend already grants `MANAGE_VERIFICATION` before the onboarding
completion check to an eligible profile holder who is not suspended or
terminated. Creating a case and uploading evidence do not require approval to
work. Submitting evidence still validates provider-controlled profile fields,
current terms and usable scan results. There is no circular requirement to
approve identity before permitting identity upload.

No backend policy, contract, schema, migration, storage boundary, scanner
configuration or work-access grant is changed by this repair.

## Acceptance cases

1. A signed-in account without a provider profile can leave verification through
   the advertised registration action and create its profile through the real
   activation and session-refresh flow.
2. A newly created DRAFT with incomplete fields sees “Start verification”, then
   “Add a document”, while work access remains unavailable.
3. The actual JPEG/PNG/PDF upload is persisted. A hard reload retains the
   document and its processing state.
4. If profile fields or terms are missing, submission explains the server's
   blockers and its return action reaches the application. Existing uploaded
   evidence is retained.
5. Once those prerequisites are fulfilled, the browser can submit the case and
   reaches the submitted state and application-return action.
6. Existing returned-application, replacement, protected Admin review and final
   approval scenarios continue to pass.
7. Missing permission, suspended/closed accounts and failed API requests never
   manufacture document-management permission in the client.
8. Arabic/mobile and English/desktop evidence is inspected for usable actions,
   wrapping and overflow. Recovery destinations respect the existing V2 flag.

## Local Windows test procedure

These commands are reviewed against the repository. They have not been run on
the user's Windows machine. Use a disposable local account and a synthetic
identity document for acceptance.

### 1. Run the delivered source

From the repository root, inspect the current work before changing branches:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git fetch origin
```

With a clean working tree, the published fix can be tested before merge:

```powershell
git switch --track origin/fix/provider-verification-onboarding-recovery-20261109
```

If that local branch already exists, use `git switch` with its local name and
then `git pull --ff-only`. After the fix is merged, a clean `develop` checkout
can instead be updated with `git pull --ff-only`. Preserve uncommitted work;
do not use reset, clean or forced checkout to apply this repair.

Stop this checkout's existing API and Vite watchers using Ctrl+C in their own
terminals. The repository pins Node 24.21.0 and pnpm 10.32.1:

```powershell
node --version
pnpm --version
Get-NetTCPConnection -State Listen -LocalPort 4000,4010,5173 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

An unrelated listener on 4000 can be left in place by choosing 4010
consistently for this API. Do not kill all Node processes.

### 2. Repair workspace dependencies and start data services

```powershell
pnpm dev:repair
if ($LASTEXITCODE -ne 0) { throw "Workspace recovery failed." }

pnpm docker:up
if ($LASTEXITCODE -ne 0) { throw "Local data services did not start." }
```

`dev:repair` installs the frozen dependency set, regenerates Prisma and checks
the workspace. It preserves environment files, uploads and database data; it
does not reset or migrate the database. `docker:up` starts PostgreSQL, Redis
and Mailpit, not another API process or the evidence scanner.

### 3. Start the API with a real local scanner

For the existing native local setup whose intended configuration is the root
`.env`, use the repository's existing opt-in review launcher:

```powershell
$env:PORT = "4000"
$env:FRONTEND_URL = "http://localhost:5173"
$env:PUBLIC_API_URL = "http://localhost:4000"

node --env-file=.env scripts/dev/review-runtime.cjs
```

The launcher validates local development, local PostgreSQL and local storage;
starts the separate `hsm-review` ClamAV service; waits for scanner health; and
runs the API with the real scan worker enabled. It does not seed, migrate,
remove volumes, change storage roots or edit environment files.

`--env-file=.env` makes that file's values process environment. If this checkout
deliberately uses a different native-local configuration file, preserve that
selection instead of accidentally changing its database or storage mapping.

The ordinary example configuration uses scanner `none` and disables its worker.
An API that boots with those settings does not prove that uploaded evidence can
finish scanning. Do not use the deterministic CI test scanner for manual safety
acceptance.

### 4. Check readiness and start Vite with the same API origin

In a separate PowerShell terminal at the same repository root:

```powershell
$hsmApiOrigin = "http://localhost:4000"
$hsmReady = Invoke-RestMethod -Uri "$hsmApiOrigin/health/ready"
if (-not $hsmReady.ready) { throw "API dependencies are not ready." }

$env:VITE_API_URL = $hsmApiOrigin
$env:VITE_PROVIDER_ONBOARDING_V2 = "true"
pnpm --filter @homeservicemarketplace/web dev
```

If choosing port 4010, use 4010 for `PORT`, `PUBLIC_API_URL` and
`$hsmApiOrigin`. Open `http://localhost:5173`; use the same host spelling for
browser and API origins. The health endpoint is `/health/ready`, not `/healthz`.

The per-browser `hsm.ff.providerOnboardingV2` preference overrides the build
environment. To return only that preference to the configured default:

```javascript
localStorage.removeItem('hsm.ff.providerOnboardingV2');
location.reload();
```

This does not clear sign-in cookies or other preferences. Restart Vite after
changing its environment. The flag chooses UI routing and cannot grant server
permissions.

### 5. Verify the complete provider/Admin journey

- Sign in. Authentication requests must reach the selected API without
  `ERR_CONNECTION_REFUSED`.
- Open the returned application's **رفع وثائق الهوية** action. For a fresh
  account, first exercise verification's registration recovery and create the
  provider profile through the displayed UI.
- An eligible DRAFT/RETURNED profile's successful capabilities response must
  include `MANAGE_VERIFICATION`, even with reason `ONBOARDING_INCOMPLETE`.
- Use **ابدأ التوثيق**, then **إضافة مستند**, and choose a synthetic supported
  file. Confirm that its actual upload finishes and its scan state changes.
- Reload and verify the document persists. A successful scan is separate from
  identity approval.
- Complete any profile/terms blockers through the working return action, then
  send the identity case for review.
- Return to the onboarding application and resubmit it if it was returned for
  corrections.
- Open the protected document as the authorized Admin and complete review.
  Confirm that application approval and work access follow their server rules.

## Verification record

Before the production markup change, the new nesting regression failed:
1 failed / 16 passed. After the scoped repair: 17 passed / 0 failed.

The verification recovery assertions first produced 17 failed / 114 passed
against the baseline implementation. Two additional warm-cache assertions
failed before the cache correction. The final verification/view/copy/task run
passed 181 tests across four suites, with no failures or skips:

```sh
pnpm --filter @homeservicemarketplace/web exec vitest run \
  src/app/features/provider-verification/components/ProviderVerificationScreen.test.tsx \
  src/app/features/provider-verification/verification-view-state.test.ts \
  src/app/features/provider-verification/copy/provider-verification-copy.test.ts \
  src/app/features/provider-onboarding-v2/components/OnboardingTaskScreen.test.tsx

pnpm --filter @homeservicemarketplace/web exec vitest run \
  src/app/features/provider-onboarding-v2/components/ReviewFeedback.test.tsx
```

Together these are 198 focused web tests across five suites. E2E TypeScript,
the production web build and its TypeScript build pass. Web lint has 0 errors
and 34 existing warnings. The production build retains its existing large-chunk
warning. The unchanged bundle gate passes 10/10 checks; shell Brotli is
189,266 bytes against a 189,440-byte ceiling.

The new browser cases are in `e2e/provider-verification-recovery.cases.ts`,
imported by the existing real-API Admin entrypoint. Collection includes all
15 existing cases plus two new cases. They use the V2 build environment with
no browser flag override; component navigation tests also cover V2 disabled.
The rollout default and browser-override precedence are unchanged.

Executed API command:

```sh
pnpm --filter @homeservicemarketplace/api test --runInBand --runTestsByPath \
  src/modules/provider/capability/provider-capability.service.spec.ts \
  src/modules/provider/capability/provider-capability.matrix.spec.ts \
  src/modules/provider/verification/case/submission-readiness.spec.ts
```

Result: 3 suites, 159 tests passed, 0 failed or skipped. Database/contracts
dependency builds passed. Existing warning: ts-jest `isolatedModules` setting
deprecation.

The PR acceptance section records the remaining focused checks, real-browser
results, inspected screenshots and final-SHA CI. Local browser execution has a
previously reproduced Chromium Unix-socket restriction; remote real-API browser
evidence must be obtained before claiming that boundary passed. CI's synthetic
test scanner establishes workflow behavior, not the user's live ClamAV setup.

## Rollback

Revert the scoped frontend change and rebuild the prior bundle. No data
migration is involved. Preserve uploaded documents, decisions, audit records
and storage directories. If the optional manual-test scanner is no longer
needed, stop only that service:

```powershell
docker compose -p hsm-review -f infra/docker/docker-compose.review.yml stop clamav
```
