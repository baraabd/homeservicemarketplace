'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { apiOrigin, apiPort, webApiEndpoint } = require('./api-endpoint.cjs');

const ROOT = path.resolve(__dirname, '../..');
const AUTH_PATH = '/v1/auth/config';
const BODY_LIMIT = 16 * 1024;
const USAGE =
  'Usage: node scripts/dev/auth-connection-doctor.cjs [--web-origin http://localhost:5173] [--mode development]';

/** Use the same Vite loader as vite.config.ts, without its process.env side effects. */
async function loadWebEnvironment(root, environment, mode) {
  const webRoot = path.join(root, 'apps/web');
  const webRequire = createRequire(path.join(webRoot, 'package.json'));
  const source = `
    try {
      const { loadEnv } = await import(process.argv[1]);
      const values = loadEnv(process.argv[3], process.argv[2], '');
      process.stdout.write(JSON.stringify({ VITE_API_URL: values.VITE_API_URL }));
    } catch { process.exitCode = 1; }
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      source,
      pathToFileURL(webRequire.resolve('vite')).href,
      webRoot,
      mode,
    ],
    { env: { ...environment }, timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true },
  );
  // Never forward child output, stderr or exceptions: Vite debug logging can
  // contain private dotenv values. Only this public field leaves the loader.
  const values = JSON.parse(stdout);
  return { VITE_API_URL: values.VITE_API_URL };
}

function options(args) {
  const result = { webOrigin: 'http://localhost:5173', mode: 'development' };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--web-origin', '--mode'].includes(flag) || seen.has(flag) || !args[i + 1])
      throw new Error('usage');
    seen.add(flag);
    if (flag === '--web-origin') result.webOrigin = apiOrigin(args[i + 1].trim());
    else {
      if (!/^[A-Za-z0-9_-]{1,64}$/u.test(args[i + 1]) || args[i + 1] === 'local')
        throw new Error('usage');
      result.mode = args[i + 1];
    }
  }
  return result;
}

async function discard(response) {
  try {
    await response.body?.cancel();
  } catch {
    // A closed/aborted response is already discarded.
  }
}

async function readJson(response) {
  if (/text\/html/iu.test(response.headers.get('content-type') ?? '')) {
    await discard(response);
    return { issue: 'html' };
  }
  if (Number(response.headers.get('content-length')) > BODY_LIMIT) {
    await discard(response);
    return { issue: 'too-large' };
  }
  const reader = response.body?.getReader();
  if (!reader) return { issue: 'malformed-json' };
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT) {
      await reader.cancel();
      return { issue: 'too-large' };
    }
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (/^\s*(?:<!doctype\s+html|<html\b)/iu.test(text)) return { issue: 'html' };
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { issue: 'malformed-json' };
  }
}

function corsChecks(headers, webOrigin, preflight) {
  const checks = {
    origin: headers.get('access-control-allow-origin') === webOrigin,
    credentials: headers.get('access-control-allow-credentials') === 'true',
  };
  if (preflight) {
    checks.method = (headers.get('access-control-allow-methods') ?? '')
      .split(',')
      .some((method) => method.trim() === 'GET');
    checks.headers = (headers.get('access-control-allow-headers') ?? '')
      .toLowerCase()
      .split(',')
      .some((header) => header.trim() === 'x-client-kind');
  }
  return checks;
}

async function request({ origin, pathname, method = 'GET', webOrigin, fetchImpl, timeoutMs }) {
  try {
    const preflight = method === 'OPTIONS';
    const headers = { accept: 'application/json, text/plain, */*' };
    if (webOrigin) {
      headers.origin = webOrigin;
      if (preflight) {
        headers['access-control-request-method'] = 'GET';
        headers['access-control-request-headers'] = 'x-client-kind';
      } else headers['x-client-kind'] = 'web';
    }
    const response = await fetchImpl(`${origin}${pathname}`, {
      method,
      headers,
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const status = response.status;
    const cors = webOrigin ? corsChecks(response.headers, webOrigin, preflight) : undefined;
    if (preflight ? status < 200 || status >= 300 : status !== 200) {
      await discard(response);
      return { ok: false, issue: 'http', status, cors };
    }
    if (preflight) {
      await discard(response);
      return { ok: true, status, cors };
    }
    const body = await readJson(response);
    if (body.issue) return { ok: false, issue: body.issue, status, cors };
    if (pathname === '/health/ready') {
      return body.data?.ready === true
        ? { ok: true, status }
        : { ok: false, issue: body.data?.ready === false ? 'not-ready' : 'shape', status };
    }
    if (
      !['whatsapp', 'email'].includes(body.data?.otpChannel) ||
      typeof body.data?.whatsappAvailable !== 'boolean'
    )
      return { ok: false, issue: 'shape', status, cors };
    return {
      ok: true,
      status,
      cors,
      policy: { otpChannel: body.data.otpChannel, whatsappAvailable: body.data.whatsappAvailable },
    };
  } catch (error) {
    return {
      ok: false,
      issue: ['AbortError', 'TimeoutError'].includes(error?.name) ? 'timeout' : 'network',
    };
  }
}

function describe(result) {
  if (result.ok) return `HTTP ${result.status}`;
  if (result.issue === 'http')
    return `HTTP ${result.status}${result.status >= 300 && result.status < 400 ? '; redirects are not followed' : ''}`;
  return {
    html: 'HTML response; check the API origin and routing',
    'too-large': 'response exceeds the 16 KiB diagnostic limit',
    'malformed-json': 'response is not valid JSON',
    shape: 'JSON does not match the endpoint contract; check the running API version',
    'not-ready': 'API reports that its dependencies are not ready',
    timeout: 'request timed out; check the API listener and dependencies',
    network: 'network request failed; check the API listener, address and TLS configuration',
  }[result.issue];
}

/** Post-start, read-only public HTTP checks. No cookies, provider calls or writes. */
async function runDoctor({
  root = ROOT,
  environment = process.env,
  args = [],
  loadWebEnvironmentImpl = loadWebEnvironment,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  log = console.log,
} = {}) {
  if (args.length === 1 && args[0] === '--help') {
    log(USAGE);
    log('Run after starting the API, from a terminal with the same environment as Vite.');
    return { exitCode: 0, checked: false };
  }
  let selected;
  try {
    selected = options(args);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
      throw new Error('timeout');
  } catch {
    log(`FAIL ${USAGE}`);
    log('Use an absolute HTTP(S) web origin without credentials, path, query or fragment.');
    return { exitCode: 1, checked: false };
  }
  let endpoint;
  try {
    const webEnvironment = await loadWebEnvironmentImpl(root, environment, selected.mode);
    endpoint = await webApiEndpoint({
      root,
      webEnvironment,
      apiEnvironment: environment,
      command: 'serve',
      mode: selected.mode,
    });
    if (!endpoint.origin) throw new Error('no-origin');
  } catch {
    log(
      'FAIL Could not resolve the Vite API origin. Check installed pinned Node/Vite, readable env files, PORT and VITE_API_URL; no configuration was changed.',
    );
    return { exitCode: 1, checked: false };
  }
  log(
    `INFO API origin: ${endpoint.origin} (${endpoint.source === 'explicit' ? 'explicit VITE_API_URL' : 'inferred from API PORT'}).`,
  );
  log(
    `INFO Browser origin: ${selected.webOrigin}. Run this command in the web terminal; separate terminals can have different PORT values.`,
  );
  if (
    endpoint.source === 'explicit' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint.origin).hostname)
  ) {
    try {
      const port = await apiPort(root, environment);
      const url = new URL(endpoint.origin);
      if (Number(url.port || (url.protocol === 'https:' ? 443 : 80)) !== port)
        log(
          `WARN Explicit VITE_API_URL uses a different port from local API PORT ${port}. Verify the intended listener; explicit web configuration wins. Restart Vite after changing it.`,
        );
    } catch {
      log('WARN Local API PORT could not be compared; the explicit web API origin is still used.');
    }
  }
  const crossOrigin = endpoint.origin !== selected.webOrigin;
  const common = { origin: endpoint.origin, fetchImpl, timeoutMs };
  const [readiness, configuration, preflight] = await Promise.all([
    request({ ...common, pathname: '/health/ready' }),
    request({ ...common, pathname: AUTH_PATH, webOrigin: selected.webOrigin }),
    crossOrigin
      ? request({
          ...common,
          pathname: AUTH_PATH,
          method: 'OPTIONS',
          webOrigin: selected.webOrigin,
        })
      : Promise.resolve(null),
  ]);
  for (const [name, result] of [
    ['GET /health/ready', readiness],
    [`GET ${AUTH_PATH}`, configuration],
    ['OPTIONS auth config', preflight],
  ]) {
    if (result) log(`${result.ok ? 'PASS' : 'FAIL'} ${name}: ${describe(result)}.`);
  }
  const corsPassed =
    !crossOrigin ||
    (preflight.ok &&
      [configuration, preflight].every(
        (result) => result?.cors && Object.values(result.cors).every(Boolean),
      ));
  log(
    crossOrigin
      ? `${corsPassed ? 'PASS' : 'FAIL'} Credentialed browser CORS: exact web origin, credentials, GET and X-Client-Kind must be allowed on the applicable responses.`
      : 'INFO Same API and browser origin; cross-origin preflight is not required.',
  );
  if (crossOrigin && !corsPassed)
    log(
      'INFO Check API FRONTEND_URL/CORS_ORIGINS for the browser origin. A command-line HTTP success alone does not establish browser CORS.',
    );
  if (configuration.ok) {
    log(
      `INFO Server-selected authentication channel: ${configuration.policy.otpChannel}; no setting was changed.`,
    );
    if (!configuration.policy.whatsappAvailable)
      log(
        'WARN WhatsApp provider is not configured. The public policy is valid; use whatsapp-doctor.cjs separately for provider configuration.',
      );
  }
  const exitCode =
    readiness.ok && configuration.ok && (!crossOrigin || preflight.ok) && corsPassed ? 0 : 1;
  log(
    'INFO Only public HTTP responses and CORS headers were checked. No cookies, login, OTP delivery, provider requests or configuration writes.',
  );
  return {
    exitCode,
    checked: true,
    endpoint,
    webOrigin: selected.webOrigin,
    readiness,
    configuration,
    preflight,
    corsPassed,
  };
}

module.exports = { runDoctor, loadWebEnvironment };

if (require.main === module) {
  runDoctor({ args: process.argv.slice(2) })
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      console.error('FAIL Live auth diagnostics could not complete. No configuration was changed.');
      process.exitCode = 1;
    });
}
