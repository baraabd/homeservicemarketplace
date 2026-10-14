# Production storage plan (R20)

A **reviewable plan**, not a deployment. Nothing here chooses an account,
region, bucket name, KMS key, CDN or paid service; every `${PLACEHOLDER}` is
supplied by the owner for a separately authorized target. Apply it only inside
an authorized test account first. The staging launcher (`../STAGING.md`)
still expects storage to exist before a rollout; wiring this plan into it is
change request CR-R20-05.

Reference vendor: AWS S3 IAM/bucket-policy JSON. Cloudflare R2, DigitalOcean
Spaces and MinIO implement subsets; translate, then re-run the checks below.

## Namespaces

| Namespace (env)                             | Holds                                                  | Read path                                                                         | Public read                    |
| ------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------ |
| `public` (`S3_BUCKET`)                      | `requests/`, `avatars/`, approved `portfolio/`         | `requests/`, `avatars/`: CDN. `portfolio/`: **API only** (moderation re-checked)  | CDN (OAC) on two prefixes only |
| `portfolio-staging` (`S3_PORTFOLIO_BUCKET`) | unmoderated portfolio uploads                          | API only (owner / reviewer)                                                       | never                          |
| `restricted` (`S3_RESTRICTED_BUCKET`)       | identity evidence, dispute evidence (`verification/…`) | API only: authorized, audited, `no-store`, streamed; no URL of any kind is minted | never                          |

`portfolio/` is deliberately **not** a public prefix: `GET /v1/media/files/*`
serves approved portfolio bytes only after `moderationState = APPROVED` is
re-checked (`portfolio-media.service.ts openPublic`). A bucket or CDN grant on
`portfolio/*` would keep serving an item after it was unpublished.

Each bucket carries a root marker `.hsm-storage-root.json`
(`apps/api/src/infrastructure/storage/storage-root.ts`) naming its namespace.
Provision it once per bucket; adapters refuse a bucket marked for another
namespace.

## Files

| File                             | Purpose                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `storage-plan.json`              | Manifest: namespaces, placeholders, which document applies where                                                                  |
| `aws/iam-api.json`               | API replicas: read/write/delete current objects in their prefixes; **no** version deletion, no listing                            |
| `aws/iam-worker.json`            | Retention / dispute maintenance / public cleanup: version deletion **only** on `restricted/verification/*`; cannot write evidence |
| `aws/iam-inventory.json`         | Read-only inventory and restore verification (R36)                                                                                |
| `aws/bucket-policy.public.json`  | TLS only; CDN service principal may `GetObject` `requests/*` and `avatars/*`                                                      |
| `aws/bucket-policy.private.json` | TLS only; every principal except the four roles is denied                                                                         |
| `aws/public-access-block.json`   | All four blocks on, for all three buckets (CDN uses OAC, not a public policy)                                                     |
| `aws/encryption.*.json`          | SSE-KMS + bucket key for private buckets; SSE-S3 for public                                                                       |
| `aws/cors.upload.json`           | Browser `PUT` from `${WEB_ORIGIN}` only, `content-type` + `if-none-match` headers                                                 |
| `aws/lifecycle.*.json`           | Abort incomplete uploads everywhere; noncurrent-version expiry on public (30 d) and staging (7 d); **nothing else on restricted** |

Versioning is enabled on all three buckets. Object Lock on `restricted` is an
owner decision (`OWNER_DECISION` in the manifest): if enabled, use legal holds
only and never a default retention period, which would block lawful erasure.

## Why no lifecycle expiry touches evidence

Retention and holds are **database facts** (`EvidenceRetentionJob.holdUntil`,
dispute evidence `retainUntil`, the R16/R18 finance decisions) that S3 cannot
see. A generic expiration rule would delete evidence still under an approved
hold, or leave noncurrent versions a naive check reports as "gone". Deletion is
therefore owned by the application workers, which delete every version and
then verify absence (`S3RestrictedStorageAdapter.eraseObject`). The validator
refuses any restricted rule other than aborting incomplete uploads, and any
current-object expiry anywhere.

## Checks

```sh
node scripts/production/storage/storage-plan.cjs --check      # STORAGE_PLAN_OK, exit 0
node --test scripts/production/storage/storage-plan.test.cjs  # every invariant bites
```

Operational tools (read-only, redacted):

```sh
node scripts/production/storage/storage-doctor.cjs            # root ids per namespace
node scripts/production/storage/storage-inventory.cjs inventory --namespace restricted \
  --bucket-env S3_RESTRICTED_BUCKET --out /secure/inventory.json [--deep]
node scripts/production/storage/storage-inventory.cjs verify-restore \
  --inventory /secure/inventory.json --bucket-env RESTORED_BUCKET [--deep]
```

Run the doctor with the exact environment of every API replica and worker:
equal `rootId`s per namespace prove they share storage. Never repair a
mismatch or a 404 by searching other host directories or by making a bucket
public.

## Emulator vs hosted evidence

`apps/api/test/integration/r20-storage` proves the adapters and these role
policies against real MinIO. MinIO does **not** implement, so the suite cannot
prove: KMS, `aws:SecureTransport` / `aws:PrincipalArn` conditions, public
access blocks, `GetBucketPolicyStatus`, CDN/OAC, Object Ownership/ACL
behaviour, or the `AbortIncompleteMultipartUpload` rule. Those are hosted
acceptance items (`docs/production-readiness/r20/ACCEPTANCE.md`).
