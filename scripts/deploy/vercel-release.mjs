import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildWebCsp } = require('../production/security-app/web-csp.cjs');
const { validateSameSiteHosts } = require('./public-suffix.cjs');
const SHA = /^[a-f0-9]{40}$/u;

// Messages deliberately identify keys/checks, never input values or response bodies.
export function httpsOrigin(value, key) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(key + ': exact HTTPS origin required');
  }
  if (
    typeof value !== 'string' ||
    value !== url.origin ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !/^[a-z0-9.-]+$/u.test(url.hostname) ||
    !url.hostname.includes('.') ||
    /(^|\.)localhost$/u.test(url.hostname) ||
    /^[\d.]+$/u.test(url.hostname)
  ) {
    throw new Error(key + ': exact HTTPS origin required, without a path or trailing slash');
  }
  return url;
}

export function releaseConfig(env) {
  if (!['staging', 'production'].includes(env.DEPLOY_TARGET))
    throw new Error('DEPLOY_TARGET: invalid target');
  if (!SHA.test(env.DEPLOY_SHA ?? '')) throw new Error('DEPLOY_SHA: full source SHA required');
  const web = httpsOrigin(env.HSM_WEB_ORIGIN, 'HSM_WEB_ORIGIN');
  const api = httpsOrigin(env.HSM_API_ORIGIN, 'HSM_API_ORIGIN');
  // This adapter deliberately implements ADR 0001 topology B. It does not
  // assume that an external HTTP rewrite proxies WebSocket upgrades.
  const { cookieParent } = validateSameSiteHosts(web.hostname, api.hostname, env.HSM_COOKIE_DOMAIN);
  return {
    schemaVersion: 1,
    sourceSha: env.DEPLOY_SHA,
    target: env.DEPLOY_TARGET,
    webOrigin: web.origin,
    apiOrigin: api.origin,
    cookieDomain: '.' + cookieParent,
  };
}

export function validatePulledSettings(project, pulled, env) {
  const config = releaseConfig(env);
  if (
    !env.VERCEL_ORG_ID ||
    !env.VERCEL_PROJECT_ID ||
    project.orgId !== env.VERCEL_ORG_ID ||
    project.projectId !== env.VERCEL_PROJECT_ID
  ) {
    throw new Error('Vercel project identity does not match the selected GitHub environment');
  }
  if (project.settings?.rootDirectory !== 'apps/web') {
    throw new Error('Vercel Root Directory must be apps/web; run CLI from the repository root');
  }
  if (project.settings.framework && project.settings.framework !== 'vite') {
    throw new Error('Vercel framework must be Vite');
  }
  if (pulled.VITE_API_URL !== config.apiOrigin)
    throw new Error('VITE_API_URL does not match HSM_API_ORIGIN');
  for (const key of [
    'VITE_PROVIDER_ONBOARDING_V2',
    'VITE_REALTIME_SOCKET_IO',
    'VITE_STRIPE_SANDBOX_ENABLED',
  ]) {
    if (!['true', 'false'].includes(pulled[key]))
      throw new Error(key + ': explicit true/false required');
  }
  if (
    pulled.VITE_REALTIME_SOCKET_IO === 'true' &&
    pulled.VITE_REALTIME_TRANSPORTS !== 'websocket'
  ) {
    throw new Error('VITE_REALTIME_TRANSPORTS: this deployment adapter requires websocket');
  }
  for (const key of Object.keys(pulled)) {
    if (key.startsWith('VITE_') && /SECRET|PASSWORD|PRIVATE_KEY|DATABASE|REDIS/u.test(key)) {
      throw new Error('Server credentials must not be exposed through VITE_ variables');
    }
  }
  // Reuse the application's canonical origin/CSP validation, including S3.
  buildWebCsp(pulled);
  return config;
}

export function validateDomainBinding(domain, config, projectId) {
  if (
    domain?.name !== new URL(config.webOrigin).hostname ||
    domain.projectId !== projectId ||
    domain.verified !== true ||
    domain.redirect ||
    domain.customEnvironmentId
  ) {
    throw new Error(
      'Vercel domain must be verified, non-redirecting and owned by the selected project',
    );
  }
  if (
    (config.target === 'staging' && domain.gitBranch !== 'develop') ||
    (config.target === 'production' && domain.gitBranch)
  ) {
    throw new Error(
      'Vercel domain environment mismatch: staging requires develop; production must not track a preview branch',
    );
  }
}

export async function probeDomainBinding(config, env, fetchImpl = fetch) {
  if (!env.VERCEL_TOKEN || !env.VERCEL_PROJECT_ID || !env.VERCEL_ORG_ID) {
    throw new Error('Vercel project identity and token are required for the domain check');
  }
  const endpoint = new URL(
    'https://api.vercel.com/v9/projects/' +
      encodeURIComponent(env.VERCEL_PROJECT_ID) +
      '/domains/' +
      new URL(config.webOrigin).hostname,
  );
  if (env.VERCEL_ORG_ID.startsWith('team_')) endpoint.searchParams.set('teamId', env.VERCEL_ORG_ID);
  const res = await response(fetchImpl, endpoint.toString(), {
    headers: { Authorization: 'Bearer ' + env.VERCEL_TOKEN, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('Vercel project domain could not be verified');
  validateDomainBinding(await jsonBody(res, 'Vercel domain'), config, env.VERCEL_PROJECT_ID);
}

function headersFor(origin, config, bypass) {
  const headers = { Accept: 'application/json', 'Cache-Control': 'no-cache' };
  if (bypass && origin !== config.apiOrigin) headers['x-vercel-protection-bypass'] = bypass;
  return headers;
}

async function response(fetchImpl, url, options = {}) {
  let result;
  try {
    result = await fetchImpl(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('HTTPS probe failed; check DNS, TLS, routing and deployment protection');
  }
  return result;
}

async function jsonBody(res, check) {
  if (!res.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error(check + ': JSON required; an SPA fallback or sign-in page is not API health');
  }
  try {
    return await res.json();
  } catch {
    throw new Error(check + ': invalid JSON');
  }
}

export async function probeApi(config, fetchImpl = fetch) {
  const live = await response(fetchImpl, config.apiOrigin + '/health/live');
  const identity = await jsonBody(live, 'API liveness');
  if (!live.ok || identity.status !== 'ok' || identity.sourceSha !== config.sourceSha) {
    throw new Error('API is not serving the exact release source SHA');
  }
  const ready = await response(fetchImpl, config.apiOrigin + '/health/ready');
  const readiness = await jsonBody(ready, 'API readiness');
  if (
    !ready.ok ||
    readiness.ready !== true ||
    !Array.isArray(readiness.dependencies) ||
    !['postgres', 'redis'].every((name) =>
      readiness.dependencies.some((item) => item.name === name && item.status === 'up'),
    ) ||
    readiness.dependencies.some((item) => item.status !== 'up')
  ) {
    throw new Error('API dependencies are not ready');
  }
  const auth = await response(fetchImpl, config.apiOrigin + '/v1/auth/me', {
    headers: { Origin: config.webOrigin },
  });
  if (auth.status !== 401) throw new Error('Anonymous auth/me must return 401');
  if (
    auth.headers.get('access-control-allow-origin') !== config.webOrigin ||
    auth.headers.get('access-control-allow-credentials') !== 'true'
  ) {
    throw new Error('API credentialed CORS does not allow the exact web origin');
  }
  const preflight = await response(fetchImpl, config.apiOrigin + '/v1/auth/refresh', {
    method: 'OPTIONS',
    headers: {
      Origin: config.webOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token,x-client-kind',
    },
  });
  const allowed = (preflight.headers.get('access-control-allow-headers') ?? '')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim());
  const methods = (preflight.headers.get('access-control-allow-methods') ?? '')
    .toUpperCase()
    .split(',')
    .map((value) => value.trim());
  if (
    !preflight.ok ||
    preflight.headers.get('access-control-allow-origin') !== config.webOrigin ||
    preflight.headers.get('access-control-allow-credentials') !== 'true' ||
    !methods.includes('POST') ||
    !['content-type', 'x-csrf-token', 'x-client-kind'].every((key) => allowed.includes(key))
  ) {
    throw new Error('API preflight does not support credentialed CSRF-protected requests');
  }
}

export function deploymentOrigin(raw) {
  const value = raw.trim();
  const url = httpsOrigin(value, 'Deployment URL');
  if (!url.hostname.endsWith('.vercel.app'))
    throw new Error('CLI must return one immutable Vercel deployment URL');
  return url.origin;
}

export async function probeWeb(config, origin, bypass, fetchImpl = fetch) {
  const target = httpsOrigin(origin, 'Web probe URL').origin;
  if (target !== config.webOrigin && !new URL(target).hostname.endsWith('.vercel.app')) {
    throw new Error('Web probe target must be the selected domain or a Vercel deployment');
  }
  const headers = headersFor(target, config, bypass);
  const res = await response(fetchImpl, target + '/deployment.json', { headers });
  const identity = await jsonBody(res, 'Web source identity');
  if (
    !res.ok ||
    ['sourceSha', 'target', 'apiOrigin', 'webOrigin'].some((key) => identity[key] !== config[key])
  ) {
    throw new Error('Web deployment identity does not match the release');
  }
  for (const route of ['/', '/login', '/provider', '/admin']) {
    const page = await response(fetchImpl, target + route, { headers });
    if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) {
      throw new Error('SPA route probe failed');
    }
    const html = await page.text();
    if (
      !html.includes('id="root"') ||
      !/type=["']module["']/u.test(html) ||
      !/http-equiv=["']Content-Security-Policy["']/iu.test(html)
    ) {
      throw new Error('SPA entrypoint or enforced document CSP is missing');
    }
  }
}

async function fromPull(env, root) {
  const scope = env.DEPLOY_TARGET === 'production' ? 'production' : 'preview';
  const project = JSON.parse(await readFile(path.join(root, '.vercel/project.json'), 'utf8'));
  const pulled = parseEnv(
    await readFile(path.join(root, '.vercel/.env.' + scope + '.local'), 'utf8'),
  );
  return validatePulledSettings(project, pulled, env);
}

async function main() {
  const [command, arg, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('Unexpected arguments');
  const config = releaseConfig(process.env);
  if (command === 'validate' && !arg) {
    await fromPull(process.env, process.cwd());
    console.log(
      'PASS selected project, same-site deployment inputs and public build configuration',
    );
  } else if (command === 'verify-domain' && !arg) {
    await probeDomainBinding(config, process.env);
    console.log('PASS Vercel project domain and target environment binding');
  } else if (command === 'stamp' && !arg) {
    await fromPull(process.env, process.cwd());
    const destination = path.resolve('apps/web/public/deployment.json');
    await mkdir(path.dirname(destination), { recursive: true });
    // Public release metadata only. No cookie or service credential is published.
    const publicIdentity = { ...config };
    delete publicIdentity.cookieDomain;
    await writeFile(destination, JSON.stringify(publicIdentity) + '\n');
  } else if (command === 'probe-api' && !arg) {
    await probeApi(config);
    console.log('PASS API source, readiness, anonymous boundary and credentialed CORS');
  } else if (command === 'capture-url' && arg) {
    const origin = deploymentOrigin(await readFile(arg, 'utf8'));
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
    await writeFile(process.env.GITHUB_OUTPUT, 'url=' + origin + '\n', { flag: 'a' });
  } else if (command === 'probe-web' && arg) {
    await probeWeb(config, arg, process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
    console.log(
      'PASS immutable web source, CSP and SPA routes; user journeys remain a separate acceptance',
    );
  } else if (command === 'hostname' && !arg) {
    console.log(new URL(config.webOrigin).hostname);
  } else {
    throw new Error(
      'Usage: vercel-release.mjs validate|verify-domain|stamp|probe-api|hostname|capture-url <file>|probe-web <origin>',
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Files/JSON can contain secrets; only our own controlled diagnostics are safe.
    const safe =
      /^(DEPLOY_|HSM_|VITE_|Vercel |Server credentials|API |Anonymous |HTTPS |Web |SPA |CLI |Deployment URL|GITHUB_OUTPUT|Usage:|Unexpected arguments)/u;
    console.error(
      'FAIL ' +
        (safe.test(error.message) ? error.message : 'Release configuration could not be validated'),
    );
    process.exitCode = 1;
  });
}
