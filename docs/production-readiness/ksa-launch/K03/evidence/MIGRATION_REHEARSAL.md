# K03 — Migration rehearsal (local, disposable)

**Scope: local only.** Throwaway `postgres:16-alpine` (16.13) and the real migrator
image. Credentials were random per run and were never printed or stored. This is not
hosted evidence and certifies no provider database or grant.

| Item           | Value                                                                                                                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run            | 2026-11-03T20:46:22Z → 20:48:34Z, `result: COMPLETED` (raw: `migration-rehearsal.json`)                                                                                                                                                                                                                                    |
| Migrator image | `hsm-migrator:k03`, image ID `sha256:57fe7c2bdd4b22986dfba57f0b0324e4f79e7ab716a945b2d72ed565eb1100dc`, label revision `e4458df3`. The migrations are identical to base `92770ea6` and final `5fd98555`; K03 adds none                                                                                                     |
| SQL            | `bootstrap-roles.sql` and `after-first-migrate.sql`, byte-identical to commit `5fd98555`                                                                                                                                                                                                                                   |
| Driver         | The pre-refactor working copy of `rehearse-migration.cjs`. Commit `5fd98555` only factors the duplicated `after-first-migrate` call into a helper and reports it as an extra `after-upgrade-privileges-as-migrator` step. The rerun at `5fd98555` was stopped by the host's low-memory reaper before it reached this stage |
| Data           | Repository dev seed (synthetic users/requests only), run **as the runtime role**                                                                                                                                                                                                                                           |

## Results

| Step                                                     | Observed                                                                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap roles                                          | OK. Both roles have no superuser, createdb, createrole, replication or bypass-RLS attribute                                                                                                                                 |
| Deploy N-2 as migrator                                   | 72/74 applied (to `20261017220000_g2_completed_booking_read_index`)                                                                                                                                                         |
| Synthetic seed as runtime                                | OK; 112 rows in 11 tables (runtime DML grants suffice)                                                                                                                                                                      |
| Upgrade to head on that data                             | 74/74 to `20261024120000_g3_financial_integration`; 15 new tables; **0** pre-existing tables changed row count                                                                                                              |
| Runtime `TRUNCATE "LedgerAccount"` / `"User"`            | Refused: permission denied                                                                                                                                                                                                  |
| Runtime `CREATE TABLE` / `ALTER TABLE` / `CREATE SCHEMA` | Refused (schema, owner, database)                                                                                                                                                                                           |
| Runtime read/write `_prisma_migrations`                  | Refused                                                                                                                                                                                                                     |
| Runtime `SET ROLE hsm_migrator`                          | Refused                                                                                                                                                                                                                     |
| Runtime `prisma migrate deploy` with a new migration     | Refused; the probe table was not created                                                                                                                                                                                    |
| Runtime `UPDATE "LedgerAccount"`                         | Refused by trigger: `ledger account … is immutable`                                                                                                                                                                         |
| Runtime `DELETE "LedgerAccount"` (unreferenced row)      | **Allowed.** Finding CR-K03-05                                                                                                                                                                                              |
| Effective privileges                                     | 106 tables. Runtime: `TRUNCATE` on 0, `TRIGGER`/`REFERENCES` on 0, owns 0 relations, no schema/database `CREATE`. Neither role owns the database                                                                            |
| Triggers                                                 | 54 user triggers, **0** `TRUNCATE` triggers. 31 tables guard UPDATE and DELETE; 5 guard UPDATE only (`EvidenceRetentionJob`, `LedgerAccount`, `MoneyReconciliationWindow`, `ProviderPortfolioItem`, `VerificationDocument`) |
| Failing migration                                        | The first deploy failed. A retry was refused with `P3009`. The history row is unfinished and not rolled back, no partial object exists, and row counts are unchanged. **No automatic rollback**                             |
| Forward repair                                           | `prisma migrate resolve --rolled-back` then redeploy: both OK                                                                                                                                                               |

The five UPDATE-only tables are reported as observed. Some, such as
`ProviderPortfolioItem`, may use their trigger for state rules rather than
append-only rules. Only the `LedgerAccount` deletion was probed directly.

## Reproduce

```sh
docker build -f apps/api/Dockerfile --target migrator -t hsm-migrator:k03 --build-arg SOURCE_SHA=$(git rev-parse HEAD) .
pnpm --filter @homeservicemarketplace/database build   # seed.js
node infra/production/database/rehearse-migration.cjs --migrator-image hsm-migrator:k03 --port 15433 --report out.json
```

Use a port outside the Windows-excluded range 55249–56148 on this host.
