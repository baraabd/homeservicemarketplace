# K03 — Deployment design (review package, not applied)

Status: **PROPOSED, provider-neutral.** K02 (approved launch scope and external
resource decisions) is not accepted, so this design names no provider, account,
region, domain, registry or price. `<…>` values are owner inputs. Do not replace
them with guessed or available-looking names. Every structural decision below is
already enforced by repository code, or is marked as a change request (CR).

## 1. Topology decision: same-origin

| Environment | Origin (web and API)                                              | `COOKIE_DOMAIN` | `CORS_ORIGINS` | Cookie SameSite (refresh/CSRF) |
| ----------- | ----------------------------------------------------------------- | --------------- | -------------- | ------------------------------ |
| Staging     | `https://staging.<DOMAIN>`                                        | unset           | empty          | `strict` (fixed in code)       |
| Production  | `https://www.<DOMAIN>` (K10)                                      | unset           | empty          | `strict`                       |
| Recovery    | No public origin (R36 restore target, outbound delivery disabled) | —               | —              | —                              |

This topology is **not** a new choice. It is the only one the current controls accept:

- ADR 0001 prefers Topology A: one origin, with `/v1/*` sent to the API.
- `edge-policy.json` is `"topology": "same-origin"`.
- `validate-plan.cjs` enforces `R28_SAME_ORIGIN_REQUIRED`.

Host-only cookies mean staging and production sessions can never share cookies. A
sibling `api.<DOMAIN>` host (Topology B) would need a cookie-domain decision,
credentialed CORS, validator changes and browser acceptance. That is a K03 change
request, not a DNS edit, and is aligned with the K10 dossier (PR #205).

With one origin, `staging.cjs` runs with `--api-origin` = `--web-origin` =
`https://staging.<DOMAIN>`. The web image is built with
`VITE_API_URL=https://staging.<DOMAIN>`. The API's credentialed-CORS probe is
skipped by design, because there is no cross-origin request.

## 2. Resources and separation

The staging, production and recovery environments each get their own **account or
project** at the selected provider. Within each environment, resources are separate:

| Component      | Staging resource (one region)                                                                     | Isolation rule                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| HTTPS edge     | Managed TLS load balancer or a reviewed reverse proxy, on one public listener (443 only)          | Routes exactly per `edge/edge-policy.json`; `/metrics` denied; WebSocket/SSE forwarded unbuffered                        |
| App host       | 1 Linux Docker host (local daemon) running `api` (1 replica) and `web` via `staging.cjs`          | API/web bound to `127.0.0.1`; no public management port                                                                  |
| PostgreSQL 16  | Managed instance with a private endpoint, TLS, `sslmode=require&sslaccept=strict`                 | Distinct instance per environment. Separate `hsm_migrator` and `hsm_api` roles (§4)                                      |
| Redis 7        | Managed, dedicated instance; TLS and password; private endpoint                                   | Never shared with another environment or product                                                                         |
| Object storage | 3 buckets per `storage/storage-plan.json`: public, portfolio-staging, restricted                  | Distinct buckets and keys per environment; the restricted bucket is private with a CMK; no cross-environment replication |
| ClamAV         | Private container on the runtime network (3310), with outbound definition updates only            | Never reachable from the internet                                                                                        |
| SMTP           | The approved provider, using a staging-specific sending subdomain (§6)                            | Separate credentials and DKIM keys from production                                                                       |
| Monitoring     | The R23 bundle (`infra/production/observability`): Prometheus with private scrape, Alertmanager   | Scrape over the private network; no public `/metrics`                                                                    |
| Registry       | A private registry in the same provider/region; repositories `hsm/api`, `hsm/migrator`, `hsm/web` | Push only from CI with workload identity; immutable tags; deploy by digest                                               |
| Secret manager | The provider's secret manager; one secret scope per environment                                   | Rendered to immutable files outside the checkout (`secrets.delivery: external-immutable-files`)                          |
| Mongo          | **Disabled**                                                                                      | No domain dependency has been demonstrated (`services.mongo.enabled: false`)                                             |

Network boundaries:

- **Internet:** reaches only the edge on 443.
- **Runtime network:** the edge, the API, web and ClamAV.
- **Data network:** the managed PostgreSQL and Redis private endpoints, reachable
  only from the app host and the CI migrator runner.
- **Firewall:** default-deny inbound. SSH or management only through the provider's
  identity-aware access, never with a public key-only port.

## 3. Release path and image identity

1. Build three images from **one accepted SHA**:
   - `hsm/api`: `apps/api/Dockerfile`, target `runner`;
   - `hsm/migrator`: the same file, target `migrator`;
   - `hsm/web`: `apps/web/Dockerfile`.
2. For the web image:
   - Supply every public input explicitly, including `VITE_STRIPE_SANDBOX_ENABLED`.
   - Compute `WEB_CONFIG_FINGERPRINT` with
     `node scripts/production/security-app/web-build-identity.cjs --fingerprint`.
   - The build fails if the compiled configuration or the emitted CSP differs.
3. Build with BuildKit provenance and an SBOM, push by digest, and sign or attest in
   the registry. `docker buildx build --provenance=mode=max --sbom=true --push`
   produces SLSA provenance tied to the digest. OCI labels alone are **not**
   provenance.
4. Write the v2 release manifest with the three digests, `onboardingV2`,
   `stripeSandbox` and `webConfigFingerprint`.
5. Run `staging.cjs --check`, then `--apply` (`STAGING_RUNBOOK.md`). The launcher
   rejects all of the following:
   - mixed SHAs;
   - tags without digests;
   - label mismatches;
   - v1 manifests;
   - a runtime and migration identity that are the same;
   - missing or changed secrets;
   - insecure database TLS;
   - mismatched origins;
   - a served bundle whose CSP differs from its declaration;
   - an edge-added web CSP header.

Payment modes: the web image has **no live-payment flag**.
`VITE_STRIPE_SANDBOX_ENABLED=true` admits only Stripe's documented sandbox
script/frame/API origins. The API schema accepts only `pk_test_` publishable keys.
Live money stays disabled (`policy.liveMoneyEnabled: false`;
`docs/money/LIVE_MONEY_GATE.md`).

## 4. Database identities

`infra/production/database/bootstrap-roles.sql` is run once by the DBA:

- It asserts that both roles are LOGIN-only, with no superuser, createdb, createrole,
  replication or bypass-RLS attributes.
- It asserts that neither role is a member of the other or of the database owner.
- It removes `PUBLIC` database privileges (no `CREATE`/`TEMP`).
- It confines migrator DDL to the application schema.
- It grants the runtime role only `SELECT, INSERT, UPDATE, DELETE` and sequence usage.

`after-first-migrate.sql` is run by the migrator after the first deploy and is
idempotent. It removes runtime access to `_prisma_migrations` and any `TRUNCATE`,
`TRIGGER` or `REFERENCES` grants.

`TRUNCATE` matters. The ledger and history guards are row-level `UPDATE`/`DELETE`
triggers, and PostgreSQL row triggers do not fire on `TRUNCATE`. The rehearsal
recorded 54 user triggers, **0** of them truncate triggers, so privilege is the only
defense. After `after-first-migrate.sql`, the runtime role held `TRUNCATE` on 0 of
106 tables (`evidence/MIGRATION_REHEARSAL.md`).

The rehearsal also found that `LedgerAccount` and `MoneyReconciliationWindow`
guard `UPDATE` only. The runtime role could therefore `DELETE` an unreferenced
`LedgerAccount` row (CR-K03-05).

## 5. Evidence data, backups and deletion

Evidence policy follows the K02 owner decision, which is **not yet accepted**:

- Staging stores only **synthetic** files. No real identity documents are used in
  staging or in test artifacts.
- Do not provision a production restricted-evidence store until K02 approves:
  - the minimal-evidence set;
  - its lawful basis;
  - retention and deletion.

  User consent alone does not authorize copying official identity documents.

- Database backups use PITR (proposal: 7 days, RPO 300 s, RTO 4 h, per
  `topology.json` `recovery`). They contain evidence **metadata**, not the
  documents themselves.
- Restricted-bucket versioning is subject to the lifecycle rules in
  `storage/aws/lifecycle.restricted.json`, so deleted originals do not survive
  indefinitely as noncurrent versions.
- Do not replicate the restricted bucket into backups, other regions or logs. The
  application logs never contain document bytes or storage keys (R20/R23 policy).
- Apply provider verification and work-access settings (`VERIFICATION_ENFORCED`,
  `WORK_ACCESS_ENFORCED`) only after OWNER_DECISIONS D-19's
  `work-access:readiness` conditions hold. Staging starts with the policy values
  `preserve` from `topology.json`.

## 6. Domain, DNS, TLS, redirects and mail

**Domain.** Whether to use `.sa`, `.com.sa` or the Arabic IDN depends on SaudiNIC's
current eligibility rules for the registrant entity. That is an owner/K02 decision
and is verified at execution time, not asserted here. Purchase is a separately
authorized action, and K10 owns the production cutover.

**Records.** This table covers the staging-specific delta. The production `www`, apex
and CAA records follow K10's `DOMAIN_EDGE_MAIL_PLAN.md`.

| Name                                      | Type            | Value                                                           |  TTL |
| ----------------------------------------- | --------------- | --------------------------------------------------------------- | ---: |
| `staging.<DOMAIN>`                        | A/AAAA or CNAME | `<staging edge target>`                                         |  300 |
| `<DOMAIN>`                                | CAA             | `0 issue "<approved CA>"` (shared with production)              | 3600 |
| `stg-mail.<DOMAIN>`                       | TXT (SPF)       | `v=spf1 include:<provider SPF host> -all`                       | 3600 |
| `<selector>._domainkey.stg-mail.<DOMAIN>` | TXT/CNAME       | provider-generated                                              | 3600 |
| `_dmarc.stg-mail.<DOMAIN>`                | TXT             | `v=DMARC1; p=none; adkim=s; aspf=r; rua=mailto:<owned mailbox>` | 3600 |
| bounce / custom MAIL FROM for `stg-mail`  | per provider    | provider docs                                                   | 3600 |

A separate staging sending subdomain keeps staging volume, test failures and DKIM
keys from affecting the production `mail.<DOMAIN>` reputation or DMARC.

- `SMTP_FROM` is `HomeService Staging <no-reply@stg-mail.<DOMAIN>>`.
- The `SMTP_FROM` value must not end in `.local`; the preflight enforces this.

**TLS.**

- Certificates are ACME-issued or provider-managed, with automatic renewal, and the
  CAA record restricts issuers.
- TLS 1.2 is the minimum.
- HSTS starts at `max-age=300` with no `includeSubDomains` and no preload (`edge-policy.json`).
- Renewal is monitored with an alert at 21 days before expiry.

**Redirects.**

- `http://` returns 308 to `https://` on every host.
- Staging has no apex or `www` redirect.
- Production apex returns 301 to `https://www.<DOMAIN>/` (K10).

**DNS rollback.** Export the zone before any change. Staging records use a 300 s TTL.
To roll back, restore the exported values; CAA and mail records may stay.

## 7. Cost model (owner must quote and approve)

No unit prices are asserted. Prices depend on the provider and region the owner
selects, and they change. Obtain a written quote or calculator export for the
selected region and record it with its date in `BLOCKED_INPUTS.md`.

Staging bill of materials (minimum viable, one region, no HA):

| Item                  | Quantity / size (proposal)                                   | Driver                                                       |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| App host VM           | 1 × 2 vCPU / 8 GiB RAM / 60 GiB SSD                          | API (Node), nginx web, ClamAV (~1.5 GiB RAM for definitions) |
| Managed PostgreSQL 16 | 1 × 2 vCPU / 4 GiB, 20 GiB storage, PITR 7 days, single zone | 75 migrations, synthetic data only                           |
| Managed Redis 7       | 1 × smallest dedicated TLS tier (~1 GiB)                     | Queues, rate limits, realtime                                |
| Object storage        | 3 buckets, < 20 GiB total, versioning, CMK for restricted    | Synthetic uploads                                            |
| Load balancer / edge  | 1 public HTTPS listener                                      | Same-origin routing                                          |
| Registry              | < 10 GiB (3 repos, retention: last 20 digests)               | Release images                                               |
| Secret manager        | ~6 secrets × versions                                        | API env, migration DSN, SMTP, S3, Redis                      |
| SMTP                  | Lowest tier covering < 1,000 messages/month                  | OTP/reset/notification tests                                 |
| DNS zone + certs      | 1 zone (shared), ACME certificates                           | —                                                            |
| Egress / logs         | Low (staging traffic)                                        | —                                                            |

**Ceiling rule.**

- The monthly ceiling is the quoted sum × 1.3, rounded up.
- Budget alerts fire at 50 %, 80 % and 100 %.
- Any resource beyond this table needs a new approval.
- Production sizing (HA database, ≥ 2 API replicas) depends on R25 multi-instance
  realtime, which is not merged (`multiInstanceStatus: R25_INTEGRATION_PENDING`). It
  is therefore out of K03's cost scope.

## 8. Change requests raised by K03

| ID        | Target                                            | Finding                                                                                                                                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CR-K03-01 | R28/coordinator: `edge-policy.json`, schema `csp` | The edge plan's web CSP fields (`scriptSources` is a `const` `'self'`, with no map or Stripe origins) predate R26's build-bound document CSP. An edge that emits them would intersect with the document policy. K03 makes the launcher reject any edge-added web CSP header. Reconcile the schema so the document meta policy is the single web script/frame/connect authority. |
| CR-K03-02 | Coordinator                                       | `apps/web/Dockerfile` and `infra/` are `COORDINATOR_OWNED`. The K03 edits there need coordinator review in this PR.                                                                                                                                                                                                                                                             |
| CR-K03-03 | API mail (R21 owner)                              | There is no application-level staging recipient allowlist. Until one exists, staging must contain only synthetic accounts addressed to approved test inboxes, plus provider-side recipient restrictions where available.                                                                                                                                                        |
| CR-K03-04 | Production rollout                                | R25 multi-instance realtime is needed before more than one API replica, for HA production sizing.                                                                                                                                                                                                                                                                               |
| CR-K03-05 | Money/ledger owner (R15/R19), via coordinator     | `LedgerAccount` (and `MoneyReconciliationWindow`) have `BEFORE UPDATE` guards but no `DELETE` guard. In the rehearsal the runtime role deleted an unreferenced `LedgerAccount` row. Foreign keys protect referenced accounts. Decide whether accounts are append-only and, if so, add a reviewed forward migration with a delete guard. K03 adds no money-schema migration.     |
