# Admin provider review

[Screen organization and data completion](EXPERIENCE_COMPLETION.md) · [Policy settings](POLICY_SETTINGS.md) · [Protected identity preview](IDENTITY_PREVIEW.md)

This workspace connects the provider's six onboarding tasks to an explicit,
audited Admin decision. It extends the existing React, NestJS, Prisma and shared
contracts architecture. No new application framework is introduced.

The web bundler explicitly includes the linked CommonJS contracts package for
shared runtime constants in development and production, following
[Vite 6's linked dependency guidance](https://v6.vite.dev/guide/dep-pre-bundling#monorepos-and-linked-dependencies).

The implementation branch starts at Provider V2 commit
`4f1279d9f46439527040a5359cbc33351fcb0b02` (PR #76). Until that prerequisite is
merged, a comparison against `develop` also includes the Provider V2 changes.
Admin review must be reviewed as the changes after that commit.

## Entry points

- `/admin/users`: all application accounts, with search, filters and pagination.
- `/admin/providers`: providers, including profiles outside the pending queue.
- `/admin/reviews`: pending applications and review navigation.
- `/admin/providers/:providerProfileId`: the complete review workspace.
- `/provider/verification`: applicant access to the existing protected identity
  upload flow, including applicants whose workspace is not yet active.

Users in these directories are application accounts, not a paid subscription
ledger. Account standing, provider standing, onboarding, verification and work
access remain separate facts.

## Six task mapping

| Provider task           | Submitted information shown to Admin                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Basics and identity     | Provider type, personal/profile information, contact details and separate identity evidence |
| Work area               | Country code, city, selected areas, location and coverage                                   |
| Services and experience | Chosen specialties, primary specialty, experience, transport and saved equipment            |
| Working hours           | Timezone and availability intervals                                                         |
| Portfolio               | Profile presentation and optional portfolio submissions                                     |
| Review and consent      | Consent version, time and immutable submission identity                                     |

The new `reviewSnapshot` is an allowlisted, versioned snapshot captured during
submission. The older policy-evaluation `snapshot` remains intact. Existing
submissions without a full snapshot are labelled as unavailable; current data
is never presented as historical submitted data. Return those applications for
a new submission before final approval.

## API and ownership

Shared wire types live in `packages/contracts/src/admin/provider-review`.
Repository queries, pure policy and orchestration are separate files under
`apps/api/src/modules/admin/provider-review`.

| Method | Endpoint                                         | Purpose                                                                     |
| ------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
| GET    | `/v1/admin/providers/:id/review`                 | Submitted/current dossier, blockers, permissions and effective capabilities |
| POST   | `/v1/admin/providers/:id/review/approve`         | Approve the exact reviewed submission                                       |
| POST   | `/v1/admin/providers/:id/review/request-changes` | Return that submission with structured task feedback                        |

Decisions carry `submissionId`, `expectedRevision` and `idempotencyKey`. The
server recomputes the revision and validates the latest submission. A stale
review returns HTTP 409; the client preserves reviewer text while refreshing.
An identical replay returns the existing result without repeating grants,
notifications or audits. Reusing a key for different content is rejected.

The approval transaction checks current permissions, identity requirements,
category decisions, account/provider standing and submitted content. It writes
the exact submission decision, onboarding/profile state, identity decision and
work grant atomically. Notification persistence and an outbox event are in the
same transaction; realtime delivery happens after commit.

Specialties need explicit decisions. Optional portfolio publication has its own
per-item moderation and does not block an otherwise complete application.
The response exposes effective server capabilities; the frontend does not infer
permission to work solely from an ACTIVE badge.

## Identity and authorization

Sensitive account/dossier reads require fresh `user:read:any` permission.
Verification decisions and evidence use the existing `verification:*`
permissions. Portfolio review adds `portfolio:read` and `portfolio:review`.
Fresh resolution reads the actor's current active membership and grants rather
than trusting a stale JWT role or cached permission set. Self review is denied.

Identity documents remain restricted storage objects. Review responses do not
contain storage keys or signed URLs. The protected content endpoint records
access before disclosure; failed audit persistence returns 503 for an otherwise
authorized request. Unauthorized requests retain the same 404 response.

New verification cases pin country ISO code, provider type and selected
specialties in `requirementsSnapshot.subjectScope`. Pending specialties are
included so their license requirements are evaluated before category approval.
Historical policies are not silently replaced with today's policy.

Reviewer private notes stay separate from provider-visible correction items.
Feedback identifies the task, reason, message and optional field/item. The
latest returned feedback remains visible until a later submission supersedes it.

## Rollout

1. Apply migration `20260915010000_admin_provider_review`. It adds nullable
   submission history fields, portfolio revision, audit enum values and narrow
   portfolio permissions. It does not fabricate old snapshots.
2. Build the database and contracts packages before API/web builds. Fresh seeds
   and upgraded installations both grant the new permissions to the Admin role.
3. Configure private portfolio staging and migrate previously public pending
   assets as described in [PORTFOLIO.md](./PORTFOLIO.md). Existing public URLs
   need storage/CDN cleanup; database filtering cannot retract them.
4. Keep the existing enforcement settings explicit in each environment.
   With `VERIFICATION_ENFORCED` or `WORK_ACCESS_ENFORCED` enabled, legacy
   provider approval returns `USE_REVIEW_WORKSPACE`; it cannot bypass the new
   final decision. The new workspace performs its checks regardless of flags.
5. Run integration/browser gates on the exact release commit, then perform the
   application → correction → resubmission → identity/specialty review → final
   approval journey using seeded test accounts.

Deploying an older binary is not a supported authorization rollback with
enforcement enabled. Preserve the new history fields and restricted media; do
not reverse migrations by deleting submitted evidence or decision history.

## Verification and design

[UX_DESIGN.md](./UX_DESIGN.md) describes the Admin visual system, responsive
layout and accessibility. [TEST_PLAN.md](./TEST_PLAN.md) distinguishes fixture
browser evidence from real PostgreSQL/HTTP integration evidence. Successful
Admin screenshots are retained in the CI `playwright-report` artifact alongside
failure traces. Release results are recorded only after their checks complete.
