import test from 'node:test';
import assert from 'node:assert/strict';
import {
  releaseConfig,
  validatePulledSettings,
  validateDomainBinding,
  probeDomainBinding,
  deploymentOrigin,
  probeApi,
  probeWeb,
} from './vercel-release.mjs';

const env = {
  DEPLOY_SHA: 'a'.repeat(40),
  DEPLOY_TARGET: 'staging',
  HSM_WEB_ORIGIN: 'https://app.staging.example.sa',
  HSM_API_ORIGIN: 'https://api.staging.example.sa',
  HSM_COOKIE_DOMAIN: '.staging.example.sa',
  VERCEL_PROJECT_ID: 'prj_fixture',
  VERCEL_ORG_ID: 'team_fixture',
};
const config = releaseConfig(env);
const project = {
  projectId: env.VERCEL_PROJECT_ID,
  orgId: env.VERCEL_ORG_ID,
  settings: { rootDirectory: 'apps/web', framework: 'vite' },
};
const pulled = {
  VITE_API_URL: config.apiOrigin,
  VITE_PROVIDER_ONBOARDING_V2: 'false',
  VITE_REALTIME_SOCKET_IO: 'true',
  VITE_REALTIME_TRANSPORTS: 'websocket',
  VITE_STRIPE_SANDBOX_ENABLED: 'false',
};

test('accepts explicit sibling domains and the exact linked project', () => {
  assert.deepEqual(validatePulledSettings(project, pulled, env), config);
});

for (const value of [
  'http://api.staging.example.sa',
  'https://api.staging.example.sa/',
  'https://api.staging.example.sa/v1',
  'https://user:password@api.staging.example.sa',
  'https://api.staging.example.sa?token=secret',
  'https://api.staging.example.sa#test',
  'https://127.0.0.1',
  'https://localhost',
]) {
  test('rejects unsafe API origin ' + value.split('@').at(-1), () => {
    assert.throws(() => releaseConfig({ ...env, HSM_API_ORIGIN: value }));
  });
}

test('rejects raw vercel.app and railway.app cross-site authentication', () => {
  assert.throws(() => releaseConfig({ ...env, HSM_WEB_ORIGIN: 'https://hsm.vercel.app' }));
  assert.throws(() =>
    releaseConfig({
      ...env,
      HSM_WEB_ORIGIN: 'https://web.vercel.app',
      HSM_API_ORIGIN: 'https://api.vercel.app',
      HSM_COOKIE_DOMAIN: '.vercel.app',
    }),
  );
});

test('does not accept a domain suffix without a label boundary', () => {
  assert.throws(() =>
    releaseConfig({
      ...env,
      HSM_WEB_ORIGIN: 'https://notstaging.example.sa',
    }),
  );
});

for (const suffix of ['com.sa', 'co.uk', 'vercel.app', 'up.railway.app']) {
  test('rejects a public suffix as the cookie parent: ' + suffix, () => {
    assert.throws(
      () =>
        releaseConfig({
          ...env,
          HSM_WEB_ORIGIN: 'https://web.' + suffix,
          HSM_API_ORIGIN: 'https://api.' + suffix,
          HSM_COOKIE_DOMAIN: '.' + suffix,
        }),
      /HSM_COOKIE_DOMAIN/u,
    );
  });
}

test('rejects wrong project, wrong root, missing flag and drifted API build input', () => {
  assert.throws(() => validatePulledSettings({ ...project, projectId: 'another' }, pulled, env));
  assert.throws(() =>
    validatePulledSettings({ ...project, settings: { rootDirectory: '.' } }, pulled, env),
  );
  assert.throws(() =>
    validatePulledSettings(project, { ...pulled, VITE_PROVIDER_ONBOARDING_V2: '' }, env),
  );
  assert.throws(() =>
    validatePulledSettings(project, { ...pulled, VITE_API_URL: 'https://api.other.sa' }, env),
  );
  assert.throws(() =>
    validatePulledSettings(
      project,
      { ...pulled, VITE_REALTIME_TRANSPORTS: 'polling,websocket' },
      env,
    ),
  );
});

test('reuses CSP validation and rejects browser-prefixed server secrets', () => {
  assert.throws(() =>
    validatePulledSettings(
      project,
      { ...pulled, VITE_CSP_UPLOAD_ORIGINS: 'https://*.example.sa' },
      env,
    ),
  );
  assert.throws(() =>
    validatePulledSettings(project, { ...pulled, VITE_DATABASE_URL: 'secret' }, env),
  );
});

test('only captures one exact HTTPS Vercel deployment origin', () => {
  assert.equal(
    deploymentOrigin('https://hsm-abc-team.vercel.app\n'),
    'https://hsm-abc-team.vercel.app',
  );
  for (const input of [
    'https://evil.example.sa',
    'https://x.vercel.app/path',
    'https://x.vercel.app\nurl=spoof',
    'https://user:secret@x.vercel.app',
  ]) {
    assert.throws(() => deploymentOrigin(input));
  }
});

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const domain = {
  name: new URL(config.webOrigin).hostname,
  projectId: env.VERCEL_PROJECT_ID,
  verified: true,
  gitBranch: 'develop',
};

test('checks the exact Vercel project domain over a non-redirecting read', async () => {
  await probeDomainBinding(
    config,
    { ...env, VERCEL_TOKEN: 'fixture-token' },
    async (url, options) => {
      assert.equal(new URL(url).hostname, 'api.vercel.com');
      assert.ok(new URL(url).pathname.endsWith('/domains/' + domain.name));
      assert.equal(new URL(url).searchParams.get('teamId'), env.VERCEL_ORG_ID);
      assert.equal(options.redirect, 'error');
      return json(domain);
    },
  );
});

test('domain check distinguishes preview branch binding from production', () => {
  assert.doesNotThrow(() => validateDomainBinding(domain, config, env.VERCEL_PROJECT_ID));
  assert.throws(() =>
    validateDomainBinding({ ...domain, gitBranch: null }, config, env.VERCEL_PROJECT_ID),
  );
  assert.throws(() =>
    validateDomainBinding(domain, { ...config, target: 'production' }, env.VERCEL_PROJECT_ID),
  );
  assert.doesNotThrow(() =>
    validateDomainBinding(
      { ...domain, gitBranch: null },
      { ...config, target: 'production' },
      env.VERCEL_PROJECT_ID,
    ),
  );
});

test('domain check rejects unverified, redirecting, foreign and custom-environment targets', () => {
  for (const change of [
    { verified: false },
    { projectId: 'prj_other' },
    { name: 'other.example.sa' },
    { redirect: 'other.example.sa' },
    { customEnvironmentId: 'env_other' },
  ]) {
    assert.throws(() =>
      validateDomainBinding({ ...domain, ...change }, config, env.VERCEL_PROJECT_ID),
    );
  }
});
const cors = {
  'access-control-allow-origin': config.webOrigin,
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'Content-Type, X-CSRF-Token, X-Client-Kind',
  'access-control-allow-methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
};
function apiReplies(overrides = {}) {
  return {
    '/health/live': () => json({ status: 'ok', sourceSha: config.sourceSha }),
    '/health/ready': () =>
      json({
        ready: true,
        dependencies: [
          { name: 'postgres', status: 'up' },
          { name: 'redis', status: 'up' },
        ],
      }),
    '/v1/auth/me': () => json({ statusCode: 401 }, 401, cors),
    '/v1/auth/refresh': () => new Response(null, { status: 204, headers: cors }),
    ...overrides,
  };
}
function apiFetch(replies, calls = []) {
  return async (url, options) => {
    assert.equal(new URL(url).origin, config.apiOrigin);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    calls.push({ url, options });
    return replies[new URL(url).pathname]();
  };
}

test('API smoke uses read-only probes and verifies real source/dependency/CORS contracts', async () => {
  const calls = [];
  await probeApi(config, apiFetch(apiReplies(), calls));
  assert.deepEqual(
    calls.map(({ options }) => options.method ?? 'GET'),
    ['GET', 'GET', 'GET', 'OPTIONS'],
  );
  assert.ok(
    calls.every(({ options }) => !options.headers?.Authorization && !options.headers?.Cookie),
  );
});

for (const [description, route, replacement] of [
  ['wrong source', '/health/live', () => json({ status: 'ok', sourceSha: 'b'.repeat(40) })],
  [
    'SPA fallback',
    '/health/ready',
    () => new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } }),
  ],
  ['false readiness', '/health/ready', () => json({ ready: false, dependencies: [] })],
  [
    'missing Redis',
    '/health/ready',
    () => json({ ready: true, dependencies: [{ name: 'postgres', status: 'up' }] }),
  ],
  [
    'down dependency',
    '/health/ready',
    () =>
      json({
        ready: true,
        dependencies: [
          { name: 'postgres', status: 'up' },
          { name: 'redis', status: 'down' },
        ],
      }),
  ],
  ['anonymous access', '/v1/auth/me', () => json({ user: {} }, 200, cors)],
  [
    'CORS wildcard',
    '/v1/auth/me',
    () => json({}, 401, { ...cors, 'access-control-allow-origin': '*' }),
  ],
  [
    'blocked CSRF header',
    '/v1/auth/refresh',
    () =>
      new Response(null, {
        status: 204,
        headers: { ...cors, 'access-control-allow-headers': 'content-type' },
      }),
  ],
]) {
  test('API smoke fails closed for ' + description, async () => {
    await assert.rejects(probeApi(config, apiFetch(apiReplies({ [route]: replacement }))));
  });
}

test('transport errors do not expose connection details or secrets', async () => {
  await assert.rejects(
    probeApi(config, async () => {
      throw new Error('secret-password-and-internal-host');
    }),
    (error) => !error.message.includes('secret-password'),
  );
});

const html =
  '<html><head><meta http-equiv="Content-Security-Policy" content="default-src self"><script type="module" src="/assets/main.js"></script></head><body><div id="root"></div></body></html>';
function webFetch(identity = config, body = html, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    return new URL(url).pathname === '/deployment.json'
      ? json(identity)
      : new Response(body, { headers: { 'content-type': 'text/html' } });
  };
}
test('web smoke verifies identity, CSP and all three application deep links', async () => {
  const calls = [];
  await probeWeb(
    config,
    'https://hsm-abc-team.vercel.app',
    'fixture-bypass',
    webFetch(config, html, calls),
  );
  assert.deepEqual(
    calls.map(({ url }) => new URL(url).pathname),
    ['/deployment.json', '/', '/login', '/provider', '/admin'],
  );
  assert.ok(
    calls.every(
      ({ options }) => options.headers['x-vercel-protection-bypass'] === 'fixture-bypass',
    ),
  );
});

test('web smoke rejects stale identity, missing CSP and unexpected bypass destinations', async () => {
  await assert.rejects(
    probeWeb(config, config.webOrigin, '', webFetch({ ...config, sourceSha: 'b'.repeat(40) })),
  );
  await assert.rejects(
    probeWeb(config, config.webOrigin, '', webFetch(config, '<div id="root"></div>')),
  );
  let called = false;
  await assert.rejects(
    probeWeb(config, 'https://external.example.sa', 'secret', async () => {
      called = true;
    }),
  );
  assert.equal(called, false);
});
