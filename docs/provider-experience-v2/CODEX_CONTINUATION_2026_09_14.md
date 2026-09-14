# Provider onboarding — continuation repair

This functional repair builds on `b8adc930958843140485432cf2955772f4cfb72c`
in PR #76. The earlier commit's successful CI does not certify this new tree.
Final GitHub results must be attached to this commit in the PR description.

## User-visible repairs

- **Experience:** the displayed zero was previously an unanswered value. The
  existing Save and continue action now explicitly confirms it and waits for
  acknowledgement before leaving. Merely viewing the screen writes nothing.
  Existing numeric experience is displayed and preserved until edited; an
  explicit stepper edit clears the old numeric field in the same date write.
  The API derives a missing numeric summary from the stored start date,
  using its existing elapsed-years helper. Explicit numeric answers retain
  precedence, matching the existing policy and legacy editor. Clean server changes hydrate the
  stepper without replacing newer in-flight edits. Continue is disabled while
  the draft form is unavailable.
- **Working hours:** an older response can no longer replace the newer week
  being edited or saved. Day selections staged for the next Apply survive the
  previous write's acknowledgement. Clean authoritative data still hydrates.
- **Country/timezone:** ASK responses include the timezone IDs accepted by the
  server's market policy. The picker offers those IDs only, rather than every
  timezone supported by the browser. Missing/empty choices show a retry state;
  they never invent a timezone or country.
- **Review/submission:** draft, hub and review now check whether the saved
  market is still enabled, using the same live check as transactional submit.
  A failed readiness refetch cannot reuse a cached permission to submit. A
  submission rejected with 422 refreshes the authoritative blockers. The
  consent screen offers a route to a collecting task that needs correction,
  even when consent is the first blocker; the approved consent-only ready
  appearance is preserved.

The only shared-contract addition is optional `timezone.allowedIds` for ASK
responses. Old responses remain readable but cannot supply unsupported choices.
No dependencies, migrations, feature-flag defaults, authorization/CSRF guards,
server writable-field restrictions, or design references were changed. These
repairs use the existing `/v1` APIs; that prefix is not evidence of a legacy UI.

## Regression evidence

New regression cases were executed against the faulty behavior before their
corresponding production changes. They reproduced experience hydration and
zero confirmation failures, stale schedule overwrite, unsupported timezone
choices, cached readiness reuse, and enabled-market disagreement. Final review
also reproduced the legacy numeric-edit conflict, enabled Continue without a
form, date-only review summary, and consent hiding another task's blocker.

Component tests use the real query/autosave/router coordination with mocked
HTTP; they are not presented as real persistence evidence. Added real-browser
tests use ordinary versioned API writes to prove zero confirmation and legacy
experience editing, with independent draft reads, reload and review assertions.
Real-HTTP integration assertions cover the market timezone list and withdrawn
market disagreement. Those service-backed layers run in the existing CI jobs.

Local gates use Node 20, pnpm 10, and `scripts/ci/run-gate.sh` so a failing
command's exit code is retained. Full local results are recorded below after
the final source changes; external-service-gated skips are not passes.

| Final local gate                             | Result                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| Complete web unit/component suite            | 127 files / 1750 passed                                                     |
| Complete API hermetic suite                  | 179 suites / 3271 passed; existing service gates skip 40 suites / 907 tests |
| Web production build, including TypeScript   | Passed                                                                      |
| API typecheck and production build           | Passed                                                                      |
| E2E TypeScript                               | Passed                                                                      |
| Web lint                                     | 0 errors / 35 existing warnings                                             |
| API source and changed integration-file lint | Passed                                                                      |
| Shared contracts build                       | Passed                                                                      |
| Design-system and all four reference files   | Byte-identical to parent commit                                             |

The final API suite contains 4178 tests in total. Only the service-backed CI
run can establish whether the 907 locally gated tests pass. The two added
browser journeys likewise require the real-API CI job, not the component
suite above. No retry/skip settings or visual baselines were changed.

## Access and delivery limits

This checkout does not contain the user's unpublished Windows commits or
access their localhost processes/database. Updating PR #76 does not update or
restart that local installation. The reported local 401/400/422 messages must
be checked against the running build and response bodies if they persist after
installing the repaired version. No authentication or readiness check is
bypassed to suppress an error. The PR remains a draft; no merge or deployment
is part of this repair.
