import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hostedBuildConfig,
  hostedBuildError,
  publicBuildIdentity,
  runHostedBuild,
} from './vercel-hosted-build.mjs';

const sha = 'a'.repeat(40);
function fixture(target = 'staging') {
  const staging = target === 'staging';
  return {
    DEPLOY_TARGET: target,
    VERCEL_ENV: staging ? 'preview' : 'production',
    VERCEL_GIT_COMMIT_REF: staging ? 'develop' : 'main',
    VERCEL_GIT_COMMIT_SHA: sha,
    HSM_WEB_ORIGIN: staging ? 'https://app.staging.example.sa' : 'https://example.sa',
    HSM_API_ORIGIN: staging ? 'https://api.staging.example.sa' : 'https://api.example.sa',
    HSM_COOKIE_DOMAIN: staging ? '.staging.example.sa' : '.example.sa',
    VITE_API_URL: staging ? 'https://api.staging.example.sa' : 'https://api.example.sa',
    VITE_PROVIDER_ONBOARDING_V2: 'true',
    VITE_REALTIME_SOCKET_IO: 'true',
    VITE_REALTIME_TRANSPORTS: 'websocket',
    VITE_STRIPE_SANDBOX_ENABLED: 'false',
  };
}

test('both release environments produce only the allowlisted public identity', () => {
  for (const target of ['staging', 'production']) {
    const config = hostedBuildConfig(
      { ...fixture(target), DEPLOY_SHA: sha, DATABASE_PASSWORD: 'never-publish' },
      sha,
    );
    assert.deepEqual(publicBuildIdentity(config), {
      schemaVersion: 1,
      sourceSha: sha,
      target,
      webOrigin: fixture(target).HSM_WEB_ORIGIN,
      apiOrigin: fixture(target).HSM_API_ORIGIN,
      authCookiePrefix: 'hsm',
    });
  }
});

test('rejects source/target/branch/API drift and credentials in browser variables', () => {
  for (const change of [
    { DEPLOY_SHA: 'b'.repeat(40) },
    { VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40) },
    { DEPLOY_TARGET: 'production' },
    { VERCEL_ENV: 'production' },
    { VERCEL_GIT_COMMIT_REF: 'feature/unreviewed' },
    { DEPLOY_BRANCH: 'main' },
    { VITE_API_URL: 'https://api.example.sa' },
    { HSM_COOKIE_DOMAIN: '.example.com' },
    { VITE_REALTIME_TRANSPORTS: 'polling' },
    { VITE_PROVIDER_ONBOARDING_V2: '' },
    { VITE_REDIS_PASSWORD: 'private' },
    { VITE_AUTH_COOKIE_PREFIX: '' },
    { VITE_AUTH_COOKIE_PREFIX: 'hsm;other' },
    { VITE_AUTH_COOKIE_PREFIX: 'hsm\n' },
  ])
    assert.throws(() => hostedBuildConfig({ ...fixture(), ...change }, sha));
});

test('requires independent source identity when checkout metadata is unavailable', () => {
  assert.equal(hostedBuildConfig(fixture()).sourceSha, sha);
  assert.throws(() =>
    hostedBuildConfig({ ...fixture(), VERCEL_GIT_COMMIT_SHA: '', DEPLOY_SHA: sha }),
  );
});

test('prebuilt CI source is accepted without Vercel Git metadata', () => {
  const env = { ...fixture(), DEPLOY_SHA: sha, DEPLOY_BRANCH: 'develop' };
  delete env.VERCEL_GIT_COMMIT_SHA;
  delete env.VERCEL_GIT_COMMIT_REF;
  assert.equal(hostedBuildConfig(env, sha).sourceSha, sha);
});

function buildFixture(overrides = {}) {
  const events = [];
  const effects = {
    checkToolchain: async () => [],
    readCheckoutSha: () => sha,
    checkApi: async (config) => {
      events.push(['probe', config.sourceSha]);
    },
    stamp: async (config) => {
      events.push(['stamp', publicBuildIdentity(config)]);
    },
    build: async (env) => {
      events.push(['build', env]);
      return { status: 0 };
    },
    ...overrides,
  };
  return { events, effects };
}

test('successful build validates the matching API before writing and after compiling', async () => {
  const { events, effects } = buildFixture();
  const env = fixture();
  const config = await runHostedBuild(env, effects);
  assert.deepEqual(events, [
    ['probe', sha],
    ['stamp', publicBuildIdentity(config)],
    ['build', env],
    ['probe', sha],
  ]);
});

test('failed initial API check never writes release identity or starts compilation', async () => {
  const { events, effects } = buildFixture({
    checkApi: async () => {
      throw new Error('API dependencies are not ready');
    },
  });
  await assert.rejects(runHostedBuild(fixture(), effects), /API dependencies are not ready/u);
  assert.deepEqual(events, []);
});

test('invalid source or runtime never starts the API checks or writes an artifact', async () => {
  for (const change of [
    { checkToolchain: async () => ['Node pin mismatch'] },
    { readCheckoutSha: () => 'b'.repeat(40) },
  ]) {
    const { events, effects } = buildFixture(change);
    await assert.rejects(runHostedBuild(fixture(), effects));
    assert.deepEqual(events, []);
  }
});

for (const [label, result] of [
  ['nonzero exit', { status: 1 }],
  ['signal', { status: null, signal: 'SIGTERM' }],
  ['spawn error', { error: new Error('private-process-path') }],
]) {
  test(`failed compilation cannot reach the final API check: ${label}`, async () => {
    const { events, effects } = buildFixture({ build: async () => result });
    await assert.rejects(runHostedBuild(fixture(), effects), /Web production build failed/u);
    assert.deepEqual(
      events.map(([event]) => event),
      ['probe', 'stamp'],
    );
  });
}

test('failed identity write stops compilation and the final API check', async () => {
  const { events, effects } = buildFixture({
    stamp: async () => {
      throw new Error('EACCES: private-path');
    },
  });
  await assert.rejects(runHostedBuild(fixture(), effects), /EACCES/u);
  assert.deepEqual(events, [['probe', sha]]);
});

test('API drift after successful compilation still rejects the release', async () => {
  let probes = 0;
  const { events, effects } = buildFixture({
    checkApi: async () => {
      probes += 1;
      if (probes === 2) throw new Error('API is not serving the exact release source SHA');
    },
  });
  await assert.rejects(runHostedBuild(fixture(), effects), /exact release source SHA/u);
  assert.equal(probes, 2);
  assert.deepEqual(
    events.map(([event]) => event),
    ['stamp', 'build'],
  );
});

test('unexpected errors cannot print raw credentials or filesystem inputs', () => {
  for (const error of [
    new Error('EACCES: /private-path/secret-value'),
    new Error('token=private-secret-value'),
    new Error('API dependencies are not ready: private-secret-value'),
    'private-secret-value',
    null,
  ]) {
    assert.equal(
      hostedBuildError(error),
      'Hosted web build failed; check the runtime, source, environment bindings and API readiness',
    );
  }
  for (const message of [
    'VITE_API_URL does not match HSM_API_ORIGIN',
    'API dependencies are not ready',
    'Web production build failed',
  ]) {
    assert.equal(hostedBuildError(new Error(message)), message);
  }
});
