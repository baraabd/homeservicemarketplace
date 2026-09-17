# Admin approval center — September 2026

## Scope and baseline

Mode B for the Admin home and review navigation; a bounded reliability fix for
review decisions during failed/pending refresh. Base inspected:
`1cc60f8c5dc229706232de6dc81514633528c542` (`develop`, after the Claude policy update).
No merge or deployment is part of this change.

The user reported that previously developed provider approvals were not visible.
Inspection distinguishes what is proved from what remains unknown:

| Surface | Finding at the baseline | Change |
| --- | --- | --- |
| `/admin` | `AdminRouteContent` rendered only `DashboardOverview`: finance/analytics, no application review entry or queue summary. | Make provider approvals the first section, retaining the existing analytics below. |
| `/admin/reviews` | The real route and navigation already existed. `ProviderDirectory` defaults to submitted `PENDING_REVIEW`; returned applications remain selectable. | Reuse it; link directly from the home CTA and counts. |
| `/admin/providers` | Already lists all lifecycle states, including unsent drafts. A draft is not an application awaiting approval. | Give drafts an explicit home entry and explain why they do not appear in the submitted queue. |
| Provider dossier | Six data sections, received snapshot/current comparison, identity viewer, specialties, portfolio moderation, corrections, history, and decision panel already existed. | Reuse the complete dossier; introduce a six-part review index with descriptions and server-reported blockers. |
| Refresh failure | The workspace intentionally retained inputs after 5xx refresh failure; simply hiding it would lose reviewer notes and break an existing regression. | Preserve input, but pause decision openers and confirmation until a fresh read succeeds. Continue hiding denied/not-found dossiers. |
| User's deployed/local build | Not observable through repository source. No claim that the user's runtime equals the inspected commit. | Document the expected route and adoption checks rather than silently changing flags or permissions. |

Relevant owners: `AdminDashboard.tsx`, `AdminRouteContent.tsx`,
`admin-routes.ts`, `ProviderDirectory.tsx`, `useAdminProviders.ts`,
`AdminProviderReviewWorkspace.tsx`, `ReviewDossier.tsx`, `ReviewDecisionPanel.tsx`,
and the API `provider-review.service.ts` / shared contracts.

## Intended experience

The landing page presents four independently linked server totals: submitted
applications awaiting review, registrations still in progress, active provider
profiles, and applications returned for changes. Active profile status is NOT
presented as proof of work access. Preview rows show the explicit work-access
answer when supplied; an absent answer remains unknown.

The next three applications use the existing server query, ordered oldest
submitted first. Counts come from the response's cross-page aggregates, not from
those three rows. No approval can be issued from a preview card. The reviewer
opens the full versioned dossier and can return to `/admin`; return destinations
remain restricted to the existing local allowlist plus that exact home route.

The review index names all six canonical sections and their purpose:

1. Contact information, provider/business identity and supporting documents.
2. Specialties, professional experience, equipment and category licensing.
3. Country, service area, districts, radius and workshop information.
4. Weekly availability and time zone.
5. Biography, portfolio content, moderation and publication rights.
6. Submitted snapshot, consent, corrections and decision history.

The index is navigation, not a client-side completion checklist. No blocker does
not mean a section is reviewed or approved. Only blockers actually attached to a
task by the server are highlighted. Existing immutable submitted data and current
information stay distinguishable throughout review.

## Architecture and safety

`admin-approvals/ApprovalCenter.tsx` composes the home from the existing provider
query hook, small read-only previews, centralized bilingual copy and scoped CSS.
It shares the established `--ar-*` brand tokens, badges, error presentation and
date formatting. No second API client, query cache, lifecycle resolver or backend
approval implementation was introduced.

`ReviewTaskIndex` consumes canonical task IDs and server blockers. The existing
dossier, identity viewer, portfolio/category review, account controls, decision
confirmation and history remain their original owners.

`ReviewDecisionPanel.readOnly` pauses new decisions during pending/failed dossier
reads, including confirmation inside the Radix portal, without clearing private
notes or correction text. The existing conflict-refresh/retry workflow remains.
A 401/403/404 still removes the unavailable dossier. This client affordance does
not replace server authorization: fresh permissions, expected revision, immutable
submission ID, idempotency, transaction safety, evidence checks, audit and work
capabilities remain server-owned and unchanged.

No schema, migration, dependency, production flag, security default, deployment
configuration or CI gate is changed. Historical prototype screenshots remain
untouched. The new home and review index are intentional design changes, not
silently rebaselined visual regressions.

## Acceptance and evidence

New unit scenarios cover server totals vs page length, zero vs unknown counts,
error vs empty, Arabic/RTL, encoded routes, bounded return targets, six canonical
sections, server-only blockers, and refresh failure/recovery with retained input.
Existing review tests continue to own stale revision, idempotency, correction
feedback, privacy and approval semantics.

The browser scenario enters the actual `/admin` route using HTTP fixtures for
repeatable presentation. Its matrix covers 320, 390, 430, 768, 1024 and 1440 CSS
pixels in English/Arabic and light/dark themes, with navigation/reload, focus,
overflow and automated accessibility checks plus PNG attachments. These are
presentation fixtures, not evidence of backend authorization.

The existing real-API Admin suite also verifies the new home after normal
login/OTP. It compares counts with the exact HTTP response consumed by the UI
and attaches actual runtime screenshots/source metadata. Existing real journeys
continue through submission, protected evidence, corrections, approval and
work-access denial/allowance. Test identities and the configured CI scanner are
not a claim of production malware-scanning effectiveness.

Local preparation uses selected source blobs reconstructed through the GitHub
connector and checked against their original Git blob hashes. This is NOT a full
application checkout. Network/dependency installation was unavailable locally;
full workspace tests, production build and final screenshot acceptance must be
reported from the final-commit CI artifacts, not invented as local passes.

Record exact commands, counts, CI head SHA and inspected PNG artifacts in the PR.
Keep the PR draft until required checks and visual review are complete. Do not
call an old commit's successful run evidence for a later patch.

## Adoption / rollback

After review and an authorized merge, update the relevant working checkout or
build/deploy the merged commit through the existing process. `/admin` must show
"Provider approval center" / "مركز موافقات المهنيين" without an extra feature
flag. The CTA opens `/admin/reviews`; `/admin/providers?status=DRAFT` is the
explicit destination for unsent registrations. Confirm the deployed version and
fresh Admin permissions before diagnosing a missing feature from an old bundle.
Do not grant new permissions merely to make a screen appear.

Rollback is a reviewed revert of this UI change. No data repair, database reset,
flag change or provider-status mutation is needed.
