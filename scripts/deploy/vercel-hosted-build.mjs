import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { probeApi, releaseConfig } from './vercel-release.mjs';

const require = createRequire(import.meta.url);
const { buildWebCsp } = require('../production/security-app/web-csp.cjs');
const { NODE_VERSION, toolchainProblems } = require('../runtime/toolchain.cjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = /^[a-f0-9]{40}$/u;

// Direct Vercel builds need the same source/API boundary and public identity
// as the prebuilt CD lane. Neither the project name nor VERCEL_ENV identifies
// our application's environment: a staging project also has a Production tab.
export function hostedBuildConfig(env, checkoutSha) {
  const sourceSha = checkoutSha || env.VERCEL_GIT_COMMIT_SHA;
  if (!SHA.test(sourceSha ?? '')) throw new Error('A full checked-out source SHA is required');
  for (const key of ['DEPLOY_SHA', 'VERCEL_GIT_COMMIT_SHA']) {
    if (env[key] && env[key] !== sourceSha) throw new Error(`${key} differs from the build source`);
  }
  const branch = env.DEPLOY_BRANCH || env.VERCEL_GIT_COMMIT_REF;
  const expectedBranch = { staging: 'develop', production: 'main' }[env.DEPLOY_TARGET];
  if (!expectedBranch || branch !== expectedBranch) {
    throw new Error('The application target must match its release branch');
  }
  if (env.VERCEL_GIT_COMMIT_REF && env.VERCEL_GIT_COMMIT_REF !== branch) {
    throw new Error('Vercel branch differs from the selected release branch');
  }
  const expectedVercelTarget = env.DEPLOY_TARGET === 'production' ? 'production' : 'preview';
  if (env.VERCEL_ENV && env.VERCEL_ENV !== expectedVercelTarget) {
    throw new Error('Vercel target does not match the selected application environment');
  }
  const config = releaseConfig({ ...env, DEPLOY_SHA: sourceSha });
  if (env.VITE_API_URL !== config.apiOrigin) {
    throw new Error('VITE_API_URL does not match HSM_API_ORIGIN');
  }
  for (const key of [
    'VITE_PROVIDER_ONBOARDING_V2',
    'VITE_REALTIME_SOCKET_IO',
    'VITE_STRIPE_SANDBOX_ENABLED',
  ]) {
    if (!['true', 'false'].includes(env[key])) throw new Error(`${key} must be explicit`);
  }
  if (env.VITE_REALTIME_SOCKET_IO === 'true' && env.VITE_REALTIME_TRANSPORTS !== 'websocket') {
    throw new Error('VITE_REALTIME_TRANSPORTS must be websocket');
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_') && /SECRET|PASSWORD|PRIVATE_KEY|DATABASE|REDIS/u.test(key)) {
      throw new Error('Server credentials must not be exposed through VITE_ variables');
    }
  }
  const authCookiePrefix = env.VITE_AUTH_COOKIE_PREFIX ?? 'hsm';
  if (
    typeof authCookiePrefix !== 'string' ||
    authCookiePrefix !== authCookiePrefix.trim() ||
    !/^[a-z][a-z0-9_]{0,31}$/u.test(authCookiePrefix)
  ) {
    throw new Error('VITE_AUTH_COOKIE_PREFIX is invalid');
  }
  buildWebCsp(env);
  return { ...config, authCookiePrefix };
}

export function publicBuildIdentity(config) {
  const { schemaVersion, sourceSha, target, webOrigin, apiOrigin, authCookiePrefix } = config;
  return { schemaVersion, sourceSha, target, webOrigin, apiOrigin, authCookiePrefix };
}

function checkoutSourceSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Vercel may omit .git after checkout. Its immutable Git metadata is then
    // the source identity; a caller-supplied DEPLOY_SHA alone is insufficient.
    return undefined;
  }
}

async function stampIdentity(config) {
  const destination = path.join(ROOT, 'apps/web/public/deployment.json');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(publicBuildIdentity(config)) + '\n');
}

function buildWeb(env) {
  return spawnSync(
    'pnpm',
    [
      `--config.use-node-version=${NODE_VERSION}`,
      '--filter',
      '@homeservicemarketplace/web',
      'build',
    ],
    { cwd: ROOT, env, stdio: 'inherit' },
  );
}

export async function runHostedBuild(
  env,
  {
    checkToolchain = toolchainProblems,
    readCheckoutSha = checkoutSourceSha,
    checkApi = probeApi,
    stamp = stampIdentity,
    build = buildWeb,
  } = {},
) {
  const problems = await checkToolchain();
  if (problems.length) throw new Error(problems.join('; '));
  const config = hostedBuildConfig(env, readCheckoutSha());
  await checkApi(config);
  await stamp(config);
  const result = await build(env);
  if (result.error || result.status !== 0) throw new Error('Web production build failed');
  await checkApi(config);
  return config;
}

export function hostedBuildError(error) {
  // Never print raw filesystem/process errors or append their causes. Only
  // these exact, controlled diagnostics can reach the deployment log.
  const safe = new Set([
    'A full checked-out source SHA is required',
    'DEPLOY_SHA differs from the build source',
    'VERCEL_GIT_COMMIT_SHA differs from the build source',
    'The application target must match its release branch',
    'Vercel branch differs from the selected release branch',
    'Vercel target does not match the selected application environment',
    'VITE_API_URL does not match HSM_API_ORIGIN',
    'VITE_PROVIDER_ONBOARDING_V2 must be explicit',
    'VITE_REALTIME_SOCKET_IO must be explicit',
    'VITE_STRIPE_SANDBOX_ENABLED must be explicit',
    'VITE_REALTIME_TRANSPORTS must be websocket',
    'VITE_AUTH_COOKIE_PREFIX is invalid',
    'Server credentials must not be exposed through VITE_ variables',
    'API is not serving the exact release source SHA',
    'API dependencies are not ready',
    'Anonymous auth/me must return 401',
    'API credentialed CORS does not allow the exact web origin',
    'API preflight does not support credentialed CSRF-protected requests',
    'HTTPS probe failed; check DNS, TLS, routing and deployment protection',
    'Web production build failed',
  ]);
  const message = error instanceof Error ? error.message : '';
  return safe.has(message)
    ? message
    : 'Hosted web build failed; check the runtime, source, environment bindings and API readiness';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHostedBuild(process.env)
    .then((config) => console.log(`PASS web build and matching API source ${config.sourceSha}`))
    .catch((error) => {
      console.error('FAIL ' + hostedBuildError(error));
      process.exitCode = 1;
    });
}
