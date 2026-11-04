-- K03: one-time DBA bootstrap for the separated migrator/runtime identities.
--
-- Run ONCE per environment as the provider's administrative role, BEFORE the
-- first `prisma migrate deploy`, with psql variables:
--
--   psql "$ADMIN_DSN" -v ON_ERROR_STOP=1 \
--     -v app_db=hsm_staging -v app_schema=public \
--     -v migrator=hsm_migrator -v runtime=hsm_api \
--     -f infra/production/database/bootstrap-roles.sql
--
-- Both LOGIN roles must already exist. Create them and set their passwords
-- through the provider console or the secret manager, never in this file or a
-- shell history. This script asserts their attributes instead of granting any.
--
-- Result: the migrator owns the application objects it creates and can run DDL
-- only inside the application schema; the runtime role can read and write rows
-- but cannot create, alter, drop or TRUNCATE objects, cannot write migration
-- history (see after-first-migrate.sql) and cannot assume the migrator.
-- TRUNCATE matters: the append-only ledger/history triggers are row-level
-- UPDATE/DELETE guards, and PostgreSQL row triggers do not fire on TRUNCATE.
\set ON_ERROR_STOP on

SELECT set_config('k03.migrator', :'migrator', false),
       set_config('k03.runtime', :'runtime', false),
       set_config('k03.app_db', :'app_db', false);

DO $$
DECLARE
  bad text;
BEGIN
  IF current_setting('k03.migrator') = current_setting('k03.runtime') THEN
    RAISE EXCEPTION 'K03_ROLES_NOT_DISTINCT';
  END IF;
  SELECT string_agg(rolname, ',') INTO bad FROM pg_roles
   WHERE rolname IN (current_setting('k03.migrator'), current_setting('k03.runtime'))
     AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
          OR NOT rolcanlogin);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'K03_ROLE_ATTRIBUTES_UNSAFE: %', bad;
  END IF;
  IF (SELECT count(*) FROM pg_roles
       WHERE rolname IN (current_setting('k03.migrator'), current_setting('k03.runtime'))) <> 2 THEN
    RAISE EXCEPTION 'K03_ROLES_MISSING';
  END IF;
  -- Neither identity may reach the other (or the database owner) by membership.
  IF pg_has_role(current_setting('k03.runtime'), current_setting('k03.migrator'), 'MEMBER')
     OR pg_has_role(current_setting('k03.migrator'), current_setting('k03.runtime'), 'MEMBER') THEN
    RAISE EXCEPTION 'K03_ROLE_MEMBERSHIP_UNSAFE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database d
              WHERE d.datname = current_setting('k03.app_db')
                AND (pg_has_role(current_setting('k03.runtime'), d.datdba, 'MEMBER')
                     OR pg_has_role(current_setting('k03.migrator'), d.datdba, 'MEMBER'))) THEN
    RAISE EXCEPTION 'K03_DATABASE_OWNER_REACHABLE';
  END IF;
END $$;

-- Database: connect only; no schema/extension creation, no temp tables.
REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"app_db" TO :"migrator", :"runtime";

-- Application schema: the migrator may create objects here and nowhere else.
CREATE SCHEMA IF NOT EXISTS :"app_schema";
REVOKE ALL ON SCHEMA :"app_schema" FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA :"app_schema" TO :"migrator";
GRANT USAGE ON SCHEMA :"app_schema" TO :"runtime";

-- Objects the migrator creates later: row access only for the runtime role.
-- Deliberately no TRUNCATE, TRIGGER or REFERENCES.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA :"app_schema"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator" IN SCHEMA :"app_schema"
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime";
