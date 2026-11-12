# MinIO portfolio staging privacy

Set `S3_PORTFOLIO_PRIVACY_MODE=minio` **only for a MinIO server**, with an explicit
`S3_ENDPOINT`. The default `aws` retains all four AWS public access blocks and
the private-policy-status requirement. Other compatible providers must keep
the AWS checks until their own privacy contract is verified; no error causes
automatic fallback.

Before every new portfolio presign, the API authenticates `GetBucketPolicy` on
`S3_PORTFOLIO_BUCKET`. Only `NoSuchBucketPolicy` with HTTP 404 proves absence
and permits the upload. Any returned policy, including a restrictive, empty,
conditional, malformed or unknown policy, is refused. Access denied, missing
bucket, unsupported operations and network failures are refused too. There is
no positive privacy cache. Namespace isolation and create-only uploads remain
enforced.

The MinIO app IAM policy must replace its AWS-only
`PortfolioStagingPrivacyChecks` statement with:

```json
{
  "Sid": "PortfolioStagingPrivacyChecks",
  "Effect": "Allow",
  "Action": ["s3:GetBucketPolicy"],
  "Resource": ["arn:aws:s3:::${PORTFOLIO_STAGING_BUCKET}"]
}
```

This is a read-only permission on the bucket, not `bucket/*`. Keep existing
prefix-scoped object permissions. Never grant `PutBucketPolicy` or
`DeleteBucketPolicy` to the app. Keep the three buckets distinct and deny all
anonymous access to portfolio staging and restricted evidence. Bootstrap's
`mc anonymous set none` is setup intent, not runtime proof: custom policy
statements can remain, and the authenticated API check must still succeed.
Do not delete a custom policy blindly to satisfy the check; review its purpose
and move required authenticated grants into the MinIO app IAM policy.

MinIO has no public object/bucket ACL grants. Its anonymous access is governed
by bucket policy, and absent policy denies non-owner anonymous requests. In
the pinned `RELEASE.2025-10-15T17-29-55Z`, `GetBucketPolicy` first checks caller
permission and bucket existence before returning `NoSuchBucketPolicy` (404).
That version implements `GetBucketPolicyStatus`, but its public classification
requires both anonymous listing and writing; download-only anonymous access
is insufficient. The application therefore does not use that classification
as privacy evidence.

Sources: [MinIO S3 compatibility](https://docs.min.io/aistor/developers/s3-api-compatibility/),
[authenticated policy handler](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/cmd/bucket-policy-handlers.go),
[absent-policy authorization](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/cmd/bucket-policy.go),
[policy-status handler](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/cmd/bucket-handlers.go),
[error codes](https://github.com/minio/minio/blob/RELEASE.2025-10-15T17-29-55Z/cmd/api-errors.go).

`r20-minio-portfolio-privacy.integration.spec.ts` runs in the existing real
storage CI lane. It proves successful private uploads under an app principal,
anonymous-read denial, denial without `GetBucketPolicy`, refusal of existing
policies, rechecking after a policy change, and inability of the app principal
to alter bucket policy. This proves the MinIO contract, not AWS ACL/KMS/CDN
behaviour or the configuration of a live hosted bucket.
