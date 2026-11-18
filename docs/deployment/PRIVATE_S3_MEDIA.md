# Public media from a private S3 origin

With `STORAGE_DRIVER=s3`, the API can serve published avatars and request
attachments from `GET /v1/media/files/<key>`. The S3 buckets stay private;
the API reads objects with its storage credentials. Anonymous bucket policies
and a CDN are not required for this read path.

| Setting                | Value / requirement                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_DRIVER`       | `s3`                                                                                                                |
| `PUBLIC_API_URL`       | The stable HTTPS API origin for this environment                                                                    |
| `S3_PUBLIC_BASE_URL`   | `${PUBLIC_API_URL}/v1/media/files` (no bucket suffix)                                                               |
| `S3_ENDPOINT`          | S3 origin, without a bucket suffix; reachable by the API; an internal origin is supported with API upload transport |
| `S3_UPLOAD_TRANSPORT`  | `api` keeps browser PUTs on the HTTPS API origin and the S3 origin private                                          |
| `S3_FORCE_PATH_STYLE`  | `true` for MinIO path-style requests                                                                                |
| `S3_BUCKET`            | Bucket holding `avatars/`, `requests/`, and legacy approved `portfolio/` keys                                       |
| `S3_PORTFOLIO_BUCKET`  | A distinct private bucket for `portfolio-staging/`                                                                  |
| `S3_RESTRICTED_BUCKET` | A distinct private bucket for restricted evidence                                                                   |

The adapter appends the encoded object key to `S3_PUBLIC_BASE_URL`; the API
selects the bucket itself. A bucket name belongs in a direct path-style S3
read URL, **not** in this API URL. API storage credentials need scoped object
read/write/delete permissions; no anonymous reader grant should be added.

API upload transport requires a verified `.hsm-storage-root.json` in each
selected bucket and `s3:GetObject` permission for those markers. Provision
their correct `public`, `portfolio-staging`, or `restricted` namespace before
rollout. Missing or mismatched roots refuse upload grants; a missing marker
is rechecked after bootstrap completes. Private storage diagnostics use marker
metadata and do not require bucket-list permission.

`S3_PUBLIC_BASE_URL` changes the read URL only. For a private origin, set
`S3_UPLOAD_TRANSPORT=api`: signed browser PUTs use `PUBLIC_API_URL`, and the
API writes to the internal `S3_ENDPOINT`. No public object-store domain or
anonymous bucket access is required. Keep the stable HTTPS API origin in the
web upload CSP configuration. For MinIO, explicitly select
`S3_PORTFOLIO_PRIVACY_MODE=minio`; its fail-closed policy probe replaces the
unsupported AWS public-access-block API without granting anonymous reads.

The default direct presigned PUT transport still needs a browser-accessible
HTTPS S3 origin, exact web-origin upload CORS (`PUT`, `content-type`,
`if-none-match`), and that origin in `VITE_CSP_UPLOAD_ORIGINS`. Changing the
read base alone does not make direct browser uploads reach an internal
hostname. Keep credentials out of web environment variables.

## Publication and revocation

The public route accepts only canonical server-minted `avatars/` and
`requests/` keys with a durable `MediaAsset` ledger row. Reservations and
finalized-but-unclaimed request uploads are not readable. Avatar reads require
the live owner's current provider profile pointer. Request reads require a
committed claim to a live request owned by the uploader. Retired, deleted,
erasing, restricted, rejected, quarantined, and scan-failed objects return
the same opaque 404 as missing objects.

Public upload finalizers validate stored byte signatures and leave the
identity scan state at `PENDING`; this read path does not invent a `CLEAN`
malware verdict or change restricted evidence scan rules. Reads verify the
stored signature and length, use a bounded stream with the allowlisted media
type, and return `private, no-store`, `nosniff`, and a restrictive CSP. A
subsequent read therefore rechecks withdrawal rather than trusting a cached
year-long public response.

Portfolio objects continue through their existing moderation-aware API
reader. Verification documents continue through their authenticated,
authorized, audited reader. Neither namespace is handled by the avatar/request
reader, and neither should receive a public bucket or CDN grant.

## Existing references

Changing `S3_PUBLIC_BASE_URL` affects URLs created by later upload/finalize
operations. Existing `ProviderProfile.profileImageUrl` / `avatarUrl` and
`ServiceRequest.mediaUrls` values remain unchanged. Do not blindly replace a
host in all URL fields: a legacy URL may be an operator-supplied CDN or an
external image and may have no owned, finalized ledger row.

Before converting an existing URL, verify its exact storage key, uploader,
live ledger and publication reference, and stored signature/length. Then
update only those verified references to the API base, or reupload using the
normal flow. Objects without durable provenance fail closed; merely finding
bytes in a bucket is not sufficient to publish them.

## Acceptance

Check anonymous bucket/object reads are denied, then exercise the normal
reserve → upload → finalize → publish flow through the environment's web/API
origins. A published image must return its validated bytes and no-store
headers from the API. Its reservation URL must return 404 before publication;
after avatar replacement, request deletion, or ledger retirement, a fresh
read must return 404. Check provider portfolio moderation and restricted
document authorization independently. Tests cannot establish a live
environment's DNS, storage credentials, CORS, or persisted URL state.
