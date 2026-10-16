# G1 remediation ownership

Mode A — source and missing runtime-evidence remediation.

Repository owner Baraa explicitly delegated all G1 blockers to this session as
coordinator on 2026-10-16 at 23:02 Asia/Damascus. This is the recorded
coordinator approval for the exact files below, including schema, seed, CI and
global wiring. One writer: this coordination session. No other lane is assigned
these files here. Extensions are recorded before editing.

- Branch: `coord/g1-wave1-remediation`.
- Base: `5d3acaf861d74756190854138af485cfbfaa0a43`.
- Base tree: `74af4d540fffaa3f51c2f4c04a3974b3aa3d68e2`.
- Scope: G1-01 through G1-05; prepare evidence for G1-06.
- Expiry: owner review/merge or explicit handoff.
- Publication: review PR only; no merge, deployment or live activation.
- R26 and Wave 2 remain closed until a separately accepted, merged G1 record.
- No permissions are granted to accounts or roles; replay permission is only registered.
- Historical G1 decision files are preserved; this remediation is not gate acceptance.

## Exact files

- `apps/api/src/config/env.schema.ts`
- `apps/api/src/config/env.validation.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/infrastructure/outbox/outbox.tokens.ts`
- `apps/api/src/infrastructure/outbox/outbox.worker.ts`
- `apps/api/src/infrastructure/outbox/outbox-replay.service.ts`
- `apps/api/src/infrastructure/telemetry/telemetry-bootstrap.service.ts`
- `apps/api/src/infrastructure/telemetry/telemetry-bootstrap.service.spec.ts`
- `apps/api/src/infrastructure/telemetry/metrics.module.ts`
- `apps/api/src/infrastructure/health/health.module.ts`
- `apps/api/src/infrastructure/health/diagnostics.scheduler.ts`
- `apps/api/src/infrastructure/health/diagnostics.scheduler.spec.ts`
- `apps/api/src/infrastructure/mail/nodemailer-mail.adapter.ts`
- `apps/api/src/infrastructure/mail/nodemailer-mail.adapter.spec.ts`
- `apps/api/src/infrastructure/storage/s3-storage.adapter.ts`
- `apps/api/src/infrastructure/storage/s3-restricted-storage.adapter.ts`
- `apps/api/src/infrastructure/storage/storage.module.ts`
- `apps/api/src/infrastructure/storage/storage-diagnostics-probe.ts`
- `apps/api/src/modules/provider/verification/media/clamav-scanner.adapter.ts`
- `apps/api/src/modules/provider/verification/media/clamav-scanner.adapter.spec.ts`
- `apps/api/src/dispute-maintenance.worker.ts`
- `apps/api/src/evidence-retention.worker.ts`
- `apps/api/src/modules/money/domain/subscription-activation.service.ts`
- `apps/api/src/modules/money/domain/money-ports.v1.ts`
- `apps/api/src/modules/notifications/subscription-activated.handler.ts`
- `apps/api/src/modules/notifications/subscription-activated.handler.spec.ts`
- `apps/api/src/modules/notifications/notifications.module.ts`
- `apps/api/test/support/money-ports-consumer.fixture.ts`
- `apps/api/test/unit/g1-telemetry-boundaries.spec.ts`
- `apps/api/test/integration/r19-subscription-money.integration.spec.ts`
- `apps/api/test/integration/r22-outbox-replay.integration.spec.ts`
- `apps/api/test/integration/r22-outbox-process.integration.spec.ts`
- `apps/api/test/integration/r20-storage/r20-s3-fixture.ts`
- `apps/api/test/integration/r20-storage/r20-s3-storage.integration.spec.ts`
- `apps/api/test/integration/seed-idempotency.spec.ts`
- `apps/web/src/lib/provider/provider-avatar-api.ts`
- `apps/web/src/lib/provider/provider-avatar-api.test.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261016203000_g1_refund_binding_and_replay_audit/migration.sql`
- `packages/database/src/seed.ts`
- `.github/workflows/ci.yml`
- `scripts/ci/install-minio-client-fixture.sh`
- `.github/scripts/g1-runtime-evidence.test.mjs`
- `.env.example`
- `docs/production-readiness/FEATURE_INVENTORY.json`
- `docs/production-readiness/r18/ENVIRONMENT_MATRIX.md`
- `docs/production-readiness/r19/CONTRACT_CATALOG.md`
- `docs/production-readiness/post-r18/gates/g1/REMEDIATION_OWNERSHIP.md`
- `docs/production-readiness/post-r18/gates/g1/REMEDIATION.md`
- `docs/production-readiness/post-r18/gates/g1/REMEDIATION_ACCEPTANCE.md`
- `docs/production-readiness/post-r18/gates/g1/REMEDIATION_ROLLBACK.md`

## Scope extension before edits

Factory wiring and focused regressions needed for the same G1 corrections:

- `apps/api/src/infrastructure/mail/mail.module.ts`
- `apps/api/src/infrastructure/storage/storage-telemetry.ts`
- `apps/api/src/infrastructure/storage/storage-telemetry.spec.ts`
- `apps/api/src/modules/provider/verification/provider-verification.module.ts`
- `apps/api/test/unit/seed-with-tx.spec.ts` — preserve the existing RBAC regression while proving the replay permission is registered without grants.
- `apps/api/src/modules/notifications/notifications.service.ts` — internal optional domain dedupe key for activation notices.
- `apps/api/src/infrastructure/persistence/notifications/notification.repository.ts` — persist and replay that unique key in the same transaction.
- `apps/api/test/integration/evidence-retention.integration.spec.ts` — assert the new generic job metric in the existing protected real-process scrape.
- `apps/api/test/integration/dispute-worker-process.integration.spec.ts` — same assertion for the independent dispute worker.
- `.github/scripts/merge-integrity.test.mjs` — retain the exact whole-suite invocation assertion while recognizing the newly retained JSON report arguments.
