'use strict';
// K03: one definition of the public, build-time web configuration. The web
// image build, the image smoke and the staging launcher all use this module, so
// a flag that changes the compiled bundle or its document CSP cannot be omitted
// from one path and silently defaulted in another. Values here are PUBLIC
// browser configuration; no secret may ever be added to this list.
const { createHash } = require('node:crypto');
const { buildWebCsp, exactOrigin, originList } = require('./web-csp.cjs');

const SCHEMA = 'hsm.web-public-config/v1';
const SHA = /^[a-f0-9]{40}$/u;
const FINGERPRINT = /^[a-f0-9]{64}$/u;
const TRANSPORTS = ['websocket', 'polling,websocket'];
/**
 * The only CSP *header* the web image sends on its documents (apps/web/nginx.conf).
 * Browsers enforce every policy present, so an extra or replaced header — e.g.
 * from an edge applying a generic web CSP — would intersect with the
 * build-bound document policy and silently block declared origins such as
 * Stripe.js. The document meta policy is the single web script/frame/connect
 * authority.
 */
const DOCUMENT_HEADER_CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'none'";

/**
 * Every Vite variable that changes the shipped bundle or its CSP. `explicit`
 * inputs have no image default: an omitted value fails the build instead of
 * compiling a different product than the release declares.
 */
const PUBLIC_WEB_INPUTS = Object.freeze([
  { envName: 'VITE_API_URL', field: 'apiUrl', kind: 'origin', explicit: true },
  {
    envName: 'VITE_AUTH_COOKIE_PREFIX',
    field: 'authCookiePrefix',
    kind: 'cookie-prefix',
    default: 'hsm',
  },
  {
    envName: 'VITE_PROVIDER_ONBOARDING_V2',
    field: 'onboardingV2',
    kind: 'boolean',
    explicit: true,
  },
  {
    envName: 'VITE_STRIPE_SANDBOX_ENABLED',
    field: 'stripeSandbox',
    kind: 'boolean',
    explicit: true,
  },
  {
    envName: 'VITE_DISPUTE_INTAKE_V1',
    field: 'disputeIntakeV1',
    kind: 'boolean',
    default: 'false',
  },
  {
    envName: 'VITE_REALTIME_SOCKET_IO',
    field: 'realtimeSocketIo',
    kind: 'boolean',
    default: 'false',
  },
  {
    envName: 'VITE_REALTIME_TRANSPORTS',
    field: 'realtimeTransports',
    kind: 'transports',
    default: 'websocket',
  },
  { envName: 'VITE_CSP_MEDIA_ORIGINS', field: 'cspMediaOrigins', kind: 'origins', default: '' },
  { envName: 'VITE_CSP_UPLOAD_ORIGINS', field: 'cspUploadOrigins', kind: 'origins', default: '' },
]);

function fail(code, key) {
  // Name the key, never echo the supplied value.
  throw new Error(`${code}: ${key}`);
}

function readInput(env, input) {
  const raw = env[input.envName];
  if (raw === '' && input.kind === 'cookie-prefix') fail('WEB_IMAGE_INPUT_INVALID', input.envName);
  if (raw === undefined || raw === '') {
    if (input.explicit) fail('WEB_IMAGE_INPUT_REQUIRED', input.envName);
    return input.default;
  }
  return raw;
}

/** Normalize and validate public build inputs; throws on any ambiguity. */
function publicWebConfig(env) {
  const config = { schema: SCHEMA };
  for (const input of PUBLIC_WEB_INPUTS) {
    const raw = readInput(env, input);
    if (typeof raw !== 'string') fail('WEB_IMAGE_INPUT_INVALID', input.envName);
    if (input.kind === 'boolean') {
      if (raw !== 'true' && raw !== 'false') fail('WEB_IMAGE_INPUT_INVALID', input.envName);
      config[input.field] = raw === 'true';
    } else if (input.kind === 'cookie-prefix') {
      if (raw !== raw.trim() || !/^[a-z][a-z0-9_]{0,31}$/.test(raw))
        fail('WEB_IMAGE_INPUT_INVALID', input.envName);
      config[input.field] = raw;
    } else if (input.kind === 'transports') {
      if (!TRANSPORTS.includes(raw)) fail('WEB_IMAGE_INPUT_INVALID', input.envName);
      config[input.field] = raw;
    } else if (input.kind === 'origin') {
      let origin;
      try {
        origin = exactOrigin(raw, input.envName);
      } catch {
        fail('WEB_IMAGE_INPUT_INVALID', input.envName);
      }
      if (origin !== raw) fail('WEB_IMAGE_INPUT_INVALID', input.envName);
      config[input.field] = origin;
    } else {
      try {
        config[input.field] = originList(raw, input.envName);
      } catch {
        fail('WEB_IMAGE_INPUT_INVALID', input.envName);
      }
    }
  }
  return Object.freeze(config);
}

/** The exact Vite environment equivalent to a normalized configuration. */
function viteEnvironment(config) {
  const env = {};
  for (const input of PUBLIC_WEB_INPUTS) {
    const value = config[input.field];
    env[input.envName] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return env;
}

/** Stable SHA-256 over the schema-ordered normalized configuration. */
function configFingerprint(config) {
  const ordered = { schema: config.schema };
  for (const input of PUBLIC_WEB_INPUTS) ordered[input.field] = config[input.field];
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function documentCsp(html) {
  const matches = [
    ...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/giu),
  ];
  if (matches.length !== 1) throw new Error('WEB_DOCUMENT_CSP_MISSING_OR_DUPLICATE');
  return matches[0][1]
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** Compare complete source expressions in the first matching CSP directive. */
function cspDirectiveHasSource(policy, directive, source) {
  for (const entry of policy.split(';')) {
    const [name, ...sources] = entry.trim().split(/\s+/u);
    if (name.toLowerCase() === directive.toLowerCase()) {
      // CSP ignores later duplicate directives. A similar host, userinfo or
      // path containing the expected origin must never count as that source.
      return sources.some((value) => value === source);
    }
  }
  return false;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Build-time identity for /build-info.json. Refuses a bundle whose emitted
 * document CSP differs from the one this configuration requires, e.g. a
 * Stripe sandbox build whose policy still blocks Stripe.js.
 */
function webBuildInfo({ sourceSha, env, html }) {
  if (typeof sourceSha !== 'string' || !SHA.test(sourceSha))
    throw new Error('WEB_IMAGE_INPUT_REQUIRED: SOURCE_SHA');
  const config = publicWebConfig(env);
  const policy = buildWebCsp(viteEnvironment(config));
  if (documentCsp(html) !== policy) throw new Error('WEB_IMAGE_CSP_MISMATCH');
  return {
    sourceSha,
    apiUrl: config.apiUrl,
    onboardingV2: config.onboardingV2,
    stripeSandbox: config.stripeSandbox,
    publicConfig: config,
    configFingerprint: configFingerprint(config),
    documentCspSha256: sha256(policy),
  };
}

const INFO_KEYS = [
  'sourceSha',
  'apiUrl',
  'onboardingV2',
  'stripeSandbox',
  'publicConfig',
  'configFingerprint',
  'documentCspSha256',
];

/**
 * Re-derive a deployed build identity from first principles. Nothing in a
 * fetched document is trusted until its configuration validates again and its
 * fingerprint, summary fields and CSP digest all agree.
 */
function verifyWebBuildInfo(info) {
  if (
    !info ||
    typeof info !== 'object' ||
    Array.isArray(info) ||
    Object.keys(info).length !== INFO_KEYS.length ||
    !INFO_KEYS.every((key) => Object.hasOwn(info, key)) ||
    !info.publicConfig ||
    typeof info.publicConfig !== 'object' ||
    info.publicConfig.schema !== SCHEMA ||
    Object.keys(info.publicConfig).length !== PUBLIC_WEB_INPUTS.length + 1
  )
    throw new Error('WEB_BUILD_INFO_INVALID');
  if (
    !PUBLIC_WEB_INPUTS.every(
      ({ field, kind }) =>
        Object.hasOwn(info.publicConfig, field) &&
        (kind === 'origins') === Array.isArray(info.publicConfig[field]),
    )
  )
    throw new Error('WEB_BUILD_INFO_INVALID');
  let config;
  try {
    config = publicWebConfig(viteEnvironment(info.publicConfig));
  } catch {
    throw new Error('WEB_BUILD_INFO_INVALID');
  }
  const fingerprint = configFingerprint(config);
  const policy = buildWebCsp(viteEnvironment(config));
  if (
    typeof info.sourceSha !== 'string' ||
    !SHA.test(info.sourceSha) ||
    typeof info.configFingerprint !== 'string' ||
    !FINGERPRINT.test(info.configFingerprint) ||
    info.configFingerprint !== fingerprint ||
    configFingerprint(info.publicConfig) !== fingerprint ||
    info.apiUrl !== config.apiUrl ||
    info.onboardingV2 !== config.onboardingV2 ||
    info.stripeSandbox !== config.stripeSandbox ||
    info.documentCspSha256 !== sha256(policy)
  )
    throw new Error('WEB_BUILD_INFO_INCONSISTENT');
  return { config, fingerprint, policy };
}

async function main(args) {
  if (args[0] === '--fingerprint' && args.length === 1) {
    console.log(configFingerprint(publicWebConfig(process.env)));
    return;
  }
  if (args[0] === '--write-build-info' && args.length === 3) {
    const fs = require('node:fs');
    const [, indexPath, outputPath] = args;
    const info = webBuildInfo({
      sourceSha: process.env.SOURCE_SHA,
      env: process.env,
      html: fs.readFileSync(indexPath, 'utf8'),
    });
    const expected = process.env.WEB_CONFIG_FINGERPRINT;
    if (typeof expected !== 'string' || !FINGERPRINT.test(expected))
      throw new Error('WEB_IMAGE_INPUT_REQUIRED: WEB_CONFIG_FINGERPRINT');
    if (expected !== info.configFingerprint)
      throw new Error('WEB_IMAGE_CONFIG_FINGERPRINT_MISMATCH');
    fs.writeFileSync(outputPath, `${JSON.stringify(info)}\n`, { flag: 'wx' });
    console.log(
      `PASS web build identity ${info.configFingerprint} stripeSandbox=${info.stripeSandbox}`,
    );
    return;
  }
  throw new Error(
    'usage: web-build-identity.cjs --fingerprint | --write-build-info dist/index.html dist/build-info.json',
  );
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DOCUMENT_HEADER_CSP,
  PUBLIC_WEB_INPUTS,
  configFingerprint,
  cspDirectiveHasSource,
  documentCsp,
  publicWebConfig,
  verifyWebBuildInfo,
  viteEnvironment,
  webBuildInfo,
};
