# S09 — real-browser keyboard race repair

Base: `66e336cb4823802aabacc536584972aa43056d23`. Final head and checks are recorded in the PR body. Scope: integration/bug fix; approved Admin components, styling, API review decisions and policy semantics remain unchanged.

## Captured failure and cause

S03 CI run 36214178324, Chromium-mobile Arabic test `tabs support keyboard, reload and retained unsent notes without approving`, failed at admin-provider-review.spec.ts:554. The source web code in that run is unchanged from the baseline. The trace shows that after Home, the Basics trigger already has focus while aria-selected remains false; the following Tab uses the previous panel's focus order. The URL has already changed, but the controlled React panel has not committed.

`useReviewTaskNavigation` correctly requests `flushSync: true`, but App imported RouterProvider from `react-router`, the non-DOM export that does not wire ReactDOM.flushSync. The documented `react-router/dom` export provides that implementation. The production root now uses it. This is a coordinated, one-line shared App.tsx integration repair owned by S09; no other sprint edits App.tsx. Existing routes and all guards are unchanged.

Failure artifact ID: 10897385342. ZIP SHA256: 90c28654296e9ee7c67a6f87a79d844a04ed414616c1c9158ed853258c59ab3d. The screenshot, error context and trace were inspected; no raw sessions or private evidence are committed. The failing test remains intact, without extra sleeps, retries, timeouts or forced focus.

## Regression and evidence

The new test renders the real App root and real data router, isolating only auth and route contents. It asserts the destination DOM synchronously inside the navigation event, before act can flush a queued transition. This checks provider wiring rather than merely scanning the import string. Local TypeScript syntax transpilation is not Vitest or browser proof. Full CI, CodeQL, the unchanged failing Chromium test, Admin real-route/DB, responsive/RTL/accessibility and all other affected browser gates must pass on the final head.

## Remaining S09 acceptance

This repair is not a claim that verification-policy draft/publish/version/retire, correction/resubmission, atomic approval/work-access/outbox and protected-evidence access loss are all production-certified. Existing baseline real-route tests are recorded by S01; hosted policy/evidence configuration and full final-head lifecycle coverage must still be established. Keep this sprint draft until those criteria are satisfied.

Rollback: revert the root import and regression test only. No database, contract, flag, dependency or policy migration is needed. Do not bypass the failing browser gate in S03 or another parallel branch; integrate this isolated fix through review, then re-run their final heads.
