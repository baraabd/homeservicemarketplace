'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { runDoctor } = require('./whatsapp-doctor.cjs');

const PRIVATE = 'private_fixture_never_log_this';
const GREEN = Object.freeze({
  WHATSAPP_PROVIDER: 'greenapi',
  GREEN_API_URL: 'https://7107.api.greenapi.com',
  GREEN_API_ID_INSTANCE: '1234567890',
  GREEN_API_TOKEN: PRIVATE,
});
const META = Object.freeze({
  WHATSAPP_ACCESS_TOKEN: PRIVATE,
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_GRAPH_API_VERSION: 'v27.0',
  WHATSAPP_AUTH_TEMPLATE_NAME: 'account_code',
  WHATSAPP_AUTH_TEMPLATE_LANGUAGE: 'ar',
  WHATSAPP_AUTH_TEMPLATE_APPROVED: 'true',
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-whatsapp-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function write(root, file, values) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n'),
  );
}

async function inspect(root, options = {}) {
  const messages = [];
  const result = await runDoctor({
    root,
    environment: {},
    fetchImpl: () => assert.fail('unexpected network request'),
    ...options,
    log: (message) => messages.push(message),
  });
  const output = messages.join('\n');
  assert.ok(
    !output.includes(PRIVATE),
    'diagnostics must not expose credentials or provider error text',
  );
  assert.ok(
    !JSON.stringify(result).includes(PRIVATE),
    'returned summary must not contain private values',
  );
  return { ...result, output };
}

test('missing Meta fields are named without networking or changing files', async (t) => {
  const root = await fixture(t);
  await write(root, '.env', { DATABASE_URL: PRIVATE });
  const before = await fs.readFile(path.join(root, '.env'), 'utf8');
  const result = await inspect(root);
  assert.equal(result.exitCode, 1);
  assert.equal(result.connectionChecked, false);
  assert.match(result.output, /WHATSAPP_ACCESS_TOKEN is missing/u);
  assert.match(result.output, /WHATSAPP_AUTH_TEMPLATE_APPROVED is missing/u);
  assert.equal(await fs.readFile(path.join(root, '.env'), 'utf8'), before);
});

test('complete Green API settings are only a local check by default', async (t) => {
  const root = await fixture(t);
  const result = await inspect(root, { environment: GREEN });
  assert.equal(result.exitCode, 0);
  assert.equal(result.configured, true);
  assert.equal(result.connectionChecked, false);
  assert.match(result.output, /does not verify credentials/u);
});

test('API env precedence matches Nest and preserves process and local files', async (t) => {
  const root = await fixture(t);
  await write(root, '.env', GREEN);
  assert.equal((await inspect(root)).exitCode, 0);
  await write(root, '.env.local', { GREEN_API_TOKEN: '' });
  assert.equal((await inspect(root)).exitCode, 1);
  await write(root, 'apps/api/.env', { GREEN_API_TOKEN: PRIVATE });
  assert.equal((await inspect(root)).exitCode, 0);
  await write(root, 'apps/api/.env.local', { GREEN_API_TOKEN: '' });
  assert.equal((await inspect(root)).exitCode, 1);
  const environment = Object.freeze({ GREEN_API_TOKEN: ` ${PRIVATE} ` });
  assert.equal((await inspect(root, { environment })).exitCode, 0);
  assert.equal(environment.GREEN_API_TOKEN, ` ${PRIVATE} `);
  assert.equal(
    await fs.readFile(path.join(root, 'apps/api/.env.local'), 'utf8'),
    'GREEN_API_TOKEN=',
  );
});

test('browser environment files cannot configure the OTP provider', async (t) => {
  const root = await fixture(t);
  await write(root, 'apps/web/.env.local', GREEN);
  assert.equal((await inspect(root)).exitCode, 1);
});

test('Meta remains the transport default and requires actual approval configuration', async (t) => {
  const root = await fixture(t);
  const ready = await inspect(root, { environment: META });
  assert.equal(ready.exitCode, 0);
  assert.equal(ready.provider, 'meta');
  assert.equal(
    (await inspect(root, { environment: { ...META, WHATSAPP_AUTH_TEMPLATE_APPROVED: 'false' } }))
      .exitCode,
    1,
  );
  const live = await inspect(root, { environment: META, args: ['--check-connection'] });
  assert.equal(live.exitCode, 1);
  assert.equal(live.connectionChecked, false);
});

test('populated inactive-provider values are validated and blank optional values are ignored', async (t) => {
  const root = await fixture(t);
  assert.equal(
    (await inspect(root, { environment: { ...GREEN, WHATSAPP_PHONE_NUMBER_ID: PRIVATE } }))
      .exitCode,
    1,
  );
  assert.equal(
    (
      await inspect(root, {
        environment: { ...META, GREEN_API_URL: `https://example.test/${PRIVATE}` },
      })
    ).exitCode,
    1,
  );
  assert.equal(
    (
      await inspect(root, {
        environment: {
          ...GREEN,
          WHATSAPP_PHONE_NUMBER_ID: '  ',
          WHATSAPP_AUTH_TEMPLATE_APPROVED: 'false',
        },
      })
    ).exitCode,
    0,
  );
  assert.equal(
    (
      await inspect(root, {
        environment: { ...META, WHATSAPP_PHONE_NUMBER_ID: ' 1234567890 ', GREEN_API_URL: '' },
      })
    ).exitCode,
    0,
  );
});

test('unsafe Green API origins fail before any authenticated request and stay redacted', async (t) => {
  const root = await fixture(t);
  for (const url of [
    'http://7107.api.greenapi.com',
    'https://api.greenapi.com.attacker.test',
    'https://arbitrary.example.test',
    'https://localhost',
    `https://user:${PRIVATE}@7107.api.greenapi.com`,
    `https://7107.api.greenapi.com/path/${PRIVATE}`,
    `https://7107.api.greenapi.com/?token=${PRIVATE}`,
    `https://7107.api.greenapi.com/#${PRIVATE}`,
    'https://7107.api.greenapi.com:8443',
  ]) {
    const result = await inspect(root, {
      environment: { ...GREEN, GREEN_API_URL: url },
      args: ['--check-connection'],
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.connectionChecked, false);
    assert.match(result.output, /GREEN_API_URL has an invalid value/u);
  }
});

test('explicit connection check is one GET with redirects refused, timeout and no message body', async (t) => {
  const root = await fixture(t);
  let requests = 0;
  const result = await inspect(root, {
    environment: GREEN,
    args: ['--check-connection'],
    fetchImpl: async (url, options) => {
      requests += 1;
      assert.equal(
        url,
        `${GREEN.GREEN_API_URL}/waInstance${GREEN.GREEN_API_ID_INSTANCE}/getStateInstance/${PRIVATE}`,
      );
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.body, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => ({ stateInstance: 'authorized' }) };
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.exitCode, 0);
  assert.equal(result.connectionChecked, true);
  assert.match(result.output, /No message was sent/u);
});

test('unauthorized and unexpected provider states never imply OTP delivery', async (t) => {
  const root = await fixture(t);
  for (const stateInstance of [
    'notAuthorized',
    'blocked',
    'starting',
    'suspended',
    PRIVATE,
    null,
  ]) {
    const result = await inspect(root, {
      environment: GREEN,
      args: ['--check-connection'],
      fetchImpl: async () => ({ ok: true, json: async () => ({ stateInstance }) }),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.connectionChecked, true);
    assert.ok(!result.output.includes('instance is authorized'));
  }
});

test('HTTP error bodies and network exception messages are never displayed', async (t) => {
  const root = await fixture(t);
  for (const fetchImpl of [
    async () => ({
      ok: false,
      status: 401,
      text: () => assert.fail('must not read provider body'),
      json: () => assert.fail('must not read provider body'),
    }),
    async () => {
      throw new Error(PRIVATE);
    },
    async () => ({
      ok: true,
      json: async () => {
        throw new Error(PRIVATE);
      },
    }),
    async () => {
      throw new DOMException(PRIVATE, 'TimeoutError');
    },
  ]) {
    const result = await inspect(root, {
      environment: GREEN,
      args: ['--check-connection'],
      fetchImpl,
    });
    assert.equal(result.exitCode, 1);
  }
});

test('missing or invalid credentials and timeout cannot trigger a state check', async (t) => {
  const root = await fixture(t);
  for (const change of [
    { WHATSAPP_PROVIDER: PRIVATE },
    { GREEN_API_ID_INSTANCE: '123' },
    { GREEN_API_TOKEN: '' },
    { GREEN_API_TOKEN: `${PRIVATE}/other` },
    { GREEN_API_AUTH_TEMPLATE_ID: `${PRIVATE}?other` },
    { WHATSAPP_REQUEST_TIMEOUT_MS: '0' },
    { WHATSAPP_REQUEST_TIMEOUT_MS: '30001' },
  ]) {
    const result = await inspect(root, {
      environment: { ...GREEN, ...change },
      args: ['--check-connection'],
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.connectionChecked, false);
  }
});

test('help and unknown options do not open local environment files', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, '.env'));
  assert.equal((await inspect(root, { args: ['--help'] })).exitCode, 0);
  assert.equal((await inspect(root, { args: ['--send'] })).exitCode, 1);
  const failed = await inspect(root);
  assert.equal(failed.exitCode, 1);
  assert.match(failed.output, /environment file could not be read/u);
});
