# R06 — Request media authority and atomic attachment claim

Status: **IMPLEMENTED, PENDING MERGE.** This document records what the branch
`feat/r06-request-media-authority` changes and the evidence gathered for it. It
does not certify hosted production storage, which is a separate release gate.

Baseline: `origin/develop` @ `fb7a3135189c3568c15b7656f592f03c8cc1f314`.

## The gap that was confirmed in source

Before R06 the request-attachment lifecycle was:

| Step    | What happened                                                                                                                         | What the server knew        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Presign | `POST /v1/media/presigned-url` minted `requests/<userId>/<uuid>.<ext>` and returned a signed upload URL                               | Nothing. No row was written |
| Upload  | The browser PUT the bytes to storage                                                                                                  | Nothing                     |
| Create  | `POST /v1/me/requests` accepted `mediaUrls: string[]`, validated only that each entry looked like a URL, and stored the list verbatim | Only the URL strings        |
| Read    | Provider feed, provider request detail, seeker request and seeker booking projected `ServiceRequest.mediaUrls`                        | The same strings            |

A seeker could therefore attach an external URL, another user's object, an
object that was never uploaded, or the same object to many requests. Avatar and
portfolio uploads already had a reservation ledger (`MediaAsset`); request media
did not, and an existing test asserted that absence on purpose.

## The lifecycle now

| Step     | Endpoint / code                                                                                                                         | Authority                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reserve  | `POST /v1/media/presigned-url` (default purpose) → `RequestMediaService.reserve`                                                        | A `MediaAsset` row is committed **before** the upload URL is returned: owner, purpose `REQUEST_ATTACHMENT`, server-minted key, expected type, expected size, expiry. The response carries `assetId` |
| Upload   | Signed PUT to storage                                                                                                                   | Write-once: `IfNoneMatch: *` on S3, exclusive create on local disk                                                                                                                                  |
| Finalize | `POST /v1/media/request-attachments/finalize` → `RequestMediaService.finalize`                                                          | The server reads the stored object back and checks existence, exact size and file signature against the reservation                                                                                 |
| Claim    | `POST /v1/me/requests` with `mediaAssetIds` → `RequestMediaService.resolveClaimable` + `claim`, inside the request-creation transaction | Conditional `UPDATE` on owner, purpose, verified, unexpired, unclaimed, not retired                                                                                                                 |
| Read     | Unchanged                                                                                                                               | `ServiceRequest.mediaUrls` is now a server-written projection of the claimed assets                                                                                                                 |

Request creation accepts asset ids only. The legacy `mediaUrls` field is
tolerated **only as an empty list** and is ignored (see Rollout); any element in
it is a 400. No code path stores or resolves a client-supplied URL.

Ownership is `MediaAsset.ownerUserId`. Nothing derives authority from a storage
key or a URL. New keys are `requests/<opaque owner ref>/<uuid>.<ext>`, where the
ref is an HMAC of the user id, so a media URL no longer publishes an internal
identifier. URLs already stored on older requests keep resolving.

## Schema

Migration `20261002090000_r06_request_media_authority` is additive. All new
columns are nullable and no existing column changes meaning.

| Object                                                   | Purpose                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| enum `MediaAssetPurpose { REQUEST_ATTACHMENT }`          | What a public reservation was issued for. `NULL` for avatar and portfolio rows               |
| `MediaAsset.purpose`                                     | Set at reservation, never changed                                                            |
| `MediaAsset.serviceRequestId` (FK, `ON DELETE SET NULL`) | The one request an asset belongs to. A single column, so "at most one request" is structural |
| `MediaAsset.requestClaimedAt`                            | When the claim committed. Never cleared, so a used asset is never reusable                   |
| `MediaAsset.requestAttachmentPosition`                   | Display order                                                                                |
| unique `(serviceRequestId, requestAttachmentPosition)`   | One asset per position                                                                       |
| index `(purpose, serviceRequestId, uploadExpiresAt)`     | The unclaimed-attachment sweep                                                               |
| check `media_asset_request_claim_shape_chk`              | A linked row must be a PUBLIC, verified request attachment with claim time and position      |
| check `media_asset_request_claimed_purpose_chk`          | A claim time exists only on a request attachment                                             |
| check `media_asset_request_position_range_chk`           | Position is in range                                                                         |

The checks use `IS NOT DISTINCT FROM` for the purpose comparison. With plain `=`
a `NULL` purpose yields `NULL`, and a CHECK passes on `NULL`; the first version of
this migration had that bug and the integration suite caught it before commit.

Rollback / forward-fix: the columns, constraints and index can be dropped
without data loss to pre-R06 behaviour. Claimed assets would lose their request
link; the URLs already projected onto `ServiceRequest.mediaUrls` keep resolving.
Prefer a forward fix.

## Security model

| Concern                      | Answer                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication               | Presign, finalize and create require a session (`JwtAuthGuard`)                                                                                            |
| CSRF                         | All three are `CsrfGuard`-protected mutations                                                                                                              |
| Ownership / IDOR             | Every read and write of an asset is scoped to the session's user id. The body never carries an owner, a key or a URL                                       |
| Enumeration                  | Unknown, foreign, already-claimed and retired assets all return the same `409 ATTACHMENT_UNAVAILABLE`                                                      |
| Replay                       | `requestClaimedAt IS NULL` is part of the claim predicate and is never cleared                                                                             |
| Stale reservations           | `uploadExpiresAt > now` is required at finalize and at claim                                                                                               |
| Content                      | File signature of the stored bytes must match the reserved type; size must match exactly                                                                   |
| Tampering after verification | Uploads are write-once                                                                                                                                     |
| Cross-purpose                | The avatar/portfolio ledger refuses request attachments (`purpose: null` in its predicates) and the database refuses linking a non-attachment to a request |
| Sensitive fields             | Logs carry user id and asset id only: no key, no URL                                                                                                       |

Not added: a dedicated rate limit on finalize (it sits behind the global
throttle like presign), and malware scanning of public media (not present for
any public media today).

## Concurrency and idempotency

- **Claim**: every predicate is repeated in the `UPDATE`. Two requests racing for
  one asset both pass the read; the second `UPDATE` waits on the first's row
  lock, re-evaluates, matches nothing and throws, which rolls its request back.
- **Rollback**: the claim runs in the request-creation transaction. A failure
  after the claim leaves the asset unclaimed and usable by a retry.
- **Finalize**: idempotent. A finalized asset is returned again without touching
  storage; the completion write is conditional.
- **Sweep vs claim**: before deleting the bytes of an unclaimed attachment the
  sweep takes a fence with one conditional `UPDATE` (`retainUntil`); the claim
  requires `retainUntil IS NULL`. Exactly one of them wins.

## Cleanup

`PublicMediaCleanupService.sweep` now excludes any row with a
`serviceRequestId` from every branch, and gains one population: request
attachments that were finalized but never attached (or whose request was later
deleted), once their reservation expired more than the grace period ago.
Abandoned, never-finalized reservations were already swept.

## Evidence

Local run on Windows 11, Node 24.21.0, pnpm 10.32.1, throwaway PostgreSQL 16 and
Redis 7 containers, local-disk storage adapter.

| Check                                                                                                                | Result                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Migration clean replay (62 migrations, empty database)                                                               | PASS, no drift (`prisma migrate diff`)                                         |
| Migration upgrade from the `develop` schema with legacy avatar, reservation, restricted-evidence and legacy-URL rows | PASS, rows unchanged, no drift                                                 |
| `r06-request-media.integration.spec.ts` (real Postgres, real files)                                                  | 24 passed; repeated 8 further times without failure                            |
| Full gated API suite (`RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1`, 6 shards)                                      | 4846 passed, 33 skipped, 1 failed (see Findings, Windows-only, pre-existing)   |
| API typecheck / lint                                                                                                 | PASS / PASS                                                                    |
| Web typecheck / lint / unit                                                                                          | PASS / PASS (34 pre-existing warnings) / 2250 passed                           |
| `r06-request-media.real-api.spec.ts` (Chromium, real API, storage, Postgres)                                         | 2 passed; repeated 3 times together with the R05 real-API spec (4 passed each) |

What the integration suite proves, each against real Postgres and real files:
valid upload and creation in order; request without media; foreign asset; unknown
id; upload never made; uploaded but unverified; partial object; wrong stored size;
wrong content (PNG and HTML declared as JPEG); wrong transport type; expired
reservation at finalize and at claim; overwrite after verification; duplicate
claim; duplicate id in one request; six concurrent claims with one winner;
transaction rollback after the claim; partial batch; database constraint
refusals; abandoned and unclaimed sweep; claimed asset surviving the sweep;
swept asset not attachable; deleted-request asset retired and not reusable; claim
versus sweep race; seeker, matching-provider feed and detail, and seeker booking
projections.

What the browser suite proves: the real wizard uploads, finalizes and posts asset
ids with no URL in the payload; the database row links owner, purpose, request
and detected type; the stored bytes equal the uploaded bytes; after a hard reload
and after a fresh login the app's own request fetch returns the stored media and
Chromium decodes the stored object; and the real HTTP stack refuses URL injection,
foreign assets, replays, unverified, missing, partial and disguised uploads, and
overwrites.

Not proved here: an S3-compatible backend end to end (the S3 adapter's write-once
flag is unit-level only), and hosted production storage.

## Findings outside the R06 change

1. **The wizard silently dropped selected files (fixed in this branch).**
   `JobWizardModal` read the live `FileList` inside a deferred React state
   updater after resetting the input, so a file picked while other state updates
   were pending was lost and the request posted without media. jsdom computes
   the update eagerly, so unit tests could not see it. The files are now
   snapshotted before the reset. This was on the valid R06 path and blocked the
   browser acceptance.
2. **Provider booking detail does not project request media (not changed).**
   `ProviderBookingDetail` has never carried the request's media, so after a bid
   is accepted the provider no longer sees the seeker's photos. Pre-existing read
   gap; belongs to the request-to-booking lifecycle sprint.
3. **`<img>` embedding of local-disk media is blocked in a split-port topology
   (not changed).** The local file route answers with
   `Cross-Origin-Resource-Policy: same-site`, and Chromium reported
   `ERR_BLOCKED_BY_RESPONSE.NotSameSite` for an `<img>` load from the web origin
   on another port. A CORS fetch of the same object succeeds. The route and
   header are unchanged by R06, the root cause was not established, and
   production serves media from object storage rather than this route. Needs a
   follow-up before relying on the local route for visual acceptance.
4. **`restricted-erasure.spec.ts` fails one case on Windows (not changed).** The
   `ENOTDIR` case fails identically on the untouched baseline checkout; it passes
   on Linux CI.

## Rollout

- **Deploy order**: API first, then web. A web bundle built before R06 sends
  `mediaUrls` on every request. An empty list is tolerated and ignored, so a
  cached old bundle can still post a request **without** media. An old bundle
  posting **with** media gets a 400 until the user reloads; this is the intended
  fail-closed behaviour.
- **In-flight uploads**: keys reserved before deploy have no `MediaAsset` row
  and cannot be attached after deploy. The seeker re-uploads.
- **Existing requests**: untouched. Their `mediaUrls` keep resolving.
- **Cleanup worker**: the unclaimed-attachment sweep runs only where
  `PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED` is on. Where it is off, unclaimed
  uploads accumulate exactly as abandoned avatar uploads already do.
- **S3**: write-once uploads rely on conditional writes (`If-None-Match`),
  which the bucket's backend must support. This is already required for
  portfolio staging.
- **Feature flags**: none added.
