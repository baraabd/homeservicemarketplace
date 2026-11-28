'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  approvedFixtureDatabase,
  seedEmailAuthFixture,
  composeEmailFixtureSql,
} = require('./email-auth-fixture.cjs');

function ci(overrides = {}) {
  return {
    CI: 'true',
    GITHUB_ACTIONS: 'true',
    RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_JOB: 'phase5-real-api',
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://fixture:fixture-secret@127.0.0.1:5432/homeservicemarketplace',
    ...overrides,
  };
}

test('each SMTP browser lane must name its own disposable database and job', () => {
  for (const job of ['phase5-real-api', 'admin-review-real-api', 'browser-auth-e2e'])
    assert.ok(approvedFixtureDatabase(ci({ GITHUB_JOB: job }), 'ci-browser'));
  for (const [scope, database, marker] of [
    ['r04', 'r04_auth_ci', 'R04_ACCEPTANCE_SCOPE'],
    ['startup', 'hsm_startup_ci', 'HSM_STARTUP_PERFORMANCE'],
    ['r26', 'r26_security_ci', 'R26_ACCEPTANCE_SCOPE'],
  ]) {
    const env = ci({
      GITHUB_JOB: 'acceptance',
      [marker]: 'isolated-ci',
      DATABASE_URL: `postgresql://fixture:fixture-secret@localhost:5432/${database}`,
    });
    assert.ok(approvedFixtureDatabase(env, scope));
    assert.throws(() => approvedFixtureDatabase({ ...env, [marker]: undefined }, scope));
  }
});

for (const [label, values, scope = 'ci-browser'] of [
  ['normal developer', { CI: undefined, GITHUB_ACTIONS: undefined }],
  ['self-hosted runner', { RUNNER_ENVIRONMENT: 'self-hosted' }],
  ['unrelated job', { GITHUB_JOB: 'integration-e2e' }],
  ['wrong scope', {}, 'unknown'],
  ['production process', { NODE_ENV: ' production ' }],
  ['production alias', { APP_ENV: 'Prod' }],
  ['staging process', { APP_ENV: 'staging' }],
  [
    'remote host',
    {
      DATABASE_URL: 'postgresql://fixture:fixture-secret@live.example:5432/homeservicemarketplace',
    },
  ],
  [
    'host suffix',
    {
      DATABASE_URL:
        'postgresql://fixture:fixture-secret@localhost.example:5432/homeservicemarketplace',
    },
  ],
  [
    'other database',
    { DATABASE_URL: 'postgresql://fixture:fixture-secret@localhost:5432/production' },
  ],
  [
    'different port',
    { DATABASE_URL: 'postgresql://fixture:fixture-secret@localhost:55432/homeservicemarketplace' },
  ],
  [
    'redirecting query',
    {
      DATABASE_URL:
        'postgresql://fixture:fixture-secret@localhost:5432/homeservicemarketplace?host=live.example',
    },
  ],
  [
    'URL fragment',
    {
      DATABASE_URL:
        'postgresql://fixture:fixture-secret@localhost:5432/homeservicemarketplace#private',
    },
  ],
  [
    'wrong protocol',
    { DATABASE_URL: 'https://fixture:fixture-secret@localhost:5432/homeservicemarketplace' },
  ],
  ['missing database URL', { DATABASE_URL: undefined }],
]) {
  test(`refuses ${label} before constructing a database client, without leaking credentials`, async () => {
    let connected = false;
    await assert.rejects(
      seedEmailAuthFixture({
        env: ci(values),
        scope,
        createClient: () => {
          connected = true;
        },
      }),
      (error) => {
        assert.match(error.message, /^EMAIL_AUTH_FIXTURE_/);
        assert.doesNotMatch(error.message, /fixture-secret|postgresql:|live\.example/);
        return true;
      },
    );
    assert.equal(connected, false);
  });
}

test('R25 and R27 retain their isolated lane identity outside hosted CI', () => {
  const r25 = {
    NODE_ENV: 'test',
    R25_SESSION: 'local_fixture',
    DATABASE_URL: 'postgresql://fixture:fixture-secret@127.0.0.1:54325/hsm_r25_local_fixture',
  };
  assert.ok(approvedFixtureDatabase(r25, 'r25'));
  for (const value of ['hsm_r25_other', 'homeservicemarketplace'])
    assert.throws(() =>
      approvedFixtureDatabase(
        { ...r25, DATABASE_URL: r25.DATABASE_URL.replace('hsm_r25_local_fixture', value) },
        'r25',
      ),
    );
  assert.throws(() =>
    approvedFixtureDatabase(
      { ...r25, DATABASE_URL: r25.DATABASE_URL.replace('54325', '5432') },
      'r25',
    ),
  );
  const r27 = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://r27:r27-local-only@127.0.0.1:54397/hsm_r27_perf',
  };
  assert.ok(approvedFixtureDatabase(r27, 'r27'));
  assert.throws(() =>
    approvedFixtureDatabase({ ...r27, DATABASE_URL: r27.DATABASE_URL + '?host=other' }, 'r27'),
  );
  assert.throws(() =>
    approvedFixtureDatabase(
      { ...r27, DATABASE_URL: r27.DATABASE_URL.replace('54397', '5432') },
      'r27',
    ),
  );
});

test('writes only the explicit email fixture, disconnects, and does not invent administrator history', async () => {
  const calls = [];
  let disconnected = false;
  await seedEmailAuthFixture({
    env: ci(),
    scope: 'ci-browser',
    createClient: () => ({
      platformSetting: { upsert: async (input) => calls.push(input) },
      $disconnect: async () => {
        disconnected = true;
      },
    }),
  });
  assert.deepEqual(calls, [
    {
      where: { key: 'auth.otpChannel' },
      create: { key: 'auth.otpChannel', value: 'email', updatedBy: null },
      update: { value: 'email', updatedBy: null },
    },
  ]);
  assert.equal(disconnected, true);
});

for (const failure of ['connect', 'write', 'disconnect']) {
  test(`sanitizes ${failure} errors and closes any created client`, async () => {
    let disconnected = false;
    const fail = () => {
      throw new Error('postgresql://fixture:fixture-secret@private');
    };
    await assert.rejects(
      seedEmailAuthFixture({
        env: ci(),
        scope: 'ci-browser',
        createClient: () => {
          if (failure === 'connect') fail();
          return {
            platformSetting: { upsert: failure === 'write' ? fail : async () => {} },
            $disconnect: async () => {
              disconnected = true;
              if (failure === 'disconnect') fail();
            },
          };
        },
      }),
      { message: 'EMAIL_AUTH_FIXTURE_WRITE_FAILED' },
    );
    assert.equal(disconnected, failure !== 'connect');
  });
}

test('dependency-free Compose SQL is available only to the existing disposable CI smoke job', () => {
  const env = ci({ GITHUB_JOB: 'compose-smoke' });
  const sql = composeEmailFixtureSql(env);
  assert.match(sql, /INSERT INTO "PlatformSetting"/);
  assert.match(sql, /'auth\.otpChannel', '"email"'::jsonb/);
  assert.doesNotMatch(sql, /User|Role|DELETE|TRUNCATE/);
  assert.throws(() => composeEmailFixtureSql(ci()));
  assert.throws(() => composeEmailFixtureSql({ ...env, GITHUB_ACTIONS: undefined }));
  assert.throws(() => composeEmailFixtureSql({ ...env, NODE_ENV: 'production' }));
});
