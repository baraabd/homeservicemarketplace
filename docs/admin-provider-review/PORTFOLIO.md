# Portfolio review and private delivery

Mode C adds the review capability; Mode A preserves the Provider layout and fixes publication boundaries. Portfolio remains optional for onboarding. A pending image does not prevent a provider from submitting their application. Approving the provider does not automatically approve any image.

## API and permissions

| Method | Route under `/v1`                                      | Permission / purpose                                                                     |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| GET    | `/admin/providers/:profileId/portfolio`                | `portfolio:read`; live items, current revision, actions, latest 200 gallery audit events |
| GET    | `/admin/providers/:profileId/portfolio/:itemId/media`  | `portfolio:read`; authenticated reviewer stream                                          |
| PATCH  | `/admin/providers/:profileId/portfolio/:itemId/review` | `portfolio:review` + CSRF; `{action, expectedRevision, reason?}`                         |
| GET    | `/me/provider/portfolio/:itemId/media`                 | Owner and existing Provider profile capability                                           |
| GET    | `/media/files/portfolio-staging/...`                   | Public only while a linked, live item is `APPROVED`                                      |

Admin routes require the existing Admin role. Sensitive permission checks read current active user role assignments from PostgreSQL, ignoring stale token or Redis grants. Decisions recheck permission inside their serializable transaction. Administrators cannot review their own images. Rejection requires an explanation visible to the provider. Responses contain no object keys, reviewer personal data, or signed GET URLs.

A decision conditionally updates the exact displayed revision, increments that revision and writes an audit event in one transaction. The losing concurrent request gets `409 STALE_REVISION`. A failed audit write rolls the transaction back. Editing title, description or category resets moderation to `PENDING`, clears the prior displayed rejection, increments revision and preserves audit history. Reordering retains the decision. Decisions can be reversed against the new displayed revision; retrying an old revision is a conflict, never a second silent decision.

`availableActions` is server-owned. `MEDIA_MIGRATION_REQUIRED` and `PUBLICATION_ACK_REQUIRED` explain otherwise valid items that cannot be decided. No generic approval or provider activation route changes image moderation. History is deliberately bounded to the latest 200 gallery events; the platform audit log retains older events.

## Storage boundary

New uploads use `portfolio-staging/<opaque-owner-ref>/<random-id>.<ext>`. The prefix is separate from verification evidence. The existing PUBLIC media ledger remains the lifecycle owner: `visibility=PUBLIC` means eligible for eventual publication, not that an arbitrary object URL is readable. A DB projection alone is not the privacy boundary.

For local storage the public GET route resolves the persisted item and current moderation before opening a stream. For S3 the bytes live in a **dedicated private** `S3_PORTFOLIO_BUCKET`, distinct from both `S3_BUCKET` and `S3_RESTRICTED_BUCKET`. Upload presigning verifies all four S3 public access block controls and that the bucket policy is not public. Missing configuration or unverifiable protection refuses new portfolio uploads with a safe 503. It does not prevent unrelated application boot or request/avatar uploads. S3-compatible vendors without the required privacy inspection APIs need an equivalent verified adapter before portfolio upload can be enabled; no permissive fallback is provided.

The bucket must allow the application principal `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:GetBucketPublicAccessBlock`, and `s3:GetBucketPolicyStatus` as applicable, scoped to the portfolio bucket. Enable bucket public access block and bucket-owner-enforced object ownership. Do not configure a public website endpoint, public ACL, or public CDN origin for this bucket. Set `PUBLIC_API_URL` to the externally reachable API origin for generated mediated URLs. The application never signs a GET URL for staging.

Configure portfolio bucket CORS with the actual frontend origin, PUT, `Content-Type`, and **`If-None-Match`**. The signed PUT requires `If-None-Match: *`; the frontend includes it. Local writes use exclusive file creation. Reusing an upload URL therefore cannot replace already reviewed bytes. Attachment verifies stored length and image magic bytes (JPEG/PNG/WebP), not only the client declaration. API streaming uses `private, no-store`, `nosniff` and a restrictive content security policy. Owner/reviewer clients fetch blobs through the existing authenticated API client and revoke temporary object URLs.

The existing public-media retention worker also deletes staged objects through the same storage abstraction, which chooses the bucket from the server-owned namespace. Identity evidence remains on the separate restricted port and is never read by portfolio code.

## Existing public objects: migration gate

Old `portfolio/` S3 URLs may already exist in browser/CDN caches. This code cannot revoke those URLs by hiding a row. Legacy S3 items therefore require migration before metadata changes or new moderation decisions. Approved legacy content remains readable during rollout; no automatic database migration changes a moderation decision or assumes old bytes are private.

The operator utility is dry-run by default:

```sh
node scripts/maintenance/migrate-portfolio-staging.cjs --limit 100
```

It reports counts only and changes neither storage nor rows. Run it with the normal API database and storage environment, after building database dependencies. To migrate bytes, use a durable private journal:

```sh
node scripts/maintenance/migrate-portfolio-staging.cjs --apply --journal /secure/operations/portfolio-migration.json --limit 100
```

By default it selects live, non-approved legacy portfolio assets. Add `--include-approved` only when intentionally migrating the existing approved gallery too. The journal is written before mutations and contains storage keys; restrict its permissions and keep it outside the repository and public artifact storage.

For each item the utility copies bytes to private staging, verifies complete-byte SHA-256 equality, conditionally updates the media reference and item revision with an audit record, then deletes the old source object. A crash after the DB commit resumes source deletion from the journal. Unfinished entries are never reported as completed. Item changes produce a refusal requiring operator inspection. Existing moderation state is retained. Running another bounded batch with the same journal adds still-legacy candidates and resumes pending work.

After source deletion, invalidate the old URLs in every CDN and verify unauthenticated origin/CDN requests fail. A successful utility run explicitly reports `cdnPurgeRequired: true`; it does **not** establish cache revocation. If an urgent privacy incident exists, block old paths at the public origin/CDN before migration. Do not claim all historical pending bytes are private until the storage deletion and CDN invalidation have been independently checked.

## Rollout and rollback

Deploy the additive schema migration and permission seed/migration, provision private staging and CORS, then deploy the API and compatible frontend together. `MODERATION_REVIEW_AVAILABLE=true` ships with the actual Admin API. `PUBLIC_PROFILE_ROUTE_AVAILABLE=false` remains accurate: this work does not create a customer-facing profile route.

Keep the mediated read boundary and exclusive PUT behavior during rollback. Rolling back to a version that treats staging as public or restores direct public URLs is unsafe. Disable new portfolio uploads at the deployment edge while repairing storage configuration if necessary; do not grant public bucket access as a workaround. Additive columns and audit values can remain while rolling forward with a repair.

## Verification

Focused tests cover revision conflicts, self-review, fresh permission revocation, rejection explanations, no success after failed audit persistence, legacy migration blocking, owner/media namespace boundaries, and the existing public/restricted media routes. The real-database portfolio HTTP suite adds concurrent review, retained decisions after reorder, reset after material edits, and durable history. Database-gated tests and S3 migration/live bucket privacy require the corresponding environment; a mocked storage test does not prove CDN revocation or production bucket policy.
