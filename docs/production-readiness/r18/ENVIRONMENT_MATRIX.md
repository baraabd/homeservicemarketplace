# R18 — Environment matrix

Read on 2026-10-10. Endpoint classes only; no credentials or hostnames.
A CI service container is not a hosted service. "Production status" is
whether the dependency exists for production today.

## Environments

| Environment | What exists                                                                                                                                  | Evidence                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Local       | Windows 11 host, Docker Desktop, throwaway `postgres:16-alpine` and `redis:7-alpine` containers; about 0.7 GB free RAM                       | heavy suites run one at a time or are left to hosted CI (labelled as such)             |
| CI          | GitHub Actions `ubuntu-latest` with disposable PostgreSQL 16, Redis 7, Mailpit, MinIO, ClamAV                                                | 26 successful check runs on `fabeb07`                                                  |
| Staging     | a GitHub environment named `staging` with **no** secrets, variables or protection rules; launcher code in `infra/production/` (`STAGING.md`) | `GET /environments/staging`; last deployment record 2026-04-23 (`9660df9`, before R05) |
| Production  | none. Vercel `Production – …` environments exist from April 2026 web previews; no API, database or worker target                             | `GET /deployments`; no repository or environment secrets                               |

## External dependencies

| Dependency                                  | Endpoint class (intended)                                             | Ownership          | Authentication                  | Encryption                          | Backup                                   | Monitoring                                          | Failure behavior (code)                             | Readiness check                      | Production status |
| ------------------------------------------- | --------------------------------------------------------------------- | ------------------ | ------------------------------- | ----------------------------------- | ---------------------------------------- | --------------------------------------------------- | --------------------------------------------------- | ------------------------------------ | ----------------- |
| PostgreSQL 16                               | managed PostgreSQL, TLS (`sslmode=require&sslaccept=strict`)          | owner (unselected) | separate app and migrator roles | TLS in transit; at rest by provider | not defined                              | none hosted                                         | API readiness fails; requests 503                   | `/health/ready`                      | MISSING           |
| Redis 7                                     | TLS + password                                                        | owner              | password                        | TLS                                 | not needed (rate limits, sessions cache) | none hosted                                         | readiness fails; rate limiting fails closed         | `/health/ready`                      | MISSING           |
| Object storage (S3 API)                     | public / restricted / portfolio-staging buckets                       | owner              | access keys from secret files   | TLS; bucket policy                  | versioning (MinIO in CI only)            | none hosted                                         | upload refused; restricted reads refuse             | evidence-retention worker readiness  | MISSING           |
| ClamAV                                      | private network service                                               | owner              | network isolation               | n/a                                 | n/a                                      | evidence-retention alert rules (`infra/monitoring`) | scan pending → evidence not usable (fails closed)   | worker `/health/ready`               | MISSING           |
| SMTP                                        | verified transactional provider                                       | owner              | SMTP credentials                | STARTTLS / TLS                      | n/a                                      | none hosted                                         | OTP send fails → login cannot complete              | none                                 | MISSING           |
| Outbox / scan / retention / dispute workers | same image as the API                                                 | owner              | database role                   | as PostgreSQL                       | n/a                                      | prom-client metrics                                 | backlog grows; no announcement lost (outbox)        | worker `/health/ready`               | MISSING           |
| Reverse proxy, TLS, DNS                     | an approved HTTPS edge                                                | owner              | n/a                             | TLS                                 | n/a                                      | none                                                | n/a                                                 | none                                 | NOT_AUTHORIZED    |
| Secret manager                              | owner's choice; file-backed Compose secrets are mounts, not a manager | owner              | n/a                             | n/a                                 | n/a                                      | n/a                                                 | launcher refuses unreadable or world-readable files | `infra/production/check-runtime.cjs` | MISSING           |
| Container registry                          | approved registry, digests pinned                                     | owner              | registry token                  | TLS                                 | image retention policy                   | n/a                                                 | launcher refuses tag-only references                | `infra/production/staging.cjs`       | MISSING           |
| Monitoring and alerting                     | the owner's Prometheus-compatible stack                               | owner              | `/metrics` bearer token         | TLS                                 | n/a                                      | —                                                   | —                                                   | —                                    | MISSING           |

No new vendor is selected here. `infra/production/STAGING.md` is the
supported topology: an operator-managed rollout onto an already authorized
target. Until the owner supplies that target, every hosted row is
`HOSTED_ENVIRONMENT_BLOCKED`.

## G1 source correction (2026-10-16; no hosted acceptance)

The dated environment inventory above is historical. The G1 corrective source
adds the following runtime configuration; it provisions no hosted dependency.

| Configuration                        | Default | Validation / behavior                                                      |
| ------------------------------------ | ------- | -------------------------------------------------------------------------- |
| `OUTBOX_DELIVERY_TX_TIMEOUT_MS`      | 15000   | integer 1000–120000; below claim timeout                                   |
| `OUTBOX_DELIVERY_DEADLINE_MS`        | 20000   | integer 1000–180000; above transaction timeout                             |
| `OUTBOX_SHUTDOWN_GRACE_MS`           | 20000   | integer 0–120000                                                           |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | unset   | export off; HTTP(S), no userinfo/fragment, production requires HTTPS       |
| `OTEL_EXPORTER_OTLP_HEADERS`         | unset   | secret; endpoint required; bounded unique header assignments; never logged |
| `OTEL_TRACES_SAMPLER_RATIO`          | 0       | number in [0,1]                                                            |
| `OTEL_SPAN_QUEUE_MAX`                | 2048    | integer 1–65536; bounded loss on collector outage                          |

API diagnostics check configured SMTP, S3 buckets and ClamAV every 60 seconds,
with a 3-second deadline, abort signals and no overlapping runs. Only the
existing bearer-protected metrics expose dependency status. Liveness and
readiness keep their existing scope. No payment adapter means no misleading
payment-UP metric. Standalone workers expose their generic job metrics through
their existing protected endpoints; no new exporter is enabled there.

`DISPUTE_WORKER_ENABLED` was inert and is removed from the API schema; the
standalone dispute worker remains controlled by its actual process and worker
configuration. The historical R18 inventory is not a live configuration list.
