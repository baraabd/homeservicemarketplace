# CR-R20-02 — Env: make storage root markers mandatory where configured; require the CDN base URL in production

**Paths (coordinator-owned):** `apps/api/src/config/env.schema.ts`,
`apps/api/src/config/runtime-policy.ts`, `.env.example` / deployment env docs,
and (R20-owned, applied together) `apps/api/src/infrastructure/storage/s3-storage-root.ts`.

**Reason.** `S3BucketRootGuard` refuses a bucket marked for another namespace,
but accepts a bucket with **no** marker (rollout posture, so pre-R20 buckets
keep working). Until markers are mandatory, a worker pointed at a wrong,
unmarked bucket is not refused. Separately, production may run without
`S3_PUBLIC_BASE_URL`, in which case `publicUrlForKey` emits direct bucket URLs
that need a public bucket policy the plan forbids.

**Minimal patch.**

```ts
// env.schema.ts
STORAGE_ROOT_MARKER_REQUIRED: trueish.default(false),
// runtime-policy.ts (production + STORAGE_DRIVER=s3)
if (!env.S3_PUBLIC_BASE_URL?.trim())
  issues.push('S3_PUBLIC_BASE_URL: public media must be served through the CDN origin');
```

and in `S3BucketRootGuard.check`: when `STORAGE_ROOT_MARKER_REQUIRED` is true,
treat `absent` as `StorageRootMismatchError` (R20 will supply this patch the
moment the key exists; it needs the config value threaded in).

**Rollout.** Provision `.hsm-storage-root.json` in each bucket (see
`infra/production/storage/README.md`), confirm with `storage-doctor.cjs` from
every process, then set the flag. Rollback: unset the flag.

**Tests.** Unit: absent marker + flag → refusal; runtime-policy tests for the new
production rule. R20 real-storage suite already provisions markers.
