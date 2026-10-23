# R31 CR-001 — serialized integration and publication reconciliation

Status: APPROVED for the exact publication, product integration and corrective
subsets recorded below before their writes. Implementation is complete;
verification results and remaining acceptance gates are in `../ACCEPTANCE.md`.
Owner: root, owner-delegated engineering coordinator. Requesting sprint: R31.

## Publication-record subset

The thirteen files differing between accepted G2 source
`72b4aaeb0a71d806b7fca7363dd9ca59bbcee644` and owner merge
`986b4707776711e80564f0642133ede90ba16f3c` contain only already-reviewed
acceptance/evidence/registry material. Apply their exact merged blobs, then
reconcile the separate publication identity and assign only R31 according to
the exact coordinator lease in `../OWNERSHIP.md`.

Reason: PR #183 is actually merged; its in-repository publication field still
describes the earlier review stage. No accepted source identity is changed.
Tests: existing G2 record/readiness, registry and governance tests, including
negative readiness for unassigned peers. Migration/dependency consequences:
none. No validator, budget or security gate relaxation is requested.

## Initial product inspection record

The implementation leads inspected the existing R19/R24 persistence,
activation participant boundary and current route graph. The exact minimal
contract/module/route/outbox requests below were approved before application.
No peer adapter or live payment configuration is in scope. Rollback removes
this lane's composition while preserving immutable financial records; see
`../ROLLBACK.md` for the concrete sequence.

## Approved R31 product integration subset

Status: APPROVED_FOR_IMPLEMENTATION, before writes. Sole writer: root.

- `packages/contracts/src/money/subscription-contracts.ts`
- `packages/contracts/src/money/index.ts`
- `apps/api/src/modules/money/money.module.ts`
- `apps/api/src/modules/money/money.module.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/app.module.spec.ts`
- `apps/api/src/infrastructure/outbox/outbox.tokens.ts`
- `apps/web/src/app/routes.ts`
- `apps/web/src/app/components/provider/screens/ProviderProfileScreen.tsx`
- `apps/web/playwright.config.ts`
- `.github/workflows/ci.yml`

Minimal changes: add the published DTOs used by both API and web; preserve
R24 collection/configuration/refund adapters as unavailable while binding the
real transaction-bound R31 participant; register stable expiry and explicitly
policy-configured reminder event types through AppModule; add the existing
provider profile entry and an authenticated standalone My Plan route; execute
the dedicated browser suite in its own disposable database/runtime. Update
composition assertions to assert the new participant without removing existing
no-grant/no-live/one-ledger checks. Existing quote and subscription-list APIs
remain authoritative. No migration or dependency change is required.

Verification: contracts build/typecheck, API composition and participant
regressions, real PostgreSQL/Redis HTTP and concurrency cases, web unit/build/
typecheck, real-route language/mobile/keyboard/reload/offline tests, unchanged
governance and final-head CI/CodeQL. No missing result is reported as a pass.

## Approved internal lifecycle receipt namespace

R31 may use the already-frozen immutable `MoneyCommand` persistence for named
policy operations in the caller transaction: actor system
`money.subscription-lifecycle`, `r31_` hashed keys, canonical request digest,
operation and affected period identity. Replays cannot reapply old cancellation
or refund effects to a renewed period. Defaults remain policy-blocked and no
new public write endpoint is granted. Before edits, root exclusively leases:

- `apps/api/src/modules/money/application/money-command.service.ts`
- `apps/api/src/modules/money/application/money-command.service.spec.ts`

The only R24 change reserves `r31_` from user keys and adds its negative case.
Existing prefixes, financial behavior and tests remain. No migration or new
persistence authority is introduced.

## Approved composition-test fixture repair

Root holds the exclusive serialized lease for
`.github/scripts/merge-integrity.test.mjs` before the first edit. Adding the
SubscriptionsModule causes the formatter to wrap the MoneyModule imports;
the existing negative fixtures depend on an obsolete single-line string.
Change only fixture construction to target the declared imports/exports
arrays across whitespace, assert each mutation actually changes the source,
and retain all existing missing/duplicate/export rejection assertions. The
production composition fence, required gates and test coverage remain intact.
The same exact lease is recorded in the wave and sprint registry.

## Publication transport and committed ancestry

The isolated branch started at the frozen source72, as recorded above. The
GitHub connector is the authenticated publishing capability; the shell has no
GitHub write credential. Before publication, root stages only the approved
files and executes the repository's actual `.husky/pre-commit` gate against
that index, without disabling hooks or changing their commands. The reviewed
candidate tree is secret-scanned and compared to the GitHub-created tree.

The connector creates the feature commit on the already verified, owner-merged
G2 publication `986b4707776711e80564f0642133ede90ba16f3c`, whose only changes
since the frozen source are the thirteen approved record files already
reconciled in this worktree. This retains source72 as an ancestor, introduces
no peer implementation and keeps the PR current with the accepted develop
publication. Root adopts that identical tree by a checked fast-forward on
this same assigned branch; no reset, rebase, force push or protected-branch
merge is authorized. The actual final SHA/tree will be verified from the
remote commit, local checkout and final-head CI.

## Approved final read-projection clarification

Before the correction, root approves an additive `latestAttemptStatus` on the
new R31 My Plan payment projection in the already leased
`packages/contracts/src/money/subscription-contracts.ts`. The existing R19/R24
`PaymentIntentWireV1`, intent state and subscription authority remain unchanged.
Real visual review showed a failed attempt beside a still-processing intent;
the explicit frozen attempt status lets the UI explain both facts, including
an active subscription with a separate failed payment. Backend and frontend
writers may resume only their already approved feature/spec files for this
correction. Tests cover both failed-payment and active-subscription cases;
no schema, policy, adapter, permission or new ownership path is introduced.

## Approved browser-fixture identifier correction

The exact staged-tree Gitleaks scan correctly stopped publication on a generic
API-key rule matching the literal synthetic plan identifier in
`apps/api/test/support/r31-browser.fixture.ts`. The value is a public test plan
name, not a credential. Before edits, root reactivates `pr_ci_audit` as the sole
writer of that already approved fixture path to use the shorter descriptive
identifier `r31-test-plan`. No scanner rule, exclusion, threshold or production
input changes. Verification: scoped fixture lint/typecheck, actual pre-commit
hook, complete staged-tree rescan, and the clean committed-source browser
matrix. No other path is delegated.

## Approved CodeQL descriptor-bound reads

Official CodeQL security result on PR #186 head
`2ce7dcece60151f30390ee1adcaadcb43a90e066` reported two `js/file-system-race`
findings (CWE-367), despite the successful analysis workflow. Before corrective
edits, root reactivates these exact disjoint writer leases:

- `r31_frontend`: `apps/web/e2e/r31-subscriptions/my-plan.real-api.spec.ts`.
- `pr_ci_audit`: `scripts/production/subscriptions/verify-my-plan.cjs`.

Replace path-check-then-reopen sequences with one non-following open and
descriptor-bound metadata/read operations, closing the descriptor in `finally`.
Credentials must remain regular mode-0600 files and cannot follow symlinks;
source hashing must inspect and hash the same opened file. Unsupported file
types fail closed. Preserve source-drift checks, private output, exact browser
matrix, cleanup and every security rule. Exercise the credential/source race
boundaries with isolated temporary files, run relevant type/lint checks, the
actual pre-commit hook, full candidate/committed scans and final-head browser
and official CodeQL. No policy, budget, dependency or runtime authority changes.

Both leases are returned frozen after implementation. Isolated scratch checks
of the actual functions passed 12/12 credential cases and 9/9 source-identity
cases, including real no-writer FIFOs and descriptor closure on error. Relevant
lint, format, syntax and E2E type checks pass. Root serializes the four-file
corrective publication (these two files and this CR/ACCEPTANCE evidence) and
requires fresh clean-head browser and official CodeQL results.
