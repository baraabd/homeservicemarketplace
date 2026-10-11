# R18 — Skipped coverage inventory

Source: CI run 38149873165 (PR #154 final source
`6e01140aeabed7fa6d1df4af407e3fb4293b43e7`), job logs read on 2026-10-11.
The suites overlap; their counts are not a combined total. This inventory
must be read again on every new final source.

## Browser E2E (Playwright, default job): 836 passed, 349 skipped

The default job runs every spec on three projects (`chromium-desktop`,
`chromium-tablet`, `chromium-mobile`) without `E2E_REAL_API`.

### 261 real-API cases, skipped because `E2E_REAL_API` is unset

Each is executed by the **Phase 5 real-route and persistence evidence** job
(131 passes in total), but **only on `chromium-desktop`**.

| Spec                                             | Skipped (3 projects) | Real-route passes (desktop)                                     |
| ------------------------------------------------ | -------------------- | --------------------------------------------------------------- |
| `r09-work-area-geo-authority.real-api`           | 54                   | 18                                                              |
| `r10-working-hours-schedule-durability.real-api` | 51                   | 17                                                              |
| `r08-provider-v2-all-field-authority.real-api`   | 42                   | 14                                                              |
| `r18-functional-completion.real-api`             | 21                   | 7                                                               |
| `r17-notifications.real-api`                     | 15                   | 5                                                               |
| `r12-booking-communication.real-api`             | 15                   | 5                                                               |
| `r11-reviews-reputation.real-api`                | 15                   | 5                                                               |
| `r17-messaging-cross-instance.real-api`          | 12                   | 4                                                               |
| `r14-budget-authority.real-api`                  | 9                    | 3                                                               |
| `r13-support.real-api`                           | 9                    | 3                                                               |
| `r06-request-media.real-api`                     | 6                    | 2                                                               |
| `r05-seeker-durability.real-api`                 | 6                    | 12 (the real-route run selects more cases than the default job) |
| `r07-request-provider-lifecycle.real-api`        | 3                    | 1                                                               |
| `platform-transaction-commit.real-api`           | 3                    | 1                                                               |

**Gap (launch-relevant, P2).** The tablet and mobile variants of these
real-API journeys run nowhere. Most specs set their own viewport, and the
provider surfaces are phone-first, but a real-API mobile run is still not
evidence of the mobile layouts. Closing this needs the real-route job to run
the mobile project for the provider and seeker specs, which is approved
coverage work, not a configuration flip.

### 88 viewport-scoped cases, skipped on purpose

| Spec                            | Skipped              | Runs on                                                               |
| ------------------------------- | -------------------- | --------------------------------------------------------------------- |
| `provider-onboarding-v2-review` | 44 (desktop, tablet) | 22 pass on `chromium-mobile` ("the provider app is a phone surface")  |
| `admin-verification`            | 34 (mobile, tablet)  | 17 pass on `chromium-desktop` (admin review is desktop-only)          |
| `provider-verification`         | 10 (desktop, tablet) | the 5 phone-only cases pass on mobile; the other 26 pass on all three |

These are covered by the same job on the project they target.

## Integration (real PostgreSQL and Redis): 5584 passed, 38 skipped (9 suites)

Each skipped suite is gated by its own variable and executed by a named job:

| Suite                                                                                                                    | Gate                        | Executed by                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------- |
| `evidence-retention.integration`, `manifest-evidence-retention.integration`                                              | `RUN_RETENTION_INTEGRATION` | Evidence retention / real Postgres, S3 versions and ClamAV (29 passed) |
| `dispute-worker-process.integration`                                                                                     | `RUN_DISPUTE_WORKER`        | Dispute journey job                                                    |
| `dispute-workspace-browser.integration`, `r17-dispute-legacy-browser.integration`                                        | `RUN_DISPUTE_BROWSER`       | Dispute journey job                                                    |
| `r17-admin-operations-browser.integration`                                                                               | `RUN_ADMIN_BROWSER`         | Dispute journey job (R17-D step)                                       |
| `r17-provider-surfaces-browser.integration`, `r17-e-closure-browser.integration`, `provider-my-bids-browser.integration` | `RUN_PROVIDER_BROWSER`      | Dispute journey job (R17-E and E-18 steps)                             |

No skipped integration suite lacks an executing job. The per-test split of
the 38 is not printed by Jest's default reporter; the mapping above is by
suite.

## What this does not cover

- Hosted execution of any of these journeys (`HOSTED_ENVIRONMENT_BLOCKED`).
- Manual browsing on target devices. None was done; static inspection and
  automated Chromium are distinct.
