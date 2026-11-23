-- K03: run as the MIGRATOR after the first successful `prisma migrate deploy`
-- (idempotent; safe to rerun after every deployment).
--
--   psql "$MIGRATOR_DSN" -v ON_ERROR_STOP=1 -v app_schema=public -v runtime=hsm_api \
--     -f infra/production/database/after-first-migrate.sql
--
-- Prisma creates "_prisma_migrations" during the first deploy, so the default
-- privileges from bootstrap-roles.sql grant the runtime role row access to it.
-- Remove that: the runtime identity must not read or rewrite migration history.
-- Also remove any TRUNCATE/TRIGGER/REFERENCES that reached the runtime role.
\set ON_ERROR_STOP on

SELECT set_config('search_path', :'app_schema', false);
REVOKE ALL ON TABLE "_prisma_migrations" FROM :"runtime";
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA :"app_schema" FROM :"runtime";
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA :"app_schema" FROM PUBLIC;
