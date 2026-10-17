'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  configuration,
  publicConfiguration,
  fingerprint,
  summarizeJest,
  summarizeBrowser,
  childEnvironment,
  requireFreePort,
  requireSameSource,
  requireNoEnvironmentFiles,
  directoryDigest,
  ownedProcess,
  requireCompletedCleanup,
} = require('./verify-replicas.cjs');

function fixture(overrides = {}) {
  return {
    R25_SESSION: 'isolated_001',
    DATABASE_URL:
      'postgresql://fixture:r25_fixture_secret_only@127.0.0.1:54325/hsm_r25_isolated_001',
    REDIS_PASSWORD: 'disposable-redis-value',
    ...overrides,
  };
}

test('accepts only the explicitly named disposable database and distinct loopback services', () => {
  const config = configuration(fixture());
  assert.equal(config.session, 'isolated_001');
  assert.equal(new Set(Object.values(config.ports)).size, 8);
});

for (const [label, values] of [
  [
    'foreign host',
    {
      DATABASE_URL:
        'postgresql://fixture:r25_fixture_secret_only@example.com:54325/hsm_r25_isolated_001',
    },
  ],
  [
    'user working database',
    {
      DATABASE_URL:
        'postgresql://fixture:r25_fixture_secret_only@127.0.0.1:54325/homeservicemarketplace',
    },
  ],
  [
    'wrong session database',
    {
      DATABASE_URL:
        'postgresql://fixture:r25_fixture_secret_only@127.0.0.1:54325/hsm_r25_other_session',
    },
  ],
  [
    'default shared database port',
    {
      DATABASE_URL:
        'postgresql://fixture:r25_fixture_secret_only@127.0.0.1:5432/hsm_r25_isolated_001',
    },
  ],
  ['default shared Redis port', { REDIS_PORT: '6379' }],
  ['remote Redis', { REDIS_HOST: 'example.com' }],
  ['unauthenticated Redis', { REDIS_PASSWORD: '' }],
  ['replica port collision', { R25_API_B_PORT: '4325' }],
  ['service port collision', { R25_MAILPIT_PORT: '56325' }],
  ['hosted runtime', { APP_ENV: 'staging' }],
  ['production runtime', { NODE_ENV: 'production' }],
  ['production alias', { APP_ENV: 'prod' }],
  ['staging node runtime', { NODE_ENV: 'staging' }],
  ['normalized production alias', { APP_ENV: ' Prod ' }],
  [
    'database query override',
    {
      DATABASE_URL:
        'postgresql://fixture:r25_fixture_secret_only@127.0.0.1:54325/hsm_r25_isolated_001?host=elsewhere',
    },
  ],
  ['session path traversal', { R25_SESSION: '../other' }],
  ['noninteger port', { R25_API_A_PORT: '4325.5' }],
]) {
  test(`refuses ${label} without leaking supplied credentials`, () => {
    assert.throws(
      () => configuration(fixture(values)),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /r25_fixture_secret_only|disposable-redis-value|postgresql:|password=/i,
        );
        return true;
      },
    );
  });
}

test('public configuration and its fingerprint exclude credentials', () => {
  const first = publicConfiguration(configuration(fixture()));
  const second = publicConfiguration(
    configuration(
      fixture({
        DATABASE_URL: 'postgresql://different:different@127.0.0.1:54325/hsm_r25_isolated_001',
        REDIS_PASSWORD: 'different',
      }),
    ),
  );
  assert.deepEqual(first, second);
  assert.equal(fingerprint(first), fingerprint(second));
  assert.doesNotMatch(
    JSON.stringify(first),
    /r25_fixture_secret_only|disposable-redis-value|password|postgresql:/i,
  );
});

test('child environment ignores inherited production secrets and uses separate storage roots', () => {
  const config = configuration(fixture());
  const inherited = {
    PATH: '/test/bin',
    REALTIME_ALLOW_SINGLE_INSTANCE: 'true',
    AWS_SECRET_ACCESS_KEY: 'private',
    THROTTLE_REDIS_REQUIRED: 'false',
    GLOBAL_THROTTLE_LIMIT: '1000000',
  };
  const env = childEnvironment(config, inherited, { headSha: 'a'.repeat(40) });
  assert.equal(env.PATH, '/test/bin');
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.GLOBAL_THROTTLE_LIMIT, undefined);
  assert.equal(env.REALTIME_ALLOW_SINGLE_INSTANCE, 'false');
  assert.equal(env.THROTTLE_REDIS_REQUIRED, 'true');
  assert.equal(env.HSM_R25_REALTIME, 'isolated-ci');
  assert.equal(env.STORAGE_DRIVER, 'local');
  assert.notEqual(env.LOCAL_STORAGE_DIR, env.RESTRICTED_STORAGE_DIR);
  assert.equal(Buffer.from(env.MAIL_INTENT_ENCRYPTION_KEY, 'base64').length, 32);
});

test('a second candidate environment never reuses generated signing/encryption secrets', () => {
  const config = configuration(fixture());
  const first = childEnvironment(config, {}, { headSha: 'a'.repeat(40) });
  const second = childEnvironment(config, {}, { headSha: 'a'.repeat(40) });
  assert.notEqual(first.JWT_ACCESS_SECRET, second.JWT_ACCESS_SECRET);
  assert.notEqual(first.MAIL_INTENT_ENCRYPTION_KEY, second.MAIL_INTENT_ENCRYPTION_KEY);
});

test('an empty or partially skipped API run cannot be accepted', () => {
  const good = {
    numPassedTestSuites: 1,
    numPassedTests: 7,
    numFailedTests: 0,
    numPendingTests: 0,
    success: true,
  };
  assert.equal(summarizeJest(good).passed, 7);
  for (const bad of [
    {},
    { ...good, numPassedTests: 0 },
    { ...good, numPendingTests: 1 },
    { ...good, numFailedTests: 1 },
    { ...good, success: false },
  ])
    assert.throws(() => summarizeJest(bad));
});

test('browser evidence requires positive exact-run success and zero retries/skips/failures', () => {
  const good = { stats: { expected: 3, unexpected: 0, skipped: 0, flaky: 0 }, errors: [] };
  assert.equal(summarizeBrowser(good).passed, 3);
  for (const key of ['unexpected', 'skipped', 'flaky'])
    assert.throws(() => summarizeBrowser({ stats: { ...good.stats, [key]: 1 } }));
  assert.throws(() => summarizeBrowser({ stats: { ...good.stats, expected: 0 } }));
  assert.throws(() => summarizeBrowser({ ...good, errors: [{ message: 'setup failed' }] }));
});

test('port collision refuses admission without stopping the existing listener', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const number = server.address().port;
  try {
    await assert.rejects(requireFreePort(number), /already in use/);
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await requireFreePort(number);
});

test('a changed head, tree or branch cannot earn acceptance under an earlier source identity', () => {
  const source = {
    headSha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    branch: 'feat/r25-realtime-multi-instance',
  };
  requireSameSource(source, { ...source });
  for (const key of ['headSha', 'treeSha', 'branch'])
    assert.throws(
      () => requireSameSource(source, { ...source, [key]: 'changed' }),
      /changed during acceptance/,
    );
});

test('failed or interrupted process cleanup fails the acceptance command', () => {
  const controller = new AbortController();
  requireCompletedCleanup('owned process groups stopped', controller.signal);
  assert.throws(
    () => requireCompletedCleanup('owned process cleanup failed', controller.signal),
    /no success is credited/,
  );
  controller.abort();
  assert.throws(
    () => requireCompletedCleanup('owned process groups stopped', controller.signal),
    /no success is credited/,
  );
});

test('loadable ignored env files are refused without reading or reporting their contents', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'r25-env-guard-'));
  try {
    await requireNoEnvironmentFiles(directory);
    await fs.mkdir(path.join(directory, 'apps/web'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'apps/web/.env.production.local'),
      'SECRET=fixture_do_not_read',
    );
    await assert.rejects(requireNoEnvironmentFiles(directory), (error) => {
      assert.match(error.message, /isolated checkout/);
      assert.doesNotMatch(error.message, /fixture_do_not_read|SECRET=/);
      return true;
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('compiled artifact identity includes nested modules as well as main.js', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'r25-build-digest-'));
  try {
    await fs.mkdir(path.join(directory, 'modules'));
    await fs.writeFile(path.join(directory, 'main.js'), 'entry');
    await fs.writeFile(path.join(directory, 'modules/gateway.js'), 'first');
    const initial = await directoryDigest(directory);
    assert.equal(initial.files, 2);
    assert.deepEqual(await directoryDigest(directory), initial);
    await fs.writeFile(path.join(directory, 'modules/gateway.js'), 'changed');
    assert.notEqual((await directoryDigest(directory)).sha256, initial.sha256);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('owned command cleanup stops its listening grandchild as well as the wrapper', async () => {
  const grandchild =
    "const net=require('node:net'); const s=net.createServer(); s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)+'\\n'));";
  const wrapper = `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore','inherit','inherit']}); setInterval(()=>{},1000);`;
  const running = ownedProcess(process.execPath, ['-e', wrapper], {});
  try {
    const number = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('test grandchild failed to start')), 5000);
      running.child.stdout.once('data', (chunk) => {
        clearTimeout(timer);
        resolve(Number(chunk.toString().trim()));
      });
    });
    assert.ok(Number.isInteger(number) && number > 0);
    await assert.rejects(requireFreePort(number), /already in use/);
    await running.stop();
    await requireFreePort(number);
  } finally {
    await running.stop();
  }
});
