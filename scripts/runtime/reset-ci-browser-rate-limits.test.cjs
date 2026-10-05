'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resetCiBrowserRateLimits } = require('./reset-ci-browser-rate-limits.cjs');

const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_JOB: 'phase5-real-api',
  NODE_ENV: 'development',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
};

function redisFixture({ pages = [['0', []]], keys = [], failure } = {}) {
  const remaining = new Set(keys);
  const calls = { connect: 0, scan: [], unlink: [], quit: 0, disconnect: 0 };
  let page = 0;
  const client = {
    on() {},
    async connect() {
      calls.connect += 1;
      if (failure === 'connect') throw new Error('redis://credential@private-host');
    },
    async scan(...args) {
      calls.scan.push(args);
      if (failure === 'scan') throw new Error('secret rl:identity@example.test');
      return pages[page++];
    },
    async unlink(...batch) {
      calls.unlink.push(batch);
      if (failure === 'unlink') throw new Error('secret rate key');
      return batch.reduce((removed, key) => removed + Number(remaining.delete(key)), 0);
    },
    async quit() {
      calls.quit += 1;
      if (failure === 'quit' || failure === 'connect') throw new Error('secret close error');
    },
    disconnect() {
      calls.disconnect += 1;
    },
  };
  return { client, calls, remaining };
}

for (const [label, patch] of [
  ['outside GitHub Actions', { GITHUB_ACTIONS: 'false' }],
  ['another CI job', { GITHUB_JOB: 'authentication-lifecycle' }],
  ['production', { NODE_ENV: 'production' }],
  ['staging', { NODE_ENV: 'staging' }],
  ['unrecognized environment', { NODE_ENV: 'prod' }],
  ['non-loopback Redis', { REDIS_HOST: 'redis.internal' }],
  ['Redis URL with credentials', { REDIS_HOST: 'redis://secret@localhost' }],
  ['zero Redis port', { REDIS_PORT: '0' }],
  ['out-of-range Redis port', { REDIS_PORT: '65536' }],
  ['nondecimal Redis port', { REDIS_PORT: '6e3' }],
  ['another invalid Redis database', { REDIS_DB: '-1' }],
]) {
  test(`refuses ${label} before constructing or connecting a client`, async () => {
    let constructed = false;
    await assert.rejects(
      resetCiBrowserRateLimits({
        env: { ...env, ...patch },
        createClient: () => {
          constructed = true;
          throw new Error('must not construct');
        },
      }),
      /CI_BROWSER_RATE_LIMIT_RESET_/,
    );
    assert.equal(constructed, false);
  });
}

test('walks every cursor, bounds deletion batches and preserves non-rate data', async () => {
  const rateKeys = Array.from({ length: 207 }, (_, i) => `rl:throttler:default:budget-${i}`);
  const otherKeys = ['session:keep', 'otp:keep', 'outbox:keep'];
  const fixture = redisFixture({
    keys: [...rateKeys, ...otherKeys],
    pages: [
      ['17', [...rateKeys, otherKeys[0]]],
      ['0', [rateKeys[0], ...otherKeys.slice(1)]],
    ],
  });
  const removed = await resetCiBrowserRateLimits({ env, createClient: () => fixture.client });
  assert.equal(removed, 207);
  assert.deepEqual(
    fixture.calls.scan.map((args) => args[0]),
    ['0', '17'],
  );
  assert.ok(fixture.calls.scan.every((args) => args[1] === 'MATCH' && args[2] === 'rl:*'));
  assert.ok(fixture.calls.unlink.every((batch) => batch.length <= 200));
  assert.ok(fixture.calls.unlink.flat().every((key) => key.startsWith('rl:')));
  assert.deepEqual([...fixture.remaining], otherKeys);
  assert.equal(fixture.calls.quit, 1);
  assert.equal(fixture.calls.disconnect, 0);
});

test('an empty rate namespace does not issue an empty deletion', async () => {
  const fixture = redisFixture({ keys: ['session:keep'], pages: [['0', ['session:keep']]] });
  assert.equal(await resetCiBrowserRateLimits({ env, createClient: () => fixture.client }), 0);
  assert.deepEqual(fixture.calls.unlink, []);
  assert.deepEqual([...fixture.remaining], ['session:keep']);
  assert.equal(fixture.calls.quit, 1);
});

test('connects to the approved IPv6 loopback database with bounded commands', async () => {
  const fixture = redisFixture();
  let options;
  await resetCiBrowserRateLimits({
    env: { ...env, REDIS_HOST: '::1', REDIS_PORT: '16379', REDIS_DB: '2', NODE_ENV: 'test' },
    createClient: (value) => {
      options = value;
      return fixture.client;
    },
  });
  assert.equal(options.host, '::1');
  assert.equal(options.port, 16379);
  assert.equal(options.db, 2);
  assert.equal(options.lazyConnect, true);
  assert.equal(options.enableOfflineQueue, false);
  assert.equal(options.retryStrategy(), null);
  assert.ok(options.commandTimeout <= 3000);
  assert.equal(fixture.calls.connect, 1);
});

test('a dependency or client-construction failure never exposes its raw details', async () => {
  await assert.rejects(
    resetCiBrowserRateLimits({
      env,
      createClient: () => {
        throw new Error('redis://secret@host and private dependency path');
      },
    }),
    (error) => error.message === 'CI_BROWSER_RATE_LIMIT_RESET_FAILED',
  );
});

for (const failure of ['connect', 'scan', 'unlink', 'quit']) {
  test(`a ${failure} failure is sanitized and closes the client`, async () => {
    const fixture = redisFixture({ failure, keys: ['rl:test'], pages: [['0', ['rl:test']]] });
    await assert.rejects(
      resetCiBrowserRateLimits({ env, createClient: () => fixture.client }),
      (error) => error.message === 'CI_BROWSER_RATE_LIMIT_RESET_FAILED',
    );
    assert.equal(fixture.calls.quit, 1);
    assert.equal(fixture.calls.disconnect, Number(failure === 'connect' || failure === 'quit'));
  });
}
