# Admin provider review: tabbed workspace v1

## Scope and baseline

Mode B for `/admin/providers/:providerProfileId`; the existing home approval center,
directory, API, permission policy and transactional decisions remain authoritative.
Baseline: develop `43bc876b4115661f3b06279e278e89c713cc6315`. Prerequisite: #88,
`16ce5129ba0cee00d925e7b28e82f895cdec8e16`, restoring the money contract export lost
at the Sprint 12 merge. Both CI and CodeQL pass on that prerequisite. That is not
acceptance evidence for this new UI.

The user requested finishing the previous work and verifying the actual build.
Existing reference screenshots show six anchor-linked sections rendered together.
The merged #82 improves discovery, but does not implement true tabs. The current
route already points at AdminProviderReviewWorkspace without an Admin UI flag.
We cannot establish the user's locally running/deployed SHA from repository source.

## Versioned design target

Keep the brand, status summary, submitted/current source distinction, complete
six-part dossier, restricted viewers and existing decision rail. Replace only the
long index-and-all-sections layout with a six-tab workspace showing one panel.

- Six canonical contract task IDs, not a second frontend state machine.
- Two-column tab navigation on narrow screens, three columns from 640px. Long
  Arabic labels wrap; targets remain at least 44px. No horizontal page overflow.
- English/LTR, Arabic/RTL, light/dark, widths 320/390/430/768/1024/1440.
- Radix's existing installed Tabs primitive owns semantic relationships and roving
  focus. Keyboard arrows, Home, End and Tab must work without a mouse.
- Previous/next controls help sequential review; opening a section never counts as
  approval. Only the server's blockers, actions and capabilities authorize work.
- Server issue counts remain text-labelled on inactive tabs. The decision rail
  retains all blockers, including those without a task. No issue is silently lost.
- Inactive panels are mounted but explicitly hidden from layout and accessibility
  navigation. Keep unsent state, existing metadata queries and explicit-only media
  reads. Do not load protected bytes merely because a tab was opened.
- `reviewTab` in the URL retains selection through reload. Preserve all unrelated
  query parameters, return links and router state. Replace tab-only history entries
  so Back does not walk through every section. Historical section hashes still
  select and focus the requested panel. Unrelated anchors do not reset selection.
- Source changes do not change the selected task; historical missing data is never
  reconstructed from current fields. 401/403/404 remove every panel and action.
  Failed/pending refreshes still block decisions and preserve permitted unsent notes.

This is an intentional v1 layout change; historical screenshots are not overwritten.
Automated evidence is necessary but is not a substitute for human visual acceptance.

## Integration and tests

ReviewTaskTabs and ReviewTaskPanel are presentation only. ReviewDossier, identity,
category, portfolio, history, correction dialogs and decision commands remain their
existing owners. ReviewSection falls back to normal rendering outside this shell.
No database, permission, security flag, dependency, production configuration or CI
threshold changes are required.

Unit coverage: one accessible panel, retained state, canonical URL parsing, invalid
input, router state preservation, legacy hash focus, issue counts, source fidelity,
refresh failures and decision idempotency. Existing non-tab tests remain in place.
Browser tests drive actual tab controls before asserting the original dossier fields,
viewers and history. They never force hidden content visible or weaken permissions.
Add keyboard/URL/reload/private-note and no-automatic-decision regressions. The real
Admin API suite still exercises login/OTP, corrections, protected evidence, portfolio
review and transactional approval/work access, and captures each panel at all six
widths in both languages/themes. Fixture screenshots are labelled separately from
real-HTTP captures. Existing API authorization and persistence assertions remain.

Required commands (workspace dependencies must already be installed):

```sh
pnpm --filter @homeservicemarketplace/contracts build
pnpm --filter @homeservicemarketplace/web lint
pnpm --filter @homeservicemarketplace/web typecheck
pnpm --filter @homeservicemarketplace/web typecheck:e2e
pnpm --filter @homeservicemarketplace/web test
pnpm --filter @homeservicemarketplace/web build
pnpm --filter @homeservicemarketplace/api typecheck
pnpm --filter @homeservicemarketplace/api build
pnpm --filter @homeservicemarketplace/web test:e2e admin-provider-review.spec.ts
node scripts/check-admin-review.mjs
```

Use the existing Admin real-route CI job for the normal-login real API acceptance;
a standalone stubbed browser run is not its replacement. Preserve all required
security, Docker, migration, provider and integration jobs. Record final-SHA CI
results in the PR; do not treat a prior SHA's passes as the new build's results.

## Activation and diagnosis

There is no new Admin flag. Rebuild the web app from the reviewed branch/SHA and
serve that build with the intended API. The provider's separate onboarding V2 flag
and backend enforcement settings are not changed by this UI work. Do not enable or
disable them simply to make a demonstration pass.

Run `node scripts/check-admin-review.mjs` in the checkout used to build. It prints
only source checks and Git identity, reads no .env or credentials, and cannot prove
deployment. On the normal Admin route, inspect the workspace element for
`data-admin-review-layout="tabbed-v1"`, six tabs and one visible tabpanel. Check the
normal authorized review GET, response status, source/version, and selected record.
An absent marker with passing source checks indicates a different/stale bundle or
entry point; investigate the serving process/build instead of changing permissions.
Do not run another server on an occupied port or delete the user's worktree.

Do not reset or clean a divergent local branch. Fetch and inspect in a separate
worktree; preserve local changes and environment files. Install with the committed
lockfile and the repository's declared toolchain. Source, built bundle, served
bundle and actual backend must be distinguished during manual acceptance.

Rollback: redeploy the previously accepted frontend artifact, or revert only the
Admin tabs commit and rebuild. Keep #88's independent contracts repair. No database
rollback or permission manipulation is needed. Merge/deployment are separate from
publishing and testing this draft and require authorization.

## Evidence status at authoring

The shell cannot resolve GitHub or npm, so a full local checkout/install/build is
not available. Source syntax checks and any standalone script checks are separate
from application typechecking. Publish as draft for final-SHA CI. Do not claim
runtime or visual acceptance until the respective results and inspected artifacts
are recorded. The user's local/production environment remains unobserved.
