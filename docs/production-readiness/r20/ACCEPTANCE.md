# R20 — acceptance evidence

| Field                | Value                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| Base                 | `059c018576a75837d4dfb262ee49168d9217d881`                                              |
| Source commit / tree | `b4063568469d667ce01f7b49c3a6d240ea3d64a9` / `a60c71e38721434d84f62988159d79f661021606` |
| Evidence commit      | the commit adding this file (docs only)                                                 |
| Lane status          | **IMPLEMENTED · SOURCE_VERIFIED (emulator) · INTEGRATION_PENDING**                      |
| Not claimed          | SANDBOX_ACCEPTED (no authorized test account), HOSTED_ACCEPTED, RELEASE_ACCEPTED        |
| Receipts             | POLICY_BLOCKED (CR-R20-06)                                                              |

All runs on 2026-10-14, Windows 11 host, worktree `HSM-r20`, every command's
own exit code checked.

## 1. Environment fingerprint (no secrets)

| Item                  | Value                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node / pnpm           | 24.21.0 / 10.32.1 (repository pins)                                                                                                                                                                                                      |
| S3-compatible service | MinIO built from source `RELEASE.2025-10-15T17-29-55Z` (go1.24.8) via `apps/api/test/integration/r20-storage/fixture/Dockerfile.minio`; image `sha256:95bcf42b547f…`; reports `DEVELOPMENT.GOGET` (a `go install` build)                 |
| PostgreSQL            | `postgres:16-alpine` `sha256:20edbde7749f…`, 16.13, tmpfs data, database `r20_storage`, 67 migrations applied (`prisma migrate deploy`, banner verified `127.0.0.1:<ephemeral>`)                                                         |
| Isolation             | containers `hsm-r20-pg`, `hsm-r20-minio`; loopback-only ephemeral ports; credentials generated per run into a scratch file outside the repository; unique buckets per suite, deleted afterwards; the developer's `hsm-*` stack untouched |
| AWS SDK               | `@aws-sdk/client-s3` / `s3-request-presigner` `^3.1116.0` (lockfile unchanged)                                                                                                                                                           |

## 2. Commands and counts

| #   | Command (from `apps/api` unless stated)                                                                                                                                                                              | Result                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm exec tsc --noEmit -p tsconfig.json` (includes `test/`)                                                                                                                                                         | rc=0                                                                                                                                                                          |
| 2   | `pnpm exec eslint "src/**/*.ts"` (package `lint` scope)                                                                                                                                                              | rc=0                                                                                                                                                                          |
| 3   | `pnpm exec eslint <changed api .ts incl. test/>`; repo root `pnpm exec eslint scripts/production/storage/*.cjs`                                                                                                      | rc=0 / rc=0                                                                                                                                                                   |
| 4   | repo root `pnpm exec prettier --check <changed files>`                                                                                                                                                               | rc=0                                                                                                                                                                          |
| 5   | `pnpm exec nest build`                                                                                                                                                                                               | rc=0                                                                                                                                                                          |
| 6   | `JWT_ACCESS_SECRET=… pnpm exec jest src/infrastructure/storage --maxWorkers=2`                                                                                                                                       | **11 suites, 174 passed, 0 failed, 0 skipped**                                                                                                                                |
| 7   | same + `src/modules/media src/modules/provider/verification src/modules/provider/onboarding/avatar src/modules/disputes/workspace` (pre-fix run)                                                                     | 56 suites, 1120 passed, 1 failed → the failure was `s3-portfolio-storage.spec` pinning presign options; updated to require the signed `content-type` (stricter), re-run in #6 |
| 8   | repo root `node --test scripts/production/storage/storage-plan.test.cjs scripts/production/storage/storage-cli.test.cjs`                                                                                             | **18 passed, 0 failed**                                                                                                                                                       |
| 9   | repo root `node scripts/production/storage/storage-plan.cjs --check`                                                                                                                                                 | `STORAGE_PLAN_OK`, rc=0                                                                                                                                                       |
| 10  | `RUN_DB_INTEGRATION=1 RUN_R20_STORAGE_INTEGRATION=1 R20_MINIO_CONTAINER=hsm-r20-minio pnpm exec jest test/integration/r20-storage --runInBand`                                                                       | **3 suites, 40 passed, 0 failed, 0 skipped**                                                                                                                                  |
| 11  | `RUN_DB_INTEGRATION=1 pnpm exec jest test/integration/{evidence-read-boundary,evidence-upload,evidence-cleanup,evidence-log-hygiene,phase4-public-media-lifecycle,r06-request-media,provider-portfolio} --runInBand` | **7 suites, 182 passed, 0 failed, 0 skipped**                                                                                                                                 |
| 12  | `RUN_DB_INTEGRATION=1 pnpm exec jest test/integration/{dispute-workspace.integration,dispute-private-lifecycle,r17-disputes.integration} --runInBand`                                                                | 3 suites, 35 passed, **1 failed** — pre-existing clock-skew race (F12), see §5                                                                                                |

`storage.module.spec.ts` needs `JWT_ACCESS_SECRET` in the environment (as CI
sets); without it the suite fails to load on any branch.

Before the fixes the first #10 run was 23/29: the failures were the real
`Content-Type` hole (F1), MinIO emulator gaps (lifecycle abort rule, two IAM
actions), a legal-hold test that targeted the delete marker, a render-order bug
in the plan script, and a keep-alive socket reuse after `AccessDenied`. Each was
fixed in source or test, not by weakening an assertion; emulator gaps are
asserted explicitly (§4).

## 3. What the real-service suites prove (emulator evidence)

`r20-s3-storage.integration.spec.ts` (29): signed upload accepted and finalize
reads real bytes · request attachments write-once, including a replay without
the signed precondition · 6 concurrent duplicate uploads → exactly one 200 ·
avatar replay gap documented (CR-R20-03) · wrong MIME → 403 · wrong size → 4xx ·
expired URL → 403 · staging presign fails closed without privacy proof · public
upload refused into a bucket marked restricted · anonymous GET of restricted,
staged and marker objects → 403 · restricted port exposes no URL method ·
missing → `null`; wrong credentials → `denied`; wrong bucket → `misconfigured`;
dead endpoint → `unavailable`, none carrying bucket/endpoint/key · restricted
head distinguishes absence from a credential fault · 5 concurrent first writes
→ one winner, overwrite refused, one version · failed streamed upload leaves no
object or version · receipt-shaped object: integrity-checked read, identity
erasure refuses it · modified object refused before streaming · missing object
error names nothing · lifecycle-style delete marker leaves versions; erasure
removes all and verifies absence · legal hold blocks erasure with no false
receipt; release → erasure completes · plan lifecycle documents accepted and
round-tripped, no current-object expiry · **plan IAM on real users**: API role
reads/writes evidence but cannot erase (bytes survive its delete marker);
worker erases every version but cannot write evidence; neither can make a
bucket public, read finance objects or read outside its prefixes · deep
inventory without keys or bucket names, restore verification detects missing
and modified objects, tampered inventory refused · two separate processes
report identical root ids; a process with the wrong bucket reports `mismatch`
and exits 3; local cwd-default roots report `absent` and are never searched.

`r20-mediated-read-s3.integration.spec.ts` (9): real controller + service, S3
adapter, real `PermissionResolverService` over `UserRole` rows (auth guard and
Redis are labelled contract doubles): owner gets exact bytes and no storage
URL · reviewer with a real grant 200, then 404 on the next request after the
grant row is deleted · ungranted reviewer and other provider 404 ·
unauthenticated 403 · `no-store, private`, `nosniff`, attachment; no key,
bucket, endpoint or `X-Amz-Signature` in headers · missing object and
unavailable storage answer with the unknown-document body (header gap
CR-R20-01) · substituted object still streamed (gap CR-R20-01) · allowed and
denied reads audited without raw user agent or key.

`r20-orphan-cleanup-s3.integration.spec.ts` (2): abandoned and unclaimed
uploads removed and recorded; in-window attachment and finalized avatar kept;
already-absent object is idempotent; a second pass does nothing; a
storage-denied delete is counted as failed and never recorded as deleted.

## 4. Emulator gaps — hosted acceptance checklist (not run)

To be exercised only in a separately authorized test account on the selected
vendor, then on the target:

1. Apply `infra/production/storage` with real placeholders; re-run
   `storage-plan.cjs --check` on the rendered documents.
2. KMS: private buckets encrypt with the key; API/worker/inventory roles can
   decrypt; another principal cannot.
3. `aws:SecureTransport` deny (plain-HTTP request refused) and
   `aws:PrincipalArn` deny on private buckets.
4. Public access block on all buckets; `GetBucketPolicyStatus` private for
   staging; portfolio staging presign succeeds (it fails closed on MinIO).
5. CDN/OAC serves `requests/*` and `avatars/*` only; `portfolio/*`, staging and
   restricted unreachable through it; TLS on the CDN origin.
6. Restricted `PUT` with `ACL: 'private'` under the chosen Object Ownership
   setting (may require `s3:PutObjectAcl` or fail under BucketOwnerEnforced).
7. `AbortIncompleteMultipartUpload` rule accepted (MinIO rejects it).
8. Re-run `test/integration/r20-storage` against the test account (endpoint
   override) and record results separately from this emulator run.
9. Inventory + restore drill with R36.

## 5. Not run / not verified locally

- `evidence-retention.integration` (needs ClamAV on :3310 and a `retention_ci`
  database). The F2 fix is unit-tested for that suite's exact shape; hosted CI
  runs it.
- Full DB/Redis-gated API suite, e2e and Playwright: not run (host at ~0.6 GB
  free RAM with five lanes; see the parallel-lanes note). Hosted CI on the
  Draft PR is the regression gate.
- Browser/UI, AR/EN/RTL, mobile and keyboard checks: **not applicable** — R20
  changes no UI.
- CodeQL / secret scanning: hosted CI on the PR. Local check: no generated
  credential or endpoint appears in any changed file (grep, 0 hits).
- F12 (`dispute-workspace` "dead-letters exhausted scanner leases"): passes on
  a fresh run, fails on repeats with `STORED`. Root cause measured: the DB
  clock is 24 ms behind the host and `nextAttemptAt` is stamped with the app
  clock. Pre-existing, outside R20, unrelated to storage.
