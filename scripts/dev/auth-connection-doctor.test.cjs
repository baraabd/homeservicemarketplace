'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { runDoctor, loadWebEnvironment } = require('./auth-connection-doctor.cjs');

const PRIVATE = 'private_fixture_do_not_print';
const WEB_ORIGIN = 'http://localhost:5173';
const AUTH_PATH = '/v1/auth/config';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-auth-connection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'apps/web'), { recursive: true });
  await fs.writeFile(path.join(root, 'apps/web/package.json'), '{}');
  return root;
}

function cors(webOrigin = WEB_ORIGIN) {
  return {
    'access-control-allow-origin': webOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST',
    'access-control-allow-headers': 'X-Client-Kind',
  };
}

function json(data, headers = {}) {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function responses(
  configure = () => json({ otpChannel: 'whatsapp', whatsappAvailable: false }, cors()),
) {
  return async (url, options) => {
    if (new URL(url).pathname === '/health/ready') return json({ ready: true });
    if (options.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    return configure();
  };
}

async function inspect(root, options = {}) {
  const messages = [];
  const result = await runDoctor({
    root,
    environment: {},
    loadWebEnvironmentImpl: async () => ({ VITE_API_URL: 'http://localhost:4010' }),
    fetchImpl: responses(),
    ...options,
    log: (message) => messages.push(message),
  });
  const output = messages.join('\n');
  assert.ok(!output.includes(PRIVATE), 'logs must not expose private env or response values');
  assert.ok(!JSON.stringify(result).includes(PRIVATE), 'summary must contain only safe fields');
  return { ...result, output };
}

async function localServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('real local HTTP: readiness, public WhatsApp policy and credentialed OPTIONS 204', async (t) => {
  const root = await fixture(t);
  const calls = [];
  const origin = await localServer(t, (request, response) => {
    calls.push({ method: request.method, path: request.url, headers: request.headers });
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors());
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', ...cors() });
    response.end(
      JSON.stringify(
        request.url === '/health/ready'
          ? { ready: true, private: PRIVATE }
          : { otpChannel: 'whatsapp', whatsappAvailable: false, private: PRIVATE },
      ),
    );
  });
  const result = await inspect(root, {
    loadWebEnvironmentImpl: async () => ({ VITE_API_URL: origin }),
    fetchImpl: fetch,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.corsPassed, true);
  assert.equal(result.preflight.status, 204);
  assert.deepEqual(result.configuration.policy, {
    otpChannel: 'whatsapp',
    whatsappAvailable: false,
  });
  assert.match(result.output, /public policy is valid/u);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`).sort(), [
    'GET /health/ready',
    'GET /v1/auth/config',
    'OPTIONS /v1/auth/config',
  ]);
  for (const call of calls) {
    assert.equal(call.headers.cookie, undefined);
    assert.equal(call.headers.authorization, undefined);
  }
  const auth = calls.find((call) => call.method === 'GET' && call.path === AUTH_PATH);
  assert.equal(auth.headers.origin, WEB_ORIGIN);
  assert.equal(auth.headers['x-client-kind'], 'web');
  const preflight = calls.find((call) => call.method === 'OPTIONS');
  assert.equal(preflight.headers.origin, WEB_ORIGIN);
  assert.equal(preflight.headers['access-control-request-method'], 'GET');
  assert.equal(preflight.headers['access-control-request-headers'], 'x-client-kind');
});

test('real local redirects are reported by status and never followed', async (t) => {
  const root = await fixture(t);
  const calls = [];
  const origin = await localServer(t, (request, response) => {
    calls.push(request.url);
    if (request.method === 'OPTIONS') response.writeHead(204, cors()).end();
    else if (request.url === '/health/ready') response.end('{"ready":true}');
    else
      response
        .writeHead(302, { location: `/must-not-follow?token=${PRIVATE}`, ...cors() })
        .end(PRIVATE);
  });
  const result = await inspect(root, {
    loadWebEnvironmentImpl: async () => ({ VITE_API_URL: origin }),
    fetchImpl: fetch,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.configuration.issue, 'http');
  assert.equal(result.configuration.status, 302);
  assert.match(result.output, /redirects are not followed/u);
  assert.ok(calls.every((url) => !url.includes('must-not-follow')));
});

test('real stalled local responses stop at the diagnostic timeout', async (t) => {
  const root = await fixture(t);
  const origin = await localServer(t, () => {});
  const result = await inspect(root, {
    loadWebEnvironmentImpl: async () => ({ VITE_API_URL: origin }),
    fetchImpl: fetch,
    timeoutMs: 80,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.readiness.issue, 'timeout');
  assert.equal(result.configuration.issue, 'timeout');
  assert.equal(result.preflight.issue, 'timeout');
});

test('selected email is a valid server policy even when WhatsApp is unavailable', async (t) => {
  const result = await inspect(await fixture(t), {
    fetchImpl: responses(() => json({ otpChannel: 'email', whatsappAvailable: false }, cors())),
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /channel: email; no setting was changed/u);
});

test('HTTP, HTML, malformed JSON and incompatible policy remain distinct and redacted', async (t) => {
  const root = await fixture(t);
  for (const [issue, makeResponse] of [
    ['http', () => new Response(PRIVATE, { status: 503, headers: cors() })],
    [
      'html',
      () =>
        new Response(`<html>${PRIVATE}</html>`, {
          headers: { ...cors(), 'content-type': 'text/html' },
        }),
    ],
    ['html', () => new Response(`<!doctype html><html>${PRIVATE}</html>`, { headers: cors() })],
    ['malformed-json', () => new Response(`{${PRIVATE}`, { headers: cors() })],
    ['shape', () => json({ otpChannel: 'sms', whatsappAvailable: true, private: PRIVATE }, cors())],
    ['shape', () => json({ otpChannel: 'whatsapp', whatsappAvailable: 'true' }, cors())],
    ['shape', () => json(null, cors())],
  ]) {
    const result = await inspect(root, { fetchImpl: responses(makeResponse) });
    assert.equal(result.exitCode, 1);
    assert.equal(result.configuration.issue, issue);
  }
});

test('response size is bounded even without Content-Length', async (t) => {
  const root = await fixture(t);
  for (const headers of [cors(), { ...cors(), 'content-length': '17000' }]) {
    const result = await inspect(root, {
      fetchImpl: responses(() => new Response('x'.repeat(17000) + PRIVATE, { headers })),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.configuration.issue, 'too-large');
  }
});

test('network exceptions are sanitized and requests have no credentials or mutations', async (t) => {
  const result = await inspect(await fixture(t), {
    fetchImpl: async (url, options) => {
      assert.ok(['/health/ready', AUTH_PATH].includes(new URL(url).pathname));
      assert.ok(['GET', 'OPTIONS'].includes(options.method));
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.body, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      throw new Error(PRIVATE);
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.configuration.issue, 'network');
});

test('a ready HTTP connection is insufficient when readiness JSON is false or malformed', async (t) => {
  const root = await fixture(t);
  for (const [body, issue] of [
    [{ ready: false }, 'not-ready'],
    [{ private: PRIVATE }, 'shape'],
  ]) {
    const otherwise = responses();
    const result = await inspect(root, {
      fetchImpl: (url, options) =>
        new URL(url).pathname === '/health/ready' ? json(body) : otherwise(url, options),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.readiness.issue, issue);
    assert.equal(result.configuration.ok, true);
  }
});

test('credentialed CORS requires exact origin and credentials on GET and OPTIONS', async (t) => {
  const root = await fixture(t);
  for (const method of ['GET', 'OPTIONS']) {
    for (const [header, value] of [
      ['access-control-allow-origin', '*'],
      ['access-control-allow-origin', 'http://localhost:5174'],
      ['access-control-allow-credentials', 'false'],
    ]) {
      const otherwise = responses();
      const result = await inspect(root, {
        fetchImpl: (url, options) => {
          if (new URL(url).pathname !== AUTH_PATH || options.method !== method)
            return otherwise(url, options);
          const headers = { ...cors(), [header]: value };
          return method === 'OPTIONS'
            ? new Response(null, { status: 204, headers })
            : json({ otpChannel: 'whatsapp', whatsappAvailable: true }, headers);
        },
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.corsPassed, false);
      assert.match(result.output, /Check API FRONTEND_URL\/CORS_ORIGINS/u);
    }
  }
});

test('preflight must allow GET and X-Client-Kind; HTTP rejection is not parsed as JSON', async (t) => {
  const root = await fixture(t);
  for (const headers of [
    { ...cors(), 'access-control-allow-methods': 'POST' },
    { ...cors(), 'access-control-allow-headers': 'Content-Type' },
    { ...cors(), 'access-control-allow-headers': '*' },
  ]) {
    const otherwise = responses();
    const result = await inspect(root, {
      fetchImpl: (url, options) =>
        options.method === 'OPTIONS'
          ? new Response(null, { status: 204, headers })
          : otherwise(url, options),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.corsPassed, false);
  }
  const otherwise = responses();
  const rejected = await inspect(root, {
    fetchImpl: (url, options) =>
      options.method === 'OPTIONS'
        ? new Response(PRIVATE, { status: 403, headers: cors() })
        : otherwise(url, options),
  });
  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.preflight.issue, 'http');
  assert.equal(rejected.corsPassed, false);
});

test('same-origin requests do not require CORS or send an unnecessary preflight', async (t) => {
  let requests = 0;
  const result = await inspect(await fixture(t), {
    args: ['--web-origin', 'http://localhost:4010/'],
    fetchImpl: (url, options) => {
      requests += 1;
      assert.equal(options.method, 'GET');
      return json(
        new URL(url).pathname === AUTH_PATH
          ? { otpChannel: 'email', whatsappAvailable: false }
          : { ready: true },
      );
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(requests, 2);
  assert.equal(result.preflight, null);
});

test('help and invalid input cannot read env files or start network checks', async (t) => {
  const root = await fixture(t);
  for (const [args, code] of [
    [['--help'], 0],
    [['--unknown'], 1],
    [['--mode'], 1],
    [['--mode', '../private'], 1],
    [['--web-origin', `https://user:${PRIVATE}@example.test`], 1],
    [['--web-origin', `https://example.test/?token=${PRIVATE}`], 1],
    [['--web-origin', 'http://localhost:5173/login'], 1],
    [['--web-origin', 'http:localhost:5173'], 1],
  ]) {
    const result = await inspect(root, {
      args,
      loadWebEnvironmentImpl: () => assert.fail('env must not be loaded'),
      fetchImpl: () => assert.fail('network must not be used'),
    });
    assert.equal(result.exitCode, code);
    assert.equal(result.checked, false);
  }
});

test('explicit versus inferred origin and local port mismatch are reported without writes', async (t) => {
  const root = await fixture(t);
  const contents = `PORT=4010\nDATABASE_URL=${PRIVATE}\n`;
  await fs.writeFile(path.join(root, '.env'), contents);
  const inferred = await inspect(root, { loadWebEnvironmentImpl: async () => ({}) });
  assert.deepEqual(inferred.endpoint, {
    origin: 'http://localhost:4010',
    source: 'local-api-port',
  });
  const explicit = await inspect(root, {
    loadWebEnvironmentImpl: async () => ({ VITE_API_URL: 'http://localhost:4000' }),
  });
  assert.equal(explicit.endpoint.source, 'explicit');
  assert.match(explicit.output, /different port from local API PORT 4010/u);
  assert.equal(await fs.readFile(path.join(root, '.env'), 'utf8'), contents);
});

test('invalid API origins and loader errors stay redacted and prevent HTTP requests', async (t) => {
  const root = await fixture(t);
  for (const loader of [
    async () => ({ VITE_API_URL: `https://user:${PRIVATE}@example.test` }),
    async () => {
      throw new Error(PRIVATE);
    },
  ]) {
    const result = await inspect(root, {
      loadWebEnvironmentImpl: loader,
      fetchImpl: () => assert.fail('no network'),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.checked, false);
  }
});

test('installed Vite owns dotenv precedence and expansion without leaking or mutating env', async (t) => {
  const root = await fixture(t);
  const actualWebRequire = createRequire(path.resolve(__dirname, '../../apps/web/package.json'));
  const viteDirectory = path.dirname(actualWebRequire.resolve('vite/package.json'));
  const webRoot = path.join(root, 'apps/web');
  await fs.mkdir(path.join(webRoot, 'node_modules'), { recursive: true });
  await fs.symlink(
    viteDirectory,
    path.join(webRoot, 'node_modules/vite'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const environment = { ...process.env };
  for (const key of ['VITE_API_URL', 'VITE_USER_NODE_ENV', 'BROWSER', 'BROWSER_ARGS', 'API_ORIGIN'])
    delete environment[key];
  environment.DEBUG = 'vite:env';
  Object.freeze(environment);
  const parentBefore = { ...process.env };
  await fs.writeFile(
    path.join(webRoot, '.env'),
    `VITE_API_URL=http://localhost:4001\nPRIVATE_KEY=${PRIVATE}\nNODE_ENV=development\nBROWSER=${PRIVATE}\n`,
  );
  assert.deepEqual(await loadWebEnvironment(root, environment, 'development'), {
    VITE_API_URL: 'http://localhost:4001',
  });
  await fs.writeFile(path.join(webRoot, '.env.local'), 'VITE_API_URL=http://localhost:4002\n');
  await fs.writeFile(
    path.join(webRoot, '.env.development'),
    'VITE_API_URL=http://localhost:4003\n',
  );
  await fs.writeFile(
    path.join(webRoot, '.env.development.local'),
    'API_ORIGIN=http://localhost:4010\nVITE_API_URL=${API_ORIGIN}\n',
  );
  assert.deepEqual(await loadWebEnvironment(root, environment, 'development'), {
    VITE_API_URL: 'http://localhost:4010',
  });
  assert.deepEqual(
    await loadWebEnvironment(
      root,
      { ...environment, VITE_API_URL: 'http://localhost:4020' },
      'development',
    ),
    { VITE_API_URL: 'http://localhost:4020' },
  );
  await fs.writeFile(path.join(webRoot, '.env.review'), 'VITE_API_URL=http://localhost:4030\n');
  assert.deepEqual(await loadWebEnvironment(root, environment, 'review'), {
    VITE_API_URL: 'http://localhost:4030',
  });
  assert.ok(
    Object.keys(process.env).length === Object.keys(parentBefore).length &&
      Object.entries(parentBefore).every(([key, value]) => process.env[key] === value),
    'Vite loading must preserve the calling environment; do not dump its values on failure',
  );
});
