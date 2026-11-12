'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildWebCsp, injectWebCsp } = require('./web-csp.cjs');
const {
  DOCUMENT_HEADER_CSP,
  PUBLIC_WEB_INPUTS,
  configFingerprint,
  cspDirectiveHasSource,
  documentCsp,
  publicWebConfig,
  verifyWebBuildInfo,
  viteEnvironment,
  webBuildInfo,
} = require('./web-build-identity.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const SHA = 'a'.repeat(40);
const declared = {
  VITE_API_URL: 'https://api.example.test',
  VITE_PROVIDER_ONBOARDING_V2: 'false',
  VITE_STRIPE_SANDBOX_ENABLED: 'false',
};
const HEAD = '<!doctype html><html><head><meta charset="UTF-8" /><title>x</title></head></html>';
const built = (env) => injectWebCsp(HEAD, buildWebCsp(env));

test('CSP source checks reject deceptive hosts, paths and unrelated directives', () => {
  const source = 'https://js.stripe.com';
  assert.equal(
    cspDirectiveHasSource(`script-src 'self'\t${source}; object-src 'none'`, 'script-src', source),
    true,
  );
  for (const value of [
    'https://js.stripe.com.attacker.test',
    'https://js.stripe.com@attacker.test',
    'https://attacker.test/https://js.stripe.com',
    'https://attacker.test/?next=https://js.stripe.com',
    'https://js.stripe.com/path',
    'https://*.js.stripe.com',
  ]) {
    assert.equal(cspDirectiveHasSource(`script-src 'self' ${value}`, 'script-src', source), false);
  }
  assert.equal(
    cspDirectiveHasSource(`img-src ${source}; script-src 'self'`, 'script-src', source),
    false,
  );
  assert.equal(
    cspDirectiveHasSource(`script-src 'self'; script-src ${source}`, 'script-src', source),
    false,
  );
  assert.equal(cspDirectiveHasSource(`default-src ${source}`, 'script-src', source), false);
});

test('K03 reported defect: the web Dockerfile propagates every public build input', () => {
  const dockerfile = fs.readFileSync(path.join(ROOT, 'apps/web/Dockerfile'), 'utf8');
  const builder = dockerfile.split(/^FROM /mu)[1];
  for (const input of PUBLIC_WEB_INPUTS) {
    const arg = builder.match(new RegExp(`^ARG ${input.envName}(?:=(.*))?$`, 'mu'));
    assert.ok(arg, `${input.envName} must be a declared builder ARG`);
    if (input.explicit)
      assert.equal(arg[1], undefined, `${input.envName} must not have an image default`);
    else
      assert.equal(arg[1] ?? '', input.default, `${input.envName} default must match the bundle`);
    assert.match(
      builder,
      new RegExp(`\\b${input.envName}=\\$\\{${input.envName}\\}`, 'u'),
      `${input.envName} must reach the Vite build environment`,
    );
  }
  assert.match(builder, /^ARG WEB_CONFIG_FINGERPRINT$/mu);
  assert.match(builder, /web-build-identity\.cjs --write-build-info/u);
  const runtime = dockerfile.split(/^FROM /mu)[2];
  for (const label of ['io.hsm.web.config-fingerprint', 'io.hsm.web.stripe-sandbox'])
    assert.match(runtime, new RegExp(label.replaceAll('.', '\\.'), 'u'));
});

test('the image document header CSP is exactly the nginx frame/object/base policy', () => {
  const nginx = fs.readFileSync(path.join(ROOT, 'apps/web/nginx.conf'), 'utf8');
  const headers = [...nginx.matchAll(/add_header Content-Security-Policy "([^"]+)" always;/gu)];
  assert.ok(headers.length >= 3);
  for (const [, value] of headers) assert.equal(value, DOCUMENT_HEADER_CSP);
  // A header policy is intersected with the document policy by browsers: it
  // must never restrict the script/frame/connect sources the build declared.
  assert.doesNotMatch(DOCUMENT_HEADER_CSP, /script-src|frame-src|connect-src|default-src/u);
});

test('explicit inputs fail closed instead of compiling a default product', () => {
  for (const key of [
    'VITE_API_URL',
    'VITE_PROVIDER_ONBOARDING_V2',
    'VITE_STRIPE_SANDBOX_ENABLED',
  ]) {
    for (const value of [undefined, '']) {
      assert.throws(() => publicWebConfig({ ...declared, [key]: value }), {
        message: `WEB_IMAGE_INPUT_REQUIRED: ${key}`,
      });
    }
  }
  for (const value of ['TRUE', '1', 'yes', ' true', 'on'])
    assert.throws(() => publicWebConfig({ ...declared, VITE_STRIPE_SANDBOX_ENABLED: value }), {
      message: 'WEB_IMAGE_INPUT_INVALID: VITE_STRIPE_SANDBOX_ENABLED',
    });
  for (const value of [
    'https://api.example.test/',
    'https://api.example.test/v1',
    'http://api.test',
  ])
    assert.throws(() => publicWebConfig({ ...declared, VITE_API_URL: value }), /VITE_API_URL/u);
  assert.throws(
    () => publicWebConfig({ ...declared, VITE_REALTIME_TRANSPORTS: 'polling' }),
    /VITE_REALTIME_TRANSPORTS/u,
  );
});

test('cookie namespace validation is identical for image and Vite builds', () => {
  assert.equal(publicWebConfig(declared).authCookiePrefix, 'hsm');
  assert.equal(
    publicWebConfig({ ...declared, VITE_AUTH_COOKIE_PREFIX: 'hsm_staging' }).authCookiePrefix,
    'hsm_staging',
  );
  for (const value of ['', 'HSM', 'hsm\n', 'hsm;other', 'x'.repeat(33)]) {
    assert.throws(
      () => publicWebConfig({ ...declared, VITE_AUTH_COOKIE_PREFIX: value }),
      /VITE_AUTH_COOKIE_PREFIX/u,
    );
  }
});

test('errors never echo supplied values', () => {
  try {
    publicWebConfig({ ...declared, VITE_CSP_MEDIA_ORIGINS: 'https://user:private@cdn.test' });
    assert.fail('expected rejection');
  } catch (error) {
    assert.doesNotMatch(error.message, /private|cdn\.test/u);
  }
});

test('optional inputs default to the behavior compiled before K03', () => {
  const config = publicWebConfig(declared);
  assert.deepEqual(
    {
      authCookiePrefix: config.authCookiePrefix,
      disputeIntakeV1: config.disputeIntakeV1,
      realtimeSocketIo: config.realtimeSocketIo,
      realtimeTransports: config.realtimeTransports,
      cspMediaOrigins: config.cspMediaOrigins,
      cspUploadOrigins: config.cspUploadOrigins,
    },
    {
      authCookiePrefix: 'hsm',
      disputeIntakeV1: false,
      realtimeSocketIo: false,
      realtimeTransports: 'websocket',
      cspMediaOrigins: [],
      cspUploadOrigins: [],
    },
  );
});

test('every public input changes the fingerprint; equivalent spellings do not', () => {
  const base = configFingerprint(publicWebConfig(declared));
  assert.match(base, /^[a-f0-9]{64}$/u);
  const variants = {
    VITE_API_URL: 'https://api2.example.test',
    VITE_AUTH_COOKIE_PREFIX: 'hsm_staging',
    VITE_PROVIDER_ONBOARDING_V2: 'true',
    VITE_STRIPE_SANDBOX_ENABLED: 'true',
    VITE_DISPUTE_INTAKE_V1: 'true',
    VITE_REALTIME_SOCKET_IO: 'true',
    VITE_REALTIME_TRANSPORTS: 'polling,websocket',
    VITE_CSP_MEDIA_ORIGINS: 'https://cdn.example.test',
    VITE_CSP_UPLOAD_ORIGINS: 'https://upload.example.test',
  };
  assert.deepEqual(
    Object.keys(variants),
    PUBLIC_WEB_INPUTS.map((input) => input.envName),
  );
  const seen = new Set([base]);
  for (const [key, value] of Object.entries(variants)) {
    const fingerprint = configFingerprint(publicWebConfig({ ...declared, [key]: value }));
    assert.ok(!seen.has(fingerprint), `${key} must contribute to image identity`);
    seen.add(fingerprint);
  }
  assert.equal(
    configFingerprint(
      publicWebConfig({
        ...declared,
        VITE_CSP_MEDIA_ORIGINS: 'https://CDN.example.test, https://cdn.example.test',
      }),
    ),
    configFingerprint(
      publicWebConfig({ ...declared, VITE_CSP_MEDIA_ORIGINS: 'https://cdn.example.test' }),
    ),
  );
});

test('the Stripe sandbox flag changes only the documented Stripe CSP sources', () => {
  const off = buildWebCsp(viteEnvironment(publicWebConfig(declared)));
  const on = buildWebCsp(
    viteEnvironment(publicWebConfig({ ...declared, VITE_STRIPE_SANDBOX_ENABLED: 'true' })),
  );
  assert.doesNotMatch(off, /stripe/u);
  assert.match(off, /frame-src 'none'/u);
  assert.match(on, /script-src 'self' https:\/\/js\.stripe\.com https:\/\/\*\.js\.stripe\.com;/u);
  assert.match(on, /connect-src [^;]* https:\/\/api\.stripe\.com/u);
  const strip = (policy) =>
    policy
      .replaceAll(/ https:\/\/(?:\*\.)?(?:js|api|hooks)\.stripe\.com/gu, '')
      .replace("frame-src 'self'", "frame-src 'none'");
  assert.equal(strip(on), off, 'no other directive may widen with the Stripe flag');
  assert.doesNotMatch(on, /'unsafe-eval'|script-src[^;]*'unsafe-inline'|https:\/\/\*[ ;]/u);
});

test('build identity refuses a bundle whose document CSP differs from the declaration', () => {
  const env = { ...declared, VITE_STRIPE_SANDBOX_ENABLED: 'true' };
  // The audited image: flag declared for the release, never seen by Vite.
  assert.throws(() => webBuildInfo({ sourceSha: SHA, env, html: built(declared) }), {
    message: 'WEB_IMAGE_CSP_MISMATCH',
  });
  const info = webBuildInfo({ sourceSha: SHA, env, html: built(env) });
  assert.equal(info.stripeSandbox, true);
  assert.equal(info.configFingerprint, configFingerprint(publicWebConfig(env)));
  assert.throws(() => webBuildInfo({ sourceSha: 'unknown', env, html: built(env) }), /SOURCE_SHA/u);
  assert.throws(() => webBuildInfo({ sourceSha: SHA, env, html: HEAD }), /CSP_MISSING/u);
});

test('documentCsp reads exactly one escaped policy', () => {
  const html = built(declared);
  assert.equal(documentCsp(html), buildWebCsp(declared));
  assert.throws(() =>
    documentCsp(html.replace('</head>', `${html.match(/<meta http-equiv[^>]+>/u)[0]}</head>`)),
  );
});

test('deployed build-info is re-derived, never trusted', () => {
  const env = { ...declared, VITE_STRIPE_SANDBOX_ENABLED: 'true' };
  const info = JSON.parse(JSON.stringify(webBuildInfo({ sourceSha: SHA, env, html: built(env) })));
  const verified = verifyWebBuildInfo(info);
  assert.equal(verified.fingerprint, info.configFingerprint);
  assert.equal(verified.policy, buildWebCsp(env));
  const tamper = [
    (v) => (v.stripeSandbox = false),
    (v) => (v.publicConfig.stripeSandbox = false),
    (v) => (v.configFingerprint = 'b'.repeat(64)),
    (v) => (v.apiUrl = 'https://other.example.test'),
    (v) => (v.documentCspSha256 = 'c'.repeat(64)),
    (v) => (v.publicConfig.cspMediaOrigins = ['https://*.example.test']),
    (v) => (v.publicConfig.cspMediaOrigins = 'https://cdn.example.test'),
    (v) => (v.publicConfig.extra = true),
    (v) => delete v.publicConfig.realtimeTransports,
    (v) => (v.onboardingV2 = 'false'),
    (v) => (v.sourceSha = 'unknown'),
    (v) => (v.unexpected = 1),
  ];
  for (const change of tamper) {
    const copy = JSON.parse(JSON.stringify(info));
    change(copy);
    assert.throws(() => verifyWebBuildInfo(copy), /WEB_BUILD_INFO_/u);
  }
});
