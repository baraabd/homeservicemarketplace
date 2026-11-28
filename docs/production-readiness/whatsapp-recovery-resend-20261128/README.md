# Anonymous WhatsApp recovery response boundary

This repair addresses the review finding on release PR #239. The release starts
from `develop` at `439d2f8272a1fba0868f37548791053afcd79181`; the final source SHA
and its current GitHub Actions evidence are recorded in the pull request body.

## Confirmed problem

`forgot-password-otp` returned an opaque challenge for both eligible and unknown
phone numbers. Recovery challenges were unmarked, while the public `resend-otp`
response normalization applied only to `wa_login_` challenges. A caller without
a password or received OTP could distinguish a live recovery challenge (202)
from an unknown challenge (400). Related verifier error codes also needed to
remain neutral when a recovery challenge was submitted to another purpose.

## Repair

- Real and neutral recovery responses use the `wa_reset_` namespace with the same
  192 random bits as login challenges. The complete identifier is always looked
  up; prefixes are never removed or translated.
- A stored marked recovery challenge must have purpose `PASSWORD_RESET_OTP` and
  delivery channel `whatsapp`. A namespace selects public response shaping, not
  account authority or permission to create a session.
- Resend acknowledges expected missing, expired, used, exhausted and suppressed
  cases neutrally. The stored attempt and resend ceilings still prevent rotation
  and delivery. Unexpected database or programming errors remain errors.
- Both public verification endpoints normalize expected anonymous challenge
  errors. Purpose validation precedes lifecycle-state disclosure, including
  attempts to use a recovery challenge at an enrollment or login verifier.
- Marked verify and resend perform one bounded OTP KDF before inspecting stored
  state. Recovery resend dispatch happens after the transaction commits, without
  waiting for provider latency in the HTTP response. The durable outbox remains
  responsible for dispatch and retries.

The existing five-attempt, three-resend, five-minute OTP limits and public IP
throttle decorators are unchanged. No database migration, dependency, production
configuration, frontend contract or release-gate change is needed for this fix.
Existing unmarked challenges retain their original contracts until they expire;
the repair does not rewrite previously issued challenge identifiers.

## Verification

Runtime: Node `24.21.0`, pnpm `10.32.1`, frozen lockfile.

- PASS: `authentication.service.spec.ts`, `otp.service.spec.ts`, and
  `test/e2e/auth.e2e.spec.ts`: 286 tests across three suites.
- PASS: API TypeScript check and ESLint on the six changed source/test modules.
- PASS: formatting and whitespace checks on the changed files.
- PASS: the full `passwordless-whatsapp-login.integration.spec.ts` suite ran
  against an isolated real PostgreSQL 17.12 instance: 28 tests, zero failures and
  zero skipped cases, including the seven new HTTP recovery regressions. The
  temporary database was created for this run and removed afterward. Hosted CI
  separately uses its declared PostgreSQL 16 service.
- Final-source hosted CI is recorded in the pull request evidence after those
  checks finish. A local passing run is not a claim that hosted CI has completed.

The additional PostgreSQL cases live in the existing
`passwordless-whatsapp-login.integration.spec.ts` suite, already executed by CI
and Authentication lifecycle acceptance. They exercise the real controller,
services, repositories and transactions: eligible/unknown/unverified recipients,
expired/used/locked/exhausted challenges, persisted attempt and resend ceilings,
namespace tampering, successful password reset, replay rejection, and absence of
new sessions or cookies. The external WhatsApp transport is simulated.

This focused HTTP fixture does not mount the global Redis/IP throttler. Its
counter assertions concern persisted OTP limits; it is not independent evidence
of the global throttle configuration or delivery to an actual WhatsApp phone.

## Release and rollback boundary

This small repair adds no migration. The broader `develop` to `main` release
includes the existing configurable-identity, OTP-audit, and email-contact
migrations from November 18. Hosted database migration and API/web release
identity checks remain deployment prerequisites.

If release acceptance fails, keep the current deployment and repair the failed
gate. After deployment, prefer a forward fix or a reviewed compatible rollback;
do not drop identity columns or delete phone-only accounts. A pre-feature binary
that assumes every account has an email is not automatically compatible with
new phone-only accounts. Reverting this response-boundary fix by itself would
reintroduce the reported enumeration issue.
