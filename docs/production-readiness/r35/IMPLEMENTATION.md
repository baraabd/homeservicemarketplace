# R35 — Cross-role certification preflight; implementation blocked

## Identity and evidence boundary

- Observed documentation parent: `73a4a64a77844db7815466f47d8afdefb0b35c2f`.
- Observed source tree: `04fbecf5ff028f95136cdddca5aeb7bb7451e09f`.
- Approved G3 candidate/frozen source/tree: **absent**.
- Final documentation SHA/tree: recorded in the PR after publication.
- Exact paths and scope: [OWNERSHIP.md](OWNERSHIP.md).
- Machine-readable findings: [preflight.json](evidence/preflight.json).

Mode A, preflight documentation only. Implementation is **NOT_STARTED**;
acceptance is **INTEGRATION_PENDING / POLICY_BLOCKED / EXTERNAL_BLOCKED**.
No functional SOURCE_VERIFIED, SANDBOX_ACCEPTED, HOSTED_ACCEPTED or
RELEASE_ACCEPTED is asserted. No unmerged branch is imported.

## Current-source findings

R29 is merged through #193, but SDK dependency, raw-body parser, ingress,
rail routing, scheduling and the browser purchase surface remain unintegrated.
Refund policy/consequences remain unavailable. R30–R33 inclusion is not the
seven-category G3 acceptance. R18 evidence stays historical.

The current Playwright projects and specialized R30/R31 configs use Chromium.
Resized Chromium is not Firefox/WebKit evidence. The coordinator must confirm
the approved engine matrix before additional engine jobs are selected.

## Provisional acceptance matrix

Every row is **NOT RUN for R35**. Existing tests are reuse/inspection anchors,
not claims of complete coverage. Browser anchors below are under
`apps/web/e2e/`; re-read them on the future frozen source.

| Journey                              | Existing anchor                                                                                                               | Required R35 proof                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Signup/verification/login/logout     | `auth-cookies.spec.ts`, auth lifecycle CI                                                                                     | Normal UI/OTP login, independent contexts, revocation, new-login durability                   |
| Profile/address/catalog              | `r05-seeker-durability.real-api.spec.ts`                                                                                      | Durable edits and empty/error states                                                          |
| Request/media/bid/booking            | `r06-request-media.real-api.spec.ts`, `r07-request-provider-lifecycle.real-api.spec.ts`                                       | Actual private/public storage boundaries and role-isolated progression                        |
| Completion/review/chat/notifications | `r11-reviews-reputation.real-api.spec.ts`, `r12-booking-communication.real-api.spec.ts`, `r17-notifications.real-api.spec.ts` | Persisted completion, reconnect, no duplicate effects                                         |
| Dispute/support                      | `apps/api/test/integration/dispute-workspace-browser.integration.spec.ts`, `r13-support.real-api.spec.ts`                     | Approved policy, visible workflow, restricted evidence and audit                              |
| Onboarding and corrections           | `provider-onboarding-v2-real-api.spec.ts`, `admin-review-workflow.real-api.spec.ts`                                           | Identity/portfolio review, correction-resubmission and authorized viewer                      |
| Area/hours/work access               | `r09-work-area-geo-authority.real-api.spec.ts`, `r10-working-hours-schedule-durability.real-api.spec.ts`                      | Capability negatives; buying a plan never grants work access                                  |
| My Plan/usage/expiry                 | `r31-subscriptions/my-plan.real-api.spec.ts`                                                                                  | Atomic activation, duplicate suppression, expiry and usage                                    |
| Manual collection                    | `r30-manual-payments/manual-payments.real-api.spec.ts`                                                                        | Authorized evidence/review, corrections, tampering and race negatives                         |
| Stripe collection                    | `apps/api/test/integration/r29-stripe-sandbox.integration.spec.ts`                                                            | SDK doubles are insufficient; actual purchase surface and signed external sandbox evidence    |
| Refund lifecycle                     | `apps/api/test/integration/r32-refund-recovery.integration.spec.ts`                                                           | Both real rails, approved rules, pending/unknown/success, no over-refund, entitlement effects |
| Financial history/permissions        | `r33-financial-operations/financial-operations.real-api.spec.ts`                                                              | Fresh authorization/login, ownership, precision and redaction                                 |
| Admin users/last-admin floor         | `support/r17-admin-operations-browser.cjs`                                                                                    | Concurrency, floor refusal and audit through real UI/API                                      |
| Accessibility/locales/engines        | `apps/web/playwright.config.ts` and real-route suites                                                                         | 320/390/768/1440; AR/EN; RTL/LTR; keyboard/zoom/reduced motion; approved real engines         |

## Isolation, execution and final recertification

After G3 and assignment, use R35's exact 18-file conditional plan. Allocate
disposable DB/user, Redis/storage/mail/queues and independent role contexts.
Proposed ports are not allocated resources; no user environment was copied.

Acceptance must forbid `page.route` mocks, use normal login/visible UI, then
verify authorized reads and durable database invariants. Fixture authority must
never become a production bypass. Record expected/passed/failed/skipped/todo/
flaky counts; missing/skipped mandatory scenarios block acceptance.

Bind source/tree, migrations/contracts/config digests, API build identity,
served frontend entry/chunk digests and intended API origin. Publish only
synthetic/cropped/redacted screenshots and sanitized summaries. Exclude tokens,
private notes, receipt/identity originals, raw payloads and session traces.

R34 owns reconciliation-specific acceptance. Do not import an unmerged peer or
change R34/R36/R37/R38 product code. The coordinator must rerun the suite on the
final combined Wave 4 source; preparation is not release sign-off. No browser,
hosted-target, screenshot or deployed-bundle check was performed here.
