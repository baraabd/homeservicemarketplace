const assert = require('node:assert/strict');
const test = require('node:test');
const { buildWebCsp, exactOrigin, injectWebCsp } = require('./web-csp.cjs');
const parse = (value) =>
  Object.fromEntries(
    value.split('; ').map((d) => {
      const [name, ...sources] = d.split(' ');
      return [name, sources];
    }),
  );

test('Stripe sandbox opt-in permits only documented Elements resources and the 3DS return origin', () => {
  const baseline = parse(buildWebCsp({ VITE_API_URL: 'https://api.example.test' }));
  const policy = parse(
    buildWebCsp({
      VITE_API_URL: 'https://api.example.test',
      VITE_STRIPE_SANDBOX_ENABLED: 'true',
    }),
  );
  assert.deepEqual(policy['script-src'], [
    "'self'",
    'https://js.stripe.com',
    'https://*.js.stripe.com',
  ]);
  assert.deepEqual(policy['connect-src'], [...baseline['connect-src'], 'https://api.stripe.com']);
  assert.deepEqual(policy['frame-src'], [
    "'self'",
    'https://js.stripe.com',
    'https://*.js.stripe.com',
    'https://hooks.stripe.com',
  ]);
  for (const name of Object.keys(baseline)) {
    if (!['script-src', 'connect-src', 'frame-src'].includes(name))
      assert.deepEqual(policy[name], baseline[name]);
  }
  assert.ok(
    !policy['script-src'].some((source) =>
      ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:'].includes(source),
    ),
  );
});

test('Stripe opt-out retains the restrictive default; malformed flags fail closed without echoing input', () => {
  const env = { VITE_API_URL: 'https://api.example.test' };
  for (const value of ['', 'false'])
    assert.equal(buildWebCsp({ ...env, VITE_STRIPE_SANDBOX_ENABLED: value }), buildWebCsp(env));
  for (const value of ['TRUE', '1', true, 'https://private.example.test', 'true; script-src *'])
    assert.throws(() => buildWebCsp({ ...env, VITE_STRIPE_SANDBOX_ENABLED: value }), {
      message: 'VITE_STRIPE_SANDBOX_ENABLED must be true or false',
    });
});

test('CSP explicitly binds API, socket, media and upload origins without widening scripts', () => {
  const csp = parse(
    buildWebCsp({
      VITE_API_URL: 'https://api.example.test',
      VITE_CSP_MEDIA_ORIGINS: 'https://cdn.example.test',
      VITE_CSP_UPLOAD_ORIGINS: 'https://uploads.example.test',
    }),
  );
  assert.deepEqual(csp['script-src'], ["'self'"]);
  assert.deepEqual(csp['script-src-attr'], ["'none'"]);
  assert.deepEqual(csp['default-src'], ["'none'"]);
  assert.ok(new Set(csp['connect-src']).has('wss://api.example.test'));
  assert.ok(new Set(csp['connect-src']).has('https://uploads.example.test'));
  assert.ok(new Set(csp['img-src']).has('https://cdn.example.test'));
  assert.ok(new Set(csp['img-src']).has('blob:'));
  assert.ok(new Set(csp['font-src']).has('https://fonts.gstatic.com'));
  assert.deepEqual(csp['worker-src'], ["'self'"]);
  assert.deepEqual(csp['frame-src'], ["'none'"]);
  assert.ok(
    !Object.values(csp)
      .flat()
      .some((value) => ['*', 'https:', 'wss:', "'unsafe-eval'"].includes(value)),
  );
});
for (const raw of [
  '*',
  'https:',
  'https://*.test',
  'https://api.test/path',
  'https://api.test/?private=value',
  'https://name:private@api.test',
  'https://api.test/#x',
  'https://api.test;script-src',
  'https://api.test\\@other.test',
  'https://api.test\n',
  'http://api.test',
  '//api.test',
  'data:text/html,x',
]) {
  test(`rejects unsafe configured origin ${JSON.stringify(raw)}`, () => {
    assert.throws(
      () => exactOrigin(raw, 'origin'),
      (error) => !error.message.includes('private'),
    );
    assert.throws(() =>
      buildWebCsp({ VITE_API_URL: 'https://api.test', VITE_CSP_MEDIA_ORIGINS: raw }),
    );
  });
}
for (const raw of [
  'https://%2A',
  'https://%2a.example.test',
  'https://api%3bprivate.example.test',
  'https://api%27private.example.test',
  'https://api%22private.example.test',
  'https://api%2cprivate.example.test',
  'https://＊.example.test',
  'https://api；private.example.test',
  'https://api＇private.example.test',
  'https://api＂private.example.test',
  'https://api，private.example.test',
]) {
  test(`rejects origin characters introduced by URL canonicalization ${JSON.stringify(raw)}`, () => {
    assert.throws(
      () => exactOrigin(raw, 'origin'),
      (error) => !error.message.includes('private'),
    );
    for (const key of ['VITE_API_URL', 'VITE_CSP_MEDIA_ORIGINS', 'VITE_CSP_UPLOAD_ORIGINS']) {
      assert.throws(() => buildWebCsp({ VITE_API_URL: 'https://api.test', [key]: raw }));
    }
  });
}
test('safe Unicode hosts, IPv6 and default ports retain canonical exact origins', () => {
  for (const [raw, expected] of [
    ['https://BÜCHER.example:443/', 'https://xn--bcher-kva.example'],
    ['https://[2001:db8::1]:8443/', 'https://[2001:db8::1]:8443'],
    ['http://[::1]:4326/', 'http://[::1]:4326'],
    ['https://APP.example:443/', 'https://app.example'],
  ]) {
    assert.equal(exactOrigin(raw, 'origin'), expected);
  }
});
test('loopback-only HTTP fixture keeps its exact API and WS port', () => {
  const csp = parse(buildWebCsp({ VITE_API_URL: 'http://127.0.0.1:4326' }));
  assert.ok(csp['connect-src'].includes('http://127.0.0.1:4326'));
  assert.ok(csp['connect-src'].includes('ws://127.0.0.1:4326'));
});
test('origin input is bounded, deduplicated and cannot inject a second directive', () => {
  assert.throws(() =>
    buildWebCsp({
      VITE_API_URL: 'https://api.test',
      VITE_CSP_UPLOAD_ORIGINS: Array(21).fill('https://store.test').join(','),
    }),
  );
  assert.throws(() =>
    buildWebCsp({
      VITE_API_URL: 'https://api.test',
      VITE_CSP_UPLOAD_ORIGINS: 'https://store.test,',
    }),
  );
  const csp = parse(
    buildWebCsp({
      VITE_API_URL: 'https://api.test',
      VITE_CSP_MEDIA_ORIGINS: 'https://cdn.test,https://cdn.test',
    }),
  );
  assert.equal(csp['img-src'].filter((x) => x === 'https://cdn.test').length, 1);
});
test('enforced metadata precedes resource loading and cannot be duplicated', () => {
  const html =
    '<html><head>\n<meta charset="UTF-8" /><script src="/app.js"></script></head></html>';
  const result = injectWebCsp(html, buildWebCsp({ VITE_API_URL: 'https://api.test' }));
  assert.ok(result.indexOf('charset=') < result.indexOf('Content-Security-Policy'));
  assert.ok(result.indexOf('Content-Security-Policy') < result.indexOf('<script'));
  assert.ok(!result.includes('Report-Only'));
  assert.throws(() => injectWebCsp(result, 'anything'));
  assert.throws(() => injectWebCsp('<head><script src="/early.js"></script>', 'anything'));
});

test('HTML insertion treats replacement tokens as literal policy text', () => {
  const result = injectWebCsp(
    '<head><meta charset="UTF-8" /></head>',
    'connect-src https://api$&.test',
  );
  assert.equal((result.match(/<head>/gu) ?? []).length, 1);
  assert.ok(result.includes('https://api$&amp;.test'));
});
