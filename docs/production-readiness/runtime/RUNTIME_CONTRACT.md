# S03 — production runtime contract

Base: `66e336cb4823802aabacc536584972aa43056d23`. This document separates boot safety, deployment preflight and real-service acceptance. Passing one never implies the others.

## Environment matrix

| Concern | Local | CI | Staging / production |
| --- | --- | --- | --- |
| `NODE_ENV`, `APP_ENV` | `development`, `dev` | `test`, `test` (legacy tests may omit APP_ENV) | Canonical: `production`, `staging` / `prod`. Legacy NODE_ENV=staging is hardened too. A dev/test runtime cannot carry a hardened APP_ENV. |
| `FRONTEND_URL`, `CORS_ORIGINS` | Exact localhost HTTP origins | Exact disposable origins | HTTPS web origin and exact HTTPS allowlist; no wildcard, credentials, path, query or fragment. An empty allowlist blocks cross-origin access; it is not "allow all". |
| Cookies | `COOKIE_SECURE=false`, `COOKIE_SAMESITE=lax` for HTTP | Explicit fixture topology | Secure=true. Keep web/API same-site; refresh and CSRF cookies are Strict independently of access-cookie SameSite. `none` never works without Secure. |
| `COOKIE_DOMAIN` | Unset (host-only) | Unset unless test requires it | Host-only preferred; explicitly review a shared parent domain and the CSRF echo design before changing it. No unrelated cross-site deployment is certified. |
| `DATABASE_URL` | Disposable PostgreSQL | Namespaced ephemeral real PostgreSQL | Secret-manager DSN for managed PostgreSQL; migration job precedes replicas; encrypted network and backups/restore rehearsal required. |
| Redis | Host/port, optional local password/TLS | Real disposable Redis for gated tests | Set host/port/password/TLS/DB explicitly; `THROTTLE_REDIS_REQUIRED=true`. Network access restricted to application/worker identities. |
| JWT | Synthetic dev secret | Generated disposable test secret | Secret-manager-generated access-signing secret, >=32 characters, no known placeholders. `JWT_ISSUER` and `JWT_AUDIENCE` must match all replicas. |
| Refresh sessions | Opaque tokens | Real rotation/revocation tests | There is no `JWT_REFRESH_SECRET` variable: refresh tokens are opaque and persisted as hashes. Do not invent a second signing key. |
| SMTP | Mailpit or in-memory where permitted | Disposable SMTP for real mail journeys | Set host/port/secure/from and credential pair as required by relay. MailModule refuses absent SMTP in hardened runtimes. Reachability and inbox delivery are separate gates. |
| Public storage | Local disk | Local or disposable S3-compatible server | Reference topology requires S3. Set public bucket, region, endpoint/path-style where needed and public URL policy. Do not expose restricted buckets via public CDN. |
| Restricted / portfolio storage | Separate local roots | Distinct fixture buckets | Explicit, distinct `S3_BUCKET`, `S3_RESTRICTED_BUCKET`, `S3_PORTFOLIO_BUCKET`. Workload identity preferred; otherwise provide both access-key fields. |
| Scanner | `none` or test only | Deterministic unit scanner or real ClamAV as declared | Test scanner forbidden. Active verification/scanning requires `clamav` and a host. Enforcing verification also requires the scan worker. |
| Evidence workers | Usually off | Enabled only in their genuine acceptance suites | Explicit scan/expiry/retention settings and ownership. Workers are not enabled by this sprint. Confirm backlog/retention before rollout. |
| Public-media cleanup | Off until exercised | Real storage cleanup tests | Explicit approval before enabling deletion; retain reservation grace. Do not enable to hide an orphan-upload bug. |
| Outbox | Default on; off for isolated tests | Per-suite configuration | `OUTBOX_WORKER_ENABLED=true` in deployment preflight; replicas coordinate using DB claims. Monitor retry/dead-letter age. |
| Verification / work access | Default off | Both states tested | Independent rollout decisions. Keep OFF until policy, evidence pipeline, backfill/grant counts and rollback are proven. No automatic flag flip here. |
| Realtime | Default off | Cross-instance Redis tests | Remains off until cutover acceptance. Enabling requires the shared adapter; single-instance override is an explicit deployment limitation. |
| Disputes | No default key | Disposable synthetic keys | Set active key ID and keyring JSON via the secret manager. Retain old decrypting keys while ciphertext exists. Workers use their own validated config. |
| Metrics | Token optional | Positive/negative guard tests | Protected bearer scrape. Missing token removes the endpoint (404); it does not publish metrics. Health probes remain separate. |
| Logging | Pretty logs where installed | Sanitized artifacts | JSON logs; request auth/password/token/email/name fields are redacted. Never log an env object or publish raw browser traces with sessions. |
| Seeding | Development users/policies allowed | Disposable fixture data | Production seed requires explicit authorization and still excludes development users/policies/markets. Review migrations separately; never reset real data. |
| Web variables | `.env` read by Vite at startup | Explicit build-time values | `VITE_API_URL`, `VITE_PROVIDER_ONBOARDING_V2`, optional restricted public Maps key and dispute-intake UI flag are public. No API, DB, SMTP, signing or private-storage secrets may enter VITE variables. |

All remaining timing, size, TTL and batch defaults are declared in `apps/api/src/config/env.schema.ts`; overrides remain bounded there. The examples are not deployed resources. No production secret manager, SMTP account, bucket policy, scanner endpoint or hosted domain was provisioned in this sprint.

## What now fails at boot

Unknown boolean spellings (instead of silently turning safeguards off); a dev/test NODE_ENV paired with prod/staging APP_ENV; insecure hardened cookies; SameSite=None without Secure; unsafe CORS origins; a deterministic hardened scanner; active verification without a real configured scanner and scan worker; S3 without a public bucket; hardened S3 with missing/shared private buckets; half an explicit S3 credential pair. Errors expose field names, not supplied secrets.

`AppConfigService.isProduction` retains its public name but now means hardened runtime for its security consumers. This brings staging mail, scanner selection, exception details, metrics and logging under the same safety boundary. Local and test behavior remains available under local/test labels.

## Preflight and remaining release gates

After building the API and injecting variables through the deployment secret manager, execute from the repository checkout:

```sh
node infra/production/check-runtime.cjs
```

This is a read-only configuration check. It additionally refuses noncanonical deployment labels, absent/non-HTTPS frontend origin, absent SMTP, local sender domain, disabled outbox, local storage, placeholder or low-diversity JWT secrets. The checker is **not yet wired into a hosted deployment pipeline**, and ordinary API boot does not enforce all of these stronger deployment-readiness checks. That is an explicit release blocker, not a claim of production certification.

The existing Docker CI boot intentionally validates image startup, not a working production SMTP/S3 deployment: its SMTP host is not dialled. Retain that distinction. Required external proof remains real SMTP delivery, S3 upload/read/privacy, scanner verdicts, TLS/cookie/browser topology, secret rotation, and no-secret-in-built-bundle/log inspection on the actual release artifact.

## Secret inventory and rotation

| Secret | Runtime / storage | Rotation and rollback |
| --- | --- | --- |
| PostgreSQL DSN | API, migration and authorized workers; deployment secret manager (not provisioned here) | Create replacement identity, grant least privilege, switch replicas/workers, verify queries, revoke old identity. Roll back only while old identity remains valid. |
| Redis password | API/realtime/workers; secret manager | Dual credential support where available, switch all replicas, verify shared throttling/eviction, revoke old. Never fall back to per-instance throttling. |
| JWT access secret | API signing/verification and existing opaque public-owner references; secret manager | Current HS256 implementation has no multi-key verification. Coordinated rotation invalidates access tokens; review owner-reference implications and refresh/relogin. A seamless rotation is NOT implemented. |
| SMTP password | Mail adapter only; secret manager | Issue replacement relay credential, verify delivery, switch, revoke old. Keep old credential only during controlled rollback. |
| S3 access pair | API/storage workers only, preferably workload identity instead | Overlap scoped identities, exercise public and private operations, switch, then revoke. Never copy to Vite or public URLs. |
| Media signing secret | Local-storage signed uploads, not reference production topology | Rotate after outstanding signed-upload TTL; do not reuse JWT secret in a new deployment. |
| Dispute keyring | Authorized dispute services/workers | Add new key, switch active ID, retain old decrypting keys until migration/retention completes; rollback active ID, never delete needed decrypting keys. |
| Metrics bearer token | Metrics endpoint and scraper | Coordinate scraper/server update, verify authorized scrape and unauthorized denial. |

Configuration is supplied by the operator; no actual secret values belong in this document or its evidence. The current application lacks a general automatic secret-rotation orchestrator; the procedures above are operator runbooks with explicit verification requirements.

## Reference topology

Internet -> CDN/web -> TLS load balancer -> API replicas -> PostgreSQL + Redis + public object store + private evidence store + private portfolio staging + SMTP. Authorized scanner, outbox, retention and dispute workers use the same controlled data plane. Metrics/logging are private. The final vendor, TLS/proxy hop count and workload identities remain deployment decisions; do not guess them from local Compose.
