'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { apiPort, apiOrigin, webApiEndpoint } = require('./api-endpoint.cjs');

const PRIVATE = 'private-fixture-must-not-reach-the-browser';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-api-origin-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function write(root, file, contents) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

const local = (root, extra = {}) =>
  webApiEndpoint({ root, command: 'serve', mode: 'development', apiEnvironment: {}, ...extra });

test('an unconfigured local checkout uses the existing API port 4000', async (t) => {
  const root = await fixture(t);
  assert.equal(await apiPort(root, {}), 4000);
  assert.deepEqual(await local(root), {
    origin: 'http://localhost:4000',
    source: 'local-api-port',
  });
});

test('API env file precedence and the process override are identical for preflight and Vite', async (t) => {
  const root = await fixture(t);
  for (const [file, port] of [
    ['.env', 4020],
    ['.env.local', 4030],
    ['apps/api/.env', 4040],
    ['apps/api/.env.local', 4050],
  ]) {
    await write(root, file, `PORT=${port}\nDATABASE_URL=${PRIVATE}\n`);
    assert.equal(await apiPort(root, {}), port);
    assert.equal((await local(root)).origin, `http://localhost:${port}`);
  }
  assert.equal(await apiPort(root, { PORT: '4060' }), 4060);
  assert.equal(
    (await local(root, { apiEnvironment: { PORT: '4060' } })).origin,
    'http://localhost:4060',
  );
});

test('a blank browser API URL follows a custom API port without copying private configuration', async (t) => {
  const root = await fixture(t);
  const contents = `PORT=4010\r\nDATABASE_URL=${PRIVATE}\r\nJWT_ACCESS_SECRET=${PRIVATE}\r\n`;
  await write(root, 'apps/api/.env.local', contents);
  const webEnvironment = Object.freeze({ VITE_API_URL: '   ', PORT: '9999' });
  const apiEnvironment = Object.freeze({});
  const endpoint = await local(root, { webEnvironment, apiEnvironment });
  assert.deepEqual(endpoint, { origin: 'http://localhost:4010', source: 'local-api-port' });
  assert.ok(!JSON.stringify(endpoint).includes(PRIVATE));
  assert.equal(await fs.readFile(path.join(root, 'apps/api/.env.local'), 'utf8'), contents);
  assert.deepEqual(webEnvironment, { VITE_API_URL: '   ', PORT: '9999' });
  assert.deepEqual(apiEnvironment, {});
});

test('an explicit API origin wins without opening backend env files or requiring a valid local PORT', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, '.env'));
  for (const configured of ['http://localhost:4999', 'https://api.example.test']) {
    assert.deepEqual(
      await local(root, {
        webEnvironment: { VITE_API_URL: ` ${configured}/ ` },
        apiEnvironment: { PORT: PRIVATE },
      }),
      { origin: configured, source: 'explicit' },
    );
  }
});

test('a PORT in the web env alone cannot impersonate the backend port', async (t) => {
  const root = await fixture(t);
  await write(root, 'apps/web/.env.local', 'PORT=4999\n');
  assert.equal(
    (await local(root, { webEnvironment: { PORT: '4999' } })).origin,
    'http://localhost:4000',
  );
});

test('invalid browser origins fail at dev startup and production build without echoing their value', async (t) => {
  const root = await fixture(t);
  for (const value of [
    '/v1',
    'localhost:4000',
    'http:localhost:4000',
    'ftp://localhost:4000',
    'https://api.example.test/v1',
    `https://api.example.test/?token=${PRIVATE}`,
    `https://api.example.test/#${PRIVATE}`,
    `https://user:${PRIVATE}@api.example.test`,
  ]) {
    for (const command of ['serve', 'build']) {
      await assert.rejects(
        local(root, { command, mode: 'production', webEnvironment: { VITE_API_URL: value } }),
        (error) => {
          assert.match(error.message, /VITE_API_URL must be an absolute http\(s\) API origin/u);
          assert.ok(!error.message.includes(PRIVATE));
          assert.ok(!error.message.includes(value));
          return true;
        },
      );
    }
  }
});

test('valid HTTP and HTTPS origins include loopback IPv6 and canonical trailing-slash handling', () => {
  assert.equal(apiOrigin('http://[::1]:4010/'), 'http://[::1]:4010');
  assert.equal(apiOrigin('https://API.EXAMPLE.TEST/'), 'https://api.example.test');
});

test('invalid API port is diagnosed without exposing other env content', async (t) => {
  const root = await fixture(t);
  await write(root, '.env', `PORT=${PRIVATE}\nDATABASE_URL=${PRIVATE}\n`);
  await assert.rejects(local(root), { message: 'API PORT must be an integer between 1 and 65535' });
  for (const PORT of ['0', '-1', '65536', '4010.5', '', PRIVATE]) {
    await assert.rejects(local(root, { apiEnvironment: { PORT } }), {
      message: 'API PORT must be an integer between 1 and 65535',
    });
  }
});

test('a production artifact cannot infer a local API or accept a missing public origin', async (t) => {
  const root = await fixture(t);
  await write(root, 'apps/api/.env', 'PORT=4010\n');
  for (const VITE_API_URL of [undefined, '', '   ']) {
    await assert.rejects(
      local(root, { command: 'build', mode: 'production', webEnvironment: { VITE_API_URL } }),
      /Missing required env var VITE_API_URL for production build/u,
    );
  }
});

test('preview, tests and other builds never read private API files or rewrite a built artifact', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, '.env'));
  for (const options of [
    { mode: 'test' },
    { isPreview: true },
    { command: 'build', mode: 'staging' },
  ]) {
    assert.deepEqual(await local(root, options), { origin: undefined, source: 'unset' });
  }
});
