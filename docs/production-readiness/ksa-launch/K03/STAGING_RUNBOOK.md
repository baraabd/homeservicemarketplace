# K03 — Staging runbook

Status: **NOT EXECUTED against a hosted target.** No staging target is authorized
(`BLOCKED_INPUTS.md`). Steps 1–3 were rehearsed locally with disposable containers,
as recorded under `evidence/`. Every `<…>` value is an approved owner input.

Rules for the whole runbook:

- Run on the trusted operator host only.
- Never paste secrets, DSNs or raw Docker diagnostics into chat, PRs or evidence.
- No step performs an automatic rollback, down migration, volume deletion or
  cleanup. A failure stops the run for investigation.

## 0. Preconditions (all must be recorded first)

- The accepted source SHA and tree are recorded. Its required CI is green on that
  exact SHA.
- The approved account, region, Docker host, registry, secret store and budget
  ceiling are recorded in `topology.json` (a reviewed copy outside Git).
  `validate-plan.cjs --check --require-target` exits **0**.
- `staging.<DOMAIN>` resolves to the staging edge, and the certificate is valid.
- The edge routes match `edge/edge-policy.json` exactly. The edge emits **no** web
  CSP header of its own (CR-K03-01).

## 1. Build the images (CI runner, one SHA)

```sh
SHA=<accepted full SHA>; ORIGIN=https://staging.<DOMAIN>
git checkout --detach "$SHA" && test -z "$(git status --porcelain)"
export VITE_API_URL=$ORIGIN VITE_PROVIDER_ONBOARDING_V2=<approved true|false> \
       VITE_STRIPE_SANDBOX_ENABLED=<approved true|false>
FP=$(node scripts/production/security-app/web-build-identity.cjs --fingerprint)
docker buildx build -f apps/api/Dockerfile --target runner   --build-arg SOURCE_SHA=$SHA \
  --provenance=mode=max --sbom=true -t <registry>/hsm/api:$SHA --push .
docker buildx build -f apps/api/Dockerfile --target migrator --build-arg SOURCE_SHA=$SHA \
  --provenance=mode=max --sbom=true -t <registry>/hsm/migrator:$SHA --push .
docker buildx build -f apps/web/Dockerfile --build-arg SOURCE_SHA=$SHA \
  --build-arg VITE_API_URL --build-arg VITE_PROVIDER_ONBOARDING_V2 \
  --build-arg VITE_STRIPE_SANDBOX_ENABLED --build-arg WEB_CONFIG_FINGERPRINT=$FP \
  --provenance=mode=max --sbom=true -t <registry>/hsm/web:$SHA --push .
```

Record the three `@sha256:` digests from the push output or from
`docker buildx imagetools inspect`. Verify the provenance subject of each digest and
its `vcs.revision` (the SHA). Reject any image whose provenance names another SHA.

## 2. Database identities (once per environment)

1. Create the `hsm_migrator` and `hsm_api` LOGIN roles in the provider console.
   - Use passwords from the secret manager.
   - Give them no superuser, createdb, createrole, replication or bypass-RLS
     attributes.
2. As the DBA, run:
   `psql "$ADMIN_DSN" -v ON_ERROR_STOP=1 -v app_db=<db> -v app_schema=public -v migrator=hsm_migrator -v runtime=hsm_api -f infra/production/database/bootstrap-roles.sql`
3. Run the R28 read-only privilege inspection (`platform/README.md`) under both
   identities, and store the sanitized results.

## 3. Release manifest and secret files

Write `/secure/release.json` (schema **v2**) with the following fields:

- the three digests;
- `onboardingV2`, `stripeSandbox` and `webConfigFingerprint=$FP`;
- `webOrigin` = `apiOrigin` = `$ORIGIN`;
- loopback ports;
- `projectName: hsm-staging-<name>`.

Render the immutable secret files from the secret manager:

- The API file contains `NODE_ENV=production`, `APP_ENV=staging`,
  `FRONTEND_URL=$ORIGIN` and the runtime `DATABASE_URL` (strict TLS).
- It also contains Redis TLS and password, the three S3 buckets, SMTP,
  `EVIDENCE_SCANNER_DRIVER=clamav`, `EVIDENCE_SCAN_WORKER_ENABLED=true`,
  `OUTBOX_WORKER_ENABLED=true` and **`MAIL_DISPATCHER_ENABLED=true`**.
- The migration file contains only the migrator `DATABASE_URL`.

```sh
node infra/production/staging.cjs --check /secure/release.json      # CONFIGURATION_ONLY, no network
```

## 4. Apply (requires explicit deployment authorization)

```sh
node infra/production/staging.cjs --apply /secure/release.json hsm-staging-<name>@$SHA \
  --api-origin $ORIGIN --web-origin $ORIGIN
```

The launcher runs these phases in order:

1. context;
2. network;
3. compose config;
4. pull digests;
5. image labels, which must match the SHA, the onboarding/Stripe flags and the
   fingerprint;
6. networkless preflight (`check-runtime.cjs --release`), which runs
   `releaseReadinessProblems`: every boot-time deployment check plus the effective
   mail dispatcher, checked independently of the outbox worker;
7. migrations;
8. readiness rollout (`--force-recreate`);
9. HTTPS checks: health/readiness, re-derived build identity, the served document
   CSP and the absence of an edge CSP header.

A success reports `DEPLOYED_NOT_ACCEPTED`. After the **first** deploy only, run
`after-first-migrate.sql` as the migrator. Then repeat the privilege inspection
from step 2.

## 5. Acceptance (all required; record sanitized evidence)

| Check                     | Method                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration/OTP delivery | Sign up with a synthetic user at an **approved test inbox**. Record `spf/dkim/dmarc=pass` from the received headers. Do not store the OTP.            |
| Reset delivery            | Run forgot-password to the same inbox. The link works once and is refused on reuse                                                                    |
| Public upload             | Upload an avatar or request image. It is served from the public bucket/CDN path                                                                       |
| Private reviewer preview  | Upload a synthetic verification file. The owner and an authorized reviewer can preview it; another user and an unauthenticated client get 403/401     |
| Scanner                   | Upload a clean file (accepted), the EICAR test string (rejected/quarantined) and a file while ClamAV is stopped (pending/unavailable, never accepted) |
| Deep link / reload        | Directly load and reload customer, provider `provider/*` and admin routes                                                                             |
| Cookies / CSRF            | `hsm_rt` HttpOnly, Secure, Strict, `/v1/auth/refresh`, no Domain. A state change without the CSRF token is rejected                                   |
| WebSocket / SSE           | `/socket.io/` upgrades; `/v1/me/events` streams unbuffered. Recovery after an edge idle close                                                         |
| Checkout (sandbox only)   | With `stripeSandbox=true`, the Payment Element renders with no CSP violation in the console. With `false`, purchase stays unavailable. No `pk_live_`  |
| Private ports             | External scan: only 443 is open. DB, Redis, ClamAV, Docker and `/metrics` are unreachable                                                             |
| Graceful shutdown         | `docker compose stop api` during an SSE stream. The outbox drains within `outboxShutdownGraceMs`                                                      |
| Isolation                 | Staging DSNs, buckets, Redis and SMTP credentials differ from production and authenticate only to staging resources                                   |
| Credential rotation       | Rotate the runtime DB password in the secret manager, re-render the file and re-apply the same digests. The old password is refused                   |
| Responsive / bilingual    | Use the CLAUDE.md matrix (320–1440, AR/EN, 200 % zoom, keyboard) on the deployed bundle                                                               |

## 6. Roll back or redeploy the application images

- **Rollback.**
  1. Take the previous accepted v2 manifest, with its digests and fingerprint.
  2. Re-run `--apply` with its own `project@sha`.
  3. Check that the previous image is compatible with the current schema. Migrations
     are forward-only: a rollback image must tolerate the newer schema, or the step
     is a **forward repair** instead.
- **Redeploy the same release.** Re-running `--apply` with the same manifest
  recreates the containers and reloads rotated secrets.
- **Failed migration.**
  - The launcher stops, and Prisma records a failed migration (`P3009` on retry).
  - Do **not** delete rows from `_prisma_migrations` or run down scripts.
  - Inspect the failure. Then either fix it forward with a new migration, or, after
    confirming that no partial DDL remains, run
    `prisma migrate resolve --rolled-back <name>` as the migrator and redeploy.
    `evidence/MIGRATION_REHEARSAL.md` records this sequence.
- **DNS.** Restore the exported zone values; the TTL is 300 s.
