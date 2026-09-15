# Review history and correction targets

The dossier's sixth section contains the unified history, followed by the latest
requested corrections. The decision panel can target a whole step, an editable
field, or a currently owned document, specialty, or portfolio item.

## Correction contract

`PROVIDER_REVIEW_CORRECTION_FIELDS` in the shared onboarding contracts is the
supported task/field catalog. Options correspond to editors that exist in the
Provider journey. Server-derived fields such as travel radius, public headline,
and provider type are intentionally not offered as editable correction targets.

The request-changes command validates each task/field combination after checking
the exact review revision and before any write, inside the existing serializable
transaction. An item id must belong to the reviewed provider's current content;
superseded evidence and mismatched document kinds are rejected. A whole-step
instruction remains valid when `field` is omitted.

Provider instructions display the localized field label. Navigation reuses the
existing task routes and `#experience`, `#portfolio`, and `#terms` sub-screens,
adding `reviewField` and optional `reviewItem` query values. A task-scoped hook
validates these domain values against the shared catalog and focuses the real
editor or the exact rendered, owned image/selected specialty. No URL value is
used as a DOM selector. Focus runs once per explicit navigation, waits for an
asynchronously rendered target, and cancels if the provider starts interacting.
Ordinary visits, readonly tasks, unknown fields and foreign item ids do not move
focus. Evidence corrections retain `/provider/verification`. These links do not
create a second save implementation. Unsent correction text and internal notes
keep their existing conflict/retry behavior.

## History read contract

`GET /v1/admin/providers/:providerProfileId/review/history?limit=20&cursor=...`
returns `{ items, nextCursor }`. It requires the admin role and a fresh
`user:read:any` permission. Page size is bounded to 50; cursor ownership is checked
against the same provider and permitted event types. Ordering is descending
`createdAt, id`, with a strict boundary for subsequent pages.

The endpoint projects an allowlist of audit events: application submission,
withdrawal, final decisions, correction requests, suspension/reactivation, note
updates, identity decisions/assignment, category decisions, and portfolio changes.
Portfolio events additionally require `portfolio:read`.

Response fields name the actor, event, time, recorded submission reference,
recorded image revision, and permitted review context. Exact submission links are
resolved against the provider id; an independent or older event without a stored
submission id stays unlinked. The endpoint never guesses the latest submission
or rebuilds an old decision from current profile values. A suspension lift is
displayed separately from application approval, even though the legacy audit
writer shares the approval event type.

Only reviewers with `verification:decide` can retrieve a submission's private
decision note. Provider feedback uses its existing explicit public projection.
Raw audit metadata, credentials, IP addresses, user agents, evidence contents,
storage keys, access logs, and signed URLs are excluded.

The React history query is under the existing admin-provider query-key root so
domain decisions can invalidate it with the dossier and directory. Loading,
empty, denied, failed, retry, and cursor-pagination states are explicit. A later
401, 403, or 404 hides cached timeline content, including private notes.

## Verification

Target validation unit tests cover unsupported fields, foreign item ids, scalar
fields with item ids, and superseded evidence. History service tests cover fresh
permissions, scoped cursors, stable pagination, redaction, exact provenance,
private-note visibility, and suspension-lift classification. HTTP/PostgreSQL
coverage lives in `admin-provider-review.integration.spec.ts`; frontend tests
cover field-specific payloads, public/private separation, history pagination,
retry, and existing Provider sub-screen links.
