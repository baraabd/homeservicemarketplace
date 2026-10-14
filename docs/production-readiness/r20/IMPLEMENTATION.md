# R20 — Production storage, private media authorization and persistence: implementation

| Field              | Value                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sprint             | R20 (wave 1 of 4, lane 2 of 5; legacy coverage P45)                                                                                                                |
| Branch / worktree  | `feat/r20-storage-production` / `HSM-r20`                                                                                                                          |
| Base               | `059c018576a75837d4dfb262ee49168d9217d881` (`develop`; the wave-1 G0 base the owner approved for this wave)                                                        |
| Source / final SHA | recorded in `ACCEPTANCE.md`                                                                                                                                        |
| Status             | **IMPLEMENTED, SOURCE_VERIFIED (emulator: real MinIO + real PostgreSQL), INTEGRATION_PENDING** (CR-R20-01…07). Not HOSTED_ACCEPTED. Receipt policy POLICY_BLOCKED. |

## 1. Write allowlist (proposed ownership roots + dedicated test directory)

The coordinator did not answer an explicit allowlist question in this session;
the lane used exactly the prompt's proposed ownership roots plus one dedicated
test directory, and records the resulting file list here for approval at G1.

```
apps/api/src/infrastructure/storage/local-disk-restricted-storage.adapter.ts  (modified)
apps/api/src/infrastructure/storage/local-disk-storage.adapter.ts             (modified)
apps/api/src/infrastructure/storage/restricted-object-storage.port.ts         (modified)
apps/api/src/infrastructure/storage/s3-restricted-storage.adapter.ts          (modified)
apps/api/src/infrastructure/storage/s3-storage.adapter.ts                     (modified)
apps/api/src/infrastructure/storage/s3-portfolio-storage.spec.ts              (modified)
apps/api/src/infrastructure/storage/s3-storage-root.ts                        (new)
apps/api/src/infrastructure/storage/storage-root.ts (+ .spec.ts)              (new)
apps/api/src/infrastructure/storage/storage-diagnostics.ts (+ .spec.ts)       (new)
apps/api/src/infrastructure/storage/storage-inventory.ts                      (new)
apps/api/src/infrastructure/storage/storage-doctor.ts                         (new)
apps/api/test/integration/r20-storage/**                                      (new)
infra/production/storage/**                                                   (new)
scripts/production/storage/**                                                 (new)
docs/production-readiness/r20/**                                              (new)
```

No file outside this list was written. No lease was requested or used.
`storage.module.ts` and `storage.port.ts` are unchanged; no env key, schema,
migration, contract, AppModule, CI, Docker or web file changed.

Part of the source diff was written by an earlier, interrupted R20 session
(uncommitted in this worktree at 2026-10-13 23:33). It was reviewed line by
line before adoption; one regression in it (F2) was found and fixed.

## 2. Trace of the four media paths (requirement 1)

| Path                                              | Upload                                                                                  | Finalize / claim                                    | Read                                                                                          | Delete                                                           | Policy kept                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| Request attachment `requests/<hmacRef>/<uuid>`    | presigned browser PUT, write-once (`If-None-Match`)                                     | `request-media.service.ts:278` reads leading bytes  | public CDN / `GET /v1/media/files/*`                                                          | `public-media-cleanup.service.ts:145`                            | PUBLIC, key-addressed                        |
| Avatar `avatars/<ref>/<uuid>`                     | presigned browser PUT                                                                   | `provider-avatar.service.ts:91` reads leading bytes | public                                                                                        | cleanup worker                                                   | PUBLIC; **S3 not write-once (F5)**           |
| Portfolio staging `portfolio-staging/…`           | presigned PUT to the private staging bucket; refuses when privacy cannot be established | moderation                                          | API only, owner/reviewer                                                                      | cleanup                                                          | never public                                 |
| Approved portfolio `portfolio/…`                  | —                                                                                       | moderation approval                                 | `GET /v1/media/files/*` → `openPublic` re-checks `APPROVED` (`portfolio-media.service.ts:49`) | cleanup                                                          | API-mediated even though the row is `PUBLIC` |
| Identity evidence `verification/<case>/<asset>`   | server-side stream to `RESTRICTED_OBJECT_STORAGE`, create-only                          | scan gate                                           | `evidence-read.controller.ts`: fresh permission, audit, `no-store`, streamed                  | retention worker `eraseObject` (all versions + verified absence) | RESTRICTED                                   |
| Dispute evidence `verification/disputes/<id>.enc` | same port                                                                               | scanner                                             | dispute workspace, `private, no-store`                                                        | `workspace-evidence.service.ts:439` `eraseObject`                | RESTRICTED                                   |
| Payment receipts                                  | **none exist** in code or schema                                                        | —                                                   | —                                                                                             | —                                                                | proposal only (CR-R20-06)                    |

A `PUBLIC` model label is never treated as read authority: approved portfolio
stays API-mediated and the plan grants no bucket/CDN read on `portfolio/*`.

## 3. Findings and dispositions

| #   | Finding                                                                                                                                                                                                                                                                        | Evidence                                                                                                      | Disposition                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **S3 presigned uploads did not bind `Content-Type`.** The presigner signs only `host;content-length;if-none-match`, so a browser could store any type (e.g. `text/html` on a PNG/HTML polyglot) on an object served publicly. The local driver already bound it into its HMAC. | probe of `X-Amz-SignedHeaders`; real-storage test "refuses a different MIME type" failed (200) before the fix | **Fixed** (`s3-storage.adapter.ts`: `signableHeaders: ['content-type']`). All three web clients PUT with the exact presigned type (avatar `image/jpeg`, request/portfolio `file.type`).                                                       |
| F2  | WIP regression: local `eraseObject` refused any unmarked, empty root — exactly what the CI retention suite (`evidence-retention.integration`, local leg) erases on in `beforeEach`.                                                                                            | code read + new unit test                                                                                     | **Fixed**: refuse only a root directory that does not exist or is marked for another namespace; erasing never writes a marker.                                                                                                                |
| F3  | Windows: `stat` under a regular-file ancestor returns `ENOENT`, so local `head()` reported absence for a damaged root and erasure could certify it. Pre-existing; failed `restricted-erasure.spec.ts` on this host.                                                            | `node` probe (`ENOENT`)                                                                                       | **Fixed**: absence only when the nearest existing ancestor is a directory.                                                                                                                                                                    |
| F4  | Wrong-root false erasure receipts (worker in another cwd, copied bucket env).                                                                                                                                                                                                  | WIP analysis                                                                                                  | Fixed by WIP root markers (`storage-root.ts`, `s3-storage-root.ts`); proven across separate processes with `storage-doctor`. Fail-closed on an _absent_ bucket marker needs a flag → CR-R20-02.                                               |
| F5  | S3 avatar presigns are not write-once: the avatar client sends no `If-None-Match`, so a replay inside the 5-minute window replaces finalized bytes. Signing it server-side would break avatar upload.                                                                          | real-storage test (documented gap, asserts current behaviour)                                                 | **CR-R20-03** (web + API, sequenced). Local driver is write-once for every key.                                                                                                                                                               |
| F6  | Evidence read route does not pass the recorded size, so a substituted object would be streamed; it also sets PDF/attachment headers before opening the object, so storage-side 404s carry a JSON body labelled as a PDF.                                                       | route suite over S3 (two documented-gap tests)                                                                | **CR-R20-01** (controller outside the lane). Adapter integrity check implemented and proven.                                                                                                                                                  |
| F7  | Storage faults were flattened (public head → `null` for every cause) or logged with raw bucket/key.                                                                                                                                                                            | code read                                                                                                     | Fixed (WIP + review): `missing / denied / misconfigured / unavailable` classification, key fingerprints, no bucket/key/endpoint/message in logs or thrown errors. Proven against real wrong-credential, wrong-bucket and dead-endpoint cases. |
| F8  | Public writes on the local driver overwrote non-portfolio/request keys (avatars).                                                                                                                                                                                              | WIP                                                                                                           | Fixed: every local public key write-once (`wx`); all public keys embed a fresh UUID.                                                                                                                                                          |
| F9  | No least-privilege, encryption, versioning, lifecycle, CORS or CDN plan existed.                                                                                                                                                                                               | —                                                                                                             | Added `infra/production/storage/**` + executable validator; role policies applied to real MinIO users in tests.                                                                                                                               |
| F10 | Public-bucket delete is a delete marker under versioning; bytes persist until noncurrent expiry.                                                                                                                                                                               | orphan suite                                                                                                  | Documented; public noncurrent expiry 30 d in plan. Restricted erasure deletes every version itself.                                                                                                                                           |
| F11 | No restore/inventory contract for R36.                                                                                                                                                                                                                                         | —                                                                                                             | Added `storage-inventory.ts` + CLI: versions, delete markers, sizes, ETags, optional SHA-256, manifest digest, key/bucket fingerprints only.                                                                                                  |
| F12 | Dispute evidence scan uses app-clock `nextAttemptAt` vs DB `NOW()` (`workspace-evidence.service.ts:190` vs `:312`); a scan immediately after upload is not "due" when the DB clock is behind (measured −24 ms here). Pre-existing, outside the lane, unrelated to storage.     | `dispute-workspace.integration` flake: received `STORED`                                                      | Reported in `RISKS.md` for the dispute owner; not changed.                                                                                                                                                                                    |

## 4. Design notes

- **Restricted reads stay URL-free.** The port has no URL-producing method;
  tests assert none exists on the S3 adapter. Receipts, if approved, reuse the
  same port under `finance/receipts/` (CR-R20-06); identity erasure refuses that
  namespace by construction.
- **Root identity.** One marker per root/bucket, random non-secret `rootId`.
  Local markers are created by hard link from a complete temp file, so racing
  processes agree. S3 accepts an _absent_ marker with a one-time warning
  (rollout posture) and refuses a marker for another namespace.
- **Diagnostics.** `storage-doctor.ts` reads only; it never creates a marker or
  directory and never searches. `bucketRef`/`keyFp` are truncated SHA-256.
- **Inventory.** Key-free output; `verifyRestore` compares sizes (shallow) or
  SHA-256 (deep), never ETags (they differ across buckets under SSE-KMS /
  multipart). Output files are written exclusively with mode 0600.
- **Plan validator** (`storage-plan.cjs`) encodes the safety invariants; a
  mutation test exists for each.

## 5. Contract / schema versions

| Artifact                   | Version                           |
| -------------------------- | --------------------------------- |
| Root marker                | `hsm.storage-root/v1`             |
| Inventory                  | `hsm.storage-inventory/v1`        |
| Restore report             | `hsm.storage-restore-report/v1`   |
| Doctor report              | `hsm.storage-doctor/v1`           |
| Storage plan               | `hsm.storage-plan/v1`             |
| Prisma schema / migrations | unchanged (67 migrations at base) |
| Shared contracts           | unchanged                         |
