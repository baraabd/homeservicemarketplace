# Authentication — QA and login troubleshooting

Use this checklist to verify registration, password login, email OTP, sessions,
recovery and access to the Seeker, Provider and Admin experiences. A successful
password submission creates an **OTP challenge**. Authentication completes only
after the OTP is verified and `GET /v1/auth/me` succeeds.

This guide replaces the former direct-token login instructions. Keep
`AUTH_REQUIRE_EMAIL_VERIFICATION=true` for this acceptance flow. Do not activate
accounts with SQL, disable verification, seed an existing database, reset its
schema, or remove its volumes to repair a login problem. Provisioning a new
disposable database is a separate task. Hosted password resets, session
revocations and account/role changes must be deliberate owner/operator actions.

## 1. Identify the environment before testing

Record the checkout SHA, frontend URL, actual login request URL and, when
available, deployed frontend/API SHAs. A checkout, a successful CI run and a
production deployment are separate pieces of evidence.

| Target                          | Frontend                   | API origin                                                                      | Mail                                          |
| ------------------------------- | -------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| Local example in this checklist | `http://localhost:5173`    | `http://localhost:4010`                                                         | Mailpit at `http://localhost:8025`            |
| Hosted production               | `https://findservice.site` | Inspect Network; the configured hosted origin is `https://api.findservice.site` | Hosted SMTP delivery                          |
| Isolated authentication CI      | `http://127.0.0.1:4173`    | `http://127.0.0.1:4010`                                                         | Disposable Mailpit at `http://127.0.0.1:8025` |

- [ ] Run `git rev-parse HEAD` in the checkout being tested.
- [ ] Inspect the **Request URL** of `/v1/auth/login` in Network. Selecting a
      differently branded app does not select a different API or database.
- [ ] Use accounts provisioned in that environment. The same email in local and
      hosted databases does not imply the same account, password, roles or
      status. A seeded local password is not a production credential.
- [ ] Use the same host spelling throughout a local test: either `localhost` or
      `127.0.0.1`, consistently across frontend, API, CORS and mail links.
- [ ] Test accounts in separate browser profiles/private contexts, or finish
      logout before changing accounts. A Provider tab that remains signed in
      does not establish that a fresh Provider password login works.

`VITE_API_URL` is compiled into a production frontend build. Changing it in a
local PowerShell terminal does not change `findservice.site`. Restart local Vite
after its environment changes. Sources: [API client](../apps/web/src/lib/api.ts),
[Vite configuration](../apps/web/vite.config.ts) and
[release guidance](deployment/VERCEL_CD.md).

## 2. Prepare local services without replacing existing data

Use the Node and pnpm versions declared in `.nvmrc` and `package.json`. Keep the
existing database and credentials. For stale dependencies/generated Prisma code
after a checkout change, follow [workspace recovery](development/workspace-recovery.md).
Stop this checkout's watchers before `pnpm dev:repair` and stop at any failed stage.

For the local example, configure the API with these nonsecret settings alongside
its existing `DATABASE_URL` and authentication secret:

```dotenv
PORT=4010
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
AUTH_REQUIRE_EMAIL_VERIFICATION=true
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=noreply@homeservicemarketplace.local
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
```

These HTTP/cookie settings are local-only; retain hosted HTTPS/cookie protections.
A local process must not inherit a hosted `COOKIE_DOMAIN`. Configure SMTP on the
API: an in-memory test mail adapter cannot deliver an OTP to the browser user's
mailbox. Receiving actual mail is a separate check from readiness.

If the API is already listening and ready, use that process. Otherwise start the
local data services and one API watcher from the repository root:

```powershell
& {
    pnpm docker:up
    if ($LASTEXITCODE -ne 0) { throw "Local data services did not start." }

    $env:PORT = "4010"
    pnpm --filter @homeservicemarketplace/api dev
    if ($LASTEXITCODE -ne 0) { throw "API startup failed." }
}
```

Use a second terminal for the frontend:

```powershell
& {
    $hsmApiOrigin = "http://localhost:4010"
    $hsmReady = Invoke-RestMethod -Uri "$hsmApiOrigin/health/ready" -ErrorAction Stop
    if (-not $hsmReady.ready) { throw "API dependencies are not ready." }

    $env:VITE_API_URL = $hsmApiOrigin
    $env:VITE_PROVIDER_ONBOARDING_V2 = "true"
    pnpm --filter @homeservicemarketplace/web dev
    if ($LASTEXITCODE -ne 0) { throw "Web startup failed." }
}
```

The default API port is `4000` when not overridden; `4010` above is intentional.
If port `5173` is occupied, inspect the existing Vite terminal/process and stop
that checkout's old watcher before replacing it. Do not kill every Node process
or silently switch to an unrelated frontend.

### Health checks

- [ ] `GET http://localhost:4010/health/live` returns **200** with `status: "ok"`.
      Record `sourceSha` when populated; a null local value is not a failure.
- [ ] `GET http://localhost:4010/health/ready` returns **200**, `ready: true`, and
      every reported dependency `up`. PostgreSQL and Redis are checked; MongoDB
      appears only when enabled. Mailpit is not a readiness dependency.
- [ ] Open the app at `http://localhost:5173/select`.

Health paths are **not** prefixed with `/v1`. Opening API root `/` may return
**404 `Cannot GET /`** because it is not an application page. That response does
not establish a login failure. Health success establishes process/dependency
readiness, not account authentication or SMTP delivery.

Sources: [health controller](../apps/api/src/infrastructure/health/health.controller.ts)
and [health service](../apps/api/src/infrastructure/health/health.service.ts).

## 3. Registration and legal acceptance

Use a new, tester-controlled address in the intended test environment. Exercise
the signup UI so the actual consent and OTP screens are tested.

- [ ] The UI obtains current policy versions from `GET /v1/legal/documents`.
      Confirm `acceptanceOpen: true` and review the Terms and Privacy documents.
- [ ] Registration includes `email`, `password`, `firstName`, `lastName`, and
      `legalAcceptance` with `termsVersion`, `privacyVersion` and `locale`.
      Use the versions returned by the server and reviewed by the user, not
      copied constants. The password length contract is 12–128 characters.
- [ ] `POST /v1/auth/register` returns **202** with an OTP challenge:

```json
{
  "otpRequired": true,
  "challengeId": "<opaque challenge identifier>",
  "expiresInSeconds": 300,
  "codeLength": 6
}
```

- [ ] In a clean browser context, registration alone does not set authenticated
      session cookies or grant protected access. With verification enabled,
      the new account remains pending until its registration OTP is consumed.
- [ ] Open `http://localhost:8025`, find the message for this exact test address,
      and enter the current six-digit code in the app. Keep codes, reset links
      and mailbox contents out of issue reports.
- [ ] `POST /v1/auth/verify-otp` submits `{ challengeId, code }`, returns **200**,
      and creates the session. `/v1/auth/me` returns **200**, the expected account,
      `status: "ACTIVE"`, `emailVerifiedAt` and the server-assigned roles.
- [ ] A new public signup receives `customer`. Selecting an Admin/Provider theme
      is not a role grant; additional access follows authorized provisioning or
      onboarding.

Duplicate-email registration deliberately returns a similar opaque challenge
without creating another account or sending a registration OTP. A 202 alone is
not proof that an account or mail was created. For an existing account, use
login or the appropriate recovery flow.

For **409 `CONFLICT`**, inspect the structured reason. `LEGAL_VERSION_STALE`
requires reloading/reviewing the current policies. `LEGAL_ACCEPTANCE_CLOSED`
requires resolving the policy release state. Neither is a password failure or a
reason to bypass consent.

Sources: [registration DTO](../apps/api/src/modules/iam/authentication/dto/register.dto.ts),
[legal acceptance](../apps/api/src/modules/iam/legal/legal-acceptance.service.ts) and
[authentication service](../apps/api/src/modules/iam/authentication/services/authentication.service.ts).

## 4. Password → OTP → session for all three experiences

Repeat with each tester-controlled account. Select the intended app through
`/select`; all experiences share `/login` and the same API contract. Inspect
returned roles after authentication before attributing an access rejection to
the password form.

| Experience | Access to verify                            | Same authentication sequence |
| ---------- | ------------------------------------------- | ---------------------------- |
| Seeker     | Customer account and `/home`                | Password → email OTP → `/me` |
| Provider   | Provisioned `provider` role and `/provider` | Password → email OTP → `/me` |
| Admin      | Provisioned `admin` role and `/admin`       | Password → email OTP → `/me` |

- [ ] One form submission produces one `POST /v1/auth/login` carrying the
      credentials. Browser requests use `X-Client-Kind: web`.
- [ ] Valid credentials for an eligible, email-verified account return **200**
      with `otpRequired`, `challengeId`, `expiresInSeconds` and `codeLength`.
      This response contains no session tokens and does not itself authenticate
      the user. Confirm actual mail delivery separately.
- [ ] Complete `/v1/auth/verify-otp` using the new code from that environment's
      mailbox. A web success sets session cookies and returns `tokens: null`.
- [ ] `/v1/auth/me` succeeds and matches the intended account and roles. It must
      not expose password hashes, MFA secrets or raw session credentials.
- [ ] Open the intended app and a protected deep link; reload and confirm the
      session survives. A safe `returnTo` target is preserved.
- [ ] An account without Admin access cannot gain it by changing app selection,
      URL or browser storage. A role/access screen after `/me` succeeds is a
      different stage from a password-login **401**.
- [ ] Provider login, email verification, identity-document approval,
      application approval and permission to work remain distinct. Follow
      [provider lifecycle acceptance](provider-experience-v2/PROVIDER_LIFECYCLE_RECOVERY.md)
      to verify approval and work permissions after authentication.

Sources: [web auth client](../apps/web/src/lib/auth-api.ts),
[experience routing](../apps/web/src/lib/auth-experience.ts),
[route guards](../apps/web/src/lib/route-guards.tsx) and
[API controller](../apps/api/src/modules/iam/authentication/controllers/authentication.controller.ts).

### OTP recovery and negative cases

Run deliberate invalid-code, expiry and lockout tests only on disposable
accounts. Do not repeatedly submit incorrect credentials to real users' accounts.

- [ ] A wrong code returns `AUTH_OTP_INVALID`; attempts remain counted. The
      challenge ceiling produces `AUTH_OTP_LOCKED`.
- [ ] Resend uses `/v1/auth/resend-otp` with the same `challengeId`, returns
      **202**, and rotates the code. Only the newest code works. Resend retains
      attempt limits; an expired, consumed or locked challenge cannot create a
      session. Restart the appropriate login/recovery flow when necessary.
- [ ] For an existing unverified account, use **Request email verification**.
      `/v1/auth/resend-verification` sends an eligible account a verification
      link. `/v1/auth/verify-email` confirms email ownership but creates no
      session. Follow it with password login and its new OTP.
- [ ] A network failure gives a useful retry/recovery message. Clicking the
      button alone does not establish successful verification.

Sources: [OTP service](../apps/api/src/modules/iam/authentication/services/otp.service.ts)
and [error mapping](../apps/web/src/lib/auth-errors.ts).

## 5. Sessions, logout and password reset

### Browser and mobile sessions

- [ ] `hsm_at` and `hsm_rt` are HttpOnly cookies; `hsm_csrf` is readable by the
      frontend for its CSRF header. Do not copy cookie values into evidence or
      use localStorage as a token workaround.
- [ ] The refresh cookie is scoped to `/v1/auth/refresh` with `SameSite=Strict`.
      Cookie domain, secure flags and credentialed CORS match the chosen origins.
- [ ] `POST /v1/auth/refresh` rotates the session and protected requests continue
      to work. Cookie-based mutations carry the required `X-CSRF-Token` header.
- [ ] Normal logout returns **204**, clears the local session and prevents
      automatic restoration after reload. Other tabs observe logout. Test
      offline logout and refresh races in the isolated acceptance suite.
- [ ] Logout ends this device's session lineage; an independent device remains
      usable. `/v1/auth/logout-all` revokes all devices; exercise it only for the
      intended test account.

Mobile/API-client tests use `X-Client-Kind: mobile` consistently. Registration and
password login still return OTP challenges. Only successful `verify-otp` returns
the mobile `tokens` object; later requests use the access Bearer token and
refresh uses `X-Refresh-Token`. A mobile request cannot validate browser cookie
behavior.

Sources: [cookie helpers](../apps/api/src/modules/iam/authentication/helpers/cookies.ts),
[API client](../apps/web/src/lib/api.ts) and
[real cookie tests](../apps/web/e2e/auth-cookies.spec.ts).

### Password recovery

- [ ] Submit **Forgot password** for the tester-controlled account. **202** with
      `{ "success": true }` is returned for both known and unknown addresses;
      it proves neither account existence nor successful delivery.
- [ ] Receive the actual reset mail and open its link on the correct frontend.
      Check `FRONTEND_URL` if local mail opens a hosted app or an unexpected port.
- [ ] Submit through `/v1/auth/reset-password`; expect **200**. Reusing an expired
      or consumed link fails. Request a new link rather than editing the database.
- [ ] Previous sessions and outstanding OTPs no longer authenticate. Sign in
      with the new password and a fresh OTP, then verify `/me` and role access.
- [ ] Reset clears failed-password counters and timed lockout. It does not grant
      roles, approve Provider work, or reactivate suspended/inactive/deleted users.

Production reset, logout-all and account-status/role changes affect real users.
Perform them only as deliberate owner/operator recovery actions, not automatic
probes. Source: [authentication service](../apps/api/src/modules/iam/authentication/services/authentication.service.ts).

## 6. Triage one failing request before retrying

Preserve **origin, path, HTTP status, `error.code`, `error.requestId` and
timestamp** from the Network response. The console line or generic form message
alone cannot establish why the API refused a request. Correlate the request ID
with structured API logs/audit records. Redact email outside the authorized
support context and exclude passwords, OTPs, cookies, tokens and reset URLs.

| Evidence                                    | Interpretation and next check                                                                                                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No HTTP response / `ERR_CONNECTION_REFUSED` | Verify the exact API origin and listening/readiness checks.                                                                                                                                                    |
| API `/` returns 404                         | Use `/health/live` and `/health/ready`; open the frontend on its own port.                                                                                                                                     |
| Login **401 `AUTH_INVALID_CREDENTIALS`**    | May mean unknown account in this database, wrong password or ineligible/deleted account. Verify environment, then correlate account/audit state; the public response intentionally does not distinguish these. |
| Login **401 `AUTH_ACCOUNT_LOCKED`**         | A timed password lockout is active. Stop repeated attempts; use owner-controlled recovery or the configured waiting policy.                                                                                    |
| Login **403 `AUTH_ACCOUNT_UNVERIFIED`**     | Complete email-verification recovery, then password plus OTP.                                                                                                                                                  |
| Login **403 `AUTH_ACCOUNT_SUSPENDED`**      | An authorized operator must resolve account standing. Password reset does not undo suspension.                                                                                                                 |
| **429** / `RATE_LIMITED`                    | Honor `Retry-After` when present and the UI cooldown; do not widen production limits for a test.                                                                                                               |
| Login **200**, no email                     | A challenge response is not SMTP delivery proof. Check the correct mailbox and delivery diagnostics; use permitted resend.                                                                                     |
| OTP **400/403 `AUTH_OTP_*`**                | Inspect expiry, invalid code, replay, attempts or resend limits at the OTP stage.                                                                                                                              |
| OTP succeeds, then `/me` fails              | Check cookie rejection reasons, host/domain/Secure/SameSite/CORS and current session/account state.                                                                                                            |
| **400/403 `AUTH_CSRF_FAILED`**              | Inspect the browser cookie/header contract: refresh returns 400; guarded mutations return 403.                                                                                                                 |
| `/me` succeeds, destination denied          | Inspect current roles and route/API authorization; this is not a password failure.                                                                                                                             |

For one intentionally failing login on an isolated account, verify **one POST →
one 401**, with no automatic `/auth/refresh` call and no login replay. Login is
in the API client's `NO_RETRY_PATHS`; refresh cannot fix rejected credentials.
An unrelated initial `/me` check may have its own session-recovery request, so
inspect the initiator and sequence.

Audit metadata matters: the current service records `LOGIN_FAILED` with
`metadata.reason: "otp_challenge_issued"` when credentials are accepted but the
OTP has not yet been consumed. That event alone is not a bad password.
`LOGIN_SUCCESS` follows successful OTP/session creation.

### Read-only account-state inspection

Use the [login troubleshooting guide](auth-login-troubleshooting.md) for the
operator procedure. The helper must connect to **the same `DATABASE_URL` as the
affected API**. It inspects account facts and optional request-linked audit
records; it neither checks nor changes the password.

After the database package is built, a configured local checkout can use:

```powershell
$env:HSM_AUTH_DIAGNOSTIC_EMAIL = Read-Host "Account email to inspect in this environment"
node --env-file=.env scripts/diagnostics/auth-state.cjs
Remove-Item Env:HSM_AUTH_DIAGNOSTIC_EMAIL
```

`HSM_AUTH_DIAGNOSTIC_REQUEST_ID` is optional for bounded request-linked audit
inspection. In an already configured API environment, omit `--env-file=.env`.
Existing process variables take precedence over the env file, so verify the
intended database configuration without printing its credentials. Request audit
inspection covers the last 24 hours; no matching row does not prove that the
request never ran.
Run `node scripts/diagnostics/auth-state.cjs --help` for usage without a database
query. The helper uses a read-only transaction, excludes credential hashes and
connection strings, and reports `credentialsChecked: false`. It cannot prove
which password was typed or that a new login will succeed.

## 7. Repeatable automated verification

### Source-level checks

From the repository root, after dependency installation/generation:

```sh
pnpm --filter @homeservicemarketplace/api build:deps
node --test scripts/diagnostics/auth-state.test.cjs
pnpm --filter @homeservicemarketplace/web exec vitest run src/lib/auth- src/lib/api.test.ts src/lib/route-guards src/lib/use-auth-identity.test.ts src/lib/intended-app.test.ts src/app/components/auth/auth-otp.test.tsx src/app/pages/app-selector-routing.test.tsx src/app/routes.lazy.test.tsx
pnpm --filter @homeservicemarketplace/api exec jest --testPathPatterns='(modules/iam/(authentication|authorization)/.*\.spec\.ts|test/e2e/auth\.e2e\.spec\.ts)'
```

These tests use HTTP/repository doubles and validate source behavior; they do not
prove hosted credentials work. The full [CI workflow](../.github/workflows/ci.yml)
also runs lint, typechecking, builds, broader unit suites, real Postgres/Redis
integration and browser acceptance. Report skipped tests accurately; a suite
skipped for a missing service is not successful integration coverage.

### Real acceptance in a disposable environment

[Authentication lifecycle acceptance](../.github/workflows/auth-lifecycle.yml)
creates disposable Postgres, Redis and Mailpit, builds the API and SPA and runs:

```sh
pnpm --filter @homeservicemarketplace/api exec jest test/integration/r04-auth-lifecycle.integration.spec.ts test/integration/auth-state-diagnostic.integration.spec.ts --runInBand
node apps/web/scripts/r04-auth-acceptance.mjs
```

The workflow supplies `RUN_DB_INTEGRATION=1` for the first command. The second
script requires the GitHub-hosted isolated CI environment and `r04_auth_ci`
database. **Do not override those guards to target a developer or hosted
database.** It creates fixture accounts and roles; its isolated setup is not an
instruction to seed an existing database.

The cookie job in `ci.yml` supplies `E2E_REAL_API` and `E2E_MAILPIT` for its
disposable services before running:

```sh
pnpm --filter @homeservicemarketplace/web exec playwright test e2e/auth-cookies.spec.ts --project=chromium-desktop --workers=1
```

Without `E2E_REAL_API`, that suite skips. The lifecycle script drives the real
`/login` UI, SMTP OTP, `/me`, role-specific destinations and logout. Provider/Admin
fixture roles are provisioned server-side, not granted by registration. Its
report binds the result to `sourceSha` and identifies the isolated environment;
it is not acceptance of production users or data.

### Evidence to keep

- [ ] Source/deployment SHA, environment and actual API origin. Historical
      feature-branch evidence must not be presented as a newly executed test.
- [ ] All three experiences: credential response, OTP, `/me`, current roles,
      protected destination and logout.
- [ ] Workflow/run URL, exact SHA, test counts, skipped counts and sanitized
      reports/screenshots.
- [ ] Remaining blockers with structured code/request ID. Do not mark login
      accepted solely because health checks or a build succeeded.

Implementation references: [authentication controller](../apps/api/src/modules/iam/authentication/controllers/authentication.controller.ts),
[authentication service](../apps/api/src/modules/iam/authentication/services/authentication.service.ts),
[lifecycle regression tests](../apps/api/test/integration/r04-auth-lifecycle.integration.spec.ts)
and [real browser acceptance](../apps/web/scripts/r04-auth-acceptance.mjs).
