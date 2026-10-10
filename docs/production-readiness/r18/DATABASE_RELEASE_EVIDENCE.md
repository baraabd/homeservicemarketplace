# R18 — Database release evidence

## Schema impact of R18

None. R18 adds tests, CI wiring and documents. No Prisma schema change, no
migration, no generated-client change. Certification did not need one.

## Migration inventory at `fabeb07`

| Item                         | Value                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Migrations                   | 67 directories under `packages/database/prisma/migrations/` (plus `migration_lock.toml`)         |
| Latest                       | `20261004150000_r15_ledger_foundation`                                                           |
| Migration-set hash (SHA-256) | `dcab94c6a7a52249c232eeaad258c964be325cf9291168c8009c295179deecf7`                               |
| Hash method                  | `find packages/database/prisma/migrations -name migration.sql \| sort \| xargs cat \| sha256sum` |
| Provider                     | PostgreSQL (CI: `postgres:16-alpine`)                                                            |

## Verification that ran (CI on `fabeb07`, all success)

- `Verify / Verify Database`: Prisma validate and generate, migration
  verification.
- `Integration & E2E (real Postgres / Redis)`: every migration applied to a
  fresh database, then the integration suites.
- `Docker cold build + production boot`: migrate and boot the production image.
- `Compose stack smoke`: migrate, boot, readiness.

## Not executed (needs a hosted database)

| Item                                                 | Status                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Upgrade of a long-lived database                     | HOSTED_ENVIRONMENT_BLOCKED                                                      |
| Pre-deploy backup                                    | HOSTED_ENVIRONMENT_BLOCKED                                                      |
| Restore to an isolated database                      | HOSTED_ENVIRONMENT_BLOCKED (`BACKUP_RESTORE_EVIDENCE.md`)                       |
| Query plans on production-sized data                 | NOT_RUN (`PERFORMANCE_ACCEPTANCE.md`)                                           |
| Role separation (app vs migrator) on the real target | HOSTED_ENVIRONMENT_BLOCKED (the launcher requires it; nothing certifies grants) |

## Forward-fix and rollback

Every migration on `develop` is forward-only. A failed deployment rolls back
the application images to the previous digests (`ROLLBACK_RUNBOOK.md`); the
schema stays, because each release has been additive to date. A migration that
fails part-way is forward-fixed with a new migration, never reversed by hand.
