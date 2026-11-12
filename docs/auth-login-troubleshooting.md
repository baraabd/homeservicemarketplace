# Login diagnosis and recovery

Scope: password login, email OTP, session creation and role-specific navigation
for Seeker, Provider and Admin. This is an integration/bug-fix change; it does not
change account eligibility, passwords, roles, public API contracts or migrations.

## Investigation: 11 November 2026

The reported screenshots contain two different targets:

| Observation                                                                             | Meaning                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http://localhost:4010/` returns `404 Cannot GET /`                                     | This is the API origin. It does not serve a frontend homepage. Test `/health/ready`; open the local UI on port `5173`.                               |
| Hosted login sends `POST https://api.findservice.site/v1/auth/login` and receives `401` | The hosted API received and refused the credential attempt. Local PowerShell settings do not change that hosted request.                             |
| A Provider page opens while Admin/Seeker login fails                                    | An existing Provider session and a fresh credential login are different checks. Complete a new login and OTP on the same API before comparing roles. |

Read-only deployment inspection established these facts at the time of the
investigation:

- The `findservice.site` production alias targeted Vercel deployment
  `dpl_7tbPAj2nBJkRpNFZjuzh3oVwewhD`, created on 4 November, from commit
  `412fe72259766b619676a75a200d800b32948f99`.
- Its publicly served `bootstrap-CBqTh5qA.js` compiled
  `https://api.findservice.site` as its API origin.
- The Railway service for `api.findservice.site` also ran commit `412fe722…`,
  deployment `688514d6-8a33-4c5f-96e5-72cb97494caf`, with status `SUCCESS`.
  The API, Postgres and Redis replicas were online.
- In the bounded 01:00–03:05 UTC log window on 11 November, the API received nine
  login POSTs returning `401`; their CORS preflights returned `204`. These logs
  establish the reached environment and HTTP outcome, not the submitted account
  or the exact credential failure reason.
- [PR 223](https://github.com/baraabd/homeservicemarketplace/pull/223) was merged
  into `develop` on 10 November as `fca0f1c238616602865aa4620092f68bfbb77b87`.
  Its tracked tree equals recovery head `89e515aa…`. The production deployments
  above predate that change.
- The complete `AuthenticationService.login`, `authApi.login` and `LoginScreen`
  implementations were identical in production source `412fe722…`, the recovery
  base `9569fec8…`, recovery head `89e515aa…` and merged `fca0f1c2…`.
  PR 223's optional Admin denial component was lazily loaded; its role and
  authentication conditions were unchanged.

Evidence references:

- [Vercel production deployment](https://vercel.com/baraa-abdullatifs-projects/homeservicemarketplace-web/7tbPAj2nBJkRpNFZjuzh3oVwewhD)
- [Railway API service](https://railway.com/project/973a2ccd-734f-460a-b3d2-50a9d9d965bb/service/29b47a8a-d301-4dda-a790-4e681f02f63c?environmentId=f18cfb42-dde7-4e0f-aa68-7fc1a5db058b)
- [Merged-source authentication acceptance](https://github.com/baraabd/homeservicemarketplace/actions/runs/42812385405)
- [Merged-source comprehensive CI](https://github.com/baraabd/homeservicemarketplace/actions/runs/42812385356)

These observations exclude the provider-recovery code change as the cause of
the reported production login refusal. They do **not** establish that a given
production account is absent or that the submitted password is wrong. No
production password probe, seed, reset, account mutation or deployment was
performed during this investigation. Account-level production evidence requires
an authorized read of the affected database or the actual structured response.

## Changes in this repair

The new browser acceptance case reproduced another existing UI defect. The phone
container in `Root.tsx` used `key={lang}` inside an exit animation. Switching language
therefore destroyed and recreated the routed screen after the animation, losing
entered credentials or an in-memory OTP challenge. The outgoing form could still
receive input before it disappeared, making a retry seem unresponsive. The shell
now keeps a stable key while its text, direction and font update in place. A
regression test includes the real root shell, and browser acceptance keeps the
real Arabic retry click and its exact request/response assertions. This UI defect
is independently reproduced; it does not identify why a particular production
credential request returned `401`.

1. `LoginScreen` offers **Request email verification** only for
   `AUTH_ACCOUNT_UNVERIFIED`. Previously any form error, including an incorrect
   password, connection failure or temporary lock, displayed this unrelated
   recovery action.
2. Editing either credential, retrying or returning from OTP clears stale recovery
   state. A delayed response for an edited credential draft cannot install the
   previous draft's recovery action or OTP challenge. The request guard is
   released in `finally`, so the next attempt remains usable.
3. Each auth endpoint's no-refresh/no-retry behavior now has an independent
   assertion. The earlier test cleared request history between endpoints and
   only asserted the last iteration.
4. The operator-only diagnostic below reports database facts without changing
   accounts or testing passwords. It does not introduce a public diagnostic API.
5. [The QA checklist](auth-qa-checklist.md) now describes the actual legal
   acceptance, password → OTP → session flow and environment boundaries.
   Obsolete direct-token and SQL-activation instructions were removed.
6. The full and production dependency audits discovered four Mongoose advisories
   published on 10 November. The API dependency and lockfile move from 8.24.4 to
   8.24.7, with mquery 5.0.1, the smallest fixed 8.x versions. Unrelated locked
   resolutions are retained and no audit rule is relaxed. See the
   [official Mongoose release](https://github.com/Automattic/mongoose/releases/tag/8.24.7).
   This audit finding does not establish the cause of the production login refusal.

## First identify the failing boundary

All three branded experiences submit the same `{ email, password }` contract to
`POST /v1/auth/login`. The selected app controls presentation and navigation; it
does not select a database or grant a role.

With valid credentials and acceptable account standing, login returns an OTP
challenge. `POST /v1/auth/verify-otp` establishes the session, then
`GET /v1/auth/me` supplies the account and roles. Diagnose authorization only
after these authentication boundaries succeed.

| Boundary / observation                   | Interpretation                                                                                                                       | Appropriate next action                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong frontend or API origin             | The test may be reaching another database/build.                                                                                     | Open the intended frontend and verify Network's Request URL. Use an account belonging to that environment.                                           |
| `401 AUTH_INVALID_CREDENTIALS`           | Deliberately generic: unknown/deleted account, password mismatch/missing credential, or unacceptable account standing can lead here. | Inspect account facts and the request audit on the same database. For an existing healthy owned account, use normal password recovery if necessary.  |
| `401 AUTH_ACCOUNT_LOCKED`                | Valid credentials reached an account whose temporary lock remains active.                                                            | Inspect `lockedUntil`; wait for the lock to expire or use the supported owned-account recovery flow. Do not repeatedly retry.                        |
| `403 AUTH_ACCOUNT_UNVERIFIED`            | The valid-password path found no verified email.                                                                                     | Use the email-verification action, receive the real mail, complete verification, then log in and complete OTP.                                       |
| `403 AUTH_ACCOUNT_SUSPENDED`             | Account standing forbids login.                                                                                                      | Use the authorized account-standing/support workflow. Uploading identity documents does not override suspension.                                     |
| `429`                                    | Request throttling applies.                                                                                                          | Respect the server's retry guidance; a loop of retries is not a recovery mechanism.                                                                  |
| Connection failure or `5xx`              | The client could not complete authentication reliably.                                                                               | Verify the same API's readiness and bounded runtime logs; show retry guidance, not email-verification recovery.                                      |
| `200` login, no mail                     | A challenge was issued; this is not proof of SMTP delivery or a session.                                                             | Check real SMTP delivery and the supported resend action. Do not mark the account verified with SQL.                                                 |
| Invalid/expired/consumed OTP             | Authentication has not completed.                                                                                                    | Follow the displayed OTP recovery/resend flow; never reuse a consumed code.                                                                          |
| OTP succeeds but `/me` fails             | Cookie/session transport or session validation needs investigation.                                                                  | Check matching origins, CORS, cookie scope/security and server validation. Do not paste cookies or tokens into reports.                              |
| `/me` succeeds but `/admin` is denied    | Authentication succeeded; authorization is a separate decision.                                                                      | Verify the current authorized Admin membership through the supported operator process. Selecting the Admin app does not grant it.                    |
| Provider signs in but cannot accept work | Login and work eligibility are different decisions.                                                                                  | Follow the provider application, identity and work-access lifecycle; see [provider recovery](provider-experience-v2/PROVIDER_LIFECYCLE_RECOVERY.md). |

The account-standing checks above run after password verification. A wrong
password still receives the generic credential error even when another account
restriction exists. Do not infer account existence from public responses.

## Read-only operator diagnostic

The script [auth-state.cjs](../scripts/diagnostics/auth-state.cjs) uses the
configured `DATABASE_URL`. Run it in the same environment as the API that
received the failing request. A report from a local database does not diagnose a
hosted account. It reads PostgreSQL through the database package's Prisma client.

Prerequisites: the pinned Node version, installed dependencies, the generated
Prisma client and a built database package. An existing working API checkout
normally has them. Building the package does not apply migrations or seed data.

For the local Windows checkout:

```powershell
& {
    pnpm --filter @homeservicemarketplace/database build
    if ($LASTEXITCODE -ne 0) { throw "Database package build failed." }

    $env:HSM_AUTH_DIAGNOSTIC_EMAIL = "admin@admin.com"
    try {
        node --env-file=.env scripts/diagnostics/auth-state.cjs
        if ($LASTEXITCODE -ne 0) { throw "Read-only authentication diagnosis failed." }
    }
    finally {
        Remove-Item Env:HSM_AUTH_DIAGNOSTIC_EMAIL -ErrorAction SilentlyContinue
    }
}
```

Repeat with the actual Seeker email. In an already configured server environment,
omit `--env-file=.env` and inherit the API's connection environment. Existing
process variables take precedence over env-file values; verify the target before
interpreting the result. Do not copy a production connection string into chat or
into tracked files.

To correlate a recent failing request, optionally set
`HSM_AUTH_DIAGNOSTIC_REQUEST_ID` to the response's `error.requestId` or
`X-Request-Id` header. Either the email or request ID is required; both are
supported. Clear this environment variable after the check. No password, OTP,
session cookie or token is an input.

The script enforces a read-only PostgreSQL transaction, a statement timeout and
bounded result sets. It selects password presence as a database boolean; it
never retrieves the hash into the report. Output uses a fixed allowlist and
driver failures become a fixed error identifier, without SQL parameters or DSNs.

| Output                                                 | Interpretation                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `account.found: false`                                 | No row with that normalized email exists in this particular database.                                                                                                                |
| `deleted`, `active`, `status`, `emailVerified`         | Observed account facts; they do not change the account or replace backend policy.                                                                                                    |
| `passwordConfigured: false`                            | No nonempty stored password hash. `true` does not establish hash validity or a matching password.                                                                                    |
| `temporarilyLocked`, `lockedUntil`, `failedLoginCount` | Current lock/counter facts. The report creates no login attempt.                                                                                                                     |
| `activeRoleDefinitions`                                | Attached standard role definitions whose `deletedAt` is null. This is not a claim about existing token contents or effective endpoint permissions.                                   |
| `requestAudit[].reason: unknown_user`                  | That audited login did not find an eligible user via the API lookup. A soft-deleted row is also excluded by that lookup.                                                             |
| `reason: otp_challenge_issued`                         | Credentials passed and the API issued an OTP challenge. The historical `LOGIN_FAILED` event type alone must not be interpreted as a bad password in this case.                       |
| `matchesInspectedAccount`                              | `true`/`false` compares the event's associated account with the inspected email; `null` means no associated account or no email comparison was possible.                             |
| Empty `requestAudit`                                   | No matching retained login event was read in the fixed last-24-hours window. Some refusal paths do not commit an audit event; this does not prove the request never ran.             |
| `databaseTargetFingerprint`                            | A redacted target comparison aid for operator reports. It is not proof of which API the browser contacted; proxies/aliases may produce different fingerprints for the same database. |
| `credentialsChecked: false`                            | Intentional: the script cannot certify a password or establish a session.                                                                                                            |

The output excludes emails, user IDs, password hashes, OTPs, reset tokens, session
tokens, IP addresses, connection strings and arbitrary audit metadata. It must
remain an operator tool, not a public account-enumeration endpoint.

## Verification and release boundary

The regression tests cover all three branded forms, Arabic/English recovery
actions, non-verification errors, edited inputs, delayed responses, and each
excluded endpoint's no-retry behavior. Real-browser acceptance also verifies an
actual `401` with no verification link, an actual unverified-account `403` with
the appropriate link, and real Admin/Provider login from their themed entry paths.

The diagnostic's unit tests cover redaction, input handling and query boundaries;
its isolated Postgres suite verifies actual account/audit facts and database-
enforced read-only behavior. See the
[authentication workflow](../.github/workflows/auth-lifecycle.yml) and
[QA commands](auth-qa-checklist.md#7-repeatable-automated-verification).
Real integration/browser tests use disposable services. Their pass result is
not a successful login to the affected existing production accounts.

Before publishing a release, verify required checks on its exact source SHA and
deploy through the existing reviewed release process. A `develop` merge or a
local `VITE_API_URL` change does not update production. Rollback uses the previous
frontend release/commit; this repair requires no data rollback or migration.

Account-level recovery remains conditional on the observed facts. Use the
correct environment, the owned-account password/email recovery flow, or the
authorized account-standing/role workflow as indicated. Do not make the login
endpoint accept invalid credentials to turn a `401` into a success.
