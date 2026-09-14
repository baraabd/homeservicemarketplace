# Provider onboarding save errors — Codex repair

This is a functional repair on top of PR #76 at
`a477c322ebb8ea05f5d54fabf93464745980e38b`. It does not certify completion of
Phase 5A/B or the user's local runtime.

## Confirmed defects and repairs

| Defect reproduced from the checked-out code                                                                                                   | Repair                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Area submits the timezone to `LOCATION`, whose writable-field guard rejects that field.                                                  | Send confirmation through the existing `AVAILABILITY` writer; merge both writers' status into Work Area's save indicator.                                                     |
| Before any working window exists, a confirmed timezone is stored in the draft but ignored by the next availability write that omits timezone. | Reuse the confirmed draft timezone when there is no explicit timezone or existing interval. Explicit `null` still clears it and invokes the existing validation.              |
| A rejected save is requeued and resent by navigation, reconnect, or a different step's edit even when its payload is unchanged.               | Hold terminal client-error revisions until an actual correction or explicit Retry. Keep the unsaved data and visible failure; allow other steps to use the same serial queue. |
| A step stops being considered dirty as soon as its request leaves the pending map, before acknowledgement.                                    | Include `saving` in the dirty guard so response hydration cannot clear the current edit while the write is in flight.                                                         |
| `/markets` substitutes zero for absent radius settings, while the wizard uses the admin schema defaults.                                      | Use the same schema defaults in the market read model. A radius offered by the picker must satisfy the existing write policy.                                                 |

The API routes, field guards, authorization, CSRF, session interceptor,
submission policy, database schema and design reference files are unchanged.
The request/response contracts and feature-flag defaults are unchanged.

`400`, `401`, `403`, `404` and `422` save responses stay visible and retain the
edit. Navigation and reconnect do not resend that unchanged revision. An
explicit Retry may resend it once through the existing queue. The existing
bounded session refresh runs before a final `401` reaches the coordinator.
Existing `409` conflict behavior is preserved. No success state is substituted
for a rejected save, and no server-owned readiness check is bypassed.

## Verification

Runtime: Node 20.18.1 and pnpm 10.32.1; dependencies installed using the frozen
lockfile. Commands use `scripts/ci/run-gate.sh`, which captures the command's
exit status before printing summaries.

Regression tests were run before each corresponding production repair:

| Regression run                                                  | Before               | After                                      |
| --------------------------------------------------------------- | -------------------- | ------------------------------------------ |
| Autosave errors, Work Area timezone routing/status              | 9 failed, 28 passed  | Included in the passing complete web suite |
| Wizard service, including confirmed timezone before first hours | 1 failed, 113 passed | 114 passed                                 |
| Market radius missing/invalid settings and operator overrides   | 3 failed, 1 passed   | 4 passed                                   |

Final local results:

| Gate                                                   | Result                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Complete web unit/component suite                      | 124 files, 1715 passed                                                                          |
| API hermetic suite with the CI placeholder environment | 179 suites, 3261 passed; 40 suites / 906 tests skipped by their existing external-service gates |
| Web typecheck and build                                | Passed                                                                                          |
| Web lint                                               | 0 errors, 35 existing warnings                                                                  |
| API typecheck, build and lint                          | Passed                                                                                          |
| Diff whitespace check                                  | Passed                                                                                          |

The first full API invocation omitted `DATABASE_URL` and `JWT_ACCESS_SECRET`.
Two suites failed during configuration validation; this was a test environment
setup error. With the same placeholder values used in `reusable-verify.yml`,
the full hermetic suite passed. No environment guard was weakened. The local
test run does **not** claim the skipped Postgres/Redis tests passed.

The new tests exercise correction while an older request is in flight,
continued saving of another step, explicit retry after `400`/`422`, retained
unsaved data, and save status during timezone confirmation. Existing session,
upload-exit, hydration, specialties and submission tests also run in the full
web suite.

## Remaining verification and access limits

- Required GitHub checks must be assessed on the new PR head, not the previous
  green commit. Real Postgres/Redis coverage is provided by the existing CI
  integration job; it was not run in this workspace.
- The user's Windows `localhost:4000` and `localhost:5173` are not reachable
  from this workspace. No local API process or Docker container was stopped,
  and the user's development database was not accessed.
- The earlier reports mention unpublished local commits (`00659f7`,
  `f577f80`, `fa43adc`). They are absent from the fetched PR branch. Their
  contents must be reconciled before updating that local checkout. This
  patch independently repairs the radius-default and in-flight-dirty defects
  found in the published source; it does not claim to include those commits.
- Reproduce the real provider account's final submission after these repairs.
  A bare `401` or `422` console line does not establish its cause; inspect the
  response body and the authoritative session/readiness result. Do not bypass
  authentication or completion checks to clear the console.
- Country/timezone picker choices and existing country-change handling still
  need real-runtime coverage. A fully completed Phase 5 and visual parity are
  not conclusions of this repair.

This patch is intended for review in the existing PR #76. It does not merge or
deploy the application.
