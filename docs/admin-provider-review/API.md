# Admin provider application review

The Admin workspace reuses the application's existing authentication, permissions,
Prisma transactions, verification state machine and notification outbox. It adds
one orchestration service; it does not replace the provider's independent onboarding,
verification, standing or work-access axes.

## HTTP contract

All routes are API version 1, authenticated and Admin-only. Commands also require
CSRF protection. Shared request/response types live in
`packages/contracts/src/admin/provider-review/index.ts`.

| Method and path                                                      | Purpose                                                                                      | Current permission                                                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/admin/providers/:providerProfileId/review`                  | Complete dossier, current facts, immutable latest submission, blockers and available actions | `user:read:any`                                                                                                       |
| `POST /v1/admin/providers/:providerProfileId/review/approve`         | Approve the exact submitted application and coordinate verification/work grant               | `user:read:any`, `verification:decide`; also `verification:evidence:view` when approving evidence in the same command |
| `POST /v1/admin/providers/:providerProfileId/review/request-changes` | Return the exact submission with targeted feedback                                           | `user:read:any`, `verification:decide`                                                                                |
| `PATCH /v1/admin/category-applications/:applicationId/review`        | Explicit separate trade approval or rejection                                                | `verification:decide`                                                                                                 |

Permissions for review decisions are read from current database role membership
inside the serializable transaction. Stale JWT role claims and cached permissions
cannot authorize a revoked review permission.

Every command carries `submissionId`, the opaque `expectedRevision`, and an
`idempotencyKey`. The exact retry by the same actor returns `changed: false` without
another decision, grant, audit record or notification. Reusing the key with altered
content returns `409 IDEMPOTENCY_KEY_REUSED`. A changed or superseded application
returns `409` with `STALE_REVIEW`, `SUBMISSION_SUPERSEDED`,
`SUBMISSION_ALREADY_DECIDED`, or `CONCURRENT_UPDATE` in `error.details.reason`.
Clients retain unsent reviewer comments and reload facts before retrying a conflict.

Approval includes a constrained `reasonCode`. Returning an application includes
1–30 feedback items with a six-task `taskId`, optional `field` and `itemId`, a stable
`reasonCode`, and a nonblank `providerMessage` of at most 2,000 characters.
The optional top-level `note` is administrative prose. It is stored on the
submission and is never copied into provider feedback, audit metadata or push
notifications. Feedback remains associated with the decided submission. Explicit evidence fields
`verificationDocuments`, `identityDocument` and `categoryLicense` also unlock the
corresponding verification task in the same transaction: submitted/in-review cases
become `ACTION_REQUIRED`; verified cases close as `EXPIRED` so the provider can
create a fresh case. Already editable cases remain editable. Personal profile corrections do not change identity
state, and the case transition does not send a duplicate notification.

## Approval invariants

A final approval requires:

- A live, eligible provider account with no restricted, suspended or terminated
  standing and an undecided `PENDING_REVIEW` application.
- A full `reviewSnapshot` matching the provider input currently stored. Older
  count-only snapshots are visibly unavailable and require correction/resubmission;
  they are never synthesized as historical evidence.
- At least one active, explicitly approved selected specialty and no undecided
  selected category application. A final click never approves unseen trades.
- A submitted/in-review case or a previously verified case. Its immutable
  requirements must match the submitted country, provider type and trade scope.
  All required evidence must be uploaded, restricted, clean, current and unexpired.
  An empty document list is not a waiver; `verificationRequired: false` must be
  explicitly pinned in the requirements snapshot.
- A reviewer distinct from the provider. If the command itself verifies evidence,
  the reviewer must also hold permission to open evidence. A previously verified
  case must retain its own active unexpired work grant.

The submission receipt, provider `ACTIVE`/`ACCEPTED` transition, case verification,
work grant, audit and persisted notification share one serializable transaction.
The existing verification workflow accepts the caller's transaction and suppresses
its duplicate notification. Standalone identity approval also rechecks current
clean, restricted, uploaded and unexpired evidence within a serializable transaction. Any failed write rolls the decision back. Standing is
never reset. The capability service remains the sole owner of `canWork`; a case
label or latest grant row is not used as a substitute.

Restricted evidence bytes remain behind the existing audited content route. The
dossier contains metadata only, and marks documents unviewable when the reviewer
lacks evidence access. Portfolio items have their own revision-based moderation
contract and private content route; portfolio moderation is not a prerequisite
for submitting an otherwise complete provider application.

## Existing cases and scope changes

New cases pin `subjectScope: { countryCode, providerType, categoryIds }` alongside
the policy requirements, including pending selected trades. Country uses a stored
ISO code; a localized display name is not interpreted as a country identifier.

A case predating scope stamps is reusable only when its original country/type and
an exact reconstruction of all policy versions in force at `case.createdAt` prove
that the current selected trades were covered. Missing, ambiguous or changed
historical requirements fail closed with `EVIDENCE_NOT_READY`.

The existing reviewer `reverify` action now also accepts `DRAFT`, `SUBMITTED`,
`IN_REVIEW` and `ACTION_REQUIRED`, with the observed `expectedState` required by the
HTTP DTO. It closes the old case as `EXPIRED`, records `REVERIFY_REQUIRED`, and
closes only grants belonging to that case. It neither rejects the person's identity
nor edits historical requirements/evidence. The provider can then use the existing
create/resume flow to create a fresh case with current scope. This is the recovery
path when a draft's country or trade selection changed or legacy scope cannot be
proved. Returning the onboarding application can accompany the renewal request to
explain which task needs attention.

## Compatibility and delivery

The new Admin review routes are available without a UI feature flag. Existing
provider capability flags keep their meanings. When `VERIFICATION_ENFORCED` or
`WORK_ACCESS_ENFORCED` is enabled, the old status-only `/approve` command returns
`409 USE_REVIEW_WORKSPACE`, and its read model no longer offers that action. With
both flags off, the old command retains its compatibility behavior. New unified
approval always applies the full review invariants.

The migration adds nullable submission review metadata and a portfolio revision;
no historical application snapshots are fabricated. Deploy the database migration
before the API and web bundles. The notification is durable at decision commit;
`provider.review.decided` is registered with the outbox and publishes realtime only
after commit. Realtime delivery is an acceleration of the persisted feed and may be
lost or repeated around process failure without losing the decision.

Rollback should retain the additive columns and recorded review history. Revert the
application release rather than deleting decisions, evidence or grants. If rolling
back to a release without this outbox handler, drain/retain its events deliberately;
do not deploy an older worker that would dead-letter the new event type silently.
See `TEST_PLAN.md` for the distinction between fixture browser checks and real
persisted-flow acceptance evidence.
