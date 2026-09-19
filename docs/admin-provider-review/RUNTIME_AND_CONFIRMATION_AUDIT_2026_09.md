# Admin runtime and confirmation audit — 19 September 2026

Mode A: bounded integration, privacy and confirmation-safety fixes. Existing Admin
visuals, server decisions, authorization, migrations and rollout defaults remain
unchanged. This is not a whole-repository correctness certification.

## Source and delivery boundary

Inspected merged `develop` at `7390cfd89b4dadc4d9c648e071fc27710031770e`.
The Admin route already mounts the provider directory, independent review queue,
complete six-section dossier, identity cases and separate policy settings.
PR #82, including the Admin home approval center, is merged. None of those Admin
entries is hidden by a new UI feature flag.

The supplied old screenshot has a mixed verification/policies page and a sidebar
which does not match that source. This establishes a source/runtime discrepancy,
not which local process, checkout or image is responsible. Neither the user's
localhost nor production, current permissions or migration ledger was accessible.

PR #88 is merged as `66e6d93682dcdf6e5dd198c313f21f638dafe8de`.
Its post-merge CI run `35431755121` passed all 16 jobs. PR #89 is merged as
`7390cfd89b4dadc4d9c648e071fc27710031770e`. Its source tree is
`c93da8239d1131e8d8e82119c341ea53afa16cd7`, matching the previously tested #89
source tree. Its post-merge CI is `35434163048`; exact final results are recorded
separately in the PR verification evidence, never inferred from an earlier run.

This repair is based directly on that combined source and preserves #89's Radix
tabs, URL-owned navigation, source marker, immutable dossier sources and tests.
The old uncommitted workspace draft was NOT copied over the tabbed workspace.
The starting workspace was reconstructed and matched to its exact Git blob SHA
`9b3a2e40c24423d627a6ed505cfe833d344ddc59` before adding the child read-only props.
The money export is already part of the base, not a new change in this PR.
Neither a PR nor a green CI run updates a local Vite server or Docker image.

## Confirmed findings and repairs

| Finding | Repair and regression evidence |
| --- | --- |
| An open identity confirmation used the newly rendered case ID. A same-state replacement could silently retarget the command. | Capture case ID with action/state; recheck the currently returned case, state, permission and available action before dispatch. Test replacement, removal, state/action/permission changes, and a valid pinned command. |
| Final approval paused during a failed/pending dossier refresh, but identity, specialty and portfolio commands did not. | Propagate the same read-only state to all three reviewers, including already-open dialog portals. Check again in handlers; retain unsent notes/reasons. Test all three through the actual workspace component. |
| Portfolio cards disappeared after a list denial, but the already-open portal could retain protected metadata and resident image bytes. | On 401/403/404, hide the portal immediately, clear its selection, abort pending media reads and revoke the object URL. Regaining list access does not reopen the old image. Test resident and late responses. |
| An already-selected portfolio action could still be confirmed after refreshed moderation permission/actions or revision changed. | Recheck current permission, available action and exact inspected revision; never replace the selected revision implicitly. Read permission and moderation permission remain separate. |
| Portfolio conflict recovery treated a resolved `refetch()` error result as success if the parallel dossier refresh succeeded. | Check `isError` and throw the refresh error before dismissing the confirmation. Test a 409 followed by list 500 with successful dossier refresh; the typed reason remains. |

These are client intent, stale-state and privacy-display repairs, not replacements
for server authorization. Existing CSRF, expected-state/revision, ownership,
policy, audit and final approval/work-access checks remain authoritative. No
permission is added, no enforcement flag is disabled, and no provider is approved
by these changes. Account lifecycle controls remain independently owned.

## Safe local activation and diagnosis

First use read-only checks in the intended checkout:

```powershell
git status --short --branch
git rev-parse HEAD
git ls-files -u
git rev-parse -q --verify MERGE_HEAD
```

A nonzero exit from the last command normally means no merge is in progress. If
there are unmerged entries or `MERGE_HEAD` exists, stop here and resolve that merge
with preserved local work/backups. Do not reset, clean, force-push, discard stashes
or blindly switch branches. Do not infer a clean local checkout from GitHub.

After choosing an approved, tested commit and preserving local work, fetch and
check out that exact source. The repair branch is
`fix/admin-review-confirmation-safety`. It retains the merged six-tab review
experience. Keep the new PR draft until its own final-commit acceptance is recorded.

Confirm which process owns ports 5173/4173 and 4000 and its working directory.
Stop only the identified application processes before restarting; do not kill
unrelated containers or run a second API on the same port. A Vite page and a
container API may otherwise come from different checkouts.

Use the pinned Node/pnpm versions from `.nvmrc` and `package.json`, then install
with `pnpm install --frozen-lockfile`. Confirm the intended database and a verified
backup before applying pending migrations. The existing policy-management grant
is `20260915120000_verification_policy_management_permission`; this repair adds
no migration. Review all pending migrations, not just that grant. For a source-run
API, the existing database scripts are:

```powershell
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database build
pnpm --filter @homeservicemarketplace/contracts build
pnpm --filter @homeservicemarketplace/api build
pnpm --filter @homeservicemarketplace/web build
```

The database scripts use the repository-root `.env`; the Vite configuration loads
its web environment from the web working directory. Confirm `VITE_API_URL` before
the web production build. Never publish environment files or credentials. If
Prisma reports an unbaselined or failed migration (including P3005), stop and
reconcile the migration ledger; do not use reset, db push or demo seeding on an
existing database to make the message disappear.

For the Compose app profile, rebuild both images from the chosen source before
bringing up the API/migration job. Existing `docker:up:app` alone may reuse an old
image. The Compose profile does not serve the frontend:

```powershell
docker compose -f infra/docker/docker-compose.yml --profile app build api api-migrate
docker compose -f infra/docker/docker-compose.yml --profile app up -d
```

The existing Compose migration dependency must succeed before API startup. This
is an operator action against the selected database, not an action performed by
this audit. Keep volumes and existing data. Start the web separately with its
normal `pnpm --filter @homeservicemarketplace/web dev` or serve the matching
production build through the intended hosting setup.

Provider correction links use the existing V2 editor. That is separate from Admin
visibility: `VITE_PROVIDER_ONBOARDING_V2=true` is a build/startup setting; the browser
key `hsm.ff.providerOnboardingV2` can override it. Inspect/remove only that override
when testing the deployment default; do not clear all browser data. Restart Vite
or rebuild after changing the web environment. Do not switch server enforcement
flags to make a blocked application appear approved. The server's existing
`VERIFICATION_ENFORCED` and `WORK_ACCESS_ENFORCED` values must match the intended
rollout, and are not changed by this repair.

Verify `/admin`, `/admin/providers`, `/admin/reviews`, a genuine submitted
`/admin/providers/:id`, and `/admin/settings/verification-policies`. The old
`/admin/verification` bookmark must redirect to the review queue. A policy 403 is
not missing UI: check the existing `verification:policy:manage` grant using the
normal role process; do not grant broader permissions as a workaround. Confirm the
browser requests reach the intended API. Review one authorized application,
including corrections, required identity/portfolio reviews, final decision and
persisted work-access result after reload and sign-in. Do not use test applicants
or fixture policies as proof about real production records.

## Validation and rollback boundaries

The authoring container could not resolve GitHub for a full clone/install. The
merged workspace was reconstructed from connector reads and verified against its
exact Git blob hash; the unchanged component baselines were reviewed previously.
The local directory is a partial source fixture, not an application checkout.
Syntax transpilation and diff checks are not dependency-aware typechecking, unit
tests or runtime acceptance.

New automated regressions are ordinary Web Vitest tests, included in the existing
required Web job. Child-refresh tests select the actual merged tabs. The added
Playwright spec opens the portfolio tab through the normal control, exercises a
409 followed by a failed refresh and then a read denial, checks preserved reasons
and restored focus, and captures English desktop and Arabic mobile dialogs with
axe evidence. Their HTTP responses are fixtures. The unchanged required
Admin real-API job, provider persistence/browser gates, security scans and Docker
jobs must also pass on the final PR commit. Exact results, failures, skips and
inspected screenshots are recorded in the PR; do not reuse #82/#89's old results
as evidence for this repair. No thresholds, skips, workflows or dependencies are
changed to obtain a pass.

Rollback the application builds together if needed. No schema rollback is added;
keep published policies, historical decisions and existing migration records.
No merge, deployment, local process restart or user-database change was performed
by creating this branch and PR.
