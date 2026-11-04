#!/usr/bin/env node
'use strict';
// K03: disposable migration rehearsal with separated identities.
//
// Uses ONLY throwaway local containers and per-run random credentials (never
// printed). Never point this at a shared, staging or production database.
//
//   node infra/production/database/rehearse-migration.cjs \
//     --migrator-image hsm-migrator:k03 --port 15433 --report out.json
//
// Sequence (each step's observed result is recorded in the JSON report):
//   1. PostgreSQL 16 + bootstrap-roles.sql (distinct migrator/runtime roles)
//   2. the real migrator image deploys all but the last N migrations
//   3. after-first-migrate.sql, then the synthetic dev seed AS THE RUNTIME ROLE
//      (representative rows; proves runtime DML grants suffice)
//   4. upgrade to head with the real migrator image; row counts preserved
//   5. runtime-role negatives: TRUNCATE, DDL, migration history, SET ROLE,
//      migrate deploy; ledger append-only triggers still enforced
//   6. a deliberately failing migration: no automatic rollback, a retry is
//      refused, data is untouched; forward repair via `migrate resolve`
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'packages/database/prisma/migrations');

function args(argv) {
  const out = { keepLast: 2, port: 15433 };
  for (let i = 0; i < argv.length; i += 2) {
    const [key, value] = [argv[i], argv[i + 1]];
    if (key === '--migrator-image') out.image = value;
    else if (key === '--port') out.port = Number(value);
    else if (key === '--report') out.report = value;
    else if (key === '--keep-last') out.keepLast = Number(value);
    else throw new Error(`unknown option ${key}`);
  }
  if (!out.image || !out.report || !Number.isInteger(out.port) || out.port < 1024)
    throw new Error('usage: --migrator-image IMAGE --report FILE [--port N] [--keep-last N]');
  return out;
}

function docker(argv, { allowFail = false, input } = {}) {
  const result = spawnSync('docker', argv, {
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  const ok = !result.error && result.status === 0;
  if (!ok && !allowFail)
    throw new Error(`docker ${argv[0]} failed: ${(result.stderr || '').slice(0, 400)}`);
  return { ok, status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function main() {
  const opts = args(process.argv.slice(2));
  const run = randomBytes(4).toString('hex');
  const names = { net: `hsm-k03-rehearsal-${run}`, pg: `hsm-k03-pg-${run}` };
  const secret = () => randomBytes(18).toString('hex');
  const pw = { admin: secret(), migrator: secret(), runtime: secret() };
  const db = 'hsm_rehearsal';
  const report = { run, startedAt: new Date().toISOString(), steps: [] };
  const step = (name, detail) => {
    report.steps.push({ name, ...detail });
    console.log(`${name}: ${JSON.stringify(detail)}`);
  };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-k03-migrations-'));
  const dsn = (role, host) =>
    `postgresql://${role}:${pw[role === 'hsm_migrator' ? 'migrator' : 'runtime']}@${host}/${db}?schema=public`;
  const psql = (role, sql, { allowFail = false } = {}) => {
    const password =
      role === 'postgres' ? pw.admin : pw[role === 'hsm_migrator' ? 'migrator' : 'runtime'];
    return docker(
      [
        'exec',
        '-i',
        '-e',
        `PGPASSWORD=${password}`,
        names.pg,
        'psql',
        '-X',
        '-q',
        '-t',
        '-A',
        '-h',
        '127.0.0.1',
        '-U',
        role,
        '-d',
        role === 'postgres' && sql.startsWith('--admin-db') ? 'postgres' : db,
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { allowFail, input: sql },
    );
  };
  const migrate = (
    dir,
    role = 'hsm_migrator',
    command = ['node_modules/.bin/prisma', 'migrate', 'deploy'],
  ) =>
    docker(
      [
        'run',
        '--rm',
        '--network',
        names.net,
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=64m',
        '-e',
        `DATABASE_URL=${dsn(role, `${names.pg}:5432`)}`,
        '-e',
        'CHECKPOINT_DISABLE=1',
        '-v',
        `${dir.replaceAll('\\', '/')}:/migrate/prisma/migrations:ro`,
        opts.image,
        ...command,
      ],
      { allowFail: true },
    );
  const counts = () =>
    Object.fromEntries(
      psql(
        'postgres',
        `SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
         FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations' ORDER BY 1;`,
      )
        .stdout.trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, value] = line.split('=');
          return [name, Number(value)];
        }),
    );
  const copyMigrations = (target, dropLast, extra) => {
    fs.mkdirSync(target, { recursive: true });
    const all = fs
      .readdirSync(MIGRATIONS)
      .filter((n) => /^\d{14}_/u.test(n))
      .sort();
    const chosen = all.slice(0, all.length - dropLast);
    for (const name of chosen)
      fs.cpSync(path.join(MIGRATIONS, name), path.join(target, name), { recursive: true });
    fs.copyFileSync(
      path.join(MIGRATIONS, 'migration_lock.toml'),
      path.join(target, 'migration_lock.toml'),
    );
    if (extra) {
      fs.mkdirSync(path.join(target, extra.name));
      fs.writeFileSync(path.join(target, extra.name, 'migration.sql'), extra.sql);
    }
    return { total: all.length, applied: chosen.length, last: chosen.at(-1) };
  };

  // after-first-migrate.sql as the MIGRATOR (idempotent; rerun after every deploy).
  const afterMigrate = () =>
    docker(
      [
        'exec',
        '-i',
        '-e',
        `PGPASSWORD=${pw.migrator}`,
        names.pg,
        'psql',
        '-X',
        '-q',
        '-h',
        '127.0.0.1',
        '-U',
        'hsm_migrator',
        '-d',
        db,
        '-v',
        'app_schema=public',
        '-v',
        'runtime=hsm_api',
        '-f',
        '-',
      ],
      { input: fs.readFileSync(path.join(__dirname, 'after-first-migrate.sql'), 'utf8') },
    );

  try {
    docker(['network', 'create', names.net]);
    docker([
      'run',
      '-d',
      '--name',
      names.pg,
      '--network',
      names.net,
      '-e',
      `POSTGRES_PASSWORD=${pw.admin}`,
      '-p',
      `127.0.0.1:${opts.port}:5432`,
      'postgres:16-alpine',
    ]);
    for (
      let i = 0;
      i < 60 && !psql('postgres', '--admin-db\nSELECT 1;', { allowFail: true }).ok;
      i += 1
    )
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
    const version = psql('postgres', '--admin-db\nSHOW server_version;').stdout.trim();
    psql(
      'postgres',
      `--admin-db
      CREATE ROLE hsm_migrator LOGIN PASSWORD '${pw.migrator}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE ROLE hsm_api LOGIN PASSWORD '${pw.runtime}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      CREATE DATABASE ${db};`,
    );
    const bootstrap = docker(
      [
        'exec',
        '-i',
        '-e',
        `PGPASSWORD=${pw.admin}`,
        names.pg,
        'psql',
        '-X',
        '-q',
        '-h',
        '127.0.0.1',
        '-U',
        'postgres',
        '-d',
        db,
        '-v',
        `app_db=${db}`,
        '-v',
        'app_schema=public',
        '-v',
        'migrator=hsm_migrator',
        '-v',
        'runtime=hsm_api',
        '-f',
        '-',
      ],
      { input: fs.readFileSync(path.join(__dirname, 'bootstrap-roles.sql'), 'utf8') },
    );
    step('bootstrap-roles', { postgres: version, ok: bootstrap.ok });

    const base = copyMigrations(path.join(scratch, 'base'), opts.keepLast);
    const first = migrate(path.join(scratch, 'base'));
    step('migrate-base-as-migrator', {
      ok: first.ok,
      applied: base.applied,
      of: base.total,
      last: base.last,
    });
    if (!first.ok) throw new Error('base migration failed');
    const after = afterMigrate();
    step('after-first-migrate-as-migrator', { ok: after.ok });

    const seed = spawnSync(process.execPath, [path.join(ROOT, 'packages/database/dist/seed.js')], {
      cwd: path.join(ROOT, 'packages/database'),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        DATABASE_URL: dsn('hsm_api', `127.0.0.1:${opts.port}`),
      },
    });
    const seeded = counts();
    step('seed-synthetic-data-as-runtime', {
      ok: seed.status === 0,
      nonEmptyTables: Object.values(seeded).filter((n) => n > 0).length,
      rows: Object.values(seeded).reduce((a, b) => a + b, 0),
    });
    if (seed.status !== 0) throw new Error(`seed failed: ${(seed.stderr || '').slice(-600)}`);
    // A real ledger row, written by the runtime role, so the guards have a target.
    psql(
      'hsm_api',
      `INSERT INTO "LedgerAccount" ("id","key","ownerType","currency") VALUES ('k03-rehearsal','k03:rehearsal','PLATFORM','SAR');`,
    );
    const beforeUpgrade = counts();

    const head = copyMigrations(path.join(scratch, 'head'), 0);
    const upgrade = migrate(path.join(scratch, 'head'));
    const afterUpgrade = counts();
    const changed = Object.entries(beforeUpgrade)
      .filter(([t, n]) => afterUpgrade[t] !== n)
      .map(([t]) => t);
    step('upgrade-to-head-on-representative-data', {
      ok: upgrade.ok,
      applied: head.applied,
      last: head.last,
      preexistingTablesWithChangedRowCounts: changed,
      newTables: Object.keys(afterUpgrade).filter((t) => !(t in beforeUpgrade)).length,
    });
    step('after-upgrade-privileges-as-migrator', { ok: afterMigrate().ok });

    const denied = (sql) => {
      const r = psql('hsm_api', sql, { allowFail: true });
      return { refused: !r.ok, reason: (r.stderr.match(/ERROR:\s+([^\n]+)/u) || [])[1] || null };
    };
    step('runtime-negative-truncate-ledger', denied('TRUNCATE "LedgerAccount";'));
    step('runtime-negative-truncate-user', denied('TRUNCATE "User";'));
    step('runtime-negative-create-table', denied('CREATE TABLE k03_probe (id int);'));
    step('runtime-negative-alter-table', denied('ALTER TABLE "User" ADD COLUMN k03_probe int;'));
    step('runtime-negative-create-schema', denied('CREATE SCHEMA k03_probe;'));
    step(
      'runtime-negative-read-migration-history',
      denied('SELECT count(*) FROM "_prisma_migrations";'),
    );
    step('runtime-negative-write-migration-history', denied(`DELETE FROM "_prisma_migrations";`));
    step('runtime-negative-set-role-migrator', denied('SET ROLE hsm_migrator;'));
    step(
      'runtime-ledger-update-guard',
      denied(`UPDATE "LedgerAccount" SET "key" = 'tampered' WHERE "id" = 'k03-rehearsal';`),
    );
    step(
      'runtime-ledger-delete',
      denied(`DELETE FROM "LedgerAccount" WHERE "id" = 'k03-rehearsal';`),
    );
    const privileges = psql(
      'postgres',
      `
      SELECT json_build_object(
        'applicationTables', (SELECT count(*) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p')),
        'runtimeTruncateTables', (SELECT count(*) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND has_table_privilege('hsm_api', c.oid, 'TRUNCATE')),
        'runtimeTriggerOrReferencesTables', (SELECT count(*) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND (has_table_privilege('hsm_api', c.oid, 'TRIGGER') OR has_table_privilege('hsm_api', c.oid, 'REFERENCES'))),
        'runtimeMigrationHistoryAccess', has_table_privilege('hsm_api', 'public._prisma_migrations', 'SELECT,INSERT,UPDATE,DELETE'),
        'runtimeSchemaCreate', has_schema_privilege('hsm_api', 'public', 'CREATE'),
        'databaseCreate', json_build_object('runtime', has_database_privilege('hsm_api', '${db}', 'CREATE'), 'migrator', has_database_privilege('hsm_migrator', '${db}', 'CREATE')),
        'ownsDatabase', json_build_object('runtime', (SELECT datdba = 'hsm_api'::regrole FROM pg_database WHERE datname='${db}'), 'migrator', (SELECT datdba = 'hsm_migrator'::regrole FROM pg_database WHERE datname='${db}')),
        'runtimeOwnedRelations', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner='hsm_api'::regrole),
        'roleAttributes', (SELECT json_agg(json_build_object('role', rolname, 'super', rolsuper, 'createdb', rolcreatedb, 'createrole', rolcreaterole, 'replication', rolreplication, 'bypassrls', rolbypassrls)) FROM pg_roles WHERE rolname IN ('hsm_api','hsm_migrator')),
        'userTriggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace),
        'truncateTriggers', (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace AND (t.tgtype & 32) <> 0),
        -- Which row operations each trigger-guarded table covers (tgtype bits: 8 DELETE, 16 UPDATE).
        'guardedTables', (SELECT json_object_agg(relname, json_build_object('update', u, 'delete', d) ORDER BY relname) FROM (
            SELECT c.relname, bool_or((t.tgtype & 16) <> 0) AS u, bool_or((t.tgtype & 8) <> 0) AS d
              FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
             WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace GROUP BY c.relname) g)
      );`,
    ).stdout.trim();
    step('effective-privileges', JSON.parse(privileges));

    const runtimeMigrate = copyMigrations(path.join(scratch, 'runtime-migrate'), 0, {
      name: '20991231000000_k03_runtime_migrate_probe',
      sql: 'CREATE TABLE "K03RuntimeMigrateProbe" ("id" INTEGER);\n',
    });
    const rm = migrate(path.join(scratch, 'runtime-migrate'), 'hsm_api');
    const rmTable = psql(
      'postgres',
      `SELECT to_regclass('public."K03RuntimeMigrateProbe"') IS NOT NULL;`,
    ).stdout.trim();
    step('runtime-negative-migrate-deploy', {
      refused: !rm.ok,
      probeTableCreated: rmTable === 't',
      applied: runtimeMigrate.applied + 1,
    });

    const failingName = '20991231000001_k03_rehearsal_failure';
    copyMigrations(path.join(scratch, 'failing'), 0, {
      name: failingName,
      sql: 'CREATE TABLE "K03FailureProbe" ("id" INTEGER);\nSELECT 1 / 0;\n',
    });
    const beforeFailure = counts();
    const fail1 = migrate(path.join(scratch, 'failing'));
    const fail2 = migrate(path.join(scratch, 'failing'));
    const afterFailure = counts();
    const history = psql(
      'postgres',
      `SELECT json_build_object('finished', finished_at IS NOT NULL, 'rolledBack', rolled_back_at IS NOT NULL) FROM "_prisma_migrations" WHERE migration_name = '${failingName}';`,
    ).stdout.trim();
    step('failing-migration-no-automatic-rollback', {
      firstDeployFailed: !fail1.ok,
      retryRefused: !fail2.ok,
      retryCode: (fail2.stdout + fail2.stderr).match(/P3\d{3}/u)?.[0] ?? null,
      historyRow: history ? JSON.parse(history) : null,
      partialObjectPresent:
        psql(
          'postgres',
          `SELECT to_regclass('public."K03FailureProbe"') IS NOT NULL;`,
        ).stdout.trim() === 't',
      rowCountsUnchanged:
        JSON.stringify(beforeFailure) ===
        JSON.stringify(
          Object.fromEntries(Object.entries(afterFailure).filter(([t]) => t in beforeFailure)),
        ),
    });
    const resolve = migrate(path.join(scratch, 'failing'), 'hsm_migrator', [
      'node_modules/.bin/prisma',
      'migrate',
      'resolve',
      '--rolled-back',
      failingName,
    ]);
    const healthy = migrate(path.join(scratch, 'head'));
    step('forward-repair-resolve-then-redeploy', { resolved: resolve.ok, redeployOk: healthy.ok });
    report.result = 'COMPLETED';
  } catch (error) {
    report.result = 'FAILED';
    report.error = error.message.replaceAll(/[a-f0-9]{36}/gu, '<redacted>');
    process.exitCode = 1;
  } finally {
    docker(['rm', '-f', names.pg], { allowFail: true });
    docker(['network', 'rm', names.net], { allowFail: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(opts.report, `${JSON.stringify(report, null, 2)}\n`);
  }
}

if (require.main === module) main();
