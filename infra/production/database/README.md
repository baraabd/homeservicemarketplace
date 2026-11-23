# Database identities (K03)

| File                      | Run as                    | When                                                |
| ------------------------- | ------------------------- | --------------------------------------------------- |
| `bootstrap-roles.sql`     | Provider admin/DBA        | Once per environment, before the first migration    |
| `after-first-migrate.sql` | Migrator                  | After the first deploy; idempotent after any deploy |
| `rehearse-migration.cjs`  | Operator, disposable only | Local rehearsal with throwaway containers           |

Roles and passwords are created in the provider console or secret manager, never in
these files. The runtime role gets row access only: it holds no `TRUNCATE` (row
triggers do not fire on `TRUNCATE`), no DDL, no migration-history access and no
`SET ROLE` to the migrator. See
`docs/production-readiness/ksa-launch/K03/DEPLOYMENT_DESIGN.md` §4 and
`evidence/MIGRATION_REHEARSAL.md`.

The rehearsal must never target a shared, staging or production database.
