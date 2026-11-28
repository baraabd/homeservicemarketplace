'use strict';

const path = require('node:path');

// SMTP/browser acceptance selects its delivery policy explicitly. This is
// fixture data, never a production seed, API fallback, or runtime environment
// override. Missing product settings continue to mean WhatsApp.
const KEY = 'auth.otpChannel';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const BROWSER_JOBS = new Set(['phase5-real-api', 'admin-review-real-api', 'browser-auth-e2e']);
const SCOPES = {
  r04: ['r04_auth_ci', 'R04_ACCEPTANCE_SCOPE'],
  startup: ['hsm_startup_ci', 'HSM_STARTUP_PERFORMANCE'],
  r26: ['r26_security_ci', 'R26_ACCEPTANCE_SCOPE'],
};

function assertFixtureProcess(env) {
  for (const key of ['NODE_ENV', 'APP_ENV']) {
    if (!['', 'test', 'development', 'dev', 'ci'].includes((env[key] ?? '').trim().toLowerCase()))
      throw new Error('EMAIL_AUTH_FIXTURE_NON_PRODUCTION_PROCESS_REQUIRED');
  }
}

function assertHostedCi(env) {
  if (
    env.CI !== 'true' ||
    env.GITHUB_ACTIONS !== 'true' ||
    env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw new Error('EMAIL_AUTH_FIXTURE_DISPOSABLE_CI_REQUIRED');
}

function approvedFixtureDatabase(env, scope) {
  assertFixtureProcess(env);
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('EMAIL_AUTH_FIXTURE_INVALID_DATABASE');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !LOOPBACK.has(url.hostname) ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error('EMAIL_AUTH_FIXTURE_LOCAL_DATABASE_REQUIRED');

  if (scope === 'r27') {
    // lane-db-reset also verifies the Docker labels, binding and ownership
    // before replacing this database. Keep its exact destination contract.
    if (env.DATABASE_URL !== 'postgresql://r27:r27-local-only@127.0.0.1:54397/hsm_r27_perf')
      throw new Error('EMAIL_AUTH_FIXTURE_R27_DATABASE_REQUIRED');
  } else if (scope === 'r25') {
    // verify-replicas already checks service identity, environment files and
    // process ownership. This second boundary forbids shared/default databases.
    if (
      !/^[a-z0-9_]{6,40}$/.test(env.R25_SESSION ?? '') ||
      url.pathname !== `/hsm_r25_${env.R25_SESSION}` ||
      !url.port ||
      url.port === '5432'
    )
      throw new Error('EMAIL_AUTH_FIXTURE_R25_DATABASE_REQUIRED');
  } else {
    assertHostedCi(env);
    let database;
    if (scope === 'ci-browser' && BROWSER_JOBS.has(env.GITHUB_JOB)) {
      database = 'homeservicemarketplace';
    } else if (
      Object.hasOwn(SCOPES, scope) &&
      env.GITHUB_JOB === 'acceptance' &&
      env[SCOPES[scope][1]] === 'isolated-ci'
    ) {
      database = SCOPES[scope][0];
    } else {
      throw new Error('EMAIL_AUTH_FIXTURE_SCOPE_REQUIRED');
    }
    if (url.pathname !== `/${database}` || !['', '5432'].includes(url.port))
      throw new Error('EMAIL_AUTH_FIXTURE_CI_DATABASE_REQUIRED');
  }
  return url.href;
}

function createDatabaseClient(url) {
  // Load only after every target guard passes; no ambient datasource is used.
  const { PrismaClient } = require(path.resolve(__dirname, '../../packages/database/dist'));
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}

async function seedEmailAuthFixture({
  env = process.env,
  scope,
  createClient = createDatabaseClient,
} = {}) {
  const url = approvedFixtureDatabase(env, scope);
  let client;
  let failed = false;
  try {
    client = createClient(url);
    await client.platformSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: 'email', updatedBy: null },
      update: { value: 'email', updatedBy: null },
    });
  } catch {
    failed = true;
  } finally {
    try {
      await client?.$disconnect();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('EMAIL_AUTH_FIXTURE_WRITE_FAILED');
}

function composeEmailFixtureSql(env = process.env) {
  assertFixtureProcess(env);
  assertHostedCi(env);
  if (env.GITHUB_JOB !== 'compose-smoke')
    throw new Error('EMAIL_AUTH_FIXTURE_COMPOSE_JOB_REQUIRED');
  // compose-smoke owns its disposable PostgreSQL container and executes this
  // fixed statement there. The host runner needs neither pnpm nor Prisma.
  return `INSERT INTO "PlatformSetting" ("key", "value", "updatedAt", "updatedBy")
VALUES ('auth.otpChannel', '"email"'::jsonb, NOW(), NULL)
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW(), "updatedBy" = NULL;\n`;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--compose-sql') {
    process.stdout.write(composeEmailFixtureSql());
  } else if (args.length === 2 && args[0] === '--scope') {
    await seedEmailAuthFixture({ scope: args[1] });
    console.log('Explicit email authentication policy prepared for disposable SMTP fixtures.');
  } else throw new Error('EMAIL_AUTH_FIXTURE_INVALID_ARGUMENTS');
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { approvedFixtureDatabase, seedEmailAuthFixture, composeEmailFixtureSql };
