# Admin approvals: discoverability and review redesign

## Baseline and scope

Mode B for the Admin home and registration-review navigation; integration
constraints retained for existing decisions. Base `1cc60f8c5dc229706232de6dc81514633528c542`
on `develop`, after the Claude design-policy PR #80 was merged. Provider repair
PRs #79 and #81 are independent and were not changed or merged by this work.

The user's report is that professional approvals do not appear in Admin.
Repository inspection establishes that the feature exists; it does **not**
establish which commit, role permissions, API, or build the user's device runs.
A redesign cannot by itself deploy a branch or repair an unobserved environment.

## Findings grounded in code

| Surface | Baseline finding | This change |
| --- | --- | --- |
| `/admin` | `AdminRouteContent` mounted only `DashboardOverview`: analytics and revenue, no approval entry or workload. | An approvals centre appears before the retained analytics. |
| Mobile navigation | Provider directory and reviews were behind the menu drawer. | Visible, wrapping shortcuts to reviews and all providers. |
| `/admin/reviews` | Already uses `ProviderDirectory` with pending/returned filters, cursor paging and server counts. | Reused unchanged; home links reach this actual route. |
| `/admin/providers/:id` | Already has all six sections, protected identity inspection, specialty/portfolio moderation and final commands. | Six descriptive snapshot cards replace bare navigation labels; each jumps to its existing section. |
| Snapshot semantics | Submitted and current projections are intentionally separate. | Summary cards use the selected snapshot and never substitute current data for an unavailable historical snapshot. |
| Work permission | `canWork`, capabilities, blockers and available actions are server facts. | The new UI reports those facts; no parallel readiness rules or shortcut approval. |
| Queue errors | Lack of provider-read permission must not look like no applicants. | Failed reads hide cached identities/totals, distinguish 403 and offer retry for transient failures through the shared error component. |

No Admin rollout flag is introduced. The provider onboarding V2 flag is not
an Admin display switch. Missing entries on a device still require comparing
that device's served build with this branch.

## Existing end-to-end route and permission chain

`/admin/*` -> `AdminPage` -> `AdminDashboard` -> `AdminRouteContent`.

- Directory: `GET /v1/admin/providers`; the new overview requests
  `status=PENDING_REVIEW`, `sort=SUBMITTED_OLDEST`, `limit=5` using the existing
  `useAdminProviders` hook and its existing query keys/invalidation.
- Dossier: `GET /v1/admin/providers/:id/review`.
- Decision: `POST /v1/admin/providers/:id/review/approve` or
  `POST /v1/admin/providers/:id/review/request-changes` through the existing API.
- `AdminProviderReviewService` freshly checks `user:read:any` for reading and
  `verification:decide` for decisions; protected evidence requires
  `verification:evidence:view`, portfolio moderation uses `portfolio:review`.
- Decision commands keep submission ID, opaque content revision and idempotency
  key. The existing serializable transaction, conflict handling, audit,
  notifications and verification/work-access workflow remain unchanged.
- An identity state or an ACTIVE label alone is not proof that work is allowed.
  The UI continues to render authoritative capabilities and denial reasons.

## Dossier coverage retained

1. **Basics and identity:** individual/business type, name, company name,
   contact details and their verification facts, photo, identity case,
   required documents, scan/viewability metadata and protected inspection.
2. **Services and experience:** specialties, primary specialty, experience,
   profession start, equipment, transport and specialty decisions.
3. **Work area:** country/code, city, service radius, selected areas,
   workshop address and available service/workshop coordinates.
4. **Working hours:** time zone, all seven weekdays, each saved time interval
   and closed days.
5. **Profile and portfolio:** title, biography, additional information,
   snapshot portfolio metadata, publication acknowledgement and current
   image inspection/moderation.
6. **Submission and consent:** submission/capture dates, policy version,
   terms acknowledgement, decision, reviewer history and specific corrections.

The six new cards summarize these facts; “Inspect details” does not mean
complete/approved. Warning counts come only from task-associated server blockers.
Global blockers remain in the decision panel. Final approval remains there,
with the existing explicit confirmation, not on a list row or summary card.

## Design and maintainability

Retain the Admin amber/slate identity and existing dark-mode tokens. Small
feature components own home composition, preview rows, mobile navigation and
bilingual copy. Reuse `ReviewBadge`, `StatusBadge`, `ProviderSubmission`,
`DirectoryError`, the complete directory/dossier and existing decision controls.
No second API client, global store, lifecycle resolver, dependency, schema,
migration, permission grant or feature-flag default is added.

Mobile-first grid at 320/390/430; four workload cards where space permits;
main queue plus context at wide desktop; RTL uses logical CSS and isolated
bidirectional values. Focusable links retain the existing minimum target size.
No decorative phone frame, new dark-mode mechanism or duplicate backend logic.

## Verification and evidence boundaries

New component tests cover true server totals versus preview length, unknown
counts, loading/empty/denied/error states, actual links, retry, language/direction,
all six anchors, selected-snapshot summaries and non-invention of readiness.

`admin-approvals-overview.spec.ts` exercises the real built application with
**illustrative API fixtures** across 320, 390, 430, 768, 1024, 1440; EN/AR;
light/dark. It asserts geometry, scoped axe checks, visible entry, queue/reload
navigation and denial behavior, then attaches 24 PNGs and provenance metadata.
These captures do not prove server authorization or persistence.

The existing `admin-review-workflow.real-api.spec.ts` suite now follows the
home approval link through `adminNavigation`, asserts an actual loaded count,
and captures the real-HTTP home before proceeding. Its existing approval,
correction, protected evidence, reload and work-denial assertions remain intact.
It captures the updated dossier on the existing EN/AR light/dark matrix.
No test, visual budget, security gate or CI configuration was disabled.

The editing environment could not resolve GitHub for a full clone and lacks
pnpm, Docker and the application dependencies. Exact original blobs for edited
files were reconstructed and hash-checked. Local syntax/isolated checks do not
replace full project typechecks or browser acceptance. The PR must report final
CI results separately; screenshots require actual human/model inspection after
retrieval, not a passing test or an `inspected: false` provenance marker.

## Adoption and remaining environment checks

No deployment or merge is performed by this change. After review and acceptance,
build/deploy the same approved commit and verify `/admin`, `/admin/reviews` and
`/admin/providers/:id` using an authorized reviewer account. Preserve rollout
and rollback configuration. Never fix a permission error by removing guards.

When a screen is still missing: verify the checkout/deployment revision,
frontend API origin, failed network requests and the actual review permissions.
A 403 is an access issue, a 404 may indicate an outdated route/API or unknown
resource, and a successful empty list may mean a filtered queue or unsubmitted
drafts. Do not label any of these as confirmed without observing that runtime.
