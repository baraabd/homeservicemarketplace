# WhatsApp default and automatic phone country selection

Date: 2026-11-19. Work starts from develop `b329170f6fee3b0e4013dfede8f1ffccdd0abaaf`.

## Scope and baseline

The user requested WhatsApp as the initial authentication channel for Customer,
Professional and Admin experiences, a persistent administrator choice between
WhatsApp and email, and a polished phone input that suggests a country and shows
its flag and calling code. This is a focused feature/UX change, using the shared
auth screens rather than separate role-specific implementations.

The source baseline already implements server-owned channel selection, verified
contact enrollment, WhatsApp transport readiness, channel-pinned OTP challenges,
admin audit/history, and experience-specific auth themes. The remaining gaps are:

- An absent `auth.otpChannel` setting resolves to email in the service and schema.
- Resetting that setting assumes email as the default.
- Login/signup component fallbacks also assume email.
- The phone field initially requires a country selection, and its focus palette
  is fixed to blue even in Customer/Admin experiences.
- Country flags in native option text depend on the platform emoji font.

These findings describe source behavior, not a fresh production acceptance run.
Historical November 18 evidence remains in its original directory.

## Target behavior

1. One contracts constant defines WhatsApp as the default. An explicit saved
   email choice always wins. Deleting/resetting the setting restores WhatsApp
   only after the existing readiness and verified-admin-contact checks pass.
2. The real server configuration remains authoritative for all three web
   experiences. Forms wait for a fresh configuration and never pretend a provider
   is ready or silently send a code through a different channel.
3. A new phone field suggests a supported country from an explicit device locale
   region, then an unambiguous supported timezone, then Saudi Arabia. This is a
   suggestion, not a claim about physical location. The user can change it.
4. Restored/manual choices and international numbers take precedence. Arabic and
   Persian digits normalize consistently. A shared calling prefix must not be
   presented as proof of a particular country.
5. Show a locally bundled country flag and calling prefix, retain a keyboard
   accessible selector, Arabic/English direction, 16px editable text, and 44px
   interactive targets. Use the shared Customer/Professional/Admin theme tokens.
6. Device-based suggestions request no geolocation permission or external lookup.
   The existing explicit location action remains opt-in and cancellable.

## Verification plan

- Focused contracts/API/web unit tests for the default, explicit override, reset
  guards, automatic country suggestion, user overrides and international paste.
- Real PostgreSQL service integration for policy persistence, reset guards and
  transactional audit/history. A no-send provider capability fixture is not proof
  of WhatsApp delivery.
- Chromium presentation checks for all three experiences, both languages and
  both administrator-selected channels at 320/390/430/768/1024/1440px, plus
  keyboard, 200% CSS zoom and screenshot inspection.
- Exact repository toolchain, scoped lint/format/typecheck, builds and final
  branch CI checks. Do not merge or deploy without explicit authorization.

## Implementation and local verification

The shared contract, owning policy service, settings schema and reset guard now
use the WhatsApp default. Login, signup and recovery receive server-confirmed
readiness; their optional readiness defaults are false. No database migration,
dependency change, role grant, runtime authentication bypass or production seed
override is introduced.

The phone field uses a separate pure suggestion helper and a small flag component.
The existing 36 supported countries have local SVG flags with a pinned MIT source
and license. International phone parsing and normalization continue to use the
shared existing helper. Stockholm and Damascus were added to the existing
timezone allowlist. New controls add no storage; the pre-existing signup draft
still preserves non-password form fields in session storage.

The administrator sees WhatsApp first, a platform-default label, the current
saved choice and an unsaved-change message. Existing accounts retain their
verified contact methods. Public signup still does not grant administrator roles.

Checks used Node **24.21.0** and pnpm **10.32.1**, with the frozen lockfile.

| Verification                                                      | Observed result                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Complete web unit/component suite                                 | 254 files, 3,313 tests passed                                                  |
| Focused country/phone/flag tests (included in the full web count) | 5 files, 98 passed                                                             |
| Focused API unit/HTTP tests                                       | 7 suites, 219 passed, zero skipped                                             |
| PostgreSQL/Redis integration scope                                | 9 suites, 92 passed, zero skipped                                              |
| CI fixture and existing R25/R27 harness regressions               | 161 passed, zero skipped                                                       |
| Real fixture policy preparation                                   | Idempotent email row; unrelated settings retained; disposable database removed |
| Contracts/API typecheck and production API build                  | Passed                                                                         |
| Production web build and TypeScript compilation                   | Passed                                                                         |
| Scoped ESLint and formatting                                      | No errors; unchanged effect warnings in existing geo/email-verification code   |

The initial K02 integration setup used the wrong Redis URL. Supplying the local
fixture's `REDIS_URL` made its eight cases pass without a source change. The full
web suite emitted existing duplicate-key fixture warnings and a refused unmocked
localhost request; its final result was 3,313 passing tests with no failed files.

The built API was also started normally against a fresh migrated PostgreSQL
database. Real HTTP requests returned WhatsApp with no setting, email after an
explicit fixture setting, then WhatsApp after removing that fixture, all without
restarting the API. Each response was HTTP 200 with `Cache-Control: no-store` and
the exact allowed credentialed CORS origin; the preflight returned 204. No users,
verification tokens or delivery intents were created. The database was removed
afterward. See [the captured HTTP evidence](./policy-http-verification.json).

### Browser evidence boundary

The updated Chromium suite covers both channels, all three experiences, Arabic
and English, all six widths, CSS 200% zoom, keyboard focus, loaded flag assets,
44px phone targets, 16px editable text, international paste and signup/OTP
presentation. API responses in this suite are explicit presentation fixtures.

Local execution was blocked **before page creation**: the installed Chromium
could not create its process-singleton Unix socket (`Operation not permitted`).
The standard Playwright headless-shell download returned an explicit blocked-site
HTML response instead of the archive. No sandbox, network restriction, test
assertion or application guard was changed to work around these restrictions.
Consequently no local visual pass or new screenshot acceptance is claimed.

### Hosted verification and screenshot review

The initial published source was
`993aff3b1529e52d4d12a8d00a3a0014d366b59f`. Its hosted results establish the
following evidence; they must not be reported as checks of a later source head.

| Check                                                                                             | Observed result                                                                                       |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Browser E2E](https://github.com/baraabd/homeservicemarketplace/actions/runs/44514893122)         | 875 passing tests, including all 36 auth-channel presentation scenarios across three browser projects |
| API hermetic scope in the same CI run                                                             | 326 suites / 5,918 tests passed; 108 suites / 1,982 integration-gated tests were outside this scope   |
| API PostgreSQL/Redis scope in the same CI run                                                     | 417 suites / 7,792 tests passed; 17 suites / 108 separately gated tests were outside this scope       |
| [Auth lifecycle](https://github.com/baraabd/homeservicemarketplace/actions/runs/44514892936)      | Missing-setting policy integration and real SMTP/browser verification passed                          |
| [R26 security](https://github.com/baraabd/homeservicemarketplace/actions/runs/44514892818)        | Passed                                                                                                |
| [Startup performance](https://github.com/baraabd/homeservicemarketplace/actions/runs/44514893007) | Passed                                                                                                |
| Main CI real-service lanes                                                                        | Admin review, Phase 5 real routes, replica verification, auth cookies and Compose smoke passed        |

The `playwright-report` artifact from that exact head contains the auth screenshots.
Manual inspection covered WhatsApp login in all three experiences (Arabic and
English), Provider Arabic signup and Admin Arabic OTP at 390px. The selected flags,
calling prefixes, role colors and right-to-left layouts are visible and coherent.
The real SMTP artifact was also reviewed for English invalid-credentials login at
320px and Arabic expired-code signup at 390px. Those screenshots demonstrate the
rendered states, not live WhatsApp delivery.

The initial main CI run failed two pre-existing email-account login helpers, in
R31 and Dispute, which still looked for an email field before selecting the email
path. Those users are already active with verified email addresses. The follow-up
changes select the real **I have an email account** action, assert the channel
transition, then retain the existing password, OTP, session and authorization
checks. The related CJS helper audit applies the same correction to six shared
browser helpers; it introduces no policy override or response mock.

The initial R27 run also caught auth-route JavaScript at 26.7 KiB Brotli against
its unchanged 20 KiB budget. Its three source/browser measurement matrices passed,
and the budget check correctly rejected the larger bundle. The follow-up keeps
SVG flag bytes in separate local assets and defers the optional reverse-geocoder
until the user requests location. Cancellation is checked after the import, before
coordinates are shared. A focused regression proves that a manual edit during
loading cancels the lookup. The whole country/phone/flag scope now has 99 passing
tests.

The shared OTP panel now loads at the challenge step, and the separate email-link
verification page loads only on its route. Their existing handlers, verification
state machine and rendered content were moved without semantic changes. OTP
loading uses the existing accessible boundary; retry retains the parent challenge,
does not request a second code, and respects verification/resend busy state.
Language changes preserve entered digits. The affected auth and route-loading
scope passed 138 tests, and TypeScript, production build and scoped formatting
passed. The existing email-verification effect warning moved with its unchanged
code; lint reported no errors.

The existing R27 analyzer passed all ten bundle checks locally with the exact
hosted API URL, `http://127.0.0.1:4327`, and the pinned toolchain:

| Bundle measurement            | Brotli bytes | Unchanged limit (bytes) |
| ----------------------------- | -----------: | ----------------------: |
| Auth route increment          |       20,151 |                  20,480 |
| Shared shell                  |      189,287 |                 189,440 |
| Provider onboarding increment |       76,796 |                  76,800 |

The final hosted measurement remains required for this follow-up, especially with
the small onboarding margin. No budget, assertion, route coverage or required gate
was relaxed. The local build graph confirms that flag SVG bytes, the optional
reverse-geocoder, the OTP panel and the email-link page are not part of initial
auth-route JavaScript.

Review [PR #233](https://github.com/baraabd/homeservicemarketplace/pull/233) for
the final source SHA, complete final-head checks and artifact links. This record
distinguishes the initial hosted findings from the follow-up fixes; the PR records
the final acceptance results without a self-referential source commit.

## Explicit email fixtures for existing SMTP journeys

Changing the product default exposed older tests that implicitly relied on email.
Email-specific service tests now choose email explicitly through the real policy
service with a scoped settings reader. Existing real SMTP browser/performance
lanes use `scripts/testing/email-auth-fixture.cjs` after their disposable database
seed. The helper validates the fixture process, host, database and lane before
writing only `auth.otpChannel=email`; production seed and API behavior are unchanged.

This covers the six SMTP browser jobs, R25's isolated replica harness, all R27
database resets and guarded Compose smoke. R27 copies the helper and its tests
alongside the harness into immutable comparison subjects. A dedicated real
PostgreSQL policy step runs before the email fixture, retaining coverage of the
actual missing-setting WhatsApp default, readiness refusals, live admin membership,
saved-email persistence and atomic history/audit rollback.

## Operator behavior after an authorized rollout

1. Open **Admin → Settings → Sign-up and verification codes**.
2. Select **WhatsApp** or **Email**, then **Save changes**. The selected draft
   does not change platform behavior until the server accepts the save.
3. The administrator must own a verified destination for the selected method.
   WhatsApp also requires configured WhatsApp Business credentials and an approved
   authentication template. The existing enrollment UI supplies the ownership step.
4. A fresh login/signup visit reads `GET /v1/auth/config` before showing credentials.
   Confirm the saved method in each experience. A failed policy fetch shows retry,
   and an unavailable WhatsApp provider remains visibly unavailable.
5. An existing explicit email row remains email after deployment. Removing that
   setting restores WhatsApp only when the existing reset guards pass.

This branch is implementation and verification work. It does not establish a
production rollout, a live WhatsApp delivery receipt, or complete platform journey
acceptance. Real delivery requires a separately authorized test using the configured
provider and an intended recipient.
