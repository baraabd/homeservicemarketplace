# R04 — Authentication lifecycle and account isolation

Mode A: integration/bug fix. Owner: @baraabd. PR: #118, `feat/r04-auth-lifecycle`.
Merged dependency source: `5636786bb147e6f4ecb677ada129ce8a3165ccd1`.
Status: implementation candidate; final-head native and live-environment acceptance
must be read independently. No migration, public role-grant endpoint, deployment,
paid resource, branch-protection mutation or production flag activation is included.

## Server invariants retained and exercised

The preceding R04 checkpoint implements account-first lock ordering, committed
wrong-password/OTP rejection bookkeeping on the same transaction connection,
conditional database-clock token consumption, challenge-scoped keyed OTP hashing,
atomic verification/account activation/session issuance/audit and reset revocation.
Successful login still requires the actual email OTP. Public registration grants
only the customer role. Suspended, inactive and deleted accounts cannot use an old
registration challenge to become active again. Logout revokes the presented device's
session family, including a refresh that completed before it acquired the account
lock, without logging out independent devices. Password reset invalidates all sessions
and pending challenges. The existing secure redirect/CSRF/role checks remain enabled.

`r04-auth-lifecycle.integration.spec.ts` exercises actual Postgres transactions and
repositories, durable rejection counters, lockout/reset, rollback at the session and
success-audit boundaries, concurrent OTP single use, suspended/inactive/deleted
accounts, resend limits, database expiry/purpose enforcement, reset invalidation,
rotated-device logout and verification-link replay. Its mail adapter is explicitly
in-memory; it does not earn SMTP delivery credit.

Keyed OTP rollout must be homogeneous or allow old five-minute challenges to drain.
New keyed hashes are not understood by older binaries. Do not revert runtime binaries
without considering active challenges and secret rotation. No token/hash weakening
or privileged account registration is used to make these tests pass.

## Browser corrections

- Await the native Web Locks result instead of returning a nested generic Promise.
  Retain exclusive locking, stale request-scope rejection and no unlocked fallback.
  The local fallback coordinates only one tab, not browsers without Web Locks.
- Wire safe registration/recovery/OTP messages; never show raw backend diagnostics.
  Synchronous request latches prevent duplicate same-tick submits and overlapping
  verify/resend actions. OTP supports Enter and fits narrow RTL/mobile screens.
- Preserve sanitized returnTo (including query/hash) across login/signup/recovery.
  Cold /check-email now accepts an email instead of disabling its only recovery
  action. Expired registration codes can recover through an actual email link.
  Verification requests coalesce StrictMode duplication, react to token changes and
  offer an explicit retry after transport failure.
- Expose local-versus-server logout status and retry. A network error is not proof
  of revocation. An unconfirmed local logout prevents automatic restoration after
  a reload. A successful password reset purges local authentication state only
  after server acknowledgement. It does not claim to undo prior committed writes.
- Give TextField native label/error associations and autocomplete/Enter hooks without
  changing its layout. Registration no longer requires a phone number that its
  existing contract cannot save; the optional field explicitly says it is not saved.
- Reset account-local wizard/context state without remounting public recovery pages;
  ignore an old identity's retained async setters. Private query/mutation caches and
  outstanding toast notifications are cleared, and private routes remain keyed by
  the authenticated account. Native fetch/media paths outside Axios retain their
  independent server-side authorization and are not claimed to be client-fenced.

The prior ProviderActivationScreen test deliberately left a mocked refresh unresolved.
Unlike a network adapter, that promise never honoured the Axios timeout and held the
shared cookie lock forever. The fixture now releases the held request after asserting
the pending screen and checks its final navigation; no runtime lock reset/test bypass
was introduced and no assertion or production timeout was weakened.

## Independent real-service acceptance

`.github/workflows/auth-lifecycle.yml` installs the pinned Node/pnpm/lockfile, provisions
an isolated `r04_auth_ci` Postgres and Redis, uses version-pinned Mailpit v1.31.1, runs
the real database regressions, builds the actual API and production browser bundle,
and drives Chromium against real HTTP and SMTP. The browser script refuses ordinary
local/self-hosted execution and non-fixture database names. It never truncates tables;
cleanup is restricted to the synthetic accounts it created. All public auth actions
use the real endpoints. Administrative/provider test roles are provisioned solely
for synthetic identities in this guarded fixture database, never by public signup.

Covered journeys include UI signup without a premature session, wrong/resend/reused
OTP, deep-link preservation, cookie/CSRF/refresh, cooperative two-tab offline logout,
recovery mail and reset revocation, cold link recovery at 320px RTL, and sign-in for
all three server-provisioned roles. There are no successful API-response mocks, token
reads from database columns or production test endpoints. Normal scope/cache unit
tests separately inject delayed HTTP errors/responses to reproduce race boundaries.

Only a sanitized per-phase report and synthetic screenshots are retained. Mail bodies,
OTP/passwords, browser cookie jars, traces and raw API logs are not artifact inputs.
The final-SHA policy requires this workflow/job/artifact in addition to the preserved
CI, CodeQL analysis AND security-result, governance, Windows/Linux startup and staging
boundary checks. Missing, pending, failed and skipped required evidence is non-PASS.

## Evidence at implementation checkpoint

Local Linux Node 22.16.0: the existing dependency-free suite plus the new declaration
check passed 239/239, no failures/skips; declaration-only validation, source/ownership
checks, syntax transpilation and whitespace validation are separate from native
application acceptance. The environment has no usable pnpm/Docker/Chromium and cannot
resolve the package registry. Native Jest/Vitest, full typechecks, the real DB tests,
images and browser SMTP journeys must be confirmed by the final-head hosted runs.
Do not reuse results from the earlier R04 checkpoint or merged R03 as new-code proof.

## Still required for sprint closure

R01 effective branch protection must be authorized/applied/read back. R03 needs an
approved actual staging target, protected secrets, effective storage/database grants,
HTTPS edge and external test inbox. Even a successful isolated CI SMTP/browser run
is not evidence of external deliverability or the user's staged cookies/TLS setup.
Record these live-target checks against the deployed source and image digests before
closing R04. This PR does not certify or implement R05-R10.

## Primary technical references

- https://www.w3.org/TR/web-locks/
- https://playwright.dev/docs/test-assertions
- https://github.com/axllent/mailpit/releases/tag/v1.31.1
