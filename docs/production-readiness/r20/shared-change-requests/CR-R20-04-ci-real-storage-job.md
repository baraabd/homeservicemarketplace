# CR-R20-04 — CI: run the R20 real-storage suites and the plan checks

**Path (coordinator-owned):** `.github/workflows/ci.yml`, and
`scripts/ci/install-minio-fixture.sh` (to also build `mc`).

**Reason.** The R20 suites are gated (`RUN_R20_STORAGE_INTEGRATION=1`) and skip
in every existing job, so they protect nothing until a job runs them.

**Minimal patch.** Reuse the retention job's pattern (same pinned MinIO source
build, masked random root credentials, loopback `127.0.0.1:19000`, disposable
Postgres):

```yaml
- name: Storage plan invariants
  run: |
    node scripts/production/storage/storage-plan.cjs --check
    node --test scripts/production/storage/storage-plan.test.cjs scripts/production/storage/storage-cli.test.cjs
- name: R20 real-storage suites
  env:
    RUN_DB_INTEGRATION: '1'
    RUN_R20_STORAGE_INTEGRATION: '1'
    R20_S3_ENDPOINT: http://127.0.0.1:19000
    R20_S3_ROOT_USER: ${{ env.RETENTION_TEST_S3_USER }}
    R20_S3_ROOT_SECRET: ${{ env.RETENTION_TEST_S3_SECRET }}
  run: pnpm --filter @homeservicemarketplace/api exec jest --runInBand --testPathPatterns=r20-storage
```

**Open item.** The least-privilege block calls `mc` through
`R20_MINIO_CONTAINER` (`docker exec`). CI runs MinIO as a binary, so either run
the fixture image `apps/api/test/integration/r20-storage/fixture/Dockerfile.minio`
as a container, or add an `R20_MC` override to the fixture (R20 will supply it)
and build `mc` (`github.com/minio/mc@v0.0.0-20251106162529-77f82e18b540`) in
`install-minio-fixture.sh`. Without one of them that block fails loudly; it is
never skipped.

**Consequences.** ~1–2 minutes of job time. No new secrets.
