'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { API_ENV_PATHS } = require('./api-endpoint.cjs');

const ROOT = path.resolve(__dirname, '../..');
const META_KEYS = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_GRAPH_API_VERSION',
  'WHATSAPP_AUTH_TEMPLATE_NAME',
  'WHATSAPP_AUTH_TEMPLATE_LANGUAGE',
  'WHATSAPP_AUTH_TEMPLATE_APPROVED',
];
const GREEN_KEYS = ['GREEN_API_URL', 'GREEN_API_ID_INSTANCE', 'GREEN_API_TOKEN'];
const SETTINGS = [
  'WHATSAPP_PROVIDER',
  'WHATSAPP_REQUEST_TIMEOUT_MS',
  ...META_KEYS,
  ...GREEN_KEYS,
  'GREEN_API_AUTH_TEMPLATE_ID',
];
const STATES = new Set([
  'authorized',
  'notAuthorized',
  'blocked',
  'starting',
  'suspended',
  'sleepMode',
]);

async function settings(root, environment) {
  const values = {};
  for (const file of [...API_ENV_PATHS].reverse()) {
    try {
      const parsed = parseEnv(await fs.readFile(path.join(root, file), 'utf8'));
      for (const key of SETTINGS) if (parsed[key] !== undefined) values[key] = parsed[key];
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('An API environment file could not be read.', { cause: error });
    }
  }
  for (const key of SETTINGS) if (environment[key] !== undefined) values[key] = environment[key];
  return values;
}

// Keep these narrow checks aligned with apps/api/src/config/green-api.config.ts
// and env.schema.ts. The doctor does not load the application or its database.
function greenApiOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      /^(?:[0-9]+\.)?api\.green-?api\.com$/u.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function configuration(values) {
  const provider = values.WHATSAPP_PROVIDER ?? 'meta';
  const issues = [];
  if (!['meta', 'greenapi'].includes(provider))
    issues.push('WHATSAPP_PROVIDER must be meta or greenapi.');
  const timeout = Number(values.WHATSAPP_REQUEST_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 30000)
    issues.push('WHATSAPP_REQUEST_TIMEOUT_MS must be an integer from 1000 to 30000.');
  const trimmed = (key) => String(values[key] ?? '').trim();
  const required = provider === 'greenapi' ? GREEN_KEYS : provider === 'meta' ? META_KEYS : [];
  for (const key of required) if (!trimmed(key)) issues.push(`${key} is missing.`);
  const check = (key, valid) => {
    if (trimmed(key) && !valid) issues.push(`${key} has an invalid value.`);
  };
  // The API validates any populated setting, even for the inactive provider.
  // Empty optional strings normalize to undefined; they do not block a switch.
  const origin = greenApiOrigin(trimmed('GREEN_API_URL'));
  check('GREEN_API_URL', Boolean(origin) && trimmed('GREEN_API_URL').length <= 256);
  check('GREEN_API_ID_INSTANCE', /^[0-9]{5,32}$/u.test(trimmed('GREEN_API_ID_INSTANCE')));
  check('GREEN_API_TOKEN', /^[A-Za-z0-9_-]{1,4096}$/u.test(trimmed('GREEN_API_TOKEN')));
  check(
    'GREEN_API_AUTH_TEMPLATE_ID',
    /^[A-Za-z0-9_-]{1,256}$/u.test(trimmed('GREEN_API_AUTH_TEMPLATE_ID')),
  );
  check('WHATSAPP_ACCESS_TOKEN', trimmed('WHATSAPP_ACCESS_TOKEN').length <= 4096);
  check('WHATSAPP_PHONE_NUMBER_ID', /^[0-9]{5,32}$/u.test(trimmed('WHATSAPP_PHONE_NUMBER_ID')));
  check(
    'WHATSAPP_GRAPH_API_VERSION',
    /^v[0-9]{1,3}\.[0-9]{1,2}$/u.test(trimmed('WHATSAPP_GRAPH_API_VERSION')),
  );
  check(
    'WHATSAPP_AUTH_TEMPLATE_NAME',
    /^[a-z0-9_]{1,512}$/u.test(trimmed('WHATSAPP_AUTH_TEMPLATE_NAME')),
  );
  check(
    'WHATSAPP_AUTH_TEMPLATE_LANGUAGE',
    /^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(trimmed('WHATSAPP_AUTH_TEMPLATE_LANGUAGE')),
  );
  if (provider === 'meta') {
    if (
      trimmed('WHATSAPP_AUTH_TEMPLATE_APPROVED') &&
      !['1', 'true', 'yes', 'on'].includes(
        String(values.WHATSAPP_AUTH_TEMPLATE_APPROVED).toLowerCase(),
      )
    )
      issues.push(
        'WHATSAPP_AUTH_TEMPLATE_APPROVED must be true only after Meta has approved the authentication template.',
      );
  }
  return { provider, issues, origin, timeout };
}

/** Read-only. No OTP, database query, setting write, or dependency installation. */
async function runDoctor({
  root = ROOT,
  environment = process.env,
  args = [],
  fetchImpl = globalThis.fetch,
  log = console.log,
} = {}) {
  if (args.length === 1 && args[0] === '--help') {
    log('Usage: pnpm whatsapp:doctor [--check-connection]');
    log(
      'Default: local configuration only. --check-connection: read GREEN-API instance state; never send a message.',
    );
    return { exitCode: 0, connectionChecked: false };
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check-connection')) {
    log('FAIL Usage: pnpm whatsapp:doctor [--check-connection]');
    return { exitCode: 1, connectionChecked: false };
  }
  let values;
  try {
    values = await settings(root, environment);
  } catch {
    log('FAIL An API environment file could not be read. Check its permissions and format.');
    return { exitCode: 1, connectionChecked: false };
  }
  const { provider, issues, origin, timeout } = configuration(values);
  log(
    'INFO Precedence: process environment > apps/api/.env.local > apps/api/.env > .env.local > .env.',
  );
  for (const issue of issues) log(`FAIL ${issue}`);
  if (issues.length) return { exitCode: 1, configured: false, connectionChecked: false };
  log(`PASS ${provider} local settings are complete and have valid formats.`);
  log(
    'INFO Local configuration does not verify credentials, provider approval, the saved OTP channel, or message delivery. Restart the API after changes and inspect GET /v1/auth/config.',
  );
  if (!args.length) return { exitCode: 0, provider, configured: true, connectionChecked: false };
  if (provider !== 'greenapi') {
    log(
      'FAIL --check-connection supports GREEN-API instance state only. Meta settings were checked locally; no Meta request was made.',
    );
    return { exitCode: 1, provider, configured: true, connectionChecked: false };
  }
  try {
    // The provider puts its access key in the URL. Never log this URL or an
    // exception/response body, and never follow redirects with the key.
    const endpoint = `${origin}/waInstance${values.GREEN_API_ID_INSTANCE.trim()}/getStateInstance/${values.GREEN_API_TOKEN.trim()}`;
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const status =
        Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
          ? `HTTP ${response.status}`
          : 'HTTP error';
      log(
        `FAIL GREEN-API state check returned ${status}. Verify the instance credentials and provider access.`,
      );
      return { exitCode: 1, provider, configured: true, connectionChecked: true };
    }
    const result = await response.json();
    const state =
      result && typeof result === 'object' && STATES.has(result.stateInstance)
        ? result.stateInstance
        : 'unknown';
    if (state !== 'authorized') {
      log(`FAIL GREEN-API instance state: ${state}. Check authorization in the provider console.`);
      return { exitCode: 1, provider, configured: true, connectionChecked: true };
    }
    log(
      'PASS GREEN-API instance is authorized. No message was sent; recipient delivery still needs a separate acceptance test.',
    );
    return { exitCode: 0, provider, configured: true, connectionChecked: true };
  } catch (error) {
    const timeoutError =
      error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
    log(
      timeoutError
        ? 'FAIL GREEN-API state check timed out.'
        : 'FAIL GREEN-API state check could not complete. Check network access and the provider console.',
    );
    return { exitCode: 1, provider, configured: true, connectionChecked: true };
  }
}

module.exports = { runDoctor, greenApiOrigin };

if (require.main === module) {
  runDoctor({ args: process.argv.slice(2) })
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch(() => {
      console.error('FAIL WhatsApp diagnostics could not complete. No message was sent.');
      process.exitCode = 1;
    });
}
