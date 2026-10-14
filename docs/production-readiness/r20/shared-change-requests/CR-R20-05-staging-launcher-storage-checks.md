# CR-R20-05 — Staging launcher: storage plan check and per-process root identity

**Paths (coordinator-owned):** `infra/production/staging.cjs`,
`infra/production/STAGING.md`, `apps/api/Dockerfile` (image contents).

**Reason.** The launcher expects "durable S3-compatible storage with
public/restricted/portfolio-staging separation" but verifies none of it. R20
provides read-only tools that can, without new network destinations beyond
the storage endpoint the API already uses.

**Minimal patch.**

1. `--check` mode: run `node scripts/production/storage/storage-plan.cjs --check`
   (no network) and fail on findings.
2. Image: include `scripts/production/storage/*.cjs` in the API runner image.
3. `--apply`, after readiness: `docker exec <api> node scripts/production/storage/storage-doctor.cjs`
   and the same in each worker container; require `healthy: true` and equal
   `rootId` per namespace across containers. Print only the doctor JSON (it
   contains no names, keys or credentials).
4. STAGING.md: replace "durable S3-compatible storage … must already be
   available" with a pointer to `infra/production/storage/README.md` and the
   doctor check. The result stays `DEPLOYED_NOT_ACCEPTED`.

**Tests.** `staging.test.cjs`: check mode runs the plan validator; apply-mode
doctor mismatch aborts before reporting success.

**Consequences.** No deployment behaviour changes when storage is correct.
