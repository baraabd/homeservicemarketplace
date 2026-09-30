# R04 native acceptance repair

Parent: `f648d434dea85fb2a27a171ee1f860cc6301d46e`.
Parent tree: `a7fc5b8e65cb965a8f3d3a2445ad9c2b4e5f5039`.
PR #118; integration owner: @baraabd. No merge or deployment is included.

## Evidence-driven corrections

The parent's native web report (run 36598676362, artifact 11047837350) reports
2219 tests and two failures. The resend assertion expected an obsolete delivery
claim; it now verifies the accessible, non-enumerating request acknowledgement
while retaining the exact endpoint, call count and challenge body checks.
The ProviderApp fixture omitted `toast.dismiss`, which the real session reset uses
to discard private notifications. The mock now includes that existing API; no
production cleanup was removed or made optional to pass a fixture.

The real SMTP/Postgres/Chromium lifecycle report (run 36598675812, artifact
11047757187) failed at `peer-authenticated` in the two-tab offline logout phase.
The visually translated, closed notification drawer still exposed a Settings
button to assistive technology and keyboard focus. It is now aria-hidden and
inert only while closed, retaining its visual transition. Two component tests
verify closing/opening and the real browser acceptance checks a unique accessible
Settings control and refused focus on the hidden control. The locator was not
weakened to choose an arbitrary duplicate, and no timeout or retry was increased.

These changes do not alter IAM authorization, OTP consumption, cookie locking,
role provisioning, data contracts, migrations, dependency versions or lockfiles.
They are not a replacement for successful execution of all R04 acceptance phases.

## Local checks and required hosted evidence

On Linux Node 22.16.0, 239/239 existing dependency-free governance/runtime/staging
regressions passed, with zero failures/skips. Four changed TypeScript files passed
syntax transpilation with TypeScript 5.8.3; the browser script passed Node syntax
checking and the patch passed whitespace checking. This environment has no usable
pnpm, Docker or Chromium. New Vitest tests and real browser checks require the
final-head hosted runs; local syntax/built-in tests do not certify them.

All five source changes were staged and the uploaded Git tree was compared with
the local tracked tree. Record final commit identity, workflow runs and separate
CodeQL security results in the PR after upload. Retain failed parent evidence as
historical; do not copy its partial successes as final-head acceptance.

R01 effective branch protection and R03 live staging/inbox/TLS acceptance remain
independent blockers. Mailpit is a real isolated SMTP inbox, not proof of external
deliverability. R05-R10 and the separate carwash F009 issue are not changed here.
